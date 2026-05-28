import {
  readSheetSA,
  appendRowSA,
  updateCellSA,
  updateRangeSA,
  batchUpdateRangesSA,
  SHEET_IDS,
} from "@/lib/sheets";
import { isDualWrite, isReadFromPostgres } from "@/lib/cutover";
import { getServiceClient } from "@/lib/supabase";
import crypto from "node:crypto";

// ═══════════════════════════════════════════════════════════════
// VENDOR MODULE (Stage 1 module 5 PR 5.1 - DORMANT)
// ═══════════════════════════════════════════════════════════════
//
// Source: HUB / vendor_master (cols A-J) + vendor_accounts (cols A-X).
// PG schema: docs/migrations/pr-5-1-vendor-schema.sql (3 tables -
// vendors, vendor_accounts, vendor_aliases; per FINANCE_STACK_PLAN.md
// Section 2.2). RLS disabled; service-role only per Section 8 lock.
//
// DORMANT INFRASTRUCTURE: with cutover flags off (the default on
// merge), nothing in this file is called. invoiceActions.js still
// hits Sheets directly. PR 5.2 rewires the 13 vendor data-access
// sites to call these orchestrators. PR 5.3 backfills the 3 tables
// from Sheets and upgrades mergeVendors PG side from sequential
// 3-statement to a true BEGIN/COMMIT transaction.
//
// NAMING NOTE:
//   Sheets tab name "vendor_master" maps to PG table name "vendors".
//   The cutover.js DUAL_WRITE_TABLES / READ_FROM_POSTGRES flag uses
//   the SHEET tab name ("vendor_master") for consistency with other
//   modules' flag conventions. Sheet tabs "vendor_accounts" and
//   "vendor_aliases" map to PG tables of the same name.
//
// Public API (10 orchestrators - 8 shipped in PR 5.1 + getVendor +
// getVendorsForMatching added in PR 5.2):
//
//   Reads (5):
//     getVendorsForList(opts)          - paginated list for vendor admin UI
//     getVendorsForBootstrap(accountKey, opts) - active vendors for invoice tool
//     searchVendors(query, opts)       - fuzzy match typeahead
//     getVendor(vendorId, accountKey, opts) - single vendor by id (PR 5.2)
//     getVendorsForMatching(opts)      - all vendors + aliases for OCR fuzzy match (PR 5.2)
//
//   Writes (5):
//     upsertVendor(input)              - create/update vendor (F19a + F19b)
//     upsertVendorAccount(input)       - create/update account link (F19b)
//     deactivateVendorAccount(input)   - active=true/false flip
//     learnVendorAlias(input)          - alias learn (ON CONFLICT DO NOTHING)
//     mergeVendors(input)              - 3-step merge (sequential PG in 5.1,
//                                        atomic transaction in PR 5.3)
//
// F19a (vendor ID collision retry):
//   Today the vendor-add handler generates IDs as `${prefix}-${100-999}`
//   and retries up to 5 times on collision. upsertVendor lifts this
//   to the orchestrator level so both Sheets and PG see the SAME
//   generated ID for the SAME vendor. This is the same orchestrator-
//   level coordination pattern from PR #78 (submissions timestamp
//   drift fix).
//
// F19b (clientUuid idempotency):
//   vendor-add stores body.uuid in vendor_master col J and
//   vendor_accounts col X. Today the handler reads first and short-
//   circuits if a prior row exists. The PG path uses the
//   client_uuid UUID UNIQUE constraint to achieve the same with
//   INSERT ... ON CONFLICT DO NOTHING + a follow-up SELECT.
//
// CROSS-STORE COORDINATION:
//   upsertVendor generates vendorId ONCE at the orchestrator level
//   before dispatching to either adapter, so the Sheets row and the
//   PG row use identical IDs during dual-write.
//
// PLAINTEXT PORTAL CREDENTIALS (Q6 intentional design):
//   portal_username and portal_password are stored as plaintext TEXT
//   in both Sheets and PG. No new masking, redaction, or encryption
//   layer is added by this dataStore. This is intentional per Q6 and
//   the TEAM_KNOWLEDGE intentional-design list. Real exposure is the
//   API surface, not at-rest data; encryption adds zero risk
//   reduction at the current threat model. RLS/access-control
//   hardening is a separate Stage 2 effort.
//
// ALIAS NORMALIZATION:
//   On the Sheets path, aliases live as a pipe-separated string in
//   vendor_master col I (e.g. "Sysco Foods|Sysco Inc|SYSCO").
//   On the PG path, each alias is a row in vendor_aliases with the
//   alias_normalized GENERATED column powering the UNIQUE constraint
//   and the fuzzy-match lookup. learnVendorAlias preserves the
//   Sheets pipe-append behavior on the Sheets side and adds an
//   INSERT ... ON CONFLICT DO NOTHING on the PG side.

// ───────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────

const VENDOR_MASTER_TAB   = "vendor_master";
const VENDOR_ACCOUNTS_TAB = "vendor_accounts";
const VENDOR_ALIASES_TAB  = "vendor_aliases"; // PG-only; no Sheet tab exists

const VENDOR_ID_RETRY_LIMIT = 5;          // F19a
const VENDOR_ID_SUFFIX_MIN  = 100;
const VENDOR_ID_SUFFIX_MAX  = 999;
const VENDOR_SEARCH_LIMIT   = 20;

// Sheet positional indices (0-indexed)
const VM_IDX = {
  vendorId:        0,  // A
  name:            1,  // B
  category:        2,  // C
  website:         3,  // D
  notes:           4,  // E
  createdBy:       5,  // F
  createdAt:       6,  // G
  // H (lastInvoiceDate) dropped per Q4 - DEAD col
  aliases:         8,  // I (pipe-separated string)
  clientUuid:      9,  // J (F19b)
};

const VA_IDX = {
  rowId:              0,   // A (synthetic legacy id)
  vendorId:           1,   // B
  accountKey:         2,   // C
  customerAccountNum: 3,   // D
  salesRepName:       4,   // E
  salesRepPhone:      5,   // F
  salesRepEmail:      6,   // G
  deliveryDays:       7,   // H
  cutoffTime:         8,   // I
  deliveryMethod:     9,   // J
  portalUrl:          10,  // K
  portalUsername:     11,  // L
  portalPassword:     12,  // M
  // N/O/P (contactName/email/phone) dropped per audit DEAD verdict
  paymentTerms:       16,  // Q
  minOrder:           17,  // R
  active:             18,  // S
  createdBy:          19,  // T
  createdAt:          20,  // U
  // V (reserved/unused) DEAD col
  accountNotes:       22,  // W
  clientUuid:         23,  // X (F19b)
};

// ───────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────

function sheetActiveToBool(s) {
  return String(s || "TRUE").trim().toUpperCase() !== "FALSE";
}
function boolToSheetActive(b) {
  return b ? "TRUE" : "FALSE";
}

// Normalize an alias the same way the PG generated column does.
// Mirrors: lower(regexp_replace(alias_text, '[^a-zA-Z0-9 ]', '', 'g'))
function normalizeAlias(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "");
}

// F19a: generate a candidate vendor ID. Caller retries on collision.
function makeVendorIdCandidate(name) {
  const prefix = String(name || "").trim().substring(0, 3).toUpperCase().replace(/[^A-Z]/g, "X");
  const range = VENDOR_ID_SUFFIX_MAX - VENDOR_ID_SUFFIX_MIN + 1;
  const suffix = Math.floor(Math.random() * range) + VENDOR_ID_SUFFIX_MIN;
  return `${prefix}-${suffix}`;
}

// Build the vendor_accounts synthetic rowId (col A) the same way the
// vendor-add handler does today. Preserved for byte-equal Sheets
// behavior; not read back as a key, only stored for legacy parity.
function makeAccountRowId(vendorId, accountKey) {
  return `${vendorId}_${String(accountKey || "").split(" - ").slice(0, 2).join("-")}`;
}

