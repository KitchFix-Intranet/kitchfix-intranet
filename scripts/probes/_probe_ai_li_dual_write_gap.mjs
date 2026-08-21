import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

console.log("=== Latest PG ai_line_items by created_at + per-account ===");
const accounts = ["STL - FL","STL - MO","CIN - OH","TXR - TX - H","TXR - TX - V","TXR - AZ","CIN - AZ","TBR - FL","TBJ - FL"];
for (const a of accounts) {
  const { data } = await supa.from("ai_line_items").select("created_at").eq("account_key", a).order("created_at", { ascending: false }).limit(1);
  console.log("  " + a.padEnd(18) + " latest_created_at=" + (data?.[0]?.created_at || "(no rows)"));
}

console.log();
console.log("=== Recent invoice_submissions WITH any line item check (last 7 days) ===");
const since = new Date(Date.now() - 7*86400*1000).toISOString();
const { data: subs } = await supa.from("invoice_submissions")
  .select("id, account_key, vendor_name, invoice_number, submitted_at, ai_scan_status, ai_scan_complete, is_historical")
  .gte("submitted_at", since)
  .eq("is_historical", false)
  .order("submitted_at", { ascending: false });
console.log("Recent submissions in 7d: " + (subs?.length || 0));

// For each, does it have ai_line_items rows in PG?
const ids = (subs || []).map((s) => s.id);
let lineCountByInv = new Map();
if (ids.length > 0) {
  // chunk to avoid url-length limits
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const { data: lis } = await supa.from("ai_line_items").select("invoice_uuid").in("invoice_uuid", chunk);
    for (const r of lis || []) lineCountByInv.set(r.invoice_uuid, (lineCountByInv.get(r.invoice_uuid) || 0) + 1);
  }
}
let scannedNoLines = 0;
let scannedWithLines = 0;
const noLinesByDay = new Map();
for (const s of subs || []) {
  if (s.ai_scan_status === "complete" || s.ai_scan_complete === true) {
    const c = lineCountByInv.get(s.id) || 0;
    if (c === 0) {
      scannedNoLines++;
      const d = String(s.submitted_at).slice(0, 10);
      const k = d + "::" + s.account_key;
      noLinesByDay.set(k, (noLinesByDay.get(k) || 0) + 1);
    } else scannedWithLines++;
  }
}
console.log("Scan complete WITH PG ai_line_items: " + scannedWithLines);
console.log("Scan complete WITHOUT PG ai_line_items (gap): " + scannedNoLines);
console.log();
if (scannedNoLines > 0) {
  console.log("Per-day per-account gap (scan complete, 0 ai_line_items in PG):");
  for (const [k, c] of [...noLinesByDay.entries()].sort()) {
    console.log("  " + k + " : " + c + " invoice(s) missing PG line items");
  }
}

// Now check ONE specific recent invoice that's missing in PG to verify
console.log();
console.log("=== Sample missing invoices ===");
let shown = 0;
for (const s of subs || []) {
  if (s.ai_scan_status === "complete" && (lineCountByInv.get(s.id) || 0) === 0) {
    console.log("  acct=" + s.account_key + " vendor=" + s.vendor_name + " inv=" + s.invoice_number + " submitted=" + s.submitted_at + " id=" + s.id);
    shown++;
    if (shown >= 8) break;
  }
}
