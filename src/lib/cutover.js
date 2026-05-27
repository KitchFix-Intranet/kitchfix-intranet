// ═══════════════════════════════════════════════════════════════
// CUTOVER CONFIG (Stage 1 dual-write control plane)
// ═══════════════════════════════════════════════════════════════
//
// Two flags, three states per table:
//
//   1. table NOT in DUAL_WRITE_TABLES, NOT in READ_FROM_POSTGRES
//      = OFF. Reads from Sheets. Writes to Sheets only. Postgres is
//        not touched (Supabase client is never constructed).
//        This is the default state on merge. Zero behavior change.
//
//   2. table in DUAL_WRITE_TABLES, NOT in READ_FROM_POSTGRES
//      = DUAL-WRITE ONLY. Reads from Sheets (still authoritative).
//        Writes go to BOTH Sheets AND Postgres. Sheets stays the
//        source of truth; Postgres is a shadow being populated.
//        Used to build confidence that PG writes succeed without
//        flipping reads yet.
//
//   3. table in DUAL_WRITE_TABLES AND in READ_FROM_POSTGRES
//      = CUT OVER. Reads from Postgres (PG is now source of truth).
//        Writes go to BOTH for the cutover window. Sheets stays
//        populated as the rollback target. After the cutover window
//        proves stable, the table is removed from DUAL_WRITE_TABLES
//        too and Sheets writes stop (Sheets becomes a frozen backup).
//
// Read-only without dual-write (READ_FROM_POSTGRES set but
// DUAL_WRITE_TABLES not) is an illegal state - reading from Postgres
// while writes only hit Sheets would make PG stale immediately.
// isReadFromPostgres asserts isDualWrite is also true at call time.
//
// Both env vars are comma-separated lists of TAB NAMES (not table
// IDs - the natural key matches how every helper in sheets.js takes
// (spreadsheetId, tabName)). Whitespace tolerated. Case-sensitive on
// the tab name itself (Sheets is case-sensitive on tab names).
//
// Example deploy state for the first table:
//   Tuesday morning (this PR merges): both flags empty - off.
//   Wednesday morning:                 DUAL_WRITE_TABLES=news_interactions
//                                       (Postgres mirror starts filling)
//   Wednesday afternoon, confidence built:
//                                       READ_FROM_POSTGRES=news_interactions
//                                       (PG becomes source of truth)
//   Days later, stable:                remove from DUAL_WRITE_TABLES
//                                       (Sheets becomes frozen backup)

function parseTableSet(envValue) {
  if (!envValue) return new Set();
  return new Set(
    envValue
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

// ─── Per-module read flags (added for directory PR B) ────────────
// Some tabs (e.g. accounts, hero_images) are read by multiple modules.
// To cut over module-by-module instead of flipping all consumers at
// once, READ_FROM_POSTGRES_<MODULE> env vars provide per-caller scope.
//
// Format:
//   READ_FROM_POSTGRES_DIRECTORY=accounts,contacts,hero_images
//   READ_FROM_POSTGRES_PEOPLE=accounts
//   READ_FROM_POSTGRES_OPS=accounts
//   etc.
//
// Composition is OR with the tab-level READ_FROM_POSTGRES flag:
// a (caller, tab) pair reads from Postgres if EITHER the tab is in
// the global READ_FROM_POSTGRES flag OR the tab is in that caller's
// per-module flag.
//
// Discovery is generic: any env var matching READ_FROM_POSTGRES_*
// (excluding the bare READ_FROM_POSTGRES) is parsed as a per-module
// flag at module load. Adding a new module requires no code change
// here; just set the env var.

const READ_PER_MODULE_PREFIX = "READ_FROM_POSTGRES_";

function parsePerModuleReadFromPostgres() {
  const result = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      key.startsWith(READ_PER_MODULE_PREFIX) &&
      key !== "READ_FROM_POSTGRES"
    ) {
      const moduleName = key.slice(READ_PER_MODULE_PREFIX.length).toLowerCase();
      if (moduleName) result[moduleName] = parseTableSet(value);
    }
  }
  return result;
}

// Parsed once at module load. All default to empty when env vars
// are absent or empty - which is the merge-day default state (off).
const dualWriteTables = parseTableSet(process.env.DUAL_WRITE_TABLES);
const readFromPostgresTables = parseTableSet(process.env.READ_FROM_POSTGRES);
const readFromPostgresPerModule = parsePerModuleReadFromPostgres();

/**
 * Does this table have dual-write enabled?
 * (writes go to BOTH Sheets and Postgres)
 */
export function isDualWrite(tabName) {
  return dualWriteTables.has(tabName);
}

/**
 * Does this (caller, tab) pair read from Postgres?
 *
 * Without moduleName: pure tab-level check (backwards compatible
 * with the news_interactions cutover - dashboard calls dataStore
 * without a module arg, and the dispatch checks only the global
 * READ_FROM_POSTGRES flag).
 *
 * With moduleName: OR-composed result. Reads from Postgres if EITHER
 * the tab is in READ_FROM_POSTGRES (global) OR the tab is in
 * READ_FROM_POSTGRES_<MODULE> (per-module override). Allows
 * directory to cut over its reads of shared tabs (accounts,
 * hero_images) independently of other modules that read the same
 * tabs.
 *
 * Implicit invariant: if this returns true, isDualWrite must also
 * be true for the same tab so writes keep the PG mirror current.
 */
export function isReadFromPostgres(tabName, moduleName) {
  if (readFromPostgresTables.has(tabName)) return true;
  if (moduleName) {
    const perModule = readFromPostgresPerModule[String(moduleName).toLowerCase()];
    if (perModule && perModule.has(tabName)) return true;
  }
  return false;
}

/**
 * Diagnostic: a snapshot of the current cutover config.
 * Used for logging at boot and in dataStore for state-mismatch
 * detection. Returns plain arrays (not Sets) for easy JSON logging.
 */
export function getCutoverState() {
  const perModule = {};
  for (const [k, v] of Object.entries(readFromPostgresPerModule)) {
    perModule[k] = Array.from(v);
  }
  return {
    dualWriteTables: Array.from(dualWriteTables),
    readFromPostgresTables: Array.from(readFromPostgresTables),
    readFromPostgresPerModule: perModule,
  };
}
