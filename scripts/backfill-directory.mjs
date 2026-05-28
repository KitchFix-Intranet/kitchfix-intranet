// ════════════════════════════════════════════════════════════════════════════
// One-time-per-table backfill: copy Sheets data into Postgres for the
// directory module's 4 tables. Same shape as
// scripts/backfill-news-interactions.mjs from PR #63.
//
// PURPOSE
//   The directory module's PG tables (accounts, contacts, work_locations,
//   hero_images) are empty until backfilled. This script populates them
//   from the Sheets source-of-truth before the directory cutover. Run
//   AFTER setting DUAL_WRITE_TABLES (which starts mirroring live edits
//   to PG) but BEFORE setting READ_FROM_POSTGRES_DIRECTORY (which flips
//   directory's reads to PG).
//
// USAGE
//   Dry run (default):
//     npm run backfill:directory -- --table=<TABLE>
//   Live:
//     npm run backfill:directory -- --table=<TABLE> --execute
//
//   Or direct invocation (the npm script wraps this):
//     node --import ./scripts/_setup/register-aliases.mjs \
//          --env-file=.env.local scripts/backfill-directory.mjs --table=<TABLE> [--execute]
//
//   TABLE: one of accounts, contacts, work_locations, hero_images.
//
//   The --import flag preloads scripts/_setup/register-aliases.mjs which
//   teaches Node to resolve @/lib/* path aliases (mirrors jsconfig.json),
//   needed because src/lib/dataStore.js imports from @/lib/sheets etc.
//
// SAFETY
//   * Default mode is dry-run. Live mode requires --execute.
//   * Live mode uses idempotent upserts with appropriate ON CONFLICT
//     clauses, so the script is safe to re-run. Re-running after
//     dual-write has populated some rows reconciles instead of
//     erroring; re-running after a successful backfill is a no-op for
//     unchanged rows and a refresh for changed rows.
//   * This script does NOT touch the Sheets tabs. Sheets remains source
//     of truth until READ_FROM_POSTGRES_DIRECTORY flips post-backfill.
//   * This script does NOT flip any cutover flags. Flag flips happen
//     manually in the Vercel env, separately from this script.
//
// SHEET READS
//   Uses the exported readXSheets functions from src/lib/dataStore.js
//   so the transform logic lives in one place. Bypasses the dispatch
//   wrappers (getX) which would route to PG if READ_FROM_POSTGRES_*
//   flags are set - the backfill must always read from Sheets.
//
// PG WRITE STRATEGIES
//   accounts        - upsert ON CONFLICT (team_key) DO UPDATE
//   contacts        - upsert ON CONFLICT (team_key, email) DO UPDATE
//   work_locations  - upsert ON CONFLICT (team_key) DO UPDATE
//   hero_images     - DELETE WHERE team_key IS NULL + INSERT
//                     (the partial unique index on (url) WHERE team_key
//                     IS NULL cannot be addressed by Supabase's
//                     onConflict parameter; delete-then-insert matches
//                     replaceHeroImagesPostgres semantics)
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";
import { readSheetSA, SHEET_IDS } from "../src/lib/sheets.js";
import {
  readAccountsSheets,
  readContactsSheets,
  readWorkLocationsSheets,
  readHeroImagesSheets,
} from "../src/lib/dataStore.js";

// ── Arg parsing ──
const args = process.argv.slice(2);
const tableArg = args
  .find((a) => a.startsWith("--table="))
  ?.slice("--table=".length);
const EXECUTE = args.includes("--execute");

const VALID_TABLES = ["accounts", "contacts", "work_locations", "hero_images"];
if (!tableArg || !VALID_TABLES.includes(tableArg)) {
  console.error(
    "Usage: npm run backfill:directory -- --table=<TABLE> [--execute]"
  );
  console.error(`  TABLE: one of ${VALID_TABLES.join(", ")}`);
  console.error(
    "  (or direct: node --import ./scripts/_setup/register-aliases.mjs " +
      "--env-file=.env.local scripts/backfill-directory.mjs --table=<TABLE> [--execute])"
  );
  process.exit(1);
}

