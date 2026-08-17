// src/app/kpi/labor/lib/budgets.js
//
// Real per-period budgets. Hero + cards + trend read from the labor
// route's budget_periods (Playbook 4.5 resolution: supersede wins,
// else P&L, else omitted). This module owns pure calculators
// (budget-for-range, elapsed %, supersede summaries) and the
// preset-suffix formatter.

import { periodOf, weekStartsInRange } from "./periods";

// Sum the per-period budget across every CALENDAR fiscal week that
// intersects [startISO, endISO]. Each week contributes its period's
// amount / 4 (4 weeks per fiscal period, always). Weeks whose period
// has no budget_periods row contribute 0 - that is a real budgeted-
// zero-week signal, not a bug; a partial map still sums what it has.
//
// F10 semantic (kpi-2 deliberate): budget spans ALL calendar weeks in
// range, not weeks-with-data. A budgeted week with no logged labor is
// underspend information, not a gap in the divisor. Pre-opening
// periods carry $0 amounts in the seed, so they cannot inflate.
//
// Envelope mode: the labor route omits budget_periods entirely for
// TXR - TX - V. Callers must gate on budget_mode before calling this.
export function budgetForRange(budgetPeriods, startISO, endISO) {
  if (!Array.isArray(budgetPeriods) || budgetPeriods.length === 0) return 0;
  const byPeriod = new Map();
  for (const bp of budgetPeriods) {
    if (bp && Number.isFinite(Number(bp.amount))) {
      byPeriod.set(Number(bp.period_no), Number(bp.amount));
    }
  }
  const weeks = weekStartsInRange(startISO, endISO);
  let sum = 0;
  for (const ws of weeks) {
    const p = periodOf(ws);
    if (p == null) continue;
    const amt = byPeriod.get(p);
    if (amt == null) continue;
    sum += amt / 4;
  }
  return Math.round(sum * 100) / 100;
}

// True iff any period intersecting [startISO, endISO] was superseded
// (playbook 4.5 - the dashboard marks the line and drills to the
// reason + P&L figure). Callers use this to decide whether to render
// the "superseded" marker on the budget sub-line.
export function hasSupersededInRange(budgetPeriods, startISO, endISO) {
  if (!Array.isArray(budgetPeriods) || budgetPeriods.length === 0) return false;
  const superByPeriod = new Map();
  for (const bp of budgetPeriods) {
    if (bp) superByPeriod.set(Number(bp.period_no), bp);
  }
  const seenPeriods = new Set();
  for (const ws of weekStartsInRange(startISO, endISO)) {
    const p = periodOf(ws);
    if (p != null) seenPeriods.add(p);
  }
  for (const p of seenPeriods) {
    const bp = superByPeriod.get(p);
    if (bp && bp.superseded) return true;
  }
  return false;
}

// Collect superseded entries whose period intersects [startISO,
// endISO]. Returns [{ period_no, amount, pnl_amount, reason }].
// Callers render this into the hover-title on the supersede marker.
export function supersededSummary(budgetPeriods, startISO, endISO) {
  if (!Array.isArray(budgetPeriods) || budgetPeriods.length === 0) return [];
  const byPeriod = new Map(budgetPeriods.map(bp => [Number(bp.period_no), bp]));
  const seen = new Set();
  for (const ws of weekStartsInRange(startISO, endISO)) {
    const p = periodOf(ws);
    if (p != null) seen.add(p);
  }
  const out = [];
  for (const p of seen) {
    const bp = byPeriod.get(p);
    if (bp && bp.superseded) {
      out.push({
        period_no: p,
        amount: bp.amount,
        pnl_amount: bp.pnl_amount,
        reason: bp.reason || null,
      });
    }
  }
  return out.sort((a, b) => a.period_no - b.period_no);
}

// elapsedPct - what % of the range window has already passed. Anchor
// for pace vs elapsed comparisons (spec §3.4 +b: pace warns when
// exceeds elapsed by > 2pts).
export function elapsedPct(startISO, endISO, todayISO) {
  const pd = (s) => new Date(s + "T00:00:00Z").getTime();
  const total = (pd(endISO) - pd(startISO)) / 86400000 + 1;
  const done  = Math.min(total, Math.max(0, (pd(todayISO) - pd(startISO)) / 86400000 + 1));
  return total > 0 ? (done / total) * 100 : 100;
}

// presetSuffix - human label for a resolved preset (F5).
export function presetSuffix(preset, startISO, endISO, currentPeriodNo) {
  switch (preset) {
    case "fytd":         return " · FY to date";
    case "this_period":  return currentPeriodNo != null ? ` · Period ${currentPeriodNo}` : " · this period";
    case "last_period":  return currentPeriodNo != null ? ` · Period ${currentPeriodNo - 1}` : " · last period";
    case "last_4wk":     return " · last 4 weeks";
    case "last_13wk":    return " · last 13 weeks";
    default: {
      const mdY = (iso) => {
        if (!iso) return "";
        const [y, m, d] = iso.slice(0, 10).split("-");
        return `${m}/${d}/${y.slice(2)}`;
      };
      return ` · ${mdY(startISO)}–${mdY(endISO)}`;
    }
  }
}
