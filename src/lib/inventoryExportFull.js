// Full-picture inventory count-sheet export (Path A).
//
// Public entry: buildFullInventoryCountWorkbook({ account, since, capUnprocessed })
//   Returns { workbook, filename, stats } where workbook is an ExcelJS
//   Workbook ready to write to a stream + the suggested attachment
//   filename + a small stats object for the caller to log.
//
// Reads STRAIGHT from Postgres:
//   inventory_items + price_history + item_aliases + merge_history
//   + merge_history_items + ai_line_items + count_sessions + vendors.
// Bypasses the Smart Inventory UI + AI similarity scanner entirely.
// Writes nothing.
//
// Extends the shape of buildInventoryCountWorkbook (PR #614) with a
// merge pass across three item classes (spec §Merge logic):
//
//   Class 1: catalog items with price_history rows, no ai_line_items
//            enrichment. Displayed as normal rows.
//   Class 2: catalog items whose normalized description matches an
//            ai_line_items row (directly by name OR via item_aliases
//            with unit+category alignment). Avg Unit Price averages
//            both sources; vendors union; Last Ordered = MAX of both.
//   Class 3: ai_line_items descriptions with no catalog match. Grouped
//            by (normKey, unit, category), tagged "NEW - not in
//            catalog" in the Notes column, sorted AFTER catalog rows
//            in each tab.
//
// Exclusions (merge_history.action='exclude') are honored across all
// three classes. A description matching an excluded item is dropped
// silently, including Class 3.
//
// Category tabs use the 5-value inventory_category enum
// (Food | Packaging | Supplies | Snacks | Beverages) plus an
// "Uncategorized" tab if any rows land there. Class 3 items get their
// tab via mapAiCategory() which projects ai_line_items' 10-bucket
// free-text field down to the 5-value enum.

import ExcelJS from "exceljs";
import { getServiceClient } from "@/lib/supabase";
import { normalize } from "@/lib/inventoryExport";

// -- style tokens (kept local because PR #614's file only exports
// normalize; per spec we do not touch that file's exports) ----------

const AMBER_FILL      = "FFFEF3C7"; // chef's Count column
const NEW_FILL        = "FFFEF9C3"; // "NEW - not in catalog" row background
const FROZEN_FILL     = "FFDBEAFE"; // frozen row highlight
const NAVY_FILL       = "FF153968"; // header bar
const WHITE_FONT      = "FFFFFFFF";
const SUBTOTAL_FILL   = "FFF1F5F9"; // category total row
const WARN_FILL       = "FFFEF3C7"; // instructions-warning box
const INSTRUCTIONS_H  = "FF0F172A";

const MONEY_FMT_BLANK = '$#,##0.00;[Red]-$#,##0.00;""';
const MONEY_FMT       = '"$"#,##0.00';
const DATE_FMT        = 'mmm d, yyyy';

const CATEGORY_ORDER = ["Food", "Packaging", "Supplies", "Snacks", "Beverages"];
const FROZEN_RE      = /\b(FROZEN|FRZN|FRZ|IQF)\b/i;

const NEW_NOTE       = "NEW - not in catalog";
const DEFAULT_SINCE  = "2026-06-04";
const DEFAULT_CAP    = 20000;

// -- small helpers (re-declared here to keep PR #614's file untouched) --

function pickLongestName(names) {
  return names.slice().sort((a, b) => b.length - a.length)[0];
}

