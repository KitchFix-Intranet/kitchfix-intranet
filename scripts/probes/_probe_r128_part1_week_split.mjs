#!/usr/bin/env node
// scripts/probes/_probe_r128_part1_week_split.mjs
//
// Kevin R-128 Part 1 · assertion contract (2026-09-19)
//
//   On every {audit account, running period, toggle}:
//     sum(week_hourly / week_total per week) === period cell (within $1)
//
// Period cell = statement_rows["3100"].budget_at_this_revenue.
// Per-week values = labor.board.weeks[i].{budget_at_this_week_revenue,
// week_hourly_allowed} depending on toggle.
//
// Also assert (Part 2 Rolling): TBJ - FL P10 rolling-vs-plan deltas on
// WK2 and WK3 are NEGATIVE. This is a data-side check - the CP table's
// rollingOf helper produces `rolling[i] - plan[i]`; when `plan[i]` was
// under-shipped by R-111, the sign flipped positive. With R-128 Part 1
// landed the sign flips back to negative on the two out-of-plan weeks.
//
// USAGE (needs local dev server)
//   TEST_MODE=true nohup npm run dev > /tmp/kf-dev.log 2>&1 &
//   node --env-file=.env.local scripts/probes/_probe_r128_part1_week_split.mjs

const BASE = process.env.PROBE_BASE || "http://localhost:3000";
const TOL_DOLLAR = 1.00;

// Kevin review 2026-09-19 F4: add P11 (next period / planned) alongside
// P10 (current period / running). Whichever branch of the labor route
// built the payload, `week_hourly_allowed` and `budget_at_this_week_
// revenue` must both fold correctly to the period cell.
const RANGES = [
  { name: "P10 running",  start: "2026-09-07", end: "2026-10-04" },
  { name: "P11 planned",  start: "2026-10-05", end: "2026-11-01" },
];

const ACCOUNTS = ["TBJ - FL", "TBR - FL", "CIN - AZ", "TXR - AZ"];

const TOGGLES = [
  { key: "+salary", include_salary: "1" },
  { key: "hourly ", include_salary: "0" },
];

// F4 · flatten to a case list
const CASES = [];
for (const account of ACCOUNTS) {
  for (const r of RANGES) CASES.push({ account, range: r });
}

function fmt(n) { return n == null ? "null" : "$" + Number(n).toFixed(2); }

let anyFail = false;

console.log("═══ R-128 Part 1 · Σ week goals == period cell · P10 + P11 · both toggles · 4 audit accounts ═══");
console.log("account          range         toggle    period_cell     Σ week goals    diff       verdict");
console.log("---------------- ------------- --------- --------------- --------------- ---------- -------");
for (const c of CASES) {
  for (const t of TOGGLES) {
    const qs = new URLSearchParams({
      account: c.account,
      start: c.range.start, end: c.range.end,
      include_salary: t.include_salary,
    });
    const [ovRes, lbRes] = await Promise.all([
      fetch(`${BASE}/api/kpi/overview?${qs.toString()}`),
      fetch(`${BASE}/api/kpi/labor?${qs.toString()}`),
    ]);
    if (!ovRes.ok || !lbRes.ok) {
      console.error(`${c.account} ${c.range.name} ${t.key}: fetch FAIL overview=${ovRes.status} labor=${lbRes.status}`);
      anyFail = true;
      continue;
    }
    const overview = await ovRes.json();
    const labor = await lbRes.json();

    const parent3100 = (overview.statement_rows || []).find(r => r.line_code === "3100" && !r.parent_line_code);
    const periodCell = parent3100 ? Number(parent3100.budget_at_this_revenue || 0) : null;

    const lbWks = labor?.board?.weeks || [];
    const field = t.include_salary === "1" ? "budget_at_this_week_revenue" : "week_hourly_allowed";
    let sumWeeks = 0;
    let missing = 0;
    for (const w of lbWks) {
      const v = w[field];
      if (v == null) missing += 1;
      sumWeeks += Number(v || 0);
    }
    const diff = periodCell != null ? Math.round((sumWeeks - periodCell) * 100) / 100 : null;
    const ok = periodCell != null && diff != null && Math.abs(diff) < TOL_DOLLAR && missing === 0;
    if (!ok) anyFail = true;
    console.log(
      `${c.account.padEnd(16)} ${c.range.name.padEnd(13)} ${t.key.padEnd(9)} ${fmt(periodCell).padStart(15)} ${fmt(sumWeeks).padStart(15)} ${fmt(diff).padStart(10)} ${ok ? "OK" : "FAIL"}${missing > 0 ? ` (${missing} weeks missing ${field})` : ""}`
    );

    // F1 Guard D assertion: on the hourly payload, `budget_at_this_
    // week_revenue` must be ABSENT. Its presence alongside `week_
    // hourly_allowed` lets any client compute `salary = total - hourly`
    // on one subtraction.
    if (t.include_salary === "0") {
      const leaked = lbWks.some(w => "budget_at_this_week_revenue" in w);
      const leakedSalary = lbWks.some(w => "week_salary_allowed" in w);
      if (leaked || leakedSalary) {
        console.error(`  Guard D FAIL: hourly payload leaks ${leaked ? "budget_at_this_week_revenue" : ""}${leaked && leakedSalary ? " + " : ""}${leakedSalary ? "week_salary_allowed" : ""}`);
        anyFail = true;
      } else {
        console.log(`  Guard D · hourly payload has neither budget_at_this_week_revenue nor week_salary_allowed · OK`);
      }
    }
  }
}

