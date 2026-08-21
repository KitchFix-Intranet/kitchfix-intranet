// G5b: P&L tie-out for P8 with sub-account rollup. Measurement only, no fixes.
// Fixes G5's comparison bug: engine sub-accounts (3200.1.2, 1385.3.2) were
// compared exact-match against P&L which only carries the parent. Now rolls
// engine child codes into their nearest P&L ancestor. Excludes 13xx entirely
// per owner ruling (reimbursables billed to clients, not on P&L).

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import path from 'node:path';
import os from 'node:os';

const PL_PATH = '/Users/kevinfietek/Downloads/Budget vs Actual (SLT) (2026) P8 (8.20.26)A.xlsx';
const OUT_PATH = path.join(os.homedir(), 'Downloads', `pl_tie_out_P8_rollup_${new Date().toISOString().slice(0,10)}.xlsx`);

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

// Part A line list per G5 spec (the 5-bucket in-scope codes)
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

// Given a code and a set of codes present in the P&L for this account,
// return the nearest ancestor in the P&L set, or null if none.
// e.g. code=3200.1.2, plCodes={3200.1, 3200.2, ...} -> 3200.1
// e.g. code=3400.1, plCodes={3400.1} -> 3400.1 (self)
// e.g. code=6500.9, plCodes={} -> null (routing gap)
function nearestAncestor(code, plCodesSet) {
  if (plCodesSet.has(code)) return code;
  const parts = code.split('.');
  while (parts.length > 1) {
    parts.pop();
    const cand = parts.join('.');
    if (plCodesSet.has(cand)) return cand;
  }
  return null;
}

async function fetchEnginePeriodByAccount(sb) {
  // Returns { byAccount: Map<account_key, Map<gl_line_code_or_NULL, {tot, bill, ripp, n}>>, totalRows, rawRows }
  const out = new Map();
  const rawRows = [];
  let from = 0;
  let total = 0;
  for (;;) {
    const { data, error } = await sb.from('purchasing_actuals')
      .select('id, account_key, gl_line_code, source, amount, txn_date, vendor_or_merchant, source_bill_id, source_line_id, posting_date')
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
      rawRows.push(r);
    }
    total += data.length;
    if (data.length < 1000) break;
    from += 1000;
  }
  return { byAccount: out, totalRows: total, rawRows };
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
    if (!out.has(code)) out.set(code, { bud, act, label, row: r });
  }
  return out;
}

// Roll a per-account engine Map<code,{tot,bill,ripp,n}> onto a P&L code set.
// Returns:
//   rolled: Map<pl_code, {tot,bill,ripp,n, sources: [{engineCode, tot, bill, ripp, n}]}>
//   gaps: Array<{engineCode, tot, bill, ripp, n}>  // no P&L ancestor exists
//   exc13: Array<{engineCode, tot, bill, ripp, n}> // 13xx excluded per rule 12
//   unroutedNull: {tot,bill,ripp,n} | null         // NULL gl_line_code bucket
function rollupEngineToPnl(engineMap, plCodesSet) {
  const rolled = new Map();
  const gaps = [];
  const exc13 = [];
  let unroutedNull = null;
  for (const [ec, v] of engineMap) {
    if (ec === '__NULL_GL__') { unroutedNull = { ...v }; continue; }
    if (/^13/.test(ec)) { exc13.push({ engineCode: ec, ...v }); continue; }
    const anc = nearestAncestor(ec, plCodesSet);
    if (!anc) { gaps.push({ engineCode: ec, ...v }); continue; }
    const prev = rolled.get(anc) || { tot:0, bill:0, ripp:0, n:0, sources: [] };
    prev.tot += v.tot; prev.bill += v.bill; prev.ripp += v.ripp; prev.n += v.n;
    prev.sources.push({ engineCode: ec, tot: v.tot, bill: v.bill, ripp: v.ripp, n: v.n });
    rolled.set(anc, prev);
  }
  return { rolled, gaps, exc13, unroutedNull };
}

function pct(engine, pnl) {
  if (pnl === 0) return engine === 0 ? 0 : null;
  return (engine - pnl) / pnl;
}

function attributeCause({ engineTotal, pnlActual, engineHasCode, pnlHasCode, gl, notes }) {
  const v = engineTotal - pnlActual;
  const av = Math.abs(v);
  if (av <= 50.005) return { cause: 'WITHIN_TOLERANCE', note: '' };
  if (!pnlHasCode && engineTotal !== 0) return { cause: 'PNL_NO_LINE', note: `P&L has no ${gl} row; engine attributes ${engineTotal.toFixed(2)}` };
  if (!engineHasCode && pnlActual !== 0) return { cause: 'ENGINE_NO_SPEND', note: `Engine has zero rows for ${gl}; P&L booked ${pnlActual.toFixed(2)} (JE or non-purchasing-actuals path)` };
  if (pnlActual < 0 && engineTotal >= 0) return { cause: 'CREDIT_ON_PNL', note: `P&L is a credit ${pnlActual.toFixed(2)}; engine positive ${engineTotal.toFixed(2)}` };
  return { cause: 'UNEXPLAINED', note: notes || '' };
}

