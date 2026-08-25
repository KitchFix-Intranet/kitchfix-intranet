#!/usr/bin/env node
/*
 * R10 A3 - the full sweep.
 *
 * For every account × every card × every period (a closed period and a
 * live one), hit the API, apply the same client-side state-resolution
 * that page.js + BucketCard + PeriodCard + LedgerCard + FunMoneyCard
 * apply, and report:
 *
 *   - hero value + hero colour (state -> heroToneClass)
 *   - pill state
 *   - VS BUDGET value + VS BUDGET colour
 *
 * Any row where the five elements do not tell one story is a defect.
 *
 * Reads route via localhost:3233 (dev server must be running). Read-
 * only against the API.
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3233";
const P8   = { start: "2026-07-13", end: "2026-08-09", label: "P8 closed" };
const P9   = { start: "2026-08-10", end: "2026-09-06", label: "P9 live"   };

// Duplicate of lib/board.js stateOf so this probe runs standalone
// without a build. If the resolver semantics ever change these two
// implementations MUST match - the sweep is what catches drift.
// stateOf as it lives in main today
function stateOf({ spent, budget, elapsedFrac, hasBills, isPassThrough, closed } = {}) {
  if (isPassThrough) return "passthru";
  if (!(budget > 0)) return "nobud";
  if (!hasBills) return "none";
  if (closed) return spent > budget ? "over" : "under";
  if (!(elapsedFrac > 0)) return "none";
  const pace = spent / (budget * elapsedFrac);
  if (pace > 1.03) return "over";
  if (pace < 0.97) return "under";
  return "onpace";
}
// R10 fix - closed-period check moved BEFORE hasBills. A closed period
// with zero spend against a real budget is not "no verdict" - it is
// under by 100%. Live period keeps the hasBills gate (early-period
// zero-spend is legitimately verdict-less).
function stateOfR10({ spent, budget, elapsedFrac, hasBills, isPassThrough, closed } = {}) {
  if (isPassThrough) return "passthru";
  if (!(budget > 0)) return "nobud";
  if (closed) return spent > budget ? "over" : "under";
  if (!hasBills) return "none";
  if (!(elapsedFrac > 0)) return "none";
  const pace = spent / (budget * elapsedFrac);
  if (pace > 1.03) return "over";
  if (pace < 0.97) return "under";
  return "onpace";
}
function heroToneClass(state) {
  if (state === "over") return "r";
  if (state === "under" || state === "onpace") return "g";
  return "";
}
function pillFor(state) {
  return {
    over:     "OVER TARGET",
    under:    "ON TARGET",
    onpace:   "ON PACE",
    none:     "NO SPEND",
    nobud:    "NO BUDGET",
    passthru: "BILLED TO CLIENT",
  }[state] || "?";
}
function fmt$(n) {
  if (n == null) return "-";
  const s = Math.abs(n).toFixed(2);
  return (n < 0 ? "-$" : "$") + s;
}

const ACCOUNTS = ["ALL", "CIN - AZ", "CIN - KY", "CIN - OH", "STL - FL", "STL - MO", "TBJ - FL", "TBJ - NY", "TBR - FL", "TXR - AZ", "TXR - TX - H", "TXR - TX - V"];

async function fetchBoard(account, range) {
  const q = `account=${encodeURIComponent(account)}&start=${range.start}&end=${range.end}`;
  const r = await fetch(`${BASE}/api/kpi/purchasing?${q}`, { credentials: "include" });
  if (!r.ok) throw new Error(`${account} ${range.label} -> HTTP ${r.status}`);
  return r.json();
}

// Client-side aggregation of what BucketCard receives per bucket, matching page.js:
//   spent = sum(weekly.amount where gl_line_code prefix matches bucket) - equals bills + coded cards
//   bills = route.buckets[key].spent (bills only)
//   cards = route.buckets[key].cards_coded
function bucketFromRoute(routeBucket) {
  const spent  = Number(routeBucket?.spent || 0) + Number(routeBucket?.cards_coded || 0);
  const bills  = Number(routeBucket?.spent || 0);
  const cards  = Number(routeBucket?.cards_coded || 0);
  const budget = Number(routeBucket?.budget || 0);
  return { spent, bills, cards, budget };
}

// -------------------------------------------------------------------
// Two resolver variants side by side:
//   CURRENT  = what main renders today (the buggy state)
//   FIXED    = what R10 proposes (bound to one source per card)
//
// The sweep prints BOTH so a comparison is possible before/after.
// -------------------------------------------------------------------
function periodCurrent({ spent, pending, budget, closed, elapsedFrac }) {
  // Reproduces PeriodCard.js today: resolver spent = spent + pending (unconditionally).
  const resolverSpent = Number(spent || 0) + Number(pending || 0);
  const state = stateOf({ spent: resolverSpent, budget, elapsedFrac, hasBills: resolverSpent > 0, closed });
  const varz  = Number(spent || 0) - Number(budget || 0);
  return {
    hero: fmt$(spent), heroCls: heroToneClass(state),
    pill: pillFor(state),
    vs: fmt$(varz), vsCls: varz > 0 ? "r" : varz < 0 ? "g" : "",
    _state: state, _varz: varz, _resolverSpent: resolverSpent,
  };
}
function periodFixed({ spent, pending, budget, closed, elapsedFrac }) {
  // R10 fix: pending contributes to the resolver only on a live period.
  const resolverSpent = Number(spent || 0) + (closed ? 0 : Number(pending || 0));
  const state = stateOfR10({ spent: resolverSpent, budget, elapsedFrac, hasBills: resolverSpent > 0, closed });
  const varz  = Number(spent || 0) - Number(budget || 0);
  return {
    hero: fmt$(spent), heroCls: heroToneClass(state),
    pill: pillFor(state),
    vs: fmt$(varz), vsCls: varz > 0 ? "r" : varz < 0 ? "g" : "",
    _state: state, _varz: varz, _resolverSpent: resolverSpent,
  };
}
function bucketCurrent({ spent, bills, budget, closed, elapsedFrac }) {
  // Reproduces BucketCard.js today: hasBills = bills > 0.
  const state = stateOf({ spent, budget, elapsedFrac, hasBills: Number(bills || 0) > 0, closed });
  const varz = Number(spent || 0) - Number(budget || 0);
  return {
    hero: fmt$(spent), heroCls: heroToneClass(state),
    pill: pillFor(state),
    vs: fmt$(varz), vsCls: varz > 0 ? "r" : varz < 0 ? "g" : "",
    _state: state, _varz: varz,
  };
}
function bucketFixed({ spent, bills, budget, closed, elapsedFrac }) {
  // R10 fix: hasBills = spent > 0 (same source as the hero).
  const state = stateOfR10({ spent, budget, elapsedFrac, hasBills: Number(spent || 0) > 0, closed });
  const varz = Number(spent || 0) - Number(budget || 0);
  return {
    hero: fmt$(spent), heroCls: heroToneClass(state),
    pill: pillFor(state),
    vs: fmt$(varz), vsCls: varz > 0 ? "r" : varz < 0 ? "g" : "",
    _state: state, _varz: varz,
  };
}

// A row is "inconsistent" if the five elements do not tell one story.
// Concretely: hero colour and VS BUDGET colour must be non-contradictory
// against the pill state. Zero-variance = no colour on either.
function isConsistent(row) {
  // Non-verdict states (none/nobud/passthru) are consistent as long as
  // hero has no colour and VS BUDGET has no colour. But VS BUDGET may
  // legitimately be coloured on a non-verdict state (there IS a budget,
  // there IS spend, we just did not assign the card a verdict) - that
  // is exactly the drift Kevin found. Enforce: whenever VS BUDGET
  // carries a colour class, the pill must also carry the matching one.
  if (row.vsCls === "" && row.heroCls === "") return true;
  // pill/hero colour must match VS BUDGET colour (when either carries one).
  return row.heroCls === row.vsCls;
}

async function main() {
  console.log("R10 A3 - full state-resolution sweep");
  console.log("=====================================");
  const rows = [];
  for (const acct of ACCOUNTS) {
    for (const range of [P8, P9]) {
      let board;
      try { board = await fetchBoard(acct, range); }
      catch (e) { console.log(`  SKIP ${acct} ${range.label}: ${e.message}`); continue; }
      const closed = new Date(range.end) < new Date(new Date().toISOString().slice(0, 10));
      const elapsedFrac = Number(board?.fiscal?.elapsed_frac || 0);
      const pending = Number(board?.pending?.amount || 0);
      const kpiBud = (board?.buckets || []).reduce((s, b) => s + Number(b.budget || 0), 0);
      const kpiSpent = (board?.buckets || []).reduce((s, b) => s + Number(b.spent || 0) + Number(b.cards_coded || 0), 0);

      // Period card (at at-risk accounts)
      const cur = periodCurrent({ spent: kpiSpent, pending, budget: kpiBud, closed, elapsedFrac });
      const fx  = periodFixed  ({ spent: kpiSpent, pending, budget: kpiBud, closed, elapsedFrac });
      rows.push({ acct, range: range.label, card: "period", cur, fx });

      // Bucket cards
      for (const b of board?.buckets || []) {
        const bc = bucketFromRoute(b);
        const cur = bucketCurrent({ ...bc, closed, elapsedFrac });
        const fx  = bucketFixed  ({ ...bc, closed, elapsedFrac });
        rows.push({ acct, range: range.label, card: `bucket-${b.bucket}`, cur, fx, bills: bc.bills, cards: bc.cards });
      }
    }
  }

  // Print table
  const line = (a, b, c, d, e, f, g, h, i) => console.log(
    a.padEnd(15), b.padEnd(9), c.padEnd(16),
    d.padStart(14), e.padStart(4), f.padEnd(16),
    g.padStart(14), h.padStart(4), (i || "").padStart(6));
  line("account", "range", "card", "hero (cur)", "H", "pill (cur)", "vs (cur)", "V", "OK?");
  line("-".repeat(15), "-".repeat(9), "-".repeat(16), "-".repeat(14), "-".repeat(4), "-".repeat(16), "-".repeat(14), "-".repeat(4), "-".repeat(6));
  let inconsistent = 0;
  for (const r of rows) {
    const ok = isConsistent(r.cur) ? "OK" : "DRIFT";
    if (ok === "DRIFT") inconsistent++;
    line(r.acct, r.range, r.card, r.cur.hero, r.cur.heroCls || ".", r.cur.pill, r.cur.vs, r.cur.vsCls || ".", ok);
  }
  console.log(`\n== CURRENT (main) - DRIFT rows: ${inconsistent} of ${rows.length} ==`);

  // Now the FIXED table (R10 proposal)
  console.log("\n\n== FIXED (R10 proposal) side-by-side ==");
  line("account", "range", "card", "hero (fix)", "H", "pill (fix)", "vs (fix)", "V", "OK?");
  line("-".repeat(15), "-".repeat(9), "-".repeat(16), "-".repeat(14), "-".repeat(4), "-".repeat(16), "-".repeat(14), "-".repeat(4), "-".repeat(6));
  let inconsistentFx = 0;
  for (const r of rows) {
    const ok = isConsistent(r.fx) ? "OK" : "DRIFT";
    if (ok === "DRIFT") inconsistentFx++;
    line(r.acct, r.range, r.card, r.fx.hero, r.fx.heroCls || ".", r.fx.pill, r.fx.vs, r.fx.vsCls || ".", ok);
  }
  console.log(`\n== FIXED (R10) - DRIFT rows: ${inconsistentFx} of ${rows.length} ==`);

  // Delta - what changed
  console.log("\n\n== DELTA (rows where CURRENT != FIXED) ==");
  let deltaCount = 0;
  for (const r of rows) {
    if (r.cur._state !== r.fx._state) {
      deltaCount++;
      console.log(`  ${r.acct.padEnd(14)} ${r.range} ${r.card.padEnd(18)}  current pill=${r.cur.pill} -> fixed pill=${r.fx.pill}`);
    }
  }
  console.log(`\n== ${deltaCount} card(s) change verdict ==`);

  process.exit(inconsistentFx > 0 ? 2 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
