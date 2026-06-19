// Audit sc_service_prices (latest effective_date per service) against
// the v3 FINAL Price Review xlsx 'Billing Price' column. Reports
// mismatches per account.
//
// Source of truth: /Users/kevinfietek/Downloads/KitchFix_Service_Calendar_Price_Review_v3_FINAL (1).xlsx
//   tab: "Service Price Review"
//   cols: A=Account Key  B=Group  C=Service  D=Full Rate  E=Billing Price
//
// Group section-header rows (e.g. "Billing: Per-Meal" / "Billing: Fee
// Account") have B set but C blank - skip them.
//
// Per-meal accounts: expected billing = E (cost basis, possibly with SF)
// Fee accounts:      expected billing = E (which is $0 by design)
// Flat-fee items:    expected billing = E (unchanged from source)

import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";

const XLSX = "/Users/kevinfietek/Downloads/KitchFix_Service_Calendar_Price_Review_v3_FINAL (1).xlsx";
const TMP_JSON = "/tmp/_v3final_prices.json";

// Inline Python helper - dump xlsx rows where col C (Service) is non-empty.
const helperPy = `
import json, sys, openpyxl
wb = openpyxl.load_workbook("${XLSX}", data_only=True)
ws = wb["Service Price Review"]
out = []
for r in range(2, ws.max_row + 1):
    acct = ws.cell(row=r, column=1).value
    grp  = ws.cell(row=r, column=2).value
    svc  = ws.cell(row=r, column=3).value
    full = ws.cell(row=r, column=4).value
    bill = ws.cell(row=r, column=5).value
    if not acct or not svc:
        continue
    out.append({"account": str(acct).strip(), "group": str(grp).strip(),
                "service": str(svc).strip(),
                "billing_price": float(bill) if bill is not None else None,
                "full_rate":     float(full) if full is not None else None})
json.dump(out, open(sys.argv[1], "w"))
print(f"dumped {len(out)} rows", file=sys.stderr)
`;
execFileSync("python3", ["-c", helperPy, TMP_JSON], { stdio: ["ignore", "inherit", "inherit"] });

const expected = JSON.parse(readFileSync(TMP_JSON, "utf-8"));
unlinkSync(TMP_JSON);

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Load groups + services + latest price per service
const ACCOUNTS = [...new Set(expected.map((e) => e.account))].sort();
console.error(`xlsx has ${expected.length} priced services across ${ACCOUNTS.length} accounts`);
console.error(`accounts: ${ACCOUNTS.join(", ")}\n`);

const { data: groups } = await supa.from("sc_service_groups")
  .select("id, account_key, group_name").is("deleted_at", null);
const { data: services } = await supa.from("sc_services")
  .select("id, account_key, group_id, service_name, is_flat_fee, is_non_revenue, active").is("deleted_at", null);

const groupNameById = new Map((groups || []).map((g) => [g.id, g.group_name]));
const svcByKey = new Map(); // "acct::group::svc" -> service row
const svcById = new Map();
for (const s of services || []) {
  const grp = groupNameById.get(s.group_id) || "?";
  svcByKey.set(`${s.account_key}::${grp}::${s.service_name}`, { ...s, group: grp });
  svcById.set(s.id, { ...s, group: grp });
}

// Pull all prices for services in our account set, then reduce to latest per service_id
const svcIds = (services || []).map((s) => s.id);
const allPrices = [];
const PAGE = 1000;
let from = 0;
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
console.error(`PG: ${groups?.length || 0} groups, ${services?.length || 0} services, ${allPrices.length} price rows, ${latestPriceBySvcId.size} services with at least one price\n`);

// Audit
const perAccount = {};
const mismatches = [];
const xlsxMissingInPg = [];
const pgMissingInXlsx = [];

for (const e of expected) {
  perAccount[e.account] ??= { ok: 0, mismatch: 0, missing_pg: 0 };
  const k = `${e.account}::${e.group}::${e.service}`;
  const svc = svcByKey.get(k);
  if (!svc) {
    xlsxMissingInPg.push(e);
    perAccount[e.account].missing_pg++;
    continue;
  }
  const pgRow = latestPriceBySvcId.get(svc.id);
  const pgPrice = pgRow ? pgRow.price : null;
  // Round to 2dp to absorb the $0.30/0.44 rounding pattern Sub-2 found
  const xlsxRounded = e.billing_price != null ? Math.round(e.billing_price * 100) / 100 : null;
  const pgRounded = pgPrice != null ? Math.round(pgPrice * 100) / 100 : null;
  if (xlsxRounded === pgRounded) {
    perAccount[e.account].ok++;
  } else {
    perAccount[e.account].mismatch++;
    mismatches.push({
      account: e.account, group: e.group, service: e.service,
      xlsx_billing: xlsxRounded, pg_latest: pgRounded,
      pg_effective_date: pgRow?.date || null,
      svc_active: svc.active, is_flat_fee: svc.is_flat_fee,
    });
  }
}

// PG services missing from xlsx
const xlsxKeys = new Set(expected.map((e) => `${e.account}::${e.group}::${e.service}`));
for (const s of services || []) {
  const k = `${s.account_key}::${groupNameById.get(s.group_id)}::${s.service_name}`;
  if (!xlsxKeys.has(k)) pgMissingInXlsx.push({ account: s.account_key, group: groupNameById.get(s.group_id), service: s.service_name, active: s.active });
}

// Report
console.log("══════ PRICE AUDIT: sc_service_prices vs v3 FINAL ══════\n");
console.log("Account         ok  mismatch  miss_in_pg");
console.log("--------------  --  --------  ----------");
for (const acct of ACCOUNTS) {
  const a = perAccount[acct];
  console.log(`${acct.padEnd(14)}  ${String(a.ok).padStart(2)}  ${String(a.mismatch).padStart(8)}  ${String(a.missing_pg).padStart(10)}`);
}

if (mismatches.length) {
  console.log(`\n══════ ${mismatches.length} PRICE MISMATCH(ES) ══════`);
  console.log("Account         Group                       Service                       xlsx     PG       date         flags");
  console.log("--------------  --------------------------  ----------------------------  -------  -------  -----------  -----");
  for (const m of mismatches) {
    const flags = (m.is_flat_fee ? "flat " : "") + (!m.svc_active ? "INACTIVE" : "");
    console.log(`${m.account.padEnd(14)}  ${(m.group || "").slice(0, 26).padEnd(26)}  ${m.service.slice(0, 28).padEnd(28)}  ${("$" + (m.xlsx_billing ?? "?")).padEnd(7)}  ${("$" + (m.pg_latest ?? "?")).padEnd(7)}  ${(m.pg_effective_date || "no-row").padEnd(11)}  ${flags}`);
  }
}

if (xlsxMissingInPg.length) {
  console.log(`\n══════ ${xlsxMissingInPg.length} XLSX SERVICE(S) NOT IN PG ══════`);
  for (const e of xlsxMissingInPg) {
    console.log(`  ${e.account.padEnd(14)}  ${(e.group || "").slice(0, 26).padEnd(26)}  ${e.service.slice(0, 30)}  xlsx_billing=$${e.billing_price}`);
  }
}

if (pgMissingInXlsx.length) {
  console.log(`\n══════ ${pgMissingInXlsx.length} PG SERVICE(S) NOT IN XLSX ══════`);
  for (const p of pgMissingInXlsx) {
    const tag = p.active ? "" : "  [INACTIVE]";
    console.log(`  ${p.account.padEnd(14)}  ${(p.group || "").slice(0, 26).padEnd(26)}  ${p.service.slice(0, 30)}${tag}`);
  }
}
