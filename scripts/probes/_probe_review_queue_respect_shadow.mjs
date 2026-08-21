// ════════════════════════════════════════════════════════════════════════════
// PROBE: simulate the PR A shadow-tally for review-queue-respect.
//
// READ-ONLY. Mirrors the gate-check + dedup-key logic in index.js to compute
// what the SHADOW mode of CRON_REVIEW_QUEUE_RESPECT would emit on the next
// cron run. No API calls, no DB writes.
//
// Reads: review_queue (for pendingQueueKeys + resolvedInvoiceUuids),
//        price_history (for processedInvoices), and ai_line_items per-account
//        (for the lines the cron would test).
// ════════════════════════════════════════════════════════════════════════════

import { safeRead, SHEET_IDS } from "../../src/lib/sheets.js";

// Match cron index.js exactly. ai_line_items columns: 0..12 used by cron.
const LI = { uuid: 0, account: 2, vendor: 3, invoiceNumber: 4, lineNum: 6, description: 7, quantity: 8, unit: 9, unitPrice: 10, extendedPrice: 11 };
// review_queue columns: shapes.QUEUE_COLS order.
const Q = { queueId: 0, lineItemText: 1, vendor: 2, invoiceUuid: 3, invoiceDate: 4, account: 5, status: 9, reason: 13 };
// price_history columns (from index.js:478): col 1 = account, col 5 = invoiceUuid.
const PH = { account: 1, invoiceUuid: 5 };

function accountMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.startsWith(b + " -") || b.startsWith(a + " -");
}
function arithmeticCheck(qty, unit, ext) {
  const calc = (Number(qty) || 0) * (Number(unit) || 0);
  const e = Number(ext) || 0;
  const tol = 0.02 * Math.abs(e) + 0.01;
  return Math.abs(calc - e) <= tol;
}

const { rows: queueRows } = await safeRead(SHEET_IDS.INVENTORY, "review_queue");
const { rows: priceRows } = await safeRead(SHEET_IDS.INVENTORY, "price_history");

console.log("=".repeat(100));
console.log("REVIEW-QUEUE-RESPECT SHADOW SIMULATION (read-only, no writes)");
console.log("=".repeat(100));
console.log(`Loaded: review_queue=${queueRows.length}, price_history=${priceRows.length}\n`);

// Get list of accounts that have ai_line_items rows (from the price_history account col)
const accountSet = new Set();
for (const r of queueRows) if (r[Q.account]) accountSet.add(r[Q.account]);
for (const r of priceRows) if (r[PH.account]) accountSet.add(r[PH.account]);
const accounts = [...accountSet].filter(Boolean).sort();

const grandTotals = { resolvedInvoices: 0, resolvedLines: 0, wouldSuppress: 0, accountsWithSuppression: 0 };

const headerFmt = (h) => h.padEnd(16);
console.log(headerFmt("account") + headerFmt("queue/pend") + headerFmt("resolvedUuid") + headerFmt("would-skip") + headerFmt("would-suppress"));
console.log("-".repeat(80));

for (const account of accounts) {
  // Build pendingQueueKeys + resolvedInvoiceUuids exactly as the cron does
  const pendingQueueKeys = new Set();
  const resolvedInvoiceUuids = new Set();
  let pendingCount = 0;
  for (const r of queueRows) {
    if (!accountMatch(r[Q.account], account)) continue;
    const uuid = String(r[Q.invoiceUuid] || "").trim();
    if (!uuid) continue;
    const status = String(r[Q.status] || "").trim().toLowerCase();
    if (status && status !== "pending") {
      resolvedInvoiceUuids.add(uuid);
    } else {
      const lineText = String(r[Q.lineItemText] || "").trim();
      pendingQueueKeys.add(`${uuid}::${lineText}`);
      pendingCount++;
    }
  }

  // processedInvoices (Sheets-only - matches cron's sheetsProcessedInvoices)
  const processedInvoices = new Set(
    priceRows.filter((r) => accountMatch(r[PH.account], account)).map((r) => r[PH.invoiceUuid])
  );

  // Read ai_line_items for the account (the cron's source-of-truth tab name = account)
  const { rows: liRows } = await safeRead(SHEET_IDS.AI_LINE_ITEMS, account);
  const lineItems = liRows.map((r) => ({
    invoiceUuid: r[LI.uuid] || "",
    vendor: r[LI.vendor] || "",
    description: r[LI.description] || "",
    quantity: parseFloat(r[LI.quantity]) || 0,
    unitPrice: parseFloat(r[LI.unitPrice]) || 0,
    extendedPrice: parseFloat(r[LI.extendedPrice]) || 0,
  }));

  // newItems filter (matches cron index.js:497)
  const newItems = lineItems.filter((li) => !processedInvoices.has(li.invoiceUuid));

  // Behavior 1: would-skip-resolved (today expected 0 since no row is non-pending)
  const resolvedHits = newItems.filter((li) => resolvedInvoiceUuids.has(li.invoiceUuid));
  const resolvedInvoiceSet = new Set(resolvedHits.map((li) => li.invoiceUuid));

  // Behavior 2: would-suppress-requeue. Simulate gate fail on remaining newItems.
  // (The actual cron also has the wouldPromote filter, but for shadow estimation
  // every gate-fail in this set would re-fire as arithmetic_fail and the cron
  // would re-queue it - which is exactly the duplicate the guard suppresses.)
  let wouldSuppressCount = 0;
  let gateFailCount = 0;
  for (const li of newItems) {
    if (resolvedInvoiceUuids.has(li.invoiceUuid)) continue; // already skipped by behavior 1
    if (!arithmeticCheck(li.quantity, li.unitPrice, li.extendedPrice)) {
      gateFailCount++;
      const key = `${li.invoiceUuid}::${li.description}`;
      if (pendingQueueKeys.has(key)) wouldSuppressCount++;
    }
  }

  console.log(
    account.padEnd(16) +
    `${pendingCount}`.padEnd(16) +
    `${resolvedInvoiceUuids.size}`.padEnd(16) +
    `${resolvedInvoiceSet.size}inv/${resolvedHits.length}line`.padEnd(16) +
    `${wouldSuppressCount}/${gateFailCount}gate-fail`
  );

  grandTotals.resolvedInvoices += resolvedInvoiceSet.size;
  grandTotals.resolvedLines    += resolvedHits.length;
  grandTotals.wouldSuppress    += wouldSuppressCount;
  if (wouldSuppressCount > 0) grandTotals.accountsWithSuppression++;
}

console.log("-".repeat(80));
console.log("\nTOTALS (expected shadow output on next cron run):");
console.log(`   resolved-status respect: WOULD skip ${grandTotals.resolvedInvoices} resolved invoice(s), ${grandTotals.resolvedLines} line(s)`);
console.log(`   re-queue dedup guard:    WOULD suppress ${grandTotals.wouldSuppress} duplicate append(s) across ${grandTotals.accountsWithSuppression} account(s)`);
console.log("");
console.log("Today's resolved-respect should be 0 (no row has been resolved yet). The would-suppress");
console.log("count should be substantial (the chronic-fail balloon the recon found).");
