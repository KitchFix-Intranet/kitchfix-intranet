#!/usr/bin/env node
// scripts/probes/_probe_r67_contractual_accrual_report.mjs
//
// R-67 (2026-09-03): Kevin's ruling PR-A pre-build report.
//
// A contractual revenue line (2200 catering, 2300 service charges,
// 2600 consulting) accrues its period budget × N complete weeks / 4
// on any range with at least one complete week. Today those lines
// render "not reported" when the account is on sc_live per-meal,
// silently dropping earned contractual revenue.
//
// This probe computes BEFORE and AFTER for every account on the
// verification range (TBJ - FL P9 open, current default open range).
// AFTER is the arithmetic Kevin's PR-A rule prescribes; no code
// change has landed yet.
//
// Predicate proposal (data-derived):
//   line is contractual for (account, period) iff
//     line_code IN {2200, 2300, 2600}  AND
//     kpi_budgets_overview has a non-null period_budget for
//     that account+period  AND
//     the row currently renders reported=false.
//
// 2400.1 + 2400.2 are meal-service, count-derived, and stay handled
// by the SC / planned picker (no double-accrual). On fee accounts
// the only revenue line is 2400.1 (contractual, already accrues in
// the picker) - the new rule leaves fee accounts unchanged.
//
// USAGE
//   TEST_MODE=true PORT=3399 npm run dev &
//   node scripts/probes/_probe_r67_contractual_accrual_report.mjs

const BASE = process.env.BASE || "http://localhost:3399";
const acct = (k) => encodeURIComponent(k);

const ACCOUNTS = [
  "CIN - AZ", "CIN - KY", "CIN - OH",
  "STL - FL", "STL - MO",
  "TBJ - FL", "TBJ - NY", "TBR - FL",
  "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
];

// Contractual candidate lines (per-meal accounts). Fee accounts only
// carry 2400.1 as a revenue line; this predicate never fires on them.
const CONTRACTUAL_LINES = new Set(["2200", "2300", "2600"]);

function fmt$(n) {
  if (n == null || Number.isNaN(Number(n))) return "-";
  const v = Number(n);
  const s = "$" + Math.abs(Math.round(v)).toLocaleString("en-US");
  return v < 0 ? "-" + s : s;
}
function pct(a, b) {
  if (a == null || b == null || b === 0) return null;
  return (Number(a) / Number(b)) * 100;
}
function fmtPct(p) {
  if (p == null) return "-";
  return `${Number(p).toFixed(1)}%`;
}
function verdictOf(costPct, targetPct) {
  if (costPct == null || targetPct == null) return "-";
  const gap = costPct - targetPct;
  const dir = gap >= 0 ? "over" : "under";
  return `${Math.abs(gap).toFixed(1)}% ${dir}`;
}

async function fetchOverview(a, qs = "") {
  // include_salary=1 to match how Kevin reads the board (lever + card
  // include salary). Without it cogs on TBJ - FL P9 is $49,676; with it
  // matches Kevin's spec at $59,879.
  const extra = "include_salary=1";
  const merged = qs ? `${qs}&${extra}` : extra;
  const url = `${BASE}/api/kpi/overview?account=${acct(a)}&${merged}`;
  const r = await fetch(url);
  if (!r.ok) return { error: `HTTP ${r.status}` };
  return await r.json();
}

const RANGES = [
  { name: "P9 open",  qs: "start=2026-08-10&end=2026-09-06" },
  { name: "P8 closed", qs: "start=2026-07-13&end=2026-08-09" },
  { name: "FYTD",     qs: "" },
];

