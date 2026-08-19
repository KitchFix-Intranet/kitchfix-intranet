// scripts/_probe_rippling_spend_attribution_axes.mjs
//
// Bug 3 DELIVERABLE: distributions of (department.display_value) and
// (work_location.display_value) across all 10,789 raw spend line rows,
// with CORP-prefix bucket callout. Kevin rules on which field
// attributes a card charge to a site.
//
// Counts + labels only. No amounts (Rippling parsed amount col is
// currently null anyway pre-fix). No cardholder names.

import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Page through all rows (10,789 exceeds default 1k).
async function fetchAll() {
  const rows = [];
  let from = 0;
  const CHUNK = 1000;
  while (true) {
    const { data, error } = await supa.from("rippling_raw_spend_lines_latest")
      .select("rippling_id, department_id, department_label, work_location_id, work_location_label")
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
console.log(`fetched ${rows.length} rows from rippling_raw_spend_lines_latest`);

function isCorpDeptLabel(label) {
  if (!label) return false;
  return /^\s*5\d{3}(\.\d+)?(\s*-|\s|$)/.test(String(label));
}

// Department distribution
const deptCounts = new Map();
let corpCount = 0;
let deptNullCount = 0;
for (const r of rows) {
  const label = r.department_label || "(null)";
  deptCounts.set(label, (deptCounts.get(label) || 0) + 1);
  if (!r.department_label) deptNullCount++;
  else if (isCorpDeptLabel(r.department_label)) corpCount++;
}
const deptSorted = [...deptCounts.entries()].sort((a, b) => b[1] - a[1]);

// Work location distribution
const wlCounts = new Map();
let wlNullCount = 0;
for (const r of rows) {
  const label = r.work_location_label || "(null)";
  wlCounts.set(label, (wlCounts.get(label) || 0) + 1);
  if (!r.work_location_label) wlNullCount++;
}
const wlSorted = [...wlCounts.entries()].sort((a, b) => b[1] - a[1]);

console.log("\n=== department.display_value distribution (all 10,789 rows) ===");
console.log(`distinct labels: ${deptSorted.length}`);
console.log(`null count:      ${deptNullCount}`);
console.log(`CORP-prefix bucket (5xxx label prefix) total: ${corpCount} / ${rows.length}  (${(corpCount * 100 / rows.length).toFixed(1)}%)`);
console.log("");
console.log("label                                                       count");
console.log("---------------------------------------------------------- -------");
for (const [label, count] of deptSorted) {
  const isCorp = isCorpDeptLabel(label) ? "  [CORP]" : "";
  console.log(`  ${label.padEnd(58)} ${String(count).padStart(6)}${isCorp}`);
}

console.log("\n=== work_location.display_value distribution (all 10,789 rows) ===");
console.log(`distinct labels: ${wlSorted.length}`);
console.log(`null count:      ${wlNullCount}`);
console.log("");
console.log("label                                                       count");
console.log("---------------------------------------------------------- -------");
for (const [label, count] of wlSorted) {
  console.log(`  ${label.padEnd(58)} ${String(count).padStart(6)}`);
}
