import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Look at raw JSON for cat 68ed4977 - find category display_value
const { data } = await supa.from("rippling_raw_spend_lines_latest").select("category_id, raw").eq("category_id", "68ed4977b7aabd4234afda3a").limit(3);
for (const r of data) {
  const raw = r.raw;
  // display_value fields
  const cat = raw.category;
  console.log("category (id):", cat);
  // Look for any display_value that hints at the name
  for (const k of Object.keys(raw)) {
    if (raw[k] && typeof raw[k] === "object" && raw[k].display_value) {
      console.log(`  ${k}.display_value = ${raw[k].display_value}`);
    }
  }
  console.log("---");
}
