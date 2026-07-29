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
