// Live Claude repro: send a real Sysco Garlic invoice line through the
// cron's actual prompt, with the actual CIN - OH catalog (which already
// contains the WCW Garlic - Peeled item from 2026-04-10). The Bug-2
// theory says Claude should match to the WCW item; the dup means it
// returned "new" instead. Run multiple times to see run-to-run variation.
import { readSheetSA, SHEET_IDS } from "@/lib/sheets";

const ACCOUNT = "CIN - OH";
function accountMatch(rowAccount, activeAccount) {
  if (!rowAccount || !activeAccount) return false;
  if (rowAccount === activeAccount) return true;
  return rowAccount.startsWith(activeAccount + " -") || activeAccount.startsWith(rowAccount + " -");
}
function cronNormalize(name) { return (name || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim(); }

const CAT_IDX = {
  itemId: 0, account: 1, name: 2, category: 3, unit: 4, locationId: 5,
  primaryVendor: 6, lastPrice: 7, active: 11, status: 16,
};

// Build the catalog the cron would have seen on 2026-04-18 (before Sysco row existed).
// Pull all active rows for CIN - OH, then REMOVE the Sysco Garlic - Peeled
// row (that's the one we're trying to NOT create).
const catData = await readSheetSA(SHEET_IDS.INVENTORY, "item_catalog");
const SYSCO_GARLIC_ID = "item_3b9c3c4b-527d-461f-82b4832d";
const catalog = (catData.rows || [])
  .filter((r) => accountMatch(r[CAT_IDX.account], ACCOUNT))
  .filter((r) => r[CAT_IDX.active] === "TRUE" || r[CAT_IDX.active] === true)
  .filter((r) => r[CAT_IDX.itemId] !== SYSCO_GARLIC_ID)
  .map((r) => ({
    itemId: r[CAT_IDX.itemId], name: r[CAT_IDX.name], category: r[CAT_IDX.category],
    unit: r[CAT_IDX.unit], primaryVendor: r[CAT_IDX.primaryVendor],
  }));
console.log("CIN - OH catalog rows passed to Claude: " + catalog.length);
const wcwGarlic = catalog.find((c) => c.itemId === "item_e9528302-103e-5045-ed26e35a");
console.log("WCW Garlic in catalog: " + (wcwGarlic ? "YES (" + wcwGarlic.name + " / " + wcwGarlic.primaryVendor + ")" : "MISSING"));

// Pull aliases for those catalog ids
const aliasData = await readSheetSA(SHEET_IDS.INVENTORY, "item_aliases");
const catIds = new Set(catalog.map((c) => c.itemId));
const aliases = (aliasData.rows || [])
  .filter((r) => catIds.has(String(r[2] || "").trim()))
  .map((r) => ({ aliasText: r[1], canonicalItemId: r[2], vendor: r[3] }));
console.log("Aliases passed: " + aliases.length);

// The REAL Sysco invoice lines from 2026-04-17 (which the cron processed
// on 2026-04-18 06:05 UTC and produced the dup catalog row).
const testItems = [
  { idx: 0, desc: "IMPFRSH GARLIC PEELED FRESH", vendor: "Sysco", qty: 2, unit: "lb", price: 29.59, cat: "produce", inv: "519209858" },
  { idx: 1, desc: "PRODUCE *** FRUIT GARLIC PEELED FRESH", vendor: "Sysco", qty: 1, unit: "case", price: 59.18, cat: "produce", inv: "519186945" },
];

// Match the cron's buildMatchPrompt format
const catalogSummary = catalog.map((c) =>
  `  - ID:${c.itemId} | "${c.name}" | ${c.category} | ${c.unit} | vendor:${c.primaryVendor}`
).join("\n");
const aliasSummary = aliases.length > 0
  ? aliases.map((a) => `  - "${a.aliasText}" → ID:${a.canonicalItemId} (${a.vendor})`).join("\n")
  : "  (no aliases yet)";
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
- Items categorized as "other" — reclassify into the correct category above based on the description

VARIETY GROUPING:
- Same brand + same pack size + same or very similar price = ONE catalog entry
- Example: "Deep River Kettle Chips BBQ 24/2oz" and "Deep River Kettle Chips Sea Salt 24/2oz" → one entry "Deep River Kettle Chips 24/2oz"
- Individual flavor names become aliases

MATCHING:
- Compare each item against the existing catalog AND aliases
- Return confidence 0-100:
  - 95-100: Exact or near-exact match (same item, minor spelling/abbreviation difference)
  - 80-94: Very likely match (same product, different vendor description style)
  - 60-79: Possible match (similar product, needs human review)
  - 0-59: No match (new item)
- If confidence >= 60, return the matched catalogItemId
- If confidence < 60, this is a new item — provide a clean canonical name
- CRITICAL matching rules — these are ALL 95+ confidence matches:
  - "30 Pack" vs "30pk" vs "30ct" vs "30 count" → SAME ITEM
  - Missing or extra hyphens, dashes, spaces → SAME ITEM
  - "Ea" vs "Each" vs "1ct" → same unit
  - Same brand + same size + same vendor = same item even if word order differs
  - Same brand + same size + different vendor = MATCH to existing item (different source, same product)
  - Abbreviations: "Chix" = "Chicken", "Org" = "Organic", "Shrd" = "Shredded", "Med" = "Medium", "Lg" = "Large", "Sm" = "Small"

BATCH DEDUP (CRITICAL — prevents duplicate catalog entries):
- BEFORE returning results, scan your own output for items that would create the same catalog entry
- If two or more items in THIS BATCH resolve to the same product:
  - The FIRST occurrence: action "new" (or "match") as normal
  - ALL subsequent occurrences of the same product: action "batch_match" with "batchRefIndex" pointing to the first occurrence's index
  - This ensures only ONE catalog entry is created per unique product per batch
- Example: index 3 = "Jarritos 24pk" from Grey Eagle, index 17 = "Jarritos 24pk" from Grey Eagle:
  - Index 3: { "action": "new", "canonicalName": "Jarritos 24pk", ... }
  - Index 17: { "action": "batch_match", "batchRefIndex": 3, "canonicalName": "Jarritos 24pk", ... }

STORAGE LOCATION SUGGESTION (for new items only):
Suggest where this item is physically stored in a commercial kitchen:
- "cooler" — fresh proteins, dairy, produce, eggs, fresh herbs, dressings, anything requiring 35-41°F
- "freezer" — frozen proteins, frozen vegetables, ice cream, frozen bread, anything requiring 0°F or below. Look for keywords: frozen, IQF, flash frozen, frost
- "dry" — shelf-stable items: canned goods, rice, pasta, flour, sugar, spices, oils, vinegar, dry beans, crackers, chips, snacks, bars, trail mix, candy, cookies
- "beverage" — water, soda, juice, sports drinks, coffee, tea, energy drinks, milk alternatives for beverage service
- "supplies" — cleaning chemicals, sanitizer, gloves, foil, plastic wrap, paper towels, trash bags, packaging materials, to-go containers, disposables

RESPOND WITH ONLY valid JSON (no markdown, no backticks, no explanation):
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

console.log();
console.log("Sending 5 runs of the SAME prompt to Claude...");
console.log();

const RUNS = 5;
const runResults = [];

for (let run = 1; run <= RUNS; run++) {
  console.log("--- RUN " + run + " ---");
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
    continue;
  }
  const result = await res.json();
  const text = result.content?.[0]?.text || "";
  const cleaned = text.replace(/```json\s*|```/g, "").trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); } catch (e) {
    console.log("  parse fail: " + e.message);
    console.log("  raw: " + cleaned.slice(0, 400));
    continue;
  }
  const results = parsed.results || [];
  const summary = results.map((r) =>
    "idx=" + r.index + " action=" + r.action + " conf=" + r.confidence +
    " matchedItemId=" + (r.matchedItemId || "(none)") +
    " canonical=\"" + (r.canonicalName || "") + "\"" +
    (r.batchRefIndex != null ? " batchRef=" + r.batchRefIndex : "")
  );
  for (const s of summary) console.log("  " + s);
  runResults.push(results);
  if (run < RUNS) await new Promise((r) => setTimeout(r, 1500));
}

