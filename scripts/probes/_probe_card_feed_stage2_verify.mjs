// READ-ONLY. Post-run verification probe for the Stage 2 card feed
// cutover. Confirms two invariants and reports P11 card totals per
// account for a sanity scan.
//
// Invariants:
//   1. Pre-floor freeze: no purchasing_actuals row with
//      source='rippling_spend' AND txn_date < CARD_REPORT_SOURCE_FLOOR
//      has a derived_at >= today. If any does, VIOLATED.
//   2. P11 totals: rows above-floor sum per account, grouped by
//      excluded + Food-fallback status. Owner compares against the
//      report-side total (Chat-Claude's dry-run gave ~ the brief's
//      figure for P11).
//
// Output: a human-readable control report to ~/Downloads/ (carries
// account_keys and dollar figures; must NOT be committed). Stdout
// stays safe for logs - counts + HELD/VIOLATED PASS/FAIL only.
//
// Usage:
//   node --env-file=/path/to/.env.local scripts/probes/_probe_card_feed_stage2_verify.mjs

import { createClient } from "@supabase/supabase-js";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CARD_REPORT_SOURCE_FLOOR } from "../../src/lib/purchasing/reportToActualsMap.js";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function pageAll(builderFactory, pageSize = 1000) {
  const out = [];
  let from = 0;
  while (true) {
    const q = await builderFactory().range(from, from + pageSize - 1);
    if (q.error) throw new Error(q.error.message);
    const rows = q.data || [];
    for (const r of rows) out.push(r);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

const P11_START = "2026-10-05";
const P11_END   = "2026-11-01";

function money(n) {
  const v = Math.round(Number(n || 0) * 100) / 100;
  return (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const t0 = Date.now();
console.log(`card_feed_stage2_verify start=${new Date().toISOString()} floor=${CARD_REPORT_SOURCE_FLOOR}`);

// ─── 1. Pre-floor freeze check ──────────────────────────────────────
//
// The loader-3 write path never touches pre-floor rows. Any pre-floor
// row with derived_at >= today's start (UTC) means something OTHER than
// loader-3 wrote it today. HELD iff zero such rows.
const todayStartUTC = new Date();
todayStartUTC.setUTCHours(0, 0, 0, 0);
const todayStartISO = todayStartUTC.toISOString();

const touchedPreFloor = await pageAll(() =>
  supa.from("purchasing_actuals")
    .select("id, txn_date, derived_at, amount, excluded, account_key")
    .eq("source", "rippling_spend")
    .lt("txn_date", CARD_REPORT_SOURCE_FLOOR)
    .gte("derived_at", todayStartISO)
    .order("derived_at", { ascending: false }),
);

// Full pre-floor count + sum for the summary.
const preFloorAll = await pageAll(() =>
  supa.from("purchasing_actuals")
    .select("amount, excluded")
    .eq("source", "rippling_spend")
    .lt("txn_date", CARD_REPORT_SOURCE_FLOOR),
);
let preCount = 0, preSum = 0;
for (const r of preFloorAll) {
  preCount += 1;
  if (!r.excluded) preSum += Number(r.amount || 0);
}
const freezeHeld = touchedPreFloor.length === 0;

// ─── 2. Above-floor P11 totals per account ──────────────────────────
const p11Rows = await pageAll(() =>
  supa.from("purchasing_actuals")
    .select("account_key, gl_line_code, amount, excluded, txn_date, reconcile_status, has_receipt")
    .eq("source", "rippling_spend")
    .gte("txn_date", P11_START)
    .lte("txn_date", P11_END)
    .order("account_key"),
);

const byAccount = new Map();
let totalMapped = 0;
let totalMappedSum = 0;
let totalExcluded = 0;
let totalExcludedSum = 0;
let totalFoodFallback = 0;
let totalFoodFallbackSum = 0;
let reconcileCounts = {};

for (const r of p11Rows) {
  const amount = Number(r.amount || 0);
  const rs = r.reconcile_status || "(null)";
  reconcileCounts[rs] = (reconcileCounts[rs] || 0) + 1;
  if (r.excluded) {
    totalExcluded += 1;
    totalExcludedSum += amount;
    continue;
  }
  if (!r.gl_line_code) {
    totalFoodFallback += 1;
    totalFoodFallbackSum += amount;
  }
  totalMapped += 1;
  totalMappedSum += amount;
  const key = r.account_key || "(unattributed)";
  const slot = byAccount.get(key) || { rows: 0, sum: 0, uncoded: 0, uncodedSum: 0 };
  slot.rows += 1;
  slot.sum += amount;
  if (!r.gl_line_code) {
    slot.uncoded += 1;
    slot.uncodedSum += amount;
  }
  byAccount.set(key, slot);
}

// ─── Compose the control report (local only; carries PII / dollars) ─
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
const outPath = path.join(os.homedir(), "Downloads", `card_feed_stage2_verify_${stamp}.txt`);
const lines = [];
lines.push(`CARD FEED STAGE 2 VERIFY - CONTROL REPORT (local, do not commit)`);
lines.push(`generated: ${new Date().toISOString()}`);
lines.push(`floor: ${CARD_REPORT_SOURCE_FLOOR}  (above-floor is P11 forward; pre-floor is P10 and earlier)`);
lines.push(``);
lines.push(`─────────── 1. PRE-FLOOR FREEZE ───────────`);
lines.push(`total pre-floor rippling_spend rows: ${preCount}`);
lines.push(`total pre-floor non-excluded sum:    ${money(preSum)}`);
lines.push(``);
lines.push(`pre-floor rows with derived_at >= ${todayStartISO}: ${touchedPreFloor.length}`);
lines.push(`freeze: ${freezeHeld ? "HELD - no pre-floor row touched today" : "VIOLATED - see rows below"}`);
if (!freezeHeld) {
  lines.push(``);
  lines.push(`touched pre-floor rows (first 25):`);
  for (const r of touchedPreFloor.slice(0, 25)) {
    lines.push(`  id=${r.id}  txn_date=${r.txn_date}  derived_at=${r.derived_at}  account_key=${r.account_key || "(null)"}  amount=${money(r.amount)}  excluded=${r.excluded}`);
  }
}
lines.push(``);
lines.push(`─────────── 2. P11 CARD TOTALS (above-floor) ───────────`);
lines.push(`P11 window: ${P11_START} to ${P11_END}`);
lines.push(`total P11 rippling_spend rows: ${p11Rows.length}`);
lines.push(`  mapped (account_key, non-excluded): ${totalMapped}  sum ${money(totalMappedSum)}`);
lines.push(`  excluded (Remote / Corporate / GL overrides): ${totalExcluded}  sum ${money(totalExcludedSum)}`);
lines.push(`  food-fallback (uncoded, routed Food downstream): ${totalFoodFallback}  sum ${money(totalFoodFallbackSum)}`);
lines.push(``);
lines.push(`reconcile_status breakdown:`);
for (const [k, v] of Object.entries(reconcileCounts).sort((a, b) => b[1] - a[1])) {
  lines.push(`  ${k}: ${v}`);
}
lines.push(``);
lines.push(`per account (mapped non-excluded):`);
const accountRows = [...byAccount.entries()]
  .map(([k, v]) => ({ account: k, rows: v.rows, sum: v.sum, uncoded: v.uncoded, uncodedSum: v.uncodedSum }))
  .sort((a, b) => b.sum - a.sum);
lines.push(`  ${"account".padEnd(16)} ${"rows".padStart(6)}  ${"sum".padStart(14)}  ${"uncoded_rows".padStart(14)}  ${"uncoded_sum".padStart(14)}`);
for (const r of accountRows) {
  lines.push(`  ${r.account.padEnd(16)} ${String(r.rows).padStart(6)}  ${money(r.sum).padStart(14)}  ${String(r.uncoded).padStart(14)}  ${money(r.uncodedSum).padStart(14)}`);
}
lines.push(`  ${"TOTAL".padEnd(16)} ${String(totalMapped).padStart(6)}  ${money(totalMappedSum).padStart(14)}`);
lines.push(``);
lines.push(`─────────── END ───────────`);
lines.push(``);
await fs.writeFile(outPath, lines.join("\n"), "utf8");

// ─── Stdout summary (safe for logs - no names, accounts, dollars) ───
console.log(``);
console.log(`─── STAGE 2 VERIFY SUMMARY (safe for logs) ───`);
console.log(`pre_floor_rows:                ${preCount}`);
console.log(`pre_floor_rows_touched_today:  ${touchedPreFloor.length}`);
console.log(`pre_floor_freeze:              ${freezeHeld ? "HELD" : "VIOLATED"}`);
console.log(`p11_rows:                      ${p11Rows.length}`);
console.log(`p11_mapped_rows:               ${totalMapped}`);
console.log(`p11_excluded_rows:             ${totalExcluded}`);
console.log(`p11_food_fallback_rows:        ${totalFoodFallback}`);
console.log(`p11_accounts_with_cards:       ${byAccount.size}`);
console.log(``);
console.log(`control report written: ${outPath}`);
console.log(`duration: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
