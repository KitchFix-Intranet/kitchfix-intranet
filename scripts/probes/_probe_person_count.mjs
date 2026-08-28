// countDistinctPeople assertions, 2026-08-28.
//
// Pure function - runs offline (no Supabase). Fixture-driven so we
// can prove the fix on cases the live data cannot demonstrate
// today (e.g., a mid-fiscal-year rehire where one person has five
// worker_ids). This is option A from the earlier person-key report:
// synthetic Keith Gilman with five spells, plus edge cases.
//
// Usage: node scripts/probes/_probe_person_count.mjs

import { countDistinctPeople, buildWorkerToEmail } from "../../src/lib/labor/personCount.js";

let failures = 0;
function assert(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures += 1;
  console.log(`  ✗ ${name}`);
  if (extra !== undefined) console.log(`      ${JSON.stringify(extra)}`);
}

console.log("=== countDistinctPeople ===\n");

// A. Empty / degenerate.
assert("empty rows -> 0",           countDistinctPeople([], new Map()) === 0);
assert("null rows -> 0",            countDistinctPeople(null, new Map()) === 0);
assert("undefined rows -> 0",       countDistinctPeople(undefined, new Map()) === 0);
assert("rows with no worker_id skipped -> 0",
  countDistinctPeople([{ amount: 10 }, { worker_id: null }, { worker_id: "" }], new Map()) === 0);

// B. The Keith Gilman case. Five spells, one email, one person.
{
  const rows = [
    { worker_id: "wid-2022", amount: 100 },
    { worker_id: "wid-2023", amount: 100 },
    { worker_id: "wid-2024-a", amount: 100 },
    { worker_id: "wid-2024-b", amount: 100 },
    { worker_id: "wid-2025", amount: 100 },
  ];
  const emailMap = new Map([
    ["wid-2022",   "kgilman@kitchfix.com"],
    ["wid-2023",   "kgilman@kitchfix.com"],
    ["wid-2024-a", "kgilman@kitchfix.com"],
    ["wid-2024-b", "kgilman@kitchfix.com"],
    ["wid-2025",   "kgilman@kitchfix.com"],
  ]);
  assert("Keith Gilman: 5 worker_ids, 1 email -> 1 person",
    countDistinctPeople(rows, emailMap) === 1);
  assert("Same rows without map falls back to worker_id -> 5 (pre-fix behaviour)",
    countDistinctPeople(rows, null) === 5);
  assert("Same rows with empty map -> 5 (fallback preserves count)",
    countDistinctPeople(rows, new Map()) === 5);
}

// C. Mixed: three people, one of whom has two spells. 4 worker_ids, 3 people.
{
  const rows = [
    { worker_id: "wid-alice-1" },
    { worker_id: "wid-alice-2" },
    { worker_id: "wid-bob" },
    { worker_id: "wid-carol" },
  ];
  const emailMap = new Map([
    ["wid-alice-1", "alice@kf.com"],
    ["wid-alice-2", "alice@kf.com"],
    ["wid-bob",     "bob@kf.com"],
    ["wid-carol",   "carol@kf.com"],
  ]);
  assert("Mixed: 4 worker_ids across 3 people -> 3",
    countDistinctPeople(rows, emailMap) === 3);
}

// D. Unmapped worker_ids count as their own person (conservative).
{
  const rows = [
    { worker_id: "wid-known-1" },
    { worker_id: "wid-known-2" },   // same email as known-1
    { worker_id: "wid-unmapped" },  // not in map
  ];
  const emailMap = new Map([
    ["wid-known-1", "person@kf.com"],
    ["wid-known-2", "person@kf.com"],
  ]);
  assert("Unmapped id counts as its own person -> 2 (1 email + 1 unmapped)",
    countDistinctPeople(rows, emailMap) === 2);
}

// E. Two unmapped ids stay distinct (don't collapse together).
{
  const rows = [
    { worker_id: "wid-unmapped-A" },
    { worker_id: "wid-unmapped-B" },
  ];
  assert("Two unmapped ids stay distinct -> 2 (never collapse unmapped)",
    countDistinctPeople(rows, new Map()) === 2);
}

// F. Object form of map (matches the shape resolveWorkerMeta returns).
{
  const rows = [
    { worker_id: "w1" },
    { worker_id: "w2" },
  ];
  const emailObj = { w1: "same@kf.com", w2: "same@kf.com" };
  assert("Object form of map accepted -> 1 person",
    countDistinctPeople(rows, emailObj) === 1);
}

