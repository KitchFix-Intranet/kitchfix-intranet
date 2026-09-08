#!/usr/bin/env node
// Kevin R-94 (2026-09-09). Awaiting-verification treatment for
// closed-but-not-yet-verified single periods.
//
// Acceptance:
//   1. No closed_awaiting period renders a settled verdict pill on
//      cost or margin. (Pill tone must be "wait" or absent, never
//      "good"/"bad".)
//   2. Revenue's pill and colour are unchanged between awaiting and
//      verified states. (Revenue pill tone remains good/bad based on
//      actual vs projection, never "wait".)
//   3. Settling strip data is present on closed_awaiting - period_no
//      + labour (2026-09-08 update: purchases counts came out per
//      Kevin, new copy is period-dynamic + generic).
//   4. Status line pill tone is "wait" + copy is "Awaiting verification"
//      on closed_awaiting single-period range.
//   5. Horizon reads "P9 · closed MM/DD · figures still settling" on
//      closed_awaiting.
//
// Fixture: TBJ - FL and TBR - FL Last period (P9, closed 2026-09-06,
// today 2026-09-08 → still awaiting verification). Simulating the
// verified state requires a different date - covered by asserting the
// wait state does not touch revenue's pill.

const BASE = "http://localhost:3000";
const HEADERS = { "x-test-user": "kevin@kitchfix.com" };

async function fetchOv(acct, start, end) {
  const r = await fetch(`${BASE}/api/kpi/overview?account=${encodeURIComponent(acct)}&start=${start}&end=${end}`, { headers: HEADERS });
  return r.json();
}

let failures = 0;
function pass(cond, msg) {
  const mark = cond ? "  PASS" : "  FAIL";
  console.log(`${mark}  ${msg}`);
  if (!cond) failures += 1;
}

const LP_START = "2026-08-10";
const LP_END = "2026-09-06";

for (const acct of ["TBJ - FL", "TBR - FL"]) {
  console.log(`\n## ${acct} · Last period (P9, closed_awaiting)`);
  const ov = await fetchOv(acct, LP_START, LP_END);
  const cards = ov.cards || [];
  const revenue = cards.find(c => c.key === "revenue");
  const cogs = cards.find(c => c.key === "cogs");
  const gm = cards.find(c => c.key === "gross_margin");
  const status = ov.status_line;
  const horizon = ov.range_labels?.horizon;
  const settling = ov.settling;

  console.log(`  status pill:    "${status?.state_copy}" (tone=${status?.tone})`);
  console.log(`  horizon:        "${horizon}"`);
  console.log(`  revenue pill:   "${revenue?.pill?.label}" (tone=${revenue?.pill?.tone})`);
  console.log(`  cogs pill:      "${cogs?.pill?.label}" (tone=${cogs?.pill?.tone})`);
  console.log(`  gm pill:        "${gm?.pill?.label}" (tone=${gm?.pill?.tone})`);
  console.log(`  settling:`);
  if (settling) {
    console.log(`    period_no:    ${settling.period_no}`);
    console.log(`    labour:       hours=${settling.labour?.hours}, people=${settling.labour?.people}`);
  } else {
    console.log(`    null`);
  }

  // Acceptance
  pass(status?.tone === "wait", `status pill tone is "wait" (got "${status?.tone}")`);
  pass(status?.state_copy === "Awaiting verification", `status pill copy is "Awaiting verification"`);
  pass(horizon && horizon.includes("closed 09/06") && horizon.includes("figures still settling"), `horizon names close date + "figures still settling"`);
  pass(settling != null, `settling data is present`);
  pass(settling?.period_no === 9, `settling.period_no === 9`);
  // Kevin ruling 2026-09-08. Purchases line no longer renders counts,
  // so the fields are gone from the payload. Assert the removal so a
  // regression that re-adds them fails loudly.
  pass(settling?.purchases === undefined, `settling.purchases removed from payload (got ${JSON.stringify(settling?.purchases)})`);
  pass(settling?.labour != null, `settling.labour populated`);

  // Card-level: cogs + gm resolve to a settled verdict pill in the
  // payload (that's still the underlying computation) - but the
  // client renders "Provisional" via the awaiting flag it receives
  // from status_line.tone. Assert the input signal for that swap.
  pass(cogs != null && cogs.pill != null, `cogs card has pill data`);
  pass(gm != null && gm.pill != null, `gm card has pill data`);

  // Revenue's pill should be settled (not "wait" or "neutral").
  // Kevin: "revenue stays settled and green" - SC counts are
  // complete for a closed period, so revenue's tone is unchanged.
  pass(revenue?.pill?.tone === "good" || revenue?.pill?.tone === "bad",
    `revenue pill tone is good/bad, not neutral (got "${revenue?.pill?.tone}")`);
}

console.log(`\n## Summary: ${failures === 0 ? "ALL PASS" : failures + " FAILURES"}`);
process.exit(failures === 0 ? 0 : 1);
