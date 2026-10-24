// Phase 5 shared helpers.
// Every step tags rows with distinct parsed_weight_source value.
import fs from "node:fs";

export const P5 = {
  DIR: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5",
  OPEN_QUESTIONS_JSON: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_open_questions.json",
  DIAGNOSTIC: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_diagnostic5.json",
  RECOVERED: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_phase5_recovered.json",
  RECLASSIFIED: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_phase5_reclassified.json",
  ANALYSIS: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_analysis5.json",
  CHANGE_LOG: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_change_log5.json",
  Q11_DIST: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_q11_over_extraction_dist.json",
  Q13_BANDS: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_q13_bands.json",
  Q14_GFS: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_q14_gfs_invoice_reads.json",
  Q15_CHENEY: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_q15_cheney_test.json",
  Q21_SAMPLE: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_q21_fresh_frozen_sample.json",
  FUSED_VALIDATION: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_fused_slash_validation.json",
  PUBLICATION_THRESHOLD_PCT: 25,  // Phase 5: Kevin lowered from 35% to 25%
  PUBLICATION_CAVEAT_LOW_PCT: 25,
  PUBLICATION_CAVEAT_HIGH_PCT: 35,
};

// Category plausibility bounds for lb-per-case (unchanged from phase 4)
export const CATEGORY_LB_BOUNDS = {
  protein: [5, 150],
  poultry: [5, 100],
  meat: [5, 150],
  seafood: [3, 100],
  dairy: [3, 80],
  produce: [3, 100],
  dry_goods: [1, 200],
  grocery: [1, 200],
  frozen: [3, 100],
  beverage: [0.5, 60],
  other: [1, 200],
};

// Q13: Kevin's steer - seafood WIDER, produce narrower. But we MEASURE from data.
// Kept here just to remind pipeline. Real bands measured in step 11.

export const CLEAN_METHODS = new Set([
  "pack_size:n_x_m_weight",
  "pack_size:single_weight",
  "weight_line_value",
  "catalog_lookup:n_x_m_weight",
  "catalog_lookup:single_weight",
  "description:n_x_m_weight",
  "description:single_weight",
]);

export const ACCOUNTS = ["TBR-FL", "TBJ-FL", "STL-FL"];
export const MONTHS = ["2026-05", "2026-06", "2026-07"];

export function assignProteinType(desc) {
  if (!desc) return "other";
  const d = String(desc).toUpperCase();
  if (/\bEGG\b|\bEGGS\b|\bTOFU\b|\bSEITAN\b|\bTEMPEH\b/.test(d)) return "plant_or_egg";
  if (/\bBEEF\b|\bSTEAK\b|\bRIBEYE\b|\bBRISKET\b|\bFLANK\b|\bSIRLOIN\b|\bTENDERLOIN\b|\bGROUND BEEF\b|\bHAMBURGER\b|MEATBALL|OXTAIL|SHORT RIB|SHORT-RIB|PASTRAMI/.test(d)) return "beef";
  if (/\bCHICKEN\b|\bTURKEY\b|\bDUCK\b|\bPOULTRY\b|\bCHIX\b|\bCVP\b|\bBRST\b|\bTHIGH\b|\bWING\b|\bLEG\b|TUKEY|TURKY/.test(d)) return "poultry";
  if (/\bPORK\b|\bBACON\b|\bSAUSAGE\b|\bHAM\b|PEPPERONI|\bBERKSHIRE\b|PORK BUTT|PORK LOIN|PORK BELLY|PORK CHOP|PROSCIUTTO|SALAMI|CHORIZO/.test(d)) return "pork";
  if (/\bSALMON\b|\bTUNA\b|\bSHRIMP\b|\bCOD\b|\bFISH\b|\bSEAFOOD\b|\bTILAPIA\b|\bMAHI\b|\bSCALLOP\b|\bLOBSTER\b|\bCRAB\b|SUSHI|\bSNAPPER\b|\bBASS\b|\bTROUT\b|GROUPER|CATFISH|FILEFISH|NETUNO|PORTCLS/.test(d)) return "seafood";
  if (/\bLAMB\b|\bGOAT\b|\bVENISON\b|\bBISON\b|VEAL/.test(d)) return "other_meat";
  return "other";
}