// G. Repeated rows for the same worker_id in the same range don't
//    inflate the count (weekly aggregates would send rows per week).
{
  const rows = [
    { worker_id: "w1", week: "2026-07-13" },
    { worker_id: "w1", week: "2026-07-20" },
    { worker_id: "w1", week: "2026-07-27" },
    { worker_id: "w2", week: "2026-07-13" },
    { worker_id: "w2", week: "2026-07-20" },
  ];
  const emailMap = new Map([["w1", "a@kf.com"], ["w2", "b@kf.com"]]);
  assert("Multi-week rows: 2 people (not 5 rows)",
    countDistinctPeople(rows, emailMap) === 2);
}

// H. Approval_people shape: pre-filter rows to those with drafts,
//    then count. Same helper, pre-filtered input.
{
  const rows = [
    { worker_id: "w1", draft_hours: 5 },
    { worker_id: "w1", draft_hours: 0 },   // same person, no draft this week
    { worker_id: "w2", draft_hours: 0 },   // different person, no draft
    { worker_id: "w3", draft_hours: 3 },   // different person, draft
  ];
  const emailMap = new Map([["w1", "a@kf.com"], ["w2", "b@kf.com"], ["w3", "c@kf.com"]]);
  const withDrafts = rows.filter(r => Number(r.draft_hours || 0) > 0.004);
  assert("approval_people via pre-filter: 2 people with drafts (w1 + w3)",
    countDistinctPeople(withDrafts, emailMap) === 2);
}

// I. Fixture that mimics the exact Keith Gilman case in a per-week
//    aggregate: 5 worker_ids each with 1 row (one week each), one
//    email -> pre-fix would report 5, post-fix reports 1.
{
  const rows = [
    { worker_id: "wid-a", week_start: "2026-01-05", amount: 200 },
    { worker_id: "wid-b", week_start: "2026-03-02", amount: 200 },
    { worker_id: "wid-c", week_start: "2026-05-11", amount: 200 },
    { worker_id: "wid-d", week_start: "2026-07-06", amount: 200 },
    { worker_id: "wid-e", week_start: "2026-09-07", amount: 200 },
  ];
  const emailMap = new Map([
    ["wid-a", "seasonal@kf.com"],
    ["wid-b", "seasonal@kf.com"],
    ["wid-c", "seasonal@kf.com"],
    ["wid-d", "seasonal@kf.com"],
    ["wid-e", "seasonal@kf.com"],
  ]);
  assert("Seasonal rehire fixture (Keith Gilman shape): 1 person across 5 spells",
    countDistinctPeople(rows, emailMap) === 1);
}

// J. buildWorkerToEmail - the resolveWorkerMeta bridge.
console.log("\n=== buildWorkerToEmail ===\n");
{
  const workerMeta = {
    "w1": { worker_id: "w1", email: "a@kf.com", display_name: "A" },
    "w2": { worker_id: "w2", email: "b@kf.com", display_name: "B" },
    "w3": { worker_id: "w3", email: null,       display_name: null },   // no email - skipped
    "w4": { worker_id: "w4",                     display_name: "D" },   // no email field - skipped
  };
  const m = buildWorkerToEmail(workerMeta);
  assert("workers with email included",  m.get("w1") === "a@kf.com" && m.get("w2") === "b@kf.com");
  assert("workers with null email skipped", !m.has("w3"));
  assert("workers with no email field skipped", !m.has("w4"));
  assert("map size = 2 (only mapped workers)", m.size === 2);
}
assert("buildWorkerToEmail(null) -> empty map", buildWorkerToEmail(null).size === 0);
assert("buildWorkerToEmail({}) -> empty map",   buildWorkerToEmail({}).size === 0);

// K. Round-trip: workerMeta -> buildWorkerToEmail -> countDistinctPeople.
{
  const rows = [
    { worker_id: "w1" },
    { worker_id: "w1" },
    { worker_id: "w2" },
    { worker_id: "w3" },   // unmapped (no email in meta)
  ];
  const workerMeta = {
    "w1": { worker_id: "w1", email: "shared@kf.com" },
    "w2": { worker_id: "w2", email: "shared@kf.com" },
    "w3": { worker_id: "w3", email: null },
  };
  const emailMap = buildWorkerToEmail(workerMeta);
  assert("Round-trip: 3 worker_ids -> 2 people (1 email + 1 unmapped w3)",
    countDistinctPeople(rows, emailMap) === 2);
}

console.log(`\n---`);
if (failures > 0) {
  console.log(`${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log(`all assertions pass. countDistinctPeople + buildWorkerToEmail cover the shape resolveWorkerMeta returns.`);
