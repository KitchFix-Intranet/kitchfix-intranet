// PR 2 R5 Part C - REPORT ONLY.
// R&M 5002.1 reconciliation.
// 1. FYTD 5002.1 budget across accounts from kpi_budgets - reconcile
//    against $15,515.14 total.
// 2. FYTD 5002.1 spend by source and by account.
// 3. Is vehicle repair (should sit in 3500.5) coding to 5002.1?
//    Check bill descriptions / vendors for vehicle-repair signals.
// 4. Top 10 5002.1 transactions.

import { createClient } from '@supabase/supabase-js';

// Env comes from process.env only. Runner must pass Supabase creds via
// `node --env-file=.env.local ...` (Node 20+). This probe NEVER opens
// .env.local itself and NEVER prints a key.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_KEY;
if (!url || !key) {
  console.error('missing SUPABASE_URL or SERVICE_ROLE key on process.env');
  process.exit(2);
}
const supa = createClient(url, key, { auth: { persistSession: false } });

const FY_START = '2025-12-29';
const TODAY = '2026-08-24';

async function main() {
  console.log('=== R&M 5002.1 RECONCILIATION ===\n');

  // (1) kpi_budgets - what's the FY total for 5002.1 across accounts?
  {
    const { data, error } = await supa
      .from('kpi_budgets')
      .select('account_key, gl_line_code, amount, period_no')
      .eq('gl_line_code', '5002.1');
    if (error) { console.error('kpi_budgets error:', error); process.exit(2); }
    console.log(`kpi_budgets 5002.1 rows: ${data.length}`);
    let total = 0;
    const byAccount = new Map();
    const byPeriod = new Map();
    for (const r of data) {
      total += Number(r.amount || 0);
      byAccount.set(r.account_key, (byAccount.get(r.account_key) || 0) + Number(r.amount || 0));
      byPeriod.set(r.period_no, (byPeriod.get(r.period_no) || 0) + Number(r.amount || 0));
    }
    console.log(`total (all accounts, all periods): $${total.toFixed(2)}`);
    console.log(`\nBy account:`);
    for (const [k, v] of [...byAccount.entries()].sort((a,b)=>b[1]-a[1])) {
      console.log(`  ${k.padEnd(15)}: $${v.toFixed(2)}`);
    }
    console.log(`\nBy period:`);
    for (const [k, v] of [...byPeriod.entries()].sort((a,b)=>a[0]-b[0])) {
      console.log(`  P${k}: $${v.toFixed(2)}`);
    }
    // FYTD sum = periods 1..9 (through today 2026-08-24).
    const fytd = [...byPeriod.entries()].filter(([p]) => p <= 9).reduce((s,[,v])=>s+v, 0);
    console.log(`\nFYTD (P1..P9) total: $${fytd.toFixed(2)}  (Kevin's anchor: $15,515.14)`);
  }

  // (2) Spend by source and by account for 5002.1 (FYTD).
  {
    const { data, error } = await supa
      .from('purchasing_actuals')
      .select('account_key, source, amount, vendor_name, description, txn_date, gl_line_code')
      .eq('gl_line_code', '5002.1')
      .eq('excluded', false)
      .gte('txn_date', FY_START)
      .lte('txn_date', TODAY)
      .limit(2000);
    if (error) { console.error('purchasing_actuals error:', error); process.exit(2); }
    console.log(`\npurchasing_actuals 5002.1 rows (FYTD, excluded=false): ${data.length}`);
    const bySrcAcct = new Map();
    for (const r of data) {
      const k = `${r.source}|${r.account_key}`;
      bySrcAcct.set(k, (bySrcAcct.get(k) || 0) + Number(r.amount || 0));
    }
    console.log(`\nSpend by source|account:`);
    for (const [k, v] of [...bySrcAcct.entries()].sort((a,b)=>b[1]-a[1])) {
      console.log(`  ${k.padEnd(30)}: $${v.toFixed(2)}`);
    }
    // Top 10.
    const top = data.slice().sort((a,b) => Number(b.amount) - Number(a.amount)).slice(0, 10);
    console.log(`\nTop 10 5002.1 transactions (FYTD):`);
    console.log(`  amount        source           account          vendor                                     description`);
    for (const r of top) {
      const desc = String(r.description || '').slice(0, 60);
      console.log(`  $${Number(r.amount).toFixed(2).padStart(10)}  ${String(r.source).padEnd(16)} ${String(r.account_key).padEnd(15)}  ${String(r.vendor_name || '').padEnd(40).slice(0,40)}  ${desc}`);
    }
    // (3) Any vehicle-repair signals in 5002.1 descriptions/vendors?
    const VEHICLE_HINTS = /truck|van|vehicle|auto|tire|brake|oil change|transmission|mechanic|garage|auto ?service|fleet|toyota|ford|chevy|nissan|honda|mercedes|jiffy|firestone|napa|pep boys/i;
    const suspects = data.filter(r =>
      VEHICLE_HINTS.test(String(r.vendor_name || '')) ||
      VEHICLE_HINTS.test(String(r.description || ''))
    );
    console.log(`\n=== Vehicle-repair-shaped rows landing in 5002.1 ===`);
    console.log(`suspect rows: ${suspects.length}`);
    for (const r of suspects.slice(0, 20)) {
      console.log(`  $${Number(r.amount).toFixed(2).padStart(9)}  ${String(r.account_key).padEnd(15)} ${String(r.vendor_name||'').padEnd(30)}  ${String(r.description||'').slice(0,80)}`);
    }
    // For contrast: what IS landing in 3500.5?
    const { data: veh5, error: verr } = await supa
      .from('purchasing_actuals')
      .select('account_key, source, amount, vendor_name, description, txn_date')
      .eq('gl_line_code', '3500.5')
      .eq('excluded', false)
      .gte('txn_date', FY_START)
      .lte('txn_date', TODAY)
      .limit(500);
    if (!verr) {
      console.log(`\n=== 3500.5 (vehicle R&M) rows FYTD: ${veh5.length} ===`);
      let s = 0;
      for (const r of veh5) s += Number(r.amount || 0);
      console.log(`total: $${s.toFixed(2)}`);
      for (const r of veh5.slice(0, 5)) {
        console.log(`  $${Number(r.amount).toFixed(2).padStart(9)}  ${String(r.account_key).padEnd(15)} ${String(r.vendor_name||'').padEnd(30)}  ${String(r.description||'').slice(0,60)}`);
      }
    }
  }
}
main().catch(e => { console.error(e); process.exit(2); });
