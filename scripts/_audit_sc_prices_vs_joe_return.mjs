// Compare Joe's returned v3 FINAL (1222).xlsx against sc_service_prices.
// Joe filled in the Billing Price column directly (not Action Required).
// For every row: find PG service by (account, group, service) name match,
// compare PG latest-effective billing price to Joe's billing price.
// Generate INSERT statements for any difference, with effective_date today.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const TODAY = "2026-06-17";
const joeRows = JSON.parse(readFileSync("/tmp/joe_return.json", "utf-8"));

// Cosmetic name normalization to match the diff we found in Sub-1:
// xlsx may spell "Coffee Service" / "Fountain Bev" without the
// "(tax-free)" suffix PG carries. Try the bare name, then with suffix.
function svcNameVariants(name) {
  return [name, `${name} (tax-free)`, name.replace(/\s+/g, " ")];
}

const { data: groups } = await supa.from("sc_service_groups")
  .select("id, account_key, group_name").is("deleted_at", null);
const { data: services } = await supa.from("sc_services")
  .select("id, account_key, group_id, service_name, is_flat_fee, is_non_revenue, active").is("deleted_at", null);

const groupNameById = new Map((groups || []).map((g) => [g.id, g.group_name]));
const svcByKey = new Map();
for (const s of services || []) {
  const grp = groupNameById.get(s.group_id) || "?";
  svcByKey.set(`${s.account_key}::${grp}::${s.service_name}`, { ...s, group: grp });
}
const svcIds = (services || []).map((s) => s.id);

// Pull all prices, latest per service_id
const allPrices = [];
let from = 0; const PAGE = 1000;
while (true) {
  const { data, error } = await supa.from("sc_service_prices")
    .select("service_id, price, effective_date")
    .in("service_id", svcIds)
    .order("effective_date", { ascending: false })
    .range(from, from + PAGE - 1);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) break;
  allPrices.push(...data);
  if (data.length < PAGE) break;
  from += PAGE;
}
const latestPriceBySvcId = new Map();
for (const r of allPrices) {
  if (!latestPriceBySvcId.has(r.service_id)) {
    latestPriceBySvcId.set(r.service_id, { price: Number(r.price), date: r.effective_date });
  }
}

// Audit
const matches = [];
const mismatches = [];
const xlsxMissingFromPg = [];

for (const j of joeRows) {
  let svc = null;
  for (const variant of svcNameVariants(j.service)) {
    const k = `${j.account}::${j.group}::${variant}`;
    if (svcByKey.has(k)) { svc = svcByKey.get(k); break; }
  }
  if (!svc) {
    // Try case-insensitive fallback
    for (const [k, v] of svcByKey.entries()) {
      const [a, g, s] = k.split("::");
      if (a === j.account && g === j.group && s.toLowerCase() === j.service.toLowerCase()) {
        svc = v; break;
      }
    }
  }
  if (!svc) {
    xlsxMissingFromPg.push(j);
    continue;
  }
  const pg = latestPriceBySvcId.get(svc.id);
  const pgPrice = pg ? pg.price : null;
  const joePrice = j.billing_price;
  if (joePrice == null) { matches.push({ j, svc, pg, status: "no-joe-price" }); continue; }
  const xlsxR = Math.round(joePrice * 100) / 100;
  const pgR = pgPrice != null ? Math.round(pgPrice * 100) / 100 : null;
  if (xlsxR === pgR) {
    matches.push({ j, svc, pg, status: "match" });
  } else {
    mismatches.push({ j, svc, pgPrice, pgDate: pg?.date, status: "mismatch" });
  }
}