export const round1 = (n) => Math.round(n * 10) / 10;
export const round2 = (n) => Math.round(n * 100) / 100;
export const pct1 = (num, den) => (den ? Math.round((num / den) * 1000) / 10 : 0);
export const sumBy = (arr, fn) => arr.reduce((s, x) => s + (Number(fn(x)) || 0), 0);
export const median = (arr) => {
  const s = [...arr].filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
export const quantile = (arr, q) => {
  const s = [...arr].filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const pos = (s.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (s[base + 1] !== undefined) return s[base] + rest * (s[base + 1] - s[base]);
  return s[base];
};

export const accountKeyNorm = (a) => (a || "").replace(" - ", "-");

// -------------------------------------------------------------------
// Fused-slash resolver
//
// Rule set (implemented in one place so we can validate against the
// 30 Kevin-supplied verified case weights before we let it loose):
//
//   4-digit + UNIT (LB or OZ):     split 2+2  -> N/M  -> per-case = N * M unit
//   3-digit + UNIT (LB or OZ):     split BOTH 1+2 and 2+1 -> compute BOTH candidates
//                                   -> disambiguate via category plausibility;
//                                   -> if BOTH pass or NEITHER pass -> ambiguous_skipped.
//   OZ variants convert to lb (divide by 16 at the very end).
//
// Returns:
//   { effective_weight_lb, split, source }  when resolved
//   { ambiguous: true, reason, both_candidates: {a,b} }  when NOT resolved
//   { unhandled: true }  when the pack_size doesn't match the fused shape
// -------------------------------------------------------------------
const FUSED_LB = /^\s*(\d{3,4})\s*LB\s*$/i;
const FUSED_OZ = /^\s*(\d{3,4})\s*OZ\s*$/i;
const NO_SP_LB = /^\s*(\d{3,4})LB\s*$/i;

export function resolveFusedSlash(packSize, category, quantity) {
  const raw = String(packSize || "").trim();
  const qty = Number.isFinite(Number(quantity)) && Number(quantity) > 0 ? Number(quantity) : 1;
  let digits = null;
  let unit = null;
  let m;
  if ((m = raw.match(FUSED_LB)) || (m = raw.match(NO_SP_LB))) {
    digits = m[1]; unit = "LB";
  } else if ((m = raw.match(FUSED_OZ))) {
    digits = m[1]; unit = "OZ";
  } else {
    return { unhandled: true };
  }
  const d = digits;
  const toLb = (n, u) => u === "LB" ? n : n / 16;
  const cat = String(category || "").toLowerCase();
  const bounds = CATEGORY_LB_BOUNDS[cat] || CATEGORY_LB_BOUNDS.other;

  // Helper: compute per-case lb from (N cases of M units)
  const perCase = (N, M) => toLb(N * M, unit);

  if (d.length === 4) {
    // Always 2+2
    const N = Number(d.slice(0, 2));
    const M = Number(d.slice(2, 4));
    const pcLb = perCase(N, M);
    return {
      effective_weight_lb_per_case: pcLb,
      total_effective_weight_lb: pcLb * qty,
      split: `${N}/${M} ${unit}`,
      source: unit === "LB" ? "fused_slash_rule_4d" : "fused_slash_rule_4d_oz_to_lb",
    };
  }

  // 3-digit: compute BOTH candidates and disambiguate
  const N_a = Number(d.slice(0, 1));  // 1+2 split
  const M_a = Number(d.slice(1, 3));
  const pcLb_a = perCase(N_a, M_a);

  const N_b = Number(d.slice(0, 2));  // 2+1 split
  const M_b = Number(d.slice(2, 3));
  const pcLb_b = perCase(N_b, M_b);

  const okA = pcLb_a >= bounds[0] && pcLb_a <= bounds[1];
  const okB = pcLb_b >= bounds[0] && pcLb_b <= bounds[1];

  if (okA && !okB) {
    return {
      effective_weight_lb_per_case: pcLb_a,
      total_effective_weight_lb: pcLb_a * qty,
      split: `${N_a}/${M_a} ${unit}`,
      source: unit === "LB" ? "fused_slash_rule_3d_1plus2" : "fused_slash_rule_3d_1plus2_oz_to_lb",
    };
  }
  if (okB && !okA) {
    return {
      effective_weight_lb_per_case: pcLb_b,
      total_effective_weight_lb: pcLb_b * qty,
      split: `${N_b}/${M_b} ${unit}`,
      source: unit === "LB" ? "fused_slash_rule_3d_2plus1" : "fused_slash_rule_3d_2plus1_oz_to_lb",
    };
  }
  return {
    ambiguous: true,
    reason: okA && okB
      ? "both_splits_plausible"
      : "neither_split_plausible",
    both_candidates: {
      one_two: { split: `${N_a}/${M_a} ${unit}`, per_case_lb: pcLb_a, in_bounds: okA },
      two_one: { split: `${N_b}/${M_b} ${unit}`, per_case_lb: pcLb_b, in_bounds: okB },
    },
    bounds_used: bounds,
  };
}

// -------------------------------------------------------------------
// Beverage size rule (Q1)
// Kevin: half gallon / gallon / litre or larger = culinary;
//        8/12/16/24 oz = service (cooler).
// Returns 'culinary' | 'service' | 'unresolved'
// -------------------------------------------------------------------
export function beverageSizeVerdict(row) {
  const desc = String(row.description || "").toUpperCase();
  const pack = String(row.pack_size || "").toUpperCase();
  const combined = `${pack} ${desc}`;

  // Kevin explicitly listed a few unsure items - leave them unresolved
  const UNSURE = [
    /CGRVIMP.*APPLE.*ASEPTIC/,
    /PINEAPPLE.*100%.*JUICE/,   // Cheney pineapple that Kevin flagged
  ];
  for (const rx of UNSURE) if (rx.test(combined)) return { verdict: "unresolved", reason: "kevin_flagged_unsure" };

  // Kevin explicit ORCHISL LIME FRESH -> culinary
  if (/ORCHISL.*LIME.*FRESH/.test(combined)) return { verdict: "culinary", reason: "kevin_named" };
  // NATALIE ORANGE FRESH, POM POMEGRANATE, etc -> cooler (service)
  if (/NATALIE.*JUICE.*ORANGE/.test(combined)) return { verdict: "service", reason: "kevin_named" };
  if (/POM.*POMEGRANATE/.test(combined)) return { verdict: "service", reason: "kevin_named" };

  // Size rule
  // Culinary if half-gallon or larger OR litre+
  // Regex catches "1/2 GAL", "HALF GAL", "GAL", "GALLON", "1 GAL",
  // "1 L", "1L", "1LTR", "1.5 L", "2 L", "2LTR"
  // Also >= 32 OZ (which is 1 quart, close to 1 L)
  const HALF_GAL_RE = /\b1\/2\s*GAL|\bHALF\s*GAL|\b1\s*\/2\s*GAL/;
  const GAL_RE = /\b\d*\s*GAL(?:LON)?\b/;
  const LTR_RE = /\b\d(?:\.\d+)?\s*L(?:TR|ITER|ITRE)?\b|\b\d(?:\.\d+)?L\b/;
  const OZ_RE = /(\d{1,3})\s*OZ\b/g;

  const isCulinaryVolume = HALF_GAL_RE.test(combined) || GAL_RE.test(combined) || LTR_RE.test(combined);
  if (isCulinaryVolume) return { verdict: "culinary", reason: "size_rule_gallon_or_liter" };

  // 8/12/16/24 oz = service. But also >=32oz = culinary/kitchen bulk.
  const ozMatches = [...combined.matchAll(OZ_RE)].map(m => Number(m[1]));
  if (ozMatches.length) {
    const anyBig = ozMatches.some(oz => oz >= 32);
    if (anyBig) return { verdict: "culinary", reason: "size_rule_32oz_or_larger" };
    const anyService = ozMatches.some(oz => [8,12,16,24].includes(oz));
    if (anyService) return { verdict: "service", reason: "size_rule_small_bottle" };
  }
  return { verdict: "unresolved", reason: "no_size_signal" };
}
