// One-shot audit 2026-08-28. Kevin's side-observation while looking at
// hours_double_time: no earning type currently routes to
// hours_premium_other, and the 5-row earning_type_map covers everything
// seen this fiscal year. Either the map is complete or sick / vacation
// / holiday-1.5 pay never reaches an account row.
//
// Question: is any merged_earning_type_name observed in
// rippling_raw_pay_segments_latest but NOT present in earning_type_map?
//
// Usage: node --env-file=.env.local scripts/probes/_probe_earning_types_unmapped_audit.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url) { console.error("SUPABASE_URL ABSENT"); process.exit(1); }
if (!key) { console.error("SUPABASE_SERVICE_ROLE_KEY ABSENT"); process.exit(1); }

const supa = createClient(url, key, { auth: { persistSession: false } });

// 1. Load earning_type_map.
const mapQ = await supa.from("earning_type_map").select("merged_earning_type_name");
if (mapQ.error) { console.error("earning_type_map:", mapQ.error.message); process.exit(1); }
const mapped = new Set(mapQ.data.map(r => r.merged_earning_type_name));
console.log(`earning_type_map: ${mapped.size} distinct names\n`);
for (const n of [...mapped].sort()) console.log(`  ${n}`);

// 2. Load rippling_raw_pay_segments_latest via keyset pagination (89k+
//    rows; single .select() would silently truncate at 1000).
console.log("\nscanning rippling_raw_pay_segments_latest...");
const observed = new Map();  // name -> occurrence_count
let lastId = null;
let scanned = 0;
const PAGE = 1000;
while (true) {
  let q = supa.from("rippling_raw_pay_segments_latest")
    .select("rippling_id, payload")
    .order("rippling_id", { ascending: true })
    .limit(PAGE);
  if (lastId) q = q.gt("rippling_id", lastId);
  const { data, error } = await q;
  if (error) { console.error(error.message); process.exit(1); }
  if (!data || data.length === 0) break;
  for (const r of data) {
    // The merged name is set by the pay-segment writer. Rippling's raw
    // field varies; the derive pipeline uses payload.earning_type?.name
    // or similar. Grab both plausible paths and merge.
    const candidates = [
      r.payload?.merged_earning_type_name,
      r.payload?.earning_type?.name,
      r.payload?.earning_type_name,
      r.payload?.earning_type,
    ].filter(v => v != null && typeof v === "string");
    for (const name of candidates) {
      observed.set(name, (observed.get(name) || 0) + 1);
    }
  }
  scanned += data.length;
  lastId = data[data.length - 1].rippling_id;
  if (data.length < PAGE) break;
}
console.log(`  scanned ${scanned} rows`);
console.log(`  ${observed.size} distinct earning_type names observed\n`);

// 3. Split into mapped vs unmapped.
const unmapped = [...observed.entries()].filter(([name]) => !mapped.has(name));
const inMap = [...observed.entries()].filter(([name]) => mapped.has(name));

console.log(`--- mapped (${inMap.length}) ---`);
for (const [name, count] of inMap.sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(6)}  ${name}`);
}

console.log(`\n--- UNMAPPED (${unmapped.length}) ---`);
if (unmapped.length === 0) {
  console.log("  (none - earning_type_map covers every observed earning type)");
} else {
  for (const [name, count] of unmapped.sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(6)}  ${name}`);
  }
}

// 4. Also check the earning_type_unmapped table for anything the derive
//    job has already flagged as unmapped in prior runs.
console.log("\n--- earning_type_unmapped table (derive's own flagging) ---");
const flagQ = await supa.from("earning_type_unmapped")
  .select("merged_earning_type_name, occurrence_count, total_hours, total_amount, first_seen_at, last_seen_at, resolved_at")
  .order("occurrence_count", { ascending: false });
if (flagQ.error) { console.error(flagQ.error.message); process.exit(1); }
if (!flagQ.data.length) {
  console.log("  (empty - derive has never seen an unmapped earning type)");
} else {
  for (const r of flagQ.data) {
    const resolved = r.resolved_at ? " [RESOLVED]" : "";
    console.log(`  ${String(r.occurrence_count).padStart(6)}  ${r.total_hours} hrs  $${r.total_amount}  ${r.merged_earning_type_name}${resolved}`);
  }
}
