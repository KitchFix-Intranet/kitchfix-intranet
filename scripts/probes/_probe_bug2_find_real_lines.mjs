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
// Find the actual ai_line_items rows that produced the cross-vendor dups,
// so the live Claude repro uses real input not invented strings.
import { readSheetSA, SHEET_IDS } from "@/lib/sheets";

const AI_LI_IDX = {
  invoiceUuid: 0, timestamp: 1, account: 2, vendor: 3, invoiceNumber: 4,
  invoiceDate: 5, lineNum: 6, description: 7, quantity: 8, unit: 9,
  unitPrice: 10, extendedPrice: 11, category: 12,
};

// Cases to look up: (account_tab, dup_vendor, dup_created, keyword)
const cases = [
  { tab: "CIN - OH",      vendor: "Sysco",              created: "2026-04-18", key: /garlic.*peel|peeled.*garlic/i },
  { tab: "STL - MO",      vendor: "Kuna Foodservice",   created: "2026-06-03", key: /pepper.*bell.*red|bell.*pepper.*red/i },
  { tab: "TXR - TX - H",  vendor: "Freshpoint",         created: "2026-04-21", key: /banana.*green|romaine.*heart/i },
  { tab: "TBJ - FL",      vendor: "Gordon Food Service",created: "2026-05-14", key: /apple.*juice|100%.*apple/i },
];

for (const c of cases) {
  console.log("=============================================================");
  console.log(c.tab + " | vendor='" + c.vendor + "' | created≈" + c.created + " | " + c.key);
  console.log("=============================================================");
  let data;
  try {
    data = await readSheetSA(SHEET_IDS.AI_LINE_ITEMS, c.tab);
  } catch (e) {
    console.log("  read failed: " + e.message);
    continue;
  }
  const rows = data.rows || [];
  const hits = rows.filter((r) => {
    const v = String(r[AI_LI_IDX.vendor] || "");
    const ts = String(r[AI_LI_IDX.timestamp] || "");
    const desc = String(r[AI_LI_IDX.description] || "");
    if (!v.toLowerCase().includes(c.vendor.toLowerCase())) return false;
    if (!ts.startsWith(c.created.slice(0, 7))) return false; // same month
    if (!c.key.test(desc)) return false;
    return true;
  });
  console.log("hits: " + hits.length);
  for (const r of hits.slice(0, 6)) {
    console.log("  ts=" + r[AI_LI_IDX.timestamp] +
                "  vendor=\"" + r[AI_LI_IDX.vendor] + "\"" +
                "  inv=" + r[AI_LI_IDX.invoiceNumber] +
                "  desc=\"" + r[AI_LI_IDX.description] + "\"" +
                "  qty=" + r[AI_LI_IDX.quantity] +
                "  unit=" + r[AI_LI_IDX.unit] +
                "  price=" + r[AI_LI_IDX.unitPrice] +
                "  cat=" + r[AI_LI_IDX.category]);
  }
  console.log();
}
process.exit(0);
