// scripts/_probe_kpi_8a2_verify.mjs
//
// KPI PR 8a-2 acceptance gate. Read-only. Runs against Postgres only.
//
// Four gates:
//   1. Row counts landed match what the sync walk reported. Both new
//      tables (rippling_raw_workers, rippling_raw_time_entry_zo) plus
//      their _latest views return the expected shape.
//   2. Second sync run: unchanged high, inserted near zero (dedup
//      proof). This gate ASSERTS - it does not run the sync; it
//      queries how many rows were inserted in the last hour and asks
//      you to compare against the walk's reported inserted count.
//   3. Two-hop join chain resolves end-to-end across the FULL set:
//        pay_segment.time_entry.id -> time_entry_zo.id
//        time_entry_zo.external_id -> time_entries.rippling_id
//      Reports match rate and status agreement, not a sample.
//   4. Coverage per REST time_entry status: how many entries have a
//      matching zo record (which is the entry-count/dollars-per-status
//      driver for labor_actuals in PR 8b).
//
// CLI:
//   node --env-file=.env.local scripts/_probe_kpi_8a2_verify.mjs

import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL) { console.error("SUPABASE_URL not set"); process.exit(1); }
if (!SB_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY not set"); process.exit(1); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

async function fetchAllPayloads(view) {
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supa.from(view).select("rippling_id, content_hash, payload, fetched_at").range(from, from + 999);
    if (error) throw new Error(`${view}: ${error.message}`);
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

console.log("KPI 8a-2 acceptance probe");
console.log("started at", new Date().toISOString());
console.log("");

// ─── Gate 1: row counts + view shape ────────────────────────────────
console.log("## Gate 1 - row counts + shape");
console.log("");
const shapes = {
  rippling_raw_workers:               "rippling_raw_workers_latest",
  rippling_raw_time_entry_zo:         "rippling_raw_time_entry_zo_latest",
  rippling_raw_time_entries:          "rippling_raw_time_entries_latest",
  rippling_raw_pay_segments:          "rippling_raw_pay_segments_latest",
};
for (const [table, view] of Object.entries(shapes)) {
  const t = await supa.from(table).select("id", { count: "exact", head: true });
  const v = await supa.from(view).select("rippling_id", { count: "exact", head: true });
  if (t.error) { console.log(`  ${table}: ERROR ${t.error.message}`); continue; }
  if (v.error) { console.log(`  ${view}: ERROR ${v.error.message}`); continue; }
  console.log(`  ${table.padEnd(35)}  table_rows=${String(t.count).padStart(6)}  latest_view_distinct=${String(v.count).padStart(6)}`);
}
console.log("");

// ─── Gate 2: dedup proof ────────────────────────────────────────────
console.log("## Gate 2 - dedup proof (rows inserted in the last hour vs cumulative)");
console.log("");
console.log("Method: for each raw table, count rows with fetched_at > NOW() - 1 hour. This is what the most recent sync run wrote. Compare against total row count above and against the walk's reported summary.");
console.log("");
const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
for (const [table] of Object.entries(shapes)) {
  const r = await supa.from(table).select("id", { count: "exact", head: true }).gt("fetched_at", oneHourAgo);
  if (r.error) { console.log(`  ${table}: ERROR ${r.error.message}`); continue; }
  console.log(`  ${table.padEnd(35)}  inserted in last hour=${String(r.count).padStart(6)}`);
}
console.log("");
console.log("Expected pattern for a healthy nightly rerun:");
console.log("  - Second run inserted values should be a small fraction of the first backfill.");
console.log("  - Time entries typically 1-3% inserted on nightly (real activity + Rippling's timer-tick fields we may not have caught).");
console.log("  - Pay segments typically <1% on nightly.");
console.log("  - Workers typically 0 on nightly (only ticks on real edits).");
console.log("  - time_entry_zo typically similar to time_entries (they mirror each other).");
console.log("");

// ─── Gate 3: two-hop join chain end-to-end ──────────────────────────
console.log("## Gate 3 - two-hop join chain, full-set coverage");
console.log("");
console.log("Method: for every pay_segment, follow pay_segment.time_entry.id -> zo.id -> zo.external_id -> REST time_entries.rippling_id. Report match rate at each hop and status agreement.");
console.log("");
const segsLatest = await fetchAllPayloads("rippling_raw_pay_segments_latest");
const zoLatest = await fetchAllPayloads("rippling_raw_time_entry_zo_latest");
const teLatest = await fetchAllPayloads("rippling_raw_time_entries_latest");

const zoById = new Map();
for (const r of zoLatest) zoById.set(r.rippling_id, r.payload);
const teByRid = new Map();
for (const r of teLatest) teByRid.set(r.rippling_id, r.payload);

let hop1Match = 0, hop1Miss = 0;
let hop2Match = 0, hop2Miss = 0;
let statusAgree = 0, statusDisagree = 0;
const hop1Misses = [];
const hop2Misses = [];
const disagreements = [];

for (const seg of segsLatest) {
  const zoId = seg.payload?.time_entry?.id;
  if (!zoId) { hop1Miss++; continue; }
  const zo = zoById.get(zoId);
  if (!zo) { hop1Miss++; if (hop1Misses.length < 5) hop1Misses.push({ seg_id: seg.rippling_id, zo_id_looked_up: zoId }); continue; }
  hop1Match++;
  const restRid = zo.external_id;
  if (!restRid) { hop2Miss++; continue; }
  const rest = teByRid.get(restRid);
  if (!rest) { hop2Miss++; if (hop2Misses.length < 5) hop2Misses.push({ zo_id: zoId, external_id_looked_up: restRid }); continue; }
  hop2Match++;
  if (zo.status === rest.status) statusAgree++;
  else { statusDisagree++; if (disagreements.length < 5) disagreements.push({ zo_id: zoId, zo_status: zo.status, rest_status: rest.status }); }
}

console.log(`  pay_segments total: ${segsLatest.length}`);
console.log(`  hop 1 (pay_segment.time_entry.id -> zo.id):     match=${hop1Match} miss=${hop1Miss} (${((hop1Match / segsLatest.length) * 100).toFixed(1)}%)`);
console.log(`  hop 2 (zo.external_id -> REST rippling_id):     match=${hop2Match} miss=${hop2Miss} (${((hop2Match / segsLatest.length) * 100).toFixed(1)}%)`);
console.log(`  status agreement (zo.status == REST.status):    agree=${statusAgree} disagree=${statusDisagree}`);
if (hop1Misses.length) {
  console.log("  hop 1 misses (first 5):");
  for (const m of hop1Misses) console.log("    seg=" + m.seg_id.slice(0, 20) + " looked up zo=" + m.zo_id_looked_up.slice(0, 20));
}
if (hop2Misses.length) {
  console.log("  hop 2 misses (first 5):");
  for (const m of hop2Misses) console.log("    zo=" + m.zo_id.slice(0, 20) + " looked up external=" + m.external_id_looked_up.slice(0, 20));
}
if (disagreements.length) {
  console.log("  status disagreements (first 5):");
  for (const d of disagreements) console.log("    zo=" + d.zo_id.slice(0, 20) + " zo_status=" + d.zo_status + " REST_status=" + d.rest_status);
}
console.log("");

// ─── Gate 4: coverage per REST status ───────────────────────────────
console.log("## Gate 4 - REST time_entry coverage by zo");
console.log("");
console.log("Method: for each REST time_entry status, count how many have a matching zo record via reverse lookup (REST.rippling_id -> zo.external_id).");
console.log("");
const zoByExternal = new Map();
for (const z of zoLatest) if (z.payload?.external_id) zoByExternal.set(z.payload.external_id, z);

const byStatus = {};
for (const te of teLatest) {
  const st = te.payload?.status || "(null)";
  if (!byStatus[st]) byStatus[st] = { total: 0, with_zo: 0 };
  byStatus[st].total++;
  if (zoByExternal.has(te.rippling_id)) byStatus[st].with_zo++;
}
console.log("| status | total | with zo | coverage |");
console.log("|---|---:|---:|---:|");
let statusSumTotal = 0, statusSumWithZo = 0;
for (const [st, r] of Object.entries(byStatus).sort((a, b) => b[1].total - a[1].total)) {
  statusSumTotal += r.total; statusSumWithZo += r.with_zo;
  console.log(`| ${st} | ${r.total} | ${r.with_zo} | ${((r.with_zo / r.total) * 100).toFixed(1)}% |`);
}
console.log(`| TOTAL | ${statusSumTotal} | ${statusSumWithZo} | ${((statusSumWithZo / statusSumTotal) * 100).toFixed(1)}% |`);
console.log("");

// ─── Gate 4b: workers coverage ──────────────────────────────────────
console.log("## Gate 4b - workers coverage");
console.log("");
const wkLatest = await fetchAllPayloads("rippling_raw_workers_latest");
console.log(`  workers total: ${wkLatest.length}`);
const statusW = {};
for (const w of wkLatest) statusW[w.payload?.status || "(null)"] = (statusW[w.payload?.status || "(null)"] || 0) + 1;
console.log("  by status:");
for (const [k, v] of Object.entries(statusW).sort((a, b) => b[1] - a[1])) console.log(`    ${k}: ${v}`);
// Verify departments coverage - do the 38 known departments all show at least one worker?
const deptSet = new Set(wkLatest.map(w => w.payload?.department_id).filter(Boolean));
console.log(`  distinct department_id values across ingested workers: ${deptSet.size}`);
console.log("");

console.log("Probe complete", new Date().toISOString());
console.log("");
console.log("Kevin's four acceptance conditions:");
console.log("  Gate 1  row counts land and match what the walk reported                 - inspect above");
console.log("  Gate 2  re-run shows unchanged high, inserted near zero                  - inspect Gate 2 counts");
console.log("  Gate 3  two-hop join resolves end-to-end with status agreement           - inspect Gate 3 percentages");
console.log("  Gate 4  coverage per status is reported (dollars-driver for labor_actuals) - inspect Gate 4 table");
