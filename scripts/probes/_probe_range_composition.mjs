#!/usr/bin/env node
// scripts/probes/_probe_range_composition.mjs
//
// Kevin blocker 2026-09-02:
//
//   FYTD hides that it is eight verified periods plus one still
//   running. Every board figure is correct but no surface says what
//   the range is made of. The sources popover named the smaller SC
//   source and omitted pnl_actuals - 93% of the revenue - so an
//   operator who anchors on the FYTD number today sees it change
//   when Sebastian closes P9 with nothing having prepared them.
//
// PAYLOAD ASSERTIONS
//
//   A1  range_composition present at payload root.
//   A2  verified.count + live.count + planned.count === periods_total.
//       Each period must be exactly one kind - the invariant.
//   A3  will_change_at_close === true iff any period in range is
//       non-verified.
//   A4  summary is a non-empty string on any range with at least one
//       period; equals "P{a}-P{b} verified · P{c} still running"
//       shape on TBJ - FL FYTD.
//   A5  sources.revenue.sources_used === union of
//       statement_rows[section=revenue].sources on every range.
//       The popover cannot name fewer sources than the payload used.
//   A6  On a range with live.count > 0: sources.revenue.consequence
//       names the live period explicitly and includes "will change".
//       On planned.count > 0 (flag-off/fee): consequence names the
//       planned period. On a single verified range: consequence
//       is null.
//   A7  status_line.progress_display carries a third clause on FYTD
//       mixed ranges reading "{verified.count} of {periods_total}
//       periods verified".
//
// COVERAGE
//
//   TBJ - FL (SC-live per-meal)      FYTD + P8 (closed) + P9 (open)
//   TBR - FL (per-meal, flag-off)    FYTD + P8 + P9
//   CIN - OH (fee, always contract)  FYTD + P8 + P9
//   STL - MO (fee)                   FYTD
//   TXR - TX - V (tracked)           FYTD
//
//   All ranges assert A1-A5. A6 asserts on mixed ranges; A7 on FYTD.
//
// USAGE
//   node scripts/probes/_probe_range_composition.mjs

const BASE = process.env.BASE || "http://localhost:3311";
const acct = (k) => encodeURIComponent(k);

const CASES = [
  { name: "TBJ - FL FYTD", account: "TBJ - FL", qs: "" },
  { name: "TBJ - FL P8",   account: "TBJ - FL", qs: "start=2026-07-13&end=2026-08-09" },
  { name: "TBJ - FL P9",   account: "TBJ - FL", qs: "start=2026-08-10&end=2026-09-06" },
  { name: "TBR - FL FYTD", account: "TBR - FL", qs: "" },
  { name: "TBR - FL P8",   account: "TBR - FL", qs: "start=2026-07-13&end=2026-08-09" },
  { name: "TBR - FL P9",   account: "TBR - FL", qs: "start=2026-08-10&end=2026-09-06" },
  { name: "CIN - OH FYTD", account: "CIN - OH", qs: "" },
  { name: "CIN - OH P8",   account: "CIN - OH", qs: "start=2026-07-13&end=2026-08-09" },
  { name: "CIN - OH P9",   account: "CIN - OH", qs: "start=2026-08-10&end=2026-09-06" },
  { name: "STL - MO FYTD", account: "STL - MO", qs: "" },
  { name: "TXR - TX - V FYTD", account: "TXR - TX - V", qs: "" },
];

const FAILS = [];
function fail(w, why) { FAILS.push(`${w}  ${why}`); }

async function fetchOne(c) {
  const url = c.qs
    ? `${BASE}/api/kpi/overview?account=${acct(c.account)}&${c.qs}`
    : `${BASE}/api/kpi/overview?account=${acct(c.account)}`;
  const res = await fetch(url);
  return res.json();
}

