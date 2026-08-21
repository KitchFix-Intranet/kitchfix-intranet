// ════════════════════════════════════════════════════════════════════════════
// PROBE: vendor volume + line-item concentration census
//
// READ-ONLY. No writes anywhere.
//
// PURPOSE
//   Feed the hybrid-extraction architecture decision. Per vendor over a
//   configurable lookback window:
//     - invoice count (and breakdown by type: invoice / credit / cc_receipt)
//     - line-item count
//     - % of total line items + cumulative %
//     - vendor_id (resolved via vendors table lookup)
//     - representative invoice number + Drive URL (most-recent non-credit)
//
//   Then: how many vendors cover 80% / 90% / 95% / 99% of line items.
//   That number tells us how many per-vendor extraction profiles the
//   hybrid actually needs.
//
// SOURCES (Sheets-only — no PG creds required):
//   - COLLECTION/invoice_submissions_26 — the master invoice index
//   - AI_LINE_ITEMS/<per-account-tab> — line-item store, one tab per account
//
// USAGE
//   node --import ./scripts/_setup/register-aliases.mjs \
//        --env-file=.env.local scripts/_probe_vendor_volume.mjs
//
//   Args:
//     --days=90      lookback window in days (default 90)
//     --top=15       number of vendors to surface in the top-N table (default 15)
//     --accounts="STL - MO,..." restrict ai_line_items reads to specific account
//                    tabs. If omitted, auto-discovers all tabs from
//                    AI_LINE_ITEMS (slower but complete).
// ════════════════════════════════════════════════════════════════════════════

import { safeRead, SHEET_IDS, getServiceAccountSheetsClient } from "../../src/lib/sheets.js";

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=", 2)[1];
  return fallback;
}
const LOOKBACK_DAYS = parseInt(getArg("days", "90"), 10);
const TOP_N         = parseInt(getArg("top",  "15"), 10);
const ACCOUNT_OVERRIDE = (getArg("accounts", "") || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

// invoice_submissions_26 column indices (src/lib/dataStore/invoice.js SUB_IDX)
const SUB_IDX = {
  uuid:          0,
  timestamp:     1,
  vendor:        4,
  vendorId:      5,
  invoiceNumber: 6,
  invoiceDate:   7,
  driveUrls:    10,
  type:         15,
  rawDriveUrl:  16,
};

// ai_line_items per-account row indices (cron parses these at index.js:309-315)
const ALI_INVOICE_UUID = 0;

function normalizeVendor(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

// ── 1. Read invoice_submissions_26, filter to window ──
console.log(`[probe] lookback=${LOOKBACK_DAYS}d  top=${TOP_N}`);
console.log("[probe] reading COLLECTION/invoice_submissions_26 ...");
const { rows: subRows } = await safeRead(SHEET_IDS.COLLECTION, "invoice_submissions_26");
console.log(`[probe] ${subRows.length} total invoice_submissions rows`);

const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
const recentSubs = subRows.filter((r) => {
  const ts = String(r[SUB_IDX.timestamp] || "").trim();
  return ts >= cutoff;
});
console.log(`[probe] within last ${LOOKBACK_DAYS}d: ${recentSubs.length} submissions`);
console.log("");

// ── 2. Build submap (uuid → submission record) ──
const submap = new Map();
for (const r of recentSubs) {
  const u = String(r[SUB_IDX.uuid] || "").trim();
  if (!u) continue;
  submap.set(u, {
    vendor:        String(r[SUB_IDX.vendor]        || "").trim(),
    vendorId:      String(r[SUB_IDX.vendorId]      || "").trim(),
    type:          String(r[SUB_IDX.type]          || "invoice").trim() || "invoice",
    invoiceNumber: String(r[SUB_IDX.invoiceNumber] || "").trim(),
    invoiceDate:   String(r[SUB_IDX.invoiceDate]   || "").trim(),
    timestamp:     String(r[SUB_IDX.timestamp]     || "").trim(),
    rawDriveUrl:   String(r[SUB_IDX.rawDriveUrl]   || "").trim(),
    driveUrls:     String(r[SUB_IDX.driveUrls]     || "").trim(),
  });
}

// ── 3. Per-vendor INVOICE-level aggregation (from invoice_submissions alone) ──
const byVendor = new Map();  // normVendor → { display, vendorId, invoices, byType, lineItems, mostRecent }
for (const [, sub] of submap) {
  const v = normalizeVendor(sub.vendor);
  if (!v) continue;
  if (!byVendor.has(v)) {
    byVendor.set(v, {
      display: sub.vendor,
      vendorId: sub.vendorId || "",
      invoices: 0,
      byType: {},
      lineItems: 0,
      mostRecent: null,
    });
  }
  const b = byVendor.get(v);
  b.invoices++;
  b.byType[sub.type] = (b.byType[sub.type] || 0) + 1;
  if (!b.vendorId && sub.vendorId) b.vendorId = sub.vendorId;
  // Track most-recent NON-CREDIT submission as the representative example
  if (sub.type !== "credit") {
    if (!b.mostRecent || sub.timestamp > b.mostRecent.timestamp) {
      b.mostRecent = sub;
    }
  }
}

// ── 4. Discover account tabs in AI_LINE_ITEMS (or use --accounts override) ──
let accountTabs;
if (ACCOUNT_OVERRIDE.length > 0) {
  accountTabs = ACCOUNT_OVERRIDE;
  console.log(`[probe] using --accounts override: ${accountTabs.length} tab(s)`);
} else {
  console.log("[probe] auto-discovering AI_LINE_ITEMS account tabs ...");
  const sheets = getServiceAccountSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_IDS.AI_LINE_ITEMS });
  const allTabs = (meta.data.sheets || []).map((s) => s.properties?.title || "").filter(Boolean);
  const skipTabs = new Set(["Invoice Uploads", "Sheet1", "_metadata"]);
  accountTabs = allTabs.filter((t) => !skipTabs.has(t) && !t.startsWith("_"));
  console.log(`[probe] discovered ${accountTabs.length} account tab(s)`);
}
console.log("");

