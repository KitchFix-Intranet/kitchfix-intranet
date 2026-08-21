// Preview-only: pull Drive links for catch-weight invoices + WCW comparison
// so the recon includes eye-verifiable samples.
import { createClient } from "@supabase/supabase-js";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function sampleVendor(vendor, label) {
  console.log("===== " + label + " (" + vendor + ") =====");
  const { data } = await supa.from("ai_line_items")
    .select("invoice_uuid, description, quantity, unit, unit_price, extended_price, raw_json")
    .eq("vendor_name", vendor)
    .gte("created_at", "2026-05-01")
    .gt("extended_price", 100)
    .lt("unit_price", 30)
    .or("description.ilike.%BEEF%,description.ilike.%PORK%,description.ilike.%CHICKEN%,description.ilike.%LAMB%")
    .order("created_at", { ascending: false })
    .limit(3);
  if (!data || data.length === 0) { console.log("  (no samples)"); return; }
  const uuids = [...new Set(data.map((r) => r.invoice_uuid))];
  const { data: subs } = await supa.from("invoice_submissions")
    .select("id, invoice_number, vendor_id, raw_drive_url, submitted_at, account_key")
    .in("id", uuids);
  const driveByUuid = new Map();
  const submetaByUuid = new Map();
  for (const s of subs || []) {
    driveByUuid.set(s.id, s.raw_drive_url);
    submetaByUuid.set(s.id, s);
  }
  for (const r of data) {
    const meta = submetaByUuid.get(r.invoice_uuid);
    const reconc = Math.abs((Number(r.quantity)||0) * (Number(r.unit_price)||0) - (Number(r.extended_price)||0)) < 0.02 * Math.abs(Number(r.extended_price)||0) + 0.01;
    console.log("  desc: \"" + r.description + "\"");
    console.log("    qty=" + r.quantity + " " + r.unit + "  up=$" + r.unit_price + "  amt=$" + r.extended_price + "  math " + (reconc ? "OK" : "FAILS"));
    if (!reconc) console.log("    implied_weight = " + (Number(r.extended_price)/Number(r.unit_price)).toFixed(2));
    console.log("    raw_json keys: [" + Object.keys(r.raw_json || {}).join(", ") + "]");
    console.log("    invoice #" + (meta?.invoice_number || "?") + " | account=" + (meta?.account_key || "?"));
    console.log("    drive: " + (driveByUuid.get(r.invoice_uuid) || "(no URL)"));
  }
}

await sampleVendor("Sysco", "FAILING - catch-weight beef");
await sampleVendor("Ben E Keith", "FAILING - catch-weight protein");
await sampleVendor("What Chefs Want", "WORKING - the gold standard");
await sampleVendor("Gordon Food Service", "TBD - prompt covers GFS Total Weight");
await sampleVendor("Cheney Brothers", "TBD - prompt covers Cheney F4 WEIGHT column");

process.exit(0);
