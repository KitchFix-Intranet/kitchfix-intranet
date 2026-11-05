#!/usr/bin/env node
// Confirm the exact spelling of the Object Type column as Rippling
// sends it, by inspecting the `_raw` map on stored rippling_report_txns
// rows. The CSV parser preserves the original header text verbatim
// in `_raw`, so this is the authoritative way to check the header
// without re-pulling a CSV from Gmail.
//
// Reports:
//   - the stored key whose text matches /object.type/i
//   - the sample of distinct values on recent rows
//
// READ-ONLY. One Supabase SELECT.
import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const q = await supa.from("rippling_report_txns_latest")
  .select("raw, purchased_at")
  .order("purchased_at", { ascending: false })
  .limit(50);
if (q.error) { console.error("read failed:", q.error.message); process.exit(1); }
const rows = q.data || [];
console.log(`rows sampled: ${rows.length}`);

// The _raw map in the stored jsonb carries every CSV column by its
// original header. `rippling_report_txns.raw` IS that `_raw` map
// stored verbatim from the parser.
const foundKeys = new Set();
const valueCounts = new Map();
for (const r of rows) {
  const payload = r.raw || {};
  for (const [k, v] of Object.entries(payload)) {
    if (/object.?type/i.test(k)) {
      foundKeys.add(k);
      const vs = String(v ?? "(null)").trim();
      valueCounts.set(vs, (valueCounts.get(vs) || 0) + 1);
    }
  }
}

console.log("");
console.log(`keys matching /object.?type/i in raw payloads:`);
for (const k of foundKeys) console.log(`  "${k}"  (${k.length} chars)`);
console.log("");
console.log("distinct values across sample:");
for (const [v, n] of [...valueCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n.toString().padStart(4)}  "${v}"`);
}
