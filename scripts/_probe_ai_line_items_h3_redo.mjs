// H3 redo with correct UUID join: PG ai_line_items.invoice_uuid -> PG
// invoice_submissions.id -> invoice_submissions.client_uuid, THEN compare
// to Sheets col A (which is client_uuid).

import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
const sheetsAuth = new google.auth.GoogleAuth({
  credentials: { client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n") },
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth: sheetsAuth });
const AI_LINE_ITEMS = "18mTWaeodOpFVmDSNRkGpNZvCrNWqHxVv3qN8r1b2REo";

// Build the Sheets-side set of client_uuids (col A).
const tabsResp = await sheets.spreadsheets.get({ spreadsheetId: AI_LINE_ITEMS, fields: "sheets.properties.title" });
const tabs = (tabsResp.data.sheets || []).map((s) => s.properties.title);
const sheetsClientUuids = new Set();
for (const t of tabs) {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: AI_LINE_ITEMS, range: t });
  const rows = (r.data.values || []).slice(1);
  for (const row of rows) {
    const u = String(row?.[0] || "").trim();
    if (u) sheetsClientUuids.add(u);
  }
}
console.log(`Sheets distinct client_uuids: ${sheetsClientUuids.size}`);

// PG non-historical ai_line_items in last 30d with the join to client_uuid.
const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
const { data: recentPg, error } = await supa
  .from("ai_line_items")
  .select("invoice_uuid, line_num, created_at, invoice_submissions!inner(client_uuid)")
  .eq("is_historical", false)
  .gte("created_at", since)
  .order("created_at", { ascending: false })
  .limit(500);
if (error) { console.error(error.message); process.exit(1); }
console.log(`PG non-historical rows in last 30d: ${recentPg.length}${recentPg.length === 500 ? " (capped)" : ""}`);

let inSheets = 0, missingFromSheets = 0;
const missingSample = [];
for (const pg of recentPg) {
  const cu = pg.invoice_submissions?.client_uuid;
  if (cu && sheetsClientUuids.has(cu)) inSheets++;
  else {
    missingFromSheets++;
    if (missingSample.length < 15) missingSample.push({ ...pg, client_uuid: cu });
  }
}
console.log(`  Recent PG rows whose parent client_uuid IS in Sheets:   ${inSheets}`);
console.log(`  Recent PG rows whose parent client_uuid is NOT in Sheets: ${missingFromSheets}`);
if (missingSample.length > 0) {
  console.log("\n  Sample missing rows (post-correct-join):");
  for (const r of missingSample) {
    console.log(`    pg_id=${r.invoice_uuid}  client_uuid=${r.client_uuid || "(null)"}  line_num=${r.line_num}  created_at=${r.created_at}`);
  }
}
