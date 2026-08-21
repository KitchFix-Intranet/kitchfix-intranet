// ════════════════════════════════════════════════════════════════════════════
// PROBE: arithmetic_fail breakdown — by vendor, by week, by account
//
// READ-ONLY. No writes.
//
// Companion to _probe_arithmetic_holds.mjs:
//   - the first probe drills into 15 specific rows + the math per row
//   - THIS probe aggregates ALL arithmetic_fail rows so we can see
//     concentration patterns — whether it's a few vendors, a recent
//     regression, or an everywhere-always problem.
//
// SOURCES (Sheets only — cron writes Sheets only):
//   - INVENTORY sheet -> "review_queue" tab (cols A..N)
//
// NOTE on time axis: review_queue rows don't carry a created_at on the
// Sheets side, so this probe uses invoice_date (col E of the queue row)
// as a time proxy. That's the date printed on the invoice itself, which
// is usually within a few days of the extraction date. Good enough to
// see clustering by week.
//
// USAGE
//   node --import ./scripts/_setup/register-aliases.mjs \
//        --env-file=.env.local scripts/_probe_arithmetic_holds_breakdown.mjs
//
//   Optional: --top=20  show top-N vendors (default 15)
// ════════════════════════════════════════════════════════════════════════════

import { safeRead, SHEET_IDS } from "../../src/lib/sheets.js";

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=", 2)[1];
  return fallback;
}
const TOP_N = parseInt(getArg("top", "15"), 10);

// review_queue column indices (cron's row-shapes.js)
const Q_VENDOR        = 2;
const Q_INVOICE_DATE  = 4;
const Q_ACCOUNT       = 5;
const Q_REASON        = 13;

// ── 1. Pull all review_queue rows ──
console.log("[probe] reading INVENTORY sheet, review_queue tab...");
const { rows: queueRows } = await safeRead(SHEET_IDS.INVENTORY, "review_queue");
console.log(`[probe] review_queue total rows: ${queueRows.length}`);

// ── 2. Filter to arithmetic_fail ──
const held = queueRows.filter((r) => String(r[Q_REASON] || "").trim() === "arithmetic_fail");
console.log(`[probe] arithmetic_fail rows: ${held.length}`);
console.log("");

if (held.length === 0) {
  console.log("[probe] No arithmetic_fail rows. Nothing to analyze.");
  process.exit(0);
}

// ── 3. Reason breakdown for reference (so we see the whole pie) ──
const reasonCounts = new Map();
for (const r of queueRows) {
  const reason = String(r[Q_REASON] || "").trim() || "(empty)";
  reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
}
console.log("REVIEW_QUEUE REASON DISTRIBUTION (whole table)");
console.log("─".repeat(60));
const totalQ = queueRows.length;
const reasonsSorted = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]);
for (const [reason, n] of reasonsSorted) {
  const pct = (n / totalQ * 100).toFixed(1);
  console.log(`  ${reason.padEnd(34)} ${String(n).padStart(5)}   ${pct.padStart(5)}%`);
}
console.log("");

// ── 4. Vendor concentration (within arithmetic_fail) ──
const vendorCounts = new Map();
for (const r of held) {
  const vendor = String(r[Q_VENDOR] || "").trim() || "(empty)";
  vendorCounts.set(vendor, (vendorCounts.get(vendor) || 0) + 1);
}
const vendorsSorted = [...vendorCounts.entries()].sort((a, b) => b[1] - a[1]);

console.log(`VENDOR CONCENTRATION (arithmetic_fail rows, top ${TOP_N})`);
console.log("─".repeat(60));
const topN = vendorsSorted.slice(0, TOP_N);
const topShare = topN.reduce((sum, [, n]) => sum + n, 0);
for (const [vendor, n] of topN) {
  const pct = (n / held.length * 100).toFixed(1);
  console.log(`  ${vendor.slice(0, 36).padEnd(36)} ${String(n).padStart(5)}   ${pct.padStart(5)}%`);
}
console.log(`  ${"─".repeat(36)}  ${"─".repeat(5)}   ${"─".repeat(5)}`);
console.log(`  ${`(top ${TOP_N} subtotal)`.padEnd(36)} ${String(topShare).padStart(5)}   ${(topShare / held.length * 100).toFixed(1).padStart(5)}%`);
const tailN = held.length - topShare;
console.log(`  ${`(${vendorsSorted.length - TOP_N} other vendors)`.padEnd(36)} ${String(tailN).padStart(5)}   ${(tailN / held.length * 100).toFixed(1).padStart(5)}%`);
console.log(`  TOTAL                                  ${String(held.length).padStart(5)}   100.0%`);
console.log("");
console.log(`  distinct vendors with at least one arithmetic_fail row: ${vendorsSorted.length}`);
console.log("");

