// ════════════════════════════════════════════════════════════════════════════
// PROBE: ai_line_items.rawJson for arithmetic_fail extraction holds
//
// READ-ONLY. No writes.
//
// PURPOSE
//   Pull the raw Claude responses (ai_line_items col O / index 14, set at
//   src/lib/dataStore/invoice.js:651 to JSON.stringify(item) of what Claude
//   returned for each line) for the failing vendors Ben E Keith + Cheney
//   Brothers. Compare side-by-side: what's STORED in ai_line_items vs what
//   CLAUDE actually returned. The stored values are a pass-through of
//   Claude's response (invoiceActions.js:1331-1344), but seeing the raw
//   JSON confirms whether the qty field really carries a PACK / inner-
//   unit value vs the intended SHIPPED case count.
//
//   Also pulls historical PASSING Ben E Keith rows (pre-cutoff) so we can
//   contrast their raw shapes against the recent failing ones — if the
//   raw JSON looks different, something about BEK invoice layout or model
//   behavior changed late-May.
//
//   Also surfaces a scan-time week histogram (using ai_line_items.timestamp
//   col B, the write-time) so you can confirm the spike is in extraction-
//   time, not just invoice-date.
//
// SOURCES (Sheets only):
//   - AI_LINE_ITEMS spreadsheet, per-account tabs (TXR - TX - H, STL - FL,
//     STL - MO by default)
//   - INVENTORY spreadsheet, review_queue tab (for the arithmetic_fail set)
//
// USAGE
//   node --import ./scripts/_setup/register-aliases.mjs \
//        --env-file=.env.local scripts/_probe_extraction_rawjson.mjs
//
//   Override accounts: --accounts="TXR - TX - H,STL - FL,STL - MO,STL - MO - H"
//   Override sample sizes: --bek=10 --cheney=5 --old=5
//   Override the old/new cutoff: --cutoff=2026-05-25
// ════════════════════════════════════════════════════════════════════════════

import { safeRead, SHEET_IDS } from "../src/lib/sheets.js";

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=", 2)[1];
  return fallback;
}

