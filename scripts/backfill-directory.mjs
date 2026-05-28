// ════════════════════════════════════════════════════════════════════════════
// One-time backfill: copy directory tables from Sheets into Postgres.
// Second consumer of the shared runner at scripts/_lib/backfill-runner.mjs.
//
// PURPOSE
//   The directory module's 4 PG tables (accounts, contacts, work_locations,
//   hero_images) are populated from the Sheets source before the directory
//   cutover. Already used end-to-end for the Module 2 cutover (2026-05-27).
//   Re-runnable: upsert strategies are idempotent, replace-null-pool wipes
//   the global hero pool before re-inserting.
//
// MIGRATION HISTORY
//   This script originally embedded its own orchestration runner (~150
//   lines: header check, read, transform, sample preview, dry-run gate,
//   supabase client setup, write-strategy dispatch, post-write count).
//   PR #77 (submissions cutover) extracted that orchestration into
//   scripts/_lib/backfill-runner.mjs and made backfill-submissions.mjs
//   its first consumer. This script now uses the same shared engine,
//   leaving directory as a thin per-table config catalog. No behavior
//   change. The runner is unchanged.
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
// STRATEGIES (per table)
//   accounts        upsert ON CONFLICT (team_key) DO UPDATE
//   contacts        upsert ON CONFLICT (team_key, email) DO UPDATE
//   work_locations  upsert ON CONFLICT (team_key) DO UPDATE
//   hero_images     replace-null-pool (DELETE WHERE team_key IS NULL + INSERT)
//                   Cannot upsert: the partial unique index on (url) WHERE
//                   team_key IS NULL is not addressable via Supabase's
//                   onConflict parameter; delete-then-insert matches
//                   replaceHeroImagesPostgres semantics.
//
// SHEET READS
//   Uses the exported readXSheets functions from src/lib/dataStore.js so
//   the transform logic lives in one place. Bypasses the dispatch wrappers
//   (getX) which would route to PG if READ_FROM_POSTGRES_* flags are set;
//   the backfill must always read from Sheets.
//
// HERO_IMAGES URL DEDUPE
//   The hero_images config wraps readHeroImagesSheets() with a dedupe
//   filter. Preserved from pre-runner-migration logic; no known
//   duplicates today after PR #80, but the check is cheap insurance.
//
// SAFETY
//   * Default mode is dry-run. Live mode requires --execute.
//   * Upsert strategies are idempotent. Re-running after dual-write has
//     populated some rows reconciles instead of erroring.
//   * replace-null-pool deletes the global hero pool before re-inserting.
//     Any concurrent admin edits between DELETE and INSERT could be lost;
//     acceptable because hero_images edits are rare.
//   * This script does NOT touch the Sheets tabs.
//   * This script does NOT flip any cutover flags.
// ════════════════════════════════════════════════════════════════════════════

import { SHEET_IDS } from "../src/lib/sheets.js";
import {
  readAccountsSheets,
  readContactsSheets,
  readWorkLocationsSheets,
  readHeroImagesSheets,
} from "../src/lib/dataStore.js";
import { runBackfill } from "./_lib/backfill-runner.mjs";

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

// ── Per-table configs ──

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
    expectedFirstHeader: "ImageURL",
    // Defensive dedupe: preserved from pre-runner-migration logic. The
    // source Sheet historically had duplicate URLs that needed filtering;
    // no known duplicates today after PR #80, but the check is cheap
    // insurance against future data drift. Logs the count delta when
    // dedupe actually filters anything (silent when there's nothing to
    // remove).
    readSheets: async () => {
      const records = await readHeroImagesSheets();
      const seen = new Set();
      const deduped = records.filter((r) => {
        const u = String(r.url || "").trim();
        if (!u || seen.has(u)) return false;
        seen.add(u);
        return true;
      });
      if (deduped.length < records.length) {
        console.log(
          `hero_images dedupe: ${records.length} -> ${deduped.length} unique URLs.`
        );
      }
      return deduped;
    },
    pgTable: "hero_images",
    transformToPg: (r) => ({
      team_key: null,
      url:      r.url,
      ordinal:  null,
    }),
    strategy: "replace-null-pool",
    onConflict: null,
    // Count only the global pool (team_key IS NULL); per-account rows
    // are dormant infrastructure and not touched by this backfill.
    countScope: "team_key IS NULL",
  },
};

const config = TABLES[tableArg];

// ── Invoke the shared runner ──

try {
  await runBackfill({
    ...config,
    moduleLabel: `directory.${tableArg}`,
    sheetId:     SHEET_IDS.HUB,
    npmCommand:  `npm run backfill:directory -- --table=${tableArg}`,
    execute:     EXECUTE,
  });
} catch (e) {
  console.error("FAILED:", e);
  process.exit(1);
}
