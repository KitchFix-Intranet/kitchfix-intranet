// user_accounts_derived verification.
//
// Owner ruling 2026-08-27. This probe runs AFTER the migration
// `docs/migrations/user-accounts-derived.sql` is applied in Studio.
// It verifies the derived view produces the right set before the
// read site (src/app/api/service-calendar/route.js:408) is cut over.
//
// Assertions:
//
//   A1  the derived view carries the two owner-named GAINS:
//         Claire Parry     TBJ - FL
//         John Lavitola    CORP
//   A2  the derived view drops the two owner-named LOSES:
//         Grant Lawson     TXR - TX - H  (terminated 2026-07-12)
//         Luis Delaportilla STL - FL     (terminated 2026-07-12)
//   A3  ALL THREE SEASONAL REHIRES RETAIN ACCESS - the test that
//       matters per the owner ruling. If any of these ends up in
//       LOSES the derivation is matching on the wrong spell:
//         Keith Gilman        4 spells, 1 ACTIVE  (from 2026-03-16)
//         Josh Forkner        2 spells, 1 ACTIVE  (from 2026-02-16)
//         Jordan Rogers       2 spells, 1 ACTIVE  (from 2026-03-02)
//   A4  the three owner-level manual overlay rows retain access:
//         joe@kitchfix.com          CORP
//         k.fietek@kitchfix.com     CORP
//         m.chavez@kitchfix.com     CORP
//   A5  case-insensitive matching survives via ilike (the pattern
//       the existing call site uses).
//   A6  the two suspected typos resolve on both sides at once:
//         m.crask@ (typo)      drops from access; j.crask@ (Joseph
//                              Crask, STL - MO) picks up access
//         c.whitmere@ (typo)   drops from access; c.whitmer@ (Chase
//                              Whitmer, STL - MO) picks up access
//   A7  the total derived count matches the pre-computed live diff:
//       35 rows (32 from people + 3 manual overlay). Guards against
//       a query change that quietly widens or narrows the set.

import { createClient } from "@supabase/supabase-js";

