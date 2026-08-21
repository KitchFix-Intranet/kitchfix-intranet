// ════════════════════════════════════════════════════════════════════════════
// PROBE: invoice AI-scan status + line item count for a single submission
//
// READ-ONLY. No --execute flag, no writes ever.
//
// PURPOSE
//   After submitting a real invoice (in prod, on a preview, or via the
//   rescan canary), confirm the AI scan completed cleanly:
//     - ai_scan_status='complete' AND ai_line_items_count > 0  → healthy
//     - ai_scan_status='complete' AND ai_line_items_count = 0  → SILENT GAP
//       (the pre-PR-#129 bug pattern; should not happen for invoices
//        submitted post-merge of fix/ai-scan-status-conditional-complete)
//     - ai_scan_status='failed'                                → loud failure
//       (loud-but-no-actor today; alarm follow-up will surface these)
//
// USAGE
//   By client_uuid (the user-facing one from the submit URL):
//     node --import ./scripts/_setup/register-aliases.mjs \
//          --env-file=.env.local scripts/_probe_invoice_status.mjs \
//          --uuid=<client_uuid>
//
//   By PG submission.id (the FK in ai_line_items.invoice_uuid):
//     node ... scripts/_probe_invoice_status.mjs --uuid=<pg_id>
//
//   The script tries client_uuid first, then falls back to id.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
function getArg(name) {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=", 2)[1];
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return null;
}

const UUID = getArg("uuid");
if (!UUID) {
  console.error("[probe] --uuid required (either client_uuid or PG submission.id)");
  process.exit(2);
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[probe] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(2);
}
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SELECT = "id, client_uuid, account_key, vendor_name, invoice_number, invoice_date, total_amount, page_count, status, ai_scan_status, ai_scan_complete, submitted_at, is_historical";

let sub;
{
  const byClient = await supa.from("invoice_submissions").select(SELECT).eq("client_uuid", UUID).maybeSingle();
  if (byClient.data) sub = byClient.data;
  else {
    const byId = await supa.from("invoice_submissions").select(SELECT).eq("id", UUID).maybeSingle();
    if (byId.data) sub = byId.data;
  }
}
if (!sub) {
  console.error(`[probe] no row found for uuid="${UUID}" (tried client_uuid then id)`);
  process.exit(1);
}

const { count: aliCount, error: aliErr } = await supa
  .from("ai_line_items")
  .select("id", { count: "exact", head: true })
  .eq("invoice_uuid", sub.id);
if (aliErr) {
  console.error(`[probe] ai_line_items count failed: ${aliErr.message}`);
  process.exit(1);
}

console.log({
  pg_id:               sub.id,
  client_uuid:         sub.client_uuid,
  account_key:         sub.account_key,
  vendor:              sub.vendor_name,
  invoice_number:      sub.invoice_number,
  invoice_date:        sub.invoice_date,
  total_amount:        sub.total_amount,
  page_count:          sub.page_count,
  status:              sub.status,
  ai_scan_status:      sub.ai_scan_status,
  ai_scan_complete:    sub.ai_scan_complete,
  submitted_at:        (sub.submitted_at || "").slice(0, 19),
  is_historical:       sub.is_historical,
  ai_line_items_count: aliCount || 0,
});

const status = sub.ai_scan_status;
const count = aliCount || 0;
console.log("");
if (status === "complete" && count > 0) {
  console.log("✓ healthy: ai_scan_status='complete' WITH line items");
} else if (status === "complete" && count === 0) {
  console.log("⚠ SILENT GAP: complete but 0 line items (pre-PR-#129 bug pattern)");
} else if (status === "failed") {
  console.log(`✗ failed: ai_scan_status='failed', ${count} line items`);
} else if (status === null || status === undefined) {
  console.log("⏳ scan not yet run (or fire-and-forget still in flight)");
} else {
  console.log(`? unclear: status=${status}, line items=${count}`);
}