// ── 5. Account concentration ──
const acctCounts = new Map();
for (const r of held) {
  const acct = String(r[Q_ACCOUNT] || "").trim() || "(empty)";
  acctCounts.set(acct, (acctCounts.get(acct) || 0) + 1);
}
console.log("ACCOUNT CONCENTRATION (arithmetic_fail rows)");
console.log("─".repeat(60));
for (const [acct, n] of [...acctCounts.entries()].sort((a, b) => b[1] - a[1])) {
  const pct = (n / held.length * 100).toFixed(1);
  console.log(`  ${acct.padEnd(36)} ${String(n).padStart(5)}   ${pct.padStart(5)}%`);
}
console.log("");

// ── 6. Time histogram by week (using invoice_date as proxy) ──
function isoWeekKey(dateStr) {
  // Accept YYYY-MM-DD, ISO timestamp, or M/D/YYYY (US format)
  let d = null;
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (!s) return null;
  // ISO-ish
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) d = new Date(s);
  // US M/D/YYYY
  else if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
    const [m, dd, yy] = s.split("/");
    const yyyy = yy.length === 2 ? `20${yy}` : yy;
    d = new Date(`${yyyy}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`);
  }
  if (!d || isNaN(d.getTime())) return null;
  // ISO week: get Monday of the week
  const day = d.getUTCDay() || 7; // Sunday → 7
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 1));
  return monday.toISOString().slice(0, 10);
}

const weekCounts = new Map();
let undatedRows = 0;
for (const r of held) {
  const w = isoWeekKey(r[Q_INVOICE_DATE]);
  if (!w) { undatedRows++; continue; }
  weekCounts.set(w, (weekCounts.get(w) || 0) + 1);
}

console.log("TIME HISTOGRAM (week of invoice_date, ascending — uses invoice_date as proxy for extraction time)");
console.log("─".repeat(70));
if (weekCounts.size === 0) {
  console.log("  (no parseable invoice_date values)");
} else {
  const maxCount = Math.max(...weekCounts.values());
  const weeksSorted = [...weekCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [week, n] of weeksSorted) {
    const barLen = Math.round(n / maxCount * 40);
    const bar = "█".repeat(barLen);
    console.log(`  ${week}   ${String(n).padStart(4)}   ${bar}`);
  }
  console.log("");
  console.log(`  weeks with rows: ${weeksSorted.length}`);
  console.log(`  earliest week  : ${weeksSorted[0][0]}`);
  console.log(`  latest week    : ${weeksSorted[weeksSorted.length - 1][0]}`);
  console.log(`  peak week      : ${[...weekCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]} (${maxCount} rows)`);
}
if (undatedRows > 0) {
  console.log(`  ${undatedRows} row(s) had an unparseable or missing invoice_date`);
}
console.log("");

// ── 7. Vendor × week cross-tab for the top 5 vendors (to see if a specific vendor's
//       failures are clustered in time → format change, or spread evenly → always-been-this-way)
console.log("VENDOR × WEEK (top 5 vendors, last 12 weeks with arithmetic_fail rows)");
console.log("─".repeat(80));
const top5Vendors = vendorsSorted.slice(0, 5).map(([v]) => v);
const last12Weeks = [...weekCounts.keys()].sort((a, b) => b.localeCompare(a)).slice(0, 12).reverse();

if (top5Vendors.length > 0 && last12Weeks.length > 0) {
  // header
  console.log(`  ${"vendor".padEnd(30)} ${last12Weeks.map((w) => w.slice(5).padStart(6)).join(" ")}`);
  for (const v of top5Vendors) {
    const counts = last12Weeks.map((w) => {
      const c = held.filter((r) => {
        const rv = String(r[Q_VENDOR] || "").trim();
        const rw = isoWeekKey(r[Q_INVOICE_DATE]);
        return rv === v && rw === w;
      }).length;
      return String(c).padStart(6);
    });
    console.log(`  ${v.slice(0, 30).padEnd(30)} ${counts.join(" ")}`);
  }
}
console.log("");
console.log("done.");