console.log();
console.log("=============================================================");
console.log("RUN-TO-RUN VARIATION SUMMARY");
console.log("=============================================================");
console.log("idx 0 (\"IMPFRSH GARLIC PEELED FRESH\", lb) actions across runs:");
console.log("  " + runResults.map((r) => r.find((x) => x.index === 0)?.action || "(missing)").join(" / "));
console.log("idx 1 (\"PRODUCE *** FRUIT GARLIC PEELED FRESH\", case) actions across runs:");
console.log("  " + runResults.map((r) => r.find((x) => x.index === 1)?.action || "(missing)").join(" / "));

// Simulate the cron post-process for each run
console.log();
console.log("=============================================================");
console.log("SIMULATED CRON POST-PROCESS - would each run create a dup?");
console.log("=============================================================");
for (let i = 0; i < runResults.length; i++) {
  const results = JSON.parse(JSON.stringify(runResults[i]));
  console.log();
  console.log("RUN " + (i + 1) + ":");
  // Catalog-dedup-by-canonical-name backstop (cron lines 731-742)
  for (const r of results) {
    if (r.action === "new" && r.canonicalName) {
      const key = cronNormalize(r.canonicalName);
      const hit = catalog.find((c) => cronNormalize(c.name) === key);
      if (hit) {
        console.log("  idx=" + r.index + " action='new' canonical='" + r.canonicalName + "' -> backstop HIT: " + hit.itemId + " (" + hit.name + " / " + hit.primaryVendor + ")");
        r.action = "match";
        r.matchedItemId = hit.itemId;
      } else {
        console.log("  idx=" + r.index + " action='new' canonical='" + r.canonicalName + "' -> backstop MISS (would create dup)");
      }
    } else {
      console.log("  idx=" + r.index + " action='" + r.action + "' matched=" + (r.matchedItemId || "(none)"));
    }
  }
}

process.exit(0);
