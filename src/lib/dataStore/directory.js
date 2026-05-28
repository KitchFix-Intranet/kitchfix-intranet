import {
  readSheetSA,
  appendRowSA,
  appendRowsSA,
  updateRangeSA,
  batchUpdateRangesSA,
  clearRangeSA,
  deleteRowSA,
  getSheetIdSA,
  SHEET_IDS,
} from "@/lib/sheets";
import { isDualWrite, isReadFromPostgres } from "@/lib/cutover";
import { getServiceClient } from "@/lib/supabase";
import { deleteRecord } from "./shared.js";

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
  // Preserve the A1 header row; clear and rewrite data rows only (A2:A).
  // hero_images uses "ImageURL" as the column header; the code intentionally
  // does NOT hard-code this text - the Sheet owns the header content. This
  // pattern fixes a latent bug from PR #69 where the canonical reader was
  // silently dropping row 1 because readSheetSA() treats it as headers; the
  // pre-PR fix wrote URLs from A1, conflicting with that contract.
  await clearRangeSA(SHEET_IDS.HUB, `${HERO_IMAGES_TAB}!A2:A`);
  if (urls.length > 0) {
    await updateRangeSA(
      SHEET_IDS.HUB,
      `${HERO_IMAGES_TAB}!A2`,
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
