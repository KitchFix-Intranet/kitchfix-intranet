// ═══════════════════════════════════════════════════════════════
// CUTOVER CONFIG (Stage 1 dual-write control plane)
// ═══════════════════════════════════════════════════════════════
//
// Two flags govern per-table behavior in the dataStore orchestrators.
// Both are comma-separated lists of TAB NAMES, parsed once at module
// load. Default empty = OFF.
//
//   DUAL_WRITE_TABLES        gates the PG write side of orchestrators
//   READ_FROM_POSTGRES       gates whether reads come from PG
//                            (plus READ_FROM_POSTGRES_<MODULE> variants
//                             for per-caller scoping; see below)
//
// Both are checked via boolean helpers (isDualWrite, isReadFromPostgres)
// at every orchestrator call site. The helpers are pure lookups; they
// do NOT enforce any cross-flag invariant at runtime.
//
// ORCHESTRATOR PATTERN (relevant to states 2-4 below)
//   Every dataStore upsertX / replaceX / updateXStatus orchestrator
//   writes Sheets UNCONDITIONALLY, then optionally mirrors to PG when
//   isDualWrite(tab) returns true. There is no third branch where
//   Sheets writes are skipped. This is what determines the per-state
//   behavior described below.
//
// FOUR STATES (3 supported + 1 misconfiguration)
//
//   1. NEITHER flag set
//      = OFF. Reads from Sheets. Writes to Sheets only. Postgres is
//        not touched (Supabase client never constructed).
//        Default state on merge. Zero behavior change.
//
//   2. DUAL_WRITE_TABLES only
//      = DUAL-WRITE BUILDING. Reads from Sheets (still authoritative).
//        Writes go to BOTH Sheets AND Postgres. Sheets stays source
//        of truth; Postgres is a shadow being populated. Used to
//        build confidence in PG writes before flipping reads.
//
//   3. DUAL_WRITE_TABLES + READ_FROM_POSTGRES
//      = CUT OVER. Reads from Postgres (PG is now source of truth).
//        Writes still go to BOTH. Sheets stays current as the
//        rollback target. This is the steady state for the 3
//        modules migrated to date.
//
//   4. READ_FROM_POSTGRES only (no DUAL_WRITE_TABLES)
//      = MISCONFIGURATION. Reads from PG but writes only reach
//        Sheets (orchestrator pattern above). PG goes stale on the
//        next user write; subsequent reads return outdated data.
//        NOTHING IN THE CODE PREVENTS THIS STATE. The implicit
//        invariant "READ_FROM_POSTGRES implies DUAL_WRITE_TABLES"
//        must be maintained operationally by whoever sets the env
//        vars. State 4 manifests silently as data loss, not as a
//        runtime error.
//
// DECOMMISSION NOTE (KNOWN LIMITATION)
//   An earlier version of this doc described a "final" cutover step
//   of removing a table from DUAL_WRITE_TABLES so "Sheets writes
//   stop (Sheets becomes a frozen backup)." That step is NOT
//   achievable with the current code. Per the orchestrator pattern
//   above, removing a table from DUAL_WRITE_TABLES stops PG writes,
//   not Sheets writes - producing state 4, with PG going stale.
//
//   To actually decommission a table (make PG the sole writer and
//   freeze Sheets), the orchestrators would need to invert their
//   semantics: skip the Sheets write when the table is in
//   READ_FROM_POSTGRES but not in DUAL_WRITE_TABLES, OR introduce
//   a third flag (e.g., FREEZE_SHEETS_TABLES). Neither change
//   exists today. Flagged as future work if/when the dual-write
//   maintenance burden becomes meaningful in practice.
//
//   Practical impact today: small but non-zero. Maintaining Sheets
//   writes after the read flip keeps the rollback net current with
//   negligible quota cost. The one operational tradeoff: Sheets API
//   availability gates write availability for all dual-write tables
//   (orchestrator writes Sheets first, throws if Sheets fails, never
//   reaches PG). Has not been a problem in practice; flagged here so
//   the dependency is documented.
//
// TAB NAME PARSING
//   Tab names are case-sensitive (Sheets is case-sensitive on tab
//   names). Whitespace is tolerated in env values. The natural key
//   matches how every helper in sheets.js takes (spreadsheetId,
//   tabName).
//
// HISTORICAL CUTOVER SEQUENCE (modules at state 3)
//   news_interactions      2026-05-27 morning
//   directory module       2026-05-27 afternoon (per-module flag)
//   submissions            2026-05-27 evening (per-module flag)
//   All currently stable in state 3. State 4 has not been used.

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
