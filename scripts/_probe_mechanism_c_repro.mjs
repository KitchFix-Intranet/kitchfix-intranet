// Read-only Mechanism C reproduction.
// Picks the "Chia Seeds Black Organic" / STL - MO dup group, walks the
// catalog filter + the normalizeName compare, and (optionally) runs the
// real cron prompt against Claude with the dup item as a "new" line to
// see what Claude actually returns.
import { createClient } from "@supabase/supabase-js";
import { readSheetSA, SHEET_IDS } from "@/lib/sheets";

// Mirror exact cron functions: accountMatch and normalizeName.
function accountMatch(rowAccount, activeAccount) {
  if (!rowAccount || !activeAccount) return false;
  if (rowAccount === activeAccount) return true;
  return rowAccount.startsWith(activeAccount + " -") || activeAccount.startsWith(rowAccount + " -");
}
function normalizeName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

// CAT_IDX from intranet's dataStore/inventory.js
const CAT_IDX = {
  itemId: 0, account: 1, name: 2, category: 3, unit: 4, locationId: 5,
  primaryVendor: 6, lastPrice: 7, active: 11, linkedToInvoice: 12,
  isVarietyGroup: 13, createdBy: 14, createdAt: 15, status: 16,
};

const TARGET_NAME = "Chia Seeds Black Organic";
const TARGET_ACCOUNT = "STL - MO";

const data = await readSheetSA(SHEET_IDS.INVENTORY, "item_catalog");
const rows = data.rows || [];
console.log("Total item_catalog rows in Sheets: " + rows.length);
console.log();

// Step 1: find both Chia Seeds rows
const targetRows = rows.filter((r) =>
  String(r[CAT_IDX.name] || "").trim() === TARGET_NAME &&
  String(r[CAT_IDX.account] || "").trim() === TARGET_ACCOUNT
);
console.log("=============================================================");
console.log("STEP 1 - the two rows (Sheets)");
console.log("=============================================================");
console.log("Found " + targetRows.length + " rows for name='" + TARGET_NAME + "' account='" + TARGET_ACCOUNT + "'");
for (let i = 0; i < targetRows.length; i++) {
  const r = targetRows[i];
  const name = r[CAT_IDX.name];
  console.log();
  console.log("Row " + (i + 1) + ":");
  console.log("  itemId:        " + r[CAT_IDX.itemId]);
  console.log("  raw account:   \"" + r[CAT_IDX.account] + "\"  len=" + (r[CAT_IDX.account] || "").length);
  console.log("  raw name:      \"" + name + "\"  len=" + name.length);
  console.log("  raw bytes:     [" + [...name].map(c => c.charCodeAt(0)).join(",") + "]");
  console.log("  primaryVendor: " + r[CAT_IDX.primaryVendor]);
  console.log("  created:       " + r[CAT_IDX.createdAt] + "  by=" + r[CAT_IDX.createdBy]);
  console.log("  active:        " + r[CAT_IDX.active] + "  status=\"" + r[CAT_IDX.status] + "\"");
  console.log("  locationId:    " + r[CAT_IDX.locationId]);
}

if (targetRows.length !== 2) {
  console.log("\nExpected exactly 2 rows; got " + targetRows.length + ". Cannot continue with controlled repro.");
  process.exit(1);
}

// Identify older/newer
const sorted = [...targetRows].sort((a, b) => String(a[CAT_IDX.createdAt]).localeCompare(String(b[CAT_IDX.createdAt])));
const olderRow = sorted[0];
const newerRow = sorted[1];
console.log();
console.log("Older row created: " + olderRow[CAT_IDX.createdAt] + "  (was in catalog at newer-run time)");
console.log("Newer row created: " + newerRow[CAT_IDX.createdAt] + "  (the duplicate)");

// Step 2: reproduce the cron's catalog filter
console.log();
console.log("=============================================================");
console.log("STEP 2 - reproduce the cron's catalog filter for accountTab='" + TARGET_ACCOUNT + "'");
console.log("=============================================================");
console.log("Filter: accountMatch(r[1], '" + TARGET_ACCOUNT + "') && r[11] !== 'FALSE' && r[11] !== false");
console.log();

const filtered = rows.filter((r) =>
  accountMatch(r[CAT_IDX.account], TARGET_ACCOUNT) &&
  r[CAT_IDX.active] !== "FALSE" &&
  r[CAT_IDX.active] !== false
);
console.log("Total filtered catalog rows for this account: " + filtered.length);

const olderInFiltered = filtered.some((r) => r[CAT_IDX.itemId] === olderRow[CAT_IDX.itemId]);
const newerInFiltered = filtered.some((r) => r[CAT_IDX.itemId] === newerRow[CAT_IDX.itemId]);
console.log("Older row (" + olderRow[CAT_IDX.itemId] + ") in filtered catalog: " + olderInFiltered);
console.log("Newer row (" + newerRow[CAT_IDX.itemId] + ") in filtered catalog: " + newerInFiltered);

