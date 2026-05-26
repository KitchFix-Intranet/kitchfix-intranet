// ═══════════════════════════════════════════════════════════════
// DATA STORE - logical data layer for Stage 1 dual-write
// ═══════════════════════════════════════════════════════════════
//
// This layer sits between route handlers and the underlying storage
// (Sheets and/or Postgres). Handlers call logical operations like
// upsertNewsInteraction; this module decides which backend(s) get
// hit based on cutover.js flags.
//
// Per-table logical API:
//   getNewsInteractions({ userEmail })   - read records for a user
//   upsertNewsInteraction({ postId, userEmail }, partial)
//                                          - upsert with partial update
//
// Dispatch rules (per table, via cutover.js):
//   READ:
//     isReadFromPostgres(table) -> read from Postgres
//     else                       -> read from Sheets (default)
//   WRITE:
//     always write to Sheets (Sheets is the rollback target)
//     isDualWrite(table)        -> ALSO write to Postgres
//
// With both flags off (the default on merge), this layer is
// Sheets-only and behaves identically to the pre-Stage-1 helpers.

import { readSheetSA, appendRowSA, updateCellSA, SHEET_IDS } from "@/lib/sheets";
import { isDualWrite, isReadFromPostgres } from "@/lib/cutover";
import { getServiceClient } from "@/lib/supabase";

// ───────────────────────────────────────────────────────────────
// news_interactions
// ───────────────────────────────────────────────────────────────
// Sheet schema (COLLECTION / news_interactions, cols A-F):
//   A postId        text
//   B userEmail     text (lowercased + trimmed)
//   C read          "TRUE" / "FALSE"
//   D readAt        ISO timestamp string, or "" if not read
//   E saved         "TRUE" / "FALSE"
//   F acknowledged  "TRUE" / "FALSE"
//
// Postgres schema (public.news_interactions):
//   post_id text, user_email text, read bool, read_at timestamptz,
//   saved bool, acknowledged bool. PK (post_id, user_email).
//
// Type coercion lives here, not in either backend. Adapters speak
// their backend's native shape; the canonical record (what we
// expose to handlers) is always:
//   { postId, userEmail, read, readAt, saved, acknowledged }
// where read/saved/acknowledged are JS booleans and readAt is
// either "" or an ISO string.

const NEWS_INTERACTIONS_TAB = "news_interactions";

// ── Type coercion helpers ──

// Sheets stores booleans as "TRUE" / "FALSE" strings.
function strToBool(s) {
  return String(s || "").toUpperCase() === "TRUE";
}
function boolToStr(b) {
  return b ? "TRUE" : "FALSE";
}

// Canonical readAt is "" when unset, ISO string when set.
// Sheets stores it as raw string (already matches canonical).
// Postgres stores it as timestamptz; null on read maps to "",
// non-null maps to ISO via toISOString().
function pgTimestampToCanonical(t) {
  return t ? new Date(t).toISOString() : "";
}
// Canonical -> Postgres: empty string or null/undefined -> NULL; else
// pass the ISO string through (Postgres accepts it as timestamptz).
function canonicalTimestampToPg(s) {
  return s ? s : null;
}

// Email is always lowercased + trimmed at the dataStore boundary.
// Handlers should be normalizing too, but defense-in-depth.
function normalizeEmail(e) {
  return String(e || "").toLowerCase().trim();
}

// ── Sheets adapter ──

async function readNewsInteractionsSheets({ userEmail }) {
  const { rows } = await readSheetSA(SHEET_IDS.COLLECTION, NEWS_INTERACTIONS_TAB);
  const target = normalizeEmail(userEmail);
  return rows
    .filter((r) => normalizeEmail(r[1]) === target)
    .map((r) => ({
      postId: String(r[0] || ""),
      userEmail: normalizeEmail(r[1]),
      read: strToBool(r[2]),
      readAt: String(r[3] || ""),
      saved: strToBool(r[4]),
      acknowledged: strToBool(r[5]),
    }));
}

