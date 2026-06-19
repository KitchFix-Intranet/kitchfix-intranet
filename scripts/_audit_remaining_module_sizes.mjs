// READ-ONLY: count rows in each backing Sheets tab for the remaining roadmap items.
// Tells us which modules have real production data vs pilot/empty.
import { google } from "googleapis";
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });
const { SHEET_IDS } = await import("../src/lib/sheets.js");

// Map each remaining module to its backing tabs.
const modules = [
  // Labor (Season Planner) - lives in /api/ops, writes to COLLECTION
  { module: "Labor",            spreadsheet: "COLLECTION", tab: "labor_plans" },
  { module: "Labor",            spreadsheet: "COLLECTION", tab: "labor_sold_revenue" },
  { module: "Labor",            spreadsheet: "COLLECTION", tab: "deep_clean_days" },
  { module: "Labor",            spreadsheet: "HUB",        tab: "labor_projections" },
  { module: "Labor",            spreadsheet: "HUB",        tab: "labor_actuals" },
  // Legacy monthly inventory count (/ops InventoryTool, NOT Smart Inventory)
  { module: "InventoryCount",   spreadsheet: "COLLECTION", tab: "inventory_submissions" },
  // Financial - currently proxies to /api/ops, so same data sources as Labor
  { module: "Financial",        spreadsheet: "HUB",        tab: "labor_projections" },
  // Service Calendar
  { module: "ServiceCalendar",  spreadsheet: "COLLECTION", tab: "sc_events" },
  { module: "ServiceCalendar",  spreadsheet: "COLLECTION", tab: "sc_overrides" },
  { module: "ServiceCalendar",  spreadsheet: "COLLECTION", tab: "sc_clickers" },
  { module: "ServiceCalendar",  spreadsheet: "HUB",        tab: "sc_config" },
  { module: "ServiceCalendar",  spreadsheet: "HUB",        tab: "sc_accounts" },
  // Incidents (people module)
  { module: "Incidents",        spreadsheet: "COLLECTION", tab: "Incidents" },
  // Module 8 (Railway cron) - intranet-side artifacts
  { module: "ModuleEight",      spreadsheet: "COLLECTION", tab: "notification_log" },
];

console.log("Backing-tab row counts (pilot vs production scale):");
console.log("");
console.log(`  ${"module".padEnd(18)}  ${"spreadsheet".padEnd(12)}  ${"tab".padEnd(28)}  ${"rows".padStart(7)}`);
console.log(`  ${"─".repeat(18)}  ${"─".repeat(12)}  ${"─".repeat(28)}  ${"─".repeat(7)}`);
for (const m of modules) {
  const id = SHEET_IDS[m.spreadsheet];
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: m.tab });
    const rows = (res.data.values || []).slice(1).filter((r) => r.some((c) => String(c || "").trim().length > 0));
    console.log(`  ${m.module.padEnd(18)}  ${m.spreadsheet.padEnd(12)}  ${m.tab.padEnd(28)}  ${String(rows.length).padStart(7)}`);
  } catch (e) {
    console.log(`  ${m.module.padEnd(18)}  ${m.spreadsheet.padEnd(12)}  ${m.tab.padEnd(28)}  ${"ERR".padStart(7)}  ${e.message.slice(0, 40)}`);
  }
}
