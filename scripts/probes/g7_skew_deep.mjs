// Deep-dive on the 1-row skew: bill_id=00n01JCGGPCQTU8la48s line_id=bli01YTBBXNPMHkvbje8
// Trace why the derive left it out of purchasing_actuals.

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BILL_ID = '00n01JCGGPCQTU8la48s';
const LINE_ID = 'bli01YTBBXNPMHkvbje8';
const COA_ID = '0ca01BLSBGONTTKiqgos';
const CLASS_ID = 'cls01FITMWDEUUS4yjvx';
const VENDOR_ID = '00901YERJSOWIP2qwfne';

async function main() {
  // 1. Is the actg_class_id in the class-site-map?
  const csmResp = await sb.from('billcom_class_site_map')
    .select('actg_class_id, account_key, excluded')
    .eq('actg_class_id', CLASS_ID)
    .maybeSingle();
  console.log('billcom_class_site_map lookup:');
  console.log('  error:', csmResp.error?.message);
  console.log('  data:', JSON.stringify(csmResp.data));

  // Also look at the ref class row
  const refClassResp = await sb.from('billcom_ref_classes')
    .select('*')
    .eq('id', CLASS_ID)
    .maybeSingle();
  console.log('\nbillcom_ref_classes lookup:');
  console.log('  error:', refClassResp.error?.message);
  console.log('  data:', JSON.stringify(refClassResp.data));

  // 2. Is the chart_of_account_id in ref_accounts?
  const acctResp = await sb.from('billcom_ref_accounts')
    .select('id, account_number')
    .eq('id', COA_ID)
    .maybeSingle();
  console.log('\nbillcom_ref_accounts lookup:');
  console.log('  error:', acctResp.error?.message);
  console.log('  data:', JSON.stringify(acctResp.data));

  // 3. Vendor
  const vendResp = await sb.from('billcom_ref_vendors')
    .select('*')
    .eq('id', VENDOR_ID)
    .maybeSingle();
  console.log('\nbillcom_ref_vendors lookup:');
  console.log('  error:', vendResp.error?.message);
  console.log('  data:', JSON.stringify(vendResp.data));

  // 4. Look at the full bill header raw payload
  const hdrResp = await sb.from('billcom_raw_bills_latest')
    .select('*')
    .eq('bill_id', BILL_ID)
    .maybeSingle();
  console.log('\nbillcom_raw_bills_latest header:');
  if (hdrResp.error) console.log('  error:', hdrResp.error.message);
  else {
    const d = hdrResp.data;
    console.log(`  bill_id: ${d.bill_id}`);
    console.log(`  vendor_id: ${d.vendor_id}`);
    console.log(`  invoice_date: ${d.invoice_date}`);
    console.log(`  gl_posting_date: ${d.gl_posting_date}`);
    console.log(`  amount: ${d.amount}`);
    console.log(`  paid_amount: ${d.paid_amount}`);
    console.log(`  payment_status: ${d.payment_status}`);
    const rawKeys = d.raw ? Object.keys(d.raw) : [];
    console.log(`  raw keys: ${rawKeys.join(', ')}`);
    // Look for isActive / deletedTime / archivedTime / any status-like field
    for (const k of rawKeys) {
      const v = d.raw[k];
      if (/active|delete|archive|status/i.test(k)) console.log(`  raw.${k} = ${JSON.stringify(v)}`);
    }
  }

  // 5. Look at the raw line entry
  const lineResp = await sb.from('billcom_raw_bill_lines_latest')
    .select('*')
    .eq('line_id', LINE_ID)
    .maybeSingle();
  console.log('\nbillcom_raw_bill_lines_latest line:');
  if (lineResp.error) console.log('  error:', lineResp.error.message);
  else {
    console.log(`  keys: ${Object.keys(lineResp.data).join(', ')}`);
    for (const [k, v] of Object.entries(lineResp.data)) {
      if (typeof v !== 'object' || v === null) console.log(`  ${k}: ${JSON.stringify(v)}`);
    }
  }

  // 6. Check purchasing_derive_runs for events around when this bill was touched
  // Look for derive runs when this specific bill was touched. We can't tell from
  // the runs table which specific bills were touched. Instead, look at bill_id
  // presence in billcom_raw_bills (non-latest) for cadence info.
  const rawBillsResp = await sb.from('billcom_raw_bills')
    .select('bill_id, first_seen_at, current_hash, superseded_by, seen_hash')
    .eq('bill_id', BILL_ID)
    .limit(10);
  console.log('\nbillcom_raw_bills (non-latest) for this bill:');
  if (rawBillsResp.error) console.log('  error:', rawBillsResp.error.message);
  else {
    console.log(`  rows: ${rawBillsResp.data.length}`);
    for (const r of rawBillsResp.data) console.log(`    ${JSON.stringify(r)}`);
  }

  // 7. What columns does billcom_raw_bills have? Try select *
  const anyBillResp = await sb.from('billcom_raw_bills').select('*').limit(1);
  if (anyBillResp.error) console.log('billcom_raw_bills schema error:', anyBillResp.error.message);
  else if (anyBillResp.data.length > 0) console.log('billcom_raw_bills columns:', Object.keys(anyBillResp.data[0]).join(', '));

  // 8. Same for lines table
  const anyLineResp = await sb.from('billcom_raw_bill_lines').select('*').limit(1);
  if (anyLineResp.error) console.log('billcom_raw_bill_lines schema error:', anyLineResp.error.message);
  else if (anyLineResp.data.length > 0) console.log('billcom_raw_bill_lines columns:', Object.keys(anyLineResp.data[0]).join(', '));

  // 9. Was there a per-bill failure in the derive path? Look at derive-runs
  // history + counts. Compute: number of raw bills == number of distinct
  // source_bill_id in actuals for source=billcom. If mismatch = 1, this bill
  // is the one that failed.
  const distinctBills = new Set();
  {
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await sb.from('purchasing_actuals')
        .select('source_bill_id')
        .eq('source', 'billcom')
        .order('id')
        .range(from, from + PAGE - 1);
      if (error) { console.log('scan err', error.message); break; }
      if (!data || data.length === 0) break;
      for (const r of data) if (r.source_bill_id) distinctBills.add(r.source_bill_id);
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }
  console.log(`\ndistinct source_bill_id in purchasing_actuals (source=billcom): ${distinctBills.size}`);
  console.log(`billcom_raw_bills_latest count: (querying next)`);
  const rawBillCount = await sb.from('billcom_raw_bills_latest').select('bill_id', { count: 'exact', head: true });
  console.log(`  ${rawBillCount.count}`);

  console.log(`\nBILL_ID ${BILL_ID} in distinctBills? ${distinctBills.has(BILL_ID)}`);

  // 10. Look at other bills with this exact vendor + amount + date to check patterns
  const twinsResp = await sb.from('billcom_raw_bills_latest')
    .select('bill_id, vendor_id, invoice_date, amount, payment_status')
    .eq('vendor_id', VENDOR_ID)
    .order('invoice_date', { ascending: false })
    .limit(5);
  console.log('\nOther bills from same vendor (last 5):');
  if (twinsResp.error) console.log('  err', twinsResp.error.message);
  else for (const t of twinsResp.data) console.log(`  ${t.bill_id} ${t.invoice_date} $${t.amount} status=${t.payment_status}`);
}

main().catch(e => { console.error(e); process.exit(2); });
