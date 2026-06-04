#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// scripts/reconciliation-alarm.mjs - dual-write reconciliation safety net
// ════════════════════════════════════════════════════════════════════════════
//
// Compares Sheets ↔ PG for every tab in DUAL_WRITE_TABLES (read from env at
// runtime; nothing hardcoded). Classifies drift as EXPECTED (cron writes
// Sheets-only until Module 8) or REAL (alarm). Then a silent-gap detector
// for invoice_submissions that processed (ai_scan_complete=TRUE) but produced
// zero ai_line_items.
//
// SELF-CONTAINED: no imports from src/lib. Uses googleapis + supabase-js
// directly so it ports straight into the kitchfix-inventory-cron repo on
// Railway. Spreadsheet IDs are env-supplied (so prod vs preview can differ
// without code change).
//
// USAGE
//   Console-only (no Slack post):
//     node --env-file=.env.local scripts/reconciliation-alarm.mjs --dry-run
//
//   Production (posts to SLACK_RECAP_WEBHOOK):
//     node --env-file=.env.local scripts/reconciliation-alarm.mjs
//
//   Configurable:
//     --lookback-days=7       silent-gap detector window
//     --gap-min-age-hours=24  minimum age for a "should have line items" gap
//     --quiet-window-min=10   skip table if Sheets last-write < N min ago
//
// EXIT CODES
//   0  all reconciled, no gaps
//   1  alarm (real drift on any table, or silent gap, or check error)
//   2  fatal (missing env, network failure, etc.)
//
// ENV VARS REQUIRED
//   SUPABASE_URL                  Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY     service role for read-only counts
//   GOOGLE_SERVICE_ACCOUNT_EMAIL  Sheets read auth (service account)
//   GOOGLE_PRIVATE_KEY            Sheets read auth (\n-escaped)
//   DUAL_WRITE_TABLES             comma-separated tab list, parsed at runtime
//
//   At least one spreadsheet ID env var (read from env, NOT hardcoded):
//     SHEET_HUB, SHEET_COLLECTION, SHEET_GL_CODES, SHEET_AI_LINE_ITEMS, SHEET_INVENTORY
//
//   SLACK_RECAP_WEBHOOK           optional; no-op if missing (or in dry-run)
//
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ── Args ──
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=", 2)[1];
  if (args.includes(`--${name}`)) return "true";
  return fallback;
}
const DRY_RUN           = getArg("dry-run", "false").toLowerCase() === "true";
const LOOKBACK_DAYS     = parseInt(getArg("lookback-days", "7"), 10);
const GAP_MIN_AGE_HOURS = parseInt(getArg("gap-min-age-hours", "24"), 10);
const QUIET_WINDOW_MIN  = parseInt(getArg("quiet-window-min", "10"), 10);

// ── Env ──
const SUPABASE_URL              = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SLACK_RECAP_WEBHOOK       = process.env.SLACK_RECAP_WEBHOOK;
const GOOGLE_SA_EMAIL           = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY        = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const DUAL_WRITE_TABLES = (process.env.DUAL_WRITE_TABLES || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

// Spreadsheet IDs - env-supplied so prod vs preview can differ. If a tab's
// spreadsheet env var is missing, the script falls back to the well-known
// production IDs baked into the intranet's src/lib/sheets.js (verified there
// 2026-06-04). This fallback exists so the script runs in this repo with
// just .env.local; on Railway, set the SHEET_* env vars explicitly.
const SHEET_IDS = {
  HUB:           process.env.SHEET_HUB           || "1rvIg9trPCxiEWvzrYbtp1j7V_sbtQnKaysv5BOwA90E",
  COLLECTION:    process.env.SHEET_COLLECTION    || "1itJh5x1YFBdyHTBr-dyKD_r_nRBfjwIBiR_bWiOyCzQ",
  GL_CODES:      process.env.SHEET_GL_CODES      || "1Gs7ToEvrsraBt81DctgwImKK-ck2Ch6V2ifvF8VndeY",
  AI_LINE_ITEMS: process.env.SHEET_AI_LINE_ITEMS || "18mTWaeodOpFVmDSNRkGpNZvCrNWqHxVv3qN8r1b2REo",
  INVENTORY:     process.env.SHEET_INVENTORY     || "14oROcj9hyQJfKOm-ZXUDn6qvOviZYX1aLMs27V8zZnk",
};

// Env validation deferred to runReconciliationAlarm() so library callers
// (e.g. the kitchfix-inventory-cron Railway service) can wrap the call in
// try/catch instead of having the import crash the process. createClient
// itself does not validate URL/key on construction; the failure surfaces
// on the first PostgREST call inside the function.
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Sheets reader (minimal, self-contained) ──
let _sheetsClient = null;
function getSheetsClient() {
  if (_sheetsClient) return _sheetsClient;
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: GOOGLE_SA_EMAIL, private_key: GOOGLE_PRIVATE_KEY },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  _sheetsClient = google.sheets({ version: "v4", auth });
  return _sheetsClient;
}

// Mirrors safeRead from src/lib/sheets.js: returns { headers, rows } where
// rows has the header stripped. Trailing blank rows are NOT returned by the
// Sheets values API for unbounded ranges, so rows.length is the data-row count.
async function safeRead(spreadsheetId, tabName) {
  try {
    const sheets = getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId, range: tabName,
    });
    const data = res.data.values || [];
    if (data.length === 0) return { headers: [], rows: [] };
    return { headers: data[0], rows: data.slice(1) };
  } catch (e) {
    throw new Error(`safeRead("${tabName}"): ${e.message}`);
  }
}

