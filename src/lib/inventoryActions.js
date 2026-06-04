/**
 * inventoryActions.js — Inventory Manager Backend Handlers
 *
 * Post-INV-2: every live handler routes through src/lib/dataStore/inventory.js
 * orchestrators. With cutover flags off (default on merge), the orchestrators
 * dispatch to their Sheets adapters and behavior is byte-equivalent to the
 * pre-INV-2 file. Once DUAL_WRITE_TABLES is flipped for inventory tabs, the
 * same handlers will write to PG via the orchestrators with no further code
 * changes here.
 *
 * Module-arg discipline (per Module 5 lesson #1 / PR #92): every orchestrator
 * call from this file passes { module: "ops" } so READ_FROM_POSTGRES_OPS
 * takes effect at read-cutover time. Forget this once and the per-surface
 * flag silently no-ops.
 *
 * Three INV-2 design calls applied here:
 *   - handleReviewAccept: zone_corrections write DROPPED on both sides (INV-1
 *     dropped the table as vestigial).
 *   - handleMergeItems: mirrors mergeVendors. The orchestrator runs the
 *     existing 4-7 step Sheets sequence unconditionally + the
 *     merge_inventory_items() RPC for atomic PG state. Keeper-field side
 *     effects (location_id copy, notes append) happen in JS inside the PG
 *     adapter BEFORE the RPC, mirroring the Sheets path inline behavior.
 *   - accountMatch retired from this file. The Sheets-side tolerance for
 *     the 1 stray STL-MO full-form row stays inside the Sheets adapters in
 *     dataStore/inventory.js. PG adapters use direct equality; the canonical
 *     account_key CHECK constraint guarantees no drift.
 *
 * 7 stubs (handleUpdateItem, handleResolveQueue, handleAdminCorrect,
 * handleScan, handleHistoryGet, handleReviewQueueGet, handlePrint) STAY as
 * stubs per BR3.
 *
 * handleDedupCatalog RETIRED per audit BR4. The PG UNIQUE constraint on
 * inventory_items + merge_inventory_items() RPC replace it.
 */

import {
  getAccountConfigs, getPeriods, getCurrentPeriod,
} from "@/lib/opsUtils";
import {
  getInventoryBootstrap,
  getCatalogForAccount,
  getCatalogForMatching,
  getRecentMergeHistory,
  createCountSession,
  appendCountItems,
  submitCountSession,
  createInventoryItem,
  verifyItemPrice,
  moveItemsBulk,
  mergeInventoryItems,
  logKeepSeparate,
  acceptReviewItem,
  deleteReviewItem,
  excludeItem,
  saveStorageLocations,
  saveLocationSortOrder,
  addStorageSubZone,
  updateStorageLocation,
  deactivateStorageLocation,
  updateCatalogItem,
  archiveItem,
  reactivateItem,
} from "@/lib/dataStore";

const MH_ACTION_IDX = 8;
const MH_MERGED_IDS_IDX = 6;
const MH_MERGED_NAMES_IDX = 7;
const MH_KEEPER_NAME_IDX = 5;

// ═══════════════════════════════════════
// BOOTSTRAP
// ═══════════════════════════════════════

