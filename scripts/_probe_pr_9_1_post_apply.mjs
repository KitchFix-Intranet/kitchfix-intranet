// Sanity probe: are the 9 new columns visible to PostgREST + readable + writable?
import { createClient } from "@supabase/supabase-js";
const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const STAGE_A = ["item_number","pack_size","ordered_count","shipped_count","uom_raw","amount","weight_line_value","catch_weight_marker","raw_columns"];

console.log("SELECT probe (each column individually):");
let cacheStale = false;
for (const col of STAGE_A) {
  const { error } = await supa.from("ai_line_items").select(col).limit(1);
  if (error) {
    console.log(`  ${col.padEnd(22)} FAIL  ${error.code} ${error.message.slice(0, 80)}`);
    if (error.code === "PGRST204" || error.code === "PGRST205") cacheStale = true;
  } else {
    console.log(`  ${col.padEnd(22)} ok`);
  }
}

console.log("");
console.log("INSERT probe (one row with all 9 columns set):");
// Pick a real submission + vendor so FKs pass; use line_num=9999999 to avoid
// colliding with any real line on the chosen parent. Rollback after.
const { data: anySub } = await supa
  .from("invoice_submissions")
  .select("id, account_key, vendor_name")
  .eq("is_historical", false)
  .limit(1);
const parentId = anySub[0].id;
const accountKey = anySub[0].account_key;
const { data: vendors } = await supa.from("vendors").select("id").is("deleted_at", null).limit(1);
const vendorId = vendors[0].id;

const payload = {
  invoice_uuid: parentId,
  account_key: accountKey,
  vendor_name: "ProbePR9_1",
  vendor_id: vendorId,
  line_num: 9999998,
  description: "pr-9-1 post-apply probe row",
  item_number:         "TEST-SKU",
  pack_size:           "1/1 LB",
  ordered_count:       1,
  shipped_count:       1,
  uom_raw:             "CS",
  amount:              9.99,
  weight_line_value:   1.5,
  catch_weight_marker: "*CS",
  raw_columns:         { probe: true },
};
const { data: ins, error: insErr } = await supa.from("ai_line_items").insert([payload]).select("id");
if (insErr) {
  console.log(`  FAIL  ${insErr.code} ${insErr.message}`);
  if (insErr.code === "PGRST204" || insErr.code === "PGRST205") cacheStale = true;
} else {
  console.log(`  ok    inserted id=${ins[0].id}, rolling back`);
  const { error: delErr } = await supa.from("ai_line_items").delete().eq("id", ins[0].id);
  if (delErr) console.log(`  ROLLBACK FAILED: ${delErr.message} - row ${ins[0].id} still in PG`);
}

console.log("");
console.log("Negative probe (catch_weight_marker CHECK rejects garbage):");
const badPayload = { ...payload, line_num: 9999997, catch_weight_marker: "*BAD" };
const { data: bins, error: badErr } = await supa.from("ai_line_items").insert([badPayload]).select("id");
if (badErr) {
  console.log(`  ok    CHECK rejected: ${badErr.code} ${badErr.message.slice(0, 80)}`);
} else {
  console.log(`  FAIL  CHECK accepted '*BAD' - constraint missing`);
  await supa.from("ai_line_items").delete().eq("id", bins[0].id);
}

console.log("");
console.log(cacheStale ? "PostgREST cache is STALE - need NOTIFY pgrst, 'reload schema'" : "PostgREST cache is FRESH - migration is fully active");