const ACCOUNT_LIST = (getArg("accounts", "TXR - TX - H,STL - FL,STL - MO") || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

const N_FAILED_BEK     = parseInt(getArg("bek",    "10"), 10);
const N_FAILED_CHENEY  = parseInt(getArg("cheney", "5"),  10);
const N_PASSING_BEK_OLD = parseInt(getArg("old",   "5"),  10);
const OLD_CUTOFF       = getArg("cutoff", "2026-05-25");

// Target vendors (substring match, case-insensitive)
const VENDOR_MATCH = {
  BEK:    "ben e keith",
  CHENEY: "cheney",
};

// review_queue cols (cron's row-shapes.js)
const Q_LINE_ITEM_TEXT = 1;
const Q_INVOICE_UUID   = 3;
const Q_REASON         = 13;

// ai_line_items cols (15 total per dataStore/invoice.js:631-651)
const A_INVOICE_UUID   = 0;
const A_TIMESTAMP      = 1;   // SCAN-TIME (write time set at insert)
const A_ACCOUNT        = 2;
const A_VENDOR         = 3;
const A_INVOICE_NUMBER = 4;
const A_INVOICE_DATE   = 5;
const A_DESCRIPTION    = 7;
const A_QUANTITY       = 8;
const A_UNIT           = 9;
const A_UNIT_PRICE     = 10;
const A_EXTENDED_PRICE = 11;
const A_RAW_JSON       = 14;

// ── 1. Read review_queue, build arithmetic_fail key set (uuid::desc) ──
console.log(`[probe] reading INVENTORY/review_queue ...`);
const { rows: queueRows } = await safeRead(SHEET_IDS.INVENTORY, "review_queue");
const failedKey = new Set();
for (const r of queueRows) {
  if (String(r[Q_REASON] || "").trim() !== "arithmetic_fail") continue;
  const uuid = String(r[Q_INVOICE_UUID] || "").trim();
  const desc = String(r[Q_LINE_ITEM_TEXT] || "").trim().toLowerCase();
  if (uuid && desc) failedKey.add(`${uuid}::${desc}`);
}
console.log(`[probe] arithmetic_fail keys (uuid::desc): ${failedKey.size}`);
console.log("");

// ── 2. Read each account tab + classify rows by vendor + verdict ──
const allRows = [];
for (const account of ACCOUNT_LIST) {
  console.log(`[probe] reading AI_LINE_ITEMS/${account} ...`);
  let liRows = [];
  try {
    const r = await safeRead(SHEET_IDS.AI_LINE_ITEMS, account);
    liRows = r.rows || [];
    console.log(`[probe]   ${liRows.length} rows`);
  } catch (e) {
    console.warn(`[probe]   WARN couldn't read tab "${account}": ${e.message}`);
    continue;
  }

  for (const r of liRows) {
    const vendor = String(r[A_VENDOR] || "").trim();
    const vLower = vendor.toLowerCase();
    let vendorKey = null;
    for (const [k, sub] of Object.entries(VENDOR_MATCH)) {
      if (vLower.includes(sub)) { vendorKey = k; break; }
    }
    if (!vendorKey) continue;

    const uuid = String(r[A_INVOICE_UUID] || "").trim();
    const desc = String(r[A_DESCRIPTION]  || "").trim();
    const key = `${uuid}::${desc.toLowerCase()}`;
    const isInQueue = failedKey.has(key);

    const qty   = Number(r[A_QUANTITY])       || 0;
    const unit  = Number(r[A_UNIT_PRICE])     || 0;
    const ext   = Number(r[A_EXTENDED_PRICE]) || 0;
    const calc  = qty * unit;
    const drift = Math.abs(calc - ext);
    const tol   = 0.02 * Math.abs(ext) + 0.01;
    const ratio = unit !== 0 ? ext / unit : null;
    const verdict = drift <= tol ? "PASS" : "FAIL";

    allRows.push({
      account,
      vendor,
      vendorKey,
      uuid,
      description: desc,
      invoiceNumber: String(r[A_INVOICE_NUMBER] || "").trim(),
      invoiceDate:   String(r[A_INVOICE_DATE]   || "").trim(),
      timestamp:     String(r[A_TIMESTAMP]      || "").trim(),
      qty, unit, ext, calc, drift, tol, ratio,
      verdict,
      isInQueue,
      rawJson: String(r[A_RAW_JSON] || "").trim(),
    });
  }
}

console.log("");
console.log(`[probe] total BEK + Cheney rows across ${ACCOUNT_LIST.length} accounts: ${allRows.length}`);

// ── 3. Pick samples ──
function sortByTimestampDesc(rows) {
  return [...rows].sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
}

const failedBek    = sortByTimestampDesc(allRows.filter((x) => x.vendorKey === "BEK"    && x.verdict === "FAIL")).slice(0, N_FAILED_BEK);
const failedCheney = sortByTimestampDesc(allRows.filter((x) => x.vendorKey === "CHENEY" && x.verdict === "FAIL")).slice(0, N_FAILED_CHENEY);

const oldPassingBek = sortByTimestampDesc(
  allRows.filter((x) => x.vendorKey === "BEK" && x.verdict === "PASS" && (x.timestamp || "") < OLD_CUTOFF)
).slice(0, N_PASSING_BEK_OLD);

// ── 4. Print per-sample detail ──
function fmtNum(n) {
  if (n === null || n === undefined) return "n/a";
  if (typeof n !== "number" || !Number.isFinite(n)) return String(n);
  return n.toFixed(2);
}

function tryParseRawJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function printSection(label, sample) {
  console.log("");
  console.log("═".repeat(120));
  console.log(label);
  console.log("═".repeat(120));
  if (sample.length === 0) {
    console.log("  (no rows matched)");
    return;
  }
  for (const r of sample) {
    console.log("");
    console.log(`account: ${r.account}   vendor: ${r.vendor}   verdict: ${r.verdict}${r.isInQueue ? "  (row exists in review_queue)" : ""}`);
    console.log(`scan_time (ai_line_items.timestamp col B): ${r.timestamp}`);
    console.log(`invoice_date: ${r.invoiceDate}   invoice#: ${r.invoiceNumber}   uuid8: ${r.uuid.slice(0, 8)}`);
    console.log(`description: ${r.description}`);
    const ratioStr = r.ratio !== null && Number.isFinite(r.ratio) ? r.ratio.toFixed(3) : "n/a";
    console.log(`STORED  qty=${fmtNum(r.qty)}  unit_price=${fmtNum(r.unit)}  extended=${fmtNum(r.ext)}  | calc=${fmtNum(r.calc)}  drift=${fmtNum(r.drift)}  tol=${fmtNum(r.tol)}  ext/unit_ratio=${ratioStr}`);

    const parsed = tryParseRawJson(r.rawJson);
    if (parsed) {
      console.log(`CLAUDE  qty=${fmtNum(parsed.quantity)}  unit_price=${fmtNum(parsed.unitPrice)}  extended=${fmtNum(parsed.extendedPrice)}  unit="${parsed.unit || ""}"  lineNum=${parsed.lineNum ?? ""}  category=${parsed.category || ""}`);
      if (parsed.description && parsed.description !== r.description) {
        console.log(`        CLAUDE description: ${parsed.description}`);
      }
    } else if (r.rawJson) {
      console.log(`CLAUDE  rawJson unparseable (${r.rawJson.length} chars): ${r.rawJson.slice(0, 100)}${r.rawJson.length > 100 ? "..." : ""}`);
    } else {
      console.log(`CLAUDE  (rawJson empty)`);
    }
  }
}

printSection(`RECENT FAILED Ben E Keith (most recent ${N_FAILED_BEK}, sorted by scan_time desc)`, failedBek);
printSection(`RECENT FAILED Cheney Brothers (most recent ${N_FAILED_CHENEY}, sorted by scan_time desc)`, failedCheney);
printSection(`HISTORICAL PASSING Ben E Keith (pre-${OLD_CUTOFF}, most recent ${N_PASSING_BEK_OLD}) — compare RAW JSON shape vs recent failures`, oldPassingBek);

// ── 5. Scan-time week histogram for the 3 affected vendors ──
console.log("");
console.log("═".repeat(120));
console.log("SCAN-TIME WEEK HISTOGRAM (axis = ai_line_items.timestamp col B, the write-time)");
console.log("Scoped to: BEK + Cheney across the ACCOUNT_LIST accounts");
console.log("═".repeat(120));

function isoWeek(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  const day = d.getUTCDay() || 7;
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 1));
  return mon.toISOString().slice(0, 10);
}

