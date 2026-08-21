// G7 Section B: period boundary skew for card spend + bill.com posting-date
// field presence check. Measurement only. No fixes.
//
// Approach:
//   1. Compute 13 FY2026 period boundaries using periods.js FY_START (2025-12-29,
//      28-day widths). Boundary = end date of period N (inclusive). Boundary
//      day means: if engine's txn_date is boundary and real Purchased-at is
//      boundary+1, the row is misplaced into the wrong period.
//   2. For source='rippling_spend', excluded=false, count rows where txn_date
//      is within 1 day OR within 2 days of ANY internal boundary (a boundary
//      between two FY2026 periods). Report count + $ per period.
//   3. Join those "within 1 day" rows to CSV via parent_txn_id (source_bill_id
//      on rippling rows OR extracted from external_id or source_line_id).
//      Compare engine txn_date vs CSV "Purchased at". Count how many actually
//      cross a boundary.
//   4. Bill.com check: describe the raw payload to see if it carries a
//      separate posting-date field beyond invoice_date/txn_date.
//
// Rule 5: paginate; order before range. Rule 9 applies.

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error('missing env'); process.exit(1); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const CSV_PATH = '/Users/kevinfietek/Downloads/Custom_report-6a87456dd3e0e4d972a07439.csv';

// Mirror periods.js exactly [code-read]
const FY_START = new Date(Date.UTC(2025, 11, 29)); // 2025-12-29
const MS_PER_DAY = 86400000;
const DAYS_PER_PERIOD = 28;

function periodBoundaries() {
  // Return the 12 INTERNAL boundaries between adjacent FY2026 periods.
  // Boundary is the last day of period N (inclusive). If txn_date == boundary
  // and Purchased-at == boundary+1, the row is misplaced from period N+1 into
  // period N. If txn_date == boundary+1 and Purchased-at == boundary, it's
  // misplaced the other way.
  const b = [];
  for (let p = 1; p <= 12; p++) {
    // Period N end = FY_START + N*28 - 1 day (inclusive). Boundary is between
    // period N and period N+1.
    const endMs = FY_START.getTime() + (p * DAYS_PER_PERIOD - 1) * MS_PER_DAY;
    const dt = new Date(endMs);
    b.push({ periodEnd: p, iso: dt.toISOString().slice(0, 10), ms: endMs });
  }
  return b;
}

function periodOf(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  const days = Math.floor((d.getTime() - FY_START.getTime()) / MS_PER_DAY);
  if (days < 0) return null;
  const p = Math.floor(days / DAYS_PER_PERIOD) + 1;
  if (p < 1 || p > 13) return null;
  return p;
}

function daysBetween(iso1, iso2) {
  const d1 = new Date(iso1 + 'T00:00:00Z').getTime();
  const d2 = new Date(iso2 + 'T00:00:00Z').getTime();
  return Math.round((d2 - d1) / MS_PER_DAY);
}

const OBJECTID_HEX24 = /^[a-f0-9]{24}$/;
function parentIdFromRow(r) {
  // source_bill_id is populated from raw.parent_txn_id where present.
  if (r.source_bill_id && OBJECTID_HEX24.test(r.source_bill_id)) return r.source_bill_id.toLowerCase();
  // Fallback: derive from source_line_id "rippling_spend:<uuid>" - but the
  // parent hex comes from external_id, not from the rippling_id. We need to
  // load external_id separately if source_bill_id is empty.
  return null;
}

async function loadRipplingCardRows() {
  // source='rippling_spend', excluded=false. Also need external_id fallback.
  // Load in FY2026 window to bound the workload.
  const fyStartIso = '2025-12-29';
  const fyEndIso = '2026-12-27';
  const PAGE = 1000;
  let from = 0;
  const rows = [];
  for (;;) {
    const { data, error } = await supa
      .from('purchasing_actuals')
      .select('id, source_line_id, source_bill_id, txn_date, amount, excluded')
      .eq('source', 'rippling_spend')
      .eq('excluded', false)
      .gte('txn_date', fyStartIso)
      .lte('txn_date', fyEndIso)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) rows.push(r);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function loadExternalIdMap(riddingIds) {
  // For rippling rows without source_bill_id, load external_id from raw table.
  // rippling_id chunked at 100 to keep URL under limit.
  const map = new Map();
  const ids = [...riddingIds];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await supa
      .from('rippling_raw_spend_lines_latest')
      .select('rippling_id, external_id, parent_txn_id')
      .in('rippling_id', chunk);
    if (error) throw error;
    for (const r of data || []) map.set(r.rippling_id, r);
  }
  return map;
}

