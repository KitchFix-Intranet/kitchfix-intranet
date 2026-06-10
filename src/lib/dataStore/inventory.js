import {
  readSheetSA,
  appendRowSA,
  appendRowsSA,
  updateRangeSA,
  batchUpdateRangesSA,
  SHEET_IDS,
} from "@/lib/sheets";
import {
  cachedRead,
  batchRead,
  invalidateCache,
  parseNum,
  generateId,
} from "@/lib/opsUtils";
import { isDualWrite, isReadFromPostgres } from "@/lib/cutover";
import { getServiceClient } from "@/lib/supabase";

// ═══════════════════════════════════════════════════════════════
// INVENTORY MODULE (Stage 1 module 7 / INV-2 — DORMANT)
// ═══════════════════════════════════════════════════════════════
//
// Source: INVENTORY spreadsheet, 8 tabs (item_catalog, item_aliases,
// storage_locations, count_sessions, count_items, price_history,
// review_queue, merge_history) + zone_corrections (vestigial,
// dropped per INV-1).
//
// PG schema: 8 tables + merge_history_items junction + 6 views +
// merge_inventory_items() RPC. See
// docs/migrations/inv-1-smart-inventory-schema.sql (PR #114).
//
// DORMANT INFRASTRUCTURE: with cutover flags off (the default state on
// merge), every orchestrator dispatches to its Sheets adapter so
// behavior is byte-equivalent to the pre-INV-2 inventoryActions.js.
// INV-2 (this PR) rewires the inventoryActions.js handlers to call
// these orchestrators. INV-3 backfills the PG tables. Read-cutover
// waits for Module 8 (cron is Sheets-only today; PG can't be the read
// source until the cron also writes PG).
//
// MODULE ARG (per Module 5 lesson #1 / PR #92): every read orchestrator
// accepts opts.module and passes to isReadFromPostgres. Handlers MUST
// pass module: "ops" at every call site for READ_FROM_POSTGRES_OPS to
// take effect.
//
// ACCOUNT-MATCH POLICY: the Sheets adapters call accountMatch (the
// short-vs-full label tolerance helper) wherever the legacy
// inventoryActions.js does today. The PG adapters use direct equality;
// the canonical short-form CHECK constraint guarantees there is no
// drift on the PG side. INV-3 normalizes the 1 stray full-form row
// before this becomes load-bearing.
//
// MERGE SPECIAL CASE: mergeInventoryItems mirrors mergeVendors. It
// runs mergeInventoryItemsSheets unconditionally (the existing 4-7
// step Sheets sequence) and, if any of inventory_items / item_aliases /
// price_history / merge_history is dual-writing, also runs
// mergeInventoryItemsPostgres which invokes merge_inventory_items()
// RPC for atomic PG state. Keeper-field side effects (location_id
// copy when keeper lacks one; notes append) are NOT in the RPC; the
// PG path runs them in JS BEFORE the RPC, mirroring what the Sheets
// path does inline.
//
// ZONE_CORRECTIONS: dropped from INV-1 as vestigial (0 rows, no
// reader). acceptReviewItem no longer writes to it on EITHER side.
//
// Public API (~22 orchestrators):
//
//   Reads:
//     getInventoryBootstrap(opts)            - hub payload (mostly views on PG side)
//     getCatalogForAccount(opts)             - catalog + aliases
//     getCatalogForMatching(opts)            - lighter shape for AI similarity
//
//   Writes:
//     createCountSession(input)              - start session (draft)
//     appendCountItems(input)                - count_items batch append
//     submitCountSession(input)              - draft -> submitted (totals + priceAtLastCount)
//     createInventoryItem(input)             - add item + initial price_history
//     verifyItemPrice(input)                 - update lastPrice + price_history
//     moveItemsBulk(input)                   - batch location_id updates
//     mergeInventoryItems(input)             - atomic merge (Sheets multi-step + PG RPC)
//     logKeepSeparate(input)                 - merge_history with action='keep_separate'
//     acceptReviewItem(input)                - review-pane accept (NO zone_corrections write)
//     deleteReviewItem(input)                - review_delete + merge_history reason
//     excludeItem(input)                     - exclude (status='excluded' + merge_history)
//     saveStorageLocations(input)            - bulk zone save + auto-assign
//     saveLocationSortOrder(input)           - sort_order batch update
//     addStorageSubZone(input)               - sub-zone create
//     updateStorageLocation(input)           - partial location update
//     deactivateStorageLocation(input)       - location soft-delete
//     updateCatalogItem(input)               - partial catalog row update
//     archiveItem(input)                     - status='archived' + merge_history
//     reactivateItem(input)                  - status='active' + merge_history

// ───────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────

const INVENTORY_ITEMS_TAB     = "item_catalog";          // Sheets tab name = canonical PG table name? No - PG is 'inventory_items'.
const INVENTORY_ITEMS_FLAG    = "inventory_items";       // dual-write/read flag token = PG table name
const ITEM_ALIASES_TAB        = "item_aliases";
const STORAGE_LOCATIONS_TAB   = "storage_locations";
const COUNT_SESSIONS_TAB      = "count_sessions";
const COUNT_ITEMS_TAB         = "count_items";
const PRICE_HISTORY_TAB       = "price_history";
const REVIEW_QUEUE_TAB        = "review_queue";
const MERGE_HISTORY_TAB       = "merge_history";

// Sheets-side column indices for item_catalog (mirrors inventoryActions.js bootstrap L40-52)
const CAT_IDX = {
  itemId:            0,   // A
  account:           1,   // B
  name:              2,   // C
  category:          3,   // D
  unit:              4,   // E
  locationId:        5,   // F
  primaryVendor:     6,   // G
  lastPrice:         7,   // H
  lastPriceDate:     8,   // I
  lastPriceVendor:   9,   // J
  priceAtLastCount: 10,   // K
  active:           11,   // L  ('TRUE'/'FALSE' string)
  linkedToInvoice:  12,   // M
  isVarietyGroup:   13,   // N
  createdBy:        14,   // O
  createdAt:        15,   // P
  status:           16,   // Q  ('excluded'/'archived'/'reviewed'/'review_deleted'/'' OR cron-written timestamp)
  notes:            17,   // R
  lastVerified:     18,   // S
};

const ALIAS_IDX = {
  aliasId:           0,
  aliasText:         1,
  itemId:            2,
  vendor:            3,
  confidence:        4,
  learnedBy:         5,
  learnedAt:         6,
  source:            7,
};

const LOC_IDX = {
  locationId:        0,
  account:           1,
  name:              2,
  icon:              3,
  sortOrder:         4,
  active:            5,
  createdBy:         6,
  createdAt:         7,
  parentLocationId:  8,
  color:             9,
};

const SESSION_IDX = {
  sessionId:         0,
  account:           1,
  period:            2,
  startedBy:         3,
  startedAt:         4,
  status:            5,
  submittedBy:       6,
  submittedAt:       7,
  totalFood:         8,
  totalPackaging:    9,
  totalSupplies:    10,
  totalSnacks:      11,
  totalBeverages:   12,
  grandTotal:       13,
};

const CI_IDX = {
  sessionId:         0,
  locationSaveId:    1,
  itemId:            2,
  quantity:          3,
  unit:              4,
  priceAtCount:      5,
  priceVendor:       6,
  extendedPrice:     7,
  locationId:        8,
  savedBy:           9,
  savedAt:          10,
  ts:               11,
  noneOnHand:       12,
};

const PRICE_IDX = {
  itemId:            0,
  account:           1,
  vendor:            2,
  price:             3,
  effectiveDate:     4,
  source:            5,
  recordedAt:        6,
};

const RQ_IDX = {
  queueId:           0,
  lineItemText:      1,
  vendor:            2,
  invoiceId:         3,
  invoiceDate:       4,
  account:           5,
  suggestedMatchId:  6,
  suggestedMatchName:7,
  confidence:        8,
  status:            9,
  reviewedBy:       10,
  reviewedAt:       11,
  resultItemId:     12,
  reason:           13,
};

const MH_IDX = {
  mergeId:           0,
  account:           1,
  timestamp:         2,
  email:             3,
  keeperItemId:      4,
  keeperName:        5,
  mergedItemIds:     6,   // JSON array string
  mergedNames:       7,   // JSON array string
  action:            8,
  reason:            9,
};

// ───────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────

// Sheets-side account label tolerance. Mirrors inventoryActions.js
// accountMatch helper. Retained ONLY in Sheets adapters; PG adapters
// use direct equality since the canonical CHECK constraint enforces
// the short form. INV-3 normalizes the 1 stray STL-MO full-form row.
function accountMatch(rowAccount, activeAccount) {
  if (!rowAccount || !activeAccount) return false;
  if (rowAccount === activeAccount) return true;
  return activeAccount.startsWith(rowAccount + " -");
}

function strToBool(s) {
  const v = String(s ?? "").trim().toUpperCase();
  return v === "TRUE";
}

function boolToStr(b) {
  return b ? "TRUE" : "FALSE";
}

function safeJsonParse(s, fallback) {
  if (!s) return fallback;
  try {
    return typeof s === "string" ? JSON.parse(s) : s;
  } catch {
    return fallback;
  }
}

// ───────────────────────────────────────────────────────────────
// Canonical record builders
// ───────────────────────────────────────────────────────────────

function catalogFromSheetsRow(r) {
  return {
    itemId:           String(r[CAT_IDX.itemId] || "").trim(),
    account:          String(r[CAT_IDX.account] || "").trim(),
    name:             String(r[CAT_IDX.name] || "").trim(),
    category:         String(r[CAT_IDX.category] || "Uncategorized").trim(),
    unit:             String(r[CAT_IDX.unit] || "EA").trim(),
    locationId:       String(r[CAT_IDX.locationId] || "").trim(),
    primaryVendor:    String(r[CAT_IDX.primaryVendor] || "").trim(),
    lastPrice:        parseNum(r[CAT_IDX.lastPrice]),
    lastPriceDate:    String(r[CAT_IDX.lastPriceDate] || "").trim(),
    lastPriceVendor:  String(r[CAT_IDX.lastPriceVendor] || "").trim(),
    priceAtLastCount: parseNum(r[CAT_IDX.priceAtLastCount]),
    active:           !strToBoolFalse(r[CAT_IDX.active]),
    linkedToInvoice:  strToBool(r[CAT_IDX.linkedToInvoice]),
    isVarietyGroup:   strToBool(r[CAT_IDX.isVarietyGroup]),
    createdBy:        String(r[CAT_IDX.createdBy] || "").trim(),
    createdAt:        String(r[CAT_IDX.createdAt] || "").trim(),
    status:           String(r[CAT_IDX.status] || "").trim(),
    notes:            String(r[CAT_IDX.notes] || "").trim(),
    lastVerified:     String(r[CAT_IDX.lastVerified] || "").trim(),
  };
}

// Sheets uses string "FALSE" for inactive; treat anything else as active.
function strToBoolFalse(s) {
  const v = String(s ?? "").trim().toUpperCase();
  return v === "FALSE";
}

function catalogFromPgRow(row) {
  return {
    itemId:           row.id,
    account:          row.account,
    name:             row.name || "",
    category:         row.category || "Uncategorized",
    unit:             row.unit || "EA",
    locationId:       row.location_id || "",
    primaryVendor:    row.primary_vendor_name || "",   // joined from vendors.name
    lastPrice:        row.last_price != null ? Number(row.last_price) : 0,
    lastPriceDate:    row.last_price_date ? String(row.last_price_date) : "",
    lastPriceVendor:  row.last_price_vendor_name || "",
    priceAtLastCount: row.price_at_last_count != null ? Number(row.price_at_last_count) : 0,
    active:           row.status === "active",
    linkedToInvoice:  !!row.linked_to_invoice,
    isVarietyGroup:   !!row.is_variety_group,
    createdBy:        row.created_by || "",
    createdAt:        row.created_at ? new Date(row.created_at).toISOString() : "",
    status:           row.status === "active" ? "" : row.status,    // legacy Sheets convention: empty = active
    notes:            row.notes || "",
    lastVerified:     row.last_verified ? new Date(row.last_verified).toISOString() : "",
  };
}

function aliasFromSheetsRow(r) {
  return {
    aliasId:          String(r[ALIAS_IDX.aliasId] || "").trim(),
    aliasText:        String(r[ALIAS_IDX.aliasText] || "").trim(),
    itemId:           String(r[ALIAS_IDX.itemId] || "").trim(),
    vendor:           String(r[ALIAS_IDX.vendor] || "").trim(),
  };
}

function aliasFromPgRow(row) {
  return {
    aliasId:          row.id,
    aliasText:        row.alias_text || "",
    itemId:           row.item_id || "",
    vendor:           row.vendor_name || "",
  };
}

function locationFromSheetsRow(r) {
  return {
    locationId:       String(r[LOC_IDX.locationId] || "").trim(),
    name:             String(r[LOC_IDX.name] || "").trim(),
    icon:             String(r[LOC_IDX.icon] || "box").trim(),
    sortOrder:        parseInt(r[LOC_IDX.sortOrder]) || 0,
    parentLocationId: String(r[LOC_IDX.parentLocationId] || "").trim() || null,
    color:            String(r[LOC_IDX.color] || "").trim(),
  };
}

function locationFromPgRow(row) {
  return {
    locationId:       row.id,
    name:             row.name || "",
    icon:             row.icon || "box",
    sortOrder:        row.sort_order || 0,
    parentLocationId: row.parent_location_id || null,
    color:            row.color || "",
  };
}

// ═══════════════════════════════════════════════════════════════
// SHEETS ADAPTERS
// ═══════════════════════════════════════════════════════════════

