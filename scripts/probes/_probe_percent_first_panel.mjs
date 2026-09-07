#!/usr/bin/env node
// Kevin post-1057 sweep · panel percent-first (2026-09-08). Six
// combinations: TBJ - FL and TBR - FL × This year / Last period /
// This period. For each, print what the panel renders under the new
// grammar: Actual %/$, Target %/$, Over-or-Under target ▲/▼ $, and
// the pill state. For This period, prints the "Spent so far / Budget /
// No percentage yet" branch instead.
//
// Cross-references docs/renders/labor-panel-percent-first.html for
// value parity with Kevin's approved render (post-fix panel batr).

const BASE = "http://localhost:3000";
const HEADERS = { "x-test-user": "kevin@kitchfix.com" };

async function fetchLab(acct, start, end) {
  const url = `${BASE}/api/kpi/labor?account=${encodeURIComponent(acct)}&start=${start}&end=${end}&include_salary=1`;
  const r = await fetch(url, { headers: HEADERS });
  return r.json();
}
function fmt$(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}
function pill(verdict, noRev) {
  if (noRev) return "Nothing earned yet (neu)";
  if (verdict === "on_track") return "On target (good)";
  if (verdict === "watch") return "Over target (bad)";  // Kevin binary: watch collapses to Over target
  if (verdict === "over") return "Over target (bad)";
  return "—";
}
const RANGES = [
  { key: "TY", label: "This year", start: "2025-12-29", end: "2026-10-04" },
  { key: "LP", label: "Last period", start: "2026-08-10", end: "2026-09-06" },
  { key: "TP", label: "This period", start: "2026-09-07", end: "2026-10-04" },
];

console.log("\n# Panel percent-first · six combinations · post-fix\n");
for (const acct of ["TBJ - FL", "TBR - FL"]) {
  console.log(`## ${acct}\n`);
  for (const range of RANGES) {
    const lab = await fetchLab(acct, range.start, range.end);
    const b = lab.board || {};
    const spent = b.closed_spent_to_date != null ? Number(b.closed_spent_to_date) : (b.spent_to_date != null ? Number(b.spent_to_date) : null);
    const batr = b.budget_at_this_revenue != null ? Number(b.budget_at_this_revenue) : null;
    const revenueEarned = (typeof b.total_revenue_for_batr === "number" && b.total_revenue_for_batr > 0) ? b.total_revenue_for_batr : null;
    const weeks = b.weeks || [];
    const forecastRev = weeks.reduce((s, w) => s + (w.week_revenue != null ? Number(w.week_revenue) : 0), 0);
    const rangeRevForTgt = revenueEarned != null ? revenueEarned : (forecastRev > 0 ? forecastRev : null);
    const actPct = (revenueEarned != null && spent != null) ? (spent / revenueEarned) * 100 : null;
    const tgtPct = (rangeRevForTgt != null && batr != null) ? (batr / rangeRevForTgt) * 100 : null;
    const variance = (spent != null && batr != null) ? (spent - batr) : null;
    const noRev = revenueEarned == null;
    const p = pill(b.verdict, noRev);
    const arrow = variance == null ? "" : (variance > 0.005 ? "▲" : variance < -0.005 ? "▼" : "·");
    const overOrUnder = variance == null ? "—" : (variance > 0.005 ? "Over target" : variance < -0.005 ? "Under target" : "On target");
    console.log(`### ${range.label}`);
    console.log(`  pill:      ${p}`);
    if (noRev) {
      console.log(`  Spent so far   ${fmt$(spent)}`);
      console.log(`  Budget         ${fmt$(batr)}   ${tgtPct != null ? tgtPct.toFixed(1) + "% target" : "—"}`);
      const usedPct = (spent != null && batr != null && batr > 0) ? (spent / batr) * 100 : null;
      console.log(`  → "No percentage yet. ${usedPct != null ? usedPct.toFixed(1) + '% of the budget used.' : ''}"`);
    } else {
      console.log(`  Actual     ${actPct != null ? actPct.toFixed(1) + "%" : "—"}   ${fmt$(spent)}`);
      console.log(`  Target     ${tgtPct != null ? tgtPct.toFixed(1) + "%" : "—"}   ${fmt$(batr)}`);
      console.log(`  Foot       ${overOrUnder}   ${arrow} ${fmt$(variance != null ? Math.abs(variance) : null)}`);
    }
    console.log("");
  }
}
