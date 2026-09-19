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

    // Kevin R-128 Part 1 review 2026-09-19 · Panel-vs-weeks assertion.
    // `recomputePanelBatrFromPerWeek` sums w.budget_at_this_week_revenue
    // into board.budget_at_this_revenue and persists it. The panel
    // figure must therefore equal the sum of the four week goals on
    // both toggles. Regression the original probe missed: on the hourly
    // path the panel kept the pre-overwrite merged total ($41,055 on
    // TBJ - FL P10) while the four weeks read the hourly allowance
    // ($24,668), a $16,386 gap = salary budget. Fix moved the overwrite
    // above recomputePanelBatrFromPerWeek; this assertion locks it in.
    const panelBatr = labor?.board?.budget_at_this_revenue;
    const panelDiff = panelBatr != null ? Math.round((sumWeeks - Number(panelBatr)) * 100) / 100 : null;
    const panelOk = panelBatr != null && panelDiff != null && Math.abs(panelDiff) < TOL_DOLLAR && missing === 0;
    if (!panelOk) anyFail = true;
    console.log(
      `  panel batr · ${t.key.trim()}: board.budget_at_this_revenue=${fmt(panelBatr)} vs Σ ${field}=${fmt(sumWeeks)} · diff ${fmt(panelDiff)} · ${panelOk ? "OK" : "FAIL"}`
    );

    // F1 Guard D assertion (Kevin review 2026-09-19). On the hourly
    // payload, `budget_at_this_week_revenue` is now PRESENT but
    // overwritten to equal `week_hourly_allowed`, so no operand pair
    // exists to decompose salary. Two checks:
    //   (a) `week_salary_allowed` must be absent.
    //   (b) per-week `budget_at_this_week_revenue === week_hourly_allowed`.
    if (t.include_salary === "0") {
      const leakedSalary = lbWks.some(w => "week_salary_allowed" in w);
      const mismatched = lbWks.filter(w => {
        const total = w.budget_at_this_week_revenue;
        const hourly = w.week_hourly_allowed;
        if (total == null && hourly == null) return false;
        if (total == null || hourly == null) return true;
        return Math.abs(Number(total) - Number(hourly)) > 0.005;
      });
      if (leakedSalary || mismatched.length > 0) {
        if (leakedSalary) console.error(`  Guard D FAIL: hourly payload leaks week_salary_allowed`);
        if (mismatched.length > 0) console.error(`  Guard D FAIL: hourly payload has ${mismatched.length} weeks where budget_at_this_week_revenue !== week_hourly_allowed`);
        anyFail = true;
      } else {
        console.log(`  Guard D · hourly payload: no week_salary_allowed, budget_at_this_week_revenue == week_hourly_allowed on every week · OK`);
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
