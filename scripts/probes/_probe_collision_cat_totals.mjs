// READ-ONLY. Reconcile cat_id 68ed4977b7aabd4234afda3a: total FYTD vs
// non-excluded, split by exclusion reason. Kevin ask 2026-08-21.
import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CAT = "68ed4977b7aabd4234afda3a";

// Step 1: find every rippling_id from raw where this category_id sits.
const rids = new Set();
let from = 0;
const PAGE = 1000;
for (;;) {
  const { data, error } = await supa
    .from("rippling_raw_spend_lines_latest")
    .select("rippling_id")
    .eq("category_id", CAT)
    .order("rippling_id")
    .range(from, from + PAGE - 1);
  if (error) throw new Error(error.message);
  if (!data || !data.length) break;
  for (const r of data) rids.add(r.rippling_id);
  if (data.length < PAGE) break;
  from += PAGE;
}
console.log(`raw rippling_ids for cat ${CAT}: ${rids.size}`);

// Step 2: for those rippling_ids, sum purchasing_actuals rows split by
// excluded + reason. Chunk .in() at 100 for UUIDs (Standing rule).
const ridArr = [...rids];
const CHUNK = 100;
const buckets = new Map();  // key: `${excluded}|${reason ?? "(null)"}` -> {rows, sum}

for (let i = 0; i < ridArr.length; i += CHUNK) {
  const chunk = ridArr.slice(i, i + CHUNK);
  from = 0;
  for (;;) {
    const { data, error } = await supa
      .from("purchasing_actuals")
      .select("amount, excluded, reason")
      .eq("source", "rippling_spend")
      .in("source_line_id", chunk.map(x => `rippling_spend:${x}`))
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    for (const r of data) {
      const key = `${r.excluded ? "excluded" : "included"}|${r.reason ?? "(null)"}`;
      const b = buckets.get(key) || { rows: 0, sum: 0 };
      b.rows++;
      b.sum += Number(r.amount || 0);
      buckets.set(key, b);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
}

let total = { rows: 0, sum: 0 };
let nonExcl = { rows: 0, sum: 0 };
console.log("\nsplit by (excluded, reason):");
for (const [key, b] of [...buckets.entries()].sort()) {
  console.log(`  ${key.padEnd(50)} rows=${String(b.rows).padStart(5)}  sum=$${b.sum.toFixed(2).padStart(14)}`);
  total.rows += b.rows;
  total.sum += b.sum;
  if (!key.startsWith("excluded")) { nonExcl.rows += b.rows; nonExcl.sum += b.sum; }
}
console.log(`\nTOTAL      rows=${total.rows}  sum=$${total.sum.toFixed(2)}`);
console.log(`NON-EXCL   rows=${nonExcl.rows}  sum=$${nonExcl.sum.toFixed(2)}`);
console.log(`EXCLUDED   rows=${total.rows - nonExcl.rows}  sum=$${(total.sum - nonExcl.sum).toFixed(2)}`);
