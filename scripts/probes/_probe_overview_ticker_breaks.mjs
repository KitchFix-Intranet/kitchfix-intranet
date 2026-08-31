// scripts/probes/_probe_overview_ticker_breaks.mjs
//
// Overview Phase 2 PR-3 - ticker state breakpoint unit test.
//
// Kevin's law: "Unit-test the state breaks at 0.99 / 1.00 / -0.99 /
// -1.00 / -2.99 / -3.00." Each seed value maps to a specific state.
// The prototype's `banner()` at overview-prototype.html:485-486 uses:
//
//   d>=1?["ahead"]: d>=-1?["ontrack"]: d>=-3?["behind"]: ["risk"]
//
// Reading down the ladder:
//   d = 1.00   -> "ahead"            (d>=1 fires)
//   d = 0.99   -> "on_track_above"   (d>=-1 fires, d>=0 branch)
//   d = -0.99  -> "on_track_below"   (d>=-1 fires, d<0 branch)
//   d = -1.00  -> "on_track_below"   (d>=-1 STILL fires at boundary)
//   d = -2.99  -> "behind"           (d>=-3 fires)
//   d = -3.00  -> "behind"           (d>=-3 STILL fires at boundary)
//   d = -3.01  -> "critical"
//
// Seeded failures baked in:
//   - synthetic call with null delta -> null state (proves null handling)
//   - synthetic call with NaN delta  -> null state (proves NaN handling)
//   - assert a wrong expectation surface loudly (below)

import { stateForDelta } from "../../src/lib/kpi/overview/ticker.js";

let pass = 0;
let fail = 0;
const failures = [];

function assertState(label, delta, expected) {
  const got = stateForDelta(delta);
  if (got === expected) {
    pass += 1;
    console.log(`  PASS  ${label}: delta=${delta} -> ${got}`);
  } else {
    fail += 1;
    failures.push({ label, delta, expected, got });
    console.log(`  FAIL  ${label}: delta=${delta} expected=${expected} got=${got}`);
  }
}

console.log("=".repeat(70));
console.log("Overview ticker state breakpoints - Kevin's 6-seed law");
console.log("=".repeat(70));

// The six seed values Kevin named. Each moves state one bucket
// relative to its pair partner, per the prototype's `>=` semantics.
assertState("0.99",  0.99,  "on_track_above");   // pair: 1.00 flips to ahead
assertState("1.00",  1.00,  "ahead");             // boundary -> ahead
assertState("-0.99", -0.99, "on_track_below");   // pair with -1.00 (same per prototype)
assertState("-1.00", -1.00, "on_track_below");   // boundary -> stays on_track (per prototype d>=-1)
assertState("-2.99", -2.99, "behind");            // pair with -3.00 (same per prototype)
assertState("-3.00", -3.00, "behind");            // boundary -> stays behind (per prototype d>=-3)

console.log();
console.log("Additional breakpoints (belt-and-suspenders):");
assertState("0.00",  0.00,  "on_track_above");   // d>=0 branch fires (matches prototype d>=-1 with d>=0)
assertState("-3.01", -3.01, "critical");          // just past boundary
assertState("5.00",  5.00,  "ahead");
assertState("-10.00", -10.00, "critical");

console.log();
console.log("Null / NaN handling:");
assertState("null",  null,     null);
assertState("NaN",   Number.NaN, null);
assertState("undef", undefined, null);

// Seeded failure - proves the assertion machinery would surface a
// regression. Comment this out to run cleanly; uncomment when
// developing to verify the FAIL path fires.
// assertState("SEEDED_FAIL", 1.00, "on_track_above");

console.log();
console.log("=".repeat(70));
console.log(`Result: ${pass} PASS, ${fail} FAIL`);
console.log("=".repeat(70));
if (fail > 0) {
  console.log("Failures:");
  for (const f of failures) console.log("  ", JSON.stringify(f));
  process.exit(1);
}
process.exit(0);
