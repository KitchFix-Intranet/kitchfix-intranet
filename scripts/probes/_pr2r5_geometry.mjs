// PR 2 R5 Part A - geometry probe.
// Reads /api/kpi/purchasing for ALL account, reconstructs the exact
// unit array that BucketCard passes to WeekChart for Food FYTD tier C,
// and prints:
//   - per-period bar height and line position (as WeekChart computes them)
//   - the ratio linePos/barHeight vs the arithmetic target/spent
//   - flags any period whose two ratios disagree beyond tolerance
//
// The formulas here are copied VERBATIM from WeekChart.js at HEAD so
// this reflects what the user actually sees drawn.

const BASE = process.env.KPI_BASE || 'http://localhost:3221';

function periodOf(weekIso, periods) {
  // A week belongs to the period whose [start,end] contains its start day.
  for (const p of periods) {
    if (weekIso >= p.start && weekIso <= p.end) return p.period_no;
  }
  return null;
}

const foodPrefix = (gl) => typeof gl === 'string' && gl.startsWith('3200');

async function main() {
  const r = await fetch(`${BASE}/api/kpi/purchasing?account=ALL`).then(x => x.json());
  const periods = r.periods;
  const weekly = r.weekly;
  const range = r.range;

  // Per-week Food spend for the whole FYTD range.
  const weekSpend = new Map();
  for (const row of weekly) {
    if (!foodPrefix(row.gl_line_code)) continue;
    const w = row.week_start;
    weekSpend.set(w, (weekSpend.get(w) || 0) + Number(row.amount || 0));
  }

  // Aggregate to periods.
  const perPeriodSpend = new Map();
  for (const [w, amt] of weekSpend.entries()) {
    const p = periodOf(w, periods);
    if (p == null) continue;
    perPeriodSpend.set(p, (perPeriodSpend.get(p) || 0) + amt);
  }

  // Build units array like page.js Tier C would.
  const units = periods.map(p => ({
    period_no: p.period_no,
    spent: Math.round((perPeriodSpend.get(p.period_no) || 0) * 100) / 100,
    budget: Math.round(Number(p.by_bucket.food.budget || 0) * 100) / 100,
    finished: !!p.finished,
    running: !!p.running,
  }));

  // Replicate WeekChart.js maxSample logic verbatim (isPeriod branch).
  const perUnitTargets = units.map(u => Number(u.budget || 0));
  const maxSample = Math.max(
    ...perUnitTargets,
    ...units.map(u => Math.abs(Number(u.spent || 0)) * 1.15),
    1,
  );

  console.log('range:', range.start, '->', range.end);
  console.log('maxSample:', maxSample.toFixed(2));
  console.log('');
  console.log('per-period geometry (Food, FYTD, tier C, ALL):');
  console.log('');
  console.log('P    spent           target          arith(t/s)  barH%   lineH%  linePos/barH  clamped');
  console.log('---  --------------  --------------  ---------   -----   -----   ------------  -------');

  let mismatch = 0;
  for (const u of units) {
    const v = Number(u.spent || 0);
    const showBar = v != null && Math.abs(v) > 0.005;
    const heightRaw = showBar ? (Math.abs(v) / maxSample) * 100 : 0;
    const heightClamped = showBar ? Math.min(97, heightRaw).toFixed(1) : '0.0';
    const target = Number(u.budget || 0);
    const orLineRaw = target > 0 ? (target / maxSample) * 100 : null;
    const orLineClamped = target > 0 ? Math.min(97, orLineRaw).toFixed(1) : null;
    const arith = target / v;
    const drawnRatio = orLineClamped != null && Number(heightClamped) > 0
      ? Number(orLineClamped) / Number(heightClamped)
      : null;
    const clampFired = (heightRaw > 97) || (orLineRaw != null && orLineRaw > 97);
    console.log(
      `P${u.period_no}`.padEnd(4),
      `$${v.toFixed(2)}`.padEnd(16),
      `$${target.toFixed(2)}`.padEnd(16),
      arith.toFixed(3).padEnd(11),
      heightClamped.padEnd(7),
      (orLineClamped != null ? orLineClamped : '--').padEnd(7),
      (drawnRatio != null ? drawnRatio.toFixed(3) : '--').padEnd(13),
      clampFired ? 'CLAMPED' : ''
    );
    if (drawnRatio != null && Math.abs(drawnRatio - arith) > 0.01) {
      mismatch += 1;
    }
  }
  console.log('');
  console.log('mismatches (drawn ratio vs arithmetic ratio):', mismatch);
}
main().catch(e => { console.error(e); process.exit(2); });