function mean(nums) {
  const clean = nums.filter((n) => typeof n === "number" && Number.isFinite(n));
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

function maxDate(dates) {
  const parsed = dates
    .filter(Boolean)
    .map((d) => new Date(d))
    .filter((d) => !Number.isNaN(d.getTime()));
  if (!parsed.length) return null;
  return new Date(Math.max(...parsed.map((d) => d.getTime())));
}

function compositeKey(norm, unit, category) {
  return `${category || "Uncategorized"} | ${unit || ""} | ${norm}`;
}

// Map ai_line_items.category (free text, 10-bucket) to the 5-value
// inventory_category enum. Unrecognized values land in Uncategorized.
export function mapAiCategory(text) {
  const s = String(text || "").toLowerCase().trim();
  if (!s) return "Uncategorized";
  switch (s) {
    case "produce":
    case "protein":
    case "dairy":
    case "dry_goods":
    case "dry goods":
    case "meat":
      return "Food";
    case "beverage":
    case "beverages":
      return "Beverages";
    case "packaging":
      return "Packaging";
    case "supplies":
    case "cleaning":
    case "smallwares":
      return "Supplies";
    case "snack":
    case "snacks":
      return "Snacks";
    default:
      return "Uncategorized";
  }
}

// Classify a single ai_line_items row against a catalog + alias index +
// exclusion set. Pure function - used by the workbook builder and by
// standalone tests.
//   Returns one of:
//     { klass: "excluded" }
//     { klass: "class2", itemId }   -- enriches an existing catalog item
//     { klass: "class3", key, mappedCategory, unit }
export function classifyLineItem(li, {
  catalogByKey,       // Map<compositeKey, itemId>
  aliasesByNorm,      // Map<normDesc, itemId>
  catalogByItemId,    // Map<itemId, {name, unit, category}>
  excludedNorms,      // Set<normDesc>
}) {
  const norm = normalize(li.description);
  if (!norm) return { klass: "excluded" };
  if (excludedNorms.has(norm)) return { klass: "excluded" };
  const mappedCategory = mapAiCategory(li.category);
  const unit = li.unit || "";
  const key = compositeKey(norm, unit, mappedCategory);

  if (catalogByKey.has(key)) {
    return { klass: "class2", itemId: catalogByKey.get(key) };
  }

  const aliasItemId = aliasesByNorm.get(norm);
  if (aliasItemId) {
    const catItem = catalogByItemId.get(aliasItemId);
    if (
      catItem
      && (catItem.unit || "") === unit
      && (catItem.category || "Uncategorized") === mappedCategory
    ) {
      return { klass: "class2", itemId: aliasItemId };
    }
  }

  return { klass: "class3", key, mappedCategory, unit };
}

// -- data fetch layer ----------------------------------------------

async function fetchCatalog(supa, account) {
  const { data, error } = await supa
    .from("inventory_items")
    .select("id, name, unit, category, last_verified, vendor_id, vendors(name)")
    .eq("account", account)
    .eq("status", "active");
  if (error) throw new Error(`inventory_items read failed: ${error.message}`);
  return (data || []).map((r) => ({
    id: r.id,
    name: r.name || "",
    unit: r.unit || "",
    category: r.category, // may be null
    lastVerified: r.last_verified,
    vendorName: r.vendors?.name || "",
  }));
}

// Pull ALL price_history rows for the account so we can:
//   (a) index the recent-8 by item for Class 1 stats
//   (b) build the "processed invoice_uuid set" for the unprocessed-line-items filter
async function fetchPriceHistory(supa, account) {
  const { data, error } = await supa
    .from("price_history")
    .select("item_id, price, recorded_at, source_or_invoice_id")
    .eq("account", account)
    .order("recorded_at", { ascending: false });
  if (error) throw new Error(`price_history read failed: ${error.message}`);
  return data || [];
}

async function fetchAliases(supa, account) {
  const { data, error } = await supa
    .from("item_aliases")
    .select("alias_text, item_id, inventory_items!inner(account, status)")
    .eq("inventory_items.account", account)
    .eq("inventory_items.status", "active");
  if (error) throw new Error(`item_aliases read failed: ${error.message}`);
  return data || [];
}

async function fetchExclusions(supa, account) {
  const { data, error } = await supa
    .from("merge_history")
    .select("id, action, merge_history_items(item_name)")
    .eq("account", account)
    .eq("action", "exclude");
  if (error) throw new Error(`merge_history read failed: ${error.message}`);
  const names = [];
  for (const mh of data || []) {
    for (const child of mh.merge_history_items || []) {
      if (child?.item_name) names.push(child.item_name);
    }
  }
  return names;
}

async function fetchUnprocessedLineItems(supa, account, sinceIso, cap, processedUuidSet) {
  const { data, error } = await supa
    .from("ai_line_items")
    .select("id, invoice_uuid, description, unit, unit_price, category, invoice_date, vendor_name, created_at")
    .eq("account_key", account)
    .gte("created_at", `${sinceIso}T00:00:00+00`)
    .gte("invoice_date", "2020-01-01")
    .lte("invoice_date", new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10))
    .order("created_at", { ascending: false })
    .limit(cap + 1); // pull one extra so we know if we capped
  if (error) throw new Error(`ai_line_items read failed: ${error.message}`);
  const rows = (data || []).filter((r) =>
    !processedUuidSet.has(String(r.invoice_uuid)),
  );
  const capped = rows.length > cap;
  return { rows: capped ? rows.slice(0, cap) : rows, capped, rawFetched: (data || []).length };
}

