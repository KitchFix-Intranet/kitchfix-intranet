// S1 diagnosis - reproduce Kevin's exact SQL and diff against 03_live_db_check's filter set.
// The suspicion: 03_live used simple .gte/.lte on invoice_date and did NOT normalize dates with
// prefix corruptions (0026-, 0206-, 23026-, 72026-). Rows with those prefixes fall OUTSIDE
// the .gte("2026-05-01").lte("2026-07-31") range and never enter the initial pull, so the
// drift low/high sweep is what would have caught them. But Kevin's SQL normalizes with dnorm
// FIRST then filters, so it counts rows whose raw invoice_date is a corrupted 2026 date.
//
// Also probe: the invoice_over_extracted filter may differ. Kevin's SQL uses
// review_reason IS DISTINCT FROM 'invoice_over_extracted' which is the same as
// review_reason !== 'invoice_over_extracted' in JS.
//
// Read-only.

import dotenv from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/dotenv/lib/main.js";
import { createClient } from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/@supabase/supabase-js/dist/index.mjs";

dotenv.config({ path: "/Users/kevinfietek/dev/kitchfix-intranet/.env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing env");
const supa = createClient(url, key, { auth: { persistSession: false } });

const round2 = (n) => Math.round(n * 100) / 100;

function dnormJs(raw) {
  if (!raw) return null;
  const s = String(raw);
  if (s.startsWith("0026-")) return "2026-" + s.slice(5);
  if (s.startsWith("0206-")) return "2026-" + s.slice(5);
  if (s.startsWith("23026-")) return s.slice(1);
  if (s.startsWith("72026-")) return s.slice(1);
  return s;
}

// Fetch ALL TBJ rows unconditionally, then apply the dnorm-first filter Kevin's SQL uses.
async function fetchAllTBJ() {
  const rows = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supa
      .from("ai_line_items")
      .select("id, account_key, invoice_uuid, invoice_date, extended_price, quantity, unit_price, unit, review_reason, created_at")
      .eq("account_key", "TBJ - FL")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function fetchHeaders(uuids) {
  const map = new Map();
  const CHUNK = 100;
  for (let i = 0; i < uuids.length; i += CHUNK) {
    const batch = uuids.slice(i, i + CHUNK);
    const { data, error } = await supa
      .from("invoice_submissions")
      .select("id, status")
      .in("id", batch);
    if (error) throw error;
    for (const r of data) map.set(r.id, r);
  }
  return map;
}

const WSTART = "2026-05-01", WEND = "2026-07-31";

console.log("== S1 DIAGNOSIS: TBJ - FL live-DB read reproducibility ==\n");

const all = await fetchAllTBJ();
console.log(`Total TBJ rows (unfiltered): ${all.length}`);

// Prefix census
const prefixCensus = {};
for (const r of all) {
  const raw = String(r.invoice_date || "");
  const pfx = raw.slice(0, 5);
  prefixCensus[pfx] = (prefixCensus[pfx] || 0) + 1;
}
console.log("Prefix census (first 5 chars of invoice_date):");
for (const [pfx, n] of Object.entries(prefixCensus).sort((a,b)=>b[1]-a[1])) {
  console.log(`  ${JSON.stringify(pfx)}  ${n}`);
}

// Simulate 03_live_db_check filter (naive gte/lte on raw invoice_date + drift sweep manual)
const filterA_naive = all.filter(r => {
  const raw = String(r.invoice_date || "");
  return raw >= WSTART && raw <= WEND;
});

const filterA_drift = all.filter(r => {
  const raw = String(r.invoice_date || "");
  if (raw >= WSTART && raw <= WEND) return false; // dedupe with naive
  // drift low: <2015 or >2027 in postgres string cmp order
  const isLow = raw < "2015-01-01";
  const isHigh = raw > "2027-12-31";
  if (!isLow && !isHigh) return false;
  const nd = dnormJs(raw);
  return nd && nd >= WSTART && nd <= WEND;
});

const filterA = [...filterA_naive, ...filterA_drift];
console.log(`\nFilter A (03_live_db_check simulation): naive=${filterA_naive.length} drift=${filterA_drift.length} total=${filterA.length}`);

// Simulate Kevin's SQL: dnorm FIRST on ALL rows, then filter
const filterB = all.filter(r => {
  const nd = dnormJs(r.invoice_date);
  return nd && nd >= WSTART && nd <= WEND;
});
console.log(`Filter B (Kevin's dnorm-first SQL): total=${filterB.length}`);

// Diff
const idsA = new Set(filterA.map(r => r.id));
const idsB = new Set(filterB.map(r => r.id));
const onlyA = filterA.filter(r => !idsB.has(r.id));
const onlyB = filterB.filter(r => !idsA.has(r.id));
console.log(`\nSet diff:  A-only=${onlyA.length}  B-only=${onlyB.length}`);
if (onlyA.length) {
  console.log("  A-only sample raw invoice_dates:");
  for (const r of onlyA.slice(0, 10)) console.log(`    ${r.id} raw=${JSON.stringify(r.invoice_date)} dnorm=${dnormJs(r.invoice_date)} ep=${r.extended_price}`);
}
if (onlyB.length) {
  console.log("  B-only sample raw invoice_dates:");
  for (const r of onlyB.slice(0, 20)) console.log(`    ${r.id} raw=${JSON.stringify(r.invoice_date)} dnorm=${dnormJs(r.invoice_date)} ep=${r.extended_price}`);
}

// Now apply header + review_reason filter to both to get dollar sets
const allUuids = [...new Set([...filterA, ...filterB].map(r => r.invoice_uuid).filter(Boolean))];
const hdrs = await fetchHeaders(allUuids);

function toDollarSet(rows) {
  return rows.filter(r => {
    const h = hdrs.get(r.invoice_uuid);
    if (h && (h.status === "corrected" || h.status === "deleted")) return false;
    if (r.review_reason === "invoice_over_extracted") return false;
    return true;
  });
}

const dsA = toDollarSet(filterA);
const dsB = toDollarSet(filterB);

function tally(rows) {
  const per = {};
  let total = 0;
  for (const r of rows) {
    const nd = dnormJs(r.invoice_date);
    if (!nd) continue;
    const m = nd.slice(0, 7);
    per[m] = per[m] || { rows: 0, spend: 0 };
    per[m].rows += 1;
    per[m].spend += Number(r.extended_price) || 0;
    total += Number(r.extended_price) || 0;
  }
  for (const m of Object.keys(per)) per[m].spend = round2(per[m].spend);
  return { per, total: round2(total), rows: rows.length };
}

const tA = tally(dsA);
const tB = tally(dsB);
console.log("\n== Filter A (03_live_db_check) dollar set ==");
console.log(`  rows=${tA.rows}  total=$${tA.total}`);
for (const [m, v] of Object.entries(tA.per).sort()) console.log(`    ${m}  ${v.rows} / $${v.spend}`);

console.log("\n== Filter B (Kevin's SQL) dollar set ==");
console.log(`  rows=${tB.rows}  total=$${tB.total}`);
for (const [m, v] of Object.entries(tB.per).sort()) console.log(`    ${m}  ${v.rows} / $${v.spend}`);

console.log("\n== Kevin's expected: 2,202 rows / $183,851.55 (630/778/794) ==");

// Also compute latest created_at across all in-window
const latestA = dsA.map(r => r.created_at).sort().slice(-1)[0] || null;
const latestB = dsB.map(r => r.created_at).sort().slice(-1)[0] || null;
console.log(`\nlatest_created_at A: ${latestA}`);
console.log(`latest_created_at B: ${latestB}`);

// Save
const OUT = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_s1_diagnose.json";
(await import("node:fs")).writeFileSync(OUT, JSON.stringify({
  ran_at: new Date().toISOString(),
  prefix_census: prefixCensus,
  filter_A_03_live: tA,
  filter_B_kevin_sql: tB,
  set_diff: {
    only_A: onlyA.map(r => ({ id: r.id, raw: r.invoice_date, dnorm: dnormJs(r.invoice_date), ep: r.extended_price })),
    only_B: onlyB.map(r => ({ id: r.id, raw: r.invoice_date, dnorm: dnormJs(r.invoice_date), ep: r.extended_price })),
  },
  latest_created_at_A: latestA,
  latest_created_at_B: latestB,
}, null, 2));
console.log(`\nwrote ${OUT}`);
