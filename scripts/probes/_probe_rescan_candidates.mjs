// Find rescan-canary candidates: status=failed/null, PG=0 AND Sheets=0.
// These are invoices the original throw happened on BEFORE
// insertAILineItemsSheets ran (= no Sheets duplicates blocking the rescan).
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
const sheetsAuth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth: sheetsAuth });
const AI_LINE_ITEMS = "18mTWaeodOpFVmDSNRkGpNZvCrNWqHxVv3qN8r1b2REo";

// Get all live failed/null status invoices with 0 PG line items
const PAGE = 1000;
let subs = [];
for (let off = 0; ; off += PAGE) {
  const { data, error } = await supa
    .from("invoice_submissions")
    .select("id, client_uuid, account_key, vendor_name, invoice_number, submitted_at, ai_scan_status, raw_drive_url")
    .eq("is_historical", false)
    .or("ai_scan_status.eq.failed,ai_scan_status.is.null")
    .range(off, off + PAGE - 1);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) break;
  subs = subs.concat(data);
  if (data.length < PAGE) break;
}

// PG line item counts per sub.id
const pgLineCountBySubId = new Map();
for (let off = 0; ; off += PAGE) {
  const { data, error } = await supa.from("ai_line_items").select("invoice_uuid").range(off, off + PAGE - 1);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) break;
  for (const r of data) pgLineCountBySubId.set(r.invoice_uuid, (pgLineCountBySubId.get(r.invoice_uuid) || 0) + 1);
  if (data.length < PAGE) break;
}

// Read each per-account Sheets tab once
async function readTabUuids(tab) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: AI_LINE_ITEMS,
      range: `'${tab}'!A:A`,
    });
    const rows = res.data.values || [];
    const m = new Map();
    for (let i = 1; i < rows.length; i++) {
      const u = String(rows[i][0] || "").trim();
      if (!u) continue;
      m.set(u, (m.get(u) || 0) + 1);
    }
    return m;
  } catch (e) {
    return new Map();
  }
}
const tabs = ["STL - FL","STL - MO","CIN - OH","TXR - TX - H","TXR - TX - V","TXR - AZ","CIN - AZ","TBR - FL","TBJ - FL"];
const sheetsByTab = new Map();
for (const t of tabs) sheetsByTab.set(t, await readTabUuids(t));

// Now classify
const candidates_zero_zero = [];
const has_sheets_no_pg    = [];
for (const s of subs) {
  const pgN = pgLineCountBySubId.get(s.id) || 0;
  if (pgN > 0) continue;
  const sheetsN = sheetsByTab.get(s.account_key)?.get(s.client_uuid) || 0;
  if (sheetsN === 0) candidates_zero_zero.push({ ...s, pgN, sheetsN });
  else has_sheets_no_pg.push({ ...s, pgN, sheetsN });
}

console.log(`Live failed/null invoices with PG=0:           ${candidates_zero_zero.length + has_sheets_no_pg.length}`);
console.log(`  - PG=0 AND Sheets=0 (RESCAN CANDIDATES):     ${candidates_zero_zero.length}`);
console.log(`  - PG=0 AND Sheets>0 (canary would abort):    ${has_sheets_no_pg.length}`);
console.log("");
console.log("RESCAN CANDIDATES (PG=0 AND Sheets=0):");
console.log("");
const sham = candidates_zero_zero.filter((s) => /shamrock/i.test(s.vendor_name || ""));
const ped  = candidates_zero_zero.filter((s) => /peddler/i.test(s.vendor_name || ""));
const sysco = candidates_zero_zero.filter((s) => /sysco/i.test(s.vendor_name || ""));
const others = candidates_zero_zero.filter((s) => !sham.includes(s) && !ped.includes(s) && !sysco.includes(s));

console.log(`Shamrock candidates (most relevant for failure-pattern): ${sham.length}`);
for (const s of sham) {
  console.log(`  ${s.client_uuid.slice(0,8)}  ${s.account_key}  "${s.vendor_name}"  inv#=${s.invoice_number}  submitted=${s.submitted_at}  status=${s.ai_scan_status}  drive=${s.raw_drive_url ? "y" : "MISSING"}`);
}
console.log("");
console.log(`Peddler's Son candidates: ${ped.length}`);
for (const s of ped) {
  console.log(`  ${s.client_uuid.slice(0,8)}  ${s.account_key}  "${s.vendor_name}"  inv#=${s.invoice_number}  submitted=${s.submitted_at}  status=${s.ai_scan_status}  drive=${s.raw_drive_url ? "y" : "MISSING"}`);
}
console.log("");
console.log(`Sysco candidates: ${sysco.length}`);
for (const s of sysco) {
  console.log(`  ${s.client_uuid.slice(0,8)}  ${s.account_key}  "${s.vendor_name}"  inv#=${s.invoice_number}  submitted=${s.submitted_at}  status=${s.ai_scan_status}  drive=${s.raw_drive_url ? "y" : "MISSING"}`);
}
console.log("");
console.log(`Other-vendor candidates: ${others.length}`);
for (const s of others.slice(0, 10)) {
  console.log(`  ${s.client_uuid.slice(0,8)}  ${s.account_key}  "${s.vendor_name}"  inv#=${s.invoice_number}  submitted=${s.submitted_at}  status=${s.ai_scan_status}  drive=${s.raw_drive_url ? "y" : "MISSING"}`);
}
