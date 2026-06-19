// Final mechanism C step: send Claude BOTH chia lines as they were on
// 2026-06-03, exactly as the cron would have. The single-line repro
// returned "match" cleanly; the dup happened with TWO lines in the same
// batch. This isolates which mechanism actually fires.
import { readSheetSA, SHEET_IDS } from "@/lib/sheets";

const TARGET_ACCOUNT = "STL - MO";
const TARGET_VENDOR  = "What Chefs Want";
function accountMatch(rowAccount, activeAccount) {
  if (!rowAccount || !activeAccount) return false;
  if (rowAccount === activeAccount) return true;
  return rowAccount.startsWith(activeAccount + " -") || activeAccount.startsWith(rowAccount + " -");
}
function normalizeName(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}
const CAT_IDX = {
  itemId: 0, account: 1, name: 2, category: 3, unit: 4, locationId: 5,
  primaryVendor: 6, lastPrice: 7, active: 11,
};

const catData = await readSheetSA(SHEET_IDS.INVENTORY, "item_catalog");
const filtered = (catData.rows || []).filter((r) =>
  accountMatch(r[CAT_IDX.account], TARGET_ACCOUNT) &&
  r[CAT_IDX.active] !== "FALSE" && r[CAT_IDX.active] !== false
);
const aliasData = await readSheetSA(SHEET_IDS.INVENTORY, "item_aliases");
const catalogIds = new Set(filtered.map((r) => r[CAT_IDX.itemId]));
const aliases = (aliasData.rows || [])
  .filter((r) => catalogIds.has(String(r[2] || "").trim()))
  .map((r) => ({ aliasText: r[1], canonicalItemId: r[2], vendor: r[3] }));

const catalogSummary = filtered
  .map((r) => `  - ID:${r[CAT_IDX.itemId]} | "${r[CAT_IDX.name]}" | ${r[CAT_IDX.category]} | ${r[CAT_IDX.unit]} | vendor:${r[CAT_IDX.primaryVendor]}`)
  .join("\n");
const aliasSummary = aliases.length > 0
  ? aliases.map((a) => `  - "${a.aliasText}" → ID:${a.canonicalItemId} (${a.vendor})`).join("\n")
  : "  (no aliases yet)";

// The two real line items the cron processed on 2026-06-03:
const testItems = [
  { idx: 0, desc: "CHIA SEEDS BLACK ORGANIC", vendor: TARGET_VENDOR, qty: 2, unit: "bag", price: 9.65, cat: "Food", inv: "31385de0-0000-0000-0000-000000000001" },
  { idx: 1, desc: "CHIA SEEDS BLACK ORGANIC", vendor: TARGET_VENDOR, qty: 3, unit: "bag", price: 6.45, cat: "Food", inv: "fae28480-0000-0000-0000-000000000001" },
];

const itemsList = testItems.map((li) =>
  `  ${li.idx}: desc="${li.desc}" | vendor="${li.vendor}" | qty=${li.qty} | unit="${li.unit}" | price=${li.price} | cat="${li.cat}" | invoiceId="${li.inv}"`
).join("\n");

const prompt = `You are a food service inventory matching engine. Your job is to process invoice line items and either match them to existing catalog items or create new catalog entries.

EXISTING CATALOG:
${catalogSummary}

EXISTING ALIASES:
${aliasSummary}

NEW LINE ITEMS TO PROCESS:
${itemsList}

RULES — apply ALL of these in one pass:

SKIP (return action:"skip"):
- Totals, subtotals, grand totals, surcharges, fees, credits, tax lines, delivery fees
- Items with category "smallwares" or "service"
- Garbled/unreadable descriptions (flag reason:"garbled")

NORMALIZE:
- Units: cs→case, ea→each, gal→gallon, lb→pound, oz→ounce, pk→pack, bg→bag, ct→count, dz→dozen
- Fix implausible unit/price combos: $24/oz is probably $24/each, $0.03/case is probably $0.03/each
- Clean up ALL-CAPS descriptions to Title Case
- Remove item numbers, asterisks, special characters from descriptions

CATEGORY MAPPING (map to these 5 GL categories):
- protein, produce, dairy, dry_goods, bakery, frozen → "Food"
- beverage, drinks → "Beverages"
- packaging, paper, disposable → "Packaging"
- cleaning, chemical, janitorial → "Supplies"
- Detect snacks by product type regardless of vendor category: chips, bars, jerky, pretzels, popcorn, trail mix, candy, dried fruit, cookies, crackers → "Snacks"

MATCHING:
- Compare each item against the existing catalog AND aliases
- Return confidence 0-100:
  - 95-100: Exact or near-exact match
  - 80-94: Very likely match
  - 60-79: Possible match
  - 0-59: No match
- If confidence >= 60, return the matched catalogItemId
- If confidence < 60, this is a new item — provide a clean canonical name

BATCH DEDUP (CRITICAL):
- BEFORE returning results, scan your own output for items that would create the same catalog entry
- If two items resolve to the same product:
  - The FIRST occurrence: action "new" (or "match") as normal
  - ALL subsequent occurrences: action "batch_match" with "batchRefIndex" pointing to the first occurrence's index

RESPOND WITH ONLY valid JSON:
{
  "results": [
    {
      "index": 0,
      "action": "match" | "new" | "skip" | "batch_match",
      "confidence": 95,
      "matchedItemId": "existing-item-id-if-matched",
      "batchRefIndex": null,
      "canonicalName": "Clean Item Name",
      "category": "Food",
      "unit": "case",
      "normalizedPrice": 24.50
    }
  ]
}`;

