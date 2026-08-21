import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const r = await supa.from("labor_actuals_latest")
  .select("week_start,week_end,fiscal_year,period_no,coverage_state,amount,source_run")
  .eq("account_key","CIN - OH").order("week_start",{ascending:true});
if (r.error) throw r.error;
const byWeek = new Map();
for (const row of r.data) {
  const k = row.week_start;
  if (!byWeek.has(k)) byWeek.set(k, { end: row.week_end, period_no: row.period_no, fy: row.fiscal_year, cov: new Set(), amt:0, n:0 });
  byWeek.get(k).cov.add(row.coverage_state);
  byWeek.get(k).amt += Number(row.amount||0);
  byWeek.get(k).n += 1;
}
console.log(`weeks: ${byWeek.size}`);
for (const [wk,v] of byWeek) {
  console.log(`  ${wk} .. ${v.end} fy=${v.fy} p=${v.period_no ?? 'NULL'} cov=[${[...v.cov].join(",")}] $${v.amt.toFixed(2)} n=${v.n}`);
}
