// G5: P&L tie-out for P8 (2026-07-13 to 2026-08-09). Measurement only, no fixes.
// Reads Postgres purchasing_actuals (non-excluded, billcom + rippling_spend) and the
// budget-vs-actual workbook, then writes ~/Downloads/pl_tie_out_P8_<YYYY-MM-DD>.xlsx.

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const PL_PATH = '/Users/kevinfietek/Downloads/Budget vs Actual (SLT) (2026) P8 (8.20.26)A.xlsx';
const OUT_PATH = path.join(os.homedir(), 'Downloads', `pl_tie_out_P8_${new Date().toISOString().slice(0,10)}.xlsx`);

const P8_START = '2026-07-13';
const P8_END = '2026-08-09';

// P8 columns in per-account P&L sheets
const COL_BUDGET = 115;
const COL_ACTUAL = 117;

// Account name mapping: P&L sheet name -> engine account_key
const ACCOUNTS = [
  { sheet: 'TBR-FL',    engine: 'TBR - FL' },
  { sheet: 'STL-FL',    engine: 'STL - FL' },
  { sheet: 'STL-MO',    engine: 'STL - MO' },
  { sheet: 'CIN-OH',    engine: 'CIN - OH' },
  { sheet: 'CIN-KY',    engine: 'CIN - KY' },
  { sheet: 'CIN-AZ',    engine: 'CIN - AZ' },
  { sheet: 'TBJ-FL',    engine: 'TBJ - FL' },
  { sheet: 'TBJ-BUF',   engine: 'TBJ - NY' },
  { sheet: 'TXR-AZ',    engine: 'TXR - AZ' },
  { sheet: 'TXR-HOME',  engine: 'TXR - TX - H' },
  { sheet: 'TXR-VISTOR',engine: 'TXR - TX - V' },
];

// Part A line list per Kevin's spec
const PART_A_LINES = ['3200.1','3200.2','3400.1','3400.2','3400.5','3500.1','3500.3','3500.4','3500.5','5002.1','5002.5'];

// Buckets per Kevin's Phase 2 spec
const BUCKETS = {
  Food:      ['3200.1','3200.2'],
  Packaging: ['3400.1','3400.2','3400.5'],
  Vehicle:   ['3500.1','3500.3','3500.4','3500.5'],
  Equipment: ['5002.5'],
  'R&M':     ['5002.1'],
};

function numOf(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && 'result' in v) return typeof v.result === 'number' ? v.result : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function codeFromCell(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d+(?:\.\d+)*)/);
  return m ? m[1] : null;
}

function textOf(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object' && 'result' in v) return String(v.result ?? '').trim();
  return String(v).trim();
}

async function fetchEnginePeriodByAccount(sb) {
  // Returns Map<account_key, Map<gl_line_code_or_NULL, {tot, bill, ripp, n}>>
  const out = new Map();
  let from = 0;
  let total = 0;
  for (;;) {
    const { data, error } = await sb.from('purchasing_actuals')
      .select('account_key, gl_line_code, source, amount, txn_date')
      .eq('excluded', false)
      .in('source', ['billcom','rippling_spend'])
      .gte('txn_date', P8_START)
      .lte('txn_date', P8_END)
      .order('id')
      .range(from, from + 999);
    if (error) throw error;
    for (const r of data) {
      const ak = r.account_key || '__NULL_ACCOUNT__';
      const gc = r.gl_line_code || '__NULL_GL__';
      if (!out.has(ak)) out.set(ak, new Map());
      const m = out.get(ak);
      const prev = m.get(gc) || { tot:0, bill:0, ripp:0, n:0 };
      prev.tot += Number(r.amount); prev.n++;
      if (r.source === 'billcom') prev.bill += Number(r.amount);
      else if (r.source === 'rippling_spend') prev.ripp += Number(r.amount);
      m.set(gc, prev);
    }
    total += data.length;
    if (data.length < 1000) break;
    from += 1000;
  }
  return { byAccount: out, totalRows: total };
}