// ── Bootstrap aggregate ──
// Reads the 7 inventory tabs in one batchRead and builds the
// payload the legacy handleInventoryBootstrap computed in JS.
async function readBootstrapSheets({ account, fresh = false, currentPeriod }) {
  const inv = await batchRead(SHEET_IDS.INVENTORY, [
    "item_catalog", "storage_locations", "count_sessions", "count_items",
    "review_queue", "price_history", "item_aliases",
  ], { fresh });

  // Catalog (active items)
  const allCatalogRows = inv.item_catalog?.rows || [];
  const accountActiveRows = allCatalogRows.filter((r) =>
    accountMatch(r[CAT_IDX.account], account) && !strToBoolFalse(r[CAT_IDX.active])
  );
  const catalogItems = accountActiveRows.map(catalogFromSheetsRow);

  const catalogStats = { totalItems: catalogItems.length, byCategory: {} };
  catalogItems.forEach((i) => {
    catalogStats.byCategory[i.category] = (catalogStats.byCategory[i.category] || 0) + 1;
  });

  const excludedItems = allCatalogRows
    .filter((r) =>
      accountMatch(r[CAT_IDX.account], account)
      && strToBoolFalse(r[CAT_IDX.active])
      && String(r[CAT_IDX.status] || "").trim() === "excluded"
    )
    .map((r) => {
      const c = catalogFromSheetsRow(r);
      return {
        itemId: c.itemId, name: c.name, category: c.category, unit: c.unit,
        primaryVendor: c.primaryVendor, lastPrice: c.lastPrice,
      };
    });

  const archivedItems = allCatalogRows
    .filter((r) =>
      accountMatch(r[CAT_IDX.account], account)
      && strToBoolFalse(r[CAT_IDX.active])
      && String(r[CAT_IDX.status] || "").trim() === "archived"
    )
    .map((r) => {
      const c = catalogFromSheetsRow(r);
      return {
        itemId: c.itemId, name: c.name, category: c.category, unit: c.unit,
        locationId: c.locationId, primaryVendor: c.primaryVendor,
        lastPrice: c.lastPrice, lastPriceDate: c.lastPriceDate,
        lastPriceVendor: c.lastPriceVendor, createdBy: c.createdBy,
        notes: c.notes, lastVerified: c.lastVerified,
      };
    });

  const catalogItemIds = new Set(catalogItems.map((i) => i.itemId));
  const aliases = (inv.item_aliases?.rows || [])
    .filter((r) => catalogItemIds.has(String(r[ALIAS_IDX.itemId] || "").trim()))
    .map(aliasFromSheetsRow);

  // Locations
  const locations = (inv.storage_locations?.rows || [])
    .filter((r) => accountMatch(r[LOC_IDX.account], account) && !strToBoolFalse(r[LOC_IDX.active]))
    .sort((a, b) => (parseInt(a[LOC_IDX.sortOrder]) || 0) - (parseInt(b[LOC_IDX.sortOrder]) || 0))
    .map(locationFromSheetsRow);

  // Sessions
  const sessionRows = (inv.count_sessions?.rows || [])
    .filter((r) => accountMatch(r[SESSION_IDX.account], account))
    .sort((a, b) =>
      new Date(b[SESSION_IDX.submittedAt] || b[SESSION_IDX.startedAt] || 0)
      - new Date(a[SESSION_IDX.submittedAt] || a[SESSION_IDX.startedAt] || 0)
    );

  const lastSubmittedRow = sessionRows.find(
    (r) => r[SESSION_IDX.status] === "submitted" || r[SESSION_IDX.status] === "corrected"
  );
  const activeDraftRow = sessionRows.find(
    (r) => r[SESSION_IDX.status] === "draft" && r[SESSION_IDX.period] === currentPeriod?.name
  );

  let lastCount = null;
  if (lastSubmittedRow) {
    lastCount = {
      sessionId:      lastSubmittedRow[SESSION_IDX.sessionId],
      period:         lastSubmittedRow[SESSION_IDX.period],
      submittedBy:    lastSubmittedRow[SESSION_IDX.submittedBy] || lastSubmittedRow[SESSION_IDX.startedBy],
      submittedAt:    lastSubmittedRow[SESSION_IDX.submittedAt] || "",
      status:         lastSubmittedRow[SESSION_IDX.status],
      totalFood:      parseNum(lastSubmittedRow[SESSION_IDX.totalFood]),
      totalPackaging: parseNum(lastSubmittedRow[SESSION_IDX.totalPackaging]),
      totalSupplies:  parseNum(lastSubmittedRow[SESSION_IDX.totalSupplies]),
      totalSnacks:    parseNum(lastSubmittedRow[SESSION_IDX.totalSnacks]),
      totalBeverages: parseNum(lastSubmittedRow[SESSION_IDX.totalBeverages]),
      grandTotal:     parseNum(lastSubmittedRow[SESSION_IDX.grandTotal]),
    };
  }

  // Last count items (replay-by-latest-locationSaveId per location)
  const lastCountItems = {};
  if (lastSubmittedRow) {
    const allCi = (inv.count_items?.rows || []).filter(
      (r) => r[CI_IDX.sessionId] === lastSubmittedRow[SESSION_IDX.sessionId]
    );
    const locGroups = {};
    allCi.forEach((r) => {
      const locId = r[CI_IDX.locationId];
      const saveId = r[CI_IDX.locationSaveId];
      const savedAt = r[CI_IDX.savedAt] || "";
      if (!locGroups[locId] || savedAt > locGroups[locId].savedAt) {
        locGroups[locId] = { saveId, savedAt };
      }
    });
    allCi.forEach((r) => {
      const locId = r[CI_IDX.locationId];
      if (locGroups[locId] && r[CI_IDX.locationSaveId] === locGroups[locId].saveId) {
        lastCountItems[r[CI_IDX.itemId]] = {
          quantity:   parseNum(r[CI_IDX.quantity]),
          noneOnHand: strToBool(r[CI_IDX.noneOnHand]),
        };
      }
    });
  }

  const reviewQueueCount = (inv.review_queue?.rows || [])
    .filter((r) =>
      accountMatch(r[RQ_IDX.account], account)
      && r[RQ_IDX.status] === "pending"
    ).length;

  // Price movers / itemPrices
  const priceRows = (inv.price_history?.rows || [])
    .filter((r) => accountMatch(r[PRICE_IDX.account], account))
    .sort((a, b) =>
      new Date(b[PRICE_IDX.recordedAt] || b[PRICE_IDX.effectiveDate] || 0)
      - new Date(a[PRICE_IDX.recordedAt] || a[PRICE_IDX.effectiveDate] || 0)
    );
  const priceByItem = {};
  priceRows.forEach((r) => {
    const itemId = r[PRICE_IDX.itemId];
    if (!priceByItem[itemId]) priceByItem[itemId] = [];
    if (priceByItem[itemId].length < 8) {
      priceByItem[itemId].push({
        price:  parseNum(r[PRICE_IDX.price]),
        vendor: r[PRICE_IDX.vendor],
        date:   r[PRICE_IDX.effectiveDate] || "",
      });
    }
  });
  const movers = [];
  for (const [itemId, prices] of Object.entries(priceByItem)) {
    if (prices.length < 2) continue;
    const diff = prices[0].price - prices[1].price;
    if (Math.abs(diff) < 0.01) continue;
    const cat = catalogItems.find((i) => i.itemId === itemId);
    movers.push({
      itemId,
      name: cat?.name || itemId,
      currentPrice: prices[0].price,
      previousPrice: prices[1].price,
      change: diff,
      pctChange: ((diff / prices[1].price) * 100).toFixed(1),
      vendor: prices[0].vendor,
      direction: diff > 0 ? "up" : "down",
    });
  }
  movers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  const currentPeriodSubmitted = sessionRows.some(
    (r) =>
      r[SESSION_IDX.period] === currentPeriod?.name
      && (r[SESSION_IDX.status] === "submitted" || r[SESSION_IDX.status] === "corrected")
  );

  return {
    catalogItems,
    catalogStats,
    locations,
    excludedItems,
    archivedItems,
    aliases,
    lastCount,
    lastCountItems,
    activeDraft: activeDraftRow
      ? {
          sessionId: activeDraftRow[SESSION_IDX.sessionId],
          period:    activeDraftRow[SESSION_IDX.period],
          startedAt: activeDraftRow[SESSION_IDX.startedAt],
        }
      : null,
    reviewQueueCount,
    priceMovers: movers.filter((m) => Math.abs(parseFloat(m.pctChange)) >= 5).slice(0, 10),
    itemPrices: Object.fromEntries(
      Object.entries(priceByItem).map(([id, prices]) => [id, prices.slice(0, 6)])
    ),
    currentPeriodSubmitted,
  };
}

// ── Catalog reads ──
async function readCatalogForAccountSheets({ account }) {
  const inv = await batchRead(SHEET_IDS.INVENTORY, ["item_catalog", "item_aliases"]);
  const items = (inv.item_catalog?.rows || [])
    .filter((r) => accountMatch(r[CAT_IDX.account], account) && !strToBoolFalse(r[CAT_IDX.active]))
    .map(catalogFromSheetsRow);
  const ids = new Set(items.map((i) => i.itemId));
  const aliases = (inv.item_aliases?.rows || [])
    .filter((r) => ids.has(String(r[ALIAS_IDX.itemId] || "").trim()))
    .map(aliasFromSheetsRow);
  return { items, aliases };
}

async function readCatalogForMatchingSheets({ account }) {
  const inv = await batchRead(SHEET_IDS.INVENTORY, ["item_catalog", "item_aliases"]);
  const items = (inv.item_catalog?.rows || [])
    .filter((r) =>
      accountMatch(r[CAT_IDX.account], account)
      && !strToBoolFalse(r[CAT_IDX.active])
      && r[CAT_IDX.itemId]
      && r[CAT_IDX.name]
    )
    .map(catalogFromSheetsRow);
  const ids = new Set(items.map((i) => i.itemId));
  const aliases = (inv.item_aliases?.rows || [])
    .filter((r) => ids.has(String(r[ALIAS_IDX.itemId] || "").trim()))
    .map(aliasFromSheetsRow);
  return { items, aliases };
}

// ── Recent merge_history reads (used by handleAISimilarityCheck for
//    learned-pattern context + keep_separate guard). Returns rows in
//    the canonical Sheets-positional shape (the handler walks the
//    fields by index); when read from PG we materialize the same
//    shape so the AI prompt-builder doesn't have to branch.
async function readRecentMergeHistorySheets({ account, limit = 50 }) {
  const inv = await batchRead(SHEET_IDS.INVENTORY, ["merge_history"], { fresh: true });
  return (inv.merge_history?.rows || [])
    .filter((r) => accountMatch(r[MH_IDX.account], account))
    .slice(-limit);
}

async function readRecentMergeHistoryPostgres({ account, limit = 50 }) {
  const supa = getServiceClient();
  const { data: headers } = await supa
    .from("merge_history")
    .select("id, account, created_at, email, keeper_item_id, canonical_name, action, reason")
    .eq("account", account)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!headers || headers.length === 0) return [];
  const ids = headers.map((h) => h.id);
  const { data: junction } = await supa
    .from("merge_history_items")
    .select("merge_id, item_id, item_name, role")
    .in("merge_id", ids);
  const byMerge = {};
  (junction || []).forEach((j) => {
    if (!byMerge[j.merge_id]) byMerge[j.merge_id] = { keeperId: null, keeperName: null, mergedIds: [], mergedNames: [] };
    if (j.role === "keeper") {
      byMerge[j.merge_id].keeperId = j.item_id;
      byMerge[j.merge_id].keeperName = j.item_name;
    } else {
      byMerge[j.merge_id].mergedIds.push(j.item_id);
      byMerge[j.merge_id].mergedNames.push(j.item_name);
    }
  });
  // Synthesize the Sheets-positional shape (MH_IDX positions) so the
  // handler can walk it identically. Returned in chronological-asc
  // order to match the Sheets path's `slice(-limit)` semantics.
  return headers.reverse().map((h) => {
    const agg = byMerge[h.id] || {};
    const row = [];
    row[MH_IDX.mergeId]       = h.id;
    row[MH_IDX.account]       = h.account;
    row[MH_IDX.timestamp]     = h.created_at;
    row[MH_IDX.email]         = h.email || "";
    row[MH_IDX.keeperItemId]  = agg.keeperId || h.keeper_item_id || "";
    row[MH_IDX.keeperName]    = agg.keeperName || h.canonical_name || "";
    row[MH_IDX.mergedItemIds] = JSON.stringify(agg.mergedIds || []);
    row[MH_IDX.mergedNames]   = JSON.stringify(agg.mergedNames || []);
    row[MH_IDX.action]        = h.action;
    row[MH_IDX.reason]        = h.reason || "";
    return row;
  });
}

// ── Count sessions ──
async function createCountSessionSheets({ account, period, email }) {
  const sessionId = generateId("inv");
  const row = [
    sessionId, account, period, email, new Date().toISOString(),
    "draft", "", "", "", "", "", "", "", "",
  ];
  await appendRowSA(SHEET_IDS.INVENTORY, "count_sessions", row);
  invalidateCache(SHEET_IDS.INVENTORY, "count_sessions");
  return { sessionId };
}

async function appendCountItemsSheets({ sessionId, locationId, items, email }) {
  const locationSaveId = generateId("loc");
  const savedAt = new Date().toISOString();
  const rows = items.map((item) => [
    sessionId, locationSaveId, item.itemId,
    item.quantity ?? 0, item.unit || "EA",
    item.priceAtCount ?? 0, item.priceVendor || "",
    ((item.quantity || 0) * (item.priceAtCount || 0)).toFixed(2),
    locationId, email, savedAt, savedAt,
    item.noneOnHand ? "TRUE" : "FALSE",
  ]);
  await appendRowsSA(SHEET_IDS.INVENTORY, "count_items", rows);
  invalidateCache(SHEET_IDS.INVENTORY, "count_items");
  return { locationSaveId, itemCount: rows.length };
}

