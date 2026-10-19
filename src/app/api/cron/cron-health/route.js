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
//
// extract-line-items vs the rare jobs: extract reinvokes every 5 min, so
// a single-newest-row model is fooled by (a) fresh in_progress rows that
// supersede older ones before aging into stale, and (b) reaped>0 rows
// getting buried under later clean ticks. For that one job the watchdog
// scans a 2-hour WINDOW of rows (see decideHealthWindow below). The
// other three jobs stay on single-newest-row (decideHealth), which is
// correct for them: a weekly or monthly cadence persists its newest row.
// Do NOT "simplify" the two paths back together - the window scan is
// pointless for the rare jobs and the newest-row model is dangerous for
// the frequent one.
const MONITORED = [
  {
    name:          "extract-line-items",
    model:         "window",
    maxSilenceMs:  30 * 60 * 1000,              // 30 min
    staleRunMs:    Math.max(15 * 60 * 1000, 2 * 300 * 1000), // 2x maxDuration(300s)
    windowMs:      2 * 60 * 60 * 1000,          // scan last 2 hours of rows
  },
  {
    name:          "sc-chase",
    model:         "newest",
    maxSilenceMs:  6 * 24 * 60 * 60 * 1000,     // 6 days (max legitimate gap)
    staleRunMs:    Math.max(15 * 60 * 1000, 2 * 60 * 1000),  // 2x maxDuration(60s), floor 15m
  },
  {
    name:          "schedule-drift",
    model:         "newest",
    maxSilenceMs:  8 * 24 * 60 * 60 * 1000,     // 8 days (weekly + 1-day margin)
    staleRunMs:    Math.max(15 * 60 * 1000, 2 * 60 * 1000),
  },
  {
    name:          "sc-bg-monthly-report",
    model:         "newest",
    maxSilenceMs:  33 * 24 * 60 * 60 * 1000,    // 33 days (monthly + 2-day margin)
    staleRunMs:    Math.max(15 * 60 * 1000, 2 * 120 * 1000), // 2x maxDuration(120s)
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
// which is exactly what the stale-claim check needs. Used by the rare
// jobs. extract-line-items uses windowRunsFor instead.
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

// Scan the last `windowMs` of rows for a job. Ordered newest-first on
// started_at (the window predicate also keys on started_at, so the
// range + sort hit the cron_runs_job_started_idx cleanly). Used only
// for extract-line-items; see decideHealthWindow for the rationale.
async function windowRunsFor(supa, jobName, now, windowMs) {
  const sinceIso = new Date(now - windowMs).toISOString();
  const { data, error } = await supa
    .from("cron_runs")
    .select("id, started_at, completed_at, status, summary, error_message")
    .eq("job_name", jobName)
    .gte("started_at", sinceIso)
    .order("started_at", { ascending: false });
  if (error) throw new Error(`windowRunsFor(${jobName}): ${error.message}`);
  return data || [];
}

// ─── Health decision - rare jobs (newest-row model) ──────────────────────
// Used for sc-chase, schedule-drift, sc-bg-monthly-report. Not used for
// extract-line-items; see decideHealthWindow below for why.
//
// The `if (!row)` branch is defensive after the migration seeds one row
// per monitored job at apply time (docs/migrations/cron-heartbeat.sql
// Step 4), so a job's silence clock starts at deploy, not at the epoch.
// Leaving the branch in because the migration could someday be re-applied
// against a wiped table.
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

  // 4. Healthy.
  return {
    healthy: true,
    reason: `${job.name}: healthy, last run ${fmtAgo(now - latestEventAt)}`,
  };
}

// ─── Health decision - frequent job (window scan) ────────────────────────
// Used ONLY for extract-line-items. The job reinvokes every 5 minutes,
// so a newest-row model has two blind spots that together let the
// October crash loop slip past undetected:
//
// A) Fresh in_progress rows never age into "stale". Vercel SIGKILLs the
//    process at maxDuration = 300s; the catch block never runs, so the
//    row stays in_progress. But a NEW in_progress row is created every
//    5 min by the next invocation. The newest in_progress row is almost
//    always younger than staleRunMs (15 min), so the stale check never
//    fires. Workaround: scan ALL rows in the window; any one of them
//    being stale is the signal.
//
// B) Reaper fires (summary.reaped > 0) get buried. li-4's reaper is the
//    REAL signal that a jam occurred, but the very next empty-queue tick
//    writes a fresh summary.reaped=0 success row. A reaper event is the
//    newest row only ~5 min out of every 15; roughly two-thirds of
//    reap events would be invisible to a newest-row watchdog running
//    every 15 min. Workaround: a reap anywhere in the 2h window is
//    unhealthy, even if the current newest row is clean.
//
// The newest-row silence check is still correct ("Vercel stopped
// invoking entirely") and is kept against the overall newest row.
function decideHealthWindow(now, job, rows) {
  // Silence: oldest-to-newest-event timestamp, measured against the
  // single newest row. If Vercel stopped invoking, no row of any kind
  // lands in the window.
  const newestRow = rows[0] || null;
  if (!newestRow) {
    // No rows in the window at all. Could mean the seed row has aged
    // out of the window AND no real run has landed since - the actual
    // silence SLA (30 min). Treat as unhealthy with the silence reason.
    return {
      healthy: false,
      reason: `${job.name}: no run in the last ${fmtAgo(job.windowMs)} (SLA ${fmtAgo(job.maxSilenceMs)})`,
    };
  }
  const newestStartedAt   = newestRow.started_at   ? new Date(newestRow.started_at).getTime()   : null;
  const newestCompletedAt = newestRow.completed_at ? new Date(newestRow.completed_at).getTime() : null;
  const newestEventAt     = newestCompletedAt ?? newestStartedAt ?? 0;
  if (now - newestEventAt > job.maxSilenceMs) {
    return {
      healthy: false,
      reason: `${job.name}: no run in ${fmtAgo(now - newestEventAt)} (SLA ${fmtAgo(job.maxSilenceMs)})`,
    };
  }

  // Reaper fired anywhere in the window. The real jam signal; report
  // the total reaped across the window.
  const reapedRows = rows.filter(r => Number(r?.summary?.reaped || 0) > 0);
  if (reapedRows.length > 0) {
    const totalReaped = reapedRows.reduce((s, r) => s + Number(r.summary.reaped || 0), 0);
    return {
      healthy: false,
      reason: `${job.name}: ${totalReaped} row(s) across ${reapedRows.length} tick(s) hit the crash ceiling and were reaped in the last ${fmtAgo(job.windowMs)}`,
    };
  }

  // Any failed row in the window.
  const failedRow = rows.find(r => r?.status === "failed");
  if (failedRow) {
    const failedAt = failedRow.completed_at
      ? new Date(failedRow.completed_at).getTime()
      : new Date(failedRow.started_at || 0).getTime();
    const msg = failedRow.error_message ? `: ${String(failedRow.error_message).slice(0, 200)}` : "";
    return {
      healthy: false,
      reason: `${job.name}: a run FAILED ${fmtAgo(now - failedAt)}${msg}`,
    };
  }

  // Any genuinely stale in_progress - one that was not superseded in
  // time. On the common SIGKILL path a NEW in_progress row supersedes
  // the old one every 5 min, so this fires only when an in_progress
  // row older than staleRunMs sits past where it should have been
  // superseded (a real hang that stopped the cron entirely, or a
  // claim that outlived its lease window).
  const staleInProgress = rows.find(r => {
    if (r?.status !== "in_progress") return false;
    const startedMs = r.started_at ? new Date(r.started_at).getTime() : null;
    return startedMs !== null && (now - startedMs) > job.staleRunMs;
  });
  if (staleInProgress) {
    const startedMs = new Date(staleInProgress.started_at).getTime();
    return {
      healthy: false,
      reason: `${job.name}: run stuck in_progress ${fmtAgo(now - startedMs)} (crashed or timed out mid-run)`,
    };
  }

  return {
    healthy: true,
    reason: `${job.name}: healthy, last run ${fmtAgo(now - newestEventAt)} (${rows.length} ticks in window)`,
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

    // Decide each job. extract-line-items uses the window scan; the
    // three rare jobs stay on single-newest-row. See the MONITORED
    // header comment for the full rationale.
    const perJob = [];
    for (const job of MONITORED) {
      let row = null;        // populated for the newest-row model
      let windowRows = null; // populated for the window model
      let readError = null;
      try {
        if (job.model === "window") {
          windowRows = await windowRunsFor(supa, job.name, nowMs, job.windowMs);
          row = windowRows[0] || null;
        } else {
          row = await latestRunFor(supa, job.name);
        }
      } catch (e) {
        readError = e.message;
      }
      let verdict;
      if (readError) {
        verdict = { healthy: false, reason: `${job.name}: cron_runs read failed: ${readError}` };
      } else if (job.model === "window") {
        verdict = decideHealthWindow(nowMs, job, windowRows || []);
      } else {
        verdict = decideHealth(nowMs, job, row);
      }
      perJob.push({ job: job.name, row, verdict, windowCount: windowRows?.length ?? null });
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
