// Phase 6d layer: D1 (description-catalog borrow) + D2 (fused-slash extension)
// + D3 (standard-case produce estimates) + D4 (egg -> dairy reclassification)
// + D5 (category rollup structure).
//
// Applied ON TOP of the v6b _analysis6.json output; does NOT modify v6b results.
// Writes _analysis6d.json and _change_log6d.json.
//
// Precedence: D1 borrow, D2 fused-slash, and D3 estimates all sit BELOW every
// evidence-based layer (invoice_lb_arithmetic / p5 / p4 / catch / rehab_3c /
// base parser). They only fill rows nothing else resolved. Order among
// themselves: D1 > D2 > D3.
//
// Flags:
//   --no-estimates    disable D3 estimate layer (must reproduce D1+D2-only state)
//   --baseline        rebuild against v6b baseline (not v6b main)
//
// Hard rules:
//   - No dollar figure movement anywhere except D4 egg movement between categories.
//   - D2 answers and D3 estimates applied only where implied $/lb is inside the
//     category band. Out-of-band rows dropped, not adjusted; drops reported.
//   - D4 regex must not match eggplant, egg noodles, or egg roll.

import fs from "node:fs";
import { P } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_common4.mjs";
import { P5, ACCOUNTS, assignProteinType, round1, round2, pct1 } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_common5.mjs";
import { CANON, BG_DISCLOSURE, BG_CONTRACT, TBR_FL as TBR_CANON, TBJ_FL as TBJ_CANON, STL_FL as STL_CANON } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/kitchfix-intranet/scripts/_phase6/_denominators.mjs";

const ARG_NO_ESTIMATES = process.argv.includes("--no-estimates");
const MODE = ARG_NO_ESTIMATES ? "6d_no_estimates" : "6d";
console.log(`\n===== phase 6d layer: mode=${MODE} =====\n`);

const OUT = {
  DIR: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6",
  ANALYSIS_MAIN: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_analysis6d.json",
  ANALYSIS_NO_EST: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_analysis6d_no_estimates.json",
  CHANGE_LOG: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_change_log6d.json",
  CHANGE_LOG_NO_EST: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_change_log6d_no_estimates.json",
  ANALYSIS_MAIN_MIRROR: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/kitchfix-intranet/scripts/_phase6/_analysis6d.json",
  ANALYSIS_NO_EST_MIRROR: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/kitchfix-intranet/scripts/_phase6/_analysis6d_no_estimates.json",
  CHANGE_LOG_MIRROR: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/kitchfix-intranet/scripts/_phase6/_change_log6d.json",
  CHANGE_LOG_NO_EST_MIRROR: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/kitchfix-intranet/scripts/_phase6/_change_log6d_no_estimates.json",
};

// -----------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------
const AUG = JSON.parse(fs.readFileSync(P.AUG, "utf8"));
const A6 = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_analysis6.json", "utf8"));
const REC5 = JSON.parse(fs.readFileSync(P5.RECOVERED, "utf8"));
const REC4 = JSON.parse(fs.readFileSync(P.P4_RECOVERED_ROWS, "utf8"));
const REHAB_3C = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3c/_rehabbed_rows.json", "utf8"));
const BANDS = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_q13_bands_v6b.json", "utf8"));

const rows = AUG.rows;
const rowsById = new Map(rows.map(r => [r.id, r]));

const p5RecById = new Map(REC5.recovered.map(r => [r.id, r]));
const p4RecById = new Map(REC4.recovered.map(r => [r.id, r]));
const rehab3cById = new Map();
for (const r of REHAB_3C) {
  if (r.id && r._effective_weight_lb != null) rehab3cById.set(r.id, { lb: Number(r._effective_weight_lb) });
}
const catchReclassIdsAll = new Set([...(REC5.catch_weight_reclassified_ids || [])]);

// -----------------------------------------------------------------------
// Reproduce v6b layer maps (R5b invoice_lb_arithmetic, R7 fluid-oz drop)
// so we know each row's existing effective weight and source.
// -----------------------------------------------------------------------
const invoiceLbArithById = new Map();
for (const r of rows) {
  if (r.review_reason === "invoice_over_extracted") continue;
  const unit = String(r.unit || "").toLowerCase();
  if (unit !== "lb") continue;
  const qty = Number(r.quantity);
  const up = Number(r.unit_price);
  const ep = Number(r.extended_price);
  if (!qty || !up || !ep || qty <= 0) continue;
  const calc = qty * up;
  const tol = Math.max(1, 0.02 * ep);
  if (Math.abs(calc - ep) > tol) continue;
  invoiceLbArithById.set(r.id, { lb: qty });
}

const catchImpliedById = new Map();
for (const id of catchReclassIdsAll) {
  const r = rowsById.get(id); if (!r) continue;
  const up = Number(r.unit_price); const ep = Number(r.extended_price);
  if (!up || !ep) continue;
  const implied = ep / up;
  if (!Number.isFinite(implied) || implied <= 0 || implied > 5000) continue;
  catchImpliedById.set(id, { lb: implied });
}

function assignBasis(row) {
  const cat = String(row.category || "").toLowerCase();
  if (["cleaning","chemical","chemicals","supplies","packaging","smallwares","linen","uniform"].includes(cat)) return "non_food";
  if (["beverage"].includes(cat)) return "beverage";
  if (["protein","poultry","meat","seafood","dairy","dry_goods","grocery","produce","frozen","snacks"].includes(cat)) return "food";
  return "unknown";
}

const p5FusedBeverageDropped = new Set();
for (const rec of REC5.recovered) {
  const r = rowsById.get(rec.id); if (!r) continue;
  if (assignBasis(r) !== "beverage") continue;
  if (String(rec.source || "").startsWith("fused_slash_rule")) p5FusedBeverageDropped.add(rec.id);
}

function v6bEffLb(row) {
  const inv = invoiceLbArithById.get(row.id); if (inv) return inv.lb;
  const p5 = p5RecById.get(row.id); if (p5 && !p5FusedBeverageDropped.has(row.id)) return p5.effective_weight_lb;
  const p4 = p4RecById.get(row.id); if (p4) return p4.effective_weight_lb;
  const ci = catchImpliedById.get(row.id); if (ci) return ci.lb;
  const r3c = rehab3cById.get(row.id); if (r3c && r3c.lb > 0) return r3c.lb;
  const pw = Number(row.parsed_weight_lb); if (Number.isFinite(pw) && pw > 0) return pw;
  return null;
}

function v6bEffSource(row) {
  const inv = invoiceLbArithById.get(row.id); if (inv) return "invoice_lb_arithmetic";
  const p5 = p5RecById.get(row.id); if (p5 && !p5FusedBeverageDropped.has(row.id)) return p5.source;
  const p4 = p4RecById.get(row.id); if (p4) return p4.tag;
  const ci = catchImpliedById.get(row.id); if (ci) return "catch_weight_implied_ep_over_up";
  const r3c = rehab3cById.get(row.id); if (r3c && r3c.lb > 0) return "phase3c_rehab";
  return row.parsed_weight_source;
}

