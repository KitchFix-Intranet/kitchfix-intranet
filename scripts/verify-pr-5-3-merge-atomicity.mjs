// Verify PR 5.3 merge_vendors stored function: atomicity + rollback.
//
// Usage:
//   node --env-file=.env.local scripts/verify-pr-5-3-merge-atomicity.mjs
//
// Tests (all use ZZZ-prefixed synthetic test data):
//   1. Function exists + service_role has EXECUTE
//   2. Happy path: 2 dupes -> 1 keeper, all 3 effects + counts verified
//   3. Rollback path: invalid keeper_id (FK violation) -> NO partial state lands
//   4. Cleanup: ZZZ- rows hard-removed; hard-fails if any remain
//
// Exit 0 on full pass; 1 on any failure.

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

console.log("=== PR 5.3 merge_vendors atomicity verification ===\n");

// Vendor IDs scoped under ZZZ- prefix so they cannot collide with real
// data. The PR 5.1 schema verification script uses the same convention.
const KEEPER_ID   = `ZZZ-${Math.floor(Math.random() * 900) + 100}`;
const DUPE_A_ID   = `ZZZ-${Math.floor(Math.random() * 900) + 100}`;
const DUPE_B_ID   = `ZZZ-${Math.floor(Math.random() * 900) + 100}`;
const TEST_EMAIL  = "verify-pr-5-3-merge-atomicity.mjs";

async function cleanup() {
  const ids = [KEEPER_ID, DUPE_A_ID, DUPE_B_ID];
  await supabase.from("vendor_accounts").delete().in("vendor_id", ids);
  await supabase.from("vendor_aliases").delete().in("vendor_id", ids);
  await supabase.from("vendors").delete().in("id", ids);
  // Also clean any rows that might have been created with a "ZZZ-" prefix
  // due to bookkeeping mistakes in past runs.
  await supabase.from("vendor_accounts").delete().like("vendor_id", "ZZZ-%");
  await supabase.from("vendor_aliases").delete().like("vendor_id", "ZZZ-%");
  await supabase.from("vendors").delete().like("id", "ZZZ-%");
}

async function countZzzRows(table, col) {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .like(col, "ZZZ-%");
  if (error) return -1;
  return count ?? -1;
}

// Pre-flight: clean any leftover ZZZ- rows from prior failed runs.
await cleanup();

// ── 1. Function exists + GRANT ──
{
  const { data, error } = await supabase.rpc("merge_vendors", {
    p_keeper_id: "NON-EXISTENT-KEEPER-FOR-PROBE",
    p_dupe_ids:  [],
    p_email:     TEST_EMAIL,
  });
  // Empty dupe_ids should return {accounts_reassigned: 0, vendors_deleted: 0,
  // dupe_names: []} without error. A function-missing or permission-denied
  // error would surface here.
  if (error) {
    fail("function exists + EXECUTE granted", error.message);
  } else if (!data || typeof data !== "object") {
    fail("function returns JSON", `got ${JSON.stringify(data)}`);
  } else if (data.accounts_reassigned !== 0 || data.vendors_deleted !== 0) {
    fail("empty dupe_ids -> zero counts", `got ${JSON.stringify(data)}`);
  } else {
    pass("function exists + service_role has EXECUTE + returns JSON");
  }
}

