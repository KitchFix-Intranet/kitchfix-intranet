#!/usr/bin/env node
// Reports the distinct Object Type values in post-floor
// rippling_report_txns_latest, and how many rows of each type the
// mapper would exclude under the new rule. Confirms that the hold
// exclusion does NOT change behavior for Mileage Request / Expense
// Request / etc. (acceptance #6).
import { createClient } from "@supabase/supabase-js";
import { buildDbCategoryMap, mapReportRowToActualsShape } from "../../src/lib/purchasing/reportToActualsMap.js";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const catMapResp = await supa.from("spend_category_map").select("category_label, gl_line_code");
if (catMapResp.error) { console.error(catMapResp.error.message); process.exit(1); }
const dbCategoryMap = buildDbCategoryMap(catMapResp.data || []);

let from = 0;
const rows = [];
for (;;) {
  const q = await supa.from("rippling_report_txns_latest")
    .select("parent_txn_id, purchased_at, approval_state, amount, currency, vendor_name, vendor, category, category_name, work_location, raw, has_receipt, memo, line_item_memo, gl_sync_status, employee, employee_id, department_name, posted_date")
    .gte("purchased_at", "2026-10-05")
    .range(from, from + 999);
  if (q.error) { console.error(q.error.message); process.exit(1); }
  rows.push(...(q.data || []));
  if ((q.data || []).length < 1000) break;
  from += 1000;
}

const byType = new Map();
for (const r of rows) {
  const ot = r.raw?.["Object Type"] ?? "(null)";
  const projected = { ...r, object_type: r.raw?.["Object Type"] ?? null };
  const shape = mapReportRowToActualsShape(projected, dbCategoryMap);
  const cur = byType.get(ot) || { total: 0, excluded_total: 0, excluded_hold: 0 };
  cur.total += 1;
  if (shape.excluded) cur.excluded_total += 1;
  if (shape._is_card_authorization) cur.excluded_hold += 1;
  byType.set(ot, cur);
}

console.log("Object Type distribution across post-floor rippling_report_txns_latest:");
console.log("");
console.log(`  ${"Object Type".padEnd(26)}  total  excluded(any)  excluded(hold-rule)`);
for (const [k, v] of [...byType.entries()].sort((a, b) => b[1].total - a[1].total)) {
  console.log(`  ${k.padEnd(26)}  ${v.total.toString().padStart(5)}  ${v.excluded_total.toString().padStart(13)}  ${v.excluded_hold.toString().padStart(19)}`);
}
console.log("");
console.log("Interpretation:");
console.log("  - excluded(hold-rule) must be nonzero ONLY for Card Authorization.");
console.log("  - Other types' excluded(any) count must match their pre-fix excluded");
console.log("    count (work location + GL only); hold rule adds zero to them.");
