#!/usr/bin/env node
// scripts/sousai-pagination-posture-test.mjs
// Guard: every entry in TOOL_REGISTRY must declare a `pagination` value from
// {"safe","paginated"} and a non-empty `paginationNote`. A deliberately-
// unbounded fixture is spliced in at the end to prove the guard fails.
//
// This is the "make it unable to recur" rule from plan v2.60: on 2026-07-30
// spend_summary shipped without pagination and silently truncated at 1000,
// undercounting the Sysco portfolio by 83%. The guard has to be as wide as
// the assumption that caused the bug.
//
// Run: node scripts/sousai-pagination-posture-test.mjs
// Exits non-zero on any violation.

import { TOOL_REGISTRY } from "../src/lib/sousai/tools/registry.js";

const VALID_POSTURES = new Set(["safe", "paginated"]);

const RED = "\x1b[31m", GREEN = "\x1b[32m", RESET = "\x1b[0m", BOLD = "\x1b[1m";

function check(entries, label) {
  const failures = [];
  for (const t of entries) {
    const name = t?.definition?.name || "(no name)";
    if (!("pagination" in t)) {
      failures.push({ name, reason: "missing `pagination` field" });
      continue;
    }
    if (!VALID_POSTURES.has(t.pagination)) {
      failures.push({ name, reason: `pagination='${t.pagination}' is not one of ${[...VALID_POSTURES].join(", ")}` });
      continue;
    }
    const note = t.paginationNote;
    if (!note || typeof note !== "string" || note.trim().length < 30) {
      failures.push({ name, reason: `paginationNote is missing or too short (< 30 chars) - state the growth argument` });
    }
  }
  console.log(`\n${BOLD}${label}: ${entries.length} tools checked${RESET}`);
  for (const t of entries) {
    const marker = t.pagination === "safe" ? "  " : "* ";
    console.log(`  ${marker}${t.definition.name.padEnd(28)} pagination=${t.pagination}`);
  }
  return failures;
}

function checkFixture() {
  // Deliberately-unbounded fixture. If the guard rules ever soften, this test
  // is what should scream. Missing `pagination` MUST fail the check.
  const broken = [
    {
      definition: { name: "broken_fixture", description: "", input_schema: { type: "object", properties: {} } },
      async execute() { return {}; },
      summarize() { return {}; },
      kind: "data",
      // pagination field intentionally omitted
      collectIds() { return []; },
    },
  ];
  const failures = check(broken, "Fixture (must fail)");
  if (failures.length === 0) {
    console.log(`${RED}FIXTURE CHECK FAILED - the guard did not catch a tool missing pagination.${RESET}`);
    process.exit(2);
  }
  console.log(`${GREEN}Fixture caught by guard as expected:${RESET} ${failures[0].reason}`);
}

const realFailures = check(TOOL_REGISTRY, "Real registry");

console.log("");
if (realFailures.length === 0) {
  console.log(`${GREEN}${BOLD}All ${TOOL_REGISTRY.length} registered tools declare pagination posture.${RESET}`);
} else {
  console.log(`${RED}${BOLD}${realFailures.length} tool(s) missing or invalid pagination declaration:${RESET}`);
  for (const f of realFailures) console.log(`  - ${f.name}: ${f.reason}`);
}

checkFixture();

if (realFailures.length > 0) process.exit(1);
console.log(`\n${GREEN}${BOLD}Pagination-posture guard PASSED.${RESET}`);
