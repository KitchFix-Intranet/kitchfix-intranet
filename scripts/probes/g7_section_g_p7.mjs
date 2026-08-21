// G7 Section G: P7 tie-out redo, mirroring g5b's rollup logic but for P7.
// P7 = 2026-06-15..2026-07-12. Exclude 13xx per owner ruling.
// Measurement only, no fixes. No workbook or extract written.
//
// Compare to P8's $15,130.80 unexplained. Report accounts that miss in BOTH
// periods. Watch TXR-AZ.

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';

const PL_PATH = '/Users/kevinfietek/Downloads/Budget vs Actual (SLT) (2026) P8 (8.20.26)A.xlsx';

// Determine P7 columns from Row 3 (per Kevin: don't hardcode). P8 was 115/117/119.
// Row 3 has period headers.
const P7_START = '2026-06-15';
const P7_END = '2026-07-12';
const P8_START = '2026-07-13';
const P8_END = '2026-08-09';

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

const PART_A_LINES = ['3200.1','3200.2','3400.1','3400.2','3400.5','3500.1','3500.3','3500.4','3500.5','5002.1','5002.5'];

const BUCKETS = {
  Food:      ['3200.1','3200.2'],
  Packaging: ['3400.1','3400.2','3400.5'],
  Vehicle:   ['3500.1','3500.3','3500.4','3500.5'],
  Equipment: ['5002.5'],
  'R&M':     ['5002.1'],
};

function numOf(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && 'result' in v) return typeof v.result === 'number' ? v.result : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function codeFromCell(v) {
  if (v == null) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d+(?:\.\d+)*)/);
  return m ? m[1] : null;
}
function textOf(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object' && 'result' in v) return String(v.result ?? '').trim();
  return String(v).trim();
}
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
function pct(engine, pnl) {
  if (pnl === 0) return engine === 0 ? 0 : null;
  return (engine - pnl) / pnl;
}
function attributeCause({ engineTotal, pnlActual, engineHasCode, pnlHasCode, gl }) {
  const v = engineTotal - pnlActual;
  const av = Math.abs(v);
  if (av <= 50.005) return { cause: 'WITHIN_TOLERANCE', note: '' };
  if (!pnlHasCode && engineTotal !== 0) return { cause: 'PNL_NO_LINE', note: `P&L has no ${gl} row; engine attributes ${engineTotal.toFixed(2)}` };
  if (!engineHasCode && pnlActual !== 0) return { cause: 'ENGINE_NO_SPEND', note: `Engine has zero rows for ${gl}; P&L booked ${pnlActual.toFixed(2)}` };
  if (pnlActual < 0 && engineTotal >= 0) return { cause: 'CREDIT_ON_PNL', note: `P&L is a credit ${pnlActual.toFixed(2)}; engine positive ${engineTotal.toFixed(2)}` };
  return { cause: 'UNEXPLAINED', note: '' };
}

