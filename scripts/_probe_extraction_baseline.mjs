// Baseline: for each of 15 held-out invoices (3 per vendor x 5 vendors),
// read existing PG raw_json and report exactly which fields are present.
// No re-extraction - just observe what extraction is actually producing today.
//
// Metrics per vendor:
//   - Total line items across the 3 invoices
//   - raw_json key count distribution (how many keys per line)
//   - Stage A fields presence: weightLineValue, packSize, uomRaw, shippedCount,
//     itemNumber, orderedCount, amount, catchWeightMarker
//   - Math reconcile rate (qty * up == amt within tolerance)
//   - For WCW: the quantity field values (the no-regression baseline)
import { createClient } from "@supabase/supabase-js";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// The 15 held-out invoices from the earlier sample probe.
const HELDOUT = {
  "Sysco":               ["103353513", "532396224"],
  "Ben E Keith":         ["57189446",  "57189438"],
  "Gordon Food Service": ["9036225940","9035380699"],
  "Cheney Brothers":     ["20-910735530", "06910771693"],
  "What Chefs Want":     ["12728505",  "12713817"],
};

const STAGE_A_KEYS = ["weightLineValue", "packSize", "uomRaw", "shippedCount", "itemNumber", "orderedCount", "amount", "catchWeightMarker"];

async function reportVendor(vendor, invoiceNumbers) {
  console.log("===== " + vendor + " (" + invoiceNumbers.length + " invoices) =====");
  // Look up invoice_uuid by number
  const { data: subs } = await supa.from("invoice_submissions")
    .select("id, invoice_number")
    .in("invoice_number", invoiceNumbers);
  const uuids = (subs || []).map((s) => s.id);
  if (uuids.length === 0) { console.log("  (no invoices matched)"); return; }

  const { data: lines } = await supa.from("ai_line_items")
    .select("description, quantity, unit, unit_price, extended_price, raw_json")
    .in("invoice_uuid", uuids);

  if (!lines || lines.length === 0) { console.log("  (no line items)"); return; }
  console.log("  Total line items: " + lines.length);

  // Key count distribution
  const keyCountBuckets = new Map();
  for (const r of lines) {
    const k = Object.keys(r.raw_json || {}).length;
    keyCountBuckets.set(k, (keyCountBuckets.get(k) || 0) + 1);
  }
  console.log("  raw_json key count distribution:");
  for (const [k, n] of [...keyCountBuckets.entries()].sort((a,b)=>a[0]-b[0])) {
    console.log("    " + k + " keys: " + n + " lines (" + ((n/lines.length)*100).toFixed(0) + "%)");
  }

  // Stage A field presence
  console.log("  Stage A field presence:");
  for (const k of STAGE_A_KEYS) {
    const present = lines.filter((r) => k in (r.raw_json || {})).length;
    const populated = lines.filter((r) => {
      const v = (r.raw_json || {})[k];
      return v !== null && v !== undefined && v !== "";
    }).length;
    console.log("    " + k.padEnd(20) + " present: " + String(present).padStart(3) + "/" + lines.length + "   populated: " + String(populated).padStart(3) + "/" + lines.length);
  }

  // Math reconcile rate
  let reconc = 0, mathFail = 0;
  for (const r of lines) {
    const am = Number(r.extended_price) || 0;
    const calc = (Number(r.quantity) || 0) * (Number(r.unit_price) || 0);
    if (Math.abs(calc - am) <= 0.02 * Math.abs(am) + 0.01) reconc++;
    else mathFail++;
  }
  console.log("  Math reconciles: " + reconc + "/" + lines.length + "  (" + ((reconc/lines.length)*100).toFixed(0) + "%)");
  console.log("  Math FAILS:      " + mathFail + "/" + lines.length + "  (these are the catch-weight + other extraction holes)");

  // Catch-weight zoom: lines where math fails AND implied weight is plausible
  const catchWeightCandidates = lines.filter((r) => {
    const am = Number(r.extended_price) || 0;
    const up = Number(r.unit_price) || 0;
    const q  = Number(r.quantity)    || 0;
    if (am <= 0 || up <= 0) return false;
    const calc = q * up;
    if (Math.abs(calc - am) <= 0.02 * Math.abs(am) + 0.01) return false;
    const impliedW = am / up;
    return impliedW > 5 && impliedW < 500;
  });
  console.log("  Catch-weight-candidate lines (math fails, implied_weight 5-500): " + catchWeightCandidates.length);

  // For WCW: report the qty + unit values so the no-regression baseline is recorded
  if (vendor === "What Chefs Want") {
    console.log("  WCW no-regression baseline (qty, unit per line):");
    let i = 0;
    for (const r of lines) {
      if (i++ >= 8) { console.log("    ... (" + (lines.length-8) + " more lines omitted)"); break; }
      console.log("    qty=" + r.quantity + " " + r.unit + "  desc=\"" + (r.description||"").slice(0, 60) + "\"");
    }
  }
  console.log();
}

for (const [vendor, invoices] of Object.entries(HELDOUT)) {
  await reportVendor(vendor, invoices);
}

// Aggregate the headline metric
console.log("===== HEADLINE METRICS =====");
const totalsByVendor = new Map();
for (const [vendor, invoices] of Object.entries(HELDOUT)) {
  const { data: subs } = await supa.from("invoice_submissions").select("id").in("invoice_number", invoices);
  const uuids = (subs||[]).map(s => s.id);
  if (uuids.length === 0) continue;
  const { data: lines } = await supa.from("ai_line_items").select("raw_json, quantity, unit_price, extended_price").in("invoice_uuid", uuids);
  if (!lines) continue;
  let total15 = 0, totalAny = lines.length;
  let weightLine = 0, packSize = 0, uomRaw = 0, shippedCount = 0;
  let mathOK = 0;
  for (const r of lines) {
    const rj = r.raw_json || {};
    if (Object.keys(rj).length >= 15) total15++;
    if (Number(rj.weightLineValue) > 0) weightLine++;
    if (rj.packSize) packSize++;
    if (rj.uomRaw) uomRaw++;
    if (Number(rj.shippedCount) > 0) shippedCount++;
    const am = Number(r.extended_price) || 0;
    const calc = (Number(r.quantity)||0) * (Number(r.unit_price)||0);
    if (Math.abs(calc-am) <= 0.02 * Math.abs(am) + 0.01) mathOK++;
  }
  totalsByVendor.set(vendor, { totalAny, total15, weightLine, packSize, uomRaw, shippedCount, mathOK });
}
console.log();
console.log("vendor                 | lines | full-shape | weight | packSize | uomRaw | shippedCount | mathOK");
for (const [v, t] of totalsByVendor) {
  console.log("  " + v.padEnd(22) + "| " + String(t.totalAny).padStart(5) + " | " + String(t.total15).padStart(10) + " | " + String(t.weightLine).padStart(6) + " | " + String(t.packSize).padStart(8) + " | " + String(t.uomRaw).padStart(6) + " | " + String(t.shippedCount).padStart(12) + " | " + String(t.mathOK).padStart(6));
}

process.exit(0);
