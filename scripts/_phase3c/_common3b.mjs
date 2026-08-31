// Phase 3b shared helpers.
// All paths absolute.

import fs from "node:fs";

export const P = {
  AUG: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3/_augmented.json",
  MEALS: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3/_meals.json",
  CLS: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/item_classifications.json",
  ANALYSIS_3B: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3b/_analysis3b.json",
  WORKBOOK: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/PURCHASE_ANALYSIS_2026_MAY_JUL.xlsx",
  CEO: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/CEO_ONE_PAGER.md",
  PHASE3_MD: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/PURCHASE_ANALYSIS_PHASE3.md",
};

export const ACCOUNTS = ["TBR-FL", "TBJ-FL", "STL-FL"];
export const MONTHS = ["2026-05", "2026-06", "2026-07"];
export const CONFIDENCE_THRESHOLD = 70;

export const sumBy = (arr, fn) => arr.reduce((s, x) => s + (Number(fn(x)) || 0), 0);
export const round2 = (n) => Math.round(n * 100) / 100;
export const round1 = (n) => Math.round(n * 10) / 10;
export const pct1 = (num, den) => (den ? Math.round((num / den) * 1000) / 10 : 0);

// Category-to-basis mapping (Fix 4).
// Every category in the dataset must map to exactly one of:
//   food         -> counted in food $ and core_food $
//   beverage     -> counted in food $ but NOT in core_food $
//   non_food     -> NOT counted in food $
//   unknown      -> counted in unknown $ (never in food or core_food)
//
// The Phase 3 defect was that GL overrides let cleaning/smallwares items land
// in food-labeled tables. Phase 3b hardens category as the primary axis, then
// only asks description/GL to override when category is unknown.
export const CATEGORY_BASIS = {
  // Food (core_food)
  produce: "food",
  protein: "food",
  poultry: "food",
  meat: "food",
  seafood: "food",
  dairy: "food",
  dry_goods: "food",
  grocery: "food",
  frozen: "food",
  snacks: "food",
  // Beverage (food but NOT core_food)
  beverage: "beverage",
  // Non-food
  supplies: "non_food",
  packaging: "non_food",
  chemical: "non_food",
  chemicals: "non_food",
  cleaning: "non_food",
  smallwares: "non_food",
  linen: "non_food",
  uniform: "non_food",
  // Unknown / ambiguous - fall through to description/GL classifier
  other: "unknown",
  "(uncategorized)": "unknown",
  null: "unknown",
  "": "unknown",
};

// Fee/service descriptions that are non-food regardless of category
const NON_PURCHASE_DESC_RE = /FUEL SURCHARGE|DELIVERY CHARGE|PAYMENT PROCESSING|MATERIAL CHARGE|CAN OPENER|CUSTOMER INCENTIVE|KNIFE SERVICE|INVOICE FEE|CREDIT ADJUSTMENT|RENTAL FEE|SANITIZ|SERVICE FEE|WEEKLY SERVICE|SHOP MAT|WIPER RENT|DISTANCE CHECK|DISTANCE_CHECK|Uniform Shield/i;

// Non-food vendor list (same as Phase 3)
const NON_FOOD_VENDORS = new Set([
  "Alsco Uniforms",
  "Cintas",
  "Vestis",
  "Auto-Chlor",
  "Ecolab",
  "Cozzini",
  "Cozzini Bros",
  "Cozzini Brothers",
  "Ferrell Gas",
]);

// Assign basis to each row (Phase 3b hardened food/beverage/non-food classifier).
// Order of precedence:
//   1. Non-food description patterns (fees/surcharges)
//   2. Non-food vendor list
//   3. Category-driven basis
//   4. If category = other/null: unknown (do NOT force food)
export function assignBasis(row) {
  const desc = String(row.description || "");
  if (NON_PURCHASE_DESC_RE.test(desc)) return "non_food";
  const vname = String(row.vendor_name || "").trim();
  if (NON_FOOD_VENDORS.has(vname)) return "non_food";
  const c = String(row.category || "").trim().toLowerCase();
  if (c in CATEGORY_BASIS) return CATEGORY_BASIS[c];
  return "unknown";
}

