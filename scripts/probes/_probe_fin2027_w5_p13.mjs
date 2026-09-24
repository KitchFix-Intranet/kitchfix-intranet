// FIN-2027 W5 · P13 state check. READ ONLY.
// The revised brief moved from P9-only to P13 for closed years.
// Verify current Supabase totals tie to the P13 workbook figures on
// the 9 accounts that FY2024 has and the 11 accounts FY2025 has
// (excluding the missing CHI + DTOR).
//
// Usage: node --env-file=.env.local scripts/probes/_probe_fin2027_w5_p13.mjs

import { createClient } from "@supabase/supabase-js";

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const fmt$ = n => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function pageAll(table, sel, filters = q => q) {
  const out = [];
  let from = 0;
  while (true) {
    const q = filters(s.from(table).select(sel).range(from, from + 999));
    const r = await q;
    if (r.error) throw r.error;
    out.push(...(r.data || []));
    if ((r.data || []).length < 1000) break;
    from += 1000;
  }
  return out;
}

const kl = await pageAll("kpi_lines", "line_code, section");
const sectionOf = new Map(kl.map(r => [r.line_code, r.section]));
const pa = await pageAll("pnl_actuals", "fiscal_year, account_key, line_code, period_no, actual");

for (const year of [2024, 2025, 2026]) {
  console.log(`\n=== FY${year} · P9 vs P13 site contribution margin per account ===`);
  const p9 = new Map(), p13 = new Map();
  for (const r of pa) {
    if (r.fiscal_year !== year) continue;
    const sec = sectionOf.get(r.line_code);
    if (!sec) continue;
    const amt = Number(r.actual || 0);
    const p = r.period_no;
    if (p == null) continue;
    if (p <= 9) {
      if (!p9.has(r.account_key)) p9.set(r.account_key, { revenue: 0, cogs: 0, sga: 0 });
      p9.get(r.account_key)[sec] += amt;
    }
    if (p <= 13) {
      if (!p13.has(r.account_key)) p13.set(r.account_key, { revenue: 0, cogs: 0, sga: 0 });
      p13.get(r.account_key)[sec] += amt;
    }
  }
  let cmP9 = 0, cmP13 = 0;
  const accts = [...new Set([...p9.keys(), ...p13.keys()])].sort();
  console.log(`  ${"account".padEnd(20)}  ${"P9 cm".padStart(14)}  ${"P13 cm".padStart(14)}`);
  for (const a of accts) {
    const v9 = p9.get(a) || { revenue: 0, cogs: 0, sga: 0 };
    const v13 = p13.get(a) || { revenue: 0, cogs: 0, sga: 0 };
    const cm9 = v9.revenue - v9.cogs - v9.sga;
    const cm13 = v13.revenue - v13.cogs - v13.sga;
    console.log(`  ${a.padEnd(20)}  ${fmt$(cm9).padStart(14)}  ${fmt$(cm13).padStart(14)}`);
    if (a !== "CORP") { cmP9 += cm9; cmP13 += cm13; }
  }
  console.log(`  ${"".padEnd(20)}  ${"site CM total (Supabase)".padStart(30)}: P9=${fmt$(cmP9)}  P13=${fmt$(cmP13)}`);
}
