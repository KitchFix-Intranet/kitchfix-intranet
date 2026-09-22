// src/app/kpi/labor/lib/aggregate.js
//
// Consolidation PR 1 · Rippling labor table into the P&L Overview.
// Kevin ruling 2026-09-22: the aggregation math that turns the labor
// route's response into the props WeekTable requires (grouped,
// grand, workerRoster, workerRangeTotals, resolvedPreset) is
// extracted verbatim from labor/page.js so BOTH the labor section
// AND the new LaborLedger on the Overview page consume the same
// implementation. One implementation, two consumers.
//
// Rationale (Kevin): every defect we fixed in the 24h before this PR
// (R-127, R-140, R-141) was the same shape - one number computed
// twice in two places, agreeing by coincidence until it stopped.
// Duplicating 200 lines of aggregation to avoid touching a file
// would repeat the exact mistake this consolidation exists to
// remove.
//
// Guard 1 (VERBATIM): every function below is a byte-for-byte lift
// of the corresponding useMemo body in labor/page.js at the ref line
// noted per function. Do not "improve" while moving. Any behavioural
// change is a separate PR.
//
// PR 5 relocates this file when the labor section is deleted.
// Moving one file later is cheap; reconciling two drifted copies
// is not.

import { periodOf, fiscalYearOf, currentPeriodNo as periodOfDate, r93FytdEndISO } from "./periods";
import { periodsInBoardWeeks } from "./signalCardModels";
import { FY_START } from "./accounts";

// Verbatim from labor/page.js:58-65. Kept here so buildWorkerRoster
// stays self-contained; the label helper has no other consumer.
export function workerLabel(meta, worker_id, redact) {
  const num = meta?.number != null ? `#${meta.number}` : `#${String(worker_id).slice(0, 6)}`;
  if (redact || !meta?.display_name) {
    const title = meta?.title ? ` · ${meta.title}` : "";
    return `${num}${title}`;
  }
  return `${meta.display_name} (${num})`;
}

// Verbatim from labor/page.js:423-427.
export function buildFilteredActuals(actuals, selectedWorkers) {
  if (!actuals) return [];
  if (!selectedWorkers || selectedWorkers.size === 0) return actuals;
  return actuals.filter(r => selectedWorkers.has(r.worker_id));
}