for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[k]) { console.error(`env ${k}: ABSENT`); process.exit(1); }
}
const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Paginated fetch. See memory: pagination-sweep-owed.
async function fetchAll(builder) {
  const out = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const r = await builder().range(from, from + PAGE - 1);
    if (r.error) throw r.error;
    if (!r.data.length) break;
    out.push(...r.data);
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

let failures = 0;
function assert(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures += 1;
  console.log(`  ✗ ${name}`);
  if (extra !== undefined) console.log(`      ${JSON.stringify(extra)}`);
}

console.log("=== user_accounts_derived verification ===\n");

let derived;
try {
  derived = await fetchAll(() => supa.from("user_accounts_derived").select("email, account"));
} catch (e) {
  if (/does not exist|Could not find the table/i.test(e.message)) {
    console.error(`user_accounts_derived view not found. Apply the migration first:`);
    console.error(`  docs/migrations/user-accounts-derived.sql`);
    console.error(`  in Studio, then re-run.`);
    process.exit(1);
  }
  throw e;
}

console.log(`derived view returned ${derived.length} rows\n`);

// Case-normalize the derived set into a lookup by lowercase email.
const derivedByEmail = new Map();
for (const r of derived) derivedByEmail.set(r.email.trim().toLowerCase(), r);

function assertHas(email, expectedAccount, label) {
  const r = derivedByEmail.get(email.toLowerCase());
  assert(
    `${label}: ${email} has access to ${expectedAccount}`,
    r != null && r.account === expectedAccount,
    { found: r },
  );
}
function assertHasNot(email, label) {
  const r = derivedByEmail.get(email.toLowerCase());
  assert(
    `${label}: ${email} has no access`,
    r == null,
    { found: r },
  );
}

// A1 - GAINS
console.log("A1  owner-named GAINS:");
assertHas("c.parry@kitchfix.com", "TBJ - FL", "A1a");
assertHas("john@kitchfix.com",    "CORP",     "A1b");

// A2 - LOSES
console.log("\nA2  owner-named LOSES:");
assertHasNot("g.lawson@kitchfix.com",      "A2a");
assertHasNot("l.delaportilla@kitchfix.com", "A2b");

// A3 - SEASONAL REHIRES (the assertion that matters)
console.log("\nA3  seasonal rehires retain access:");
assertHas("k.gilman@kitchfix.com",  "TBJ - NY",     "A3a");
assertHas("j.forkner@kitchfix.com", "TXR - TX - H", "A3b");
assertHas("j.rogers@kitchfix.com",  "TXR - TX - V", "A3c");

// A4 - MANUAL OVERLAY
console.log("\nA4  manual overlay rows retain access:");
assertHas("joe@kitchfix.com",       "CORP", "A4a");
assertHas("k.fietek@kitchfix.com",  "CORP", "A4b");
assertHas("m.chavez@kitchfix.com",  "CORP", "A4c");

// A5 - CASE INSENSITIVE via ilike
console.log("\nA5  case-insensitive lookup (mimics service-calendar/route.js:408):");
{
  const testEmail = "K.Gilman@KitchFix.com";   // mixed case
  const q = await supa.from("user_accounts_derived").select("account").ilike("email", testEmail).limit(1);
  assert(
    `A5  ilike lookup of "${testEmail}" returns account`,
    !q.error && q.data.length === 1,
    { data: q.data, error: q.error?.message },
  );
}

// A6 - TYPO RESOLUTION
console.log("\nA6  suspected typos resolve on both sides at once:");
assertHasNot("m.crask@kitchfix.com",      "A6a  typo drop");
assertHas("j.crask@kitchfix.com", "STL - MO", "A6a  real access - Joseph Crask");
assertHasNot("c.whitmere@kitchfix.com",   "A6b  typo drop");
assertHas("c.whitmer@kitchfix.com", "STL - MO", "A6b  real access - Chase Whitmer");

// A7 - TOTAL COUNT
console.log("\nA7  total set size (guards against a silent widening/narrowing):");
// Pre-computed off live people + manual: 32 ACTIVE-with-email-and-account
// + 3 owner overlay = 35. May drift by 1-2 as roster changes; if this
// fires, look at the diff before re-baselining.
const EXPECTED_TOTAL = 35;
const TOLERANCE = 3;
assert(
  `A7  derived rows = ${derived.length}, expected ~${EXPECTED_TOTAL} +/- ${TOLERANCE}`,
  Math.abs(derived.length - EXPECTED_TOTAL) <= TOLERANCE,
  { actual: derived.length, expected: EXPECTED_TOTAL, tolerance: TOLERANCE },
);

// Bonus: report the diff against the old user_accounts table for
// human review during the pre-cutover verification.
console.log("\n--- diff report (old user_accounts vs derived) ---");
const oldUa = await fetchAll(() => supa.from("user_accounts").select("email, account"));
const oldByEmail = new Map(oldUa.map(u => [u.email.trim().toLowerCase(), u]));
const gains = [...derivedByEmail].filter(([e]) => !oldByEmail.has(e));
const loses = [...oldByEmail].filter(([e]) => !derivedByEmail.has(e));
console.log(`  GAINS (in derived, not in user_accounts): ${gains.length}`);
for (const [_, r] of gains) console.log(`    + ${r.email.padEnd(35)} ${r.account}`);
console.log(`  LOSES (in user_accounts, not in derived): ${loses.length}`);
for (const [_, r] of loses) console.log(`    - ${r.email.padEnd(35)} ${r.account}`);
console.log(`  UNCHANGED: ${derivedByEmail.size - gains.length}`);

console.log(`\n---`);
if (failures > 0) {
  console.log(`${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log(`all assertions pass. Derived view is safe to cut the read site over to.`);