async function loadCsvParentMap() {
  // CSV header row 1. Transaction ID column 0, Purchased at column 1.
  // NEVER echo worker names. Only pull the two columns we need.
  const map = new Map(); // txn_id (lowercase) -> real ISO date
  const rl = readline.createInterface({ input: createReadStream(CSV_PATH), crlfDelay: Infinity });
  let header = null;
  let idIdx = -1, purIdx = -1;
  for await (const line of rl) {
    if (!header) {
      header = line.split(',');
      idIdx = header.findIndex(h => h.trim() === 'Transaction ID');
      purIdx = header.findIndex(h => h.trim() === 'Purchased at');
      if (idIdx < 0 || purIdx < 0) { throw new Error(`CSV cols not found: id=${idIdx} pur=${purIdx}`); }
      continue;
    }
    // Naive split - Transaction ID + Purchased at are early cols, unquoted.
    const cols = line.split(',');
    if (cols.length < Math.max(idIdx, purIdx) + 1) continue;
    const id = (cols[idIdx] || '').trim().toLowerCase();
    const pur = (cols[purIdx] || '').trim();
    if (!id) continue;
    // CSV format: "01/25/2026 11:03 PM MST" (US m/d/YYYY). Convert to ISO.
    // Also accept ISO defensively.
    let dateOnly = null;
    const usMatch = pur.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (usMatch) {
      const mm = usMatch[1].padStart(2, '0');
      const dd = usMatch[2].padStart(2, '0');
      dateOnly = `${usMatch[3]}-${mm}-${dd}`;
    } else {
      const first10 = pur.slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(first10)) dateOnly = first10;
    }
    if (!dateOnly) continue;
    if (!map.has(id)) map.set(id, dateOnly);
  }
  return map;
}

async function loadBillcomRawShape() {
  // Grab a small sample of billcom_raw_bills_latest raw payloads to check
  // for distinct posting-date fields.
  const { data, error } = await supa
    .from('billcom_raw_bills_latest')
    .select('bill_id, invoice_date, gl_posting_date, raw')
    .limit(5);
  if (error) throw error;
  return data || [];
}

