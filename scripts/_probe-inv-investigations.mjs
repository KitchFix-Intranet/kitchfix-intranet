// READ-ONLY probe for the three investigations feeding INV-1 design:
//   (1) the 30 "other" inactive item_catalog rows
//   (2) zone_corrections schema + sample rows
//   (3) confirm grand_total derivation by sampling count_items vs sessions
// No writes. No mutations.

import { safeRead, SHEET_IDS } from "../src/lib/sheets.js";

const asStr = (v) => (v == null ? "" : String(v).trim());

function pad(s, n) { s = String(s); return s.length >= n ? s : s + " ".repeat(n - s.length); }

async function main() {
  // ─── Investigation 1: the 30 "other" inactive rows ───
  console.log(`=== INVESTIGATION 1: "other" inactive item_catalog rows ===`);
  const { rows: catalogRows } = await safeRead(SHEET_IDS.INVENTORY, "item_catalog");
  // Schema per inventoryActions.js bootstrap (cols 0..18):
  //  0 itemId, 1 account, 2 name, 3 category, 4 unit, 5 locationId,
  //  6 primaryVendor, 7 lastPrice, 8 lastPriceDate, 9 lastPriceVendor,
  //  10 priceAtLastCount, 11 active, 12 linkedToInvoice, 13 isVarietyGroup,
  //  14 createdBy, 15 createdAt (or similar), 16 status (archived/excluded),
  //  17 notes, 18 lastVerified
  // bootstrap reads r[14] as createdBy. Col 15 likely createdAt; let's verify
  // by sampling.
  const inactive = catalogRows.filter((r) => asStr(r[11]).toUpperCase() === "FALSE");
  const archived = inactive.filter((r) => asStr(r[16]) === "archived");
  const excluded = inactive.filter((r) => asStr(r[16]) === "excluded");
  const other = inactive.filter((r) => {
    const s = asStr(r[16]);
    return s !== "archived" && s !== "excluded";
  });
  console.log(`inactive total: ${inactive.length}  archived: ${archived.length}  excluded: ${excluded.length}  other: ${other.length}`);
  console.log(``);

  // Tabulate "other" by status string seen
  const otherByStatus = {};
  for (const r of other) {
    const s = asStr(r[16]) || "(empty)";
    otherByStatus[s] = (otherByStatus[s] || 0) + 1;
  }
  console.log(`status (col Q / idx 16) distribution within "other":`);
  for (const [s, n] of Object.entries(otherByStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`  "${s}": ${n}`);
  }
  console.log(``);

  // Tabulate by createdBy
  const otherByCreator = {};
  for (const r of other) {
    const c = asStr(r[14]) || "(empty)";
    otherByCreator[c] = (otherByCreator[c] || 0) + 1;
  }
  console.log(`createdBy (col O / idx 14) distribution within "other":`);
  for (const [c, n] of Object.entries(otherByCreator).sort((a, b) => b[1] - a[1])) {
    console.log(`  "${c}": ${n}`);
  }
  console.log(``);

  // Tabulate by createdAt (col P / idx 15). Buckets: by year-month for shape sense.
  const otherByYM = {};
  for (const r of other) {
    const ca = asStr(r[15]);
    let ym = "(empty)";
    if (ca) {
      const d = new Date(ca);
      if (!isNaN(d)) ym = ca.slice(0, 7); // YYYY-MM
      else ym = ca.slice(0, 10) || "(unparseable)";
    }
    otherByYM[ym] = (otherByYM[ym] || 0) + 1;
  }
  console.log(`createdAt (col P / idx 15) distribution within "other" (by year-month):`);
  for (const [d, n] of Object.entries(otherByYM).sort()) {
    console.log(`  ${d}: ${n}`);
  }
  console.log(``);

  // Tabulate by account
  const otherByAccount = {};
  for (const r of other) {
    const a = asStr(r[1]) || "(empty)";
    otherByAccount[a] = (otherByAccount[a] || 0) + 1;
  }
  console.log(`account (col B / idx 1) distribution within "other":`);
  for (const [a, n] of Object.entries(otherByAccount).sort((a, b) => b[1] - a[1])) {
    console.log(`  "${a}": ${n}`);
  }
  console.log(``);

  // Sample 12 rows in full so the user can eyeball them
  console.log(`first 12 "other" rows (cols 0,1,2,3,11,14,15,16,17 only - the diagnostic ones):`);
  console.log(`  ${pad("itemId", 22)} ${pad("account", 25)} ${pad("name", 36)} ${pad("category", 14)} ${pad("active", 7)} ${pad("createdBy", 28)} ${pad("createdAt", 22)} ${pad("status[16]", 14)} notes[17]`);
  for (const r of other.slice(0, 12)) {
    console.log(`  ${pad(asStr(r[0]).slice(0, 22), 22)} ${pad(asStr(r[1]).slice(0, 25), 25)} ${pad(asStr(r[2]).slice(0, 36), 36)} ${pad(asStr(r[3]).slice(0, 14), 14)} ${pad(asStr(r[11]).slice(0, 7), 7)} ${pad(asStr(r[14]).slice(0, 28), 28)} ${pad(asStr(r[15]).slice(0, 22), 22)} ${pad(asStr(r[16]).slice(0, 14), 14)} "${asStr(r[17]).slice(0, 50)}"`);
  }
  console.log(``);

  // Check if r[12] linkedToInvoice or r[13] isVarietyGroup correlate
  const linked = other.filter((r) => asStr(r[12]).toUpperCase() === "TRUE").length;
  const variety = other.filter((r) => asStr(r[13]).toUpperCase() === "TRUE").length;
  console.log(`within "other": linkedToInvoice=TRUE: ${linked}/${other.length}, isVarietyGroup=TRUE: ${variety}/${other.length}`);
  console.log(``);

  // ─── Investigation 2: zone_corrections ───
  console.log(`=== INVESTIGATION 2: zone_corrections tab ===`);
  let zcRows = [];
  let zcReadErr = null;
  try {
    const result = await safeRead(SHEET_IDS.INVENTORY, "zone_corrections");
    zcRows = result.rows || [];
  } catch (e) {
    zcReadErr = e.message;
  }
  if (zcReadErr) {
    console.log(`zone_corrections read FAILED: ${zcReadErr}`);
  } else {
    console.log(`zone_corrections rows (data only): ${zcRows.length}`);
    if (zcRows.length > 0) {
      // Try to infer max-width
      let maxCol = 0;
      for (const r of zcRows) {
        for (let i = r.length - 1; i >= 0; i--) {
          if (asStr(r[i]) !== "") { if (i + 1 > maxCol) maxCol = i + 1; break; }
        }
      }
      console.log(`max non-empty column (1-indexed): ${maxCol}`);
      console.log(`first 5 rows (raw, all populated columns):`);
      for (const r of zcRows.slice(0, 5)) {
        console.log(`  [${r.slice(0, maxCol).map((v, i) => `${i}:"${asStr(v).slice(0, 40)}"`).join(" | ")}]`);
      }
      if (zcRows.length > 5) console.log(`  ... +${zcRows.length - 5} more`);

      // Distinct values per column (helps figure out schema)
      console.log(`distinct values per column (first 4 unique per col):`);
      for (let i = 0; i < maxCol; i++) {
        const set = new Set();
        for (const r of zcRows) {
          const v = asStr(r[i]);
          if (v) set.add(v);
        }
        const distinct = [...set];
        console.log(`  col ${i}: ${distinct.length} distinct  sample: [${distinct.slice(0, 4).map((v) => `"${v.slice(0, 30)}"`).join(", ")}]`);
      }
    }
  }
  console.log(``);

  // ─── Investigation 3: grand_total derivation ───
  console.log(`=== INVESTIGATION 3: count_sessions.grand_total derivation ===`);
  // For each session, compare:
  //   (a) col N (grandTotal stored at idx 13)
  //   (b) sum of the 5 stored category totals (cols I-M, idx 8-12)
  //   (c) sum of count_items.extended_price (col H, idx 7) for the session
  const { rows: csRows } = await safeRead(SHEET_IDS.INVENTORY, "count_sessions");
  const { rows: ciRows } = await safeRead(SHEET_IDS.INVENTORY, "count_items");
  console.log(`count_sessions: ${csRows.length} rows. Per-session reconcile (only sessions with stored totals):`);
  console.log(`  ${pad("sessionId", 26)} ${pad("status[F=5]", 12)} ${pad("storedGT[N=13]", 16)} ${pad("sumCats[I-M]", 16)} ${pad("sumCI.ext[H=7]", 16)} match?`);
  for (const r of csRows) {
    const sid = asStr(r[0]);
    const status = asStr(r[5]);
    const totalF = Number(r[8]) || 0;
    const totalP = Number(r[9]) || 0;
    const totalS = Number(r[10]) || 0;
    const totalSn = Number(r[11]) || 0;
    const totalB = Number(r[12]) || 0;
    const sumCats = totalF + totalP + totalS + totalSn + totalB;
    const storedGT = Number(r[13]) || 0;
    const sessionItems = ciRows.filter((x) => asStr(x[0]) === sid);
    const sumExt = sessionItems.reduce((acc, x) => acc + (Number(x[7]) || 0), 0);
    const matchCS = Math.abs(storedGT - sumCats) < 0.01;
    const matchCI = Math.abs(storedGT - sumExt) < 0.01;
    let m = "n/a (draft)";
    if (storedGT > 0 || sumCats > 0 || sumExt > 0) m = `cats${matchCS ? "=" : "!="}stored, items${matchCI ? "=" : "!="}stored`;
    console.log(`  ${pad(sid.slice(0, 26), 26)} ${pad(status, 12)} ${pad("$" + storedGT.toFixed(2), 16)} ${pad("$" + sumCats.toFixed(2), 16)} ${pad("$" + sumExt.toFixed(2), 16)} ${m}`);
  }
}

main().catch((e) => {
  console.error(`[probe] FATAL: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