async function fetchDraftSessionCount(supa, account) {
  const { count, error } = await supa
    .from("count_sessions")
    .select("id", { count: "exact", head: true })
    .eq("account", account)
    .eq("status", "draft");
  if (error) throw new Error(`count_sessions read failed: ${error.message}`);
  return count || 0;
}

// -- merge core ---------------------------------------------------

// Turn raw price_history into per-item stats:
//   {itemId => {avgPrice, lastDate, recentPrices: number[]}}
// Uses the most recent 8 rows per item by recorded_at (input is already
// sorted DESC by recorded_at at the fetch layer).
function computePriceStatsByItem(priceHistoryRows) {
  const buckets = new Map();
  for (const row of priceHistoryRows) {
    const arr = buckets.get(row.item_id) || [];
    if (arr.length < 8) arr.push(row);
    buckets.set(row.item_id, arr);
  }
  const out = new Map();
  for (const [itemId, rows] of buckets) {
    const prices = rows.map((r) => Number(r.price)).filter(Number.isFinite);
    const avg = mean(prices);
    const dates = rows.map((r) => r.recorded_at).filter(Boolean);
    const last = dates.length ? new Date(dates[0]) : null; // sorted DESC already
    out.set(itemId, {
      avgPrice: avg,
      lastDate: last,
      recentPrices: prices,
    });
  }
  return out;
}

