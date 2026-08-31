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
// Read-only: list the tab names in the INVENTORY spreadsheet.
import { getServiceAccountSheetsClient, SHEET_IDS } from "@/lib/sheets";

const sheets = getServiceAccountSheetsClient();
const res = await sheets.spreadsheets.get({
  spreadsheetId: SHEET_IDS.INVENTORY,
  fields: "sheets(properties(title,sheetId))",
});

const tabs = (res.data.sheets || []).map((s) => ({
  title:   s.properties?.title,
  sheetId: s.properties?.sheetId,
}));

console.log("INVENTORY spreadsheet tabs (" + tabs.length + "):");
for (const t of tabs) {
  console.log("  - " + t.title);
}

console.log();
const target = "invoice_verifications";
const exists = tabs.some((t) => t.title === target);
console.log('Target check: tab named exactly "' + target + '" exists? ' + (exists ? "YES" : "NO"));
const closeMatches = tabs.filter((t) => t.title && t.title.toLowerCase().includes("verif"));
if (closeMatches.length > 0) {
  console.log("Close matches (containing 'verif'):");
  for (const t of closeMatches) console.log("  - " + t.title);
}

process.exit(0);
