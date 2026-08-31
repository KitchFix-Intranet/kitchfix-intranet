// Q15 self-answer: does Cheney uom_raw='#N' actually mean pounds-per-case?
//
// Method:
//   1. Find all Cheney rows where uom_raw='#N' (or contains '#').
//   2. For each such row, if we ALSO have a way to independently know the
//      case weight (weight_line_value, or up*shipped=ep sanity check), see
//      whether treating '#N' as "pounds-per-case" reconciles.
//
// The dominant Cheney pattern: shipped_count=1 (one case), unit_price is
// $/lb, extended_price = up * (weight-in-lb). So implied lb = ep / up.
// If uom_raw = '#N' AND that implied-lb is a reasonable case weight for the
// category, then '#N' IS the pounds convention (per-case shipped weight).
//
// Actually more subtle: this establishes that Cheney lines with uom_raw
// containing '#' means the RECORDED VALUE (shipped or unit_price) is a
// weight quantity, not a case quantity. Test:
//   - For rows where up*ep_lb == ep AND up != ep AND up in $2-$20 range:
//     up = $/lb, ep_lb = shipped weight. This is the catch-weight pattern.
//   - If this pattern holds for a majority of '#N' rows, adopt the convention.

import fs from "node:fs";
import { P } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_common4.mjs";
import { P5, assignProteinType, CATEGORY_LB_BOUNDS } from "./_common5.mjs";

const AUG = JSON.parse(fs.readFileSync(P.AUG, "utf8")).rows;

// Look at all Cheney rows with '#' in uom_raw
const cheney = AUG.filter(r => /Cheney/i.test(r.vendor_name || "") && /[#]/.test(String(r.uom_raw || "")));

// bucket by uom_raw
const buckets = {};
for (const r of cheney) {
  const u = String(r.uom_raw || "").trim().toUpperCase();
  buckets[u] = buckets[u] || [];
  buckets[u].push(r);
}
console.log("Cheney rows with # in uom_raw:");
for (const [u, arr] of Object.entries(buckets).sort((a,b)=>b[1].length - a[1].length)) {
  const sp = arr.reduce((s,r)=>s+(Number(r.extended_price)||0),0);
  console.log(`  uom_raw='${u}': ${arr.length} rows / $${sp.toFixed(0)}`);
}

// For '#N' specifically: does treating "up = $/lb, shipped = case count, weight = ep/up per case" work?
const target = "#N";
const rowsN = buckets[target] || [];
let sampleShown = 0;
const testResults = { rows: rowsN.length, tested: 0, reconciled_as_lb_pattern: 0, reject: 0, details: [] };
console.log(`\n===== Cheney '#N' test =====`);
for (const r of rowsN) {
  const up = Number(r.unit_price);
  const sh = Number(r.shipped_count);
  const ep = Number(r.extended_price);
  const cat = String(r.category || "").toLowerCase();
  if (!up || !ep || !sh) continue;
  testResults.tested++;
  // Interpret: catch-weight case pattern:
  //   ep_per_case = ep / sh
  //   weight_per_case_lb = ep_per_case / up
  const wPerCase = (ep / sh) / up;
  const bounds = CATEGORY_LB_BOUNDS[cat] || CATEGORY_LB_BOUNDS.other;
  const inBounds = wPerCase >= bounds[0] && wPerCase <= bounds[1];
  if (inBounds) testResults.reconciled_as_lb_pattern++;
  else testResults.reject++;
  if (sampleShown < 15) {
    console.log(`  ${r.description.slice(0,50).padEnd(50)} | up=${up.toString().padStart(6)} sh=${sh} ep=${ep.toString().padStart(7)} cat=${cat.padEnd(10)} | implied_wt_per_case=${wPerCase.toFixed(2)} lb bounds=[${bounds[0]},${bounds[1]}] ${inBounds ? "OK" : "REJECT"}`);
    sampleShown++;
  }
  testResults.details.push({
    id: r.id, desc: r.description, cat, up, sh, ep,
    implied_weight_per_case: wPerCase, in_bounds: inBounds,
  });
}
console.log(`\n#N test outcomes: tested=${testResults.tested} reconciled=${testResults.reconciled_as_lb_pattern} reject=${testResults.reject}`);
const pct = testResults.tested ? (testResults.reconciled_as_lb_pattern / testResults.tested * 100).toFixed(1) : "n/a";
console.log(`Reconcile rate: ${pct}%`);
console.log(`\nSelf-answer: adopt convention only if reconcile rate >= 80%.`);

fs.writeFileSync(P5.Q15_CHENEY, JSON.stringify({
  buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, {
    rows: v.length,
    spend: v.reduce((s,r)=>s+(Number(r.extended_price)||0),0),
  }])),
  pound_n_test: testResults,
  reconcile_rate_pct: testResults.tested ? testResults.reconciled_as_lb_pattern / testResults.tested * 100 : null,
  adopt_convention: testResults.tested >= 5 && (testResults.reconciled_as_lb_pattern / testResults.tested) >= 0.8,
}, null, 2));
console.log(`wrote ${P5.Q15_CHENEY}`);
