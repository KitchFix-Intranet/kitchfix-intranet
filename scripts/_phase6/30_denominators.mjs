// D1-D3: Denominator appendix. Read-only SQL against Supabase (via SDK).
//   D1  sc_daily_actuals sums for TBR-FL / TBJ-FL / STL-FL,
//       2026-05-01..2026-07-31, by month.
//   D2  Search sc_service_groups / accounts for any B&G / BGC / Boys & Girls
//       entity under or near TBR-FL; if found, monthly actuals in-window.
//   D3  STL-FL sc_daily_projections monthly sums in-window vs 7,540 / 6,190 /
//       5,130 figures.
// Report values only.

import dotenv from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/dotenv/lib/main.js";
import { createClient } from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/@supabase/supabase-js/dist/index.mjs";
import fs from "node:fs";

dotenv.config({ path: "/Users/kevinfietek/dev/kitchfix-intranet/.env.local", quiet: true });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing env");
const supa = createClient(url, key, { auth: { persistSession: false } });

const WINDOW_START = "2026-05-01";
const WINDOW_END = "2026-07-31";

const OUT = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_denominators.json";
const out = { built_at: new Date().toISOString() };

// Probe sc_daily_actuals shape
async function probeTable(t) {
  const { data, error } = await supa.from(t).select("*").limit(1);
  if (error) return { table: t, error: error.message };
  return { table: t, sample_keys: data && data[0] ? Object.keys(data[0]) : [] };
}

const T = {};
for (const t of ["sc_daily_actuals","sc_daily_projections","sc_service_groups","service_calendar_accounts"]) {
  T[t] = await probeTable(t);
  console.log("[probe]", t, JSON.stringify(T[t]).slice(0,300));
}
out.table_probes = T;

// Try to resolve the account keys. Assume there is a text account column.
// Look for column names that hint at account.
function pickCol(sampleKeys, wanted) {
  for (const w of wanted) if (sampleKeys.includes(w)) return w;
  return null;
}
const ACT_COLS = T.sc_daily_actuals.sample_keys || [];
const PROJ_COLS = T.sc_daily_projections.sample_keys || [];
const SG_COLS = T.sc_service_groups.sample_keys || [];

// D1 - sc_daily_actuals sums for TBR/TBJ/STL by month
if (ACT_COLS.length) {
  const dateCol = pickCol(ACT_COLS, ["date","service_date","day","actual_date"]);
  const acctCol = pickCol(ACT_COLS, ["account_key","account","account_code","account_id","service_account"]);
  const mealsCol = pickCol(ACT_COLS, ["actual_count","meals","meal_count","total_meals","meals_actual","count","actual_meals"]);
  console.log("[D1] columns picked: date=", dateCol, "acct=", acctCol, "meals=", mealsCol);
  out.d1 = { columns_used: { dateCol, acctCol, mealsCol } };
  if (dateCol && acctCol && mealsCol) {
    const perAcct = {};
    for (const acctVariant of ["TBR-FL","TBR - FL","TBJ-FL","TBJ - FL","STL-FL","STL - FL"]) {
      const { data, error } = await supa
        .from("sc_daily_actuals")
        .select(`${dateCol}, ${acctCol}, ${mealsCol}`)
        .eq(acctCol, acctVariant)
        .gte(dateCol, WINDOW_START)
        .lte(dateCol, WINDOW_END);
      if (error) { console.log(" err", acctVariant, error.message); continue; }
      if (!data || !data.length) continue;
      const key = acctVariant.replace(" - ","-");
      perAcct[key] = perAcct[key] || { monthly: {}, rows: 0 };
      for (const r of data) {
        const d = String(r[dateCol]).slice(0,10);
        const m = d.slice(0,7);
        perAcct[key].monthly[m] = perAcct[key].monthly[m] || { rows: 0, meals: 0 };
        perAcct[key].monthly[m].rows += 1;
        perAcct[key].monthly[m].meals += Number(r[mealsCol]) || 0;
        perAcct[key].rows += 1;
      }
    }
    out.d1.per_account = perAcct;
    console.log("[D1] per_account:", JSON.stringify(perAcct, null, 2));
  } else {
    out.d1.note = "Could not identify required columns for sc_daily_actuals; skipping.";
  }
}

