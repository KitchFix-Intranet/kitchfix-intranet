// Phase 4 Path B - fetch raw_drive_url for each bacon-exclusion invoice_uuid.
// Read-only on invoice_submissions.

import fs from "node:fs";
import { createClient } from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/@supabase/supabase-js/dist/index.mjs";
import dotenv from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/dotenv/lib/main.js";
dotenv.config({ path: "/Users/kevinfietek/dev/kitchfix-intranet/.env.local", quiet: true });

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const IN = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_path_b_targets.json";
const OUT = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_path_b_targets.json";
const t = JSON.parse(fs.readFileSync(IN, "utf8"));

const uuids = t.invoices.map((i) => i.invoice_uuid);
const { data, error } = await supa
  .from("invoice_submissions")
  .select("id, raw_drive_url, invoice_number, invoice_date, vendor_id, account_key, status")
  .in("id", uuids);
if (error) throw error;

const byId = new Map(data.map((r) => [r.id, r]));
let ok = 0, missing = 0;
for (const inv of t.invoices) {
  const s = byId.get(inv.invoice_uuid);
  if (s && s.raw_drive_url) {
    inv.raw_drive_url = s.raw_drive_url;
    inv.invoice_number = s.invoice_number;
    inv.status = s.status;
    ok += 1;
  } else {
    inv.raw_drive_url = null;
    inv.status = s ? s.status : "not_found";
    missing += 1;
  }
}
fs.writeFileSync(OUT, JSON.stringify(t, null, 2));
console.log(`[4-pathB-urls] ${ok} ok, ${missing} missing raw_drive_url`);
for (const inv of t.invoices) {
  console.log(`  ${inv.invoice_uuid} inv#=${inv.invoice_number} url=${inv.raw_drive_url ? "yes" : "MISSING"} status=${inv.status}`);
}
