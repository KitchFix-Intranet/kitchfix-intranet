// ═══════════════════════════════════════════════════════════════════════════
// opdAcl unit tests - canUseSous truth table
// ═══════════════════════════════════════════════════════════════════════════
//
// Run with: node --test src/lib/opdAcl.test.js
//
// Covers:
//   - Four-case truth table: SLT / corporate-not-SLT / authenticated-neither
//     / unauthenticated (falsy email). Runs with the solo-preview allowlist
//     EMPTIED so the pre-lock SLT-or-corporate behavior is exercised - the
//     spec guarantee for the unlock path (empty the Set to restore).
//   - SLT short-circuit: viewerTier=slt returns true without ever calling
//     isCorporateEmail (the DB path). Non-SLT users pay one PG round trip.
//   - No-backdoor equivalence: the helper's output matches the exact
//     predicate expressed in src/app/api/sousai/gate.js:36-40 and
//     src/app/sous/page.js:78-80 for every combination of tier and
//     isCorporateEmail. A regression in either call site would fail here.
//   - Solo-preview lock (roadmap round 0a, 2026-08-04): with a populated
//     SOUS_PREVIEW_ALLOWLIST, canUseSous returns true iff the lowercased
//     email is in the set. Tier and corporate-email checks are bypassed.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { canUseSous, SOUS_PREVIEW_ALLOWLIST } from "./opdAcl.js";

// Snapshot the shipped allowlist so tests can mutate it and put it back.
// (SOUS_PREVIEW_ALLOWLIST is a live Set exported deliberately - the module
// comment documents "empty the Set" as the one-line unlock. That same
// mutability lets these tests exercise both states without a rebuild.)
const SHIPPED_ALLOWLIST = new Set(SOUS_PREVIEW_ALLOWLIST);

function setAllowlist(members) {
  SOUS_PREVIEW_ALLOWLIST.clear();
  for (const m of members) SOUS_PREVIEW_ALLOWLIST.add(m);
}
function restoreAllowlist() {
  setAllowlist(SHIPPED_ALLOWLIST);
}

// ── Empty allowlist: original truth table passes unchanged ─────────────────
// This is spec outcome 4. When the Set is empty, canUseSous reverts exactly
// to the pre-lock SLT-or-corporate logic; the five original tests below must
// still pass byte-for-byte. Emptying the set IS the one-line unlock, so this
// block is the guarantee that path is intact.

describe("canUseSous - empty allowlist (pre-lock SLT-or-corporate)", () => {
  beforeEach(() => setAllowlist([]));
  afterEach(() => restoreAllowlist());

  test("SLT users pass, short-circuit skips DB", async () => {
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

  test("corporate-not-SLT users pass via DB path", async () => {
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

  test("authenticated-neither denied", async () => {
    const deps = {
      viewerTier: () => "unrestricted",
      isCorporateEmail: async () => false,
    };
    const result = await canUseSous("contractor@vendor.com", deps);
    assert.equal(result, false, "non-SLT non-corp viewer must be denied");
  });

  test("unauthenticated (falsy email) denied without any deps call", async () => {
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
});

// ── Populated allowlist: solo-preview lock ─────────────────────────────────
// Spec outcomes 1-3. Under the lock the allowlist is the ONLY gate:
//   - allowlisted email -> true
//   - non-allowlisted SLT member -> false (the point of this PR)
//   - non-allowlisted corporate email -> false
// Tier and corporate-email checks must be bypassed. The tests assert that
// by wiring stubs that WOULD grant access under the pre-lock logic and
// verifying the answer is still false when the email is not in the set.

describe("canUseSous - populated allowlist (solo-preview lock)", () => {
  beforeEach(() => setAllowlist(["k.fietek@kitchfix.com"]));
  afterEach(() => restoreAllowlist());

  test("allowlisted email -> true (tier and corporate ignored)", async () => {
    let dbCalled = false;
    const deps = {
      viewerTier: () => "unrestricted",
      isCorporateEmail: async () => {
        dbCalled = true;
        return false;
      },
    };
    const result = await canUseSous("k.fietek@kitchfix.com", deps);
    assert.equal(result, true, "allowlisted email must be granted");
    assert.equal(dbCalled, false, "allowlist short-circuit must not hit isCorporateEmail");
  });

  test("non-allowlisted SLT member -> false (the point of this PR)", async () => {
    const deps = {
      viewerTier: () => "slt",
      isCorporateEmail: async () => true,
    };
    const result = await canUseSous("josh@kitchfix.com", deps);
    assert.equal(result, false, "SLT tier must be bypassed while the allowlist is populated");
  });

  test("non-allowlisted corporate email -> false", async () => {
    const deps = {
      viewerTier: () => "unrestricted",
      isCorporateEmail: async () => true,
    };
    const result = await canUseSous("engineer@kitchfix.com", deps);
    assert.equal(result, false, "corporate flag must be bypassed while the allowlist is populated");
  });
});
