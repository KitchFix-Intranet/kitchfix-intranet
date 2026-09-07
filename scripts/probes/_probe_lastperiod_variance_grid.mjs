#!/usr/bin/env node
// PR-A evidence grid (2026-09-08). Four weeks × three surfaces for
// TBJ - FL and TBR - FL Last period. Both raw and adjusted variances
// live on the same payload, so the grid can be reconstructed cleanly:
//
//   bar (pre-fix)    variance = spent - w.original_target
//                    (equivalent to w.delta_vs_original)
//   card (pre-fix)   variance = spent - w.budget_at_this_week_revenue
//   table (pre-fix)  variance = spent - w.week_budget (raw)
//   all three (post) variance = spent - w.budget_at_this_week_revenue
//
// TBR - FL is included specifically because raw ~= adjusted there
// (small delta), so it is the weaker signal - if a residual raw read
// hides anywhere, it hides here.

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
  const sign = n < 0 ? "-" : n > 0 ? "+" : " ";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}
function label(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v) < -0.005 ? "under" : Number(v) > 0.005 ? "over" : "flat";
}

const START = "2026-08-10";
const END = "2026-09-06";

for (const acct of ["TBJ - FL", "TBR - FL"]) {
  console.log(`\n## ${acct} · Last period (${START} - ${END})`);
  const lab = await fetchLab(acct, START, END);
  const weeks = (lab.board?.weeks || []).filter(w => w.state === "closed");
  console.log("");
  console.log("  Week          Spent        Raw week bud  Adj week bud  | Bar (pre)      Card (pre/post)  Table (pre)     | All three (post)");
  console.log("  " + "-".repeat(150));
  for (const w of weeks) {
    const spent = Number(w.spent || 0);
    const rawBud = Number(w.original_target || 0);
    const adjBud = w.budget_at_this_week_revenue != null ? Number(w.budget_at_this_week_revenue) : null;
    const barPre = spent - rawBud;
    const cardPreAndPost = adjBud != null ? spent - adjBud : null;
    const tablePre = spent - rawBud;
    const allPost = cardPreAndPost;
    console.log(`  ${w.week_start}   $${spent.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).padStart(9)}   $${rawBud.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).padStart(9)}     $${adjBud == null ? "     n/a" : adjBud.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).padStart(9)}   | ${fmt$(barPre).padEnd(12)} ${label(barPre).padEnd(6)} ${fmt$(cardPreAndPost).padEnd(12)} ${label(cardPreAndPost).padEnd(6)}  ${fmt$(tablePre).padEnd(12)} ${label(tablePre).padEnd(6)} | ${fmt$(allPost)} ${label(allPost)}`);
  }
}
