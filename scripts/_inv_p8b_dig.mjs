// INV-P8b DIG - deeper look at:
//   1. why all our lines have first_seen_at 2026-08 (fresh sync?)
//   2. weekly first_seen_at distribution across all our data
//   3. widen the superseded-split shape detection (looser: any parent where all lines share ONE amount and there are >=2 lines matches INV-P8's original 78)
//   4. sample raw payload for one line to see actual keys available (dump keys, not values)
//   5. what date field IS populated on raw payload (all top-level keys with date-ish names)
//
// READ-ONLY. No writes.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("missing env"); process.exit(2); }
const supa = createClient(url, key, { auth: { persistSession: false } });

function fmt(n) { return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function cents(n) { return Math.round(Number(n || 0) * 100); }
const HEX24 = /^[a-f0-9]{24}$/;
function parseParentFromExternal(external_id) {
  if (!external_id || typeof external_id !== "string") return null;
  const idx = external_id.indexOf("__");
  if (idx <= 0) return null;
  const tok = external_id.slice(0, idx).toLowerCase();
  return HEX24.test(tok) ? tok : null;
}
async function paginate(qBuilder, pageSize = 1000) {
  const out = [];
  let from = 0;
  while (true) {
    const q = await qBuilder(from, from + pageSize - 1);
    if (q.error) throw q.error;
    const rows = q.data || [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// 1 + 2: sample all rows, look at first_seen_at range + weekly buckets
console.error("[load] scanning first_seen_at across rippling_raw_spend_lines_latest ...");
const oursMinimal = await paginate((f, t) => supa
  .from("rippling_raw_spend_lines_latest")
  .select("rippling_id, external_id, amount, currency, first_seen_at")
  .order("rippling_id").range(f, t), 1000);
console.error(`[load] rows: ${oursMinimal.length}`);
const dates = oursMinimal.map(r => (r.first_seen_at ? String(r.first_seen_at).slice(0, 10) : null)).filter(Boolean).sort();
console.error(`[first_seen_at] earliest: ${dates[0]}  latest: ${dates[dates.length - 1]}`);

// bucket by day
const dayCounts = new Map();
for (const r of oursMinimal) {
  const d = r.first_seen_at ? String(r.first_seen_at).slice(0, 10) : "(null)";
  dayCounts.set(d, (dayCounts.get(d) || 0) + 1);
}
const dayCountsArr = [...dayCounts.entries()].sort();
console.log("first_seen_at day distribution (all ours rows):");
for (const [d, n] of dayCountsArr) {
  console.log(`  ${d}   ${n}`);
}

// 3: widen superseded detection - INV-P8's original criteria was
// "each of our lines equals the parent's full amount" - i.e. all lines equal same amount, N>=2.
// We do NOT know parent total (spend_transaction_zo blocked). Approximation: for each
// parent, if there are >=2 lines and ALL lines have the SAME amount, it's the "inflated"
// shape (which was one bucket of the 78). The original 78 = parents where each line
// equals parent total. Also count parents that have coexisting sets with the same sum.
console.log("");
console.log("[superseded shape detection - INV-P8 original 78-parent criteria]");
// Load full detail again with parent24
const oursDetail = await paginate((f, t) => supa
  .from("rippling_raw_spend_lines_latest")
  .select("rippling_id, external_id, amount, currency")
  .order("rippling_id").range(f, t), 1000);
const byParent = new Map();
for (const r of oursDetail) {
  const p24 = parseParentFromExternal(r.external_id);
  if (!p24) continue;
  if (!byParent.has(p24)) byParent.set(p24, []);
  byParent.get(p24).push(Number(r.amount || 0));
}
// Bucket A: all lines share single amount, N>=2
let bucketA_parents = 0, bucketA_lines = 0, bucketA_storedDollars = 0, bucketA_canonicalDollars = 0;
// Bucket B: multi-amount but coexisting sets sum-match (superseded splits like [x], [x/2, x/2])
let bucketB_parents = 0, bucketB_storedDollars = 0, bucketB_canonicalDollars = 0;
// Bucket C: all other multi-line parents (legit multi-line breakouts)
let bucketC_parents = 0, bucketC_storedDollars = 0;
for (const [k, arr] of byParent.entries()) {
  if (arr.length < 2) continue;
  const distinctCents = new Set(arr.map(cents));
  const stored = arr.reduce((a, b) => a + b, 0);
  if (distinctCents.size === 1) {
    // all equal - inflated N-fold
    bucketA_parents++;
    bucketA_lines += arr.length;
    bucketA_storedDollars += stored;
    bucketA_canonicalDollars += arr[0]; // canonical = one instance
  } else {
    // multi-amount: are there coexisting sets with same sum?
    const amountCounts = new Map();
    for (const v of arr) amountCounts.set(cents(v), (amountCounts.get(cents(v)) || 0) + 1);
    const sums = new Map();
    for (const [amtC, n] of amountCounts.entries()) {
      const s = amtC * n;
      if (!sums.has(s)) sums.set(s, 0);
      sums.set(s, sums.get(s) + 1);
    }
    let bucketBHit = false;
    let canonicalSumCents = null;
    for (const [s, bucketCount] of sums.entries()) {
      if (bucketCount >= 2) { bucketBHit = true; canonicalSumCents = s; break; }
    }
    if (bucketBHit) {
      bucketB_parents++;
      bucketB_storedDollars += stored;
      bucketB_canonicalDollars += canonicalSumCents / 100;
    } else {
      bucketC_parents++;
      bucketC_storedDollars += stored;
    }
  }
}
console.log(`  bucketA (all-lines-equal, N>=2): parents=${bucketA_parents} lines=${bucketA_lines} stored=$${fmt(bucketA_storedDollars)} canonical=$${fmt(bucketA_canonicalDollars)} over=$${fmt(bucketA_storedDollars - bucketA_canonicalDollars)}`);
console.log(`  bucketB (multi-amount but coexisting sets match sum): parents=${bucketB_parents} stored=$${fmt(bucketB_storedDollars)} canonical=$${fmt(bucketB_canonicalDollars)} over=$${fmt(bucketB_storedDollars - bucketB_canonicalDollars)}`);
console.log(`  bucketC (multi-amount, likely legit breakouts): parents=${bucketC_parents} stored=$${fmt(bucketC_storedDollars)}`);

// 4: dump the top-level payload keys observed across our first 500 rows
console.log("");
console.log("[payload key survey - top-level and spend_transaction nested]");
const oursRaw = await supa
  .from("rippling_raw_spend_lines_latest")
  .select("rippling_id, raw")
  .limit(500);
if (oursRaw.error) { console.error(oursRaw.error); process.exit(2); }
const topKeyPresence = new Map();
const parentKeyPresence = new Map();
for (const r of (oursRaw.data || [])) {
  const raw = r.raw || {};
  for (const k of Object.keys(raw)) {
    topKeyPresence.set(k, (topKeyPresence.get(k) || 0) + 1);
  }
  const st = raw.spend_transaction || {};
  if (typeof st === "object") for (const k of Object.keys(st)) {
    parentKeyPresence.set(k, (parentKeyPresence.get(k) || 0) + 1);
  }
}
console.log("TOP-LEVEL keys (sample=500):");
for (const [k, n] of [...topKeyPresence.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(k).padEnd(40)}  ${n}`);
}
console.log("SPEND_TRANSACTION nested keys (sample=500):");
for (const [k, n] of [...parentKeyPresence.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(k).padEnd(40)}  ${n}`);
}

// 5: look for ANY date-shaped values on raw payload
console.log("");
console.log("[date-shaped fields on raw payload]");
const dateShapedTop = new Map();
const dateShapedParent = new Map();
const dateShapeRegex = /^\d{4}-\d{2}-\d{2}/;
for (const r of (oursRaw.data || [])) {
  const raw = r.raw || {};
  for (const [k, v] of Object.entries(raw)) {
    if (v == null) continue;
    if (typeof v === "string" && dateShapeRegex.test(v)) {
      dateShapedTop.set(k, (dateShapedTop.get(k) || 0) + 1);
    }
  }
  const st = raw.spend_transaction || {};
  if (typeof st === "object") for (const [k, v] of Object.entries(st)) {
    if (v == null) continue;
    if (typeof v === "string" && dateShapeRegex.test(v)) {
      dateShapedParent.set(k, (dateShapedParent.get(k) || 0) + 1);
    }
  }
}
console.log("TOP-LEVEL date-shaped strings:");
for (const [k, n] of dateShapedTop.entries()) console.log(`  ${k.padEnd(30)}  ${n}`);
console.log("SPEND_TRANSACTION nested date-shaped strings:");
for (const [k, n] of dateShapedParent.entries()) console.log(`  ${k.padEnd(30)}  ${n}`);

// 6: dump one raw row fully (KEYS ONLY - no values to avoid cardholder names)
console.log("");
console.log("[single raw row: KEY SCHEMA ONLY, no scalar values printed]");
const one = (oursRaw.data || [])[0];
if (one) {
  const raw = one.raw || {};
  function keySchema(obj, depth = 0, prefix = "") {
    if (depth > 3) return;
    if (Array.isArray(obj)) {
      console.log(`${" ".repeat(depth * 2)}${prefix}[array len=${obj.length}]`);
      if (obj.length > 0 && typeof obj[0] === "object") keySchema(obj[0], depth + 1, "[0]");
      return;
    }
    if (typeof obj !== "object" || obj === null) return;
    for (const [k, v] of Object.entries(obj)) {
      const t = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
      console.log(`${" ".repeat(depth * 2)}${prefix}${k}  <${t}>`);
      if (v && typeof v === "object" && !Array.isArray(v)) keySchema(v, depth + 1, "");
    }
  }
  keySchema(raw);
}

console.error("[done]");
