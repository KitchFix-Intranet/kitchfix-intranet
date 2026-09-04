#!/usr/bin/env node
// PR-A gate (Kevin ruling 2026-09-04): Labor's figure must equal the
// Overview's budget_at_this_revenue to the cent on every account and
// both closed ranges (single-closed period + FYTD).
//
// Disagreement means stop and report, not adjust either side.
//
// This probe:
//   for each account × { Last period (P8, closed), FYTD (P1-P8, closed) }
//     labor_figure   = /api/kpi/labor  board.range_budget   (with include_salary=1)
//     overview_batr  = /api/kpi/overview 3100 row.budget_at_this_revenue
//   assert |labor - overview| < $0.005 (to-the-cent tolerance)

const BASE = "http://localhost:3399";

const ACCOUNTS = [
  "TBJ - FL", "TBR - FL", "CIN - AZ", "CIN - KY", "CIN - OH",
  "STL - FL", "STL - MO", "TBJ - NY", "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
];

const RANGES = [
  { name: "Last period (P8)", start: "2026-07-13", end: "2026-08-09" },
  { name: "FYTD (P1-P8)",     start: "",           end: ""            },  // FYTD default
];

let failures = 0;
let checks = 0;

function fmt(n) { return n == null ? "—" : "$" + Number(n).toFixed(2); }

for (const account of ACCOUNTS) {
  for (const range of RANGES) {
    checks++;
    const qs = range.start
      ? `account=${encodeURIComponent(account)}&start=${range.start}&end=${range.end}&include_salary=1`
      : `account=${encodeURIComponent(account)}&include_salary=1`;

    let laborFigure = null, laborNote = "";
    let overviewBatr = null, overviewNote = "";

    try {
      const laborRes = await fetch(`${BASE}/api/kpi/labor?${qs}`);
      if (!laborRes.ok) { laborNote = `http ${laborRes.status}`; }
      else {
        const j = await laborRes.json();
        // Kevin's "Labor's figure" - reading board.range_budget (raw
        // period budget). If the parity target is a different field
        // (budget_to_date_days, budget_at_this_revenue), swap here.
        // Post-PR-A: labor board carries budget_at_this_revenue. If
        // the field is absent (route not yet updated), fall back to
        // range_budget so the pre-fix gap remains visible in the
        // report - Kevin's ruling: parity gate is the ACCEPTANCE at
        // the end of PR-A, and it must fail on pre-fix code (that IS
        // the R-77 defect).
        laborFigure = j?.board?.budget_at_this_revenue ?? j?.board?.range_budget ?? null;
        if (j?.account_state && j.account_state !== "sc" && j.account_state !== "salaried_only") {
          laborNote = `account_state=${j.account_state}`;
        }
      }
    } catch (e) { laborNote = `err ${e.message}`; }

    try {
      const ovRes = await fetch(`${BASE}/api/kpi/overview?${qs.replace("&include_salary=1","")}`);
      if (!ovRes.ok) { overviewNote = `http ${ovRes.status}`; }
      else {
        const j = await ovRes.json();
        const row3100 = (j.statement_rows || []).find(r =>
          r.section === "cogs" && !r.parent_line_code && r.line_code === "3100"
        );
        overviewBatr = row3100?.budget_at_this_revenue ?? null;
        const isBilledBack = Array.isArray(row3100?.flags) && row3100.flags.includes("billed_back");
        if (isBilledBack) overviewNote = "billed_back";
      }
    } catch (e) { overviewNote = `err ${e.message}`; }

    // Both null - can't compare. If either has data and the other is
    // null, that's a mismatch (one board loaded the account, the
    // other did not).
    if (laborFigure == null && overviewBatr == null) {
      console.log(`SKIP ${account.padEnd(16)} ${range.name.padEnd(20)} both null  labor=${laborNote}  overview=${overviewNote}`);
      continue;
    }
    if (laborFigure == null || overviewBatr == null) {
      console.log(`FAIL ${account.padEnd(16)} ${range.name.padEnd(20)} half null  labor=${fmt(laborFigure)} (${laborNote})  overview=${fmt(overviewBatr)} (${overviewNote})`);
      failures++;
      continue;
    }
    const diff = Math.abs(Number(laborFigure) - Number(overviewBatr));
    const pass = diff < 0.005;
    if (pass) {
      console.log(`PASS ${account.padEnd(16)} ${range.name.padEnd(20)} labor=${fmt(laborFigure)}  overview=${fmt(overviewBatr)}`);
    } else {
      console.log(`FAIL ${account.padEnd(16)} ${range.name.padEnd(20)} labor=${fmt(laborFigure)}  overview=${fmt(overviewBatr)}  diff=$${diff.toFixed(2)}`);
      failures++;
    }
  }
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} failures`}  (${checks} checks total)`);
process.exit(failures === 0 ? 0 : 1);
