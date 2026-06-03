// ─────────────────────────────────────────────────────────────────────────────
// scripts/apply-pr-7-4-bilingual-columns.mjs
// Project OPD · PR 7.4 · verify bilingual columns landed on documents.
//
// THIS DB HAS NO exec_sql RPC (confirmed by verify-pr-7-1's GRANT check
// gracefully skipping it). supabase-js can't run ALTER TABLE directly through
// PostgREST, so DDL is applied the same way pr-7-1-opd-schema was: paste the
// .sql in Studio, then this script verifies the columns are now present.
//
// Idempotent: re-running after a clean apply is a no-op that just re-confirms.
//
// Usage:
//   1. Paste docs/migrations/pr-7-4-opd-bilingual-columns.sql into Supabase
//      Studio's SQL editor and run.
//   2. node --env-file=.env.local scripts/apply-pr-7-4-bilingual-columns.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const REQUIRED_COLUMNS = ["source_drive_id_es", "storage_path_es"];

async function columnExists(col) {
  // Probe with a regular .select().limit(1) - HEAD-only requests swallow
  // PostgREST's error code/message body, so we'd lose the 42703 signal.
  // A 1-row body is cheap enough.
  const { error } = await sb.from("documents").select(col).limit(1);
  if (!error) return { ok: true };
  if (error.code === "42703" || /column .* does not exist/i.test(error.message || "")) {
    return { ok: false, reason: "missing" };
  }
  return { ok: false, reason: `${error.code || "?"}: ${error.message || "(no message)"}` };
}

console.log("apply pr-7-4-opd-bilingual-columns (verify-after-Studio)\n");

let allPresent = true;
for (const col of REQUIRED_COLUMNS) {
  const r = await columnExists(col);
  if (r.ok) {
    console.log(`  ok   documents.${col} present`);
  } else if (r.reason === "missing") {
    console.log(`  MISS documents.${col} does not exist`);
    allPresent = false;
  } else {
    console.error(`  FAIL documents.${col} probe failed: ${r.reason}`);
    process.exit(2);
  }
}

console.log();
if (allPresent) {
  console.log("PASS — pr-7-4 columns landed (source_drive_id_es, storage_path_es).");
  process.exit(0);
}

console.log("FAIL — columns missing. Paste the following into Supabase Studio:");
console.log("       docs/migrations/pr-7-4-opd-bilingual-columns.sql");
console.log("Then re-run this script to verify.");
process.exit(1);
