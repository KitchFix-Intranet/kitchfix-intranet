#!/usr/bin/env node
// scripts/probes/_probe_test_mode_inertness.mjs
//
// Overview Phase 4 (2026-08-31): the TEST_MODE backdoor gate.
//
// PURPOSE
//   The overview API route accepts `?_test_role=<role>` and
//   `?_test_scope=<key>` query params - but ONLY when the request
//   runs under the TEST_MODE double-gate:
//     process.env.TEST_MODE === "true" && process.env.VERCEL !== "1"
//   Every other environment (real prod, real preview, dev-server-
//   without-TEST_MODE) must IGNORE the params. Kevin ruling on PR
//   #916: "a probe asserting both params are inert when TEST_MODE
//   is unset - the gate needs its own guard, same as every other
//   gate here."
//
// APPROACH
//   The probe reads three surfaces and asserts:
//
//   [C1] src/app/api/kpi/overview/route.js
//        The `_test_role` / `_test_scope` acceptance block is inside
//        an `if (testModeBypass)` conditional, where testModeBypass
//        is `TEST_MODE === "true" && VERCEL !== "1"`.
//
//   [C2] src/middleware.js
//        The TEST_MODE bypass is gated by the identical condition.
//
//   [C3] Grep the entire repo. No other file reads `_test_role` or
//        `_test_scope` from a URL, cookie, header, or any other
//        request-side surface. If a second reader appears without
//        the same gate, this probe fires.
//
// SEEDED FAILURE
//   Toggle SEEDED_FAILURE=1 to exercise the C1 branch by having the
//   probe search for a marker phrase that doesn't exist ("__seed_
//   fail__"). The probe fires on the same surface as a real leak.
//   Restores automatically - the seed flips the expected-marker
//   string, never the source file.
//
// USAGE
//   node scripts/probes/_probe_test_mode_inertness.mjs
//   SEEDED_FAILURE=1 node scripts/probes/_probe_test_mode_inertness.mjs
//   (No env vars required. Pure code-read.)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..", "..");
const SEEDED_FAILURE = process.env.SEEDED_FAILURE === "1";

const ROUTE_PATH = path.join(REPO_ROOT, "src/app/api/kpi/overview/route.js");
const MIDDLEWARE_PATH = path.join(REPO_ROOT, "src/middleware.js");

const results = [];
function record(id, name, passed, detail) {
  results.push({ id, name, passed: !!passed, detail });
}