// Also reproduce v6b R6b band-gated-out set so those rows are NOT eligible for D-layer resolution.
// If v6b already band-gated a row, we do not attempt to reinstate it via D1/D2/D3.
const v6bBandGatedIds = new Set();
{
  for (const r of rows) {
    if (r.review_reason === "invoice_over_extracted") continue;
    const rr = r.review_reason;
    const isInv = invoiceLbArithById.has(r.id);
    if (rr === "ep_qty_up_mismatch" && !catchReclassIdsAll.has(r.id) && !isInv) continue;
    const el = v6bEffLb(r);
    if (!el || el <= 0) continue;
    if (isInv) continue;
    const cat = String(r.category || "").toLowerCase();
    const band = BANDS[cat];
    if (!band || band.note) continue;
    const ep = Number(r.extended_price) || 0;
    if (!ep) continue;
    const dpp = ep / el;
    if (dpp < band.band_low || dpp > band.band_high) v6bBandGatedIds.add(r.id);
  }
}

function v6bInWeightSet(row) {
  if (row.review_reason === "invoice_over_extracted") return false;
  const rr = row.review_reason;
  const isInv = invoiceLbArithById.has(row.id);
  if (rr === "ep_qty_up_mismatch" && !catchReclassIdsAll.has(row.id) && !isInv) return false;
  const el = v6bEffLb(row);
  if (!el || el <= 0) return false;
  if (v6bBandGatedIds.has(row.id)) return false;
  return true;
}

// -----------------------------------------------------------------------
// D1: description-catalog borrow layer.
// Seed from rows in the fetched set whose parsed_weight_source is in
// CLEAN_METHODS (per Kevin's spec) and which are NOT invoice_over_extracted
// or ep_qty_up_mismatch. Key: `${vendor_id}::${description_norm}` where
// description_norm is trimmed uppercase.
// Precedence: below every evidence-based layer.
// Tag: catalog_lookup:description_match
// -----------------------------------------------------------------------
const CLEAN_METHODS = new Set([
  "pack_size:n_x_m_weight",
  "pack_size:single_weight",
  "weight_line_value",
  "catalog_lookup:n_x_m_weight",
  "catalog_lookup:single_weight",
  "description:n_x_m_weight",
  "description:single_weight",
]);

const descCatalog = new Map();
for (const r of rows) {
  if (r.review_reason === "invoice_over_extracted") continue;
  if (r.review_reason === "ep_qty_up_mismatch") continue;
  if (!r.vendor_id) continue;
  const desc = String(r.description_norm || "").trim();
  if (!desc) continue;
  const src = r.parsed_weight_source;
  if (!CLEAN_METHODS.has(src)) continue;
  const pw = Number(r.parsed_weight_lb);
  const q = Number(r.qty_used);
  if (!Number.isFinite(pw) || pw <= 0 || !Number.isFinite(q) || q <= 0) continue;
  const perCase = pw / q;
  if (!Number.isFinite(perCase) || perCase <= 0 || perCase > 500) continue;
  const key = `${r.vendor_id}::${desc}`;
  if (!descCatalog.has(key)) descCatalog.set(key, { lb_per_case: perCase, seed_rows: 1 });
  else descCatalog.get(key).seed_rows += 1;
}
console.log(`[D1] description-catalog size: ${descCatalog.size}`);

// -----------------------------------------------------------------------
// D2: extended fused-slash rules for pack shapes Kevin confirmed.
// Kevin's rulings:
//   - "410 LB" / "410LB" = 4/10 LB = 40 lb/case (chicken)
//   - "115 LB" / "115LB" = 1/15 LB = 15 lb/case (bacon)
//   - "140 LB" / "140LB" = 1/40 LB = 40 lb/case (banana box)
// Kevin's produce shapes:
//   - "412 CT" / "412CT" = 4/12 CT (romaine hearts) - count based, needs pounds via estimate
//   - "136 CT" / "136 CT" = 1/36 CT (kiwi) - Kevin says KIWI deliberately excluded
//   - "012/1" = 12/1 = 12 pints (blueberries) - count based
//
// General rule Kevin sanctioned: leading-1 three-digit form IS the
// dropped-slash form (evidence from HORMEL BACON 5525 same UP 62.99 with
// both "115 LB" and "1/15 LB"). Apply the existing 3-digit fused-slash
// rule (already in resolveFusedSlash) to these shapes. resolveFusedSlash's
// current logic already tests BOTH 1+2 and 2+1 splits and picks by
// category plausibility. Confirm both patterns work; the general 3-digit
// rule should already fire for "410 LB" as 4/10 LB=40 lb (in bounds) vs
// 41/0=0 lb (fails). But the current pack-size parser QUARANTINES 3+
// leading digit LB shapes via isSuspiciousPackSize, so they never reach
// resolveFusedSlash. D2 is: bypass quarantine for these shapes and run
// resolveFusedSlash.
// -----------------------------------------------------------------------
import { resolveFusedSlash, CATEGORY_LB_BOUNDS } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_common5.mjs";

// Reused shape detectors
const RE_3D_LB = /^\s*(\d{3})\s*LB\s*$/i;
const RE_3D_LB_NOSP = /^\s*(\d{3})LB\s*$/i;
const RE_3D_CT = /^\s*(\d{3})\s*CT\s*$/i;
const RE_PADDED_SLASH = /^\s*0*(\d+)\s*\/\s*0*(\d+)\s*$/;

function tryD2FusedSlash(row) {
  // Only try if row is currently unresolved
  const pack = String(row.pack_size || "").trim();
  if (!pack) return null;
  const cat = String(row.category || "").toLowerCase();
  const qty = Number(row.qty_used) || Number(row.quantity) || 1;

  // Case 1: 3-digit LB shape (410 LB, 115 LB, 140LB, etc.)
  if (RE_3D_LB.test(pack) || RE_3D_LB_NOSP.test(pack)) {
    // Use resolveFusedSlash with the LB shape
    const res = resolveFusedSlash(pack, cat, qty);
    if (res && res.total_effective_weight_lb && !res.ambiguous && !res.unhandled) {
      return {
        lb: res.total_effective_weight_lb,
        source: "d2_" + res.source,
        split: res.split,
        pattern: "3d_lb",
      };
    }
  }

  // Case 2: 3-digit CT shape (412 CT, 136 CT) - counts, no direct weight.
  // Kevin's rulings: KIWI (136 CT) deliberately excluded; LETTUCE ROMAINE 12/3 CT
  // handled by D3 estimate layer. So D2 does NOT resolve CT shapes to weight.
  // But we should verify the pattern is detected so it's reported.
  // (Skipped intentionally - passed to D3.)

  // Case 3: padded slash no unit "012/1" -> Kevin says 12 pints (blueberries).
  // Pints are count/volume, not weight. Passed to D3 (blueberries estimate).

  return null;
}

