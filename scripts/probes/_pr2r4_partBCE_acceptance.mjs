// PR2 R4 Parts B/C/E acceptance probe.
//
// B - tier C per-period budget: ALL FYTD Food -> 9 different values,
//     matched to route.periods[].by_bucket.food.budget.
// C - bar colors: check that WeekChart emits st-under/st-over on state
//     bars (identity is fallback only for no-target / no-verdict).
//     This runs a code-read on the source; visual verification is a
//     screenshot below.
// E - freshness pill: cards_through field populated (date, derived).

import fs from "node:fs";
const BASE = process.env.PROBE_BASE || "http://localhost:3221";

async function main() {
  console.log("=".repeat(72));
  console.log("PR-2 R4 Parts B/C/E acceptance");
  console.log("=".repeat(72));

  // ── B ────────────────────────────────────────────────────────
  console.log("\n== Part B: ALL FYTD Food tier C targets ==");
  const bResp = await fetch(`${BASE}/api/kpi/purchasing?account=ALL&start=2025-12-29&end=2026-08-24`);
  const bJson = await bResp.json();
  const foodPer = bJson.periods.map(p => ({ p: p.period_no, budget: p.by_bucket?.food?.budget || 0, spent: p.by_bucket?.food?.spent || 0 }));
  const distinctBudgets = new Set(foodPer.map(r => r.budget));
  console.log("| period | food budget | food spent |");
  console.log("|---|---|---|");
  for (const r of foodPer) {
    console.log("| P" + r.p + " | $" + r.budget.toLocaleString() + " | $" + r.spent.toLocaleString() + " |");
  }
  console.log("\ndistinct budget values across 9 periods:", distinctBudgets.size, "(expected: > 1, ideally all 9 unique)");
  console.log("Part B PASS:", distinctBudgets.size > 1 ? "yes" : "NO (still flat)");

  // TBR-FL context for Kevin's ruling anchor.
  const tbrResp = await fetch(`${BASE}/api/kpi/purchasing?account=${encodeURIComponent("TBR - FL")}&start=2025-12-29&end=2026-08-24`);
  const tbrJson = await tbrResp.json();
  const tbrFood = tbrJson.periods.map(p => ({ p: p.period_no, budget: p.by_bucket?.food?.budget || 0 }));
  console.log("\nTBR - FL Food per-period budgets (context - Kevin's anchor):");
  for (const r of tbrFood) console.log("  P" + r.p + " budget=$" + r.budget.toLocaleString());
  const p1Bud = tbrFood.find(r => r.p === 1)?.budget;
  const p3Bud = tbrFood.find(r => r.p === 3)?.budget;
  console.log("  P1 budget matches Kevin's $4,264:", p1Bud === 4264);
  console.log("  P3 budget matches Kevin's $164,897:", Math.abs(p3Bud - 164897.20) < 1);

  // ── C ────────────────────────────────────────────────────────
  console.log("\n== Part C: bar color source ==");
  const wc = fs.readFileSync("src/app/kpi/purchasing/components/WeekChart.js", "utf-8");
  const stUnderPresent = wc.includes("st-under");
  const stOverPresent  = wc.includes("st-over");
  console.log("WeekChart.js emits 'st-under':", stUnderPresent);
  console.log("WeekChart.js emits 'st-over':", stOverPresent);
  const css = fs.readFileSync("src/app/kpi/purchasing/purchasing.css", "utf-8");
  const cssStUnder = /\.kpi-p-bar\.st-under\s*\{\s*background:\s*var\(--green-500\)/.test(css);
  const cssStOver  = /\.kpi-p-bar\.st-over\s*\{\s*background:\s*#DC5A5A/.test(css);
  console.log("purchasing.css st-under -> --green-500:", cssStUnder);
  console.log("purchasing.css st-over -> #DC5A5A:", cssStOver);
  // Cross-check labor's tokens
  const kpiCss = fs.readFileSync("src/app/kpi/kpi.css", "utf-8");
  const laborUnder = /\.kpi-wb-bar-under\s*\{\s*background:\s*var\(--green-500\)/.test(kpiCss);
  const laborOver  = /\.kpi-wb-bar-over\s*\{\s*background:\s*#DC5A5A/.test(kpiCss);
  console.log("labor .kpi-wb-bar-under uses --green-500:", laborUnder);
  console.log("labor .kpi-wb-bar-over uses #DC5A5A:", laborOver);
  console.log("Part C PASS:", stUnderPresent && stOverPresent && cssStUnder && cssStOver && laborUnder && laborOver ? "yes" : "NO");

  // ── E ────────────────────────────────────────────────────────
  console.log("\n== Part E: freshness pill ==");
  console.log("route.freshness.cards_through:", bJson.freshness?.cards_through);
  console.log("route.freshness.last_billcom_sync:", bJson.freshness?.last_billcom_sync);
  console.log("Derivation: max(txn_date) on rippling_spend excluded=false, from loadFreshness()");
  const cardsThroughLabel = bJson.freshness?.cards_through
    ? `${bJson.freshness.cards_through.slice(5,7)}/${bJson.freshness.cards_through.slice(8,10)}`
    : null;
  const pill = cardsThroughLabel ? `Bills current · cards through ${cardsThroughLabel}` : "Bills current";
  console.log("Pill wording:", pill);
  console.log("Cards-row note: '" + `coded to a P&L line · through ${cardsThroughLabel}` + "'");
  console.log("Part E PASS:", bJson.freshness?.cards_through != null ? "yes" : "NO");

  console.log("\n" + "=".repeat(72));
  console.log("END");
}
main().catch(e => { console.error(e); process.exit(1); });