// Beverage classification patterns for Fix 1.
// Anything matching these = quality axis forced to "neutral" (branded water /
// sodas / sports drinks / juices / energy drinks / bottled coffee are NEVER
// premium in this analysis).
// Culinary exceptions: juice used as an ingredient (marsala wine, cooking wine)
// keeps its LLM verdict. Coffee/tea used for guest service is neutral either
// way. The pattern list is applied only to rows in the `beverage` category
// (primary gate) or narrower explicit beverage description patterns.
//
// Note: rows outside `beverage` category are NOT forced neutral via description
// alone - too many false positives (e.g. "TOMATO DICED IN JUICE" is a canned
// tomato, "BBQ SAUCE BOTTLE" is a condiment). The category assignment is the
// authoritative signal; description patterns only supplement inside beverage.
export const BEVERAGE_DESC_STRONG_RE = /\bBOTTLED WATER\b|\bCOCONUT WATER\b|\bCOCONUT MILK\b|\bSODA\b|\bGATORADE\b|\bPOWERADE\b|\bENERGY DRINK\b|\bRED BULL\b|\bMONSTER\b|\bSPARKLING WATER\b|\bCOLD BREW\b|\bKEG\b/i;
// Description patterns that indicate a culinary-use exception (do NOT force
// neutral even inside beverage category). E.g. cooking wine, sherry, vermouth,
// marsala, canned tomato juice for cooking, coconut milk for curries.
// Coffee beans (roasting/brewing) and cooking wine categorized here as
// culinary-input if in dry_goods/protein/etc rather than beverage.
export const CULINARY_BEV_EXCEPTION_RE = /MARSA|COOKING WINE|SHERRY|VERMOUTH|BEER FOR|EXTRACT|TOMATO.*JUICE|SAUCE|BBQ|MAYO/i;

// Return true if a row is a "beverage as-consumed" (should NOT be premium).
// Primary gate: category === beverage. Secondary gate: strong beverage keyword
// (BOTTLED WATER etc.) outside beverage category - but must not match a
// culinary exception.
export function isConsumerBeverage(row) {
  const cat = String(row.category || "").toLowerCase();
  const desc = String(row.description || "");
  if (CULINARY_BEV_EXCEPTION_RE.test(desc)) return false;
  if (cat === "beverage") return true;
  if (BEVERAGE_DESC_STRONG_RE.test(desc)) return true;
  return false;
}

// Protein type buckets for Protein Mix sheet (Fix 6).
// Assigned by description patterns. Untyped rows kept in "other" bucket and
// reported as such (do NOT force into a type).
export function assignProteinType(desc) {
  if (!desc) return "other";
  const d = String(desc).toUpperCase();
  // Order matters: eggs before beef (some egg products mention "cage-free")
  if (/\bEGG\b|\bEGGS\b|\bTOFU\b|\bSEITAN\b|\bTEMPEH\b/.test(d)) return "plant_or_egg";
  if (/\bBEEF\b|\bSTEAK\b|\bRIBEYE\b|\bBRISKET\b|\bFLANK\b|\bSIRLOIN\b|\bTENDERLOIN\b|\bGROUND BEEF\b|\bHAMBURGER\b|MEATBALL|OXTAIL|SHORT RIB|SHORT-RIB|PASTRAMI/.test(d)) return "beef";
  if (/\bCHICKEN\b|\bTURKEY\b|\bDUCK\b|\bPOULTRY\b|\bCHIX\b|\bCVP\b|\bBRST\b|\bTHIGH\b|\bWING\b|\bLEG\b|TUKEY|TURKY/.test(d)) return "poultry";
  if (/\bPORK\b|\bBACON\b|\bSAUSAGE\b|\bHAM\b|PEPPERONI|\bBERKSHIRE\b|PORK BUTT|PORK LOIN|PORK BELLY|PORK CHOP|PROSCIUTTO|SALAMI|CHORIZO/.test(d)) return "pork";
  if (/\bSALMON\b|\bTUNA\b|\bSHRIMP\b|\bCOD\b|\bFISH\b|\bSEAFOOD\b|\bTILAPIA\b|\bMAHI\b|\bSCALLOP\b|\bLOBSTER\b|\bCRAB\b|SUSHI|\bSNAPPER\b|\bBASS\b|\bTROUT\b|GROUPER|CATFISH|FILEFISH|NETUNO|PORTCLS/.test(d)) return "seafood";
  if (/\bLAMB\b|\bGOAT\b|\bVENISON\b|\bBISON\b|VEAL/.test(d)) return "other_meat";
  return "other";
}

