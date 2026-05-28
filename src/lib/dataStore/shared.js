import { readSheetSA, appendRowsSA, deleteRowSA, getSheetIdSA } from "@/lib/sheets";
import { isDualWrite } from "@/lib/cutover";
import { getServiceClient } from "@/lib/supabase";

// ═══════════════════════════════════════════════════════════════
// SHARED PRIMITIVES (foundation for directory + future modules)
// ═══════════════════════════════════════════════════════════════
//
// These primitives are internal to the dataStore module. They are
// exported from shared.js for the per-table adapter files
// (directory.js etc.) and are NOT part of the public dataStore
// surface (i.e., not re-exported by index.js).

/**
 * Coordinated multi-table write helper.
 *
 * Runs operations sequentially. Each op is { name, run }; run is
 * an async function that performs the write. On failure, the
 * primitive LOGS LOUDLY and continues to the next op (does NOT
 * throw mid-flight). Returns a summary { allSuccess, results }
 * so the caller can decide how to respond to partial failure.
 *
 * Per directory design: Sheets is source of truth during the
 * dual-write window. Postgres mirrors are best-effort. If a PG
 * write fails partway through a multi-table action, the system
 * logs the divergence (which surfaces on the next read once
 * READ_FROM_POSTGRES is flipped) and the action continues. The
 * Sheets state remains consistent, which is what production
 * reads from today.
 *
 * Sequential (not parallel) to avoid Sheets per-doc write rate
 * limits in the common case where multiple ops hit the same
 * spreadsheet.
 */
export async function coordinatedWrite(operations) {
  const results = [];
  for (const op of operations) {
    try {
      const result = await op.run();
      results.push({ name: op.name, success: true, result });
    } catch (e) {
      const msg = e?.message ?? String(e);
      results.push({ name: op.name, success: false, error: msg });
      console.error(`[dataStore.coordinatedWrite] ${op.name} FAILED:`, msg);
    }
  }
  return {
    allSuccess: results.every((r) => r.success),
    results,
  };
}

/**
 * Generic delete: removes a row from a Sheets tab (by key lookup
 * in the specified positional column) and optionally from Postgres
 * (by PK column name + value) if dual-write is on for the tab.
 *
 * Used by directory's work_locations removal (PR B) and the
 * delete-half of replaceScope flows. Symmetric Sheets / PG
 * semantics modulo the dual-write flag.
 *
 * If the key is absent from Sheets, this is treated as a no-op
 * success rather than an error (idempotent delete).
 */
export async function deleteRecord({
  spreadsheetId,
  tabName,
  sheetsKeyColIdx,
  key,
  pgTable,
  pgKeyCol,
}) {
  // Sheets: find row by key, delete if found
  const { rows } = await readSheetSA(spreadsheetId, tabName);
  const rowIdx = rows.findIndex(
    (r) => String(r[sheetsKeyColIdx] || "").trim() === String(key).trim()
  );
  if (rowIdx >= 0) {
    const tabId = await getSheetIdSA(spreadsheetId, tabName);
    if (tabId == null) {
      throw new Error(
        `[dataStore.deleteRecord] could not resolve sheet gid for ${tabName}`
      );
    }
    // deleteRowSA expects 0-indexed row position (header at 0).
    // rowIdx is 0-indexed into data rows, so the actual position is rowIdx + 1.
    await deleteRowSA(spreadsheetId, tabId, rowIdx + 1);
  }

  // Postgres: only if dual-write is on for this tab
  if (isDualWrite(tabName)) {
    const supabase = getServiceClient();
    const { error } = await supabase.from(pgTable).delete().eq(pgKeyCol, key);
    if (error) {
      // Per directory design: log loudly, do not throw - Sheets succeeded
      console.error(
        `[dataStore.deleteRecord] PG delete failed (${pgTable} ${pgKeyCol}=${key}):`,
        error.message
      );
    }
  }
}

/**
 * Replace all rows matching a scope in Sheets and (if dual-write
 * is on) in Postgres. Used for "replace all contacts for an
 * account" (PR B) and similar replace-list flows.
 *
 * Sheets path: find matching rows by positional key match, delete
 * bottom-up (avoids index shift), then bulk-append the new set.
 *
 * Postgres path: DELETE WHERE scope = value (or IS NULL), then
 * bulk INSERT new rows.
 *
 * scopeValue == null means "scope cell is empty in Sheets / IS
 * NULL in Postgres" (supports the per-account future where some
 * rows have NULL scope = global pool).
 *
 * Caller provides two row builders: one for Sheets (returns
 * positional array) and one for PG (returns object). This keeps
 * the primitive table-shape-agnostic.
 */
export async function replaceScope({
  spreadsheetId,
  tabName,
  sheetsScopeColIdx,
  scopeValue,
  sheetsRowBuilder,
  pgTable,
  pgScopeCol,
  pgRowBuilder,
  items,
}) {
  // Sheets: find matching rows, delete bottom-up, then bulk append
  const { rows } = await readSheetSA(spreadsheetId, tabName);
  const matchingRowIdxs = [];
  rows.forEach((r, i) => {
    const cellValue = String(r[sheetsScopeColIdx] || "").trim();
    const matches =
      scopeValue == null
        ? cellValue === ""
        : cellValue === String(scopeValue).trim();
    if (matches) matchingRowIdxs.push(i + 1); // +1 to convert data-row idx to row position (header at 0)
  });

  if (matchingRowIdxs.length > 0) {
    const tabId = await getSheetIdSA(spreadsheetId, tabName);
    if (tabId == null) {
      throw new Error(
        `[dataStore.replaceScope] could not resolve sheet gid for ${tabName}`
      );
    }
    // Bottom-up delete order to avoid row-index shift on the API side
    const sorted = [...matchingRowIdxs].sort((a, b) => b - a);
    for (const rowPos of sorted) {
      await deleteRowSA(spreadsheetId, tabId, rowPos);
    }
  }

  if (items.length > 0) {
    const newRows = items.map(sheetsRowBuilder);
    await appendRowsSA(spreadsheetId, tabName, newRows);
  }

  if (isDualWrite(tabName)) {
    const supabase = getServiceClient();
    let deleteQuery = supabase.from(pgTable).delete();
    deleteQuery =
      scopeValue == null
        ? deleteQuery.is(pgScopeCol, null)
        : deleteQuery.eq(pgScopeCol, scopeValue);
    const { error: delErr } = await deleteQuery;
    if (delErr) {
      console.error(
        `[dataStore.replaceScope] PG delete failed (${pgTable} scope=${scopeValue}):`,
        delErr.message
      );
      return;
    }
    if (items.length > 0) {
      const pgRows = items.map(pgRowBuilder);
      const { error: insErr } = await supabase.from(pgTable).insert(pgRows);
      if (insErr) {
        console.error(
          `[dataStore.replaceScope] PG insert failed (${pgTable}):`,
          insErr.message
        );
      }
    }
  }
}
