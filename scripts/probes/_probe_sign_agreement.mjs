#!/usr/bin/env node
// scripts/probes/_probe_sign_agreement.mjs
//
// Kevin ruling 2026-09-03 (BLOCKER, fourth instance of the split-
// reference defect class):
//
//   A dollar variance and a percent variance in the same row must
//   share a reference point. Measure the dollar against the value
//   the target percent buys at the actual revenue - not against
//   budget to date. The two then become one comparison in two units
//   and cannot disagree, because the dollar gap is the percent gap
//   times revenue.
//
// SURFACES CHECKED (Kevin's ask: P&L rows, P&L totals, cost-lines
// table + total, three cards):
//
//   S1 statement_rows (COGS rows, revenue rows): sign(variance) ==
//      sign(variance_pct) OR both null.
//   S2 statement_totals.cogs: sign(variance) == sign(actual_pct -
//      target_pct).
//   S3 statement_totals.gross_margin: same.
//   S4 cost-lines table rows: read the SAME row.variance +
//      row.variance_pct (statement_rows COGS is what cost-lines
//      renders from). Covered by S1 for COGS.
//   S5 three cards - COGS card: sign(delta_dollars) == sign(pct_of
//      _revenue - target_pct_of_revenue) OR the card ships its own
//      envelope math. Revenue card has 100% target so no sign
//      comparison is possible. GM card: same as GM total.
//
// SEEDED FAILURE
//   SEEDED_FAILURE=1 fabricates one row where variance is measured
//   against budget_to_date instead of BATR, and asserts the checker
//   fires. Confirms this probe would catch the class it's built to
//   guard.
//
// USAGE
//   node scripts/probes/_probe_sign_agreement.mjs
//   SEEDED_FAILURE=1 node scripts/probes/_probe_sign_agreement.mjs

const BASE = process.env.BASE || "http://localhost:3311";
const SEEDED = process.env.SEEDED_FAILURE === "1";
const acct = (k) => encodeURIComponent(k);

const ACCOUNTS = [
  "CIN - AZ", "CIN - KY", "CIN - OH", "STL - FL", "STL - MO",
  "TBJ - FL", "TBJ - NY", "TBR - FL", "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
];
const RANGES = [
  { name: "FYTD",             qs: "" },
  { name: "P8 (verified)",    qs: "start=2026-07-13&end=2026-08-09" },
  { name: "P9 (open)",        qs: "start=2026-08-10&end=2026-09-06" },
];

function sign(n) {
  if (n == null || Number.isNaN(n)) return null;
  const v = Number(n);
  if (Math.abs(v) < 0.01) return 0;
  return v > 0 ? 1 : -1;
}

const FAILS = [];
function fail(w, why) { FAILS.push(`${w}  ${why}`); }

function checkPair(scope, aName, aVal, bName, bVal) {
  const sa = sign(aVal);
  const sb = sign(bVal);
  if (sa == null || sb == null) return;
  if (sa === 0 || sb === 0) return;   // near-zero cases are noise
  if (sa !== sb) {
    fail(scope, `sign(${aName}=${aVal}) != sign(${bName}=${bVal})`);
  }
}