// submitCountSessionSheets: returns the computed totals for the
// orchestrator to forward to the Slack notifier and to the handler.
async function submitCountSessionSheets({ sessionId, account, email }) {
  const inv = await batchRead(
    SHEET_IDS.INVENTORY,
    ["count_sessions", "count_items", "item_catalog"],
    { fresh: true }
  );
  const sessions = inv.count_sessions?.rows || [];
  const now = new Date().toISOString();

  let sessionRowNum = null;
  for (let i = 0; i < sessions.length; i++) {
    if (sessions[i][SESSION_IDX.sessionId] === sessionId) {
      sessionRowNum = i + 2;
      break;
    }
  }
  if (!sessionRowNum) {
    throw new Error("Session not found");
  }

  const countItems = (inv.count_items?.rows || []).filter(
    (r) => r[CI_IDX.sessionId] === sessionId
  );
  const catTotals = { Food: 0, Packaging: 0, Supplies: 0, Snacks: 0, Beverages: 0 };
  const catalogRows = inv.item_catalog?.rows || [];
  const catMap = {};
  catalogRows.forEach((r) => { catMap[r[CAT_IDX.itemId]] = r[CAT_IDX.category] || "Food"; });

  let grandTotal = 0;
  countItems.forEach((r) => {
    const ext = parseNum(r[CI_IDX.extendedPrice]);
    const cat = catMap[r[CI_IDX.itemId]] || "Food";
    if (catTotals[cat] !== undefined) catTotals[cat] += ext;
    else catTotals.Food += ext;
    grandTotal += ext;
  });

  await batchUpdateRangesSA(SHEET_IDS.INVENTORY, [
    { range: `count_sessions!F${sessionRowNum}`, values: [["submitted"]] },
    { range: `count_sessions!G${sessionRowNum}`, values: [[email || ""]] },
    { range: `count_sessions!H${sessionRowNum}`, values: [[now]] },
    { range: `count_sessions!I${sessionRowNum}`, values: [[catTotals.Food.toFixed(2)]] },
    { range: `count_sessions!J${sessionRowNum}`, values: [[catTotals.Packaging.toFixed(2)]] },
    { range: `count_sessions!K${sessionRowNum}`, values: [[catTotals.Supplies.toFixed(2)]] },
    { range: `count_sessions!L${sessionRowNum}`, values: [[catTotals.Snacks.toFixed(2)]] },
    { range: `count_sessions!M${sessionRowNum}`, values: [[catTotals.Beverages.toFixed(2)]] },
    { range: `count_sessions!N${sessionRowNum}`, values: [[grandTotal.toFixed(2)]] },
  ]);

  // priceAtLastCount on catalog items (col K)
  const priceUpdates = [];
  countItems.forEach((r) => {
    const itemId = r[CI_IDX.itemId];
    const priceAtCount = parseNum(r[CI_IDX.priceAtCount]);
    if (priceAtCount > 0) {
      for (let i = 0; i < catalogRows.length; i++) {
        if (catalogRows[i][CAT_IDX.itemId] === itemId && accountMatch(catalogRows[i][CAT_IDX.account], account)) {
          priceUpdates.push({ range: `item_catalog!K${i + 2}`, values: [[priceAtCount]] });
          break;
        }
      }
    }
  });
  if (priceUpdates.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < priceUpdates.length; i += CHUNK) {
      await batchUpdateRangesSA(SHEET_IDS.INVENTORY, priceUpdates.slice(i, i + CHUNK));
    }
  }

  invalidateCache(SHEET_IDS.INVENTORY, "count_sessions");
  invalidateCache(SHEET_IDS.INVENTORY, "item_catalog");
  return { grandTotal, catTotals, itemsCounted: countItems.length };
}

// ── Inventory item writes ──
async function createInventoryItemSheets({ account, name, vendor, category, unit, price, locationId, email }) {
  const itemId = generateId("inv");
  const now = new Date().toISOString();
  const priceNum = parseNum(price);
  await appendRowSA(SHEET_IDS.INVENTORY, "item_catalog", [
    itemId, account, name, category || "Uncategorized", unit || "each",
    locationId || "", vendor, priceNum || "", priceNum ? now.slice(0, 10) : "",
    priceNum ? vendor : "", 0, "TRUE", "FALSE", "FALSE",
    email || "manual", now, "", "", priceNum ? now.slice(0, 10) : "",
  ]);
  if (priceNum > 0) {
    await appendRowSA(SHEET_IDS.INVENTORY, "price_history", [
      itemId, account, vendor, priceNum, now.slice(0, 10), "manual-add", now,
    ]);
  }
  invalidateCache(SHEET_IDS.INVENTORY, "item_catalog");
  invalidateCache(SHEET_IDS.INVENTORY, "price_history");
  return { itemId };
}

async function verifyItemPriceSheets({ account, itemId, price, email }) {
  const priceNum = parseNum(price);
  if (!priceNum || priceNum <= 0) throw new Error("Valid price required");
  const { rows } = await readSheetSA(SHEET_IDS.INVENTORY, "item_catalog");
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][CAT_IDX.itemId] === itemId && accountMatch(rows[i][CAT_IDX.account], account)) {
      const now = new Date().toISOString();
      const vendor = rows[i][CAT_IDX.primaryVendor] || "";
      await batchUpdateRangesSA(SHEET_IDS.INVENTORY, [
        { range: `item_catalog!H${i + 2}`, values: [[priceNum]] },
        { range: `item_catalog!I${i + 2}`, values: [[now.slice(0, 10)]] },
        { range: `item_catalog!J${i + 2}`, values: [[vendor]] },
        { range: `item_catalog!S${i + 2}`, values: [[now.slice(0, 10)]] },
      ]);
      await appendRowSA(SHEET_IDS.INVENTORY, "price_history", [
        itemId, account, vendor, priceNum, now.slice(0, 10), "manual-verify", now,
      ]);
      break;
    }
  }
  invalidateCache(SHEET_IDS.INVENTORY, "item_catalog");
  invalidateCache(SHEET_IDS.INVENTORY, "price_history");
}

async function moveItemsBulkSheets({ account, items }) {
  if (!items || items.length === 0) return { moved: 0 };
  const catalogData = await readSheetSA(SHEET_IDS.INVENTORY, "item_catalog");
  const rows = catalogData.rows || [];
  const data = [];
  for (const move of items) {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][CAT_IDX.itemId] === move.itemId && accountMatch(rows[i][CAT_IDX.account], account)) {
        data.push({ range: `item_catalog!F${i + 2}`, values: [[move.newLocationId]] });
        break;
      }
    }
  }
  if (data.length === 0) return { moved: 0 };
  const CHUNK = 500;
  let moved = 0;
  for (let c = 0; c < data.length; c += CHUNK) {
    const chunk = data.slice(c, c + CHUNK);
    const result = await batchUpdateRangesSA(SHEET_IDS.INVENTORY, chunk);
    if (!result?.success) {
      throw new Error(result?.error || "moveItemsBulkSheets failed");
    }
    moved += chunk.length;
  }
  invalidateCache(SHEET_IDS.INVENTORY, "item_catalog");
  return { moved };
}

// ── Merge (the multi-step Sheets sequence) ──
async function mergeInventoryItemsSheets({ account, keeperItemId, mergedItemIds, canonicalName, category, unit, email }) {
  const inv = await batchRead(
    SHEET_IDS.INVENTORY,
    ["item_catalog", "item_aliases", "price_history"],
    { fresh: true }
  );
  const catalogRows = inv.item_catalog?.rows || [];
  const aliasRows   = inv.item_aliases?.rows || [];
  const priceRows   = inv.price_history?.rows || [];
  const now = new Date().toISOString();

  let keeperRowNum = null;
  let keeperRow = null;
  for (let i = 0; i < catalogRows.length; i++) {
    if (catalogRows[i][CAT_IDX.itemId] === keeperItemId) {
      keeperRowNum = i + 2;
      keeperRow = [...catalogRows[i]];
      break;
    }
  }
  if (!keeperRowNum) throw new Error("Keeper item not found");

  // Update keeper name/category/unit
  await updateRangeSA(
    SHEET_IDS.INVENTORY,
    `item_catalog!C${keeperRowNum}:E${keeperRowNum}`,
    [[canonicalName || keeperRow[CAT_IDX.name], category || keeperRow[CAT_IDX.category], unit || keeperRow[CAT_IDX.unit]]]
  );

  const mergedNames = [];
  const aliasRemapOps = [];
  const priceRemapOps = [];

  for (const mergedId of mergedItemIds) {
    for (let i = 0; i < catalogRows.length; i++) {
      if (catalogRows[i][CAT_IDX.itemId] === mergedId) {
        const rowNum = i + 2;
        mergedNames.push(catalogRows[i][CAT_IDX.name] || mergedId);

        await updateRangeSA(SHEET_IDS.INVENTORY, `item_catalog!L${rowNum}`, [["FALSE"]]);

        await appendRowSA(SHEET_IDS.INVENTORY, "item_aliases", [
          generateId("alias"), catalogRows[i][CAT_IDX.name] || "", keeperItemId,
          catalogRows[i][CAT_IDX.primaryVendor] || "", 100, email || "item_review", now, "item_review",
        ]);

        aliasRows.forEach((a, ai) => {
          if (a[ALIAS_IDX.itemId] === mergedId) {
            aliasRemapOps.push({ range: `item_aliases!C${ai + 2}`, values: [[keeperItemId]] });
          }
        });
        priceRows.forEach((p, pi) => {
          if (p[PRICE_IDX.itemId] === mergedId) {
            priceRemapOps.push({ range: `price_history!A${pi + 2}`, values: [[keeperItemId]] });
          }
        });

        // Keeper-field side effects (matches handleMergeItems L668-682)
        if (catalogRows[i][CAT_IDX.locationId] && !keeperRow[CAT_IDX.locationId]) {
          await updateRangeSA(
            SHEET_IDS.INVENTORY,
            `item_catalog!F${keeperRowNum}`,
            [[catalogRows[i][CAT_IDX.locationId]]]
          );
          keeperRow[CAT_IDX.locationId] = catalogRows[i][CAT_IDX.locationId];
        }
        const mergedNotes = catalogRows[i][CAT_IDX.notes] || "";
        if (mergedNotes.trim()) {
          const keeperNotes = keeperRow[CAT_IDX.notes] || "";
          const combined = keeperNotes
            ? `${keeperNotes}\n[Merged from ${catalogRows[i][CAT_IDX.name]}]: ${mergedNotes}`
            : `[Merged from ${catalogRows[i][CAT_IDX.name]}]: ${mergedNotes}`;
          await updateRangeSA(
            SHEET_IDS.INVENTORY,
            `item_catalog!R${keeperRowNum}`,
            [[combined.slice(0, 500)]]
          );
          keeperRow[CAT_IDX.notes] = combined.slice(0, 500);
        }
        break;
      }
    }
  }

  if (aliasRemapOps.length > 0) await batchUpdateRangesSA(SHEET_IDS.INVENTORY, aliasRemapOps);
  if (priceRemapOps.length > 0) await batchUpdateRangesSA(SHEET_IDS.INVENTORY, priceRemapOps);

  await appendRowSA(SHEET_IDS.INVENTORY, "merge_history", [
    generateId("mrg"), account, now, email || "",
    keeperItemId, canonicalName || keeperRow[CAT_IDX.name],
    JSON.stringify(mergedItemIds), JSON.stringify(mergedNames),
    "merge", "",
  ]);

  invalidateCache(SHEET_IDS.INVENTORY, "item_catalog");
  invalidateCache(SHEET_IDS.INVENTORY, "item_aliases");
  invalidateCache(SHEET_IDS.INVENTORY, "price_history");

  return { merged: mergedItemIds.length, mergedNames };
}

async function logKeepSeparateSheets({ account, itemIds, itemNames, email }) {
  const now = new Date().toISOString();
  await appendRowSA(SHEET_IDS.INVENTORY, "merge_history", [
    generateId("mrg"), account, now, email || "",
    "", "",
    JSON.stringify(itemIds), JSON.stringify(itemNames || itemIds),
    "keep_separate", "",
  ]);
}

// ── Review actions ──
// NOTE: zone_corrections write DROPPED on both sides per INV-1 (vestigial table).
async function acceptReviewItemSheets({ account, itemId, name, category, unit, locationId, email }) {
  const { rows } = await readSheetSA(SHEET_IDS.INVENTORY, "item_catalog");
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][CAT_IDX.itemId] === itemId && accountMatch(rows[i][CAT_IDX.account], account)) {
      const rowNum = i + 2;
      const updates = [name || rows[i][CAT_IDX.name], category || rows[i][CAT_IDX.category], unit || rows[i][CAT_IDX.unit]];
      await updateRangeSA(SHEET_IDS.INVENTORY, `item_catalog!C${rowNum}:E${rowNum}`, [updates]);
      if (locationId) {
        await updateRangeSA(SHEET_IDS.INVENTORY, `item_catalog!F${rowNum}`, [[locationId]]);
      }
      await updateRangeSA(SHEET_IDS.INVENTORY, `item_catalog!Q${rowNum}`, [["reviewed"]]);
      break;
    }
  }
  invalidateCache(SHEET_IDS.INVENTORY, "item_catalog");
}

async function deleteReviewItemSheets({ account, itemId, reason, email }) {
  const { rows } = await readSheetSA(SHEET_IDS.INVENTORY, "item_catalog");
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][CAT_IDX.itemId] === itemId && accountMatch(rows[i][CAT_IDX.account], account)) {
      const itemName = rows[i][CAT_IDX.name] || "";
      await batchUpdateRangesSA(SHEET_IDS.INVENTORY, [
        { range: `item_catalog!L${i + 2}`, values: [["FALSE"]] },
        { range: `item_catalog!Q${i + 2}`, values: [["review_deleted"]] },
      ]);
      await appendRowSA(SHEET_IDS.INVENTORY, "merge_history", [
        generateId("mrg"), account, new Date().toISOString(), email || "",
        itemId, itemName, "", "", "review_delete", reason || "",
      ]);
      break;
    }
  }
  invalidateCache(SHEET_IDS.INVENTORY, "item_catalog");
}