// List all tab (sheet) names in a spreadsheet. Used for ai_line_items and
// gl_codes which fan into one tab per kitchen account.
async function listTabs(spreadsheetId) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.get({
    spreadsheetId, fields: "sheets.properties.title",
  });
  return (res.data.sheets || []).map((s) => s.properties.title);
}

// ── Per-table config ──
// Keys ARE the DUAL_WRITE_TABLES env-var entries. Each maps to a sheetsRead
// strategy because not every dual-write "tab" is a single Sheets tab. Real
// shapes the orchestrators use:
//   - SINGLE TAB: tab name + spreadsheet (most common)
//   - PG-ONLY: there is no Sheets tab at all (vendor_aliases is documented
//     as PG-only in src/lib/dataStore/vendor.js)
//   - EMBEDDED: rows live in columns of another tab (invoice_rejections is
//     embedded in cols R-U of invoice_submissions_26)
//   - PER-ACCOUNT FAN-OUT: data fans into one tab per kitchen account
//     (ai_line_items, gl_codes)
//
// Config fields:
//   sheetsMode:          "single" | "pg_only" | "embedded" | "per_account"
//   spreadsheetIdKey:    which SHEET_IDS entry holds the spreadsheet (or
//                        parent spreadsheet for the embedded mode)
//   sheetTab:            actual Sheets tab name (may differ from the flag
//                        name, e.g. invoice_submissions → invoice_submissions_26)
//   embeddedHostTab:     for embedded mode: parent tab to read
//   embeddedRowFilter:   for embedded mode: function(row) → bool - true if
//                        this row contributes a "live" embedded record
//   pgTable:             PG table name (only differs for 2 tabs)
//   pgLiveFilter:        function(query) → query - PG soft-delete filter
//   sheetsTombstone:     function(row) → bool - true = treat as soft-deleted
//                        in Sheets, exclude from the live count.  null = no
//                        Sheets-side tombstone.
//   sheetsTimestampIdx:  0-based column index for the Sheets "recently
//                        written" timestamp (quiet-window). null = no guard.
//   classification:      "intranet_only" - drift = real alarm in either direction
//                        "cron_external" - cron writes Sheets-only; Sheets>PG
//                          is EXPECTED, PG>Sheets is REAL.
//   notes:               human-readable label for the digest
//
// The cron-external set is: item_catalog, item_aliases, price_history,
// review_queue (Module 7 tabs, cron writes Sheets-only until Module 8) AND
// ai_line_items (the cron's own output - intranet dual-writes its OCR
// pipeline contribution but the cron itself is Sheets-only). For ai_line_items
// specifically: Sheets > PG = cron contribution (expected); PG > Sheets =
// intranet wrote PG but failed to mirror to Sheets (real alarm).
const TABLE_CONFIG = {
  // ── Module 1 ──
  news_interactions: {
    sheetsMode: "single", spreadsheetIdKey: "COLLECTION", sheetTab: "news_interactions",
    pgTable: "news_interactions",
    pgLiveFilter: (q) => q, sheetsTombstone: null, sheetsTimestampIdx: null,
    classification: "intranet_only", notes: "Module 1 (append-only, COLLECTION)",
  },

  // ── Module 2 (directory) ──
  accounts:       { sheetsMode: "single", spreadsheetIdKey: "HUB", sheetTab: "accounts",
    pgTable: "accounts", pgLiveFilter: (q) => q,
    sheetsTombstone: null, sheetsTimestampIdx: null,
    classification: "intranet_only", notes: "Module 2 directory" },
  contacts:       { sheetsMode: "single", spreadsheetIdKey: "HUB", sheetTab: "contacts",
    pgTable: "contacts", pgLiveFilter: (q) => q,
    sheetsTombstone: null, sheetsTimestampIdx: null,
    classification: "intranet_only", notes: "Module 2 directory" },
  hero_images:    { sheetsMode: "single", spreadsheetIdKey: "HUB", sheetTab: "hero_images",
    pgTable: "hero_images", pgLiveFilter: (q) => q,
    sheetsTombstone: null, sheetsTimestampIdx: null,
    classification: "intranet_only", notes: "Module 2 directory" },
  work_locations: { sheetsMode: "single", spreadsheetIdKey: "HUB", sheetTab: "work_locations",
    pgTable: "work_locations", pgLiveFilter: (q) => q,
    sheetsTombstone: null, sheetsTimestampIdx: null,
    classification: "intranet_only", notes: "Module 2 directory" },

  // ── Module 3 ──
  submissions: { sheetsMode: "single", spreadsheetIdKey: "COLLECTION", sheetTab: "submissions",
    pgTable: "submissions", pgLiveFilter: (q) => q,
    sheetsTombstone: null, sheetsTimestampIdx: null,
    classification: "intranet_only", notes: "Module 3 People Portal (COLLECTION)" },

  // ── Module 5 (vendor) ──
  vendor_master: {
    sheetsMode: "single", spreadsheetIdKey: "HUB", sheetTab: "vendor_master",
    pgTable: "vendors", pgLiveFilter: (q) => q.is("deleted_at", null),
    // Actual Sheets soft-delete pattern (confirmed against prod data
    // 2026-06-04): the Vendor Name col (B / idx 1) is WIPED to empty
    // string and the literal "DELETED" string goes into the Notes col
    // (E / idx 4). The canonical reliable signal is "name is empty" —
    // the Notes-column sentinel is a separate write that can drift.
    // Additionally hard-skip the documented SAM-956 corruption row
    // (Path-3 PG-skip per dashboard, every column populated with
    // "SAM-956") so it doesn't count as Sheets-live.
    sheetsTombstone: (row) => {
      const id   = String(row?.[0] || "").trim();
      const name = String(row?.[1] || "").trim();
      if (id === "SAM-956") return true;        // documented corruption row
      if (name === "") return true;             // soft-delete sentinel
      return false;
    },
    sheetsTimestampIdx: null,
    classification: "intranet_only",
    notes: "Module 5 vendors (PG deleted_at, Sheets name='' + SAM-956 exclusion)",
  },
  vendor_accounts: {
    sheetsMode: "single", spreadsheetIdKey: "HUB", sheetTab: "vendor_accounts",
    pgTable: "vendor_accounts", pgLiveFilter: (q) => q.eq("active", true),
    sheetsTombstone: null,  // Sheets-side active col not consistently used; tolerated drift
    sheetsTimestampIdx: null,
    classification: "intranet_only", notes: "Module 5 vendor_accounts (PG active=TRUE)",
  },
  vendor_aliases: {
    // Documented PG-only in src/lib/dataStore/vendor.js:98 - no Sheet tab exists.
    sheetsMode: "pg_only", pgTable: "vendor_aliases", pgLiveFilter: (q) => q,
    classification: "intranet_only", notes: "Module 5 vendor_aliases (PG-only, no Sheet tab)",
  },

  // ── Module 6 (invoice + finance) ──
  invoice_submissions: {
    // Actual Sheets tab is invoice_submissions_26 (per dataStore/invoice.js:74).
    // Sheets col N (idx 13) = workflow status going forward, but the
    // column is historically OVERLOADED with AI-scan status values too
    // (per dataStore/invoice.js:110 - "mixed AI-scan + workflow
    // historically; workflow-only going forward"). PG cleanly separates
    // status + ai_scan_status. The drift the alarm catches has TWO
    // documented historical residue shapes, both pre-existing Module 6
    // and unrelated to inventory dual-write:
    //
    //   SHAPE α — pre-cutover Sheets-only invoices
    //     Sheets row exists with no PG counterpart, submitted before the
    //     PR 6.3 backfill cutover (2026-06-03). These are invoices
    //     submitted against vendors that were later soft-deleted, so the
    //     vendor_id FK couldn't resolve during backfill and the rows
    //     were intentionally skipped (Path-3 doctrine per dashboard).
    //     The dashboard explicitly documents the SAM-956 → 38a56cc8...
    //     case under post-Module-5 backlog item (e), "Resolution: accept
    //     the skip in PG per Path 3 decision."
    //
    //   SHAPE β — col-N overloading
    //     PG row exists with status IN (corrected, deleted) and
    //     is_historical=TRUE, but Sheets col N still holds an AI-scan
    //     value (complete/failed/pending/photo-only) because the AI cron
    //     overwrote col N after the workflow status change. Tracked as a
    //     Module 6 cleanup (col-N split into separate columns); not a
    //     dual-write bug.
    //
    // The residueCalculator computes the EXACT row count for each shape
    // separately. The temporal gate (submitted_at < 2026-06-03 for α,
    // is_historical=TRUE for β) is the safety boundary that ensures
    // ANY post-cutover drift outside these shapes stays REAL.
    sheetsMode: "single", spreadsheetIdKey: "COLLECTION", sheetTab: "invoice_submissions_26",
    pgTable: "invoice_submissions",
    pgLiveFilter: (q) => q.not("status", "in", "(deleted,corrected)"),
    sheetsTombstone: (row) => ["deleted","corrected"].includes(String(row?.[13]||"").trim().toLowerCase()),
    sheetsTimestampIdx: null,
    classification: "intranet_only",
    notes: "Module 6 invoice_submissions (residue: α pre-cutover Sheets-only + β col-N overloading on is_historical)",
    //
    // Residue calculator. Returns a row count that explains the observed
    // positive drift. Each residue row contributes EXACTLY +1 to
    // (sheetsLive − pgLive), so when residue ≥ drift the drift is fully
    // explained and the alarm classifies as known_residue (informational,
    // does NOT fire). Any excess drift beyond residue stays REAL.
    //
    // SCOPING (the safety bounds that prevent hiding future real drift):
    //
    //   SHAPE α requires ALL of:
    //     (α1) Sheets row exists, no PG row by client_uuid
    //     (α2) Sheets col N NOT IN (deleted, corrected) — so it counts in
    //          sheetsLive (otherwise it doesn't contribute to drift anyway)
    //     (α3) Sheets submitted_at < MODULE_6_CUTOVER (2026-06-03)
    //
    //   SHAPE β requires ALL of:
    //     (β1) PG row exists with status IN (corrected, deleted)
    //     (β2) PG.is_historical = TRUE
    //     (β3) Sheets row exists for that client_uuid
    //     (β4) Sheets col N IN (complete, failed, pending, photo-only)
    //
    // Anything that fails (α3) or (β2) — i.e. post-cutover / live data —
    // does NOT count as residue. PG > Sheets direction is NEVER residue
    // (handled by the outer drift check, residue is only consulted when
    // drift > 0). Drift > residue.count stays as real_drift with the
    // unexplained excess surfaced.
    //
    // Future failure modes this CAN'T hide:
    //   - new Sheets-only row submitted today (α3 fails)
    //   - new dual-write failure (Sheets succeeds, PG fails) (α3 fails)
    //   - new col-N stale-write on a non-historical row (β2 fails)
    //   - PG-only row (drift goes negative, residue not consulted)
    //   - any row count drift beyond residue.count (excess is alarmed)
    residueCalculator: async (supa, sheetsRows) => {
      const MODULE_6_CUTOVER = "2026-06-03T00:00:00Z";  // PR 6.3 backfill cutover
      const AI_SCAN_VALUES   = new Set(["complete", "failed", "pending", "photo-only"]);
      const DEAD_STATUSES    = new Set(["deleted", "corrected"]);

      // Load PG indexed by client_uuid (paginated).
      const pgByUuid = new Map();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supa
          .from("invoice_submissions")
          .select("client_uuid, status, is_historical")
          .range(from, from + 999);
        if (error) throw new Error(`residueCalculator PG read: ${error.message}`);
        if (!data?.length) break;
        for (const r of data) if (r.client_uuid) pgByUuid.set(r.client_uuid, r);
        if (data.length < 1000) break;
      }

      const shapeAlpha = [];
      const shapeBeta  = [];

      for (const row of sheetsRows) {
        const uuid        = String(row?.[0]  || "").trim();
        const submittedAt = String(row?.[1]  || "").trim();
        const colN        = String(row?.[13] || "").trim().toLowerCase();
        if (!uuid) continue;

        // Sheets-tombstoned rows don't contribute to drift in either direction.
        if (DEAD_STATUSES.has(colN)) continue;

        const pgRow = pgByUuid.get(uuid);

        if (!pgRow) {
          // SHAPE α: Sheets-only, pre-cutover
          if (submittedAt && submittedAt < MODULE_6_CUTOVER) {
            shapeAlpha.push({ uuid, submittedAt, colN });
          }
          continue;
        }

        // PG row exists. Could it be SHAPE β?
        if (DEAD_STATUSES.has(pgRow.status) && pgRow.is_historical && AI_SCAN_VALUES.has(colN)) {
          shapeBeta.push({ uuid, pg_status: pgRow.status, colN });
        }
      }

      const total = shapeAlpha.length + shapeBeta.length;
      const sampleIds = [
        ...shapeAlpha.slice(0, 5).map((r) => `α:${r.uuid}`),
        ...shapeBeta.slice(0, 5).map((r) => `β:${r.uuid}`),
      ];
      return {
        count: total,
        breakdown: { alpha_precutover_sheets_only: shapeAlpha.length, beta_colN_overloading: shapeBeta.length },
        sampleIds,
        rule: "α: (no PG row ∧ submitted_at<2026-06-03) ∨ β: (PG.status∈{corrected,deleted} ∧ is_historical ∧ col_N∈AI-scan)",
      };
    },
  },
  invoice_rejections: {
    // Per dataStore/invoice.js:75 invoice_rejections is "PG-only; embedded in
    // cols R-U of submissions on Sheets path". Col R (idx 17) is the rejection
    // timestamp (or similar). A row contributes a rejection if any of R/S/T/U
    // has a non-empty value.
    sheetsMode: "embedded", spreadsheetIdKey: "COLLECTION",
    embeddedHostTab: "invoice_submissions_26",
    embeddedRowFilter: (row) => [17,18,19,20].some((i) => String(row?.[i]||"").trim() !== ""),
    pgTable: "invoice_rejections", pgLiveFilter: (q) => q,
    classification: "intranet_only", notes: "Module 6 invoice_rejections (embedded in invoice_submissions_26 cols R-U)",
  },
  ai_line_items: {
    // Per-account fan-out: one tab per kitchen account in the AI_LINE_ITEMS
    // spreadsheet (dataStore/invoice.js:432-657). Sum row counts across all
    // tabs. Cron writes Sheets-only → Sheets > PG is expected.
    sheetsMode: "per_account", spreadsheetIdKey: "AI_LINE_ITEMS",
    pgTable: "ai_line_items", pgLiveFilter: (q) => q,
    classification: "cron_external", notes: "Module 6 ai_line_items (cron Sheets-only fans into per-account tabs)",
  },
  gl_codes: {
    // Per-account fan-out in GL_CODES spreadsheet (dataStore/invoice.js:77).
    // Count comparison is structurally meaningless because GL codes can be
    // SHARED across kitchen accounts: PG has one normalized row per code,
    // Sheets has one row per (account, code) pair. Sheets count is roughly
    // K × N where K is the avg overlap factor and N is the unique-code
    // count. Drift is always positive and not meaningful as an alarm.
    // Treated as "structural" - counts shown for reference only.
    sheetsMode: "per_account", spreadsheetIdKey: "GL_CODES",
    pgTable: "gl_codes", pgLiveFilter: (q) => q,
    classification: "structural",
    notes: "Module 6 gl_codes (per-account fan-out; codes shared across accounts - count comparison structural)",
  },

  // ── Module 7 (Smart Inventory) - NOT YET DUAL-WRITE ──
  // Pre-configured so the alarm activates the moment these tabs are added
  // to DUAL_WRITE_TABLES. Cron writes Sheets-only until Module 8 ships.
  // Sheets timestamp indices below are the cron-write detection point for
  // the quiet-window guard.
  item_catalog: {
    sheetsMode: "single", spreadsheetIdKey: "INVENTORY", sheetTab: "item_catalog",
    pgTable: "inventory_items", pgLiveFilter: (q) => q.neq("status", "excluded"),
    sheetsTombstone: null, sheetsTimestampIdx: 14,  // col O = updated_at (cron-written)
    classification: "cron_external", notes: "Module 7 inventory_items (cron Sheets-only)",
  },
  item_aliases: {
    sheetsMode: "single", spreadsheetIdKey: "INVENTORY", sheetTab: "item_aliases",
    pgTable: "item_aliases", pgLiveFilter: (q) => q,
    sheetsTombstone: null, sheetsTimestampIdx: 6,  // learned_at
    classification: "cron_external", notes: "Module 7 item_aliases (cron Sheets-only)",
  },
  price_history: {
    sheetsMode: "single", spreadsheetIdKey: "INVENTORY", sheetTab: "price_history",
    pgTable: "price_history", pgLiveFilter: (q) => q,
    sheetsTombstone: null, sheetsTimestampIdx: 6,  // recorded_at
    classification: "cron_external", notes: "Module 7 price_history (cron Sheets-only)",
  },
  review_queue: {
    sheetsMode: "single", spreadsheetIdKey: "INVENTORY", sheetTab: "review_queue",
    pgTable: "review_queue", pgLiveFilter: (q) => q,
    sheetsTombstone: null, sheetsTimestampIdx: null,
    classification: "cron_external", notes: "Module 7 review_queue (cron Sheets-only)",
  },
  storage_locations: {
    sheetsMode: "single", spreadsheetIdKey: "INVENTORY", sheetTab: "storage_locations",
    pgTable: "storage_locations", pgLiveFilter: (q) => q.eq("active", true),
    sheetsTombstone: null, sheetsTimestampIdx: null,
    classification: "intranet_only", notes: "Module 7 storage_locations (PG active=TRUE)",
  },
  count_sessions: {
    sheetsMode: "single", spreadsheetIdKey: "INVENTORY", sheetTab: "count_sessions",
    pgTable: "count_sessions", pgLiveFilter: (q) => q,
    sheetsTombstone: null, sheetsTimestampIdx: null,
    classification: "intranet_only", notes: "Module 7 count_sessions",
  },
  count_items: {
    sheetsMode: "single", spreadsheetIdKey: "INVENTORY", sheetTab: "count_items",
    pgTable: "count_items", pgLiveFilter: (q) => q,
    sheetsTombstone: null, sheetsTimestampIdx: null,
    classification: "intranet_only", notes: "Module 7 count_items",
  },
  merge_history: {
    sheetsMode: "single", spreadsheetIdKey: "INVENTORY", sheetTab: "merge_history",
    pgTable: "merge_history", pgLiveFilter: (q) => q,
    sheetsTombstone: null, sheetsTimestampIdx: null,
    classification: "intranet_only", notes: "Module 7 merge_history",
  },
};

