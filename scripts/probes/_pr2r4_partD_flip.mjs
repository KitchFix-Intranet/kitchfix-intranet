// PR2 R4 Part D - verdict flip enumeration.
//
// Measures pill-state changes when elapsed_frac moves from the prior
// day-based / `endDate > todayDate` gated formula (returned 1.0 on
// every range ending today) to the week-native formula:
//   elapsed = (closed_weeks_in_range + fraction_of_running_week)
//             / weeks_in_range
// with gate `endDate >= todayDate`.
//
// The route is now on the corrected formula. This probe rebuilds the
// PRIOR formula's elapsed by inspecting range end vs today, then
// re-scores each card/bucket/gl item with both to enumerate flips.

const BASE = process.env.PROBE_BASE || "http://localhost:3221";
const today = new Date().toISOString().slice(0, 10);

const AT_RISK = ["CIN - AZ", "CIN - KY", "TBJ - FL", "TBJ - NY", "TBR - FL", "TXR - AZ", "TXR - TX - H", "TXR - TX - V"];
const AGGREGATES = ["ALL", "EAST", "WEST"];
const ALL_ACCOUNTS = [...AGGREGATES, ...AT_RISK];

const FY_START = "2025-12-29";

function addDaysISO(iso, delta) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// Prior formula (route pre-PR-2 R4 Part D):
//   Elapsed frac: for closed range (end < today), 1.0. For in-progress,
//   (days from start to today) / (days from start to end + 1).
// Gate: `endDate > todayDate` - a range ending today returns 1.0 too.
function priorElapsedFrac(start, end, today) {
  const t = new Date(today + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  const s = new Date(start + "T00:00:00Z");
  if (!(e > t)) return 1.0;
  const totalDays = Math.max(1, Math.floor((e - s) / 86400000) + 1);
  const doneDays = Math.max(0, Math.floor((t - s) / 86400000) + 1);
  return Math.min(1.0, doneDays / totalDays);
}

// stateOf: mirrors src/app/kpi/purchasing/route.js stateOf().
function stateOf({ spent, budget, elapsedFrac, hasBills }) {
  if (!(budget > 0)) return "nobud";
  if (!hasBills) return "none";
  if (!(elapsedFrac > 0)) return "none";
  const pace = spent / (budget * elapsedFrac);
  if (pace > 1.03) return "over";
  if (pace < 0.97) return "under";
  return "onpace";
}

const PRESETS = [
  { key: "fytd",       start: FY_START,               end: today, label: "FYTD" },
  { key: "last_4wk",   start: addDaysISO(today, -27), end: today, label: "last 4 weeks" },
  { key: "last_13wk",  start: addDaysISO(today, -90), end: today, label: "last 13 weeks" },
];

async function fetchBoard(account, start, end) {
  const url = `${BASE}/api/kpi/purchasing?account=${encodeURIComponent(account)}&start=${start}&end=${end}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${account} ${start}..${end} -> ${r.status}`);
  return r.json();
}

const flips = [];

console.log("=".repeat(72));
console.log("PR-2 R4 Part D - verdict flip list (prior day-based -> week-native)");
console.log("today:", today);
console.log("=".repeat(72));

for (const account of ALL_ACCOUNTS) {
  for (const preset of PRESETS) {
    let board;
    try {
      board = await fetchBoard(account, preset.start, preset.end);
    } catch (e) {
      console.log(`  fetch ${account} ${preset.label} -> ${e.message}`);
      continue;
    }
    const elapsedGood = Number(board?.fiscal?.elapsed_frac ?? 1.0);
    const elapsedBad  = priorElapsedFrac(preset.start, preset.end, today);
    // Items to score: buckets (food/packaging/vehicle) + KPI-line (pl_cogs total).
    const items = [];
    const totals = board?.totals || {};
    if (totals?.pl_cogs?.budget > 0) {
      items.push({ key: "period(pl_cogs)", spent: totals.pl_cogs.spent, budget: totals.pl_cogs.budget });
    }
    for (const bk of board?.buckets || []) {
      if (!(bk.budget > 0)) continue;
      // R3 methodology: bucket bills-only spend against bucket budget.
      // Bucket STATE on the route uses `spent` (bills-only) per §3.4;
      // that is the number the pill / bar / verdict all resolve from.
      const spent = Number(bk.spent || 0);
      items.push({ key: `bucket:${bk.bucket}`, spent, budget: bk.budget });
    }
    // Per-category (gl_line_code) flips - route.categories carries the
    // pace_pct render. Only meaningful when budget > 0 AND pace_pct
    // was computed (i.e. was not null on the route response).
    for (const cat of board?.categories || []) {
      if (!(cat.budget > 0)) continue;
      if (cat.pace_pct == null) continue;
      items.push({ key: `gl:${cat.gl_line_code}`, spent: cat.spent, budget: cat.budget });
    }
    for (const it of items) {
      const spent = Number(it.spent || 0);
      const budget = Number(it.budget || 0);
      if (!(budget > 0)) continue;
      const hasBills = spent > 0;
      const sBad  = stateOf({ spent, budget, elapsedFrac: elapsedBad,  hasBills });
      const sGood = stateOf({ spent, budget, elapsedFrac: elapsedGood, hasBills });
      const paceBad  = elapsedBad  > 0 ? (spent / (budget * elapsedBad )) * 100 : null;
      const paceGood = elapsedGood > 0 ? (spent / (budget * elapsedGood)) * 100 : null;
      if (sBad !== sGood) {
        flips.push({
          account, preset: preset.label, item: it.key,
          spent: spent.toFixed(2), budget: budget.toFixed(2),
          elapsedBad: elapsedBad.toFixed(4), elapsedGood: elapsedGood.toFixed(4),
          paceBad:  paceBad  != null ? paceBad.toFixed(1)  + "%" : "-",
          paceGood: paceGood != null ? paceGood.toFixed(1) + "%" : "-",
          stateBad: sBad, stateGood: sGood,
        });
      }
    }
  }
}

console.log(`\nverdict flips (before -> after): ${flips.length}\n`);
console.log("| # | account | preset | item | spent | budget | elapsed b->g | pace b->g | state b->g |");
console.log("|---|---|---|---|---|---|---|---|---|");
flips.forEach((f, i) => {
  console.log(`| ${i+1} | ${f.account} | ${f.preset} | ${f.item} | $${Number(f.spent).toLocaleString()} | $${Number(f.budget).toLocaleString()} | ${f.elapsedBad} -> ${f.elapsedGood} | ${f.paceBad} -> ${f.paceGood} | ${f.stateBad} -> ${f.stateGood} |`);
});
console.log("\n" + "=".repeat(72));
console.log("END PART D FLIP PROBE");