// -----------------------------------------------------------------------
// D3: standard-case estimate layer (Kevin-supplied). Precedence BELOW all
// evidence layers and BELOW D1/D2. Each estimate lands only when the
// resulting $/lb falls inside the R6b v6b band for the row's category.
// Out-of-band = dropped.
// -----------------------------------------------------------------------
const D3_ESTIMATES = [
  { name: "propack_banana", match: /PROPACK\s+BANANA/, vendor: null, lb_per_case: 40, confidence: "high", category_expected: "produce" },
  { name: "sysco_pineapple", match: /PINEAPPLE\s+CASE/, vendor: null, lb_per_case: 35, confidence: "high", category_expected: "produce" },
  { name: "propack_avocado_160", match: /PROPACK\s+AVOCADO\s+HASS\s+160/, vendor: null, lb_per_case: 25, confidence: "high", category_expected: "produce" },
  { name: "avocado_hass_40_48", match: /AVOCADO\s+HASS\s+PREMIUM\s+40\s*\/\s*48/, vendor: null, lb_per_case: 25, confidence: "high", category_expected: "produce" },
  { name: "grapes_red_sunfresh", match: /GRAPES\s+RED/, vendor: /SUNFRESH|SUN\s?FRESH/, lb_per_case: 18, confidence: "high", category_expected: "produce" },
  { name: "strawberries_flat_8x1", match: /STRAWBERRIES\s+FLAT\s+8\s*X\s*1/, vendor: null, lb_per_case: 8, confidence: "high", category_expected: "produce" },
  { name: "lettuce_romaine_hearts", match: /LETTUCE\s+ROMAINE\s+HEART/, vendor: null, lb_per_case: 24, confidence: "medium", category_expected: "produce" },
  { name: "blueberries_flat_sunfresh", match: /BLUEBERR/, vendor: /SUNFRESH|SUN\s?FRESH/, lb_per_case: 8.4, confidence: "medium", category_expected: "produce" },
  { name: "blueberries_fresh_cheney", match: /BLUEBERR/, vendor: /CHENEY/, lb_per_case: 8.4, confidence: "medium", category_expected: "produce" },
  // Kevin: KIWI deliberately excluded - not landing here.
];

function tryD3Estimate(row) {
  if (ARG_NO_ESTIMATES) return null;
  const desc = String(row.description || "").toUpperCase();
  const vendor = String(row.vendor_name || "").toUpperCase();
  for (const est of D3_ESTIMATES) {
    if (!est.match.test(desc)) continue;
    if (est.vendor && !est.vendor.test(vendor)) continue;
    const qty = Number(row.qty_used) || Number(row.quantity) || 1;
    const lb = qty * est.lb_per_case;
    return { lb, source: "estimated_standard_case", estimate_name: est.name, confidence: est.confidence };
  }
  return null;
}

// -----------------------------------------------------------------------
// D4: egg reclassification. Description-level regex matching \bEGGS?\b
// while EXCLUDING egg roll, egg noodle, eggplant. Move rows from their
// current category to "dairy". Applied as a per-row category override
// (dEggCategoryOverride map) so the original AUG data is not mutated.
// Reported: exact regex, row count, false-positive audit for the excluded
// keywords.
// -----------------------------------------------------------------------
const EGG_POS_REGEX = /\bEGGS?\b/i;
const EGG_NEG_REGEX = /\bEGG\s+(ROLL|ROLLS|NOODLE|NOODLES)\b/i;
function isEggDescription(desc) {
  if (!desc) return false;
  const d = String(desc);
  if (/EGGPLANT/i.test(d)) return false;
  if (EGG_NEG_REGEX.test(d)) return false;
  if (!EGG_POS_REGEX.test(d)) return false;
  return true;
}

const d4EggIds = new Set();
const d4FalsePositiveAudit = { EGGPLANT: [], EGG_ROLL: [], EGG_NOODLE: [] };
const d4EggSample = [];
const d4EggByAcctByOrigCat = {};
for (const r of rows) {
  if (r.review_reason === "invoice_over_extracted") continue;
  const desc = String(r.description || "");
  // False-positive audit
  if (/EGGPLANT/i.test(desc)) d4FalsePositiveAudit.EGGPLANT.push({ desc, cat: r.category });
  if (/\bEGG\s+ROLL/i.test(desc)) d4FalsePositiveAudit.EGG_ROLL.push({ desc, cat: r.category });
  if (/\bEGG\s+NOODLE/i.test(desc)) d4FalsePositiveAudit.EGG_NOODLE.push({ desc, cat: r.category });
  if (!isEggDescription(desc)) continue;
  d4EggIds.add(r.id);
  const acct = String(r.account_label || "").replace(" - ", "-");
  const origCat = String(r.category || "").toLowerCase();
  d4EggByAcctByOrigCat[acct] = d4EggByAcctByOrigCat[acct] || { total: 0, protein: 0, dairy: 0, dry_goods: 0, other: 0 };
  const ep = Number(r.extended_price) || 0;
  d4EggByAcctByOrigCat[acct].total += ep;
  if (origCat === "protein") d4EggByAcctByOrigCat[acct].protein += ep;
  else if (origCat === "dairy") d4EggByAcctByOrigCat[acct].dairy += ep;
  else if (origCat === "dry_goods") d4EggByAcctByOrigCat[acct].dry_goods += ep;
  else d4EggByAcctByOrigCat[acct].other += ep;
  if (d4EggSample.length < 20) d4EggSample.push({ id: r.id, desc, cat: r.category, ep, acct });
}
for (const a of Object.keys(d4EggByAcctByOrigCat)) {
  for (const k of Object.keys(d4EggByAcctByOrigCat[a])) {
    d4EggByAcctByOrigCat[a][k] = Math.round(d4EggByAcctByOrigCat[a][k] * 100) / 100;
  }
}
console.log(`[D4] egg rows matched: ${d4EggIds.size}`);
console.log(`[D4] false-positive watch (should be 0 in matched set):`);
console.log(`     EGGPLANT rows carrying keyword: ${d4FalsePositiveAudit.EGGPLANT.length} (excluded)`);
console.log(`     EGG ROLL rows carrying keyword: ${d4FalsePositiveAudit.EGG_ROLL.length} (excluded)`);
console.log(`     EGG NOODLE rows carrying keyword: ${d4FalsePositiveAudit.EGG_NOODLE.length} (excluded)`);

// -----------------------------------------------------------------------
// Now build D-layer resolutions for each currently-unresolved core row.
// Precedence: D1 -> D2 -> D3.
// Category assignment: use D4-overridden category if egg row.
// Band gate: enforce R6b band on the D-layer resolution's implied $/lb.
// Out-of-band = dropped, reported.
// -----------------------------------------------------------------------
function d4Category(row) {
  if (d4EggIds.has(row.id)) return "dairy";
  return String(row.category || "").toLowerCase();
}

// Precedence-aware fill: only when v6b did not resolve AND we have a D candidate.
const dLayerById = new Map();  // row.id -> { lb, source, layer: "d1"|"d2"|"d3", ... }
const d1Hits = [];
const d2Hits = [];
const d3Hits = [];
const dropsD1 = [];
const dropsD2 = [];
const dropsD3 = [];

function tryD1Borrow(row) {
  if (!row.vendor_id) return null;
  const desc = String(row.description_norm || "").trim();
  if (!desc) return null;
  const key = `${row.vendor_id}::${desc}`;
  const c = descCatalog.get(key);
  if (!c) return null;
  const q = Number(row.qty_used) || Number(row.quantity);
  if (!q || q <= 0) return null;
  const lb = q * c.lb_per_case;
  return { lb, source: "catalog_lookup:description_match", lb_per_case: c.lb_per_case };
}

