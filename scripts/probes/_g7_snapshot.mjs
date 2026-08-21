// G7 Section A - stable checksum snapshot for purchasing_actuals.
//
// Sorts by (source, source_line_id) ascending, paginated 1000/page.
// Hashes each row into a running SHA-256 over the tuple:
//   (source, account_key||'', gl_line_code||'', txn_date||'', amount, excluded, reason||'')
// NO timestamps, NO serial ids.
//
// Also reports:
//   count(*), sum(amount) - both non-excluded and total
//
// Usage: node --env-file=... _g7_snapshot.mjs <label>
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const label = process.argv[2] || 'unlabeled';
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PAGE = 1000;
const hash = crypto.createHash('sha256');

let total = 0;
let sumAll = 0;     // total amount (all rows)
let sumNonExc = 0;  // non-excluded amount
let countAll = 0;
let countNonExc = 0;

// Also stream ALL rows into a rowbook file so we can pairwise-diff later.
// Path: /tmp/g7_snap_<label>.jsonl - one JSON object per line, sorted.
import fs from 'node:fs';
const outPath = `/tmp/g7_snap_${label}.jsonl`;
const outStream = fs.createWriteStream(outPath, { flags: 'w' });

const t0 = Date.now();
let from = 0;
for (;;) {
  const { data, error } = await supa
    .from('purchasing_actuals')
    .select('source, source_line_id, account_key, gl_line_code, txn_date, amount, excluded, reason')
    .order('source', { ascending: true })
    .order('source_line_id', { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) { console.error('SNAPSHOT ERROR:', error.message); process.exit(1); }
  if (!data || data.length === 0) break;
  for (const r of data) {
    // Build stable tuple string.
    const tuple = [
      r.source,
      r.account_key || '',
      r.gl_line_code || '',
      r.txn_date || '',
      String(r.amount),
      r.excluded ? '1' : '0',
      r.reason || '',
    ].join('|');
    hash.update(tuple);
    hash.update('\n');
    const amt = Number(r.amount) || 0;
    sumAll += amt;
    countAll += 1;
    if (!r.excluded) {
      sumNonExc += amt;
      countNonExc += 1;
    }
    // Persist for row-level diff.
    outStream.write(JSON.stringify({
      source: r.source,
      source_line_id: r.source_line_id,
      account_key: r.account_key,
      gl_line_code: r.gl_line_code,
      txn_date: r.txn_date,
      amount: r.amount,
      excluded: r.excluded,
      reason: r.reason,
    }) + '\n');
    total += 1;
  }
  if (data.length < PAGE) break;
  from += PAGE;
}
outStream.end();
const dur = ((Date.now() - t0) / 1000).toFixed(1);

const sha = hash.digest('hex');
console.log(`snapshot label=${label}`);
console.log(`  total_rows=${total}  duration=${dur}s`);
console.log(`  count_all=${countAll}       sum_all=${sumAll.toFixed(2)}`);
console.log(`  count_non_excluded=${countNonExc}  sum_non_excluded=${sumNonExc.toFixed(2)}`);
console.log(`  sha256=${sha}`);
console.log(`  rowbook=${outPath}`);
