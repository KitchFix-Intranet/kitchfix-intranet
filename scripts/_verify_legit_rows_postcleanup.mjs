// READ-ONLY: confirm the legitimate correct-client_uuid Sheets rows are
// still present for the 12 invoices whose wrong-uuid rows were just cleaned.
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

// The 12 PG IDs and their expected pre-existing correct-uuid row counts
// (taken from the dry-run output's "Sheets rows with RIGHT uuid" column)
const EXPECTED = [
  { pgId: "1b7c0799-b42c-4dc6-bc7e-983ad22ef6b9", tab: "TBR - FL", expected: 0, label: "Cheney Brothers 06-910802140" },
  { pgId: "9714e1ba-e373-4916-8c26-e7272b0f1204", tab: "TBR - FL", expected: 0, label: "Cheney Brothers 06-910802155" },
  { pgId: "62827688-1e33-4b0a-9f33-11ba7e03a4ad", tab: "TXR - AZ", expected: 2, label: "inreach I707380" },
  { pgId: "28897118-5eb3-4bbc-8a97-68bbafcb8691", tab: "CIN - AZ", expected: 5, label: "Cozzini c21237979" },
  { pgId: "af62aa76-c87c-4e68-800f-e2d2d578e3a5", tab: "CIN - AZ", expected: 16, label: "Alsco LPHO2188004" },
  { pgId: "beb39c29-2c61-4df3-839c-50152c62a6bd", tab: "CIN - AZ", expected: 1, label: "Peddler's Son 2454591" },
  { pgId: "89bad712-df5c-486f-8ebb-b0ac8f9b5458", tab: "CIN - AZ", expected: 4, label: "Peddler's Son 2454588" },
  { pgId: "a08563df-5801-4f95-80b6-ebdda9a2f057", tab: "CIN - AZ", expected: 1, label: "Shamrock 36630914" },
  { pgId: "124558b3-cef9-4b7b-b3c5-af213e3cbe45", tab: "CIN - AZ", expected: 1, label: "Shamrock 36630913" },
  { pgId: "52cfe1be-1f7c-4a3b-b242-64a352946dcd", tab: "CIN - AZ", expected: 33, label: "Shamrock 36635903" },
  { pgId: "8e78f4d9-8870-4a21-b9ae-5262b7f6cd5c", tab: "CIN - AZ", expected: 2, label: "Shamrock 36630911" },
  { pgId: "c7f59548-995e-4757-905b-7501858eedff", tab: "CIN - AZ", expected: 2, label: "Shamrock 36635904" },
];

// Resolve each PG id -> client_uuid (the canonical lookup field used by the orchestrator)
console.log("Resolving PG ids -> client_uuid via invoice_submissions...");
for (const e of EXPECTED) {
  const { data, error } = await supa
    .from("invoice_submissions")
    .select("client_uuid")
    .eq("id", e.pgId)
    .maybeSingle();
  if (error || !data) {
    console.log(`  ABORT for ${e.pgId.slice(0,8)}: ${error?.message || "no row"}`);
    process.exit(1);
  }
  e.clientUuid = data.client_uuid;
}

// Read each unique tab once
const tabsToRead = [...new Set(EXPECTED.map((e) => e.tab))];
const tabRows = new Map();
for (const tab of tabsToRead) {
  const res = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: AI_LINE_ITEMS_SHEET,
    range: `'${tab}'!A:A`,
  });
  tabRows.set(tab, res.data.values || []);
}

// Per-target verification
console.log("");
console.log("Legit client_uuid row counts post-cleanup:");
console.log("");
console.log(`  ${"tab".padEnd(14)} ${"client_uuid".padEnd(12)} ${"label".padEnd(28)} ${"expect".padStart(7)} ${"actual".padStart(7)}  status`);
console.log(`  ${"─".repeat(14)} ${"─".repeat(12)} ${"─".repeat(28)} ${"─".repeat(7)} ${"─".repeat(7)}  ──`);
let allPassed = true;
for (const e of EXPECTED) {
  const rows = tabRows.get(e.tab) || [];
  const actual = rows.filter((r, i) => i > 0 && String(r[0] || "").trim() === e.clientUuid).length;
  const ok = actual === e.expected;
  if (!ok) allPassed = false;
  console.log(`  ${e.tab.padEnd(14)} ${e.clientUuid.slice(0,8) + ".."} ${e.label.padEnd(28)} ${String(e.expected).padStart(7)} ${String(actual).padStart(7)}  ${ok ? "✓" : "✗ MISMATCH"}`);
}
console.log("");
console.log(allPassed
  ? "ALL PASS - legitimate correct-uuid rows present at expected counts (cleanup left them untouched)."
  : "FAIL - one or more expected row counts are off. Manual review needed.");
