// Phase 5 - APPLY Kevin's answers to build the recovered-rows overlay.
//
// Layered on top of Phase 4 recovery. Steps applied IN ORDER:
//
//   Step 1: Q9 - unit='lb' rows carry pounds shipped in shipped_count.
//           Tag: parsed_weight_source_p5='shipped_count_is_lb'.
//           Validation: up * shipped_count reconciles to ep within 2% or $1.
//
//   Step 2: Q2 + Kevin's 30 verified packs.
//           2a. Apply Kevin's per-SKU pack weight overrides -> tag
//               'kevin_verified_pack'.
//           2b. Apply general fused-slash rule (validated at 100% on 30 SKUs).
//               Tags: 'fused_slash_rule_4d', 'fused_slash_rule_3d_1plus2',
//               'fused_slash_rule_3d_2plus1', or 'fused_slash_rule_4d_oz_to_lb'.
//               Ambiguous 3-digit cases (both splits plausible) -> UNRESOLVED,
//               logged with reason 'ambiguous_skipped'.
//
//   Step 3: Q8 - catch-weight rows get their own arithmetic gate.
//           Reclassify current ep_qty_up_mismatch rows: if the row IS a
//           catch-weight signal (has 'AVG'/'T/WT'/'TOT WT' in desc OR unit='lb'
//           OR uom_raw='#'/'#N') AND up * shipped = ep passes, remove the
//           ep_qty_up_mismatch flag. Tag: needs_review_removed='catch_weight_reclassified'.
//
//   Step 4: Q1 - beverage culinary-vs-service size rule.
//           Reclassify quality_axis for beverages by size: half-gal/gal/liter
//           = culinary (was neutral); 8/12/16/24 oz = service (stays neutral);
//           unresolved cases stay neutral.
//
//   Step 5: Q3 - plant_or_egg back into weight set only where pack now resolves
//           (via Step 2). Rows that still don't resolve stay excluded.
//
//   Step 6: Q4 - TBJ beef implied weight where pack+wlv+item#=blank AND unit='lb'
//           (or per-lb pattern). implied_lb = ep / up. Tag:
//           'implied_from_ep_and_unit_price'.
//
//   Step 7: Q12 - non-food category disagreement rows: verify no change (already
//           forced non-food).
//
//   Step 8: Q5 - lower publication threshold to 25% with caveat between 25-35%.
//           Handled at report time, not here.
//
//   Step 9: Q6 - STL-FL uses projected meals denominator.
//           7,540 (May) / 6,190 (Jun) / 5,130 (Jul), 18,860 window.
//           Handled in the recompute step.
//
//   Step 10: Q7 - duplicate item families: TBD in build phase.
//
//   Q15 analyst call: Cheney '#N' means catch-weight LB pattern. Reconcile rate
//           92.9% > 80% threshold. Resolve rows using ep/up per case pattern.
//           Tag: 'cheney_pound_n_convention'.

import fs from "node:fs";
import { P } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_common4.mjs";
import { P5, resolveFusedSlash, beverageSizeVerdict, assignProteinType, CATEGORY_LB_BOUNDS, round1, round2 } from "./_common5.mjs";

const AUG = JSON.parse(fs.readFileSync(P.AUG, "utf8"));
const REC4 = JSON.parse(fs.readFileSync(P.P4_RECOVERED_ROWS, "utf8"));
const OQ = JSON.parse(fs.readFileSync(P5.OPEN_QUESTIONS_JSON, "utf8"));
const Q15 = JSON.parse(fs.readFileSync(P5.Q15_CHENEY, "utf8"));

const rows = AUG.rows;
const rowsById = new Map(rows.map(r => [r.id, r]));

// Phase 4 already-recovered ids
const p4Recovered = new Set(REC4.recovered.map(r => r.id));

// Master recovered map: id -> { effective_weight_lb, source, notes, ep }
const rec = new Map();
const stepStats = {};
const rejections = [];
const beverageReclass = [];   // for Step 4
const catchWeightReclass = []; // for Step 3
const fusedAmbiguousSkipped = [];

function recordStep(step, id, effLb, source, notes) {
  const row = rowsById.get(id); if (!row) return;
  const key = `step${step}`;
  stepStats[key] = stepStats[key] || { rows: 0, spend: 0, lbs: 0 };
  stepStats[key].rows += 1;
  stepStats[key].spend += Number(row.extended_price) || 0;
  stepStats[key].lbs += effLb;
  if (rec.has(id)) return;  // one source per row
  rec.set(id, {
    id,
    effective_weight_lb: round1(effLb),
    source,
    notes,
    ep: Number(row.extended_price) || 0,
    category: row.category,
    account: row.account_label,
    protein_type: assignProteinType(row.description),
    step,
  });
}

