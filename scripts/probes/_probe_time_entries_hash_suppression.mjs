#!/usr/bin/env node
/**
 * Prove the Rippling time_entries hash fix suppresses the nightly
 * re-insert storm. Same shape as the users suppression probe:
 *
 *   1. Fetch one page of time entries from the Rippling API.
 *   2. For each id, fetch the STORED payload from
 *      rippling_raw_time_entries_latest.
 *   3. Re-hash BOTH payloads under the CURRENT HASH_EXCLUDE_TOP
 *      + the ISO-canonical scalar transform (i.e. with THIS branch's
 *      edit live).
 *   4. Classify: matched (both re-hash to the same value, so a
 *      nightly run under this branch would suppress) vs differs
 *      (payloads diverge in a non-noise field under the new rule).
 *
 * Why re-hash both sides under the new rule:
 *   The stored content_hash column was computed with the OLD canonical
 *   projection (no ISO canonicalization). A fresh hash under the new
 *   rule will never match a stored hash under the old rule - that is
 *   the one-time transition cost. Re-hashing both payloads with the
 *   new rule answers the real question: "once a nightly run lands
 *   with the fix, will the NEXT night's run suppress correctly?"
 *
 * READ-ONLY. One Rippling GET, one Supabase SELECT.
 *
 * CLI:
 *   node --env-file=.env.local scripts/probes/_probe_time_entries_hash_suppression.mjs
 *
 * Exit:
 *   0  probe ran, verdict reported
 *   1  configuration missing or an API/DB call failed
 */
import { createClient } from "@supabase/supabase-js";
import { contentHash, fetchPage, extractRows, firstPageUrl } from "../../src/lib/rippling.js";

function pres(name) {
  const v = process.env[name];
  console.log(`env ${name.padEnd(32)}: ${v ? "PRESENT" : "ABSENT"}`);
  return !!v;
}

console.log(`time_entries_hash_suppression_probe started=${new Date().toISOString()}`);
const okKey  = pres("RIPPLING_API_KEY");
const okUrl  = pres("SUPABASE_URL");
const okRole = pres("SUPABASE_SERVICE_ROLE_KEY");
if (!okKey || !okUrl || !okRole) { console.error("STOP: required env ABSENT."); process.exit(1); }

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const url = firstPageUrl("time-entries", 100);
console.log("");
console.log("step 1: fetch one page of time entries from Rippling");
const res = await fetchPage(url, process.env.RIPPLING_API_KEY);
if (!res.ok) { console.error(`  FAIL ${res.status}: ${res.error}`); process.exit(1); }
const rows = extractRows(res.body);
console.log(`  OK: ${rows.length} rows on page 1`);
if (rows.length === 0) { console.error("STOP: zero rows."); process.exit(1); }

// Hash each FRESH row with the CURRENT rule.
const freshHashes = new Map();
for (const r of rows) {
  if (!r.id) continue;
  freshHashes.set(String(r.id), contentHash(r, "time_entries"));
}
console.log(`  fresh hashes computed: ${freshHashes.size}`);

// Fetch STORED payloads.
const ids = [...freshHashes.keys()];
const { data, error } = await supa
  .from("rippling_raw_time_entries_latest")
  .select("rippling_id, payload")
  .in("rippling_id", ids);
if (error) { console.error(`  FAIL latest lookup: ${error.message}`); process.exit(1); }
const storedByID = new Map();
for (const r of (data || [])) storedByID.set(r.rippling_id, r.payload);
console.log(`  stored payloads fetched: ${storedByID.size}`);

// Classify: hash the stored payload with the SAME rule and compare.
let matched = 0;
let differs = 0;
let notYetStored = 0;
const differIds = [];
for (const [id, freshHash] of freshHashes) {
  const stored = storedByID.get(id);
  if (stored == null) { notYetStored += 1; continue; }
  const storedHash = contentHash(stored, "time_entries");
  if (storedHash === freshHash) matched += 1;
  else { differs += 1; differIds.push(id); }
}

console.log("");
console.log("step 2: classify page 1 against stored (both hashed under new rule)");
console.log(`  matched (would NOT insert)              : ${matched}`);
console.log(`  differs (would insert)                  : ${differs}`);
console.log(`  not yet in rippling_raw_time_entries_latest: ${notYetStored}`);
console.log("");
console.log(`Interpretation:`);
console.log(`  Pre-fix baseline (per Chat-Claude's measurement):`);
console.log(`    Rippling re-serializes segments[].end_time offsets between calls;`);
console.log(`    ~97% of adjacent-version pairs are noise, so ~97% of a page would`);
console.log(`    hash-differ under the OLD rule.`);
console.log(`  Post-fix target: most of the page should match (payloads differ`);
console.log(`    only in canonicalized datetime strings OR real punch edits).`);
if (differs > 0 && differIds.length > 0) {
  console.log(`  rippling_ids that would still insert: ${differIds.slice(0, 20).join(", ")}${differIds.length > 20 ? ` ...+${differIds.length - 20} more` : ""}`);
}
process.exit(0);