async function excludeItemSheets({ account, itemId, email }) {
  const { rows } = await readSheetSA(SHEET_IDS.INVENTORY, "item_catalog");
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][CAT_IDX.itemId] === itemId && accountMatch(rows[i][CAT_IDX.account], account)) {
      await batchUpdateRangesSA(SHEET_IDS.INVENTORY, [
        { range: `item_catalog!L${i + 2}`, values: [["FALSE"]] },
        { range: `item_catalog!Q${i + 2}`, values: [["excluded"]] },
      ]);
      await appendRowSA(SHEET_IDS.INVENTORY, "merge_history!A:A", [
        generateId("mrg"), account, new Date().toISOString(), email,
        itemId, rows[i][CAT_IDX.name] || "", "", "", "exclude", "",
      ]);
      break;
    }
  }
  invalidateCache(SHEET_IDS.INVENTORY, "item_catalog");
}

// ── Locations ──
async function saveStorageLocationsSheets({ account, locations, email }) {
  const { rows } = await readSheetSA(SHEET_IDS.INVENTORY, "storage_locations");
  await updateRangeSA(SHEET_IDS.INVENTORY, "storage_locations!I1:J1", [["parentLocationId", "color"]]);
  const existingRows = {};
  rows.forEach((r, i) => {
    if (accountMatch(r[LOC_IDX.account], account)) existingRows[r[LOC_IDX.locationId]] = i + 2;
  });
  const now = new Date().toISOString();
  const savedIds = new Set();
  const savedLocations = [];
  const newIdMap = {};

  const topLevel = locations.filter((l) => !l.parentLocationId);
  for (const loc of topLevel) {
    if (loc.locationId && existingRows[loc.locationId]) {
      const rowNum = existingRows[loc.locationId];
      await updateRangeSA(SHEET_IDS.INVENTORY, `storage_locations!A${rowNum}:J${rowNum}`, [[
        loc.locationId, account, loc.name, loc.icon || "box",
        loc.sortOrder, "TRUE", email, now, "", loc.color || "",
      ]]);
      savedIds.add(loc.locationId);
      savedLocations.push({ locationId: loc.locationId, name: loc.name });
    } else {
      const locationId = generateId("loc");
      newIdMap[loc.name] = locationId;
      await appendRowSA(SHEET_IDS.INVENTORY, "storage_locations!A:A", [
        locationId, account, loc.name, loc.icon || "box",
        loc.sortOrder, "TRUE", email, now, "", loc.color || "",
      ]);
      savedLocations.push({ locationId, name: loc.name });
    }
  }

  const subZones = locations.filter((l) => l.parentLocationId);
  for (const loc of subZones) {
    let parentId = loc.parentLocationId;
    if (!parentId && loc.parentName) parentId = newIdMap[loc.parentName] || "";

    if (loc.locationId && existingRows[loc.locationId]) {
      const rowNum = existingRows[loc.locationId];
      await updateRangeSA(SHEET_IDS.INVENTORY, `storage_locations!A${rowNum}:J${rowNum}`, [[
        loc.locationId, account, loc.name, loc.icon || "box",
        loc.sortOrder, "TRUE", email, now, parentId, loc.color || "",
      ]]);
      savedIds.add(loc.locationId);
    } else {
      const locationId = generateId("loc");
      await appendRowSA(SHEET_IDS.INVENTORY, "storage_locations!A:A", [
        locationId, account, loc.name, loc.icon || "box",
        loc.sortOrder, "TRUE", email, now, parentId, loc.color || "",
      ]);
      savedIds.add(locationId);
    }
  }

  for (const [locId, rowNum] of Object.entries(existingRows)) {
    if (!savedIds.has(locId)) {
      await updateRangeSA(SHEET_IDS.INVENTORY, `storage_locations!E${rowNum}:F${rowNum}`, [[999, "FALSE"]]);
    }
  }

  // ── Auto-assign items with keyword locationIds (preserved verbatim) ──
  const KEYWORD_PATTERNS = {
    cooler:   ["cool", "refrig", "reach-in", "walk-in c", "fridge"],
    freezer:  ["freez", "frost"],
    dry:      ["dry", "pantry", "shelf", "storage room"],
    beverage: ["bev", "bar", "drink"],
    supplies: ["supply", "suppli", "clean", "chem", "janitor", "paper"],
  };
  function matchKeywordToLocation(keyword) {
    const patterns = KEYWORD_PATTERNS[keyword];
    if (!patterns) return savedLocations[0]?.locationId || "";
    const nameLower = savedLocations.map((l) => ({ ...l, lower: l.name.toLowerCase() }));
    for (const pattern of patterns) {
      const match = nameLower.find((l) => l.lower.includes(pattern));
      if (match) return match.locationId;
    }
    return savedLocations[0]?.locationId || "";
  }
  const catalogData = await readSheetSA(SHEET_IDS.INVENTORY, "item_catalog");
  const catalogRows = catalogData.rows || [];
  let assigned = 0;
  const activeLocIds = new Set();
  rows.forEach((r) => {
    if (accountMatch(r[LOC_IDX.account], account) && !strToBoolFalse(r[LOC_IDX.active]) && r[LOC_IDX.locationId]) {
      activeLocIds.add(r[LOC_IDX.locationId]);
    }
  });
  savedLocations.forEach((l) => activeLocIds.add(l.locationId));

  let needsAssignment = false;
  for (let i = 0; i < catalogRows.length; i++) {
    const r = catalogRows[i];
    if (!accountMatch(r[CAT_IDX.account], account)) continue;
    const currentLocId = r[CAT_IDX.locationId] || "";
    if (!currentLocId
        || (currentLocId && !currentLocId.startsWith("loc_") && KEYWORD_PATTERNS[currentLocId])
        || (currentLocId.startsWith("loc_") && !activeLocIds.has(currentLocId))) {
      needsAssignment = true; break;
    }
  }
  if (needsAssignment) {
    for (let i = 0; i < catalogRows.length; i++) {
      const r = catalogRows[i];
      if (!accountMatch(r[CAT_IDX.account], account)) continue;
      const currentLocId = r[CAT_IDX.locationId] || "";
      const isOrphaned = currentLocId.startsWith("loc_") && !activeLocIds.has(currentLocId);
      if (currentLocId && !currentLocId.startsWith("loc_") && KEYWORD_PATTERNS[currentLocId]) {
        const realLocId = matchKeywordToLocation(currentLocId);
        if (realLocId) { await updateRangeSA(SHEET_IDS.INVENTORY, `item_catalog!F${i + 2}`, [[realLocId]]); assigned++; }
      }
      if (!currentLocId || isOrphaned) {
        const cat = (r[CAT_IDX.category] || "").toLowerCase();
        let keyword = "dry";
        if (["food"].includes(cat)) keyword = "cooler";
        if (["beverages"].includes(cat)) keyword = "beverage";
        if (["packaging", "supplies"].includes(cat)) keyword = "supplies";
        if (["snacks"].includes(cat)) keyword = "dry";
        const realLocId = matchKeywordToLocation(keyword);
        if (realLocId) { await updateRangeSA(SHEET_IDS.INVENTORY, `item_catalog!F${i + 2}`, [[realLocId]]); assigned++; }
      }
    }
    invalidateCache(SHEET_IDS.INVENTORY, "item_catalog");
  }
  invalidateCache(SHEET_IDS.INVENTORY, "storage_locations");
  invalidateCache(SHEET_IDS.INVENTORY, "item_catalog");
  return { count: locations.length, assigned };
}

async function saveLocationSortOrderSheets({ account, updates }) {
  if (!updates || updates.length === 0) return { updated: 0 };
  const { rows } = await readSheetSA(SHEET_IDS.INVENTORY, "storage_locations");
  const data = [];
  for (const u of updates) {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][LOC_IDX.locationId] === u.locationId && accountMatch(rows[i][LOC_IDX.account], account)) {
        data.push({ range: `storage_locations!E${i + 2}`, values: [[u.sortOrder]] });
        break;
      }
    }
  }
  if (data.length > 0) await batchUpdateRangesSA(SHEET_IDS.INVENTORY, data);
  invalidateCache(SHEET_IDS.INVENTORY, "storage_locations");
  return { updated: data.length };
}

async function addStorageSubZoneSheets({ account, parentLocationId, name, icon, color, email }) {
  const { rows } = await readSheetSA(SHEET_IDS.INVENTORY, "storage_locations");
  let maxSort = -1;
  rows.forEach((r) => {
    if (accountMatch(r[LOC_IDX.account], account)
        && (r[LOC_IDX.parentLocationId] || "") === (parentLocationId || "")
        && !strToBoolFalse(r[LOC_IDX.active])) {
      const s = Number(r[LOC_IDX.sortOrder] || 0);
      if (s > maxSort) maxSort = s;
    }
  });
  const locationId = generateId("loc");
  const now = new Date().toISOString();
  await appendRowSA(SHEET_IDS.INVENTORY, "storage_locations!A:A", [
    locationId, account, name, icon || "box",
    maxSort + 1, "TRUE", email, now, parentLocationId, color || "",
  ]);
  invalidateCache(SHEET_IDS.INVENTORY, "storage_locations");
  return { locationId, name };
}

async function updateStorageLocationSheets({ account, locationId, fields }) {
  const { rows } = await readSheetSA(SHEET_IDS.INVENTORY, "storage_locations");
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][LOC_IDX.locationId] === locationId
        && accountMatch(rows[i][LOC_IDX.account], account)
        && !strToBoolFalse(rows[i][LOC_IDX.active])) {
      const updates = [];
      if (fields.name !== undefined)  updates.push({ range: `storage_locations!C${i + 2}`, values: [[fields.name]] });
      if (fields.icon !== undefined)  updates.push({ range: `storage_locations!D${i + 2}`, values: [[fields.icon]] });
      if (fields.color !== undefined) updates.push({ range: `storage_locations!J${i + 2}`, values: [[fields.color]] });
      if (updates.length > 0) await batchUpdateRangesSA(SHEET_IDS.INVENTORY, updates);
      break;
    }
  }
  invalidateCache(SHEET_IDS.INVENTORY, "storage_locations");
}

async function deactivateStorageLocationSheets({ account, locationId }) {
  const { rows } = await readSheetSA(SHEET_IDS.INVENTORY, "storage_locations");
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][LOC_IDX.locationId] === locationId && accountMatch(rows[i][LOC_IDX.account], account)) {
      await updateRangeSA(SHEET_IDS.INVENTORY, `storage_locations!E${i + 2}:F${i + 2}`, [[999, "FALSE"]]);
      invalidateCache(SHEET_IDS.INVENTORY, "storage_locations");
      return { ok: true };
    }
  }
  return { ok: false };
}

// ── Catalog partial updates ──
async function updateCatalogItemSheets({ account, itemId, fields, email }) {
  const { rows } = await readSheetSA(SHEET_IDS.INVENTORY, "item_catalog");
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][CAT_IDX.itemId] === itemId && accountMatch(rows[i][CAT_IDX.account], account)) {
      const updates = [];
      if (fields.category !== undefined) updates.push({ range: `item_catalog!D${i + 2}`, values: [[fields.category]] });
      if (fields.notes !== undefined)    updates.push({ range: `item_catalog!R${i + 2}`, values: [[fields.notes]] });
      if (updates.length > 0) await batchUpdateRangesSA(SHEET_IDS.INVENTORY, updates);
      break;
    }
  }
  invalidateCache(SHEET_IDS.INVENTORY, "item_catalog");
}

async function archiveItemSheets({ account, itemId, email }) {
  const { rows } = await readSheetSA(SHEET_IDS.INVENTORY, "item_catalog");
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][CAT_IDX.itemId] === itemId && accountMatch(rows[i][CAT_IDX.account], account)) {
      await batchUpdateRangesSA(SHEET_IDS.INVENTORY, [
        { range: `item_catalog!L${i + 2}`, values: [["FALSE"]] },
        { range: `item_catalog!Q${i + 2}`, values: [["archived"]] },
      ]);
      await appendRowSA(SHEET_IDS.INVENTORY, "merge_history", [
        generateId("mrg"), account, new Date().toISOString(), email || "",
        itemId, rows[i][CAT_IDX.name] || "", "", "", "archive", "",
      ]);
      break;
    }
  }
  invalidateCache(SHEET_IDS.INVENTORY, "item_catalog");
}

async function reactivateItemSheets({ account, itemId, email }) {
  const { rows } = await readSheetSA(SHEET_IDS.INVENTORY, "item_catalog");
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][CAT_IDX.itemId] === itemId && accountMatch(rows[i][CAT_IDX.account], account)) {
      await batchUpdateRangesSA(SHEET_IDS.INVENTORY, [
        { range: `item_catalog!L${i + 2}`, values: [["TRUE"]] },
        { range: `item_catalog!Q${i + 2}`, values: [[""]] },
      ]);
      await appendRowSA(SHEET_IDS.INVENTORY, "merge_history", [
        generateId("mrg"), account, new Date().toISOString(), email || "",
        itemId, rows[i][CAT_IDX.name] || "", "", "", "reactivate", "",
      ]);
      break;
    }
  }
  invalidateCache(SHEET_IDS.INVENTORY, "item_catalog");
}

// ═══════════════════════════════════════════════════════════════
// POSTGRES ADAPTERS
// ═══════════════════════════════════════════════════════════════
//
// Reads use the views built in INV-1 wherever possible:
//   v_inventory_items_full          (last_price + price_at_last_count)
//   v_count_session_totals          (Option B totals)
//   v_current_count_items           (latest locationSaveId window)
//   v_price_movers                  (>=5% per-item-per-account)
//   v_price_history_ranked          (LAG() ranked history)
//
// Writes hit the INV-1 tables directly. accountMatch is NOT used; direct
// equality is safe because of the canonical account_key CHECK constraint.

