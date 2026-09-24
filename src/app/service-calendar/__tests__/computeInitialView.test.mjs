// computeInitialView unit tests. First coverage for this helper.
//
// 2026-09-23 ruling (Kevin): every user lands on their own account's
// year overview with the Period lens. Nobody is auto-dropped into a
// period workspace. Users drill in themselves. Explicit user intent
// (?view=admin, ?period=P\d+) still wins; the ruling governs the
// DEFAULT landing only.
//
// Prior behavior: floor-tier roles with a resolved home account were
// landed on the current-period workspace via branch 3. That branch is
// removed. These tests pin the ruling so a future well-intentioned
// re-introduction of a floor-fastpath fails the suite.
//
// 2026-09-24 cleanup: the ROLE_TIERS / roleTier / tierFromRoles
// machinery + the `role` and `roles` parameters were dropped from
// computeInitialView; branch 3's removal in #1209 had already made
// them unreachable. Every previous call site that passed `roles:`
// was updated here to reflect the trimmed signature.
//
// Run via: node --import ./scripts/_setup/register-aliases.mjs --test \
//          src/app/service-calendar/__tests__/computeInitialView.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { computeInitialView } from "../computeInitialView.js";

const YEAR_PERIOD_DEFAULT = {
  scope: "year", lens: "period",
  isAdminView: false, periodKey: null,
  landOnCurrentPeriod: false,
};

// ─── The ruling: clean URL always lands year/Period ────────────────

test("clean URL + hasHomeAccount=true -> year overview on Period lens (the ruling)", () => {
  // Pre-2026-09-23 this returned scope:'period', landOnCurrentPeriod:true
  // for floor roles with a home account. Post-ruling the tier no longer
  // enters the decision. If a future change re-introduces a fastpath on
  // ANY input, this test fails.
  const result = computeInitialView({
    urlView: null, urlPeriod: null, isAdmin: false,
    hasHomeAccount: true,
  });
  assert.deepEqual(result, YEAR_PERIOD_DEFAULT,
    "clean URL + home account no longer auto-drops into the period workspace");
});

test("clean URL + hasHomeAccount=false -> year overview on Period lens (unchanged)", () => {
  const result = computeInitialView({
    urlView: null, urlPeriod: null, isAdmin: false,
    hasHomeAccount: false,
  });
  assert.deepEqual(result, YEAR_PERIOD_DEFAULT);
});

test("clean URL + no options at all -> year overview on Period lens (unchanged)", () => {
  const result = computeInitialView({
    urlView: null, urlPeriod: null, isAdmin: false,
  });
  assert.deepEqual(result, YEAR_PERIOD_DEFAULT);
});

// ─── Branch 2: ?period deep-link still wins ────────────────────────

test("?period=P7 deep-link still wins over the default", () => {
  const result = computeInitialView({
    urlView: null, urlPeriod: "P7", isAdmin: false,
    hasHomeAccount: true,
  });
  assert.equal(result.scope, "period");
  assert.equal(result.lens, "period");
  assert.equal(result.periodKey, "P7");
  assert.equal(result.landOnCurrentPeriod, false,
    "deep-link is an explicit target, not a fresh-today landing");
  assert.equal(result.isAdminView, false);
});

// ─── Branch 1: ?view=admin + isAdmin ───────────────────────────────

test("?view=admin + isAdmin=true -> admin surface", () => {
  const result = computeInitialView({
    urlView: "admin", urlPeriod: null, isAdmin: true,
    hasHomeAccount: true,
  });
  assert.equal(result.isAdminView, true);
  assert.equal(result.scope, "year");
  assert.equal(result.lens, "calendar");
});

test("?view=admin + isAdmin=false -> does NOT reach admin (falls to default)", () => {
  const result = computeInitialView({
    urlView: "admin", urlPeriod: null, isAdmin: false,
    hasHomeAccount: true,
  });
  assert.deepEqual(result, YEAR_PERIOD_DEFAULT,
    "URL admin intent without the isAdmin gate must not reach the admin surface");
});
