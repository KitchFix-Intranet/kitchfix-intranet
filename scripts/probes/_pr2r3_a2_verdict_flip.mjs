// PR2 R3 A2 - list which verdicts change when a range ending TODAY
// stops treating elapsed=1.0 (the current bug) and instead uses the
// fractional elapsed within the final fiscal week.
//
// Mechanism (route.js:769): `if (endDate > todayDate)` gates the
// fractional branch. When end === today, elapsedFrac stays at its
// initialised 1.0. Verdicts (pace = spent/(budget*1.0)) then only trip
// `over` at 103% of the WHOLE-RANGE budget - understating pace by a
// factor of (weeks_in_range / weeks_elapsed) for every in-progress range.
//
// This probe hits /api/kpi/purchasing for each at-risk account + ALL/
// EAST/WEST for each of the presets that end today (FYTD, last_4wk,
// last_13wk, this_period). For every bucket + KPI card it records the
// current pill state and re-computes the pill state with the corrected
// fractional elapsed. Report ONLY - no changes are proposed here.

const BASE = "http://localhost:3220";
const today = new Date().toISOString().slice(0, 10);

const AT_RISK = ["CIN - AZ", "CIN - KY", "TBJ - FL", "TBJ - NY", "TBR - FL", "TXR - AZ", "TXR - TX - H", "TXR - TX - V"];
const AGGREGATES = ["ALL", "EAST", "WEST"];
const ALL_ACCOUNTS = [...AGGREGATES, ...AT_RISK];

const FY_START = "2025-12-29"; // fiscal year 2026 start (Monday)

function addDaysISO(iso, delta) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// Weeks in range: count Mondays from start to end inclusive.
function weekStartsInRange(start, end) {
  const out = [];
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  const dow = s.getUTCDay(); // 0=Sun
  const daysToMon = (dow + 6) % 7;
  let cur = new Date(s);
  cur.setUTCDate(s.getUTCDate() - daysToMon);
  while (cur <= e) {
    if (cur >= s) out.push(cur.toISOString().slice(0, 10));
    else if (cur.toISOString().slice(0, 10) === start) out.push(start);
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  // simpler: enumerate every Monday <= end that is >= start-6d, filter
  return out;
}
// Simpler correct enumerator: Monday-anchored week starts falling within [start..end]
function weekStarts(start, end) {
  const out = [];
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  const dow = s.getUTCDay();
  const daysToMon = (dow + 6) % 7;
  const firstMon = new Date(s);
  firstMon.setUTCDate(s.getUTCDate() - daysToMon);
  // if firstMon < start, first week is truncated but the start is inside that week
  let cur = new Date(firstMon);
  while (cur <= e) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return out;
}

// Correct elapsed for a range ending today: fiscal weeks_finished plus
// the fraction of the running fiscal week already lived, divided by
// total weeks in range. Owner spec §5.1 already treats weeks as the
// unit; day-based math (route.js:770-772) drifts by up to 1/7 near the
// boundary and is what today's board applies to CLOSED ranges too. For a
// range ending today the correct answer is:
//   elapsed = (closed_weeks_in_range + fraction_of_running_week) / weeks_in_range
// Fraction of running week: floor(days from that week's Mon to today)+1
// divided by 7, clamped to 1.
function correctElapsedFrac(start, end, today, closedWeeksInRange, weeksInRange) {
  const e = new Date(end + "T00:00:00Z").getTime();
  const t = new Date(today + "T00:00:00Z").getTime();
  if (e < t) return 1.0;
  if (!(weeksInRange > 0)) return 1.0;
  // Find running week's Monday - the week that CONTAINS today.
  const td = new Date(today + "T00:00:00Z");
  const dow = td.getUTCDay(); // Sun=0
  const daysToMon = (dow + 6) % 7;
  const runMon = new Date(td);
  runMon.setUTCDate(td.getUTCDate() - daysToMon);
  const runFrac = Math.min(1, (daysToMon + 1) / 7);  // e.g., Mon=1/7, Sun=7/7
  return Math.min(1.0, (Number(closedWeeksInRange || 0) + runFrac) / weeksInRange);
}

// Mimic src/app/kpi/purchasing/lib/board.js stateOf().
function stateOf({ spent, budget, elapsedFrac, hasBills, closed }) {
  if (!(budget > 0)) return "nobud";
  if (!hasBills) return "none";
  if (closed) return spent > budget ? "over" : "under";
  if (!(elapsedFrac > 0)) return "none";
  const pace = spent / (budget * elapsedFrac);
  if (pace > 1.03) return "over";
  if (pace < 0.97) return "under";
  return "onpace";
}

// Presets that end today.
const PRESETS = [
  { key: "fytd", start: FY_START, end: today, label: "FYTD" },
  { key: "last_4wk", start: addDaysISO(today, -27), end: today, label: "last 4 weeks" },
  { key: "last_13wk", start: addDaysISO(today, -90), end: today, label: "last 13 weeks" },
];

async function fetchBoard(account, start, end) {
  const url = `${BASE}/api/kpi/purchasing?account=${encodeURIComponent(account)}&start=${start}&end=${end}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${account} ${start}..${end} -> ${r.status}`);
  return r.json();
}