// ── Helpers ──
function countSheetsLive(rows, tombstoneFn) {
  if (!tombstoneFn) return rows.length;
  let n = 0;
  for (const r of rows) if (!tombstoneFn(r)) n++;
  return n;
}

function newestSheetsTimestamp(rows, tsColIdx) {
  if (tsColIdx == null) return null;
  let max = 0;
  for (const r of rows) {
    const raw = r[tsColIdx];
    if (!raw) continue;
    const t = Date.parse(String(raw));
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max || null;
}

async function countPgLive(pgTable, pgLiveFilter) {
  let q = supa.from(pgTable).select("*", { count: "exact", head: true });
  q = pgLiveFilter(q);
  const { count, error } = await q;
  if (error) throw new Error(`PG count ${pgTable}: ${error.message}`);
  return count || 0;
}

// ── Sheets-side count by mode ──
async function countSheetsByMode(config) {
  // pg_only short-circuit must precede the spreadsheet lookup because
  // these tabs deliberately have no spreadsheetIdKey.
  if (config.sheetsMode === "pg_only") {
    return { sheetsAll: null, sheetsLive: null, newestTs: null, modeNote: "PG-only (no Sheets tab)" };
  }

  const spreadsheetId = SHEET_IDS[config.spreadsheetIdKey];
  if (!spreadsheetId) throw new Error(`unknown spreadsheetIdKey ${config.spreadsheetIdKey}`);

  if (config.sheetsMode === "single") {
    const { rows } = await safeRead(spreadsheetId, config.sheetTab);
    return {
      sheetsAll:  rows.length,
      sheetsLive: countSheetsLive(rows, config.sheetsTombstone),
      newestTs:   newestSheetsTimestamp(rows, config.sheetsTimestampIdx),
      modeNote:   `single tab "${config.sheetTab}"`,
      sheetsRows: rows,      // exposed for the optional residueCalculator
    };
  }

  if (config.sheetsMode === "embedded") {
    const { rows } = await safeRead(spreadsheetId, config.embeddedHostTab);
    const live = rows.filter(config.embeddedRowFilter).length;
    return {
      sheetsAll:  live,
      sheetsLive: live,
      newestTs:   null,
      modeNote:   `embedded in cols of "${config.embeddedHostTab}"`,
    };
  }

  if (config.sheetsMode === "per_account") {
    const tabs = await listTabs(spreadsheetId);
    // Skip non-data tabs (headers, template) by convention. The cron and
    // intranet readers treat every tab as a per-account data tab.
    let total = 0; let nonEmpty = 0;
    for (const t of tabs) {
      try {
        const { rows } = await safeRead(spreadsheetId, t);
        total += rows.length;
        if (rows.length) nonEmpty++;
      } catch {
        // Skip unreadable tab (some spreadsheets have a hidden template tab)
      }
    }
    return {
      sheetsAll:  total,
      sheetsLive: total,
      newestTs:   null,
      modeNote:   `${tabs.length} tabs (${nonEmpty} non-empty)`,
    };
  }

  throw new Error(`unsupported sheetsMode "${config.sheetsMode}"`);
}

// ── CHECK 1: per-table reconciliation ──
async function check1() {
  const results = [];
  for (const tab of DUAL_WRITE_TABLES) {
    const config = TABLE_CONFIG[tab];
    if (!config) {
      results.push({ tab, status: "no_config",
        message: `No reconciliation config for tab "${tab}" - add to TABLE_CONFIG`,
      });
      continue;
    }
    try {
      const { sheetsAll, sheetsLive, newestTs, modeNote, sheetsRows } = await countSheetsByMode(config);
      const quietViolation = newestTs != null
        && (Date.now() - newestTs) < QUIET_WINDOW_MIN * 60 * 1000;
      const pgLive = await countPgLive(config.pgTable, config.pgLiveFilter);

      // PG-only mode: there is no Sheets count to compare; report just PG.
      if (config.sheetsMode === "pg_only") {
        results.push({
          tab, status: "checked", config,
          sheetsAll: null, sheetsLive: null, pgLive, drift: 0, newestTs,
          classification: "pg_only_reference", modeNote,
        });
        continue;
      }

      const drift = sheetsLive - pgLive;

      // Residue gate. Only applies when (1) the config defines a
      // residueCalculator, (2) drift is strictly positive (we never
      // explain away PG > Sheets - that's always a real bug), and
      // (3) the calculator's count is greater than or equal to the
      // observed drift. The calculator is per-table, narrowly scoped
      // to a specific structural-residue shape (see config notes).
      // Excess drift beyond residue stays REAL.
      let residue = null;
      if (config.residueCalculator && drift > 0 && sheetsRows) {
        residue = await config.residueCalculator(supa, sheetsRows);
      }

      let classification;
      let unexplainedDrift = drift;
      if (quietViolation) {
        classification = "quiet_window_skip";
      } else if (config.classification === "structural") {
        classification = "structural_difference";
      } else if (drift === 0) {
        classification = "reconciled";
      } else if (config.classification === "cron_external" && drift > 0) {
        classification = "expected_cron_drift";
      } else if (residue && residue.count >= drift) {
        // All positive drift explained by the strictly-scoped residue shape.
        classification = "known_residue";
        unexplainedDrift = 0;
      } else if (residue && drift > residue.count) {
        // Residue explains SOME of the drift but not all. Excess is real.
        classification = "real_drift";
        unexplainedDrift = drift - residue.count;
      } else {
        classification = "real_drift";
      }
      results.push({
        tab, status: "checked", config,
        sheetsAll, sheetsLive, pgLive, drift, classification,
        newestTs, modeNote, residue, unexplainedDrift,
      });
    } catch (err) {
      results.push({ tab, status: "error", message: err.message });
    }
  }
  return results;
}

// ── CHECK 2: silent-gap detector ──
//
// invoice_submissions where:
//   ai_scan_complete = TRUE      AI claims it processed
//   is_historical    = FALSE     skip backfilled rows
//   submitted_at >= now() - 7d   lookback window
//   submitted_at <= now() - 24h  skip in-flight (cron may be mid-run)
// AND (count of ai_line_items where invoice_uuid = id) = 0
//
// "Should have had line items but produced none" - the lesson behind the
// rest of today's session.
async function check2() {
  const since  = new Date(Date.now() - LOOKBACK_DAYS    * 24 * 60 * 60 * 1000).toISOString();
  const cutoff = new Date(Date.now() - GAP_MIN_AGE_HOURS *      60 * 60 * 1000).toISOString();

  const { data: candidates, error: e1 } = await supa
    .from("invoice_submissions")
    .select("id, vendor_id, account_key, invoice_number, submitted_at, status, ai_scan_status")
    .eq("ai_scan_complete", true)
    .eq("is_historical", false)
    .gte("submitted_at", since)
    .lte("submitted_at", cutoff)
    .order("submitted_at", { ascending: false });
  if (e1) throw new Error(`silent-gap candidates: ${e1.message}`);
  if (!candidates || candidates.length === 0) {
    return { lookback: LOOKBACK_DAYS, candidates: 0, gaps: [] };
  }

  // Bulk fetch line-item presence by invoice_uuid (200-id batches to stay
  // under PostgREST URL length limits).
  const candidateIds = candidates.map((c) => c.id);
  const present = new Set();
  for (let i = 0; i < candidateIds.length; i += 200) {
    const slice = candidateIds.slice(i, i + 200);
    const { data, error } = await supa
      .from("ai_line_items")
      .select("invoice_uuid")
      .in("invoice_uuid", slice);
    if (error) throw new Error(`silent-gap line items: ${error.message}`);
    for (const r of data || []) present.add(r.invoice_uuid);
  }

  const gaps = candidates.filter((c) => !present.has(c.id));
  return { lookback: LOOKBACK_DAYS, candidates: candidates.length, gaps };
}

// ── Slack poster (reuses the cron/daily/route.js pattern) ──
async function postSlack(webhookUrl, text, mrkdwn) {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        blocks: mrkdwn ? [{ type: "section", text: { type: "mrkdwn", text: mrkdwn } }] : undefined,
      }),
    });
  } catch (e) {
    console.error("[recon] slack post failed:", e.message);
  }
}

