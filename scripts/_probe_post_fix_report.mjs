// scripts/_probe_post_fix_report.mjs
//
// Post-fix verification. Runs the numbers Kevin needs:
//   - rippling_raw_spend_lines_latest non-null amount count (want 10,789)
//   - purchasing_actuals rippling_spend rows with non-zero amount + total $
//   - distinct category ids captured
//   - billcom P7 + P8 sums (compare vs pre-fix baseline for zero-delta assertion)
//   - CIN - AZ 5006.1 / 5016.6 acceptance count
//   - projection-repair check: any latest row still amount=null?
//   - dept + cat map states

import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// 1. Raw table projection state
const rawTotal = await supa.from("rippling_raw_spend_lines_latest").select("rippling_id", { count: "exact", head: true });
const rawNonNullAmt = await supa.from("rippling_raw_spend_lines_latest").select("rippling_id", { count: "exact", head: true }).not("amount", "is", null);
const rawNonNullCat = await supa.from("rippling_raw_spend_lines_latest").select("rippling_id", { count: "exact", head: true }).not("category_id", "is", null);
console.log("=== rippling_raw_spend_lines_latest ===");
console.log(`  total rows:              ${rawTotal.count}`);
console.log(`  non-null amount:         ${rawNonNullAmt.count}   (target 10789)`);
console.log(`  non-null category_id:    ${rawNonNullCat.count}   (target 10789)`);

// 2. purchasing_actuals fact rows
async function sumSource(source, extra = null) {
  const rows = [];
  let from = 0;
  const CHUNK = 1000;
  while (true) {
    let q = supa.from("purchasing_actuals").select("amount, account_key, gl_line_code, excluded, txn_date").eq("source", source).range(from, from + CHUNK - 1);
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data.length) break;
    rows.push(...data);
    if (data.length < CHUNK) break;
    from += CHUNK;
  }
  return rows;
}
const ripp = await sumSource("rippling_spend");
const rippNonZero = ripp.filter(r => Number(r.amount) !== 0);
const rippTotal = ripp.reduce((a, r) => a + Number(r.amount || 0), 0);
console.log("\n=== purchasing_actuals rippling_spend ===");
console.log(`  total rows:              ${ripp.length}`);
console.log(`  non-zero amount rows:    ${rippNonZero.length}`);
console.log(`  sum(amount) all rows:    $${rippTotal.toFixed(2)}   (private, not for PR body)`);
const rippExcluded = ripp.filter(r => r.excluded === true);
const rippAttributed = ripp.filter(r => r.account_key != null);
console.log(`  excluded rows:           ${rippExcluded.length}`);
console.log(`  attributed rows (account_key not null): ${rippAttributed.length}`);

// 3. distinct category ids captured (via spend_category_map)
const catMap = await supa.from("spend_category_map").select("category_id, gl_line_code, category_label");
console.log(`\n=== spend_category_map ===`);
console.log(`  total rows:              ${catMap.data?.length ?? 0}`);
console.log(`  labelled (gl_line_code):  ${(catMap.data || []).filter(r => r.gl_line_code).length}`);
console.log(`  with category_label:      ${(catMap.data || []).filter(r => r.category_label).length}   (expected 0 - shape has no display_value)`);

// 4. billcom P7 + P8 sum - assert delta zero vs pre-fix
const FY_START = new Date("2025-12-29T00:00:00Z").getTime();
function pB(p) {
  const s = new Date(FY_START + (p - 1) * 28 * 86400000).toISOString().slice(0, 10);
  const e = new Date(FY_START + (p * 28 - 1) * 86400000).toISOString().slice(0, 10);
  return { s, e };
}
console.log(`\n=== billcom period sums (must be unchanged from pre-fix) ===`);
for (const p of [7, 8]) {
  const { s, e } = pB(p);
  const { data } = await supa.from("purchasing_actuals").select("amount").eq("source", "billcom").gte("txn_date", s).lte("txn_date", e).limit(50000);
  const sum = (data || []).reduce((a, r) => a + Number(r.amount || 0), 0);
  console.log(`  billcom P${p} (${s}..${e}) rows=${data.length} sum=$${sum.toFixed(2)}`);
}
// Pre-fix baseline captured in _probe_rippling_spend_payload run:
//   billcom P7 (2026-06-15..2026-07-12) rows=687 sum=$485811.04
//   billcom P8 (2026-07-13..2026-08-09) rows=638 sum=$463183.05
console.log("  pre-fix P7 baseline:  687 rows, $485811.04");
console.log("  pre-fix P8 baseline:  638 rows, $463183.05");

// 5. CIN - AZ 5006.1 / 5016.6 acceptance
const cinAz = await supa.from("purchasing_actuals").select("id", { count: "exact", head: true })
  .eq("source", "rippling_spend").eq("account_key", "CIN - AZ").in("gl_line_code", ["5006.1", "5016.6"]);
console.log(`\n=== CIN - AZ 5006.1 / 5016.6 acceptance ===`);
console.log(`  matching rippling_spend rows: ${cinAz.count}   (expected 0 pre-labelling: no site/category labelled yet)`);

// 6. dept map state
const dept = await supa.from("spend_department_site_map").select("department_id, department_label, account_key, excluded");
console.log(`\n=== spend_department_site_map ===`);
console.log(`  total:      ${dept.data?.length ?? 0}`);
console.log(`  excluded:   ${(dept.data || []).filter(r => r.excluded).length}`);
console.log(`  labelled:   ${(dept.data || []).filter(r => r.account_key).length}`);
console.log(`  awaiting:   ${(dept.data || []).filter(r => !r.account_key && !r.excluded).length}`);
