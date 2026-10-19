// ═══════════════════════════════════════════════════════════════════════════
// /api/cron/cron-health - active watchdog over the four surviving crons.
// ═══════════════════════════════════════════════════════════════════════════
//
// Reads `cron_runs` (populated by startCronRun / finishCronRun in each
// wrapped cron), decides per-job health, and posts to Slack. Writes its
// OWN cron_runs row too (job_name = 'cron-health') so the watchdog itself
// is in the log and visible to any future observability layer.
//
// Register in vercel.json: `*/15 * * * *`. Fast enough that a dead
// 5-minute scanner surfaces within ~45 min; cheap because each run is
// four indexed reads and usually no Slack post.
//
// ─── Health decision per job (ordered) ───────────────────────────────────
//
// 1. Silence SLA breach: no row at all, OR latest timestamp older than
//    the job's max-silence-before-alert. Backstop for "Vercel never
//    invoked it". The rare-job SLAs are deliberately coarse (6/8/33
//    days) because that is the longest LEGITIMATE gap for each - reverse-
//    engineering a tighter window from the cron expression would
//    reintroduce the timezone/DST fragility we removed from sc-chase.
//    Checks 2-4 are cadence-independent and catch the common cases fast.
// 2. Latest status = 'failed' -> UNHEALTHY, include error_message.
// 3. Latest status = 'in_progress' AND started_at older than 2x the
//    job's maxDuration (15-min floor) -> UNHEALTHY, "crashed or timed
//    out mid-run". This is the stale-claim check; it is what would have
//    caught the October extract-line-items crash loop on tick one.
// 4. extract-line-items only: latest summary.reaped > 0 -> UNHEALTHY,
//    "N rows hit the crash ceiling and were reaped". Ties into li-4.
// 5. Otherwise HEALTHY.
//
// ─── Alerting + debounce ─────────────────────────────────────────────────
//
// A watchdog that cries every 15 minutes trains the operator to ignore
// it. Rules:
//   - A job newly UNHEALTHY (was healthy on the previous watchdog tick)
//     alerts immediately.
//   - A job that stays UNHEALTHY re-alerts at most once per 6 hours.
//
// State lives in the watchdog's own `cron_runs.summary.alerted` map
// (`{"extract-line-items":"<iso ts>"}`). No new table. Each tick reads
// its own previous row to decide; the current row carries the next
// state forward.
//
// ─── Weekly all-clear ────────────────────────────────────────────────────
//
// When all four jobs are healthy AND no all-clear has been posted in
// the last 6 days (tracked in the watchdog's own summary via
// `summary.lastAllClearAt`), post one positive line.
//
// This is the mitigation for the one gap in an in-repo watchdog: it
// cannot fully watch itself. If the watchdog dies, the weekly all-clear
// stops arriving, and its absence on a known cadence is the human-
// visible signal. Do not remove it as redundant - that silence is the
// signal.
//
// External dead-man's-switch (Better Stack / Pingdom / etc.) is the
// stronger upgrade - documented in RUNBOOK's Captain's log for the
// future. Not in scope for this PR.

import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { postSlack } from "@/lib/opsUtils";
import { startCronRun, finishCronRun } from "@/lib/cronRuns";

export const runtime     = "nodejs";
export const dynamic     = "force-dynamic";
export const maxDuration = 60;

// ─── Monitored jobs + per-job policy ─────────────────────────────────────
// maxSilenceMs is the "it never fired at all" backstop. staleRunMs is
// 2x the host cron's maxDuration (route.js export), floored at 15 min.
// Keep these in sync with each route's maxDuration if those change.
const MONITORED = [
  {
    name:          "extract-line-items",
    maxSilenceMs:  30 * 60 * 1000,              // 30 min
    staleRunMs:    Math.max(15 * 60 * 1000, 2 * 300 * 1000), // 2x maxDuration(300s)
    checkReaped:   true,
  },
  {
    name:          "sc-chase",
    maxSilenceMs:  6 * 24 * 60 * 60 * 1000,     // 6 days (max legitimate gap)
    staleRunMs:    Math.max(15 * 60 * 1000, 2 * 60 * 1000),  // 2x maxDuration(60s), floor 15m
    checkReaped:   false,
  },
  {
    name:          "schedule-drift",
    maxSilenceMs:  8 * 24 * 60 * 60 * 1000,     // 8 days (weekly + 1-day margin)
    staleRunMs:    Math.max(15 * 60 * 1000, 2 * 60 * 1000),
    checkReaped:   false,
  },
  {
    name:          "sc-bg-monthly-report",
    maxSilenceMs:  33 * 24 * 60 * 60 * 1000,    // 33 days (monthly + 2-day margin)
    staleRunMs:    Math.max(15 * 60 * 1000, 2 * 120 * 1000), // 2x maxDuration(120s)
    checkReaped:   false,
  },
];