if (!olderInFiltered) {
  console.log();
  console.log(">>> CAUSE (i) CONFIRMED: older row excluded from catalog filter <<<");
  console.log("    Older row account label: \"" + olderRow[CAT_IDX.account] + "\"");
  console.log("    accountMatch(olderRow.account, '" + TARGET_ACCOUNT + "') = " + accountMatch(olderRow[CAT_IDX.account], TARGET_ACCOUNT));
  console.log("    Older row active value: \"" + olderRow[CAT_IDX.active] + "\"");
  process.exit(0);
}

console.log();
console.log("Older row IS in the filtered catalog passed to Claude. Cause (i) RULED OUT.");
console.log("Moving to Cause (ii) - normalizeName compare.");

// Step 3: normalizeName compare
console.log();
console.log("=============================================================");
console.log("STEP 3 - normalizeName comparison");
console.log("=============================================================");
const olderKey = normalizeName(olderRow[CAT_IDX.name]);
const newerKey = normalizeName(newerRow[CAT_IDX.name]);
console.log("normalizeName(older.name=\"" + olderRow[CAT_IDX.name] + "\")");
console.log("  -> \"" + olderKey + "\"");
console.log("normalizeName(newer.name=\"" + newerRow[CAT_IDX.name] + "\")");
console.log("  -> \"" + newerKey + "\"");
console.log();
console.log("Keys match? " + (olderKey === newerKey ? "YES (same key - line 681 SHOULD have caught the dedup)" : "NO (different keys - the dedup couldn't match)"));

if (olderKey !== newerKey) {
  console.log();
  console.log(">>> CAUSE (ii) CONFIRMED: normalize keys differ <<<");
  for (let i = 0; i < Math.max(olderKey.length, newerKey.length); i++) {
    if (olderKey[i] !== newerKey[i]) {
      console.log("    First divergence at index " + i + ": older='" + olderKey[i] + "' newer='" + newerKey[i] + "'");
      break;
    }
  }
  process.exit(0);
}

console.log();
console.log("Normalize keys match. Line 681 SHOULD have converted the newer one from 'new' to 'match'.");
console.log("Something else produced the row. Digging deeper.");

// Step 4: look at PG.ai_line_items - what description did the cron actually see
// on the night the newer row was created? That description goes into the prompt
// as the line item to match. Claude returns a canonicalName based on it.
console.log();
console.log("=============================================================");
console.log("STEP 4 - PG.ai_line_items investigation");
console.log("=============================================================");
console.log("Looking up the line items extracted around the newer-row creation date");
console.log("to see what description Claude received...");

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const newerCreatedAt = newerRow[CAT_IDX.createdAt];
const dayBefore = new Date(new Date(newerCreatedAt).getTime() - 36 * 3600 * 1000).toISOString();
const dayAfter  = new Date(new Date(newerCreatedAt).getTime() + 12 * 3600 * 1000).toISOString();
const { data: lines } = await supa.from("ai_line_items")
  .select("invoice_uuid, description, vendor, vendor_name, account_key, quantity, unit, unit_price, created_at")
  .ilike("description", "%chia%")
  .gte("created_at", dayBefore)
  .lte("created_at", dayAfter);
console.log("ai_line_items rows w/ description ILIKE %chia% in [" + dayBefore.slice(0,16) + " .. " + dayAfter.slice(0,16) + "]: " + (lines?.length || 0));
for (const r of lines || []) {
  console.log("  invoice=" + r.invoice_uuid?.slice(0,8) + "  vendor=" + (r.vendor_name || r.vendor) + "  acct=" + r.account_key);
  console.log("    desc=\"" + r.description + "\"  qty=" + r.quantity + " " + r.unit + "  $" + r.unit_price);
  console.log("    extracted=" + r.created_at);
}

// Step 5: optional - actually run the cron prompt against Claude
// READ-ONLY: only sends the prompt and reads the response. No writes.
const RUN_CLAUDE = process.argv.includes("--call-claude");
if (!RUN_CLAUDE) {
  console.log();
  console.log("=============================================================");
  console.log("STEP 5 - skipped (rerun with --call-claude to do the live repro)");
  console.log("=============================================================");
  process.exit(0);
}

console.log();
console.log("=============================================================");
console.log("STEP 5 - live Claude call (READ-ONLY, no writes)");
console.log("=============================================================");

// Build a buildMatchPrompt() faithful to the cron's exact text.
// Catalog summary uses the filtered catalog (includes the older row).
// Aliases for these catalog items (kept minimal - same access pattern).
const aliasData = await readSheetSA(SHEET_IDS.INVENTORY, "item_aliases");
const catalogIds = new Set(filtered.map((r) => r[CAT_IDX.itemId]));
const aliases = (aliasData.rows || [])
  .filter((r) => catalogIds.has(String(r[2] || "").trim()))
  .map((r) => ({
    aliasId: r[0], aliasText: r[1], canonicalItemId: r[2], vendor: r[3],
  }));
console.log("Catalog rows passed: " + filtered.length);
console.log("Aliases passed:      " + aliases.length);