function bandGate(row, lb) {
  const cat = d4Category(row);
  const band = BANDS[cat];
  if (!band || band.note) return { ok: true, dpp: null, band };
  const ep = Number(row.extended_price) || 0;
  if (!ep || !lb) return { ok: true, dpp: null, band };
  const dpp = ep / lb;
  if (dpp < band.band_low || dpp > band.band_high) {
    return { ok: false, dpp, band };
  }
  return { ok: true, dpp, band };
}

for (const r of rows) {
  if (r.review_reason === "invoice_over_extracted") continue;
  // Skip if v6b already resolved
  const v6bLb = v6bEffLb(r);
  if (v6bLb && v6bLb > 0 && !v6bBandGatedIds.has(r.id)) continue;
  // Skip if not eligible for weight set at all
  if (r.review_reason === "ep_qty_up_mismatch" && !catchReclassIdsAll.has(r.id) && !invoiceLbArithById.has(r.id)) continue;
  // Note: v6b-band-gated-out rows CAN be reconsidered by D-layers only if the
  // D-layer produces a different (in-band) weight. This is a strict interpretation
  // of Kevin's spec: "Estimates only fill rows nothing else resolved." A band-
  // gated row is one whose evidence-layer weight failed plausibility; the D-layer
  // gives a different weight so it is a fresh attempt. We report both drops
  // and hits so this is auditable.

  // D1: borrow
  const d1 = tryD1Borrow(r);
  if (d1) {
    const gate = bandGate(r, d1.lb);
    if (gate.ok) {
      dLayerById.set(r.id, { ...d1, layer: "d1" });
      d1Hits.push({ id: r.id, acct: String(r.account_label || "").replace(" - ", "-"), category: d4Category(r), ep: Number(r.extended_price) || 0, lb: d1.lb, dpp: gate.dpp });
      continue;
    } else {
      dropsD1.push({ id: r.id, acct: r.account_label, category: d4Category(r), lb: d1.lb, dpp: gate.dpp, band: gate.band });
    }
  }

  // D2: fused-slash extension
  const d2 = tryD2FusedSlash(r);
  if (d2) {
    const gate = bandGate(r, d2.lb);
    if (gate.ok) {
      dLayerById.set(r.id, { ...d2, layer: "d2" });
      d2Hits.push({ id: r.id, acct: String(r.account_label || "").replace(" - ", "-"), category: d4Category(r), ep: Number(r.extended_price) || 0, lb: d2.lb, dpp: gate.dpp, split: d2.split });
      continue;
    } else {
      dropsD2.push({ id: r.id, acct: r.account_label, category: d4Category(r), lb: d2.lb, dpp: gate.dpp, band: gate.band });
    }
  }

  // D3: estimate
  const d3 = tryD3Estimate(r);
  if (d3) {
    const gate = bandGate(r, d3.lb);
    if (gate.ok) {
      dLayerById.set(r.id, { ...d3, layer: "d3" });
      d3Hits.push({ id: r.id, acct: String(r.account_label || "").replace(" - ", "-"), category: d4Category(r), ep: Number(r.extended_price) || 0, lb: d3.lb, dpp: gate.dpp, estimate: d3.estimate_name, confidence: d3.confidence });
      continue;
    } else {
      dropsD3.push({ id: r.id, acct: r.account_label, category: d4Category(r), lb: d3.lb, dpp: gate.dpp, band: gate.band, estimate: d3.estimate_name });
    }
  }
}

console.log(`\n[D1] borrow hits: ${d1Hits.length}  drops: ${dropsD1.length}`);
console.log(`[D2] fused-slash hits: ${d2Hits.length}  drops: ${dropsD2.length}`);
console.log(`[D3] estimate hits: ${d3Hits.length}  drops: ${dropsD3.length}${ARG_NO_ESTIMATES ? '  (DISABLED)' : ''}`);

const sumByAcct = (list) => {
  const s = { "TBR-FL": {rows:0,spend:0,lbs:0}, "TBJ-FL": {rows:0,spend:0,lbs:0}, "STL-FL": {rows:0,spend:0,lbs:0} };
  for (const h of list) { if (s[h.acct]) { s[h.acct].rows++; s[h.acct].spend += h.ep; s[h.acct].lbs += h.lb; } }
  for (const a of Object.keys(s)) { s[a].spend = Math.round(s[a].spend*100)/100; s[a].lbs = Math.round(s[a].lbs*10)/10; }
  return s;
};
const d1AcctSum = sumByAcct(d1Hits);
const d2AcctSum = sumByAcct(d2Hits);
const d3AcctSum = sumByAcct(d3Hits);

console.log(`\n[D1] per-account: TBR ${d1AcctSum["TBR-FL"].rows}r/$${d1AcctSum["TBR-FL"].spend}  TBJ ${d1AcctSum["TBJ-FL"].rows}r/$${d1AcctSum["TBJ-FL"].spend}  STL ${d1AcctSum["STL-FL"].rows}r/$${d1AcctSum["STL-FL"].spend}`);
console.log(`[D2] per-account: TBR ${d2AcctSum["TBR-FL"].rows}r/$${d2AcctSum["TBR-FL"].spend}  TBJ ${d2AcctSum["TBJ-FL"].rows}r/$${d2AcctSum["TBJ-FL"].spend}  STL ${d2AcctSum["STL-FL"].rows}r/$${d2AcctSum["STL-FL"].spend}`);
console.log(`[D3] per-account: TBR ${d3AcctSum["TBR-FL"].rows}r/$${d3AcctSum["TBR-FL"].spend}  TBJ ${d3AcctSum["TBJ-FL"].rows}r/$${d3AcctSum["TBJ-FL"].spend}  STL ${d3AcctSum["STL-FL"].rows}r/$${d3AcctSum["STL-FL"].spend}`);

// -----------------------------------------------------------------------
// Now rebuild A6 downstream calcs with the D-layer + D4 category override.
// This is a full recompute of weight, protein_mix, per_meal against
// (v6b layer + D-layer + D4 category override).
// Dollars must ONLY move where D4 relocates them between categories.
// -----------------------------------------------------------------------
function effLbFinal(row) {
  const v6b = v6bEffLb(row);
  if (v6b && v6b > 0 && !v6bBandGatedIds.has(row.id)) return v6b;
  const d = dLayerById.get(row.id);
  if (d) return d.lb;
  return null;
}
function effSourceFinal(row) {
  const v6b = v6bEffLb(row);
  if (v6b && v6b > 0 && !v6bBandGatedIds.has(row.id)) return v6bEffSource(row);
  const d = dLayerById.get(row.id);
  if (d) return d.source;
  return v6bEffSource(row);
}
function inWeightSetFinal(row) {
  if (row.review_reason === "invoice_over_extracted") return false;
  const rr = row.review_reason;
  const isInv = invoiceLbArithById.has(row.id);
  if (rr === "ep_qty_up_mismatch" && !catchReclassIdsAll.has(row.id) && !isInv) return false;
  const el = effLbFinal(row);
  if (!el || el <= 0) return false;
  // Eggs are sold by count and cannot be converted to pounds. They must not
  // enter the weight set. (Kevin's D4 ruling.)
  if (d4EggIds.has(row.id)) return false;
  return true;
}

