// scripts/probes/_probe_rippling_custom_objects.mjs
//
// Diagnose the Oct 2026 nightly-sync 404s on the two labor custom
// objects. READ-ONLY. Slugs + status codes + record counts only - no
// record payloads print. Re-runnable; prints a self-contained verdict.
//
// Usage:
//   node --env-file=.env.local scripts/probes/_probe_rippling_custom_objects.mjs
//
// Four sections:
//   1. Enumerate tenant's custom objects (GET /custom-objects, paginated).
//   2. Probe each known slug (broken + sibling-sanity) with request-shape
//      variants to rule out querystring / limit-param issues.
//   3. Try first-class REST endpoint candidates for the broken objects
//      (in case Rippling promoted them off the /custom-objects surface).
//   4. Check Supabase raw-latest views for staleness - the last time
//      each walk actually landed data.

import { BASE, API_VERSION, firstPageUrl, fetchPage, extractRows } from "../../src/lib/rippling.js";
import { createClient } from "@supabase/supabase-js";

const KEY = process.env.RIPPLING_API_KEY;
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error("ABSENT: RIPPLING_API_KEY"); process.exit(1); }
if (!SB_URL || !SB_KEY) { console.error("ABSENT: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

console.log(`rippling custom-object probe · base=${BASE} api_version=${API_VERSION}`);
console.log("");

async function tryGet(label, url, opts = {}) {
  const r = await fetchPage(url, KEY, { maxAttempts: opts.maxAttempts ?? 2 });
  const detail = r.body?.detail || r.body?.message || r.error || "";
  const rows = r.ok ? extractRows(r.body) : [];
  const firstKeys = rows[0] ? Object.keys(rows[0]).sort() : null;
  const flag = r.ok ? "OK  " : "FAIL";
  console.log(`  ${flag} ${label.padEnd(50)} -> ${r.status}  rows=${rows.length}  ${detail}`);
  if (opts.printKeys && firstKeys) {
    console.log(`         first-row keys: ${firstKeys.join(", ")}`);
  }
  return { status: r.status, ok: r.ok, body: r.body, rows, firstKeys };
}

// ─── 1. Enumerate /custom-objects (paginated) ─────────────────────────
console.log("─── 1. Enumerate /custom-objects (paginated) ─────────────────");
const customObjs = [];
let listUrl = firstPageUrl("custom-objects", 100);
let pages = 0;
while (listUrl && pages < 20) {
  const r = await fetchPage(listUrl, KEY, { maxAttempts: 2 });
  if (!r.ok) { console.log(`  page ${pages + 1} FAIL -> ${r.status}  ${r.body?.detail || r.error}`); break; }
  const rows = extractRows(r.body);
  customObjs.push(...rows);
  pages++;
  listUrl = r.body?.next_link || null;
  console.log(`  page ${pages}: rows=${rows.length}  next_link=${listUrl ? "yes" : "no"}`);
}
console.log(`  total custom objects on tenant: ${customObjs.length}`);
for (const obj of customObjs) {
  const slug = obj.slug || obj.api_name || obj.name || obj.id;
  const display = obj.display_name || obj.label || obj.title || "";
  console.log(`    - ${slug}${display ? "  (" + display + ")" : ""}`);
}
console.log("");

// ─── 2. Per-slug /records probe + sibling sanity ──────────────────────
console.log("─── 2. Per-slug .../records probe ────────────────────────────");
const KNOWN = [
  { slug: "time_entry_computed_pay_segment", role: "broken-in-sync", used_by: "pay_segments walk" },
  { slug: "time_entry_zo",                   role: "broken-in-sync", used_by: "time_entry_zo walk" },
  { slug: "spend_transaction_line_item_zo",  role: "sibling-sanity", used_by: "purchasing sync (walks fine)" },
];
const results = {};
for (const k of KNOWN) {
  console.log(`  slug=${k.slug}  (${k.role}, ${k.used_by})`);
  const res = await tryGet("default limit=1", firstPageUrl(`custom-objects/${k.slug}/records`, 1));
  results[k.slug] = res;
  // One request-shape variant per slug so we see we didn't miss a trivial fix
  await tryGet("no querystring", `${BASE}/custom-objects/${k.slug}/records`);
  await tryGet("metadata (no /records)", `${BASE}/custom-objects/${k.slug}`);
}
console.log("");

// Fuzzy-match: does any enumerated slug map to our broken objects?
console.log("─── 2b. Fuzzy match broken-slugs against enumerated catalog ───");
for (const needle of ["time_entry", "pay_segment", "zo", "spend_transaction"]) {
  const hits = customObjs
    .map((o) => o.slug || o.api_name || o.name || o.id)
    .filter(Boolean)
    .filter((s) => s.toLowerCase().includes(needle));
  console.log(`  needle "${needle}": ${hits.length} match(es)${hits.length ? "  -> " + hits.join(", ") : ""}`);
}
console.log("");

// ─── 3. First-class endpoint candidates ───────────────────────────────
console.log("─── 3. First-class REST endpoint candidates ──────────────────");
// Sanity: /time-entries works - keep it in the list to confirm auth +
// base URL + API version are fine when a non-/custom-objects path is hit.
await tryGet("GET /time-entries (sanity)",            firstPageUrl("time-entries", 1), { printKeys: true });
// pay_segments candidates
await tryGet("GET /pay-segments",                     firstPageUrl("pay-segments", 1));
await tryGet("GET /time-entry-pay-segments",          firstPageUrl("time-entry-pay-segments", 1));
await tryGet("GET /time-entries/pay-segments",        firstPageUrl("time-entries/pay-segments", 1));
await tryGet("GET /time-entries/computed-pay-segments", firstPageUrl("time-entries/computed-pay-segments", 1));
await tryGet("GET /computed-pay-segments",            firstPageUrl("computed-pay-segments", 1));
// time_entry_zo candidates
await tryGet("GET /time-entries-zo",                  firstPageUrl("time-entries-zo", 1));
await tryGet("GET /time-entry-zos",                   firstPageUrl("time-entry-zos", 1));
// spend_transaction_line_item_zo candidates
await tryGet("GET /spend/transactions",               firstPageUrl("spend/transactions", 1));
await tryGet("GET /spend-transactions",               firstPageUrl("spend-transactions", 1));
await tryGet("GET /spend/transaction-line-items",     firstPageUrl("spend/transaction-line-items", 1));
console.log("");

// ─── 4. Supabase raw-latest staleness ─────────────────────────────────
console.log("─── 4. Newest fetched_at per raw-latest view ────────────────");
async function newest(table) {
  const { data, error } = await supa
    .from(table)
    .select("fetched_at")
    .order("fetched_at", { ascending: false })
    .limit(1);
  if (error) return `ERR  ${error.message}`;
  if (!data || data.length === 0) return "no rows";
  return String(data[0].fetched_at);
}
const views = [
  "rippling_raw_time_entries_latest",
  "rippling_raw_pay_segments_latest",
  "rippling_raw_time_entry_zo_latest",
  "rippling_raw_workers_latest",
  "rippling_raw_users_latest",
  "rippling_raw_compensations_latest",
];
for (const v of views) {
  const t = await newest(v);
  console.log(`  ${v.padEnd(42)} newest fetched_at: ${t}`);
}
console.log("");

// ─── Verdict ──────────────────────────────────────────────────────────
console.log("─── Verdict ──────────────────────────────────────────────────");
const broken = ["time_entry_computed_pay_segment", "time_entry_zo"];
for (const slug of broken) {
  const r = results[slug];
  if (r?.status === 404) console.log(`  ${slug.padEnd(40)} 404 CONFIRMED - no first-class fallback found`);
  else if (r?.ok) console.log(`  ${slug.padEnd(40)} 200 - slug now works (transient failure?)`);
  else console.log(`  ${slug.padEnd(40)} status=${r?.status} - re-inspect`);
}
const sibling = results["spend_transaction_line_item_zo"];
if (sibling?.status === 404) {
  console.log(`  spend_transaction_line_item_zo         404 - sanity slug ALSO 404s. purchasing sync is at risk too.`);
} else if (sibling?.ok) {
  console.log(`  spend_transaction_line_item_zo         200 - sanity OK; the two labor slugs are the only broken ones.`);
}

const enumeratedHasBroken = customObjs.some((o) => {
  const s = (o.slug || o.api_name || o.name || o.id || "").toLowerCase();
  return s.includes("time_entry") || s.includes("pay_segment");
});
if (!enumeratedHasBroken && customObjs.length > 0) {
  console.log(`  /custom-objects enumeration (${customObjs.length} rows) contains no time_entry / pay_segment matches.`);
  console.log(`  likely cause: these objects were removed from the /custom-objects surface (or require a new scoped-slug address not visible to our enumeration).`);
  console.log(`  recommended next steps for owner + Chat-Claude:`);
  console.log(`    - open a Rippling API support ticket citing the two 404 slugs + today's enumeration result`);
  console.log(`    - check whether /time-entries response now carries the pay-segment data inline (first-row keys above include 'segments', 'piece_rate_premiums', 'premiums', 'time_entry_summary')`);
  console.log(`    - do NOT blind-rename the slug in rippling_sync.mjs; the fix path depends on which option Rippling confirms`);
}

console.log("");
console.log("done.");