async function readBootstrapPostgres({ account, currentPeriod }) {
  const supa = getServiceClient();

  // Catalog with derived columns (v_inventory_items_full)
  const { data: itemRows, error: itemErr } = await supa
    .from("v_inventory_items_full")
    .select("*")
    .eq("account", account);
  if (itemErr) throw new Error(`[dataStore.inventory.pg] bootstrap items: ${itemErr.message}`);

  const allItems = (itemRows || []).map(catalogFromPgRow);
  const catalogItems = allItems.filter((i) => i.active);

  const catalogStats = { totalItems: catalogItems.length, byCategory: {} };
  catalogItems.forEach((i) => {
    catalogStats.byCategory[i.category] = (catalogStats.byCategory[i.category] || 0) + 1;
  });

  const excludedItems = allItems
    .filter((i) => i.status === "excluded")
    .map((i) => ({
      itemId: i.itemId, name: i.name, category: i.category, unit: i.unit,
      primaryVendor: i.primaryVendor, lastPrice: i.lastPrice,
    }));
  const archivedItems = allItems
    .filter((i) => i.status === "archived")
    .map((i) => ({
      itemId: i.itemId, name: i.name, category: i.category, unit: i.unit,
      locationId: i.locationId, primaryVendor: i.primaryVendor,
      lastPrice: i.lastPrice, lastPriceDate: i.lastPriceDate,
      lastPriceVendor: i.lastPriceVendor, createdBy: i.createdBy,
      notes: i.notes, lastVerified: i.lastVerified,
    }));

  // Aliases (only for active catalog items)
  const activeIds = catalogItems.map((i) => i.itemId);
  let aliases = [];
  if (activeIds.length > 0) {
    const { data: aliasRows, error: aliasErr } = await supa
      .from("item_aliases")
      .select("id, alias_text, item_id, vendor_name:vendor_id");
    if (aliasErr) throw new Error(`[dataStore.inventory.pg] bootstrap aliases: ${aliasErr.message}`);
    const idSet = new Set(activeIds);
    aliases = (aliasRows || [])
      .filter((r) => idSet.has(r.item_id))
      .map(aliasFromPgRow);
  }

  // Locations
  const { data: locRows, error: locErr } = await supa
    .from("storage_locations")
    .select("id, name, icon, sort_order, parent_location_id, color, active")
    .eq("account", account)
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (locErr) throw new Error(`[dataStore.inventory.pg] bootstrap locations: ${locErr.message}`);
  const locations = (locRows || []).map(locationFromPgRow);

  // Sessions
  const { data: sessionRows, error: sessionErr } = await supa
    .from("count_sessions")
    .select("id, account, period, status, started_by, started_at, submitted_by, submitted_at")
    .eq("account", account)
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .order("started_at", { ascending: false });
  if (sessionErr) throw new Error(`[dataStore.inventory.pg] bootstrap sessions: ${sessionErr.message}`);
  const lastSubmittedSession = (sessionRows || []).find(
    (s) => s.status === "submitted" || s.status === "corrected"
  );
  const activeDraftSession = (sessionRows || []).find(
    (s) => s.status === "draft" && s.period === currentPeriod?.name
  );

  // lastCount totals (v_count_session_totals)
  let lastCount = null;
  if (lastSubmittedSession) {
    const { data: totalsRow } = await supa
      .from("v_count_session_totals")
      .select("*")
      .eq("session_id", lastSubmittedSession.id)
      .maybeSingle();
    lastCount = {
      sessionId:      lastSubmittedSession.id,
      period:         lastSubmittedSession.period,
      submittedBy:    lastSubmittedSession.submitted_by || lastSubmittedSession.started_by,
      submittedAt:    lastSubmittedSession.submitted_at || "",
      status:         lastSubmittedSession.status,
      totalFood:      Number(totalsRow?.total_food || 0),
      totalPackaging: Number(totalsRow?.total_packaging || 0),
      totalSupplies:  Number(totalsRow?.total_supplies || 0),
      totalSnacks:    Number(totalsRow?.total_snacks || 0),
      totalBeverages: Number(totalsRow?.total_beverages || 0),
      grandTotal:     Number(totalsRow?.grand_total || 0),
    };
  }

  // lastCountItems via v_current_count_items
  const lastCountItems = {};
  if (lastSubmittedSession) {
    const { data: ciRows } = await supa
      .from("v_current_count_items")
      .select("item_id, quantity, none_on_hand")
      .eq("session_id", lastSubmittedSession.id);
    (ciRows || []).forEach((r) => {
      lastCountItems[r.item_id] = {
        quantity:   Number(r.quantity || 0),
        noneOnHand: !!r.none_on_hand,
      };
    });
  }

  // review queue count
  const { count: rqCount } = await supa
    .from("review_queue")
    .select("id", { count: "exact", head: true })
    .eq("account", account)
    .eq("status", "pending");

  // priceMovers from v_price_movers
  const { data: moverRows } = await supa
    .from("v_price_movers")
    .select("item_id, current_price, prior_price, change, pct_change, direction")
    .eq("account", account);
  const itemNameById = Object.fromEntries(catalogItems.map((i) => [i.itemId, i.name]));
  const priceMovers = (moverRows || [])
    .map((r) => ({
      itemId: r.item_id,
      name:   itemNameById[r.item_id] || r.item_id,
      currentPrice:  Number(r.current_price || 0),
      previousPrice: Number(r.prior_price || 0),
      change:        Number(r.change || 0),
      pctChange:     String(r.pct_change),
      direction:     r.direction,
    }))
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 10);

  // itemPrices top-6 via v_price_history_ranked
  const { data: rankedRows } = await supa
    .from("v_price_history_ranked")
    .select("item_id, price, effective_date, vendor_id, rn")
    .eq("account", account)
    .lte("rn", 6);
  const itemPrices = {};
  (rankedRows || []).forEach((r) => {
    if (!itemPrices[r.item_id]) itemPrices[r.item_id] = [];
    itemPrices[r.item_id].push({
      price:  Number(r.price || 0),
      vendor: r.vendor_id,
      date:   r.effective_date ? String(r.effective_date) : "",
    });
  });

  const currentPeriodSubmitted = (sessionRows || []).some(
    (s) =>
      s.period === currentPeriod?.name
      && (s.status === "submitted" || s.status === "corrected")
  );

  return {
    catalogItems,
    catalogStats,
    locations,
    excludedItems,
    archivedItems,
    aliases,
    lastCount,
    lastCountItems,
    activeDraft: activeDraftSession
      ? {
          sessionId: activeDraftSession.id,
          period:    activeDraftSession.period,
          startedAt: activeDraftSession.started_at,
        }
      : null,
    reviewQueueCount: rqCount ?? 0,
    priceMovers,
    itemPrices,
    currentPeriodSubmitted,
  };
}

async function readCatalogForAccountPostgres({ account }) {
  const supa = getServiceClient();
  const { data: itemRows } = await supa
    .from("v_inventory_items_full")
    .select("*")
    .eq("account", account)
    .eq("status", "active");
  const items = (itemRows || []).map(catalogFromPgRow);
  const ids = items.map((i) => i.itemId);
  let aliases = [];
  if (ids.length > 0) {
    const { data: aliasRows } = await supa
      .from("item_aliases")
      .select("id, alias_text, item_id, vendor_name:vendor_id")
      .in("item_id", ids);
    aliases = (aliasRows || []).map(aliasFromPgRow);
  }
  return { items, aliases };
}

async function readCatalogForMatchingPostgres({ account }) {
  // Same shape; the legacy filter required name + itemId non-empty which the
  // PG NOT NULL constraints already guarantee.
  return readCatalogForAccountPostgres({ account });
}

// ── Count session writes ──
async function createCountSessionPostgres({ account, period, email, sessionId }) {
  const supa = getServiceClient();
  const { error } = await supa.from("count_sessions").insert({
    id: sessionId, account, period, started_by: email, status: "draft",
  });
  if (error) throw new Error(`[dataStore.inventory.pg] createCountSession: ${error.message}`);
}

async function appendCountItemsPostgres({ sessionId, locationId, items, email, locationSaveId }) {
  const supa = getServiceClient();
  const rows = items.map((item) => ({
    session_id:       sessionId,
    location_save_id: locationSaveId,
    item_id:          item.itemId,
    quantity:         item.quantity ?? 0,
    unit:             item.unit || "EA",
    price_at_count:   item.priceAtCount ?? 0,
    location_id:      locationId || null,
    saved_by:         email,
    none_on_hand:     !!item.noneOnHand,
  }));
  if (rows.length === 0) return;
  const { error } = await supa.from("count_items").insert(rows);
  if (error) throw new Error(`[dataStore.inventory.pg] appendCountItems: ${error.message}`);
}

