// src/lib/purchase/packSizeParser.js
// Phase 2 purchase-line-item repair. Pack-size + quantity -> honest weight per
// line, with a documented fallback chain and per-row resolution-method tag.
//
// No external deps. Pure functions. Safe to unit-test.
//
// See docs/migrations/pr-10-2-ai-line-items-derived-columns.sql for the
// derived columns this module writes to (parsed_pack_qty, parsed_pack_uom,
// parsed_weight_lb, parsed_weight_source).

// ============================================================================
// UOM canonicalization
// ============================================================================

// Weight units - convertible to pounds.
const WEIGHT_UOMS = new Set(["LB", "#", "OZ", "KG", "G"]);
// Volume units - NOT weight. Excluded from weight coverage; recorded as
// "resolution_method=volume_excluded".
const VOLUME_UOMS = new Set(["GAL", "FOZ", "L", "ML", "QT", "PT"]);
// Count units - not mass, but often the pack-size line ("60 CT" x quantity).
const COUNT_UOMS = new Set(["CT", "COUNT", "PK", "PACK", "EA", "EACH", "DZ", "DOZEN"]);

const UOM_ALIASES = {
  LBS: "LB",
  POUND: "LB",
  POUNDS: "LB",
  "#": "LB",
  OZS: "OZ",
  OUNCE: "OZ",
  OUNCES: "OZ",
  GRAM: "G",
  GRAMS: "G",
  KILOS: "KG",
  KILOGRAM: "KG",
  KILOGRAMS: "KG",
  GALLON: "GAL",
  GALLONS: "GAL",
  GALS: "GAL",
  FLOZ: "FOZ",
  "FL OZ": "FOZ",
  LITER: "L",
  LITERS: "L",
  LITRE: "L",
  LITRES: "L",
  MILLILITER: "ML",
  MILLILITERS: "ML",
  QUART: "QT",
  QUARTS: "QT",
  PINT: "PT",
  PINTS: "PT",
  COUNT: "CT",
  PACK: "PK",
  EACH: "EA",
  DOZEN: "DZ",
};

function canonUom(raw) {
  if (!raw) return null;
  const up = String(raw).trim().toUpperCase().replace(/\.$/, "");
  if (WEIGHT_UOMS.has(up)) return up;
  if (VOLUME_UOMS.has(up)) return up;
  if (COUNT_UOMS.has(up)) return up;
  if (UOM_ALIASES[up]) return UOM_ALIASES[up];
  return null;
}

// UOM -> pounds conversion (weight only).
// Kevin: OZ = avoirdupois ounce (28.35 g). If any invoice is troy ounce, we
// have bigger problems.
const TO_LB = {
  LB: 1,
  "#": 1,
  OZ: 1 / 16,
  KG: 2.20462,
  G: 0.00220462,
};

function toPounds(qty, uom) {
  const c = canonUom(uom);
  if (!c) return null;
  if (TO_LB[c] == null) return null;
  return Number(qty) * TO_LB[c];
}

// ============================================================================
// Pack-size string parsing
// ============================================================================
//
// Real shapes observed 2026-08-12 in ai_line_items (top ~60 non-null values):
//
//   Mass + unit:            "25 LB", "410 LB", "1 LB", "41 GAL", "632 OZ"
//   Padded / vendor form:   "25LB", "110LB", "45LB", "140LB", "42.5 LB"
//   N/M UNIT:               "8/1 LB", "6x1.5 LB", "4x1 GAL", "12/6OZ",
//                           "012/14 OZ", "24x8 FOZ", "8X1"
//   Zero-padded triples:    "004/5 #", "001/100", "002/20", "001/10 #"
//   Ounce compound:         "2412 OZ" (i.e. 24 x 12 OZ, glued together)
//   Count only:             "60CT", "16 CT", "004/75 CT", "10100CT"
//   Word forms:             "EACH", "CASE" (no size info)
//   MASS+#:                 "20#", "50#", "2/5#"
//   With qualifier:         "ONLY1 GAL", "ONLY5 LB"
//   Range:                  "8-11 CT", "3-4 PBO", "122-25#"
//
// The parser tries patterns from most-specific to most-general. Returns:
//   { unitCount, unitSize, unitUom, totalMass_lb, totalVolume_gal, confidence, source }
// where source explains which regex won.