console.log("Catalog rows passed: " + filtered.length);
console.log("Aliases passed:      " + aliases.length);
console.log("Test lines: 2x \"CHIA SEEDS BLACK ORGANIC\" from " + TARGET_VENDOR + " at different prices (9.65/bag vs 6.45/bag)");
console.log();
console.log("Calling Claude...");

const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": process.env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  }),
});
if (!res.ok) {
  console.log("Claude API error: " + res.status + " " + (await res.text()).slice(0, 200));
  process.exit(1);
}
const result = await res.json();
const text = result.content?.[0]?.text || "";
const cleaned = text.replace(/```json\s*|```/g, "").trim();
console.log();
console.log("CLAUDE RESPONSE:");
console.log(cleaned);
console.log();

// Now SIMULATE the cron's post-process to see what would actually be written
const parsed = JSON.parse(cleaned);
const results = (parsed.results || []).map((r) => ({ ...r, index: r.index }));
console.log("=============================================================");
console.log("SIMULATED CRON POST-PROCESS");
console.log("=============================================================");

// Step 1: within-batch dedup of "new" items
const newByName = {};
for (const r of results) {
  if (r.action === "new" && r.canonicalName) {
    const key = normalizeName(r.canonicalName);
    if (newByName[key] !== undefined) {
      console.log("  [batch-dedup] item " + r.index + " '" + r.canonicalName + "' -> batch_match of " + newByName[key]);
      r.action = "batch_match";
      r.batchRefIndex = newByName[key];
    } else {
      newByName[key] = r.index;
    }
  }
}

// Step 2: dedup vs existing catalog
for (const r of results) {
  if (r.action === "new" && r.canonicalName) {
    const key = normalizeName(r.canonicalName);
    const existingMatch = filtered.find((c) => normalizeName(c[CAT_IDX.name]) === key);
    if (existingMatch) {
      console.log("  [catalog-dedup] item " + r.index + " '" + r.canonicalName + "' -> match (item " + existingMatch[CAT_IDX.itemId] + ")");
      r.action = "match";
      r.matchedItemId = existingMatch[CAT_IDX.itemId];
      r.confidence = 95;
    }
  }
}

console.log();
console.log("=============================================================");
console.log("FINAL ACTIONS after post-process");
console.log("=============================================================");
for (const r of results) {
  console.log("  item " + r.index + ":");
  console.log("    action:        " + r.action);
  console.log("    confidence:    " + r.confidence);
  console.log("    matchedItemId: " + (r.matchedItemId || "(none)"));
  console.log("    batchRefIndex: " + (r.batchRefIndex != null ? r.batchRefIndex : "(none)"));
  console.log("    canonicalName: \"" + (r.canonicalName || "") + "\"");
}

// Step 3: simulate the write phase
console.log();
console.log("=============================================================");
console.log("SIMULATED WRITE PHASE - which actions create catalog rows?");
console.log("=============================================================");
const batchNewIds = {};
let catalogCreates = 0;
for (const r of results) {
  if (r.action === "match") {
    console.log("  item " + r.index + ": ACTION=match -> alias + price to " + r.matchedItemId + ", NO new catalog row");
  } else if (r.action === "new") {
    const isPossibleNew = r.confidence !== undefined && r.confidence >= 60;
    if (isPossibleNew) {
      console.log("  item " + r.index + ": ACTION=new (conf >=60) -> queued as possible_new, NO catalog row, batchNewIds NOT set");
    } else {
      const newId = "item_NEW_" + r.index;
      batchNewIds[r.index] = newId;
      catalogCreates++;
      console.log("  item " + r.index + ": ACTION=new (conf <60) -> CREATES catalog row " + newId);
    }
  } else if (r.action === "batch_match") {
    const refIdx = r.batchRefIndex;
    const refItemId = batchNewIds[refIdx];
    if (refItemId) {
      console.log("  item " + r.index + ": ACTION=batch_match -> alias + price to " + refItemId + " (ref found)");
    } else {
      // The orphan path
      const newId = "item_ORPHAN_" + r.index;
      catalogCreates++;
      console.log("  item " + r.index + ": ACTION=batch_match -> *** REF NOT FOUND (refIdx=" + refIdx + " was not in batchNewIds) ***");
      console.log("                                  -> CREATES catalog row " + newId + " (THIS IS THE BUG)");
    }
  }
}
console.log();
console.log("TOTAL NEW CATALOG ROWS CREATED: " + catalogCreates);
console.log("Expected if working correctly: 0 (both lines should match existing item)");

process.exit(0);