// Split a pipe-separated alias string into an array, trimmed and
// non-empty. Reverse of arr.join("|").
function splitAliases(piped) {
  return String(piped || "")
    .split("|")
    .map((a) => a.trim())
    .filter(Boolean);
}

// ═══════════════════════════════════════════════════════════════
// SHEETS ADAPTERS
// ═══════════════════════════════════════════════════════════════
//
// All Sheets adapters mirror the current invoiceActions.js logic
// 1:1 so the rewire in PR 5.2 is byte-identical. Adapters speak the
// Sheets-native shape; orchestrators expose the canonical shape.

// ── Reads ──

async function readVendorListSheets(opts = {}) {
  const {
    accountKey, allAccounts = false, category, search,
    page = 1, pageSize = 10, showInactive = false,
  } = opts;

  const [masterResult, accountResult] = await Promise.all([
    readSheetSA(SHEET_IDS.HUB, VENDOR_MASTER_TAB),
    readSheetSA(SHEET_IDS.HUB, VENDOR_ACCOUNTS_TAB),
  ]);

  // Build account link map keyed by vendorId
  const linkMap = {};
  for (const r of accountResult.rows) {
    const vId = String(r[VA_IDX.vendorId] || "").trim();
    if (!vId) continue;
    if (!linkMap[vId]) linkMap[vId] = [];
    linkMap[vId].push({
      rowId:              String(r[VA_IDX.rowId] || "").trim(),
      accountKey:         String(r[VA_IDX.accountKey] || "").trim(),
      customerAccountNum: String(r[VA_IDX.customerAccountNum] || "").trim(),
      salesRepName:       String(r[VA_IDX.salesRepName] || "").trim(),
      salesRepPhone:      String(r[VA_IDX.salesRepPhone] || "").trim(),
      salesRepEmail:      String(r[VA_IDX.salesRepEmail] || "").trim(),
      deliveryDays:       String(r[VA_IDX.deliveryDays] || "").trim(),
      cutoffTime:         String(r[VA_IDX.cutoffTime] || "").trim(),
      deliveryMethod:     String(r[VA_IDX.deliveryMethod] || "").trim(),
      portalUrl:          String(r[VA_IDX.portalUrl] || "").trim(),
      portalUsername:     String(r[VA_IDX.portalUsername] || "").trim(),
      portalPassword:     String(r[VA_IDX.portalPassword] || "").trim(),
      paymentTerms:       String(r[VA_IDX.paymentTerms] || "").trim(),
      minOrder:           String(r[VA_IDX.minOrder] || "").trim(),
      active:             sheetActiveToBool(r[VA_IDX.active]),
      createdBy:          String(r[VA_IDX.createdBy] || "").trim(),
      createdAt:          String(r[VA_IDX.createdAt] || "").trim(),
      accountNotes:       String(r[VA_IDX.accountNotes] || "").trim(),
    });
  }

  let vendors = masterResult.rows
    .filter((r) => r[VM_IDX.vendorId])
    .map((r) => {
      const vendorId    = String(r[VM_IDX.vendorId]).trim();
      const links       = linkMap[vendorId] || [];
      const accountLink = accountKey ? links.find((l) => l.accountKey === accountKey) : null;
      return {
        vendorId,
        name:               String(r[VM_IDX.name] || "").trim(),
        category:           String(r[VM_IDX.category] || "").trim(),
        website:            String(r[VM_IDX.website] || "").trim(),
        notes:              String(r[VM_IDX.notes] || "").trim(),
        createdBy:          String(r[VM_IDX.createdBy] || "").trim(),
        createdAt:          String(r[VM_IDX.createdAt] || "").trim(),
        customerAccountNum: accountLink?.customerAccountNum || "",
        salesRepName:       accountLink?.salesRepName       || "",
        salesRepPhone:      accountLink?.salesRepPhone      || "",
        salesRepEmail:      accountLink?.salesRepEmail      || "",
        deliveryDays:       accountLink?.deliveryDays       || "",
        cutoffTime:         accountLink?.cutoffTime         || "",
        deliveryMethod:     accountLink?.deliveryMethod     || "",
        portalUrl:          accountLink?.portalUrl          || "",
        portalUsername:     accountLink?.portalUsername     || "",
        portalPassword:     accountLink?.portalPassword     || "",
        paymentTerms:       accountLink?.paymentTerms       || "",
        minOrder:           accountLink?.minOrder           || "",
        accountNotes:       accountLink?.accountNotes       || "",
        active:             accountLink ? accountLink.active : true,
        linkedAccounts:     links.map((l) => l.accountKey),
      };
    });

  if (!allAccounts && accountKey) {
    vendors = vendors.filter((v) => (linkMap[v.vendorId] || []).some((l) => l.accountKey === accountKey));
  }

  vendors = vendors.filter((v) => showInactive ? !v.active : v.active !== false);
  if (category && category !== "All") vendors = vendors.filter((v) => v.category === category);
  if (search) {
    const q = String(search).toLowerCase();
    vendors = vendors.filter((v) => v.name.toLowerCase().includes(q));
  }

  const inactiveCount = accountKey
    ? masterResult.rows.filter((r) => {
        const vId  = String(r[VM_IDX.vendorId] || "").trim();
        const link = (linkMap[vId] || []).find((l) => l.accountKey === accountKey);
        return link && !link.active;
      }).length
    : 0;

  const total   = vendors.length;
  const start   = (page - 1) * pageSize;
  const paged   = vendors.slice(start, start + pageSize);
  const hasMore = start + pageSize < total;

  return { vendors: paged, total, inactiveCount, hasMore, page, pageSize };
}

async function readVendorBootstrapSheets(accountKey) {
  const [vendorMasterRaw, vendorAccountsRaw] = await Promise.all([
    readSheetSA(SHEET_IDS.HUB, VENDOR_MASTER_TAB),
    readSheetSA(SHEET_IDS.HUB, VENDOR_ACCOUNTS_TAB),
  ]);

  const vendorMaster = vendorMasterRaw.rows
    .map((r) => ({
      vendorId: String(r[VM_IDX.vendorId] || "").trim(),
      name:     String(r[VM_IDX.name] || "").trim(),
      category: String(r[VM_IDX.category] || "").trim(),
      website:  String(r[VM_IDX.website] || "").trim(),
      notes:    String(r[VM_IDX.notes] || "").trim(),
    }))
    .filter((v) => v.vendorId && v.name);

  // Enriched account links (PR 5.2): handler needs the full account-link
  // fields, not just the (vendorId, accountKey) pair the PR 5.1 stub
  // returned. The bootstrap response shape is determined by the handler.
  const accountVendors = vendorAccountsRaw.rows
    .filter((r) => {
      const acct = String(r[VA_IDX.accountKey] || "").trim();
      const active = String(r[VA_IDX.active] || "TRUE").trim().toUpperCase();
      return acct === accountKey && active !== "FALSE";
    })
    .map((r) => ({
      rowId:              String(r[VA_IDX.rowId] || "").trim(),
      vendorId:           String(r[VA_IDX.vendorId] || "").trim(),
      accountKey:         String(r[VA_IDX.accountKey] || "").trim(),
      customerAccountNum: String(r[VA_IDX.customerAccountNum] || "").trim(),
      salesRepName:       String(r[VA_IDX.salesRepName] || "").trim(),
      salesRepPhone:      String(r[VA_IDX.salesRepPhone] || "").trim(),
      salesRepEmail:      String(r[VA_IDX.salesRepEmail] || "").trim(),
      deliveryDays:       String(r[VA_IDX.deliveryDays] || "").trim(),
      cutoffTime:         String(r[VA_IDX.cutoffTime] || "").trim(),
      deliveryMethod:     String(r[VA_IDX.deliveryMethod] || "").trim(),
      portalUrl:          String(r[VA_IDX.portalUrl] || "").trim(),
      portalUsername:     String(r[VA_IDX.portalUsername] || "").trim(),  // Q6 plaintext intentional
      portalPassword:     String(r[VA_IDX.portalPassword] || "").trim(),  // Q6 plaintext intentional
      paymentTerms:       String(r[VA_IDX.paymentTerms] || "").trim(),
      minOrder:           String(r[VA_IDX.minOrder] || "").trim(),
    }));

  return { vendorMaster, accountVendors };
}

