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

test("clean URL + floor role + home account -> year overview on Period lens (ruling)", () => {
  // The case that CHANGED. Pre-ruling this returned scope:'period',
  // landOnCurrentPeriod:true. If a future change re-introduces the
  // floor-fastpath, this test fails.
  const result = computeInitialView({
    urlView: null, urlPeriod: null, isAdmin: false,
    roles: ["Executive Chef"], hasHomeAccount: true,
  });
  assert.deepEqual(result, YEAR_PERIOD_DEFAULT,
    "floor+home no longer auto-drops into the period workspace");
});

test("clean URL + leadership role -> year overview on Period lens (unchanged)", () => {
  const result = computeInitialView({
    urlView: null, urlPeriod: null, isAdmin: false,
    roles: ["Director of Operations"], hasHomeAccount: true,
  });
  assert.deepEqual(result, YEAR_PERIOD_DEFAULT);
});

test("clean URL + no role at all -> year overview on Period lens (unchanged)", () => {
  const result = computeInitialView({
    urlView: null, urlPeriod: null, isAdmin: false,
    // omit roles + role entirely
  });
  assert.deepEqual(result, YEAR_PERIOD_DEFAULT);
});

// ─── Branch 2: ?period deep-link still wins ────────────────────────

test("?period=P7 deep-link still wins over the default", () => {
  const result = computeInitialView({
    urlView: null, urlPeriod: "P7", isAdmin: false,
    roles: ["Executive Chef"], hasHomeAccount: true,
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
    roles: ["Executive Chef"], hasHomeAccount: true,
  });
  assert.equal(result.isAdminView, true);
  assert.equal(result.scope, "year");
  assert.equal(result.lens, "calendar");
});

test("?view=admin + isAdmin=false -> does NOT reach admin (falls to default)", () => {
  const result = computeInitialView({
    urlView: "admin", urlPeriod: null, isAdmin: false,
    roles: ["Director of Operations"], hasHomeAccount: true,
  });
  assert.deepEqual(result, YEAR_PERIOD_DEFAULT,
    "URL admin intent without the isAdmin gate must not reach the admin surface");
});
