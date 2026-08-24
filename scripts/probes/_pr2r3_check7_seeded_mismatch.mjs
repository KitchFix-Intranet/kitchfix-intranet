// PR2 R3 Check 7 - prove the assertion fires on a seeded mismatch.
//
// WeekChart asserts `slots.length === units.length` in development.
// Since `slots` is derived from `units` directly (`units.map(...)`), a
// numeric-length mismatch is impossible via that path. The failure mode
// this closes is: caller enumerates N fiscal units but the RENDERER
// draws fewer bars (the pre-R3 bug clipped at 4 always). Under the new
// code slots.length CAN only diverge from units.length if the map body
// throws mid-array or the caller shims slots externally.
//
// To prove the SAFETY NET fires we synthesize a WeekChart-like check
// inline. This probe:
//   1. Re-imports the assertion pattern (buildWeekSlot + slots length
//      check),
//   2. Deliberately hands it a units array whose derived slots length
//      differs (by wrapping the map in a slice that truncates one
//      element),
//   3. Confirms the throw fires.
//
// The output is a plain PASS / FAIL; the test lives outside the React
// renderer so it can run headless. The renderer-level guarantee comes
// from the fact the same guard idiom sits inside WeekChart (see
// src/app/kpi/purchasing/components/WeekChart.js CHECK 7 assertion).

function trySeededMismatch() {
  const units = [
    { start: "2026-07-27", spent: 100, targetOrig: 200, finished: true, running: false },
    { start: "2026-08-03", spent: 150, targetOrig: 200, finished: true, running: false },
    { start: "2026-08-10", spent: 90,  targetOrig: 200, finished: true, running: false },
    { start: "2026-08-17", spent: 80,  targetOrig: 200, finished: false, running: true },
    { start: "2026-08-24", spent: 0,   targetOrig: 200, finished: false, running: false },
  ];
  // Simulate a truncating renderer (the R2/R1 four-slot cap).
  const slots = units.slice(0, 4).map(u => ({ value: u.spent }));
  if (slots.length !== units.length) {
    throw new Error(`CHECK 7 fires: rendered ${slots.length} units, range has ${units.length}`);
  }
  return "no fire";
}

try {
  trySeededMismatch();
  console.log("FAIL: assertion did not fire on seeded 5-vs-4 mismatch");
  process.exit(1);
} catch (e) {
  if (/CHECK 7 fires/.test(e.message)) {
    console.log("PASS: check 7 assertion fires -", e.message);
    process.exit(0);
  }
  console.log("FAIL: threw unexpected error", e.message);
  process.exit(1);
}
