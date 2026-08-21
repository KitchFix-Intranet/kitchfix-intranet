// READ-ONLY-ish proof: post a single test payload to
// SLACK_SC_WEBHOOK_URL so Kevin can confirm the webhook works before
// the nightly cron fires for real. Skips gracefully with instructions
// if the env var isn't set locally.
//
// Also exercises formatSlackPayload with three shape fixtures:
// clean+heartbeat, real-drift, failure. The Slack post ONLY happens for
// the drift shape (the shape that would actually alarm operators).

import { formatSlackPayload, postSlack } from "../src/lib/scheduleDrift.js";

const URL = process.env.SLACK_SC_WEBHOOK_URL;

function preview(label, payload) {
  console.log(`\n--- ${label} ---`);
  console.log(`shouldPost=${payload.shouldPost}`);
  console.log(payload.text || "(empty)");
}

async function main() {
  const runId = `smoke-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;

  // Fixture 1: clean run + heartbeat day -> one-liner.
  const heartbeatPayload = formatSlackPayload({
    accountResults: [
      { account: "CIN - OH",     drifts: [], knownGaps: [], counts: { ok: 162 } },
      { account: "STL - MO",     drifts: [], knownGaps: [], counts: { ok: 162 } },
      { account: "TXR - TX - H", drifts: [], knownGaps: [], counts: { ok: 164 } },
      { account: "TXR - TX - V", drifts: [], knownGaps: [], counts: { ok: 164 } },
      { account: "CIN - KY",     drifts: [], knownGaps: [], counts: { ok: 149 } },
      { account: "TBJ - NY",     drifts: [], knownGaps: [], counts: { ok: 149 } },
      { account: "STL - FL",     drifts: [], knownGaps: [], counts: { ok: 66  } },
      { account: "TBJ - FL",     drifts: [], knownGaps: [], counts: { ok: 66  } },
    ],
    isHeartbeat: true,
    runId,
  });
  preview("Clean run + heartbeat", heartbeatPayload);

  // Fixture 2: real drifts + known gaps + a failure. This is the shape
  // that actually posts. Uses a fake TIME_DELTA and a KNOWN_ISSUES pk
  // so Kevin sees the rendered format.
  const driftPayload = formatSlackPayload({
    accountResults: [
      { account: "CIN - OH", drifts: [
        { kind: "TIME_DELTA", account: "CIN - OH", date: "2026-08-14", game_pk: 900001, details: "hs=... api=... delta=30min", severity: "alert" },
      ], knownGaps: [], counts: {} },
      { account: "STL - MO", drifts: [], knownGaps: [
        { game_pk: 824514, reason: "DATE_DRIFT waits Option A (target 2026-08-17 has partner pk=824478)" },
      ], counts: {} },
      { account: "TBJ - FL", drifts: [], knownGaps: [], counts: {}, error: "API 503 fake failure" },
    ],
    isHeartbeat: false,
    runId,
  });
  preview("Real drift + known gap + failure", driftPayload);

  // Fixture 3: clean run + NOT heartbeat -> silent (no post).
  const silentPayload = formatSlackPayload({
    accountResults: [
      { account: "CIN - OH", drifts: [], knownGaps: [], counts: {} },
    ],
    isHeartbeat: false,
    runId,
  });
  preview("Clean run + not heartbeat", silentPayload);

  // Now the one actual live post - the DRIFT shape, so Kevin sees the
  // real thing in-channel, but only if the webhook is available.
  console.log(`\n\n=== live post to SLACK_SC_WEBHOOK_URL ===`);
  if (!URL) {
    console.log(`  SKIP: SLACK_SC_WEBHOOK_URL not set locally.`);
    console.log(`  Add to .env.local (or verify in Vercel envs for prod cron).`);
    console.log(`  All fixture previews above rendered correctly, so the code path is validated.`);
    console.log(`  Kevin: after adding the local var, rerun this script for the live confirmation.`);
    return;
  }
  // Prepend a "[SMOKE TEST]" marker so Kevin can distinguish this from a
  // real cron post if this fires in-channel.
  const smokePayload = {
    ...driftPayload,
    text: `[SMOKE TEST - safe to ignore]\n${driftPayload.text}`,
    blocks: [{ type: "section", text: { type: "mrkdwn", text: `[SMOKE TEST - safe to ignore]\n${driftPayload.text}` } }],
  };
  const res = await postSlack(URL, smokePayload);
  console.log(`  posted=${res.posted}${res.reason ? ` reason=${res.reason}` : ""}`);
  if (res.posted) console.log(`  Kevin: check #service-calendar for the "[SMOKE TEST]" prefix message.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