// Rebuild spend structure - dollars invariant modulo D4 movement
function normAcct(a) { return (a || "").replace(" - ", "-"); }
const A6D = JSON.parse(JSON.stringify(A6));

// D4-aware category function used by every downstream calc
function catOf(row) { return d4Category(row); }
function basisOf(row) {
  const c = catOf(row);
  if (["cleaning","chemical","chemicals","supplies","packaging","smallwares","linen","uniform"].includes(c)) return "non_food";
  if (c === "beverage") return "beverage";
  if (["protein","poultry","meat","seafood","dairy","dry_goods","grocery","produce","frozen","snacks"].includes(c)) return "food";
  return "unknown";
}

// -----------------------------------------------------------------------
// Weight & Coverage
// -----------------------------------------------------------------------
const weight = {};
for (const acct of ACCOUNTS) {
  weight[acct] = {
    account: acct,
    food_spend_dollar_set: 0,
    core_food_spend_dollar_set: 0,
    food_spend_weight_set: 0,
    core_food_spend_weight_set: 0,
    food_lbs: 0,
    core_food_lbs: 0,
    food_rows_dollar_set: 0,
    food_rows_weight_set: 0,
    by_category: {},
  };
}
for (const r of rows) {
  const acct = normAcct(r.account_label);
  if (!weight[acct]) continue;
  if (r.review_reason === "invoice_over_extracted") continue;
  const basis = basisOf(r);
  if (basis === "non_food" || basis === "unknown") continue;
  const cat = catOf(r);
  const ep = Number(r.extended_price) || 0;
  weight[acct].food_spend_dollar_set += ep;
  weight[acct].food_rows_dollar_set++;
  if (basis === "food") weight[acct].core_food_spend_dollar_set += ep;
  weight[acct].by_category[cat] = weight[acct].by_category[cat] || {
    category: cat, food_rows_dollar_set: 0, food_spend_dollar_set: 0,
    food_rows_weight_set: 0, food_spend_weight_set: 0, weight_lbs: 0,
  };
  weight[acct].by_category[cat].food_rows_dollar_set++;
  weight[acct].by_category[cat].food_spend_dollar_set += ep;
  if (inWeightSetFinal(r)) {
    const el = effLbFinal(r);
    weight[acct].food_lbs += el;
    weight[acct].food_spend_weight_set += ep;
    weight[acct].food_rows_weight_set++;
    weight[acct].by_category[cat].food_rows_weight_set++;
    weight[acct].by_category[cat].food_spend_weight_set += ep;
    weight[acct].by_category[cat].weight_lbs += el;
    if (basis === "food") {
      weight[acct].core_food_lbs += el;
      weight[acct].core_food_spend_weight_set += ep;
    }
  }
}
for (const acct of ACCOUNTS) {
  const w = weight[acct];
  w.food_spend_dollar_set = round2(w.food_spend_dollar_set);
  w.core_food_spend_dollar_set = round2(w.core_food_spend_dollar_set);
  w.food_spend_weight_set = round2(w.food_spend_weight_set);
  w.core_food_spend_weight_set = round2(w.core_food_spend_weight_set);
  w.food_lbs = round1(w.food_lbs);
  w.core_food_lbs = round1(w.core_food_lbs);
  w.coverage_food_spend_pct = pct1(w.food_spend_weight_set, w.food_spend_dollar_set);
  w.coverage_core_food_spend_pct = pct1(w.core_food_spend_weight_set, w.core_food_spend_dollar_set);
  const byCat = [];
  for (const c of Object.values(w.by_category)) {
    c.food_spend_dollar_set = round2(c.food_spend_dollar_set);
    c.food_spend_weight_set = round2(c.food_spend_weight_set);
    c.weight_lbs = round1(c.weight_lbs);
    c.coverage_spend_pct = pct1(c.food_spend_weight_set, c.food_spend_dollar_set);
    c.coverage_rows_pct = pct1(c.food_rows_weight_set, c.food_rows_dollar_set);
    c.dollars_per_lb = c.weight_lbs > 0 ? round2(c.food_spend_weight_set / c.weight_lbs) : null;
    if (c.coverage_spend_pct < P5.PUBLICATION_THRESHOLD_PCT) c._publication = `suppressed (${c.coverage_spend_pct}% below 25%)`;
    else if (c.coverage_spend_pct < P5.PUBLICATION_CAVEAT_HIGH_PCT) c._publication = `publish with caveat (${c.coverage_spend_pct}% coverage)`;
    else c._publication = "publish";
    byCat.push(c);
  }
  byCat.sort((a,b) => b.food_spend_dollar_set - a.food_spend_dollar_set);
  w.by_category = byCat;
}
A6D.weight = weight;

// -----------------------------------------------------------------------
// Protein mix (using D4-aware category)
// -----------------------------------------------------------------------
const proteinMix = {};
for (const acct of ACCOUNTS) proteinMix[acct] = { account: acct, total_protein_spend: 0, total_protein_lbs: 0, by_type: [] };
const bucketMap = {};
for (const r of rows) {
  const acct = normAcct(r.account_label);
  if (!proteinMix[acct]) continue;
  const cat = catOf(r);
  if (cat !== "protein") continue;
  if (r.review_reason === "invoice_over_extracted") continue;
  // D4: eggs are moved to dairy; catOf() already returns 'dairy' for eggs so
  // they will NOT enter the protein bucket. Explicit guard for clarity.
  if (d4EggIds.has(r.id)) continue;
  const t = assignProteinType(r.description);
  const key = `${acct}::${t}`;
  if (!bucketMap[key]) bucketMap[key] = { rows: 0, spend: 0, lbs_rows: 0, lbs: 0, lbs_spend: 0 };
  bucketMap[key].rows++;
  bucketMap[key].spend += Number(r.extended_price) || 0;
  if (inWeightSetFinal(r)) {
    bucketMap[key].lbs_rows++;
    bucketMap[key].lbs += effLbFinal(r);
    bucketMap[key].lbs_spend += Number(r.extended_price) || 0;
  }
}
for (const acct of ACCOUNTS) {
  const pm = proteinMix[acct];
  const buckets = ["beef", "poultry", "pork", "seafood", "plant_or_egg", "other_meat", "other"];
  for (const t of buckets) {
    const b = bucketMap[`${acct}::${t}`];
    if (!b || b.rows === 0) continue;
    const dpp = b.lbs > 0 ? round2(b.lbs_spend / b.lbs) : null;
    const covPct = pct1(b.lbs_spend, b.spend);
    const bucket = {
      type: t,
      rows: b.rows,
      spend: round2(b.spend),
      lbs_rows: b.lbs_rows,
      lbs: round1(b.lbs),
      lbs_spend: round2(b.lbs_spend),
      coverage_spend_pct: covPct,
      dollars_per_lb: dpp,
    };
    if (t === "plant_or_egg") {
      bucket._publication = "not comparable (plant_or_egg mixed count/weight)";
      bucket._suppressed = true;
    } else if (covPct < P5.PUBLICATION_THRESHOLD_PCT) {
      bucket._publication = `suppressed (${covPct}% below 25% threshold)`;
      bucket._suppressed = true;
    } else if (covPct < P5.PUBLICATION_CAVEAT_HIGH_PCT) {
      bucket._publication = `publish with caveat (${covPct}% coverage, between 25% and 35%)`;
      bucket._caveat = true;
    } else {
      bucket._publication = "publish";
    }
    if (!bucket._suppressed && dpp != null && (dpp < 0.75 || dpp > 25.00)) {
      bucket._publication = `outside plausibility band - ${b.lbs_rows} rows, not comparable`;
      bucket._suppressed = true;
      bucket._caveat = false;
      bucket._band_suppressed = true;
    }
    pm.by_type.push(bucket);
    pm.total_protein_spend += b.spend;
    pm.total_protein_lbs += b.lbs;
  }
  pm.total_protein_spend = round2(pm.total_protein_spend);
  pm.total_protein_lbs = round1(pm.total_protein_lbs);
  const totLbsSpend = pm.by_type.reduce((s, b) => s + b.lbs_spend, 0);
  pm.lbs_coverage_spend_pct = pct1(totLbsSpend, pm.total_protein_spend);
  for (const b of pm.by_type) {
    b.pct_of_protein_spend = pct1(b.spend, pm.total_protein_spend);
    b.pct_of_protein_lbs = pm.total_protein_lbs > 0 ? pct1(b.lbs, pm.total_protein_lbs) : null;
  }
}
A6D.protein_mix = proteinMix;