// D2 - hunt for BGC entity in sc_service_groups
if (SG_COLS.length) {
  out.d2 = { columns_available: SG_COLS };
  const nameCol = pickCol(SG_COLS, ["name","group_name","label","display_name","title"]);
  if (nameCol) {
    const { data, error } = await supa
      .from("sc_service_groups")
      .select("*")
      .or(`${nameCol}.ilike.%boys%,${nameCol}.ilike.%girls%,${nameCol}.ilike.%bgc%,${nameCol}.ilike.%b%g%`)
      .limit(50);
    if (error) out.d2.error = error.message;
    else out.d2.matches = data || [];
    console.log("[D2] service_group matches:", (data||[]).length, "entries:", (data||[]).slice(0,10));

    // If any match: pull monthly actuals for that service_id in-window
    if (data && data.length) {
      out.d2.matches_monthly_actuals = [];
      for (const m of data) {
        const svcId = m.id;
        const { data: actRows, error: aErr } = await supa
          .from("sc_daily_actuals")
          .select("service_date, actual_count")
          .eq("service_id", svcId)
          .gte("service_date", WINDOW_START)
          .lte("service_date", WINDOW_END);
        if (aErr) { console.log(" bgc actuals err", aErr.message); continue; }
        const perMonth = {};
        for (const r of actRows || []) {
          const mm = String(r.service_date).slice(0,7);
          perMonth[mm] = perMonth[mm] || { rows: 0, meals: 0 };
          perMonth[mm].rows += 1;
          perMonth[mm].meals += Number(r.actual_count) || 0;
        }
        out.d2.matches_monthly_actuals.push({ service_id: svcId, account_key: m.account_key, name: m[nameCol], monthly: perMonth });
        console.log("[D2] monthly actuals for", m[nameCol], "(", m.account_key, "):", perMonth);
      }
    }
  } else {
    out.d2.note = "No name-like column identified in sc_service_groups; skipping.";
  }
}

// D3 - sc_daily_projections STL-FL monthly
if (PROJ_COLS.length) {
  const dateCol = pickCol(PROJ_COLS, ["date","service_date","day","projected_date"]);
  const acctCol = pickCol(PROJ_COLS, ["account_key","account","account_code","account_id","service_account"]);
  const mealsCol = pickCol(PROJ_COLS, ["projected_count","meals","meal_count","total_meals","projected_meals","count","projection"]);
  out.d3 = { columns_used: { dateCol, acctCol, mealsCol } };
  if (dateCol && acctCol && mealsCol) {
    let combined = {};
    for (const acctVariant of ["STL-FL","STL - FL"]) {
      const { data, error } = await supa
        .from("sc_daily_projections")
        .select(`${dateCol}, ${acctCol}, ${mealsCol}`)
        .eq(acctCol, acctVariant)
        .gte(dateCol, WINDOW_START)
        .lte(dateCol, WINDOW_END);
      if (error) { console.log(" err", acctVariant, error.message); continue; }
      if (!data || !data.length) continue;
      for (const r of data) {
        const m = String(r[dateCol]).slice(0,7);
        combined[m] = combined[m] || { rows: 0, meals: 0 };
        combined[m].rows += 1;
        combined[m].meals += Number(r[mealsCol]) || 0;
      }
    }
    out.d3.stl_monthly = combined;
    console.log("[D3] STL-FL projections monthly:", combined);
  } else {
    out.d3.note = "Could not identify required columns for sc_daily_projections; skipping.";
  }
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`\nwrote ${OUT}`);
