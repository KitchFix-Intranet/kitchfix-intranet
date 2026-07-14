import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import {
  TRACKED_TEAMS,
  diffSchedule,
  fetchTeamSchedule,
  formatSlackPayload,
  postSlack,
  HEARTBEAT_DOW,
} from "@/lib/scheduleDrift";

// ══════════════════════════════════════════════════════════════════════
// SCHEDULE-DRIFT WATCHDOG (Stage 1)
// Schedule: 0 11 * * *  (06:00 ET, before operator day)
//
// Detects nightly drift between the MLB / MiLB Stats API (calendar
// truth per Kevin's schedule-truth doctrine - see
// docs/modules/SERVICE_CALENDAR.md) and sc_homestand_schedule for the
// 8 schedule-bearing accounts. Posts alerts to the #service-calendar
// Slack channel via SLACK_SC_WEBHOOK_URL.
//
// ZERO WRITES to schedule / projection / metadata tables. Stage 1 is
// detect-and-notify only; applying changes stays the manual extract ->
// migration flow. Stages 2/3 (auto-draft, auto-apply) are PARKED to
// 2027 review (see SC_STATUS.md parked-projects).
//
// Auth: mirrors /api/cron/daily - Bearer <CRON_SECRET> in the
// Authorization header. Vercel Cron sets this automatically.
//
// Dry-run (auth'd caller): append ?dry=1 to skip the Slack POST and
// return the payload as JSON. Useful for local ops verification and
// for the live-proof step of the PR.
// ══════════════════════════════════════════════════════════════════════

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // 8 API calls + 8 DB reads + Slack post

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const isDryRun = searchParams.get("dry") === "1";
  const forceHeartbeat = searchParams.get("heartbeat") === "1";
  const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const startMs = Date.now();

  console.log(`[sc-drift] run ${runId} start (dry=${isDryRun}, forceHeartbeat=${forceHeartbeat})`);

  // Central-time day-of-week for the heartbeat gate. The cron fires at
  // 06:00 ET which is inside the same ET calendar day - so getDay() here
  // is safe against the UTC midnight edge.
  const isHeartbeatDay = forceHeartbeat || new Date().getDay() === HEARTBEAT_DOW;

  const supa = getServiceClient();
  const accountResults = [];

  // Fetch each team + diff. Sequential to keep the API load gentle and
  // to surface failures per-team (a single team's 5xx doesn't kill the
  // run; the failure lands in the Slack post's failures section).
  for (const team of TRACKED_TEAMS) {
    try {
      const [apiGames, hsRes] = await Promise.all([
        fetchTeamSchedule(team, { season: 2026 }),
        supa
          .from("sc_homestand_schedule")
          .select("service_date, day_type, opponent, game_pk, game_time, is_doubleheader")
          .eq("account_key", team.account)
          .gte("service_date", "2026-02-01")
          .lte("service_date", "2026-11-30")
          .order("service_date", { ascending: true }),
      ]);
      if (hsRes.error) throw new Error(`hs read: ${hsRes.error.message}`);
      const r = diffSchedule({ apiGames, hsRows: hsRes.data || [], account: team.account });
      accountResults.push({ account: team.account, ...r });
      console.log(`[sc-drift] ${team.account} :: OK ${r.counts.ok} · drifts ${r.drifts.length} · known ${r.knownGaps.length} · dh ${r.counts.dh} · ppd ${r.counts.ppd}`);
    } catch (e) {
      accountResults.push({ account: team.account, drifts: [], knownGaps: [], counts: {}, error: e.message });
      console.error(`[sc-drift] ${team.account} :: FAILED ${e.message}`);
    }
  }

  const payload = formatSlackPayload({
    accountResults,
    isHeartbeat: isHeartbeatDay,
    runId,
  });

  const totalDrifts = accountResults.reduce((a, r) => a + (r.drifts?.length || 0), 0);
  const totalKnown  = accountResults.reduce((a, r) => a + (r.knownGaps?.length || 0), 0);
  const failures    = accountResults.filter(r => r.error).length;
  const elapsedMs   = Date.now() - startMs;

  let slackResult = { posted: false, reason: "" };
  if (isDryRun) {
    slackResult = { posted: false, reason: "dry-run" };
  } else {
    slackResult = await postSlack(process.env.SLACK_SC_WEBHOOK_URL, payload);
  }

  console.log(`[sc-drift] run ${runId} done · drifts=${totalDrifts} known=${totalKnown} failures=${failures} elapsed=${elapsedMs}ms slack=${slackResult.posted}${slackResult.reason ? ` (${slackResult.reason})` : ""}`);

  return NextResponse.json({
    success: true,
    runId,
    elapsedMs,
    counts: { totalDrifts, totalKnown, failures, teams: TRACKED_TEAMS.length },
    isHeartbeat: isHeartbeatDay,
    isDryRun,
    slack: slackResult,
    // On dry-run OR when there's drift, echo the intended payload so
    // the caller can inspect. On clean+non-heartbeat production runs,
    // payload.shouldPost=false and there's nothing to echo.
    payload: (isDryRun || payload.shouldPost) ? payload : null,
    accountResults: isDryRun ? accountResults : accountResults.map(r => ({
      account: r.account,
      counts: r.counts,
      drifts: (r.drifts || []).length,
      knownGaps: (r.knownGaps || []).length,
      error: r.error || null,
    })),
  });
}