// Build the exported rows list. Pure function of the inputs; the fetch
// layer feeds it. Exposed for tests.
export function mergeToRows({
  catalog,
  priceHistoryRows,
  aliases,
  exclusions,
  lineItems,
}) {
  const excludedNorms = new Set(exclusions.map(normalize).filter(Boolean));

  // Build catalog indices.
  const catalogByItemId = new Map(catalog.map((c) => [c.id, c]));
  const catalogByKey    = new Map();
  for (const c of catalog) {
    const cat = c.category || "Uncategorized";
    const key = compositeKey(normalize(c.name), c.unit || "", cat);
    catalogByKey.set(key, c.id);
  }
  const aliasesByNorm = new Map();
  for (const a of aliases) {
    const n = normalize(a.alias_text);
    if (n && !aliasesByNorm.has(n)) aliasesByNorm.set(n, a.item_id);
  }

  const priceStats = computePriceStatsByItem(priceHistoryRows);

  // Line-item pass -> per-item enrichment + Class 3 groups.
  const enrichmentByItemId = new Map();
  const class3Groups       = new Map();

  const ensureEnrichment = (itemId) => {
    if (!enrichmentByItemId.has(itemId)) {
      enrichmentByItemId.set(itemId, { prices: [], vendors: new Set(), dates: [] });
    }
    return enrichmentByItemId.get(itemId);
  };

  for (const li of lineItems) {
    const verdict = classifyLineItem(li, {
      catalogByKey, aliasesByNorm, catalogByItemId, excludedNorms,
    });
    if (verdict.klass === "excluded") continue;
    if (verdict.klass === "class2") {
      const e = ensureEnrichment(verdict.itemId);
      const price = Number(li.unit_price);
      if (Number.isFinite(price)) e.prices.push(price);
      if (li.vendor_name) e.vendors.add(li.vendor_name);
      if (li.invoice_date) e.dates.push(li.invoice_date);
      continue;
    }
    // Class 3
    const g = class3Groups.get(verdict.key) || {
      names: [], unit: verdict.unit, category: verdict.mappedCategory,
      prices: [], vendors: new Set(), dates: [],
    };
    g.names.push(li.description);
    const price = Number(li.unit_price);
    if (Number.isFinite(price)) g.prices.push(price);
    if (li.vendor_name) g.vendors.add(li.vendor_name);
    if (li.invoice_date) g.dates.push(li.invoice_date);
    class3Groups.set(verdict.key, g);
  }

  const rows = [];

  // Catalog rows (Class 1 or Class 2).
  for (const c of catalog) {
    if (excludedNorms.has(normalize(c.name))) continue;
    const stats = priceStats.get(c.id);
    const enrich = enrichmentByItemId.get(c.id);
    const vendors = new Set(c.vendorName ? [c.vendorName] : []);
    let avgPrice = stats?.avgPrice ?? null;
    let lastOrdered = stats?.lastDate ?? null;
    if (enrich) {
      const combinedPrices = [...(stats?.recentPrices || []), ...enrich.prices];
      avgPrice = mean(combinedPrices);
      for (const v of enrich.vendors) vendors.add(v);
      lastOrdered = maxDate([lastOrdered, ...enrich.dates]);
    }
    rows.push({
      name: c.name,
      unit: c.unit || "",
      category: c.category || "Uncategorized",
      vendors: Array.from(vendors).sort().join(" / "),
      avgPrice,
      lastOrdered,
      frozen: FROZEN_RE.test(c.name),
      isNew: false,
    });
  }

  // Class 3 rows.
  for (const g of class3Groups.values()) {
    const name = pickLongestName(g.names);
    rows.push({
      name,
      unit: g.unit || "",
      category: g.category,
      vendors: Array.from(g.vendors).sort().join(" / "),
      avgPrice: mean(g.prices),
      lastOrdered: maxDate(g.dates),
      frozen: FROZEN_RE.test(name),
      isNew: true,
    });
  }

  return {
    rows,
    stats: {
      catalog_count: catalog.length,
      class2_count: enrichmentByItemId.size,
      class3_group_count: class3Groups.size,
      excluded_norms: excludedNorms.size,
      alias_count: aliasesByNorm.size,
    },
  };
}

// -- workbook build ------------------------------------------------

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: WHITE_FONT }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = { bottom: { style: "thin", color: { argb: "FF334155" } } };
  });
  row.height = 22;
}