const failW = new Map(), passW = new Map();
for (const r of allRows) {
  const w = isoWeek(r.timestamp);
  if (!w) continue;
  if (r.verdict === "FAIL") failW.set(w, (failW.get(w) || 0) + 1);
  else                      passW.set(w, (passW.get(w) || 0) + 1);
}

const weeks = [...new Set([...failW.keys(), ...passW.keys()])].sort();
console.log("");
console.log(`week_start    failed   passed   total   fail_rate`);
console.log("─".repeat(60));
for (const w of weeks) {
  const f = failW.get(w) || 0;
  const p = passW.get(w) || 0;
  const t = f + p;
  const rate = t > 0 ? (f / t * 100).toFixed(1) + "%" : "n/a";
  const bar = "█".repeat(Math.min(40, Math.round(f / 5)));
  console.log(`${w}   ${String(f).padStart(6)}   ${String(p).padStart(6)}   ${String(t).padStart(5)}   ${rate.padStart(8)}  ${bar}`);
}

console.log("");
console.log("INTERPRETATION:");
console.log(`  if FAIL counts spike at/after ${OLD_CUTOFF} on the BEK + Cheney rows,`);
console.log(`  the regression is in EXTRACTION-TIME (something changed about how Claude reads these invoices) — recent.`);
console.log(`  if FAIL counts are spread evenly across all weeks, the failure is longstanding and just became visible.`);
console.log("");
console.log("done.");
