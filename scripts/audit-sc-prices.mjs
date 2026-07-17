// READ-ONLY dump of the current SC price catalog from PG.
//
// Purpose:
//   1. Certification-audit input: emits a JSON snapshot of every account
//      x service x current price + flags for the four-way audit
//      (Signed / PG / Account files / SC workbooks).
//   2. PRICE_BOOK generator seed: this is the persistent, first-class
//      read path for "what is PG currently pricing." Do NOT delete after
//      the audit; downstream jobs (PRICE_BOOK render, KPI reads,
//      contract-fee reconciliation) will grow off the same shape.
//
// Modes:
//   node scripts/audit-sc-prices.mjs              # full JSON dump to stdout
//   node scripts/audit-sc-prices.mjs --pretty     # + human-readable table on stderr
//   node scripts/audit-sc-prices.mjs --smoke      # only run the 4 Stage-1 gate checks
//   node scripts/audit-sc-prices.mjs --out FILE   # write JSON to FILE instead of stdout
//
// Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY.
//
// SELECT-only. This script writes no rows anywhere.

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const argVal = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};
const SMOKE = flag("--smoke");
const PRETTY = flag("--pretty") || SMOKE;
const OUT = argVal("--out");

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ---- SELECT 1: accounts ----
const { data: accounts, error: eA } = await supa
  .from("accounts")
  .select("team_key, name, level, billing_model, active")
  .order("team_key", { ascending: true });
if (eA) throw new Error(`accounts: ${eA.message}`);

const accountByKey = new Map(accounts.map((a) => [a.team_key, a]));

// ---- SELECT 2: sc_service_groups (respect soft-delete) ----
const { data: groups, error: eG } = await supa
  .from("sc_service_groups")
  .select("id, account_key, group_name, active_until")
  .is("deleted_at", null);
if (eG) throw new Error(`sc_service_groups: ${eG.message}`);

const groupById = new Map(groups.map((g) => [g.id, g]));

// ---- SELECT 3: sc_services (respect soft-delete) ----
const { data: services, error: eS } = await supa
  .from("sc_services")
  .select(
    "id, account_key, group_id, service_name, is_flat_fee, is_tax_free, is_non_revenue, active, active_until, created_at"
  )
  .is("deleted_at", null);
if (eS) throw new Error(`sc_services: ${eS.message}`);

// ---- SELECT 4: sc_service_prices (all rows for the loaded services; reduce to
// latest effective_date per service_id) ----
const svcIds = services.map((s) => s.id);
const allPrices = [];
const PAGE = 1000;
for (let from = 0; ; from += PAGE) {
  const { data, error } = await supa
    .from("sc_service_prices")
    .select("service_id, price, effective_date, price_kind")
    .in("service_id", svcIds)
    .order("effective_date", { ascending: false })
    .range(from, from + PAGE - 1);
  if (error) throw new Error(`sc_service_prices: ${error.message}`);
  if (!data || data.length === 0) break;
  allPrices.push(...data);
  if (data.length < PAGE) break;
}

// Reduce to latest per (service_id, price_kind).
const latestByKey = new Map();
for (const r of allPrices) {
  const k = `${r.service_id}::${r.price_kind || "projected"}`;
  if (!latestByKey.has(k)) latestByKey.set(k, r);
}

// ---- Assemble the flat dump ----
const rows = services
  .map((s) => {
    const g = groupById.get(s.group_id);
    const proj = latestByKey.get(`${s.id}::projected`);
    const actl = latestByKey.get(`${s.id}::actual`);
    const acct = accountByKey.get(s.account_key);
    return {
      account_key: s.account_key,
      account_name: acct?.name ?? null,
      billing_model: acct?.billing_model ?? null,
      group: g?.group_name ?? null,
      service: s.service_name,
      is_flat_fee: !!s.is_flat_fee,
      is_non_revenue: !!s.is_non_revenue,
      is_tax_free: !!s.is_tax_free,
      svc_active: !!s.active,
      svc_active_until: s.active_until,
      group_active_until: g?.active_until ?? null,
      projected_price: proj ? Number(proj.price) : null,
      projected_effective_date: proj?.effective_date ?? null,
      actual_price: actl ? Number(actl.price) : null,
      actual_effective_date: actl?.effective_date ?? null,
    };
  })
  .sort((a, b) =>
    (a.account_key || "").localeCompare(b.account_key || "") ||
    (a.group || "").localeCompare(b.group || "") ||
    (a.service || "").localeCompare(b.service || "")
  );