// Verbatim from labor/page.js:448-529 (body only; signature wraps
// the useMemo body's free-variable set as parameters).
export function buildWeekAggregates(filteredActuals, aggregateExcludedSet, boardWeeks) {
  const excludedFromRollup = (r) => aggregateExcludedSet.has(r.account_key);

  if (!filteredActuals?.length) return [];
  const byWeek = new Map();
  for (const r of filteredActuals) {
    const wk = r.week_start;
    if (!byWeek.has(wk)) {
      byWeek.set(wk, {
        week_start: r.week_start, week_end: r.week_end,
        week_label: r.week_label,
        // H1: derive period client-side. Payload period_no is null on
        // backfill rows; we NEVER trust it.
        fiscal_year: fiscalYearOf(r.week_start) ?? r.fiscal_year ?? 2026,
        period_no: periodOf(r.week_start),
        hours_regular: 0, hours_overtime: 0, hours_double_time: 0, hours_premium_other: 0,
        dollars_regular: 0, dollars_overtime: 0, dollars_double_time: 0, dollars_premium_other: 0,
        amount: 0, hours_without_dollars: 0,
        // V42 REVISED (PR-B render fix) - the client-side weekly
        // rollup needs the status + anomaly totals too; WeekTable's
        // flagForV42State reads them directly off the aggregated
        // `w` object. Without these, the table row saw undefined
        // and the four-state model never fired.
        draft_entry_count:   0,
        draft_hours:         0,
        anomaly_no_clockout: 0,
        anomaly_under_1h:    0,
        anomaly_over_16h:    0,
        worker_rows: [], coverage_states: new Set(),
      });
    }
    const w = byWeek.get(wk);
    // Drill payload gets EVERY row; rollup sums drop excluded members
    // so the vs-budget compare stays population-matched (V25-3).
    w.worker_rows.push(r);
    w.coverage_states.add(r.coverage_state);
    if (excludedFromRollup(r)) continue;
    w.hours_regular       += Number(r.hours_regular       || 0);
    w.hours_overtime      += Number(r.hours_overtime      || 0);
    w.hours_double_time   += Number(r.hours_double_time   || 0);
    w.hours_premium_other += Number(r.hours_premium_other || 0);
    w.dollars_regular       += Number(r.dollars_regular       || 0);
    w.dollars_overtime      += Number(r.dollars_overtime      || 0);
    w.dollars_double_time   += Number(r.dollars_double_time   || 0);
    w.dollars_premium_other += Number(r.dollars_premium_other || 0);
    w.amount                += Number(r.amount                || 0);
    w.hours_without_dollars += Number(r.hours_without_dollars || 0);
    // V42 REVISED (PR-B render fix) - sum status + anomaly fields
    // per week so WeekTable.flagForV42State can read them off `w`.
    w.draft_entry_count     += Number(r.draft_entry_count     || 0);
    w.draft_hours           += Number(r.draft_hours           || 0);
    w.anomaly_no_clockout   += Number(r.anomaly_no_clockout   || 0);
    w.anomaly_under_1h      += Number(r.anomaly_under_1h      || 0);
    w.anomaly_over_16h      += Number(r.anomaly_over_16h      || 0);
  }
  for (const w of byWeek.values()) {
    const states = [...w.coverage_states];
    w.coverage_state = states.length === 1 ? states[0] : "partial";
    if ((w.coverage_state === "unknown" || w.coverage_state === "hours_only") && w.amount > 0.01) {
      console.warn(`kpi-labor: collapsed row ${w.week_start} has amount=$${w.amount.toFixed(2)}; demoting to partial`);
      w.coverage_state = "partial";
    }
  }
  // Kevin post-1055 sweep item 1+2 (2026-09-08). Enrich each client-
  // side week aggregate with the API-supplied per-week adjusted
  // budget (budget_at_this_week_revenue) so the table's period rows,
  // week rows, and grand total read the same basis the panel + chart
  // use. Prior state: weekAggregates was built from data.actuals
  // rows alone and never carried the batr field, so WeekTable's
  // periodTotals + per-week VS BUDGET quietly fell back to raw
  // week_budget (period_budget / 4) even though #1055 wired the
  // adjusted read - the fallback WAS the render. Reproducer:
  // TBJ - FL This year P3 chart said $7,597 under, table said $719
  // over ($8,316 apart, opposite sign) - both from the same payload.
  const boardWeeksByStart = new Map((boardWeeks || []).map(bw => [bw.week_start, bw]));
  for (const w of byWeek.values()) {
    const bw = boardWeeksByStart.get(w.week_start);
    if (bw && bw.budget_at_this_week_revenue != null) {
      w.budget_at_this_week_revenue = Number(bw.budget_at_this_week_revenue);
    }
  }
  // Sort desc so the newest week (P9 today) appears first.
  return [...byWeek.values()].sort((a, b) => b.week_start.localeCompare(a.week_start));
}

