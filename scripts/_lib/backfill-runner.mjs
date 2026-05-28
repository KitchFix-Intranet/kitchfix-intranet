// ════════════════════════════════════════════════════════════════════════════
// Reusable backfill runner. Per-module backfill scripts
// (scripts/backfill-{module}.mjs) provide a config object; this runner
// handles the orchestration: header check, optional sidecar read,
// validation, transform, sample preview, dry-run gating, supabase client
// setup, write-strategy dispatch, post-write count verification.
//
// First consumer: scripts/backfill-submissions.mjs (PR C).
//
// NOT YET CONSUMED BY: scripts/backfill-directory.mjs. The directory
// script keeps its embedded runner for now; a future cleanup PR will
// migrate it to use this shared engine. Out of scope for the PR
// introducing the runner.
//
// USAGE FROM A PER-MODULE SCRIPT
//   import { runBackfill } from "./_lib/backfill-runner.mjs";
//   await runBackfill({ ...config });
//
// CONFIG SHAPE
//   moduleLabel:          string used in log headers, e.g. "submissions"
//   sheetId:              SHEET_IDS.HUB | SHEET_IDS.COLLECTION
//   sheetTabName:         string, tab name in the spreadsheet
//   expectedFirstHeader:  string | null. If string, runner aborts when
//                         headers[0] does not match. null skips the check.
//   readSheets:           async () -> canonical records array (typically
//                         one of the readXSheets exports from dataStore.js)
//   sidecarRead:          optional async () -> { rows } where rows[i]
//                         corresponds to canonicalRecords[i] by position.
//                         Used when the canonical layer intentionally drops
//                         columns the backfill needs to preserve (e.g.,
//                         admin_action_at on submissions). Runner aborts
//                         if sidecar length does not match canonical length.
//   validators:           optional array of { name, check, message } objects.
//                         check(canonicalRecord) returns boolean. False
//                         results in skip-with-log; transformToPg is NOT
//                         called for skipped rows.
//   transformToPg:        (canonicalRecord, sidecarRow|null) -> pgRow object
//   pgTable:              PG target table name
//   strategy:             "upsert" | "insert-if-empty" | "replace-null-pool"
//   onConflict:           string | null. For "upsert" strategy.
//   countScope:           string | null. Extra WHERE clause for the
//                         pre-flight and post-write count queries. Only
//                         "team_key IS NULL" is recognized currently.
//   npmCommand:           string. Shown in dry-run hint. e.g.
//                         "npm run backfill:submissions"
//   execute:              boolean. true = LIVE, false = DRY-RUN.
//
// STRATEGIES
//   upsert             ON CONFLICT (onConflict) DO UPDATE. Idempotent;
//                      safe to re-run.
//   insert-if-empty    SELECT count(*) [WHERE countScope] first; abort
//                      if > 0; else bulk INSERT. Used for tables with no
//                      natural UNIQUE column suitable for upsert.
//   replace-null-pool  DELETE WHERE team_key IS NULL + bulk INSERT.
//                      Currently only used by hero_images.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";
import { readSheetSA } from "../../src/lib/sheets.js";

