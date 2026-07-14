// READ-ONLY probe for the pricing-summit evidence PR.
// Dumps sc_service_prices, sc_fee_schedule, sc_services in markdown-table
// format suitable for pasting into evidence docs.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function md(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "✓" : "";
  if (typeof v === "number") return String(v);
  return String(v).replace(/\|/g, "\\|");
}

async function dumpTable(name, orderCols, columnList = "*") {
  const q = supa.from(name).select(columnList);
  for (const c of orderCols) q.order(c, { ascending: true });
  const { data, error } = await q;
  if (error) throw new Error(`${name}: ${error.message}`);
  console.log(`\n## ${name} (${data.length} rows)\n`);
  if (data.length === 0) { console.log(`(empty)`); return; }
  const cols = Object.keys(data[0]);
  console.log(`| ${cols.join(" | ")} |`);
  console.log(`| ${cols.map(() => "---").join(" | ")} |`);
  for (const r of data) console.log(`| ${cols.map(c => md(r[c])).join(" | ")} |`);
  return data;
}

async function dumpAccounts() {
  const { data, error } = await supa
    .from("accounts")
    .select("team_key, name, level, billing_model, has_homestand_schedule, has_schedule_overlay, active")
    .order("team_key", { ascending: true });
  if (error) throw new Error(`accounts: ${error.message}`);
  console.log(`\n## accounts (${data.length} rows)\n`);
  const cols = Object.keys(data[0]);
  console.log(`| ${cols.join(" | ")} |`);
  console.log(`| ${cols.map(() => "---").join(" | ")} |`);
  for (const r of data) console.log(`| ${cols.map(c => md(r[c])).join(" | ")} |`);
}

async function dumpPricesJoined() {
  // Join sc_service_prices to sc_services + accounts for readable table.
  const { data, error } = await supa
    .from("sc_services")
    .select("id, account_key, group_id, service_name, is_flat_fee, is_tax_free, is_non_revenue, active, sc_service_prices(effective_date, price_kind, price)")
    .order("account_key", { ascending: true })
    .order("service_name", { ascending: true });
  if (error) throw new Error(`sc_services join: ${error.message}`);
  console.log(`\n## sc_service_prices (joined via sc_services)\n`);
  console.log(`| account_key | service | is_flat_fee | is_tax_free | is_non_revenue | active | effective_date | price_kind | price |`);
  console.log(`| --- | --- | --- | --- | --- | --- | --- | --- | --- |`);
  for (const s of data) {
    const prices = s.sc_service_prices || [];
    if (prices.length === 0) {
      console.log(`| ${s.account_key} | ${s.service_name} | ${md(s.is_flat_fee)} | ${md(s.is_tax_free)} | ${md(s.is_non_revenue)} | ${md(s.active)} | — | — | — |`);
    } else {
      for (const p of prices.sort((a,b) => (a.effective_date || "").localeCompare(b.effective_date || ""))) {
        console.log(`| ${s.account_key} | ${s.service_name} | ${md(s.is_flat_fee)} | ${md(s.is_tax_free)} | ${md(s.is_non_revenue)} | ${md(s.active)} | ${md(p.effective_date)} | ${md(p.price_kind)} | ${md(p.price)} |`);
      }
    }
  }
}

async function main() {
  console.log("READ-ONLY :: pricing-summit PG dump");
  console.log(`Generated ${new Date().toISOString()}`);

  await dumpAccounts();
  await dumpTable("sc_fee_schedule", ["account_key", "effective_date"]);
  await dumpPricesJoined();
}

main().catch((e) => { console.error(e); process.exit(1); });