async function readVendorSearchSheets(query) {
  const q = String(query || "").toLowerCase().trim();
  const { rows } = await readSheetSA(SHEET_IDS.HUB, VENDOR_MASTER_TAB);
  return rows
    .map((r) => ({
      vendorId: String(r[VM_IDX.vendorId] || "").trim(),
      name:     String(r[VM_IDX.name] || "").trim(),
      category: String(r[VM_IDX.category] || "").trim(),
    }))
    .filter((v) => v.name && v.name.toLowerCase().includes(q))
    .slice(0, VENDOR_SEARCH_LIMIT);
}

// Single-vendor read with optional accountKey scope.
// Returns null if vendor not found. If accountKey provided, returns
// the vendor with the matching account_link fields populated; if not,
// vendor-only fields are populated and account-link fields are blank.
// Read all vendors with their aliases for the OCR fuzzy matcher.
// Returns the canonical shape that fuzzyMatchVendor (in
// src/lib/vendorMatching.js) consumes: [{ vendorId, name, category,
// aliases (pipe-string) }]. Aliases are intentionally returned as
// the pipe-separated string so the matcher's internal split/normalize
// logic stays unchanged across the Sheets vs PG path.
async function readVendorsForMatchingSheets() {
  const { rows } = await readSheetSA(SHEET_IDS.HUB, VENDOR_MASTER_TAB);
  return rows
    .map((r) => ({
      vendorId: String(r[VM_IDX.vendorId] || "").trim(),
      name:     String(r[VM_IDX.name] || "").trim(),
      category: String(r[VM_IDX.category] || "").trim(),
      aliases:  String(r[VM_IDX.aliases] || "").trim(),
    }))
    .filter((v) => v.vendorId && v.name);
}

async function readVendorByIdSheets(vendorId, accountKey) {
  const [masterResult, accountResult] = await Promise.all([
    readSheetSA(SHEET_IDS.HUB, VENDOR_MASTER_TAB),
    readSheetSA(SHEET_IDS.HUB, VENDOR_ACCOUNTS_TAB),
  ]);

  const masterRow = masterResult.rows.find((r) => String(r[VM_IDX.vendorId] || "").trim() === vendorId);
  if (!masterRow) return null;

  const allLinks    = accountResult.rows.filter((r) => String(r[VA_IDX.vendorId] || "").trim() === vendorId);
  const accountLink = accountKey ? allLinks.find((r) => String(r[VA_IDX.accountKey] || "").trim() === accountKey) : null;

  return {
    vendorId:           String(masterRow[VM_IDX.vendorId] || "").trim(),
    name:               String(masterRow[VM_IDX.name] || "").trim(),
    category:           String(masterRow[VM_IDX.category] || "").trim(),
    website:            String(masterRow[VM_IDX.website] || "").trim(),
    notes:              String(masterRow[VM_IDX.notes] || "").trim(),
    createdBy:          String(masterRow[VM_IDX.createdBy] || "").trim(),
    createdAt:          String(masterRow[VM_IDX.createdAt] || "").trim(),
    customerAccountNum: String(accountLink?.[VA_IDX.customerAccountNum] || "").trim(),
    salesRepName:       String(accountLink?.[VA_IDX.salesRepName] || "").trim(),
    salesRepPhone:      String(accountLink?.[VA_IDX.salesRepPhone] || "").trim(),
    salesRepEmail:      String(accountLink?.[VA_IDX.salesRepEmail] || "").trim(),
    deliveryDays:       String(accountLink?.[VA_IDX.deliveryDays] || "").trim(),
    cutoffTime:         String(accountLink?.[VA_IDX.cutoffTime] || "").trim(),
    deliveryMethod:     String(accountLink?.[VA_IDX.deliveryMethod] || "").trim(),
    portalUrl:          String(accountLink?.[VA_IDX.portalUrl] || "").trim(),
    portalUsername:     String(accountLink?.[VA_IDX.portalUsername] || "").trim(),
    portalPassword:     String(accountLink?.[VA_IDX.portalPassword] || "").trim(),
    paymentTerms:       String(accountLink?.[VA_IDX.paymentTerms] || "").trim(),
    minOrder:           String(accountLink?.[VA_IDX.minOrder] || "").trim(),
    accountNotes:       String(accountLink?.[VA_IDX.accountNotes] || "").trim(),
    active:             accountLink ? sheetActiveToBool(accountLink[VA_IDX.active]) : true,
    linkedAccounts:     allLinks.map((r) => String(r[VA_IDX.accountKey] || "").trim()),
  };
}

// ── Writes ──

// F19a: read existing IDs, try a random candidate up to N times.
// Caller (orchestrator) calls this ONCE so both adapters see the
// same generated vendorId. Returns null if no unique ID found.
async function generateUniqueVendorIdSheets(name) {
  const { rows } = await readSheetSA(SHEET_IDS.HUB, VENDOR_MASTER_TAB);
  const existing = new Set(rows.map((r) => String(r[VM_IDX.vendorId] || "").trim()).filter(Boolean));
  for (let attempt = 0; attempt < VENDOR_ID_RETRY_LIMIT; attempt++) {
    const candidate = makeVendorIdCandidate(name);
    if (!existing.has(candidate)) return candidate;
  }
  return null;
}

// F19b: check whether a prior row with this clientUuid exists in
// vendor_master. Returns the existing vendorId or null.
async function findVendorByClientUuidSheets(clientUuid) {
  if (!clientUuid) return null;
  const { rows } = await readSheetSA(SHEET_IDS.HUB, VENDOR_MASTER_TAB);
  const prior = rows.find((r) => String(r[VM_IDX.clientUuid] || "") === clientUuid);
  if (!prior) return null;
  return {
    vendorId:   String(prior[VM_IDX.vendorId] || "").trim(),
    vendorName: String(prior[VM_IDX.name] || "").trim(),
  };
}

async function upsertVendorSheets(input) {
  const { rows } = await readSheetSA(SHEET_IDS.HUB, VENDOR_MASTER_TAB);
  const rowIndex = rows.findIndex((r) => String(r[VM_IDX.vendorId] || "").trim() === input.vendorId);

  if (rowIndex === -1) {
    // Create
    const masterRow = [
      input.vendorId,                                                // A
      String(input.name || "").trim(),                               // B
      input.category || "",                                          // C
      String(input.website || "").trim(),                            // D
      String(input.notes || "").trim(),                              // E
      input.createdBy || "",                                         // F
      input.createdAt || new Date().toISOString(),                   // G
      "",                                                            // H (DEAD)
      input.aliases !== undefined ? String(input.aliases).trim() : "", // I
      input.clientUuid || "",                                        // J (F19b)
    ];
    const result = await appendRowSA(SHEET_IDS.HUB, VENDOR_MASTER_TAB, masterRow);
    if (!result.success) {
      throw new Error(`[dataStore.vendor] upsertVendorSheets create failed: ${result.error || "unknown"}`);
    }
  } else {
    // Update - mirror handleVendorMasterUpdate field set (B,C,D,E,I)
    const sheetRow = rowIndex + 2;
    const cols = ["B", "C", "D", "E", "I"];
    const values = [
      String(input.name || "").trim(),
      input.category || "",
      String(input.website || "").trim(),
      String(input.notes || "").trim(),
      input.aliases !== undefined ? String(input.aliases).trim() : String(rows[rowIndex][VM_IDX.aliases] || "").trim(),
    ];
    await Promise.all(cols.map((col, i) =>
      updateCellSA(SHEET_IDS.HUB, `${VENDOR_MASTER_TAB}!${col}${sheetRow}`, values[i])
    ));
  }
}

