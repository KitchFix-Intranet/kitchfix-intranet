// A2 (Addendum): AUDIT sc_daily_actuals against the calendar canon.
// READ-ONLY. Do NOT modify sc_daily_actuals - findings only.
//
// Chat-Claude already established the DB is wrong in at least these places:
//   TBJ May 16,078 vs calendar 9,433
//   TBJ Jul    885 vs calendar 10,801
//   STL Jun      0 vs projected 5,440
// Confirm or refute; add per-service-group breakdown where DB has one.
//
// Output:
//   scripts/_phase6/_denominator_audit.json  (structured findings)
//   Console: three-way variance table.

import dotenv from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/dotenv/lib/main.js";
import { createClient } from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/@supabase/supabase-js/dist/index.mjs";
import fs from "node:fs";
import { CANON, WINDOW } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/kitchfix-intranet/scripts/_phase6/_denominators.mjs";

dotenv.config({ path: "/Users/kevinfietek/dev/kitchfix-intranet/.env.local", quiet: true });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing env");
const supa = createClient(url, key, { auth: { persistSession: false } });

const OUT = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_denominator_audit.json";

const ACCT_KEYS = {
  "TBR-FL": "TBR - FL",
  "TBJ-FL": "TBJ - FL",
  "STL-FL": "STL - FL",
};

const MONTHS = ["2026-05", "2026-06", "2026-07"];

// --- Step 1: monthly totals from sc_daily_actuals ---
async function monthlyActuals(dbAcctKey) {
  const { data, error } = await supa
    .from("sc_daily_actuals")
    .select("service_date, service_id, actual_count")
    .eq("account_key", dbAcctKey)
    .gte("service_date", WINDOW.start)
    .lte("service_date", WINDOW.end);
  if (error) throw new Error(`sc_daily_actuals err ${dbAcctKey}: ${error.message}`);
  const monthly = {};
  const monthlyByService = {};
  for (const r of data || []) {
    const m = String(r.service_date).slice(0, 7);
    monthly[m] = (monthly[m] || 0) + (Number(r.actual_count) || 0);
    monthlyByService[m] = monthlyByService[m] || {};
    monthlyByService[m][r.service_id] = (monthlyByService[m][r.service_id] || 0) + (Number(r.actual_count) || 0);
  }
  return { monthly, monthlyByService, row_count: (data || []).length };
}

// --- Step 2: service group lookup for the account ---
async function serviceGroupsForAccount(dbAcctKey) {
  const { data: sg, error: sgErr } = await supa
    .from("sc_service_groups")
    .select("id, group_name, account_key, active")
    .eq("account_key", dbAcctKey);
  if (sgErr) throw new Error(`sg err: ${sgErr.message}`);
  return sg || [];
}

// --- Step 3: services under groups (to map service_id -> group_name) ---
async function servicesForAccount(dbAcctKey) {
  const { data, error } = await supa
    .from("sc_services")
    .select("id, service_name, group_id, account_key, active")
    .eq("account_key", dbAcctKey);
  if (error) throw new Error(`svc err: ${error.message}`);
  return data || [];
}

const out = { built_at: new Date().toISOString(), window: WINDOW, canon: {}, accounts: {} };