// ---- Smoke checks: the 4 Stage-1 fixes ----
function normalize(s) {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

const smokeChecks = [
  {
    id: "CIN-AZ Breakfast = $20.31",
    match: (r) =>
      r.account_key === "CIN - AZ" &&
      normalize(r.service).startsWith("breakfast") &&
      normalize(r.group).includes("major league"),
    assert: (r) => r.projected_price === 20.31,
    expect: 20.31,
  },
  {
    id: "Media Meals = $16.00",
    match: (r) => normalize(r.service).includes("media"),
    assert: (r) => r.projected_price === 16.00,
    expect: 16.00,
  },
  {
    id: "No '(tax-free)' suffixes on service names",
    match: (r) => normalize(r.service).includes("(tax-free)") || normalize(r.service).includes("(tax free)"),
    invert: true, // matching rows = FAIL
  },
  {
    id: "'Extended Day Labor' present (renamed, case-exact)",
    // Case-EXACT: PG had "Extended Day labor" (lowercase l) pre-fix; the
    // rename target is "Extended Day Labor" (capital L). Do NOT normalize.
    match: (r) => (r.service || "").includes("Extended Day Labor"),
    presenceOnly: true,
  },
];

function runSmoke() {
  const results = [];
  for (const c of smokeChecks) {
    if (c.invert) {
      const bad = rows.filter(c.match);
      results.push({
        id: c.id,
        pass: bad.length === 0,
        detail: bad.length === 0 ? "no matches" : bad.map((r) => `${r.account_key}::${r.group}::${r.service}`),
      });
      continue;
    }
    if (c.presenceOnly) {
      const hits = rows.filter(c.match);
      results.push({
        id: c.id,
        pass: hits.length > 0,
        detail: hits.length > 0
          ? hits.map((r) => `${r.account_key}::${r.group}::${r.service}`).join(", ")
          : "no matching row",
      });
      continue;
    }
    const hits = rows.filter(c.match);
    if (hits.length === 0) {
      results.push({ id: c.id, pass: false, detail: "no matching row" });
      continue;
    }
    const bad = hits.filter((r) => !c.assert(r));
    results.push({
      id: c.id,
      pass: bad.length === 0,
      detail:
        bad.length === 0
          ? `${hits.length} row(s), all @ ${c.expect}`
          : bad
              .map(
                (r) =>
                  `${r.account_key}::${r.service} projected=${r.projected_price} (expected ${c.expect})`
              )
              .join(" | "),
    });
  }
  return results;
}

// ---- Output ----
const snapshot = {
  generated_at: new Date().toISOString(),
  counts: {
    accounts: accounts.length,
    groups: groups.length,
    services: services.length,
    prices_scanned: allPrices.length,
    services_with_projected_price: [...latestByKey.keys()].filter((k) =>
      k.endsWith("::projected")
    ).length,
    services_with_actual_price: [...latestByKey.keys()].filter((k) =>
      k.endsWith("::actual")
    ).length,
  },
  smoke: runSmoke(),
  rows,
};

if (SMOKE) {
  // Smoke-only: print the smoke result table.
  const s = snapshot.smoke;
  const anyFail = s.some((r) => !r.pass);
  console.error("== Stage-1 smoke checks ==");
  for (const r of s) {
    console.error(`${r.pass ? "PASS" : "FAIL"}  ${r.id}`);
    console.error(`      ${typeof r.detail === "string" ? r.detail : JSON.stringify(r.detail)}`);
  }
  console.error(`\nOverall: ${anyFail ? "FAIL" : "PASS"}`);
  process.exit(anyFail ? 1 : 0);
}

const json = JSON.stringify(snapshot, null, 2);
if (OUT) {
  writeFileSync(OUT, json);
  console.error(`wrote ${rows.length} rows to ${OUT}`);
} else {
  console.log(json);
}

if (PRETTY) {
  console.error(`\n== dump summary ==`);
  console.error(`accounts=${accounts.length} groups=${groups.length} services=${services.length}`);
  console.error(
    `latest-projected=${snapshot.counts.services_with_projected_price} latest-actual=${snapshot.counts.services_with_actual_price}`
  );
  console.error(`\n== smoke ==`);
  for (const r of snapshot.smoke) {
    console.error(`${r.pass ? "PASS" : "FAIL"}  ${r.id}`);
    console.error(`      ${typeof r.detail === "string" ? r.detail : JSON.stringify(r.detail)}`);
  }
}
