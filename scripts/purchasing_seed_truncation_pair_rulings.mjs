#!/usr/bin/env node
/*
 * purchasing_seed_truncation_pair_rulings.mjs
 *
 * One-shot: read ~/Downloads/inv_p12_45_exclude_parents_<date>.json (produced
 * by scripts/probes/_probe_inv_p12_before_after.mjs) and INSERT one row per
 * ruled parent into `purchasing_truncation_pair_rulings`.
 *
 * Idempotent: ON CONFLICT (parent_txn_id) DO NOTHING.  Re-run is safe.
 * Fails loudly if a row already exists with a different partner_parent_txn_id
 * (that would mean a re-ruling with different intent - block instead of
 * silently accepting).
 *
 * Env: process.env only (--env-file=.env.local recommended).
 * Args:
 *   --file <path>   path to the JSON seed (default: newest in ~/Downloads/)
 *   --batch <name>  ruling_batch tag (default: derived from filename)
 *   --dry-run       print what would be inserted; do not write
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createClient } from "@supabase/supabase-js";

const argv = process.argv.slice(2);
function argOf(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}
const dryRun    = argv.includes("--dry-run");
const explicit  = argOf("--file");
const batchArg  = argOf("--batch");

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log(`SUPABASE_URL:              ${SB_URL ? "PRESENT" : "ABSENT"}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${SB_KEY ? "PRESENT" : "ABSENT"}`);
if (!SB_URL || !SB_KEY) { console.error("BLOCKED"); process.exit(2); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// Locate seed file
let seedPath = explicit;
if (!seedPath) {
  const dir = path.join(os.homedir(), "Downloads");
  const entries = await fs.readdir(dir);
  const candidates = entries
    .filter(f => f.startsWith("inv_p12_45_exclude_parents_") && f.endsWith(".json"))
    .sort();
  if (!candidates.length) {
    console.error("BLOCKED: no seed file found in ~/Downloads/ - run scripts/probes/_probe_inv_p12_before_after.mjs first");
    process.exit(3);
  }
  seedPath = path.join(dir, candidates[candidates.length - 1]);
}
console.log(`seed file: ${seedPath}`);

const raw = await fs.readFile(seedPath, "utf8");
const seed = JSON.parse(raw);
console.log(`  rule:          ${seed.rule}`);
console.log(`  ruled_by:      ${seed.ruled_by}`);
console.log(`  count:         ${seed.count}`);
console.log(`  total dollars: $${seed.total_excluded_dollars.toFixed(2)}`);

const batch = batchArg || `inv-p12-${path.basename(seedPath).match(/(\d{4}-\d{2}-\d{2})/)?.[1] || "unknown"}`;
console.log(`  ruling_batch:  ${batch}`);

// Pre-flight: existing rows in the table
const { data: existing, error: exErr } = await supa
  .from("purchasing_truncation_pair_rulings")
  .select("parent_txn_id, partner_parent_txn_id, ruling_batch");
if (exErr) {
  console.error("BLOCKED: cannot read rulings table:", exErr.message);
  process.exit(4);
}
const existingByParent = new Map();
for (const r of existing || []) existingByParent.set(r.parent_txn_id, r);
console.log(`  existing rulings in table: ${existingByParent.size}`);

// Conflict detection: if a parent already exists with a different partner,
// stop.  Different-batch same-partner is fine (re-attest is OK).
const conflicts = [];
for (const p of seed.parents) {
  const cur = existingByParent.get(p.parent_txn_id);
  if (cur && cur.partner_parent_txn_id !== p.partner_parent_txn_id) {
    conflicts.push({ parent_txn_id: p.parent_txn_id, existing_partner: cur.partner_parent_txn_id, seed_partner: p.partner_parent_txn_id });
  }
}
if (conflicts.length) {
  console.error(`BLOCKED: ${conflicts.length} parents already ruled with a DIFFERENT partner - re-ruling intent, cannot silently accept:`);
  for (const c of conflicts.slice(0, 10)) console.error(`  ${c.parent_txn_id}: existing partner ${c.existing_partner} vs seed partner ${c.seed_partner}`);
  process.exit(5);
}

// Build INSERT payload
const payload = seed.parents.map(p => ({
  parent_txn_id:         p.parent_txn_id,
  partner_parent_txn_id: p.partner_parent_txn_id,
  merchant_short:        p.merchant_short,
  merchant_long:         p.merchant_long,
  amount_cents:          p.amount_cents,
  account_key:           p.account_key,
  days_apart:            p.days_apart,
  excluded_txn_date:     p.excluded_txn_date,
  kept_txn_date:         p.kept_txn_date,
  ruled_by:              seed.ruled_by,
  ruling_batch:          batch,
  note:                  seed.ruled_at_note || null,
}));

if (dryRun) {
  console.log(`\n--dry-run: would upsert ${payload.length} rows`);
  console.log(`  new rows:       ${payload.filter(p => !existingByParent.has(p.parent_txn_id)).length}`);
  console.log(`  already-exists: ${payload.filter(p => existingByParent.has(p.parent_txn_id)).length}`);
  process.exit(0);
}

// Upsert with onConflict = parent_txn_id, ignoreDuplicates = true
console.log(`\nupserting ${payload.length} rows (ignoreDuplicates=true)...`);
const { error: upErr, count } = await supa
  .from("purchasing_truncation_pair_rulings")
  .upsert(payload, { onConflict: "parent_txn_id", ignoreDuplicates: true, count: "exact" });
if (upErr) {
  console.error("INSERT FAILED:", upErr.message);
  process.exit(6);
}
console.log(`  upsert returned count: ${count}`);

// Verify
const { data: after, error: aErr } = await supa
  .from("purchasing_truncation_pair_rulings")
  .select("parent_txn_id, amount_cents", { count: "exact" });
if (aErr) { console.error("verify failed:", aErr.message); process.exit(7); }
const totalCents = (after || []).reduce((s, r) => s + Number(r.amount_cents), 0);
console.log(`\nfinal state:`);
console.log(`  rulings in table: ${after.length}`);
console.log(`  total excluded dollars: $${(totalCents / 100).toFixed(2)}`);
console.log(`\nnext step: kick a derive run so purchasing_actuals picks up reason='truncation_pair' on these ${after.length} parents' lines.`);