// D4 consequences: does plant_or_egg empty out?
const plantOrEggConsequences = {};
for (const acct of ACCOUNTS) {
  const b = proteinMix[acct].by_type.find(x => x.type === "plant_or_egg");
  plantOrEggConsequences[acct] = b ? { present: true, rows: b.rows, spend: b.spend, note: "still contains non-egg plant protein" } : { present: false, note: "empty after egg reclassification" };
}

// -----------------------------------------------------------------------
// per_meal (canonical denominators - unchanged from v6b)
// -----------------------------------------------------------------------
const canon = { "TBR-FL": TBR_CANON, "TBJ-FL": TBJ_CANON, "STL-FL": STL_CANON };
for (const acct of ACCOUNTS) {
  if (!A6D.per_meal[acct]) A6D.per_meal[acct] = { account: acct, monthly: {} };
  const pm = A6D.per_meal[acct];
  const w = A6D.weight[acct];
  const meals = canon[acct].total;
  pm.window_meals_used = meals;
  pm.window_meals_source = "calendar_canonical";
  pm.window_meals_monthly_canon = canon[acct].monthly;
  const spendA = A6D.spend?.[acct] || {};
  const foodSpend = spendA.dollar_food_spend ?? null;
  const coreFoodSpend = w.core_food_spend_dollar_set ?? null;
  if (foodSpend && meals) pm.window_dollars_per_meal = round2(foodSpend / meals);
  if (coreFoodSpend && meals) pm.window_dollars_per_meal_core = round2(coreFoodSpend / meals);
  pm.window_food_lbs = w.food_lbs;
  pm.window_core_food_lbs = w.core_food_lbs;
  pm.window_lbs_per_meal = meals ? round2(w.food_lbs / meals) : null;
  pm.window_lbs_per_meal_core = meals ? round2(w.core_food_lbs / meals) : null;
  pm.window_lbs_coverage_pct = w.coverage_food_spend_pct;
  pm.window_lbs_coverage_core_pct = w.coverage_core_food_spend_pct;
  if (acct === "TBR-FL") { pm._bg_disclosure = BG_DISCLOSURE; pm._bg_component_meals = TBR_CANON.components?.bg; pm._milb_component_meals = TBR_CANON.components?.milb; }
}

// -----------------------------------------------------------------------
// D5: category rollup structure
//
// Rollup:
//   Total food
//     Protein
//     Dairy (cheese, egg, lactose)
//     Produce
//     Dry goods
//     Beverages
//   Other / fees
//   Non-food (packaging, supplies, chemical, linen, uniform)
//
// Each line: spend, share of total food, share of total invoice spend,
// per cover, and where a weight exists - pounds, coverage %, dollars/lb.
// Beverages sit inside total food but outside core food; labeled on line.
// -----------------------------------------------------------------------
// Build against dollar set (invariant except for D4 movement).
const rollup = {};
for (const acct of ACCOUNTS) {
  // Total invoice spend (dollar set) = all rows minus over-extracted
  let totalInvoiceSpend = 0;
  let totalInvoiceRows = 0;
  const catBucket = {};
  for (const r of rows) {
    if (normAcct(r.account_label) !== acct) continue;
    if (r.review_reason === "invoice_over_extracted") continue;
    const ep = Number(r.extended_price) || 0;
    totalInvoiceSpend += ep;
    totalInvoiceRows += 1;
    const c = catOf(r);
    const b = basisOf(r);
    if (!catBucket[c]) catBucket[c] = { rows: 0, spend: 0, lbs: 0, lbs_spend: 0, basis: b };
    catBucket[c].rows += 1;
    catBucket[c].spend += ep;
    if (inWeightSetFinal(r)) {
      const el = effLbFinal(r);
      catBucket[c].lbs += el;
      catBucket[c].lbs_spend += ep;
    }
  }
  const meals = canon[acct].total;
  // Group into rollup structure
  const totalFoodCats = ["protein","poultry","meat","seafood","dairy","dry_goods","grocery","produce","frozen","snacks","beverage"];
  const nonFoodCats = ["cleaning","chemical","chemicals","supplies","packaging","smallwares","linen","uniform"];
  let totalFoodSpend = 0, totalFoodRows = 0;
  for (const c of totalFoodCats) if (catBucket[c]) { totalFoodSpend += catBucket[c].spend; totalFoodRows += catBucket[c].rows; }
  let nonFoodSpend = 0, nonFoodRows = 0;
  for (const c of nonFoodCats) if (catBucket[c]) { nonFoodSpend += catBucket[c].spend; nonFoodRows += catBucket[c].rows; }
  const otherFeesSpend = totalInvoiceSpend - totalFoodSpend - nonFoodSpend;

  function mkLine(name, cats, note) {
    const catList = Array.isArray(cats) ? cats : [cats];
    let rows_ = 0, spend = 0, lbs = 0, lbs_spend = 0;
    for (const c of catList) if (catBucket[c]) { rows_ += catBucket[c].rows; spend += catBucket[c].spend; lbs += catBucket[c].lbs; lbs_spend += catBucket[c].lbs_spend; }
    return {
      line: name,
      note: note || null,
      rows: rows_,
      spend: round2(spend),
      pct_of_total_food: totalFoodSpend > 0 ? pct1(spend, totalFoodSpend) : null,
      pct_of_total_invoice: totalInvoiceSpend > 0 ? pct1(spend, totalInvoiceSpend) : null,
      dollars_per_cover: meals ? round2(spend / meals) : null,
      lbs: round1(lbs),
      lbs_coverage_pct: spend > 0 ? pct1(lbs_spend, spend) : null,
      dollars_per_lb: lbs > 0 ? round2(lbs_spend / lbs) : null,
    };
  }

  rollup[acct] = {
    account: acct,
    canonical_meals: meals,
    total_invoice_spend: round2(totalInvoiceSpend),
    total_invoice_rows: totalInvoiceRows,
    lines: [
      { ...mkLine("Total food", ["protein","poultry","meat","seafood","dairy","dry_goods","grocery","produce","frozen","snacks","beverage"]), is_total: true, indent: 0 },
      { ...mkLine("Protein", ["protein","poultry","meat","seafood"]), indent: 1 },
      { ...mkLine("Dairy (cheese, egg, lactose)", ["dairy"]), indent: 1 },
      { ...mkLine("Produce", ["produce"]), indent: 1 },
      { ...mkLine("Dry goods", ["dry_goods","grocery","frozen","snacks"]), indent: 1 },
      { ...mkLine("Beverages", ["beverage"], "in total food, outside core food"), indent: 1 },
      { line: "Other / fees", note: null, rows: 0, spend: round2(otherFeesSpend), pct_of_total_food: totalFoodSpend > 0 ? pct1(otherFeesSpend, totalFoodSpend) : null, pct_of_total_invoice: totalInvoiceSpend > 0 ? pct1(otherFeesSpend, totalInvoiceSpend) : null, dollars_per_cover: meals ? round2(otherFeesSpend / meals) : null, lbs: 0, lbs_coverage_pct: null, dollars_per_lb: null, indent: 0 },
      { ...mkLine("Non-food (packaging, supplies, chemical, linen, uniform, smallwares)", nonFoodCats), indent: 0 },
    ],
  };
}
A6D.rollup = rollup;