const RE_ALERT_MS       = 6 * 60 * 60 * 1000;     // debounce window
const ALL_CLEAR_EVERY_MS = 6 * 24 * 60 * 60 * 1000; // weekly-ish

// ─── Time formatting ─────────────────────────────────────────────────────
function fmtAgo(ms) {
  if (ms == null || !Number.isFinite(ms)) return "unknown";
  const abs = Math.abs(ms);
  const min = Math.round(abs / 60000);
  if (min < 2) return `${Math.round(abs / 1000)}s ago`;
  if (min < 90) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 36) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

// ─── Per-job latest-row lookup ───────────────────────────────────────────
// Sorted by completed_at DESC NULLS FIRST (via the cron-heartbeat index)
// so an in_progress row (null completed_at) wins over a prior success,
// which is exactly what the stale-claim check needs.
async function latestRunFor(supa, jobName) {
  const { data, error } = await supa
    .from("cron_runs")
    .select("id, started_at, completed_at, status, summary, error_message")
    .eq("job_name", jobName)
    .order("completed_at", { ascending: false, nullsFirst: true })
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`latestRunFor(${jobName}): ${error.message}`);
  return data || null;
}

// ─── Health decision ─────────────────────────────────────────────────────
function decideHealth(now, job, row) {
  if (!row) {
    return { healthy: false, reason: `${job.name}: no run ever logged` };
  }
  const startedAt   = row.started_at   ? new Date(row.started_at).getTime()   : null;
  const completedAt = row.completed_at ? new Date(row.completed_at).getTime() : null;
  const latestEventAt = completedAt ?? startedAt ?? 0;

  // 1. Silence SLA
  if (now - latestEventAt > job.maxSilenceMs) {
    return {
      healthy: false,
      reason: `${job.name}: no run in ${fmtAgo(now - latestEventAt)} (SLA ${fmtAgo(job.maxSilenceMs)})`,
    };
  }

  // 2. Latest failed
  if (row.status === "failed") {
    const msg = row.error_message ? `: ${String(row.error_message).slice(0, 200)}` : "";
    return {
      healthy: false,
      reason: `${job.name}: last run FAILED ${fmtAgo(now - latestEventAt)}${msg}`,
    };
  }

  // 3. Stale in_progress - the crash-mid-run signal.
  if (row.status === "in_progress") {
    if (startedAt !== null && (now - startedAt) > job.staleRunMs) {
      return {
        healthy: false,
        reason: `${job.name}: run stuck in_progress ${fmtAgo(now - startedAt)} (crashed or timed out mid-run)`,
      };
    }
  }

  // 4. Reaper fired (extract-line-items only).
  if (job.checkReaped) {
    const reaped = Number(row.summary?.reaped || 0);
    if (reaped > 0) {
      return {
        healthy: false,
        reason: `${job.name}: ${reaped} row(s) hit the crash ceiling and were reaped last tick`,
      };
    }
  }

  // 5. Healthy.
  return {
    healthy: true,
    reason: `${job.name}: healthy, last run ${fmtAgo(now - latestEventAt)}`,
  };
}