async function upsertVendorAccountSheets(input) {
  const { rows } = await readSheetSA(SHEET_IDS.HUB, VENDOR_ACCOUNTS_TAB);
  const rowIndex = rows.findIndex(
    (r) => String(r[VA_IDX.vendorId] || "").trim() === input.vendorId
      && String(r[VA_IDX.accountKey] || "").trim() === input.accountKey
  );

  if (rowIndex === -1) {
    // Create
    const rowId = makeAccountRowId(input.vendorId, input.accountKey);
    const accountRow = [
      rowId,                                                           // A
      input.vendorId,                                                  // B
      input.accountKey,                                                // C
      input.customerAccountNum || "",                                  // D
      input.salesRepName       || "",                                  // E
      input.salesRepPhone      || "",                                  // F
      input.salesRepEmail      || "",                                  // G
      input.deliveryDays       || "",                                  // H
      input.cutoffTime         || "",                                  // I
      input.deliveryMethod     || "",                                  // J
      input.portalUrl          || "",                                  // K
      input.portalUsername     || "",                                  // L
      input.portalPassword     || "",                                  // M
      "",                                                              // N (DEAD)
      "",                                                              // O (DEAD)
      "",                                                              // P (DEAD)
      input.paymentTerms       || "",                                  // Q
      input.minOrder           || "",                                  // R
      input.active === undefined ? "TRUE" : boolToSheetActive(input.active), // S
      input.createdBy          || "",                                  // T
      input.createdAt          || new Date().toISOString(),            // U
      "",                                                              // V (DEAD)
      input.accountNotes       || "",                                  // W
      input.clientUuid         || "",                                  // X (F19b)
    ];
    const result = await appendRowSA(SHEET_IDS.HUB, VENDOR_ACCOUNTS_TAB, accountRow);
    if (!result.success) {
      throw new Error(`[dataStore.vendor] upsertVendorAccountSheets create failed: ${result.error || "unknown"}`);
    }
  } else {
    // Update D-R contiguous range + W separately (mirrors handleVendorUpdate)
    const sheetRow = rowIndex + 2;
    const existing = rows[rowIndex];
    const dRange = [[
      input.customerAccountNum ?? existing[VA_IDX.customerAccountNum] ?? "",
      input.salesRepName       ?? existing[VA_IDX.salesRepName]       ?? "",
      input.salesRepPhone      ?? existing[VA_IDX.salesRepPhone]      ?? "",
      input.salesRepEmail      ?? existing[VA_IDX.salesRepEmail]      ?? "",
      input.deliveryDays       ?? existing[VA_IDX.deliveryDays]       ?? "",
      input.cutoffTime         ?? existing[VA_IDX.cutoffTime]         ?? "",
      input.deliveryMethod     ?? existing[VA_IDX.deliveryMethod]     ?? "",
      input.portalUrl          ?? existing[VA_IDX.portalUrl]          ?? "",
      input.portalUsername     ?? existing[VA_IDX.portalUsername]     ?? "",
      input.portalPassword     ?? existing[VA_IDX.portalPassword]     ?? "",
      // N/O/P are dead cols - preserve existing values rather than blanking
      existing[13] ?? "",
      existing[14] ?? "",
      existing[15] ?? "",
      input.paymentTerms       ?? existing[VA_IDX.paymentTerms]       ?? "",
      input.minOrder           ?? existing[VA_IDX.minOrder]           ?? "",
    ]];
    await Promise.all([
      updateRangeSA(SHEET_IDS.HUB, `${VENDOR_ACCOUNTS_TAB}!D${sheetRow}:R${sheetRow}`, dRange),
      updateCellSA(SHEET_IDS.HUB, `${VENDOR_ACCOUNTS_TAB}!W${sheetRow}`, input.accountNotes ?? existing[VA_IDX.accountNotes] ?? ""),
    ]);
  }
}

async function deactivateVendorAccountSheets(vendorId, accountKey, active) {
  const { rows } = await readSheetSA(SHEET_IDS.HUB, VENDOR_ACCOUNTS_TAB);
  const rowIndex = rows.findIndex(
    (r) => String(r[VA_IDX.vendorId] || "").trim() === vendorId
      && String(r[VA_IDX.accountKey] || "").trim() === accountKey
  );
  if (rowIndex === -1) {
    throw new Error(`[dataStore.vendor] deactivateVendorAccountSheets: account link not found (${vendorId}/${accountKey})`);
  }
  await updateCellSA(SHEET_IDS.HUB, `${VENDOR_ACCOUNTS_TAB}!S${rowIndex + 2}`, boolToSheetActive(active));
}

async function learnVendorAliasSheets(vendorId, ocrName) {
  // Mirror the existing learnVendorAlias logic: read row, check
  // primary name match, check existing alias list, pipe-append.
  if (!vendorId || !ocrName) return { learned: false };
  const { rows } = await readSheetSA(SHEET_IDS.HUB, VENDOR_MASTER_TAB);
  const rowIndex = rows.findIndex((r) => String(r[VM_IDX.vendorId] || "").trim() === vendorId);
  if (rowIndex === -1) return { learned: false };

  const primaryName = String(rows[rowIndex][VM_IDX.name] || "").trim().toLowerCase();
  const ocrClean = String(ocrName).trim();
  const ocrLower = ocrClean.toLowerCase();
  if (ocrLower === primaryName) return { learned: false };

  const existingAliases = String(rows[rowIndex][VM_IDX.aliases] || "").trim();
  const aliasList = splitAliases(existingAliases);
  if (aliasList.some((a) => a.toLowerCase() === ocrLower)) return { learned: false };

  const updated = aliasList.length > 0 ? `${existingAliases}|${ocrClean}` : ocrClean;
  const sheetRow = rowIndex + 2;
  await updateCellSA(SHEET_IDS.HUB, `${VENDOR_MASTER_TAB}!I${sheetRow}`, updated);
  return { learned: true };
}

async function mergeVendorsSheets(keeperId, dupeIds) {
  // Mirror handleVendorMerge: 3 sequential batched updates.
  const { rows: masterRows } = await readSheetSA(SHEET_IDS.HUB, VENDOR_MASTER_TAB);

  // 1. Reassign vendor_accounts.vendor_id from dupes -> keeper
  const { rows: acctRows } = await readSheetSA(SHEET_IDS.HUB, VENDOR_ACCOUNTS_TAB);
  const acctBatchData = [];
  acctRows.forEach((row, i) => {
    if (i === 0) return; // skip header
    const rowVendorId = String(row[VA_IDX.vendorId] || "").trim();
    if (dupeIds.includes(rowVendorId)) {
      acctBatchData.push({ range: `${VENDOR_ACCOUNTS_TAB}!B${i + 2}`, values: [[keeperId]] });
    }
  });
  if (acctBatchData.length > 0) {
    await batchUpdateRangesSA(SHEET_IDS.HUB, acctBatchData);
  }

  // 2. Soft-delete dupes (blank B/C/D, mark E as "DELETED") + collect dupe names
  const dupeNames = [];
  const masterBatchData = [];
  masterRows.forEach((row, i) => {
    if (i === 0) return;
    const rowVendorId = String(row[VM_IDX.vendorId] || "").trim();
    if (dupeIds.includes(rowVendorId)) {
      const dupeName = String(row[VM_IDX.name] || "").trim();
      if (dupeName) dupeNames.push(dupeName);
      masterBatchData.push({
        range: `${VENDOR_MASTER_TAB}!B${i + 2}:E${i + 2}`,
        values: [["", "", "", "DELETED"]],
      });
    }
  });
  if (masterBatchData.length > 0) {
    await batchUpdateRangesSA(SHEET_IDS.HUB, masterBatchData);
  }

  // 3. Append dupe names as aliases on keeper row (pipe string)
  if (dupeNames.length > 0) {
    const keeperIndex = masterRows.findIndex((r) => String(r[VM_IDX.vendorId] || "").trim() === keeperId);
    if (keeperIndex !== -1) {
      const keeperSheetRow = keeperIndex + 2;
      const existingAliases = String(masterRows[keeperIndex][VM_IDX.aliases] || "").trim();
      const aliasParts = splitAliases(existingAliases);
      for (const dn of dupeNames) {
        if (!aliasParts.some((a) => a.toLowerCase() === dn.toLowerCase())) {
          aliasParts.push(dn);
        }
      }
      await updateCellSA(SHEET_IDS.HUB, `${VENDOR_MASTER_TAB}!I${keeperSheetRow}`, aliasParts.join("|"));
    }
  }

  return {
    accountRowsReassigned: acctBatchData.length,
    vendorRowsDeleted:     masterBatchData.length,
    aliasesAdded:          dupeNames,
  };
}

