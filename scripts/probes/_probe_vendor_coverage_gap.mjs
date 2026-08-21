// READ-ONLY: assess vendor resolution coverage for top failing vendors.
// Top gap vendors (from full-history dual-write gap probe):
//   Shamrock Foods (8), Sysco (7), Peddler's Son (7), Cheney Brothers (3),
//   Cintas (2), What Chefs Want (1), Ben E Keith (1), inreach (1),
//   Swire Coca-Cola (1), Alsco Uniforms (1), Cozzini (1),
//   Gordon Food Service (1)
//
// Algorithm matches insertAILineItemsPostgres resolveVendorId:
//   1. exact match on lower(vendors.name)
//   2. vendor_aliases.alias_normalized (lowercase + strip non-[a-z0-9 space])

import { createClient } from "@supabase/supabase-js";
const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const gapVendors = [
  "Shamrock Foods",
  "Sysco",
  "Peddler's Son",
  "Cheney Brothers",
  "Cintas",
  "What Chefs Want",
  "Ben E Keith",
  "inreach",
  "Swire Coca-Cola",
  "Alsco Uniforms",
  "Cozzini",
  "Gordon Food Service",
];

// Pull vendors + aliases just like the orchestrator does
const { data: vendors } = await supa.from("vendors").select("id, name").is("deleted_at", null);
const { data: aliases } = await supa.from("vendor_aliases").select("vendor_id, alias_normalized, alias");

const nameToVendorId = new Map();
for (const v of vendors || []) nameToVendorId.set((v.name || "").toLowerCase(), v);
const aliasNormToVendor = new Map();
for (const a of aliases || []) aliasNormToVendor.set((a.alias_normalized || "").toLowerCase(), a);

function normalizeAlias(s) {
  return String(s || "").toLowerCase().replace(/[^a-zA-Z0-9 ]/g, "");
}

console.log("Vendor resolution check (matches insertAILineItemsPostgres algorithm):");
console.log("");
console.log("  Input vendor name           Exact?  Alias?  Resolved vendor_id  vendors.name");
console.log("  ─────────────────────────  ──────  ──────  ──────────────────  ─────────────");
for (const vn of gapVendors) {
  const lower = vn.toLowerCase().trim();
  const exact = nameToVendorId.get(lower);
  const norm = normalizeAlias(vn);
  const aliasHit = aliasNormToVendor.get(norm);
  const resolvedVendor = exact || (aliasHit && (vendors || []).find((v) => v.id === aliasHit.vendor_id));
  const resolvedName = exact?.name || resolvedVendor?.name || "(unresolved)";
  console.log(
    `  ${vn.padEnd(26)}  ` +
    `${exact ? "  ok  " : "  -   "}  ` +
    `${!exact && aliasHit ? "  ok  " : "  -   "}  ` +
    `${(resolvedVendor?.id || "(none)").toString().slice(0, 18).padEnd(18)}  ` +
    `${resolvedName}`
  );
}

console.log("");
console.log("All vendors currently in vendors table (33 rows):");
for (const v of (vendors || []).sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`  ${v.name}`);
}
console.log("");
console.log(`All aliases currently in vendor_aliases (${(aliases || []).length} rows):`);
const byVendor = new Map();
for (const a of aliases || []) {
  if (!byVendor.has(a.vendor_id)) byVendor.set(a.vendor_id, []);
  byVendor.get(a.vendor_id).push(a.alias);
}
for (const [vid, aArr] of byVendor.entries()) {
  const vname = (vendors || []).find((v) => v.id === vid)?.name || "(?)";
  console.log(`  ${vname.padEnd(28)} -> ${aArr.join(", ")}`);
}