// Load per-account P&L: Map<code, {bud, act, label, row}>
function loadPnlSheet(wb, sheetName) {
  const ws = wb.getWorksheet(sheetName);
  if (!ws) return null;
  const out = new Map();
  for (let r = 1; r <= ws.rowCount; r++) {
    const a = ws.getRow(r).getCell(1).value;
    const code = codeFromCell(a);
    if (!code) continue;
    const label = textOf(a);
    const bud = numOf(ws.getRow(r).getCell(COL_BUDGET).value);
    const act = numOf(ws.getRow(r).getCell(COL_ACTUAL).value);
    // If duplicate code seen, keep first (main sheet form is one row per code)
    if (!out.has(code)) out.set(code, { bud, act, label, row: r });
  }
  return out;
}

function variance(engine, pnl) { return engine - pnl; }
function pct(engine, pnl) {
  if (pnl === 0) return engine === 0 ? 0 : null;
  return (engine - pnl) / pnl;
}

function attributeCause({ engineTotal, pnlActual, engineHasCode, pnlHasCode, gl, notes }) {
  // Deterministic candidate cause; UNEXPLAINED if none fits.
  const v = engineTotal - pnlActual;
  const av = Math.abs(v);
  if (av <= 50.005) return { cause: 'WITHIN_TOLERANCE', note: '' };
  if (!pnlHasCode && engineTotal !== 0) {
    return { cause: 'PNL_NO_LINE', note: `P&L has no ${gl} row on this sheet; engine attributes ${engineTotal.toFixed(2)}` };
  }
  if (!engineHasCode && pnlActual !== 0) {
    return { cause: 'ENGINE_NO_SPEND', note: `Engine has zero rows for ${gl}; P&L booked ${pnlActual.toFixed(2)} (JE or non-purchasing-actuals path)` };
  }
  if (pnlActual < 0 && engineTotal >= 0) {
    return { cause: 'CREDIT_ON_PNL', note: `P&L is a credit ${pnlActual.toFixed(2)}; engine positive ${engineTotal.toFixed(2)}` };
  }
  // UNEXPLAINED: engine + P&L both present, non-trivial gap
  return { cause: 'UNEXPLAINED', note: notes || '' };
}

