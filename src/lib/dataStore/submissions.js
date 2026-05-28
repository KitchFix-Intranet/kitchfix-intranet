import { readSheetSA, appendRowSA, updateCellSA, updateRangeSA, SHEET_IDS } from "@/lib/sheets";
import { isDualWrite, isReadFromPostgres } from "@/lib/cutover";
import { getServiceClient } from "@/lib/supabase";

// ═══════════════════════════════════════════════════════════════
// SUBMISSIONS module (Stage 1 module 3 PR A - DORMANT)
// ═══════════════════════════════════════════════════════════════
//
// Source: COLLECTION / submissions (cols A-K, 109 rows as of 2026-05-27).
// PG schema: docs/SHEETS_AUDIT_SYNTHESIS.md plus the submissions-recon
// design discussion. Schema is LIVE in Supabase; DDL is Supabase-side,
// not versioned.
//
// DORMANT INFRASTRUCTURE: with cutover flags off (the default state on
// merge), nothing in this section is called. The dashboard handler is
// updated to route its submissions read through the dataStore (one
// small block change), and the people handler will be rewired in PR B.
// Same zero-merge-risk pattern as directory PR A.
//
// Public API:
//   getSubmissions({ module })             - read all submissions
//   getSubmissionByToken(token, { module }) - read single submission
//   upsertSubmission(token, fields)        - create (token=null) or
//                                            update (token="sub-N")
//   updateSubmissionStatus(token, status, notes)
//                                          - I/J/K-column transition
//                                            (status, notes,
//                                            admin_action_at stamp)
//
// SUB-{N} TOKEN DESIGN:
//   The "sub-{N}" token format comes from the pre-migration handler:
//     id: "sub-" + (i + 2)
//   where i is the 0-indexed position in the data rows array (header
//   excluded). So sub-2 = first data row, sub-N = data row at
//   0-indexed position N-2, which is also Sheet row N (header at row 1).
//
//   On Sheets path: token N -> Sheet row N (today's behavior, byte
//     identical).
//   On Postgres path: token N -> ORDER BY created_at ASC OFFSET (N-2)
//     LIMIT 1. The token is a VIRTUAL INDEX over rows in creation
//     order; the row's UUID is internal to the dataStore.
//
//   Both backends agree on row position because:
//     (a) the backfill copies rows from Sheets to PG in created_at ASC
//         order, so PG's offset N-2 = Sheets data row N-2 = Sheet row N
//     (b) during dual-write, new submissions append to both backends
//         simultaneously, so they get the same ordinal position
//
//   Token deprecation path (future PR, NOT this one): expose the PG
//   UUID directly to the frontend, deprecate "sub-{N}" tokens. Keep
//   them for backwards compatibility during the cutover window.
//
// TIMESTAMP DUAL-COLUMN DESIGN (created_at + submitted_at):
//   The Sheet has ONE timestamp column (col A) that mirrors two
//   logically-distinct semantics:
//     - "when this submission was first created" (immutable origin)
//     - "when this submission was last submitted/edited" (mutable activity)
//   The pre-migration handler overwrites col A on every edit
//   (submit-newhire/paf with isEdit=true), conflating the two.
//   PG splits this into two columns so the data model is clean AND
//   user-facing display behavior is byte-identical at cutover.
//
//     created_at    immutable. Set once on first INSERT. Drives the
//                   sub-{N} token math (OFFSET in created_at ASC).
//                   Never updated.
//     submitted_at  mutable. Mirrors the Sheets col A "last touched"
//                   semantic. Updated on every upsertSubmission edit
//                   (matching today's full-row Sheets writes) AND on
//                   every updateSubmissionStatus transition (per the
//                   design call: status transitions count as activity).
//
//   On the Sheets path, col A is the only timestamp source, so the
//   canonical record exposes BOTH createdAt and submittedAt as the
//   SAME value (col A). The Sheets path cannot tell them apart.
//
//   On the PG path, the two columns diverge intentionally:
//     - Token math reads created_at (stable ordering preserved)
//     - The canonical createdAt field reads created_at
//     - The canonical submittedAt field reads submitted_at
//
//   USER-FACING IMPACT AT CUTOVER:
//   The frontend's "submitted on X" date should display submittedAt,
//   NOT createdAt. With submittedAt populated correctly on every
//   write, the displayed date matches today's Sheets behavior
//   exactly. No user-facing divergence.
//
//   STATUS TRANSITION NOTE:
//   In the Sheets handler, admin-process / withdraw / cancel write to
//   cols I/J/K only; they do NOT touch col A. Strict Sheets-parity
//   would mean submitted_at also not updated on those transitions.
//   We deliberately diverge here: updateSubmissionStatus on PG bumps
//   submitted_at. The data-model argument (activity tracking) was
//   chosen over strict Sheets-parity. Frontend impact is minimal
//   (the displayed date may shift slightly forward when an admin
//   processes a row, vs Sheets where it would have stayed at the
//   submit time).
//
// STATUS DEFAULT GOTCHA (PG semantics):
//   The PG column has DEFAULT 'Pending'. This default fires ONLY on
//   column-omitted INSERTs (no key in the payload object), NOT on
//   empty-string INSERTs. If the caller passes status: "", the PG
//   row gets stored with status = "" literally, which would create
//   split-brain with the read-side coalesce logic that coerces blanks
//   to "Pending" via `String(row[SUB.STATUS] || "Pending")`.
//
//   Therefore: upsertSubmissionPostgres / updateSubmissionStatusPostgres
//   OMIT the status key from the payload when the input is falsy/empty.
//   The DDL comment (schema-side) and these helpers (dataStore-side)
//   enforce this together.
//
// COL K (admin_action_at) IS WRITE-ONLY in the API:
//   updateSubmissionStatus writes admin_action_at on every transition
//   (matches the pre-migration handler's writes to SUB.ADMIN_ACTION_COL).
//   The canonical read shape does NOT expose admin_action_at. The audit
//   labeled this column "BUG/unlabeled K" but per the recon design, it
//   is intentional audit-trail behavior, preserved.
//
// CROSS-MODULE READ:
//   src/app/api/dashboard/route.js also reads submissions for the
//   People Portal metrics widget. PR A routes that read through
//   getSubmissions({ module: "dashboard" }) so the dashboard cutover
//   can be sequenced INDEPENDENTLY of the people module via the
//   READ_FROM_POSTGRES_DASHBOARD env flag.

