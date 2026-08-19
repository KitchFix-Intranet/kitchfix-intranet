// scripts/_probe_work_location_ids.mjs
//
// Read work_location_id + work_location_label pairs from
// rippling_raw_spend_lines_latest so the migration can seed the map
// with EXPLICIT ids (Kevin's rule: no runtime parse of the parenthesised
// suffix - the ids might rotate but the labels are stable).
//
// Emits one row per (id, label) pair with count so migration author can
// confirm 1:1.

import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function fetchAll() {
  const rows = [];
  let from = 0;
  const CHUNK = 1000;
  while (true) {
    const { data, error } = await supa.from("rippling_raw_spend_lines_latest")
      .select("work_location_id, work_location_label")
      .range(from, from + CHUNK - 1);
    if (error) throw error;
    if (!data.length) break;
    rows.push(...data);
    if (data.length < CHUNK) break;
    from += CHUNK;
  }
  return rows;
}

const rows = await fetchAll();
console.log(`fetched ${rows.length} rows`);

const byPair = new Map();
for (const r of rows) {
  const key = `${r.work_location_id || "(null)"}\t${r.work_location_label || "(null)"}`;
  byPair.set(key, (byPair.get(key) || 0) + 1);
}
const sorted = [...byPair.entries()].sort((a, b) => b[1] - a[1]);

console.log("");
console.log("work_location_id                                          | label                                                       | count");
console.log("----------------------------------------------------------+-------------------------------------------------------------+-------");
for (const [key, count] of sorted) {
  const [id, label] = key.split("\t");
  console.log(`  ${id.padEnd(56)}| ${label.padEnd(60)}| ${count}`);
}

// Also confirm every label has exactly one id.
const labelToIds = new Map();
for (const [key] of sorted) {
  const [id, label] = key.split("\t");
  if (!labelToIds.has(label)) labelToIds.set(label, new Set());
  labelToIds.get(label).add(id);
}
console.log("");
console.log("labels with more than one id (should be empty):");
for (const [label, ids] of labelToIds) {
  if (ids.size > 1) console.log(`  ${label} -> ${[...ids].join(", ")}`);
}
