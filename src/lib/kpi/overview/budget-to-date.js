// src/lib/kpi/overview/budget-to-date.js
//
// Overview Phase 2 PR-3 (Master KPI CC seat).
//
// Budget-to-date computation for REVENUE lines (§5.5 open-period case).
// Cost lines get their budget_to_date_days from the drill boards
// (`board.budget_to_date_days` on labor + `totals.buckets_budget_to_
// date_days` on purchasing) - one implementation per number, sitting
// on the engine that owns that number.
//
// This module is the equivalent for REVENUE lines that the Overview
// resolver owns end-to-end (per-meal 2400.1 / 2400.2, service charges
// 2300, catering 2200, consulting 2600, fee accounts' 2400.1).
//
// Contract (mirrors the labor + purchasing helpers):
//   - Closed periods in range: full period budget.
//   - Current period (contains today): period budget x (days_elapsed_
//     through_yesterday / days_in_period).
//   - Future periods: nothing.
//
// Inputs:
//   - budgetByPeriod: Map<periodNo, amount> for ONE line, already
//     summed across members (aggregate case) or the single member's
//     own budget (single-account case).
//   - periodsInRange: number[] sorted ascending, the fiscal periods
//     the range's fiscal weeks touch.
//   - today: ISO YYYY-MM-DD.
//
// Output:
//   { amount, days_elapsed_current, days_in_current, current_period_no,
//     closed_period_nos }
//
//   amount is null when no budget rows exist for any period in the
//   range (matches labor + purchasing helpers' "no data" semantic).
//   amount is 0 when budgets exist but only for future periods (a
//   valid zero, not a null).

import { periodStartISO, periodEndISO } from "@/app/kpi/labor/lib/periods.js";

const MS_PER_DAY = 86400000;

function parseISOUTC(iso) {
  const m = String(iso || "").slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function computeBudgetToDateForLine({ budgetByPeriod, periodsInRange, today }) {
  const empty = { amount: null, days_elapsed_current: null, days_in_current: null, current_period_no: null, closed_period_nos: [] };
  if (!budgetByPeriod || (typeof budgetByPeriod.size === "number" && budgetByPeriod.size === 0)) {
    return empty;
  }
  const todayD = parseISOUTC(today);
  if (!todayD) return empty;
  const getBudget = (p) => {
    if (typeof budgetByPeriod.get === "function") {
      const v = budgetByPeriod.get(Number(p));
      return v == null ? null : Number(v);
    }
    const v = budgetByPeriod[p] ?? budgetByPeriod[String(p)];
    return v == null ? null : Number(v);
  };
  let total = 0;
  let anyContribution = false;
  const closed = [];
  let currentPeriodNo = null;
  let daysElapsedCurrent = null;
  let daysInCurrent = null;
  for (const p of periodsInRange) {
    const pStart = parseISOUTC(periodStartISO(p));
    const pEnd = parseISOUTC(periodEndISO(p));
    if (!pStart || !pEnd) continue;
    const amt = getBudget(p);
    if (pEnd < todayD) {
      closed.push(p);
      if (amt != null) {
        total += amt;
        anyContribution = true;
      }
    } else if (pStart <= todayD && todayD <= pEnd) {
      currentPeriodNo = p;
      const daysInclusive = Math.floor((pEnd.getTime() - pStart.getTime()) / MS_PER_DAY) + 1;
      daysInCurrent = daysInclusive;
      const daysThroughYesterday = Math.max(0, Math.floor((todayD.getTime() - pStart.getTime()) / MS_PER_DAY));
      daysElapsedCurrent = Math.min(daysThroughYesterday, daysInclusive);
      if (amt != null) {
        total += amt * (daysElapsedCurrent / daysInclusive);
        anyContribution = true;
      }
    }
    // future: no contribution
  }
  if (!anyContribution) {
    // No budget rows in range at all: null (no data).
    // Budget rows only for future periods: 0 (nothing elapsed yet).
    // Distinguished by whether we saw any row for any period in range.
    const seenAny = periodsInRange.some(p => getBudget(p) != null);
    return {
      amount: seenAny ? 0 : null,
      days_elapsed_current: daysElapsedCurrent,
      days_in_current: daysInCurrent,
      current_period_no: currentPeriodNo,
      closed_period_nos: closed,
    };
  }
  return {
    amount: Math.round(total * 100) / 100,
    days_elapsed_current: daysElapsedCurrent,
    days_in_current: daysInCurrent,
    current_period_no: currentPeriodNo,
    closed_period_nos: closed,
  };
}

// Full-period budget over the range (closed + current period + future).
// Used for the "Period budget" / "Full year budget" side of the revenue
// card. Sum of every period's budget in periodsInRange, no proration.
export function computeFullPeriodBudget({ budgetByPeriod, periodsInRange }) {
  if (!budgetByPeriod) return null;
  const getBudget = (p) => {
    if (typeof budgetByPeriod.get === "function") {
      const v = budgetByPeriod.get(Number(p));
      return v == null ? null : Number(v);
    }
    const v = budgetByPeriod[p] ?? budgetByPeriod[String(p)];
    return v == null ? null : Number(v);
  };
  let total = 0;
  let any = false;
  for (const p of periodsInRange) {
    const amt = getBudget(p);
    if (amt != null) {
      total += amt;
      any = true;
    }
  }
  return any ? Math.round(total * 100) / 100 : null;
}

// Full-year budget - sums all 13 periods regardless of range. The
// revenue card renders this alongside "budget to date" on FYTD to
// contextualize where we are in the year (prototype `fy` field on the
// PNL table).
export function computeFullYearBudget({ budgetByPeriod }) {
  if (!budgetByPeriod) return null;
  const getBudget = (p) => {
    if (typeof budgetByPeriod.get === "function") {
      const v = budgetByPeriod.get(Number(p));
      return v == null ? null : Number(v);
    }
    const v = budgetByPeriod[p] ?? budgetByPeriod[String(p)];
    return v == null ? null : Number(v);
  };
  let total = 0;
  let any = false;
  for (let p = 1; p <= 13; p += 1) {
    const amt = getBudget(p);
    if (amt != null) {
      total += amt;
      any = true;
    }
  }
  return any ? Math.round(total * 100) / 100 : null;
}
