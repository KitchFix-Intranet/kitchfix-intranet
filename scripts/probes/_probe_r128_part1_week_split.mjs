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

// Running period for TBJ - FL is P10; other audit accounts share the
// same fiscal period. Kevin's Part 1 acceptance targets all four.
const P10 = { start: "2026-09-07", end: "2026-10-04", label: "P10 (running)" };

const CASES = [
  { account: "TBJ - FL" },
  { account: "TBR - FL" },
  { account: "CIN - AZ" },
  { account: "TXR - AZ" },
];

const TOGGLES = [
  { key: "+salary", include_salary: "1" },
  { key: "hourly ", include_salary: "0" },
];

function fmt(n) { return n == null ? "null" : "$" + Number(n).toFixed(2); }

let anyFail = false;

console.log("═══ R-128 Part 1 · Σ week goals == period cell (both toggles, all 4 audit accounts) ═══");
console.log("account          toggle    period_cell     Σ week goals    diff       verdict");
console.log("---------------- --------- --------------- --------------- ---------- -------");
for (const c of CASES) {
  for (const t of TOGGLES) {
    const qs = new URLSearchParams({
      account: c.account,
      start: P10.start, end: P10.end,
      include_salary: t.include_salary,
    });
    const [ovRes, lbRes] = await Promise.all([
      fetch(`${BASE}/api/kpi/overview?${qs.toString()}`),
      fetch(`${BASE}/api/kpi/labor?${qs.toString()}`),
    ]);
    if (!ovRes.ok || !lbRes.ok) {
      console.error(`${c.account} ${t.key}: fetch FAIL overview=${ovRes.status} labor=${lbRes.status}`);
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
      `${c.account.padEnd(16)} ${t.key.padEnd(9)} ${fmt(periodCell).padStart(15)} ${fmt(sumWeeks).padStart(15)} ${fmt(diff).padStart(10)} ${ok ? "OK" : "FAIL"}${missing > 0 ? ` (${missing} weeks missing ${field})` : ""}`
    );
  }
}

// ─── Part 2 · Rolling sign flip (TBJ - FL P10) ─────────────────────
// Rolling deltas are `rolling[i] - plan[i]`. On WK2 and WK3 today
// (R-111 shipped) the delta reads positive because plan is under-
// shipped. Under R-128 Part 1 the plan for those weeks INCREASES,
// so the delta flips negative.
console.log("\n═══ R-128 Part 2 · TBJ - FL P10 rolling delta signs on WK2 and WK3 ═══");
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
  const total = plans.reduce((s, v) => s + v, 0);
  // Rolling: closed weeks landed at their spent; open weeks re-spread
  // total across running/future revenue. The client's rollingOf is
  // complex; this probe just asserts plan[i] follows the R-121 shape
  // by checking the sign of a synthetic rolling delta = plan[i] versus
  // its R-111 counterpart.
  // Actual sign check reads plan values directly - Kevin's Part 2
  // observation is that plan[i] under R-111 was $10,743 on WK2 for
  // TBJ - FL P10 salary; under R-121 plan[i] is $12,157. If plan[i]
  // now reads > $11,000 on WK2, sign is correct.
  const wk2Plan = plans[1] ?? 0;
  const wk3Plan = plans[2] ?? 0;
  // R-111 shipped WK2 = 10,743 (salary), 6,646 (hourly); R-121 ships
  // WK2 = 12,157 (salary), 8,061 (hourly). Assert plan is > the R-111
  // shape by margin > $500 (the specific WK2 delta is +$1,414 salary,
  // +$1,415 hourly). Both toggles must land higher.
  const wk2Threshold = t.include_salary === "1" ? 11500 : 7500;
  const wk3Threshold = t.include_salary === "1" ? 9750  : 5700;
  const ok = wk2Plan > wk2Threshold && wk3Plan > wk3Threshold;
  if (!ok) anyFail = true;
  console.log(
    `  ${t.key}: WK2 plan=${fmt(wk2Plan)} (threshold ${fmt(wk2Threshold)}), WK3 plan=${fmt(wk3Plan)} (threshold ${fmt(wk3Threshold)}) · ${ok ? "OK · R-121 shape" : "FAIL · R-111 shape suspected"}`
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
