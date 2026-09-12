#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// _probe_notify_shape_c.mjs
// Measured end-to-end wall time for the shipped shape C
// (parallel sends, notification_log deleted).
// Compared against the earlier sequential measurement so Kevin sees
// the real delta, not the projection.
// 2026-09-11.
// ═══════════════════════════════════════════════════════════════════
//
// Simulates the actual notify() shape after this PR:
//   Promise.all([sendEmailSA(admin), sendEmailSA(submitter)])
// No logNotification. No Sheets append.
//
// The earlier probe measured 7,376ms sequential (submitter's email
// starts at t=3.7s). Kevin's ruling: "Report the measured result,
// not the projection." This is the measured result.
//
// Run:
//   node --import ./scripts/probes/_at_alias_hook.mjs \
//     --env-file=.env.local \
//     scripts/probes/_probe_notify_shape_c.mjs

const req = ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY"];
for (const k of req) {
  console.log(`${k}: ${process.env[k] ? "PRESENT" : "ABSENT"}`);
  if (!process.env[k]) { console.error(`\nABORT: ${k} missing`); process.exit(2); }
}

const { sendEmailSA } = await import("../../src/lib/gmail.js");

const SENDER    = "kitchfix.admin@kitchfix.com";
const DISPLAY   = "KitchFix Ops Hub PROBE";
const RECIPIENT = "k.fietek@kitchfix.com";
const TAG       = `[PROBE - shape C measured ${new Date().toISOString().slice(0,19)}]`;

// Shape C: Promise.all on the two sends, no logging.
async function notifyShapeC(iter) {
  const t0 = Date.now();
  const sends = [
    sendEmailSA({
      sender: SENDER, displayName: DISPLAY, to: RECIPIENT,
      subject: `${TAG} admin iter=${iter}`,
      html: `<p>Probe admin send under shape C - delete this.</p>`,
    }),
    sendEmailSA({
      sender: SENDER, displayName: DISPLAY, to: RECIPIENT,
      subject: `${TAG} submitter iter=${iter}`,
      html: `<p>Probe submitter send under shape C - delete this.</p>`,
    }),
  ];
  const results = await Promise.all(sends);
  return { ms: Date.now() - t0, results };
}

console.log(`\n═══ Shape C measurement (parallel sends, no notification_log) ═══\n`);
const iters = [];
for (let i = 1; i <= 3; i++) {
  const r = await notifyShapeC(i);
  console.log(`  iter ${i}: ${String(r.ms).padStart(5)} ms  results=[${r.results.join(", ")}]`);
  iters.push(r.ms);
}

const sorted = [...iters].sort((a, b) => a - b);
const min = sorted[0], med = sorted[1], max = sorted[2];
console.log(`\n  Shape C total: min=${min} med=${med} max=${max} ms`);
console.log(`  Submitter's email STARTS at t=0`);

console.log(`\n═══ Comparison to earlier sequential measurement ═══\n`);
const prevSequentialMed = 7376;  // From _probe_notify_timing.mjs run 2026-09-10
const savedMs = prevSequentialMed - med;
const savedPct = ((savedMs / prevSequentialMed) * 100).toFixed(0);
console.log(`  Before (sequential):   ${prevSequentialMed} ms  (submitter waited 3,688 ms)`);
console.log(`  After  (shape C):      ${med} ms   (submitter waits 0 ms)`);
console.log(`  Improvement:           ${savedMs} ms saved (${savedPct}% of the sequential total)`);