async function upsertNewsInteractionSheets({ postId, userEmail }, partial) {
  const normalizedEmail = normalizeEmail(userEmail);
  const { rows } = await readSheetSA(SHEET_IDS.COLLECTION, NEWS_INTERACTIONS_TAB);
  const rowIdx = rows.findIndex(
    (r) => String(r[0] || "") === postId && normalizeEmail(r[1]) === normalizedEmail
  );

  if (rowIdx >= 0) {
    // Existing row: update only the cells corresponding to provided partial fields
    const sheetRow = rowIdx + 2; // +1 header, +1 0-indexed -> 1-indexed
    const writes = [];
    if ("read" in partial) {
      writes.push(
        updateCellSA(SHEET_IDS.COLLECTION, `${NEWS_INTERACTIONS_TAB}!C${sheetRow}`, boolToStr(partial.read))
      );
    }
    if ("readAt" in partial) {
      writes.push(
        updateCellSA(
          SHEET_IDS.COLLECTION,
          `${NEWS_INTERACTIONS_TAB}!D${sheetRow}`,
          partial.readAt || ""
        )
      );
    }
    if ("saved" in partial) {
      writes.push(
        updateCellSA(SHEET_IDS.COLLECTION, `${NEWS_INTERACTIONS_TAB}!E${sheetRow}`, boolToStr(partial.saved))
      );
    }
    if ("acknowledged" in partial) {
      writes.push(
        updateCellSA(
          SHEET_IDS.COLLECTION,
          `${NEWS_INTERACTIONS_TAB}!F${sheetRow}`,
          boolToStr(partial.acknowledged)
        )
      );
    }
    await Promise.all(writes);
  } else {
    // No existing row: append a full 6-col row with provided values + Sheets defaults
    const newRow = [
      postId,
      normalizedEmail,
      "read" in partial ? boolToStr(partial.read) : "FALSE",
      "readAt" in partial ? partial.readAt || "" : "",
      "saved" in partial ? boolToStr(partial.saved) : "FALSE",
      "acknowledged" in partial ? boolToStr(partial.acknowledged) : "FALSE",
    ];
    await appendRowSA(SHEET_IDS.COLLECTION, NEWS_INTERACTIONS_TAB, newRow);
  }
}

// ── Postgres adapter ──

async function readNewsInteractionsPostgres({ userEmail }) {
  const supabase = getServiceClient();
  const target = normalizeEmail(userEmail);
  const { data, error } = await supabase
    .from("news_interactions")
    .select("post_id, user_email, read, read_at, saved, acknowledged")
    .eq("user_email", target);
  if (error) {
    throw new Error(`[dataStore.pg] readNewsInteractions: ${error.message}`);
  }
  return (data || []).map((row) => ({
    postId: row.post_id,
    userEmail: row.user_email,
    read: !!row.read,
    readAt: pgTimestampToCanonical(row.read_at),
    saved: !!row.saved,
    acknowledged: !!row.acknowledged,
  }));
}

async function upsertNewsInteractionPostgres({ postId, userEmail }, partial) {
  const supabase = getServiceClient();
  // Build the payload: key fields always present, plus any provided partial fields.
  // supabase-js .upsert with a partial column set INSERTs with those columns (PG
  // defaults fill in the rest) AND ON CONFLICT updates only those columns
  // (EXCLUDED.<col> for each column in the payload).
  const payload = {
    post_id: postId,
    user_email: normalizeEmail(userEmail),
  };
  if ("read" in partial) payload.read = !!partial.read;
  if ("readAt" in partial) payload.read_at = canonicalTimestampToPg(partial.readAt);
  if ("saved" in partial) payload.saved = !!partial.saved;
  if ("acknowledged" in partial) payload.acknowledged = !!partial.acknowledged;

  const { error } = await supabase
    .from("news_interactions")
    .upsert(payload, { onConflict: "post_id,user_email", ignoreDuplicates: false });
  if (error) {
    throw new Error(`[dataStore.pg] upsertNewsInteraction: ${error.message}`);
  }
}

// ── Public API: dispatched by cutover flags ──

/**
 * Read all news_interactions for a given user.
 * Returns array of canonical records.
 *
 * With READ_FROM_POSTGRES off (default): reads from Sheets.
 * With it on for this table: reads from Postgres.
 */
export async function getNewsInteractions({ userEmail }) {
  if (isReadFromPostgres(NEWS_INTERACTIONS_TAB)) {
    return readNewsInteractionsPostgres({ userEmail });
  }
  return readNewsInteractionsSheets({ userEmail });
}

/**
 * Upsert a news_interaction.
 *   key:     { postId, userEmail } - identifies the row
 *   partial: any subset of { read, readAt, saved, acknowledged }
 *            Only the provided fields are written; others remain
 *            at their current value (or backend defaults on insert).
 *
 * Always writes to Sheets (the rollback target).
 * With DUAL_WRITE_TABLES on for this table: ALSO writes to Postgres.
 *
 * Errors throw. The caller's outer try/catch handles surfacing.
 */
export async function upsertNewsInteraction(key, partial) {
  // Sheets first (the rollback target stays current).
  await upsertNewsInteractionSheets(key, partial);
  // Optionally mirror to Postgres.
  if (isDualWrite(NEWS_INTERACTIONS_TAB)) {
    await upsertNewsInteractionPostgres(key, partial);
  }
}