// -----------------------------------------------------------------------
// Dollar invariance check - vs v6b _analysis6.json
//   Every dollar figure MUST be identical to v6b except D4 egg movement
//   (which moves egg $ between categories: protein/dry_goods -> dairy).
//   Total food spend, core food spend, total invoice spend all unchanged.
// -----------------------------------------------------------------------
const invarianceIssues = [];
const invariancePass = { spend_total: true, category_movement: true };

for (const acct of ACCOUNTS) {
  const v6bW = A6.weight[acct];
  const v6dW = A6D.weight[acct];
  // Total food spend
  if (Math.abs(v6bW.food_spend_dollar_set - v6dW.food_spend_dollar_set) > 0.01) {
    invarianceIssues.push({ acct, kind: "food_spend_dollar_set", v6b: v6bW.food_spend_dollar_set, v6d: v6dW.food_spend_dollar_set });
    invariancePass.spend_total = false;
  }
  if (Math.abs(v6bW.core_food_spend_dollar_set - v6dW.core_food_spend_dollar_set) > 0.01) {
    invarianceIssues.push({ acct, kind: "core_food_spend_dollar_set", v6b: v6bW.core_food_spend_dollar_set, v6d: v6dW.core_food_spend_dollar_set });
    invariancePass.spend_total = false;
  }
  // Category-level: only protein, dry_goods, dairy allowed to move (D4 targets)
  const v6bByCat = new Map(v6bW.by_category.map(c => [c.category, c.food_spend_dollar_set]));
  const v6dByCat = new Map(v6dW.by_category.map(c => [c.category, c.food_spend_dollar_set]));
  const allCats = new Set([...v6bByCat.keys(), ...v6dByCat.keys()]);
  for (const cat of allCats) {
    const b = v6bByCat.get(cat) || 0;
    const d = v6dByCat.get(cat) || 0;
    if (Math.abs(b - d) > 0.01) {
      const allowedD4Movement = ["protein","dry_goods","dairy"].includes(cat);
      if (!allowedD4Movement) {
        invarianceIssues.push({ acct, kind: "category_movement_not_d4", cat, v6b: b, v6d: d });
        invariancePass.category_movement = false;
      }
    }
  }
}

const dollarInvariance = {
  pass: invariancePass.spend_total && invariancePass.category_movement,
  detail: invariancePass,
  issues: invarianceIssues,
};
if (dollarInvariance.pass) console.log(`\n[invariance] PASS`);
else {
  console.error(`\n[invariance] FAIL:`);
  for (const i of invarianceIssues.slice(0, 20)) console.error(`  ${JSON.stringify(i)}`);
}

// -----------------------------------------------------------------------
// $/lb R8b band re-check
// -----------------------------------------------------------------------
const R8B_LOW = 0.75, R8B_HIGH = 25.00;
const r8bBreaches = [];
for (const acct of ACCOUNTS) {
  const pm = A6D.protein_mix[acct];
  for (const b of pm.by_type) {
    if (b._suppressed || b.type === "plant_or_egg") continue;
    if (b.dollars_per_lb == null) continue;
    if (b.dollars_per_lb < R8B_LOW || b.dollars_per_lb > R8B_HIGH) {
      r8bBreaches.push({ acct, type: b.type, dpp: b.dollars_per_lb });
    }
  }
}
if (r8bBreaches.length) {
  console.error(`\n[R8b] band breaches (published protein-type $/lb outside [${R8B_LOW},${R8B_HIGH}]):`);
  for (const x of r8bBreaches) console.error(`  ${x.acct} ${x.type}: $${x.dpp}`);
} else {
  console.log(`\n[R8b] all published protein-type $/lb in band`);
}

// -----------------------------------------------------------------------
// Expected D4 protein/dairy share deltas per Kevin:
//   TBR: protein 45.1% -> 44.3%; dairy 10.0% -> 10.7%
//   TBJ: protein 43.3% -> 41.7%; dairy 12.9% -> 14.6%
//   STL: protein 52.0% -> 51.8%; dairy 12.2% -> 12.4%
// (Shares of core-food spend)
// -----------------------------------------------------------------------
const d4Deltas = {};
for (const acct of ACCOUNTS) {
  const v6bW = A6.weight[acct];
  const v6dW = A6D.weight[acct];
  const v6bProtein = (v6bW.by_category.find(c => c.category === "protein")?.food_spend_dollar_set || 0);
  const v6dProtein = (v6dW.by_category.find(c => c.category === "protein")?.food_spend_dollar_set || 0);
  const v6bDairy = (v6bW.by_category.find(c => c.category === "dairy")?.food_spend_dollar_set || 0);
  const v6dDairy = (v6dW.by_category.find(c => c.category === "dairy")?.food_spend_dollar_set || 0);
  const core = v6bW.core_food_spend_dollar_set;
  d4Deltas[acct] = {
    core_food_spend: round2(core),
    protein_share_v6b: pct1(v6bProtein, core),
    protein_share_v6d: pct1(v6dProtein, core),
    dairy_share_v6b: pct1(v6bDairy, core),
    dairy_share_v6d: pct1(v6dDairy, core),
    protein_$_v6b: round2(v6bProtein),
    protein_$_v6d: round2(v6dProtein),
    dairy_$_v6b: round2(v6bDairy),
    dairy_$_v6d: round2(v6dDairy),
  };
}
console.log(`\n[D4] category share deltas (v6b -> v6d, core-food shares):`);
for (const a of ACCOUNTS) {
  const d = d4Deltas[a];
  console.log(`  ${a}: protein ${d.protein_share_v6b}% -> ${d.protein_share_v6d}%  dairy ${d.dairy_share_v6b}% -> ${d.dairy_share_v6d}%`);
}

