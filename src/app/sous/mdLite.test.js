// ════════════════════════════════════════════════════════════════════════════
// mdLite unit tests (Train 3)
// ════════════════════════════════════════════════════════════════════════════
//
// Run with: node --test src/app/sous/mdLite.test.js
//
// Coverage:
//   - escapeHtml against a script-injection case
//   - bold rendering with the plan v2.32 $515,712 case
//   - bold across deltas: unbalanced marker renders literal until close
//   - numbered list rendering
//   - bulleted list rendering
//   - script tag inside markdown never becomes live HTML
// ════════════════════════════════════════════════════════════════════════════

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMdLite, escapeHtml } from "./mdLite.js";

test("escapeHtml escapes the five HTML entities", () => {
  const raw = `<script>alert("xss")</script>`;
  const out = escapeHtml(raw);
  assert.equal(out, "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
});

test("escapeHtml handles null/undefined without throwing", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});

test("renderMdLite escapes script injection - live HTML never emitted", () => {
  const raw = `Sous says: <script>alert(1)</script> the answer is here.`;
  const out = renderMdLite(raw);
  // The literal `<script>` must NOT appear; the escaped form must.
  assert.ok(!out.includes("<script>"), "raw <script> tag should not survive");
  assert.ok(out.includes("&lt;script&gt;"), "escaped tag should be present");
});

test("bold renders around a money figure (the $515,712 case)", () => {
  const raw = `The TBJ-FL 2026 service fee is **$515,712**.`;
  const out = renderMdLite(raw);
  assert.ok(out.includes("<strong>$515,712</strong>"));
});

test("bold across deltas: unbalanced ** renders literal until close", () => {
  // Simulates a partial streaming state where the closing ** has not yet
  // arrived. The unbalanced marker should render as literal text, not open
  // an infinite bold span.
  const partial = `The number is **515,712 and the`;
  const out = renderMdLite(partial);
  assert.ok(!out.includes("<strong>"), "unbalanced ** must not open <strong>");
  assert.ok(out.includes("**515,712"), "literal ** should render as text");
});

test("bold across deltas: closing ** in the next delta closes the span", () => {
  const full = `The number is **515,712** and the entity is **TBJ-FL**.`;
  const out = renderMdLite(full);
  assert.ok(out.includes("<strong>515,712</strong>"));
  assert.ok(out.includes("<strong>TBJ-FL</strong>"));
});

test("numbered list wraps in <ol> with <li> per item", () => {
  const raw = `Do these in order:\n1. Read PB-002\n2. Follow SOP-002\n3. Log it.`;
  const out = renderMdLite(raw);
  assert.ok(out.includes("<ol>"));
  assert.ok(out.includes("<li>Read PB-002</li>"));
  assert.ok(out.includes("<li>Follow SOP-002</li>"));
  assert.ok(out.includes("<li>Log it.</li>"));
  assert.ok(out.includes("</ol>"));
});

test("bulleted list wraps in <ul> with <li> per item", () => {
  const raw = `Sources:\n- PB-002\n- SOP-002\n- REF-140`;
  const out = renderMdLite(raw);
  assert.ok(out.includes("<ul>"));
  assert.ok(out.includes("<li>PB-002</li>"));
  assert.ok(out.includes("<li>SOP-002</li>"));
  assert.ok(out.includes("<li>REF-140</li>"));
  assert.ok(out.includes("</ul>"));
});

test("bold inside a list item still renders", () => {
  const raw = `- **PB-002** Allergen protocol\n- **SOP-002** Incident response`;
  const out = renderMdLite(raw);
  assert.ok(out.includes("<li><strong>PB-002</strong> Allergen protocol</li>"));
  assert.ok(out.includes("<li><strong>SOP-002</strong> Incident response</li>"));
});

test("plain line breaks become <br>", () => {
  const raw = `first line\nsecond line`;
  const out = renderMdLite(raw);
  assert.ok(out.includes("<br>"));
});

test("html entities inside a bold span stay escaped", () => {
  const raw = `Warning: **<danger>** must not open a tag.`;
  const out = renderMdLite(raw);
  assert.ok(!out.includes("<danger>"), "raw <danger> must not survive");
  assert.ok(out.includes("<strong>&lt;danger&gt;</strong>"));
});

// ── Table support (added Phase F PR 2) ───────────────────────────────────────

