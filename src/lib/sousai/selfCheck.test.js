// ═══════════════════════════════════════════════════════════════════════════
// selfCheck unit tests (round 0b Parts 4 + 5, 2026-08-04)
// ═══════════════════════════════════════════════════════════════════════════
//
// Run with: node --test src/lib/sousai/selfCheck.test.js
//
// Covers:
//   - Agreement opener strip (Part 1.2 requirement, Part 4 implementation).
//   - Self-narration opener strip.
//   - Clock-time strip from prose; quoted content protected by the fence.
//   - Plumbing strip: body-only tool names + always-flagged tables/env.
//   - Source-line plumbing rewrite: tool name replaced with human label.
//   - Multi-part detection + partial-addressing checks.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { applySelfCheck, checkMultiPart } from "./selfCheck.js";

// ── Agreement openers ──────────────────────────────────────────────────────
describe("applySelfCheck - agreement openers", () => {
  test("strips 'You're right' at the start", () => {
    const r = applySelfCheck("You're right. The count is 42.", { question: "how many?" });
    assert.equal(r.answer.startsWith("The count"), true, `got: ${r.answer}`);
    assert.equal(r.strips.agreement, 1);
  });
  test("strips 'Apologies' + comma", () => {
    const r = applySelfCheck("Apologies, the count is 42.", { question: "how many?" });
    assert.equal(r.strips.agreement, 1);
    assert.equal(/^apologies/i.test(r.answer), false);
  });
  test("does NOT strip agreement openers mid-answer", () => {
    // Fence: openers are only stripped at the FIRST sentence, not mid-body.
    const r = applySelfCheck("The count is 42. Sorry for the confusion.", { question: "how many?" });
    assert.equal(r.strips.agreement, 0);
    assert.equal(r.answer.includes("Sorry"), true);
  });
});

// ── Self-narration openers ─────────────────────────────────────────────────
describe("applySelfCheck - self-narration openers", () => {
  test("strips 'Let me pull ...' opener", () => {
    const r = applySelfCheck("Let me pull that up. The count is 42.", { question: "how many?" });
    assert.equal(r.strips.self_narration, 1);
    assert.equal(/^let me/i.test(r.answer), false);
  });
  test("strips 'Let me check' opener", () => {
    const r = applySelfCheck("Let me check. The count is 42.", { question: "how many?" });
    assert.equal(r.strips.self_narration, 1);
  });
});

// ── Clock times ─────────────────────────────────────────────────────────────
describe("applySelfCheck - clock times", () => {
  test("strips 'as of 4:01 PM' style clock", () => {
    const r = applySelfCheck("Loaded at 4:01 PM UTC.", { question: "when?" });
    assert.equal(r.strips.clock >= 1, true, `strips: ${JSON.stringify(r.strips)}`);
    assert.equal(/\d{1,2}:\d{2}/.test(r.answer), false);
  });
  test("does not touch clock times inside a blockquote", () => {
    const original = "> Prior text with 4:01 PM.\nToday's count is 42.";
    const r = applySelfCheck(original, { question: "how many?" });
    assert.equal(r.strips.clock, 0);
    assert.equal(r.answer.includes("4:01 PM"), true);
  });
});

// ── Plumbing strip ─────────────────────────────────────────────────────────
describe("applySelfCheck - plumbing strip", () => {
  test("strips a body-line tool name (body-only list)", () => {
    const r = applySelfCheck("I called sc_account_window for that. Count: 42.", { question: "how many?" });
    assert.equal(r.strips.plumbing >= 1, true);
    assert.equal(r.answer.includes("sc_account_window"), false);
  });
  test("rewrites a Source-line tool name to the human label", () => {
    const original = "Count: 42.\n\nSource: sc_account_window (PG live).";
    const r = applySelfCheck(original, { question: "how many?" });
    assert.equal(r.strips.plumbing >= 1, true);
    assert.equal(r.answer.includes("sc_account_window"), false);
    assert.equal(r.answer.includes("SC tools"), true);
  });
  test("strips ALWAYS-list identifier (table name) anywhere", () => {
    const r = applySelfCheck("Data pulled from ai_line_items table.", { question: "where?" });
    assert.equal(r.strips.plumbing >= 1, true);
    assert.equal(r.answer.includes("ai_line_items"), false);
  });
});

// ── Multi-part detection ───────────────────────────────────────────────────
describe("checkMultiPart", () => {
  test("detects 'and who' conjunction pattern", () => {
    const r = checkMultiPart(
      "which accounts are behind on February entry, and who should I contact about each?",
      "CIN-AZ and TXR-AZ are behind. Talk to your RDO."
    );
    assert.equal(r.isMultiPart, true);
    assert.equal(r.parts.length >= 2, true);
    // Both parts should be addressed by the sample answer.
    assert.deepEqual(r.unaddressed, [], `unaddressed: ${JSON.stringify(r.unaddressed)}`);
  });
  test("flags unaddressed 'who' part when only 'which' is answered", () => {
    const r = checkMultiPart(
      "which accounts are behind on February entry, and who should I contact about each?",
      "CIN-AZ and TXR-AZ are behind on February entry."
    );
    assert.equal(r.isMultiPart, true);
    assert.equal(r.unaddressed.length, 1, `expected exactly one unaddressed part, got ${JSON.stringify(r.unaddressed)}`);
    assert.equal(/who/i.test(r.unaddressed[0]), true);
  });
  test("single-part question is not multi-part", () => {
    const r = checkMultiPart("what percent of February total did TBJ-FL represent?", "answer");
    assert.equal(r.isMultiPart, false);
    assert.deepEqual(r.unaddressed, []);
  });
});

// ── End-to-end: applySelfCheck fence preservation ─────────────────────────
describe("applySelfCheck - fence: never rewrite content, only remove/flag", () => {
  test("does not strip agreement openers inside blockquote content", () => {
    const original = "> You're right about the doc.\nCount: 42.";
    const r = applySelfCheck(original, { question: "count?" });
    // Blockquote line preserves its content; the answer body doesn't have
    // an agreement opener, so the strip counter stays at 0.
    assert.equal(r.strips.agreement, 0);
    assert.equal(r.answer.includes("You're right about the doc."), true);
  });
});