async function main() {
  const boundaries = periodBoundaries();
  console.log('== Section B: period boundary skew ==');
  console.log('FY_START =', FY_START.toISOString().slice(0, 10), 'DAYS_PER_PERIOD =', DAYS_PER_PERIOD);
  console.log('boundaries (internal, 12 of them):');
  boundaries.forEach(b => console.log(`  end P${b.periodEnd} = ${b.iso}  (next period starts ${new Date(b.ms + MS_PER_DAY).toISOString().slice(0, 10)})`));

  console.log('\nLoading rippling_spend rows (excluded=false, FY2026)...');
  const rows = await loadRipplingCardRows();
  console.log('  rows loaded:', rows.length);

  // Per-period-boundary counts at 1-day and 2-day windows.
  // For each row, find nearest boundary; measure |txn_date - boundary_iso|.
  // If within 1 or 2 days, tally against that boundary.
  const perBoundary1 = new Map(); // periodEnd -> { count, dollars }
  const perBoundary2 = new Map();
  boundaries.forEach(b => {
    perBoundary1.set(b.periodEnd, { count: 0, dollars: 0 });
    perBoundary2.set(b.periodEnd, { count: 0, dollars: 0 });
  });

  const within1Rows = [];
  const withoutParent = [];
  for (const r of rows) {
    if (!r.txn_date) continue;
    const iso = String(r.txn_date).slice(0, 10);
    // Nearest boundary
    let bestB = null, bestDist = Infinity;
    for (const b of boundaries) {
      const d = Math.abs(daysBetween(b.iso, iso));
      if (d < bestDist) { bestDist = d; bestB = b; }
    }
    if (!bestB) continue;
    if (bestDist <= 1) {
      const s = perBoundary1.get(bestB.periodEnd);
      s.count++; s.dollars += Number(r.amount) || 0;
      within1Rows.push({ row: r, boundary: bestB, dist: bestDist });
    }
    if (bestDist <= 2) {
      const s = perBoundary2.get(bestB.periodEnd);
      s.count++; s.dollars += Number(r.amount) || 0;
    }
  }

  console.log('\n== Per-boundary counts (1-day window) ==');
  console.log('boundary_end_P | boundary_iso | rows_within_1d | dollars_within_1d');
  boundaries.forEach(b => {
    const s = perBoundary1.get(b.periodEnd);
    console.log(`  P${b.periodEnd} -> P${b.periodEnd + 1}  ${b.iso}   n=${s.count}  $${s.dollars.toFixed(2)}`);
  });

  console.log('\n== Per-boundary counts (2-day window) ==');
  console.log('boundary_end_P | boundary_iso | rows_within_2d | dollars_within_2d');
  boundaries.forEach(b => {
    const s = perBoundary2.get(b.periodEnd);
    console.log(`  P${b.periodEnd} -> P${b.periodEnd + 1}  ${b.iso}   n=${s.count}  $${s.dollars.toFixed(2)}`);
  });

  console.log('\n== Boundary CROSS check via CSV (1-day rows only) ==');
  console.log(`  rows in 1-day window: ${within1Rows.length}`);

  // Load external_ids for those without source_bill_id
  const needExt = new Set();
  const ridToRow = new Map();
  for (const it of within1Rows) {
    const parent = parentIdFromRow(it.row);
    if (!parent) {
      // source_line_id is "rippling_spend:<uuid>"
      const rid = it.row.source_line_id?.startsWith('rippling_spend:')
        ? it.row.source_line_id.slice('rippling_spend:'.length) : null;
      if (rid) { needExt.add(rid); ridToRow.set(rid, it); }
      else { withoutParent.push(it.row); }
    }
  }
  console.log(`  needing external_id lookup: ${needExt.size}`);
  const extMap = needExt.size ? await loadExternalIdMap(needExt) : new Map();
  // Fill in parent from external_id fallback
  const parentByItem = new Map(); // idx -> parent
  within1Rows.forEach((it, idx) => {
    let p = parentIdFromRow(it.row);
    if (!p && it.row.source_line_id?.startsWith('rippling_spend:')) {
      const rid = it.row.source_line_id.slice('rippling_spend:'.length);
      const raw = extMap.get(rid);
      if (raw?.parent_txn_id && OBJECTID_HEX24.test(String(raw.parent_txn_id))) {
        p = String(raw.parent_txn_id).toLowerCase();
      } else if (raw?.external_id) {
        const tok = String(raw.external_id).split('__')[0]?.toLowerCase();
        if (tok && OBJECTID_HEX24.test(tok)) p = tok;
      }
    }
    if (p) parentByItem.set(idx, p);
  });
  const parentSet = new Set(parentByItem.values());
  console.log(`  distinct parent ids to look up in CSV: ${parentSet.size}`);

  console.log('\nLoading CSV parent map (worker names NOT read)...');
  const csvMap = await loadCsvParentMap();
  console.log('  CSV parent map size:', csvMap.size);

  // For each within-1d row, look up CSV real date and check if it crosses a boundary.
  let matched = 0, unmatched = 0, actuallyCross = 0, sameSide = 0;
  const crossExamples = [];
  const perBoundaryCross = new Map();
  boundaries.forEach(b => perBoundaryCross.set(b.periodEnd, { engineSide: 0, csvSide: 0, dollars: 0 }));
  const withoutMatch = [];
  for (let i = 0; i < within1Rows.length; i++) {
    const it = within1Rows[i];
    const p = parentByItem.get(i);
    if (!p) { unmatched++; continue; }
    const realIso = csvMap.get(p);
    if (!realIso) { unmatched++; withoutMatch.push(p); continue; }
    matched++;
    const engineIso = String(it.row.txn_date).slice(0, 10);
    const engineP = periodOf(engineIso);
    const csvP = periodOf(realIso);
    if (engineP != null && csvP != null && engineP !== csvP) {
      actuallyCross++;
      const b = it.boundary;
      const s = perBoundaryCross.get(b.periodEnd);
      s.engineSide++;
      s.dollars += Number(it.row.amount) || 0;
      if (crossExamples.length < 10) {
        crossExamples.push({
          parent: p,
          engine_txn: engineIso,
          engine_p: engineP,
          csv_pur: realIso,
          csv_p: csvP,
          amount: Number(it.row.amount).toFixed(2),
          boundary_iso: b.iso,
        });
      }
    } else {
      sameSide++;
    }
  }
  console.log(`  matched to CSV: ${matched}, unmatched: ${unmatched}`);
  console.log(`  actually cross a boundary (engine period != CSV period): ${actuallyCross}`);
  console.log(`  same side: ${sameSide}`);
  console.log(`  unmatched-parent examples (up to 5): ${withoutMatch.slice(0, 5).join(', ')}`);
  console.log('\n  per-boundary CROSS counts + dollars:');
  boundaries.forEach(b => {
    const s = perBoundaryCross.get(b.periodEnd);
    if (s.engineSide > 0) console.log(`    P${b.periodEnd} -> P${b.periodEnd + 1}  ${b.iso}   crosses=${s.engineSide}  $${s.dollars.toFixed(2)}`);
  });
  console.log('\n  cross examples (parent, engine_txn / engine_p, csv_pur / csv_p, amount, boundary):');
  crossExamples.forEach(e => console.log(`    ${e.parent}  eng=${e.engine_txn}(P${e.engine_p})  csv=${e.csv_pur}(P${e.csv_p})  $${e.amount}  bdry=${e.boundary_iso}`));

  console.log('\n== Bill.com date-field check ==');
  const bcSample = await loadBillcomRawShape();
  console.log(`  loaded ${bcSample.length} sample bills`);
  bcSample.forEach((b, idx) => {
    const rawKeys = b.raw && typeof b.raw === 'object' ? Object.keys(b.raw) : [];
    const dateKeys = rawKeys.filter(k => /date/i.test(k));
    console.log(`  sample ${idx + 1}: bill_id=${b.bill_id}  invoice_date=${b.invoice_date}  gl_posting_date=${b.gl_posting_date}`);
    console.log(`    raw date-like keys: ${dateKeys.join(', ')}`);
    // Print those key values (they're the source of the columns, so likely = invoice_date etc.)
    dateKeys.forEach(k => console.log(`      raw.${k} = ${JSON.stringify(b.raw[k])}`));
  });

  // Count how many billcom_raw_bills_latest rows have distinct invoice_date vs gl_posting_date.
  const distinctResp = await supa
    .from('billcom_raw_bills_latest')
    .select('bill_id, invoice_date, gl_posting_date', { count: 'exact', head: false })
    .limit(1);
  // Do a paginated scan for distinctness stats.
  let bcTot = 0, bcHavePosting = 0, bcDistinct = 0, bcMaxDelta = 0;
  {
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await supa
        .from('billcom_raw_bills_latest')
        .select('bill_id, invoice_date, gl_posting_date')
        .order('bill_id')
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data) {
        bcTot++;
        if (r.gl_posting_date) bcHavePosting++;
        if (r.invoice_date && r.gl_posting_date && r.invoice_date !== r.gl_posting_date) {
          bcDistinct++;
          const d = Math.abs(daysBetween(r.invoice_date, r.gl_posting_date));
          if (d > bcMaxDelta) bcMaxDelta = d;
        }
      }
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }
  console.log(`\n  billcom_raw_bills_latest totals: ${bcTot} rows, ${bcHavePosting} have gl_posting_date, ${bcDistinct} have invoice_date != gl_posting_date, max delta = ${bcMaxDelta} days`);
  console.log('  NOTE: purchasing_actuals.txn_date for billcom = header.invoice_date; posting_date = header.gl_posting_date [code-read]');
  console.log('  So bill.com already carries a distinct posting field on the fact row; the engine populates BOTH.');
}

main().catch(e => { console.error(e); process.exit(2); });
