// scripts/content/__tests__/inventoryExportFull.test.mjs
//
// Unit tests for the pure sort function in src/lib/inventoryExportFull.js.
// Covers the globally-frozen-first ordering owner-ruled 2026-08-04 on
// PR #621: frozen items across every class come first, then non-frozen
// catalog rows (Class 1 + Class 2), then non-frozen NEW rows (Class 3).
//
// Run via: npm run test:unit

import test from "node:test";
import assert from "node:assert/strict";
import { sortRowsForTab } from "../../../src/lib/inventoryExportFull.js";

// Row factory - the fields sortRowsForTab actually reads.
const row = (name, { frozen = false, isNew = false } = {}) => ({
  name, frozen, isNew,
});

test("sortRowsForTab: all frozen first, alphabetical", () => {
  const rows = [
    row("Cheese Cheddar",              { frozen: false, isNew: false }),
    row("Salmon Frozen 4oz",           { frozen: true,  isNew: false }),
    row("Bacon Layout Applewood",      { frozen: false, isNew: false }),
    row("IQF Broccoli Florets",        { frozen: true,  isNew: false }),
    row("Frozen Blueberry 5lb Bag",    { frozen: true,  isNew: true  }),
    row("Avocado Fresh",               { frozen: false, isNew: true  }),
  ];
  const sorted = sortRowsForTab(rows);
  // Frozen block (3 rows), alphabetical across all classes:
  //   "Frozen Blueberry ..." < "IQF Broccoli ..." < "Salmon Frozen ..."
  assert.equal(sorted[0].name, "Frozen Blueberry 5lb Bag");
  assert.equal(sorted[0].isNew, true, "frozen NEW row appears in the top group, not in NEW group");
  assert.equal(sorted[1].name, "IQF Broccoli Florets");
  assert.equal(sorted[2].name, "Salmon Frozen 4oz");
  // Non-frozen catalog block:
  assert.equal(sorted[3].name, "Bacon Layout Applewood");
  assert.equal(sorted[4].name, "Cheese Cheddar");
  // Non-frozen NEW block at the bottom:
  assert.equal(sorted[5].name, "Avocado Fresh");
  assert.equal(sorted[5].isNew, true);
});

test("sortRowsForTab: Class 2 (enriched) sits with Class 1 catalog", () => {
  // In the row structure Class 1 and Class 2 both have isNew=false;
  // sortRowsForTab does not distinguish them and must not.
  const rows = [
    row("Zucchini",       { isNew: false }),
    row("Apple Fuji",     { isNew: false }),
    row("Beet Red",       { isNew: true  }),
  ];
  const sorted = sortRowsForTab(rows);
  assert.deepEqual(sorted.map((r) => r.name), ["Apple Fuji", "Zucchini", "Beet Red"]);
});

test("sortRowsForTab: empty input", () => {
  assert.deepEqual(sortRowsForTab([]), []);
});

test("sortRowsForTab: all frozen", () => {
  const rows = [
    row("Salmon Frozen",      { frozen: true, isNew: true  }),
    row("Chicken IQF",        { frozen: true, isNew: false }),
    row("Beef Ribeye Frozen", { frozen: true, isNew: false }),
  ];
  const sorted = sortRowsForTab(rows);
  assert.deepEqual(sorted.map((r) => r.name), [
    "Beef Ribeye Frozen",
    "Chicken IQF",
    "Salmon Frozen",
  ]);
});

test("sortRowsForTab: no frozen rows", () => {
  const rows = [
    row("Zucchini",   { isNew: false }),
    row("Beet Red",   { isNew: true  }),
    row("Apple Fuji", { isNew: false }),
    row("Apple Gala", { isNew: true  }),
  ];
  const sorted = sortRowsForTab(rows);
  assert.deepEqual(sorted.map((r) => r.name), [
    "Apple Fuji",
    "Zucchini",
    "Apple Gala",
    "Beet Red",
  ]);
});

test("sortRowsForTab: preserves row objects (does not mutate fields)", () => {
  const original = [
    row("Blueberry Frozen", { frozen: true, isNew: true }),
    row("Cheese Cheddar",   { frozen: false, isNew: false }),
  ];
  const originalSnapshot = JSON.parse(JSON.stringify(original));
  const sorted = sortRowsForTab(original);
  // NEW note-carrying row keeps isNew=true even though it sorts to the top
  const frozenNew = sorted.find((r) => r.name === "Blueberry Frozen");
  assert.equal(frozenNew.isNew, true, "frozen NEW row still isNew for Notes column");
  assert.equal(frozenNew.frozen, true);
  // Input rows unchanged (we only sort references, not fields)
  assert.deepEqual(original.map((r) => r.name).sort(), originalSnapshot.map((r) => r.name).sort());
});
