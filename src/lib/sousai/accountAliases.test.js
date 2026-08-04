// ═══════════════════════════════════════════════════════════════════════════
// accountAliases unit tests (round 1 Part A E1, 2026-08-04)
// ═══════════════════════════════════════════════════════════════════════════
//
// Run with: node --test src/lib/sousai/accountAliases.test.js
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveAccountAlias, listAliases, CANONICAL_ACCOUNT_KEYS } from "./accountAliases.js";

describe("resolveAccountAlias - canonical + spaced forms", () => {
  test("canonical unspaced form resolves as-is", () => {
    for (const key of CANONICAL_ACCOUNT_KEYS) {
      const r = resolveAccountAlias(key);
      assert.equal(r.canonical, key, `expected ${key} to resolve to itself`);
    }
  });
  test("canonical spaced-hyphen form maps to unspaced canonical", () => {
    assert.deepEqual(resolveAccountAlias("STL - FL"), { canonical: "STL-FL", source: "spaced" });
    assert.deepEqual(resolveAccountAlias("TXR - TX - H"), { canonical: "TXR-TX-H", source: "spaced" });
  });
});

describe("resolveAccountAlias - nickname / city aliases", () => {
  test("Great American Ballpark → CIN-OH", () => {
    assert.equal(resolveAccountAlias("Great American Ballpark").canonical, "CIN-OH");
    assert.equal(resolveAccountAlias("GABP").canonical, "CIN-OH");
  });
  test("Jupiter → STL-FL, Busch → STL-MO", () => {
    assert.equal(resolveAccountAlias("Jupiter").canonical, "STL-FL");
    assert.equal(resolveAccountAlias("Busch").canonical, "STL-MO");
    assert.equal(resolveAccountAlias("Busch Stadium").canonical, "STL-MO");
  });
  test("Buffalo → TBJ-NY, Dunedin → TBJ-FL", () => {
    assert.equal(resolveAccountAlias("Buffalo").canonical, "TBJ-NY");
    assert.equal(resolveAccountAlias("Dunedin").canonical, "TBJ-FL");
  });
  test("Surprise → TXR-AZ, Arlington → TXR-TX-H", () => {
    assert.equal(resolveAccountAlias("Surprise").canonical, "TXR-AZ");
    assert.equal(resolveAccountAlias("Arlington").canonical, "TXR-TX-H");
    assert.equal(resolveAccountAlias("Globe Life Field").canonical, "TXR-TX-H");
  });
  test("Tampa Bay / Rays / Port Charlotte all map to TBR-FL", () => {
    assert.equal(resolveAccountAlias("Rays").canonical, "TBR-FL");
    assert.equal(resolveAccountAlias("Tampa Bay").canonical, "TBR-FL");
    assert.equal(resolveAccountAlias("Port Charlotte").canonical, "TBR-FL");
  });
});

describe("resolveAccountAlias - ambiguity", () => {
  test("'Cardinals' alone is ambiguous with STL-FL / STL-MO candidates", () => {
    const r = resolveAccountAlias("Cardinals");
    assert.equal(r.canonical, null);
    assert.equal(r.source, "ambiguous");
    assert.deepEqual(r.candidates, ["STL-FL", "STL-MO"]);
  });
  test("'Reds' alone is ambiguous with three candidates", () => {
    const r = resolveAccountAlias("Reds");
    assert.equal(r.canonical, null);
    assert.equal(r.source, "ambiguous");
    assert.deepEqual(r.candidates, ["CIN-AZ", "CIN-KY", "CIN-OH"]);
  });
  test("'Rangers Texas' is ambiguous between H and V", () => {
    const r = resolveAccountAlias("Rangers Texas");
    assert.equal(r.canonical, null);
    assert.equal(r.source, "ambiguous");
    assert.deepEqual(r.candidates, ["TXR-AZ", "TXR-TX-H", "TXR-TX-V"]);
  });
});

describe("resolveAccountAlias - typo corridor", () => {
  test("'Cincinati' misspelling still maps to CIN-OH", () => {
    assert.equal(resolveAccountAlias("Cincinati").canonical, "CIN-OH");
    assert.equal(resolveAccountAlias("Cinci").canonical, "CIN-OH");
  });
});

describe("resolveAccountAlias - unknown", () => {
  test("free-form text with no match returns source=unknown", () => {
    const r = resolveAccountAlias("some random vendor name");
    assert.equal(r.canonical, null);
    assert.equal(r.source, "unknown");
  });
  test("null / empty input returns unknown", () => {
    assert.equal(resolveAccountAlias(null).source, "unknown");
    assert.equal(resolveAccountAlias("").source, "unknown");
    assert.equal(resolveAccountAlias("   ").source, "unknown");
  });
});

describe("resolveAccountAlias - normalization tolerance", () => {
  test("mixed case + punctuation still resolves", () => {
    assert.equal(resolveAccountAlias("st. louis").canonical, "STL-MO");
    assert.equal(resolveAccountAlias("ST. LOUIS").canonical, "STL-MO");
    assert.equal(resolveAccountAlias("Saint Louis").canonical, "STL-MO");
  });
  test("extra whitespace collapses", () => {
    assert.equal(resolveAccountAlias("  Busch   Stadium  ").canonical, "STL-MO");
  });
});

describe("listAliases", () => {
  test("returns an array of {input, canonical} records seeded", () => {
    const rows = listAliases();
    assert.ok(rows.length > 30, `seeded ~30+ aliases, got ${rows.length}`);
    assert.ok(rows.every((r) => typeof r.input === "string"));
    assert.ok(rows.some((r) => r.canonical === "CIN-OH"), "CIN-OH represented");
    assert.ok(rows.some((r) => r.canonical === null), "at least one ambiguous alias present");
  });
});
