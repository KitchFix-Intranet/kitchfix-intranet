#!/usr/bin/env node
/**
 * Prove the 26-hour staleness gate fires.  Kevin's acceptance check 3.
 *
 * `checkFresh()` is a pure function; we can seed a mock `internalDate`
 * that is > 26h in the past and prove it throws with `code=REPORT_STALE`.
 * We also cover the boundary at exactly 26h + 1ms, the boundary at
 * exactly 25h59m (must PASS), and a malformed value (must throw).
 *
 * No Rippling calls, no Gmail calls, no Postgres calls, no key needed.
 */
import { checkFresh, _internal } from "../../src/lib/gmailReadReport.js";

const NOW = 1_800_000_000_000;   // fixed clock

let passed = 0, failed = 0;

function ok(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}${detail ? "  " + detail : ""}`); }
  else      { failed++; console.log(`  FAIL  ${name}${detail ? "  " + detail : ""}`); }
}

function expectThrowsStale(name, internalDateMs) {
  try {
    checkFresh(internalDateMs, NOW);
    ok(name, false, "expected throw, got return");
  } catch (err) {
    const named = err?.code === "REPORT_STALE";
    ok(name, named, `code=${err?.code} msg="${(err.message || "").slice(0, 80)}"`);
  }
}

function expectPass(name, internalDateMs) {
  try {
    const age = checkFresh(internalDateMs, NOW);
    ok(name, typeof age === "number", `ageHours=${age}`);
  } catch (err) {
    ok(name, false, `unexpected throw code=${err?.code}`);
  }
}

console.log("INV-P20 acceptance check 3 - 26h staleness gate\n");

const LIMIT = _internal.STALENESS_LIMIT_MS;
console.log(`STALENESS_LIMIT_MS = ${LIMIT} (= ${LIMIT / 3600000}h)\n`);

// Seed 48h old
expectThrowsStale("48h-old email throws REPORT_STALE",
  NOW - 48 * 3600 * 1000);

// Seed just over 26h
expectThrowsStale("26h + 1ms throws REPORT_STALE (boundary)",
  NOW - (LIMIT + 1));

// Fresh - 1h ago passes
expectPass("1h-old email passes",
  NOW - 3600 * 1000);

// Boundary - 25h 59m ago (just fresher than 26h)
expectPass("25h 59m passes (just inside window)",
  NOW - (LIMIT - 60 * 1000));

// Malformed - throws named
expectThrowsStale("null internalDate throws REPORT_STALE", null);
expectThrowsStale("undefined internalDate throws REPORT_STALE", undefined);
expectThrowsStale("garbage string throws REPORT_STALE", "not-a-number");

console.log(`\nresult: ${passed} passed / ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
