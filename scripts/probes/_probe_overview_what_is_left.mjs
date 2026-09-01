#!/usr/bin/env node
// scripts/probes/_probe_overview_what_is_left.mjs
//
// R-34 gate assertion. Read-only.
// "What is left" is open-period only + site-posture only. Absent on:
//   - corporate posture
//   - closed periods (verified, closed_awaiting)
//   - FYTD (applying an open period's remaining days to a year is
//     wrong arithmetic)
//
// Runs against a local TEST_MODE dev server on :3311, same pattern as
// the other overview probes. Fails loud on any regression.

const BASE = "http://localhost:3311/api/kpi/overview";

const cases = [
  {
    name: "site_leader / open period P9 -> present",
    url: `${BASE}?account=CIN%20-%20AZ&range=period:9&_test_role=site_leader&_test_scope=CIN%20-%20AZ`,
    expect: "object",
  },
  {
    name: "site_leader / closed period P8 -> null",
    url: `${BASE}?account=CIN%20-%20AZ&range=period:8&_test_role=site_leader&_test_scope=CIN%20-%20AZ`,
    expect: "null",
  },
  {
    name: "site_leader / FYTD -> null",
    url: `${BASE}?account=CIN%20-%20AZ&range=fytd&_test_role=site_leader&_test_scope=CIN%20-%20AZ`,
    expect: "null",
  },
  {
    name: "corporate / open period P9 -> null",
    url: `${BASE}?account=CIN%20-%20AZ&range=period:9`,
    expect: "null",
  },
  {
    name: "corporate / FYTD -> null",
    url: `${BASE}?account=CIN%20-%20AZ&range=fytd`,
    expect: "null",
  },
];

async function main() {
  console.log(`# R-34 what_is_left absence gate - ${new Date().toISOString()}`);
  console.log("");
  let pass = 0, fail = 0;
  for (const c of cases) {
    const r = await fetch(c.url);
    if (!r.ok) {
      console.log(`  FAIL  ${c.name}  http=${r.status}`);
      fail += 1; continue;
    }
    const j = await r.json();
    const w = j.what_is_left;
    const shape = w == null ? "null" : "object";
    const ok = shape === c.expect;
    if (ok) pass += 1; else fail += 1;
    const detail = w == null
      ? "null"
      : `days_elapsed=${w.days_elapsed} days_remaining=${w.days_remaining} pace=${w.pace}`;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${c.name}  got=${shape} expected=${c.expect}  (${detail})`);
  }
  console.log("");
  console.log(`Result: ${pass} PASS, ${fail} FAIL across ${cases.length} assertions`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