function analyze(a, j) {
  if (j.error) return { account: a, error: j.error };
  const cards = j.cards || [];
  const revCard = cards.find(c => c.key === "revenue");
  const cogsCard = cards.find(c => c.key === "cogs");
  const rows = (j.statement_rows || []).filter(r => r.section === "revenue");

  // BEFORE: current revenue/cogs/cost%/margin%
  const revBefore = revCard?.hero_actual;
  const cogs = cogsCard?.hero_actual;
  // Kevin's spec 53.4% target = budget_at_this_revenue / revenue.
  // cogsCard.target_pct is a different measure (budget/budget over
  // full-period sums); use the adjusted derivation to match spec.
  const budAtThisRev = cogsCard?.budget_at_this_revenue;
  const targetPct = pct(budAtThisRev, revBefore);
  const costPctBefore = pct(cogs, revBefore);
  const marginBefore = revBefore != null ? 100 - costPctBefore : null;
  const verdictBefore = verdictOf(costPctBefore, targetPct);

  // Predicate (Kevin ruling 2026-09-03 confirming R-67):
  //   - line ∈ {2200, 2300, 2600}
  //   - revenue_model === "sc_driven" (fee + sales_based accounts
  //     have pickers that skip 2200/2300/2600 entirely; accruing
  //     there would mask loader defects like STL - MO 2300 $35,715)
  //   - period_state !== "verified" (verified means finance booked
  //     nothing → nothing is the answer; if we're missing an actual
  //     that's a loader bug and it must stay visible)
  //   - reported === false
  //   - non-zero budget-to-date
  const accrualRows = [];
  let accruedTotal = 0;
  const isSc = j.revenue_model === "sc_driven";
  const isVerified = j.period_state === "verified";
  if (isSc && !isVerified) {
    for (const row of rows) {
      if (!CONTRACTUAL_LINES.has(row.line_code)) continue;
      if (row.reported) continue;
      if (row.budget_to_date == null) continue;
      if (Number(row.budget_to_date) === 0) continue;
      const isInactive = Array.isArray(row.flags) && row.flags.includes("inactive");
      if (isInactive) continue;
      accrualRows.push({ line: row.line_code, amount: Number(row.budget_to_date) });
      accruedTotal += Number(row.budget_to_date);
    }
  }

  // AFTER: revenue += accrued; cogs unchanged. Target% is the target
  // COST ratio (cogs_budget / rev_budget) - a fixed account plan, not
  // a function of actual revenue. Same before and after per Kevin's
  // spec ("Target 53.4% 53.4%").
  const revAfter = revBefore != null ? revBefore + accruedTotal : null;
  const costPctAfter = pct(cogs, revAfter);
  const marginAfter = revAfter != null ? 100 - costPctAfter : null;
  const verdictAfter = verdictOf(costPctAfter, targetPct);

  return {
    account: a,
    range_label: j.range_labels?.horizon || j.range_labels?.period_span,
    period_state: j.period_state,
    rev_model: j.revenue_model,
    accrual_rows: accrualRows,
    accrued_total: accruedTotal,
    revBefore, revAfter,
    cogs,
    costPctBefore, costPctAfter, targetPct,
    marginBefore, marginAfter,
    verdictBefore, verdictAfter,
    verdictChanged: verdictBefore !== verdictAfter,
  };
}

function main() {
  return (async () => {
    console.log(`# R-67 contractual accrual · before/after · ${new Date().toISOString()}`);
    console.log(`# BASE=${BASE}`);

    for (const range of RANGES) {
      console.log(`\n\n# ===== ${range.name} =====\n`);
      const results = [];
      for (const a of ACCOUNTS) {
        const j = await fetchOverview(a, range.qs);
        results.push(analyze(a, j));
      }

      console.log("## Per-account rundown\n");
      console.log("| Account | Rev before | Rev after | Cost% before | Cost% after | Target% | Verdict before | Verdict after | Margin before | Margin after | Accrual |");
      console.log("|---|---:|---:|---:|---:|---:|---|---|---:|---:|---:|");
      for (const r of results) {
        if (r.error) { console.log(`| ${r.account} | ERROR ${r.error} |`); continue; }
        const chg = r.verdictChanged ? " ⚠️" : "";
        console.log(
          `| ${r.account} | ${fmt$(r.revBefore)} | ${fmt$(r.revAfter)} | ${fmtPct(r.costPctBefore)} | ${fmtPct(r.costPctAfter)} | ${fmtPct(r.targetPct)} | ${r.verdictBefore} | ${r.verdictAfter}${chg} | ${fmtPct(r.marginBefore)} | ${fmtPct(r.marginAfter)} | ${fmt$(r.accrued_total)} |`
        );
      }

      console.log("\n## Accrual sources per account\n");
      for (const r of results) {
        if (r.error) continue;
        if (r.accrual_rows.length === 0) {
          console.log(`- **${r.account}** [${r.rev_model} · ${r.period_state}]: no contractual accrual`);
        } else {
          const parts = r.accrual_rows.map(x => `${x.line}=${fmt$(x.amount)}`).join(", ");
          console.log(`- **${r.account}** [${r.rev_model} · ${r.period_state}]: ${parts} → ${fmt$(r.accrued_total)}`);
        }
      }

      console.log("\n## Verdict changes\n");
      const changed = results.filter(r => !r.error && r.verdictChanged);
      if (changed.length === 0) {
        console.log("_No verdict changes._");
      } else {
        for (const r of changed) {
          console.log(`- **${r.account}**: ${r.verdictBefore} → ${r.verdictAfter} (rev ${fmt$(r.revBefore)} → ${fmt$(r.revAfter)}, cost% ${fmtPct(r.costPctBefore)} → ${fmtPct(r.costPctAfter)})`);
        }
      }

      console.log("\n## Fee-account double-count check\n");
      for (const r of results) {
        if (r.error) continue;
        if (r.rev_model !== "management_fee") continue;
        const parts = r.accrual_rows.length === 0 ? "no accrual (predicate excludes 2400.1)" : `⚠️ WOULD DOUBLE-COUNT: ${r.accrual_rows.map(x => x.line).join(", ")}`;
        console.log(`- ${r.account}: ${parts}`);
      }
    }
  })();
}

main().catch(e => { console.error(e); process.exit(1); });
