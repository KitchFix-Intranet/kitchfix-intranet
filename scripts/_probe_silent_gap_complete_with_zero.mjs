// READ-ONLY: investigate the 6 invoices the weekend cron recon flagged as
// ai_scan_complete=TRUE but 0 ai_line_items. Question: pre-fix residue, or
// live regression after #138+#144?
//
// PR #138 (visibility) merged 2026-06-12T16:45 UTC
// pr-9-1 applied            2026-06-12T17:57 UTC
// PR #139 (re-sequence)      2026-06-12 evening
// PR #144 (retry + capture) merged 2026-06-12 evening
// PR #145 (max_tokens 16k)  merged today 2026-06-15
//
// Any submission AFTER ~2026-06-12T18:00 UTC ran on the post-fix pipeline.
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
const sheetsApi = google.sheets({ version: "v4", auth: sheetsAuth });
const AI_LINE_ITEMS_SHEET = "18mTWaeodOpFVmDSNRkGpNZvCrNWqHxVv3qN8r1b2REo";

const TARGETS = [
  "feaa166c", // Fresh Point STL-FL submitted 6/13 - POST #144
  "f460d3b6", // Shamrock STL-FL submitted 6/13 - POST #144
  "f66ea99a", // Cheney TBJ-FL submitted 6/11 - PRE #138 (~)
  "fb3bce8e", // Sysco TBJ-FL submitted 6/8 - PRE all fixes
  "f40e322e", // Sysco TBJ-FL submitted 6/8 - PRE all fixes
  "56836db2", // Cheney TBJ-FL submitted 6/8 - PRE all fixes
];

// The fix-merge timestamp on main per git history
const POST_FIX_CUTOFF = "2026-06-12T18:00:00Z";

console.log("════════════════════════════════════════════════════════════════════");
console.log("  6 invoices flagged by cron recon (ai_scan_complete=TRUE, 0 line items)");
console.log("════════════════════════════════════════════════════════════════════");
console.log("");

// Resolve each target
const resolved = [];
for (const prefix of TARGETS) {
  const { data } = await supa
    .from("invoice_submissions")
    .select("id, client_uuid, account_key, vendor_name, invoice_number, submitted_at, ai_scan_status, ai_scan_complete, ai_scan_error, is_historical, status, type, raw_drive_url, page_count")
    .eq("is_historical", false);
  const match = (data || []).find((r) => String(r.client_uuid).startsWith(prefix));
  if (!match) { console.log(`  ${prefix}: NOT FOUND in invoice_submissions`); continue; }
  resolved.push(match);
}

console.log("Resolved invoices:");
console.log("");
console.log(`  ${"uuid".padEnd(10)} ${"submitted_at".padEnd(20)} ${"account".padEnd(12)} ${"vendor".padEnd(20)} ${"ai_scan_status".padEnd(14)} ${"complete?".padStart(10)} ${"sub.status".padStart(11)} ${"pre/post fix"}`);
console.log(`  ${"-".repeat(10)} ${"-".repeat(20)} ${"-".repeat(12)} ${"-".repeat(20)} ${"-".repeat(14)} ${"-".repeat(10)} ${"-".repeat(11)} ${"-".repeat(12)}`);
for (const s of resolved) {
  const eraTag = s.submitted_at >= POST_FIX_CUTOFF ? "POST-FIX ⚠" : "pre-fix";
  console.log(`  ${s.client_uuid.slice(0,8)}.. ${s.submitted_at.slice(0,19)}  ${s.account_key.padEnd(12)} ${(s.vendor_name||"").slice(0,20).padEnd(20)} ${(s.ai_scan_status||"(null)").padEnd(14)} ${String(s.ai_scan_complete).padStart(10)} ${(s.status||"?").padStart(11)} ${eraTag}`);
}

// For each: count PG ai_line_items + Sheets ai_line_items
console.log("");
console.log("Line-item count verification (PG + Sheets):");
console.log("");
console.log(`  ${"uuid".padEnd(10)} ${"PG count".padStart(8)} ${"Sheets count".padStart(13)} ${"ai_scan_error".padEnd(40)}  observation`);
console.log(`  ${"-".repeat(10)} ${"-".repeat(8)} ${"-".repeat(13)} ${"-".repeat(40)}  ──`);

// Pre-read all Sheets tabs we need
const accountKeys = [...new Set(resolved.map((s) => s.account_key))];
const sheetsCache = new Map();
for (const tab of accountKeys) {
  try {
    const res = await sheetsApi.spreadsheets.values.get({
      spreadsheetId: AI_LINE_ITEMS_SHEET,
      range: `'${tab}'!A:A`,
    });
    sheetsCache.set(tab, res.data.values || []);
  } catch (e) {
    sheetsCache.set(tab, []);
    console.log(`  (tab "${tab}" read failed: ${e.message})`);
  }
}

for (const s of resolved) {
  const { count: pgCount } = await supa
    .from("ai_line_items")
    .select("*", { count: "exact", head: true })
    .eq("invoice_uuid", s.id);
  const tabRows = sheetsCache.get(s.account_key) || [];
  const sheetsCount = tabRows.filter((r, i) => i > 0 && String(r[0] || "").trim() === s.client_uuid).length;

  let obs = "";
  if (pgCount === 0 && sheetsCount === 0) obs = "TRUE silent gap (both stores empty)";
  else if (pgCount === 0 && sheetsCount > 0) obs = `recon STALE on PG (Sheets has ${sheetsCount})`;
  else if (pgCount > 0 && sheetsCount === 0) obs = `recon STALE on Sheets (PG has ${pgCount})`;
  else obs = "recon SNAPSHOT was stale (both stores populated)";

  const errStr = (s.ai_scan_error || "").slice(0, 38);
  console.log(`  ${s.client_uuid.slice(0,8)}.. ${String(pgCount).padStart(8)} ${String(sheetsCount).padStart(13)} ${errStr.padEnd(40)}  ${obs}`);
}

// Verification check: was ai_scan_status actually 'complete' for these?
console.log("");
console.log("Status drilldown (the recon claims ai_scan_complete=TRUE; is it?):");
for (const s of resolved) {
  // ai_scan_complete is a GENERATED column = (ai_scan_status = 'complete')
  // So ai_scan_complete=TRUE means ai_scan_status='complete'
  const actuallyComplete = s.ai_scan_status === "complete" && s.ai_scan_complete === true;
  console.log(`  ${s.client_uuid.slice(0,8)}..  ai_scan_status="${s.ai_scan_status}"  ai_scan_complete=${s.ai_scan_complete}  -> recon's claim is ${actuallyComplete ? "ACCURATE" : "STALE"}`);
}

console.log("");
console.log("Done.");