export async function handleInventoryBootstrap({ account, fresh = false }) {
  try {
    const [accounts, currentPeriod, allPeriods] = await Promise.all([
      getAccountConfigs(), getCurrentPeriod(), getPeriods(),
    ]);

    const activeAccount = account || accounts[0]?.label || "";
    const inv = await getInventoryBootstrap({ account: activeAccount, currentPeriod, fresh, module: "ops" });

    return {
      success: true,
      account: activeAccount,
      accounts: accounts.map((a) => ({ key: a.key, label: a.label, level: a.level })),
      currentPeriod, allPeriods,
      ...inv,
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
    const { sessionId } = await createCountSession({ account, period, email, module: "ops" });
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
    const { locationSaveId, itemCount } = await appendCountItems({
      sessionId, locationId, items, email, module: "ops",
    });
    return { success: true, locationSaveId, itemCount };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ═══════════════════════════════════════
// SUBMIT — finalize count, lock period
// ═══════════════════════════════════════

export async function handleCountSubmit({ sessionId, account, period, summary, email }) {
  try {
    const { grandTotal, catTotals, itemsCounted } = await submitCountSession({
      sessionId, account, period, email, module: "ops",
    });

    // Slack notification (preserved verbatim from pre-INV-2)
    const slackUrl = process.env.SLACK_INVENTORY_WEBHOOK;
    if (slackUrl) {
      const text = `*Inventory Count Submitted*\n• Account: ${account}\n• Period: ${period}\n• By: ${email}\n• Grand Total: $${grandTotal.toFixed(2)}\n• Food: $${catTotals.Food.toFixed(2)} | Snacks: $${catTotals.Snacks.toFixed(2)} | Beverages: $${catTotals.Beverages.toFixed(2)}\n• Supplies: $${catTotals.Supplies.toFixed(2)} | Packaging: $${catTotals.Packaging.toFixed(2)}\n• Items counted: ${itemsCounted}`;
      try { await fetch(slackUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }); } catch {}
    }

    return { success: true, grandTotal, catTotals, itemsCounted };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ═══════════════════════════════════════
// CATALOG — full catalog with aliases
// ═══════════════════════════════════════

export async function handleCatalogGet({ account }) {
  try {
    const { items, aliases } = await getCatalogForAccount({ account, module: "ops" });
    return { success: true, items, aliases };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function handleAddItem({ account, name, vendor, category, unit, price, locationId, email }) {
  try {
    if (!name || !vendor) return { success: false, error: "Name and vendor are required" };
    const { itemId } = await createInventoryItem({
      account, name, vendor, category, unit, price, locationId, email, module: "ops",
    });
    return { success: true, itemId };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function handleVerifyPrice({ account, itemId, price, email }) {
  try {
    await verifyItemPrice({ account, itemId, price, email, module: "ops" });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function handleUpdateItem(body) { return { success: false, error: "Week 3" }; }

export async function handleBatchMoveItems({ account, items }) {
  try {
    if (!items || items.length === 0) return { success: true, moved: 0 };
    const { moved } = await moveItemsBulk({ account, items, module: "ops" });
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
    const [{ items, aliases }, mergeRows] = await Promise.all([
      getCatalogForMatching({ account, module: "ops" }),
      getRecentMergeHistory({ account, limit: 50, module: "ops" }),
    ]);

    // Adapt canonical records back to the shape the prompt-builder uses.
    const promptItems = items.map((i) => ({
      itemId: i.itemId, name: i.name, category: i.category || "Food",
      unit: i.unit || "EA", vendor: i.primaryVendor || "", price: i.lastPrice || "",
    }));

    if (promptItems.length === 0) return { success: true, groups: [] };

    const promptAliases = aliases.map((a) => ({
      alias: a.aliasText, itemId: a.itemId, vendor: a.vendor,
    }));

    // Recent merge decisions for learning (walks the row by positional
    // index; both Sheets adapter and PG adapter return the same shape).
    const mergedContext = [];
    const keepSeparateContext = [];
    mergeRows.forEach((r) => {
      if (r[MH_ACTION_IDX] === "keep_separate") {
        try {
          const names = JSON.parse(r[MH_MERGED_NAMES_IDX] || "[]");
          if (names.length > 0) keepSeparateContext.push(`  - "${names.join('" AND "')}"`);
        } catch { /* skip malformed */ }
      } else {
        mergedContext.push(`  - MERGED: "${r[MH_KEEPER_NAME_IDX]}" ← ${r[MH_MERGED_NAMES_IDX] || ""}`);
      }
    });

    const mergeContext = mergedContext.length > 0 ? mergedContext.join("\n") : "  (none)";
    const keepSepContext = keepSeparateContext.length > 0 ? keepSeparateContext.join("\n") : "  (none)";

    const catalogList = promptItems.map((i) => `  ID:${i.itemId} | "${i.name}" | ${i.category} | ${i.unit} | vendor:${i.vendor} | price:${i.price}`).join("\n");
    const aliasList = promptAliases.length > 0
      ? promptAliases.map((a) => `  "${a.alias}" → ${a.itemId} (${a.vendor})`).join("\n")
      : "  (none)";

    const prompt = `You are a food service inventory dedup engine. Scan this catalog for items that are likely the same product listed multiple times.

CATALOG (${promptItems.length} items):
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

CRITICAL — DIFFERENT PACK SIZES:
When two items have similar names but DIFFERENT UNITS (each vs case, pound vs case, etc.) AND a large price gap (>50% difference), these are the SAME PRODUCT in DIFFERENT PACK SIZES. Do NOT suggest merging them — they must stay separate.
Flag them as type "keep_separate" with a reason like "Same product, different pack size — keep separate."
Example: "Herb Cilantro Fresh" ($0.80/each) and "Cilantro Bunched" ($29.50/case) = same herb, different formats = type "keep_separate".
Example: "Chicken Breast 10lb" ($35.00/case) and "Chicken Breast 10 LB" ($35.50/case) = same product same unit = type "merge".

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
      "type": "merge",
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

TYPE MUST BE one of:
- "merge" — same product, same unit, should be merged into one catalog entry
- "keep_separate" — same product but different pack size/unit, must stay as separate items

IMPORTANT: Be EXHAUSTIVE — scan EVERY item against EVERY other item. Do NOT stop after finding a few groups. Check all ${promptItems.length} items systematically. Missing a duplicate is worse than flagging a false positive. Each group MUST contain at least 2 items. Only return groups where you found 2 or more items that appear to be the same product.

If no duplicates found, return: { "groups": [] }`;

    const raw = await callClaude(prompt, 16384);
    const cleaned = raw.replace(/```json\s*|```/g, "").trim();
    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) throw new Error("No JSON found in Claude response");
    const jsonStr = cleaned.slice(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(jsonStr);

    // Code-level safety: filter out groups that contain keep-separate pairs.
    const keepSepSets = mergeRows
      .filter((r) => r[MH_ACTION_IDX] === "keep_separate")
      .map((r) => { try { return new Set(JSON.parse(r[MH_MERGED_IDS_IDX] || "[]")); } catch { return new Set(); } })
      .filter((s) => s.size > 0);

    const filtered = (parsed.groups || [])
      .filter((group) => group.items && group.items.length >= 2)
      .filter((group) => {
        const groupIds = new Set(group.items.map((i) => i.itemId));
        return !keepSepSets.some((sepSet) => {
          let overlap = 0;
          groupIds.forEach((id) => { if (sepSet.has(id)) overlap++; });
          return overlap >= 2;
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
    const { merged } = await mergeInventoryItems({
      account, keeperItemId, mergedItemIds, canonicalName, category, unit, email, module: "ops",
    });
    return { success: true, merged };
  } catch (error) {
    console.error("[inventoryActions] merge error:", error.message);
    return { success: false, error: error.message };
  }
}

export async function handleKeepSeparate({ account, itemIds, itemNames, email }) {
  try {
    await logKeepSeparate({ account, itemIds, itemNames, email, module: "ops" });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function handleReviewAccept({ account, itemId, name, category, unit, locationId, email }) {
  try {
    await acceptReviewItem({ account, itemId, name, category, unit, locationId, email, module: "ops" });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function handleReviewDelete({ account, itemId, reason, email }) {
  try {
    await deleteReviewItem({ account, itemId, reason, email, module: "ops" });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function handleExcludeItem({ account, itemId, email }) {
  try {
    await excludeItem({ account, itemId, email, module: "ops" });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function handleResolveQueue(body) { return { success: false, error: "Week 3" }; }

export async function handleSaveLocations({ account, locations, email }) {
  try {
    const { count, assigned } = await saveStorageLocations({ account, locations, email, module: "ops" });
    console.log(`[save-locations] ${account}: ${count} zones saved, ${assigned} items auto-assigned`);
    return { success: true, count, assigned };
  } catch (error) {
    console.error("[inventoryActions] save-locations error:", error.message);
    return { success: false, error: error.message };
  }
}

export async function handleSaveSortOrder({ account, updates }) {
  try {
    if (!updates || updates.length === 0) return { success: true };
    const { updated } = await saveLocationSortOrder({ account, updates, module: "ops" });
    return { success: true, updated };
  } catch (error) {
    console.error("[inventoryActions] save-sort-order error:", error.message);
    return { success: false, error: error.message };
  }
}

export async function handleAddSubZone({ account, parentLocationId, name, icon, color, email }) {
  try {
    const { locationId, name: savedName } = await addStorageSubZone({
      account, parentLocationId, name, icon, color, email, module: "ops",
    });
    return { success: true, locationId, name: savedName };
  } catch (error) {
    console.error("[inventoryActions] add-subzone error:", error.message);
    return { success: false, error: error.message };
  }
}

export async function handleUpdateLocation({ account, locationId, fields }) {
  try {
    await updateStorageLocation({ account, locationId, fields, module: "ops" });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function handleDeactivateLocation({ account, locationId }) {
  try {
    const result = await deactivateStorageLocation({ account, locationId, module: "ops" });
    if (result?.ok === false) return { success: false, error: "Location not found" };
    return { success: true };
  } catch (error) {
    console.error("[inventoryActions] deactivate-location error:", error.message);
    return { success: false, error: error.message };
  }
}

export async function handleAdminCorrect(body) { return { success: false, error: "Week 4" }; }
export async function handleScan(body) { return { success: false, error: "Week 3" }; }
export async function handleHistoryGet({ account }) { return { success: true, sessions: [] }; }
export async function handleReviewQueueGet({ account }) { return { success: true, items: [] }; }

// handleDedupCatalog RETIRED per audit BR4. PG UNIQUE constraints on
// inventory_items + merge_inventory_items() RPC replace it.

export async function handlePrint({ account }) { return { success: false, error: "Week 3" }; }

export async function handleUpdateCatalogItem({ account, itemId, fields, email }) {
  try {
    await updateCatalogItem({ account, itemId, fields, email, module: "ops" });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function handleArchiveItem({ account, itemId, email }) {
  try {
    await archiveItem({ account, itemId, email, module: "ops" });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function handleReactivateItem({ account, itemId, email }) {
  try {
    await reactivateItem({ account, itemId, email, module: "ops" });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
