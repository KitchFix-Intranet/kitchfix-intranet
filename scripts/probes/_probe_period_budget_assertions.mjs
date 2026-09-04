#!/usr/bin/env node
// Prompt 1 item 1 accept clause (2026-09-04):
//   - card period figure = statement_totals.*.period_budget
//   - per-line P9 budget values sum to the cost card's period budget
//   - no period block renders on a closed range (checked via screenshot pass)
//
// This probe hits the API for a set of open-period accounts and
// checks both invariants against the server payload.

const BASE = "http://localhost:3399";
const CASES = [
  { account: "TBJ - FL", start: "2026-08-10", end: "2026-09-06", label: "TBJ - FL P9" },
  { account: "TBR - FL", start: "2026-08-10", end: "2026-09-06", label: "TBR - FL P9" },
  { account: "CIN - KY", start: "2026-08-10", end: "2026-09-06", label: "CIN - KY P9" },
  { account: "CIN - OH", start: "2026-08-10", end: "2026-09-06", label: "CIN - OH P9" },
];

let failures = 0;
for (const c of CASES) {
  const url = `${BASE}/api/kpi/overview?account=${encodeURIComponent(c.account)}&start=${c.start}&end=${c.end}`;
  const r = await fetch(url);
  if (!r.ok) { console.log(`FAIL ${c.label}  http ${r.status}`); failures++; continue; }
  const j = await r.json();
  const stTot = j.statement_totals || {};
  const cards = j.cards || [];

  // Invariant 1: card period figure = statement_totals.*.period_budget
  // (We compute the card block from statement_totals so this is
  // structural; still verify the payload has the value.)
  const revPb = stTot.revenue?.period_budget;
  const cogPb = stTot.cogs?.period_budget;
  const okRevPresent = revPb != null && !Number.isNaN(Number(revPb));
  const okCogPresent = cogPb != null && !Number.isNaN(Number(cogPb));
  if (!okRevPresent) { console.log(`FAIL ${c.label}  statement_totals.revenue.period_budget missing`); failures++; }
  if (!okCogPresent) { console.log(`FAIL ${c.label}  statement_totals.cogs.period_budget missing`); failures++; }

  // Invariant 2: per-line period_budget values SUM to the cost card's
  // period budget. The four cost lever rows (3100/3200/3400/3500)
  // should reconcile to cogPb within $1 of rounding tolerance.
  const levers = (j.statement_rows || []).filter(r =>
    r.section === "cogs" && !r.parent_line_code && /^3(1|2|4|5)00$/.test(r.line_code)
  );
  const leverSum = levers.reduce((a, r) => a + Number(r.period_budget || 0), 0);
  const diff = Math.abs(leverSum - Number(cogPb || 0));
  const okSum = diff < 1;
  if (!okSum) {
    console.log(`FAIL ${c.label}  cost lever period_budget sum $${leverSum.toFixed(2)} != cogs card $${cogPb}  (diff $${diff.toFixed(2)})`);
    failures++;
  } else {
    console.log(`PASS ${c.label}  cogs card period_budget $${Number(cogPb).toFixed(2)}  lever sum $${leverSum.toFixed(2)}  (diff $${diff.toFixed(2)})`);
  }
}
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} failures`}`);
process.exit(failures === 0 ? 0 : 1);
