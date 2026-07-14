// READ-ONLY: dump PG effective-dated per-service prices for a 2026 mid-year
// service date (2026-07-01). Mirrors the LATERAL JOIN the sc_daily_revenue
// view uses: latest sc_service_prices row where price_kind='projected'
// AND effective_date <= service_date.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const SERVICE_DATE = "2026-07-01";

async function main() {
  // Pull all services + all sc_service_prices; join per (service_id) taking
  // the latest projected-kind price with effective_date <= SERVICE_DATE.
  const { data: services, error: sErr } = await supa
    .from("sc_services")
    .select("id, account_key, service_name, is_flat_fee, is_tax_free, is_non_revenue, active, group_id, sc_service_groups(group_name)")
    .order("account_key")
    .order("service_name");
  if (sErr) throw new Error(sErr.message);

  const { data: prices, error: pErr } = await supa
    .from("sc_service_prices")
    .select("service_id, effective_date, price_kind, price")
    .lte("effective_date", SERVICE_DATE)
    .order("effective_date", { ascending: false });
  if (pErr) throw new Error(pErr.message);

  const latestProj = new Map();
  for (const p of prices) {
    if (p.price_kind !== "projected") continue;
    if (!latestProj.has(p.service_id)) latestProj.set(p.service_id, p);
  }

  const rows = [];
  for (const s of services) {
    const p = latestProj.get(s.id);
    rows.push({
      account: s.account_key,
      group: s.sc_service_groups?.group_name || null,
      service_name: s.service_name,
      is_flat_fee: s.is_flat_fee,
      is_tax_free: s.is_tax_free,
      is_non_revenue: s.is_non_revenue,
      active: s.active,
      effective_date: p?.effective_date || null,
      pg_price: p?.price != null ? Number(p.price) : null,
    });
  }
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