function addInstructionsTab(wb, {
  account, generatedAt, itemTotal, class3Count,
  activeTabs, draftSessions, cappedNotice, sinceIso,
}) {
  const ws = wb.addWorksheet("Instructions", { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 100;

  const header = `${account} Full Inventory Count Sheet`;
  const meta = [
    `Generated: ${generatedAt.toLocaleString()}`,
    `Total unique items after dedup: ${itemTotal} (of which ${class3Count} are NEW - not in catalog)`,
    `Category tabs: ${activeTabs.join(", ")}`,
    `Unprocessed line items pulled since: ${sinceIso}`,
  ];

  const warnings = [];
  if (draftSessions > 0) {
    warnings.push(
      `WARNING: ${draftSessions} open draft count session${draftSessions === 1 ? "" : "s"} exist for this account. `
      + `This export does not reflect in-flight counts. Reconcile drafts before starting a new count with this sheet.`,
    );
  }
  if (cappedNotice) {
    warnings.push(
      "WARNING: This export processed the most recent 20,000 unreconciled line items. "
      + "Contact Kevin for a full backfill if that is not enough.",
    );
  }

  const sections = [
    [
      "1. How this was built",
      "This sheet was pulled straight from Postgres because the Smart Inventory UI is timing out on the STL-FL catalog and the nightly cron stopped writing to PG on 2026-06-04.",
      "It merges the current PG catalog with recent invoice line items that were never reconciled into the catalog. Duplicates were folded in memory: items sharing a normalized name + unit + category are shown as ONE row.",
      "The schema only carries five category buckets (Food, Packaging, Supplies, Snacks, Beverages). Any finer sub-buckets (Protein, Produce, Dry Goods, etc.) DO NOT exist in the database - one tab per bucket is what you get.",
    ],
    [
      "2. Where these items came from",
      "Rows without a NEW tag are current Smart Inventory catalog items (their normal history + prices are already known).",
      "Rows tagged 'NEW - not in catalog' in the Notes column were seen on an invoice since " + sinceIso + " but have not been added to the catalog yet - the nightly reconciliation cron has been silent on this side of the system since 2026-06-04. Count them the same way you count any other item; Kevin and Joe will decide later which NEW items to promote to the catalog.",
      "If a NEW row looks like a duplicate of a catalog row already above it, count them together on one line and leave a note in the Notes column.",
    ],
    [
      "3. How to count",
      "Work one tab at a time. In each tab, fill the amber Count column with what you actually have on hand.",
      "Extended Total in the next column self-calculates ($/unit x count). Leave Count blank for items you skip - Extended Total shows blank, not $0.",
      "Every tab has a Category Total row at the bottom. The Summary tab rolls all tabs into one grand total.",
    ],
    [
      "4. What might still be missing",
      "Genuinely never-seen items - if a vendor delivered something we have never received or manually added, it will not appear. Write it at the bottom of the right tab.",
      "Excluded items - items you or Joe marked 'never re-import' (e.g. old plastic tub sizes) will not appear even if a new invoice mentions them. That is by design.",
      "The 'NEW' tag catches items that arrived via invoice but never got promoted; the 'genuinely never-seen' gap is only for items that never appeared on any invoice.",
    ],
    [
      "5. Frozen items caveat",
      "Rows flagged FROZEN / FRZN / FRZ / IQF are highlighted light blue and sorted to the top of each tab.",
      "The detector matches word-boundary FRZ so it CAN false-positive on flavor names like 'GAT GLCR FRZ' (Gatorade Glacier Frost). Spot-check the flagged rows.",
    ],
    [
      "6. Units",
      "The Unit column shows what one unit of Avg Unit Price refers to (case, pound, each, gallon, etc.). Enter Count in that same unit - not in the individual pack pieces.",
    ],
    [
      "7. When you finish",
      "Save the file, take a photo or scan of any handwritten additions, and send them to Kevin.",
      "Once Smart Inventory's UI is fixed the counts can be typed back in for the historical record.",
    ],
  ];

  let r = 1;
  const write = (text, opts = {}) => {
    const cell = ws.getCell(`A${r}`);
    cell.value = text;
    if (opts.head1) cell.font = { bold: true, size: 16, color: { argb: INSTRUCTIONS_H } };
    else if (opts.head2) cell.font = { bold: true, size: 12, color: { argb: INSTRUCTIONS_H } };
    else cell.font = { size: 11, color: { argb: "FF334155" } };
    if (opts.warn) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARN_FILL } };
      cell.font = { size: 11, bold: true, color: { argb: INSTRUCTIONS_H } };
    }
    cell.alignment = { wrapText: true, vertical: "top" };
    r += 1;
  };

  write(header, { head1: true });
  write("");
  for (const m of meta) write(m);
  write("");
  for (const w of warnings) { write(w, { warn: true }); write(""); }

  for (const block of sections) {
    write(block[0], { head2: true });
    for (let i = 1; i < block.length; i += 1) write(block[i]);
    write("");
  }

  ws.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
}