// ── 5. Read each account tab, count line items per (joined-by-uuid) vendor ──
console.log("[probe] reading AI_LINE_ITEMS per-account tabs to count line items ...");
let totalLineItemsAll = 0;
let totalLineItemsNonCredit = 0;
const totalsByType = {};

for (const acct of accountTabs) {
  let liRows = [];
  try {
    const r = await safeRead(SHEET_IDS.AI_LINE_ITEMS, acct);
    liRows = r.rows || [];
  } catch (e) {
    console.warn(`[probe]   WARN read failed for "${acct}": ${e.message}`);
    continue;
  }
  let inWindow = 0;
  for (const r of liRows) {
    const u = String(r[ALI_INVOICE_UUID] || "").trim();
    const sub = submap.get(u);
    if (!sub) continue;  // outside lookback window
    inWindow++;
    totalLineItemsAll++;
    totalsByType[sub.type] = (totalsByType[sub.type] || 0) + 1;
    if (sub.type !== "credit") {
      totalLineItemsNonCredit++;
      const v = normalizeVendor(sub.vendor);
      if (byVendor.has(v)) {
        byVendor.get(v).lineItems++;
      }
    }
  }
  if (inWindow > 0) {
    console.log(`[probe]   ${acct.padEnd(28)} ${String(inWindow).padStart(5)} line items in window`);
  }
}
console.log("");
console.log(`[probe] total line items in window (all types): ${totalLineItemsAll}`);
console.log(`[probe] total line items NON-CREDIT (= what hybrid extraction handles): ${totalLineItemsNonCredit}`);
console.log("");

// ── 6. Compute rankings + concentration ──
const ranked = [...byVendor.entries()]
  .filter(([, b]) => b.lineItems > 0)
  .sort((a, b) => b[1].lineItems - a[1].lineItems);

let cumulative = 0;
const cumByRank = [];
for (const [, b] of ranked) {
  cumulative += b.lineItems;
  cumByRank.push(cumulative / totalLineItemsNonCredit);
}

function findThreshold(pct) {
  for (let i = 0; i < cumByRank.length; i++) {
    if (cumByRank[i] >= pct) return i + 1;
  }
  return cumByRank.length;
}
const n80 = findThreshold(0.80);
const n90 = findThreshold(0.90);
const n95 = findThreshold(0.95);
const n99 = findThreshold(0.99);

// ── 7. Print breakdown by type ──
console.log("═".repeat(100));
console.log("BREAKDOWN BY TYPE (line items in window)");
console.log("═".repeat(100));
const totalByType = Object.values(totalsByType).reduce((a, b) => a + b, 0);
for (const [type, n] of Object.entries(totalsByType).sort((a, b) => b[1] - a[1])) {
  const pct = totalByType > 0 ? (n / totalByType * 100).toFixed(1) : "0.0";
  console.log(`  ${type.padEnd(14)} ${String(n).padStart(7)}   ${pct.padStart(5)}%`);
}
console.log("");