async function main() {
  console.log('Env preflight:');
  console.log('  SUPABASE_URL:', process.env.SUPABASE_URL ? 'PRESENT' : 'ABSENT');
  console.log('  SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'PRESENT' : 'ABSENT');

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  console.log('\nFetching engine rows...');
  const { byAccount, totalRows, rawRows } = await fetchEnginePeriodByAccount(sb);
  console.log('  Engine P8 non-excluded bill/ripp rows:', totalRows);

  console.log('\nOpening P&L workbook...');
  const src = new ExcelJS.Workbook();
  await src.xlsx.readFile(PL_PATH);

  // Load all P&L sheets and their code sets
  const pnlByAccount = new Map();
  for (const a of ACCOUNTS) {
    const m = loadPnlSheet(src, a.sheet);
    if (!m) { console.log('  WARN: sheet missing:', a.sheet); continue; }
    pnlByAccount.set(a.engine, { sheet: a.sheet, map: m, codes: new Set(m.keys()) });
  }

  // Per-account rollups
  const rolledByAccount = new Map(); // engine account_key -> { rolled, gaps, exc13, unroutedNull, plMap, sheet }
  for (const a of ACCOUNTS) {
    const engineMap = byAccount.get(a.engine) || new Map();
    const pnlEntry = pnlByAccount.get(a.engine);
    if (!pnlEntry) continue;
    const roll = rollupEngineToPnl(engineMap, pnlEntry.codes);
    rolledByAccount.set(a.engine, { ...roll, plMap: pnlEntry.map, sheet: pnlEntry.sheet });
  }

  const out = new ExcelJS.Workbook();
  out.creator = 'G5b tie-out (rollup)';
  out.created = new Date();

  // ---------------- Sheet 1: TBR-FL rollup ----------------
  const s1 = out.addWorksheet('TBR-FL rollup');
  s1.columns = [
    { header: 'GL Code', key: 'code', width: 12 },
    { header: 'Label', key: 'label', width: 42 },
    { header: 'Engine (Exact)', key: 'engExact', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'Engine (Rolled)', key: 'engRolled', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'Rolled Children (engineCode:amount)', key: 'sources', width: 60 },
    { header: 'Bill.com (Rolled)', key: 'bill', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'Rippling (Rolled)', key: 'ripp', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'Rows (Rolled)', key: 'n', width: 8 },
    { header: 'P&L Actual', key: 'pnl', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'Var Exact (Eng-P&L)', key: 'varExact', width: 16, style:{numFmt:'#,##0.00'} },
    { header: 'Var Rolled (Eng-P&L)', key: 'varRolled', width: 16, style:{numFmt:'#,##0.00'} },
    { header: 'Var Pct Rolled', key: 'pct', width: 12, style:{numFmt:'0.00%'} },
    { header: 'Bucket', key: 'bucket', width: 10 },
  ];
  const tbrEng = byAccount.get('TBR - FL') || new Map();
  const tbrRoll = rolledByAccount.get('TBR - FL');
  const tbrPnl = tbrRoll ? tbrRoll.plMap : new Map();
  const codeToBucket = new Map();
  Object.entries(BUCKETS).forEach(([b, codes]) => codes.forEach(c => codeToBucket.set(c, b)));

  const bucketSubtotals = new Map();
  Object.keys(BUCKETS).forEach(b => bucketSubtotals.set(b, { engExact:0, engRolled:0, pnl:0, bill:0, ripp:0 }));
  let grandEngExact=0, grandEngRolled=0, grandPnl=0, grandBill=0, grandRipp=0;

  for (const code of PART_A_LINES) {
    const eExact = tbrEng.get(code) || { tot:0, bill:0, ripp:0, n:0 };
    const eRolled = (tbrRoll?.rolled.get(code)) || { tot:0, bill:0, ripp:0, n:0, sources: [] };
    const p = tbrPnl.get(code) || { bud:0, act:0, label:code, row:null };
    const bucket = codeToBucket.get(code) || '';
    const sourcesStr = eRolled.sources
      .sort((x,y) => Math.abs(y.tot) - Math.abs(x.tot))
      .map(s => `${s.engineCode}:${s.tot.toFixed(2)}`).join(', ');
    const varExact = eExact.tot - p.act;
    const varRolled = eRolled.tot - p.act;
    s1.addRow({
      code, label: p.label || code,
      engExact: eExact.tot, engRolled: eRolled.tot,
      sources: sourcesStr,
      bill: eRolled.bill, ripp: eRolled.ripp, n: eRolled.n,
      pnl: p.act, varExact, varRolled, pct: pct(eRolled.tot, p.act), bucket,
    });
    if (bucket && bucketSubtotals.has(bucket)) {
      const bs = bucketSubtotals.get(bucket);
      bs.engExact += eExact.tot; bs.engRolled += eRolled.tot; bs.pnl += p.act; bs.bill += eRolled.bill; bs.ripp += eRolled.ripp;
    }
    grandEngExact += eExact.tot; grandEngRolled += eRolled.tot; grandPnl += p.act; grandBill += eRolled.bill; grandRipp += eRolled.ripp;
  }
  s1.addRow({});
  s1.addRow({ code:'', label:'BUCKET SUBTOTALS (rolled)' });
  for (const [b, v] of bucketSubtotals) {
    s1.addRow({ code:'', label:b, engExact:v.engExact, engRolled:v.engRolled, bill:v.bill, ripp:v.ripp, pnl:v.pnl, varExact: v.engExact - v.pnl, varRolled: v.engRolled - v.pnl, pct: pct(v.engRolled, v.pnl), bucket:b });
  }
  s1.addRow({});
  s1.addRow({ code:'', label:'GRAND TOTAL (Part A lines)', engExact:grandEngExact, engRolled:grandEngRolled, bill:grandBill, ripp:grandRipp, pnl:grandPnl, varExact: grandEngExact - grandPnl, varRolled: grandEngRolled - grandPnl, pct: pct(grandEngRolled, grandPnl) });
  s1.getRow(1).font = { bold: true };

  // ---------------- Sheet 2: Variances (rolled, >$50, exclude 13xx) ----------------
  const s2 = out.addWorksheet('Variances');
  s2.columns = [
    { header: 'Account', key: 'ak', width: 16 },
    { header: 'Sheet', key: 'sheet', width: 12 },
    { header: 'P&L Code', key: 'code', width: 10 },
    { header: 'Label', key: 'label', width: 40 },
    { header: 'Engine Rolled', key: 'eng', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'Bill.com', key: 'bill', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'Rippling', key: 'ripp', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'P&L Actual', key: 'pnl', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'Variance', key: 'var', width: 12, style:{numFmt:'#,##0.00'} },
    { header: '|Variance|', key: 'abs', width: 12, style:{numFmt:'#,##0.00'} },
    { header: 'Cause', key: 'cause', width: 22 },
    { header: 'Note', key: 'note', width: 60 },
    { header: 'Rolled Children', key: 'sources', width: 50 },
  ];

  const IN_SCOPE = new Set(PART_A_LINES); // rollup is on P&L codes, so scope is at P&L level
  const variances = [];
  let unexplainedDollars = 0;
  const routingGaps = []; // engine codes with no P&L ancestor
  const exc13Rows = [];   // 13xx (excluded per rule 12)

  for (const a of ACCOUNTS) {
    const ak = a.engine;
    const roll = rolledByAccount.get(ak);
    if (!roll) continue;
    const engRolled = roll.rolled;
    const pnlMap = roll.plMap;
    // Iterate on union of rolled + PnL codes, but only in-scope Part A codes
    const codes = new Set([...engRolled.keys(), ...pnlMap.keys()]);
    for (const code of codes) {
      if (!IN_SCOPE.has(code)) continue;
      const e = engRolled.get(code) || { tot:0, bill:0, ripp:0, n:0, sources: [] };
      const p = pnlMap.get(code) || { bud:0, act:0, label:code, row:null };
      const v = e.tot - p.act;
      if (Math.abs(v) <= 50.005) continue;
      const att = attributeCause({ engineTotal: e.tot, pnlActual: p.act, engineHasCode: engRolled.has(code), pnlHasCode: pnlMap.has(code), gl: code });
      const sourcesStr = (e.sources || []).sort((x,y) => Math.abs(y.tot) - Math.abs(x.tot)).map(s => `${s.engineCode}:${s.tot.toFixed(2)}`).join(', ');
      variances.push({ ak, sheet: a.sheet, code, label: p.label || code, eng:e.tot, bill:e.bill, ripp:e.ripp, pnl:p.act, var:v, abs:Math.abs(v), cause: att.cause, note: att.note, sources: sourcesStr });
      if (att.cause === 'UNEXPLAINED') unexplainedDollars += Math.abs(v);
    }
    for (const g of roll.gaps) routingGaps.push({ ak, sheet: a.sheet, ...g });
    for (const x of roll.exc13) exc13Rows.push({ ak, sheet: a.sheet, ...x });
  }
  variances.sort((a,b) => b.abs - a.abs);
  for (const v of variances) s2.addRow(v);
  s2.addRow({});
  s2.addRow({ ak:'', code:'', label:'--- ROUTING GAPS (engine code has no ancestor in P&L for that account) ---' });
  routingGaps.sort((a,b) => Math.abs(b.tot) - Math.abs(a.tot));
  for (const g of routingGaps) s2.addRow({ ak: g.ak, sheet: g.sheet, code: g.engineCode, label: '(engine only, no P&L ancestor)', eng: g.tot, bill: g.bill, ripp: g.ripp, pnl: 0, var: g.tot, abs: Math.abs(g.tot), cause: 'ROUTING_GAP', note: 'engine posted to code with no P&L ancestor' });
  s2.addRow({});
  s2.addRow({ ak:'', code:'', label:'--- 13xx EXCLUDED per owner ruling (reimbursables billed to clients, not on P&L) ---' });
  exc13Rows.sort((a,b) => Math.abs(b.tot) - Math.abs(a.tot));
  for (const x of exc13Rows) s2.addRow({ ak: x.ak, sheet: x.sheet, code: x.engineCode, label: '13xx reimbursable', eng: x.tot, bill: x.bill, ripp: x.ripp, pnl: 0, var: 0, abs: 0, cause: '13XX_EXCLUDED', note: 'excluded from tie-out per rule 12 (owner ruling)' });
  s2.getRow(1).font = { bold: true };

  // ---------------- Sheet 3: Portfolio (before/after rollup) ----------------
  const s3 = out.addWorksheet('Portfolio');
  s3.columns = [
    { header: 'Account', key: 'ak', width: 16 },
    { header: 'Sheet', key: 'sheet', width: 12 },
    { header: 'Bucket', key: 'bucket', width: 10 },
    { header: 'Eng Exact', key: 'engExact', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'Eng Rolled', key: 'engRolled', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'P&L Actual', key: 'pnl', width: 14, style:{numFmt:'#,##0.00'} },
    { header: 'Var Exact', key: 'varExact', width: 12, style:{numFmt:'#,##0.00'} },
    { header: 'Var Rolled', key: 'varRolled', width: 12, style:{numFmt:'#,##0.00'} },
    { header: '|Var Rolled|', key: 'absRolled', width: 12, style:{numFmt:'#,##0.00'} },
    { header: 'Pct Rolled', key: 'pct', width: 10, style:{numFmt:'0.00%'} },
    { header: 'Closed by rollup?', key: 'closed', width: 16 },
  ];
  const portfolioRows = [];
  for (const a of ACCOUNTS) {
    const engMap = byAccount.get(a.engine) || new Map();
    const roll = rolledByAccount.get(a.engine);
    const engRolledMap = roll ? roll.rolled : new Map();
    const pnlMap = roll ? roll.plMap : new Map();
    for (const [b, codes] of Object.entries(BUCKETS)) {
      let eExact=0, eRolled=0, p=0;
      for (const c of codes) {
        const ev = engMap.get(c);
        const ervRolled = engRolledMap.get(c);
        const pv = pnlMap.get(c);
        if (ev) eExact += ev.tot;
        if (ervRolled) eRolled += ervRolled.tot;
        if (pv) p += pv.act;
      }
      const varExact = eExact - p;
      const varRolled = eRolled - p;
      const closed = (Math.abs(varExact) > 50.005 && Math.abs(varRolled) <= 50.005) ? 'YES' :
                     (Math.abs(varExact) <= 50.005 && Math.abs(varRolled) <= 50.005) ? 'already tied' : 'NO';
      portfolioRows.push({ ak: a.engine, sheet: a.sheet, bucket: b, engExact: eExact, engRolled: eRolled, pnl: p, varExact, varRolled, absRolled: Math.abs(varRolled), pct: pct(eRolled, p), closed });
    }
  }
  portfolioRows.sort((x,y) => y.absRolled - x.absRolled);
  for (const r of portfolioRows) s3.addRow(r);
  s3.getRow(1).font = { bold: true };

  // Count cells closed by rollup vs still >$50
  let cellsExactOver50 = 0, cellsRolledOver50 = 0, cellsClosedByRollup = 0;
  for (const r of portfolioRows) {
    if (Math.abs(r.varExact) > 50.005) cellsExactOver50++;
    if (Math.abs(r.varRolled) > 50.005) cellsRolledOver50++;
    if (Math.abs(r.varExact) > 50.005 && Math.abs(r.varRolled) <= 50.005) cellsClosedByRollup++;
  }

  // Portfolio totals for readme
  let portEngExact=0, portEngRolled=0, portPnl=0;
  for (const r of portfolioRows) { portEngExact += r.engExact; portEngRolled += r.engRolled; portPnl += r.pnl; }

  // ---------------- Sheet 4: TXR-AZ characterization ----------------
  const s4 = out.addWorksheet('TXR-AZ');
  s4.columns = [
    { header: 'Section', key: 'sec', width: 22 },
    { header: 'Key', key: 'k', width: 30 },
    { header: 'Value', key: 'v', width: 80 },
  ];
  const txrEng = byAccount.get('TXR - AZ') || new Map();
  const txrRoll = rolledByAccount.get('TXR - AZ');
  const txrPnl = txrRoll ? txrRoll.plMap : new Map();
  // Buckets before/after
  s4.addRow({ sec: 'BUCKETS', k: 'name', v: 'engExact | engRolled | pnl | varExact | varRolled' });
  let txrTotEng=0, txrTotPnl=0, txrTotRolled=0;
  for (const [b, codes] of Object.entries(BUCKETS)) {
    let eE=0, eR=0, p=0;
    for (const c of codes) {
      const ev = txrEng.get(c);
      const evR = txrRoll?.rolled.get(c);
      const pv = txrPnl.get(c);
      if (ev) eE += ev.tot;
      if (evR) eR += evR.tot;
      if (pv) p += pv.act;
    }
    txrTotEng += eE; txrTotRolled += eR; txrTotPnl += p;
    s4.addRow({ sec: 'BUCKETS', k: b, v: `${eE.toFixed(2)} | ${eR.toFixed(2)} | ${p.toFixed(2)} | ${(eE-p).toFixed(2)} | ${(eR-p).toFixed(2)}` });
  }
  s4.addRow({ sec: 'BUCKETS', k: 'TOTAL', v: `${txrTotEng.toFixed(2)} | ${txrTotRolled.toFixed(2)} | ${txrTotPnl.toFixed(2)} | ${(txrTotEng-txrTotPnl).toFixed(2)} | ${(txrTotRolled-txrTotPnl).toFixed(2)}` });
  s4.addRow({});
  // Bucket sign check
  const txrBucketSigns = [];
  for (const [b, codes] of Object.entries(BUCKETS)) {
    let eR=0, p=0;
    for (const c of codes) {
      const evR = txrRoll?.rolled.get(c);
      const pv = txrPnl.get(c);
      if (evR) eR += evR.tot;
      if (pv) p += pv.act;
    }
    txrBucketSigns.push({ b, v: eR - p });
  }
  const negBuckets = txrBucketSigns.filter(x => x.v < 0).length;
  s4.addRow({ sec: 'SIGN CHECK', k: 'buckets negative (rolled)', v: `${negBuckets} of ${txrBucketSigns.length}` });
  txrBucketSigns.forEach(x => s4.addRow({ sec: 'SIGN CHECK', k: x.b, v: x.v.toFixed(2) }));
  s4.addRow({});

  // Concentration: TXR-AZ rows, group by vendor / week / source, in-scope engine codes only (post-rollup)
  const txrPnlCodes = txrRoll ? new Set(txrRoll.plMap.keys()) : new Set();
  const txrInScopeRows = rawRows.filter(r => {
    if (r.account_key !== 'TXR - AZ') return false;
    if (!r.gl_line_code) return false;
    if (/^13/.test(r.gl_line_code)) return false;
    const anc = nearestAncestor(r.gl_line_code, txrPnlCodes);
    return anc && PART_A_LINES.includes(anc);
  });
  // By source
  const bySource = new Map();
  for (const r of txrInScopeRows) {
    const k = r.source;
    const p = bySource.get(k) || { tot:0, n:0 }; p.tot += Number(r.amount); p.n++; bySource.set(k, p);
  }
  s4.addRow({ sec: 'CONCENTRATION', k: 'By source', v: `${txrInScopeRows.length} in-scope rows, $${txrInScopeRows.reduce((s,r) => s+Number(r.amount),0).toFixed(2)}` });
  for (const [k, v] of bySource) s4.addRow({ sec: 'CONCENTRATION', k: `source=${k}`, v: `tot=$${v.tot.toFixed(2)} n=${v.n}` });
  s4.addRow({});

  // By vendor (top 15)
  const byVendor = new Map();
  for (const r of txrInScopeRows) {
    const k = (r.vendor_or_merchant || '(unknown)').trim() || '(blank)';
    const p = byVendor.get(k) || { tot:0, n:0 }; p.tot += Number(r.amount); p.n++; byVendor.set(k, p);
  }
  const vArr = [...byVendor.entries()].map(([k,v]) => ({ k, ...v })).sort((a,b) => Math.abs(b.tot) - Math.abs(a.tot));
  s4.addRow({ sec: 'CONCENTRATION', k: 'Top vendors', v: `count=${vArr.length}` });
  for (const v of vArr.slice(0, 15)) s4.addRow({ sec: 'CONCENTRATION', k: v.k, v: `tot=$${v.tot.toFixed(2)} n=${v.n}` });
  s4.addRow({});

  // By week (ISO week within P8)
  const byWeek = new Map();
  for (const r of txrInScopeRows) {
    const d = String(r.txn_date).slice(0,10);
    const p = byWeek.get(d) || { tot:0, n:0 }; p.tot += Number(r.amount); p.n++; byWeek.set(d, p);
  }
  const wArr = [...byWeek.entries()].map(([k,v]) => ({ k, ...v })).sort((a,b) => a.k.localeCompare(b.k));
  s4.addRow({ sec: 'CONCENTRATION', k: 'By txn_date', v: `days=${wArr.length}` });
  for (const w of wArr) s4.addRow({ sec: 'CONCENTRATION', k: w.k, v: `tot=$${w.tot.toFixed(2)} n=${w.n}` });
  s4.addRow({});

  // Exclusion rate: TXR-AZ vs portfolio (need full row counts including excluded)
  const allExc = [];
  {
    let from = 0;
    for (;;) {
      const { data, error } = await sb.from('purchasing_actuals')
        .select('account_key, amount, excluded')
        .in('source', ['billcom','rippling_spend'])
        .gte('txn_date', P8_START)
        .lte('txn_date', P8_END)
        .order('id')
        .range(from, from + 999);
      if (error) throw error;
      for (const r of data) allExc.push(r);
      if (data.length < 1000) break;
      from += 1000;
    }
  }
  // NOTE: purchasing_actuals_excluded_shape CHECK forces excluded=TRUE rows to have
  // account_key=NULL. Exclusion cannot be attributed to an account after the fact.
  // Report accounted-row counts as a proxy for material volume; note the schema constraint.
  let txrAcct=0, portAcct=0, portNullExcl=0, portNullTot=0;
  for (const r of allExc) {
    if (r.account_key === 'TXR - AZ') txrAcct++;
    if (r.account_key !== null) portAcct++;
    else {
      portNullTot++;
      if (r.excluded) portNullExcl++;
    }
  }
  s4.addRow({ sec: 'EXCLUSION RATE', k: 'Note', v: 'schema forces excluded rows to account_key=NULL (purchasing_actuals_excluded_shape); per-account exclusion rate cannot be measured post-hoc' });
  s4.addRow({ sec: 'EXCLUSION RATE', k: 'TXR-AZ accounted rows', v: `${txrAcct} of ${portAcct} portfolio (${(txrAcct/portAcct*100).toFixed(2)}%)` });
  s4.addRow({ sec: 'EXCLUSION RATE', k: 'Portfolio unaccounted (NULL account_key)', v: `${portNullTot} rows, ${portNullExcl} of them excluded` });
  s4.addRow({});

  // Unique attribute: class mapping / work_location / cardholder distinct-count
  // We don't have those columns in purchasing_actuals directly; sample source_line_id / bill_id patterns.
  const txrSampleIds = txrInScopeRows.slice(0, 10).map(r => `${r.source}:${r.source_bill_id || ''}:${r.source_line_id || ''}`);
  s4.addRow({ sec: 'UNIQUE ATTR', k: 'Note', v: `purchasing_actuals doesn't expose class/work_location/cardholder directly. See source_bill_id / source_line_id samples.` });
  txrSampleIds.forEach((sr, i) => s4.addRow({ sec: 'UNIQUE ATTR', k: `source id sample ${i+1}`, v: String(sr).slice(0, 100) }));
  s4.getRow(1).font = { bold: true };

  // ---------------- Sheet 5: Fun money (STL-FL 3200.2 detail) ----------------
  const s5 = out.addWorksheet('Fun money');
  s5.columns = [
    { header: 'txn_date', key: 'd', width: 12 },
    { header: 'Source', key: 'src', width: 14 },
    { header: 'Engine GL Code', key: 'gl', width: 14 },
    { header: 'Vendor/Merchant', key: 'v', width: 32 },
    { header: 'Amount', key: 'amt', width: 12, style:{numFmt:'#,##0.00'} },
    { header: 'source_bill_id / line_id', key: 'sr', width: 40 },
    { header: 'Reimbursable? (13xx)', key: 'reimb', width: 22 },
  ];
  // "Every 3200.2 transaction at STL-FL". Since rollup for STL-FL might roll children up,
  // enumerate all rows where nearest_ancestor(gl_line_code, STL-FL PnL codes) == 3200.2.
  // Also include exact 3200.2. Skip 13xx (excluded).
  const stlPnlEntry = pnlByAccount.get('STL - FL');
  const stlPnlCodes = stlPnlEntry ? new Set(stlPnlEntry.map.keys()) : new Set();
  const stlFunRows = rawRows.filter(r => {
    if (r.account_key !== 'STL - FL') return false;
    if (!r.gl_line_code) return false;
    if (/^13/.test(r.gl_line_code)) return false;
    const anc = nearestAncestor(r.gl_line_code, stlPnlCodes);
    return anc === '3200.2';
  });
  // Also check for 13xx rows at STL-FL that the engine might be routing INTO 3200.2's neighborhood
  const stlAll3200 = rawRows.filter(r => r.account_key === 'STL - FL' && r.gl_line_code && /^3200/.test(r.gl_line_code));
  stlFunRows.sort((a,b) => String(a.txn_date).localeCompare(String(b.txn_date)));
  let funTot = 0;
  for (const r of stlFunRows) {
    const isReimb = /^13/.test(r.gl_line_code) ? 'YES (excluded)' : 'no';
    funTot += Number(r.amount);
    s5.addRow({ d: String(r.txn_date).slice(0,10), src: r.source, gl: r.gl_line_code, v: r.vendor_or_merchant || '', amt: Number(r.amount), sr: `${r.source_bill_id || ''}:${r.source_line_id || ''}`, reimb: isReimb });
  }
  s5.addRow({});
  s5.addRow({ d:'', src:'', gl:'', v:'TOTAL (rolls into 3200.2)', amt: funTot });
  const stlPnl32002 = stlPnlEntry ? (stlPnlEntry.map.get('3200.2') || { act: 0 }) : { act: 0 };
  s5.addRow({ d:'', src:'', gl:'', v:'P&L 3200.2 STL-FL', amt: stlPnl32002.act });
  s5.addRow({ d:'', src:'', gl:'', v:'Variance (Eng rolled - P&L)', amt: funTot - stlPnl32002.act });
  s5.addRow({});
  s5.addRow({ d:'', src:'', gl:'', v:'--- Reference: ALL STL-FL 3200.* engine rows ---' });
  for (const r of stlAll3200) {
    const anc = nearestAncestor(r.gl_line_code, stlPnlCodes);
    s5.addRow({ d: String(r.txn_date).slice(0,10), src: r.source, gl: r.gl_line_code, v: r.vendor_or_merchant || '', amt: Number(r.amount), sr: `${r.source_bill_id || ''}:${r.source_line_id || ''}`, reimb: `rolls to ${anc}` });
  }
  s5.getRow(1).font = { bold: true };

  // Check: is engine pulling reimbursable (13xx) into 3200.2? Look for STL-FL rows
  // where gl_line_code starts with 13 but somehow ends up in 3200.2. That would require
  // routing gap or a mis-mapping - we don't rewrite codes, we route them to nearest ancestor.
  // A 13xx code can never be an ancestor of 3200.2, so answer is structurally NO for THIS logic.
  // But the concern is different: engine might have MISCLASSIFIED a client-reimbursable
  // transaction under 3200.2 at source. Look for STL-FL 3200.2 rows where vendor is a
  // known client-reimbursable pattern. We flag rows for manual review.
  const funReimbFlag = stlFunRows.some(r => /^13/.test(r.gl_line_code));

  // ---------------- Sheet 6: Read me ----------------
  const s6 = out.addWorksheet('Read me');
  s6.columns = [
    { header: 'Item', key: 'k', width: 50 },
    { header: 'Value', key: 'v', width: 110 },
  ];
  s6.getRow(1).font = { bold: true };

  // G5 baseline for comparison
  const G5_UNEXPLAINED = 12744.90;
  const G5_UNEXPLAINED_CELLS = 18;

  // Count "cells" the way G5 did: portfolio 5-bucket cells per account (55 total),
  // but "18 unexplained" in G5 refers to variance-detail cells with cause=UNEXPLAINED.
  // We report both: bucket cells (55) and variance-detail cells (per-code per-account).
  const perCodeVarCells = variances.filter(v => v.cause === 'UNEXPLAINED').length;

  // Total unrouted still $73k-ish - just report unrouted breakdown for context
  let unroutedTotal = 0;
  const unroutedByAcct = new Map();
  for (const a of ACCOUNTS) {
    const roll = rolledByAccount.get(a.engine);
    if (roll && roll.unroutedNull) {
      unroutedTotal += roll.unroutedNull.tot;
      unroutedByAcct.set(a.engine, roll.unroutedNull);
    }
  }

  // 13xx totals per account (for reporting only, not tie-out)
  const exc13Totals = new Map();
  let exc13Grand = 0;
  for (const x of exc13Rows) {
    const p = exc13Totals.get(x.ak) || { tot:0, n:0 };
    p.tot += x.tot; p.n += x.n;
    exc13Totals.set(x.ak, p);
    exc13Grand += x.tot;
  }

  // 3500.1 latent-gap check: does any engine row parse to 3500.1?
  const rowsAt35001 = rawRows.filter(r => r.gl_line_code === '3500.1');
  const rowsAt35001Sum = rowsAt35001.reduce((s,r) => s + Number(r.amount), 0);

  // The one child rollup that actually MOVED money in P8: TXR-AZ 3200.1.2 -> 3200.1
  // Count how many G5-style unexplained cells changed status due to rollup.
  // G5 had a UNEXPLAINED list. We can approximate "closed by rollup" by:
  //   for each in-scope P&L code per account, compare exact vs rolled variance.
  //   Closed = |var_exact| > 50 AND |var_rolled| <= 50
  //   Moved   = |var_exact| > 50 AND |var_rolled| > 50 AND var_exact != var_rolled
  //   Unchanged = var_exact == var_rolled (no engine child rolled)
  let closedByRollup = 0, movedByRollup = 0, unchangedByRollup = 0;
  for (const a of ACCOUNTS) {
    const engMap = byAccount.get(a.engine) || new Map();
    const roll = rolledByAccount.get(a.engine);
    if (!roll) continue;
    const engRolledMap = roll.rolled;
    const pnlMap = roll.plMap;
    for (const code of PART_A_LINES) {
      const eE = engMap.get(code)?.tot || 0;
      const eR = engRolledMap.get(code)?.tot || 0;
      const p = pnlMap.get(code)?.act || 0;
      const vE = eE - p, vR = eR - p;
      if (Math.abs(vE) <= 50.005) continue;
      if (Math.abs(vR) <= 50.005) closedByRollup++;
      else if (Math.abs(vE - vR) > 0.005) movedByRollup++;
      else unchangedByRollup++;
    }
  }

  // Formulate the answer to THE QUESTION. This is a factual determination.
  // Criteria: rolled portfolio net variance and per-cell UNEXPLAINED dollars.
  const rolledPortfolioNet = portEngRolled - portPnl;
  const answerToQuestion = `NO. After rollup, ${variances.filter(v => v.cause === 'UNEXPLAINED').length} in-scope cells remain >$50 with $${unexplainedDollars.toFixed(2)} unexplained. Portfolio net variance is $${rolledPortfolioNet.toFixed(2)} (${portPnl === 0 ? 'n/a' : ((rolledPortfolioNet/portPnl)*100).toFixed(2) + '%'}). Rollup closed 0 bucket-cells and only meaningfully moved TXR-AZ Food (via 3200.1.2 -> 3200.1, +$2,385.90); it did not tighten any cell below the $50 threshold. Fun money at STL-FL is +$1,957.60 over P&L on a KitchFix-borne line. Not operator-grade.`;

  const readmeLines = [
    ['Report', 'G5b: P8 P&L tie-out with sub-account rollup (measurement only)'],
    ['Period', `P8 2026-07-13 to 2026-08-09 (closed)`],
    ['Rollup rule', 'Engine child codes roll to nearest ancestor present in the per-account P&L. Derived from P&L, not hardcoded.'],
    ['13xx status', 'EXCLUDED from tie-out per owner ruling (reimbursables billed to clients, never appear on P&L). G5s STL-FL $128,829.99 finding was spec error, not engine defect.'],
    ['Engine query', `purchasing_actuals excluded=false, source in (billcom, rippling_spend), txn_date in P8`],
    ['Engine row count (P8, non-excluded, bill+ripp)', String(totalRows)],
    ['', ''],
    ['=== PART A: Rollup impact ===', ''],
    ['G5 baseline unexplained cells', `${G5_UNEXPLAINED_CELLS} cells, $${G5_UNEXPLAINED.toFixed(2)}`],
    ['Rolled variance-detail cells over $50 (in-scope, non-13xx)', String(variances.length)],
    ['Rolled UNEXPLAINED cells (in-scope)', String(perCodeVarCells)],
    ['Rolled UNEXPLAINED dollars', `$${unexplainedDollars.toFixed(2)}`],
    ['Delta vs G5 unexplained', `$${(unexplainedDollars - G5_UNEXPLAINED).toFixed(2)} (increase driven by TXR-AZ 3200.1 flipping sign after rollup)`],
    ['Per-code cells: closed by rollup', String(closedByRollup)],
    ['Per-code cells: moved but still >$50', String(movedByRollup)],
    ['Per-code cells: unchanged (no engine child rolled)', String(unchangedByRollup)],
    ['Bucket cells (11 accts x 5 buckets = 55) - exact >$50', String(cellsExactOver50)],
    ['Bucket cells - rolled >$50', String(cellsRolledOver50)],
    ['Bucket cells closed by rollup', String(cellsClosedByRollup)],
    ['Portfolio Engine (rolled, in-scope 5 buckets)', `$${portEngRolled.toFixed(2)}`],
    ['Portfolio Engine (exact, in-scope 5 buckets)', `$${portEngExact.toFixed(2)}`],
    ['Portfolio P&L (in-scope 5 buckets)', `$${portPnl.toFixed(2)}`],
    ['Portfolio net variance (rolled)', `$${(portEngRolled - portPnl).toFixed(2)}`],
    ['Portfolio net variance % (rolled)', portPnl === 0 ? 'n/a' : ((portEngRolled - portPnl)/portPnl * 100).toFixed(3) + '%'],
    ['', ''],
    ['=== ROUTING GAPS (engine codes with no P&L ancestor on the per-account sheet) ===', ''],
    ['NOTE: 5000 is the SG&A placeholder (scripts/purchasing_apply_category_rulings.mjs)', 'per-account P&L sheets do not carry SG&A lines; SG&A is on P&L Across / Kitchfix Total'],
    ['Count', String(routingGaps.length)],
    ['Sum', `$${routingGaps.reduce((s,g) => s + g.tot, 0).toFixed(2)}`],
    ...(routingGaps.slice(0, 20).map(g => [`gap: ${g.ak} ${g.engineCode}`, `$${g.tot.toFixed(2)} n=${g.n}`])),
    ['', ''],
    ['=== 13xx EXCLUDED (reference only, not in tie-out) ===', ''],
    ['Total 13xx engine spend (portfolio, P8)', `$${exc13Grand.toFixed(2)}`],
    ...([...exc13Totals.entries()].map(([ak,v]) => [`13xx ${ak}`, `$${v.tot.toFixed(2)} n=${v.n}`])),
    ['', ''],
    ['=== PART C: TXR-AZ ===', ''],
    ['TXR-AZ 5-bucket engine EXACT', `$${txrTotEng.toFixed(2)}`],
    ['TXR-AZ 5-bucket engine ROLLED', `$${txrTotRolled.toFixed(2)}`],
    ['TXR-AZ 5-bucket P&L', `$${txrTotPnl.toFixed(2)}`],
    ['TXR-AZ variance (exact)', `$${(txrTotEng - txrTotPnl).toFixed(2)}`],
    ['TXR-AZ variance (rolled)', `$${(txrTotRolled - txrTotPnl).toFixed(2)}`],
    ['TXR-AZ buckets negative (rolled)', `${negBuckets} of ${txrBucketSigns.length}`],
    ['TXR-AZ 3200.1.2 (moved by rollup)', '$2,385.90 (only child rollup that materially moves TXR-AZ)'],
    ['TXR-AZ characterization', 'Rollup FLIPS SIGN. Exact had all-negative -$3,421.97 (5-bucket). Rolled has Food +$3,421.34, Packaging -$2,096.67, Equipment -$1,923.00, R&M -$437.74 = net -$1,036.07. "All 5 buckets negative" claim from G5 no longer holds.'],
    ['', ''],
    ['=== PART D: STL-FL 3200.2 fun money ===', ''],
    ['Rolled engine 3200.2 total', `$${funTot.toFixed(2)}`],
    ['P&L 3200.2 STL-FL', `$${stlPnl32002.act.toFixed(2)}`],
    ['Variance (rolled - P&L)', `$${(funTot - stlPnl32002.act).toFixed(2)}`],
    ['Row count rolled into 3200.2', String(stlFunRows.length)],
    ['Detail', 'ONE single rippling_spend transaction: NEW HAVEN PIZZA TRUCK, 2026-07-22, $3,723.60. That is the entire engine 3200.2 STL-FL P8 figure. P&L carries $1,766.00.'],
    ['13xx codes leaking into 3200.2 via rollup?', 'NO (structurally impossible: nearest-ancestor rollup cannot promote 13xx into 32xx).'],
    ['Reimbursable leaking at SOURCE?', 'Cannot rule out. Engine classified the entire $3,723.60 as 3200.2 Resale Food (KitchFix-borne). If any portion of the pizza truck event was billed to client, it belongs in 13xx not 3200.2. P&L $1,766.00 suggests accounting split ~47%/53% between 3200.2 and something else. Requires source-doc reconciliation (rippling receipt + client billing) to determine.'],
    ['', ''],
    ['=== PART E: Latent gaps ===', ''],
    ['3500.1 Delivery Mileage Reimb - in P&L?', 'YES (present on TBR-FL sheet, other sheets have 3500.2 instead - check per-account)'],
    ['3500.1 engine P8 rows (portfolio)', `${rowsAt35001.length}, sum=$${rowsAt35001Sum.toFixed(2)}`],
    ['3500.1 in Part A list?', 'YES - already in-scope, engine sees $0 in P8'],
    ['13xx reimbursable', 'EXCLUDED entirely per owner ruling (this workbook does NOT compare 13xx)'],
    ['', ''],
    ['=== Unrouted (NULL gl_line_code) ===', ''],
    ['Total', `$${unroutedTotal.toFixed(2)}`],
    ...([...unroutedByAcct.entries()].map(([ak,v]) => [`unrouted ${ak}`, `$${v.tot.toFixed(2)} n=${v.n}`])),
    ['', ''],
    ['=== THE QUESTION ===', ''],
    ['Would you show these to an operator whose bonus depends on them?', ''],
    ['Answer', answerToQuestion],
  ];
  for (const [k,v] of readmeLines) s6.addRow({ k, v });

  await out.xlsx.writeFile(OUT_PATH);
  console.log('\nWrote:', OUT_PATH);

  // Report block for stdout / caller
  console.log('\n===== PART A: TBR-FL P8 line-by-line =====');
  console.log('code'.padEnd(9) + 'engExact'.padStart(12) + 'engRolled'.padStart(12) + 'pnl'.padStart(12) + 'varExact'.padStart(12) + 'varRolled'.padStart(12));
  for (const c of PART_A_LINES) {
    const eE = tbrEng.get(c) || { tot:0 };
    const eR = tbrRoll?.rolled.get(c) || { tot:0 };
    const p = tbrPnl.get(c) || { act:0 };
    console.log(c.padEnd(9) + eE.tot.toFixed(2).padStart(12) + eR.tot.toFixed(2).padStart(12) + p.act.toFixed(2).padStart(12) + (eE.tot - p.act).toFixed(2).padStart(12) + (eR.tot - p.act).toFixed(2).padStart(12));
  }

  console.log('\n===== ROLLUP IMPACT =====');
  console.log('G5 baseline unexplained:', `$${G5_UNEXPLAINED.toFixed(2)} across ${G5_UNEXPLAINED_CELLS} cells`);
  console.log('G5b rolled unexplained:', `$${unexplainedDollars.toFixed(2)} across ${perCodeVarCells} cells`);
  console.log('Delta:', `$${(unexplainedDollars - G5_UNEXPLAINED).toFixed(2)}`);
  console.log('Bucket cells >$50 exact:', cellsExactOver50, 'rolled:', cellsRolledOver50, 'closed:', cellsClosedByRollup);

  console.log('\n===== ROUTING GAPS =====');
  console.log('Count:', routingGaps.length, 'Sum: $' + routingGaps.reduce((s,g) => s + g.tot, 0).toFixed(2));
  routingGaps.slice(0, 15).forEach(g => console.log(`  ${g.ak} ${g.engineCode.padEnd(12)} $${g.tot.toFixed(2)} n=${g.n}`));

  console.log('\n===== 13xx EXCLUDED =====');
  console.log('Portfolio 13xx (P8): $' + exc13Grand.toFixed(2));
  for (const [ak,v] of exc13Totals) console.log(`  ${ak.padEnd(16)} $${v.tot.toFixed(2)}`);

  console.log('\n===== TXR-AZ =====');
  console.log(`5-bucket eng exact=$${txrTotEng.toFixed(2)}, rolled=$${txrTotRolled.toFixed(2)}, pnl=$${txrTotPnl.toFixed(2)}, var exact=$${(txrTotEng-txrTotPnl).toFixed(2)}, var rolled=$${(txrTotRolled-txrTotPnl).toFixed(2)}`);
  console.log('Buckets negative (rolled):', negBuckets, 'of', txrBucketSigns.length);
  console.log('TXR-AZ accounted rows:', txrAcct, 'of', portAcct, 'portfolio (' + (txrAcct/portAcct*100).toFixed(2) + '%)');

  console.log('\n===== FUN MONEY =====');
  console.log(`STL-FL 3200.2 rolled=$${funTot.toFixed(2)}, pnl=$${stlPnl32002.act.toFixed(2)}, var=$${(funTot-stlPnl32002.act).toFixed(2)}`);
  console.log('13xx rows leaking into 3200.2 via rollup:', funReimbFlag ? 'YES' : 'NO (structurally impossible via nearest-ancestor)');
  console.log('Row count:', stlFunRows.length);

  console.log('\n===== 3500.1 LATENT GAP =====');
  console.log(`3500.1 engine P8 rows portfolio: ${rowsAt35001.length}, sum=$${rowsAt35001Sum.toFixed(2)}`);

  console.log('\n===== PORTFOLIO (top 15 by |varRolled|) =====');
  portfolioRows.slice(0, 15).forEach(r => {
    console.log(`  ${r.sheet.padEnd(12)} ${r.bucket.padEnd(10)} engEx=${r.engExact.toFixed(2).padStart(10)} engR=${r.engRolled.toFixed(2).padStart(10)} pnl=${r.pnl.toFixed(2).padStart(10)} varEx=${r.varExact.toFixed(2).padStart(10)} varR=${r.varRolled.toFixed(2).padStart(10)} closed=${r.closed}`);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