// ═══════════════════════════════════════════════════════════════
// POSTGRES ADAPTERS
// ═══════════════════════════════════════════════════════════════
//
// PG adapters use the new vendors / vendor_accounts / vendor_aliases
// tables per docs/migrations/pr-5-1-vendor-schema.sql. Sheet
// pipe-aliases land in vendor_aliases rows on the backfill (PR 5.3).

// ── Reads ──

async function readVendorListPostgres(opts = {}) {
  const {
    accountKey, allAccounts = false, category, search,
    page = 1, pageSize = 10, showInactive = false,
  } = opts;

  const supabase = getServiceClient();
  // Fetch vendors (LIVE rows) + vendor_accounts in parallel.
  // Filter at JS level for byte-equal output to Sheets path.
  const [vendorsRes, accountsRes] = await Promise.all([
    supabase.from("vendors")
      .select("id, name, category, website, notes, created_by, created_at")
      .is("deleted_at", null),
    supabase.from("vendor_accounts")
      .select("id, vendor_id, account_key, customer_account_num, sales_rep_name, " +
              "sales_rep_phone, sales_rep_email, delivery_days, cutoff_time, " +
              "delivery_method, portal_url, portal_username, portal_password, " +
              "payment_terms, min_order, active, created_by, created_at, account_notes"),
  ]);
  if (vendorsRes.error) throw new Error(`[dataStore.vendor.pg] readVendorList vendors: ${vendorsRes.error.message}`);
  if (accountsRes.error) throw new Error(`[dataStore.vendor.pg] readVendorList accounts: ${accountsRes.error.message}`);

  const linkMap = {};
  for (const r of accountsRes.data || []) {
    const vId = r.vendor_id;
    if (!linkMap[vId]) linkMap[vId] = [];
    linkMap[vId].push({
      accountKey:         r.account_key,
      customerAccountNum: r.customer_account_num || "",
      salesRepName:       r.sales_rep_name || "",
      salesRepPhone:      r.sales_rep_phone || "",
      salesRepEmail:      r.sales_rep_email || "",
      deliveryDays:       r.delivery_days || "",
      cutoffTime:         r.cutoff_time || "",
      deliveryMethod:     r.delivery_method || "",
      portalUrl:          r.portal_url || "",
      portalUsername:     r.portal_username || "",  // Q6 plaintext intentional
      portalPassword:     r.portal_password || "",  // Q6 plaintext intentional
      paymentTerms:       r.payment_terms || "",
      minOrder:           r.min_order || "",
      active:             !!r.active,
      createdBy:          r.created_by || "",
      createdAt:          r.created_at || "",
      accountNotes:       r.account_notes || "",
    });
  }

  let vendors = (vendorsRes.data || []).map((v) => {
    const links = linkMap[v.id] || [];
    const accountLink = accountKey ? links.find((l) => l.accountKey === accountKey) : null;
    return {
      vendorId:           v.id,
      name:               v.name || "",
      category:           v.category || "",
      website:            v.website || "",
      notes:              v.notes || "",
      createdBy:          v.created_by || "",
      createdAt:          v.created_at || "",
      customerAccountNum: accountLink?.customerAccountNum || "",
      salesRepName:       accountLink?.salesRepName       || "",
      salesRepPhone:      accountLink?.salesRepPhone      || "",
      salesRepEmail:      accountLink?.salesRepEmail      || "",
      deliveryDays:       accountLink?.deliveryDays       || "",
      cutoffTime:         accountLink?.cutoffTime         || "",
      deliveryMethod:     accountLink?.deliveryMethod     || "",
      portalUrl:          accountLink?.portalUrl          || "",
      portalUsername:     accountLink?.portalUsername     || "",
      portalPassword:     accountLink?.portalPassword     || "",
      paymentTerms:       accountLink?.paymentTerms       || "",
      minOrder:           accountLink?.minOrder           || "",
      accountNotes:       accountLink?.accountNotes       || "",
      active:             accountLink ? accountLink.active : true,
      linkedAccounts:     links.map((l) => l.accountKey),
    };
  });

  if (!allAccounts && accountKey) {
    vendors = vendors.filter((v) => (linkMap[v.vendorId] || []).some((l) => l.accountKey === accountKey));
  }
  vendors = vendors.filter((v) => showInactive ? !v.active : v.active !== false);
  if (category && category !== "All") vendors = vendors.filter((v) => v.category === category);
  if (search) {
    const q = String(search).toLowerCase();
    vendors = vendors.filter((v) => v.name.toLowerCase().includes(q));
  }

  const inactiveCount = accountKey
    ? (vendorsRes.data || []).filter((v) => {
        const link = (linkMap[v.id] || []).find((l) => l.accountKey === accountKey);
        return link && !link.active;
      }).length
    : 0;

  const total   = vendors.length;
  const start   = (page - 1) * pageSize;
  const paged   = vendors.slice(start, start + pageSize);
  const hasMore = start + pageSize < total;

  return { vendors: paged, total, inactiveCount, hasMore, page, pageSize };
}

async function readVendorBootstrapPostgres(accountKey) {
  const supabase = getServiceClient();
  const [vendorsRes, accountsRes] = await Promise.all([
    supabase.from("vendors")
      .select("id, name, category, website, notes")
      .is("deleted_at", null),
    supabase.from("vendor_accounts")
      .select("id, vendor_id, account_key, customer_account_num, sales_rep_name, " +
              "sales_rep_phone, sales_rep_email, delivery_days, cutoff_time, " +
              "delivery_method, portal_url, portal_username, portal_password, " +
              "payment_terms, min_order, active")
      .eq("account_key", accountKey)
      .eq("active", true),
  ]);
  if (vendorsRes.error) throw new Error(`[dataStore.vendor.pg] readVendorBootstrap vendors: ${vendorsRes.error.message}`);
  if (accountsRes.error) throw new Error(`[dataStore.vendor.pg] readVendorBootstrap accounts: ${accountsRes.error.message}`);

  const vendorMaster = (vendorsRes.data || [])
    .map((v) => ({
      vendorId: v.id,
      name:     v.name || "",
      category: v.category || "",
      website:  v.website || "",
      notes:    v.notes || "",
    }))
    .filter((v) => v.vendorId && v.name);

  // Enriched shape (PR 5.2): matches the Sheets adapter return.
  // PG has no Sheets-only rowId column; use the PG UUID as the
  // equivalent stable identifier.
  const accountVendors = (accountsRes.data || []).map((r) => ({
    rowId:              r.id,
    vendorId:           r.vendor_id,
    accountKey:         r.account_key,
    customerAccountNum: r.customer_account_num || "",
    salesRepName:       r.sales_rep_name || "",
    salesRepPhone:      r.sales_rep_phone || "",
    salesRepEmail:      r.sales_rep_email || "",
    deliveryDays:       r.delivery_days || "",
    cutoffTime:         r.cutoff_time || "",
    deliveryMethod:     r.delivery_method || "",
    portalUrl:          r.portal_url || "",
    portalUsername:     r.portal_username || "",  // Q6 plaintext intentional
    portalPassword:     r.portal_password || "",  // Q6 plaintext intentional
    paymentTerms:       r.payment_terms || "",
    minOrder:           r.min_order || "",
  }));

  return { vendorMaster, accountVendors };
}

