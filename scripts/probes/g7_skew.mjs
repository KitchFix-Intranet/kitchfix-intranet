// G7 skew diagnostic: G6 Phase 2 noted billcom_raw_bill_lines_latest has 5,195
// rows and purchasing_actuals source='billcom' has 5,194 rows. Name the 1-row
// skew, don't assume. Find the specific source_line_id (or bill+line) that's
// in raw but not in actuals, describe its content, and trace the derive path
// to name why it doesn't make it to actuals.

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const PAGE = 1000;
async function loadAllRawLines() {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from('billcom_raw_bill_lines_latest')
      .select('line_id, bill_id, amount, chart_of_account_id, actg_class_id, description')
      .order('line_id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) rows.push(r);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function loadAllActualLineIds() {
  const set = new Set();
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from('purchasing_actuals')
      .select('source_line_id')
      .eq('source', 'billcom')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) set.add(r.source_line_id);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return set;
}

async function main() {
  console.log('Loading billcom raw lines...');
  const raw = await loadAllRawLines();
  console.log('  raw lines:', raw.length);

  console.log('Loading billcom actuals source_line_ids...');
  const actIds = await loadAllActualLineIds();
  console.log('  actuals source_line_ids (source=billcom):', actIds.size);

  // Missing: raw where "billcom:<line_id>" not in actuals set
  const missing = [];
  for (const r of raw) {
    const key = `billcom:${r.line_id}`;
    if (!actIds.has(key)) missing.push(r);
  }
  console.log(`\nMISSING FROM ACTUALS: ${missing.length} raw line(s)`);
  for (const m of missing) {
    console.log(`\n  line_id: ${m.line_id}`);
    console.log(`  bill_id: ${m.bill_id}`);
    console.log(`  amount: ${m.amount}`);
    console.log(`  chart_of_account_id: ${m.chart_of_account_id}`);
    console.log(`  actg_class_id: ${m.actg_class_id}`);
    console.log(`  description: ${JSON.stringify(m.description)}`);

    // Check if the bill header exists in _latest
    const hdrResp = await sb.from('billcom_raw_bills_latest')
      .select('bill_id, vendor_id, invoice_date, gl_posting_date, amount, paid_amount, payment_status')
      .eq('bill_id', m.bill_id).maybeSingle();
    if (hdrResp.error) console.log(`  header lookup error: ${hdrResp.error.message}`);
    else if (!hdrResp.data) console.log(`  HEADER MISSING FROM billcom_raw_bills_latest for bill_id ${m.bill_id}`);
    else console.log(`  header: invoice_date=${hdrResp.data.invoice_date} status=${hdrResp.data.payment_status} vendor_id=${hdrResp.data.vendor_id} amount=${hdrResp.data.amount}`);

    // Check how many raw lines exist for this bill vs actuals lines for this bill
    const allLinesResp = await sb.from('billcom_raw_bill_lines_latest')
      .select('line_id, amount, chart_of_account_id, actg_class_id')
      .eq('bill_id', m.bill_id);
    if (allLinesResp.error) console.log(`  bill-lines lookup error: ${allLinesResp.error.message}`);
    else {
      console.log(`  raw lines for this bill: ${allLinesResp.data.length}`);
      for (const l of allLinesResp.data) console.log(`    line ${l.line_id} amt=${l.amount} coa=${l.chart_of_account_id} class=${l.actg_class_id}`);
    }
    const actLinesResp = await sb.from('purchasing_actuals')
      .select('source_line_id, amount, gl_line_code, account_key, excluded, reason')
      .eq('source', 'billcom')
      .eq('source_bill_id', m.bill_id);
    if (actLinesResp.error) console.log(`  actual-lines lookup error: ${actLinesResp.error.message}`);
    else {
      console.log(`  actuals rows for this bill: ${actLinesResp.data.length}`);
      for (const a of actLinesResp.data) console.log(`    ${a.source_line_id} amt=${a.amount} gl=${a.gl_line_code} ak=${a.account_key} excl=${a.excluded}`);
    }

    // Check billcom_raw_bills (non-latest) for this bill_id
    const rawBillsResp = await sb.from('billcom_raw_bills')
      .select('bill_id, seen_at, superseded_at')
      .eq('bill_id', m.bill_id)
      .order('seen_at', { ascending: false })
      .limit(5);
    if (rawBillsResp.error) console.log(`  raw_bills lookup: ${rawBillsResp.error.message}`);
    else console.log(`  raw_bills header rows: ${rawBillsResp.data.length}, samples: ${JSON.stringify(rawBillsResp.data)}`);

    // Check billcom_raw_bill_lines (non-latest)
    const rawLinesResp = await sb.from('billcom_raw_bill_lines')
      .select('line_id, bill_id, seen_at')
      .eq('line_id', m.line_id)
      .order('seen_at', { ascending: false })
      .limit(5);
    if (rawLinesResp.error) console.log(`  raw_bill_lines lookup: ${rawLinesResp.error.message}`);
    else console.log(`  raw_bill_lines rows (non-latest) for this line_id: ${rawLinesResp.data.length}, samples: ${JSON.stringify(rawLinesResp.data)}`);

    // Also look at derive_runs for anomalies
    const drResp = await sb.from('purchasing_derive_runs')
      .select('id, source, fetch_source, status, error_message, started_at, completed_at, bills_touched, lines_written')
      .eq('source', 'billcom')
      .order('started_at', { ascending: false })
      .limit(3);
    if (!drResp.error) console.log(`  last 3 billcom derive_runs: ${JSON.stringify(drResp.data)}`);
  }

  // Reverse: any actuals rows for source=billcom that DON'T have a raw line?
  const rawLineIds = new Set(raw.map(r => `billcom:${r.line_id}`));
  const orphanActuals = [...actIds].filter(id => !rawLineIds.has(id));
  console.log(`\nActuals rows without a raw line: ${orphanActuals.length}`);
  if (orphanActuals.length > 0 && orphanActuals.length <= 10) {
    for (const id of orphanActuals) console.log(`  ${id}`);
  } else if (orphanActuals.length > 10) {
    console.log(`  first 10: ${orphanActuals.slice(0, 10).join(', ')}`);
  }
}

main().catch(e => { console.error(e); process.exit(2); });