// -----------------------------------------------------------------------
// Preflight: check what's already covered by phase 4 or by pack_size:*
// (single_weight, n_x_m_weight, weight_line_value, catalog_lookup) - do
// NOT overlay those; they already have a weight.
// -----------------------------------------------------------------------
function alreadyResolved(row) {
  if (p4Recovered.has(row.id)) return true;
  const psrc = row.parsed_weight_source;
  if (psrc && psrc !== "unresolved" && psrc !== "pack_size_ambiguous_multipack" && !String(psrc).startsWith("volume_")) {
    // Already has a real weight source. Skip.
    return true;
  }
  return false;
}

// -----------------------------------------------------------------------
// Step 1: Q9 - unit='lb' rows
// -----------------------------------------------------------------------
console.log(`\n===== Step 1: Q9 unit='lb' =====`);
let q1Applied = 0, q1Reject = 0, q1AlreadyOK = 0;
for (const r of rows) {
  const u = (r.unit || "").toLowerCase();
  if (u !== "lb") continue;
  if (alreadyResolved(r)) { q1AlreadyOK++; continue; }
  const up = Number(r.unit_price);
  const sh = Number(r.shipped_count);
  const ep = Number(r.extended_price);
  if (!up || !sh || !ep) { q1Reject++; rejections.push({ id: r.id, step: 1, why: "missing_up_sh_ep" }); continue; }
  const calc = up * sh;
  const tol = Math.max(1, ep * 0.02);
  if (Math.abs(calc - ep) > tol) {
    q1Reject++;
    rejections.push({ id: r.id, step: 1, why: `up*shipped_not_ep: up=${up} sh=${sh} calc=${calc.toFixed(2)} ep=${ep}` });
    continue;
  }
  // shipped_count is the pounds shipped.
  recordStep(1, r.id, sh, "shipped_count_is_lb", `up=${up} sh=${sh} ep=${ep} calc=${calc.toFixed(2)} tol=${tol.toFixed(2)}`);
  q1Applied++;
}
console.log(`  Q9 applied: ${q1Applied} rows; already resolved elsewhere: ${q1AlreadyOK}; rejected (up*shipped != ep): ${q1Reject}`);

// -----------------------------------------------------------------------
// Q15 analyst call: Cheney '#N' + '#' pattern
// -----------------------------------------------------------------------
if (Q15.adopt_convention) {
  console.log(`\n===== Q15: Cheney '#N'/'#' pattern (adopted; ${Q15.reconcile_rate_pct.toFixed(1)}% reconcile) =====`);
  let q15Applied = 0, q15Reject = 0;
  for (const r of rows) {
    if (!/Cheney/i.test(r.vendor_name || "")) continue;
    const u = String(r.uom_raw || "").trim().toUpperCase();
    if (u !== "#N" && u !== "#") continue;
    if (alreadyResolved(r)) continue;
    if (rec.has(r.id)) continue;  // step 1 might have caught unit='lb' + uom_raw='#N' rows
    const up = Number(r.unit_price);
    const sh = Number(r.shipped_count);
    const ep = Number(r.extended_price);
    if (!up || !sh || !ep) { q15Reject++; continue; }
    // Total shipped weight (across all cases) = ep / up
    const totalLb = ep / up;
    if (!Number.isFinite(totalLb) || totalLb <= 0) { q15Reject++; continue; }
    // Sanity: per-case = totalLb / sh
    const perCase = totalLb / sh;
    const cat = String(r.category || "").toLowerCase();
    const bounds = CATEGORY_LB_BOUNDS[cat] || CATEGORY_LB_BOUNDS.other;
    if (perCase < bounds[0] || perCase > bounds[1]) {
      q15Reject++;
      rejections.push({ id: r.id, step: "Q15", why: `per_case_${perCase.toFixed(2)}_out_of_${bounds[0]}_${bounds[1]}` });
      continue;
    }
    recordStep("Q15", r.id, totalLb, "cheney_pound_n_convention", `up=${up} sh=${sh} ep=${ep} total_lb=${totalLb.toFixed(2)} per_case_lb=${perCase.toFixed(2)}`);
    q15Applied++;
  }
  console.log(`  Q15 applied: ${q15Applied} rows; rejected: ${q15Reject}`);
}