async function readVendorSearchPostgres(query) {
  const q = String(query || "").toLowerCase().trim();
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("vendors")
    .select("id, name, category")
    .is("deleted_at", null)
    .ilike("name", `%${q}%`)
    .limit(VENDOR_SEARCH_LIMIT);
  if (error) throw new Error(`[dataStore.vendor.pg] readVendorSearch: ${error.message}`);
  return (data || []).map((v) => ({
    vendorId: v.id,
    name:     v.name || "",
    category: v.category || "",
  }));
}

async function readVendorsForMatchingPostgres() {
  const supabase = getServiceClient();
  // Fetch vendors + their aliases. Reconstruct the pipe-separated
  // alias string so the canonical return shape matches Sheets path
  // and the matcher's split logic is path-agnostic.
  const [vendorsRes, aliasesRes] = await Promise.all([
    supabase.from("vendors")
      .select("id, name, category")
      .is("deleted_at", null),
    supabase.from("vendor_aliases")
      .select("vendor_id, alias_text"),
  ]);
  if (vendorsRes.error) throw new Error(`[dataStore.vendor.pg] readVendorsForMatching vendors: ${vendorsRes.error.message}`);
  if (aliasesRes.error) throw new Error(`[dataStore.vendor.pg] readVendorsForMatching aliases: ${aliasesRes.error.message}`);

  const aliasesByVendor = {};
  for (const a of aliasesRes.data || []) {
    if (!aliasesByVendor[a.vendor_id]) aliasesByVendor[a.vendor_id] = [];
    aliasesByVendor[a.vendor_id].push(String(a.alias_text || "").trim());
  }

  return (vendorsRes.data || []).map((v) => ({
    vendorId: v.id,
    name:     v.name || "",
    category: v.category || "",
    aliases:  (aliasesByVendor[v.id] || []).filter(Boolean).join("|"),
  }));
}