const SUBMISSIONS_TAB = "submissions";

// Sheet column positional indices (0-indexed; matches SUB in people/route.js).
// Col K (1-indexed col 11) is intentionally absent - write-only audit
// trail, never read positionally.
const SUBMISSIONS_IDX = {
  timestamp:  0,  // A
  submitter:  1,  // B
  module:     2,  // C
  employee:   3,  // D
  location:   4,  // E
  actionType: 5,  // F
  effective:  6,  // G
  payload:    7,  // H
  status:     8,  // I
  notes:      9,  // J
};

// ── Token parsing + resolution ──────────────────────────────────

// Parse "sub-{N}" -> integer N. Throws on malformed tokens.
function parseSubmissionToken(token) {
  if (typeof token !== "string" || !token.startsWith("sub-")) {
    throw new Error(
      `[dataStore] invalid submission token: ${JSON.stringify(token)} ` +
        `(expected "sub-{N}")`
    );
  }
  const n = parseInt(token.slice("sub-".length), 10);
  if (!Number.isFinite(n) || n < 2) {
    throw new Error(
      `[dataStore] invalid submission token: ${JSON.stringify(token)} ` +
        `(expected N >= 2 since N is the 1-indexed Sheet row position, ` +
        `header at row 1)`
    );
  }
  return n;
}

// Sheets-side token resolution: token "sub-N" -> Sheet row number N.
// Identity function plus validation - the token IS the sheet row.
function resolveTokenSheets(token) {
  return parseSubmissionToken(token);
}

// Postgres-side token resolution: token "sub-N" -> UUID via
// SELECT id FROM submissions ORDER BY created_at ASC OFFSET (N-2)
// LIMIT 1. Returns the UUID string or throws if no row at that offset.
async function resolveTokenPostgres(token) {
  const n = parseSubmissionToken(token);
  const offset = n - 2;
  if (offset < 0) {
    throw new Error(
      `[dataStore] token offset out of range: ${token} -> offset ${offset}`
    );
  }
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from(SUBMISSIONS_TAB)
    .select("id")
    .order("created_at", { ascending: true })
    .range(offset, offset);
  if (error) {
    throw new Error(
      `[dataStore.pg] resolveTokenPostgres failed for ${token}: ${error.message}`
    );
  }
  if (!data || data.length === 0) {
    throw new Error(
      `[dataStore.pg] resolveTokenPostgres: no row at offset ${offset} ` +
        `(token ${token}; table may have fewer rows than expected)`
    );
  }
  return data[0].id;
}

// ── Sheets adapter ──────────────────────────────────────────────

