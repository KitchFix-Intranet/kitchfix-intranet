// ════════════════════════════════════════════════════════════════════════════
// PROBE: arithmetic_fail taxonomy across top-N failing vendors
//
// READ-ONLY. No writes.
//
// PURPOSE
//   For each of the top failing vendors (auto-discovered from review_queue),
//   pull a sample of arithmetic_fail rows with their rawJson side-by-side
//   to the stored qty/unit/ext. Output is grouped per vendor so a human
//   can quickly categorize each row as one of:
//     (i)   pack-size-as-quantity   — Claude grabbed PACK ("2" from "2/2 LB") as qty
//     (ii)  catch-weight total-weight — qty should be from "Total Weight 103.00#"
//                                       sub-line, Claude grabbed case count
//     (iii) column-misalignment      — Claude mapped wrong cols to qty/unit/ext
//     (iv?) new shape we haven't seen yet (the point of this probe)
//
//   This is the input to designing the code-side derivation layer that turns
//   raw extracted columns into quantity-for-pricing. The derivation rules
//   must handle every shape the probe surfaces.
//
// SOURCES (Sheets only):
//   - INVENTORY/review_queue (the held rows)
//   - AI_LINE_ITEMS/<per-account tab> (the source rows + rawJson)
//
// USAGE
//   node --import ./scripts/_setup/register-aliases.mjs \
//        --env-file=.env.local scripts/_probe_failure_taxonomy.mjs
//
//   Optional:
//     --top=10       number of top vendors to include (default 10)
//     --per=4        rows per vendor (default 4)
//     --min=10       only include vendors with at least this many arithmetic_fail rows
// ════════════════════════════════════════════════════════════════════════════

import { safeRead, SHEET_IDS } from "../../src/lib/sheets.js";

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=", 2)[1];
  return fallback;
}
const TOP_N      = parseInt(getArg("top", "10"), 10);
const PER_VENDOR = parseInt(getArg("per", "4"),  10);
const MIN_FAILS  = parseInt(getArg("min", "10"), 10);

// review_queue cols
const Q_LINE_ITEM_TEXT = 1;
const Q_VENDOR         = 2;
const Q_INVOICE_UUID   = 3;
const Q_ACCOUNT        = 5;
const Q_REASON         = 13;

// ai_line_items cols (15 cols per dataStore/invoice.js insertAILineItemsSheets)
const A_INVOICE_UUID   = 0;
const A_TIMESTAMP      = 1;   // scan-time
const A_VENDOR         = 3;
const A_INVOICE_NUMBER = 4;
const A_INVOICE_DATE   = 5;
const A_DESCRIPTION    = 7;
const A_QUANTITY       = 8;
const A_UNIT           = 9;
const A_UNIT_PRICE     = 10;
const A_EXTENDED_PRICE = 11;
const A_RAW_JSON       = 14;

function normalizeVendor(v) {
  // Collapse small variations: case + extra whitespace
  return String(v || "").trim().replace(/\s+/g, " ").toLowerCase();
}

// ── 1. Read review_queue, filter arithmetic_fail ──
console.log("[probe] reading INVENTORY/review_queue ...");
const { rows: queueRows } = await safeRead(SHEET_IDS.INVENTORY, "review_queue");
const failed = queueRows.filter((r) => String(r[Q_REASON] || "").trim() === "arithmetic_fail");
console.log(`[probe] arithmetic_fail rows: ${failed.length}`);

// ── 2. Group by normalized vendor, count + collect rows ──
const vendorBuckets = new Map();  // normVendor -> { display, rows: [] }
for (const r of failed) {
  const display = String(r[Q_VENDOR] || "").trim() || "(empty)";
  const key = normalizeVendor(display);
  if (!vendorBuckets.has(key)) vendorBuckets.set(key, { display, rows: [] });
  vendorBuckets.get(key).rows.push(r);
}

const vendorsSorted = [...vendorBuckets.entries()]
  .filter(([, v]) => v.rows.length >= MIN_FAILS)
  .sort((a, b) => b[1].rows.length - a[1].rows.length)
  .slice(0, TOP_N);

