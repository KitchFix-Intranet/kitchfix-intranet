#!/usr/bin/env node
// scripts/probes/_probe_finance_close_no_double_count.mjs
//
// Kevin ruling 2026-09-18 · Guard J.
// The parent line is computed once. Assert on every {account, range}
// that a parent's actual equals the sum of all statement_rows whose
// parent_line_code === parent.line_code. If any downstream consumer
// starts re-deriving a parent from children (or the FIN_CLOSE emit
// double-counts), this probe fires with the specific parent that broke.
//
// Covers zero-adjustment cases (TBJ - FL P9 3500 · Kevin's worked
// example) and non-zero cases across audited + non-audited accounts.
//
// USAGE
//   TEST_MODE=true node --env-file=.env.local scripts/probes/_probe_finance_close_no_double_count.mjs
// (assumes local dev server is running at http://localhost:3000)

const BASE = process.env.PROBE_BASE || "http://localhost:3000";
const HEADERS = { "x-test-mode": "true" };

// Kevin acceptance cases from the ruling doc + effect matrix.
const CASES = [
  { account: "TBJ - FL", start: "2026-08-10", end: "2026-09-06",
    expected: { cogs: 87521.69, gross: null }, name: "TBJ - FL P9" },
  { account: "TXR - AZ", start: "2026-08-10", end: "2026-09-06",
    expected: { cogs: 55498.46, gross: null }, name: "TXR - AZ P9" },
  { account: "CIN - OH", start: "2026-08-10", end: "2026-09-06",
    expected: { cogs: null, gross: null }, name: "CIN - OH P9 (pass-through)" },
  { account: "TBJ - NY", start: "2026-08-10", end: "2026-09-06",
    expected: { cogs: null, gross: null }, name: "TBJ - NY P9 (fee account)" },
];

const PARENTS = ["3100", "3200", "3400", "3500"];
let anyFail = false;

for (const c of CASES) {
  const qs = new URLSearchParams({ account: c.account, start: c.start, end: c.end, include_salary: "1" });
  const url = `${BASE}/api/kpi/overview?${qs.toString()}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    console.error(`FAIL fetch · ${c.name} · ${res.status} · ${(await res.text()).slice(0, 200)}`);
    anyFail = true;
    continue;
  }
  const body = await res.json();
  const rows = body.statement_rows || [];

  console.log(`\n─── ${c.name} · ${c.account} · ${c.start} to ${c.end} ─────`);
  for (const parent of PARENTS) {
    const parentRow = rows.find(r => r.line_code === parent && !r.parent_line_code);
    const children = rows.filter(r => r.parent_line_code === parent);
    if (!parentRow || parentRow.actual == null) {
      console.log(`  ${parent}: parent absent or null actual, skipping`);
      continue;
    }
    const childSum = children.reduce((s, r) => s + Number(r.actual || 0), 0);
    const parentActual = Number(parentRow.actual);
    const finCloseRow = children.find(r => (r.flags || []).includes("finance_close_adjustment"));
    const hasFinClose = !!finCloseRow;
    const finCloseAmt = finCloseRow ? Number(finCloseRow.actual) : 0;
    const invjeRow = children.find(r => r.line_code === `${parent}.INVJE`);
    const invjeAmt = invjeRow ? Number(invjeRow.actual) : 0;
    const subs = children.filter(r =>
      !((r.flags || []).includes("finance_close_adjustment")) &&
      r.line_code !== `${parent}.INVJE`);

    // Guard J: no double count. When children are present, parent must
    // equal child sum to a cent. If not, either the parent was set
    // twice or FIN_CLOSE emitted double.
    if (children.length === 0) {
      console.log(`  ${parent}: parentActual=${parentActual.toFixed(2)} · no children (invariant N/A)`);
      continue;
    }
    const diff = Math.round((parentActual - childSum) * 100) / 100;
    const status = Math.abs(diff) < 0.02 ? "OK" : "FAIL";
    if (status === "FAIL") anyFail = true;
    console.log(
      `  ${parent}: parent=${parentActual.toFixed(2).padStart(10)}  child_sum=${childSum.toFixed(2).padStart(10)}  diff=${diff.toFixed(2).padStart(8)}  ` +
      `subs=${subs.length}  INVJE=${invjeAmt.toFixed(2).padStart(9)}  FIN_CLOSE=${finCloseAmt.toFixed(2).padStart(9)}  · ${status}`
    );
  }
  // Cost of goods card check
  const cogsCard = (body.cards || []).find(c => c.key === "cogs");
  if (cogsCard) {
    console.log(`  cogs card hero_actual = $${Number(cogsCard.hero_actual).toFixed(2)}${c.expected.cogs != null ? ` · expect $${c.expected.cogs}` : ''}`);
    if (c.expected.cogs != null && Math.abs(Number(cogsCard.hero_actual) - c.expected.cogs) > 0.02) {
      console.error(`  FAIL: cogs card mismatches expected acceptance`);
      anyFail = true;
    }
  }
}

// Guard L check: on the labor endpoint, spent_to_date == spent_to_date_feeds
// + finance_close_adjustment.total. Same assert shape.
console.log("\n═══ Guard L · labor.board.spent_to_date invariant ═══════════════");
for (const c of CASES) {
  const qs = new URLSearchParams({ account: c.account, start: c.start, end: c.end, include_salary: "1" });
  const url = `${BASE}/api/kpi/labor?${qs.toString()}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) { console.error(`  ${c.name}: labor fetch FAIL ${res.status}`); anyFail = true; continue; }
  const body = await res.json();
  const board = body.board;
  if (!board || board.applies === false) { console.log(`  ${c.name}: labor board does not apply`); continue; }
  const spent = Number(board.spent_to_date ?? 0);
  const feeds = Number(board.spent_to_date_feeds ?? 0);
  const fc = board.finance_close_adjustment;
  const adj = Number(fc?.total ?? 0);
  const check = feeds + adj;
  const diff = Math.round((spent - check) * 100) / 100;
  const status = Math.abs(diff) < 0.02 ? "OK" : "FAIL";
  if (status === "FAIL") anyFail = true;
  console.log(
    `  ${c.name}: spent=${spent.toFixed(2)} · feeds=${feeds.toFixed(2)} · adj=${adj.toFixed(2)} · feeds+adj=${check.toFixed(2)} · diff=${diff.toFixed(2)} · ${status}`
  );
}

console.log("");
if (anyFail) {
  console.log("FAIL · at least one assertion tripped");
  process.exit(1);
} else {
  console.log("PASS · every parent equals sum of its children, every labor board reconciles feeds+adjustment");
  process.exit(0);
}