// Build canonical record from a Sheets row array + its 0-indexed
// position in the rows array (used to compute the sub-{N} token).
//
// TIMESTAMP NOTE: on the Sheets path, col A is the only timestamp
// source. createdAt and submittedAt are exposed as the SAME value
// (col A); the Sheets path cannot tell them apart. On the PG path
// they diverge intentionally - see the TIMESTAMP DUAL-COLUMN DESIGN
// block comment above for full details.
function canonicalFromSheetsRow(r, dataIdx) {
  const ts = String(r[SUBMISSIONS_IDX.timestamp] || "");
  return {
    token:       `sub-${dataIdx + 2}`,  // header at row 1; first data row = sub-2
    createdAt:   ts,
    submittedAt: ts,                    // same as createdAt on Sheets path
    submitter:   String(r[SUBMISSIONS_IDX.submitter]  || ""),
    module:      String(r[SUBMISSIONS_IDX.module]     || ""),
    employee:    String(r[SUBMISSIONS_IDX.employee]   || ""),
    location:    String(r[SUBMISSIONS_IDX.location]   || ""),
    actionType:  String(r[SUBMISSIONS_IDX.actionType] || ""),
    effective:   String(r[SUBMISSIONS_IDX.effective]  || ""),
    payload:     String(r[SUBMISSIONS_IDX.payload]    || ""),
    // Coalesce blank to "Pending" - matches existing handler reads
    // via `String(row[SUB.STATUS] || "Pending")`.
    status:      String(r[SUBMISSIONS_IDX.status]     || "Pending"),
    notes:       String(r[SUBMISSIONS_IDX.notes]      || ""),
  };
}

// Exported for direct Sheets-source reads (backfill scripts).
export async function readSubmissionsSheets() {
  const { rows } = await readSheetSA(SHEET_IDS.COLLECTION, SUBMISSIONS_TAB);
  return rows.map((r, i) => canonicalFromSheetsRow(r, i));
}

async function readSubmissionByTokenSheets(token) {
  const n = resolveTokenSheets(token);
  const dataIdx = n - 2;
  const { rows } = await readSheetSA(SHEET_IDS.COLLECTION, SUBMISSIONS_TAB);
  if (dataIdx < 0 || dataIdx >= rows.length) return null;
  return canonicalFromSheetsRow(rows[dataIdx], dataIdx);
}

async function upsertSubmissionSheets(token, fields) {
  // Build the A-J row payload. Status coerces blank to "Pending" to
  // match the read-side coalesce convention.
  const row = [
    fields.createdAt || new Date().toISOString(),  // A
    fields.submitter || "",                        // B
    fields.module    || "",                        // C
    fields.employee  || "",                        // D
    fields.location  || "",                        // E
    fields.actionType || "",                       // F
    fields.effective || "",                        // G
    fields.payload   || "",                        // H
    fields.status    || "Pending",                 // I (coerce blank)
    fields.notes     || "",                        // J
  ];

  if (token === null || token === undefined) {
    // New submission - append
    await appendRowSA(SHEET_IDS.COLLECTION, SUBMISSIONS_TAB, row);
  } else {
    // Existing - update A:J range at the resolved Sheet row.
    // NOTE: this overwrites col A (TIMESTAMP) with the new timestamp,
    // matching pre-PR-B handler behavior on isEdit. The Sheets path
    // exposes that updated col A as BOTH createdAt and submittedAt
    // in the canonical record (the Sheet has only one timestamp
    // column). See the TIMESTAMP DUAL-COLUMN DESIGN block comment
    // for how PG splits this into two columns.
    const sheetRow = resolveTokenSheets(token);
    const range = `${SUBMISSIONS_TAB}!A${sheetRow}:J${sheetRow}`;
    await updateRangeSA(SHEET_IDS.COLLECTION, range, [row]);
  }
}

async function updateSubmissionStatusSheets(token, status, notes, adminActionAt) {
  const sheetRow = resolveTokenSheets(token);
  // Status transition: I (status), J (notes), K (admin_action_at).
  // Three independent cell updates - matches pre-PR-B handler.
  //
  // adminActionAt is normally passed in by the orchestrator
  // (updateSubmissionStatus) so the same event-moment lands in
  // Sheets col K and PG admin_action_at. Fallback to a fresh
  // timestamp if a future caller forgets to pass it.
  await updateCellSA(
    SHEET_IDS.COLLECTION,
    `${SUBMISSIONS_TAB}!I${sheetRow}`,
    status
  );
  await updateCellSA(
    SHEET_IDS.COLLECTION,
    `${SUBMISSIONS_TAB}!J${sheetRow}`,
    notes
  );
  await updateCellSA(
    SHEET_IDS.COLLECTION,
    `${SUBMISSIONS_TAB}!K${sheetRow}`,
    adminActionAt || new Date().toISOString()
  );
}

