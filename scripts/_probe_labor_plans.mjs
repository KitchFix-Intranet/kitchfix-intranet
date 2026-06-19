#!/usr/bin/env node
// One-off read-only probe: dump labor_plans + homestand_schedule shape so we
// can determine whether actuals exist and the crossAccount computation just
// isn't finding them, or actuals are truly absent.
//
// Usage:
//   node --env-file=.env.local scripts/_probe_labor_plans.mjs

import "dotenv/config";
import { google } from "googleapis";

const COLLECTION = "1itJh5x1YFBdyHTBr-dyKD_r_nRBfjwIBiR_bWiOyCzQ";
const HUB = "1rvIg9trPCxiEWvzrYbtp1j7V_sbtQnKaysv5BOwA90E";

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

async function dump(spreadsheetId, range, label) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];
  console.log(`\n=== ${label} (${range}) ===`);
  console.log(`Total rows (incl header): ${rows.length}`);
  if (rows.length === 0) return rows;
  console.log("Header row:", rows[0]);
  if (rows.length > 1) {
    console.log("First 3 data rows:");
    rows.slice(1, 4).forEach((r, i) => console.log(`  Row ${i + 2}: [${r.length} cols]`, r));
  }
  if (rows.length > 4) {
    console.log("Last 2 data rows:");
    rows.slice(-2).forEach((r) => console.log(`  Row :`, r));
  }
  return rows;
}

const planRows = await dump(COLLECTION, "labor_plans!A:Z", "labor_plans (COLLECTION)");
const scheduleRows = await dump(HUB, "homestand_schedule!A:M", "homestand_schedule (HUB)");
const budgetRows = await dump(HUB, "labor_budgets!A:H", "labor_budgets (HUB)");

// Per-account breakdown of labor_plans
console.log("\n=== labor_plans per account ===");
const planCounts = {};
const accountCol = 1; // best guess; will verify from header
for (let i = 1; i < planRows.length; i++) {
  const r = planRows[i];
  if (!r || !r[0]) continue;
  const acct = String(r[accountCol] || "(empty)").trim();
  planCounts[acct] = (planCounts[acct] || 0) + 1;
}
for (const acct of Object.keys(planCounts).sort()) {
  console.log(`  ${acct}: ${planCounts[acct]} rows`);
}

// Show any rows where ANY field after the first 5 cols is populated (likely actuals)
console.log("\n=== labor_plans rows with populated actuals (cols F+) ===");
let withActuals = 0;
for (let i = 1; i < planRows.length; i++) {
  const r = planRows[i];
  if (!r) continue;
  const hasActuals = r.slice(5).some((c) => c && String(c).trim() && String(c).trim() !== "0");
  if (hasActuals) {
    withActuals++;
    if (withActuals <= 5) console.log(`  Row ${i + 2}:`, r);
  }
}
console.log(`Total rows with populated actuals: ${withActuals}`);