// ── 2. Happy path: seed 1 keeper + 2 dupes, each with 1 account, then merge ──
{
  // Seed keeper + dupes
  const seedVendors = await supabase.from("vendors").insert([
    { id: KEEPER_ID, name: "ZZZ Keeper",     created_by: TEST_EMAIL },
    { id: DUPE_A_ID, name: "ZZZ Dupe Alpha", created_by: TEST_EMAIL },
    { id: DUPE_B_ID, name: "ZZZ Dupe Beta",  created_by: TEST_EMAIL },
  ]);
  if (seedVendors.error) {
    fail("seed test vendors", seedVendors.error.message);
  } else {
    pass("seed test vendors (keeper + 2 dupes)");
  }

  const seedAccounts = await supabase.from("vendor_accounts").insert([
    { vendor_id: KEEPER_ID, account_key: "CIN - OH", created_by: TEST_EMAIL },
    { vendor_id: DUPE_A_ID, account_key: "ATL - GA", created_by: TEST_EMAIL },
    { vendor_id: DUPE_B_ID, account_key: "PHI - PA", created_by: TEST_EMAIL },
  ]);
  if (seedAccounts.error) {
    fail("seed test accounts", seedAccounts.error.message);
  } else {
    pass("seed test accounts (1 per vendor)");
  }

  // Pre-seed an alias on the keeper that matches one of the dupe names.
  // After the merge, the function's ON CONFLICT (vendor_id, alias_normalized)
  // DO NOTHING clause should skip the duplicate insert and the final alias
  // count should be 2, not 3.
  const seedExistingAlias = await supabase.from("vendor_aliases").insert({
    vendor_id:  KEEPER_ID,
    alias_text: "ZZZ Dupe Alpha",
    source:     "manual",
    learned_by: TEST_EMAIL,
  });
  if (seedExistingAlias.error) {
    fail("seed existing alias on keeper (conflict test setup)", seedExistingAlias.error.message);
  } else {
    pass("seed existing alias on keeper for conflict test");
  }

  // Run the merge: 2 dupes -> 1 keeper
  const { data: result, error: mergeErr } = await supabase.rpc("merge_vendors", {
    p_keeper_id: KEEPER_ID,
    p_dupe_ids:  [DUPE_A_ID, DUPE_B_ID],
    p_email:     TEST_EMAIL,
  });
  if (mergeErr) {
    fail("happy path: merge RPC", mergeErr.message);
  } else if (result.accounts_reassigned !== 2) {
    fail("happy path: accounts_reassigned == 2", `got ${result.accounts_reassigned}`);
  } else if (result.vendors_deleted !== 2) {
    fail("happy path: vendors_deleted == 2", `got ${result.vendors_deleted}`);
  } else {
    const dupeNames = result.dupe_names || [];
    if (dupeNames.length !== 2 || !dupeNames.includes("ZZZ Dupe Alpha") || !dupeNames.includes("ZZZ Dupe Beta")) {
      fail("happy path: dupe_names contains both dupe names", `got ${JSON.stringify(dupeNames)}`);
    } else {
      pass(`happy path: merge returned ${JSON.stringify(result)}`);
    }
  }

  // Verify effects landed in the DB
  const { data: keeperAccts } = await supabase
    .from("vendor_accounts").select("account_key").eq("vendor_id", KEEPER_ID);
  const keeperAcctKeys = (keeperAccts || []).map((r) => r.account_key).sort();
  if (JSON.stringify(keeperAcctKeys) === JSON.stringify(["ATL - GA", "CIN - OH", "PHI - PA"])) {
    pass("happy path: vendor_accounts all reassigned to keeper");
  } else {
    fail("happy path: vendor_accounts reassigned", `keeper accounts = ${JSON.stringify(keeperAcctKeys)}`);
  }

  const { data: dupeRows } = await supabase
    .from("vendors").select("id, deleted_at").in("id", [DUPE_A_ID, DUPE_B_ID]);
  const allDeleted = (dupeRows || []).every((r) => r.deleted_at !== null);
  if (allDeleted && dupeRows.length === 2) {
    pass("happy path: both dupes soft-deleted");
  } else {
    fail("happy path: dupes soft-deleted", `dupe rows = ${JSON.stringify(dupeRows)}`);
  }

  // Final alias state assertions (with the pre-seeded "ZZZ Dupe Alpha"):
  //   - Total count = 2 (NOT 3) - proves ON CONFLICT DO NOTHING worked
  //   - "ZZZ Dupe Alpha" retains source='manual' - proves DO NOTHING
  //     preserved the existing row's metadata (didn't UPDATE)
  //   - "ZZZ Dupe Beta" has source='merge' - proves the function inserted
  //     it as a new row
  const { data: aliases } = await supabase
    .from("vendor_aliases").select("alias_text, source, learned_by").eq("vendor_id", KEEPER_ID);
  const aliasTexts = (aliases || []).map((r) => r.alias_text).sort();
  if (JSON.stringify(aliasTexts) === JSON.stringify(["ZZZ Dupe Alpha", "ZZZ Dupe Beta"])) {
    pass("happy path: ON CONFLICT DO NOTHING skipped duplicate (alias count = 2, not 3)");
    const aliasMap = Object.fromEntries((aliases || []).map((r) => [r.alias_text, r]));
    const alphaPreserved = aliasMap["ZZZ Dupe Alpha"]?.source === "manual"
      && aliasMap["ZZZ Dupe Alpha"]?.learned_by === TEST_EMAIL;
    const betaInserted = aliasMap["ZZZ Dupe Beta"]?.source === "merge"
      && aliasMap["ZZZ Dupe Beta"]?.learned_by === TEST_EMAIL;
    if (alphaPreserved) {
      pass("happy path: pre-seeded alias 'ZZZ Dupe Alpha' kept source='manual' (DO NOTHING preserved existing row)");
    } else {
      fail("happy path: pre-seeded alias metadata", `expected source='manual', got ${JSON.stringify(aliasMap["ZZZ Dupe Alpha"])}`);
    }
    if (betaInserted) {
      pass("happy path: new alias 'ZZZ Dupe Beta' inserted by function with source='merge'");
    } else {
      fail("happy path: new alias metadata", `expected source='merge', got ${JSON.stringify(aliasMap["ZZZ Dupe Beta"])}`);
    }
  } else {
    fail("happy path: aliases inserted", `expected ['ZZZ Dupe Alpha', 'ZZZ Dupe Beta'], got ${JSON.stringify(aliasTexts)}`);
  }

  // Clean up so the rollback test starts fresh
  await cleanup();
}

