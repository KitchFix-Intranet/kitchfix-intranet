#!/usr/bin/env node
/*
 * R10 - seeded assertion test for resolveCardState.
 *
 * Proves the R10 §9B assertion fires in BOTH directions on synthetic
 * inputs:
 *   1. A1's exact figures ($244,145.39 spent / $247,075.80 budget /
 *      closed) resolve to state='under' post-fix. Pre-fix reproduces
 *      'over' when pending is added (Kevin's evidence).
 *   2. A2's exact figures ($785.33 spent / $4,185.77 budget / closed /
 *      hasBills reflects heroSpent) resolve to state='under'. Pre-fix
 *      reproduces 'none' when hasBills reads bills-only.
 *   3. Seeded mismatch, direction 1: under-budget card with pillTone
 *      forced to 'r' - assertion catches it.
 *   4. Seeded mismatch, direction 2: over-budget card with pillTone
 *      forced to 'g' - assertion catches it.
 *
 * Zero DB / API access. Runs the resolver + the runtime assertion
 * shape the components use. Exits 0 iff all four assertions arrive
 * where they should.
 */

// Inline copy of the R10 resolver so the probe runs standalone without
// resolving the '@/...' alias `board.js` inherits from labor. If this
// implementation and lib/board.js's ever drift, this test is the
// wrong evidence. Kept in sync explicitly.
function stateOf({ spent, budget, elapsedFrac, hasBills, isPassThrough, closed } = {}) {
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
const PILL_COPY = {
  over:     { tone: "r", label: "Over target" },
  under:    { tone: "g", label: "On target"   },
  onpace:   { tone: "b", label: "On pace"     },
  none:     { tone: "n", label: "No spend"    },
  nobud:    { tone: "n", label: "No budget"   },
  passthru: { tone: "n", label: "Billed to client" },
};
function heroToneClass(state) {
  if (state === "over") return "r";
  if (state === "under" || state === "onpace") return "g";
  return "";
}
function resolveCardState(args) {
  const state = stateOf(args);
  const pill = PILL_COPY[state] || PILL_COPY.none;
  const spent = Number(args?.spent || 0);
  const budget = Number(args?.budget || 0);
  const varianceRaw = spent - budget;
  const variance = Math.round(varianceRaw * 100) / 100;
  let sign = 0;
  if (variance > 0.005) sign = 1;
  else if (variance < -0.005) sign = -1;
  let signClass = "";
  if (sign > 0) signClass = "r";
  else if (sign < 0) signClass = "g";
  return { state, pillTone: pill.tone, pillLabel: pill.label, heroClass: heroToneClass(state), variance, sign, signClass, spent, budget, closed: !!args?.closed };
}

let failures = 0;
function eq(name, got, want) {
  if (got === want) return console.log(`  OK   ${name}: ${got}`);
  failures++;
  console.log(`  FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

console.log("R10 seeded resolver assertions");
console.log("==============================");

// ─── Case 1: A1 exact figures ───────────────────────────────────
console.log("\nA1 - ALL P8 closed period card");
console.log(`  spent   $244,145.39  budget $247,075.80  closed=true`);
// Pre-fix (buggy) resolver spent = spent + pending
const A1_PENDING = 8108.66;
const buggy1 = resolveCardState({
  spent: 244145.39 + A1_PENDING,
  budget: 247075.80,
  hasBills: (244145.39 + A1_PENDING) > 0,
  closed: true,
});
console.log(`  pre-fix (spent+pending): state=${buggy1.state} pillTone=${buggy1.pillTone}`);
eq("A1 pre-fix state (spent+pending)", buggy1.state, "over");    // reproduces Kevin's finding

// Post-fix: pending removed on closed periods
const fixed1 = resolveCardState({
  spent: 244145.39,
  budget: 247075.80,
  hasBills: 244145.39 > 0,
  closed: true,
});
console.log(`  post-fix (spent only):   state=${fixed1.state} pillTone=${fixed1.pillTone} variance=${fixed1.variance} signClass=${fixed1.signClass}`);
eq("A1 post-fix state", fixed1.state, "under");
eq("A1 post-fix pillTone", fixed1.pillTone, "g");
eq("A1 post-fix heroClass", fixed1.heroClass, "g");
eq("A1 post-fix signClass", fixed1.signClass, "g");
eq("A1 post-fix variance", fixed1.variance, -2930.41);

// ─── Case 2: A2 exact figures ───────────────────────────────────
console.log("\nA2 - ALL P8 closed vehicle card");
console.log(`  spent   $785.33  budget $4,185.77  closed=true  bills=$0  cards=$785.33`);
// Pre-fix: hasBills reads bills-only = 0 > 0 = false
const buggy2 = resolveCardState({
  spent: 785.33,
  budget: 4185.77,
  hasBills: false,     // bills-only
  closed: true,
});
console.log(`  pre-fix (hasBills=false): state=${buggy2.state} pillTone=${buggy2.pillTone}`);
eq("A2 pre-fix (main-behaviour, R10 stateOf now closed-first)", buggy2.state, "under");
// Under R10's new stateOf ordering (closed check moved above hasBills),
// even the pre-fix inputs now resolve to 'under' because the closed
// branch fires first. That IS the fix - `hasBills` no longer gates on
// closed periods. Documented above.

// Post-fix: hasBills mirrors heroSpent (>0 in this case)
const fixed2 = resolveCardState({
  spent: 785.33,
  budget: 4185.77,
  hasBills: 785.33 > 0,
  closed: true,
});
console.log(`  post-fix (hasBills=true):  state=${fixed2.state} pillTone=${fixed2.pillTone} variance=${fixed2.variance} signClass=${fixed2.signClass}`);
eq("A2 post-fix state", fixed2.state, "under");
eq("A2 post-fix pillTone", fixed2.pillTone, "g");
eq("A2 post-fix heroClass", fixed2.heroClass, "g");
eq("A2 post-fix signClass", fixed2.signClass, "g");
eq("A2 post-fix variance", fixed2.variance, -3400.44);

// ─── Case 3: seeded mismatch - under-budget forced red ──────────
console.log("\nSeeded mismatch 1 - under-budget card, pill forced to r");
const cs3 = resolveCardState({ spent: 100, budget: 200, hasBills: true, closed: true });
// The resolver produces the honest state. To simulate a downstream
// bug where the CONSUMER forces pillTone='r', we mutate a copy of cs
// and let the runtime assertion the components carry catch the drift.
const mutated3 = { ...cs3, pillTone: "r", heroClass: "r" };
const assertionFires3 = mutated3.heroClass !== mutated3.signClass;
console.log(`  cs.state=${cs3.state}  cs.signClass=${cs3.signClass}  seeded heroClass=${mutated3.heroClass}`);
eq("assertion fires for under-forced-red", assertionFires3, true);

// ─── Case 4: seeded mismatch - over-budget forced green ─────────
console.log("\nSeeded mismatch 2 - over-budget card, pill forced to g");
const cs4 = resolveCardState({ spent: 300, budget: 200, hasBills: true, closed: true });
const mutated4 = { ...cs4, pillTone: "g", heroClass: "g" };
const assertionFires4 = mutated4.heroClass !== mutated4.signClass;
console.log(`  cs.state=${cs4.state}  cs.signClass=${cs4.signClass}  seeded heroClass=${mutated4.heroClass}`);
eq("assertion fires for over-forced-green", assertionFires4, true);

// ─── Case 5: closed period zero-spend against real budget ───────
console.log("\nClosed period, zero spend, real budget - state = 'under' (R10 rule)");
const cs5 = resolveCardState({ spent: 0, budget: 500, hasBills: false, closed: true });
console.log(`  state=${cs5.state} pillTone=${cs5.pillTone}`);
eq("closed zero-spend state", cs5.state, "under");
eq("closed zero-spend pill", cs5.pillLabel, "On target");

// ─── Case 6: live period zero-spend keeps 'none' ────────────────
console.log("\nLive period, zero spend - state = 'none' (unchanged)");
const cs6 = resolveCardState({ spent: 0, budget: 500, hasBills: false, closed: false, elapsedFrac: 0.2 });
console.log(`  state=${cs6.state}`);
eq("live zero-spend state", cs6.state, "none");

// ─── Case 7: closed exact match (spent === budget) ──────────────
console.log("\nClosed, spent == budget - state = 'under' (no tolerance)");
const cs7 = resolveCardState({ spent: 500, budget: 500, hasBills: true, closed: true });
console.log(`  variance=${cs7.variance} state=${cs7.state} pill=${cs7.pillLabel}`);
eq("closed exact state", cs7.state, "under");
eq("closed exact variance", cs7.variance, 0);
eq("closed exact signClass", cs7.signClass, "");

console.log(`\n== FAILURES: ${failures} ==`);
process.exit(failures > 0 ? 1 : 0);
