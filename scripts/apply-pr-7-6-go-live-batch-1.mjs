// ─────────────────────────────────────────────────────────────────────────────
// scripts/apply-pr-7-6-go-live-batch-1.mjs
// Project OPD · PR 7.6 · first real document upload batch
//
// Sets 3 catalog rows Live with their authoritative Drive file IDs:
//
//   AGR-001    The Big Rules                  v1.0  (EN)
//   STD-001    Documentation Format Standard  v1.0  (EN; version bumped from v0.96/v0.97)
//   POSTER-001 The Big Rules (poster)         v1.2  (EN + ES — first bilingual doc)
//
// This is the reusable template for future per-batch uploads. Pattern:
//   • One UPLOADS table at the top - data, no code.
//   • For each entry, do an UPDATE on the document row by id, then a SELECT
//     read-back to confirm the change landed.
//   • Print before/after for each row so the operator can eyeball it.
//   • Never touches summary / keywords / surfaces / relationships - those were
//     set at seed time (pr-7-2). This batch is linking files + going Live only.
//
// Prerequisites (in order):
//   1. pr-7-4-opd-bilingual-columns.sql applied   (POSTER-001 needs source_drive_id_es)
//   2. pr-7-5-opd-poster-id-fix.sql applied       (POSTER-001 row must exist)
//
// Usage:
//   node --env-file=.env.local scripts/apply-pr-7-6-go-live-batch-1.mjs
//
// Idempotent: re-running on already-Live rows is a no-op (UPDATE just sets
// the same values).
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// Per-doc upload spec. Add entries here for future batches.
const UPLOADS = [
  {
    id: "AGR-001",
    status: "Live",
    version: "v1.0",
    source_drive_id: "19U56xYG7XBwpStaftZOoqu3yfPvUA3vCMhfzdDUl_s8",
    // No ES variant.
  },
  {
    id: "STD-001",
    status: "Live",
    version: "v1.0",
    source_drive_id: "1p6d6zwxkkBuGEgd__tA4JNulvd4Pj7gaCtBUyg2JZEc",
    // No ES variant. Version bumped from v0.96/v0.97 -> v1.0 on going Live.
  },
  {
    id: "POSTER-001",
    status: "Live",
    version: "v1.2",
    source_drive_id:    "1ohrOtBzeXKkTGfad9DxyzQJns3wz5YGk",   // EN poster
    source_drive_id_es: "1Wl35J7A9zWiOExLFZ2NPMW1QY0-mp1P0",   // ES poster
  },
];

const FIELDS_TO_SHOW = ["id", "title", "status", "version", "source_drive_id", "source_drive_id_es"];

function fmt(row) {
  if (!row) return "(missing)";
  return FIELDS_TO_SHOW
    .map((f) => `${f}=${row[f] == null ? "NULL" : row[f]}`)
    .join("\n       ");
}

async function readRow(id) {
  const { data, error } = await sb
    .from("documents")
    .select(FIELDS_TO_SHOW.join(","))
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`read ${id}: ${error.message}`);
  return data;
}

console.log("apply pr-7-6 go-live batch 1\n");

let failures = 0;
for (const u of UPLOADS) {
  console.log(`────── ${u.id} ──────`);
  const before = await readRow(u.id);
  if (!before) {
    console.error(`  FAIL ${u.id} not found in documents — skipping`);
    failures++;
    continue;
  }
  console.log(`BEFORE ${fmt(before)}`);

  // Build patch from the upload spec, omitting undefined fields so we don't
  // overwrite columns that weren't explicitly set in UPLOADS.
  const patch = { updated_at: new Date().toISOString() };
  if (u.status            !== undefined) patch.status            = u.status;
  if (u.version           !== undefined) patch.version           = u.version;
  if (u.source_drive_id   !== undefined) patch.source_drive_id   = u.source_drive_id;
  if (u.source_drive_id_es!== undefined) patch.source_drive_id_es= u.source_drive_id_es;

  const { error } = await sb
    .from("documents")
    .update(patch)
    .eq("id", u.id);
  if (error) {
    console.error(`  FAIL ${u.id} update failed: ${error.code || ""} ${error.message}`);
    if (error.details) console.error(`       details: ${error.details}`);
    if (error.hint)    console.error(`       hint:    ${error.hint}`);
    failures++;
    continue;
  }

  const after = await readRow(u.id);
  console.log(`AFTER  ${fmt(after)}`);

  // Spot-check that the values actually changed where intended.
  let mismatch = false;
  for (const k of Object.keys(patch)) {
    if (k === "updated_at") continue;
    if (after[k] !== patch[k]) {
      console.error(`  FAIL ${u.id}.${k} read-back mismatch: expected ${patch[k]}, got ${after[k]}`);
      mismatch = true;
    }
  }
  if (!mismatch) console.log(`  ok   ${u.id} write verified`);
  console.log();
}

console.log(failures === 0
  ? `PASS — ${UPLOADS.length} document(s) updated Live.`
  : `FAIL — ${failures} issue(s).`);
process.exit(failures === 0 ? 0 : 1);
