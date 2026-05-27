// ════════════════════════════════════════════════════════════════════════════
// One-time backfill: copy submissions data from Sheets into Postgres.
// First module to use the shared runner at scripts/_lib/backfill-runner.mjs.
//
// PURPOSE
//   The PG submissions table is empty until backfilled. Run BEFORE setting
//   DUAL_WRITE_TABLES += "submissions" (which mirrors live writes to PG)
//   to avoid races between historical backfill and live dual-write activity.
//   After the backfill + dual-write window, set READ_FROM_POSTGRES_PEOPLE
//   to flip reads to PG.
//
// USAGE
//   Dry run (default):
//     npm run backfill:submissions
//   Live:
//     npm run backfill:submissions -- --execute
//
//   Or direct invocation (the npm script wraps this):
//     node --import ./scripts/_setup/register-aliases.mjs \
//          --env-file=.env.local scripts/backfill-submissions.mjs [--execute]
//
// STRATEGY
//   insert-if-empty: pre-flight count check on the PG submissions table.
//   If non-zero, the script aborts with instructions. If zero, bulk INSERT.
//
//   Why not upsert: submissions has no natural UNIQUE column. The PK is a
//   synthetic UUID generated on INSERT. Adding a composite UNIQUE constraint
//   (e.g., submitter_email + created_at + employee_name) was rejected as a
//   schema change out of scope for this PR. For a one-shot 109-row backfill
//   of a currently-empty table, insert-if-empty is sufficient.
//
//   Why not delete-all + insert: races with dual-write. The pre-flight
//   count check enforces "backfill before dual-write" at the tool level.
//
// COL K (admin_action_at) PRESERVATION VIA SIDECAR READ
//   The canonical read shape returned by readSubmissionsSheets() in
//   src/lib/dataStore.js intentionally does NOT expose col K
//   (admin_action_at). Per the PR A design, col K is treated as a
//   write-only audit trail at the data layer.
//
//   For the BACKFILL, however, we want to preserve historical
//   admin_action_at values for the 109 pre-migration rows so the PG
//   audit trail does not lose history at cutover. This script does ONE
//   raw readSheetSA call as a "sidecar" alongside the canonical read,
//   indexes the raw row array by position alongside the canonical
//   records, and merges col K into the transform payload.
//
//   This is the ONE place we reach behind the canonical abstraction.
//   The canonical layer stays clean (does not expose admin_action_at).
//   Production reads continue to omit it. Production writes
//   (updateSubmissionStatus) continue to populate it. The sidecar is
//   backfill-only, one-shot.
//
//   Trade-off: two reads of the submissions tab on a cutover script
//   (single one-time cost, ~50ms over canonical). Acceptable.
// ════════════════════════════════════════════════════════════════════════════

import { readSheetSA, SHEET_IDS } from "../src/lib/sheets.js";
import { readSubmissionsSheets } from "../src/lib/dataStore.js";
import { runBackfill } from "./_lib/backfill-runner.mjs";

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");

// 0-indexed col K (admin_action_at), unlabeled in the Sheet header per
// the audit. Hard-coded here because this is the ONLY place the backfill
// needs to know about col K positionally; everywhere else the canonical
// layer abstracts column positions away.
const ADMIN_ACTION_COL_INDEX = 10;

try {
  await runBackfill({
    moduleLabel:         "submissions",
    sheetId:             SHEET_IDS.COLLECTION,
    sheetTabName:        "submissions",
    expectedFirstHeader: "Timestamp",
    readSheets:          readSubmissionsSheets,
    // Sidecar: same tab read in raw form, used solely to preserve col K
    // (admin_action_at). See the file header for the rationale.
    sidecarRead:         () => readSheetSA(SHEET_IDS.COLLECTION, "submissions"),
    pgTable:             "submissions",
    strategy:            "insert-if-empty",
    onConflict:          null,
    countScope:          null,
    npmCommand:          "npm run backfill:submissions",
    execute:             EXECUTE,

    // Skip-with-log validators. Pre-rewire empirical check (PR B)
    // showed 0/109 rows violate any of these, but the validators
    // document the invariants and surface any future drift.
    validators: [
      {
        name:    "module CHECK constraint",
        check:   (r) => r.module === "paf" || r.module === "newhire",
        message: (r) => `module value "${r.module}" not in ('paf', 'newhire')`,
      },
      {
        name:    "created_at non-empty",
        check:   (r) => Boolean(r.createdAt) && String(r.createdAt).length > 0,
        message: () => "createdAt is empty (PG column is NOT NULL with no default)",
      },
    ],

    transformToPg: (r, rawRow) => {
      const row = {
        created_at:      r.createdAt,
        submitted_at:    r.submittedAt,    // identical to createdAt on Sheets path (col A is single source)
        submitter_email: r.submitter || "",
        module:          r.module || "",
        employee_name:   r.employee || "",
        location:        r.location || "",
        action_type:     r.actionType || "",
        effective_date:  r.effective || "",
        payload:         r.payload || "",
        notes:           r.notes || "",
        updated_at:      new Date().toISOString(),
      };
      // STATUS DEFAULT GOTCHA: omit if blank so column DEFAULT 'Pending'
      // fires (matches upsertSubmissionPostgres in PR A).
      if (r.status && r.status !== "") {
        row.status = r.status;
      }
      // Sidecar merge: admin_action_at preserved from col K.
      // See file header for why this is the one place we reach behind
      // the canonical abstraction.
      //
      // Defensive parse: PG TIMESTAMPTZ parsing is strict, and one
      // malformed col K cell (manual edit, copy-paste accident) would
      // cause the entire bulk INSERT to fail. Per the audit, col K is
      // 104/109 populated, so variance is known. We Date.parse the raw
      // string, round-trip through ISO if valid (canonical form for PG),
      // and skip-with-log on parse failure so the submission row STILL
      // gets inserted - just without admin_action_at.
      if (rawRow && rawRow[ADMIN_ACTION_COL_INDEX]) {
        const raw = String(rawRow[ADMIN_ACTION_COL_INDEX]).trim();
        if (raw) {
          const parsed = Date.parse(raw);
          if (!isNaN(parsed)) {
            row.admin_action_at = new Date(parsed).toISOString();
          } else {
            console.warn(
              `[admin_action_at parse fail] row created_at=${r.createdAt}: ` +
                `col K value "${raw}" is not parseable as a Date. Storing null.`
            );
          }
        }
      }
      return row;
    },
  });
} catch (e) {
  console.error("FAILED:", e);
  process.exit(1);
}
