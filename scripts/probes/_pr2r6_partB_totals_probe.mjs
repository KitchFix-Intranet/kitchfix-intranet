// Full pagination probe - get the exact totals for check 9 reconciliation.
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supa = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const START = '2025-12-29';
const END = '2026-08-24';
const CAP = 1000;

async function pageAll(query) {
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await query.range(from, from + CAP - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) rows.push(r);
    if (data.length < CAP) break;
    from += CAP;
  }
  return rows;
}

async function sumGlLike(prefix) {
  // Use purchasing_actuals directly (bills-only doesn't matter here - 5002/13xx are all bills)
  const q = supa.from('purchasing_actuals')
    .select('amount, source, gl_line_code')
    .eq('excluded', false)
    .like('gl_line_code', prefix)
    .gte('txn_date', START).lte('txn_date', END)
    .not('account_key', 'is', null)
    .order('id', { ascending: true });
  const rows = await pageAll(q);
  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  return { count: rows.length, total, bysrc: countBySrc(rows) };
}
function countBySrc(rows) {
  const m = new Map();
  for (const r of rows) m.set(r.source, (m.get(r.source) || 0) + 1);
  return Object.fromEntries(m);
}

async function main() {
  const equip = await sumGlLike('5002.5%');
  const rep = await sumGlLike('5002.1%');
  const reimb = await sumGlLike('13%');
  console.log('EQUIP  (5002.5) count:', equip.count, 'total:', equip.total.toFixed(2), 'src:', equip.bysrc);
  console.log('REPAIR (5002.1) count:', rep.count, 'total:', rep.total.toFixed(2), 'src:', rep.bysrc);
  console.log('REIMB  (13xx)   count:', reimb.count, 'total:', reimb.total.toFixed(2), 'src:', reimb.bysrc);
  // Distinct gl codes seen in 13xx
  const q = supa.from('purchasing_actuals')
    .select('gl_line_code')
    .eq('excluded', false)
    .like('gl_line_code', '13%')
    .gte('txn_date', START).lte('txn_date', END)
    .not('account_key', 'is', null)
    .order('id', { ascending: true });
  const rows = await pageAll(q);
  const codes = new Set(rows.map(r => r.gl_line_code));
  console.log('13xx codes present:', [...codes]);
}
main().catch(e => { console.error(e); process.exit(2); });
