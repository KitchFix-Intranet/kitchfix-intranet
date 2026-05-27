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
//   news_interactions:
//     getNewsInteractions({ userEmail })   - read records for a user
//     upsertNewsInteraction({ postId, userEmail }, partial)
//                                            - upsert with partial update
//   directory module (Stage 1 module 2, PR A + PR B - DORMANT):
//     getAccounts({ module })              - read all accounts
//     upsertAccount(teamKey, partial)      - upsert with partial update
//     getContacts({ module })              - read all contacts
//     replaceContactsForAccount(teamKey, contacts)
//                                          - replace-all-for-account with
//                                            col-G preservation (PR B)
//     getWorkLocations({ module })         - read all work_locations
//     upsertWorkLocation(teamKey, partial) - upsert by team_key
//     deleteWorkLocation(teamKey)          - delete by team_key
//     getHeroImages({ module })            - read flat global hero list
//     replaceHeroImages(urls)              - replace the global hero pool
//
//   Per-module read dispatch (PR B): readers can pass { module: "directory" }
//   to opt into per-module READ_FROM_POSTGRES_<MODULE> overrides. The dispatch
//   OR-composes per-module + global READ_FROM_POSTGRES flags. With both flag
//   sets empty (default), behavior is identical to today.
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

import {
  readSheetSA,
  appendRowSA,
  appendRowsSA,
  updateCellSA,
  updateRangeSA,
  batchUpdateRangesSA,
  clearRangeSA,
  deleteRowSA,
  getSheetIdSA,
  SHEET_IDS,
} from "@/lib/sheets";
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


// ═══════════════════════════════════════════════════════════════
// DIRECTORY MODULE - accounts + hero_images (Stage 1 module 2 PR A)
// ═══════════════════════════════════════════════════════════════
//
// DORMANT INFRASTRUCTURE: this section adds dataStore adapters
// and shared primitives for the directory module. The directory
// handler (src/app/api/directory/route.js) is NOT rewired in this
// PR; that happens in PR B. With cutover flags OFF (the default
// state on merge), nothing in this section is called and the
// directory module behaves byte-identical to today.
//
// Tabs covered in PR A:
//   accounts       - getAccounts + upsertAccount
//   hero_images    - getHeroImages + replaceHeroImages
//
// Tabs deferred to PR B:
//   contacts       - get / upsert / replaceContactsForAccount
//   work_locations - get / upsert / deleteWorkLocation
//
// Three new primitives (foundation - some unused until PR B):
//   coordinatedWrite   - multi-table Sheets-first PG-best-effort
//   deleteRecord       - Sheets row delete + optional PG DELETE
//   replaceScope       - replace-list flow (clear + bulk insert)
//
// PG schema source: docs/SHEETS_AUDIT_SYNTHESIS.md LIVE verdicts.
// Build rule: only LIVE columns migrate. DEAD cols (accounts
// N/O/P/Q) and REFERENCE cols (contacts H/I/J) are absent from
// the dataStore's canonical shapes.

const ACCOUNTS_TAB    = "accounts";
const DIR_LINKS_TAB   = "dir_links";
const HERO_IMAGES_TAB = "hero_images";


// ───────────────────────────────────────────────────────────────
// Accounts schema mapping
// ───────────────────────────────────────────────────────────────
// Sheet cols A-T -> canonical camelCase field names.
// Cols N/O/P/Q (wifi_ssid, wifi_pass, gate_code, door_code) DROPPED
// per audit DEAD verdict (0/12 filled in Sheet, never read by code).
// Col T (region) is READ but NEVER WRITTEN by this dataStore. The
// latent-blanking-risk fix from the directory design: region is
// populated externally (Apps Script / manual), and the upsert path
// only writes fields explicitly in the partial. region is excluded
// from the writeable set entirely.
// dir_links B-E (URL fields) are read from the dir_links tab and
// joined on the Sheets path; on the PG path they are columns on
// accounts (folded per the schema design).

const ACCOUNTS_SHEET_COL = {
  // canonical field -> Sheet col letter (writeable fields only)
  name:              "B",
  level:             "C",
  city:              "D",
  state:             "E",
  season:            "F",
  stadium:           "G",
  stadiumHeaderUrl:  "H",
  logoUrl:           "I",
  address:           "J",
  lat:               "K",
  longitude:         "L",
  timezone:          "M",
  // N (wifi_ssid), O (wifi_pass), P (gate_code), Q (door_code) DROPPED
  gmapUrl:           "R",
  active:            "S",
  // T (region) intentionally absent - never written by upsertAccount
};

// Sheet row positional indices for the READ side (0-indexed).
// SKIPS the dead cols 13-16 (wifi/gate/door).
const ACCOUNTS_IDX = {
  teamKey: 0, name: 1, level: 2, city: 3, state: 4, season: 5,
  stadium: 6, stadiumHeaderUrl: 7, logoUrl: 8, address: 9,
  lat: 10, longitude: 11, timezone: 12,
  // 13-16 (wifi/gate/door) intentionally absent
  gmapUrl: 17, active: 18, region: 19,
};

// dir_links Sheet positional indices.
const DIR_LINKS_IDX = {
  teamKey: 0, homestandUrl: 1, slaUrl: 2,
  serviceCalendarsUrl: 3, driveUrl: 4,
};

// Set of canonical fields that map to columns on dir_links rather
// than accounts (in the Sheets layout). On PG these all live on
// accounts as folded-in columns.
const DIR_LINKS_FIELDS = new Set([
  "homestandUrl", "slaUrl", "serviceCalendarsUrl", "driveUrl",
]);


