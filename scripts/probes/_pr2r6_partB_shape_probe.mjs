// Probe purchasing_actuals + v_purchasing_actuals_billcom_named + rippling_raw
// to inform the payload shape for PR-2 R6 Part B.
//
// Reports:
//  - top 25 rows for 5002.5 (equipment) with vendor names
//  - top 25 rows for 5002.1 (R&M) with vendor names
//  - top 25 rows for 13xx (reimbursable) with vendor names
//  - top 50 pending card charges (rippling_spend, gl_line_code NULL)
//  - top 25 vendors by spend
//  - vendor fragmentation: count of names collapsing when a " - <STATE>"
//    or " <ACCT>" suffix is stripped
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('missing supabase env'); process.exit(2); }
const supa = createClient(url, key);

const START = '2025-12-29';
const END = '2026-08-24';

async function loadEquip() {
  const { data, error } = await supa
    .from('v_purchasing_actuals_billcom_named')
    .select('account_key, gl_line_code, txn_date, amount, vendor_id, vendor_name, vendor_resolved')
    .eq('excluded', false)
    .eq('gl_line_code', '5002.5')
    .gte('txn_date', START).lte('txn_date', END)
    .not('account_key', 'is', null)
    .order('amount', { ascending: false });
  if (error) throw error;
  const totalAmt = (data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
  const unresolved = (data || []).filter(r => !r.vendor_resolved).length;
  return { rows: data || [], totalCount: (data || []).length, totalAmt, unresolved };
}
async function loadRepair() {
  const { data, error } = await supa
    .from('v_purchasing_actuals_billcom_named')
    .select('account_key, gl_line_code, txn_date, amount, vendor_id, vendor_name, vendor_resolved')
    .eq('excluded', false)
    .eq('gl_line_code', '5002.1')
    .gte('txn_date', START).lte('txn_date', END)
    .not('account_key', 'is', null)
    .order('amount', { ascending: false });
  if (error) throw error;
  const totalAmt = (data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
  const unresolved = (data || []).filter(r => !r.vendor_resolved).length;
  return { rows: data || [], totalCount: (data || []).length, totalAmt, unresolved };
}
async function loadReimb() {
  const { data, error } = await supa
    .from('v_purchasing_actuals_billcom_named')
    .select('account_key, gl_line_code, txn_date, amount, vendor_id, vendor_name, vendor_resolved')
    .eq('excluded', false)
    .like('gl_line_code', '13%')
    .gte('txn_date', START).lte('txn_date', END)
    .not('account_key', 'is', null)
    .order('amount', { ascending: false });
  if (error) throw error;
  const totalAmt = (data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
  const unresolved = (data || []).filter(r => !r.vendor_resolved).length;
  return { rows: data || [], totalCount: (data || []).length, totalAmt, unresolved };
}
async function loadCardCharges() {
  // Pending = coded to no GL line. Per Kevin's card_charges spec:
  // "uncoded card charges - merchant, txn_date, operator category, amount, account_key"
  // Read purchasing_actuals for rippling_spend rows with gl_line_code IS NULL.
  const { data, error } = await supa
    .from('purchasing_actuals')
    .select('id, account_key, txn_date, amount, vendor_or_merchant, gl_line_code, source_line_id')
    .eq('excluded', false)
    .eq('source', 'rippling_spend')
    .is('gl_line_code', null)
    .gte('txn_date', START).lte('txn_date', END)
    .order('amount', { ascending: false })
    .limit(200);
  if (error) throw error;
  const totalCount = data?.length || 0;
  const totalAmt = (data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
  return { rows: data || [], totalCount, totalAmt };
}
async function loadVendors() {
  // Per-vendor rollup from billcom rows via named view, plus prior period comparison.
  const { data, error } = await supa
    .from('v_purchasing_actuals_billcom_named')
    .select('account_key, gl_line_code, amount, vendor_id, vendor_name, vendor_resolved')
    .eq('excluded', false)
    .gte('txn_date', START).lte('txn_date', END)
    .not('account_key', 'is', null);
  if (error) throw error;

  const byVendor = new Map();
  for (const r of data || []) {
    const key = r.vendor_id || '__UNRESOLVED__';
    if (!byVendor.has(key)) {
      byVendor.set(key, {
        vendor_id: r.vendor_id,
        name: r.vendor_name || null,
        resolved: !!r.vendor_resolved,
        spend: 0,
        line_count: 0,
        gl_split: { food: 0, packaging: 0, vehicle: 0, other: 0 },
      });
    }
    const v = byVendor.get(key);
    v.spend += Number(r.amount || 0);
    v.line_count += 1;
    const gl = String(r.gl_line_code || '');
    if (gl.startsWith('3200')) v.gl_split.food += Number(r.amount || 0);
    else if (gl.startsWith('3400')) v.gl_split.packaging += Number(r.amount || 0);
    else if (gl.startsWith('3500')) v.gl_split.vehicle += Number(r.amount || 0);
    else v.gl_split.other += Number(r.amount || 0);
  }
  const rows = [...byVendor.values()].sort((a, b) => b.spend - a.spend);
  const unresolved = rows.filter(r => !r.resolved).length;
  return { rows, totalCount: rows.length, totalAmt: rows.reduce((s, r) => s + r.spend, 0), unresolved };
}

// Vendor fragmentation: strip trailing " - <STATE>" (e.g. Sysco JUP) and count collapses.
function fragmentationStats(vendorRows) {
  const names = vendorRows.map(v => v.name).filter(Boolean);
  const suffixesToStrip = / (JUP|TBJ|TBR|CIN|MIA|SDR|STL|MYR|VIS|WPB|BAL|SLB|WOR|CLT|LKF|SRT|SOM|TAM|CLR|LKB|OAK|COL|OKC|KCK|WCH|GDR|TXR|ATL|LOU|HOU|SPR|ORL|DEN|AUS|ARL|IRV)$/i;
  // Or: last dash-separated token that is 2..4 uppercase letters
  const canonMap = new Map();
  for (const n of names) {
    const cleaned = n
      .replace(suffixesToStrip, '')
      .replace(/\s+-\s+[A-Z]{2,5}$/, '')
      .replace(/\s+[A-Z]{2,4}$/, '')
      .trim();
    if (!canonMap.has(cleaned)) canonMap.set(cleaned, new Set());
    canonMap.get(cleaned).add(n);
  }
  const fragmented = [...canonMap.entries()]
    .filter(([, set]) => set.size > 1)
    .map(([canon, set]) => ({ canonical: canon, variants: [...set] }))
    .sort((a, b) => b.variants.length - a.variants.length);
  return {
    distinctNames: names.length,
    suppliersIfCollapsed: canonMap.size,
    fragmented,
  };
}

async function main() {
  const [equip, rep, reimb, card, vendors] = await Promise.all([
    loadEquip(), loadRepair(), loadReimb(), loadCardCharges(), loadVendors()
  ]);
  console.log('=== EQUIP (5002.5) ===');
  console.log('total_count:', equip.totalCount, 'total_amount:', equip.totalAmt.toFixed(2), 'unresolved:', equip.unresolved);
  console.log('top 5:');
  for (const r of equip.rows.slice(0, 5)) console.log(' ', r.account_key, r.txn_date, Number(r.amount).toFixed(2), '|', r.vendor_name || `[unresolved:${r.vendor_id}]`);

  console.log('\n=== REPAIR (5002.1) ===');
  console.log('total_count:', rep.totalCount, 'total_amount:', rep.totalAmt.toFixed(2), 'unresolved:', rep.unresolved);
  for (const r of rep.rows.slice(0, 5)) console.log(' ', r.account_key, r.txn_date, Number(r.amount).toFixed(2), '|', r.vendor_name || `[unresolved:${r.vendor_id}]`);

  console.log('\n=== REIMB (13xx) ===');
  console.log('total_count:', reimb.totalCount, 'total_amount:', reimb.totalAmt.toFixed(2), 'unresolved:', reimb.unresolved);
  for (const r of reimb.rows.slice(0, 5)) console.log(' ', r.account_key, r.txn_date, Number(r.amount).toFixed(2), '|', r.vendor_name || `[unresolved:${r.vendor_id}]`);

  console.log('\n=== CARD CHARGES (rippling_spend, gl NULL) ===');
  console.log('total_count:', card.totalCount, 'total_amount:', card.totalAmt.toFixed(2));
  for (const r of card.rows.slice(0, 5)) console.log(' ', r.account_key, r.txn_date, Number(r.amount).toFixed(2), '|', r.vendor_or_merchant);

  console.log('\n=== VENDORS (billcom, per-vendor rollup) ===');
  console.log('total_count:', vendors.totalCount, 'total_amount:', vendors.totalAmt.toFixed(2), 'unresolved:', vendors.unresolved);
  for (const v of vendors.rows.slice(0, 8)) console.log(' ', v.resolved ? v.name : `[unresolved:${v.vendor_id}]`, 'spend:', v.spend.toFixed(2), 'lines:', v.line_count, 'food:', v.gl_split.food.toFixed(0), 'pkg:', v.gl_split.packaging.toFixed(0), 'veh:', v.gl_split.vehicle.toFixed(0), 'other:', v.gl_split.other.toFixed(0));

  console.log('\n=== VENDOR FRAGMENTATION ===');
  const frag = fragmentationStats(vendors.rows);
  console.log('distinct names:', frag.distinctNames);
  console.log('suppliers if suffixed stripped:', frag.suppliersIfCollapsed);
  console.log('fragmented (top 10):');
  for (const f of frag.fragmented.slice(0, 10)) {
    console.log(` -> ${f.canonical}: ${f.variants.length} variants:`, f.variants.join(', '));
  }
}
main().catch(e => { console.error(e); process.exit(2); });