async function submitCountSessionPostgres({ sessionId, email }) {
  // D7 Option B: NO total writes on submit. Just status + submitted_by/at.
  const supa = getServiceClient();
  const { error } = await supa
    .from("count_sessions")
    .update({ status: "submitted", submitted_by: email, submitted_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) throw new Error(`[dataStore.inventory.pg] submitCountSession: ${error.message}`);
}

// ── Inventory item writes ──
// vendor_id resolution is deferred to INV-3 backfill / future enhancement.
// For now: dual-write only fires once vendor_id is reliably available.
// During the dual-write window (flags off in INV-2), this is dormant.
async function createInventoryItemPostgres({ account, name, vendor, category, unit, price, locationId, email, itemId }) {
  const supa = getServiceClient();
  const vendorId = await resolveVendorIdPostgres(vendor);
  if (!vendorId) {
    // Without a resolvable vendor_id, we can't insert (NOT NULL FK).
    // Log + skip; the Sheets side is authoritative.
    console.warn(`[dataStore.inventory.pg] createInventoryItem: vendor "${vendor}" not resolvable, skipping PG insert`);
    return;
  }
  const { error } = await supa.from("inventory_items").insert({
    id: itemId, account, name,
    category: category || null,
    unit: unit || "each",
    location_id: locationId || null,
    vendor_id: vendorId,
    linked_to_invoice: false,
    is_variety_group: false,
    created_by: email || "manual",
    status: "active",
  });
  if (error) throw new Error(`[dataStore.inventory.pg] createInventoryItem: ${error.message}`);
  const priceNum = parseNum(price);
  if (priceNum > 0) {
    await supa.from("price_history").insert({
      item_id: itemId, account, vendor_id: vendorId,
      price: priceNum,
      effective_date: new Date().toISOString().slice(0, 10),
      source: "manual_add",
      source_or_invoice_id: `manual-add:${itemId}:${Date.now()}`,
      recorded_by: email || "manual",
    });
  }
}

async function resolveVendorIdPostgres(vendorName) {
  if (!vendorName) return null;
  const supa = getServiceClient();
  const { data } = await supa
    .from("vendors")
    .select("id")
    .ilike("name", vendorName.trim())
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

async function verifyItemPricePostgres({ account, itemId, price, email }) {
  const supa = getServiceClient();
  const priceNum = parseNum(price);
  if (!priceNum || priceNum <= 0) return;
  // Look up vendor_id from the item's existing record.
  const { data: item } = await supa
    .from("inventory_items")
    .select("vendor_id")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return;
  await supa.from("price_history").insert({
    item_id: itemId, account, vendor_id: item.vendor_id,
    price: priceNum,
    effective_date: new Date().toISOString().slice(0, 10),
    source: "manual_verify",
    source_or_invoice_id: `manual-verify:${itemId}:${Date.now()}`,
    recorded_by: email || "manual",
  });
  // last_price / last_price_date / last_price_vendor are view-derived (no stored cols to update).
  // last_verified updates on inventory_items.
  await supa
    .from("inventory_items")
    .update({ last_verified: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", itemId);
}

async function moveItemsBulkPostgres({ account, items }) {
  const supa = getServiceClient();
  if (!items || items.length === 0) return { moved: 0 };
  // Update each item one at a time; small per-bulk size in practice.
  let moved = 0;
  for (const move of items) {
    const { error } = await supa
      .from("inventory_items")
      .update({ location_id: move.newLocationId || null, updated_at: new Date().toISOString() })
      .eq("id", move.itemId)
      .eq("account", account);
    if (!error) moved++;
  }
  return { moved };
}

// ── Merge: keeper-field side effects + RPC ──
async function mergeInventoryItemsPostgres({ account, keeperItemId, mergedItemIds, canonicalName, category, unit, email }) {
  const supa = getServiceClient();

  // 1. Apply keeper-field side effects in JS BEFORE the RPC so the
  //    atomic state the RPC produces is the FINAL one. Mirrors the
  //    Sheets path inline behavior:
  //      (a) copy a dupe's location_id to the keeper if keeper lacks one
  //      (b) append each dupe's notes to the keeper's notes (\n[Merged from <name>]: ...)
  //    The RPC handles name/category/unit rename via its p_canonical_name
  //    argument; we still need to push category + unit changes here
  //    because the RPC's UPDATE inventory_items SET name only sets name.

  // Read keeper + dupes once.
  const { data: keeper } = await supa
    .from("inventory_items")
    .select("id, location_id, notes, name")
    .eq("id", keeperItemId)
    .maybeSingle();
  if (!keeper) throw new Error("Keeper item not found in PG");
  const { data: dupeItems } = await supa
    .from("inventory_items")
    .select("id, location_id, notes, name")
    .in("id", mergedItemIds);

  let newKeeperLocId = keeper.location_id;
  let newKeeperNotes = keeper.notes || "";
  for (const d of dupeItems || []) {
    if (d.location_id && !newKeeperLocId) {
      newKeeperLocId = d.location_id;
    }
    const dupeNotes = (d.notes || "").trim();
    if (dupeNotes) {
      newKeeperNotes = newKeeperNotes
        ? `${newKeeperNotes}\n[Merged from ${d.name}]: ${dupeNotes}`
        : `[Merged from ${d.name}]: ${dupeNotes}`;
      if (newKeeperNotes.length > 500) newKeeperNotes = newKeeperNotes.slice(0, 500);
    }
  }

  // Apply the side effects (category, unit, location_id copy, notes append).
  // The RPC handles name rename + the atomic alias/price reassign + dupe archive.
  const keeperFieldUpdates = { updated_at: new Date().toISOString() };
  if (category) keeperFieldUpdates.category = category;
  if (unit)     keeperFieldUpdates.unit = unit;
  if (newKeeperLocId && newKeeperLocId !== keeper.location_id) {
    keeperFieldUpdates.location_id = newKeeperLocId;
  }
  if (newKeeperNotes !== (keeper.notes || "")) {
    keeperFieldUpdates.notes = newKeeperNotes;
  }
  if (Object.keys(keeperFieldUpdates).length > 1) {  // > 1 because updated_at is always set
    const { error } = await supa
      .from("inventory_items")
      .update(keeperFieldUpdates)
      .eq("id", keeperItemId);
    if (error) throw new Error(`[dataStore.inventory.pg] mergeInventoryItems keeper update: ${error.message}`);
  }

  // 2. Call the atomic RPC.
  const { data: rpcResult, error: rpcError } = await supa.rpc("merge_inventory_items", {
    p_keeper_id:      keeperItemId,
    p_dupe_ids:       mergedItemIds,
    p_canonical_name: canonicalName || null,
    p_email:          email || "",
  });
  if (rpcError) throw new Error(`[dataStore.inventory.pg] merge_inventory_items RPC: ${rpcError.message}`);
  return rpcResult;
}

async function logKeepSeparatePostgres({ account, itemIds, itemNames, email }) {
  const supa = getServiceClient();
  const { data: header, error } = await supa
    .from("merge_history")
    .insert({
      account, keeper_item_id: null, action: "keep_separate", email,
    })
    .select("id")
    .single();
  if (error) throw new Error(`[dataStore.inventory.pg] logKeepSeparate: ${error.message}`);
  // Junction entries (role=merged) for each item.
  const junction = itemIds.map((id, idx) => ({
    merge_id:  header.id,
    item_id:   id,
    item_name: (itemNames && itemNames[idx]) || id,
    role:      "merged",
  }));
  if (junction.length > 0) {
    const { error: jErr } = await supa.from("merge_history_items").insert(junction);
    if (jErr) throw new Error(`[dataStore.inventory.pg] logKeepSeparate junction: ${jErr.message}`);
  }
}

// ── Review actions (PG side; zone_corrections dropped) ──
async function acceptReviewItemPostgres({ account, itemId, name, category, unit, locationId, email }) {
  const supa = getServiceClient();
  const updates = { updated_at: new Date().toISOString() };
  if (name)       updates.name = name;
  if (category)   updates.category = category;
  if (unit)       updates.unit = unit;
  if (locationId) updates.location_id = locationId;
  // Sheets uses col Q = "reviewed". The PG status enum has no
  // "reviewed" value; we encode this as a no-op on the status side
  // (it stays 'active'). The actual "this was reviewed" signal lives
  // in the review_queue row's status flip (resolver UI deferred).
  const { error } = await supa
    .from("inventory_items")
    .update(updates)
    .eq("id", itemId)
    .eq("account", account);
  if (error) throw new Error(`[dataStore.inventory.pg] acceptReviewItem: ${error.message}`);
}

async function deleteReviewItemPostgres({ account, itemId, reason, email }) {
  const supa = getServiceClient();
  const { data: item } = await supa
    .from("inventory_items")
    .select("name")
    .eq("id", itemId)
    .eq("account", account)
    .maybeSingle();
  if (!item) return;
  const { error: e1 } = await supa
    .from("inventory_items")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", itemId);
  if (e1) throw new Error(`[dataStore.inventory.pg] deleteReviewItem update: ${e1.message}`);
  const { data: mh, error: e2 } = await supa
    .from("merge_history")
    .insert({
      account, keeper_item_id: null, action: "review_delete", email, reason: reason || null,
    })
    .select("id")
    .single();
  if (e2) throw new Error(`[dataStore.inventory.pg] deleteReviewItem merge_history: ${e2.message}`);
  await supa.from("merge_history_items").insert({
    merge_id: mh.id, item_id: itemId, item_name: item.name, role: "merged",
  });
}

async function excludeItemPostgres({ account, itemId, email }) {
  const supa = getServiceClient();
  const { data: item } = await supa
    .from("inventory_items")
    .select("name")
    .eq("id", itemId)
    .eq("account", account)
    .maybeSingle();
  if (!item) return;
  const { error: e1 } = await supa
    .from("inventory_items")
    .update({ status: "excluded", updated_at: new Date().toISOString() })
    .eq("id", itemId);
  if (e1) throw new Error(`[dataStore.inventory.pg] excludeItem update: ${e1.message}`);
  const { data: mh, error: e2 } = await supa
    .from("merge_history")
    .insert({ account, keeper_item_id: null, action: "exclude", email })
    .select("id")
    .single();
  if (e2) throw new Error(`[dataStore.inventory.pg] excludeItem merge_history: ${e2.message}`);
  await supa.from("merge_history_items").insert({
    merge_id: mh.id, item_id: itemId, item_name: item.name, role: "merged",
  });
}

// ── Storage locations ──
async function saveStorageLocationsPostgres({ account, locations, email }) {
  const supa = getServiceClient();
  // Existing locations for this account (for upsert decision).
  const { data: existing } = await supa
    .from("storage_locations")
    .select("id, parent_location_id")
    .eq("account", account);
  const existingIds = new Set((existing || []).map((r) => r.id));
  const savedIds = new Set();
  const newIdMap = {};

  const topLevel = locations.filter((l) => !l.parentLocationId);
  for (const loc of topLevel) {
    if (loc.locationId && existingIds.has(loc.locationId)) {
      await supa.from("storage_locations").update({
        name: loc.name, icon: loc.icon || "box",
        sort_order: loc.sortOrder, active: true,
        color: loc.color || null, parent_location_id: null,
      }).eq("id", loc.locationId);
      savedIds.add(loc.locationId);
    } else {
      const id = loc.locationId || generateId("loc");
      newIdMap[loc.name] = id;
      await supa.from("storage_locations").insert({
        id, account, name: loc.name, icon: loc.icon || "box",
        sort_order: loc.sortOrder, active: true,
        color: loc.color || null, created_by: email,
      });
      savedIds.add(id);
    }
  }

  const subZones = locations.filter((l) => l.parentLocationId);
  for (const loc of subZones) {
    let parentId = loc.parentLocationId;
    if (!parentId && loc.parentName) parentId = newIdMap[loc.parentName] || null;
    if (loc.locationId && existingIds.has(loc.locationId)) {
      await supa.from("storage_locations").update({
        name: loc.name, icon: loc.icon || "box",
        sort_order: loc.sortOrder, active: true,
        color: loc.color || null, parent_location_id: parentId,
      }).eq("id", loc.locationId);
      savedIds.add(loc.locationId);
    } else {
      const id = loc.locationId || generateId("loc");
      await supa.from("storage_locations").insert({
        id, account, name: loc.name, icon: loc.icon || "box",
        sort_order: loc.sortOrder, active: true,
        color: loc.color || null, parent_location_id: parentId,
        created_by: email,
      });
      savedIds.add(id);
    }
  }

  // Deactivate removed locations.
  for (const r of existing || []) {
    if (!savedIds.has(r.id)) {
      await supa.from("storage_locations")
        .update({ active: false, sort_order: 999 })
        .eq("id", r.id);
    }
  }
}

async function saveLocationSortOrderPostgres({ account, updates }) {
  const supa = getServiceClient();
  for (const u of updates) {
    await supa.from("storage_locations")
      .update({ sort_order: u.sortOrder })
      .eq("id", u.locationId)
      .eq("account", account);
  }
}

async function addStorageSubZonePostgres({ account, parentLocationId, name, icon, color, email, locationId }) {
  const supa = getServiceClient();
  // Compute next sort_order among siblings.
  const { data: siblings } = await supa
    .from("storage_locations")
    .select("sort_order")
    .eq("account", account)
    .eq("parent_location_id", parentLocationId || null)
    .eq("active", true);
  const maxSort = (siblings || []).reduce((m, r) => Math.max(m, r.sort_order || 0), -1);
  await supa.from("storage_locations").insert({
    id: locationId, account, name, icon: icon || "box",
    sort_order: maxSort + 1, active: true,
    color: color || null, parent_location_id: parentLocationId || null,
    created_by: email,
  });
}

async function updateStorageLocationPostgres({ account, locationId, fields }) {
  const supa = getServiceClient();
  const updates = {};
  if (fields.name  !== undefined) updates.name = fields.name;
  if (fields.icon  !== undefined) updates.icon = fields.icon;
  if (fields.color !== undefined) updates.color = fields.color;
  if (Object.keys(updates).length === 0) return;
  await supa.from("storage_locations")
    .update(updates)
    .eq("id", locationId)
    .eq("account", account)
    .eq("active", true);
}

async function deactivateStorageLocationPostgres({ account, locationId }) {
  const supa = getServiceClient();
  await supa.from("storage_locations")
    .update({ active: false, sort_order: 999 })
    .eq("id", locationId)
    .eq("account", account);
}

// ── Catalog partial updates ──
async function updateCatalogItemPostgres({ account, itemId, fields, email }) {
  const supa = getServiceClient();
  const updates = { updated_at: new Date().toISOString() };
  if (fields.category !== undefined) updates.category = fields.category;
  if (fields.notes    !== undefined) updates.notes = fields.notes;
  await supa.from("inventory_items")
    .update(updates)
    .eq("id", itemId)
    .eq("account", account);
}

async function archiveItemPostgres({ account, itemId, email }) {
  const supa = getServiceClient();
  const { data: item } = await supa
    .from("inventory_items")
    .select("name")
    .eq("id", itemId)
    .eq("account", account)
    .maybeSingle();
  if (!item) return;
  await supa.from("inventory_items")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", itemId);
  const { data: mh } = await supa
    .from("merge_history")
    .insert({ account, keeper_item_id: null, action: "archive", email })
    .select("id")
    .single();
  if (mh) {
    await supa.from("merge_history_items").insert({
      merge_id: mh.id, item_id: itemId, item_name: item.name, role: "merged",
    });
  }
}

async function reactivateItemPostgres({ account, itemId, email }) {
  const supa = getServiceClient();
  const { data: item } = await supa
    .from("inventory_items")
    .select("name")
    .eq("id", itemId)
    .eq("account", account)
    .maybeSingle();
  if (!item) return;
  await supa.from("inventory_items")
    .update({ status: "active", updated_at: new Date().toISOString() })
    .eq("id", itemId);
  const { data: mh } = await supa
    .from("merge_history")
    .insert({ account, keeper_item_id: null, action: "reactivate", email })
    .select("id")
    .single();
  if (mh) {
    await supa.from("merge_history_items").insert({
      merge_id: mh.id, item_id: itemId, item_name: item.name, role: "merged",
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC ORCHESTRATORS
// ═══════════════════════════════════════════════════════════════
//
// READ dispatch: PG if isReadFromPostgres(<canonical-table>, opts.module)
//   else Sheets. Note: bootstrap composes data from many tabs; we use
//   the inventory_items flag as the gate (if you cut over the catalog
//   to PG, you cut over the bootstrap; partial cutovers would create
//   cross-store joins).
//
// WRITE dispatch: Sheets ALWAYS, PG if isDualWrite(<canonical-table>).
//   Sheets return value is authoritative.

// ── Reads ──

export async function getInventoryBootstrap(opts = {}) {
  const { account, currentPeriod, fresh = false } = opts;
  if (isReadFromPostgres(INVENTORY_ITEMS_FLAG, opts.module)) {
    return readBootstrapPostgres({ account, currentPeriod });
  }
  return readBootstrapSheets({ account, fresh, currentPeriod });
}

export async function getCatalogForAccount(opts = {}) {
  if (isReadFromPostgres(INVENTORY_ITEMS_FLAG, opts.module)) {
    return readCatalogForAccountPostgres({ account: opts.account });
  }
  return readCatalogForAccountSheets({ account: opts.account });
}

export async function getCatalogForMatching(opts = {}) {
  if (isReadFromPostgres(INVENTORY_ITEMS_FLAG, opts.module)) {
    return readCatalogForMatchingPostgres({ account: opts.account });
  }
  return readCatalogForMatchingSheets({ account: opts.account });
}

export async function getRecentMergeHistory(opts = {}) {
  const { account, limit = 50 } = opts;
  if (isReadFromPostgres("merge_history", opts.module)) {
    return readRecentMergeHistoryPostgres({ account, limit });
  }
  return readRecentMergeHistorySheets({ account, limit });
}

// ── Writes ──

export async function createCountSession(input) {
  const sheetsResult = await createCountSessionSheets(input);
  if (isDualWrite("count_sessions")) {
    await createCountSessionPostgres({ ...input, sessionId: sheetsResult.sessionId });
  }
  return sheetsResult;
}

export async function appendCountItems(input) {
  const sheetsResult = await appendCountItemsSheets(input);
  if (isDualWrite("count_items")) {
    await appendCountItemsPostgres({ ...input, locationSaveId: sheetsResult.locationSaveId });
  }
  return sheetsResult;
}

export async function submitCountSession(input) {
  // Sheets path returns the computed totals; PG side flips status only
  // (totals are view-derived per D7 Option B).
  const sheetsResult = await submitCountSessionSheets(input);
  if (isDualWrite("count_sessions")) {
    await submitCountSessionPostgres({ sessionId: input.sessionId, email: input.email });
  }
  return sheetsResult;
}

export async function createInventoryItem(input) {
  const sheetsResult = await createInventoryItemSheets(input);
  if (isDualWrite(INVENTORY_ITEMS_FLAG)) {
    await createInventoryItemPostgres({ ...input, itemId: sheetsResult.itemId });
  }
  return sheetsResult;
}

export async function verifyItemPrice(input) {
  await verifyItemPriceSheets(input);
  if (isDualWrite("price_history") || isDualWrite(INVENTORY_ITEMS_FLAG)) {
    await verifyItemPricePostgres(input);
  }
}

export async function moveItemsBulk(input) {
  const sheetsResult = await moveItemsBulkSheets(input);
  if (isDualWrite(INVENTORY_ITEMS_FLAG)) {
    await moveItemsBulkPostgres(input);
  }
  return sheetsResult;
}

export async function mergeInventoryItems(input) {
  if (!input.keeperItemId) throw new Error("[dataStore.inventory] mergeInventoryItems: keeperItemId required");
  if (!Array.isArray(input.mergedItemIds) || input.mergedItemIds.length === 0) {
    throw new Error("[dataStore.inventory] mergeInventoryItems: mergedItemIds required and non-empty");
  }
  const sheetsResult = await mergeInventoryItemsSheets(input);
  if (
    isDualWrite(INVENTORY_ITEMS_FLAG)
    || isDualWrite("item_aliases")
    || isDualWrite("price_history")
    || isDualWrite("merge_history")
  ) {
    await mergeInventoryItemsPostgres(input);
  }
  return sheetsResult;
}

export async function logKeepSeparate(input) {
  await logKeepSeparateSheets(input);
  if (isDualWrite("merge_history")) {
    await logKeepSeparatePostgres(input);
  }
}

// IMPORTANT: zone_corrections write DROPPED on both sides per INV-1.
export async function acceptReviewItem(input) {
  await acceptReviewItemSheets(input);
  if (isDualWrite(INVENTORY_ITEMS_FLAG)) {
    await acceptReviewItemPostgres(input);
  }
}

export async function deleteReviewItem(input) {
  await deleteReviewItemSheets(input);
  if (isDualWrite(INVENTORY_ITEMS_FLAG) || isDualWrite("merge_history")) {
    await deleteReviewItemPostgres(input);
  }
}

export async function excludeItem(input) {
  await excludeItemSheets(input);
  if (isDualWrite(INVENTORY_ITEMS_FLAG) || isDualWrite("merge_history")) {
    await excludeItemPostgres(input);
  }
}

export async function saveStorageLocations(input) {
  const sheetsResult = await saveStorageLocationsSheets(input);
  if (isDualWrite("storage_locations")) {
    await saveStorageLocationsPostgres(input);
  }
  return sheetsResult;
}

export async function saveLocationSortOrder(input) {
  const sheetsResult = await saveLocationSortOrderSheets(input);
  if (isDualWrite("storage_locations")) {
    await saveLocationSortOrderPostgres(input);
  }
  return sheetsResult;
}

export async function addStorageSubZone(input) {
  const sheetsResult = await addStorageSubZoneSheets(input);
  if (isDualWrite("storage_locations")) {
    await addStorageSubZonePostgres({ ...input, locationId: sheetsResult.locationId });
  }
  return sheetsResult;
}

export async function updateStorageLocation(input) {
  await updateStorageLocationSheets(input);
  if (isDualWrite("storage_locations")) {
    await updateStorageLocationPostgres(input);
  }
}

export async function deactivateStorageLocation(input) {
  const sheetsResult = await deactivateStorageLocationSheets(input);
  if (isDualWrite("storage_locations")) {
    await deactivateStorageLocationPostgres(input);
  }
  return sheetsResult;
}

export async function updateCatalogItem(input) {
  await updateCatalogItemSheets(input);
  if (isDualWrite(INVENTORY_ITEMS_FLAG)) {
    await updateCatalogItemPostgres(input);
  }
}

export async function archiveItem(input) {
  await archiveItemSheets(input);
  if (isDualWrite(INVENTORY_ITEMS_FLAG) || isDualWrite("merge_history")) {
    await archiveItemPostgres(input);
  }
}

export async function reactivateItem(input) {
  await reactivateItemSheets(input);
  if (isDualWrite(INVENTORY_ITEMS_FLAG) || isDualWrite("merge_history")) {
    await reactivateItemPostgres(input);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REVIEW DASHBOARD PR B-1: list + resolve + skip
//
// list:    enrich pending review_queue rows with the line item details
//          (unitPrice, amount from ai_line_items) + the invoice's rawDriveUrl
//          (from invoice_submissions). Server-side join across 3 tables so
//          the dashboard renders a dense actionable list in one round-trip.
//
// resolve: the arithmetic_fail mechanic. Operator types a corrected qty.
//          Server updates ai_line_items.quantity (+ unit), appends a
//          price_history row keyed to the real invoiceUuid + corrected
//          qty + actual unitPrice, and flips review_queue.status='accepted'
//          with reviewedBy + reviewedAt. Cron's PR A foundation reads the
//          non-pending status next night and stops re-trying the invoice.
//
// skip:    no fake price_history. Just flip review_queue.status='rejected'
//          + reviewedBy + reviewedAt. PR A reads 'rejected' (also non-
//          pending) and stops re-trying.
//
// Status values are lowercase per the PG review_queue_status enum
// (pending | accepted | rejected) and the existing Sheets convention.
// PR A in the cron does `if (status && status !== "pending")` so both
// 'accepted' and 'rejected' break the chronic-fail loop.
// ════════════════════════════════════════════════════════════════════════════

// Sheets: AI_LINE_ITEMS per-account tab column order (matches dataStore/invoice.js
// LINE_IDX; redeclared here so the helpers stay self-contained).
const AI_LI_IDX = {
  invoiceUuid: 0, timestamp: 1, account: 2, vendor: 3, invoiceNumber: 4,
  invoiceDate: 5, lineNum: 6, description: 7, quantity: 8, unit: 9,
  unitPrice: 10, extendedPrice: 11, category: 12,
};
// invoice_submissions_26 column index for rawDriveUrl
const SUB_RAW_DRIVE_URL_IDX = 16;
const SUB_UUID_IDX = 0;

// Helper: A1 column letter for a 0-indexed column number (A=0, B=1, ..., AA=26).
function colLetter(idx) {
  let n = idx;
  let s = "";
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

// ── Sheets: list pending review_queue lines + join ai_line_items + raw drive url ──
async function listReviewQueueLinesSheets({ account, reason, vendor } = {}) {
  const { rows: queueRows } = await readSheetSA(SHEET_IDS.INVENTORY, REVIEW_QUEUE_TAB);

  // Filter to pending only (the dashboard's main mode). B-2 will add the
  // resolved-history view as a second tab; today we only list pending.
  const pending = queueRows.filter((r) => {
    const st = String(r[RQ_IDX.status] || "").trim().toLowerCase();
    if (st && st !== "pending") return false;
    if (account && r[RQ_IDX.account] !== account) return false;
    if (reason && String(r[RQ_IDX.reason] || "").trim() !== reason) return false;
    if (vendor && r[RQ_IDX.vendor] !== vendor) return false;
    return true;
  });

  // Collect distinct accounts + uuids we need to join against.
  const accountSet = new Set(pending.map((r) => r[RQ_IDX.account]).filter(Boolean));
  const uuidSet = new Set(pending.map((r) => r[RQ_IDX.invoiceId]).filter(Boolean));

  // Read AI_LINE_ITEMS per-account tabs (just the accounts we need).
  // Key the lookup by (invoiceUuid + description) since review_queue doesn't
  // carry lineNum. If two lines on the same invoice share description, the
  // first match wins; this is a rare edge case (the audit found 0 cross-
  // account collisions; within-invoice repeats are chronic re-fires, not
  // distinct lines).
  const liByKey = new Map();
  const liTimestampByKey = new Map();
  // Ambiguity flag: count how many ai_line_items rows share each
  // (invoiceUuid, description) key. When >1, the row cannot be safely
  // resolved (we don't know which physical line the qty update should
  // land on). UI surfaces this so the operator sees it BEFORE clicking
  // Resolve; the resolve path also guards (refuse-on-ambiguity).
  const liCountByKey = new Map();
  for (const acct of accountSet) {
    try {
      const { rows: liRows } = await readSheetSA(SHEET_IDS.AI_LINE_ITEMS, acct);
      for (const r of liRows) {
        const u = String(r[AI_LI_IDX.invoiceUuid] || "").trim();
        const d = String(r[AI_LI_IDX.description] || "").trim();
        if (!u || !d) continue;
        if (!uuidSet.has(u)) continue;
        const k = `${u}::${d}`;
        const ts = String(r[AI_LI_IDX.timestamp] || "");
        liCountByKey.set(k, (liCountByKey.get(k) || 0) + 1);
        // Prefer the most recently written row if multiple exist for the
        // same (uuid, description) - mirrors the cron's "newest read" view.
        if (!liByKey.has(k) || ts > (liTimestampByKey.get(k) || "")) {
          liByKey.set(k, r);
          liTimestampByKey.set(k, ts);
        }
      }
    } catch (e) {
      // Account tab might not exist - skip silently, matches existing dataStore
      // behavior for sparse per-account fan-out.
    }
  }

  // Read invoice_submissions_26 once to build the rawDriveUrl lookup.
  const { rows: subRows } = await readSheetSA(SHEET_IDS.COLLECTION, "invoice_submissions_26");
  const rawDriveUrlByUuid = new Map();
  for (const r of subRows) {
    const u = String(r[SUB_UUID_IDX] || "").trim();
    if (!u || !uuidSet.has(u)) continue;
    const url = String(r[SUB_RAW_DRIVE_URL_IDX] || "").trim();
    if (url) rawDriveUrlByUuid.set(u, url);
  }

  // Enrich and return.
  const items = pending.map((r) => {
    const invoiceUuid = String(r[RQ_IDX.invoiceId] || "").trim();
    const lineItemText = String(r[RQ_IDX.lineItemText] || "").trim();
    const k = `${invoiceUuid}::${lineItemText}`;
    const li = liByKey.get(k);
    return {
      queueId:            String(r[RQ_IDX.queueId] || "").trim(),
      account:            r[RQ_IDX.account] || "",
      vendor:             r[RQ_IDX.vendor] || "",
      invoiceUuid,
      invoiceDate:        r[RQ_IDX.invoiceDate] || "",
      invoiceNumber:      li ? (li[AI_LI_IDX.invoiceNumber] || "") : "",
      lineItemText,
      description:        lineItemText,
      quantity:           li ? parseNum(li[AI_LI_IDX.quantity])  : null,
      unit:               li ? (li[AI_LI_IDX.unit]   || "")      : "",
      unitPrice:          li ? parseNum(li[AI_LI_IDX.unitPrice]) : null,
      amount:             li ? parseNum(li[AI_LI_IDX.extendedPrice]) : null,
      suggestedMatchId:   r[RQ_IDX.suggestedMatchId]   || "",
      suggestedMatchName: r[RQ_IDX.suggestedMatchName] || "",
      confidence:         parseNum(r[RQ_IDX.confidence]) || 0,
      reason:             r[RQ_IDX.reason] || "",
      rawDriveUrl:        rawDriveUrlByUuid.get(invoiceUuid) || "",
      ambiguous:          (liCountByKey.get(k) || 0) > 1,
    };
  });

  // Filter out invoice-level holds. The 45 overcount_suspect_reextract rows
  // have a different resolution path (re-extract the invoice) - they don't
  // get the line-resolve dashboard treatment per Kevin's scope fence.
  const actionable = items.filter((it) => it.reason !== "overcount_suspect_reextract");

  return { items: actionable };
}

// ── Sheets: resolve a single arithmetic_fail line ──
async function resolveReviewQueueLineSheets({ queueId, correctedQty, correctedUnit, email }) {
  if (!queueId) throw new Error("queueId required");
  if (correctedQty == null || isNaN(Number(correctedQty))) throw new Error("correctedQty required");

  // 1) Find the review_queue row by queueId.
  const { rows: queueRows } = await readSheetSA(SHEET_IDS.INVENTORY, REVIEW_QUEUE_TAB);
  let queueRowIdx = -1;
  let queueRow = null;
  for (let i = 0; i < queueRows.length; i++) {
    if (queueRows[i][RQ_IDX.queueId] === queueId) {
      queueRowIdx = i;
      queueRow = queueRows[i];
      break;
    }
  }
  if (!queueRow) throw new Error(`queue row not found: ${queueId}`);
  if (queueRow[RQ_IDX.reason] === "overcount_suspect_reextract") {
    throw new Error("overcount_suspect_reextract lines are not resolvable via this path");
  }
  const status = String(queueRow[RQ_IDX.status] || "").trim().toLowerCase();
  if (status && status !== "pending") throw new Error(`queue row already resolved: status=${status}`);

  const account     = queueRow[RQ_IDX.account];
  const invoiceUuid = String(queueRow[RQ_IDX.invoiceId] || "").trim();
  const lineItemText = String(queueRow[RQ_IDX.lineItemText] || "").trim();

  // 2) Find the matching ai_line_items row + update its quantity (+ unit if provided).
  // Ambiguity guard: review_queue doesn't carry lineNum, so within-invoice
  // distinct lines sharing the same description (e.g. two "BEEF FLANK" rows
  // with different actual quantities) would silently overwrite the wrong
  // row if we picked first-match. Refuse instead and surface to the
  // operator. B-2 plans to add lineNum to the queue row writer for a
  // natural fix; the list endpoint pre-flags ambiguity (ambiguous: true)
  // so the UI can disable Resolve before the operator even tries.
  const { rows: liRows } = await readSheetSA(SHEET_IDS.AI_LINE_ITEMS, account);
  const matches = [];
  for (let i = 0; i < liRows.length; i++) {
    const r = liRows[i];
    if (String(r[AI_LI_IDX.invoiceUuid] || "").trim() === invoiceUuid &&
        String(r[AI_LI_IDX.description] || "").trim() === lineItemText) {
      matches.push({ idx: i, row: r });
    }
  }
  if (matches.length === 0) {
    throw new Error(`ai_line_items row not found for invoiceUuid=${invoiceUuid.slice(0,8)} desc="${lineItemText.slice(0,30)}"`);
  }
  if (matches.length > 1) {
    throw new Error(`ambiguous_line: ${matches.length} ai_line_items rows match (invoiceUuid, "${lineItemText.slice(0,30)}") on account=${account}. Cannot determine which line to update without lineNum. Skip this row or wait for PR B-2.`);
  }
  const liRowIdx = matches[0].idx;
  const liRow    = matches[0].row;

  const unitPrice = parseNum(liRow[AI_LI_IDX.unitPrice]) || 0;
  const amount    = parseNum(liRow[AI_LI_IDX.extendedPrice]) || 0;
  const vendor    = liRow[AI_LI_IDX.vendor] || queueRow[RQ_IDX.vendor] || "";
  const invoiceDate = liRow[AI_LI_IDX.invoiceDate] || queueRow[RQ_IDX.invoiceDate] || "";
  const now = new Date().toISOString();

  // ai_line_items quantity is col I (index 8). Unit is col J (index 9).
  // +2 = 1 for the header row + 1 for A1 1-indexing.
  const liRowA1 = liRowIdx + 2;
  const liUpdates = [
    { range: `${account}!${colLetter(AI_LI_IDX.quantity)}${liRowA1}`, values: [[Number(correctedQty)]] },
  ];
  if (correctedUnit) {
    liUpdates.push({ range: `${account}!${colLetter(AI_LI_IDX.unit)}${liRowA1}`, values: [[String(correctedUnit)]] });
  }
  await batchUpdateRangesSA(SHEET_IDS.AI_LINE_ITEMS, liUpdates);

  // 3) Append a price_history row keyed to the REAL invoice (not "manual-verify"
  //    like verifyItemPriceSheets does for catalog-side price corrections).
  //    Source field carries the invoiceUuid so the cron can trace provenance.
  const itemId = queueRow[RQ_IDX.suggestedMatchId] || ""; // empty if no match - skipped at price_history append below
  if (itemId) {
    await appendRowSA(SHEET_IDS.INVENTORY, PRICE_HISTORY_TAB, [
      itemId,
      account,
      vendor,
      unitPrice,
      String(invoiceDate).slice(0, 10),
      invoiceUuid,           // source-or-invoice-id col carries the canonical invoiceUuid
      now,
    ]);
  }

  // 4) Flip review_queue row: status='accepted', reviewedBy=email, reviewedAt=now.
  const queueRowA1 = queueRowIdx + 2;
  await batchUpdateRangesSA(SHEET_IDS.INVENTORY, [
    { range: `${REVIEW_QUEUE_TAB}!${colLetter(RQ_IDX.status)}${queueRowA1}`,     values: [["accepted"]] },
    { range: `${REVIEW_QUEUE_TAB}!${colLetter(RQ_IDX.reviewedBy)}${queueRowA1}`, values: [[email || ""]] },
    { range: `${REVIEW_QUEUE_TAB}!${colLetter(RQ_IDX.reviewedAt)}${queueRowA1}`, values: [[now]] },
  ]);

  invalidateCache(SHEET_IDS.INVENTORY, REVIEW_QUEUE_TAB);
  invalidateCache(SHEET_IDS.INVENTORY, PRICE_HISTORY_TAB);
  invalidateCache(SHEET_IDS.AI_LINE_ITEMS, account);

  return {
    queueId,
    invoiceUuid,
    account,
    correctedQty: Number(correctedQty),
    correctedUnit: correctedUnit || liRow[AI_LI_IDX.unit] || "",
    unitPrice,
    amount,
    pricedAgainstItemId: itemId || null,
    resolvedAt: now,
    resolvedBy: email || "",
  };
}

// ── Sheets: skip a single line (Option B: no fake price_history) ──
async function skipReviewQueueLineSheets({ queueId, email }) {
  if (!queueId) throw new Error("queueId required");
  const { rows: queueRows } = await readSheetSA(SHEET_IDS.INVENTORY, REVIEW_QUEUE_TAB);
  let queueRowIdx = -1;
  let queueRow = null;
  for (let i = 0; i < queueRows.length; i++) {
    if (queueRows[i][RQ_IDX.queueId] === queueId) {
      queueRowIdx = i;
      queueRow = queueRows[i];
      break;
    }
  }
  if (!queueRow) throw new Error(`queue row not found: ${queueId}`);
  const status = String(queueRow[RQ_IDX.status] || "").trim().toLowerCase();
  if (status && status !== "pending") throw new Error(`queue row already resolved: status=${status}`);

  const now = new Date().toISOString();
  const queueRowA1 = queueRowIdx + 2;
  await batchUpdateRangesSA(SHEET_IDS.INVENTORY, [
    { range: `${REVIEW_QUEUE_TAB}!${colLetter(RQ_IDX.status)}${queueRowA1}`,     values: [["rejected"]] },
    { range: `${REVIEW_QUEUE_TAB}!${colLetter(RQ_IDX.reviewedBy)}${queueRowA1}`, values: [[email || ""]] },
    { range: `${REVIEW_QUEUE_TAB}!${colLetter(RQ_IDX.reviewedAt)}${queueRowA1}`, values: [[now]] },
  ]);
  invalidateCache(SHEET_IDS.INVENTORY, REVIEW_QUEUE_TAB);

  return {
    queueId,
    invoiceUuid: String(queueRow[RQ_IDX.invoiceId] || "").trim(),
    account: queueRow[RQ_IDX.account] || "",
    resolvedAt: now,
    resolvedBy: email || "",
  };
}

// ── PG side: dormant adapters that fire when isDualWrite("review_queue") flips ──
// Module 7 has not shipped yet; today these no-op because the dual-write
// flag is off for review_queue / ai_line_items inventory tables. When the
// flag flips, the same input shape produces equivalent PG writes.

async function listReviewQueueLinesPostgres({ account, reason, vendor } = {}) {
  const supa = getServiceClient();
  let q = supa.from("review_queue").select("*").eq("status", "pending");
  if (account) q = q.eq("account", account);
  if (reason)  q = q.eq("reason",  reason);
  if (vendor)  q = q.eq("vendor",  vendor);
  const { data: queueRows, error } = await q;
  if (error) throw new Error(`PG review_queue: ${error.message}`);

  const uuidSet = new Set((queueRows || []).map((r) => r.invoice_id).filter(Boolean));
  const uuids = [...uuidSet];

  // Bulk fetch matching ai_line_items + invoice_submissions
  let liRows = [];
  let subRows = [];
  if (uuids.length > 0) {
    const [li, sub] = await Promise.all([
      supa.from("ai_line_items").select("invoice_uuid, description, quantity, unit, unit_price, extended_price, vendor, invoice_number, invoice_date").in("invoice_uuid", uuids),
      supa.from("invoice_submissions").select("id, raw_drive_url").in("id", uuids),
    ]);
    if (li.error)  throw new Error(`PG ai_line_items: ${li.error.message}`);
    if (sub.error) throw new Error(`PG invoice_submissions: ${sub.error.message}`);
    liRows  = li.data  || [];
    subRows = sub.data || [];
  }

  const liByKey = new Map();
  const liCountByKey = new Map();   // ambiguity flag - same semantics as the Sheets path
  for (const r of liRows) {
    const k = `${r.invoice_uuid}::${r.description}`;
    if (!liByKey.has(k)) liByKey.set(k, r);
    liCountByKey.set(k, (liCountByKey.get(k) || 0) + 1);
  }
  const rawDriveByUuid = new Map();
  for (const r of subRows) rawDriveByUuid.set(r.id, r.raw_drive_url || "");

  const items = (queueRows || []).map((q) => {
    const k = `${q.invoice_id}::${q.line_item_text}`;
    const li = liByKey.get(k);
    return {
      queueId:            q.id,                       // PG uses UUID; Sheets uses 'q_<uid>'
      account:            q.account || "",
      vendor:             q.vendor  || (li?.vendor || ""),
      invoiceUuid:        q.invoice_id || "",
      invoiceDate:        q.invoice_date || (li?.invoice_date || ""),
      invoiceNumber:      li?.invoice_number || "",
      lineItemText:       q.line_item_text || "",
      description:        q.line_item_text || "",
      quantity:           li ? parseNum(li.quantity)      : null,
      unit:               li?.unit || "",
      unitPrice:          li ? parseNum(li.unit_price)    : null,
      amount:             li ? parseNum(li.extended_price): null,
      suggestedMatchId:   q.suggested_match_id   || "",
      suggestedMatchName: q.suggested_match_name || "",
      confidence:         parseNum(q.confidence) || 0,
      reason:             q.reason || "",
      rawDriveUrl:        rawDriveByUuid.get(q.invoice_id) || "",
      ambiguous:          (liCountByKey.get(k) || 0) > 1,
    };
  }).filter((it) => it.reason !== "overcount_suspect_reextract");

  return { items };
}

async function resolveReviewQueueLinePostgres({ queueId, correctedQty, correctedUnit, email }) {
  const supa = getServiceClient();
  const now = new Date().toISOString();

  // 1) Find the queue row
  const { data: qrow, error: qerr } = await supa.from("review_queue").select("*").eq("id", queueId).single();
  if (qerr || !qrow) throw new Error(`PG queue row not found: ${queueId}`);
  if (qrow.status !== "pending") throw new Error(`PG queue row already resolved: status=${qrow.status}`);

  // 2) Find matching ai_line_items row + ambiguity guard (mirror of Sheets path).
  const { data: lirows, error: lierr } = await supa.from("ai_line_items")
    .select("id, invoice_uuid, description, unit, unit_price, extended_price, vendor, invoice_date")
    .eq("invoice_uuid", qrow.invoice_id)
    .eq("description",  qrow.line_item_text)
    .limit(2);   // pull 2 to detect ambiguity without paginating
  if (lierr) throw new Error(`PG ai_line_items lookup: ${lierr.message}`);
  if (!lirows || !lirows[0]) throw new Error(`PG ai_line_items not found`);
  if (lirows.length > 1) {
    throw new Error(`ambiguous_line: multiple PG ai_line_items rows match (invoice_uuid, "${(qrow.line_item_text||"").slice(0,30)}"). Cannot determine which to update without lineNum. Skip or wait for PR B-2.`);
  }
  const li = lirows[0];

  // 3) Update ai_line_items.quantity (+ unit)
  const liPatch = { quantity: Number(correctedQty) };
  if (correctedUnit) liPatch.unit = String(correctedUnit);
  const { error: liUpdErr } = await supa.from("ai_line_items").update(liPatch).eq("id", li.id);
  if (liUpdErr) throw new Error(`PG ai_line_items update: ${liUpdErr.message}`);

  // 4) Append price_history (only if we have a suggested itemId)
  const itemId = qrow.suggested_match_id || null;
  if (itemId) {
    const phRow = {
      item_id:           itemId,
      account:           qrow.account,
      vendor_id:         li.vendor || qrow.vendor,
      price:             parseNum(li.unit_price) || 0,
      invoice_date:      String(li.invoice_date || qrow.invoice_date || "").slice(0, 10) || null,
      invoice_id:        qrow.invoice_id,
      recorded_at:       now,
    };
    const { error: phErr } = await supa.from("price_history").insert(phRow);
    if (phErr) throw new Error(`PG price_history insert: ${phErr.message}`);
  }

  // 5) Flip review_queue status
  const { error: qUpdErr } = await supa.from("review_queue").update({
    status: "accepted",
    reviewed_by: email || null,
    reviewed_at: now,
  }).eq("id", queueId);
  if (qUpdErr) throw new Error(`PG review_queue update: ${qUpdErr.message}`);

  return { queueId, invoiceUuid: qrow.invoice_id, account: qrow.account, resolvedAt: now, resolvedBy: email || "" };
}

async function skipReviewQueueLinePostgres({ queueId, email }) {
  const supa = getServiceClient();
  const now = new Date().toISOString();
  const { data: qrow, error: qerr } = await supa.from("review_queue").select("status, invoice_id, account").eq("id", queueId).single();
  if (qerr || !qrow) throw new Error(`PG queue row not found: ${queueId}`);
  if (qrow.status !== "pending") throw new Error(`PG queue row already resolved: status=${qrow.status}`);
  const { error: updErr } = await supa.from("review_queue").update({
    status: "rejected",
    reviewed_by: email || null,
    reviewed_at: now,
  }).eq("id", queueId);
  if (updErr) throw new Error(`PG review_queue update: ${updErr.message}`);
  return { queueId, invoiceUuid: qrow.invoice_id, account: qrow.account, resolvedAt: now, resolvedBy: email || "" };
}

// ── Orchestrators (Sheets always; PG when isDualWrite flag flips) ──

export async function listReviewQueueLines(input = {}) {
  // Reads route to whichever store is the read-side per the cutover config.
  // For PR B-1 today, review_queue read flag is off so Sheets is canonical.
  // When the read flag flips for Module 7, the PG path takes over.
  if (isReadFromPostgres("review_queue")) {
    return await listReviewQueueLinesPostgres(input);
  }
  return await listReviewQueueLinesSheets(input);
}

export async function resolveReviewQueueLine(input) {
  const result = await resolveReviewQueueLineSheets(input);
  if (isDualWrite("review_queue") || isDualWrite("ai_line_items")) {
    try {
      await resolveReviewQueueLinePostgres(input);
    } catch (e) {
      // Mirror existing dataStore behavior: log + continue. Sheets is
      // authoritative until Module 7 ships, so a PG mirror failure does
      // not roll back the Sheets write.
      console.error("[resolveReviewQueueLine] PG mirror failed:", e.message);
    }
  }
  return result;
}

export async function skipReviewQueueLine(input) {
  const result = await skipReviewQueueLineSheets(input);
  if (isDualWrite("review_queue")) {
    try {
      await skipReviewQueueLinePostgres(input);
    } catch (e) {
      console.error("[skipReviewQueueLine] PG mirror failed:", e.message);
    }
  }
  return result;
}