// ── 3. Rollback path: invalid keeper_id -> FK violation -> NO partial state ──
{
  // Seed only a single dupe with an account. Keeper does NOT exist in vendors.
  // The merge_vendors function will:
  //   - try UPDATE vendor_accounts SET vendor_id = '<non-existent>' WHERE vendor_id = ANY([dupe])
  //     -> FK violation on vendor_accounts.vendor_id -> vendors.id
  //   - function aborts; transaction rolls back; account stays pointing at dupe
  const DUPE_ONLY_ID  = `ZZZ-${Math.floor(Math.random() * 900) + 100}`;
  const FAKE_KEEPER   = `ZZZ-DOES-NOT-EXIST-${Date.now()}`;

  const seedV = await supabase.from("vendors").insert({
    id: DUPE_ONLY_ID, name: "ZZZ Rollback Dupe", created_by: TEST_EMAIL,
  });
  if (seedV.error) {
    fail("rollback seed: dupe vendor", seedV.error.message);
  } else {
    pass("rollback seed: dupe vendor");
  }
  const seedA = await supabase.from("vendor_accounts").insert({
    vendor_id: DUPE_ONLY_ID, account_key: "ATL - GA", created_by: TEST_EMAIL,
  });
  if (seedA.error) {
    fail("rollback seed: dupe account", seedA.error.message);
  } else {
    pass("rollback seed: dupe account");
  }

  // Capture pre-state
  const preCounts = {
    accounts: await countZzzRows("vendor_accounts", "vendor_id"),
    aliases:  await countZzzRows("vendor_aliases", "vendor_id"),
    vendors:  await countZzzRows("vendors", "id"),
  };

  // Attempt merge with non-existent keeper. Expect error (FK violation).
  const { error: mergeErr } = await supabase.rpc("merge_vendors", {
    p_keeper_id: FAKE_KEEPER,
    p_dupe_ids:  [DUPE_ONLY_ID],
    p_email:     TEST_EMAIL,
  });
  if (!mergeErr) {
    fail("rollback path: RPC should have errored", "got success (FK violation expected)");
  } else if (mergeErr.code === "23503" || /foreign key|violates/i.test(mergeErr.message)) {
    pass(`rollback path: RPC errored with FK violation (code=${mergeErr.code})`);
  } else {
    fail("rollback path: wrong error type", `code=${mergeErr.code} message=${mergeErr.message}`);
  }

  // Verify NO partial state: the account is still pointing at the original
  // dupe (not at the fake keeper), the dupe is still LIVE (deleted_at NULL),
  // and no aliases were inserted.
  const { data: acctRow } = await supabase
    .from("vendor_accounts").select("vendor_id").eq("vendor_id", DUPE_ONLY_ID).maybeSingle();
  if (acctRow && acctRow.vendor_id === DUPE_ONLY_ID) {
    pass("rollback path: vendor_accounts.vendor_id unchanged (still points to original dupe)");
  } else {
    fail("rollback path: vendor_accounts.vendor_id", `expected ${DUPE_ONLY_ID}, got ${JSON.stringify(acctRow)}`);
  }

  const { data: dupeStill } = await supabase
    .from("vendors").select("id, deleted_at").eq("id", DUPE_ONLY_ID).maybeSingle();
  if (dupeStill && dupeStill.deleted_at === null) {
    pass("rollback path: dupe vendor NOT soft-deleted");
  } else {
    fail("rollback path: dupe soft-delete state", `got ${JSON.stringify(dupeStill)}`);
  }

  const postCounts = {
    accounts: await countZzzRows("vendor_accounts", "vendor_id"),
    aliases:  await countZzzRows("vendor_aliases", "vendor_id"),
    vendors:  await countZzzRows("vendors", "id"),
  };
  if (
    preCounts.accounts === postCounts.accounts &&
    preCounts.aliases  === postCounts.aliases &&
    preCounts.vendors  === postCounts.vendors
  ) {
    pass(`rollback path: zero count delta (accounts/aliases/vendors all stable at ${preCounts.accounts}/${preCounts.aliases}/${preCounts.vendors})`);
  } else {
    fail("rollback path: count delta",
      `pre=${JSON.stringify(preCounts)} post=${JSON.stringify(postCounts)}`);
  }

  // Clean rollback test
  await cleanup();
}

// ── 4. Final cleanup verification (hard-fail) ──
{
  const finalCounts = {
    vendors:  await countZzzRows("vendors", "id"),
    accounts: await countZzzRows("vendor_accounts", "vendor_id"),
    aliases:  await countZzzRows("vendor_aliases", "vendor_id"),
  };
  if (finalCounts.vendors === 0 && finalCounts.accounts === 0 && finalCounts.aliases === 0) {
    pass("final cleanup: zero ZZZ- rows remain in vendors/vendor_accounts/vendor_aliases");
  } else {
    fail("final cleanup: orphan ZZZ- rows", `got ${JSON.stringify(finalCounts)}`);
  }
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `FAILED: ${failures} check(s)`}`);
process.exit(failures === 0 ? 0 : 1);