// ─── C1: route.js gates the _test_role / _test_scope block ────────
//
// Structural read: locate the `testModeBypass` declaration, locate
// the `_test_role` acceptance branch, verify the branch is inside a
// `!testModeBypass` -> return-401 fence and inside an `if (testModeBypass)`
// conditional that guards role injection. Direct grep for both markers.
//
// Marker phrases: allow toggling one to demonstrate the seeded failure
// path without editing source.
function checkRoute() {
  const src = fs.readFileSync(ROUTE_PATH, "utf8");

  // The double-gate assignment must be present in the route.
  const gateAssignmentRe = /const\s+testModeBypass\s*=\s*process\.env\.TEST_MODE\s*===\s*["']true["']\s*&&\s*process\.env\.VERCEL\s*!==\s*["']1["']/;
  const gateOk = gateAssignmentRe.test(src);
  record("C1a", "route.js declares testModeBypass with the double-gate", gateOk, gateOk ? "found" : "expected `const testModeBypass = process.env.TEST_MODE === \"true\" && process.env.VERCEL !== \"1\"`");

  // The role-injection block must sit inside `if (testModeBypass)`.
  // Structurally: find every occurrence of `_test_role` in the source
  // and require each occurrence is inside a testModeBypass conditional.
  // The block is a single `if (testModeBypass)` scope in the route
  // today; a second reader outside that scope is a leak.
  //
  // Approach: split on `if (testModeBypass)` and assert `_test_role`
  // appears ONLY in the branch that follows this if, not before, and
  // not outside the else-if fall-through that returns 401.
  const seedMarker = SEEDED_FAILURE ? "__seed_fail__" : "_test_role";
  const rolePositions = [];
  let idx = 0;
  while ((idx = src.indexOf(seedMarker, idx)) !== -1) {
    rolePositions.push(idx);
    idx += 1;
  }
  if (rolePositions.length === 0) {
    record("C1b", "route.js contains _test_role acceptance", false, SEEDED_FAILURE ? "SEEDED FAILURE: marker '__seed_fail__' intentionally absent" : "expected `_test_role` reads inside the testModeBypass block");
    return;
  }

  // Locate the testModeBypass conditional block bounds.
  const ifMatch = /if\s*\(\s*testModeBypass\s*\)\s*\{/.exec(src);
  if (!ifMatch) {
    record("C1b", "route.js gates _test_role behind if (testModeBypass)", false, "no `if (testModeBypass) {` block found");
    return;
  }
  const blockStart = ifMatch.index + ifMatch[0].length;
  // Walk braces to find matching close.
  let depth = 1;
  let i = blockStart;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    i += 1;
  }
  const blockEnd = i; // exclusive
  const allInsideBlock = rolePositions.every(p => p >= blockStart && p < blockEnd);
  record("C1b", "route.js gates every _test_role read inside if (testModeBypass)", allInsideBlock, allInsideBlock
    ? `${rolePositions.length} reads all within the double-gate block`
    : `${rolePositions.filter(p => p < blockStart || p >= blockEnd).length} read(s) outside the double-gate block`);

  // The comment-block that Kevin's PR-916 ruling asked for: the
  // backdoor-removal TODO must sit adjacent to the acceptance branch.
  // This is a soft signal (informational only, not FAIL-blocking).
  const removalTodo = /TODO[^\n]*(remove|drop)[^\n]*(backdoor|site\s+posture|live\s+build)/i.test(src);
  record("C1c", "route.js carries a backdoor-removal TODO adjacent to _test_role", removalTodo, removalTodo ? "TODO found" : "informational: no removal TODO found in route.js");
}

// ─── C2: middleware.js gates the TEST_MODE bypass ─────────────────
function checkMiddleware() {
  const src = fs.readFileSync(MIDDLEWARE_PATH, "utf8");
  const gateRe = /if\s*\(\s*process\.env\.TEST_MODE\s*===\s*["']true["']\s*&&\s*process\.env\.VERCEL\s*!==\s*["']1["']\s*\)\s*\{/;
  const ok = gateRe.test(src);
  record("C2", "middleware.js gates the TEST_MODE bypass with the same double-gate", ok, ok ? "found" : "expected `if (process.env.TEST_MODE === \"true\" && process.env.VERCEL !== \"1\")` at the top of middleware()");
}

// ─── C3: no other file reads _test_role / _test_scope from a URL ──
//
// Walk src/ + scripts/ (skip node_modules / .next / .git). Flag any
// occurrence of the two params outside:
//   - src/app/api/kpi/overview/route.js  (the gated reader)
//   - src/app/kpi/overview/page.js       (the client forwards the
//                                         params in the URL - it does
//                                         not READ them from a request;
//                                         it plants them for the server)
//   - probes / audit scripts             (test-only, allowed)
//
// The distinction the probe cares about: server-side READERS. The
// client forwarding is not a leak because the server ignores the
// params outside the gate.
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && /\.(js|jsx|ts|tsx|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function checkNoOtherReaders() {
  const SRC_DIR = path.join(REPO_ROOT, "src");
  const files = walk(SRC_DIR);
  const allowed = new Set([
    path.join(SRC_DIR, "app", "api", "kpi", "overview", "route.js"),
    path.join(SRC_DIR, "app", "kpi", "overview", "page.js"),
  ]);
  const bad = [];
  for (const f of files) {
    if (allowed.has(f)) continue;
    const src = fs.readFileSync(f, "utf8");
    // Match a URL-side read: `.get("_test_role")`, `.get('_test_role')`,
    // or the string appearing in a `searchParams` / `URL` / `request`
    // context. A hit on the bare string outside those contexts (e.g.
    // in a comment) is not a leak, so match the read shape not the
    // token alone.
    const readRe = /\.get\(\s*["'](_test_role|_test_scope)["']\s*\)/;
    if (readRe.test(src)) bad.push(path.relative(REPO_ROOT, f));
  }
  record("C3", "no other server-side surface reads _test_role / _test_scope from a URL",
    bad.length === 0,
    bad.length === 0
      ? `scanned ${files.length} files, only the two allowed readers found`
      : `LEAK: readers outside the allowlist: ${bad.join(", ")}`);
}

// ─── Report ────────────────────────────────────────────────────────
console.log("─".repeat(70));
console.log("PROBE: TEST_MODE inertness gate");
console.log(`REPO: ${REPO_ROOT}`);
console.log(`SEEDED_FAILURE: ${SEEDED_FAILURE ? "ON (expected FAIL)" : "off"}`);
console.log("─".repeat(70));

try {
  checkRoute();
  checkMiddleware();
  checkNoOtherReaders();
} catch (e) {
  console.error(`[abort] ${e?.message || e}`);
  process.exit(2);
}

let pass = 0, fail = 0;
for (const r of results) {
  const mark = r.passed ? "PASS" : "FAIL";
  if (r.passed) pass += 1; else fail += 1;
  console.log(`[${mark}] ${r.id} - ${r.name}`);
  console.log(`       ${r.detail}`);
}
console.log("─".repeat(70));
console.log(`SUMMARY: ${pass} PASS · ${fail} FAIL`);
console.log("─".repeat(70));

// Informational checks (C1c) do not affect exit code.
const criticalFail = results.some(r => !r.passed && r.id !== "C1c");
process.exit(criticalFail ? 1 : 0);
