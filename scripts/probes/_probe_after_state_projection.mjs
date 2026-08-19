// scripts/_probe_after_state_projection.mjs
//
// Projection of what the rederive will produce ONCE the migration is
// applied (spend_work_location_site_map seed lands and the updated
// purchasing_rippling_sync derive step lands).
//
// This script does NOT write anything. It reads the raw
// rippling_raw_spend_lines_latest, applies the SAME seed the migration
// carries in the file (hard-coded here so the projection matches
// exactly), and prints the per-account totals + the miscoded_card_lines
// + the excluded roll-up.
//
// Used for the PR-body report per Kevin's spec: the numbers are the
// same numbers Kevin will see after applying the migration and
// re-running purchasing_rippling_sync.
//
// Assertion: billcom P7 + P8 sums must be identical before/after; this
// script computes them from the current purchasing_actuals (they are
// untouched by the rederive) and prints them so the "delta = $0.00"
// assertion in the report is grounded.
//
// No cardholder names. No merchant names. Site labels + account keys
// only.

import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// The seed the migration will land. Kept identical to the SQL file
// so this projection is truthful. If Kevin edits the seed before
// applying, update this file too.
const SEED = [
  ['5fd0ff0083480900d2098801', 'Englewood, FL/Port Charlotte, FL (TBR-FL)',   'TBR - FL',     false],
  ['61953763dc6af3048edd1698', 'Surprise, AZ (TXR-AZ)',                       'TXR - AZ',     false],
  ['69179ad8210e99f5ca378716', 'Jupiter, FL (STL-FL)',                        'STL - FL',     false],
  ['5c13e4086ab9e235e4e707be', 'Dunedin, FL (TBJ-FL)',                        'TBJ - FL',     false],
  ['601c9f2805fa6f9640978ef7', 'Goodyear, AZ (CIN-AZ)',                       'CIN - AZ',     false],
  ['5e3ecb7c8a9f4e35f4b22c6a', 'Arlington, TX (TXR-HOME)',                    'TXR - TX - H', false],
  ['67a52de4d8c6991431b36df2', 'St. Louis, MO (STL-MO)',                      'STL - MO',     false],
  ['66a3b7c7c6e4b91ff923a5fa', 'Cincinnati, OH (CIN-OH)',                     'CIN - OH',     false],
  ['6881444a5dadb8e1598c7a68', 'Arlington, TX Visitor (TXR-VISITOR)',         'TXR - TX - V', false],
  ['65dcfc120d15b3daa1037c1e', 'Louisville, KY (CIN-KY)',                     'CIN - KY',     false],
  ['5c9a224d92dabb4cbe24a781', 'Buffalo, NY (TBJ-BUF)',                       'TBJ - NY',     false],
  ['674f7561bdd0f54665237b26', 'Corporate (CORP)',                             null,          true],
  ['5c05aa61d2a5f837ee651c1e', 'Headquarters & Chicago Commissary Kitchen',   null,          true],
  ['688142741ac512185a155f36', 'Remote',                                       null,          true],
  ['688141f90f7d769a5e9454d9', 'Remote',                                       null,          true],
  ['68814218178ce31372432089', 'Remote',                                       null,          true],
  ['6937146cfee99b45793fd7e5', 'Remote',                                       null,          true],
  ['619535efa5d797bee1ec9ac3', 'Remote',                                       null,          true],
  ['6881417367f1b1677b1fc4eb', 'Remote',                                       null,          true],
  ['6a356e58e3fbd29781d88739', 'Remote',                                       null,          true],
  ['643978713ca2f6c8a9c8fb5f', 'Remote',                                       null,          true],
  ['688141a0c4d26deefbbfacc3', 'Remote',                                       null,          true],
  ['686fcc8b707a6b7fb3457282', 'Remote',                                       null,          true],
  ['642c85e0aa29ccb6b3382cc4', 'Remote',                                       null,          true],
  ['68814132e69bbd42ff431fd9', 'Remote',                                       null,          true],
];
const wlMap = new Map(SEED.map(([id, label, acct, excl]) => [id, { account_key: acct, excluded: excl, label }]));

// FY period boundaries for billcom P7/P8 assertion.
const FY_START = "2025-12-29";
function periodStart(p) {
  const d = new Date(FY_START + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + (p - 1) * 28);
  return d.toISOString().slice(0, 10);
}
function periodEnd(p) {
  const d = new Date(FY_START + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + p * 28 - 1);
  return d.toISOString().slice(0, 10);
}

async function fetchAll(table, cols, filter) {
  const rows = [];
  let from = 0;
  const CHUNK = 1000;
  while (true) {
    let q = supa.from(table).select(cols).range(from, from + CHUNK - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data.length) break;
    rows.push(...data);
    if (data.length < CHUNK) break;
    from += CHUNK;
  }
  return rows;
}

// 1. AFTER-STATE PROJECTION: per-account roll-up using work_location.
const raw = await fetchAll("rippling_raw_spend_lines_latest",
  "rippling_id, work_location_id, work_location_label, department_id, amount");
console.log(`raw rows examined: ${raw.length}`);