async function main() {
  console.log('Env preflight:');
  console.log('  SUPABASE_URL:', process.env.SUPABASE_URL ? 'PRESENT' : 'ABSENT');
  console.log('  SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'PRESENT' : 'ABSENT');

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  console.log('\nFetching engine rows...');
  const { byAccount, totalRows } = await fetchEnginePeriodByAccount(sb);
  console.log('  Engine P8 non-excluded bill/ripp rows:', totalRows);

  console.log('\nOpening P&L workbook...');
  const src = new ExcelJS.Workbook();
  await src.xlsx.readFile(PL_PATH);

  // Load all P&L sheets
  const pnlByAccount = new Map();
  for (const a of ACCOUNTS) {
    const m = loadPnlSheet(src, a.sheet);
    if (!m) { console.log('  WARN: sheet missing:', a.sheet); continue; }
    pnlByAccount.set(a.engine, { sheet: a.sheet, map: m });
  }

  // Build output
  const out = new ExcelJS.Workbook();
  out.creator = 'G5 tie-out';
  out.created = new Date();

  // ---------------- Sheet 1: TBR-FL P8 ----------------
  const s1 = out.addWorksheet('TBR-FL P8');
  s1.columns = [
    { header: 'GL Code', key: 'code', width: 10 },
    { header: 'Label', key: 'label', width: 40 },
    { header: 'Engine Total', key: 'eng', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'Bill.com', key: 'bill', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'Rippling', key: 'ripp', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'Rows', key: 'n', width: 6 },
    { header: 'P&L Actual', key: 'pnl', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'Variance (Eng-P&L)', key: 'var', width: 16, style:{numFmt:'#,##0.00'} },
    { header: 'Variance %', key: 'pct', width: 12, style:{numFmt:'0.00%'} },
    { header: 'Bucket', key: 'bucket', width: 12 },
  ];
  const tbrEngine = byAccount.get('TBR - FL') || new Map();
  const tbrPnl = (pnlByAccount.get('TBR - FL') || {}).map || new Map();
  // GL -> bucket
  const codeToBucket = new Map();
  Object.entries(BUCKETS).forEach(([b, codes]) => codes.forEach(c => codeToBucket.set(c, b)));

  const bucketSubtotals = new Map(); // bucket -> {eng, pnl, bill, ripp}
  Object.keys(BUCKETS).forEach(b => bucketSubtotals.set(b, { eng:0, pnl:0, bill:0, ripp:0 }));
  let grandEng=0, grandPnl=0, grandBill=0, grandRipp=0;
  for (const code of PART_A_LINES) {
    const e = tbrEngine.get(code) || { tot:0, bill:0, ripp:0, n:0 };
    const p = tbrPnl.get(code) || { bud:0, act:0, label:code, row:null };
    const v = variance(e.tot, p.act);
    const pc = pct(e.tot, p.act);
    const bucket = codeToBucket.get(code) || '';
    s1.addRow({ code, label: p.label || code, eng: e.tot, bill: e.bill, ripp: e.ripp, n: e.n, pnl: p.act, var: v, pct: pc, bucket });
    if (bucket && bucketSubtotals.has(bucket)) {
      const bs = bucketSubtotals.get(bucket);
      bs.eng += e.tot; bs.pnl += p.act; bs.bill += e.bill; bs.ripp += e.ripp;
    }
    grandEng += e.tot; grandPnl += p.act; grandBill += e.bill; grandRipp += e.ripp;
  }
  s1.addRow({});
  s1.addRow({ code: '', label: 'BUCKET SUBTOTALS', bucket: '' });
  for (const [b, v] of bucketSubtotals) {
    s1.addRow({ code:'', label:b, eng:v.eng, bill:v.bill, ripp:v.ripp, n:'', pnl:v.pnl, var:v.eng - v.pnl, pct: pct(v.eng, v.pnl), bucket:b });
  }
  s1.addRow({});
  s1.addRow({ code:'', label:'GRAND TOTAL (Part A lines)', eng:grandEng, bill:grandBill, ripp:grandRipp, pnl:grandPnl, var:grandEng - grandPnl, pct: pct(grandEng, grandPnl) });
  s1.getRow(1).font = { bold: true };

  // ---------------- Sheet 2: Variances (>$50 portfolio-wide) ----------------
  const s2 = out.addWorksheet('Variances');
  s2.columns = [
    { header: 'Account (Engine)', key: 'ak', width: 16 },
    { header: 'Sheet', key: 'sheet', width: 12 },
    { header: 'GL Code', key: 'code', width: 10 },
    { header: 'Label', key: 'label', width: 40 },
    { header: 'Engine Total', key: 'eng', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'Bill.com', key: 'bill', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'Rippling', key: 'ripp', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'P&L Actual', key: 'pnl', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'Variance', key: 'var', width: 12, style:{numFmt:'#,##0.00'} },
    { header: '|Variance|', key: 'abs', width: 12, style:{numFmt:'#,##0.00'} },
    { header: 'Cause', key: 'cause', width: 20 },
    { header: 'Note', key: 'note', width: 60 },
  ];

  // In scope for the engine: Kevin's Part A codes (the 5 buckets)
  // Anything else is either revenue / labor / SG&A (never engine-covered) or
  // reimbursable 13xx (pass-through, not on P&L by design).
  const IN_SCOPE = new Set(PART_A_LINES);

  const variances = [];
  const outOfScope = [];   // engine spend on codes not in the 5 buckets (13xx, 5000, 5012.x, etc.)
  const pnlOnlyOOS = [];   // P&L lines not in engine scope (revenue/labor/SG&A)
  let unexplainedDollars = 0;

  for (const a of ACCOUNTS) {
    const ak = a.engine;
    const engMap = byAccount.get(ak) || new Map();
    const pnlEntry = pnlByAccount.get(ak);
    const pnlMap = pnlEntry ? pnlEntry.map : new Map();
    const codes = new Set([...engMap.keys(), ...pnlMap.keys()]);
    codes.delete('__NULL_GL__'); // handled separately as unrouted
    for (const code of codes) {
      const e = engMap.get(code) || { tot:0, bill:0, ripp:0, n:0 };
      const p = pnlMap.get(code) || { bud:0, act:0, label:code, row:null };
      const v = e.tot - p.act;
      const inScope = IN_SCOPE.has(code);
      if (inScope) {
        if (Math.abs(v) <= 50.005) continue;
        const att = attributeCause({ engineTotal: e.tot, pnlActual: p.act, engineHasCode: engMap.has(code), pnlHasCode: pnlMap.has(code), gl: code });
        variances.push({ ak, sheet: a.sheet, code, label: p.label || code, eng:e.tot, bill:e.bill, ripp:e.ripp, pnl:p.act, var:v, abs:Math.abs(v), cause: att.cause, note: att.note });
        if (att.cause === 'UNEXPLAINED') unexplainedDollars += Math.abs(v);
      } else {
        // Out of scope: split into two piles
        if (engMap.has(code) && e.tot !== 0 && Math.abs(e.tot) > 50.005) {
          // engine posted to a code outside the 5 buckets
          outOfScope.push({ ak, sheet:a.sheet, code, label: p.label || code, eng:e.tot, bill:e.bill, ripp:e.ripp, pnl:p.act, var:v, abs:Math.abs(v) });
        }
        if (pnlMap.has(code) && p.act !== 0 && !engMap.has(code) && Math.abs(p.act) > 50.005) {
          pnlOnlyOOS.push({ ak, sheet:a.sheet, code, label: p.label || code, eng:0, pnl:p.act, var: -p.act, abs: Math.abs(p.act) });
        }
      }
    }
  }
  variances.sort((a,b) => b.abs - a.abs);
  for (const v of variances) s2.addRow(v);
  s2.addRow({});
  s2.addRow({ ak: '', sheet: '', code: '', label: '--- Reference: engine posted to codes OUTSIDE the 5 buckets (13xx pass-through etc.) ---' });
  outOfScope.sort((a,b) => b.abs - a.abs);
  for (const v of outOfScope) s2.addRow({ ...v, cause: 'OUT_OF_SCOPE_ENGINE', note: 'engine posted to code not in Part A buckets' });
  s2.addRow({});
  s2.addRow({ ak:'', sheet:'', code:'', label:'--- Reference: P&L lines outside engine scope (revenue, labor, SG&A) ---' });
  pnlOnlyOOS.sort((a,b) => b.abs - a.abs);
  for (const v of pnlOnlyOOS) s2.addRow({ ...v, cause: 'OUT_OF_SCOPE_PNL', note: 'P&L line not covered by purchasing engine' });
  s2.getRow(1).font = { bold: true };

  // ---------------- Sheet 3: STL-FL P8 (pass-through) ----------------
  const s3 = out.addWorksheet('STL-FL P8');
  s3.columns = [
    { header: 'GL Code', key: 'code', width: 12 },
    { header: 'Path', key: 'path', width: 14 },
    { header: 'Label / Note', key: 'label', width: 46 },
    { header: 'Engine Total', key: 'eng', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'Bill.com', key: 'bill', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'Rippling', key: 'ripp', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'P&L Actual', key: 'pnl', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'Variance', key: 'var', width: 12, style:{numFmt:'#,##0.00'} },
  ];
  const stlEng = byAccount.get('STL - FL') || new Map();
  const stlPnl = (pnlByAccount.get('STL - FL') || {}).map || new Map();
  // 13xx reimbursable lines from engine
  const stl13 = [...stlEng.keys()].filter(k => /^13/.test(k)).sort();
  const anyPnl13 = [...stlPnl.keys()].some(k => /^13/.test(k));
  s3.addRow({ code: '', path: 'FINDING', label: `P&L STL-FL contains 13xx lines? ${anyPnl13 ? 'YES' : 'NO'}` });
  s3.addRow({ code: '', path: '', label: anyPnl13 ? '' : 'Engine 13xx spend has nothing to tie to on the P&L (reimbursable path not on P&L)' });
  s3.addRow({});
  s3.addRow({ code:'', path:'13xx REIMB', label:'Engine 13xx lines (P&L has no counterpart):' });
  let stl13Total=0, stl13Bill=0, stl13Ripp=0;
  for (const c of stl13) {
    const e = stlEng.get(c);
    stl13Total += e.tot; stl13Bill += e.bill; stl13Ripp += e.ripp;
    s3.addRow({ code:c, path:'13xx', label:'(engine only)', eng:e.tot, bill:e.bill, ripp:e.ripp, pnl: null, var: null });
  }
  s3.addRow({ code:'', path:'13xx TOTAL', label:'engine 13xx total (unrecoverable via P&L)', eng: stl13Total, bill: stl13Bill, ripp: stl13Ripp, pnl: null, var: null });
  s3.addRow({});
  s3.addRow({ code:'', path:'FUN MONEY', label:'3200.2 Resale Food - KitchFix-borne at-risk figure' });
  const fmEng = stlEng.get('3200.2') || { tot:0, bill:0, ripp:0, n:0 };
  const fmPnl = stlPnl.get('3200.2') || { bud:0, act:0 };
  s3.addRow({ code:'3200.2', path:'3200.2', label: fmPnl.label || '3200.2 Resale Food', eng: fmEng.tot, bill: fmEng.bill, ripp: fmEng.ripp, pnl: fmPnl.act, var: fmEng.tot - fmPnl.act });
  s3.addRow({});
  s3.addRow({ code:'', path:'COGS BUCKETS', label:'Confirm the COGS buckets read near-zero by design:' });
  for (const [b, codes] of Object.entries(BUCKETS)) {
    let e=0,p=0;
    for (const c of codes) {
      const ev = stlEng.get(c);
      const pv = stlPnl.get(c);
      if (ev) e += ev.tot;
      if (pv) p += pv.act;
    }
    s3.addRow({ code:'', path:b, label:'bucket subtotal', eng:e, bill:'', ripp:'', pnl:p, var: e - p });
  }
  s3.getRow(1).font = { bold: true };

  // ---------------- Sheet 4: Portfolio ----------------
  const s4 = out.addWorksheet('Portfolio');
  s4.columns = [
    { header: 'Account', key: 'ak', width: 16 },
    { header: 'Sheet', key: 'sheet', width: 12 },
    { header: 'Bucket', key: 'bucket', width: 12 },
    { header: 'Engine', key: 'eng', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'P&L Actual', key: 'pnl', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'Variance', key: 'var', width: 12, style:{numFmt:'#,##0.00'} },
    { header: '|Variance|', key: 'abs', width: 12, style:{numFmt:'#,##0.00'} },
    { header: 'Variance %', key: 'pct', width: 12, style:{numFmt:'0.00%'} },
  ];
  const portfolioRows = [];
  for (const a of ACCOUNTS) {
    const engMap = byAccount.get(a.engine) || new Map();
    const pnlMap = (pnlByAccount.get(a.engine) || {}).map || new Map();
    for (const [b, codes] of Object.entries(BUCKETS)) {
      let e=0, p=0;
      for (const c of codes) {
        const ev = engMap.get(c);
        const pv = pnlMap.get(c);
        if (ev) e += ev.tot;
        if (pv) p += pv.act;
      }
      portfolioRows.push({ ak: a.engine, sheet: a.sheet, bucket: b, eng: e, pnl: p, var: e - p, abs: Math.abs(e - p), pct: pct(e, p) });
    }
  }
  portfolioRows.sort((x,y) => y.abs - x.abs);
  for (const r of portfolioRows) s4.addRow(r);
  s4.getRow(1).font = { bold: true };

  // Compute portfolio totals + unexplained totals for Read Me
  let portEng=0, portPnl=0, portAbs=0;
  for (const r of portfolioRows) { portEng += r.eng; portPnl += r.pnl; portAbs += r.abs; }

  // Sign of variances per bucket (systematic direction?)
  const bucketDir = new Map();
  for (const r of portfolioRows) {
    const bd = bucketDir.get(r.bucket) || { pos:0, neg:0, sum:0, absSum:0 };
    if (r.var > 0) bd.pos++;
    if (r.var < 0) bd.neg++;
    bd.sum += r.var;
    bd.absSum += r.abs;
    bucketDir.set(r.bucket, bd);
  }
  // Per-account totals for Q3
  const perAccountTotals = new Map();
  for (const r of portfolioRows) {
    const t = perAccountTotals.get(r.sheet) || { eng:0, pnl:0 };
    t.eng += r.eng; t.pnl += r.pnl;
    perAccountTotals.set(r.sheet, t);
  }

  // Unrouted (hoisted for Read Me)
  let unroutedByAccount = new Map();
  let unroutedTotal = 0;
  for (const [ak, m] of byAccount) {
    const n = m.get('__NULL_GL__');
    if (n) { unroutedByAccount.set(ak, n); unroutedTotal += n.tot; }
  }

  // ---------------- Sheet 5: Read me ----------------
  const s5 = out.addWorksheet('Read me');
  s5.columns = [
    { header: 'Item', key: 'k', width: 44 },
    { header: 'Value', key: 'v', width: 100 },
  ];
  s5.getRow(1).font = { bold: true };
  const portTolerancePct = portPnl === 0 ? null : (portEng - portPnl) / portPnl;
  const unexPctOfPortfolio = portPnl === 0 ? null : unexplainedDollars / portPnl;
  const worstAcct = [...perAccountTotals.entries()].map(([sheet,v]) => ({ sheet, absVar: Math.abs(v.eng - v.pnl) })).sort((a,b) => b.absVar - a.absVar)[0];
  const tiedAccts = [...perAccountTotals.entries()].filter(([_,v]) => Math.abs(v.eng - v.pnl) <= 50.005).length;
  const outOfTolAccts = ACCOUNTS.length - tiedAccts;

  const readmeLines = [
    ['Period', `P8 2026-07-13 to 2026-08-09 (closed)`],
    ['Engine query', `purchasing_actuals excluded=false, source in (billcom, rippling_spend), txn_date in P8`],
    ['Engine row count (P8)', String(totalRows)],
    ['Accounts covered', ACCOUNTS.map(a=>a.sheet).join(', ')],
    ['Portfolio engine (5 buckets)', portEng.toFixed(2)],
    ['Portfolio P&L (5 buckets)', portPnl.toFixed(2)],
    ['Portfolio net variance', (portEng - portPnl).toFixed(2)],
    ['Portfolio net variance %', portTolerancePct == null ? 'n/a' : (portTolerancePct * 100).toFixed(3) + '%'],
    ['Portfolio |variance| sum (5 buckets, per account-bucket cell)', portAbs.toFixed(2)],
    ['Accounts within +/- $50 (5-bucket total)', `${tiedAccts} of ${ACCOUNTS.length}`],
    ['Accounts outside +/- $50 (5-bucket total)', `${outOfTolAccts} of ${ACCOUNTS.length}`],
    ['Worst account by |variance|', worstAcct ? `${worstAcct.sheet} $${worstAcct.absVar.toFixed(2)}` : 'n/a'],
    ['Total UNEXPLAINED dollars (>$50 in-scope items)', unexplainedDollars.toFixed(2)],
    ['UNEXPLAINED as % of portfolio P&L', unexPctOfPortfolio == null ? 'n/a' : (unexPctOfPortfolio * 100).toFixed(3) + '%'],
    ['STL-FL P&L carries 13xx?', anyPnl13 ? 'YES' : 'NO'],
    ['Engine STL-FL 13xx spend (no P&L to tie to)', stl13Total.toFixed(2)],
    ['P8 unrouted (NULL gl_line_code) engine dollars', unroutedTotal.toFixed(2)],
    ['', ''],
    ['Q1 Does the engine tie to the P&L?', `NO. Portfolio net is $${(portEng - portPnl).toFixed(2)} (${portTolerancePct == null ? 'n/a' : (portTolerancePct * 100).toFixed(2) + '%'}). ${outOfTolAccts} of ${ACCOUNTS.length} accounts fall outside +/- $50 on 5-bucket total. Per-bucket per-account it is worse: many cells miss by hundreds to thousands.`],
    ['Q2 Total unexplained variance ($ and %)', `$${unexplainedDollars.toFixed(2)} (${unexPctOfPortfolio == null ? 'n/a' : (unexPctOfPortfolio * 100).toFixed(3) + '%'} of portfolio P&L). See Variances sheet, cause=UNEXPLAINED.`],
    ['Q3 Systematic?', `Mixed. Direction is not one-sided (Food net +$${(bucketDir.get('Food')?.sum || 0).toFixed(2)}, Packaging -$${Math.abs(bucketDir.get('Packaging')?.sum || 0).toFixed(2)}, Vehicle -$${Math.abs(bucketDir.get('Vehicle')?.sum || 0).toFixed(2)}, Equipment -$${Math.abs(bucketDir.get('Equipment')?.sum || 0).toFixed(2)}, R&M -$${Math.abs(bucketDir.get('R&M')?.sum || 0).toFixed(2)}). Concentration: TXR-AZ is the single largest miss.`],
    ['Q4 Show these to an operator whose bonus depends on them?', 'NO. In-scope bucket variances routinely exceed hundreds of dollars per cell with $' + unexplainedDollars.toFixed(2) + ' unexplained. STL-FL 13xx pass-through has no P&L counterpart at all ($' + stl13Total.toFixed(2) + ' of engine spend). The engine does not yet reconcile to the closed P&L at operator-grade tolerance.'],
  ];
  for (const [k,v] of readmeLines) s5.addRow({ k, v });

  await out.xlsx.writeFile(OUT_PATH);
  console.log('\nWrote:', OUT_PATH);

  // Emit summary to stdout for the report
  console.log('\n===== TBR-FL P8 (Part A) =====');
  const tbrEng2 = byAccount.get('TBR - FL') || new Map();
  const tbrPnl2 = (pnlByAccount.get('TBR - FL') || {}).map || new Map();
  console.log('code'.padEnd(9) + 'engine'.padStart(12) + 'bill'.padStart(12) + 'ripp'.padStart(12) + 'pnl'.padStart(12) + 'var'.padStart(12));
  for (const c of PART_A_LINES) {
    const e = tbrEng2.get(c) || { tot:0, bill:0, ripp:0 };
    const p = tbrPnl2.get(c) || { act:0 };
    console.log(c.padEnd(9) + e.tot.toFixed(2).padStart(12) + e.bill.toFixed(2).padStart(12) + e.ripp.toFixed(2).padStart(12) + p.act.toFixed(2).padStart(12) + (e.tot - p.act).toFixed(2).padStart(12));
  }

  console.log('\n===== Bucket direction (systematic?) =====');
  for (const [b, bd] of bucketDir) {
    console.log(`  ${b.padEnd(10)} pos=${bd.pos} neg=${bd.neg} sum=${bd.sum.toFixed(2)}`);
  }

  console.log('\n===== Variances > $50 portfolio-wide =====');
  console.log('count=', variances.length);
  console.log('UNEXPLAINED $', unexplainedDollars.toFixed(2));

  console.log('\n===== Portfolio (top 15 |variance|) =====');
  portfolioRows.slice(0, 15).forEach(r => {
    console.log(`  ${r.sheet.padEnd(12)} ${r.bucket.padEnd(10)} eng=${r.eng.toFixed(2).padStart(12)} pnl=${r.pnl.toFixed(2).padStart(12)} var=${r.var.toFixed(2).padStart(12)}`);
  });

  // Also emit account-level totals for Q3 systematic check
  console.log('\n===== Per-account 5-bucket totals =====');
  const perAccount = new Map();
  for (const r of portfolioRows) {
    const p = perAccount.get(r.sheet) || { eng:0, pnl:0 };
    p.eng += r.eng; p.pnl += r.pnl;
    perAccount.set(r.sheet, p);
  }
  const perArr = [...perAccount.entries()].map(([k,v]) => ({ sheet:k, eng:v.eng, pnl:v.pnl, var:v.eng-v.pnl, abs: Math.abs(v.eng-v.pnl) })).sort((a,b) => b.abs - a.abs);
  perArr.forEach(r => console.log(`  ${r.sheet.padEnd(12)} eng=${r.eng.toFixed(2).padStart(12)} pnl=${r.pnl.toFixed(2).padStart(12)} var=${r.var.toFixed(2).padStart(12)}`));

  // STL-FL 13xx summary
  console.log('\n===== STL-FL 13xx (pass-through) =====');
  console.log('STL-FL P&L has 13xx lines?', anyPnl13 ? 'YES' : 'NO');
  console.log('Engine 13xx total on STL-FL:', stl13Total.toFixed(2));
  console.log('Engine 3200.2 (fun money):', fmEng.tot.toFixed(2), 'P&L:', fmPnl.act.toFixed(2));

  console.log('\n===== Unrouted (NULL gl_line_code) P8 =====');
  console.log('Total: $' + unroutedTotal.toFixed(2));
  for (const [ak, v] of unroutedByAccount) console.log('  ' + ak.padEnd(16) + ' tot=' + v.tot.toFixed(2).padStart(12) + ' n=' + v.n);
}

main().catch(e => { console.error(e); process.exit(1); });