// ── Postgres adapter ────────────────────────────────────────────

// Build canonical record from a PG row + its 0-indexed position in
// the ORDER BY created_at ASC result set. The position determines
// the sub-{N} token.
//
// TIMESTAMP NOTE: createdAt and submittedAt are distinct on the PG
// path. created_at is immutable (drives token math); submitted_at
// is mutable (matches the Sheets col A "last touched" semantic).
// See the TIMESTAMP DUAL-COLUMN DESIGN block comment for the full
// rationale.
function canonicalFromPgRow(row, dataIdx) {
  return {
    token:       `sub-${dataIdx + 2}`,
    createdAt:   row.created_at || "",
    submittedAt: row.submitted_at || "",  // mutable, matches Sheets col A
    submitter:   row.submitter_email || "",
    module:      row.module || "",
    employee:    row.employee_name || "",
    location:    row.location || "",
    actionType:  row.action_type || "",
    effective:   row.effective_date || "",
    payload:     row.payload || "",
    // PG NOT NULL DEFAULT 'Pending' guarantees status is never blank,
    // but coerce-or-pass for symmetry with the Sheets path.
    status:      row.status || "Pending",
    notes:       row.notes || "",
  };
}

async function readSubmissionsPostgres() {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from(SUBMISSIONS_TAB)
    .select(
      "id, created_at, submitted_at, submitter_email, module, " +
        "employee_name, location, action_type, effective_date, " +
        "payload, status, notes"
    )
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(`[dataStore.pg] getSubmissions: ${error.message}`);
  }
  return (data || []).map((row, i) => canonicalFromPgRow(row, i));
}

async function readSubmissionByTokenPostgres(token) {
  const n = parseSubmissionToken(token);
  const offset = n - 2;
  if (offset < 0) return null;
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from(SUBMISSIONS_TAB)
    .select(
      "id, created_at, submitted_at, submitter_email, module, " +
        "employee_name, location, action_type, effective_date, " +
        "payload, status, notes"
    )
    .order("created_at", { ascending: true })
    .range(offset, offset);
  if (error) {
    throw new Error(
      `[dataStore.pg] getSubmissionByToken(${token}): ${error.message}`
    );
  }
  if (!data || data.length === 0) return null;
  return canonicalFromPgRow(data[0], offset);
}

async function upsertSubmissionPostgres(token, fields) {
  const supabase = getServiceClient();

  // Build the payload. Status is conditionally included to respect
  // the DEFAULT 'Pending' gotcha: omit on falsy/empty so the column
  // DEFAULT fires; pass through otherwise.
  const payload = {
    submitter_email: fields.submitter || "",
    module:          fields.module || "",
    employee_name:   fields.employee || "",
    location:        fields.location || "",
    action_type:     fields.actionType || "",
    effective_date:  fields.effective || "",
    payload:         fields.payload || "",
    notes:           fields.notes || "",
    updated_at:      new Date().toISOString(),
  };
  // STATUS DEFAULT GOTCHA: omit if empty/missing so the column
  // DEFAULT 'Pending' fires on INSERT. Pass through if non-empty.
  if (fields.status && fields.status !== "") {
    payload.status = fields.status;
  }

  if (token === null || token === undefined) {
    // New submission - INSERT. Set BOTH created_at and submitted_at
    // to the same timestamp (the row's origin moment). created_at
    // never changes after this; submitted_at can be bumped on edits
    // and status transitions.
    const ts = fields.createdAt || new Date().toISOString();
    payload.created_at = ts;
    payload.submitted_at = ts;
    const { error } = await supabase.from(SUBMISSIONS_TAB).insert(payload);
    if (error) {
      throw new Error(`[dataStore.pg] upsertSubmission insert: ${error.message}`);
    }
  } else {
    // Existing - resolve UUID via token offset, then UPDATE everything
    // EXCEPT created_at (preserving the stable ordering that the token
    // math relies on). DO bump submitted_at to now() - this is the
    // mutable "last submitted/edited" timestamp that mirrors Sheets
    // col A behavior. See the TIMESTAMP DUAL-COLUMN DESIGN block
    // comment for the full design rationale.
    payload.submitted_at = new Date().toISOString();
    const id = await resolveTokenPostgres(token);
    const { error } = await supabase
      .from(SUBMISSIONS_TAB)
      .update(payload)
      .eq("id", id);
    if (error) {
      throw new Error(`[dataStore.pg] upsertSubmission update: ${error.message}`);
    }
  }
}

