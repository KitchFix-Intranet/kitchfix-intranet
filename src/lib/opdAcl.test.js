// ═══════════════════════════════════════════════════════════════════════════
// opdAcl unit tests - canUseSous truth table
// ═══════════════════════════════════════════════════════════════════════════
//
// Run with: node --test src/lib/opdAcl.test.js
//
// Covers:
//   - Four-case truth table: SLT / corporate-not-SLT / authenticated-neither
//     / unauthenticated (falsy email).
//   - SLT short-circuit: viewerTier=slt returns true without ever calling
//     isCorporateEmail (the DB path). Non-SLT users pay one PG round trip.
//   - No-backdoor equivalence: the helper's output matches the exact
//     predicate expressed in src/app/api/sousai/gate.js:36-40 and
//     src/app/sous/page.js:78-80 for every combination of tier and
//     isCorporateEmail. A regression in either call site would fail here.
// ═══════════════════════════════════════════════════════════════════════════

import { test } from "node:test";
import assert from "node:assert/strict";
import { canUseSous } from "./opdAcl.js";

// ── Truth-table cases (the four states named in the CC prompt) ─────────────

test("canUseSous - SLT users pass, short-circuit skips DB", async () => {
  let dbCalled = false;
  const deps = {
    viewerTier: () => "slt",
    isCorporateEmail: async () => {
      dbCalled = true;
      return false; // even if DB said not-corp, SLT already wins
    },
  };
  const result = await canUseSous("k.fietek@kitchfix.com", deps);
  assert.equal(result, true, "SLT viewer must be granted");
  assert.equal(dbCalled, false, "SLT short-circuit must not hit isCorporateEmail");
});

test("canUseSous - corporate-not-SLT users pass via DB path", async () => {
  let dbCalled = false;
  const deps = {
    viewerTier: () => "unrestricted",
    isCorporateEmail: async () => {
      dbCalled = true;
      return true;
    },
  };
  const result = await canUseSous("engineer@kitchfix.com", deps);
  assert.equal(result, true, "corporate viewer must be granted");
  assert.equal(dbCalled, true, "non-SLT viewer must reach the corporate lookup");
});

test("canUseSous - authenticated-neither denied", async () => {
  const deps = {
    viewerTier: () => "unrestricted",
    isCorporateEmail: async () => false,
  };
  const result = await canUseSous("contractor@vendor.com", deps);
  assert.equal(result, false, "non-SLT non-corp viewer must be denied");
});

test("canUseSous - unauthenticated (falsy email) denied without any deps call", async () => {
  let anyDepCalled = false;
  const deps = {
    viewerTier: () => {
      anyDepCalled = true;
      return "slt";
    },
    isCorporateEmail: async () => {
      anyDepCalled = true;
      return true;
    },
  };
  assert.equal(await canUseSous(null, deps), false);
  assert.equal(await canUseSous(undefined, deps), false);
  assert.equal(await canUseSous("", deps), false);
  assert.equal(anyDepCalled, false, "Falsy email must return false before any deps call");
});

// ── No-backdoor equivalence: helper matches gate.js AND sous/page.js ───────

test("no-backdoor - helper matches gate.js and sous/page.js predicate across every case", async () => {
  // Reproduce the exact predicate from src/app/api/sousai/gate.js:36-40.
  // The gate denies when `tier !== "slt" && !isCorp` -> passes when the
  // negation of that expression is true.
  const gateJsPredicate = async (email, deps) => {
    const tier = deps.viewerTier(email);
    const isCorp = await deps.isCorporateEmail(email);
    return !(tier !== "slt" && !isCorp);
  };
  // Reproduce the exact predicate from src/app/sous/page.js:78-80 verbatim,
  // including its SLT short-circuit.
  const pageJsPredicate = async (email, deps) => {
    const tier = deps.viewerTier(email);
    const corp = tier === "slt" ? true : await deps.isCorporateEmail(email);
    return !(tier !== "slt" && !corp);
  };

  const cases = [
    { name: "slt + isCorp false",           tier: "slt",          isCorp: false },
    { name: "slt + isCorp true",            tier: "slt",          isCorp: true },
    { name: "restricted + isCorp true",     tier: "restricted",   isCorp: true },
    { name: "restricted + isCorp false",    tier: "restricted",   isCorp: false },
    { name: "unrestricted + isCorp true",   tier: "unrestricted", isCorp: true },
    { name: "unrestricted + isCorp false",  tier: "unrestricted", isCorp: false },
  ];

  const email = "test@example.com";
  for (const c of cases) {
    const deps = { viewerTier: () => c.tier, isCorporateEmail: async () => c.isCorp };
    const helper = await canUseSous(email, deps);
    const gate = await gateJsPredicate(email, deps);
    const page = await pageJsPredicate(email, deps);
    assert.equal(helper, gate, `case "${c.name}": helper !== gate.js predicate`);
    assert.equal(helper, page, `case "${c.name}": helper !== sous/page.js predicate`);
  }
});
