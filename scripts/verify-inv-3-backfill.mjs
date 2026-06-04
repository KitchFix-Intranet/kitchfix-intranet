// Read-only post-backfill verification for INV-3.
// Counts + FK integrity + Samuels vendor check + B1 survival + view derivations.

import { createClient } from "@supabase/supabase-js";
const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function fetchAllIds(table, col = "id") {
  const out = new Set();
  let from = 0; const PAGE = 1000;
  while (true) {
    const { data, error } = await supa.from(table).select(col).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} fetch: ${error.message}`);
    if (!data?.length) break;
    for (const r of data) if (r[col] !== null) out.add(r[col]);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function countTable(t) {
  const { count } = await supa.from(t).select("*", { count: "exact", head: true });
  return count || 0;
}

// ── 1. Counts ──
const projected = {
  storage_locations:   32,
  inventory_items:     3759,
  item_aliases:        4342,
  count_sessions:      5,
  count_items:         147,
  price_history:       6665,
  review_queue:        191,
  merge_history:       58,
  merge_history_items: 120,
};

console.log("PROJECTED vs ACTUAL row counts");
console.log("─".repeat(70));
let allMatch = true;
for (const [t, want] of Object.entries(projected)) {
  const got = await countTable(t);
  const ok = got === want;
  if (!ok) allMatch = false;
  console.log(`  ${t.padEnd(22)} projected=${String(want).padStart(5)}  actual=${String(got).padStart(5)}  ${ok ? "MATCH" : "MISMATCH"}`);
}
console.log(`Overall: ${allMatch ? "all counts MATCH projections" : "MISMATCH — investigate"}`);
console.log("");

// ── 2. FK + integrity spot-checks ──
console.log("FK + integrity spot-checks");
console.log("─".repeat(70));

// 2a. price_history.item_id all resolve to inventory_items.id
const itemIds = await fetchAllIds("inventory_items", "id");
const phItemIds = await fetchAllIds("price_history", "item_id");
const phOrphans = [...phItemIds].filter((id) => !itemIds.has(id));
console.log(`  price_history with item_id not in inventory_items: ${phOrphans.length} (expect 0)`);

// 2b. price_history.vendor_id all resolve to vendors.id
const vendorIds = await fetchAllIds("vendors", "id");
const phVendorIds = await fetchAllIds("price_history", "vendor_id");
const phVendorOrphans = [...phVendorIds].filter((id) => !vendorIds.has(id));
console.log(`  price_history with vendor_id not in vendors:        ${phVendorOrphans.length} (expect 0)`);

// 2c. review_queue.invoice_id (non-null) all resolve to invoice_submissions.id
const invIds = await fetchAllIds("invoice_submissions", "id");
const rqInvoiceIds = await fetchAllIds("review_queue", "invoice_id");
const rqInvoiceOrphans = [...rqInvoiceIds].filter((id) => !invIds.has(id));
console.log(`  review_queue invoice_id (non-null) not in invoice_submissions: ${rqInvoiceOrphans.length} (expect 0)`);

// 2d. merge_history_items.item_id non-null orphans
const mhiItemIds = await fetchAllIds("merge_history_items", "item_id");
const mhiOrphans = [...mhiItemIds].filter((id) => !itemIds.has(id));
console.log(`  merge_history_items with non-null item_id not in inventory_items: ${mhiOrphans.length} (expect 0; the 1 approved orphan has item_id NULL)`);
const { count: mhiNullCount } = await supa
  .from("merge_history_items")
  .select("*", { count: "exact", head: true })
  .is("item_id", null);
console.log(`  merge_history_items with item_id NULL (the approved orphan):     ${mhiNullCount} (expect 1)`);

// 2e. Samuels items' price_history landed with vendor_id=SAM-902
const { data: samuelsItems } = await supa
  .from("inventory_items")
  .select("id, name, vendor_id")
  .eq("vendor_id", "SAM-902");
console.log(`  inventory_items with vendor_id=SAM-902 (Samuels Seafood Co): ${samuelsItems?.length ?? 0}`);
const samuelsIds = (samuelsItems || []).map((r) => r.id);
if (samuelsIds.length) {
  const { data: samuelsPh } = await supa
    .from("price_history")
    .select("item_id, vendor_id, price")
    .in("item_id", samuelsIds);
  const distinctVendors = new Set((samuelsPh || []).map((r) => r.vendor_id));
  console.log(`  price_history rows for those items: ${samuelsPh?.length ?? 0}, distinct vendor_ids in those rows: [${[...distinctVendors].join(", ")}] (expect [SAM-902])`);
}

// 2f. B1 survival: pick a known B1 collision key and verify both prices landed
const knownB1 = { item_id: "item_3edcca7f-7bfc-ad53-b4ac10c4", source_or_invoice_id: "ba7f25bb-5539-4914-a21a-8eb6e438da04" };
const { data: b1Rows } = await supa
  .from("price_history")
  .select("item_id, source_or_invoice_id, price, effective_date, vendor_id")
  .eq("item_id", knownB1.item_id)
  .eq("source_or_invoice_id", knownB1.source_or_invoice_id);
console.log(`  B1 survival probe (item_3edcca7f / ba7f25bb...): ${b1Rows?.length ?? 0} rows (expect 2 with distinct prices 71.07 and 4.03)`);
for (const r of b1Rows || []) {
  console.log(`    price=${r.price} eff_date=${r.effective_date} vendor=${r.vendor_id}`);
}

console.log("");
console.log("View derivations");
console.log("─".repeat(70));

// 3a. v_inventory_items_full last_price for a few items
const { data: vifSample } = await supa
  .from("v_inventory_items_full")
  .select("id, name, status, last_price, last_price_date, last_price_vendor_id")
  .in("id", [
    "item_05157f33-f870-0381-c8eb4666",
    "item_a1daf452-b7a8-a200-17b10404",
    "item_b221f83b-d317-12f3-41071901",
  ]);
console.log(`  v_inventory_items_full sample (3 items):`);
for (const r of vifSample || []) {
  console.log(`    id=${r.id}  name="${r.name}"  status=${r.status}`);
  console.log(`      last_price=${r.last_price}  last_price_date=${r.last_price_date}  last_price_vendor_id=${r.last_price_vendor_id}`);
}

// 3b. v_count_session_totals for the 5 sessions
const { data: totalsSample } = await supa
  .from("v_count_session_totals")
  .select("*");
console.log(`  v_count_session_totals (${totalsSample?.length ?? 0} rows; expect 5):`);
for (const t of totalsSample || []) {
  console.log(`    session=${t.session_id}  food=${t.total_food}  packaging=${t.total_packaging}  supplies=${t.total_supplies}  snacks=${t.total_snacks}  beverages=${t.total_beverages}  grand=${t.grand_total}`);
}

// 3c. Generated columns sanity: 3 count_items - extended_price = quantity*price_at_count
const { data: ciSample } = await supa
  .from("count_items")
  .select("id, quantity, price_at_count, extended_price")
  .limit(3);
console.log(`  count_items generated column probe:`);
for (const r of ciSample || []) {
  const expected = Number(r.quantity) * Number(r.price_at_count);
  const ok = Math.abs(Number(r.extended_price) - expected) < 1e-9;
  console.log(`    qty=${r.quantity}  price=${r.price_at_count}  extended_price=${r.extended_price}  ${ok ? "OK" : "WRONG"}`);
}

// 3d. item_aliases alias_normalized populated
const { data: aliasSample } = await supa
  .from("item_aliases")
  .select("alias_text, alias_normalized")
  .limit(3);
console.log(`  item_aliases alias_normalized probe:`);
for (const r of aliasSample || []) {
  console.log(`    "${r.alias_text}" -> "${r.alias_normalized}"`);
}
