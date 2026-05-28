// Verify PR 5.1 vendor schema was applied correctly.
//
// Usage:
//   node --env-file=.env.local scripts/verify-pr-5-1-schema.mjs
//
// Checks:
//   1. vendors / vendor_aliases / vendor_accounts all exist + count = 0
//   2. CHECK constraint on vendor_accounts.account_key rejects bad values
//   3. UNIQUE constraint on vendor_aliases (vendor_id, alias_normalized) wires through
//
// Exit code 0 on full pass; 1 on any failure.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;
function pass(label) { console.log(`  PASS  ${label}`); }
function fail(label, detail) { console.error(`  FAIL  ${label}: ${detail}`); failures++; }

console.log("=== PR 5.1 vendor schema verification ===\n");

// 1. Count checks
for (const table of ["vendors", "vendor_aliases", "vendor_accounts"]) {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) {
    fail(`count(${table})`, error.message);
  } else if (count !== 0) {
    fail(`count(${table})`, `expected 0, got ${count}`);
  } else {
    pass(`count(${table}) = 0`);
  }
}

// 2. CHECK constraint smoke test
// Need a valid vendor first since vendor_accounts has FK on vendors(id).
// Create a temp vendor row, attempt the bad insert, then clean up.
const tempVendorId = `ZZZ-${Math.floor(Math.random() * 900) + 100}`;
const { error: vCreateErr } = await supabase.from("vendors").insert({
  id:         tempVendorId,
  name:       "TEMP - schema verification",
  created_by: "verify-pr-5-1-schema.mjs",
});
if (vCreateErr) {
  fail("create temp vendor", vCreateErr.message);
} else {
  // Try the bad-key insert. Expect rejection (lowercase 'cin-oh').
  const { error: badErr } = await supabase.from("vendor_accounts").insert({
    vendor_id:   tempVendorId,
    account_key: "cin-oh",
    created_by:  "verify-pr-5-1-schema.mjs",
  });
  if (!badErr) {
    fail("CHECK constraint on account_key", "INSERT with 'cin-oh' should have been rejected but succeeded");
    // Clean up bad row if it somehow landed
    await supabase.from("vendor_accounts").delete().eq("vendor_id", tempVendorId).eq("account_key", "cin-oh");
  } else if (/check constraint/i.test(badErr.message) || badErr.code === "23514") {
    pass("CHECK constraint on account_key rejects 'cin-oh'");
  } else {
    fail("CHECK constraint on account_key", `wrong error: ${badErr.message}`);
  }

  // Verify a GOOD key works
  const { error: goodErr } = await supabase.from("vendor_accounts").insert({
    vendor_id:   tempVendorId,
    account_key: "CIN - OH",
    created_by:  "verify-pr-5-1-schema.mjs",
  });
  if (goodErr) {
    fail("CHECK constraint on account_key (canonical)", `'CIN - OH' should pass but: ${goodErr.message}`);
  } else {
    pass("CHECK constraint on account_key accepts 'CIN - OH'");
  }
  // Verify CORP also passes
  const { error: corpErr } = await supabase.from("vendor_accounts").insert({
    vendor_id:   tempVendorId,
    account_key: "CORP",
    created_by:  "verify-pr-5-1-schema.mjs",
  });
  if (corpErr) {
    fail("CHECK constraint on account_key (CORP)", `'CORP' should pass but: ${corpErr.message}`);
  } else {
    pass("CHECK constraint on account_key accepts 'CORP'");
  }

  // 3. vendor_aliases UNIQUE smoke test
  const { error: a1Err } = await supabase.from("vendor_aliases").insert({
    vendor_id:  tempVendorId,
    alias_text: "Temp Alias One",
    source:     "manual",
    learned_by: "verify-pr-5-1-schema.mjs",
  });
  if (a1Err) {
    fail("vendor_aliases insert", a1Err.message);
  } else {
    // Same alias again -> should hit UNIQUE constraint (23505)
    const { error: a2Err } = await supabase.from("vendor_aliases").insert({
      vendor_id:  tempVendorId,
      alias_text: "Temp Alias One",
      source:     "manual",
      learned_by: "verify-pr-5-1-schema.mjs",
    });
    if (!a2Err) {
      fail("vendor_aliases UNIQUE", "duplicate insert should have been rejected");
    } else if (a2Err.code === "23505") {
      pass("vendor_aliases UNIQUE (vendor_id, alias_normalized) wires through");
    } else {
      fail("vendor_aliases UNIQUE", `wrong error code: ${a2Err.code} - ${a2Err.message}`);
    }
    // Same vendor, different alias_text but same normalized form ("Temp Alias One!" -> same normalized)
    const { error: a3Err } = await supabase.from("vendor_aliases").insert({
      vendor_id:  tempVendorId,
      alias_text: "Temp Alias One!",
      source:     "manual",
      learned_by: "verify-pr-5-1-schema.mjs",
    });
    if (!a3Err) {
      fail("vendor_aliases normalized dedup", "'Temp Alias One!' should normalize same as 'Temp Alias One' and be rejected");
    } else if (a3Err.code === "23505") {
      pass("vendor_aliases alias_normalized generated column dedupes via UNIQUE");
    } else {
      fail("vendor_aliases normalized dedup", `wrong error code: ${a3Err.code} - ${a3Err.message}`);
    }
  }

  // Cleanup
  await supabase.from("vendor_accounts").delete().eq("vendor_id", tempVendorId);
  await supabase.from("vendor_aliases").delete().eq("vendor_id", tempVendorId);
  await supabase.from("vendors").delete().eq("id", tempVendorId);
  pass("cleanup complete (temp rows removed)");
}

// Final counts after cleanup
console.log("\n=== Final state ===");
for (const table of ["vendors", "vendor_aliases", "vendor_accounts"]) {
  const { count } = await supabase.from(table).select("*", { count: "exact", head: true });
  console.log(`  ${table}: ${count} rows`);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `FAILED: ${failures} check(s)`}`);
process.exit(failures === 0 ? 0 : 1);
