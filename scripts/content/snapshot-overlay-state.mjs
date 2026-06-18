#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/snapshot-overlay-state.mjs
//
// Read-only snapshot of the OPD overlay state for every document. Used as the
// baseline / post-apply comparison point for the projection-preserve safety
// procedure. Pairs with verify-overlay-preserved.mjs.
//
// SAFETY PROCEDURE (run in this exact order around the projection-preserve
// migration that moves status + access_level to overlay):
//
//   1. ON MAIN, BEFORE merging the projection-preserve PR:
//        node --env-file=.env.local scripts/content/snapshot-overlay-state.mjs
//      Output: .scratch/overlay-baseline-pre-<ISO>.json (path printed).
//      Rename / copy as `overlay-baseline-pre.json` for the diff in step 5.
//
//   2. Check out the projection-preserve PR branch.
//
//   3. Run the projection in dry-run mode and verify NOTHING in the
//      "Would-update sample" section lists `status` or `access_level`:
//        node --env-file=.env.local scripts/content/project-catalog.mjs --dry-run
//      Inspect: docs/opd/foundation/PROJECTION_DRYRUN.md
//      If ANY doc shows status or access_level in its changes set, HALT.
//      Do not proceed - the conditional-include is buggy.
//
//   4. Run the projection apply:
//        node --env-file=.env.local scripts/content/project-catalog.mjs --apply
//
//   5. Re-snapshot and diff against the baseline:
//        node --env-file=.env.local scripts/content/snapshot-overlay-state.mjs
//        node scripts/content/verify-overlay-preserved.mjs \
//          .scratch/overlay-baseline-pre.json \
//          .scratch/overlay-baseline-post-<ISO>.json
//      Every (id, status, access_level) tuple MUST be identical. Any divergence
//      is a P0 - the migration is wrong. Roll back: revert the projection PR
//      and (if state was corrupted) restore status/access_level from the
//      baseline JSON via Studio UPDATEs.
//
//   6. Only after step 5 is clean: merge the projection-preserve PR to main.
//
// WHAT'S SNAPSHOTTED:
//   { id, status, access_level, pinned, archived, archived_at } for every
//   document row, ordered by id ASCENDING. pinned/archived included as extra
//   sanity columns - they should also never change during the projection apply
//   (they are already overlay-preserved by the existing preserve-by-omission
//   pattern; if they change, something deeper is wrong).
//
// USAGE:
//   node --env-file=.env.local scripts/content/snapshot-overlay-state.mjs
//   node --env-file=.env.local scripts/content/snapshot-overlay-state.mjs --out .scratch/custom-name.json
//
// READ-ONLY: this script never writes to Postgres. Only reads documents +
// document_pins, then writes a local JSON file.
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const SCRATCH_DIR = join(REPO_ROOT, ".scratch");

function parseArgs() {
  const args = process.argv.slice(2);
  let out = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && i + 1 < args.length) {
      out = args[i + 1];
      i++;
    }
  }
  return { out };
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required. " +
      "Run with `node --env-file=.env.local scripts/content/snapshot-overlay-state.mjs`."
    );
    process.exit(1);
  }

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  // documents columns we care about for the preserve check.
  const { data: docs, error: docsErr } = await sb
    .from("documents")
    .select("id, status, access_level, archived, archived_at")
    .order("id", { ascending: true });
  if (docsErr) {
    console.error(`documents read failed: ${docsErr.message}`);
    process.exit(1);
  }

  // document_pins overlay - pinned is sourced here post-pr-7-9, not from
  // documents.pinned. Build a Set of pinned doc_ids so we can decorate the
  // documents rows with an overlay-sourced `pinned` value.
  const { data: pins, error: pinsErr } = await sb
    .from("document_pins")
    .select("doc_id");
  if (pinsErr) {
    console.error(`document_pins read failed: ${pinsErr.message}`);
    process.exit(1);
  }
  const pinSet = new Set((pins || []).map((p) => p.doc_id));

  const snapshot = (docs || []).map((d) => ({
    id: d.id,
    status: d.status,
    access_level: d.access_level,
    pinned: pinSet.has(d.id),
    archived: d.archived,
    archived_at: d.archived_at,
  }));

  const { out } = parseArgs();
  if (!existsSync(SCRATCH_DIR)) mkdirSync(SCRATCH_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = out || join(SCRATCH_DIR, `overlay-snapshot-${ts}.json`);
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + "\n");

  console.log(`Snapshotted ${snapshot.length} document overlay rows.`);
  console.log(`Wrote: ${outPath.replace(REPO_ROOT + "/", "")}`);
  const counts = {
    status: {},
    access_level: {},
    pinned: 0,
    archived: 0,
  };
  for (const r of snapshot) {
    counts.status[r.status] = (counts.status[r.status] || 0) + 1;
    counts.access_level[r.access_level] = (counts.access_level[r.access_level] || 0) + 1;
    if (r.pinned) counts.pinned++;
    if (r.archived) counts.archived++;
  }
  console.log("");
  console.log("Distribution:");
  console.log("  status:");
  for (const [k, v] of Object.entries(counts.status).sort()) {
    console.log(`    ${k.padEnd(15)} ${v}`);
  }
  console.log("  access_level:");
  for (const [k, v] of Object.entries(counts.access_level).sort()) {
    console.log(`    ${k.padEnd(15)} ${v}`);
  }
  console.log(`  pinned          ${counts.pinned}`);
  console.log(`  archived        ${counts.archived}`);
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  console.error(e.stack);
  process.exit(1);
});