function addSummaryTab(wb, categoriesWithRows) {
  const ws = wb.addWorksheet("Summary", { views: [{ showGridLines: false }] });
  ws.columns = [
    { header: "Category", key: "cat", width: 26 },
    { header: "Items Counted", key: "cnt", width: 16 },
    { header: "Extended Total", key: "ext", width: 20 },
    { header: "% of Total", key: "pct", width: 14 },
  ];
  styleHeaderRow(ws.getRow(1));

  const grandRow = 2 + categoriesWithRows.length;
  categoriesWithRows.forEach((tabName, idx) => {
    const r = 2 + idx;
    const safeTab = `'${tabName.replace(/'/g, "''")}'`;
    ws.getCell(`A${r}`).value = tabName;
    ws.getCell(`B${r}`).value = { formula: `COUNTIF(${safeTab}!F:F,">0")` };
    ws.getCell(`C${r}`).value = { formula: `SUM(${safeTab}!G:G)` };
    ws.getCell(`C${r}`).numFmt = MONEY_FMT;
    ws.getCell(`D${r}`).value = { formula: `IFERROR(C${r}/C${grandRow},0)` };
    ws.getCell(`D${r}`).numFmt = "0.0%";
  });

  const first = 2;
  const last = 1 + categoriesWithRows.length;
  ws.getCell(`A${grandRow}`).value = "GRAND TOTAL";
  ws.getCell(`B${grandRow}`).value = { formula: `SUM(B${first}:B${last})` };
  ws.getCell(`C${grandRow}`).value = { formula: `SUM(C${first}:C${last})` };
  ws.getCell(`C${grandRow}`).numFmt = MONEY_FMT;
  ws.getCell(`D${grandRow}`).value = 1;
  ws.getCell(`D${grandRow}`).numFmt = "0.0%";
  for (const col of ["A", "B", "C", "D"]) {
    const c = ws.getCell(`${col}${grandRow}`);
    c.font = { bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBTOTAL_FILL } };
    c.border = { top: { style: "medium", color: { argb: "FF334155" } } };
  }

  ws.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
}

// Sort order within a tab (globally-frozen-first per owner ruling
// 2026-08-04 on PR #621): all frozen items across every class come
// first so the chef walks the walk-in freezer as one trip, then
// non-frozen catalog rows (Class 1 + Class 2), then non-frozen NEW
// rows (Class 3). Alphabetical within each group. The "NEW - not in
// catalog" note stays on Class 3 rows wherever they sort.
export function sortRowsForTab(rows) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const frozen  = rows.filter((r) =>  r.frozen);
  const catalog = rows.filter((r) => !r.frozen && !r.isNew);
  const newRows = rows.filter((r) => !r.frozen &&  r.isNew);
  frozen.sort(byName);
  catalog.sort(byName);
  newRows.sort(byName);
  return [...frozen, ...catalog, ...newRows];
}

