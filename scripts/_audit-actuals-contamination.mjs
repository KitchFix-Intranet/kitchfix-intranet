// Supplementary probe for Task 2: sc_daily_actuals.created_by patterns.
// History only captures value CHANGES. An insert at zero (test signature the
// audit is worried about) leaves no history row - only sc_daily_actuals.
//
// Read-only.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and service role required");
const sb = createClient(url, key, { auth: { persistSession: false } });

async function paginateAll(runPage) {
  const all = []; let from = 0;
  for (;;) {
    const { data, error } = await runPage(from, from + 999);
    if (error) throw error;
    all.push(...(data || []));
    if ((data || []).length < 1000) return all;
    from += 1000;
  }
}

const actuals = await paginateAll((from, to) => sb
  .from("sc_daily_actuals")
  .select("account_key, service_date, actual_count, created_by, created_at, updated_by, updated_at")
  .order("id")
  .range(from, to));

console.log(`Total sc_daily_actuals rows: ${actuals.length}\n`);

const byCreator = {};
for (const r of actuals) byCreator[r.created_by || "(null)"] = (byCreator[r.created_by || "(null)"] || 0) + 1;
console.log(`created_by breakdown (insert authors):`);
for (const [k, n] of Object.entries(byCreator).sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(6)}  ${k}`);

const byUpdater = {};
for (const r of actuals) byUpdater[r.updated_by || "(null)"] = (byUpdater[r.updated_by || "(null)"] || 0) + 1;
console.log(`\nupdated_by breakdown (last-writer):`);
for (const [k, n] of Object.entries(byUpdater).sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(6)}  ${k}`);

// Post-mark cancellations = days where all actuals for the account+date are zero.
// Per-account+date reduce.
const perDay = new Map();
for (const r of actuals) {
  const k = `${r.account_key}|${r.service_date}`;
  let s = perDay.get(k);
  if (!s) { s = { any_nonzero: false, creators: new Set(), first_created_at: r.created_at, count_rows: 0 }; perDay.set(k, s); }
  s.count_rows += 1;
  if (Number(r.actual_count) > 0) s.any_nonzero = true;
  s.creators.add(r.created_by || "(null)");
  if (r.created_at < s.first_created_at) s.first_created_at = r.created_at;
}

let postMarkTotal = 0;
const postMarkByCreator = {};
const postMarkByAccount = {};
for (const [k, s] of perDay) {
  if (!s.any_nonzero && s.count_rows > 0) {
    postMarkTotal += 1;
    const [acct] = k.split("|");
    postMarkByAccount[acct] = (postMarkByAccount[acct] || 0) + 1;
    for (const c of s.creators) postMarkByCreator[c] = (postMarkByCreator[c] || 0) + 1;
  }
}

console.log(`\nPost-mark cancellation days (day where all sc_daily_actuals rows have actual_count=0): ${postMarkTotal}`);
console.log(`\nBy account:`);
for (const [acct, n] of Object.entries(postMarkByAccount).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n.toString().padStart(4)}  ${acct}`);
}
console.log(`\nBy creator (unique creators on all-zero days - a day may have multiple):`);
for (const [c, n] of Object.entries(postMarkByCreator).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n.toString().padStart(4)}  ${c}`);
}

// Test-signature check
const testRE = /test|smoke|dev|localhost|@example\.|@test\.|kf-test/i;
const testCreatorRows = actuals.filter((r) => testRE.test(r.created_by || ""));
console.log(`\nsc_daily_actuals rows created by test-signature identity: ${testCreatorRows.length}`);