const MODE = EXECUTE ? "LIVE" : "DRY-RUN";

// ── Per-table config ──
//
// Each table config defines:
//   sheetTabName        - the tab in HUB to read for the header check
//   expectedFirstHeader - col A header to verify before any write
//                         (null = skip header check; used for hero_images
//                         since the tab has no documented header name)
//   readSheets          - the dataStore function returning canonical
//                         records from Sheets (bypasses dispatch)
//   pgTable             - target PG table name
//   transformToPg       - canonical record -> PG row object
//   strategy            - "upsert" or "replace-null-pool" (hero_images)
//   onConflict          - column list for ON CONFLICT (upsert strategy)
//   countScope          - extra WHERE clause for the post-write count
//                         verification (null = no filter)

const TABLES = {
  accounts: {
    sheetTabName: "accounts",
    expectedFirstHeader: "TeamKey",
    readSheets: readAccountsSheets,
    pgTable: "accounts",
    transformToPg: (r) => ({
      team_key:              r.teamKey,
      name:                  r.name              || "",
      level:                 r.level             || null,
      city:                  r.city              || null,
      state:                 r.state             || null,
      season:                r.season            || null,
      stadium_name:          r.stadium           || null,
      stadium_header_url:    r.stadiumHeaderUrl  || null,
      logo_url:              r.logoUrl           || null,
      address:               r.address           || null,
      lat:                   r.lat               || null,
      longitude:             r.longitude         || null,
      timezone:              r.timezone          || null,
      gmap_url:              r.gmapUrl           || null,
      active:                !!r.active,
      region:                r.region            || null,
      homestand_url:         r.homestandUrl      || null,
      sla_url:               r.slaUrl            || null,
      service_calendars_url: r.serviceCalendarsUrl || null,
      drive_url:             r.driveUrl          || null,
      updated_at:            new Date().toISOString(),
    }),
    strategy: "upsert",
    onConflict: "team_key",
    countScope: null,
  },

  contacts: {
    sheetTabName: "contacts",
    expectedFirstHeader: "TeamKey",
    readSheets: readContactsSheets,
    pgTable: "contacts",
    transformToPg: (r) => ({
      team_key:      r.teamKey,
      role:          r.role         || "",
      name:          r.name         || "",
      email:         r.email        || "",
      phone:         r.phone        || null,
      slack_handle:  r.slackHandle  || null,
      slack_user_id: r.slackUserId  || null,
      updated_at:    new Date().toISOString(),
    }),
    strategy: "upsert",
    onConflict: "team_key,email",
    countScope: null,
  },

  work_locations: {
    sheetTabName: "work_locations",
    expectedFirstHeader: "Work location name",
    readSheets: readWorkLocationsSheets,
    pgTable: "work_locations",
    transformToPg: (r) => ({
      team_key:      r.teamKey,
      location_name: r.locationName || "",
      team_name:     r.teamName     || "",
      updated_at:    new Date().toISOString(),
    }),
    strategy: "upsert",
    onConflict: "team_key",
    countScope: null,
  },

  hero_images: {
    sheetTabName: "hero_images",
    expectedFirstHeader: "ImageURL", // header added to fix PR #69 latent reader-drops-row-1 bug
    readSheets: readHeroImagesSheets,
    pgTable: "hero_images",
    transformToPg: (r) => ({
      team_key: null,
      url:      r.url,
      ordinal:  null,
    }),
    strategy: "replace-null-pool",
    onConflict: null,
    // Count only the global pool (team_key IS NULL) - per-account rows
    // are dormant infrastructure and not touched by this backfill.
    countScope: "team_key IS NULL",
  },
};

const config = TABLES[tableArg];

// ── Main ──

