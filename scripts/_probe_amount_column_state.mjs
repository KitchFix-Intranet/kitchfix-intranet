// Verify the actual schema state of ai_line_items.amount.
// PostgREST schema-cache miss is suspicious - if the column doesn't exist
// at the PG level, pr-9-1 was never applied.
import { createClient } from "@supabase/supabase-js";
const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Try probing the column by inserting just amount=null + minimal required fields.
// Pick any existing live submission to use as parent (rollback after).
const { data: anySub } = await supa
  .from("invoice_submissions")
  .select("id, account_key, vendor_name")
  .eq("is_historical", false)
  .limit(1);
if (!anySub?.length) throw new Error("no submission");
const parentId = anySub[0].id;
const accountKey = anySub[0].account_key;

const { data: vendors } = await supa.from("vendors").select("id, name").is("deleted_at", null);
const vendorId = (vendors || [])[0]?.id;

// Try a series of probe inserts, each with one Stage A column at a time.
// If amount fails but others succeed -> only amount is missing from PG/cache.
// If all fail -> none of Stage A reached PG.
// If all succeed -> the v2 audit had a different problem; need to recheck.
const STAGE_A_FIELDS = ["item_number","pack_size","ordered_count","shipped_count","uom_raw","amount","weight_line_value","catch_weight_marker","raw_columns"];
const REQUIRED = {
  invoice_uuid: parentId,
  account_key: accountKey,
  vendor_name: "Probe",
  vendor_id: vendorId,
  line_num: 9999999,  // way beyond any real line_num to avoid the partial unique idx
  description: "schema_probe",
};

console.log("Probing each Stage A column individually:");
for (const col of STAGE_A_FIELDS) {
  const payload = { ...REQUIRED, [col]: null };
  const { data, error } = await supa.from("ai_line_items").insert([payload]).select("id");
  if (error) {
    console.log(`  ${col.padEnd(22)} FAIL  ${error.code} ${error.message.slice(0, 100)}`);
  } else {
    console.log(`  ${col.padEnd(22)} ok    inserted id=${data[0].id}`);
    // rollback
    await supa.from("ai_line_items").delete().eq("id", data[0].id);
  }
}

// Also check: does the table have the column at the PG level (bypass PostgREST cache)?
console.log("");
console.log("Checking schema via direct SELECT:");
for (const col of STAGE_A_FIELDS) {
  const { error } = await supa.from("ai_line_items").select(col).limit(1);
  if (error) {
    console.log(`  SELECT ${col.padEnd(22)} FAIL  ${error.code} ${error.message.slice(0, 100)}`);
  } else {
    console.log(`  SELECT ${col.padEnd(22)} ok`);
  }
}
