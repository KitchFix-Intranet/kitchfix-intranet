/**
 * inventoryActions.js — Inventory Manager Backend Handlers
 */

import { SHEET_IDS, readSheetSA, appendRowSA, appendRowsSA, updateRangeSA, batchUpdateRangesSA } from "@/lib/sheets";
import {
  cachedRead, batchRead, invalidateCache,
  getAccountConfigs, getPeriods, getCurrentPeriod,
  getAllVendors, resolveVendorId, parseNum, generateId,
} from "@/lib/opsUtils";

const INVENTORY_SHEET_ID = process.env.INVENTORY_SHEET_ID;

// Account labels in item_catalog may be short ("STL - MO") while bootstrap
// uses full labels ("STL - MO - St Louis Cardinals"). Match flexibly.
function accountMatch(rowAccount, activeAccount) {
  if (!rowAccount || !activeAccount) return false;
  if (rowAccount === activeAccount) return true;
  return activeAccount.startsWith(rowAccount + " -");
}

// ═══════════════════════════════════════
// BOOTSTRAP
// ═══════════════════════════════════════

export async function handleInventoryBootstrap({ account, fresh = false }) {
  try {
    const [accounts, currentPeriod, allPeriods] = await Promise.all([
      getAccountConfigs(), getCurrentPeriod(), getPeriods(),
    ]);

    const activeAccount = account || accounts[0]?.label || "";

    // Read inventory tabs in parallel (fresh=true bypasses cache after save)
    const inv = await batchRead(INVENTORY_SHEET_ID, [
      "item_catalog", "storage_locations", "count_sessions", "count_items",
      "review_queue", "price_history",
    ], { fresh });

    // Full catalog for this account
    const catalogItems = (inv.item_catalog?.rows || [])
      .filter((r) => accountMatch(r[1], activeAccount) && r[11] !== "FALSE" && r[11] !== false)
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
      .filter((r) => accountMatch(r[1], activeAccount) && r[5] !== "FALSE" && r[5] !== false)
      .sort((a, b) => (parseInt(a[4]) || 0) - (parseInt(b[4]) || 0))
      .map((r) => ({
        locationId: r[0], name: r[2] || "", icon: r[3] || "box",
        sortOrder: parseInt(r[4]) || 0,
        parentLocationId: r[8] || null,
        color: r[9] || "",
      }));

    // Count sessions for this account
    const sessions = (inv.count_sessions?.rows || [])
      .filter((r) => accountMatch(r[1], activeAccount))
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
      .filter((r) => accountMatch(r[5], activeAccount) && r[9] === "pending").length;

    // Price movers
    const priceRows = (inv.price_history?.rows || [])
      .filter((r) => accountMatch(r[1], activeAccount))
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
      .filter((r) => accountMatch(r[1], account) && r[11] !== "FALSE" && r[11] !== false)
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

export async function handleBatchMoveItems({ account, items }) {
  // items: [{itemId, newLocationId}]
  try {
    if (!items || items.length === 0) return { success: true, moved: 0 };
    const catalogData = await readSheetSA(INVENTORY_SHEET_ID, "item_catalog");
    const rows = catalogData.rows || [];

    // Build batch of range updates
    const data = [];
    for (const move of items) {
      for (let i = 0; i < rows.length; i++) {
        if (rows[i][0] === move.itemId && accountMatch(rows[i][1], account)) {
          data.push({ range: `item_catalog!F${i + 2}`, values: [[move.newLocationId]] });
          break;
        }
      }
    }

    if (data.length === 0) return { success: true, moved: 0 };

    // Sheets batchUpdate handles up to 100k cells — chunk at 500 to be safe
    const CHUNK = 500;
    let moved = 0;
    for (let c = 0; c < data.length; c += CHUNK) {
      const chunk = data.slice(c, c + CHUNK);
      const result = await batchUpdateRangesSA(INVENTORY_SHEET_ID, chunk);
      if (!result.success) {
        console.error(`[batch-move] Chunk failed at offset ${c}:`, result.error);
        return { success: false, moved, error: result.error };
      }
      moved += chunk.length;
    }

    invalidateCache(INVENTORY_SHEET_ID, "item_catalog");
    return { success: true, moved };
  } catch (error) {
    console.error("[inventoryActions] batch-move error:", error.message);
    return { success: false, error: error.message };
  }
}
// ═══════════════════════════════════════
// ITEM REVIEW — AI Similarity + Merge
// ═══════════════════════════════════════

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

async function callClaude(prompt, maxTokens = 8192, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: maxTokens,
          system: "You are a JSON API. Respond with ONLY valid JSON. No prose, no markdown, no explanation, no preamble. Start your response with { and end with }.",
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (res.status === 529 || res.status === 429) {
        const wait = attempt * 3000;
        console.warn(`[Claude] ${res.status} on attempt ${attempt}/${retries}, retrying in ${wait}ms...`);
        if (attempt < retries) { await new Promise(r => setTimeout(r, wait)); continue; }
      }
      if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
      const data = await res.json();
      return data.content?.[0]?.text || "";
    } catch (e) {
      if (attempt === retries) throw e;
      console.warn(`[Claude] Attempt ${attempt} error: ${e.message}, retrying...`);
      await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }
}

export async function handleAISimilarityCheck({ account }) {
  try {
    const inv = await batchRead(INVENTORY_SHEET_ID, ["item_catalog", "item_aliases", "merge_history"], { fresh: true });
    const items = (inv.item_catalog?.rows || [])
      .filter((r) => accountMatch(r[1], account) && r[11] !== "FALSE" && r[11] !== false && r[0] && r[2])
      .map((r) => ({ itemId: r[0], name: r[2], category: r[3] || "Food", unit: r[4] || "EA", vendor: r[6] || "", price: r[7] || "" }));

    if (items.length === 0) return { success: true, groups: [] };

    const aliases = (inv.item_aliases?.rows || [])
      .filter((r) => items.some((i) => i.itemId === r[2]))
      .map((r) => ({ alias: r[1], itemId: r[2], vendor: r[3] }));

    // Recent merge decisions for learning
    const mergeRows = (inv.merge_history?.rows || [])
      .filter((r) => accountMatch(r[1], account))
      .slice(-50);

    // Build separate lists for merged vs keep-separate
    const mergedContext = [];
    const keepSeparateContext = [];
    mergeRows.forEach((r) => {
      if (r[8] === "keep_separate") {
        try {
          const names = JSON.parse(r[7] || "[]");
          if (names.length > 0) keepSeparateContext.push(`  - "${names.join('" AND "')}"`);
        } catch { /* skip malformed */ }
      } else {
        mergedContext.push(`  - MERGED: "${r[5]}" ← ${r[7] || ""}`);
      }
    });

    const mergeContext = mergedContext.length > 0 ? mergedContext.join("\n") : "  (none)";
    const keepSepContext = keepSeparateContext.length > 0 ? keepSeparateContext.join("\n") : "  (none)";

    const catalogList = items.map((i) => `  ID:${i.itemId} | "${i.name}" | ${i.category} | ${i.unit} | vendor:${i.vendor} | price:${i.price}`).join("\n");
    const aliasList = aliases.length > 0
      ? aliases.map((a) => `  "${a.alias}" → ${a.itemId} (${a.vendor})`).join("\n")
      : "  (none)";

    const prompt = `You are a food service inventory dedup engine. Scan this catalog for items that are likely the same product listed multiple times.

CATALOG (${items.length} items):
${catalogList}

EXISTING ALIASES:
${aliasList}

RECENT MERGE DECISIONS BY THIS KITCHEN (learn from these patterns):
${mergeContext}

ITEMS EXPLICITLY MARKED AS DIFFERENT (NEVER flag these pairs again):
${keepSepContext}

FIND GROUPS OF DUPLICATE/SIMILAR ITEMS. Look for:
- Same product with different spelling/abbreviation: "Chicken Breast Bnls" vs "Chc Brst cs" vs "Breast Chicken 5oz"
- Same product from different vendors: vendor descriptions vary but it's the same item
- Same product with different size notations: "30 Pack" vs "30pk" vs "30ct"
- Missing/extra hyphens, spaces, abbreviations
- Same brand, same pack size, slightly different wording

DO NOT flag as duplicates:
- ANY pair listed in "ITEMS EXPLICITLY MARKED AS DIFFERENT" above — this is a hard rule, the kitchen has confirmed these are separate items
- Different sizes of the same product (5oz vs 8oz = different items)
- Items that share a word but are clearly different (e.g., "Chicken Breast" vs "Chicken Wings")

For each group, suggest the best canonical name (clean, professional, includes key details like size/count).

RESPOND WITH ONLY valid JSON (no markdown, no backticks):
{
  "groups": [
    {
      "groupId": "g_001",
      "confidence": 92,
      "suggestedName": "Clean Canonical Name",
      "suggestedCategory": "Food",
      "suggestedUnit": "case",
      "reason": "Brief explanation",
      "items": [
        { "itemId": "item_abc", "name": "Original Name", "vendor": "Vendor Name" }
      ]
    }
  ]
}

IMPORTANT: Be EXHAUSTIVE — scan EVERY item against EVERY other item. Do NOT stop after finding a few groups. Check all ${items.length} items systematically. Missing a duplicate is worse than flagging a false positive. Each group MUST contain at least 2 items. Only return groups where you found 2 or more items that appear to be the same product.

If no duplicates found, return: { "groups": [] }`;

const raw = await callClaude(prompt, 16384);
    // Robust JSON extraction — find first { and last }
    const cleaned = raw.replace(/```json\s*|```/g, "").trim();
    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) throw new Error("No JSON found in Claude response");
    const jsonStr = cleaned.slice(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(jsonStr);

    // Code-level safety: filter out groups that contain keep-separate pairs
    const keepSepSets = mergeRows
      .filter((r) => r[8] === "keep_separate")
      .map((r) => { try { return new Set(JSON.parse(r[6] || "[]")); } catch { return new Set(); } })
      .filter((s) => s.size > 0);

    const filtered = (parsed.groups || [])
      // Must have 2+ items to be a similarity group
      .filter((group) => group.items && group.items.length >= 2)
      // Filter out keep-separate pairs
      .filter((group) => {
      const groupIds = new Set(group.items.map((i) => i.itemId));
      // Reject group if ALL its items appear in a single keep-separate entry
      return !keepSepSets.some((sepSet) => {
        let overlap = 0;
        groupIds.forEach((id) => { if (sepSet.has(id)) overlap++; });
        return overlap >= 2; // at least 2 items from this group were kept separate before
      });
    });

    return { success: true, groups: filtered };
  } catch (error) {
    console.error("[inventoryActions] ai-similarity error:", error.message);
    return { success: false, error: error.message };
  }
}

export async function handleMergeItems({ account, keeperItemId, mergedItemIds, canonicalName, category, unit, email }) {
  try {
    const inv = await batchRead(INVENTORY_SHEET_ID, ["item_catalog", "item_aliases", "price_history"], { fresh: true });
    const catalogRows = inv.item_catalog?.rows || [];
    const aliasRows = inv.item_aliases?.rows || [];
    const priceRows = inv.price_history?.rows || [];
    const now = new Date().toISOString();

    // Find keeper row
    let keeperRowNum = null;
    let keeperRow = null;
    for (let i = 0; i < catalogRows.length; i++) {
      if (catalogRows[i][0] === keeperItemId) { keeperRowNum = i + 2; keeperRow = catalogRows[i]; break; }
    }
    if (!keeperRowNum) return { success: false, error: "Keeper item not found" };

    // Update keeper name/category/unit
    await updateRangeSA(INVENTORY_SHEET_ID, `item_catalog!C${keeperRowNum}:E${keeperRowNum}`, [[canonicalName || keeperRow[2], category || keeperRow[3], unit || keeperRow[4]]]);

    const mergedNames = [];

    for (const mergedId of mergedItemIds) {
      // Find merged row
      for (let i = 0; i < catalogRows.length; i++) {
        if (catalogRows[i][0] === mergedId) {
          const rowNum = i + 2;
          mergedNames.push(catalogRows[i][2] || mergedId);

          // Deactivate merged item
          await updateRangeSA(INVENTORY_SHEET_ID, `item_catalog!L${rowNum}`, [["FALSE"]]);

          // Create alias from merged name → keeper
          await appendRowSA(INVENTORY_SHEET_ID, "item_aliases", [
            generateId("alias"), catalogRows[i][2] || "", keeperItemId,
            catalogRows[i][6] || "", 100, email || "item_review", now, "item_review",
          ]);

          // Remap aliases pointing to merged → keeper
          aliasRows.forEach(async (a, ai) => {
            if (a[2] === mergedId) {
              await updateRangeSA(INVENTORY_SHEET_ID, `item_aliases!C${ai + 2}`, [[keeperItemId]]);
            }
          });

          // Remap price_history
          priceRows.forEach(async (p, pi) => {
            if (p[0] === mergedId) {
              await updateRangeSA(INVENTORY_SHEET_ID, `price_history!A${pi + 2}`, [[keeperItemId]]);
            }
          });

          // Copy locationId if keeper has none
          if (catalogRows[i][5] && !keeperRow[5]) {
            await updateRangeSA(INVENTORY_SHEET_ID, `item_catalog!F${keeperRowNum}`, [[catalogRows[i][5]]]);
            keeperRow[5] = catalogRows[i][5];
          }
          break;
        }
      }
    }

    // Log merge decision
    await appendRowSA(INVENTORY_SHEET_ID, "merge_history", [
      generateId("mrg"), account, now, email || "",
      keeperItemId, canonicalName || keeperRow[2],
      JSON.stringify(mergedItemIds), JSON.stringify(mergedNames),
      "merge", "",
    ]);

    invalidateCache(INVENTORY_SHEET_ID, "item_catalog");
    invalidateCache(INVENTORY_SHEET_ID, "item_aliases");
    invalidateCache(INVENTORY_SHEET_ID, "price_history");

    return { success: true, merged: mergedItemIds.length };
  } catch (error) {
    console.error("[inventoryActions] merge error:", error.message);
    return { success: false, error: error.message };
  }
}

export async function handleKeepSeparate({ account, itemIds, itemNames, email }) {
  try {
    const now = new Date().toISOString();
    await appendRowSA(INVENTORY_SHEET_ID, "merge_history", [
      generateId("mrg"), account, now, email || "",
      "", "",
      JSON.stringify(itemIds),
      JSON.stringify(itemNames || itemIds),
      "keep_separate", "",
    ]);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function handleReviewAccept({ account, itemId, name, category, unit, locationId, email }) {
  try {
    const { rows } = await readSheetSA(INVENTORY_SHEET_ID, "item_catalog");
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === itemId && accountMatch(rows[i][1], account)) {
        const rowNum = i + 2;
        // Update name, category, unit, locationId
        const updates = [name || rows[i][2], category || rows[i][3], unit || rows[i][4]];
        await updateRangeSA(INVENTORY_SHEET_ID, `item_catalog!C${rowNum}:E${rowNum}`, [updates]);
        if (locationId) {
          await updateRangeSA(INVENTORY_SHEET_ID, `item_catalog!F${rowNum}`, [[locationId]]);
          // Log zone correction if different from AI suggestion
          const aiSuggested = rows[i][5] || "";
          if (aiSuggested && aiSuggested !== locationId) {
            await appendRowSA(INVENTORY_SHEET_ID, "zone_corrections", [
              generateId("zc"), account, new Date().toISOString(), email || "",
              itemId, name || rows[i][2], aiSuggested, locationId, category || rows[i][3],
            ]);
          }
        }
        // Set reviewStatus (column Q, index 16)
        await updateRangeSA(INVENTORY_SHEET_ID, `item_catalog!Q${rowNum}`, [["reviewed"]]);
        break;
      }
    }
    invalidateCache(INVENTORY_SHEET_ID, "item_catalog");
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function handleReviewDelete({ account, itemId, reason, email }) {
  try {
    const { rows } = await readSheetSA(INVENTORY_SHEET_ID, "item_catalog");
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === itemId && accountMatch(rows[i][1], account)) {
        await updateRangeSA(INVENTORY_SHEET_ID, `item_catalog!L${i + 2}`, [["FALSE"]]);
        break;
      }
    }
    invalidateCache(INVENTORY_SHEET_ID, "item_catalog");
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function handleExcludeItem({ account, itemId, email }) {
  try {
    const { rows } = await readSheetSA(INVENTORY_SHEET_ID, "item_catalog");
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === itemId && accountMatch(rows[i][1], account)) {
        // Set active=FALSE (col L) and reviewStatus=excluded (col Q)
        await batchUpdateRangesSA(INVENTORY_SHEET_ID, [
          { range: `item_catalog!L${i + 2}`, values: [["FALSE"]] },
          { range: `item_catalog!Q${i + 2}`, values: [["excluded"]] },
        ]);
        // Log to merge_history for cron exclusion reference
        await appendRowSA(INVENTORY_SHEET_ID, "merge_history!A:A", [
          generateId("mrg"), account, new Date().toISOString(), email,
          itemId, rows[i][2] || "", "", "", "exclude", "",
        ]);
        break;
      }
    }
    invalidateCache(INVENTORY_SHEET_ID, "item_catalog");
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function handleResolveQueue(body) { return { success: false, error: "Week 3" }; }
export async function handleSaveLocations({ account, locations, email }) {
  try {
    const { rows } = await readSheetSA(INVENTORY_SHEET_ID, "storage_locations");

    // Ensure columns I & J headers exist (parentLocationId, color)
    await updateRangeSA(INVENTORY_SHEET_ID, "storage_locations!I1:J1", [["parentLocationId", "color"]]);

    const existingRows = {};
    rows.forEach((r, i) => {
      if (accountMatch(r[1], account)) existingRows[r[0]] = i + 2;
    });

    const now = new Date().toISOString();
    const savedIds = new Set();
    const savedLocations = [];
    const newIdMap = {}; // map temp IDs to real IDs for sub-zone parent resolution

    // First pass: save top-level zones (parentLocationId === null)
    const topLevel = locations.filter((l) => !l.parentLocationId);
    for (const loc of topLevel) {
      if (loc.locationId && existingRows[loc.locationId]) {
        const rowNum = existingRows[loc.locationId];
        await updateRangeSA(INVENTORY_SHEET_ID, `storage_locations!A${rowNum}:J${rowNum}`, [[
          loc.locationId, account, loc.name, loc.icon || "box",
          loc.sortOrder, "TRUE", email, now, "", loc.color || "",
        ]]);
        savedIds.add(loc.locationId);
        savedLocations.push({ locationId: loc.locationId, name: loc.name });
      } else {
        const locationId = generateId("loc");
        newIdMap[loc.name] = locationId; // for sub-zone parent resolution
        await appendRowSA(INVENTORY_SHEET_ID, "storage_locations!A:A", [
          locationId, account, loc.name, loc.icon || "box",
          loc.sortOrder, "TRUE", email, now, "", loc.color || "",
        ]);
        savedLocations.push({ locationId, name: loc.name });
      }
    }

    // Second pass: save sub-zones (parentLocationId !== null)
    const subZones = locations.filter((l) => l.parentLocationId);
    console.log(`[save-locations] ${account}: ${topLevel.length} zones, ${subZones.length} sub-zones to save`);
    for (const loc of subZones) {
      // Resolve parent ID (might be a new zone that just got a real ID)
      let parentId = loc.parentLocationId;
      if (!parentId && loc.parentName) parentId = newIdMap[loc.parentName] || "";
      console.log(`[save-locations] Sub-zone "${loc.name}" → parent: ${parentId}`);

      if (loc.locationId && existingRows[loc.locationId]) {
        const rowNum = existingRows[loc.locationId];
        await updateRangeSA(INVENTORY_SHEET_ID, `storage_locations!A${rowNum}:J${rowNum}`, [[
          loc.locationId, account, loc.name, loc.icon || "box",
          loc.sortOrder, "TRUE", email, now, parentId, loc.color || "",
        ]]);
        savedIds.add(loc.locationId);
      } else {
        const locationId = generateId("loc");
        await appendRowSA(INVENTORY_SHEET_ID, "storage_locations!A:A", [
          locationId, account, loc.name, loc.icon || "box",
          loc.sortOrder, "TRUE", email, now, parentId, loc.color || "",
        ]);
        savedIds.add(locationId); // Track new sub-zones too
        console.log(`[save-locations] Appended sub-zone ${locationId} "${loc.name}" parent=${parentId}`);
      }
    }

    // Mark removed locations as inactive + clear sortOrder
    // Only deactivate rows that exist in sheet but weren't in our save payload
    for (const [locId, rowNum] of Object.entries(existingRows)) {
      if (!savedIds.has(locId)) {
        console.log(`[save-locations] Deactivating removed location: ${locId} at row ${rowNum}`);
        await updateRangeSA(INVENTORY_SHEET_ID, `storage_locations!E${rowNum}:F${rowNum}`, [[999, "FALSE"]]);
      }
    }

    // ── Auto-assign items with keyword locationIds ──
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

    const catalogData = await readSheetSA(INVENTORY_SHEET_ID, "item_catalog");
    const catalogRows = catalogData.rows || [];
    let assigned = 0;

    // Build set of all active location IDs for this account
    const activeLocIds = new Set();
    rows.forEach((r) => {
      if (accountMatch(r[1], account) && r[5] !== "FALSE" && r[5] !== false && r[0]) activeLocIds.add(r[0]);
    });
    // Also include newly saved locations
    savedLocations.forEach((l) => activeLocIds.add(l.locationId));

    // Check if any items need assignment (keyword, empty, or orphaned loc_ ID)
    let needsAssignment = false;
    for (let i = 0; i < catalogRows.length; i++) {
      const r = catalogRows[i];
      if (!accountMatch(r[1], account)) continue;
      const currentLocId = r[5] || "";
      if (!currentLocId || (currentLocId && !currentLocId.startsWith("loc_") && KEYWORD_PATTERNS[currentLocId]) || (currentLocId.startsWith("loc_") && !activeLocIds.has(currentLocId))) {
        needsAssignment = true; break;
      }
    }

    if (needsAssignment) {
      console.log(`[save-locations] Running auto-assign for ${account}...`);
      for (let i = 0; i < catalogRows.length; i++) {
        const r = catalogRows[i];
        if (!accountMatch(r[1], account)) continue;
        const currentLocId = r[5] || "";
        const isOrphaned = currentLocId.startsWith("loc_") && !activeLocIds.has(currentLocId);

        // Keyword locationId → map to real location
        if (currentLocId && !currentLocId.startsWith("loc_") && KEYWORD_PATTERNS[currentLocId]) {
          const realLocId = matchKeywordToLocation(currentLocId);
          if (realLocId) { await updateRangeSA(INVENTORY_SHEET_ID, `item_catalog!F${i + 2}`, [[realLocId]]); assigned++; }
        }
        // Empty or orphaned → assign by category
        if (!currentLocId || isOrphaned) {
          const cat = (r[3] || "").toLowerCase();
          let keyword = "dry";
          if (["food"].includes(cat)) keyword = "cooler";
          if (["beverages"].includes(cat)) keyword = "beverage";
          if (["packaging", "supplies"].includes(cat)) keyword = "supplies";
          if (["snacks"].includes(cat)) keyword = "dry";
          const realLocId = matchKeywordToLocation(keyword);
          if (realLocId) { await updateRangeSA(INVENTORY_SHEET_ID, `item_catalog!F${i + 2}`, [[realLocId]]); assigned++; }
        }
      }
      invalidateCache(INVENTORY_SHEET_ID, "item_catalog");
    } else {
      console.log(`[save-locations] No items need auto-assignment, skipping`);
    }

    invalidateCache(INVENTORY_SHEET_ID, "storage_locations");
    invalidateCache(INVENTORY_SHEET_ID, "item_catalog");
    console.log(`[save-locations] ${account}: ${savedLocations.length} zones saved, ${subZones.length} sub-zones, ${assigned} items auto-assigned`);
    return { success: true, count: locations.length, assigned };
  } catch (error) {
    console.error("[inventoryActions] save-locations error:", error.message);
    return { success: false, error: error.message };
  }
}
export async function handleSaveSortOrder({ account, updates }) {
  // updates: [{ locationId, sortOrder }]
  try {
    if (!updates || updates.length === 0) return { success: true };
    const { rows } = await readSheetSA(INVENTORY_SHEET_ID, "storage_locations");
    const data = [];
    for (const u of updates) {
      for (let i = 0; i < rows.length; i++) {
        if (rows[i][0] === u.locationId && accountMatch(rows[i][1], account)) {
          data.push({ range: `storage_locations!E${i + 2}`, values: [[u.sortOrder]] });
          break;
        }
      }
    }
    if (data.length > 0) await batchUpdateRangesSA(INVENTORY_SHEET_ID, data);
    invalidateCache(INVENTORY_SHEET_ID, "storage_locations");
    return { success: true, updated: data.length };
  } catch (error) {
    console.error("[inventoryActions] save-sort-order error:", error.message);
    return { success: false, error: error.message };
  }
}

export async function handleAddSubZone({ account, parentLocationId, name, icon, color, email }) {
      try {
    const { rows } = await readSheetSA(INVENTORY_SHEET_ID, "storage_locations");
    // Count existing sub-zones for sortOrder
    let maxSort = -1;
    rows.forEach(r => {
      if (accountMatch(r[1], account) && (r[8] || "") === (parentLocationId || "") && r[5] !== "FALSE" && r[5] !== false) {
        const s = Number(r[4] || 0);
        if (s > maxSort) maxSort = s;
      }
    });
    const locationId = generateId("loc");
    const now = new Date().toISOString();
    await appendRowSA(INVENTORY_SHEET_ID, "storage_locations!A:A", [
locationId, account, name, icon || "box",
      maxSort + 1, "TRUE", email, now, parentLocationId, color || "",
        ]);
    invalidateCache(INVENTORY_SHEET_ID, "storage_locations");
    return { success: true, locationId, name };
  } catch (error) {
    console.error("[inventoryActions] add-subzone error:", error.message);
    return { success: false, error: error.message };
  }
}

export async function handleUpdateLocation({ account, locationId, fields }) {
  try {
    const { rows } = await readSheetSA(INVENTORY_SHEET_ID, "storage_locations");
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === locationId && accountMatch(rows[i][1], account) && rows[i][5] !== "FALSE" && rows[i][5] !== false) {
        const updates = [];
        if (fields.name !== undefined) updates.push({ range: `storage_locations!C${i + 2}`, values: [[fields.name]] });
        if (fields.icon !== undefined) updates.push({ range: `storage_locations!D${i + 2}`, values: [[fields.icon]] });
        if (fields.color !== undefined) updates.push({ range: `storage_locations!J${i + 2}`, values: [[fields.color]] });
        if (updates.length > 0) await batchUpdateRangesSA(INVENTORY_SHEET_ID, updates);
        break;
      }
    }
    invalidateCache(INVENTORY_SHEET_ID, "storage_locations");
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function handleDeactivateLocation({ account, locationId }) {
  try {
    const { rows } = await readSheetSA(INVENTORY_SHEET_ID, "storage_locations");
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === locationId && accountMatch(rows[i][1], account)) {
        await updateRangeSA(INVENTORY_SHEET_ID, `storage_locations!E${i + 2}:F${i + 2}`, [[999, "FALSE"]]);
        invalidateCache(INVENTORY_SHEET_ID, "storage_locations");
        return { success: true };
      }
    }
    return { success: false, error: "Location not found" };
  } catch (error) {
    console.error("[inventoryActions] deactivate-location error:", error.message);
    return { success: false, error: error.message };
  }
}
export async function handleAdminCorrect(body) { return { success: false, error: "Week 4" }; }
export async function handleScan(body) { return { success: false, error: "Week 3" }; }
export async function handleHistoryGet({ account }) { return { success: true, sessions: [] }; }
export async function handleReviewQueueGet({ account }) { return { success: true, items: [] }; }

// ── One-time catalog dedup ──
function normalizeCatalogName(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

export async function handleDedupCatalog({ dryRun = true }) {
  try {
    const catalogData = await readSheetSA(INVENTORY_SHEET_ID, "item_catalog");
    const aliasData = await readSheetSA(INVENTORY_SHEET_ID, "item_aliases");
    const priceData = await readSheetSA(INVENTORY_SHEET_ID, "price_history");
    const catalogRows = catalogData.rows || [];
    const aliasRows = aliasData.rows || [];
    const priceRows = priceData.rows || [];

    // Group active items by normalized name + account
    const groups = {};
    catalogRows.forEach((r, i) => {
      if (r[11] === "FALSE") return;
      if (!r[0] || !r[2]) return; // skip header/empty rows
      const account = r[1] || "";
      const name = normalizeCatalogName(r[2]);
      if (!name) return; // skip if name normalizes to empty
      const key = `${account}::${name}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push({ rowNum: i + 2, itemId: r[0], name: r[2], lastPriceDate: r[8] || "", locationId: r[5] || "" });
    });

    let deactivated = 0;
    const ops = [];
    const log = [];

    for (const [key, items] of Object.entries(groups)) {
      if (items.length <= 1) continue;

      // Keep item with locationId, then most recent price date
      items.sort((a, b) => {
        if (a.locationId && !b.locationId) return -1;
        if (!a.locationId && b.locationId) return 1;
        return (b.lastPriceDate || "").localeCompare(a.lastPriceDate || "");
      });
      const keeper = items[0];
      const dupes = items.slice(1);

      log.push(`"${keeper.name}" — keep ${keeper.itemId}, deactivate ${dupes.map(d => d.itemId).join(", ")}`);

      for (const dupe of dupes) {
        ops.push({ range: `item_catalog!L${dupe.rowNum}`, values: [["FALSE"]] });

        aliasRows.forEach((a, ai) => {
          if (a[2] === dupe.itemId) {
            ops.push({ range: `item_aliases!C${ai + 2}`, values: [[keeper.itemId]] });
          }
        });

        priceRows.forEach((p, pi) => {
          if (p[0] === dupe.itemId) {
            ops.push({ range: `price_history!A${pi + 2}`, values: [[keeper.itemId]] });
          }
        });

        if (dupe.locationId && !keeper.locationId) {
          ops.push({ range: `item_catalog!F${keeper.rowNum}`, values: [[dupe.locationId]] });
          keeper.locationId = dupe.locationId;
        }

        deactivated++;
      }
    }

    if (!dryRun && ops.length > 0) {
      for (const op of ops) {
        await updateRangeSA(INVENTORY_SHEET_ID, op.range, op.values);
      }
      invalidateCache(INVENTORY_SHEET_ID, "item_catalog");
      invalidateCache(INVENTORY_SHEET_ID, "item_aliases");
      invalidateCache(INVENTORY_SHEET_ID, "price_history");
    }

    return {
      success: true,
      dryRun,
      deactivated,
      operations: ops.length,
      log,
    };
  } catch (error) {
    console.error("[inventoryActions] dedup error:", error.message);
    return { success: false, error: error.message };
  }
}
export async function handlePrint({ account }) { return { success: false, error: "Week 3" }; }