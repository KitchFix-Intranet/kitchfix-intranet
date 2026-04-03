/**
 * inventoryActions.js — Inventory Manager Backend Handlers
 * 
 * All handlers for /api/ops/inventory/ actions.
 * Uses opsUtils for cached reads, account config, vendor resolution.
 * Uses service account for all sheet operations.
 * 
 * Actions (Phase 1):
 *   GET:  bootstrap, catalog, history, review-queue, print
 *   POST: save-count, submit, add-item, update-item, merge-items,
 *         resolve-queue, save-locations, save-sort-order, admin-correct, scan
 */

import { SHEET_IDS, readSheetSA, appendRowSA, appendRowsSA } from "@/lib/sheets";
import {
  cachedRead,
  batchRead,
  invalidateCache,
  getAccountConfigs,
  getCurrentPeriod,
  getPeriodsForAccount,
  getAllVendors,
  resolveVendorId,
  parseNum,
  formatCurrency,
  generateId,
} from "@/lib/opsUtils";

const INVENTORY_SHEET_ID = process.env.INVENTORY_SHEET_ID;

// ═══════════════════════════════════════
// BOOTSTRAP — Landing screen data
// ═══════════════════════════════════════

/**
 * Returns everything the landing screen needs:
 * - accounts (list)
 * - currentPeriod (for selected account)
 * - catalogStats (item count, categories)
 * - storageLocations (for selected account)
 * - lastCount (previous session summary)
 * - reviewQueueCount (unmatched items needing attention)
 * - priceMovers (top 4 price changes)
 */
export async function handleInventoryBootstrap({ account }) {
  try {
    const accounts = await getAccountConfigs();
    
    // Default to first account if none specified
    const activeAccount = account || accounts[0]?.label || "";
    
    // Get period data
    const currentPeriod = await getCurrentPeriod(activeAccount);
    const allPeriods = await getPeriodsForAccount(activeAccount);

    // Read inventory-specific tabs in parallel
    const invData = await batchRead(INVENTORY_SHEET_ID, [
      "item_catalog",
      "storage_locations",
      "count_sessions",
      "review_queue",
      "price_history",
    ]);

    // Filter catalog for this account
    const catalogRows = (invData.item_catalog?.rows || [])
      .filter((r) => r[1] === activeAccount && r[11] !== "FALSE");
    
    const catalogStats = {
      totalItems: catalogRows.length,
      byCategory: {},
    };
    catalogRows.forEach((r) => {
      const cat = r[3] || "Uncategorized";
      catalogStats.byCategory[cat] = (catalogStats.byCategory[cat] || 0) + 1;
    });

    // Storage locations for this account
    const locations = (invData.storage_locations?.rows || [])
      .filter((r) => r[1] === activeAccount && r[5] !== "FALSE")
      .sort((a, b) => (parseInt(a[4]) || 0) - (parseInt(b[4]) || 0))
      .map((r) => ({
        locationId: r[0],
        name: r[2] || "",
        icon: r[3] || "box",
        sortOrder: parseInt(r[4]) || 0,
      }));

    // Last count session for this account + current period
    const sessions = (invData.count_sessions?.rows || [])
      .filter((r) => r[1] === activeAccount)
      .sort((a, b) => new Date(b[7] || b[4]) - new Date(a[7] || a[4]));
    
    const lastSubmitted = sessions.find((r) => r[5] === "submitted" || r[5] === "corrected");
    const activeDraft = sessions.find(
      (r) => r[5] === "draft" && r[2] === currentPeriod?.period
    );

    let lastCount = null;
    if (lastSubmitted) {
      lastCount = {
        sessionId: lastSubmitted[0],
        period: lastSubmitted[2],
        submittedBy: lastSubmitted[6] || lastSubmitted[3],
        submittedAt: lastSubmitted[7] || "",
        status: lastSubmitted[5],
        totalFood: parseNum(lastSubmitted[8]),
        totalPackaging: parseNum(lastSubmitted[9]),
        totalSupplies: parseNum(lastSubmitted[10]),
        totalSnacks: parseNum(lastSubmitted[11]),
        totalBeverages: parseNum(lastSubmitted[12]),
        grandTotal: parseNum(lastSubmitted[13]),
      };
    }

    // Review queue count (pending items)
    const reviewCount = (invData.review_queue?.rows || [])
      .filter((r) => r[5] === activeAccount && r[9] === "pending")
      .length;

    // Price movers — compare last two prices for items in this account
    const priceRows = (invData.price_history?.rows || [])
      .filter((r) => r[1] === activeAccount)
      .sort((a, b) => new Date(b[6] || b[4]) - new Date(a[6] || a[4]));
    
    const priceByItem = {};
    priceRows.forEach((r) => {
      const itemId = r[0];
      if (!priceByItem[itemId]) priceByItem[itemId] = [];
      if (priceByItem[itemId].length < 2) {
        priceByItem[itemId].push({ price: parseNum(r[3]), vendor: r[2], date: r[4] });
      }
    });

    const movers = [];
    for (const [itemId, prices] of Object.entries(priceByItem)) {
      if (prices.length < 2) continue;
      const diff = prices[0].price - prices[1].price;
      if (Math.abs(diff) < 0.01) continue;
      const catItem = catalogRows.find((r) => r[0] === itemId);
      movers.push({
        itemId,
        name: catItem ? catItem[2] : itemId,
        currentPrice: prices[0].price,
        previousPrice: prices[1].price,
        change: diff,
        pctChange: ((diff / prices[1].price) * 100).toFixed(1),
        vendor: prices[0].vendor,
        direction: diff > 0 ? "up" : "down",
      });
    }
    movers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

    // Check if current period already submitted
    const currentPeriodSubmitted = sessions.some(
      (r) => r[2] === currentPeriod?.period && (r[5] === "submitted" || r[5] === "corrected")
    );

    return {
      success: true,
      account: activeAccount,
      accounts: accounts.map((a) => ({ id: a.id, label: a.label, type: a.type })),
      currentPeriod,
      allPeriods,
      catalogStats,
      locations,
      lastCount,
      activeDraft: activeDraft ? {
        sessionId: activeDraft[0],
        period: activeDraft[2],
        startedAt: activeDraft[4],
      } : null,
      reviewQueueCount: reviewCount,
      priceMovers: movers.slice(0, 4),
      currentPeriodSubmitted,
    };
  } catch (error) {
    console.error("[inventoryActions] bootstrap error:", error.message);
    return { success: false, error: error.message };
  }
}

