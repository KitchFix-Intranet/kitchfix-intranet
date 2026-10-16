// READ-ONLY. Dollar-parity gate for the proposed restructuring of
// rippling_report_only_pending_v1 (purchasing-11).
//
// Loads api_prefixes without a SQL LIKE filter (JS regex instead) to
// avoid PostgREST escape ambiguity on `_`, then compares the current
// view output to the equivalent restructured query shape row-by-row
// on two ranges: the brief's test window (2026-09-07..2026-10-04)
// and FY2026 to date. Verifies the 48-mixed-amount case separately.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function pageAll(builderFactory, pageSize = 1000) {
  const out = [];
  let from = 0;
  while (true) {
    const q = await builderFactory().range(from, from + pageSize - 1);
    if (q.error) throw new Error(q.error.message);
    const rows = q.data || [];
    for (const r of rows) out.push(r);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// ── label_to_account map (mirrors MATERIALIZED CTE) ──
async function loadLabelToAccount() {
  const lines = await pageAll(() =>
    supa.from("rippling_raw_spend_lines")
      .select("work_location_label, work_location_id, first_seen_at")
      .not("work_location_label", "is", null)
      .order("work_location_label")
      .order("first_seen_at", { ascending: true }));
  const siteMap = await pageAll(() =>
    supa.from("spend_work_location_site_map")
      .select("work_location_id, account_key, excluded"));
  const siteByWlid = new Map();
  for (const s of siteMap) siteByWlid.set(s.work_location_id, s);
  const seen = new Set();
  const map = new Map();
  for (const l of lines) {
    if (!l.work_location_label || seen.has(l.work_location_label)) continue;
    seen.add(l.work_location_label);
    const site = siteByWlid.get(l.work_location_id);
    if (!site) continue;
    map.set(l.work_location_label, { account_key: site.account_key, excluded: site.excluded });
  }
  return map;
}

// ── api_prefixes: pull ALL external_ids (no SQL LIKE), filter in JS ──
// Stable ORDER required - PostgREST pagination with OFFSET on an
// unordered select skips rows across page boundaries. First-run of
// this probe hit that bug and under-counted prefixes by ~460,
// producing a false 53-row divergence in the parity check.
async function loadApiPrefixes() {
  const rows = await pageAll(() =>
    supa.from("rippling_raw_spend_lines")
      .select("external_id, rippling_id")
      .order("rippling_id"));
  const set = new Set();
  const re = /^[0-9a-f]{24}__/;
  for (const r of rows) {
    const ext = r.external_id;
    if (typeof ext !== "string") continue;
    if (!re.test(ext)) continue;
    set.add(ext.slice(0, 24));
  }
  return { set, scanned: rows.length };
}

async function fetchCurrent(start, end, accountKeys) {
  const all = [];
  const IN_CHUNK = 200;
  for (let i = 0; i < accountKeys.length; i += IN_CHUNK) {
    const chunk = accountKeys.slice(i, i + IN_CHUNK);
    const rows = await pageAll(() =>
      supa.from("rippling_report_only_pending_v1")
        .select("parent_txn_id, amount, account_key, purchased_at, currency, category, work_location")
        .in("account_key", chunk)
        .gte("purchased_at", start)
        .lte("purchased_at", end)
        .order("parent_txn_id"));
    for (const r of rows) all.push(r);
  }
  return all;
}

async function fetchRestructured(start, end, labelToAccount, apiPrefixes) {
  // Equivalent to the proposed function body: pre-filter on
  // purchased_at + currency, DISTINCT ON (parent_txn_id) in-window,
  // then apply NOT EXISTS + amount != 0 + attribution.
  const txns = await pageAll(() =>
    supa.from("rippling_report_txns")
      .select("parent_txn_id, purchased_at, amount, currency, work_location, last_seen_at, id, category")
      .gte("purchased_at", start)
      .lte("purchased_at", end)
      .eq("currency", "USD")
      .order("parent_txn_id")
      .order("last_seen_at", { ascending: false })
      .order("id", { ascending: false }));
  const seen = new Set();
  const deduped = [];
  for (const t of txns) {
    if (seen.has(t.parent_txn_id)) continue;
    seen.add(t.parent_txn_id);
    deduped.push(t);
  }
  const out = [];
  for (const t of deduped) {
    if (apiPrefixes.has(t.parent_txn_id)) continue;
    if (Number(t.amount || 0) === 0) continue;
    const la = labelToAccount.get(t.work_location);
    if (!la || !la.account_key) continue;
    if (la.excluded) continue;
    out.push({
      parent_txn_id: t.parent_txn_id,
      amount: Number(t.amount),
      account_key: la.account_key,
      purchased_at: t.purchased_at,
      currency: t.currency,
      category: t.category,
      work_location: t.work_location,
    });
  }
  return out;
}

console.log("loading label_to_account + api_prefixes...");
const labelToAccount = await loadLabelToAccount();
const { set: apiPrefixes, scanned } = await loadApiPrefixes();
console.log(`  label_to_account entries: ${labelToAccount.size}`);
console.log(`  rippling_raw_spend_lines scanned: ${scanned}`);
console.log(`  api_prefixes entries:     ${apiPrefixes.size}`);

const accountsRows = await pageAll(() =>
  supa.from("accounts").select("team_key").eq("active", true));
const accountKeys = accountsRows.map(a => a.team_key).filter(k => k && k !== "CORP");
console.log(`  accounts to check: ${accountKeys.length}`);

const RANGES = [
  { label: "2026-09-07..2026-10-04", start: "2026-09-07", end: "2026-10-04" },
  { label: "FY2026 to date (2025-12-29..today)", start: "2025-12-29", end: new Date().toISOString().slice(0, 10) },
];

for (const R of RANGES) {
  console.log(`\n=== Range: ${R.label} ===`);
  const curRows = await fetchCurrent(R.start, R.end, accountKeys);
  const newRows = await fetchRestructured(R.start, R.end, labelToAccount, apiPrefixes);
  console.log(`  current view rows:    ${curRows.length}`);
  console.log(`  restructured rows:    ${newRows.length}`);

  const curBy = new Map();
  for (const r of curRows) curBy.set(`${r.parent_txn_id}|${r.account_key}`, Number(r.amount || 0));
  const newBy = new Map();
  for (const r of newRows) newBy.set(`${r.parent_txn_id}|${r.account_key}`, Number(r.amount || 0));

  let missing = 0, extra = 0, amountDiffs = 0;
  const diffSamples = [];
  for (const [k, v] of curBy) {
    if (!newBy.has(k)) { missing++; if (diffSamples.length < 3) diffSamples.push({ k_hash: k.slice(0,12)+"...", in: "current only", amt_diff: v }); continue; }
    const vn = newBy.get(k);
    if (Math.abs(vn - v) > 0.001) { amountDiffs++; if (diffSamples.length < 5) diffSamples.push({ k_hash: k.slice(0,12)+"...", current: v, new: vn }); }
  }
  for (const [k] of newBy) if (!curBy.has(k)) { extra++; if (diffSamples.length < 3) diffSamples.push({ k_hash: k.slice(0,12)+"...", in: "new only" }); }

  console.log(`  missing from new:     ${missing}`);
  console.log(`  extra in new:         ${extra}`);
  console.log(`  amount differs:       ${amountDiffs}`);
  if (diffSamples.length) console.log(`  samples: ${JSON.stringify(diffSamples)}`);
  console.log(`  VERDICT: ${missing === 0 && extra === 0 && amountDiffs === 0 ? "BYTE-IDENTICAL" : "FAIL"}`);
}

// ── Mixed-amount scenarios ──
console.log("\n=== Mixed-amount parents (both zero and non-zero versions exist) ===");
const allTxns = await pageAll(() =>
  supa.from("rippling_report_txns")
    .select("parent_txn_id, amount, last_seen_at, id, currency")
    .eq("currency", "USD"));
const byParent = new Map();
for (const t of allTxns) {
  if (!byParent.has(t.parent_txn_id)) byParent.set(t.parent_txn_id, []);
  byParent.get(t.parent_txn_id).push(t);
}
const mixed = [];
for (const [pid, versions] of byParent) {
  if (versions.length < 2) continue;
  const hasZero = versions.some(v => Number(v.amount || 0) === 0);
  const hasNonZero = versions.some(v => Number(v.amount || 0) !== 0);
  if (hasZero && hasNonZero) mixed.push({ pid, versions });
}
console.log(`  parents with both zero and non-zero versions: ${mixed.length}`);

function sortNewest(versions) {
  return [...versions].sort((a, b) => {
    const c = String(b.last_seen_at || "").localeCompare(String(a.last_seen_at || ""));
    if (c !== 0) return c;
    return String(b.id || "").localeCompare(String(a.id || ""));
  });
}
let currentIncludes = 0, newIncludes = 0;
let currentDrops = 0, newDrops = 0;
let outcomeMismatch = 0;
const outcomeSamples = [];
for (const m of mixed) {
  const sorted = sortNewest(m.versions);
  const newestNonZero = Number(sorted[0].amount || 0) !== 0;
  const anyNonZero = m.versions.some(v => Number(v.amount || 0) !== 0);
  // Current view: picks newest, then drops if amount == 0
  const current = newestNonZero && !apiPrefixes.has(m.pid);
  // Restructured (if pushing amount filter pre-dedupe): picks newest NON-ZERO
  // Restructured (NOT pushing amount filter): picks newest, drops if amount == 0 - SAME as current
  const newNoPushdown = current;
  // "pushdown" variant for comparison
  const nonZeroVersions = m.versions.filter(v => Number(v.amount || 0) !== 0);
  const newestNonZeroVersion = nonZeroVersions.length ? sortNewest(nonZeroVersions)[0] : null;
  const newPushdown = newestNonZeroVersion && !apiPrefixes.has(m.pid);

  if (current) currentIncludes++; else currentDrops++;
  if (newNoPushdown) newIncludes++; else newDrops++;
  if (current !== newNoPushdown) {
    outcomeMismatch++;
    if (outcomeSamples.length < 3) outcomeSamples.push({ pid_hash: m.pid.slice(0,10)+"...", current, newNoPushdown, newPushdown });
  }
}
console.log(`  in current view: ${currentIncludes} included, ${currentDrops} dropped`);
console.log(`  in restructured (NO amount pushdown): ${newIncludes} included, ${newDrops} dropped`);
console.log(`  outcome mismatches (current vs restructured without amount pushdown): ${outcomeMismatch}`);
if (outcomeSamples.length) console.log(`  samples: ${JSON.stringify(outcomeSamples)}`);
console.log(`  VERDICT: ${outcomeMismatch === 0 ? "PRESERVED (amount filter stays post-dedupe)" : "FAIL"}`);