console.log(`[probe] top ${vendorsSorted.length} vendors with at least ${MIN_FAILS} fails:`);
for (const [, v] of vendorsSorted) {
  console.log(`        ${String(v.rows.length).padStart(4)}  ${v.display}`);
}

// ── 3. For each selected vendor, take the PER_VENDOR most-recent fails (by queue-row position) ──
const sampledQueueRows = [];
for (const [, v] of vendorsSorted) {
  // Sheets appends to bottom; last N are most recent. Take the last PER_VENDOR.
  const recent = v.rows.slice(-PER_VENDOR);
  for (const r of recent) sampledQueueRows.push({ row: r, vendorDisplay: v.display });
}
console.log(`[probe] sampled ${sampledQueueRows.length} held rows for raw-JSON lookup`);
console.log("");

// ── 4. Collect unique (account) tabs to read ──
const accountsNeeded = new Set();
for (const s of sampledQueueRows) {
  const acct = String(s.row[Q_ACCOUNT] || "").trim();
  if (acct) accountsNeeded.add(acct);
}
console.log(`[probe] will read ${accountsNeeded.size} AI_LINE_ITEMS account tab(s) ...`);

// Build a lookup: (uuid, lower(desc)) -> ai_line_items row
const aliByKey = new Map();
for (const acct of accountsNeeded) {
  let liRows = [];
  try {
    const r = await safeRead(SHEET_IDS.AI_LINE_ITEMS, acct);
    liRows = r.rows || [];
    console.log(`[probe]   ${acct}: ${liRows.length} rows`);
  } catch (e) {
    console.warn(`[probe]   WARN couldn't read tab "${acct}": ${e.message}`);
    continue;
  }
  for (const r of liRows) {
    const uuid = String(r[A_INVOICE_UUID] || "").trim();
    const desc = String(r[A_DESCRIPTION] || "").trim().toLowerCase();
    if (!uuid || !desc) continue;
    const key = `${uuid}::${desc}`;
    if (!aliByKey.has(key)) aliByKey.set(key, r); // first wins; duplicates rare
  }
}
console.log(`[probe] ai_line_items lookup built: ${aliByKey.size} unique (uuid,desc) keys`);
console.log("");

// ── 5. For each sampled queue row, find its ali source + compute display fields ──
function fmtNum(n) {
  if (n === null || n === undefined) return "n/a";
  if (typeof n !== "number" || !Number.isFinite(n)) return String(n);
  return n.toFixed(2);
}
function tryParse(s) { try { return JSON.parse(s); } catch { return null; } }

const enriched = [];
let nMatched = 0, nMissing = 0;
for (const s of sampledQueueRows) {
  const q = s.row;
  const uuid = String(q[Q_INVOICE_UUID] || "").trim();
  const desc = String(q[Q_LINE_ITEM_TEXT] || "").trim();
  const key = `${uuid}::${desc.toLowerCase()}`;
  const ali = aliByKey.get(key);

  if (!ali) {
    nMissing++;
    enriched.push({ vendorDisplay: s.vendorDisplay, q, ali: null });
    continue;
  }
  nMatched++;
  enriched.push({ vendorDisplay: s.vendorDisplay, q, ali });
}

