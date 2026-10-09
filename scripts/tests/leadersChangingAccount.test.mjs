#!/usr/bin/env node
// Unit test for src/lib/people/leadersChangingAccount.js.
//
// Covers:
//   - positive: leader whose account_key changes to a different non-null
//     account is returned
//   - negative: not a leader -> ignored
//   - negative: leader whose account_key did not change -> ignored
//   - negative: leader whose new account_key is null (unknown dept) -> ignored
//
// Run: node scripts/tests/leadersChangingAccount.test.mjs

import { leadersChangingAccount } from "../../src/lib/people/leadersChangingAccount.js";

let passed = 0, failed = 0;
function assert(cond, name, detail = "") {
  if (cond) { passed++; console.log(`  PASS · ${name}`); }
  else { failed++; console.log(`  FAIL · ${name}${detail ? "\n         " + detail : ""}`); }
}

// ─── Fixture inputs ───────────────────────────────────────────────────
// Four workers, one shaped row per worker. Scenarios:
//   w_transfer     : leader, moving CIN - KY -> TBR - FL (positive)
//   w_not_leader   : hourly worker moving, not a leader (negative)
//   w_stayed       : leader, same account (negative)
//   w_null_target  : leader, new account_key null (dept-map gap; negative)
const existingByWorker = new Map([
  ["w_transfer",    { account_key: "CIN - KY",  is_site_leader: true  }],
  ["w_not_leader",  { account_key: "STL - FL",  is_site_leader: false }],
  ["w_stayed",      { account_key: "TBJ - FL",  is_site_leader: true  }],
  ["w_null_target", { account_key: "TXR - AZ",  is_site_leader: true  }],
]);

const shapedRows = [
  { worker_id: "w_transfer",    account_key: "TBR - FL" },  // positive
  { worker_id: "w_not_leader",  account_key: "TBR - FL" },  // negative - not a leader
  { worker_id: "w_stayed",      account_key: "TBJ - FL" },  // negative - account unchanged
  { worker_id: "w_null_target", account_key: null       },  // negative - new account null
];

const out = leadersChangingAccount(existingByWorker, shapedRows);

console.log("\nleadersChangingAccount · 4-case fixture");
assert(Array.isArray(out), "returns an array");
assert(out.length === 1, `exactly one transfer detected (got ${out.length}: ${JSON.stringify(out)})`);
assert(out.includes("w_transfer"), "positive: leader moving to different non-null account_key is included");
assert(!out.includes("w_not_leader"), "negative: non-leader is excluded");
assert(!out.includes("w_stayed"), "negative: leader with unchanged account_key is excluded");
assert(!out.includes("w_null_target"), "negative: leader with new account_key = null is excluded (dept-map gap protection)");

// Extra: a worker in shapedRows with no entry in existingByWorker (new
// hire path) must not crash and must not be included.
const outWithNew = leadersChangingAccount(
  existingByWorker,
  [...shapedRows, { worker_id: "w_new", account_key: "CORP" }]
);
assert(!outWithNew.includes("w_new"), "new worker (no prior row) is excluded");

console.log("");
console.log(`result: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