// Verbatim from labor/page.js:533-701 (body only).
export function buildGrouped(weekAggregates, rangeSelectionEarly, board) {
  // Labor empty-state fix (Kevin 2026-09-07): removed the
  // `if (!weekAggregates.length) return [];` early return that
  // short-circuited the zero-labor placeholder walk below when a
  // period had no actuals rows yet (Monday morning of a new
  // period). Without the walk, WeekTable saw an empty grouped list
  // and rendered nothing; the surviving canonical-periods loop
  // (`if (!groupByMonth && data?.board)` below) now populates
  // placeholder groups even when weekAggregates is empty, so the
  // table renders the period skeleton with "no labor recorded"
  // rows. The rest of this function iterates weekAggregates in
  // ways that are naturally no-ops when the list is empty.
  // V6-5 - grouping mode implied by selection. Month selection
  // groups by calendar month (weeks belong to the month their
  // MONDAY falls in - the same rule fiscalMonthsWithWeeks uses,
  // so a week never straddles). Every other selection groups by
  // fiscal period. No standalone group-by control.
  const groupByMonth = rangeSelectionEarly?.kind === "month";
  const MONTH_NAMES = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
  const groups = [];
  for (const w of weekAggregates) {
    const fy = w.fiscal_year ?? 2026;
    let key, sortKey, groupLabel, groupHint;
    if (groupByMonth) {
      // Parse week_start UTC-safe (Mondays).
      const [yy, mm] = w.week_start.split("-").map(Number);
      const year = yy;
      const monthIndex = mm - 1;
      key = `M-${year}-${monthIndex}`;
      sortKey = year * 100 + monthIndex;
      groupLabel = `${MONTH_NAMES[monthIndex]} ${year}`;
      groupHint = { kind: "month", year, monthIndex };
    } else {
      const p = w.period_no ?? 0;
      key = `P-${fy}|${p}`;
      sortKey = -(fy * 100 + p);  // period desc (existing convention)
      groupHint = { kind: "period", period_no: p, fiscal_year: fy };
    }
    let g = groups.find(x => x.key === key);
    if (!g) {
      g = { key, fiscal_year: fy, period_no: w.period_no ?? 0, weeks: [], subtotal: null, groupLabel, groupHint, sortKey };
      groups.push(g);
    }
    g.weeks.push(w);
  }
  // Month mode - sort ascending (Jan first). Period mode retains
  // the descending-by-period convention D2 shipped.
  if (groupByMonth) {
    groups.sort((a, b) => a.sortKey - b.sortKey);
  } else {
    groups.sort((a, b) => a.sortKey - b.sortKey);
  }
  // Month group headers append "· N fiscal wks" per V6-5.
  if (groupByMonth) {
    for (const g of groups) {
      g.groupLabel = `${g.groupLabel} · ${g.weeks.length} fiscal wk${g.weeks.length === 1 ? "" : "s"}`;
    }
  }
  for (const g of groups) {
    // HS FB1 hotfix 2026-08-25: subtotal now carries draft_hours so
    // the WeekTable grand-total Unapproved column reads it (via the
    // grand fold below). Same pattern as the WeekTable band/week
    // switch from hours_without_dollars -> draft_hours.
    const s = { hours_regular: 0, hours_overtime: 0, hours_double_time: 0, hours_premium_other: 0, amount: 0, hours_without_dollars: 0, draft_hours: 0 };
    for (const w of g.weeks) {
      s.hours_regular       += w.hours_regular;
      s.hours_overtime      += w.hours_overtime;
      s.hours_double_time   += w.hours_double_time;
      s.hours_premium_other += w.hours_premium_other;
      s.amount              += w.amount;
      s.hours_without_dollars += w.hours_without_dollars;
      s.draft_hours           += w.draft_hours || 0;
    }
    g.subtotal = s;
  }
  // 2026-08-26 polish round 2 item 6 - the table and TierCStrip must
  // count from the SAME period list. weekAggregates drops zero-labor
  // weeks (they never had actuals rows), so periods with no labor
  // in the range dropped from the table entirely - the chart showed
  // 9 bars while the table showed 7 for CIN - OH FYTD. Fix by walking
  // periodsInBoardWeeks(board) - the canonical range period list -
  // and appending a zero-labor placeholder group for any period not
  // already covered. TierCStrip reads from the same helper; both
  // components now count independently CAN'T diverge because they
  // share the derivation. Month grouping is unaffected (a month is
  // not a period, and no zero-labor month is currently rendered).
  //
  // 2026-08-26 fix (post-verify) - attach weeks_in_period from the
  // shared helper to EVERY period group, not only the zero-labor
  // placeholders. Prior fix left a partial-period defect: the
  // "N PERIODS · M WEEKS" total in WeekTable summed g.weeks.length
  // for present groups, which counts weeks-with-actuals, not
  // weeks-in-period. On CIN - OH FYTD (P3-P9 each had zero-labor
  // weeks inside them), the total read 9 PERIODS · 31 WEEKS instead
  // of 35. Same defect the item was meant to fix, one level down -
  // fix at the source. Pin weeks_in_period on every group; WeekTable
  // sums that field.
  if (!groupByMonth && board) {
    const canonicalPeriods = periodsInBoardWeeks(board);
    const canonicalByPeriod = new Map(canonicalPeriods.map(p => [p.period_no, p]));
    // Attach weeks_in_period from the shared source to every period
    // group. Groups built from weekAggregates get the canonical
    // count; if a period is missing from canonical (data drift),
    // fall back to the group's own weeks.length so the number stays
    // defined.
    //
    // Kevin CC ruling 2026-09-10 (post-#1108). Attach period-
    // total budget from STARTED board.weeks only (state !==
    // "not_started"). The rule: "no row displays a comparison
    // against a budget for a week that has not begun." A
    // period-band or grand-total row that summed all weeks'
    // batr would compare period-to-date spend against the
    // full-period budget, understating variance on any period
    // whose only started week is over. Started-weeks-only
    // budget keeps the compare like-for-like: on CP day 1 the
    // period budget equals week 1's own batr, so `▲ $X over`
    // on the period row equals the running week's variance.
    // On a fully-closed period every week is started so the
    // sum equals the whole-period batr - unchanged for LP + CY.
    const boardWeeksByPeriod = new Map();
    for (const bw of (board?.weeks || [])) {
      const p = periodOf(bw.week_start);
      if (p == null) continue;
      if (!boardWeeksByPeriod.has(p)) boardWeeksByPeriod.set(p, []);
      boardWeeksByPeriod.get(p).push(bw);
    }
    for (const g of groups) {
      if (g.groupHint?.kind !== "period") continue;
      const canonical = canonicalByPeriod.get(g.period_no);
      g.weeks_in_period = canonical ? canonical.weeks_in_period : g.weeks.length;
      const periodBoardWeeks = boardWeeksByPeriod.get(g.period_no) || [];
      let batrSum = 0, batrAny = false;
      for (const bw of periodBoardWeeks) {
        if (bw.state === "not_started") continue;
        if (bw.budget_at_this_week_revenue != null) {
          batrSum += Number(bw.budget_at_this_week_revenue);
          batrAny = true;
        }
      }
      g.period_budget_total = batrAny ? Math.round(batrSum * 100) / 100 : null;
    }
    // Append zero-labor placeholder groups for periods missing from
    // the actuals-derived groups.
    const seenPeriods = new Set(groups.filter(g => g.groupHint?.kind === "period").map(g => g.period_no));
    for (const p of canonicalPeriods) {
      if (seenPeriods.has(p.period_no)) continue;
      const key = `P-${p.fiscal_year}|${p.period_no}`;
      groups.push({
        key,
        fiscal_year: p.fiscal_year,
        period_no: p.period_no,
        weeks: [],
        subtotal: { hours_regular: 0, hours_overtime: 0, hours_double_time: 0, hours_premium_other: 0, amount: 0, hours_without_dollars: 0, draft_hours: 0 },
        groupLabel: undefined,
        groupHint: { kind: "period", period_no: p.period_no, fiscal_year: p.fiscal_year },
        sortKey: -(p.fiscal_year * 100 + p.period_no),
        // Marker for WeekTable render: no per-week rows for this
        // group; render as a single muted row explaining the state
        // as "no labor recorded". The board does not know WHY (season
        // hadn't started, facility closure, etc.) and does not claim.
        zero_labor: true,
        weeks_in_period: p.weeks_in_period,
      });
    }
    // Re-sort with the new groups included (existing convention).
    groups.sort((a, b) => a.sortKey - b.sortKey);
  }
  return groups;
}