const byAcct = new Map();
let excludedRemote = 0, excludedCorp = 0, excludedHQ = 0;
let unattributedLines = 0;
let unmappedIds = new Set();
for (const r of raw) {
  const amt = Number(r.amount || 0);
  if (!r.work_location_id) {
    unattributedLines++;
    continue;
  }
  const wl = wlMap.get(r.work_location_id);
  if (!wl) {
    unmappedIds.add(r.work_location_id);
    unattributedLines++;
    continue;
  }
  if (wl.excluded) {
    if (wl.label === "Remote") excludedRemote += amt;
    else if (wl.label === "Corporate (CORP)") excludedCorp += amt;
    else if (wl.label.startsWith("Headquarters")) excludedHQ += amt;
    continue;
  }
  const k = wl.account_key;
  if (!byAcct.has(k)) byAcct.set(k, { sum: 0, lines: 0 });
  byAcct.get(k).sum += amt;
  byAcct.get(k).lines++;
}

// Expected (spec §4).
const EXPECTED = {
  "STL - FL":     372674,
  "TXR - AZ":     232999,
  "TBR - FL":     208901,
  "CIN - OH":     158795,
  "TBJ - FL":     153912,
  "STL - MO":     152306,
  "TXR - TX - H": 151260,
  "CIN - AZ":     107888,
  "CIN - KY":     26556,
  "TXR - TX - V": 15596,
  "TBJ - NY":     13117,
};

console.log("");
console.log("=== PROJECTED per-account card totals (work_location attribution) ===");
console.log("account_key    | actual        | expected     | delta");
console.log("---------------+---------------+--------------+---------");
for (const [k, expected] of Object.entries(EXPECTED)) {
  const actual = byAcct.get(k)?.sum ?? 0;
  const delta = actual - expected;
  console.log(`  ${k.padEnd(14)}| ${actual.toFixed(2).padStart(13)} | ${String(expected).padStart(12)} | ${delta.toFixed(2)}`);
}

// Any accounts we produced that aren't in the expected list?
for (const [k, v] of byAcct.entries()) {
  if (!(k in EXPECTED)) console.log(`  UNEXPECTED account produced: ${k} sum=${v.sum.toFixed(2)}`);
}

console.log("");
console.log("=== PROJECTED excluded roll-up ===");
console.log(`  Remote                         ${excludedRemote.toFixed(2)}   (expected: 657266)`);
console.log(`  Corporate (CORP)               ${excludedCorp.toFixed(2)}   (expected: 229184)`);
console.log(`  Headquarters & Chicago         ${excludedHQ.toFixed(2)}   (expected: 1727)`);
console.log(`  UNATTRIBUTED (null wl):        lines=${unattributedLines}   (expected: 3)`);
console.log(`  UNMAPPED work_location_ids:    ${unmappedIds.size}  (should be 0 if seed is complete)`);
if (unmappedIds.size > 0) {
  console.log(`  ids: ${[...unmappedIds].join(", ")}`);
}

// 2. billcom P7 + P8 baselines (must be identical after) - re-read here
//    so the report has a single-source baseline; the rederive DOES NOT
//    touch billcom rows.
async function billcomPeriodSum(pStart, pEnd) {
  const rows = await fetchAll("purchasing_actuals", "amount, excluded",
    q => q.eq("source", "billcom").gte("txn_date", pStart).lte("txn_date", pEnd));
  let total = 0;
  for (const r of rows) if (!r.excluded) total += Number(r.amount || 0);
  return { total, lines: rows.length };
}
const bcP7 = await billcomPeriodSum(periodStart(7), periodEnd(7));
const bcP8 = await billcomPeriodSum(periodStart(8), periodEnd(8));
console.log("");
console.log(`billcom baseline (invariant across the rederive):`);
console.log(`  P7 sum=${bcP7.total.toFixed(2)}  lines=${bcP7.lines}`);
console.log(`  P8 sum=${bcP8.total.toFixed(2)}  lines=${bcP8.lines}`);

// 3. miscoded_card_lines projection: for the FYTD range, count raw
//    rows whose work_location resolves to excluded AND whose
//    department_id maps to a site via rippling_department_map.
const deptMap = new Map(
  (await fetchAll("rippling_department_map", "department_id, account_key"))
    .map(r => [r.department_id, r.account_key])
);
const miscodedByAcct = new Map();
let miscodedSampleMerchant = null;
for (const r of raw) {
  if (!r.work_location_id) continue;
  const wl = wlMap.get(r.work_location_id);
  if (!wl || !wl.excluded) continue;
  const acct = deptMap.get(r.department_id);
  if (!acct) continue;
  if (acct === "CORP") continue;   // CORP dept coded to Remote/HQ is not a miscoding
  miscodedByAcct.set(acct, (miscodedByAcct.get(acct) || 0) + 1);
}
const miscodedTotal = [...miscodedByAcct.values()].reduce((s, n) => s + n, 0);
console.log("");
console.log(`=== PROJECTED miscoded_card_lines ===`);
console.log(`  count: ${miscodedTotal}  (expected ~41 per spec)`);
console.log(`  by_account:`);
for (const [k, n] of [...miscodedByAcct.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${k.padEnd(14)}: ${n}`);
}