const flips = [];  // {account, preset, bucket, spent, budget, elapsedBad, elapsedGood, stateBad, stateGood}

console.log("=".repeat(72));
console.log("PR2 R3 A2 - verdict flip list for elapsed=1.0 -> fractional");
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
    const elapsedBad = Number(board?.fiscal?.elapsed_frac ?? 1.0);
    const closedWks = Number(board?.fiscal?.closed_weeks_in_range ?? 0);
    const wksInRange = Number(board?.fiscal?.weeks_in_range ?? 0);
    const elapsedGood = correctElapsedFrac(preset.start, preset.end, today, closedWks, wksInRange);
    // Card-visible items:
    //  - KPI/period card uses pl_cogs total (bills+coded)
    //  - Bucket cards each use their bucket total from the page derivation
    //    which combines `route.buckets[].spent` bills-only + coded-cards
    //    tallied from actuals. For A2 accuracy we prefer the ROUTE-visible
    //    bucket rows (which carry pace_pct + state as computed with the
    //    buggy elapsed) so we can measure flips off the same math.
    const totals = board?.totals || {};
    const items = [
      { key: "period(pl_cogs)", spent: totals?.pl_cogs?.spent, budget: totals?.pl_cogs?.budget },
    ];
    for (const bk of board?.buckets || []) {
      items.push({ key: `bucket:${bk.bucket}`, spent: bk.spent, budget: bk.budget, currentState: bk.state, currentPace: bk.pace_pct });
    }
    // Per-category flips (finer-grained; but only meaningful when route
    // shipped a non-null pace_pct)
    for (const cat of board?.categories || []) {
      if (cat.pace_pct == null) continue;
      items.push({ key: `gl:${cat.gl_line_code}`, spent: cat.spent, budget: cat.budget });
    }
    for (const it of items) {
      const spent = Number(it.spent || 0);
      const budget = Number(it.budget || 0);
      if (!(budget > 0)) continue;
      const hasBills = spent > 0;
      const closed = false;
      const sBad  = stateOf({ spent, budget, elapsedFrac: elapsedBad,  hasBills, closed });
      const sGood = stateOf({ spent, budget, elapsedFrac: elapsedGood, hasBills, closed });
      if (sBad !== sGood) {
        flips.push({
          account, preset: preset.label, item: it.key,
          spent: spent.toFixed(2), budget: budget.toFixed(2),
          elapsedBad: elapsedBad.toFixed(4), elapsedGood: elapsedGood.toFixed(4),
          paceBad:  ((spent / (budget * elapsedBad)) * 100).toFixed(1) + "%",
          paceGood: ((spent / (budget * elapsedGood)) * 100).toFixed(1) + "%",
          stateBad: sBad, stateGood: sGood,
        });
      }
    }
  }
}

console.log(`\nverdict flips: ${flips.length}`);
for (const f of flips) {
  console.log(`  ${f.account}  ${f.preset}  ${f.item}`);
  console.log(`    spent=$${f.spent}  budget=$${f.budget}  elapsed  ${f.elapsedBad} -> ${f.elapsedGood}`);
  console.log(`    pace   ${f.paceBad}    -> ${f.paceGood}`);
  console.log(`    state  ${f.stateBad}  ->  ${f.stateGood}`);
}
console.log("\n" + "=".repeat(72));
console.log("END A2");
