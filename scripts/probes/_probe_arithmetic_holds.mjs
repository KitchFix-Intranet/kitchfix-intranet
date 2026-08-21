// ════════════════════════════════════════════════════════════════════════════
// PROBE: arithmetic_fail held rows + the math that put them there
//
// READ-ONLY. No writes. Uses the same Sheets service-account auth path the
// intranet + cron use.
//
// PURPOSE
//   The cron holds line items in review_queue with reason='arithmetic_fail'
//   when |qty * unit_price - extended_price| > 2% * |extended_price| + 0.01.
//   We want to see, on a sample of recent holds, whether the drift looks
//   like:
//     - rounding/cents       (drift% < 5%)        → gate marginally over-strict
//     - line-level discount  (drift% 5-30%)        → gate over-strict for food service
//                            or surcharge / fuel
//     - unit-swap mistake    (drift% 30-100%)      → mixed; could be either
//     - real OCR error       (drift% > 100%)       → gate doing its job
//
//   The output classifies each row + summarizes the distribution.
//
// READ SOURCES (Sheets only - the cron currently writes Sheets only):
//   - INVENTORY sheet -> "review_queue" tab        (the held rows)
//   - AI_LINE_ITEMS sheet -> per-account tab        (the source line items, to recompute math)
//
// USAGE
//   node --import ./scripts/_setup/register-aliases.mjs \
//        --env-file=.env.local scripts/_probe_arithmetic_holds.mjs
//
//   Optional override: pass --n=20 to pull more than the default 15 rows.
// ════════════════════════════════════════════════════════════════════════════

import { safeRead, SHEET_IDS } from "../src/lib/sheets.js";

// ── args ──
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=", 2)[1];
  return fallback;
}
const N_RECENT = parseInt(getArg("n", "15"), 10);

// ── row-shape references (must match the cron's row-shapes.js + ai_line_items parsing) ──
// review_queue cols (cron writes via shapes.makeQueueRow):
//   0:queueId 1:lineItemText 2:vendor 3:invoiceUuid 4:invoiceDate
//   5:account 6:suggestedMatchId 7:suggestedMatchName 8:confidence
//   9:status 10:reserved10 11:reserved11 12:reserved12 13:reason
const Q_LINE_ITEM_TEXT = 1;
const Q_VENDOR         = 2;
const Q_INVOICE_UUID   = 3;
const Q_ACCOUNT        = 5;
const Q_REASON         = 13;

// ai_line_items per-account tab (cron parses at index.js:309-315):
//   0:invoiceUuid 1:timestamp 2:account 3:vendor 4:invoiceNumber
//   5:invoiceDate 6:lineNum 7:description 8:quantity 9:unit
//   10:unitPrice 11:extendedPrice 12:category
const A_INVOICE_UUID   = 0;
const A_INVOICE_NUMBER = 4;
const A_DESCRIPTION    = 7;
const A_QUANTITY       = 8;
const A_UNIT_PRICE     = 10;
const A_EXTENDED_PRICE = 11;

// ── 1. Pull all review_queue rows ──
console.log("[probe] reading INVENTORY sheet, review_queue tab...");
const { rows: queueRows } = await safeRead(SHEET_IDS.INVENTORY, "review_queue");
console.log(`[probe] review_queue total rows: ${queueRows.length}`);

// ── 2. Filter to arithmetic_fail only ──
const heldRows = queueRows.filter((r) => String(r[Q_REASON] || "").trim() === "arithmetic_fail");
console.log(`[probe] arithmetic_fail rows: ${heldRows.length}`);
console.log("");

if (heldRows.length === 0) {
  console.log("[probe] No arithmetic_fail rows in review_queue. Nothing to analyze.");
  process.exit(0);
}

// Sheets appends to bottom -> last N are most recent
const recent = heldRows.slice(-N_RECENT);
console.log(`[probe] sampling the most-recent ${recent.length} held rows`);
console.log("");

// ── 3. Group by account so we read each AI_LINE_ITEMS tab only once ──
const byAccount = new Map();
for (const r of recent) {
  const account = String(r[Q_ACCOUNT] || "").trim();
  if (!account) continue;
  if (!byAccount.has(account)) byAccount.set(account, []);
  byAccount.get(account).push(r);
}

// ── 4. For each account, read AI_LINE_ITEMS + match each held row to its source line ──
const W_ACCT = 12, W_UUID = 10, W_VENDOR = 18, W_DESC = 40,
      W_QTY = 7, W_UNIT = 10, W_EXT = 10, W_CALC = 10,
      W_DRIFT = 8, W_PCT = 7, W_TOL = 7, W_VERDICT = 8;

function pad(s, n) { return String(s).padEnd(n); }
function padN(n, w) { return (typeof n === "number" ? n.toFixed(2) : String(n)).padStart(w); }

