// Phase 4 shared helpers.
// All paths absolute.
import fs from "node:fs";

export const P = {
  AUG: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3/_augmented.json",
  MEALS: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3/_meals.json",
  CLS: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/item_classifications.json",
  ANALYSIS_3B: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3b/_analysis3b.json",
  ANALYSIS_3C: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3c/_analysis3c.json",
  CHANGE_LOG_3C: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3c/_change_log.json",
  REHABBED_3C: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3c/_rehabbed_rows.json",
  WORKBOOK: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/PURCHASE_ANALYSIS_2026_MAY_JUL.xlsx",
  CEO: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/PURCHASE_ONE_PAGER.md",
  PHASE3_MD: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/PURCHASE_ANALYSIS_PHASE3.md",

  // Phase 4 artifacts
  P4_DIR: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4",
  P4_PATH_A: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_path_a_borrows.json",
  P4_PATH_B: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_path_b_invoice_reads.json",
  P4_PATH_C: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_path_c_invoice_reads.json",
  P4_ANALYSIS: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_analysis4.json",
  P4_CHANGE_LOG: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_change_log4.json",
  P4_DIAGNOSTIC: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_diagnostic.json",
  P4_RECOVERED_ROWS: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_recovered_rows.json",
};

export const ACCOUNTS = ["TBR-FL", "TBJ-FL", "STL-FL"];
export const MONTHS = ["2026-05", "2026-06", "2026-07"];

export const PUBLICATION_THRESHOLD_PCT = 35; // fixed per Phase 4 hard rule

export const sumBy = (arr, fn) => arr.reduce((s, x) => s + (Number(fn(x)) || 0), 0);
export const round2 = (n) => Math.round(n * 100) / 100;
export const round1 = (n) => Math.round(n * 10) / 10;
export const pct1 = (num, den) => (den ? Math.round((num / den) * 1000) / 10 : 0);
export const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

// Category plausibility bounds (byte-identical to phase3b)
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
};
export const CATEGORY_DPLB_BOUNDS = {
  protein: [1, 30],
  poultry: [1, 15],
  meat: [1, 30],
  seafood: [2, 60],
  dairy: [0.5, 25],
  produce: [0.3, 20],
  dry_goods: [0.2, 40],
  grocery: [0.2, 40],
  frozen: [1, 40],
};

export const CLEAN_METHODS = new Set([
  "pack_size:n_x_m_weight",
  "pack_size:single_weight",
  "weight_line_value",
  "catalog_lookup:n_x_m_weight",
  "catalog_lookup:single_weight",
  "description:n_x_m_weight",
  "description:single_weight",
]);

// Byte-identical protein-type assignment (matches _common3b.mjs)
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

export const inDollar = (r) => r.review_reason !== "invoice_over_extracted";

export function loadAugmented() {
  return JSON.parse(fs.readFileSync(P.AUG, "utf8"));
}