// ─── Prior watchdog state (own cron_runs row) ────────────────────────────
async function readPriorWatchdogState(supa) {
  // Most recent completed cron-health run that landed success. We skip
  // the still-in-progress CURRENT row (its own insert) by requiring
  // completed_at not null AND status = 'success' so a prior half-run
  // doesn't poison the debounce memory.
  const { data, error } = await supa
    .from("cron_runs")
    .select("summary")
    .eq("job_name", "cron-health")
    .eq("status", "success")
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(`[cron-health] prior-state read failed: ${error.message}`);
    return { alerted: {}, lastAllClearAt: null };
  }
  const s = data?.summary || {};
  return {
    alerted:        s.alerted && typeof s.alerted === "object" ? s.alerted : {},
    lastAllClearAt: typeof s.lastAllClearAt === "string" ? s.lastAllClearAt : null,
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────
export async function GET(request) {
  const authHeader = request.headers.get("authorization") || "";
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supa = getServiceClient();
  const cronRunId = await startCronRun(supa, "cron-health");

  try {
    const nowMs = Date.now();
    const prior = await readPriorWatchdogState(supa);

    // Decide each job.
    const perJob = [];
    for (const job of MONITORED) {
      let row = null;
      let readError = null;
      try {
        row = await latestRunFor(supa, job.name);
      } catch (e) {
        readError = e.message;
      }
      const verdict = readError
        ? { healthy: false, reason: `${job.name}: cron_runs read failed: ${readError}` }
        : decideHealth(nowMs, job, row);
      perJob.push({ job: job.name, row, verdict });
    }

    // Compute the current alerted-map and which jobs should alert this tick.
    const toAlert     = [];
    const nextAlerted = {};
    for (const { job, verdict } of perJob) {
      if (verdict.healthy) continue;
      const priorAlertIso = prior.alerted[job];
      const priorAlertMs  = priorAlertIso ? new Date(priorAlertIso).getTime() : null;
      const dueForReAlert = priorAlertMs == null || (nowMs - priorAlertMs) > RE_ALERT_MS;
      if (dueForReAlert) {
        toAlert.push(verdict.reason);
        nextAlerted[job] = new Date(nowMs).toISOString();
      } else {
        // Still unhealthy, within debounce window - carry forward the
        // original alert timestamp so re-alert cadence is from the
        // first alert, not from each tick.
        nextAlerted[job] = priorAlertIso;
      }
    }

    const anyUnhealthy = perJob.some((p) => !p.verdict.healthy);
    const allHealthy   = !anyUnhealthy;

    // All-clear bookkeeping: only when all four are healthy AND
    // ALL_CLEAR_EVERY_MS has elapsed since the last all-clear post.
    const lastAllClearMs = prior.lastAllClearAt ? new Date(prior.lastAllClearAt).getTime() : null;
    const dueForAllClear =
      allHealthy && (lastAllClearMs == null || (nowMs - lastAllClearMs) > ALL_CLEAR_EVERY_MS);

    // Build messages. Alerts and the all-clear are separate posts so an
    // emergency unhealthy state never ships inside a "healthy" line.
    const messages = [];
    if (toAlert.length > 0) {
      messages.push("Cron watchdog: " + toAlert.join(" | "));
    }
    let nextAllClearAt = prior.lastAllClearAt;
    if (dueForAllClear) {
      const lines = perJob.map((p) => {
        const r = p.row;
        if (!r) return `${p.job} <no runs>`;
        const latestMs = r.completed_at ? new Date(r.completed_at).getTime()
                      : r.started_at   ? new Date(r.started_at).getTime()   : null;
        return `${p.job} ${fmtAgo(nowMs - (latestMs ?? nowMs))}`;
      });
      messages.push(`✓ All ${MONITORED.length} crons healthy. Last runs: ${lines.join(", ")}.`);
      nextAllClearAt = new Date(nowMs).toISOString();
    }

    // Post to Slack. Fail-soft on a missing webhook (same shape as the
    // retired sousai-daily): log to console.warn and continue, do NOT
    // 500 or throw.
    const webhook = process.env.SLACK_OPS_HEALTH_WEBHOOK;
    const slackResults = [];
    for (const text of messages) {
      if (!webhook) {
        console.warn(`[cron-health] SLACK_OPS_HEALTH_WEBHOOK unset; would post: ${text}`);
        slackResults.push({ posted: false, reason: "webhook_unset", text });
        continue;
      }
      try {
        const r = await postSlack(webhook, text);
        slackResults.push({ posted: !!r?.success, text });
      } catch (e) {
        console.warn(`[cron-health] postSlack threw: ${e?.message || e}`);
        slackResults.push({ posted: false, reason: "post_threw", error: e?.message, text });
      }
    }

    // Close the watchdog's own row with the carried-forward state so the
    // NEXT tick can decide debounce + all-clear from it.
    const outSummary = {
      checkedAt:       new Date(nowMs).toISOString(),
      jobs:            perJob.map((p) => ({ job: p.job, healthy: p.verdict.healthy, reason: p.verdict.reason })),
      alerted:         nextAlerted,
      lastAllClearAt:  nextAllClearAt,
      alertsThisTick:  toAlert.length,
      allClearPosted:  dueForAllClear,
      slack:           slackResults,
      webhookPresent:  !!webhook,
    };
    await finishCronRun(supa, cronRunId, { status: "success", summary: outSummary });

    return NextResponse.json({
      ok:            true,
      healthy:       allHealthy,
      alertsThisTick: toAlert.length,
      allClearPosted: dueForAllClear,
      jobs:          perJob.map((p) => ({ job: p.job, healthy: p.verdict.healthy, reason: p.verdict.reason })),
      slack:         slackResults,
    });
  } catch (e) {
    await finishCronRun(supa, cronRunId, {
      status: "failed",
      errorMessage: e?.message || String(e),
    });
    throw e;
  }
}
