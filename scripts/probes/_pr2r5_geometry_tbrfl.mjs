// TBR - FL geometry probe for tier C Food FYTD.
const BASE = process.env.KPI_BASE || 'http://localhost:3221';
const foodPrefix = (gl) => typeof gl === 'string' && gl.startsWith('3200');
function periodOf(w, periods) {
  for (const p of periods) if (w >= p.start && w <= p.end) return p.period_no;
  return null;
}
async function main() {
  const r = await fetch(`${BASE}/api/kpi/purchasing?account=TBR%20-%20FL`).then(x => x.json());
  const periods = r.periods;
  const weekly = r.weekly;
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
  const perUnitTargets = units.map(u => u.budget);
  const maxSample = Math.max(...perUnitTargets, ...units.map(u => Math.abs(u.spent) * 1.15), 1);
  console.log('TBR - FL Food FYTD tier C, maxSample:', maxSample.toFixed(2));
  console.log('P    spent           target          arith(t/s)  barH%   lineH%  clamped');
  for (const u of units) {
    const v = u.spent;
    const t = u.budget;
    const barRaw = (Math.abs(v)/maxSample)*100;
    const barC = Math.min(97, barRaw);
    const lnRaw = t>0 ? (t/maxSample)*100 : null;
    const lnC = lnRaw != null ? Math.min(97, lnRaw) : null;
    const clamped = (barRaw > 97) || (lnRaw != null && lnRaw > 97);
    console.log(`P${u.period_no}`.padEnd(4), `$${v.toFixed(2)}`.padEnd(16), `$${t.toFixed(2)}`.padEnd(16),
      (t/v).toFixed(3).padEnd(11), barC.toFixed(1).padEnd(7),
      (lnC != null ? lnC.toFixed(1) : '--').padEnd(7),
      clamped ? 'CLAMPED' : '');
  }
}
main().catch(e => { console.error(e); process.exit(2); });
