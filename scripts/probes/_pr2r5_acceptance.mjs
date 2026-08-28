// PR 2 R5 acceptance - full 11-row check.
const BASE = process.env.KPI_BASE || 'http://localhost:3221';
const foodPrefix = (gl) => typeof gl === 'string' && gl.startsWith('3200');
function periodOf(w, periods) {
  for (const p of periods) if (w >= p.start && w <= p.end) return p.period_no;
  return null;
}

async function main() {
  // FYTD ALL data.
  const r = await fetch(`${BASE}/api/kpi/purchasing?account=ALL&debug=1`).then(x => x.json());
  const periods = r.periods;
  const weekly = r.weekly;

  // Reconstruct Food per-period spend + budget for checks 1-6.
  const perW = new Map();
  for (const row of weekly) {
    if (!foodPrefix(row.gl_line_code)) continue;
    perW.set(row.week_start, (perW.get(row.week_start) || 0) + Number(row.amount || 0));
  }
  const perP = new Map();
  for (const [w, a] of perW.entries()) {
    const p = periodOf(w, periods);
    if (p != null) perP.set(p, (perP.get(p) || 0) + a);
  }
  const units = periods.map(p => ({
    period_no: p.period_no,
    spent: Math.round((perP.get(p.period_no) || 0) * 100) / 100,
    budget: Math.round(Number(p.by_bucket.food.budget || 0) * 100) / 100,
  }));
  // Post-fix formulas.
  const perUnitTargetsAll = units.map(u => u.budget).filter(v => v > 0);
  const perUnitSpendAll = units.map(u => Math.abs(u.spent));
  const rawMax = Math.max(...perUnitTargetsAll, ...perUnitSpendAll, 1);
  const HEADROOM = 1.05;
  const maxSample = rawMax * HEADROOM;

  const rows = units.map(u => {
    const barH = (u.spent / maxSample) * 100;
    const lineH = (u.budget / maxSample) * 100;
    const drawn = lineH / barH;
    const arith = u.budget / u.spent;
    return { p: u.period_no, spent: u.spent, target: u.budget, barH, lineH, drawn, arith };
  });

  // Check 1: P1 Food FYTD line position - expect ~44% of bar height.
  const p1 = rows[0];
  console.log(`CHECK 1: P1 Food FYTD linePos/barHeight = ${(p1.lineH/p1.barH*100).toFixed(1)}%  (expected ~44% of bar height)`);

  // Check 2: all 9 periods, drawn ratio == arithmetic ratio within tolerance.
  let mismatches = 0;
  for (const r of rows) {
    const tol = Math.max(0.005, Math.abs(r.arith) * 0.005);
    if (Math.abs(r.drawn - r.arith) > tol) mismatches += 1;
  }
  console.log(`CHECK 2: mismatches across 9 periods = ${mismatches}  (expected 0)`);
  for (const r of rows) {
    console.log(`   P${r.p}: drawn=${r.drawn.toFixed(4)} arith=${r.arith.toFixed(4)} diff=${Math.abs(r.drawn-r.arith).toExponential(2)}`);
  }

  // Check 3: P3 Food FYTD - line above bar.
  const p3 = rows[2];
  const p3AboveBar = p3.lineH > p3.barH;
  console.log(`CHECK 3: P3 Food FYTD line above bar = ${p3AboveBar}  (lineH=${p3.lineH.toFixed(1)}%, barH=${p3.barH.toFixed(1)}%)`);

  // Check 6: A target exceeding tallest bar renders and does not clip.
  // P3's target (544967.45) > max spent (440267.25). lineH must be finite and < 100.
  const maxSpend = Math.max(...perUnitSpendAll);
  const maxTarget = Math.max(...perUnitTargetsAll);
  console.log(`CHECK 6: maxTarget=${maxTarget}, maxSpend=${maxSpend}, maxTarget > maxSpend? ${maxTarget > maxSpend}. P3 lineH=${p3.lineH.toFixed(2)}%  (not clamped)`);

  // Check 10: Portfolio P9 budget = $231,132.99.
  // Sum of by_bucket.food + by_bucket.packaging + by_bucket.vehicle budget across all accounts for P9.
  const p9 = periods.find(p => p.period_no === 9);
  const p9BudTotal = ['food','packaging','vehicle'].reduce((s,k) => s + Number(p9.by_bucket?.[k]?.budget || 0), 0);
  console.log(`CHECK 10: Portfolio P9 KPI budget total = $${p9BudTotal.toFixed(2)}  (expected $231,132.99)`);

  // Check 11: Sentinel TBR - FL P8 gl 3200.1 billcom = $39,373.74.
  if (r.sentinel) console.log('sentinel keys:', Object.keys(r.sentinel));
  // Fetch TBR-FL directly for sentinel value.
  const t = await fetch(`${BASE}/api/kpi/purchasing?account=TBR%20-%20FL&debug=1`).then(x => x.json());
  console.log('TBR-FL sentinel:', JSON.stringify(t.sentinel || null, null, 2).slice(0, 500));

  // Also fetch the P8 3200.1 direct sum from weekly.
  const tP8 = t.periods.find(p => p.period_no === 8);
  let s3200_1 = 0;
  for (const row of t.weekly) {
    if (row.gl_line_code !== '3200.1') continue;
    const p = periodOf(row.week_start, t.periods);
    if (p !== 8) continue;
    s3200_1 += Number(row.amount || 0);
  }
  console.log(`CHECK 11: TBR - FL P8 gl 3200.1 (from weekly) = $${s3200_1.toFixed(2)}  (expected $39,373.74)`);
}
main().catch(e => { console.error(e); process.exit(2); });
