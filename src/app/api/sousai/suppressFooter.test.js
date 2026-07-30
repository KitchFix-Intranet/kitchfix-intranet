// ═══════════════════════════════════════════════════════════════════════════
// suppressFooter.test.js
// Unit tests for the trailing-sentinel suppressor.
//
// Coverage focus after the 2026-07-29 REASON-first fix:
//   - Original [[STATUS-only case still works.
//   - The REASON-first case (declined path) suppresses REASON in-flight.
//   - Split sentinels across deltas work for both REASON and STATUS.
//   - Text that is NOT a sentinel and merely resembles one flushes cleanly.
// ═══════════════════════════════════════════════════════════════════════════

import test from "node:test";
import assert from "node:assert/strict";
import { advance, flush, initFooterState, SENTINELS, SENTINEL } from "./suppressFooter.js";

function run(deltas) {
  let state = initFooterState();
  let out = "";
  const hits = [];
  for (const d of deltas) {
    const { forward, next, hit } = advance(state, d);
    out += forward;
    if (hit) hits.push(true);
    state = next;
  }
  out += flush(state);
  return { output: out, hits, final: state };
}

test("SENTINELS constant carries both markers", () => {
  assert.deepEqual(SENTINELS, ["[[REASON", "[[STATUS"]);
});

test("legacy SENTINEL export still points to [[STATUS", () => {
  assert.equal(SENTINEL, "[[STATUS");
});

// ── STATUS-only, single-delta (the original happy path) ─────────────────────

test("suppresses [[STATUS in a single delta", () => {
  const { output } = run(["Answer text.\n\n[[STATUS: grounded]]"]);
  assert.equal(output, "Answer text.\n\n");
});

test("suppresses [[STATUS split across deltas", () => {
  const { output } = run(["Answer text.\n\n[[STA", "TUS: grounded]]"]);
  assert.equal(output, "Answer text.\n\n");
});

// ── REASON-first (the case the original test missed) ────────────────────────

test("REASON-first: suppresses starting at [[REASON on a decline", () => {
  const { output } = run([
    "I don't have that documented.\n\n[[REASON: no matching source]]\n[[STATUS: declined]]",
  ]);
  assert.equal(output, "I don't have that documented.\n\n");
});

test("REASON-first: split [[REASON across deltas is still suppressed", () => {
  const { output } = run([
    "That is not documented.\n\n[[REA",
    "SON: out of corpus]]\n[[STATUS: declined]]",
  ]);
  assert.equal(output, "That is not documented.\n\n");
});

test("REASON adjacent to prior prose (the 'date.[[REASON:' leak from #565)", () => {
  const { output } = run([
    "I don't have an inventory date.[[REASON: no inventory schedule in corpus]]\n[[STATUS: declined]]",
  ]);
  assert.equal(output, "I don't have an inventory date.");
});

test("REASON-first across many small deltas", () => {
  const { output } = run(["ab", "c", ".", "\n", "\n", "[", "[", "R", "E", "A", "S", "O", "N", ": foo]]", "[[STATUS: declined]]"]);
  assert.equal(output, "abc.\n\n");
});

test("STATUS alone (grounded) still suppresses across small deltas", () => {
  const { output } = run(["Answer.\n\n[", "[", "S", "T", "A", "T", "U", "S: grounded]]"]);
  assert.equal(output, "Answer.\n\n");
});

// ── False-positive containment ──────────────────────────────────────────────

test("non-sentinel text starting with [[ flushes cleanly", () => {
  const { output } = run(["Ordinary [[brackets]] in the answer."]);
  assert.equal(output, "Ordinary [[brackets]] in the answer.");
});

test("prefix of REASON that never completes flushes on stream end", () => {
  const { output } = run(["ends abruptly.\n\n[[REA"]);
  // The suppressor held back "[[REA" waiting for either sentinel; flush emits it.
  assert.equal(output, "ends abruptly.\n\n[[REA");
});

test("prefix of STATUS that never completes flushes on stream end", () => {
  const { output } = run(["end.\n\n[[STA"]);
  assert.equal(output, "end.\n\n[[STA");
});

test("after suppression, subsequent deltas emit nothing", () => {
  const { output } = run([
    "prose.\n\n[[STATUS: grounded]]",
    "trailing garbage that should not appear",
    "\nmore junk",
  ]);
  assert.equal(output, "prose.\n\n");
});

// ── Edge cases ──────────────────────────────────────────────────────────────

test("empty delta is a no-op", () => {
  const state = initFooterState();
  const r = advance(state, "");
  assert.equal(r.forward, "");
  assert.equal(r.next, state);
  assert.equal(r.hit, false);
});

test("null delta is a no-op", () => {
  const state = initFooterState();
  const r = advance(state, null);
  assert.equal(r.forward, "");
});

test("REASON appearing without a following STATUS is still suppressed", () => {
  // The decline path is REASON then STATUS, but a corrupted stream might
  // emit REASON alone. The suppressor should still bury it - REASON is
  // machine metadata regardless of what follows.
  const { output } = run(["An answer.\n[[REASON: xyz]] some more text that leaked"]);
  assert.equal(output, "An answer.\n");
});
