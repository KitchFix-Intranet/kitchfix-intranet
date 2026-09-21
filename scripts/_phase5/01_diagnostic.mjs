// Phase 5 diagnostic: size the buckets that each step will touch,
// probe distributions that must be measured (Q11, Q13, Q9 shipped=lb sanity).
// Read-only.

import fs from "node:fs";
import { P } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_common4.mjs";

const AUG = JSON.parse(fs.readFileSync(P.AUG, "utf8"));
const rows = AUG.rows;

function norm(a) { return (a || "").replace(" - ", "-"); }

// Filter: live rows (already excluded orphan-corrected in augmented pipeline)
const live = rows;

// --------- Step 1: unit='lb' rows (Q9) ---------
const q9 = live.filter(r => (r.unit || "").toLowerCase() === "lb");
let q9Reconcile = 0;
let q9Reject = 0;
for (const r of q9) {
  const up = Number(r.unit_price);
  const sh = Number(r.shipped_count);
  const ep = Number(r.extended_price);
  if (!up || !sh || !ep) { q9Reject++; continue; }
  const calc = up * sh;
  const tol = Math.max(1, ep * 0.02);
  if (Math.abs(calc - ep) <= tol) q9Reconcile++;
  else q9Reject++;
}
console.log(`Q9: unit='lb' rows total=${q9.length} reconcile OK=${q9Reconcile} reject=${q9Reject}`);
console.log(`Q9: spend total=$${q9.reduce((s,r)=>s + (Number(r.extended_price)||0),0).toFixed(0)}`);

// --------- Step 2: fused-slash candidate universe ---------
const FUSED_3D_LB = /^\s*(\d{3})\s*LB\s*$/i;
const FUSED_4D_LB = /^\s*(\d{4})\s*LB\s*$/i;
const FUSED_3D_OZ = /^\s*(\d{3})\s*OZ\s*$/i;
const FUSED_4D_OZ = /^\s*(\d{4})\s*OZ\s*$/i;
const NO_SPACE_3D_LB = /^\s*(\d{3})LB\s*$/i;
const NO_SPACE_4D_LB = /^\s*(\d{4})LB\s*$/i;

const fused = { lb3: [], lb4: [], oz3: [], oz4: [] };
for (const r of live) {
  const ps = String(r.pack_size || "");
  if (FUSED_3D_LB.test(ps) || NO_SPACE_3D_LB.test(ps)) fused.lb3.push(r);
  else if (FUSED_4D_LB.test(ps) || NO_SPACE_4D_LB.test(ps)) fused.lb4.push(r);
  else if (FUSED_3D_OZ.test(ps)) fused.oz3.push(r);
  else if (FUSED_4D_OZ.test(ps)) fused.oz4.push(r);
}
for (const [k, arr] of Object.entries(fused)) {
  const sp = arr.reduce((s,r)=>s + (Number(r.extended_price)||0),0);
  console.log(`Fused ${k}: ${arr.length} rows / $${sp.toFixed(0)}`);
}

// --------- Step 3: catch-weight rows (Q8) ---------
const cw = live.filter(r => r.catch_weight_marker || r.review_reason === "ep_qty_up_mismatch");
console.log(`Catch-weight / ep_qty_up_mismatch: ${cw.length} rows / $${cw.reduce((s,r)=>s+(Number(r.extended_price)||0),0).toFixed(0)}`);

// --------- Step 4: beverages ---------
const bev = live.filter(r => (r.category || "").toLowerCase() === "beverage");
console.log(`Beverage rows: ${bev.length} / $${bev.reduce((s,r)=>s+(Number(r.extended_price)||0),0).toFixed(0)}`);

// --------- Step 5: plant_or_egg ---------
import { assignProteinType } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_common4.mjs";
const poe = live.filter(r => assignProteinType(r.description) === "plant_or_egg");
console.log(`plant_or_egg rows: ${poe.length} / $${poe.reduce((s,r)=>s+(Number(r.extended_price)||0),0).toFixed(0)}`);