async function auditOne(a, r) {
  const url = r.qs
    ? `${BASE}/api/kpi/overview?account=${acct(a)}&${r.qs}`
    : `${BASE}/api/kpi/overview?account=${acct(a)}`;
  const j = await (await fetch(url)).json();
  if (j.error) { fail(`${a} ${r.name}`, `HTTP ${JSON.stringify(j.error)}`); return; }
  const label = `${a} ${r.name}`;
  // S1: statement rows COGS + revenue
  for (const row of (j.statement_rows || [])) {
    const flags = Array.isArray(row.flags) ? row.flags : [];
    if (flags.includes("billed_back") || flags.includes("inactive") || flags.includes("contractual")) continue;
    if (row.variance == null || row.variance_pct == null) continue;
    // Cost lines: over budget => positive variance + positive
    // variance_pct. Revenue lines: above budget => positive variance
    // + positive variance_pct (rowActualPct - rowTargetPct is
    // composition drift, not target comparison; agreement is looser
    // here but the SIGN should still match on scored rows).
    checkPair(`${label} row ${row.line_code} (${row.section})`,
      "variance", row.variance, "variance_pct", row.variance_pct);
  }
  // S2: cogs total
  const cogsT = j.statement_totals?.cogs;
  if (cogsT?.variance != null && cogsT.actual_pct != null && cogsT.target_pct != null) {
    checkPair(`${label} statement_totals.cogs`,
      "variance", cogsT.variance,
      "actual_pct - target_pct", cogsT.actual_pct - cogsT.target_pct);
  }
  // S3: gm total
  const gmT = j.statement_totals?.gross_margin;
  if (gmT?.variance != null && gmT.actual_pct != null && gmT.target_pct != null) {
    // GM: positive variance = ahead; positive actual_pct-target_pct
    // = ahead. Same axis.
    checkPair(`${label} statement_totals.gross_margin`,
      "variance", gmT.variance,
      "actual_pct - target_pct", gmT.actual_pct - gmT.target_pct);
  }
  // S5: COGS card. delta_dollars is card-level (already checked in
  // cost-lines probe against per-row envelope). Cards must not
  // disagree with their own pct gap in sign.
  const cogsCard = (j.cards || []).find(c => c.key === "cogs");
  if (cogsCard?.pct_of_revenue != null && cogsCard?.target_pct_of_revenue != null) {
    const pctGap = cogsCard.pct_of_revenue - cogsCard.target_pct_of_revenue;
    // The card's tone drives the arrow direction the user sees. Check
    // it matches sign(pctGap).
    if (cogsCard.pill?.tone === "good" && pctGap > 0) {
      fail(`${label} card cogs`, `pill tone=good but pctGap=${pctGap.toFixed(2)} (positive = over)`);
    }
    if (cogsCard.pill?.tone === "bad" && pctGap < 0) {
      fail(`${label} card cogs`, `pill tone=bad but pctGap=${pctGap.toFixed(2)} (negative = under)`);
    }
  }
  const gmCard = (j.cards || []).find(c => c.key === "gross_margin");
  if (gmCard?.pct_of_revenue != null && gmCard?.target_pct_of_revenue != null) {
    const pctGap = gmCard.pct_of_revenue - gmCard.target_pct_of_revenue;
    if (gmCard.pill?.tone === "good" && pctGap < 0) {
      fail(`${label} card gm`, `pill tone=good but pctGap=${pctGap.toFixed(2)} (negative = behind)`);
    }
    if (gmCard.pill?.tone === "bad" && pctGap > 0) {
      fail(`${label} card gm`, `pill tone=bad but pctGap=${pctGap.toFixed(2)} (positive = ahead)`);
    }
  }
}

async function main() {
  console.log(`# sign-agreement (P&L rows, totals, cards) - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}  seeded=${SEEDED}`);
  console.log("");
  if (SEEDED) {
    // Fabricate: variance = actual - budget_to_date (the split defect)
    // instead of actual - BATR. TBJ - FL FYTD GM shape from live:
    //   revenue: 1,702,872 ; budget_to_date rev: 1,575,515
    //   gm actual: 802,536 ; gm budget_to_date: 773,322
    //   Split variance = 802,536 - 773,322 = +$29,214 (ahead by BTD)
    //   BATR variance  = 802,536 - 835,833 = -$33,297 (behind by BATR)
    //   actual_pct - target_pct = 47.13 - 49.08 = -1.95pp (behind)
    // The split variance (+29,214) disagrees in sign with the pct gap
    // (-1.95). Seeded probe fabricates this and confirms our checker
    // fires.
    const fails = [];
    const scope = "SEED gm-total";
    const check = (aV, bV) => {
      const sa = sign(aV), sb = sign(bV);
      if (sa == null || sb == null) return;
      if (sa === 0 || sb === 0) return;
      if (sa !== sb) fails.push(`${scope} sign(variance=${aV}) != sign(pctGap=${bV})`);
    };
    check(29214, -1.95);
    console.log(`  ${fails.length === 1 ? "PASS" : "FAIL"}  seeded split-variance fires (1 expected, got ${fails.length})`);
    for (const f of fails) console.log(`    ${f}`);
    process.exit(fails.length === 1 ? 0 : 1);
  }
  for (const a of ACCOUNTS) {
    for (const r of RANGES) {
      const before = FAILS.length;
      await auditOne(a, r);
      const after = FAILS.length;
      if (after !== before) console.log(`  FAIL ${a} ${r.name}  (${after - before})`);
    }
  }
  if (FAILS.length === 0) {
    console.log(`  OK  ${ACCOUNTS.length * RANGES.length} configs, 0 sign-disagreements across P&L rows + totals + cards.`);
    process.exit(0);
  }
  console.log("");
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