test("GFM table with header + separator + rows renders as <table>", () => {
  const raw = [
    "TBJ-FL breakfast rates:",
    "",
    "| Group | Rate | Effective |",
    "|---|---|---|",
    "| MLB | **$23.12** | 2026-01-01 |",
    "| MiLB | **$11.55** | 2026-01-01 |",
  ].join("\n");
  const out = renderMdLite(raw);
  assert.ok(out.includes("<table>"), "table opens");
  assert.ok(out.includes("<thead>"), "thead present");
  assert.ok(out.includes("<tbody>"), "tbody present");
  assert.ok(out.includes("<th>Group</th>"), "header cell renders");
  assert.ok(out.includes("<td>MLB</td>"), "body cell renders");
  assert.ok(out.includes("<td><strong>$23.12</strong></td>"), "bold inside cell preserved");
  assert.ok(!out.match(/\|[^<]/), "no literal pipes leak into non-tag output");
});

test("table with alignment colons in separator still parses", () => {
  const raw = [
    "| Left | Right |",
    "|:---|---:|",
    "| a | b |",
  ].join("\n");
  const out = renderMdLite(raw);
  assert.ok(out.includes("<table>"), "colon-aligned separator recognized");
  assert.ok(out.includes("<td>a</td>"));
  assert.ok(out.includes("<td>b</td>"));
});

test("malformed table (missing separator) renders as literal text", () => {
  const raw = [
    "| Group | Rate |",
    "| MLB | $23.12 |",
  ].join("\n");
  const out = renderMdLite(raw);
  assert.ok(!out.includes("<table>"), "no table produced without a separator");
  assert.ok(out.includes("| Group | Rate |"), "literal header preserved");
});

test("bare header + separator with no rows stays literal (avoids empty <table>)", () => {
  const raw = [
    "| Group | Rate |",
    "|---|---|",
  ].join("\n");
  const out = renderMdLite(raw);
  assert.ok(!out.includes("<table>"), "no table without body rows");
});

test("script injection inside a table CELL never becomes live HTML", () => {
  const raw = [
    "| Name | Note |",
    "|---|---|",
    `| <script>alert(1)</script> | <img src=x onerror=alert(2)> |`,
  ].join("\n");
  const out = renderMdLite(raw);
  // Live HTML that would execute must never survive - the concrete injection
  // vectors are `<script`, `<img`, `<iframe`, `<svg`, `<object`, `<style` as
  // real tag opens (a `<` followed by an ASCII letter). Escaped forms
  // (&lt;script&gt;) are safe - they render as visible text, not HTML.
  assert.ok(!/<script/i.test(out), "raw <script> must not survive in cell");
  assert.ok(!/<img\s/i.test(out), "raw <img> must not survive in cell");
  assert.ok(out.includes("&lt;script&gt;"), "escaped script tag present");
  assert.ok(out.includes("&lt;img"), "escaped img tag present");
});

test("table split across deltas (partial) renders literal until complete", () => {
  // Simulates a mid-stream state where only the header + separator have
  // arrived. Should stay literal, not open a broken <table>.
  const partial = [
    "TBJ-FL breakfast rates:",
    "",
    "| Group | Rate |",
    "|---|---|",
  ].join("\n");
  const out = renderMdLite(partial);
  assert.ok(!out.includes("<table>"), "no table until first body row arrives");
});

// ── Round 0c Part C: real paragraphs ────────────────────────────────────────

test("prose separated by a blank line emits real <p> paragraphs, no <br> stack", () => {
  const raw = "The allergen protocol lives in PB-002.\n\nCall the chef, then log the incident.";
  const out = renderMdLite(raw);
  const pCount = (out.match(/<p[^>]*>/g) || []).length;
  const brCount = (out.match(/<br>/g) || []).length;
  assert.ok(pCount >= 2, `expected 2+ <p> paragraphs, got ${pCount}: ${out}`);
  assert.equal(brCount, 0, `expected zero <br> for paragraph separation, got ${brCount}`);
  assert.ok(out.includes("<p>The allergen protocol lives in PB-002.</p>"));
});

test("trailing Source: line becomes real .sa-answer-source element", () => {
  const raw = "Call the chef, then log the incident.\n\nSource: PB-002 §7.3";
  const out = renderMdLite(raw);
  assert.ok(out.includes(`<div class="sa-answer-source">Source: PB-002 §7.3</div>`), `got: ${out}`);
});

test("trailing **Source:** (bold) line becomes .sa-answer-source", () => {
  const raw = "Answer body.\n\n**Source:** PB-002";
  const out = renderMdLite(raw);
  assert.ok(/<div class="sa-answer-source">.*<strong>Source:<\/strong>/.test(out), `got: ${out}`);
});