// --------- Step 6: TBJ beef blank-everything (Q4) ---------
const tbjBeefBlank = live.filter(r =>
  norm(r.account_label) === "TBJ-FL" &&
  /^BEEF\b/i.test(r.description || "") &&
  !r.item_number &&
  !r.pack_size &&
  !r.weight_line_value &&
  (r.vendor_name || "").match(/Cheney|Gordon|GFS/i)
);
console.log(`TBJ beef blank cohort: ${tbjBeefBlank.length} rows / $${tbjBeefBlank.reduce((s,r)=>s+(Number(r.extended_price)||0),0).toFixed(0)}`);

// --------- Cheney #N test (Q15) ---------
const cheneyN = live.filter(r =>
  (r.vendor_name || "").match(/Cheney/i) &&
  (r.uom_raw || "").trim() === "#N"
);
console.log(`Cheney uom='#N': ${cheneyN.length} rows / $${cheneyN.reduce((s,r)=>s+(Number(r.extended_price)||0),0).toFixed(0)}`);

// --------- Q11 base: current invoice_over_extracted candidates ---------
const overExt = live.filter(r => r.review_reason === "invoice_over_extracted");
console.log(`invoice_over_extracted: ${overExt.length} rows / $${overExt.reduce((s,r)=>s+(Number(r.extended_price)||0),0).toFixed(0)}`);

// --------- Q17 "other" category ---------
const otherCat = live.filter(r => (r.category || "").toLowerCase() === "other");
console.log(`category='other': ${otherCat.length} rows / $${otherCat.reduce((s,r)=>s+(Number(r.extended_price)||0),0).toFixed(0)}`);

// --------- Q16 fee lines ---------
const feeLines = live.filter(r => /FUEL SURCHARGE|DELIVERY CHARGE|CUSTOMER INCENTIVE|FUEL SURCH|PAYMENT PROCESSING|MATERIAL CHARGE/i.test(r.description || ""));
console.log(`fee lines: ${feeLines.length} rows / $${feeLines.reduce((s,r)=>s+(Number(r.extended_price)||0),0).toFixed(0)}`);

// Save
const out = {
  q9_unit_lb: { rows: q9.length, reconcile_ok: q9Reconcile, reject: q9Reject, spend: q9.reduce((s,r)=>s+(Number(r.extended_price)||0),0) },
  fused: {
    lb3: { rows: fused.lb3.length, spend: fused.lb3.reduce((s,r)=>s+(Number(r.extended_price)||0),0) },
    lb4: { rows: fused.lb4.length, spend: fused.lb4.reduce((s,r)=>s+(Number(r.extended_price)||0),0) },
    oz3: { rows: fused.oz3.length, spend: fused.oz3.reduce((s,r)=>s+(Number(r.extended_price)||0),0) },
    oz4: { rows: fused.oz4.length, spend: fused.oz4.reduce((s,r)=>s+(Number(r.extended_price)||0),0) },
  },
  catch_weight: { rows: cw.length, spend: cw.reduce((s,r)=>s+(Number(r.extended_price)||0),0) },
  beverage: { rows: bev.length, spend: bev.reduce((s,r)=>s+(Number(r.extended_price)||0),0) },
  plant_or_egg: { rows: poe.length, spend: poe.reduce((s,r)=>s+(Number(r.extended_price)||0),0) },
  tbj_beef_blank: { rows: tbjBeefBlank.length, spend: tbjBeefBlank.reduce((s,r)=>s+(Number(r.extended_price)||0),0) },
  cheney_pound_n: { rows: cheneyN.length, spend: cheneyN.reduce((s,r)=>s+(Number(r.extended_price)||0),0) },
  invoice_over_extracted: { rows: overExt.length, spend: overExt.reduce((s,r)=>s+(Number(r.extended_price)||0),0) },
  other_cat: { rows: otherCat.length, spend: otherCat.reduce((s,r)=>s+(Number(r.extended_price)||0),0) },
  fee_lines: { rows: feeLines.length, spend: feeLines.reduce((s,r)=>s+(Number(r.extended_price)||0),0) },
};
fs.writeFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_diagnostic5.json", JSON.stringify(out, null, 2));
console.log("wrote _diagnostic5.json");
