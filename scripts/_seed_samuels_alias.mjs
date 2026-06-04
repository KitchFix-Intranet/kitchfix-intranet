// One-time INV-3-prep write (executed 2026-06-04) that seeded the
// vendor_aliases row mapping the inventory typo "Samuels Seafoos" to the
// canonical vendor SAM-902 ("Samuels Seafood Co"). Already applied;
// idempotent on re-run (pre-checks for existing alias before inserting).
// Kept in tree as the provenance record for that prod write.
import { createClient } from "@supabase/supabase-js";
const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// 1. Look up Samuels Seafood. The widget stored it as "Samuels Seafood Co"
// (note " Co" suffix); use a wildcard so the alias still maps to the
// canonical vendor regardless of suffix variants.
const { data: vendors, error: vErr } = await supa
  .from("vendors")
  .select("id, name, deleted_at")
  .ilike("name", "samuels seafood%")
  .is("deleted_at", null);
if (vErr) { console.error("vendor lookup:", vErr.message); process.exit(1); }
console.log(`vendors.name ILIKE 'samuels seafood%' (live): ${vendors.length}`);
for (const v of vendors) console.log(`  id=${v.id}  name="${v.name}"`);
if (vendors.length === 0) {
  console.error("Samuels Seafood not found in vendors");
  process.exit(1);
}
if (vendors.length > 1) {
  console.error("Multiple Samuels Seafood vendors found; refusing to guess");
  process.exit(1);
}
const vendorId = vendors[0].id;

// 2. Check if alias already exists (idempotent).
const { data: existing } = await supa
  .from("vendor_aliases")
  .select("id, alias_text, alias_normalized, source")
  .eq("vendor_id", vendorId)
  .eq("alias_normalized", "samuels seafoos");
console.log(`existing vendor_aliases row for (vendor_id=${vendorId}, alias_normalized='samuels seafoos'): ${existing?.length || 0}`);
if (existing && existing.length > 0) {
  console.log("Alias already present; nothing to insert.");
  for (const a of existing) console.log(`  id=${a.id} alias_text="${a.alias_text}" source=${a.source}`);
  process.exit(0);
}

// 3. Insert.
const { data: inserted, error: insErr } = await supa
  .from("vendor_aliases")
  .insert({
    vendor_id:  vendorId,
    alias_text: "Samuels Seafoos",
    source:     "manual",
    learned_by: "inv-3-backfill-prep",
  })
  .select("id, vendor_id, alias_text, alias_normalized, source, learned_by, learned_at")
  .single();
if (insErr) { console.error("insert:", insErr.message); process.exit(1); }
console.log(`INSERTED:`);
console.log(JSON.stringify(inserted, null, 2));

// 4. Confirm generated column populated correctly.
if (inserted.alias_normalized !== "samuels seafoos") {
  console.error(`alias_normalized="${inserted.alias_normalized}" - expected "samuels seafoos"`);
  process.exit(1);
}
console.log(`alias_normalized correctly populated: "${inserted.alias_normalized}"`);

// 5. UNIQUE re-check: try to insert again, expect failure.
const { error: dupErr } = await supa.from("vendor_aliases").insert({
  vendor_id:  vendorId,
  alias_text: "Samuels Seafoos",
  source:     "manual",
});
if (dupErr) {
  console.log(`UNIQUE (vendor_id, alias_normalized) re-check: rejected duplicate as expected (code=${dupErr.code}, msg="${dupErr.message.slice(0, 80)}...")`);
} else {
  console.error("UNIQUE constraint did not fire on duplicate insert!");
  process.exit(1);
}
console.log(``);
console.log(`OK: vendor_aliases seeded.`);