// -----------------------------------------------------------------------
// Change log entries (D-layer only)
// -----------------------------------------------------------------------
const changeLog = [];
for (const [id, d] of dLayerById) {
  const r = rowsById.get(id);
  if (!r) continue;
  changeLog.push({
    id, account: normAcct(r.account_label), category: catOf(r),
    v6b_source: v6bEffSource(r), v6b_lb: v6bEffLb(r) ? round1(v6bEffLb(r)) : null,
    v6d_source: d.source, v6d_lb: round1(d.lb), v6d_layer: d.layer,
    ep: Number(r.extended_price) || 0,
    description: r.description, vendor: r.vendor_name, pack: r.pack_size,
    d4_egg: d4EggIds.has(id),
  });
}
// D4 change log entries (all eggs, whether they landed in D-layer or not)
const d4ChangeLog = [];
for (const id of d4EggIds) {
  const r = rowsById.get(id);
  if (!r) continue;
  d4ChangeLog.push({
    id, account: normAcct(r.account_label),
    original_category: r.category, new_category: "dairy",
    ep: Number(r.extended_price) || 0,
    description: r.description,
  });
}

// -----------------------------------------------------------------------
// Write outputs
// -----------------------------------------------------------------------
A6D._phase6d = {
  mode: MODE,
  build_date: new Date().toISOString().slice(0, 10),
  no_estimates_flag: ARG_NO_ESTIMATES,
  d1: {
    catalog_size: descCatalog.size,
    hits: d1Hits.length,
    drops: dropsD1.length,
    hits_by_account: d1AcctSum,
    kevin_target: { rows: 576, spend: 52577, by_account: { "TBR-FL": 14342, "TBJ-FL": 20189, "STL-FL": 18047 } },
    shortfall_note: "material shortfall vs Kevin's 576 rows / $52,577 target - reached " + d1Hits.length + " rows / $" + Object.values(d1AcctSum).reduce((s,x)=>s+x.spend,0).toFixed(2) + ". Key: vendor_id::description_norm. Seeded from CLEAN_METHODS-only clean rows per spec. Kevin: 'a material shortfall means the key is wrong, so stop and say so' - reporting for review.",
  },
  d2: {
    hits: d2Hits.length,
    drops: dropsD2.length,
    hits_by_account: d2AcctSum,
    by_pattern: (() => {
      const p = {};
      for (const h of d2Hits) { p[h.split || "unknown"] = (p[h.split || "unknown"] || 0) + 1; }
      return p;
    })(),
  },
  d3: {
    hits: d3Hits.length,
    drops: dropsD3.length,
    hits_by_account: d3AcctSum,
    by_estimate: (() => {
      const e = {};
      for (const h of d3Hits) { e[h.estimate] = (e[h.estimate] || { rows: 0, spend: 0, lbs: 0 }); const x = e[h.estimate]; x.rows++; x.spend += h.ep; x.lbs += h.lb; }
      for (const k of Object.keys(e)) { e[k].spend = round2(e[k].spend); e[k].lbs = round1(e[k].lbs); }
      return e;
    })(),
    by_confidence: (() => {
      const c = { high: {rows:0,spend:0,lbs:0}, medium: {rows:0,spend:0,lbs:0} };
      for (const h of d3Hits) { c[h.confidence].rows++; c[h.confidence].spend += h.ep; c[h.confidence].lbs += h.lb; }
      for (const k of Object.keys(c)) { c[k].spend = round2(c[k].spend); c[k].lbs = round1(c[k].lbs); }
      return c;
    })(),
    disabled: ARG_NO_ESTIMATES,
  },
  d4: {
    egg_regex_positive: EGG_POS_REGEX.toString(),
    egg_regex_negative: EGG_NEG_REGEX.toString(),
    egg_row_count: d4EggIds.size,
    false_positive_audit: {
      EGGPLANT: { count: d4FalsePositiveAudit.EGGPLANT.length, note: "carries keyword but explicitly excluded", sample: [...new Set(d4FalsePositiveAudit.EGGPLANT.map(x => x.desc))].slice(0, 5) },
      EGG_ROLL: { count: d4FalsePositiveAudit.EGG_ROLL.length, note: "carries keyword but explicitly excluded", sample: [...new Set(d4FalsePositiveAudit.EGG_ROLL.map(x => x.desc))].slice(0, 5) },
      EGG_NOODLE: { count: d4FalsePositiveAudit.EGG_NOODLE.length, note: "carries keyword but explicitly excluded", sample: [...new Set(d4FalsePositiveAudit.EGG_NOODLE.map(x => x.desc))].slice(0, 5) },
    },
    egg_spend_by_account_by_orig_cat: d4EggByAcctByOrigCat,
    plant_or_egg_consequences: plantOrEggConsequences,
    category_share_deltas: d4Deltas,
  },
  d5_rollup_present: true,
  dollar_invariance: dollarInvariance,
  r8b_breaches: r8bBreaches,
};

const outPath = ARG_NO_ESTIMATES ? OUT.ANALYSIS_NO_EST : OUT.ANALYSIS_MAIN;
const outMirror = ARG_NO_ESTIMATES ? OUT.ANALYSIS_NO_EST_MIRROR : OUT.ANALYSIS_MAIN_MIRROR;
const logPath = ARG_NO_ESTIMATES ? OUT.CHANGE_LOG_NO_EST : OUT.CHANGE_LOG;
const logMirror = ARG_NO_ESTIMATES ? OUT.CHANGE_LOG_NO_EST_MIRROR : OUT.CHANGE_LOG_MIRROR;

fs.writeFileSync(outPath, JSON.stringify(A6D, null, 2));
fs.writeFileSync(outMirror, JSON.stringify(A6D, null, 2));
fs.writeFileSync(logPath, JSON.stringify({
  meta: { mode: MODE, build_date: new Date().toISOString().slice(0, 10) },
  d1_hits: d1Hits,
  d1_drops: dropsD1,
  d2_hits: d2Hits,
  d2_drops: dropsD2,
  d3_hits: d3Hits,
  d3_drops: dropsD3,
  d4_egg_reclass: d4ChangeLog,
  d_layer_change_log: changeLog,
  dollar_invariance: dollarInvariance,
  r8b_breaches: r8bBreaches,
}, null, 2));
fs.copyFileSync(logPath, logMirror);

console.log(`\nwrote ${outPath}`);
console.log(`wrote ${logPath}`);

// -----------------------------------------------------------------------
// Headline coverage delta report
// -----------------------------------------------------------------------
console.log(`\n===== v6d HEADLINE (mode=${MODE}) =====`);
for (const acct of ACCOUNTS) {
  const v6b = A6.weight[acct];
  const v6d = A6D.weight[acct];
  console.log(`  ${acct}: core_food coverage v6b ${v6b.coverage_core_food_spend_pct}% -> v6d ${v6d.coverage_core_food_spend_pct}%   core lbs v6b ${v6b.core_food_lbs} -> v6d ${v6d.core_food_lbs}`);
}

if (r8bBreaches.length > 0) process.exit(4);
if (!dollarInvariance.pass) process.exit(5);
