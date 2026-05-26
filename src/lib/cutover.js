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

// Parsed once at module load. Both default to empty Set when env var
// is absent or empty - which is the merge-day default state (off).
const dualWriteTables = parseTableSet(process.env.DUAL_WRITE_TABLES);
const readFromPostgresTables = parseTableSet(process.env.READ_FROM_POSTGRES);

/**
 * Does this table have dual-write enabled?
 * (writes go to BOTH Sheets and Postgres)
 */
export function isDualWrite(tabName) {
  return dualWriteTables.has(tabName);
}

/**
 * Does this table read from Postgres?
 * (Postgres is the source of truth for reads)
 *
 * Implicit invariant: if this returns true, isDualWrite must also be
 * true for the same tab. The dataStore enforces this at call time.
 */
export function isReadFromPostgres(tabName) {
  return readFromPostgresTables.has(tabName);
}

/**
 * Diagnostic: a snapshot of the current cutover config.
 * Used for logging at boot and in dataStore for state-mismatch
 * detection. Returns plain arrays (not Sets) for easy JSON logging.
 */
export function getCutoverState() {
  return {
    dualWriteTables: Array.from(dualWriteTables),
    readFromPostgresTables: Array.from(readFromPostgresTables),
  };
}