export function parsePackSize(raw) {
  if (!raw || typeof raw !== "string") return null;
  let s = String(raw).trim().toUpperCase();
  if (!s || s === "NULL") return null;

  // Strip "ONLY" prefix - vendor formatting artifact.
  s = s.replace(/^ONLY\s*/, "");

  // Word-only forms carry no size info.
  if (/^(EACH|CASE|EA|CS|BOX|BX|PACK|PK)$/.test(s)) {
    return { unitCount: 1, unitSize: null, unitUom: null, totalMass_lb: null, totalVolume_gal: null, confidence: "low", source: "word_only" };
  }

  // Range - use midpoint. E.g. "8-11 CT", "3-4 PBO", "122-25#"
  const rangeMatch = s.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(#|LB|LBS|OZ|CT|GAL|FOZ|G|KG|PBO)?$/);
  if (rangeMatch) {
    const lo = Number(rangeMatch[1]);
    const hi = Number(rangeMatch[2]);
    const mid = (lo + hi) / 2;
    const uom = canonUom(rangeMatch[3] || "LB");
    if (uom && WEIGHT_UOMS.has(uom)) {
      return { unitCount: 1, unitSize: mid, unitUom: uom, totalMass_lb: toPounds(mid, uom), totalVolume_gal: null, confidence: "med", source: "range_midpoint" };
    }
    if (uom && VOLUME_UOMS.has(uom)) {
      return { unitCount: 1, unitSize: mid, unitUom: uom, totalMass_lb: null, totalVolume_gal: uom === "GAL" ? mid : null, confidence: "med", source: "range_midpoint_volume" };
    }
  }

  // N/M UNIT with x or / separator. E.g. "24/16 OZ", "4x1 GAL", "6x1.5 LB",
  // "012/14 OZ", "8/1 LB", "012/14OZ" (no space).
  const slashMatch = s.match(/^0*(\d+(?:\.\d+)?)\s*[/xX]\s*0*(\d+(?:\.\d+)?)\s*(LB|LBS|#|OZ|GAL|FOZ|KG|G|CT|PK|EA)?$/);
  if (slashMatch) {
    const n = Number(slashMatch[1]);
    const m = Number(slashMatch[2]);
    const uom = canonUom(slashMatch[3] || null);
    if (uom && WEIGHT_UOMS.has(uom)) {
      const totalMass_lb = n * (toPounds(m, uom) ?? 0);
      return { unitCount: n, unitSize: m, unitUom: uom, totalMass_lb, totalVolume_gal: null, confidence: "high", source: "n_x_m_weight" };
    }
    if (uom && VOLUME_UOMS.has(uom)) {
      const totalVolume_gal = uom === "GAL" ? n * m : uom === "FOZ" ? (n * m) / 128 : uom === "L" ? (n * m) * 0.264172 : uom === "ML" ? (n * m) * 0.000264172 : uom === "QT" ? (n * m) * 0.25 : uom === "PT" ? (n * m) * 0.125 : null;
      return { unitCount: n, unitSize: m, unitUom: uom, totalMass_lb: null, totalVolume_gal, confidence: "high", source: "n_x_m_volume" };
    }
    if (uom && COUNT_UOMS.has(uom)) {
      return { unitCount: n, unitSize: m, unitUom: uom, totalMass_lb: null, totalVolume_gal: null, confidence: "med", source: "n_x_m_count" };
    }
    // Unit missing entirely - treat as ambiguous count.
    return { unitCount: n, unitSize: m, unitUom: null, totalMass_lb: null, totalVolume_gal: null, confidence: "low", source: "n_x_m_no_uom" };
  }

  // Mass or volume single unit. E.g. "25 LB", "410 LB", "41 GAL", "20#",
  // "42.5 LB", "50#", "1 LB", "25LB", "110LB".
  const singleMatch = s.match(/^(\d+(?:\.\d+)?)\s*(LB|LBS|#|OZ|GAL|FOZ|KG|G|CT|PK|EA|DZ)$/);
  if (singleMatch) {
    const n = Number(singleMatch[1]);
    const uom = canonUom(singleMatch[2]);
    if (uom && WEIGHT_UOMS.has(uom)) {
      return { unitCount: 1, unitSize: n, unitUom: uom, totalMass_lb: toPounds(n, uom), totalVolume_gal: null, confidence: "high", source: "single_weight" };
    }
    if (uom && VOLUME_UOMS.has(uom)) {
      const totalVolume_gal = uom === "GAL" ? n : uom === "FOZ" ? n / 128 : uom === "L" ? n * 0.264172 : uom === "ML" ? n * 0.000264172 : uom === "QT" ? n * 0.25 : uom === "PT" ? n * 0.125 : null;
      return { unitCount: 1, unitSize: n, unitUom: uom, totalMass_lb: null, totalVolume_gal, confidence: "high", source: "single_volume" };
    }
    if (uom && COUNT_UOMS.has(uom)) {
      return { unitCount: 1, unitSize: n, unitUom: uom, totalMass_lb: null, totalVolume_gal: null, confidence: "med", source: "single_count" };
    }
  }

  // 2/M UNIT with # or non-space uom. E.g. "2/5#", "6#10" (weird glue).
  const hashSlashMatch = s.match(/^(\d+)\s*[/xX]\s*(\d+(?:\.\d+)?)\s*#$/);
  if (hashSlashMatch) {
    const n = Number(hashSlashMatch[1]);
    const m = Number(hashSlashMatch[2]);
    return { unitCount: n, unitSize: m, unitUom: "LB", totalMass_lb: n * m, totalVolume_gal: null, confidence: "high", source: "n_slash_m_hash" };
  }

  // Number followed by # with no separator. E.g. "20#", "50#".
  const hashOnlyMatch = s.match(/^(\d+(?:\.\d+)?)\s*#$/);
  if (hashOnlyMatch) {
    const n = Number(hashOnlyMatch[1]);
    return { unitCount: 1, unitSize: n, unitUom: "LB", totalMass_lb: n, totalVolume_gal: null, confidence: "high", source: "hash_only" };
  }

  // Glued form: "2412 OZ" -> 24 x 12 OZ. Heuristic: if length matches
  // exactly d{4} + optional whitespace + OZ, try splitting into 2+2.
  const gluedOz = s.match(/^(\d{2})(\d{1,2})\s*OZ$/);
  if (gluedOz) {
    const n = Number(gluedOz[1]);
    const m = Number(gluedOz[2]);
    return { unitCount: n, unitSize: m, unitUom: "OZ", totalMass_lb: (n * m) / 16, totalVolume_gal: null, confidence: "low", source: "glued_ounce_split" };
  }

  // CT-only, e.g. "60CT", "16 CT", "160 CT", "004/75 CT", "10100CT".
  const ctSlashMatch = s.match(/^0*(\d+)\s*[/xX]\s*(\d+)\s*CT$/);
  if (ctSlashMatch) {
    const n = Number(ctSlashMatch[1]);
    const m = Number(ctSlashMatch[2]);
    return { unitCount: n, unitSize: m, unitUom: "CT", totalMass_lb: null, totalVolume_gal: null, confidence: "med", source: "n_x_m_count_ct" };
  }
  const ctMatch = s.match(/^(\d+)\s*CT$/);
  if (ctMatch) {
    const n = Number(ctMatch[1]);
    return { unitCount: 1, unitSize: n, unitUom: "CT", totalMass_lb: null, totalVolume_gal: null, confidence: "med", source: "single_ct" };
  }

  // Padded numeric only, e.g. "001/100", "8X1", "004/5" (no unit at all).
  const paddedNum = s.match(/^0*(\d+)\s*[/xX]\s*0*(\d+)$/);
  if (paddedNum) {
    const n = Number(paddedNum[1]);
    const m = Number(paddedNum[2]);
    return { unitCount: n, unitSize: m, unitUom: null, totalMass_lb: null, totalVolume_gal: null, confidence: "low", source: "padded_no_uom" };
  }

  return null;
}

// ============================================================================
// Fallback: parse pack shape out of description text
// ============================================================================
//
// Descriptions often carry pack info in prefix / suffix:
//   "3# / MUSHROOM SHIITAKE CASE"      -> "3#"
//   "CARROTS 25LB CBI"                 -> "25LB"
//   "SALMON 3-4 PBO SK/OFF"            -> "3-4 PBO"
//   "EGGS - 5 DOZEN"                   -> "5 DOZEN"
//   "CHIX BREAST 4/5 #"                -> "4/5 #"

const DESC_PACK_PATTERNS = [
  // Leading "N# /" prefix
  /^(\d+(?:\.\d+)?)\s*#\s*\//,
  // Standalone N LB / N# / N OZ / N GAL anywhere in description
  /\b(\d+(?:\.\d+)?)\s*(LB|LBS|#|OZ|GAL|FOZ|KG|G|CT|DOZEN|DZ)\b/,
  // N/M LB anywhere
  /\b(\d+)\s*[/xX]\s*(\d+(?:\.\d+)?)\s*(LB|LBS|#|OZ|GAL|FOZ|CT)\b/,
];

export function parsePackFromDescription(description) {
  if (!description) return null;
  const d = String(description).toUpperCase();

  // Try N/M UOM first (most specific)
  const slashDesc = d.match(/\b(\d+)\s*[/xX]\s*(\d+(?:\.\d+)?)\s*(LB|LBS|#|OZ|GAL|FOZ|CT)\b/);
  if (slashDesc) {
    return parsePackSize(`${slashDesc[1]}/${slashDesc[2]} ${slashDesc[3]}`);
  }

  // Standalone N UOM
  const singleDesc = d.match(/\b(\d+(?:\.\d+)?)\s*(LB|LBS|#|OZ|GAL|FOZ|KG|G)\b/);
  if (singleDesc) {
    return parsePackSize(`${singleDesc[1]} ${singleDesc[2]}`);
  }

  // Leading N#
  const leadHash = d.match(/^(\d+(?:\.\d+)?)\s*#/);
  if (leadHash) {
    return parsePackSize(`${leadHash[1]}#`);
  }

  return null;
}

// ============================================================================
// Quantity resolution: prompt spec = shipped_count > ordered_count > quantity
// where non-zero.
// ============================================================================

export function resolveQuantity(row) {
  const shipped = Number(row.shipped_count);
  const ordered = Number(row.ordered_count);
  const quantity = Number(row.quantity);
  if (Number.isFinite(shipped) && shipped !== 0) return { qty: shipped, source: "shipped_count" };
  if (Number.isFinite(ordered) && ordered !== 0) return { qty: ordered, source: "ordered_count" };
  if (Number.isFinite(quantity) && quantity !== 0) return { qty: quantity, source: "quantity" };
  // As a last resort, still return quantity even if zero, so downstream can
  // distinguish "no data" from "zero real qty" via source tag.
  return { qty: null, source: "unresolved" };
}

// ============================================================================
// Full weight resolution for a row
// ============================================================================

export function resolveWeightForRow(row, options = {}) {
  const { catalogLookup } = options; // (vendor_id, item_number) -> parsed pack; optional cache

  const q = resolveQuantity(row);

  // Step 1: catch-weight-marker takes precedence when present.
  // weight_line_value is stored as the vendor's own printed weight per line
  // and is the most trustworthy source when populated.
  if (row.weight_line_value != null && Number.isFinite(Number(row.weight_line_value))) {
    return {
      weight_lb: Number(row.weight_line_value),
      qty: q.qty,
      quantity_source: q.source,
      resolution_method: "weight_line_value",
      confidence: "high",
    };
  }

  // Step 2: parse pack_size column.
  const parsed = parsePackSize(row.pack_size);
  if (parsed && parsed.totalMass_lb != null && q.qty != null) {
    return {
      weight_lb: q.qty * parsed.totalMass_lb,
      qty: q.qty,
      quantity_source: q.source,
      resolution_method: `pack_size:${parsed.source}`,
      confidence: parsed.confidence,
    };
  }

  // Step 3: parse pack shape from description.
  const parsedDesc = parsePackFromDescription(row.description);
  if (parsedDesc && parsedDesc.totalMass_lb != null && q.qty != null) {
    return {
      weight_lb: q.qty * parsedDesc.totalMass_lb,
      qty: q.qty,
      quantity_source: q.source,
      resolution_method: `description:${parsedDesc.source}`,
      confidence: "low",
    };
  }

  // Step 4: catalog lookup by (vendor_id, item_number).
  if (catalogLookup && row.vendor_id && row.item_number) {
    const cached = catalogLookup.get(`${row.vendor_id}::${row.item_number}`);
    if (cached && cached.totalMass_lb != null && q.qty != null) {
      return {
        weight_lb: q.qty * cached.totalMass_lb,
        qty: q.qty,
        quantity_source: q.source,
        resolution_method: `catalog_lookup:${cached.source}`,
        confidence: "low",
      };
    }
  }

  // Step 5: volume-only pack. Exclude from mass, but tag.
  if (parsed && parsed.totalVolume_gal != null) {
    return {
      weight_lb: null,
      qty: q.qty,
      quantity_source: q.source,
      resolution_method: "volume_excluded",
      confidence: "n/a",
    };
  }

  return {
    weight_lb: null,
    qty: q.qty,
    quantity_source: q.source,
    resolution_method: "unresolved",
    confidence: "n/a",
  };
}

export const _internal = { canonUom, toPounds, WEIGHT_UOMS, VOLUME_UOMS, COUNT_UOMS };