function addCategoryTab(wb, tabName, rows) {
  const ws = wb.addWorksheet(tabName, { views: [{ showGridLines: false }] });
  ws.columns = [
    { header: "Item",           key: "item",   width: 46 },
    { header: "Unit",           key: "unit",   width: 12 },
    { header: "Avg Unit Price", key: "price",  width: 16 },
    { header: "Vendor(s)",      key: "vendor", width: 28 },
    { header: "Last Ordered",   key: "last",   width: 14 },
    { header: "Count",          key: "count",  width: 12 },
    { header: "Extended Total", key: "ext",    width: 16 },
    { header: "Notes",          key: "notes",  width: 30 },
  ];
  styleHeaderRow(ws.getRow(1));

  const sorted = sortRowsForTab(rows);

  sorted.forEach((row, idx) => {
    const r = 2 + idx;
    ws.getCell(`A${r}`).value = row.name;
    ws.getCell(`B${r}`).value = row.unit || "";
    if (typeof row.avgPrice === "number") {
      ws.getCell(`C${r}`).value = row.avgPrice;
      ws.getCell(`C${r}`).numFmt = MONEY_FMT;
    }
    ws.getCell(`D${r}`).value = row.vendors || "";
    if (row.lastOrdered) {
      ws.getCell(`E${r}`).value = row.lastOrdered;
      ws.getCell(`E${r}`).numFmt = DATE_FMT;
    }
    const countCell = ws.getCell(`F${r}`);
    countCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMBER_FILL } };
    countCell.alignment = { horizontal: "right" };
    const extCell = ws.getCell(`G${r}`);
    extCell.value = { formula: `IFERROR(F${r}*C${r},0)` };
    extCell.numFmt = MONEY_FMT_BLANK;
    if (row.isNew) {
      ws.getCell(`H${r}`).value = NEW_NOTE;
    }

    // Highlight: frozen wins for the whole row (except Count amber);
    // NEW-only rows get a distinct light amber background (except Count
    // amber). Frozen-NEW rows keep the blue frozen highlight and the
    // NEW note in H so the two flags are still visible.
    const bg = row.frozen ? FROZEN_FILL : (row.isNew ? NEW_FILL : null);
    if (bg) {
      for (const col of ["A", "B", "C", "D", "E", "G", "H"]) {
        ws.getCell(`${col}${r}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
      }
    }
  });

  const dataStart = 2;
  const dataEnd = 1 + sorted.length;
  const totalRow = dataEnd + 1;
  ws.getCell(`A${totalRow}`).value = `${tabName} Total`;
  ws.getCell(`G${totalRow}`).value = { formula: `SUM(G${dataStart}:G${dataEnd})` };
  ws.getCell(`G${totalRow}`).numFmt = MONEY_FMT;
  for (const col of ["A", "B", "C", "D", "E", "F", "G", "H"]) {
    const c = ws.getCell(`${col}${totalRow}`);
    c.font = { bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBTOTAL_FILL } };
    c.border = { top: { style: "medium", color: { argb: "FF334155" } } };
  }

  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 1, showGridLines: false }];
}

// -- public entry ---------------------------------------------------

export async function buildFullInventoryCountWorkbook({
  account,
  since = DEFAULT_SINCE,
  capUnprocessed = DEFAULT_CAP,
}) {
  if (!account) throw new Error("[inventoryExportFull] account required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    throw new Error(`[inventoryExportFull] since must be YYYY-MM-DD (got ${since})`);
  }

  const supa = getServiceClient();

  const [catalog, priceHistoryRows, aliases, exclusions, draftSessions] = await Promise.all([
    fetchCatalog(supa, account),
    fetchPriceHistory(supa, account),
    fetchAliases(supa, account),
    fetchExclusions(supa, account),
    fetchDraftSessionCount(supa, account),
  ]);

  const processedUuidSet = new Set(
    priceHistoryRows
      .map((r) => r.source_or_invoice_id)
      .filter(Boolean)
      .map(String),
  );

  const { rows: lineItems, capped } = await fetchUnprocessedLineItems(
    supa, account, since, capUnprocessed, processedUuidSet,
  );

  const { rows, stats: mergeStats } = mergeToRows({
    catalog, priceHistoryRows, aliases, exclusions, lineItems,
  });

  // Group by tab.
  const byTab = new Map();
  for (const cat of CATEGORY_ORDER) byTab.set(cat, []);
  for (const row of rows) {
    const tab = CATEGORY_ORDER.includes(row.category) ? row.category : "Uncategorized";
    if (!byTab.has(tab)) byTab.set(tab, []);
    byTab.get(tab).push(row);
  }

  const activeTabs = [];
  for (const cat of CATEGORY_ORDER) {
    if ((byTab.get(cat) || []).length > 0) activeTabs.push(cat);
  }
  if ((byTab.get("Uncategorized") || []).length > 0) activeTabs.push("Uncategorized");

  const class3Count = rows.filter((r) => r.isNew).length;

  const wb = new ExcelJS.Workbook();
  wb.creator = "KitchFix Ops Hub";
  wb.created = new Date();

  addInstructionsTab(wb, {
    account,
    generatedAt: wb.created,
    itemTotal: rows.length,
    class3Count,
    activeTabs,
    draftSessions,
    cappedNotice: capped,
    sinceIso: since,
  });
  addSummaryTab(wb, activeTabs);
  for (const tab of activeTabs) addCategoryTab(wb, tab, byTab.get(tab));

  const safeAccount = account.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const filename = `${safeAccount}_Inventory_Count_Sheet.xlsx`;
  return {
    workbook: wb,
    filename,
    stats: {
      ...mergeStats,
      total_rows: rows.length,
      class3_rows: class3Count,
      unprocessed_line_items_pulled: lineItems.length,
      unprocessed_line_items_capped: capped,
      draft_sessions: draftSessions,
    },
  };
}