// ── 6. Group + print per-vendor ──
function vendorBlock(vendorDisplay, rows) {
  console.log("");
  console.log("═".repeat(120));
  console.log(`VENDOR: ${vendorDisplay}    (${rows.length} sampled rows)`);
  console.log("═".repeat(120));

  for (const { q, ali } of rows) {
    console.log("");
    if (!ali) {
      console.log(`  description: ${String(q[Q_LINE_ITEM_TEXT] || "").trim()}`);
      console.log(`  invoice_uuid: ${String(q[Q_INVOICE_UUID] || "").trim()}`);
      console.log(`  (no matching ai_line_items row found — held row may pre-date current schema or the description doesn't join exactly)`);
      continue;
    }

    const qty   = Number(ali[A_QUANTITY])       || 0;
    const unit  = Number(ali[A_UNIT_PRICE])     || 0;
    const ext   = Number(ali[A_EXTENDED_PRICE]) || 0;
    const calc  = qty * unit;
    const drift = Math.abs(calc - ext);
    const tol   = 0.02 * Math.abs(ext) + 0.01;
    const ratio = unit !== 0 ? ext / unit : null;
    const ratioRound = ratio !== null ? Math.round(ratio) : null;
    const ratioIsSmallInt = ratio !== null && Math.abs(ratio - ratioRound) < 0.05 && ratioRound >= 1 && ratioRound <= 50;

    console.log(`  invoice_date: ${String(ali[A_INVOICE_DATE] || "").trim()}   scan_time: ${String(ali[A_TIMESTAMP] || "").trim()}   inv#: ${String(ali[A_INVOICE_NUMBER] || "").trim()}   uuid8: ${String(ali[A_INVOICE_UUID] || "").trim().slice(0, 8)}`);
    console.log(`  description: ${String(ali[A_DESCRIPTION] || "").trim()}`);
    console.log(`  STORED   qty=${fmtNum(qty)}  unit_price=${fmtNum(unit)}  extended=${fmtNum(ext)}  unit="${String(ali[A_UNIT] || "").trim()}"`);
    console.log(`           calc=${fmtNum(calc)}  drift=${fmtNum(drift)}  tol=${fmtNum(tol)}  ext/unit_ratio=${ratio !== null ? ratio.toFixed(3) : "n/a"}${ratioIsSmallInt ? `  ← small-int ratio ≈ ${ratioRound} (suggests qty should be ${ratioRound})` : ""}`);

    const parsed = tryParse(String(ali[A_RAW_JSON] || "").trim());
    if (parsed) {
      console.log(`  CLAUDE   qty=${fmtNum(parsed.quantity)}  unit_price=${fmtNum(parsed.unitPrice)}  extended=${fmtNum(parsed.extendedPrice)}  unit="${parsed.unit || ""}"  lineNum=${parsed.lineNum ?? ""}  category=${parsed.category || ""}`);
      if (parsed.description && parsed.description !== String(ali[A_DESCRIPTION] || "").trim()) {
        console.log(`           CLAUDE description: ${parsed.description}`);
      }
    } else {
      console.log(`  CLAUDE   (rawJson missing or unparseable)`);
    }
  }
}

// Group enriched by vendor (preserving sorted order from vendorsSorted)
for (const [, v] of vendorsSorted) {
  const block = enriched.filter((e) => e.vendorDisplay === v.display);
  if (block.length === 0) continue;
  vendorBlock(v.display, block);
}

// ── 7. Cross-vendor summary ──
console.log("");
console.log("═".repeat(120));
console.log("CROSS-VENDOR RATIO PATTERN SUMMARY");
console.log("═".repeat(120));
console.log("");
console.log("If a vendor's rows cluster around a small-integer ext/unit ratio (1, 2, 3, 4...),");
console.log("that's the pack-size-as-quantity / cases-shipped shape (shape i + ii).");
console.log("If ratios are fractional and varied, it's likely column-misalignment (shape iii) or a new shape.");
console.log("");

for (const [, v] of vendorsSorted) {
  const block = enriched.filter((e) => e.vendorDisplay === v.display && e.ali);
  if (block.length === 0) continue;
  const ratios = block.map((e) => {
    const unit = Number(e.ali[A_UNIT_PRICE]) || 0;
    const ext  = Number(e.ali[A_EXTENDED_PRICE]) || 0;
    return unit !== 0 ? ext / unit : null;
  }).filter((r) => r !== null && Number.isFinite(r));

  if (ratios.length === 0) continue;
  ratios.sort((a, b) => a - b);
  const med = ratios[Math.floor(ratios.length / 2)];
  const intRatios = ratios.filter((r) => Math.abs(r - Math.round(r)) < 0.05);
  const intShare = (intRatios.length / ratios.length * 100).toFixed(0);

  console.log(`  ${v.display.padEnd(34)} n=${ratios.length}  median ratio=${med.toFixed(2)}  small-int-ratio share=${intShare}%`);
}
console.log("");
console.log("done.");