async function fetchPeriodEngine(sb, startIso, endIso) {
  const out = new Map();
  const PAGE = 1000;
  let from = 0;
  let total = 0;
  for (;;) {
    const { data, error } = await sb.from('purchasing_actuals')
      .select('id, account_key, gl_line_code, source, amount, txn_date')
      .eq('excluded', false)
      .in('source', ['billcom','rippling_spend'])
      .gte('txn_date', startIso)
      .lte('txn_date', endIso)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
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
      total++;
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return { byAccount: out, totalRows: total };
}

// Discover P7 columns from Row 3 of the first per-account sheet.
// Kevin says P8 was 115/117/119 and we should not hardcode. Row 3 has period
// labels; the DETAIL block has Budget/Actual/Delta subheaders on row 4.
// Skip the SUMMARY block (cols 2-14) which has period labels but no
// Budget/Actual row-4 subheaders.
function discoverPeriodColumns(ws, targetPeriod) {
  const row3 = ws.getRow(3);
  const row4 = ws.getRow(4);
  for (let c = 1; c <= 250; c++) {
    const v = textOf(row3.getCell(c).value);
    if (!v) continue;
    const upper = v.toUpperCase();
    if (upper === `P${targetPeriod}` || upper === `PERIOD ${targetPeriod}`) {
      // Confirm this is the DETAIL block: row 4 at THIS col must have "Budget"
      const r4v = textOf(row4.getCell(c).value).toUpperCase();
      if (r4v === 'BUDGET') return { header_col: c };
    }
  }
  return null;
}

function loadPnlSheet(wb, sheetName, colBudget, colActual) {
  const ws = wb.getWorksheet(sheetName);
  if (!ws) return null;
  const out = new Map();
  for (let r = 1; r <= ws.rowCount; r++) {
    const a = ws.getRow(r).getCell(1).value;
    const code = codeFromCell(a);
    if (!code) continue;
    const label = textOf(a);
    const bud = numOf(ws.getRow(r).getCell(colBudget).value);
    const act = numOf(ws.getRow(r).getCell(colActual).value);
    if (!out.has(code)) out.set(code, { bud, act, label, row: r });
  }
  return out;
}

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

async function tieOutPeriod(sb, wb, periodNum, startIso, endIso) {
  console.log(`\n===== Tie-out P${periodNum} (${startIso}..${endIso}) =====`);
  const { byAccount, totalRows } = await fetchPeriodEngine(sb, startIso, endIso);
  console.log(`Engine non-excluded bill+ripp rows: ${totalRows}`);

  // Discover columns from first sheet
  const firstSheet = wb.getWorksheet(ACCOUNTS[0].sheet);
  const discovered = discoverPeriodColumns(firstSheet, periodNum);
  let COL_BUDGET, COL_ACTUAL;
  if (discovered && discovered.header_col) {
    // P8 was header at 115. Confirm by checking P8 discovery.
    // The P8 pattern: 115=Budget, 117=Actual (delta of +2 between Budget and Actual).
    // Determine actual offset by inspecting row 4 headers.
    const r4 = firstSheet.getRow(4);
    // Look at cells near the discovered header for Budget / Actual keywords
    let budCol = null, actCol = null;
    for (let dc = 0; dc < 10; dc++) {
      const c = discovered.header_col + dc;
      const v = textOf(r4.getCell(c).value).toUpperCase();
      if (v === 'BUDGET' && !budCol) budCol = c;
      if (v === 'ACTUAL' && !actCol) actCol = c;
    }
    if (budCol && actCol) {
      COL_BUDGET = budCol;
      COL_ACTUAL = actCol;
      console.log(`P${periodNum} columns discovered: Budget=${COL_BUDGET}, Actual=${COL_ACTUAL} (header at ${discovered.header_col})`);
    }
  }
  if (!COL_BUDGET || !COL_ACTUAL) {
    // Fallback: infer via P8's known offset. P8 = period_index 8, budget col 115.
    // 13 periods per FY. Structural offset: (period-1) * period_width from a base.
    // P8 = 115, P7 should be 115 - (col_width_per_period). Look at first sheet for
    // column with "P8" header, then subtract offset.
    const p8Col = discoverPeriodColumns(firstSheet, 8);
    const p7Col = discoverPeriodColumns(firstSheet, 7);
    if (p8Col && p7Col) {
      const perPeriodWidth = p8Col.header_col - p7Col.header_col;
      console.log(`Fallback: P8 header at ${p8Col.header_col}, P7 header at ${p7Col.header_col}, width=${perPeriodWidth}`);
      // Apply the known P8 offset within its block: Budget = header_col + 1 (per P8 = 114 header, 115 budget)
      // But we didn't inspect P8's offset. Manually check.
      const r4 = firstSheet.getRow(4);
      // Search near p8 header for BUDGET / ACTUAL
      let p8bud = null, p8act = null;
      for (let dc = 0; dc < 10; dc++) {
        const c = p8Col.header_col + dc;
        const v = textOf(r4.getCell(c).value).toUpperCase();
        if (v === 'BUDGET' && !p8bud) p8bud = c;
        if (v === 'ACTUAL' && !p8act) p8act = c;
      }
      const offBud = p8bud ? (p8bud - p8Col.header_col) : 1;
      const offAct = p8act ? (p8act - p8Col.header_col) : 3;
      COL_BUDGET = p7Col.header_col + offBud;
      COL_ACTUAL = p7Col.header_col + offAct;
      console.log(`P${periodNum} columns (fallback): Budget=${COL_BUDGET}, Actual=${COL_ACTUAL}`);
    }
  }
  if (!COL_BUDGET || !COL_ACTUAL) {
    throw new Error(`Could not determine P${periodNum} columns from workbook`);
  }

  const pnlByAccount = new Map();
  for (const a of ACCOUNTS) {
    const m = loadPnlSheet(wb, a.sheet, COL_BUDGET, COL_ACTUAL);
    if (!m) { console.log('WARN sheet missing:', a.sheet); continue; }
    pnlByAccount.set(a.engine, { sheet: a.sheet, map: m, codes: new Set(m.keys()) });
  }

  const rolledByAccount = new Map();
  for (const a of ACCOUNTS) {
    const engineMap = byAccount.get(a.engine) || new Map();
    const pnlEntry = pnlByAccount.get(a.engine);
    if (!pnlEntry) continue;
    const roll = rollupEngineToPnl(engineMap, pnlEntry.codes);
    rolledByAccount.set(a.engine, { ...roll, plMap: pnlEntry.map, sheet: pnlEntry.sheet });
  }

  const IN_SCOPE = new Set(PART_A_LINES);
  const variances = [];
  let unexplainedDollars = 0;
  const routingGaps = [];
  const exc13Rows = [];

  for (const a of ACCOUNTS) {
    const ak = a.engine;
    const roll = rolledByAccount.get(ak);
    if (!roll) continue;
    const engRolled = roll.rolled;
    const pnlMap = roll.plMap;
    const codes = new Set([...engRolled.keys(), ...pnlMap.keys()]);
    for (const code of codes) {
      if (!IN_SCOPE.has(code)) continue;
      const e = engRolled.get(code) || { tot:0, bill:0, ripp:0, n:0 };
      const p = pnlMap.get(code) || { bud:0, act:0, label:code };
      const v = e.tot - p.act;
      if (Math.abs(v) <= 50.005) continue;
      const att = attributeCause({ engineTotal: e.tot, pnlActual: p.act, engineHasCode: engRolled.has(code), pnlHasCode: pnlMap.has(code), gl: code });
      variances.push({ ak, sheet: a.sheet, code, label: p.label || code, eng: e.tot, pnl: p.act, var: v, abs: Math.abs(v), cause: att.cause, note: att.note });
      if (att.cause === 'UNEXPLAINED') unexplainedDollars += Math.abs(v);
    }
    for (const g of roll.gaps) routingGaps.push({ ak, sheet: a.sheet, ...g });
    for (const x of roll.exc13) exc13Rows.push({ ak, sheet: a.sheet, ...x });
  }
  variances.sort((a,b) => b.abs - a.abs);

  // Portfolio totals
  let portEngRolled = 0, portPnl = 0;
  const portfolioRows = [];
  for (const a of ACCOUNTS) {
    const roll = rolledByAccount.get(a.engine);
    if (!roll) continue;
    for (const [b, codes] of Object.entries(BUCKETS)) {
      let eR = 0, p = 0;
      for (const c of codes) {
        const ervRolled = roll.rolled.get(c);
        const pv = roll.plMap.get(c);
        if (ervRolled) eR += ervRolled.tot;
        if (pv) p += pv.act;
      }
      portfolioRows.push({ ak: a.engine, sheet: a.sheet, bucket: b, engRolled: eR, pnl: p, var: eR - p, abs: Math.abs(eR - p) });
      portEngRolled += eR;
      portPnl += p;
    }
  }

  // TXR-AZ characterization
  const txrRoll = rolledByAccount.get('TXR - AZ');
  let txrTotEng = 0, txrTotPnl = 0;
  const txrBucketSigns = [];
  if (txrRoll) {
    for (const [b, codes] of Object.entries(BUCKETS)) {
      let eR = 0, p = 0;
      for (const c of codes) {
        const ev = txrRoll.rolled.get(c);
        const pv = txrRoll.plMap.get(c);
        if (ev) eR += ev.tot;
        if (pv) p += pv.act;
      }
      txrTotEng += eR;
      txrTotPnl += p;
      txrBucketSigns.push({ b, v: eR - p, eR, p });
    }
  }

  console.log(`\n== P${periodNum} SUMMARY ==`);
  console.log(`Variance cells >$50 (in-scope, post-rollup): ${variances.length}`);
  console.log(`UNEXPLAINED cells: ${variances.filter(v => v.cause === 'UNEXPLAINED').length}`);
  console.log(`UNEXPLAINED dollars: $${unexplainedDollars.toFixed(2)}`);
  console.log(`Portfolio Engine (rolled, 5-bucket): $${portEngRolled.toFixed(2)}`);
  console.log(`Portfolio P&L (5-bucket): $${portPnl.toFixed(2)}`);
  console.log(`Portfolio net variance: $${(portEngRolled - portPnl).toFixed(2)}`);
  console.log(`Routing gaps: ${routingGaps.length}, sum $${routingGaps.reduce((s,g) => s + g.tot, 0).toFixed(2)}`);
  console.log(`13xx excluded: rows=${exc13Rows.length}, sum $${exc13Rows.reduce((s,x) => s + x.tot, 0).toFixed(2)}`);

  console.log(`\n== P${periodNum} TXR-AZ ==`);
  console.log(`  eng(rolled)=${txrTotEng.toFixed(2)}  pnl=${txrTotPnl.toFixed(2)}  var=${(txrTotEng - txrTotPnl).toFixed(2)}`);
  txrBucketSigns.forEach(x => console.log(`  bucket=${x.b}  eng=${x.eR.toFixed(2)}  pnl=${x.p.toFixed(2)}  var=${x.v.toFixed(2)}`));
  const negBuckets = txrBucketSigns.filter(x => x.v < 0).length;
  console.log(`  buckets negative: ${negBuckets} of ${txrBucketSigns.length}`);

  console.log(`\n== P${periodNum} TOP 15 UNEXPLAINED (account/code/var/eng/pnl) ==`);
  variances.filter(v => v.cause === 'UNEXPLAINED').slice(0, 15).forEach(v => {
    console.log(`  ${v.ak.padEnd(16)} ${v.code.padEnd(8)} var=${v.var.toFixed(2).padStart(12)} eng=${v.eng.toFixed(2).padStart(12)} pnl=${v.pnl.toFixed(2).padStart(12)}`);
  });

  return { variances, unexplainedDollars, portEngRolled, portPnl, txrTotEng, txrTotPnl, txrBucketSigns, negBuckets };
}

async function main() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(PL_PATH);

  const p7 = await tieOutPeriod(sb, wb, 7, P7_START, P7_END);
  const p8 = await tieOutPeriod(sb, wb, 8, P8_START, P8_END);

  console.log('\n===== SUMMARY: P7 vs P8 UNEXPLAINED =====');
  console.log(`P7 UNEXPLAINED total: $${p7.unexplainedDollars.toFixed(2)} across ${p7.variances.filter(v => v.cause === 'UNEXPLAINED').length} cells`);
  console.log(`P8 UNEXPLAINED total: $${p8.unexplainedDollars.toFixed(2)} across ${p8.variances.filter(v => v.cause === 'UNEXPLAINED').length} cells`);

  // Accounts that miss in BOTH periods (structural)
  const p7Miss = new Map(); // "ak|code" -> {p7var, p8var}
  const p8Miss = new Map();
  for (const v of p7.variances.filter(x => x.cause === 'UNEXPLAINED')) p7Miss.set(`${v.ak}|${v.code}`, v);
  for (const v of p8.variances.filter(x => x.cause === 'UNEXPLAINED')) p8Miss.set(`${v.ak}|${v.code}`, v);
  const bothMiss = [];
  for (const [k, v7] of p7Miss) {
    const v8 = p8Miss.get(k);
    if (v8) bothMiss.push({ key: k, ak: v7.ak, code: v7.code, p7var: v7.var, p8var: v8.var, p7eng: v7.eng, p7pnl: v7.pnl, p8eng: v8.eng, p8pnl: v8.pnl });
  }
  bothMiss.sort((a, b) => (Math.abs(b.p7var) + Math.abs(b.p8var)) - (Math.abs(a.p7var) + Math.abs(a.p8var)));

  console.log(`\n===== Accounts/codes that MISS IN BOTH P7 AND P8 (${bothMiss.length}) =====`);
  console.log(`(sorted by combined |var|; positive var = engine > P&L)`);
  bothMiss.forEach(m => {
    console.log(`  ${m.ak.padEnd(16)} ${m.code.padEnd(8)}  P7 var=${m.p7var.toFixed(2).padStart(12)}  P8 var=${m.p8var.toFixed(2).padStart(12)}   P7 eng=${m.p7eng.toFixed(2).padStart(10)} pnl=${m.p7pnl.toFixed(2).padStart(10)}  |  P8 eng=${m.p8eng.toFixed(2).padStart(10)} pnl=${m.p8pnl.toFixed(2).padStart(10)}`);
  });

  console.log(`\n===== TXR-AZ verdict =====`);
  console.log(`P7 TXR-AZ 5-bucket eng=${p7.txrTotEng.toFixed(2)} pnl=${p7.txrTotPnl.toFixed(2)} var=${(p7.txrTotEng - p7.txrTotPnl).toFixed(2)} negBuckets=${p7.negBuckets}/5`);
  console.log(`P8 TXR-AZ 5-bucket eng=${p8.txrTotEng.toFixed(2)} pnl=${p8.txrTotPnl.toFixed(2)} var=${(p8.txrTotEng - p8.txrTotPnl).toFixed(2)} negBuckets=${p8.negBuckets}/5`);
  const txrBothMiss = bothMiss.filter(m => m.ak === 'TXR - AZ');
  console.log(`TXR-AZ cells missing in BOTH: ${txrBothMiss.length}`);
  txrBothMiss.forEach(m => console.log(`  ${m.code.padEnd(8)}  P7 var=${m.p7var.toFixed(2).padStart(12)}  P8 var=${m.p8var.toFixed(2).padStart(12)}`));
}

main().catch(e => { console.error(e); process.exit(2); });
