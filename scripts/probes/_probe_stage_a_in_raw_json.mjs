// Does raw_json on the gap-invoice Sheets rows contain Stage A fields,
// or only the legacy field set? Determines whether the audit's NULL Stage A
// substitution is a faithful replay or a measurement artifact.
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

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
const AI_LINE_ITEMS = "18mTWaeodOpFVmDSNRkGpNZvCrNWqHxVv3qN8r1b2REo";

// Pick 5 gap invoices from different vendors / dates to see if Stage A
// fields are present in raw_json
const samples = [
  { prefix: "9ac6972b", vendor: "Shamrock Foods", tab: "CIN - AZ" }, // 2026-06-11 (large)
  { prefix: "f1d70f6b", vendor: "Shamrock Foods", tab: "CIN - AZ" }, // 2026-06-11
  { prefix: "47ee10c8", vendor: "Gordon Food Service", tab: "TBJ - FL" }, // 2026-06-10
  { prefix: "8586831c", vendor: "Peddler's Son", tab: "CIN - AZ" }, // 2026-06-11
  { prefix: "c11c78c5", vendor: "Sysco", tab: "TBR - FL" }, // 2026-06-01 (oldest in gap)
];

// Also check one CURRENTLY-SUCCEEDING invoice to compare
const successSamples = [
  { prefix: "c3139f92", vendor: "Cheney Brothers", tab: "STL - FL" }, // 2026-06-09 complete
];

const STAGE_A_FIELDS = ["itemNumber", "packSize", "orderedCount", "shippedCount", "uomRaw", "amount", "weightLineValue", "catchWeightMarker"];

async function check(s, label) {
  const { data: candidates } = await supa
    .from("invoice_submissions")
    .select("client_uuid, submitted_at")
    .eq("vendor_name", s.vendor)
    .eq("is_historical", false);
  const match = (candidates || []).find((c) => String(c.client_uuid).startsWith(s.prefix));
  if (!match) return;
  const fullUuid = match.client_uuid;

  const res = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: AI_LINE_ITEMS,
    range: `'${s.tab}'!A:O`,
  });
  const rows = (res.data.values || []).filter((r, i) => i > 0 && String(r[0] || "").trim() === fullUuid);
  if (rows.length === 0) return;

  // Look at raw_json (col 14) of first row
  let parsed;
  try { parsed = JSON.parse(rows[0][14] || "{}"); } catch { parsed = null; }
  const keys = parsed ? Object.keys(parsed).sort() : [];
  const hasStageA = STAGE_A_FIELDS.some((f) => keys.includes(f));
  const present = STAGE_A_FIELDS.filter((f) => keys.includes(f));

  console.log(`  ${label}  ${s.prefix}  ${s.vendor}  submitted=${(match.submitted_at || "").slice(0, 10)}`);
  console.log(`    raw_json keys (${keys.length}): ${keys.join(", ")}`);
  console.log(`    Stage A fields present: ${hasStageA ? present.join(", ") : "(none)"}`);
  console.log("");
}

console.log("Gap-invoice samples (PG=0, Sheets>0, status=failed/null):");
for (const s of samples) await check(s, "  GAP   ");
console.log("Currently-succeeding sample (status=complete, PG=N):");
for (const s of successSamples) await check(s, "  GOOD  ");
