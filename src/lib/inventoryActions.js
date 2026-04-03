/**
 * inventoryActions.js — Inventory Manager Backend Handlers
 */

import { SHEET_IDS, appendRowSA, appendRowsSA } from "@/lib/sheets";
import {
  cachedRead, batchRead, invalidateCache,
  getAccountConfigs, getPeriods, getCurrentPeriod,
  getAllVendors, resolveVendorId, parseNum, generateId,
} from "@/lib/opsUtils";

const INVENTORY_SHEET_ID = process.env.INVENTORY_SHEET_ID;

// ═══════════════════════════════════════
// BOOTSTRAP
// ═══════════════════════════════════════

export async function handleInventoryBootstrap({ account }) {
  try {
    const [accounts, currentPeriod, allPeriods] = await Promise.all([
      getAccountConfigs(), getCurrentPeriod(), getPeriods(),
    ]);

    const activeAccount = account || accounts[0]?.label || "";

    // Read inventory tabs in parallel
    const inv = await batchRead(INVENTORY_SHEET_ID, [
      "item_catalog", "storage_locations", "count_sessions", "count_items",
      "review_queue", "price_history",
    ]);

    // Full catalog for this account
    const catalogItems = (inv.item_catalog?.rows || [])
      .filter((r) => r[1] === activeAccount && r[11] !== "FALSE")
      .map((r) => ({
        itemId: r[0], name: r[2] || "", category: r[3] || "Uncategorized",
        unit: r[4] || "EA", locationId: r[5] || "",
        primaryVendor: r[6] || "", lastPrice: parseNum(r[7]),
        lastPriceDate: r[8] || "", lastPriceVendor: r[9] || "",
        priceAtLastCount: parseNum(r[10]),
        linkedToInvoice: r[12] === "TRUE",
        isVarietyGroup: r[13] === "TRUE",
      }));

    const catalogStats = { totalItems: catalogItems.length, byCategory: {} };
    catalogItems.forEach((i) => {
      catalogStats.byCategory[i.category] = (catalogStats.byCategory[i.category] || 0) + 1;
    });

    // Storage locations
    const locations = (inv.storage_locations?.rows || [])
      .filter((r) => r[1] === activeAccount && r[5] !== "FALSE")
      .sort((a, b) => (parseInt(a[4]) || 0) - (parseInt(b[4]) || 0))
      .map((r) => ({
        locationId: r[0], name: r[2] || "", icon: r[3] || "box",
        sortOrder: parseInt(r[4]) || 0,
      }));

    // Count sessions for this account
    const sessions = (inv.count_sessions?.rows || [])
      .filter((r) => r[1] === activeAccount)
      .sort((a, b) => new Date(b[7] || b[4] || 0) - new Date(a[7] || a[4] || 0));

    const lastSubmitted = sessions.find((r) => r[5] === "submitted" || r[5] === "corrected");
    const activeDraft = sessions.find(
      (r) => r[5] === "draft" && r[2] === currentPeriod?.name
    );

    // Last count for summary
    let lastCount = null;
    if (lastSubmitted) {
      lastCount = {
        sessionId: lastSubmitted[0], period: lastSubmitted[2],
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

    // "Last: X" chips — get per-item quantities from last submitted count
    const lastCountItems = {};
    if (lastSubmitted) {
      const allCountItems = (inv.count_items?.rows || [])
        .filter((r) => r[0] === lastSubmitted[0]);
      // Group by locationId, take latest locationSaveId per location
      const locGroups = {};
      allCountItems.forEach((r) => {
        const locId = r[8];
        const saveId = r[1];
        const savedAt = r[11] || "";
        if (!locGroups[locId] || savedAt > locGroups[locId].savedAt) {
          locGroups[locId] = { saveId, savedAt, items: [] };
        }
      });
      // Second pass: collect items from latest save per location
      allCountItems.forEach((r) => {
        const locId = r[8];
        if (locGroups[locId] && r[1] === locGroups[locId].saveId) {
          lastCountItems[r[2]] = {
            quantity: parseNum(r[3]),
            noneOnHand: r[12] === "TRUE",
          };
        }
      });
    }

    // Review queue count
    const reviewCount = (inv.review_queue?.rows || [])
      .filter((r) => r[5] === activeAccount && r[9] === "pending").length;

    // Price movers
    const priceRows = (inv.price_history?.rows || [])
      .filter((r) => r[1] === activeAccount)
      .sort((a, b) => new Date(b[6] || b[4] || 0) - new Date(a[6] || a[4] || 0));
    const priceByItem = {};
    priceRows.forEach((r) => {
      if (!priceByItem[r[0]]) priceByItem[r[0]] = [];
      if (priceByItem[r[0]].length < 2) priceByItem[r[0]].push({ price: parseNum(r[3]), vendor: r[2] });
    });
    const movers = [];
    for (const [itemId, prices] of Object.entries(priceByItem)) {
      if (prices.length < 2) continue;
      const diff = prices[0].price - prices[1].price;
      if (Math.abs(diff) < 0.01) continue;
      const cat = catalogItems.find((i) => i.itemId === itemId);
      movers.push({
        itemId, name: cat?.name || itemId,
        currentPrice: prices[0].price, previousPrice: prices[1].price,
        change: diff, pctChange: ((diff / prices[1].price) * 100).toFixed(1),
        vendor: prices[0].vendor, direction: diff > 0 ? "up" : "down",
      });
    }
    movers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

    const currentPeriodSubmitted = sessions.some(
      (r) => r[2] === currentPeriod?.name && (r[5] === "submitted" || r[5] === "corrected")
    );

    return {
      success: true,
      account: activeAccount,
      accounts: accounts.map((a) => ({ key: a.key, label: a.label, level: a.level })),
      currentPeriod, allPeriods,
      catalogItems, catalogStats, locations,
      lastCount, lastCountItems,
      activeDraft: activeDraft ? { sessionId: activeDraft[0], period: activeDraft[2], startedAt: activeDraft[4] } : null,
      reviewQueueCount: reviewCount,
      priceMovers: movers.slice(0, 4),
      currentPeriodSubmitted,
    };
  } catch (error) {
    console.error("[inventoryActions] bootstrap error:", error);
    return { success: false, error: error.message };
  }
}

// ═══════════════════════════════════════
// START SESSION — create draft in count_sessions
// ═══════════════════════════════════════

export async function handleStartSession({ account, period, email }) {
  try {
    const sessionId = generateId("inv");
    const row = [
      sessionId, account, period, email, new Date().toISOString(),
      "draft", "", "", "", "", "", "", "", "", "", "", "", "",
    ];
    await appendRowSA(INVENTORY_SHEET_ID, "count_sessions", row);
    invalidateCache(INVENTORY_SHEET_ID, "count_sessions");
    return { success: true, sessionId };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ═══════════════════════════════════════
// SAVE COUNT — per-location append-only batch
// ═══════════════════════════════════════

export async function handleCountSave({ sessionId, locationId, items, email }) {
  try {
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
    await appendRowsSA(INVENTORY_SHEET_ID, "count_items", rows);
    invalidateCache(INVENTORY_SHEET_ID, "count_items");
    return { success: true, locationSaveId, itemCount: rows.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ═══════════════════════════════════════
// SUBMIT — finalize count, lock period
// ═══════════════════════════════════════

export async function handleCountSubmit(body) {
  return { success: false, error: "Not yet implemented — Week 2 Session 8" };
}

// ═══════════════════════════════════════
// CATALOG — full catalog with aliases
// ═══════════════════════════════════════

export async function handleCatalogGet({ account }) {
  try {
    const inv = await batchRead(INVENTORY_SHEET_ID, ["item_catalog", "item_aliases"]);
    const items = (inv.item_catalog?.rows || [])
      .filter((r) => r[1] === account && r[11] !== "FALSE")
      .map((r) => ({
        itemId: r[0], name: r[2], category: r[3], unit: r[4],
        locationId: r[5], primaryVendor: r[6], lastPrice: parseNum(r[7]),
        lastPriceDate: r[8], lastPriceVendor: r[9],
        linkedToInvoice: r[12] === "TRUE", isVarietyGroup: r[13] === "TRUE",
      }));
    return { success: true, items };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ═══════════════════════════════════════
// STUBS — built in later sessions
// ═══════════════════════════════════════

export async function handleAddItem(body) { return { success: false, error: "Week 3" }; }
export async function handleUpdateItem(body) { return { success: false, error: "Week 3" }; }
export async function handleMergeItems(body) { return { success: false, error: "Week 3" }; }
export async function handleResolveQueue(body) { return { success: false, error: "Week 3" }; }
export async function handleSaveLocations(body) { return { success: false, error: "Week 3" }; }
export async function handleSaveSortOrder(body) { return { success: false, error: "Week 3" }; }
export async function handleAdminCorrect(body) { return { success: false, error: "Week 4" }; }
export async function handleScan(body) { return { success: false, error: "Week 3" }; }
export async function handleHistoryGet({ account }) { return { success: true, sessions: [] }; }
export async function handleReviewQueueGet({ account }) { return { success: true, items: [] }; }
export async function handlePrint({ account }) { return { success: false, error: "Week 3" }; }