// ── Digest builder ──
function buildDigest(c1Results, c2Result) {
  const realDrift  = c1Results.filter((r) => r.classification === "real_drift");
  const expected   = c1Results.filter((r) => r.classification === "expected_cron_drift");
  const structural = c1Results.filter((r) => r.classification === "structural_difference");
  const knownRes   = c1Results.filter((r) => r.classification === "known_residue");
  const reconciled = c1Results.filter((r) => r.classification === "reconciled");
  const pgOnlyRef  = c1Results.filter((r) => r.classification === "pg_only_reference");
  const quiet      = c1Results.filter((r) => r.classification === "quiet_window_skip");
  const errors     = c1Results.filter((r) => r.status === "error");
  const noConfig   = c1Results.filter((r) => r.status === "no_config");
  const gaps       = c2Result.gaps;

  const alarm = realDrift.length > 0 || gaps.length > 0 || errors.length > 0;
  const tailBits = [];
  if (expected.length)   tailBits.push(`${expected.length} expected-drift`);
  if (knownRes.length)   tailBits.push(`${knownRes.length} known-residue`);
  if (structural.length) tailBits.push(`${structural.length} structural`);
  const headline = alarm
    ? `🚨 *Dual-write recon ALARM* - ${realDrift.length} drift, ${gaps.length} silent gap, ${errors.length} error`
    : `✅ *Dual-write recon clean* - ${reconciled.length} reconciled${tailBits.length ? ", " + tailBits.join(", ") : ""}, 0 gaps`;

  const lines = [headline, ""];

  if (realDrift.length) {
    lines.push("*🚨 REAL DRIFT (action required)*");
    for (const r of realDrift) {
      const sign = r.drift > 0 ? "+" : "";
      const tail = r.residue
        ? `  (residue explains ${r.residue.count}; unexplained excess ${r.unexplainedDrift})`
        : "";
      lines.push(`  • \`${r.tab}\` PG-live ${r.pgLive}, Sheets-live ${r.sheetsLive}, drift ${sign}${r.drift}${tail}  _${r.config.notes}_`);
    }
    lines.push("");
  }
  if (gaps.length) {
    lines.push("*🚨 SILENT GAPS (ai_scan_complete=TRUE but 0 ai_line_items)*");
    const shown = gaps.slice(0, 10);
    for (const g of shown) {
      lines.push(`  • \`${g.id}\` vendor=${g.vendor_id || "(null)"} acct=${g.account_key} inv#=${g.invoice_number || "(n/a)"} submitted=${(g.submitted_at||"").slice(0,16)}`);
    }
    if (gaps.length > shown.length) lines.push(`  • _… ${gaps.length - shown.length} more_`);
    lines.push("");
  }
  if (errors.length) {
    lines.push("*⚠️ CHECK ERRORS*");
    for (const e of errors) lines.push(`  • \`${e.tab}\`: ${e.message}`);
    lines.push("");
  }
  if (expected.length) {
    lines.push("*expected drift (cron Sheets-only until Module 8)*");
    for (const r of expected) {
      lines.push(`  • \`${r.tab}\` Sheets-live ${r.sheetsLive}, PG-live ${r.pgLive}, drift +${r.drift}`);
    }
    lines.push("");
  }
  if (structural.length) {
    lines.push("*structural difference (count comparison not meaningful)*");
    for (const r of structural) {
      lines.push(`  • \`${r.tab}\` Sheets-live ${r.sheetsLive}, PG-live ${r.pgLive}  _${r.config.notes}_`);
    }
    lines.push("");
  }
  if (knownRes.length) {
    lines.push("*known residue (pre-existing structural shape, not a dual-write bug)*");
    for (const r of knownRes) {
      lines.push(`  • \`${r.tab}\` Sheets-live ${r.sheetsLive}, PG-live ${r.pgLive}, drift +${r.drift} fully explained by ${r.residue?.count ?? "?"} residue row(s)`);
      if (r.residue?.breakdown) {
        const bd = Object.entries(r.residue.breakdown).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(", ");
        if (bd) lines.push(`    breakdown: ${bd}`);
      }
      lines.push(`    rule: \`${r.residue?.rule || "(no rule reported)"}\``);
      const idsPreview = r.residue?.sampleIds?.slice(0, 5).map((id) => `\`${id}\``).join(", ") || "";
      const more = (r.residue?.count || 0) > 5 ? ` (+${r.residue.count - 5} more)` : "";
      if (idsPreview) lines.push(`    sample: ${idsPreview}${more}`);
    }
    lines.push("");
  }
  if (quiet.length) {
    lines.push(`*skipped (cron wrote within ${QUIET_WINDOW_MIN} min)*`);
    for (const r of quiet) lines.push(`  • \`${r.tab}\` (newest ts ${new Date(r.newestTs).toISOString()})`);
    lines.push("");
  }
  if (reconciled.length) {
    lines.push(`*reconciled (${reconciled.length})*  ` + reconciled.map((r) => `\`${r.tab}\``).join(" "));
    lines.push("");
  }
  if (pgOnlyRef.length) {
    lines.push(`*PG-only (no Sheets counterpart; reference count)*`);
    for (const r of pgOnlyRef) lines.push(`  • \`${r.tab}\` PG-live ${r.pgLive}`);
    lines.push("");
  }
  if (noConfig.length) {
    lines.push("*⚠️ DUAL_WRITE_TABLES entries with no reconciliation config*");
    for (const r of noConfig) lines.push(`  • \`${r.tab}\` - add to TABLE_CONFIG`);
    lines.push("");
  }
  lines.push(`_run ${new Date().toISOString()} · lookback ${LOOKBACK_DAYS}d · gap-min-age ${GAP_MIN_AGE_HOURS}h · quiet ${QUIET_WINDOW_MIN}m_`);

  return { alarm, text: headline.replace(/[*`]/g, ""), mrkdwn: lines.join("\n") };
}

// ── Main ──
// Exported so the kitchfix-inventory-cron Railway service can append it
// to the tail of its own main() after the 06:00 cron writes flush. The
// CLI entry point (see bottom of file) calls this same function when the
// script is invoked directly via node.
export async function runReconciliationAlarm() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("[recon] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!GOOGLE_SA_EMAIL || !GOOGLE_PRIVATE_KEY) {
    throw new Error("[recon] missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY");
  }

  console.log("════════════════════════════════════════════════════════════════════════");
  console.log(`  INVENTORY DUAL-WRITE RECON  ${DRY_RUN ? "(DRY-RUN - CONSOLE ONLY)" : "(POSTS TO SLACK)"}`);
  console.log("════════════════════════════════════════════════════════════════════════");
  console.log(`DUAL_WRITE_TABLES (${DUAL_WRITE_TABLES.length} tabs): ${DUAL_WRITE_TABLES.join(", ") || "(empty - skipping CHECK 1)"}`);
  console.log(`Params: lookback=${LOOKBACK_DAYS}d, gap-min-age=${GAP_MIN_AGE_HOURS}h, quiet-window=${QUIET_WINDOW_MIN}m`);
  console.log("");

  console.log("CHECK 1 - per-table dual-write reconciliation");
  console.log("────────────────────────────────────────────────────────────────────────");
  const c1 = DUAL_WRITE_TABLES.length ? await check1() : [];
  for (const r of c1) {
    if (r.status === "no_config") {
      console.log(`  ?  ${r.tab.padEnd(22)} NO CONFIG  (${r.message})`);
    } else if (r.status === "error") {
      console.log(`  ✗  ${r.tab.padEnd(22)} ERROR  ${r.message}`);
    } else {
      const tag = {
        reconciled:            "✓",
        expected_cron_drift:   ".",
        structural_difference: "≈",
        known_residue:         "~",
        real_drift:            "🚨",
        quiet_window_skip:     "⏸",
        pg_only_reference:     "·",
      }[r.classification] || "?";
      const sheetsStr = r.sheetsLive == null ? "  (n/a)" : String(r.sheetsLive).padStart(7);
      const driftStr  = r.sheetsLive == null ? "  (n/a)" : ((r.drift > 0 ? "+" : "") + r.drift).padStart(7);
      console.log(`  ${tag}  ${r.tab.padEnd(22)} PG-live=${String(r.pgLive).padStart(7)}  Sheets-live=${sheetsStr}  drift=${driftStr}  ${r.classification.padEnd(22)} ${r.modeNote || ""}`);
    }
  }
  console.log("");

  console.log("CHECK 2 - silent-gap detector (invoice_submissions with 0 ai_line_items)");
  console.log("────────────────────────────────────────────────────────────────────────");
  let c2;
  try {
    c2 = await check2();
    console.log(`  Candidates (ai_scan_complete=TRUE, is_historical=FALSE, submitted_at ${LOOKBACK_DAYS}d..${GAP_MIN_AGE_HOURS}h ago): ${c2.candidates}`);
    console.log(`  Gaps (zero ai_line_items): ${c2.gaps.length}`);
    for (const g of c2.gaps.slice(0, 20)) {
      console.log(`    ${g.id}  vendor=${g.vendor_id || "(null)"}  acct=${g.account_key}  inv#=${g.invoice_number || "(n/a)"}  submitted=${g.submitted_at}`);
    }
    if (c2.gaps.length > 20) console.log(`    ... and ${c2.gaps.length - 20} more`);
  } catch (err) {
    console.log(`  ✗ CHECK 2 failed: ${err.message}`);
    c2 = { lookback: LOOKBACK_DAYS, candidates: 0, gaps: [] };
    // Tag this as an error in the digest by inserting an error row in c1.
    c1.push({ tab: "check2", status: "error", message: err.message });
  }
  console.log("");

  const digest = buildDigest(c1, c2);
  console.log("DIGEST");
  console.log("────────────────────────────────────────────────────────────────────────");
  console.log(digest.mrkdwn);
  console.log("");
  if (DRY_RUN) {
    console.log("(dry-run: not posting to Slack)");
  } else {
    await postSlack(SLACK_RECAP_WEBHOOK, digest.text, digest.mrkdwn);
    console.log(SLACK_RECAP_WEBHOOK
      ? "Posted to SLACK_RECAP_WEBHOOK."
      : "SLACK_RECAP_WEBHOOK not set; skipped.");
  }

  return { alarm: digest.alarm };
}

// CLI direct-run guard. When invoked as `node scripts/reconciliation-alarm.mjs ...`,
// run the alarm and exit with 0 (clean), 1 (real alarm), or 2 (fatal). When
// imported as a module (Railway cron tail), this block is skipped and the
// caller invokes runReconciliationAlarm() directly inside its own try/catch.
const isDirectRun = (() => {
  try {
    return process.argv[1]
      && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch { return false; }
})();

if (isDirectRun) {
  runReconciliationAlarm()
    .then((result) => process.exit(result.alarm ? 1 : 0))
    .catch((err) => {
      console.error("[recon] FATAL:", err.stack || err.message);
      process.exit(2);
    });
}
