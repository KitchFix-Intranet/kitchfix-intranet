#!/usr/bin/env node
/*
 * R11 item 4 probe: does the drill table's vendor column dash because
 * the data is absent, or because it's not being read?
 *
 * Reports for FYTD (fy_start = 2025-12-29):
 *   - purchasing_actuals billcom rows with vendor_or_merchant populated
 *     (vendor_or_merchant IS the billcom vendor id for source=billcom)
 *   - how many of those ids resolve in billcom_ref_vendors (name != null)
 *   - purchasing_actuals rippling_spend rows and how many carry a
 *     non-null vendor_or_merchant (which for rippling is the raw
 *     merchant string, no resolve needed)
 *
 * Read-only. Never prints keys or PII.
 */
import { createClient } from "@supabase/supabase-js";
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log("env SUPABASE_URL:              ", SB_URL ? "PRESENT" : "ABSENT");
console.log("env SUPABASE_SERVICE_ROLE_KEY: ", SB_KEY ? "PRESENT" : "ABSENT");
if (!SB_URL || !SB_KEY) { console.error("BLOCKED"); process.exit(2); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const FY_START = "2025-12-29";

async function pageAll(builder) {
  const rows = [];
  const PS = 1000;
  for (let from = 0; ; from += PS) {
    const { data, error } = await builder().range(from, from + PS - 1);
    if (error) { console.error(error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PS) break;
  }
  return rows;
}

async function main() {
  const bill = await pageAll(() =>
    supa.from("purchasing_actuals")
      .select("id, vendor_or_merchant")
      .eq("source", "billcom")
      .eq("excluded", false)
      .gte("txn_date", FY_START)
  );
  const billWithId = bill.filter(r => r.vendor_or_merchant);
  const billNoId   = bill.filter(r => !r.vendor_or_merchant);
  console.log(`\npurchasing_actuals billcom FYTD rows:                 ${bill.length}`);
  console.log(`  rows with vendor_or_merchant (billcom vendor id):   ${billWithId.length}`);
  console.log(`  rows with vendor_or_merchant NULL:                  ${billNoId.length}`);

  const ids = [...new Set(billWithId.map(r => r.vendor_or_merchant))];
  console.log(`  distinct billcom vendor ids:                        ${ids.length}`);

  const nameMap = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await supa.from("billcom_ref_vendors")
      .select("id, name")
      .in("id", chunk);
    if (error) { console.error(error.message); process.exit(1); }
    for (const v of data || []) nameMap.set(v.id, v.name);
  }
  console.log(`  ids resolvable to a name in billcom_ref_vendors:    ${nameMap.size}`);
  const namedCount    = billWithId.filter(r => nameMap.has(r.vendor_or_merchant) && nameMap.get(r.vendor_or_merchant)).length;
  const unnamedCount  = billWithId.filter(r => !nameMap.has(r.vendor_or_merchant) || !nameMap.get(r.vendor_or_merchant)).length;
  console.log(`  billcom rows that would render a NAME (if fetched): ${namedCount}  (${((namedCount / bill.length) * 100).toFixed(2)}%)`);
  console.log(`  billcom rows genuinely unresolved:                  ${unnamedCount}  (${((unnamedCount / bill.length) * 100).toFixed(2)}%)`);

  const rip = await pageAll(() =>
    supa.from("purchasing_actuals")
      .select("id, vendor_or_merchant")
      .eq("source", "rippling_spend")
      .eq("excluded", false)
      .gte("txn_date", FY_START)
  );
  const ripWithMerchant = rip.filter(r => r.vendor_or_merchant && r.vendor_or_merchant.trim() !== "");
  const ripNoMerchant   = rip.filter(r => !r.vendor_or_merchant || r.vendor_or_merchant.trim() === "");
  console.log(`\npurchasing_actuals rippling_spend FYTD rows:          ${rip.length}`);
  console.log(`  rows with vendor_or_merchant (raw merchant string): ${ripWithMerchant.length}  (${((ripWithMerchant.length / rip.length) * 100).toFixed(2)}%)`);
  console.log(`  rows with vendor_or_merchant NULL/blank:            ${ripNoMerchant.length}`);
}
main().catch(e => { console.error("FAIL:", e); process.exit(1); });