// The "new line item" we test - use the actual extracted description from
// the line item that produced the dup, if we found it. Else fall back to
// a synthetic description matching the newer row's name.
let testLine;
if (lines && lines.length > 0) {
  // pick the WHA-980 entry near the newer-row date (most likely the producer)
  const candidate = lines.find((r) => /chefs.?want/i.test(r.vendor_name || r.vendor || "") &&
    Math.abs(new Date(r.created_at).getTime() - new Date(newerCreatedAt).getTime()) < 24 * 3600 * 1000)
    || lines[0];
  testLine = {
    description: candidate.description,
    vendor: candidate.vendor_name || candidate.vendor,
    quantity: candidate.quantity,
    unit: candidate.unit,
    unitPrice: candidate.unit_price,
    category: "Food",
    invoiceUuid: candidate.invoice_uuid,
  };
  console.log("Using REAL extracted line for the test:");
} else {
  testLine = {
    description: newerRow[CAT_IDX.name],
    vendor: newerRow[CAT_IDX.primaryVendor],
    quantity: 1, unit: "case", unitPrice: 9.65, category: "Food",
    invoiceUuid: "00000000-0000-0000-0000-000000000000",
  };
  console.log("Using SYNTHETIC line (no real extracted line found in window):");
}
console.log("  desc=\"" + testLine.description + "\" vendor=\"" + testLine.vendor + "\" qty=" + testLine.quantity);

// Build prompt (mirror buildMatchPrompt from index.js:293-396 exactly)
const catalogForPrompt = filtered.map((r) => ({
  itemId: r[CAT_IDX.itemId], name: r[CAT_IDX.name], category: r[CAT_IDX.category],
  unit: r[CAT_IDX.unit], primaryVendor: r[CAT_IDX.primaryVendor],
}));
const catalogSummary = catalogForPrompt.length > 0
  ? catalogForPrompt.map((c) => `  - ID:${c.itemId} | "${c.name}" | ${c.category} | ${c.unit} | vendor:${c.primaryVendor}`).join("\n")
  : "  (empty catalog — all items are new)";
const aliasSummary = aliases.length > 0
  ? aliases.map((a) => `  - "${a.aliasText}" → ID:${a.canonicalItemId} (${a.vendor})`).join("\n")
  : "  (no aliases yet)";
const itemsList = `  0: desc="${testLine.description}" | vendor="${testLine.vendor}" | qty=${testLine.quantity} | unit="${testLine.unit}" | price=${testLine.unitPrice} | cat="${testLine.category}" | invoiceId="${testLine.invoiceUuid}"`;

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
  - Same brand + same size + same vendor = same item even if word order differs
  - Same brand + same size + different vendor = MATCH to existing item

RESPOND WITH ONLY valid JSON:
{
  "results": [
    {
      "index": 0,
      "action": "match" | "new" | "skip" | "batch_match",
      "confidence": 95,
      "matchedItemId": "existing-item-id-if-matched",
      "canonicalName": "Clean Item Name",
      "category": "Food",
      "unit": "case",
      "normalizedPrice": 24.50
    }
  ]
}`;

console.log("Calling Claude (model: claude-sonnet-4-20250514, READ-ONLY, no writes)...");
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
console.log("=============================================================");
console.log("CLAUDE RESPONSE:");
console.log("=============================================================");
console.log(cleaned);
console.log();
console.log("=============================================================");
console.log("INTERPRETATION:");
console.log("=============================================================");
try {
  const parsed = JSON.parse(cleaned);
  const r = parsed.results?.[0];
  if (!r) console.log("No result returned.");
  else {
    console.log("Claude returned:");
    console.log("  action:         " + r.action);
    console.log("  confidence:     " + r.confidence);
    console.log("  matchedItemId:  " + (r.matchedItemId || "(none)"));
    console.log("  canonicalName:  \"" + (r.canonicalName || "") + "\"");
    console.log();
    if (r.action === "match" && r.matchedItemId === olderRow[CAT_IDX.itemId]) {
      console.log("=> Claude WOULD HAVE matched the older row this run. Bug must be elsewhere.");
    } else if (r.action === "match") {
      console.log("=> Claude returned 'match' but to ITEM " + r.matchedItemId + " (not the older row " + olderRow[CAT_IDX.itemId] + ")");
    } else if (r.action === "new") {
      console.log("=> Claude returned 'new' despite the older row being in the catalog summary.");
      const claudeKey = normalizeName(r.canonicalName);
      const olderRowKey = normalizeName(olderRow[CAT_IDX.name]);
      console.log("   normalizeName(Claude's canonicalName) = \"" + claudeKey + "\"");
      console.log("   normalizeName(older row's name)        = \"" + olderRowKey + "\"");
      console.log("   match? " + (claudeKey === olderRowKey ? "YES (line 681 would have caught it)" : "NO (canonical-name normalization gap)"));
    }
  }
} catch (e) {
  console.log("Could not parse Claude's response: " + e.message);
}

process.exit(0);
