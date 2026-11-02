#!/usr/bin/env node
/**
 * Prove the Rippling users hash fix suppresses the nightly re-insert
 * storm. The existing `--dry-run` on scripts/rippling_sync.mjs skips
 * the dedup lookup (rippling_sync.mjs:225 is gated on
 * `!args.dryRun`), so its `inserted=N` on dry-run equals
 * `examined=N` regardless of whether the content hashes actually
 * changed. That is a separate defect; this probe answers the
 * suppression question directly by sampling the live API against the
 * current stored latest hashes.
 *
 * How it works:
 *   1. Fetch one page of users from the Rippling API (same auth,
 *      same URL shape as the production walk).
 *   2. For each row, fetch the STORED payload (not just the stored
 *      hash) from rippling_raw_users_latest.
 *   3. Recompute content_hash with the CURRENT exclude list on BOTH
 *      the stored payload AND the fresh payload.
 *   4. Classify: matched (both re-hashes equal, so under the new
 *      rule a nightly run would leave the row alone) vs differs
 *      (the two payloads diverge in a non-excluded field).
 *
 * Why hash both sides with the new rule:
 *   The content_hash column in rippling_raw_users_latest was
 *   computed with the OLD exclude list (no `photos` exclude). A
 *   fresh hash under the new rule will NEVER match a stored hash
 *   under the old rule - that is a one-time transition cost, not a
 *   signal of ongoing drift. Hashing both payloads under the new
 *   rule answers the real question: "once a nightly run lands with
 *   the fix, will the NEXT night's run suppress correctly?"
 *
 * Expected after the `photos` exclude:
 *   - 100 of 100 users on the page should match (the only moving
 *     leaves between stored and fresh are photos[].value, which
 *     the new rule strips).
 *   - A handful could still differ if a real update
 *     (name / email / role) actually happened since the stored row.
 *
 * READ-ONLY. One Rippling GET; three Supabase SELECTs. No writes.
 * Never prints a payload field value. The only per-row output is the
 * rippling_id (opaque) and the matched/differs verdict.
 *
 * CLI:
 *   node --env-file=.env.local scripts/probes/_probe_users_hash_suppression.mjs
 *
 * Exit codes:
 *   0  probe ran, verdict reported (regardless of match / differ count)
 *   1  configuration missing or an API / DB call failed
 */
import { createClient } from "@supabase/supabase-js";
import { contentHash, fetchPage, extractRows, firstPageUrl } from "../../src/lib/rippling.js";

function pres(name) {
  const v = process.env[name];
  console.log(`env ${name.padEnd(32)}: ${v ? "PRESENT" : "ABSENT"}`);
  return !!v;
}

console.log(`users_hash_suppression_probe started=${new Date().toISOString()}`);
const okKey  = pres("RIPPLING_API_KEY");
const okUrl  = pres("SUPABASE_URL");
const okRole = pres("SUPABASE_SERVICE_ROLE_KEY");
if (!okKey || !okUrl || !okRole) { console.error("STOP: required env ABSENT."); process.exit(1); }

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// Fetch one page of users from Rippling (same URL shape production uses).
const url = firstPageUrl("users", 100);
console.log("");
console.log("step 1: fetch one page of users from Rippling");
const res = await fetchPage(url, process.env.RIPPLING_API_KEY);
if (!res.ok) {
  console.error(`  FAIL ${res.status}: ${res.error}`);
  process.exit(1);
}
const rows = extractRows(res.body);
console.log(`  OK: ${rows.length} user rows on page 1`);

if (rows.length === 0) {
  console.error("STOP: zero rows on page 1; cannot measure suppression.");
  process.exit(1);
}

// Hash each FRESH row with the CURRENT HASH_EXCLUDE_TOP.users.
const freshHashes = new Map();
const freshById = new Map();
for (const r of rows) {
  if (!r.id) continue;
  const id = String(r.id);
  freshById.set(id, r);
  freshHashes.set(id, contentHash(r, "users"));
}
console.log(`  fresh hashes computed: ${freshHashes.size}`);

// Look up the STORED payload (not just the stored hash) so the
// comparison is apples-to-apples under the new exclude list.
const ids = [...freshHashes.keys()];
const { data, error } = await supa
  .from("rippling_raw_users_latest")
  .select("rippling_id, payload")
  .in("rippling_id", ids);
if (error) { console.error(`  FAIL latest lookup: ${error.message}`); process.exit(1); }
const storedByID = new Map();
for (const r of (data || [])) storedByID.set(r.rippling_id, r.payload);
console.log(`  stored payloads fetched: ${storedByID.size}`);

// Classify: hash the stored payload with the SAME exclude list and
// compare to the fresh hash. Equal under new rule = suppression
// works; a nightly run under this branch would skip the row.
let matched = 0;
let differs = 0;
let notYetStored = 0;
const differIds = [];
for (const [id, freshHash] of freshHashes) {
  const stored = storedByID.get(id);
  if (stored == null) { notYetStored += 1; continue; }
  const storedHash = contentHash(stored, "users");
  if (storedHash === freshHash) matched += 1;
  else { differs += 1; differIds.push(id); }
}

console.log("");
console.log("step 2: classify page 1 against stored latest hashes");
console.log(`  matched (would NOT insert)     : ${matched}`);
console.log(`  differs (would insert)         : ${differs}`);
console.log(`  not yet in rippling_raw_users_latest: ${notYetStored}`);
console.log("");
console.log(`Interpretation:`);
console.log(`  Pre-fix baseline on this page (per Chat-Claude's measurement):`);
console.log(`    would-insert ~= page size (every user re-hashed nightly).`);
console.log(`  Post-fix target:`);
console.log(`    would-insert = 0-3 on a quiet night (only real changes trip).`);
if (differs <= 3) {
  console.log("");
  console.log(`  OK: ${differs} would insert on this page. Suppression consistent`);
  console.log(`      with Chat-Claude's expected 0-3 range.`);
} else {
  console.log("");
  console.log(`  CAUTION: ${differs} would insert on this page. Report before`);
  console.log(`           acting; the diagnosis may be incomplete.`);
}
if (differIds.length > 0) {
  console.log(`  rippling_ids that would insert: ${differIds.join(", ")}`);
}
process.exit(0);
