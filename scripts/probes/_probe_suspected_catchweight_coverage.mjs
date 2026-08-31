// USAGE (path aliases required)
// This probe imports from the `@/…` path alias, which Node cannot resolve
// on its own. Run with the alias hook installed via `--import`:
//
//   node --env-file=.env.local \
//        --import ./scripts/probes/_at_alias_hook.mjs \
//        scripts/probes/<this-file>
//
// Running without --import fails at import time with
//   `Cannot find package '@/…'`
// which reads identically to a probe defect - added 2026-08-31 after
// PR #916 review named this as the sentinel-#4 root cause.
// Coverage: how many pending arithmetic_fail rows are "suspected catch-weight"
// per the back-calc rule (impliedWeight = amount/unitPrice in [2, 500] AND
// case-count math fails - which is given because they're arithmetic_fail).
import { readSheetSA, SHEET_IDS } from "@/lib/sheets";

// Sheets review_queue indices
const RQ_QID = 0, RQ_DESC = 1, RQ_VENDOR = 2, RQ_INV = 3, RQ_ACCOUNT = 5, RQ_STATUS = 9, RQ_REASON = 13;
const AI_INV = 0, AI_DESC = 7, AI_QTY = 8, AI_UNIT = 9, AI_UP = 10, AI_AMT = 11;

const rqData = await readSheetSA(SHEET_IDS.INVENTORY, "review_queue");
const arith = (rqData.rows || []).filter((r) => {
  const status = String(r[RQ_STATUS] || "").trim().toLowerCase();
  if (status && status !== "pending") return false;
  return String(r[RQ_REASON] || "").trim() === "arithmetic_fail";
});
console.log("Total pending arithmetic_fail rows: " + arith.length);

// Group by account so we batch ai_line_items reads
const byAccount = new Map();
for (const r of arith) {
  const a = r[RQ_ACCOUNT];
  if (!byAccount.has(a)) byAccount.set(a, []);
  byAccount.get(a).push(r);
}

// Read each account's ai_line_items once
const liByAcct = new Map();
for (const acct of byAccount.keys()) {
  try {
    const d = await readSheetSA(SHEET_IDS.AI_LINE_ITEMS, acct);
    const m = new Map();
    for (const row of d.rows || []) {
      const k = (row[AI_INV] || "") + "::" + (row[AI_DESC] || "");
      if (!m.has(k)) m.set(k, row);
    }
    liByAcct.set(acct, m);
  } catch { liByAcct.set(acct, new Map()); }
}

const TOL = (am) => 0.02 * Math.abs(am) + 0.01;

let suspected = 0;
let total = 0;
let noLi = 0;
const byVendor = new Map();
const examples = [];

for (const r of arith) {
  const acct = r[RQ_ACCOUNT];
  const key = (r[RQ_INV] || "") + "::" + (r[RQ_DESC] || "");
  const li = liByAcct.get(acct)?.get(key);
  if (!li) { noLi++; continue; }
  total++;
  const qty = Number(li[AI_QTY]) || 0;
  const up  = Number(li[AI_UP])  || 0;
  const am  = Number(li[AI_AMT]) || 0;
  if (up <= 0 || am <= 0) continue;
  const implied = am / up;
  // Suspected catch-weight: implied weight in plausible range
  if (implied >= 2 && implied <= 500) {
    suspected++;
    const vendor = String(r[RQ_VENDOR] || "").trim() || "(unknown)";
    byVendor.set(vendor, (byVendor.get(vendor) || 0) + 1);
    if (examples.length < 15) {
      examples.push({
        vendor, account: acct, desc: r[RQ_DESC], qty, unit: li[AI_UNIT], up, am, implied,
      });
    }
  }
}

console.log("Lines we could join to ai_line_items: " + total);
console.log("Lines that could not be joined (zombie): " + noLi);
console.log();
console.log("SUSPECTED CATCH-WEIGHT (implied weight in [2,500]): " + suspected + "/" + total + " = " + ((suspected / Math.max(1, total)) * 100).toFixed(0) + "%");
console.log();
console.log("By vendor:");
for (const [v, n] of [...byVendor.entries()].sort((a, b) => b[1] - a[1])) {
  console.log("  " + v.padEnd(24) + " : " + n);
}
console.log();
console.log("15 examples (verify by eye whether these look like real catch-weight):");
for (const e of examples) {
  console.log("  " + e.vendor.slice(0, 16).padEnd(16) + " | " + (e.desc || "").slice(0, 46).padEnd(46) +
    " | qty=" + String(e.qty).padStart(4) + " " + (e.unit || "").padEnd(5) +
    " | up=$" + e.up.toFixed(3).padStart(8) + " | amt=$" + e.am.toFixed(2).padStart(8) +
    " | implied weight=" + e.implied.toFixed(2));
}

process.exit(0);