// Verbatim from labor/page.js:733-739.
export function buildWorkerRoster(actuals, workers, redact) {
  if (!actuals) return [];
  const ids = [...new Set(actuals.map(r => r.worker_id))];
  return ids
    .map(id => ({ id, label: workerLabel(workers?.[id], id, redact), meta: workers?.[id] }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// Verbatim from labor/page.js:751-791.
export function buildGrand(grouped, today, avgRate) {
  if (!grouped.length) return null;
  // Kevin post-1049 sweep item 3 (2026-09-07). Multi-period ranges
  // exclude the running period from the grand total (R-78, matching
  // Overview). Prior code summed every group; TBJ - FL This year
  // total included P10 day-1 salary accrual and disagreed with
  // the panel's own "36 of 37 weeks closed · running not counted".
  // Single-period ranges that ARE the running period still
  // contribute (the whole point of viewing them).
  //
  // Kevin CC prompt 2026-09-10 (one definition of spent). Track
  // `hatched` (unpriced × rate + draft × rate) alongside amount
  // so the table's grand total Dollars column reads
  // spent = costed + unpriced + unapproved. Follows the same
  // running-period exclusion the amount + hours totals do.
  const rate = avgRate ?? null;
  const g = { hours_regular: 0, hours_overtime: 0, hours_double_time: 0, amount: 0, hours_without_dollars: 0, draft_hours: 0, hatched: 0 };
  const currentP = periodOfDate(today);
  for (const period of grouped) {
    const isRunning = period.groupHint?.kind === "period"
      && period.period_no === currentP
      && grouped.length > 1;
    if (isRunning) continue;
    g.hours_regular       += period.subtotal.hours_regular;
    g.hours_overtime      += period.subtotal.hours_overtime;
    g.hours_double_time   += period.subtotal.hours_double_time;
    g.amount              += period.subtotal.amount;
    g.hours_without_dollars += period.subtotal.hours_without_dollars;
    g.draft_hours           += period.subtotal.draft_hours || 0;
    for (const w of period.weeks || []) {
      const uphrs = Number(w.hours_without_dollars || 0);
      const draftHrs = Number(w.draft_hours || 0);
      const amt = Number(w.amount || 0);
      if (rate) {
        if (uphrs > 0.004) g.hatched += uphrs * Number(rate);
        if (draftHrs > 0.004 && amt > 0.5) g.hatched += draftHrs * Number(rate);
      }
    }
  }
  return g;
}

// Verbatim from labor/page.js:851-860.
export function buildWorkerRangeTotals(filteredActuals) {
  const m = {};
  for (const r of filteredActuals) {
    const id = r.worker_id;
    if (!m[id]) m[id] = { hoursWorked: 0, dollarsTotal: 0 };
    m[id].hoursWorked += Number(r.hours_regular || 0) + Number(r.hours_overtime || 0) + Number(r.hours_double_time || 0);
    m[id].dollarsTotal += Number(r.amount || 0);
  }
  return m;
}

// Verbatim from labor/page.js:871-892. `accountPeriods` is
// `data?.account_periods`; passing null falls through to the
// "no periods yet" branch (returns null).
export function computeResolvedPreset(lastPreset, start, end, today, accountPeriods) {
  if (lastPreset) return lastPreset; // user clicked one this session
  // R-93 (2026-09-09): fytd end is the last-settled period's end, not
  // today. A period enters the year only after 8 days past close.
  const fytdEnd = r93FytdEndISO(today);
  if (start === FY_START && fytdEnd && end === fytdEnd) return "fytd";
  // 2026-09-02 retire-custom PR: last_4wk inference removed - the
  // preset itself is retired (rolling window straddles periods and
  // produced the grain-mismatch defect Kevin measured on TBR - FL).
  // last_13wk was retired 2026-08-24 for the same reason.
  // this_period / last_period rely on account_periods bounds
  const periods = accountPeriods || [];
  if (periods.length) {
    const past = periods.filter(p => p.start && p.end && p.start <= today)
      .sort((a, b) => a.start.localeCompare(b.start));
    const cur = past[past.length - 1];
    const prev = past[past.length - 2];
    if (cur && start === cur.start && end === cur.end) return "this_period";
    if (prev && start === prev.start && end === prev.end) return "last_period";
  }
  return null;
}