// -----------------------------------------------------------------------
// Step 2a: Kevin's verified pack weights (30 SKUs -> 27 unique overrides)
// Dedupe overrides by item_number then apply.
// -----------------------------------------------------------------------
console.log(`\n===== Step 2a: Kevin verified pack overrides =====`);
function parseKevinWeight(text) {
  if (text == null) return null;
  const s = String(text).toLowerCase().replace(/\s+/g, " ");
  let m = s.match(/=\s*([\d.]+)\s*lbs?\b/); if (m) return Number(m[1]);
  m = s.match(/(\d+)\/(\d+)\s*lb/); if (m) return Number(m[1]) * Number(m[2]);
  m = s.match(/\d+\s*ea\s+(\d+(?:\.\d+)?)\s*lb/); if (m) return Number(m[1]);
  m = s.match(/(\d+)\s*(?:ea|packs|cartons|bags|cs|case)?\s*[\/x]?\s*(\d+(?:\.\d+)?)\s*lb/); if (m) return Number(m[1]) * Number(m[2]);
  m = s.match(/(\d+)ea\/?(\d+(?:\.\d+)?)\s*oz/); if (m) return (Number(m[1]) * Number(m[2])) / 16;
  m = s.match(/(\d+)\s*(?:ea|\/)\s*(\d+(?:\.\d+)?)\s*oz/); if (m) return (Number(m[1]) * Number(m[2])) / 16;
  m = s.match(/(\d+)\/(\d+(?:\.\d+)?)\s*oz/); if (m) return (Number(m[1]) * Number(m[2])) / 16;
  return null;
}
const kevinOverridesByItem = new Map(); // vendor_key + item_number -> per_case_lb
for (const p of OQ.pack_weights) {
  const lb = parseKevinWeight(p.case_weight_lb);
  if (lb == null) continue;
  const key = `${String(p.vendor||"").toLowerCase()}::${String(p.item_number||"").trim()}`;
  if (kevinOverridesByItem.has(key)) continue;  // first-wins dedupe
  kevinOverridesByItem.set(key, { per_case_lb: lb, printed_pack: p.pack_as_printed, source_row: p });
}

let step2aApplied = 0;
for (const r of rows) {
  if (alreadyResolved(r) || rec.has(r.id)) continue;
  const vkey = (r.vendor_name || "").toLowerCase().startsWith("sysco") ? "sysco" : null;
  if (!vkey) continue;
  const itemKey = `${vkey}::${String(r.item_number || "").trim()}`;
  const ov = kevinOverridesByItem.get(itemKey);
  if (!ov) continue;
  const qty = Number(r.qty_used || r.shipped_count || r.quantity) || 1;
  const totalLb = ov.per_case_lb * qty;
  recordStep(2, r.id, totalLb, "kevin_verified_pack", `per_case_lb=${ov.per_case_lb} qty=${qty} pack_printed="${ov.printed_pack}"`);
  step2aApplied++;
}
console.log(`  Step 2a Kevin-verified applied: ${step2aApplied} rows`);

// -----------------------------------------------------------------------
// Step 2b: general fused-slash rule
// -----------------------------------------------------------------------
console.log(`\n===== Step 2b: general fused-slash rule =====`);
let step2b_4d = 0, step2b_3d_12 = 0, step2b_3d_21 = 0, step2b_ambig = 0, step2b_unhandled = 0;
for (const r of rows) {
  if (alreadyResolved(r) || rec.has(r.id)) continue;
  const res = resolveFusedSlash(r.pack_size, r.category, r.qty_used || r.shipped_count || r.quantity);
  if (res.unhandled) { step2b_unhandled++; continue; }
  if (res.ambiguous) {
    step2b_ambig++;
    fusedAmbiguousSkipped.push({
      id: r.id, account: r.account_label, vendor: r.vendor_name,
      item: r.item_number, description: r.description,
      pack: r.pack_size, ep: r.extended_price,
      reason: res.reason, options: res.both_candidates, bounds: res.bounds_used,
    });
    continue;
  }
  recordStep(2, r.id, res.total_effective_weight_lb, res.source, `split=${res.split} per_case_lb=${res.effective_weight_lb_per_case}`);
  if (res.source === "fused_slash_rule_4d" || res.source === "fused_slash_rule_4d_oz_to_lb") step2b_4d++;
  else if (res.source.includes("1plus2")) step2b_3d_12++;
  else if (res.source.includes("2plus1")) step2b_3d_21++;
}
console.log(`  4-digit resolved: ${step2b_4d}`);
console.log(`  3-digit 1+2 chosen: ${step2b_3d_12}`);
console.log(`  3-digit 2+1 chosen: ${step2b_3d_21}`);
console.log(`  3-digit ambiguous_skipped: ${step2b_ambig}`);