async function checkOne(c) {
  const j = await fetchOne(c);
  if (j.error) { fail(c.name, `HTTP error ${JSON.stringify(j.error)}`); return; }
  const rc = j.range_composition;
  // A1: present
  if (!rc) { fail(c.name, "range_composition missing"); return; }
  // A2: invariant
  const sum = (rc.verified?.count ?? 0) + (rc.live?.count ?? 0) + (rc.planned?.count ?? 0);
  if (sum !== rc.periods_total) {
    fail(c.name, `verified+live+planned=${sum} != periods_total=${rc.periods_total}`);
  }
  // A3: will_change_at_close === (any non-verified in range)
  const wantWillChange = rc.verified.count < rc.periods_total;
  if (!!rc.will_change_at_close !== wantWillChange) {
    fail(c.name, `will_change_at_close=${rc.will_change_at_close}, expected ${wantWillChange}`);
  }
  // A4: summary shape on TBJ - FL FYTD. Kevin ruling 2026-09-02
  // (PR-1 of language pass): FYTD ends at the last closed period, so
  // the summary is just "P1-P8 verified" - no still-running tail.
  if (c.name === "TBJ - FL FYTD") {
    if (rc.summary !== "P1-P8 verified") {
      fail(c.name, `summary=${JSON.stringify(rc.summary)} not "P1-P8 verified" (FYTD closed-only)`);
    }
  }
  if (rc.periods_total > 0 && !rc.summary) {
    fail(c.name, `summary null with periods_total=${rc.periods_total}`);
  }
  // A5: sources.revenue.sources_used === union of statement_rows revenue sources
  const revRows = (j.statement_rows || []).filter(r => r.section === "revenue");
  const stmtSources = new Set();
  for (const r of revRows) for (const s of (r.sources || [])) stmtSources.add(s);
  const popSources = new Set(j.sources?.revenue?.sources_used || []);
  const eqSets = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
  if (!eqSets(stmtSources, popSources)) {
    fail(c.name, `sources.revenue.sources_used=[${[...popSources].sort().join(",")}] != statement rows union=[${[...stmtSources].sort().join(",")}]`);
  }
  // A6: consequence naming
  const revCons = j.sources?.revenue?.consequence || null;
  if (rc.live.count > 0) {
    if (!revCons || !revCons.includes(rc.live.label) || !/will change/i.test(revCons)) {
      fail(c.name, `consequence does not name live period '${rc.live.label}' or "will change": ${JSON.stringify(revCons)}`);
    }
  }
  if (rc.live.count === 0 && rc.planned.count > 0) {
    if (!revCons || !revCons.includes(rc.planned.label)) {
      fail(c.name, `consequence does not name planned period '${rc.planned.label}': ${JSON.stringify(revCons)}`);
    }
  }
  if (rc.verified.count === rc.periods_total) {
    if (revCons != null) {
      fail(c.name, `consequence should be null on all-verified range, got ${JSON.stringify(revCons)}`);
    }
  }
  // A7: FYTD mixed status_line third clause
  const isFytd = j.range?.kind === "fytd";
  const isMixed = rc.periods_total > 1 && rc.verified.count < rc.periods_total;
  const pd = j.status_line?.progress_display;
  if (isFytd && isMixed) {
    const want = `${rc.verified.count} of ${rc.periods_total} periods verified`;
    if (pd !== want) {
      fail(c.name, `status_line.progress_display=${JSON.stringify(pd)} != ${JSON.stringify(want)}`);
    }
  }
}

async function main() {
  console.log(`# range_composition coverage - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}  cases=${CASES.length}`);
  console.log("");
  for (const c of CASES) {
    const before = FAILS.length;
    try { await checkOne(c); } catch (e) { fail(c.name, `threw: ${e.message}`); }
    const after = FAILS.length;
    console.log(`  ${after === before ? "OK  " : "FAIL"} ${c.name}  (${after - before})`);
  }
  console.log("");
  if (FAILS.length === 0) {
    console.log(`Result: range_composition invariants + popover source-union hold across ${CASES.length} configurations.`);
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
