// READ-ONLY probe for PR 8.1 (ai_line_items.vendor_id).
// Mirrors the exact resolution algorithm from scripts/backfill-inventory.mjs
// (Phase 2, lines 258-285): exact name match (case-insensitive) -> vendor_aliases
// alias_normalized -> unresolved. Reports coverage + unresolved names.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function normalizeAlias(s) {
  return String(s || "").toLowerCase().replace(/[^a-zA-Z0-9 ]/g, "");
}

// ── Load vendor resolution data from PG (Module 5 LIVE) ──
const { data: vendors } = await supa
  .from("vendors").select("id, name").is("deleted_at", null);
const { data: vendorAliases } = await supa
  .from("vendor_aliases").select("vendor_id, alias_text, alias_normalized");
const nameToVendorId = new Map();
for (const v of vendors || []) nameToVendorId.set((v.name || "").toLowerCase(), v.id);
const aliasNormToVendorId = new Map();
for (const a of vendorAliases || []) aliasNormToVendorId.set((a.alias_normalized || "").toLowerCase(), a.vendor_id);
console.log(`PG vendors (active, deleted_at IS NULL): ${vendors?.length || 0}`);
console.log(`PG vendor_aliases: ${vendorAliases?.length || 0}`);
console.log("");

function resolveVendor(rawName) {
  const trimmed = String(rawName || "").trim();
  if (!trimmed) return { vendorId: null, via: "empty" };
  const lower = trimmed.toLowerCase();
  if (nameToVendorId.has(lower)) return { vendorId: nameToVendorId.get(lower), via: "exact" };
  const norm = normalizeAlias(trimmed);
  if (aliasNormToVendorId.has(norm)) return { vendorId: aliasNormToVendorId.get(norm), via: "alias" };
  if (lower === "samuels seafoos") {
    const samId = nameToVendorId.get("samuels seafood") || nameToVendorId.get("samuels seafood co");
    return samId ? { vendorId: samId, via: "fixed (typo)" } : { vendorId: null, via: "unresolved (samuels seafoos)" };
  }
  if (lower === "test vendor") return { vendorId: null, via: "skipped (dev)" };
  return { vendorId: null, via: "unresolved" };
}

// ── Pull all ai_line_items rows (paginated) and tally distinct vendor_name ──
const tally = new Map();          // raw vendor_name -> count
const tallyByHistorical = new Map(); // raw vendor_name -> { live: N, hist: N }
let total = 0;
for (let from = 0; ; from += 1000) {
  const { data, error } = await supa
    .from("ai_line_items")
    .select("vendor_name, is_historical")
    .range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  if (!data?.length) break;
  for (const r of data) {
    total++;
    const v = String(r.vendor_name || "").trim();
    tally.set(v, (tally.get(v) || 0) + 1);
    const split = tallyByHistorical.get(v) || { live: 0, hist: 0 };
    if (r.is_historical) split.hist++; else split.live++;
    tallyByHistorical.set(v, split);
  }
  if (data.length < 1000) break;
}
console.log(`ai_line_items total rows: ${total}`);
console.log(`Distinct vendor_name values: ${tally.size}`);
console.log("");

// ── Run resolution + bucket ──
const buckets = { exact: 0, alias: 0, fixed: 0, skipped: 0, empty: 0, unresolved: 0 };
const bucketRowCounts = { exact: 0, alias: 0, fixed: 0, skipped: 0, empty: 0, unresolved: 0 };
const resolutionByName = new Map();
for (const [name, count] of tally) {
  const res = resolveVendor(name);
  resolutionByName.set(name, { ...res, count });
  if (res.via.startsWith("exact"))         { buckets.exact++;       bucketRowCounts.exact += count; }
  else if (res.via.startsWith("alias"))    { buckets.alias++;       bucketRowCounts.alias += count; }
  else if (res.via.startsWith("fixed"))    { buckets.fixed++;       bucketRowCounts.fixed += count; }
  else if (res.via.startsWith("skipped"))  { buckets.skipped++;     bucketRowCounts.skipped += count; }
  else if (res.via === "empty")            { buckets.empty++;       bucketRowCounts.empty += count; }
  else                                     { buckets.unresolved++;  bucketRowCounts.unresolved += count; }
}

console.log("RESOLUTION COVERAGE (distinct names + row counts)");
console.log("─".repeat(70));
function row(label, distinct, rows) {
  const pctDistinct = (100 * distinct / tally.size).toFixed(1);
  const pctRows    = (100 * rows / total).toFixed(1);
  console.log(`  ${label.padEnd(34)} ${String(distinct).padStart(4)} distinct (${pctDistinct}%)  ${String(rows).padStart(6)} rows (${pctRows}%)`);
}
row("exact match (vendors.name)",         buckets.exact,      bucketRowCounts.exact);
row("via vendor_aliases",                 buckets.alias,      bucketRowCounts.alias);
row("fixed (Samuels Seafoos typo)",       buckets.fixed,      bucketRowCounts.fixed);
row("skipped (Test Vendor / dev)",        buckets.skipped,    bucketRowCounts.skipped);
row("empty vendor_name",                  buckets.empty,      bucketRowCounts.empty);
row("UNRESOLVED",                          buckets.unresolved, bucketRowCounts.unresolved);
const resolvedDistinct = buckets.exact + buckets.alias + buckets.fixed;
const resolvedRows    = bucketRowCounts.exact + bucketRowCounts.alias + bucketRowCounts.fixed;
console.log("  " + "─".repeat(66));
console.log(`  ${"resolvable to vendor_id".padEnd(34)} ${String(resolvedDistinct).padStart(4)} distinct           ${String(resolvedRows).padStart(6)} rows`);
console.log(`  ${"NOT resolvable (any reason)".padEnd(34)} ${String(buckets.empty + buckets.unresolved + buckets.skipped).padStart(4)} distinct           ${String(bucketRowCounts.empty + bucketRowCounts.unresolved + bucketRowCounts.skipped).padStart(6)} rows`);

console.log("");
console.log("UNRESOLVED + EMPTY + SKIPPED — exact names with row counts");
console.log("─".repeat(70));
const flagged = [...resolutionByName.entries()]
  .filter(([, r]) => r.via === "unresolved" || r.via === "empty" || r.via.startsWith("unresolved (") || r.via.startsWith("skipped"))
  .sort((a, b) => b[1].count - a[1].count);
if (flagged.length === 0) {
  console.log("  (none)");
} else {
  for (const [name, r] of flagged) {
    const split = tallyByHistorical.get(name) || { live: 0, hist: 0 };
    const displayName = name === "" ? "(empty/NULL)" : `"${name}"`;
    console.log(`  ${String(r.count).padStart(5)} rows  (live=${split.live}, hist=${split.hist})  via=${r.via.padEnd(28)}  ${displayName}`);
  }
}

// ── Cross-check: of the rows that DO resolve, what's the historical split? ──
console.log("");
console.log("LIVE vs HISTORICAL split (for context on backfill scope)");
console.log("─".repeat(70));
const { count: histRows } = await supa.from("ai_line_items").select("*", { count: "exact", head: true }).eq("is_historical", true);
const { count: liveRows } = await supa.from("ai_line_items").select("*", { count: "exact", head: true }).eq("is_historical", false);
console.log(`  is_historical=TRUE  : ${histRows}  (Module 6 backfilled depth)`);
console.log(`  is_historical=FALSE : ${liveRows}  (post-cutover live writes)`);