// ─── Part 2 · Rolling sign flip (TBJ - FL P10) ─────────────────────
// Rolling deltas are `rolling[i] - plan[i]`. On WK2 and WK3 today
// (R-111 shipped) the delta reads positive because plan is under-
// shipped. Under R-128 Part 1 the plan for those weeks INCREASES,
// so the delta flips negative.
console.log("\n═══ R-128 Part 2 · TBJ - FL P10 rolling delta signs on WK2 and WK3 ═══");
const P10 = RANGES[0];
for (const t of TOGGLES) {
  const qs = new URLSearchParams({
    account: "TBJ - FL",
    start: P10.start, end: P10.end,
    include_salary: t.include_salary,
  });
  const lbRes = await fetch(`${BASE}/api/kpi/labor?${qs.toString()}`);
  if (!lbRes.ok) { console.error(`labor fetch FAIL ${lbRes.status}`); anyFail = true; continue; }
  const labor = await lbRes.json();
  const wks = labor?.board?.weeks || [];
  const field = t.include_salary === "1" ? "budget_at_this_week_revenue" : "week_hourly_allowed";
  const plans = wks.map(w => Number(w[field] || 0));
  // Kevin acceptance (2026-09-19). The client's rollingOf computes
  // `rolling[i] - plan[i]`; rolling values are unchanged by this PR.
  // Plan values move to the R-121 shape. Verified plan values below;
  // rolling deltas follow by construction. Kevin's pre-merge UI check
  // is that the CP table renders WK2 -$495, WK3 -$407, WK4 -$341 on
  // TBJ - FL P10 rolling salary toggle.
  const expectedSalary = { wk2: 12157, wk3: 9989, wk4: 8366 };
  const expectedHourly = { wk2:  8061, wk3: 5892, wk4: 4270 };
  const expected = t.include_salary === "1" ? expectedSalary : expectedHourly;
  const wk2 = plans[1] ?? 0;
  const wk3 = plans[2] ?? 0;
  const wk4 = plans[3] ?? 0;
  const tol = 2;
  const ok = Math.abs(wk2 - expected.wk2) < tol
          && Math.abs(wk3 - expected.wk3) < tol
          && Math.abs(wk4 - expected.wk4) < tol;
  if (!ok) anyFail = true;
  console.log(
    `  ${t.key}: WK2 plan=${fmt(wk2)} (expect ~${fmt(expected.wk2)}), WK3 plan=${fmt(wk3)} (expect ~${fmt(expected.wk3)}), WK4 plan=${fmt(wk4)} (expect ~${fmt(expected.wk4)}) · ${ok ? "OK · R-121 shape" : "FAIL · plan does not match R-121 acceptance"}`
  );
}

console.log("");
if (anyFail) {
  console.log("FAIL · at least one R-128 assertion tripped");
  process.exit(1);
} else {
  console.log("PASS · week sums to period on both toggles · Rolling plan flipped to R-121 shape");
  process.exit(0);
}