for (const acct of Object.keys(ACCT_KEYS)) {
  const canonRow = CANON[acct];
  out.canon[acct] = canonRow;
  const dbAcctKey = ACCT_KEYS[acct];
  console.log(`\n==== ${acct} (db key: "${dbAcctKey}") ====`);
  const [actualsRes, groups, services] = await Promise.all([
    monthlyActuals(dbAcctKey),
    serviceGroupsForAccount(dbAcctKey),
    servicesForAccount(dbAcctKey),
  ]);
  const svcById = new Map(services.map(s => [s.id, s]));
  const groupById = new Map(groups.map(g => [g.id, g]));

  const monthlyRows = [];
  for (const m of MONTHS) {
    const canonM = canonRow.monthly[m] || 0;
    const dbM = actualsRes.monthly[m] || 0;
    const variance = dbM - canonM;
    const pct = canonM ? Math.round((variance / canonM) * 1000) / 10 : null;
    monthlyRows.push({ month: m, canon: canonM, db_actuals: dbM, variance, pct });
  }
  const canonTotal = canonRow.total;
  const dbTotal = MONTHS.reduce((s, m) => s + (actualsRes.monthly[m] || 0), 0);
  const totalRow = { month: "TOTAL", canon: canonTotal, db_actuals: dbTotal, variance: dbTotal - canonTotal, pct: canonTotal ? Math.round(((dbTotal - canonTotal) / canonTotal) * 1000) / 10 : null };

  // Console table
  console.log("  month     canon    db_actuals  variance     pct");
  console.log("  --------  -------  ----------  --------     -----");
  for (const r of [...monthlyRows, totalRow]) {
    console.log(`  ${r.month.padEnd(8)}  ${String(r.canon).padStart(7)}  ${String(r.db_actuals).padStart(10)}  ${String(r.variance).padStart(8)}  ${r.pct != null ? r.pct + "%" : "-"}`);
  }

  // Per-service-group breakdown per month
  const perGroup = {};
  for (const m of MONTHS) {
    const byService = actualsRes.monthlyByService[m] || {};
    for (const [svcId, count] of Object.entries(byService)) {
      const svc = svcById.get(svcId);
      const grpId = svc?.group_id;
      const grpName = grpId ? (groupById.get(grpId)?.group_name || `unknown_group:${grpId}`) : "no_group";
      perGroup[grpName] = perGroup[grpName] || { by_month: { "2026-05": 0, "2026-06": 0, "2026-07": 0 }, total: 0 };
      perGroup[grpName].by_month[m] += count;
      perGroup[grpName].total += count;
    }
  }
  console.log("\n  Per-service-group breakdown (from sc_daily_actuals):");
  console.log("    group_name                          2026-05    2026-06    2026-07     total");
  console.log("    --------------------------------    -------    -------    -------     -----");
  for (const [name, v] of Object.entries(perGroup).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`    ${name.padEnd(36).slice(0,36)}    ${String(v.by_month["2026-05"]).padStart(7)}    ${String(v.by_month["2026-06"]).padStart(7)}    ${String(v.by_month["2026-07"]).padStart(7)}     ${String(v.total).padStart(5)}`);
  }

  out.accounts[acct] = {
    db_account_key: dbAcctKey,
    row_count: actualsRes.row_count,
    monthly: monthlyRows,
    total: totalRow,
    per_group: perGroup,
    service_groups_present: groups.map(g => ({ id: g.id, name: g.group_name, active: g.active })),
  };
}

// Highlight Chat-Claude's claimed variances
const claimedVariances = [
  { account: "TBJ-FL", month: "2026-05", canon: 9433, db: 16078, note: "Chat-Claude: TBJ May 16,078 vs calendar 9,433" },
  { account: "TBJ-FL", month: "2026-07", canon: 10801, db: 885, note: "Chat-Claude: TBJ Jul 885 vs calendar 10,801" },
  { account: "STL-FL", month: "2026-06", canon: 6190, db: 0, note: "Chat-Claude: STL Jun 0 vs projected 5,440" },
];
console.log("\n==== Chat-Claude claim verification ====");
for (const c of claimedVariances) {
  const dbActual = (out.accounts[c.account].monthly.find(x => x.month === c.month) || {}).db_actuals;
  const canonActual = (out.accounts[c.account].monthly.find(x => x.month === c.month) || {}).canon;
  const match = dbActual === c.db;
  console.log(`  ${c.note}`);
  console.log(`    -> observed: canon=${canonActual}  db=${dbActual}  ${match ? "CONFIRMED" : "REFUTED"}`);
}
out.claim_verification = claimedVariances.map(c => {
  const row = (out.accounts[c.account].monthly.find(x => x.month === c.month) || {});
  return { ...c, observed_canon: row.canon, observed_db: row.db_actuals, confirmed: row.db_actuals === c.db };
});

fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`\nwrote ${OUT}`);
console.log("\nAUDIT ONLY. sc_daily_actuals NOT MODIFIED. Findings for post-Phase-6 SC data-integrity review.");
