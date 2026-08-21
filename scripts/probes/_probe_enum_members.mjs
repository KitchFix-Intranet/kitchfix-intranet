// Read-only enum membership probe. PostgreSQL coerces the literal in .eq()
// to the column's enum type. If the literal is not a valid member, PG
// raises "invalid input value for enum ... " with the actual rejected
// string. We catch the rejection - no row touched, no DDL run.
import { createClient } from "@supabase/supabase-js";
const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

console.log("Method: SELECT with .eq() on enum column. PG raises on invalid literal.");
console.log();

async function testEnumValue(table, column, value, label) {
  const { error } = await sb.from(table).select("id").eq(column, value).limit(1);
  if (error) {
    if (error.code === "22P02" || /invalid input value for enum/i.test(error.message)) {
      console.log("  ✗ " + label + ": REJECTED - '" + value + "' is NOT a member of the enum");
      console.log("    error code: " + error.code);
      console.log("    error msg:  " + error.message.slice(0, 200));
    } else {
      console.log("  ? " + label + ": OTHER ERROR (" + error.code + ") " + error.message.slice(0, 200));
    }
  } else {
    console.log("  ✓ " + label + ": ACCEPTED - '" + value + "' IS a valid member of the enum");
  }
}

console.log("══════════════════════════════════════════════════════════════");
console.log("ENUM 1: inventory_alias_source  (item_aliases.source column)");
console.log("══════════════════════════════════════════════════════════════");
const aliasValues = ["manual_resolve", "manual_resolve_reverted",
                     "manual", "ocr_learned", "merge", "item_review", "ai_cron",
                     "definitely_not_a_real_enum_member"];
for (const v of aliasValues) {
  await testEnumValue("item_aliases", "source", v, "value '" + v + "'");
}

console.log();
console.log("══════════════════════════════════════════════════════════════");
console.log("ENUM 2: price_history_source  (price_history.source column)");
console.log("══════════════════════════════════════════════════════════════");
const phValues = ["manual_resolve", "manual_resolve_reverted",
                  "manual_add", "manual_verify", "invoice_ocr", "merge",
                  "definitely_not_a_real_enum_member"];
for (const v of phValues) {
  await testEnumValue("price_history", "source", v, "value '" + v + "'");
}

// Also re-fetch the live OpenAPI for cross-confirmation
console.log();
console.log("══════════════════════════════════════════════════════════════");
console.log("Cross-check: live OpenAPI enum definitions");
console.log("══════════════════════════════════════════════════════════════");
const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const res = await fetch(URL + "/rest/v1/", {
  headers: { apikey: KEY, Authorization: "Bearer " + KEY, Accept: "application/openapi+json" },
});
const spec = await res.json();
const ia = spec.definitions?.item_aliases?.properties?.source;
const ph = spec.definitions?.price_history?.properties?.source;
console.log("OpenAPI: item_aliases.source enum members  = (" + (ia?.enum || []).join(", ") + ")");
console.log("OpenAPI: price_history.source enum members = (" + (ph?.enum || []).join(", ") + ")");

process.exit(0);
