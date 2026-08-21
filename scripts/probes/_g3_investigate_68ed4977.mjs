import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Deep look at 68ed4977b7aabd4234afda3a. What departments / work locations / merchants dominate?
const rows = [];
{ let from = 0; const step = 1000;
  while (true) {
    const { data } = await supa.from("rippling_raw_spend_lines_latest")
      .select("category_id, external_id, amount, merchant_name, department_label, work_location_label, raw")
      .eq("category_id", "68ed4977b7aabd4234afda3a")
      .order("id").range(from, from + step - 1);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < step) break;
    from += step;
  }
}
console.log(`raw rows: ${rows.length}`);

// Look at ext_id patterns
const withContent = rows.filter(r => /line_item_content_[a-f0-9]+_/i.test(r.external_id));
const other = rows.filter(r => !/line_item_content_[a-f0-9]+_/i.test(r.external_id));
console.log(`  matching pattern line_item_content_HEX_...: ${withContent.length}`);
console.log(`  other patterns: ${other.length}`);
if (other.length) {
  console.log("  sample other pattern:");
  for (const r of other.slice(0, 5)) console.log("    ", r.external_id);
}

// Check the "68ed4977..." embedded in external_id: is it ALWAYS the same across rows?
// Actually the pattern captures cat_id inside external_id. Let me see distribution.
const embedCats = new Map();
for (const r of rows) {
  const m = /line_item_content_([a-f0-9]+)_/i.exec(r.external_id);
  if (m) embedCats.set(m[1], (embedCats.get(m[1]) || 0) + 1);
}
console.log("\ncat_ids EMBEDDED in external_id (should be one - the category itself):");
for (const [c, n] of [...embedCats.entries()].sort((a,b) => b[1]-a[1]).slice(0, 20)) console.log(`  ${c}: ${n}`);

// Merchants histogram
const merchants = new Map();
for (const r of rows) merchants.set(r.merchant_name, (merchants.get(r.merchant_name) || 0) + 1);
console.log("\ntop 20 merchants:");
for (const [m, n] of [...merchants.entries()].sort((a,b) => b[1]-a[1]).slice(0, 20)) console.log(`  ${n.toString().padStart(5)}  ${m}`);

// department labels
const depts = new Map();
for (const r of rows) depts.set(r.department_label, (depts.get(r.department_label) || 0) + 1);
console.log("\ntop 10 department_labels:");
for (const [d, n] of [...depts.entries()].sort((a,b) => b[1]-a[1]).slice(0, 10)) console.log(`  ${n.toString().padStart(5)}  ${d}`);
