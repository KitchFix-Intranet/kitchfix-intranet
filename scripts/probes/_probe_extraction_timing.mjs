// Preview-only probe: when did Stage A fields start appearing in raw_json?
// If recent extractions DO populate weightLineValue but older ones don't,
// the prompt is fine; the failing rows just predate the prompt extension.
import { createClient } from "@supabase/supabase-js";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data } = await supa.from("ai_line_items")
  .select("created_at, vendor_name, description, quantity, unit, unit_price, extended_price, raw_json")
  .in("vendor_name", ["Sysco", "Ben E Keith", "What Chefs Want", "Cheney Brothers", "Kuna Foodservice", "Gordon Food Service"])
  .gte("created_at", "2026-01-01")
  .order("created_at", { ascending: false })
  .limit(3000);

console.log("Sampled " + (data?.length || 0) + " rows from 6 vendors since 2026-01-01");

const byMonth = new Map();
for (const r of data || []) {
  const ym = (r.created_at || "").slice(0, 7);
  const rj = r.raw_json || {};
  const hasStageA = ("weightLineValue" in rj) || ("shippedCount" in rj) || ("itemNumber" in rj);
  const w = Number(rj.weightLineValue);
  const am = Number(r.extended_price) || 0;
  const reconc = Math.abs((Number(r.quantity) || 0) * (Number(r.unit_price) || 0) - am) < 0.02 * Math.abs(am) + 0.01;
  if (!byMonth.has(ym)) byMonth.set(ym, { total: 0, stageA: 0, mathOK: 0, weightPop: 0 });
  const m = byMonth.get(ym);
  m.total++;
  if (hasStageA) m.stageA++;
  if (Number.isFinite(w) && w > 0) m.weightPop++;
  if (reconc) m.mathOK++;
}

console.log();
console.log("By month - total | stageA in raw_json | weightLineValue populated | math reconciles");
for (const [ym, m] of [...byMonth.entries()].sort()) {
  console.log("  " + ym + "  total=" + String(m.total).padStart(4) + "  stageA=" + String(m.stageA).padStart(4) + "  weightPop=" + String(m.weightPop).padStart(4) + "  mathOK=" + String(m.mathOK).padStart(4));
}

console.log();
console.log("MOST RECENT row per vendor with Stage A in raw_json (one each):");
const byVendor = new Map();
for (const r of data || []) {
  const rj = r.raw_json || {};
  if (!("weightLineValue" in rj) && !("shippedCount" in rj) && !("itemNumber" in rj)) continue;
  if (!byVendor.has(r.vendor_name)) byVendor.set(r.vendor_name, r);
}
for (const [v, r] of byVendor) {
  console.log("  " + v + " (" + (r.created_at || "").slice(0, 10) + "):");
  console.log("    desc=\"" + (r.description || "").slice(0, 60) + "\"");
  console.log("    raw_json: " + JSON.stringify(r.raw_json));
}

console.log();
console.log("MOST RECENT row per vendor WITHOUT Stage A in raw_json (one each):");
const byVendorNoStageA = new Map();
for (const r of data || []) {
  const rj = r.raw_json || {};
  if (("weightLineValue" in rj) || ("shippedCount" in rj) || ("itemNumber" in rj)) continue;
  if (!byVendorNoStageA.has(r.vendor_name)) byVendorNoStageA.set(r.vendor_name, r);
}
for (const [v, r] of byVendorNoStageA) {
  console.log("  " + v + " (" + (r.created_at || "").slice(0, 10) + "):");
  console.log("    desc=\"" + (r.description || "").slice(0, 60) + "\"");
  console.log("    raw_json: " + JSON.stringify(r.raw_json));
}

process.exit(0);