// PG services Joe didn't include
const xlsxKeys = new Set(joeRows.map((j) => `${j.account}::${j.group}::${j.service}`));
const xlsxKeysWithSuffix = new Set();
for (const j of joeRows) for (const v of svcNameVariants(j.service)) xlsxKeysWithSuffix.add(`${j.account}::${j.group}::${v}`);
const pgMissingFromXlsx = [];
for (const s of services || []) {
  const k = `${s.account_key}::${groupNameById.get(s.group_id)}::${s.service_name}`;
  if (!xlsxKeysWithSuffix.has(k)) pgMissingFromXlsx.push({ ...s, group: groupNameById.get(s.group_id) });
}

// Reports
console.log("══════ JOE'S RETURN vs PG ══════\n");
console.log(`Joe priced ${joeRows.length} services`);
console.log(`  matches PG latest:       ${matches.filter(m => m.status === "match").length}`);
console.log(`  mismatch (NEEDS UPDATE): ${mismatches.length}`);
console.log(`  no price provided:       ${matches.filter(m => m.status === "no-joe-price").length}`);
console.log(`  xlsx service not in PG:  ${xlsxMissingFromPg.length}`);
console.log(`  PG service not in xlsx:  ${pgMissingFromXlsx.length}\n`);

if (mismatches.length) {
  console.log("══════ PRICE MISMATCHES (need UPDATE) ══════");
  console.log("Account       Group                  Service                       PG price  Joe price  PG eff_date");
  console.log("------------- ---------------------- ---------------------------- --------  ---------  -----------");
  for (const m of mismatches) {
    console.log(`${m.j.account.padEnd(13)} ${(m.j.group || "").slice(0,22).padEnd(22)} ${m.j.service.slice(0,28).padEnd(28)} $${String(m.pgPrice ?? "none").padEnd(7)} $${String(m.j.billing_price).padEnd(8)} ${m.pgDate || "no-row"}`);
  }
}

if (xlsxMissingFromPg.length) {
  console.log("\n══════ JOE LISTED but NOT IN PG (decisions needed) ══════");
  for (const x of xlsxMissingFromPg) {
    console.log(`  ${x.account.padEnd(13)} ${(x.group || "").slice(0,22).padEnd(22)} ${x.service.padEnd(28)}  joe_billing=$${x.billing_price}  notes="${x.notes || ""}"`);
  }
}

if (pgMissingFromXlsx.length) {
  console.log("\n══════ PG SERVICES NOT IN JOE'S XLSX ══════");
  for (const p of pgMissingFromXlsx) {
    const pg = latestPriceBySvcId.get(p.id);
    console.log(`  ${p.account_key.padEnd(13)} ${(p.group || "").slice(0,22).padEnd(22)} ${p.service_name.padEnd(28)}  pg_price=$${pg?.price ?? "none"}  active=${p.active}`);
  }
}

// SQL generation
if (mismatches.length) {
  console.log("\n══════ SQL: UPSERT statements for mismatches (effective_date='2026-06-17') ══════");
  console.log(`-- Run after merging PR #165 (upsert support). These mirror the live config-editor write path.`);
  console.log(`-- IMPORTANT: Review every row first. Notably the CIN-AZ MLB Breakfast \$1 testing edit will be undone by the matching row below if present.`);
  for (const m of mismatches) {
    const acct = m.j.account.replace(/'/g, "''");
    const grp = (m.j.group || "").replace(/'/g, "''");
    const svc = m.svc.service_name.replace(/'/g, "''");
    console.log(`INSERT INTO sc_service_prices (service_id, price, effective_date, created_by, notes) VALUES`);
    console.log(`  ((SELECT id FROM sc_services WHERE account_key='${acct}' AND group_id=(SELECT id FROM sc_service_groups WHERE account_key='${acct}' AND group_name='${grp}' AND deleted_at IS NULL) AND service_name='${svc}' AND deleted_at IS NULL),`);
    console.log(`   ${m.j.billing_price}, '${TODAY}', 'joe-review-2026-06-17', 'v3 FINAL price review')`);
    console.log(`  ON CONFLICT (service_id, effective_date) DO UPDATE SET price=EXCLUDED.price, notes=EXCLUDED.notes;`);
  }
}
