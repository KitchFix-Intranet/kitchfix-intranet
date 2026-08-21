// Prove H1 fix: derive period_no client-side, group correctly.
import { createClient } from "@supabase/supabase-js";
import { periodOf, fiscalYearOf } from "../../src/app/kpi/labor/lib/periods.js";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const r = await supa.from("labor_actuals_latest")
  .select("week_start,fiscal_year,period_no,amount")
  .eq("account_key","CIN - OH").order("week_start",{ascending:true});
if (r.error) throw r.error;

const uniqWeeks = [...new Set(r.data.map(x => x.week_start))].sort();
console.log(`unique weeks: ${uniqWeeks.length}`);

const byPeriod = new Map();
for (const w of uniqWeeks) {
  const p = periodOf(w);
  const fy = fiscalYearOf(w);
  const k = `${fy}|${p ?? 0}`;
  if (!byPeriod.has(k)) byPeriod.set(k, []);
  byPeriod.get(k).push(w);
}

console.log(`groups (client-derived):`);
for (const [k, weeks] of [...byPeriod.entries()].sort()) {
  console.log(`  ${k}: ${weeks.length} weeks · ${weeks[0]}..${weeks.at(-1)}`);
}

// Compare with server period_no
const srvGroups = new Map();
for (const row of r.data) {
  const k = `${row.fiscal_year}|${row.period_no ?? 'NULL'}`;
  srvGroups.set(k, (srvGroups.get(k) || 0) + 1);
}
console.log(`\ngroups (server period_no, rows):`);
for (const [k, n] of [...srvGroups.entries()].sort()) {
  console.log(`  ${k}: ${n} rows`);
}