// ═══════════════════════════════════════
// CATALOG — Full catalog with aliases
// (Will be built out in Week 3)
// ═══════════════════════════════════════

export async function handleCatalogGet({ account }) {
  try {
    const invData = await batchRead(INVENTORY_SHEET_ID, ["item_catalog", "item_aliases"]);
    
    const items = (invData.item_catalog?.rows || [])
      .filter((r) => r[1] === account && r[11] !== "FALSE")
      .map((r) => ({
        itemId: r[0],
        name: r[2],
        category: r[3],
        unit: r[4],
        locationId: r[5],
        primaryVendor: r[6],
        lastPrice: parseNum(r[7]),
        lastPriceDate: r[8],
        lastPriceVendor: r[9],
        linkedToInvoice: r[12] === "TRUE",
        isVarietyGroup: r[13] === "TRUE",
      }));

    const aliases = (invData.item_aliases?.rows || [])
      .filter((r) => items.some((i) => i.itemId === r[2]))
      .map((r) => ({
        aliasId: r[0],
        aliasText: r[1],
        canonicalItemId: r[2],
        vendor: r[3],
        confidence: parseNum(r[4]),
      }));

    return { success: true, items, aliases };
  } catch (error) {
    console.error("[inventoryActions] catalog error:", error.message);
    return { success: false, error: error.message };
  }
}

// ═══════════════════════════════════════
// PLACEHOLDER HANDLERS
// Stubbed for routing — built in later sessions
// ═══════════════════════════════════════

export async function handleCountSave(body) {
  return { success: false, error: "Not yet implemented — Week 2" };
}

export async function handleCountSubmit(body) {
  return { success: false, error: "Not yet implemented — Week 2" };
}

export async function handleAddItem(body) {
  return { success: false, error: "Not yet implemented — Week 3" };
}

export async function handleUpdateItem(body) {
  return { success: false, error: "Not yet implemented — Week 3" };
}

export async function handleMergeItems(body) {
  return { success: false, error: "Not yet implemented — Week 3" };
}

export async function handleResolveQueue(body) {
  return { success: false, error: "Not yet implemented — Week 3" };
}

export async function handleSaveLocations(body) {
  return { success: false, error: "Not yet implemented — Week 3" };
}

export async function handleSaveSortOrder(body) {
  return { success: false, error: "Not yet implemented — Week 3" };
}

export async function handleAdminCorrect(body) {
  return { success: false, error: "Not yet implemented — Week 4" };
}

export async function handleScan(body) {
  return { success: false, error: "Not yet implemented — Week 3" };
}

export async function handleHistoryGet({ account }) {
  return { success: true, sessions: [] };
}

export async function handleReviewQueueGet({ account }) {
  return { success: true, items: [] };
}

export async function handlePrint({ account, locations, format }) {
  return { success: false, error: "Not yet implemented — Week 3" };
}