import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import {
  TRACKED_TEAMS,
  diffSchedule,
  fetchTeamSchedule,
  filterToAlerting,
  renderDrift,
  signatureOf,
  computeWeeklyDiff,
  formatWeeklyRecapPayload,
  postSlack,
} from "@/lib/scheduleDrift";
import { startCronRun, finishCronRun } from "@/lib/cronRuns";

// ══════════════════════════════════════════════════════════════════════
// SCHEDULE-DRIFT WATCHDOG - WEEKLY CHANGE-ONLY RECAP (sc-59, 2026-10-12)
// Schedule: 0 11 * * 1  (Monday 06:00 Central).
//
// Compares the current scoped drift set (DATE_DRIFT + PHANTOM_IN_DB
// only) against sc_schedule_drift_state and posts ONLY the delta -
// new signatures and cleared signatures. A quiet week with no changes
// posts nothing (fixes the daily-noise regression).
//
// Resilience: if the state read/write fails (e.g. migration not yet
// applied), log a warning and fall back to posting the current scoped
// list without the diff - never let a state error silence or crash the
// watch. Once Kevin applies sc-59 in Studio this path stops firing.
//
// ZERO WRITES to schedule / projection / metadata tables. The state
// table (sc_schedule_drift_state) is the only write target.
//
// Auth: Bearer <CRON_SECRET>. Dry-run via ?dry=1 (returns the computed
// payload without POSTing to Slack and without reconciling state).
// ══════════════════════════════════════════════════════════════════════

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function mondayOfRunUtc(nowUtc) {
  const d = new Date(nowUtc);
  const dow = d.getUTCDay();          // 0=Sun..6=Sat
  const isoIdx = (dow + 6) % 7;        // 0=Mon..6=Sun
  d.setUTCDate(d.getUTCDate() - isoIdx);
  return d.toISOString().slice(0, 10);
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const isDryRun = searchParams.get("dry") === "1";
  const nowUtc   = new Date();
  const runId    = nowUtc.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const weekOfIso = mondayOfRunUtc(nowUtc);
  const runYear   = Number(weekOfIso.slice(0, 4));
  const startMs = Date.now();

  console.log(`[sc-drift] weekly run ${runId} start (dry=${isDryRun}, weekOf=${weekOfIso})`);

  const supa = getServiceClient();
  // Heartbeat open AFTER the auth gate. Null id is tolerated if the
  // cron_runs table is missing; the watchdog detection just degrades.
  const cronRunId = await startCronRun(supa, "schedule-drift");

  try {
  const accountResults = [];

  for (const team of TRACKED_TEAMS) {
    try {
      const [apiGames, hsRes] = await Promise.all([
        fetchTeamSchedule(team, { season: runYear }),
        supa
          .from("sc_homestand_schedule")
          .select("service_date, day_type, opponent, game_pk, game_time, is_doubleheader")
          .eq("account_key", team.account)
          .gte("service_date", `${runYear}-02-01`)
          .lte("service_date", `${runYear}-11-30`)
          .order("service_date", { ascending: true }),
      ]);
      if (hsRes.error) throw new Error(`hs read: ${hsRes.error.message}`);
      const r = diffSchedule({ apiGames, hsRows: hsRes.data || [], account: team.account });
      accountResults.push({ account: team.account, ...r });
      console.log(`[sc-drift] ${team.account} :: OK ${r.counts.ok} · drifts ${r.drifts.length} (all kinds) · alerting ${filterToAlerting(r.drifts).length} · known ${r.knownGaps.length}`);
    } catch (e) {
      accountResults.push({ account: team.account, drifts: [], knownGaps: [], counts: {}, error: e.message });
      console.error(`[sc-drift] ${team.account} :: FAILED ${e.message}`);
    }
  }

  // ─── Build current scoped entries ──────────────────────────────────
  // Each entry carries signature + rendered display line. renderDrift
  // returns null for any kind outside ALERTING_KINDS; those were already
  // filtered, but we also drop null defensively so an unknown shape
  // can't crash the recap.
  const currentEntries = [];
  for (const r of accountResults) {
    if (r.error) continue;
    for (const d of filterToAlerting(r.drifts)) {
      const sig = signatureOf(d);
      const display = renderDrift(d, runYear);
      if (!sig || !display) continue;
      currentEntries.push({
        signature:   sig,
        account_key: r.account,
        kind:        d.kind,
        display,
        drift:       d,
      });
    }
  }
  const failures = accountResults.filter((r) => r.error).map((r) => ({ account: r.account, error: r.error }));

  // ─── Read prior state, compute diff, build payload ─────────────────
  let priorRows = null;
  let stateReadError = null;
  try {
    const stateRes = await supa
      .from("sc_schedule_drift_state")
      .select("signature, account_key, kind, display, first_seen, last_seen");
    if (stateRes.error) throw new Error(stateRes.error.message);
    priorRows = stateRes.data || [];
  } catch (e) {
    stateReadError = e.message;
    console.warn(`[sc-drift] state read FAILED - falling back to current-list post without diff: ${e.message}`);
  }

  // Failed-account set drives the CLEARED guard in computeWeeklyDiff:
  // a prior drift must only be posted / deleted when we successfully
  // verified its account this run. Otherwise a transient API blip
  // would false-clear real drifts (and re-alert them next week).
  const failedAccounts = new Set(accountResults.filter((r) => r.error).map((r) => r.account));

  let payload;
  let diff = null;
  if (priorRows !== null) {
    diff = computeWeeklyDiff({ currentEntries, priorRows, failedAccounts });
    payload = formatWeeklyRecapPayload({
      newItems:       diff.newItems,
      clearedItems:   diff.clearedItems,
      carryOpenCount: diff.carryOpen,
      failures,
      weekOfIso,
      runId,
      runYear,
    });
  } else {
    // Resilience fallback: no diff available. Post the current scoped
    // list as all-new rather than silencing the watch. Avoids the
    // Kevin-noted failure mode where a missing migration would hide
    // real drift behind a swallowed state error.
    payload = formatWeeklyRecapPayload({
      newItems:       currentEntries,
      clearedItems:   [],
      carryOpenCount: 0,
      failures,
      weekOfIso,
      runId,
      runYear,
    });
  }

  // ─── Post + reconcile state (unless dry-run) ───────────────────────
  let slackResult = { posted: false, reason: "" };
  let reconcile   = { inserts: 0, bumps: 0, deletes: 0, error: null };

  if (isDryRun) {
    slackResult = { posted: false, reason: "dry-run" };
  } else {
    slackResult = await postSlack(process.env.SLACK_SC_WEBHOOK_URL, payload);
    // Reconcile state regardless of post outcome, so a Slack failure
    // doesn't leave the state frozen in last week's shape. Only
    // reconcile when we successfully READ prior state and the recap
    // actually posted (keeps the "silent week -> no state write"
    // discipline Kevin asked for).
    if (priorRows !== null && diff && payload.shouldPost) {
      try {
        const now = new Date().toISOString();
        if (diff.reconcile.inserts.length > 0) {
          const ins = diff.reconcile.inserts.map((r) => ({ ...r, first_seen: now, last_seen: now }));
          const insRes = await supa.from("sc_schedule_drift_state").insert(ins);
          if (insRes.error) throw new Error(`inserts: ${insRes.error.message}`);
          reconcile.inserts = ins.length;
        }
        if (diff.reconcile.bumps.length > 0) {
          const bumpRes = await supa
            .from("sc_schedule_drift_state")
            .update({ last_seen: now })
            .in("signature", diff.reconcile.bumps);
          if (bumpRes.error) throw new Error(`bumps: ${bumpRes.error.message}`);
          reconcile.bumps = diff.reconcile.bumps.length;
        }
        if (diff.reconcile.deletes.length > 0) {
          const delRes = await supa
            .from("sc_schedule_drift_state")
            .delete()
            .in("signature", diff.reconcile.deletes);
          if (delRes.error) throw new Error(`deletes: ${delRes.error.message}`);
          reconcile.deletes = diff.reconcile.deletes.length;
        }
      } catch (e) {
        reconcile.error = e.message;
        console.warn(`[sc-drift] state reconcile FAILED (recap posted; state may be stale): ${e.message}`);
      }
    }
  }

  const elapsedMs = Date.now() - startMs;
  const currentCount = currentEntries.length;
  const summary = diff
    ? { newItems: diff.newItems.length, cleared: diff.clearedItems.length, carryOpen: diff.carryOpen }
    : { newItems: currentCount, cleared: 0, carryOpen: 0, fallback: true };

  console.log(`[sc-drift] weekly run ${runId} done · current=${currentCount} · ${JSON.stringify(summary)} · failures=${failures.length} · elapsed=${elapsedMs}ms · slack=${slackResult.posted}${slackResult.reason ? ` (${slackResult.reason})` : ""}${stateReadError ? ` · stateRead=FAILED(${stateReadError})` : ""}${reconcile.error ? ` · reconcile=FAILED(${reconcile.error})` : ""}`);

  // Heartbeat success close. Carries the per-run deltas the watchdog can
  // peek at via summary. isDryRun threads through so a dry-run tick is
  // distinguishable from a real one.
  await finishCronRun(supa, cronRunId, {
    status: "success",
    summary: {
      runId,
      weekOf:   weekOfIso,
      elapsedMs,
      dry:      isDryRun,
      newItems: summary.newItems,
      cleared:  summary.cleared,
      carryOpen: summary.carryOpen,
      failures: failures.length,
      teams:    TRACKED_TEAMS.length,
      fallbackFromStateError: priorRows === null,
    },
  });

  return NextResponse.json({
    success: true,
    runId,
    weekOf: weekOfIso,
    elapsedMs,
    counts: {
      currentAlerting: currentCount,
      newItems:        summary.newItems,
      cleared:         summary.cleared,
      carryOpen:       summary.carryOpen,
      failures:        failures.length,
      teams:           TRACKED_TEAMS.length,
    },
    fallbackFromStateError: priorRows === null,
    isDryRun,
    slack: slackResult,
    reconcile,
    payload: (isDryRun || payload.shouldPost) ? payload : null,
    accountResults: isDryRun ? accountResults : accountResults.map((r) => ({
      account:   r.account,
      counts:    r.counts,
      drifts:    (r.drifts || []).length,
      alerting:  filterToAlerting(r.drifts || []).length,
      knownGaps: (r.knownGaps || []).length,
      error:     r.error || null,
    })),
  });
  } catch (e) {
    // Preserve existing shape of a thrown-error exit (prior to this PR
    // the handler had no explicit catch and a throw would surface as a
    // 500). Finalize the heartbeat row as failed, then re-throw so the
    // response status is unchanged.
    await finishCronRun(supa, cronRunId, {
      status: "failed",
      errorMessage: e?.message || String(e),
    });
    throw e;
  }
}