// ── 8. Print top-N vendor ranking ──
console.log("═".repeat(120));
console.log(`TOP ${TOP_N} VENDORS BY LINE-ITEM VOLUME (NON-CREDIT, last ${LOOKBACK_DAYS}d)`);
console.log("═".repeat(120));
console.log("rank  invoices  line_items   %total   cum%    vendor                                  vendor_id");
console.log("─".repeat(120));
const topN = ranked.slice(0, TOP_N);
let topShare = 0;
for (let i = 0; i < topN.length; i++) {
  const [, b] = topN[i];
  const pct = (b.lineItems / totalLineItemsNonCredit * 100).toFixed(1);
  const cum = (cumByRank[i] * 100).toFixed(1);
  topShare += b.lineItems;
  const typeBits = Object.entries(b.byType).map(([k, n]) => `${k}=${n}`).join(",");
  console.log(`${String(i + 1).padStart(4)}  ${String(b.invoices).padStart(8)}  ${String(b.lineItems).padStart(10)}   ${pct.padStart(5)}%  ${cum.padStart(5)}%   ${b.display.slice(0, 38).padEnd(38)}  ${b.vendorId || "(none)"}`);
  if (typeBits) console.log(`                                                    type breakdown: ${typeBits}`);
}
console.log("─".repeat(120));
console.log(`top ${TOP_N} cover ${(topShare / totalLineItemsNonCredit * 100).toFixed(1)}% of non-credit line items`);
console.log("");

// ── 9. Concentration curve ──
console.log("═".repeat(100));
console.log("CONCENTRATION — how many vendors cover X% of NON-CREDIT line items");
console.log("═".repeat(100));
console.log(`  80% of line items: top ${n80} vendor(s)`);
console.log(`  90% of line items: top ${n90} vendor(s)`);
console.log(`  95% of line items: top ${n95} vendor(s)`);
console.log(`  99% of line items: top ${n99} vendor(s)`);
console.log(`  total vendors with at least one line item: ${ranked.length}`);
console.log("");

// ── 10. Top-N representative-invoice list (copy-friendly URLs) ──
console.log("═".repeat(120));
console.log(`REPRESENTATIVE INVOICES FOR THE TOP ${TOP_N} (most-recent non-credit per vendor)`);
console.log("═".repeat(120));
console.log("Use these for the manual STRUCTURE CATALOG pass — open each URL, eyeball the layout.");
console.log("");
for (let i = 0; i < topN.length; i++) {
  const [, b] = topN[i];
  const r = b.mostRecent;
  if (!r) {
    console.log(`#${i + 1}  ${b.display}`);
    console.log(`     (no non-credit invoice found in window — this vendor only issued credits?)`);
    console.log("");
    continue;
  }
  // Prefer rawDriveUrl (unstamped); fall back to first entry in driveUrls
  let url = r.rawDriveUrl;
  if (!url && r.driveUrls) {
    try {
      const parsed = JSON.parse(r.driveUrls);
      if (Array.isArray(parsed) && parsed.length > 0) url = parsed[0];
      else if (typeof parsed === "string") url = parsed;
    } catch {
      url = r.driveUrls.split(/[,\s]+/)[0] || "";
    }
  }
  const pct = (b.lineItems / totalLineItemsNonCredit * 100).toFixed(1);
  console.log(`#${i + 1}  ${b.display}    (${b.lineItems} line items, ${pct}% of volume)`);
  console.log(`     invoice#:   ${r.invoiceNumber || "(empty)"}`);
  console.log(`     date:       ${r.invoiceDate || "(empty)"}    submitted: ${r.timestamp.slice(0, 19)}`);
  console.log(`     vendor_id:  ${b.vendorId || "(none)"}`);
  console.log(`     drive URL:  ${url || "(no URL)"}`);
  console.log("");
}

console.log("═".repeat(100));
console.log("done.");
console.log("");
console.log("INTERPRETATION:");
console.log("  - 'top 80%' = how many per-vendor profiles cover the bulk; everything beyond goes to generic+queue.");
console.log("  - A flat curve (lots of vendors needed for 80%) = generic-prompt-heavy approach.");
console.log("  - A steep curve (few vendors needed for 80%) = profile-heavy approach with a thin generic tail.");
