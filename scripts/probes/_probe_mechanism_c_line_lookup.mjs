// USAGE (path aliases required)
// This probe imports from the `@/…` path alias, which Node cannot resolve
// on its own. Run with the alias hook installed via `--import`:
//
//   node --env-file=.env.local \
//        --import ./scripts/probes/_at_alias_hook.mjs \
//        scripts/probes/<this-file>
//
// Running without --import fails at import time with
//   `Cannot find package '@/…'`
// which reads identically to a probe defect - added 2026-08-31 after
// PR #916 review named this as the sentinel-#4 root cause.
// Follow-up to mechanism C repro: the PG lookup found nothing in the
// 36-hour window around the newer row's creation. Hit Sheets ai_line_items
// for STL - MO directly to find what description Claude actually received.
import { readSheetSA, SHEET_IDS } from "@/lib/sheets";

const TARGET_ACCOUNT = "STL - MO";
const NEWER_DATE = "2026-06-03T21:08:25.955Z";

const AI_LI_IDX = {
  invoiceUuid: 0, timestamp: 1, account: 2, vendor: 3, invoiceNumber: 4,
  invoiceDate: 5, lineNum: 6, description: 7, quantity: 8, unit: 9,
  unitPrice: 10, extendedPrice: 11, category: 12,
};

const data = await readSheetSA(SHEET_IDS.AI_LINE_ITEMS, TARGET_ACCOUNT);
const rows = data.rows || [];
console.log("Total ai_line_items rows in Sheets tab '" + TARGET_ACCOUNT + "': " + rows.length);

// Find any line mentioning chia (case-insensitive)
const chiaRows = rows.filter((r) => /chia/i.test(String(r[AI_LI_IDX.description] || "")));
console.log("Rows w/ 'chia' in description: " + chiaRows.length);

const newerTs = new Date(NEWER_DATE).getTime();
const ONE_DAY = 24 * 3600 * 1000;
const candidates = chiaRows.filter((r) => {
  const t = new Date(String(r[AI_LI_IDX.timestamp] || "")).getTime();
  if (Number.isNaN(t)) return false;
  return Math.abs(t - newerTs) < ONE_DAY;
});

console.log("Rows w/ 'chia' within 24h of newer row's creation:");
for (const r of candidates) {
  console.log("  ts=" + r[AI_LI_IDX.timestamp] + "  invoice=" + (r[AI_LI_IDX.invoiceUuid]||"").slice(0,8) +
    "  vendor=\"" + r[AI_LI_IDX.vendor] + "\"  desc=\"" + r[AI_LI_IDX.description] + "\"  qty=" + r[AI_LI_IDX.quantity] +
    " " + r[AI_LI_IDX.unit] + "  $" + r[AI_LI_IDX.unitPrice]);
}

console.log();
console.log("All chia rows in this account tab (any date) - sorted newest first:");
const sorted = [...chiaRows].sort((a, b) => String(b[AI_LI_IDX.timestamp]).localeCompare(String(a[AI_LI_IDX.timestamp]))).slice(0, 10);
for (const r of sorted) {
  console.log("  ts=" + r[AI_LI_IDX.timestamp] + "  invoice=" + (r[AI_LI_IDX.invoiceUuid]||"").slice(0,8) +
    "  vendor=\"" + r[AI_LI_IDX.vendor] + "\"  desc=\"" + r[AI_LI_IDX.description] + "\"");
}

process.exit(0);