async function main() {
  console.log("=".repeat(70));
  console.log(`directory backfill - table=${tableArg} - ${MODE}`);
  console.log("=".repeat(70));
  console.log();

  // ── 1. Header check (where applicable) ──
  if (config.expectedFirstHeader) {
    const { headers } = await readSheetSA(SHEET_IDS.HUB, config.sheetTabName);
    if (headers[0] !== config.expectedFirstHeader) {
      console.error(
        `FATAL: header A1 of '${config.sheetTabName}' is "${headers[0]}", ` +
        `expected "${config.expectedFirstHeader}". The column mapping in ` +
        `the dataStore assumes specific Sheet positions; if the header ` +
        `shifted, the backfill would write the wrong data. STOP.`
      );
      process.exit(1);
    }
    console.log(`Header check OK: '${config.sheetTabName}' A1 = "${headers[0]}"`);
  } else {
    console.log(`Header check skipped for '${config.sheetTabName}' (no documented header).`);
  }
  console.log();

  // ── 2. Read canonical records via dataStore ──
  const records = await config.readSheets();
  console.log(`Read ${records.length} canonical records from Sheets via dataStore.`);
  console.log();

  if (records.length === 0) {
    console.log("(empty source - nothing to backfill)");
    if (!EXECUTE) {
      console.log(`To execute for real: npm run backfill:directory -- --table=${tableArg} --execute`);
    }
    return;
  }

  // ── 3. Transform + dedupe (hero_images only) ──
  let pgRows = records.map(config.transformToPg);

  if (tableArg === "hero_images") {
    // Dedupe by URL: the partial unique index would reject duplicates,
    // and the source Sheet COULD theoretically have dupes.
    const seen = new Set();
    const before = pgRows.length;
    pgRows = pgRows.filter((r) => {
      const u = String(r.url || "").trim();
      if (!u || seen.has(u)) return false;
      seen.add(u);
      return true;
    });
    if (pgRows.length < before) {
      console.log(`hero_images dedupe: ${before} -> ${pgRows.length} unique URLs.`);
    }
  }

  console.log(`Transformed: ${pgRows.length} rows ready to write.`);
  console.log();

  console.log("Sample of transformed rows (first 3):");
  pgRows.slice(0, 3).forEach((row, i) => {
    console.log(`  [${i}]`, JSON.stringify(row));
  });
  console.log();

  // ── 4. DRY-RUN: stop here ──
  if (!EXECUTE) {
    console.log("DRY-RUN: not connecting to Postgres. Nothing written.");
    console.log(`Strategy: ${config.strategy}` +
      (config.onConflict ? ` (ON CONFLICT ${config.onConflict})` : ""));
    console.log(
      `To execute for real: npm run backfill:directory -- --table=${tableArg} --execute`
    );
    return;
  }

  // ── 5. LIVE: construct supabase client ──
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.");
    process.exit(1);
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── 6. LIVE: write per strategy ──
  console.log(`LIVE: writing to ${config.pgTable} via ${config.strategy} strategy...`);

  if (config.strategy === "upsert") {
    const { error } = await supabase
      .from(config.pgTable)
      .upsert(pgRows, {
        onConflict: config.onConflict,
        ignoreDuplicates: false,
      });
    if (error) {
      console.error(`Upsert failed:`, error);
      process.exit(1);
    }
    console.log(`Upsert OK: ${pgRows.length} rows reconciled.`);
  } else if (config.strategy === "replace-null-pool") {
    // hero_images: DELETE WHERE team_key IS NULL, then INSERT new rows
    const { error: delErr } = await supabase
      .from(config.pgTable)
      .delete()
      .is("team_key", null);
    if (delErr) {
      console.error(`Delete (global pool) failed:`, delErr);
      process.exit(1);
    }
    if (pgRows.length > 0) {
      const { error: insErr } = await supabase
        .from(config.pgTable)
        .insert(pgRows);
      if (insErr) {
        console.error(`Insert failed:`, insErr);
        process.exit(1);
      }
    }
    console.log(`Replace OK: deleted prior NULL-team_key rows + inserted ${pgRows.length} fresh rows.`);
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

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
