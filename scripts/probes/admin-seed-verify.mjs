// scripts/probes/admin-seed-verify.mjs
//
// Verifies the people-2-admin-columns.sql seed against the live DB.
// Bidirectional: expected -> DB and DB -> expected. Fails on any
// mismatch.
//
// Pre-apply: if the new columns are absent, the probe reports
// "MIGRATION NOT APPLIED" and exits 2 (distinct from exit 1 = real
// mismatch). This lets Kevin re-run it any time to see where we are.
//
// Usage:
//   node --env-file=.env.local scripts/probes/admin-seed-verify.mjs
//
// Exit codes:
//   0 - all expected flags match DB, no unexpected flags found
//   1 - mismatch (expected emails missing, wrong flags, or extras)
//   2 - migration not applied yet (new columns absent)
//   3 - env or connection error

import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL) { console.error("ABSENT: SUPABASE_URL"); process.exit(3); }
if (!SB_KEY) { console.error("ABSENT: SUPABASE_SERVICE_ROLE_KEY"); process.exit(3); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const EXPECTED = {
  OPS_LEADERSHIP: [
    "k.fietek@kitchfix.com", "a.wasserman@kitchfix.com", "britt@kitchfix.com",
    "joe@kitchfix.com", "josh@kitchfix.com", "m.chavez@kitchfix.com",
  ],
  SC_ACCESS: [
    "k.fietek@kitchfix.com", "joe@kitchfix.com", "josh@kitchfix.com",
    "s.castro@kitchfix.com", "m.chavez@kitchfix.com", "r.moore@kitchfix.com",
    "j.trible@kitchfix.com", "m.decanio@kitchfix.com", "e.randall@kitchfix.com",
    "a.lacy@kitchfix.com", "a.hughes@kitchfix.com",
  ],
  SC_ADMIN: [
    "k.fietek@kitchfix.com", "josh@kitchfix.com", "joe@kitchfix.com",
    "britt@kitchfix.com", "m.chavez@kitchfix.com", "s.castro@kitchfix.com",
    "r.moore@kitchfix.com", "s.lynch@kitchfix.com",
  ],
  SC_LOCK_OVERRIDE: [
    "k.fietek@kitchfix.com", "joe@kitchfix.com", "s.castro@kitchfix.com",
  ],
  PAF_ALWAYS_CC: [
    "k.fietek@kitchfix.com", "m.chavez@kitchfix.com",
    "joe@kitchfix.com", "a.wasserman@kitchfix.com",
  ],
  PLAYBOOK_OWNER: ["k.fietek@kitchfix.com"],
  INCIDENT_ALL: [
    "k.fietek@kitchfix.com", "m.chavez@kitchfix.com",
    "josh@kitchfix.com", "joe@kitchfix.com", "britt@kitchfix.com",
  ],
  REGION: {
    "r.moore@kitchfix.com":   "West",
    "s.lynch@kitchfix.com":   "East",
    "k.fietek@kitchfix.com":  "CORP",
  },
};

const COLUMN_FOR = {
  OPS_LEADERSHIP:   "is_ops_leadership",
  SC_ACCESS:        "is_sc_access",
  SC_ADMIN:         "is_sc_admin",
  SC_LOCK_OVERRIDE: "is_sc_lock_override",
  PAF_ALWAYS_CC:    "paf_always_cc",
  PLAYBOOK_OWNER:   "is_playbook_owner",
};

const COLUMNS = [
  "work_email",
  "is_ops_leadership",
  "is_sc_access",
  "is_sc_admin",
  "is_sc_lock_override",
  "is_playbook_owner",
  "paf_always_cc",
  "region",
  "incident_notify",
];

console.log("ADMIN SEED VERIFY");
console.log("=================");

// ─── Fetch ────────────────────────────────────────────────────────
// Full table scan on `people` (~1,100 rows is cheap). We query every
// row because the reverse walk needs to see ANY row with a TRUE
// permission flag, not just the rows we expect.
let rows;
{
  const { data, error } = await supa.from("people").select(COLUMNS.join(", "));
  if (error) {
    // Distinguish "columns absent" (migration not yet applied) from a
    // real connection error.
    if (/column\s+("|'?)people\.(is_|paf_|region|incident_notify|is_sc_|is_ops_|is_playbook_)/i.test(error.message)
     || /does not exist/i.test(error.message)) {
      console.log("");
      console.log("MIGRATION NOT APPLIED - the people-2-admin-columns.sql columns are absent.");
      console.log(`  Supabase error: ${error.message}`);
      console.log("");
      console.log("Expected flow:");
      console.log("  1. Paste docs/migrations/people-2-admin-columns.sql into Supabase Studio");
      console.log("  2. Re-run this probe");
      console.log("");
      console.log("RESULT: MIGRATION NOT APPLIED YET (exit 2)");
      process.exit(2);
    }
    console.error(`select failed: ${error.message}`);
    process.exit(3);
  }
  rows = data || [];
}

// Index by LOWER(work_email) for quick lookups.
const byEmail = new Map();
for (const r of rows) {
  const e = String(r.work_email || "").toLowerCase().trim();
  if (!e) continue;
  byEmail.set(e, r);
}

let failed = 0;
const failures = [];
function report(group, matched, total, extras = []) {
  const pad = (group + ":").padEnd(18, " ");
  const bar = matched === total ? "✓" : "✗";
  console.log(`${pad}${String(matched).padStart(2)}/${String(total).padStart(2)} match  ${bar}`);
  if (matched !== total || extras.length > 0) {
    failed++;
    for (const e of extras) failures.push(`${group}: ${e}`);
  }
}

// ─── Direction A: expected -> DB ──────────────────────────────────
for (const groupName of ["OPS_LEADERSHIP","SC_ACCESS","SC_ADMIN","SC_LOCK_OVERRIDE","PAF_ALWAYS_CC","PLAYBOOK_OWNER"]) {
  const col = COLUMN_FOR[groupName];
  const list = EXPECTED[groupName];
  const extras = [];
  let matched = 0;
  for (const email of list) {
    const row = byEmail.get(email.toLowerCase());
    if (!row) {
      extras.push(`expected ${email} not found in people table`);
      continue;
    }
    if (row[col] === true) matched++;
    else extras.push(`${email}: ${col}=${row[col]} (expected TRUE)`);
  }
  report(groupName, matched, list.length, extras);
}

// Incident_notify = 'all' group
{
  const list = EXPECTED.INCIDENT_ALL;
  const extras = [];
  let matched = 0;
  for (const email of list) {
    const row = byEmail.get(email.toLowerCase());
    if (!row) { extras.push(`expected ${email} not found`); continue; }
    if (row.incident_notify === "all") matched++;
    else extras.push(`${email}: incident_notify=${row.incident_notify} (expected 'all')`);
  }
  report("INCIDENT_ALL", matched, list.length, extras);
}

// Region map
{
  const map = EXPECTED.REGION;
  const emails = Object.keys(map);
  const extras = [];
  let matched = 0;
  for (const email of emails) {
    const row = byEmail.get(email.toLowerCase());
    if (!row) { extras.push(`expected ${email} not found`); continue; }
    const expected = map[email];
    if (row.region === expected) matched++;
    else extras.push(`${email}: region=${row.region} (expected ${expected})`);
  }
  report("REGION", matched, emails.length, extras);
}

console.log("---");

// ─── Direction B: DB -> expected ──────────────────────────────────
// Walk every row with any permission flag set, confirm it is listed
// in the matching expected group. Bidirectional-diff law: a one-way
// walk would miss stray TRUEs set in Studio by hand.
const extras = [];
for (const r of rows) {
  const email = String(r.work_email || "").toLowerCase().trim();
  if (!email) continue;

  for (const groupName of ["OPS_LEADERSHIP","SC_ACCESS","SC_ADMIN","SC_LOCK_OVERRIDE","PAF_ALWAYS_CC","PLAYBOOK_OWNER"]) {
    const col = COLUMN_FOR[groupName];
    if (r[col] === true && !EXPECTED[groupName].map((x) => x.toLowerCase()).includes(email)) {
      extras.push(`${col}=TRUE on ${email} but not expected in ${groupName}`);
    }
  }
  if (r.incident_notify === "all"
      && !EXPECTED.INCIDENT_ALL.map((x) => x.toLowerCase()).includes(email)) {
    extras.push(`incident_notify='all' on ${email} but not expected`);
  }
  if (r.region && !Object.keys(EXPECTED.REGION).map((x) => x.toLowerCase()).includes(email)) {
    extras.push(`region=${r.region} on ${email} but not expected`);
  } else if (r.region && Object.keys(EXPECTED.REGION).map((x) => x.toLowerCase()).includes(email)) {
    const expected = EXPECTED.REGION[Object.keys(EXPECTED.REGION).find((k) => k.toLowerCase() === email)];
    if (r.region !== expected) {
      extras.push(`region on ${email}: got ${r.region}, expected ${expected}`);
    }
  }
}
if (extras.length === 0) {
  console.log("REVERSE CHECK:     0 unexpected flags found  ✓");
} else {
  console.log(`REVERSE CHECK:     ${extras.length} unexpected flag(s) found  ✗`);
  failed++;
  for (const x of extras) failures.push(`REVERSE: ${x}`);
}

console.log("");
if (failed === 0) {
  console.log("RESULT: PASS");
  process.exit(0);
}

console.log(`RESULT: FAIL  (${failures.length} issue${failures.length === 1 ? "" : "s"})`);
console.log("");
for (const f of failures) console.log("  -", f);
process.exit(1);
