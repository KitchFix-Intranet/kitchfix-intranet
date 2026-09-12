#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// _probe_notify_timing.mjs
// Measure the four steps of people/route.js:notify() in isolation
// so Kevin has real numbers for the parallel-fix vs delete-log
// decision.
// 2026-09-11.
// ═══════════════════════════════════════════════════════════════════
//
// Steps (in the current sequential order):
//   1. sendEmail  (admin)      -> sendEmailSA to Kevin only for probe
//   2. logNotify  (admin)      -> appendRowSA notification_log
//   3. sendEmail  (submitter)  -> sendEmailSA to k.fietek+probe
//   4. logNotify  (submitter)  -> appendRowSA notification_log
//
// Runs each step 3 times back-to-back and reports min/median/max +
// what the total wall time would look like under three shapes:
//   A. Sequential (current)
//   B. Parallel sends + parallel logs (proposed fix)
//   C. Parallel sends only (if log is deleted)
//
// Every send is [PROBE - IGNORE] tagged so Kevin's inbox knows this
// is instrumentation, not real ops mail. Every log row uses
// "PROBE-DELETE-ME" as the eventType so a Sheets grep can find + prune.
//
// Run:
//   node --import ./scripts/probes/_at_alias_hook.mjs \
//     --env-file=.env.local \
//     scripts/probes/_probe_notify_timing.mjs

const req = ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY"];
for (const k of req) {
  console.log(`${k}: ${process.env[k] ? "PRESENT" : "ABSENT"}`);
  if (!process.env[k]) { console.error(`\nABORT: ${k} missing`); process.exit(2); }
}

const { sendEmailSA } = await import("../../src/lib/gmail.js");
const { appendRowSA, SHEET_IDS } = await import("../../src/lib/sheets.js");

const SHEETS_COLLECTION_ID = SHEET_IDS.COLLECTION;
const NOTIF_TAB = "notification_log";
console.log(`\nSHEETS_COLLECTION_ID: ${SHEETS_COLLECTION_ID}  (from sheets.js SHEET_IDS.COLLECTION)`);

const SENDER      = "kitchfix.admin@kitchfix.com";
const DISPLAY     = "KitchFix Ops Hub PROBE";
const RECIPIENT   = "k.fietek@kitchfix.com";
const SUBJECT_TAG = `[PROBE - IGNORE ${new Date().toISOString().slice(0,19)}]`;

async function timeSend(label) {
  const t0 = Date.now();
  const res = await sendEmailSA({
    sender: SENDER, displayName: DISPLAY, to: RECIPIENT,
    subject: `${SUBJECT_TAG} ${label}`,
    html: `<p>Probe send - ${label}. Delete this email.</p>`,
  });
  return { ms: Date.now() - t0, res };
}

async function timeLog(label) {
  const t0 = Date.now();
  await appendRowSA(SHEETS_COLLECTION_ID, NOTIF_TAB, [
    new Date().toISOString(),
    RECIPIENT,
    "email",
    `${SUBJECT_TAG} ${label}`,
    "PROBE-DELETE-ME",
    "sent",
    label,
  ]);
  return { ms: Date.now() - t0 };
}

console.log(`\n═══ Individual step timings (3 iterations each) ═══\n`);
const results = { send: [], log: [] };

for (let i = 1; i <= 3; i++) {
  const s = await timeSend(`send iter=${i}`);
  console.log(`  sendEmailSA iter ${i}: ${String(s.ms).padStart(5)} ms  ${s.res}`);
  results.send.push(s.ms);
}

for (let i = 1; i <= 3; i++) {
  const l = await timeLog(`log iter=${i}`);
  console.log(`  appendRowSA iter ${i}: ${String(l.ms).padStart(5)} ms`);
  results.log.push(l.ms);
}

function stats(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  return { min: sorted[0], med: sorted[Math.floor(sorted.length / 2)], max: sorted[sorted.length - 1] };
}
const sendStats = stats(results.send);
const logStats  = stats(results.log);

console.log(`\n═══ Summary (per operation) ═══\n`);
console.log(`  sendEmailSA:  min=${sendStats.min} med=${sendStats.med} max=${sendStats.max} ms`);
console.log(`  appendRowSA:  min=${logStats.min}  med=${logStats.med}  max=${logStats.max}  ms`);

// Project the three shapes using median times.
const s = sendStats.med;
const l = logStats.med;
console.log(`\n═══ Projected end-to-end for notify() shapes ═══\n`);
console.log(`  A. Sequential (current):`);
console.log(`     send admin + log admin + send submitter + log submitter`);
console.log(`     = ${s} + ${l} + ${s} + ${l} = ${s + l + s + l} ms`);
console.log(`     Submitter's email STARTS at t=${s + l} ms`);
console.log(`\n  B. Parallel sends + parallel logs (proposed):`);
console.log(`     max(send admin, send submitter) + max(log admin, log submitter)`);
console.log(`     = ${s} + ${l} = ${s + l} ms`);
console.log(`     Submitter's email STARTS at t=0`);
console.log(`     Improvement: ${s + l} ms saved (${((100 * (s + l)) / (s + l + s + l)).toFixed(0)}% of the sequential total)`);
console.log(`\n  C. Parallel sends only (if notification_log is deleted):`);
console.log(`     max(send admin, send submitter)`);
console.log(`     = ${s} ms`);
console.log(`     Submitter's email STARTS at t=0`);
console.log(`     Improvement over A: ${(s + l + s + l) - s} ms saved (${((100 * ((s + l + s + l) - s)) / (s + l + s + l)).toFixed(0)}% of the sequential total)`);
console.log(`     Improvement over B: ${l} ms saved`);