export async function runBackfill(config) {
  const MODE = config.execute ? "LIVE" : "DRY-RUN";
  // If npmCommand already contains "--" (per-module CLI args), don't add
  // another one - npm only needs the first "--" as the script-arg separator.
  const executeFlag = config.npmCommand.includes(" -- ") ? "--execute" : "-- --execute";

  console.log("=".repeat(70));
  console.log(`${config.moduleLabel} backfill - ${MODE}`);
  console.log("=".repeat(70));
  console.log();

  // ── 1. Header check ──
  if (config.expectedFirstHeader) {
    const { headers } = await readSheetSA(config.sheetId, config.sheetTabName);
    if (headers[0] !== config.expectedFirstHeader) {
      console.error(
        `FATAL: header A1 of '${config.sheetTabName}' is "${headers[0]}", ` +
          `expected "${config.expectedFirstHeader}". The column mapping ` +
          `in the dataStore/transform assumes specific Sheet positions; ` +
          `if the header shifted, the backfill would write the wrong data. STOP.`
      );
      process.exit(1);
    }
    console.log(`Header check OK: '${config.sheetTabName}' A1 = "${headers[0]}"`);
  } else {
    console.log(`Header check skipped for '${config.sheetTabName}' (no documented header).`);
  }
  console.log();

  // ── 2. Read canonical records ──
  const canonicalRecords = await config.readSheets();
  console.log(`Read ${canonicalRecords.length} canonical records from Sheets via dataStore.`);

  // ── 2b. Sidecar (optional) ──
  let sidecarRows = null;
  if (config.sidecarRead) {
    const sidecar = await config.sidecarRead();
    sidecarRows = sidecar.rows || [];
    if (sidecarRows.length !== canonicalRecords.length) {
      console.error(
        `FATAL: sidecar row count (${sidecarRows.length}) does not match ` +
          `canonical record count (${canonicalRecords.length}). The two reads ` +
          `must be index-aligned for transformToPg to merge them safely. STOP.`
      );
      process.exit(1);
    }
    console.log(`Sidecar read OK: ${sidecarRows.length} raw rows aligned by index.`);
  }
  console.log();

  if (canonicalRecords.length === 0) {
    console.log("(empty source - nothing to backfill)");
    if (!config.execute) {
      console.log(`To execute for real: ${config.npmCommand} ${executeFlag}`);
    }
    return;
  }

  // ── 3. Validate + transform ──
  const pgRows = [];
  let skippedCount = 0;
  for (let i = 0; i < canonicalRecords.length; i++) {
    const r = canonicalRecords[i];
    let valid = true;
    for (const v of config.validators || []) {
      if (!v.check(r)) {
        console.warn(`[skip row ${i}] ${v.name}: ${v.message(r)}`);
        valid = false;
        skippedCount++;
        break;
      }
    }
    if (!valid) continue;
    const sidecarRow = sidecarRows ? sidecarRows[i] : null;
    pgRows.push(config.transformToPg(r, sidecarRow));
  }
  if (skippedCount > 0) {
    console.log();
    console.log(
      `Validation: skipped ${skippedCount} row(s). Proceeding with ${pgRows.length} valid row(s).`
    );
  }
  console.log();
  console.log(`Transformed: ${pgRows.length} rows ready to write.`);
  console.log();

  console.log("Sample of transformed rows (first 3):");
  pgRows.slice(0, 3).forEach((row, i) => {
    console.log(`  [${i}]`, JSON.stringify(row));
  });
  console.log();

  // ── 4. DRY-RUN: stop here ──
  if (!config.execute) {
    console.log("DRY-RUN: not connecting to Postgres. Nothing written.");
    console.log(
      `Strategy: ${config.strategy}` +
        (config.onConflict ? ` (ON CONFLICT ${config.onConflict})` : "")
    );
    console.log(`To execute for real: ${config.npmCommand} ${executeFlag}`);
    return;
  }

  // ── 5. LIVE: construct supabase client ──
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local."
    );
    process.exit(1);
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── 6. LIVE: write per strategy ──
  console.log(`LIVE: writing to ${config.pgTable} via ${config.strategy} strategy...`);

  if (config.strategy === "upsert") {
    const { error } = await supabase.from(config.pgTable).upsert(pgRows, {
      onConflict: config.onConflict,
      ignoreDuplicates: false,
    });
    if (error) {
      console.error("Upsert failed:", error);
      process.exit(1);
    }
    console.log(`Upsert OK: ${pgRows.length} rows reconciled.`);
  } else if (config.strategy === "insert-if-empty") {
    // Pre-flight: count rows in target table. Abort if non-zero so we
    // never clobber rows that may have arrived via dual-write.
    //
    // countScope is currently a closed enum: null or "team_key IS NULL".
    // Extend if a future module needs a different predicate. The same
    // enum is consumed by the post-write count query (section 7 below).
    let preCountQuery = supabase
      .from(config.pgTable)
      .select("*", { count: "exact", head: true });
    if (config.countScope === "team_key IS NULL") {
      preCountQuery = preCountQuery.is("team_key", null);
    }
    const { count: preCount, error: preCountErr } = await preCountQuery;
    if (preCountErr) {
      console.error("Pre-flight count check failed:", preCountErr);
      process.exit(1);
    }
    if (preCount > 0) {
      console.error(
        `FATAL: ${config.pgTable} already has ${preCount} row(s). The ` +
          `insert-if-empty strategy refuses to clobber existing data. ` +
          `Either (a) run BEFORE enabling DUAL_WRITE_TABLES, or ` +
          `(b) manually \`DELETE FROM ${config.pgTable};\` and re-run.`
      );
      process.exit(1);
    }
    const { error } = await supabase.from(config.pgTable).insert(pgRows);
    if (error) {
      console.error("Insert failed:", error);
      process.exit(1);
    }
    console.log(`Insert OK: ${pgRows.length} rows inserted into empty table.`);
  } else if (config.strategy === "replace-null-pool") {
    const { error: delErr } = await supabase
      .from(config.pgTable)
      .delete()
      .is("team_key", null);
    if (delErr) {
      console.error("Delete (global pool) failed:", delErr);
      process.exit(1);
    }
    if (pgRows.length > 0) {
      const { error: insErr } = await supabase.from(config.pgTable).insert(pgRows);
      if (insErr) {
        console.error("Insert failed:", insErr);
        process.exit(1);
      }
    }
    console.log(
      `Replace OK: deleted prior NULL-team_key rows + inserted ${pgRows.length} fresh rows.`
    );
  } else {
    console.error(`FATAL: unknown strategy "${config.strategy}"`);
    process.exit(1);
  }

  // ── 7. Post-write count verification ──
  let countQuery = supabase
    .from(config.pgTable)
    .select("*", { count: "exact", head: true });
  if (config.countScope === "team_key IS NULL") {
    countQuery = countQuery.is("team_key", null);
  }
  const { count, error: countErr } = await countQuery;
  if (countErr) {
    console.warn("Post-write count check failed:", countErr.message);
  } else {
    const scopeNote = config.countScope ? ` (${config.countScope})` : "";
    console.log(`Postgres ${config.pgTable} now has ${count} total rows${scopeNote}.`);
    if (count < pgRows.length) {
      console.warn(
        `WARNING: expected at least ${pgRows.length} rows, got ${count}. Investigate.`
      );
    }
  }
}
