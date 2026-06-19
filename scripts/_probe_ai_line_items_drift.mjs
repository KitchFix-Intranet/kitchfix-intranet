// READ-ONLY probe of the alarm's ai_line_items drift (PG 7575 vs Sheets 2965).
// No writes. Tests three hypotheses:
//   1. PG depth from Module 6 backfill (is_historical=TRUE)
//   2. Per-account Sheets tab counting quirk (cron trimming? unreadable tabs?
//      alarm undercounting?)
//   3. Recent PG writes outside the dual-write path

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

async function listTabs() {
  const res = await sheets.spreadsheets.get({ spreadsheetId: AI_LINE_ITEMS, fields: "sheets.properties.title" });
  return (res.data.sheets || []).map((s) => s.properties.title);
}
async function readTab(name) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: AI_LINE_ITEMS, range: name });
  const data = res.data.values || [];
  return { headers: data[0] || [], rows: data.slice(1) };
}

// ── HYPOTHESIS 1: PG depth split by is_historical ──
console.log("════════════════════════════════════════════════════════════════════");
console.log("  H1: PG ai_line_items by is_historical");
console.log("════════════════════════════════════════════════════════════════════");
const { count: pgTotal } = await supa.from("ai_line_items").select("*", { count: "exact", head: true });
const { count: pgHist } = await supa.from("ai_line_items").select("*", { count: "exact", head: true }).eq("is_historical", true);
const { count: pgLive } = await supa.from("ai_line_items").select("*", { count: "exact", head: true }).eq("is_historical", false);
console.log(`  PG total:            ${pgTotal}`);
console.log(`  PG is_historical=T:  ${pgHist}  (Module 6 backfill depth)`);
console.log(`  PG is_historical=F:  ${pgLive}  (live writes since Module 6 cutover 2026-06-03)`);
console.log("");

// ── HYPOTHESIS 2: Per-account Sheets read - what's actually there + readable? ──
console.log("════════════════════════════════════════════════════════════════════");
console.log("  H2: Per-account Sheets tabs - per-tab row counts");
console.log("════════════════════════════════════════════════════════════════════");
const tabs = await listTabs();
console.log(`  Total tabs in AI_LINE_ITEMS spreadsheet: ${tabs.length}`);
let sheetsSum = 0;
let readFails = 0;
const perTab = [];
for (const t of tabs) {
  try {
    const { rows } = await readTab(t);
    sheetsSum += rows.length;
    perTab.push({ tab: t, rows: rows.length, status: "ok" });
  } catch (e) {
    readFails++;
    perTab.push({ tab: t, rows: 0, status: `ERR: ${e.message.slice(0, 60)}` });
  }
}
console.log(`  Tabs read OK:  ${tabs.length - readFails}`);
console.log(`  Tabs failed:   ${readFails}`);
console.log(`  Sum of rows across all tabs: ${sheetsSum}`);
console.log("");
console.log("  Per-tab breakdown:");
for (const t of perTab.sort((a, b) => b.rows - a.rows)) {
  console.log(`    ${t.rows.toString().padStart(5)} rows  ${t.status === "ok" ? "OK " : "✗  "}  "${t.tab}"`);
}

// ── HYPOTHESIS 3: Recent PG writes (non-historical) whose invoice_uuid is NOT in Sheets ──
console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log("  H3: Recent non-historical PG rows vs Sheets presence");
console.log("════════════════════════════════════════════════════════════════════");
// Pull the most recent N non-historical PG rows; look up each invoice_uuid
// across the union of Sheets tabs to see whether it has a Sheets counterpart.
// "Recent" = created_at >= now() - 30 days, which is generous post-cutover.
const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
const { data: recentPg, error: e3 } = await supa
  .from("ai_line_items")
  .select("invoice_uuid, line_num, created_at")
  .eq("is_historical", false)
  .gte("created_at", since)
  .order("created_at", { ascending: false })
  .limit(500);
if (e3) { console.error(`PG recent query: ${e3.message}`); process.exit(1); }
console.log(`  PG non-historical rows in last 30d: ${recentPg.length}${recentPg.length === 500 ? " (capped at 500)" : ""}`);

// Build a Set of (invoice_uuid, line_num) from all readable Sheets tabs.
// AI_LINE_ITEMS per-account tab columns are (per cron): invoiceUuid[0], timestamp[1],
// account[2], vendor[3], invoiceNumber[4], invoiceDate[5], lineNum[6], ...
const sheetsKeys = new Set();
const sheetsUuids = new Set();
for (const { tab, status } of perTab) {
  if (status !== "ok") continue;
  try {
    const { rows } = await readTab(tab);
    for (const r of rows) {
      const uuid = String(r[0] || "").trim();
      const ln = String(r[6] || "").trim();
      if (uuid) sheetsUuids.add(uuid);
      if (uuid && ln) sheetsKeys.add(`${uuid}::${ln}`);
    }
  } catch { /* already counted as fail */ }
}
console.log(`  Distinct invoice_uuids across all Sheets tabs: ${sheetsUuids.size}`);
console.log(`  Distinct (uuid, line_num) pairs across all Sheets tabs: ${sheetsKeys.size}`);

let missingFromSheets = 0;
let missingUuidEntirely = 0;
const missingSample = [];
for (const pg of recentPg) {
  const key = `${pg.invoice_uuid}::${pg.line_num}`;
  if (!sheetsKeys.has(key)) {
    missingFromSheets++;
    if (!sheetsUuids.has(pg.invoice_uuid)) missingUuidEntirely++;
    if (missingSample.length < 10) missingSample.push(pg);
  }
}
console.log(`  Recent PG rows whose (uuid, line_num) is NOT in Sheets: ${missingFromSheets}`);
console.log(`     of those, whose invoice_uuid is NOT in Sheets at all: ${missingUuidEntirely}`);
if (missingSample.length > 0) {
  console.log("  Sample missing rows:");
  for (const r of missingSample) {
    console.log(`    invoice_uuid=${r.invoice_uuid}  line_num=${r.line_num}  created_at=${r.created_at}`);
  }
}
