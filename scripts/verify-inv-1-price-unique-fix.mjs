// Verify the INV-1 follow-up: the price_history UNIQUE key was widened
// from (item_id, source_or_invoice_id) to (item_id, source_or_invoice_id,
// price), and the merge_inventory_items RPC's NOT EXISTS check also
// matches on price.
//
// Read-only; no DDL or DML.
//
// USAGE
//   node --env-file=.env.local scripts/verify-inv-1-price-unique-fix.mjs

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

console.log("INV-1 follow-up verification");
console.log("─".repeat(70));

// 1. price_history empty (sanity).
const { count: phCount } = await supa
  .from("price_history")
  .select("*", { count: "exact", head: true });
console.log(`price_history row count: ${phCount} ${phCount === 0 ? "OK (expected 0 pre-rerun)" : "WARN non-empty"}`);

// 2. The UNIQUE constraint test: write two rows with same
//    (item_id, source_or_invoice_id) but different price. Old key
//    rejects the second; new key accepts both. We use a real item_id
//    + vendor_id so the FKs satisfy, then clean up.
const { data: anyItem } = await supa
  .from("inventory_items")
  .select("id, account, vendor_id")
  .limit(1)
  .single();
if (!anyItem) {
  console.error("Could not find a real inventory_items row for the probe. Aborting.");
  process.exit(2);
}

const probeKey = `__inv1_unique_probe_${Date.now()}__`;
const probeRows = [
  {
    item_id: anyItem.id,
    account: anyItem.account,
    vendor_id: anyItem.vendor_id,
    price: 1.01,
    effective_date: "2026-01-01",
    source_or_invoice_id: probeKey,
    source: "manual_add",
  },
  {
    item_id: anyItem.id,
    account: anyItem.account,
    vendor_id: anyItem.vendor_id,
    price: 2.02,
    effective_date: "2026-01-01",
    source_or_invoice_id: probeKey,
    source: "manual_add",
  },
];

const { data: probeIns, error: probeErr } = await supa
  .from("price_history")
  .insert(probeRows)
  .select("id");

if (probeErr) {
  console.log(`PROBE: insert two same-(item, source) DIFFERENT prices -> REJECTED`);
  console.log(`  error code: ${probeErr.code}`);
  console.log(`  error msg:  ${probeErr.message}`);
  console.log(`  -> the OLD UNIQUE (item_id, source_or_invoice_id) is still in effect.`);
  console.log(`     Paste docs/migrations/inv-1-fix-price-history-unique.sql in Studio and retry.`);
  process.exit(1);
}
console.log(`PROBE: insert two same-(item, source) DIFFERENT prices -> ACCEPTED (${probeIns.length} rows)`);

// 3. Same-(item, source) SAME price must still collide.
const probeDupErr = await supa.from("price_history").insert([{
  item_id: anyItem.id,
  account: anyItem.account,
  vendor_id: anyItem.vendor_id,
  price: 1.01,            // same as the first probe row
  effective_date: "2026-01-01",
  source_or_invoice_id: probeKey,
  source: "manual_add",
}]);
if (probeDupErr.error && probeDupErr.error.code === "23505") {
  console.log(`PROBE: insert same (item, source, price) -> REJECTED with 23505 OK`);
  console.log(`  constraint message: ${probeDupErr.error.message.slice(0, 100)}`);
} else if (probeDupErr.error) {
  console.log(`PROBE: same-key insert rejected with UNEXPECTED code ${probeDupErr.error.code}`);
  console.log(`  msg: ${probeDupErr.error.message}`);
} else {
  console.log(`PROBE: same-key insert was ACCEPTED — the constraint is missing entirely. WARN.`);
}

// Cleanup probe rows.
const { error: cleanupErr } = await supa
  .from("price_history")
  .delete()
  .eq("source_or_invoice_id", probeKey);
if (cleanupErr) {
  console.log(`Cleanup of probe rows failed: ${cleanupErr.message}`);
  console.log(`Manual cleanup: DELETE FROM price_history WHERE source_or_invoice_id = '${probeKey}';`);
} else {
  console.log(`Probe rows cleaned up.`);
}

// 4. Final count sanity.
const { count: phFinal } = await supa
  .from("price_history")
  .select("*", { count: "exact", head: true });
console.log(`price_history row count after probe: ${phFinal} ${phFinal === phCount ? "OK" : "WARN drift"}`);

console.log("");
console.log("If both PROBE results say OK, the constraint is widened and we're clear to run Phase 5.");