async function updateSubmissionStatusPostgres(token, status, notes, adminActionAt) {
  const supabase = getServiceClient();
  const id = await resolveTokenPostgres(token);
  // Patch I/J/K columns: status, notes, admin_action_at. status is
  // expected non-empty here (it's a transition write; "Pending" or
  // similar terminal value), but defensive coerce just in case.
  // Also bump submitted_at: status transitions count as activity
  // (see TIMESTAMP DUAL-COLUMN DESIGN block comment - this is a
  // deliberate divergence from strict Sheets-parity which would
  // leave col A untouched on admin transitions).
  //
  // admin_action_at uses the orchestrator-supplied adminActionAt so
  // it matches Sheets col K byte-for-byte. submitted_at and
  // updated_at are PG-only metadata and stay on a fresh local now
  // (no parallel Sheets timestamp to coordinate with).
  const now = new Date().toISOString();
  const payload = {
    status:          status || "Pending",
    notes:           notes  || "",
    admin_action_at: adminActionAt || now,
    submitted_at:    now,
    updated_at:      now,
  };
  const { error } = await supabase
    .from(SUBMISSIONS_TAB)
    .update(payload)
    .eq("id", id);
  if (error) {
    throw new Error(
      `[dataStore.pg] updateSubmissionStatus(${token}): ${error.message}`
    );
  }
}

// ── Public API: dispatched by cutover flags ────────────────────

/**
 * Read all submissions as an array of canonical records.
 *
 * Optional opts.module enables per-module READ flag dispatch.
 * Common values: "people" (handler), "dashboard" (metrics widget).
 *
 * Canonical record shape:
 *   { token: "sub-{N}", createdAt, submitter, module, employee,
 *     location, actionType, effective, payload, status, notes }
 *
 * admin_action_at is NOT exposed (write-only audit trail per design).
 */
export async function getSubmissions(opts = {}) {
  if (isReadFromPostgres(SUBMISSIONS_TAB, opts.module)) {
    return readSubmissionsPostgres();
  }
  return readSubmissionsSheets();
}

/**
 * Read a single submission by sub-{N} token. Returns canonical
 * record or null if no row at that position.
 */
export async function getSubmissionByToken(token, opts = {}) {
  if (isReadFromPostgres(SUBMISSIONS_TAB, opts.module)) {
    return readSubmissionByTokenPostgres(token);
  }
  return readSubmissionByTokenSheets(token);
}

/**
 * Create or update a submission.
 *   token:  null/undefined -> create new (append row)
 *           "sub-{N}"      -> update existing row at position N
 *   fields: { createdAt?, submitter, module, employee, location,
 *             actionType, effective, payload, status?, notes }
 *
 * Always writes to Sheets (rollback target). If DUAL_WRITE_TABLES
 * includes "submissions", also writes to Postgres.
 *
 * On Sheets path, updates overwrite col A with a fresh timestamp
 * (matches pre-PR-B behavior). On PG path, created_at is set ONCE
 * on INSERT and never changed; submitted_at is set on INSERT and
 * bumped on every UPDATE. See TIMESTAMP DUAL-COLUMN DESIGN block
 * comment for the full design rationale.
 */
export async function upsertSubmission(token, fields) {
  // Stamp createdAt ONCE before dispatching so both adapters write
  // the same timestamp. Without this, each adapter independently
  // calls new Date().toISOString() and the wall-clock between the
  // two sequential calls (~100-300ms) becomes a drift between
  // Sheets col A and PG created_at/submitted_at, breaking the
  // invariant that the two stores represent the same event-moment.
  const fieldsWithTs = {
    ...fields,
    createdAt: fields.createdAt || new Date().toISOString(),
  };
  await upsertSubmissionSheets(token, fieldsWithTs);
  if (isDualWrite(SUBMISSIONS_TAB)) {
    await upsertSubmissionPostgres(token, fieldsWithTs);
  }
}

/**
 * Status transition: writes I (status), J (notes), K (admin_action_at).
 * Used by withdraw-submission, cancel-submission, admin-process.
 *
 * Does NOT touch created_at or any other column.
 */
export async function updateSubmissionStatus(token, status, notes) {
  // Stamp adminActionAt ONCE before dispatching so both adapters
  // write the same event-moment to Sheets col K and PG
  // admin_action_at. Same drift-class fix as upsertSubmission.
  const adminActionAt = new Date().toISOString();
  await updateSubmissionStatusSheets(token, status, notes, adminActionAt);
  if (isDualWrite(SUBMISSIONS_TAB)) {
    await updateSubmissionStatusPostgres(token, status, notes, adminActionAt);
  }
}