// Item-family key for Duplicate Item Families sheet (Fix 6).
// Normalizes descriptions to a "family" key by:
//  - upper-case
//  - stripping brand prefixes (SYS, CLS, SYSCO, KEYSTON, HRMHR, etc.)
//  - stripping item-number codes and pack shapes
//  - collapsing whitespace
// Returns a short family label (e.g. "CHICKEN BREAST BONELESS SKINLESS").
const BRAND_PREFIX_RE = /\b(SYS|CLS|SYSCO|SYS CLS|KEYSTON|HORMEL|NORMEL|PHLYBST|HARMHRV|HARMKRY|HARMKRV|ZHARMHRV|ORCHISL|CGRVCLS|CGRVIMP|BBRLCLS|SCHWRTZ|MRS T|CITVIMP|SMPLYOR|SAMBZON|COCACOL|CALIFIA|NATALIE|ESSENTIA|GAT|CA|FOZHARMKRV|FOZHARMHRV|AREZCLS|AREZICLS|SUCCESS|ZOLACAI|MOODY|MURRAYS|PORTCLS)\b/g;
const ITEM_NUMBER_RE = /\b\d{4,}\b/g;
const PACK_SHAPE_RE = /\b\d+\/?\d*\s*(?:LB|LBS|OZ|CT|PACK|PK|GAL|FOZ|#|KG|G|EA|CS|CASE|EACH)\b/gi;
const EXTRA_TOKENS_RE = /\b(CVP|BNLS|SKLS|B\/S|BRST|CKD|PORT|PORTION|IQF|FRZ|FROZEN|BOM|RDM|RNDM|JUMBO|SMALL|MEDIUM|LARGE|EXTRA|LGE|MED|SM|XL|LG)\b/gi;

export function assignFamily(desc, category) {
  if (!desc) return { family: "(none)", confidence: 0 };
  let s = String(desc).toUpperCase();
  s = s.replace(BRAND_PREFIX_RE, " ");
  s = s.replace(ITEM_NUMBER_RE, " ");
  s = s.replace(PACK_SHAPE_RE, " ");
  s = s.replace(EXTRA_TOKENS_RE, " ");
  s = s.replace(/[^\w\s]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  // Keep the first 6 significant tokens as family key
  const tokens = s.split(" ").filter((t) => t.length > 2);
  const key = tokens.slice(0, 6).join(" ") || "(uncategorized)";
  // Confidence: 60 = short family, 80 = 3+ tokens, 90 = 4+ tokens
  const confidence = tokens.length >= 4 ? 90 : tokens.length >= 3 ? 80 : 60;
  return { family: key, confidence };
}

// Load all four caches.
export function loadAll() {
  const AUG = JSON.parse(fs.readFileSync(P.AUG, "utf8"));
  const MEALS = JSON.parse(fs.readFileSync(P.MEALS, "utf8"));
  const CLS = JSON.parse(fs.readFileSync(P.CLS, "utf8"));
  return { AUG, MEALS, CLS };
}