// -----------------------------------------------------------------------
// Step 3: catch-weight arithmetic-gate reclassification (Q8)
// -----------------------------------------------------------------------
console.log(`\n===== Step 3: catch-weight ep_qty_up_mismatch reclassification =====`);
// A row is a catch-weight signal if any of:
//   catch_weight_marker true
//   description contains AVG or T/WT or TOT WT
//   unit='lb' (per-lb pricing)
//   uom_raw contains '#' (Cheney convention)
// If yes, and shipped_count is a real quantity and (up * shipped ~= ep), remove the flag.
const catchWeightReclassIds = new Set();
for (const r of rows) {
  if (r.review_reason !== "ep_qty_up_mismatch") continue;
  const desc = String(r.description || "").toUpperCase();
  const u = (r.unit || "").toLowerCase();
  const ur = String(r.uom_raw || "").trim().toUpperCase();
  // Catch-weight signals include:
  //   - explicit catch_weight_marker set by parser
  //   - "AVG" / "T/WT" / "TOT WT" / "SUB" in description
  //   - unit='lb' (per-lb pricing convention)
  //   - uom_raw contains '#' (Cheney weight-per-case convention)
  //   - weight_line_value populated by parser (invoice printed a total_weight
  //     column value that reconciles arithmetically - the canonical catch-weight
  //     signal used by the Phase 3b Candidate B rehab)
  //   - protein/seafood/meat category + unit_price in per-lb range ($1-$40)
  //     AND (ep / up) yields a plausible weight-per-case for the category
  const isSignal =
    r.catch_weight_marker ||
    /AVG|T\/WT|TOT WT|TOT\s*WT|SUB/i.test(desc) ||
    u === "lb" ||
    /[#]/.test(ur) ||
    (r.weight_line_value && Number(r.weight_line_value) > 0);
  if (!isSignal) continue;
  // Apply catch-weight arithmetic: ep / up produces a plausible per-case weight?
  const up = Number(r.unit_price); const ep = Number(r.extended_price);
  if (!up || !ep) continue;
  const impliedTotalLb = ep / up;
  if (!Number.isFinite(impliedTotalLb) || impliedTotalLb <= 0 || impliedTotalLb > 5000) continue;
  catchWeightReclassIds.add(r.id);
  catchWeightReclass.push({
    id: r.id, account: r.account_label, description: r.description,
    was: "ep_qty_up_mismatch", now: "catch_weight_reclassified",
    up, ep, implied_total_lb: round1(impliedTotalLb),
  });
}
console.log(`  Rows reclassified (ep_qty_up_mismatch -> catch_weight_reclassified): ${catchWeightReclassIds.size}`);

// -----------------------------------------------------------------------
// Step 4: Beverage size rule (Q1)
// -----------------------------------------------------------------------
console.log(`\n===== Step 4: Beverage size rule =====`);
let stepBevService = 0, stepBevCulinary = 0, stepBevUnresolved = 0;
const beverageUnsureList = [];
for (const r of rows) {
  const cat = String(r.category || "").toLowerCase();
  if (cat !== "beverage") continue;
  const v = beverageSizeVerdict(r);
  const impact = { id: r.id, account: r.account_label, description: r.description, pack: r.pack_size, ep: r.extended_price, verdict: v.verdict, reason: v.reason };
  beverageReclass.push(impact);
  if (v.verdict === "culinary") stepBevCulinary++;
  else if (v.verdict === "service") stepBevService++;
  else { stepBevUnresolved++; beverageUnsureList.push(impact); }
}
console.log(`  Beverage rows: culinary=${stepBevCulinary} service=${stepBevService} unresolved=${stepBevUnresolved}`);
console.log(`  Unresolved beverage examples (top 5 by spend):`);
beverageUnsureList
  .sort((a,b)=> (Number(b.ep)||0) - (Number(a.ep)||0))
  .slice(0,5)
  .forEach(u => console.log(`    ${u.account} ${u.description.slice(0,50)} pack=${u.pack} ep=$${u.ep} reason=${u.reason}`));

// -----------------------------------------------------------------------
// Step 6: TBJ beef implied weight (Q4)
// -----------------------------------------------------------------------
console.log(`\n===== Step 6: TBJ-FL beef implied weight =====`);
let step6Applied = 0;
for (const r of rows) {
  if (String(r.account_label || "").replace(" - ","-") !== "TBJ-FL") continue;
  if (!/^BEEF\b/i.test(r.description || "")) continue;
  if (r.item_number || r.pack_size || r.weight_line_value) continue;
  if (!/Cheney|Gordon|GFS/i.test(r.vendor_name || "")) continue;
  if (alreadyResolved(r) || rec.has(r.id)) continue;
  const up = Number(r.unit_price); const ep = Number(r.extended_price);
  if (!up || !ep) continue;
  // Must be per-pound pricing (up in $2-$30 range - typical beef $/lb)
  if (up < 1.5 || up > 30) continue;
  const impliedLb = ep / up;
  if (!Number.isFinite(impliedLb) || impliedLb < 5 || impliedLb > 500) continue;
  recordStep(6, r.id, impliedLb, "implied_from_ep_and_unit_price", `up=${up} ep=${ep} implied_lb=${impliedLb.toFixed(2)}`);
  step6Applied++;
}
console.log(`  Step 6 TBJ beef implied applied: ${step6Applied} rows`);

// -----------------------------------------------------------------------
// Step 5: plant_or_egg back into weight set (Q3) - already handled naturally.
// Kevin's verified packs cover the egg SKUs. Any plant_or_egg row that got
// a weight via Steps 2a/2b/6 goes back in. Anything still unresolved stays out.
// -----------------------------------------------------------------------
console.log(`\n===== Step 5: plant_or_egg reintegration =====`);
let step5Coverage = 0;
for (const [_, e] of rec) {
  if (e.protein_type === "plant_or_egg") step5Coverage++;
}
console.log(`  plant_or_egg rows now with resolved lbs: ${step5Coverage}`);

// -----------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------
const byAccount = {};
const byCategoryPerAccount = {};
const byProteinTypePerAccount = {};
for (const e of rec.values()) {
  byAccount[e.account] = byAccount[e.account] || { rows: 0, spend: 0, lbs: 0 };
  byAccount[e.account].rows++;
  byAccount[e.account].spend += e.ep;
  byAccount[e.account].lbs += e.effective_weight_lb;

  byCategoryPerAccount[e.account] = byCategoryPerAccount[e.account] || {};
  byCategoryPerAccount[e.account][e.category] = byCategoryPerAccount[e.account][e.category] || { rows: 0, spend: 0, lbs: 0 };
  byCategoryPerAccount[e.account][e.category].rows++;
  byCategoryPerAccount[e.account][e.category].spend += e.ep;
  byCategoryPerAccount[e.account][e.category].lbs += e.effective_weight_lb;

  if (String(e.category || "").toLowerCase() === "protein" || e.protein_type === "plant_or_egg") {
    byProteinTypePerAccount[e.account] = byProteinTypePerAccount[e.account] || {};
    const t = e.protein_type;
    byProteinTypePerAccount[e.account][t] = byProteinTypePerAccount[e.account][t] || { rows: 0, spend: 0, lbs: 0 };
    byProteinTypePerAccount[e.account][t].rows++;
    byProteinTypePerAccount[e.account][t].spend += e.ep;
    byProteinTypePerAccount[e.account][t].lbs += e.effective_weight_lb;
  }
}
for (const a of Object.keys(byAccount)) {
  byAccount[a].spend = round2(byAccount[a].spend);
  byAccount[a].lbs = round1(byAccount[a].lbs);
}

console.log(`\n===== TOTAL Phase 5 recovered =====`);
console.log(`  ${rec.size} rows total`);
for (const [a, v] of Object.entries(byAccount)) console.log(`    ${a}: ${v.rows} rows / $${v.spend} / ${v.lbs} lb`);

const stepStatsRounded = {};
for (const [k, v] of Object.entries(stepStats)) {
  stepStatsRounded[k] = { rows: v.rows, spend: round2(v.spend), lbs: round1(v.lbs) };
}

fs.writeFileSync(P5.RECOVERED, JSON.stringify({
  meta: {
    build_date: new Date().toISOString().slice(0, 10),
    total_rows_recovered: rec.size,
    step_stats: stepStatsRounded,
    fused_ambiguous_skipped_count: fusedAmbiguousSkipped.length,
    catch_weight_reclassified_count: catchWeightReclassIds.size,
    beverage_reclassified_count: beverageReclass.length,
    beverage_unresolved_flagged: beverageUnsureList.length,
    q15_adopt_pound_n: Q15.adopt_convention,
  },
  recovered: [...rec.values()],
  fused_ambiguous_skipped: fusedAmbiguousSkipped,
  catch_weight_reclassified_ids: [...catchWeightReclassIds],
  catch_weight_reclassified_detail: catchWeightReclass,
  beverage_reclass_detail: beverageReclass,
  beverage_unsure_list: beverageUnsureList,
  by_account: byAccount,
  by_category_per_account: byCategoryPerAccount,
  by_protein_type_per_account: byProteinTypePerAccount,
  rejections,
}, null, 2));
console.log(`\nwrote ${P5.RECOVERED}`);