test("Note: lead-in paragraph gets .sa-callout class", () => {
  const raw = "Note: This applies only to Live docs.";
  const out = renderMdLite(raw);
  assert.ok(out.includes(`<p class="sa-callout">Note: This applies only to Live docs.</p>`), `got: ${out}`);
});

test("Important: lead-in paragraph gets .sa-callout class", () => {
  const raw = "Important: Always escalate to the chef.";
  const out = renderMdLite(raw);
  assert.ok(out.includes(`<p class="sa-callout">Important: Always escalate to the chef.</p>`), `got: ${out}`);
});

test("headings emit as block elements, not wrapped in <p>", () => {
  const raw = "## Per-meal accounts\n\nAll six accounts are entered.";
  const out = renderMdLite(raw);
  assert.ok(out.includes("<h3>Per-meal accounts</h3>"), "heading survives");
  assert.ok(!out.match(/<p>[^<]*<h3>/), "heading is not wrapped inside <p>");
});

test("list emits as block elements, not wrapped in <p>", () => {
  const raw = "Sources:\n\n- PB-002\n- SOP-002";
  const out = renderMdLite(raw);
  assert.ok(out.includes("<ul>"), "list opens");
  assert.ok(!out.match(/<p>\s*<ul>/), "list is not wrapped inside <p>");
});

test("allergen-shape answer produces zero <br> paragraph separators and >=4 <p> children", () => {
  // Reproduces the answer shape the D-02 recon measured: multiple prose
  // paragraphs, an intervening heading, a list, and a Source line.
  const raw = [
    "If someone has an allergic reaction, follow the documented protocol.",
    "",
    "Stop service to that guest immediately. Do not attempt to negotiate the reaction.",
    "",
    "## Escalate",
    "",
    "Call the chef on shift. If the reaction is severe, call 911.",
    "",
    "Then file an incident report:",
    "",
    "- Log timestamp and account",
    "- Attach any menu / label photos",
    "- Route to your RDO for follow-up",
    "",
    "Source: PB-002 §7.3, SOP-002",
  ].join("\n");
  const out = renderMdLite(raw);
  const pCount = (out.match(/<p[^>]*>/g) || []).length;
  const brCount = (out.match(/<br>/g) || []).length;
  assert.ok(pCount >= 4, `expected 4+ <p> children, got ${pCount}`);
  assert.equal(brCount, 0, `expected zero <br>, got ${brCount}: ${out}`);
  assert.ok(out.includes(`<div class="sa-answer-source">Source: PB-002 §7.3, SOP-002</div>`));
});

test("intra-paragraph single newlines still emit <br> (line-break preservation)", () => {
  // Two lines separated by ONE newline should stay as one paragraph with <br>.
  const raw = "first line\nsecond line";
  const out = renderMdLite(raw);
  assert.ok(out.includes("<br>"), "single newline within a paragraph becomes <br>");
  assert.ok(out.includes("<p>first line<br>second line</p>"), `got: ${out}`);
});

// ── Round 0c Part D measured: ordinal columns left-align ────────────────────

test("ordinal-header column tagged with data-ord (left-align), quantities keep data-num", () => {
  const raw = [
    "| Rank | Vendor | Spend |",
    "|---|---|---|",
    "| 1 | Sysco | $244,954 |",
    "| 2 | FreshPoint | $118,232 |",
  ].join("\n");
  const out = renderMdLite(raw);
  assert.ok(out.includes(`<th data-ord>Rank</th>`), "Rank header carries data-ord");
  assert.ok(out.includes(`<td data-ord>1</td>`), "rank cell carries data-ord");
  assert.ok(out.includes(`<td data-num>`), "Spend cell keeps data-num");
});

test("row-count mismatch stops the table cleanly", () => {
  const raw = [
    "| A | B | C |",
    "|---|---|---|",
    "| 1 | 2 | 3 |",
    "| 1 | 2 |", // wrong cell count
  ].join("\n");
  const out = renderMdLite(raw);
  // Cell may or may not carry `data-num` depending on whether the column
  // classifier ran - either shape is a "well-formed row still lands".
  assert.ok(/<td(?:\s+data-num)?>1<\/td>/.test(out), "first well-formed row still lands");
  // The mismatched row should not have injected two cells masquerading as three.
  assert.ok(!out.match(/<td(?:\s+data-num)?>1<\/td><td(?:\s+data-num)?>2<\/td><td(?:\s+data-num)?><\/td>/), "no phantom cell filled in");
});
