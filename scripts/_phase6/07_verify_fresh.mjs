// Verify fresh AUG against Kevin's Fact 1 (TBR/STL) and Fact 2 (TBJ).
// AUG has 6,969 live rows. Now tally per-account dollar set.
import fs from "node:fs";

const AUG = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3/_augmented.json", "utf8"));
const round2 = n => Math.round(n*100)/100;

const acctResults = {};
for (const r of AUG.rows) {
  const acct = r.account_label;
  if (!acctResults[acct]) acctResults[acct] = { dollar_rows: 0, dollar_spend: 0, by_month: {} };
  if (r.review_reason === "invoice_over_extracted") continue;
  const m = r.month;
  acctResults[acct].dollar_rows += 1;
  const ep = Number(r.extended_price) || 0;
  acctResults[acct].dollar_spend += ep;
  if (!acctResults[acct].by_month[m]) acctResults[acct].by_month[m] = { rows: 0, spend: 0 };
  acctResults[acct].by_month[m].rows += 1;
  acctResults[acct].by_month[m].spend += ep;
}
for (const acct of Object.keys(acctResults)) {
  const a = acctResults[acct];
  a.dollar_spend = round2(a.dollar_spend);
  for (const m of Object.keys(a.by_month)) a.by_month[m].spend = round2(a.by_month[m].spend);
}

for (const acct of ["TBR-FL", "TBJ-FL", "STL-FL"]) {
  const a = acctResults[acct];
  console.log(`\n${acct}: dollar_rows=${a.dollar_rows}  dollar_spend=$${a.dollar_spend}`);
  for (const [m, v] of Object.entries(a.by_month).sort()) console.log(`  ${m}: ${v.rows} / $${v.spend}`);
}

console.log(`\nExpected TBJ (Kevin Fact 2): 2,202 rows / $183,851.55 (630 / 778 / 794)`);

fs.writeFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_s1_verify_fresh.json", JSON.stringify({
  ran_at: new Date().toISOString(),
  acct_results: acctResults,
  aug_meta: {
    row_count: AUG.row_count,
    drift_recovered: AUG.drift_recovered,
    orphan_excluded: AUG.orphan_excluded,
  },
}, null, 2));
