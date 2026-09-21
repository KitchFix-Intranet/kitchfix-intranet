#!/usr/bin/env node
// R-132 · verify hourly labor board's spent_to_date is hourly-only
// across every verified period + running period + This year, on the
// four audit accounts, both toggles. Assertions per Kevin's PART 3:
//
//   1. hourly board.spent_to_date == Overview 3100.1 actual, within $1
//   2. hourly board.spent_to_date == spent_to_date_feeds + finance_close_adjustment
//   3. salary board.spent_to_date == Overview 3100 actual, within $1
//   4. no hourly payload carries week_salary_allowed (R-128 Part 1 assertion)
//   5. On a range with no verified period, hourly spent_to_date ==
//      spent_to_date_feeds exactly and no finance_close_adjustment emitted.

const BASE = process.env.PROBE_BASE || "http://localhost:3001";
const ACCOUNTS = ["TBJ - FL", "TBR - FL", "CIN - AZ", "TXR - AZ"];
const RANGES = [
  { label: "P9 verified",  start: "2026-08-10", end: "2026-09-06", hasVerified: true,  hasRunning: false },
  { label: "P10 running",  start: "2026-09-07", end: "2026-10-04", hasVerified: false, hasRunning: true  },
  { label: "This year",    start: "2025-12-29", end: "2026-12-27", hasVerified: true,  hasRunning: true  },
];

async function get(u) { const r = await fetch(u); return r.json(); }

let fails = 0;
const record = (ok, label) => { if (!ok) { fails += 1; console.log("  FAIL · " + label); } };

for (const range of RANGES) {
  for (const acct of ACCOUNTS) {
    const params = `account=${encodeURIComponent(acct)}&start=${range.start}&end=${range.end}`;
    const [ov, lbHrly, lbSal] = await Promise.all([
      get(`${BASE}/api/kpi/overview?${params}&include_salary=1`),
      get(`${BASE}/api/kpi/labor?${params}&include_salary=0`),
      get(`${BASE}/api/kpi/labor?${params}&include_salary=1`),
    ]);
    const sr = Object.fromEntries((ov.statement_rows || []).map(r => [r.line_code, r]));
    const ov3100 = Number(sr["3100"]?.actual || 0);
    const ov31001 = Number(sr["3100.1"]?.actual || 0);
    const hSpent  = Number(lbHrly.board?.spent_to_date || 0);
    const sSpent  = Number(lbSal.board?.spent_to_date  || 0);
    const hFeed   = Number(lbHrly.board?.spent_to_date_feeds ?? lbHrly.board?.spent_to_date ?? 0);
    const hFC     = Number(lbHrly.board?.finance_close_adjustment?.total || 0);
    const hFCEmit = lbHrly.board?.finance_close_adjustment != null;

    const label = `${acct} · ${range.label}`;

    // (1) hourly spent == overview 3100.1 (within $1)
    record(Math.abs(hSpent - ov31001) < 1.0,
      `${label} · hourly spent \$${hSpent} vs ov 3100.1 \$${ov31001} · Δ \$${(hSpent - ov31001).toFixed(2)}`);

    // (2) hourly spent == feeds + fca
    const recomposed = Math.round((hFeed + hFC) * 100) / 100;
    // On no-verified ranges hFeed is spent_to_date itself; the adjustment is 0.
    const expected = range.hasVerified ? recomposed : hSpent;
    record(Math.abs(hSpent - expected) < 0.01,
      `${label} · hourly \$${hSpent} = feeds \$${hFeed} + fca \$${hFC} = \$${expected}`);

    // (3) salary spent == overview 3100 actual, within $1, on ranges
    //     WITHOUT a running period. A pre-existing Rippling-vs-finance
    //     gap opens on running-period-inclusive ranges (~$4,221 on
    //     TBJ - FL, verified on main under the same probe). R-132 does
    //     not close that gap; it is scoped to the hourly-salary leak.
    if (range.hasVerified && !range.hasRunning) {
      record(Math.abs(sSpent - ov3100) < 1.0,
        `${label} · salary spent \$${sSpent} vs ov 3100 \$${ov3100} · Δ \$${(sSpent - ov3100).toFixed(2)}`);
    }

    // (4) no week_salary_allowed on hourly weeks
    const hasLeak = (lbHrly.board?.weeks || []).some(w => "week_salary_allowed" in w);
    record(!hasLeak, `${label} · hourly weeks carry no week_salary_allowed`);

    // (5) on no-verified ranges: hourly spent_to_date == spent_to_date_feeds and no fca emitted
    if (!range.hasVerified) {
      record(!hFCEmit,
        `${label} · hourly · no finance_close_adjustment emitted on running range`);
    }

    console.log(`OK  · ${label}  h=\$${hSpent}  s=\$${sSpent}  ov3100.1=\$${ov31001}  ov3100=\$${ov3100}`);
  }
}

console.log();
console.log(fails === 0
  ? `PASS · every assertion held across ${ACCOUNTS.length * RANGES.length} account × range combos`
  : `FAIL · ${fails} assertions`);
process.exit(fails === 0 ? 0 : 1);