async function readVendorByIdPostgres(vendorId, accountKey) {
  const supabase = getServiceClient();
  const [vendorRes, accountsRes] = await Promise.all([
    supabase.from("vendors")
      .select("id, name, category, website, notes, created_by, created_at")
      .eq("id", vendorId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase.from("vendor_accounts")
      .select("account_key, customer_account_num, sales_rep_name, sales_rep_phone, " +
              "sales_rep_email, delivery_days, cutoff_time, delivery_method, " +
              "portal_url, portal_username, portal_password, payment_terms, " +
              "min_order, account_notes, active")
      .eq("vendor_id", vendorId),
  ]);
  if (vendorRes.error) throw new Error(`[dataStore.vendor.pg] readVendorById vendor: ${vendorRes.error.message}`);
  if (accountsRes.error) throw new Error(`[dataStore.vendor.pg] readVendorById accounts: ${accountsRes.error.message}`);
  if (!vendorRes.data) return null;

  const v = vendorRes.data;
  const allLinks = accountsRes.data || [];
  const accountLink = accountKey ? allLinks.find((r) => r.account_key === accountKey) : null;

  return {
    vendorId:           v.id,
    name:               v.name || "",
    category:           v.category || "",
    website:            v.website || "",
    notes:              v.notes || "",
    createdBy:          v.created_by || "",
    createdAt:          v.created_at || "",
    customerAccountNum: accountLink?.customer_account_num || "",
    salesRepName:       accountLink?.sales_rep_name || "",
    salesRepPhone:      accountLink?.sales_rep_phone || "",
    salesRepEmail:      accountLink?.sales_rep_email || "",
    deliveryDays:       accountLink?.delivery_days || "",
    cutoffTime:         accountLink?.cutoff_time || "",
    deliveryMethod:     accountLink?.delivery_method || "",
    portalUrl:          accountLink?.portal_url || "",
    portalUsername:     accountLink?.portal_username || "",  // Q6 plaintext intentional
    portalPassword:     accountLink?.portal_password || "",  // Q6 plaintext intentional
    paymentTerms:       accountLink?.payment_terms || "",
    minOrder:           accountLink?.min_order || "",
    accountNotes:       accountLink?.account_notes || "",
    active:             accountLink ? !!accountLink.active : true,
    linkedAccounts:     allLinks.map((r) => r.account_key),
  };
}

// ── Writes ──

async function findVendorByClientUuidPostgres(clientUuid) {
  if (!clientUuid) return null;
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("vendors")
    .select("id, name")
    .eq("client_uuid", clientUuid)
    .maybeSingle();
  if (error) throw new Error(`[dataStore.vendor.pg] findVendorByClientUuid: ${error.message}`);
  if (!data) return null;
  return { vendorId: data.id, vendorName: data.name || "" };
}

async function findVendorIdsPostgres() {
  const supabase = getServiceClient();
  const { data, error } = await supabase.from("vendors").select("id");
  if (error) throw new Error(`[dataStore.vendor.pg] findVendorIds: ${error.message}`);
  return new Set((data || []).map((r) => r.id));
}

async function upsertVendorPostgres(input) {
  const supabase = getServiceClient();
  // Probe for existing row by id to decide insert vs update
  const { data: existing, error: lookupErr } = await supabase
    .from("vendors")
    .select("id, aliases:id")  // selecting id only is enough; alias check uses sheets pipe
    .eq("id", input.vendorId)
    .maybeSingle();
  if (lookupErr) throw new Error(`[dataStore.vendor.pg] upsertVendor lookup: ${lookupErr.message}`);

  if (!existing) {
    // Create
    const payload = {
      id:          input.vendorId,
      name:        String(input.name || "").trim(),
      category:    input.category || null,
      website:     String(input.website || "").trim() || null,
      notes:       String(input.notes || "").trim() || null,
      created_by:  input.createdBy || "",
      created_at:  input.createdAt || new Date().toISOString(),
      client_uuid: input.clientUuid || null,
    };
    const { error } = await supabase.from("vendors").insert(payload);
    if (error) throw new Error(`[dataStore.vendor.pg] upsertVendor insert: ${error.message}`);
  } else {
    // Update (subset of fields - matches handleVendorMasterUpdate behavior)
    const payload = {
      name:     String(input.name || "").trim(),
      category: input.category || null,
      website:  String(input.website || "").trim() || null,
      notes:    String(input.notes || "").trim() || null,
    };
    const { error } = await supabase.from("vendors").update(payload).eq("id", input.vendorId);
    if (error) throw new Error(`[dataStore.vendor.pg] upsertVendor update: ${error.message}`);
  }
}

async function findVendorAccountByClientUuidPostgres(clientUuid) {
  if (!clientUuid) return null;
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("vendor_accounts")
    .select("id, vendor_id, account_key")
    .eq("client_uuid", clientUuid)
    .maybeSingle();
  if (error) throw new Error(`[dataStore.vendor.pg] findVendorAccountByClientUuid: ${error.message}`);
  if (!data) return null;
  return { vendorId: data.vendor_id, accountKey: data.account_key };
}

async function upsertVendorAccountPostgres(input) {
  const supabase = getServiceClient();
  const { data: existing, error: lookupErr } = await supabase
    .from("vendor_accounts")
    .select("id")
    .eq("vendor_id", input.vendorId)
    .eq("account_key", input.accountKey)
    .maybeSingle();
  if (lookupErr) throw new Error(`[dataStore.vendor.pg] upsertVendorAccount lookup: ${lookupErr.message}`);

  if (!existing) {
    const payload = {
      vendor_id:            input.vendorId,
      account_key:          input.accountKey,
      customer_account_num: input.customerAccountNum || null,
      sales_rep_name:       input.salesRepName       || null,
      sales_rep_phone:      input.salesRepPhone      || null,
      sales_rep_email:      input.salesRepEmail      || null,
      delivery_days:        input.deliveryDays       || null,
      cutoff_time:          input.cutoffTime         || null,
      delivery_method:      input.deliveryMethod     || null,
      portal_url:           input.portalUrl          || null,
      portal_username:      input.portalUsername     || null,  // Q6 plaintext intentional
      portal_password:      input.portalPassword     || null,  // Q6 plaintext intentional
      payment_terms:        input.paymentTerms       || null,
      min_order:            input.minOrder           || null,
      active:               input.active !== undefined ? !!input.active : true,
      created_by:           input.createdBy          || "",
      created_at:           input.createdAt          || new Date().toISOString(),
      account_notes:        input.accountNotes       || null,
      client_uuid:          input.clientUuid         || null,
    };
    const { error } = await supabase.from("vendor_accounts").insert(payload);
    if (error) throw new Error(`[dataStore.vendor.pg] upsertVendorAccount insert: ${error.message}`);
  } else {
    // Partial update - only fields actually present in input
    const payload = {};
    if ("customerAccountNum" in input) payload.customer_account_num = input.customerAccountNum || null;
    if ("salesRepName" in input)       payload.sales_rep_name       = input.salesRepName       || null;
    if ("salesRepPhone" in input)      payload.sales_rep_phone      = input.salesRepPhone      || null;
    if ("salesRepEmail" in input)      payload.sales_rep_email      = input.salesRepEmail      || null;
    if ("deliveryDays" in input)       payload.delivery_days        = input.deliveryDays       || null;
    if ("cutoffTime" in input)         payload.cutoff_time          = input.cutoffTime         || null;
    if ("deliveryMethod" in input)     payload.delivery_method      = input.deliveryMethod     || null;
    if ("portalUrl" in input)          payload.portal_url           = input.portalUrl          || null;
    if ("portalUsername" in input)     payload.portal_username      = input.portalUsername     || null;
    if ("portalPassword" in input)     payload.portal_password      = input.portalPassword     || null;
    if ("paymentTerms" in input)       payload.payment_terms        = input.paymentTerms       || null;
    if ("minOrder" in input)           payload.min_order            = input.minOrder           || null;
    if ("accountNotes" in input)       payload.account_notes        = input.accountNotes       || null;
    if (Object.keys(payload).length === 0) return;
    const { error } = await supabase
      .from("vendor_accounts")
      .update(payload)
      .eq("vendor_id", input.vendorId)
      .eq("account_key", input.accountKey);
    if (error) throw new Error(`[dataStore.vendor.pg] upsertVendorAccount update: ${error.message}`);
  }
}

async function deactivateVendorAccountPostgres(vendorId, accountKey, active) {
  const supabase = getServiceClient();
  const { error } = await supabase
    .from("vendor_accounts")
    .update({ active: !!active })
    .eq("vendor_id", vendorId)
    .eq("account_key", accountKey);
  if (error) throw new Error(`[dataStore.vendor.pg] deactivateVendorAccount: ${error.message}`);
}

async function learnVendorAliasPostgres(vendorId, ocrName, learnedBy) {
  if (!vendorId || !ocrName) return { learned: false };
  const supabase = getServiceClient();
  // Skip if alias matches primary name (parity with Sheets adapter)
  const { data: vendor, error: vErr } = await supabase
    .from("vendors")
    .select("name")
    .eq("id", vendorId)
    .maybeSingle();
  if (vErr) throw new Error(`[dataStore.vendor.pg] learnVendorAlias lookup: ${vErr.message}`);
  if (!vendor) return { learned: false };
  const ocrClean = String(ocrName).trim();
  const primary = String(vendor.name || "").trim().toLowerCase();
  if (ocrClean.toLowerCase() === primary) return { learned: false };

  // ON CONFLICT DO NOTHING via the (vendor_id, alias_normalized) UNIQUE
  // constraint. The alias_normalized is a GENERATED column on the
  // server, so we just insert alias_text and let PG dedup.
  const { error } = await supabase.from("vendor_aliases").insert({
    vendor_id:  vendorId,
    alias_text: ocrClean,
    source:     "ocr_learned",
    learned_by: learnedBy || "system",
  });
  // 23505 = unique_violation. Treat as no-op (already learned).
  if (error && error.code !== "23505") {
    throw new Error(`[dataStore.vendor.pg] learnVendorAlias insert: ${error.message}`);
  }
  return { learned: !error };
}

async function mergeVendorsPostgres(keeperId, dupeIds, email) {
  // PR 5.1: sequential 3-statement (NOT atomic). PR 5.3 upgrades
  // this to a true BEGIN/COMMIT transaction (via stored function or
  // pg client transaction). Per the plan, this is best-effort during
  // the dual-write window: Sheets remains source of truth, so a
  // partial PG failure is recoverable by re-running the merge (the
  // operations are idempotent at the row level).
  const supabase = getServiceClient();

  // 1. Reassign vendor_accounts.vendor_id from dupes -> keeper
  const { error: reassignErr } = await supabase
    .from("vendor_accounts")
    .update({ vendor_id: keeperId })
    .in("vendor_id", dupeIds);
  if (reassignErr) {
    throw new Error(`[dataStore.vendor.pg] mergeVendors reassign: ${reassignErr.message}`);
  }

  // 2. Read dupe names (for alias backfill) then soft-delete
  const { data: dupes, error: dupeReadErr } = await supabase
    .from("vendors")
    .select("id, name")
    .in("id", dupeIds);
  if (dupeReadErr) {
    throw new Error(`[dataStore.vendor.pg] mergeVendors dupe read: ${dupeReadErr.message}`);
  }
  const dupeNames = (dupes || []).map((d) => String(d.name || "").trim()).filter(Boolean);

  const { error: softDelErr } = await supabase
    .from("vendors")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", dupeIds);
  if (softDelErr) {
    throw new Error(`[dataStore.vendor.pg] mergeVendors soft-delete: ${softDelErr.message}`);
  }

  // 3. Append dupe names as aliases on keeper (ON CONFLICT DO NOTHING)
  const aliasRows = dupeNames.map((n) => ({
    vendor_id:  keeperId,
    alias_text: n,
    source:     "merge",
    learned_by: email || "system",
  }));
  if (aliasRows.length > 0) {
    const { error: aliasErr } = await supabase
      .from("vendor_aliases")
      .insert(aliasRows);
    // 23505 = unique_violation (alias already exists for keeper). Non-fatal.
    if (aliasErr && aliasErr.code !== "23505") {
      throw new Error(`[dataStore.vendor.pg] mergeVendors aliases: ${aliasErr.message}`);
    }
  }

  return { dupeNames };
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API ORCHESTRATORS (dispatched by cutover flags)
// ═══════════════════════════════════════════════════════════════

// ── Reads ──

/**
 * Paginated vendor list for the admin UI.
 *   opts: { accountKey?, allAccounts?, category?, search?, page?,
 *           pageSize?, showInactive?, module? }
 * Returns: { vendors, total, inactiveCount, hasMore, page, pageSize }
 */
export async function getVendorsForList(opts = {}) {
  if (isReadFromPostgres(VENDOR_MASTER_TAB, opts.module)) {
    return readVendorListPostgres(opts);
  }
  return readVendorListSheets(opts);
}

/**
 * Active vendors for the invoice tool bootstrap.
 *   accountKey: the account's natural key (e.g. "CIN - OH")
 *   opts: { module? }
 * Returns: { vendorMaster: [...], accountVendors: [...] }
 */
export async function getVendorsForBootstrap(accountKey, opts = {}) {
  if (isReadFromPostgres(VENDOR_MASTER_TAB, opts.module)) {
    return readVendorBootstrapPostgres(accountKey);
  }
  return readVendorBootstrapSheets(accountKey);
}

/**
 * Fuzzy-match vendor search for typeahead.
 *   query: substring of vendor name (lowercased)
 *   opts: { module? }
 * Returns: array of { vendorId, name, category } up to 20 results.
 */
export async function searchVendors(query, opts = {}) {
  if (isReadFromPostgres(VENDOR_MASTER_TAB, opts.module)) {
    return readVendorSearchPostgres(query);
  }
  return readVendorSearchSheets(query);
}

/**
 * Single-vendor read by vendorId.
 *   vendorId:   the natural vendor key (e.g. "FRE-448")
 *   accountKey: optional - if provided, populates account_link fields
 *               for that account; otherwise all account fields blank
 *   opts:       { module? }
 * Returns: canonical vendor record (same shape as getVendorsForList
 * row) or null if not found.
 */
export async function getVendor(vendorId, accountKey, opts = {}) {
  if (isReadFromPostgres(VENDOR_MASTER_TAB, opts.module)) {
    return readVendorByIdPostgres(vendorId, accountKey);
  }
  return readVendorByIdSheets(vendorId, accountKey);
}

/**
 * Read all vendors with aliases for the OCR fuzzy matcher.
 *   opts: { module? }
 * Returns: [{ vendorId, name, category, aliases }, ...]
 * `aliases` is the pipe-separated string (reconstructed from the
 * vendor_aliases table on the PG path).
 */
export async function getVendorsForMatching(opts = {}) {
  if (isReadFromPostgres(VENDOR_MASTER_TAB, opts.module)) {
    return readVendorsForMatchingPostgres();
  }
  return readVendorsForMatchingSheets();
}

// ── Writes ──

/**
 * Create or update a vendor master row.
 *   input: {
 *     vendorId?,                          // omit on create; F19a generates
 *     name, category?, website?, notes?,
 *     aliases?,                           // pipe-string on Sheets; not propagated to PG vendor_aliases (use learnVendorAlias)
 *     createdBy, createdAt?,
 *     clientUuid?,                        // F19b idempotency key
 *   }
 *
 * F19a (vendor ID generation): if vendorId is missing, the
 * orchestrator generates one ONCE before dispatching to both
 * adapters so the Sheets row and the PG row share the same ID.
 *
 * F19b (clientUuid idempotency): if clientUuid is provided and a
 * prior row exists with that clientUuid, short-circuits with the
 * existing vendorId + deduplicated: true.
 *
 * Returns: { vendorId, deduplicated? }
 */
export async function upsertVendor(input) {
  const isCreate = !input.vendorId;

  // F19b: short-circuit on prior clientUuid
  if (isCreate && input.clientUuid) {
    // Check Sheets first (the canonical store today)
    const prior = await findVendorByClientUuidSheets(input.clientUuid);
    if (prior) {
      return { vendorId: prior.vendorId, vendorName: prior.vendorName, deduplicated: true };
    }
  }

  // F19a: orchestrator-level ID generation so both adapters see same value
  let vendorId = input.vendorId;
  if (!vendorId) {
    if (!input.name?.trim()) {
      throw new Error("[dataStore.vendor] upsertVendor: name required when vendorId omitted");
    }
    vendorId = await generateUniqueVendorIdSheets(input.name);
    if (!vendorId) {
      throw new Error(`[dataStore.vendor] upsertVendor: F19a exhausted ${VENDOR_ID_RETRY_LIMIT} attempts (name="${input.name}")`);
    }
  }

  const fullInput = {
    ...input,
    vendorId,
    clientUuid: input.clientUuid || (isCreate ? crypto.randomUUID() : null),
  };

  await upsertVendorSheets(fullInput);
  if (isDualWrite(VENDOR_MASTER_TAB)) {
    await upsertVendorPostgres(fullInput);
  }
  return { vendorId, deduplicated: false };
}

/**
 * Create or update a vendor_accounts row (account link).
 *   input: {
 *     vendorId, accountKey,
 *     customerAccountNum?, salesRepName?, salesRepPhone?,
 *     salesRepEmail?, deliveryDays?, cutoffTime?, deliveryMethod?,
 *     portalUrl?, portalUsername?, portalPassword?,
 *     paymentTerms?, minOrder?, accountNotes?, active?,
 *     createdBy?, createdAt?,
 *     clientUuid?,                        // F19b idempotency key
 *   }
 *
 * F19b: if clientUuid is provided and a prior row exists with that
 * clientUuid, short-circuits.
 *
 * Returns: { vendorId, accountKey, deduplicated? }
 */
export async function upsertVendorAccount(input) {
  if (!input.vendorId)   throw new Error("[dataStore.vendor] upsertVendorAccount: vendorId required");
  if (!input.accountKey) throw new Error("[dataStore.vendor] upsertVendorAccount: accountKey required");

  // F19b on Sheets side first (canonical today)
  if (input.clientUuid) {
    const { rows } = await readSheetSA(SHEET_IDS.HUB, VENDOR_ACCOUNTS_TAB);
    const prior = rows.find((r) => String(r[VA_IDX.clientUuid] || "") === input.clientUuid);
    if (prior) {
      return {
        vendorId:   String(prior[VA_IDX.vendorId] || ""),
        accountKey: String(prior[VA_IDX.accountKey] || ""),
        deduplicated: true,
      };
    }
  }

  await upsertVendorAccountSheets(input);
  if (isDualWrite(VENDOR_ACCOUNTS_TAB)) {
    await upsertVendorAccountPostgres(input);
  }
  return { vendorId: input.vendorId, accountKey: input.accountKey, deduplicated: false };
}

/**
 * Set a vendor_accounts row's active flag.
 *   input: { vendorId, accountKey, active }
 *     active = true  -> reactivate
 *     active = false -> deactivate
 */
export async function deactivateVendorAccount(input) {
  if (!input.vendorId)   throw new Error("[dataStore.vendor] deactivateVendorAccount: vendorId required");
  if (!input.accountKey) throw new Error("[dataStore.vendor] deactivateVendorAccount: accountKey required");
  if (typeof input.active !== "boolean") {
    throw new Error("[dataStore.vendor] deactivateVendorAccount: active must be boolean");
  }
  await deactivateVendorAccountSheets(input.vendorId, input.accountKey, input.active);
  if (isDualWrite(VENDOR_ACCOUNTS_TAB)) {
    await deactivateVendorAccountPostgres(input.vendorId, input.accountKey, input.active);
  }
  return { success: true };
}

/**
 * Auto-learn an alias from OCR.
 *   input: { vendorId, ocrName, learnedBy? }
 *
 * Sheets: pipe-append to vendor_master col I, deduped by lowercase.
 * Postgres: INSERT INTO vendor_aliases ON CONFLICT DO NOTHING via
 * the (vendor_id, alias_normalized) UNIQUE constraint. Race-safe.
 *
 * Returns: { learned: boolean }
 */
export async function learnVendorAlias(input) {
  const result = await learnVendorAliasSheets(input.vendorId, input.ocrName);
  if (isDualWrite(VENDOR_ALIASES_TAB) || isDualWrite(VENDOR_MASTER_TAB)) {
    await learnVendorAliasPostgres(input.vendorId, input.ocrName, input.learnedBy);
  }
  return result;
}

/**
 * Merge dupe vendors into a keeper.
 *   input: { keeperId, dupeIds: [...], email }
 *
 * Sheets path: 3 sequential batched updates (existing behavior).
 * Postgres path: 3 sequential statements in PR 5.1 (NOT atomic).
 * PR 5.3 upgrades this to a true BEGIN/COMMIT transaction.
 *
 * Returns: {
 *   keeperId, dupeIds, accountRowsReassigned,
 *   vendorRowsDeleted, aliasesAdded
 * }
 */
export async function mergeVendors(input) {
  if (!input.keeperId) throw new Error("[dataStore.vendor] mergeVendors: keeperId required");
  if (!Array.isArray(input.dupeIds) || input.dupeIds.length === 0) {
    throw new Error("[dataStore.vendor] mergeVendors: dupeIds required and non-empty");
  }

  const sheetsResult = await mergeVendorsSheets(input.keeperId, input.dupeIds);
  if (isDualWrite(VENDOR_MASTER_TAB) || isDualWrite(VENDOR_ACCOUNTS_TAB) || isDualWrite(VENDOR_ALIASES_TAB)) {
    await mergeVendorsPostgres(input.keeperId, input.dupeIds, input.email);
  }
  return {
    keeperId:              input.keeperId,
    dupeIds:               input.dupeIds,
    accountRowsReassigned: sheetsResult.accountRowsReassigned,
    vendorRowsDeleted:     sheetsResult.vendorRowsDeleted,
    aliasesAdded:          sheetsResult.aliasesAdded,
  };
}