const HEADER = [
  pad("account",     W_ACCT),
  pad("uuid8",       W_UUID),
  pad("vendor",      W_VENDOR),
  pad("description", W_DESC),
  pad("qty",         W_QTY),
  pad("unit_price",  W_UNIT),
  pad("ext_price",   W_EXT),
  pad("calc",        W_CALC),
  pad("drift",       W_DRIFT),
  pad("drift%",      W_PCT),
  pad("tol",         W_TOL),
  pad("verdict",     W_VERDICT),
].join(" │ ");

const RULE = "─".repeat(HEADER.length);

console.log(RULE);
console.log(HEADER);
console.log(RULE);

let nFound = 0, nMissing = 0;
const driftRatios = [];

for (const [account, queueEntries] of byAccount) {
  let liRows = [];
  try {
    const r = await safeRead(SHEET_IDS.AI_LINE_ITEMS, account);
    liRows = r.rows || [];
  } catch (e) {
    console.warn(`[probe]   WARN couldn't read AI_LINE_ITEMS tab "${account}": ${e.message}`);
    continue;
  }

  for (const q of queueEntries) {
    const queueDesc   = String(q[Q_LINE_ITEM_TEXT] || "").trim();
    const invoiceUuid = String(q[Q_INVOICE_UUID]   || "").trim();
    const vendor      = String(q[Q_VENDOR]         || "").trim();
    const uuid8       = invoiceUuid.slice(0, 8);

    const liRow = liRows.find((r) => {
      const u = String(r[A_INVOICE_UUID] || "").trim();
      const d = String(r[A_DESCRIPTION]  || "").trim();
      return u === invoiceUuid && d.toLowerCase() === queueDesc.toLowerCase();
    });

    if (!liRow) {
      nMissing++;
      console.log([
        pad(account,                 W_ACCT),
        pad(uuid8,                   W_UUID),
        pad(vendor.slice(0, 18),     W_VENDOR),
        pad(queueDesc.slice(0, 40),  W_DESC),
        pad("?",                     W_QTY),
        pad("?",                     W_UNIT),
        pad("?",                     W_EXT),
        pad("?",                     W_CALC),
        pad("?",                     W_DRIFT),
        pad("?",                     W_PCT),
        pad("?",                     W_TOL),
        pad("NO_MATCH",              W_VERDICT),
      ].join(" │ "));
      continue;
    }

    nFound++;
    const qty   = Number(liRow[A_QUANTITY])       || 0;
    const unit  = Number(liRow[A_UNIT_PRICE])     || 0;
    const ext   = Number(liRow[A_EXTENDED_PRICE]) || 0;
    const calc  = qty * unit;
    const drift = Math.abs(calc - ext);
    const tol   = 0.02 * Math.abs(ext) + 0.01;
    const verdict = drift <= tol ? "PASS" : "FAIL";
    const driftPct = ext !== 0 ? (drift / Math.abs(ext) * 100) : null;
    if (driftPct !== null) driftRatios.push(driftPct);

    console.log([
      pad(account,                 W_ACCT),
      pad(uuid8,                   W_UUID),
      pad(vendor.slice(0, 18),     W_VENDOR),
      pad(queueDesc.slice(0, 40),  W_DESC),
      padN(qty,                    W_QTY),
      padN(unit,                   W_UNIT),
      padN(ext,                    W_EXT),
      padN(calc,                   W_CALC),
      padN(drift,                  W_DRIFT),
      pad(driftPct !== null ? driftPct.toFixed(1) + "%" : "n/a", W_PCT),
      padN(tol,                    W_TOL),
      pad(verdict,                 W_VERDICT),
    ].join(" │ "));
  }
}

console.log(RULE);
console.log("");
console.log(`joined to ai_line_items: ${nFound}   |   missing: ${nMissing}`);

if (driftRatios.length > 0) {
  driftRatios.sort((a, b) => a - b);
  const bucket = { lt5: 0, mid: 0, hi: 0, vhi: 0 };
  for (const d of driftRatios) {
    if (d < 5)        bucket.lt5++;
    else if (d < 30)  bucket.mid++;
    else if (d < 100) bucket.hi++;
    else              bucket.vhi++;
  }
  const med = driftRatios[Math.floor(driftRatios.length / 2)];
  const p90 = driftRatios[Math.floor(driftRatios.length * 0.9)];

  console.log("");
  console.log("DRIFT% DISTRIBUTION (read this to classify the holds)");
  console.log(`  < 5%        : ${bucket.lt5}   rounding/cents — gate marginally over-strict`);
  console.log(`  5%  - 30%   : ${bucket.mid}   likely discount/surcharge — gate over-strict for food service`);
  console.log(`  30% - 100%  : ${bucket.hi}   mixed — could be unit-swap OR real OCR error`);
  console.log(`  > 100%      : ${bucket.vhi}   likely real OCR magnitude error — gate doing its job`);
  console.log("");
  console.log(`  median drift%: ${med.toFixed(1)}%   p90 drift%: ${p90.toFixed(1)}%`);
}
