// G7 Section A: snapshot purchasing_actuals for determinism checking.
// Streams rows page-by-page, sorted by (source, source_line_id), and folds
// a stable SHA-256 hash over (source, account_key, gl_line_code, txn_date,
// amount, excluded, reason). Also reports count(*) and sum(amount).
//
// Usage: node --env-file=.env.local scripts/audit/g7_snapshot.mjs [tag]

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error('missing SUPABASE env'); process.exit(1); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const tag = process.argv[2] || new Date().toISOString();

async function main() {
  const t0 = Date.now();
  const PAGE = 1000;
  let start = 0;
  let count = 0;
  let sumCents = 0n;
  const hash = createHash('sha256');

  // Also keep a compact row-index for diffing: (source|source_line_id) -> stable row hash
  const perRowHashes = new Map();

  for (;;) {
    const { data, error } = await supa
      .from('purchasing_actuals')
      .select('source, source_line_id, source_bill_id, account_key, gl_line_code, txn_date, amount, excluded, reason')
      .order('source', { ascending: true })
      .order('source_line_id', { ascending: true })
      .range(start, start + PAGE - 1);
    if (error) { console.error('page fetch failed:', error.message); process.exit(2); }
    if (!data || data.length === 0) break;
    for (const r of data) {
      const key = `${r.source}\x1f${r.source_line_id ?? ''}`;
      // Build a stable per-row tuple. Amount to fixed 4dp to avoid float jitter.
      const amt = (r.amount == null) ? '' : Number(r.amount).toFixed(4);
      const tuple = [
        r.source ?? '',
        r.account_key ?? '',
        r.gl_line_code ?? '',
        r.txn_date ?? '',
        amt,
        r.excluded === true ? '1' : '0',
        r.reason ?? '',
      ].join('\x1e');
      const rowHash = createHash('sha256').update(tuple).digest('hex');
      hash.update(key + '\x1d' + rowHash + '\n');
      perRowHashes.set(key, { rowHash, tuple, source_bill_id: r.source_bill_id ?? '' });
      count += 1;
      if (r.amount != null && !r.excluded) {
        // sum in integer cents to keep exact
        const cents = BigInt(Math.round(Number(r.amount) * 100));
        sumCents += cents;
      }
    }
    if (data.length < PAGE) break;
    start += PAGE;
  }

  const digest = hash.digest('hex');
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  const sumDollars = (Number(sumCents) / 100).toFixed(2);

  const summary = {
    tag,
    count,
    sum_non_excluded_amount: sumDollars,
    checksum_sha256: digest,
    duration_sec: dur,
    generated_at: new Date().toISOString(),
  };
  console.log(JSON.stringify(summary, null, 2));

  // Persist row-level index to /tmp so we can diff later without re-querying.
  const fs = await import('node:fs/promises');
  const outPath = `/tmp/g7_snapshot_${tag}.json`;
  const rows = {};
  for (const [k, v] of perRowHashes) rows[k] = v;
  await fs.writeFile(outPath, JSON.stringify({ summary, rows }));
  console.error(`wrote row index to ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(2); });