// ── Type coercion: accounts.active (Sheet TRUE/FALSE strings) ──
// The current bootstrap treats blank as TRUE (only "FALSE" is
// falsy). Preserved here for byte-identical read behavior.

function sheetActiveToBool(s) {
  return String(s || "").trim().toUpperCase() !== "FALSE";
}
function boolToSheetActive(b) {
  return b ? "TRUE" : "FALSE";
}


// ═══════════════════════════════════════════════════════════════
// SHARED PRIMITIVES (foundation for directory + future modules)
// ═══════════════════════════════════════════════════════════════
//
// These primitives are internal to dataStore.js. They are not
// exported; callers compose with the per-table adapter functions
// (getAccounts, upsertAccount, replaceHeroImages, etc.).

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
async function coordinatedWrite(operations) {
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
async function deleteRecord({
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
async function replaceScope({
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


// ═══════════════════════════════════════════════════════════════
// ACCOUNTS adapters
// ═══════════════════════════════════════════════════════════════
//
// Canonical record shape (what handlers consume; same for both
// Sheets and PG read paths):
//   {
//     teamKey, name, level, city, state, season, stadium,
//     stadiumHeaderUrl, logoUrl, address, lat, longitude, timezone,
//     gmapUrl, active (boolean), region,
//     homestandUrl, slaUrl, serviceCalendarsUrl, driveUrl,
//   }
//
// Notes:
//   * active is a boolean in the canonical shape (TRUE/FALSE strings
//     are coerced at the Sheets boundary; PG stores as BOOLEAN).
//   * region is READ but NOT WRITTEN by upsertAccount. To change
//     region, the caller must update the Sheet directly (today) or
//     write a separate updateRegion primitive (future).
//   * lat / longitude are TEXT throughout (mirrors Sheet storage;
//     dataStore is identity-coercion for these).

// ── Sheets adapter ──

// Exported for direct Sheets-source reads (e.g. backfill scripts) that
// must bypass the dispatch wrappers (which route to PG when flags are
// set). Direct callers should not be used in the runtime handler path.
export async function readAccountsSheets() {
  const [accountsRes, dirLinksRes] = await Promise.all([
    readSheetSA(SHEET_IDS.HUB, ACCOUNTS_TAB),
    readSheetSA(SHEET_IDS.HUB, DIR_LINKS_TAB),
  ]);

  // Build dir_links lookup by team_key for the join
  const dirLinksByKey = new Map();
  for (const r of dirLinksRes.rows) {
    const key = String(r[DIR_LINKS_IDX.teamKey] || "").trim();
    if (!key) continue;
    dirLinksByKey.set(key, {
      homestandUrl:        String(r[DIR_LINKS_IDX.homestandUrl]        || "").trim(),
      slaUrl:              String(r[DIR_LINKS_IDX.slaUrl]              || "").trim(),
      serviceCalendarsUrl: String(r[DIR_LINKS_IDX.serviceCalendarsUrl] || "").trim(),
      driveUrl:            String(r[DIR_LINKS_IDX.driveUrl]            || "").trim(),
    });
  }

  return accountsRes.rows
    .filter((r) => String(r[ACCOUNTS_IDX.teamKey] || "").trim())
    .map((r) => {
      const teamKey = String(r[ACCOUNTS_IDX.teamKey] || "").trim();
      // _hasDirLinksRow tracks whether a row existed in the dir_links
      // tab for this team_key. Used by the directory handler to
      // preserve pre-PR-B byte-identity of the bootstrap links map:
      // emit the 4-keys object when a dir_links row exists (even if
      // all URLs are blank), else emit {}. PG path always sets to
      // true since the folded model has no "no row" concept.
      const linksData = dirLinksByKey.get(teamKey);
      const _hasDirLinksRow = linksData !== undefined;
      const links = linksData || {};
      return {
        teamKey,
        name:             String(r[ACCOUNTS_IDX.name]             || "").trim(),
        level:            String(r[ACCOUNTS_IDX.level]            || "").trim(),
        city:             String(r[ACCOUNTS_IDX.city]             || "").trim(),
        state:            String(r[ACCOUNTS_IDX.state]            || "").trim(),
        season:           String(r[ACCOUNTS_IDX.season]           || "").trim(),
        stadium:          String(r[ACCOUNTS_IDX.stadium]          || "").trim(),
        stadiumHeaderUrl: String(r[ACCOUNTS_IDX.stadiumHeaderUrl] || "").trim(),
        logoUrl:          String(r[ACCOUNTS_IDX.logoUrl]          || "").trim(),
        address:          String(r[ACCOUNTS_IDX.address]          || "").trim(),
        lat:              String(r[ACCOUNTS_IDX.lat]              || "").trim(),
        longitude:        String(r[ACCOUNTS_IDX.longitude]        || "").trim(),
        timezone:         String(r[ACCOUNTS_IDX.timezone]         || "").trim(),
        gmapUrl:          String(r[ACCOUNTS_IDX.gmapUrl]          || "").trim(),
        active:           sheetActiveToBool(r[ACCOUNTS_IDX.active]),
        region:           String(r[ACCOUNTS_IDX.region]           || "").trim(),
        homestandUrl:        links.homestandUrl        || "",
        slaUrl:              links.slaUrl              || "",
        serviceCalendarsUrl: links.serviceCalendarsUrl || "",
        driveUrl:            links.driveUrl            || "",
        _hasDirLinksRow,
      };
    });
}

async function upsertAccountSheets(teamKey, partial) {
  const { rows: accountRows } = await readSheetSA(SHEET_IDS.HUB, ACCOUNTS_TAB);
  const rowIdx = accountRows.findIndex(
    (r) => String(r[ACCOUNTS_IDX.teamKey] || "").trim() === teamKey
  );

  if (rowIdx >= 0) {
    // Existing row: collect per-field updates and fire ONE
    // batchUpdateRangesSA call. ONLY provided fields are written.
    // Cols N/O/P/Q (dead) and col T (region) are never touched -
    // that is the latent-blanking-risk fix.
    // Batch vs Promise.all: 18 fields = 18 writes/save on parallel;
    // batchUpdateRangesSA collapses to 1 API call, avoiding the
    // Sheets per-user 60-write/min rate limit and aligning with the
    // coordinatedWrite design (sequential, single-doc-safe).
    const sheetRow = rowIdx + 2; // +1 header + 1-indexed
    const updates = [];

    const queueField = (field, value) => {
      const col = ACCOUNTS_SHEET_COL[field];
      if (!col) return;
      updates.push({
        range: `${ACCOUNTS_TAB}!${col}${sheetRow}`,
        values: [[value]],
      });
    };

    if ("name" in partial)             queueField("name",             partial.name || "");
    if ("level" in partial)            queueField("level",            partial.level || "");
    if ("city" in partial)             queueField("city",             partial.city || "");
    if ("state" in partial)            queueField("state",            partial.state || "");
    if ("season" in partial)           queueField("season",           partial.season || "");
    if ("stadium" in partial)          queueField("stadium",          partial.stadium || "");
    if ("stadiumHeaderUrl" in partial) queueField("stadiumHeaderUrl", partial.stadiumHeaderUrl || "");
    if ("logoUrl" in partial)          queueField("logoUrl",          partial.logoUrl || "");
    if ("address" in partial)          queueField("address",          partial.address || "");
    if ("lat" in partial)              queueField("lat",              partial.lat || "");
    if ("longitude" in partial)        queueField("longitude",        partial.longitude || "");
    if ("timezone" in partial)         queueField("timezone",         partial.timezone || "");
    if ("gmapUrl" in partial)          queueField("gmapUrl",          partial.gmapUrl || "");
    if ("active" in partial)           queueField("active",           boolToSheetActive(partial.active));
    // region intentionally NOT queued

    if (updates.length > 0) {
      await batchUpdateRangesSA(SHEET_IDS.HUB, updates);
    }
  } else {
    // New account: append a row covering A-R (18 cells) for parity
    // with the current handler's admin-add-account append. Col S
    // (active) is left blank; the dataStore's sheetActiveToBool
    // coercion reads blank as TRUE, matching today's behavior.
    // Cols N/O/P/Q (dead) appear as blank padding to preserve
    // column alignment in the Sheet. Col T (region) is also blank
    // (set externally by Apps Script / manual entry after creation).
    const newRow = [
      teamKey,                                                   // A
      partial.name             || "",                            // B
      partial.level            || "",                            // C
      partial.city             || "",                            // D
      partial.state            || "",                            // E
      partial.season           || "",                            // F
      partial.stadium          || "",                            // G
      partial.stadiumHeaderUrl || "",                            // H
      partial.logoUrl          || "",                            // I
      partial.address          || "",                            // J
      partial.lat              || "",                            // K
      partial.longitude        || "",                            // L
      partial.timezone         || "",                            // M
      "", "", "", "",                                            // N-Q dead padding
      partial.gmapUrl          || "",                            // R
    ];
    await appendRowSA(SHEET_IDS.HUB, ACCOUNTS_TAB, newRow);
  }

  // dir_links upsert (separate tab on the Sheets path)
  const hasDirLinks =
    "homestandUrl"        in partial ||
    "slaUrl"              in partial ||
    "serviceCalendarsUrl" in partial ||
    "driveUrl"            in partial;
  if (hasDirLinks) {
    await upsertDirLinksSheets(teamKey, partial);
  }
}

// Helper: upsert dir_links row for a team (Sheets path only; on PG
// path these fields are columns on accounts and are written in
// upsertAccountPostgres directly).
async function upsertDirLinksSheets(teamKey, partial) {
  const { rows } = await readSheetSA(SHEET_IDS.HUB, DIR_LINKS_TAB);
  const idx = rows.findIndex(
    (r) => String(r[DIR_LINKS_IDX.teamKey] || "").trim() === teamKey
  );

  if (idx >= 0) {
    // Existing dir_links row: batch up to 4 cell updates into one
    // API call (same rationale as upsertAccountSheets).
    const sheetRow = idx + 2;
    const updates = [];
    if ("homestandUrl" in partial)
      updates.push({ range: `${DIR_LINKS_TAB}!B${sheetRow}`, values: [[partial.homestandUrl || ""]] });
    if ("slaUrl" in partial)
      updates.push({ range: `${DIR_LINKS_TAB}!C${sheetRow}`, values: [[partial.slaUrl || ""]] });
    if ("serviceCalendarsUrl" in partial)
      updates.push({ range: `${DIR_LINKS_TAB}!D${sheetRow}`, values: [[partial.serviceCalendarsUrl || ""]] });
    if ("driveUrl" in partial)
      updates.push({ range: `${DIR_LINKS_TAB}!E${sheetRow}`, values: [[partial.driveUrl || ""]] });
    if (updates.length > 0) {
      await batchUpdateRangesSA(SHEET_IDS.HUB, updates);
    }
  } else {
    const newRow = [
      teamKey,
      partial.homestandUrl        || "",
      partial.slaUrl              || "",
      partial.serviceCalendarsUrl || "",
      partial.driveUrl            || "",
    ];
    await appendRowSA(SHEET_IDS.HUB, DIR_LINKS_TAB, newRow);
  }
}

// ── Postgres adapter ──

async function readAccountsPostgres() {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("accounts")
    .select(
      "team_key, name, level, city, state, season, stadium_name, " +
      "stadium_header_url, logo_url, address, lat, longitude, timezone, " +
      "gmap_url, active, region, " +
      "homestand_url, sla_url, service_calendars_url, drive_url"
    );
  if (error) {
    throw new Error(`[dataStore.pg] getAccounts: ${error.message}`);
  }
  return (data || []).map((row) => ({
    teamKey:             row.team_key,
    name:                row.name              || "",
    level:               row.level             || "",
    city:                row.city              || "",
    state:               row.state             || "",
    season:              row.season            || "",
    stadium:             row.stadium_name      || "",
    stadiumHeaderUrl:    row.stadium_header_url|| "",
    logoUrl:             row.logo_url          || "",
    address:             row.address           || "",
    lat:                 row.lat               || "",
    longitude:           row.longitude         || "",
    timezone:            row.timezone          || "",
    gmapUrl:             row.gmap_url          || "",
    active:              !!row.active,
    region:              row.region            || "",
    homestandUrl:        row.homestand_url        || "",
    slaUrl:              row.sla_url              || "",
    serviceCalendarsUrl: row.service_calendars_url|| "",
    driveUrl:            row.drive_url            || "",
    // PG path: the folded schema has no "no row" concept for dir_links.
    // Always true so the handler emits the 4-keys links map on PG reads
    // (matches Sheets-path behavior for accounts that have a dir_links
    // row; minor divergence for accounts that had NO dir_links row in
    // Sheets - those would emit {} on Sheets path but the 4-keys map
    // on PG path. Acceptable per Stage 1 design.)
    _hasDirLinksRow: true,
  }));
}

async function upsertAccountPostgres(teamKey, partial) {
  const supabase = getServiceClient();
  const payload = { team_key: teamKey };

  if ("name" in partial)                payload.name                  = partial.name || "";
  if ("level" in partial)               payload.level                 = partial.level || "";
  if ("city" in partial)                payload.city                  = partial.city || "";
  if ("state" in partial)               payload.state                 = partial.state || "";
  if ("season" in partial)              payload.season                = partial.season || "";
  if ("stadium" in partial)             payload.stadium_name          = partial.stadium || "";
  if ("stadiumHeaderUrl" in partial)    payload.stadium_header_url    = partial.stadiumHeaderUrl || "";
  if ("logoUrl" in partial)             payload.logo_url              = partial.logoUrl || "";
  if ("address" in partial)             payload.address               = partial.address || "";
  if ("lat" in partial)                 payload.lat                   = partial.lat || "";
  if ("longitude" in partial)           payload.longitude             = partial.longitude || "";
  if ("timezone" in partial)            payload.timezone              = partial.timezone || "";
  if ("gmapUrl" in partial)             payload.gmap_url              = partial.gmapUrl || "";
  if ("active" in partial)              payload.active                = !!partial.active;
  // region intentionally NOT in payload (latent blanking fix; matches Sheets behavior)
  if ("homestandUrl" in partial)        payload.homestand_url         = partial.homestandUrl || "";
  if ("slaUrl" in partial)              payload.sla_url               = partial.slaUrl || "";
  if ("serviceCalendarsUrl" in partial) payload.service_calendars_url = partial.serviceCalendarsUrl || "";
  if ("driveUrl" in partial)            payload.drive_url             = partial.driveUrl || "";

  payload.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("accounts")
    .upsert(payload, { onConflict: "team_key", ignoreDuplicates: false });
  if (error) {
    throw new Error(`[dataStore.pg] upsertAccount: ${error.message}`);
  }
}

// ── Public API: dispatched by cutover flags ──

/**
 * Read all accounts as an array of canonical records.
 *
 * Optional opts:
 *   module: caller module name (e.g. "directory"). Enables the
 *   READ_FROM_POSTGRES_<MODULE> per-module override. Without it,
 *   only the global READ_FROM_POSTGRES flag is consulted.
 *
 * With both flags off (default): reads from Sheets (accounts tab +
 * dir_links tab, joined by team_key). With either flag on for
 * this (caller, tab) pair: reads from Postgres (folded shape).
 * Either path returns the same canonical record shape.
 */
export async function getAccounts(opts = {}) {
  if (isReadFromPostgres(ACCOUNTS_TAB, opts.module)) {
    return readAccountsPostgres();
  }
  return readAccountsSheets();
}

/**
 * Upsert an account by team_key with a partial update.
 *
 *   teamKey: the natural PK (e.g. "CIN - OH")
 *   partial: any subset of the writeable canonical fields:
 *     name, level, city, state, season, stadium, stadiumHeaderUrl,
 *     logoUrl, address, lat, longitude, timezone, gmapUrl, active,
 *     homestandUrl, slaUrl, serviceCalendarsUrl, driveUrl
 *
 * NOT WRITEABLE here: region (latent-blanking-risk fix; region is
 * populated externally).
 *
 * Always writes to Sheets (the rollback target). With DUAL_WRITE_TABLES
 * on for accounts: ALSO writes to Postgres.
 */
export async function upsertAccount(teamKey, partial) {
  await upsertAccountSheets(teamKey, partial);
  if (isDualWrite(ACCOUNTS_TAB)) {
    await upsertAccountPostgres(teamKey, partial);
  }
}


// ═══════════════════════════════════════════════════════════════
// HERO_IMAGES adapters
// ═══════════════════════════════════════════════════════════════
//
// Canonical record shape: { url, teamKey, ordinal }
// In this build, teamKey is ALWAYS NULL on write (dormant per-
// account infrastructure - see PG schema notes in DDL).
//
// Sheets shape: flat single column (col A holds URLs).
// PG shape: rows with (id UUID, team_key NULL today, url, ordinal).

// ── Sheets adapter ──

// Exported for direct Sheets-source reads (backfill scripts).
export async function readHeroImagesSheets() {
  const { rows } = await readSheetSA(SHEET_IDS.HUB, HERO_IMAGES_TAB);
  return rows
    .map((r) => String(r[0] || "").trim())
    .filter(Boolean)
    .map((url) => ({ url, teamKey: null, ordinal: null }));
}

async function replaceHeroImagesSheets(urls) {
  await clearRangeSA(SHEET_IDS.HUB, `${HERO_IMAGES_TAB}!A:A`);
  if (urls.length > 0) {
    await updateRangeSA(
      SHEET_IDS.HUB,
      `${HERO_IMAGES_TAB}!A1`,
      urls.map((u) => [u])
    );
  }
}

// ── Postgres adapter ──

async function readHeroImagesPostgres() {
  // PR A: read only the global pool (team_key IS NULL). Per-account
  // is dormant infrastructure; future PR adds account-scoped reads.
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("hero_images")
    .select("url, team_key, ordinal")
    .is("team_key", null);
  if (error) {
    throw new Error(`[dataStore.pg] getHeroImages: ${error.message}`);
  }
  return (data || []).map((row) => ({
    url:     row.url,
    teamKey: row.team_key,
    ordinal: row.ordinal,
  }));
}

async function replaceHeroImagesPostgres(urls) {
  const supabase = getServiceClient();
  // Delete the global pool (team_key IS NULL); per-account rows
  // are not touched (none exist today; future PR may add some).
  const { error: delErr } = await supabase
    .from("hero_images")
    .delete()
    .is("team_key", null);
  if (delErr) {
    console.error(
      `[dataStore.pg] replaceHeroImages: PG delete failed:`,
      delErr.message
    );
    return;
  }
  if (urls.length > 0) {
    // team_key always NULL in this build (dormant per-account infra)
    const rows = urls.map((url) => ({ url, team_key: null, ordinal: null }));
    const { error: insErr } = await supabase.from("hero_images").insert(rows);
    if (insErr) {
      console.error(
        `[dataStore.pg] replaceHeroImages: PG insert failed:`,
        insErr.message
      );
    }
  }
}

// ── Public API: dispatched by cutover flags ──

/**
 * Read all hero images. Returns array of { url, teamKey, ordinal }.
 *
 * In this build, all returned rows have teamKey = null (global pool).
 * Per-account rows are dormant infrastructure for a future feature.
 *
 * Optional opts.module enables per-module READ flag dispatch.
 * With both flags off (default): reads from Sheets.
 * With either flag on: reads from Postgres (filtered to team_key IS NULL).
 */
export async function getHeroImages(opts = {}) {
  if (isReadFromPostgres(HERO_IMAGES_TAB, opts.module)) {
    return readHeroImagesPostgres();
  }
  return readHeroImagesSheets();
}

/**
 * Replace the global hero pool with a new list of URLs.
 *
 *   urls: array of URL strings (may be empty)
 *
 * Sheets: clear col A then write the new list down from A1.
 * Postgres (if dual-write on): DELETE WHERE team_key IS NULL,
 * then INSERT new rows with team_key = NULL.
 *
 * Per-account hero rows (future) are NOT touched by this function.
 */
export async function replaceHeroImages(urls) {
  await replaceHeroImagesSheets(urls);
  if (isDualWrite(HERO_IMAGES_TAB)) {
    await replaceHeroImagesPostgres(urls);
  }
}


// ═══════════════════════════════════════════════════════════════
// CONTACTS adapters (PR B)
// ═══════════════════════════════════════════════════════════════
//
// Canonical record shape:
//   { id?, teamKey, role, name, email, phone, slackHandle, slackUserId }
// (id is the synthetic UUID present only on the PG path; the Sheets
// path returns records without id.)
//
// Schema (per docs/SHEETS_AUDIT_SYNTHESIS.md):
//   * Sheet cols A-G migrate (team_key, role, name, email, phone,
//     slack_handle, slack_user_id).
//   * Sheet cols H/I/J (Kiosk Emails, Manager, Region) are REFERENCE
//     per audit verdict - Kevin's manual notes, NOT app-driven,
//     stays in the Sheet. The dataStore does NOT touch them.
//
// COL-G PRESERVATION (the bug fix):
//   The pre-PR-B handler called appendRowsSA with 6-element rows
//   `[teamKey, role, name, email, phone, slack_handle]` and the
//   admin-update-contacts payload never included slack_user_id.
//   Result: every contacts edit blanked col G silently, breaking
//   the Slack deep-link button for affected rows.
//
//   replaceContactsForAccount fixes this at the dataStore boundary:
//   it reads the existing rows for the account, builds an
//   email -> slack_user_id lookup, and carries the existing value
//   forward into each new row that lacks one. Matching key is
//   email (normalized: lowercased + trimmed). If an email changed
//   in the same edit, the lookup misses and slack_user_id is
//   absent for that row - same outcome as today, no worse.
//
// Cols H/I/J PRESERVATION (the latent-blanking-risk equivalent):
//   On the Sheets path, contacts rows have 10 cells in the live
//   Sheet (A-J). The replace-all flow uses replaceScope which
//   deletes rows by team_key then bulk-appends new ones. The new
//   rows are 7 cells (A-G) - which would blank H/I/J the same way
//   the col-G bug blanked G. To preserve Kevin's reference notes,
//   replaceContactsForAccountSheets builds H/I/J carry-forward
//   the same way as G: email -> {h, i, j} lookup against existing
//   rows, splice into the new appended rows.

const CONTACTS_TAB = "contacts";

// Sheet positional indices for contacts (0-indexed).
const CONTACTS_IDX = {
  teamKey: 0, role: 1, name: 2, email: 3, phone: 4,
  slackHandle: 5, slackUserId: 6,
  // 7 (kiosk_emails), 8 (manager), 9 (region) - REFERENCE per audit;
  // read on Sheets path for carry-forward only; never canonicalized.
  kioskEmails: 7, manager: 8, region: 9,
};

function normalizeEmailForKey(e) {
  return String(e || "").toLowerCase().trim();
}


// ── Sheets adapter ──

// Exported for direct Sheets-source reads (backfill scripts).
export async function readContactsSheets() {
  const { rows } = await readSheetSA(SHEET_IDS.HUB, CONTACTS_TAB);
  return rows
    .filter((r) => String(r[CONTACTS_IDX.teamKey] || "").trim())
    .map((r) => ({
      teamKey:      String(r[CONTACTS_IDX.teamKey]      || "").trim(),
      role:         String(r[CONTACTS_IDX.role]         || "").trim(),
      name:         String(r[CONTACTS_IDX.name]         || "").trim(),
      email:        String(r[CONTACTS_IDX.email]        || "").trim(),
      phone:        String(r[CONTACTS_IDX.phone]        || "").trim(),
      slackHandle:  String(r[CONTACTS_IDX.slackHandle]  || "").trim(),
      slackUserId:  String(r[CONTACTS_IDX.slackUserId]  || "").trim(),
    }));
}

async function replaceContactsForAccountSheets(teamKey, newContacts) {
  // Step 1: read all current contacts rows. We need:
  //   (a) the row positions to delete (matching team_key)
  //   (b) the col G + cols H/I/J values to carry forward per email
  const { rows } = await readSheetSA(SHEET_IDS.HUB, CONTACTS_TAB);

  // Build carry-forward lookup by normalized email for THIS account only
  // (so we do not accidentally inherit a slack_user_id from a different
  // account that happens to share an email; per audit, all rows have
  // team_key + email populated, no NULLs)
  const carryByEmail = new Map();
  rows.forEach((r) => {
    const rowKey = String(r[CONTACTS_IDX.teamKey] || "").trim();
    if (rowKey !== teamKey) return;
    const email = normalizeEmailForKey(r[CONTACTS_IDX.email]);
    if (!email) return;
    carryByEmail.set(email, {
      slackUserId: String(r[CONTACTS_IDX.slackUserId] || ""),
      kioskEmails: String(r[CONTACTS_IDX.kioskEmails] || ""),
      manager:     String(r[CONTACTS_IDX.manager]     || ""),
      region:      String(r[CONTACTS_IDX.region]      || ""),
    });
  });

  // Step 2: find row positions to delete (matching team_key), bottom-up
  const toDelete = rows
    .map((r, i) =>
      String(r[CONTACTS_IDX.teamKey] || "").trim() === teamKey ? i + 1 : null
    )
    .filter((x) => x !== null);

  if (toDelete.length > 0) {
    const tabId = await getSheetIdSA(SHEET_IDS.HUB, CONTACTS_TAB);
    if (tabId == null) {
      throw new Error(
        `[dataStore.replaceContactsForAccount] could not resolve sheet gid for ${CONTACTS_TAB}`
      );
    }
    const sorted = [...toDelete].sort((a, b) => b - a);
    for (const rowPos of sorted) {
      await deleteRowSA(SHEET_IDS.HUB, tabId, rowPos);
    }
  }

  // Step 3: bulk-append new rows with col-G + H/I/J carry-forward by email
  if (newContacts.length > 0) {
    const rowsToAppend = newContacts.map((c) => {
      const email = normalizeEmailForKey(c.email);
      const carried = carryByEmail.get(email) || {};
      // Explicit slackUserId in the payload would win, but the current
      // admin-update-contacts payload never includes it. Defensive guard
      // in case a future caller passes it explicitly.
      const slackUserId =
        "slackUserId" in c
          ? String(c.slackUserId || "")
          : carried.slackUserId || "";
      // Build a 10-cell row: A-G app-managed, H-J carried-forward from
      // existing row (or blank if new contact). This preserves Kevin's
      // reference notes for existing contacts AND avoids blank-padding
      // existing data on edit.
      return [
        teamKey,                                       // A
        String(c.role  || ""),                         // B
        String(c.name  || ""),                         // C
        String(c.email || ""),                         // D
        String(c.phone || ""),                         // E
        String(c.slackHandle ?? c.slack ?? ""),        // F (handler today calls it .slack)
        slackUserId,                                   // G
        carried.kioskEmails || "",                     // H (REFERENCE preserve)
        carried.manager     || "",                     // I (REFERENCE preserve)
        carried.region      || "",                     // J (REFERENCE preserve)
      ];
    });
    await appendRowsSA(SHEET_IDS.HUB, CONTACTS_TAB, rowsToAppend);
  }
}


// ── Postgres adapter ──

async function readContactsPostgres() {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("contacts")
    .select(
      "id, team_key, role, name, email, phone, slack_handle, slack_user_id"
    );
  if (error) {
    throw new Error(`[dataStore.pg] getContacts: ${error.message}`);
  }
  return (data || []).map((row) => ({
    id:           row.id,
    teamKey:      row.team_key,
    role:         row.role         || "",
    name:         row.name         || "",
    email:        row.email        || "",
    phone:        row.phone        || "",
    slackHandle:  row.slack_handle || "",
    slackUserId:  row.slack_user_id|| "",
  }));
}

async function replaceContactsForAccountPostgres(teamKey, newContacts) {
  const supabase = getServiceClient();

  // Step 1: read existing rows for col-G preservation (PG side)
  const { data: existingRows, error: readErr } = await supabase
    .from("contacts")
    .select("email, slack_user_id")
    .eq("team_key", teamKey);
  if (readErr) {
    console.error(
      `[dataStore.pg] replaceContactsForAccount read failed (${teamKey}):`,
      readErr.message
    );
    return;
  }
  const carryByEmail = new Map();
  for (const r of existingRows || []) {
    const email = normalizeEmailForKey(r.email);
    if (email) carryByEmail.set(email, r.slack_user_id || "");
  }

  // Step 2: delete all rows for this team_key
  const { error: delErr } = await supabase
    .from("contacts")
    .delete()
    .eq("team_key", teamKey);
  if (delErr) {
    console.error(
      `[dataStore.pg] replaceContactsForAccount delete failed (${teamKey}):`,
      delErr.message
    );
    return;
  }

  // Step 3: insert new rows with col-G carried forward by email
  if (newContacts.length > 0) {
    const pgRows = newContacts.map((c) => {
      const email = normalizeEmailForKey(c.email);
      const explicitSlackUserId =
        "slackUserId" in c ? String(c.slackUserId || "") : null;
      const slack_user_id =
        explicitSlackUserId !== null
          ? explicitSlackUserId
          : carryByEmail.get(email) || "";
      return {
        team_key:       teamKey,
        role:           String(c.role  || ""),
        name:           String(c.name  || ""),
        email:          String(c.email || ""),
        phone:          String(c.phone || ""),
        slack_handle:   String(c.slackHandle ?? c.slack ?? ""),
        slack_user_id,
      };
    });
    const { error: insErr } = await supabase.from("contacts").insert(pgRows);
    if (insErr) {
      console.error(
        `[dataStore.pg] replaceContactsForAccount insert failed (${teamKey}):`,
        insErr.message
      );
    }
  }
}


// ── Public API: dispatched by cutover flags ──

/**
 * Read all contacts (across all accounts) as an array of canonical
 * records. The handler typically groups these by teamKey to build a
 * per-account contactMap for the bootstrap response.
 *
 * Optional opts.module enables per-module READ flag dispatch.
 */
export async function getContacts(opts = {}) {
  if (isReadFromPostgres(CONTACTS_TAB, opts.module)) {
    return readContactsPostgres();
  }
  return readContactsSheets();
}

/**
 * Replace ALL contacts for an account with a new list (replace-all
 * semantics; matches the current admin-update-contacts flow).
 *
 *   teamKey: the account's natural key (e.g. "CIN - OH")
 *   newContacts: array of { role, name, email, phone, slack OR
 *     slackHandle, slackUserId? }
 *
 * Sheets path: delete-then-bulk-append, with cols G + H/I/J carried
 * forward by email match against the existing rows for this account.
 *
 * Postgres path (if dual-write on): DELETE WHERE team_key = ?, then
 * INSERT with col-G carry-forward.
 *
 * If a new contact has explicit slackUserId in the payload, that
 * wins. Otherwise carry from the existing row by email.
 */
export async function replaceContactsForAccount(teamKey, newContacts) {
  await replaceContactsForAccountSheets(teamKey, newContacts);
  if (isDualWrite(CONTACTS_TAB)) {
    await replaceContactsForAccountPostgres(teamKey, newContacts);
  }
}


// ═══════════════════════════════════════════════════════════════
// WORK_LOCATIONS adapters (PR B)
// ═══════════════════════════════════════════════════════════════
//
// Canonical record shape:
//   { teamKey, locationName, teamName }
//
// Schema (per docs/SHEETS_AUDIT_SYNTHESIS.md): 3 cols, team_key
// is the natural PK (col B in the Sheet, NOT col A; col A is the
// computed location_name display string). work_locations is touched
// ONLY by directory in src/ - kept as a real PG table pending
// confirmation that no external consumer depends on it.

const WORK_LOCATIONS_TAB = "work_locations";

const WORK_LOCATIONS_IDX = {
  locationName: 0,  // A (computed display)
  teamKey:      1,  // B (natural PK)
  teamName:     2,  // C
};


// ── Sheets adapter ──

// Exported for direct Sheets-source reads (backfill scripts).
export async function readWorkLocationsSheets() {
  const { rows } = await readSheetSA(SHEET_IDS.HUB, WORK_LOCATIONS_TAB);
  return rows
    .filter((r) => String(r[WORK_LOCATIONS_IDX.teamKey] || "").trim())
    .map((r) => ({
      locationName: String(r[WORK_LOCATIONS_IDX.locationName] || "").trim(),
      teamKey:      String(r[WORK_LOCATIONS_IDX.teamKey]      || "").trim(),
      teamName:     String(r[WORK_LOCATIONS_IDX.teamName]     || "").trim(),
    }));
}

async function upsertWorkLocationSheets(teamKey, partial) {
  const { rows } = await readSheetSA(SHEET_IDS.HUB, WORK_LOCATIONS_TAB);
  const rowIdx = rows.findIndex(
    (r) => String(r[WORK_LOCATIONS_IDX.teamKey] || "").trim() === teamKey
  );

  if (rowIdx >= 0) {
    // Existing row: per-field cell updates batched into one API call.
    const sheetRow = rowIdx + 2; // +1 header + 1-indexed
    const updates = [];
    if ("locationName" in partial)
      updates.push({
        range: `${WORK_LOCATIONS_TAB}!A${sheetRow}`,
        values: [[String(partial.locationName || "")]],
      });
    // team_key (col B) is the PK - never updated on existing rows
    if ("teamName" in partial)
      updates.push({
        range: `${WORK_LOCATIONS_TAB}!C${sheetRow}`,
        values: [[String(partial.teamName || "")]],
      });
    if (updates.length > 0) {
      await batchUpdateRangesSA(SHEET_IDS.HUB, updates);
    }
  } else {
    // New row: append A-C
    const newRow = [
      String(partial.locationName || ""), // A
      teamKey,                            // B (PK)
      String(partial.teamName || ""),     // C
    ];
    await appendRowSA(SHEET_IDS.HUB, WORK_LOCATIONS_TAB, newRow);
  }
}

async function deleteWorkLocationSheets(teamKey) {
  // Delegate to the shared deleteRecord primitive: finds row by
  // team_key in col B (positional idx 1), deletes the row.
  await deleteRecord({
    spreadsheetId: SHEET_IDS.HUB,
    tabName: WORK_LOCATIONS_TAB,
    sheetsKeyColIdx: WORK_LOCATIONS_IDX.teamKey,
    key: teamKey,
    pgTable: "work_locations",
    pgKeyCol: "team_key",
  });
  // Note: deleteRecord handles both Sheets and the optional PG-side
  // delete (gated by isDualWrite). We do NOT need a separate
  // deleteWorkLocationPostgres call.
}


// ── Postgres adapter ──

async function readWorkLocationsPostgres() {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("work_locations")
    .select("team_key, location_name, team_name");
  if (error) {
    throw new Error(`[dataStore.pg] getWorkLocations: ${error.message}`);
  }
  return (data || []).map((row) => ({
    locationName: row.location_name || "",
    teamKey:      row.team_key,
    teamName:     row.team_name || "",
  }));
}

async function upsertWorkLocationPostgres(teamKey, partial) {
  const supabase = getServiceClient();
  const payload = { team_key: teamKey };
  if ("locationName" in partial)
    payload.location_name = String(partial.locationName || "");
  if ("teamName" in partial)
    payload.team_name = String(partial.teamName || "");
  payload.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("work_locations")
    .upsert(payload, { onConflict: "team_key", ignoreDuplicates: false });
  if (error) {
    throw new Error(`[dataStore.pg] upsertWorkLocation: ${error.message}`);
  }
}


// ── Public API: dispatched by cutover flags ──

/**
 * Read all work_locations records.
 * Optional opts.module enables per-module READ flag dispatch.
 */
export async function getWorkLocations(opts = {}) {
  if (isReadFromPostgres(WORK_LOCATIONS_TAB, opts.module)) {
    return readWorkLocationsPostgres();
  }
  return readWorkLocationsSheets();
}

/**
 * Upsert a work_location by team_key with a partial update.
 *   partial: { locationName?, teamName? }
 *   team_key cannot be changed (it is the PK).
 */
export async function upsertWorkLocation(teamKey, partial) {
  await upsertWorkLocationSheets(teamKey, partial);
  if (isDualWrite(WORK_LOCATIONS_TAB)) {
    await upsertWorkLocationPostgres(teamKey, partial);
  }
}

/**
 * Delete a work_location by team_key. Idempotent (no error if
 * the row is absent on either backend).
 */
export async function deleteWorkLocation(teamKey) {
  // deleteRecord handles both Sheets and the optional PG delete
  // (gated by isDualWrite(WORK_LOCATIONS_TAB) internally).
  await deleteWorkLocationSheets(teamKey);
}


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

async function updateSubmissionStatusSheets(token, status, notes) {
  const sheetRow = resolveTokenSheets(token);
  // Status transition: I (status), J (notes), K (admin_action_at).
  // Three independent cell updates - matches pre-PR-B handler.
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
    new Date().toISOString()
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

async function updateSubmissionStatusPostgres(token, status, notes) {
  const supabase = getServiceClient();
  const id = await resolveTokenPostgres(token);
  // Patch I/J/K columns: status, notes, admin_action_at. status is
  // expected non-empty here (it's a transition write; "Pending" or
  // similar terminal value), but defensive coerce just in case.
  // Also bump submitted_at: status transitions count as activity
  // (see TIMESTAMP DUAL-COLUMN DESIGN block comment - this is a
  // deliberate divergence from strict Sheets-parity which would
  // leave col A untouched on admin transitions).
  const now = new Date().toISOString();
  const payload = {
    status:          status || "Pending",
    notes:           notes  || "",
    admin_action_at: now,
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
  await upsertSubmissionSheets(token, fields);
  if (isDualWrite(SUBMISSIONS_TAB)) {
    await upsertSubmissionPostgres(token, fields);
  }
}

/**
 * Status transition: writes I (status), J (notes), K (admin_action_at).
 * Used by withdraw-submission, cancel-submission, admin-process.
 *
 * Does NOT touch created_at or any other column.
 */
export async function updateSubmissionStatus(token, status, notes) {
  await updateSubmissionStatusSheets(token, status, notes);
  if (isDualWrite(SUBMISSIONS_TAB)) {
    await updateSubmissionStatusPostgres(token, status, notes);
  }
}
