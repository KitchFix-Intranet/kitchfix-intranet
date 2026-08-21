// READ-ONLY: count rows in each dugout Sheets tab to size the migration.
import { google } from "googleapis";

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });

// IDs from src/lib/sheets.js (look up if needed). I'll resolve them via
// the existing SHEET_IDS export through a dynamic import.
const { SHEET_IDS } = await import("../src/lib/sheets.js");

const tabs = [
  { spreadsheet: "HUB",        name: "HUB__Performance_Chain" },
  { spreadsheet: "HUB",        name: "HUB__Cycle_Calendar" },
  { spreadsheet: "HUB",        name: "HUB__Performance_System_Config" },
  { spreadsheet: "HUB",        name: "ldug_library_manifest" },
  { spreadsheet: "COLLECTION", name: "COLL__WOW_Plans_Header" },
  { spreadsheet: "COLLECTION", name: "COLL__WOW_Plans_Body" },
  { spreadsheet: "COLLECTION", name: "COLL__Performance_Audit_Log" },
  { spreadsheet: "COLLECTION", name: "COLL__Cycle_Review_Header" },
  { spreadsheet: "COLLECTION", name: "COLL__Cycle_Review_Body" },
  { spreadsheet: "COLLECTION", name: "COLL__Scorecards" },
];

console.log("Dugout Sheets tab row counts:");
console.log("");
console.log(`  ${"spreadsheet".padEnd(12)}  ${"tab".padEnd(36)}  ${"rows".padStart(6)}  ${"cols".padStart(5)}`);
console.log(`  ${"─".repeat(12)}  ${"─".repeat(36)}  ${"─".repeat(6)}  ${"─".repeat(5)}`);
for (const t of tabs) {
  const id = SHEET_IDS[t.spreadsheet];
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: t.name });
    const rows = res.data.values || [];
    const headerRow = rows[0] || [];
    const dataRows = rows.slice(1).filter((r) => r.some((c) => String(c || "").trim().length > 0));
    console.log(`  ${t.spreadsheet.padEnd(12)}  ${t.name.padEnd(36)}  ${String(dataRows.length).padStart(6)}  ${String(headerRow.length).padStart(5)}`);
  } catch (e) {
    console.log(`  ${t.spreadsheet.padEnd(12)}  ${t.name.padEnd(36)}  ${"ERR".padStart(6)}  ${e.message.slice(0, 60)}`);
  }
}
