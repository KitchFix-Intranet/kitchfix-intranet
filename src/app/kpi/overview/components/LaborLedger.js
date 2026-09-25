// src/app/kpi/overview/components/LaborLedger.js
//
// Consolidation PR 1 · commit 2/2 (2026-09-22). Kevin's ruling:
// the Labor and Purchasing sections are retired, all accounts get
// one section (P&L Overview) with supporting detail in collapsible
// tables below. This component surfaces the Rippling labor detail
// as a fold on the Overview page, mounted below the Full P&L on
// closed periods + current year and below "needs review today" on
// the current period.
//
// Fold chrome mirrors PnlStatement.js:346-376 (kpi-ov-card
// kpi-ov-fold-card + kpi-ov-fold-open when open, data-kpi-ov-open,
// aria-expanded). WeekTable rendered inside the fold, imported
// across route folders per Kevin's ruling ("Import WeekTable, do
// not move it. WeekTable.js stays where it is for this PR because
// the labor page still renders it").
//
// Aggregation math consumed from src/app/kpi/labor/lib/aggregate.js
// (extracted verbatim in commit 1), so the labor section and this
// surface produce the same figures by construction.
//
// Tooling stripped per Kevin's ruling: no Export, no names/numbers
// toggle, no jump-to-period nav, no Expand all / Collapse all. Row-
// level disclosure (per-period and per-week chevrons) stays -
// without it the table renders 27 workers × 9 periods × 4 weeks
// flat.
//
// Salary gate: server-side canSeeSalary already implements the
// rule. This component does not add a client-side check; it just
// forwards include_salary=1 to the labor fetch when the Overview
// is on +Salary and omits it on hourly. Guard D holds by fetch
// alone.

"use client";

import { useMemo, useState } from "react";
import { WeekTable, WEEK_TABLE_POP_BODY } from "@/app/kpi/labor/components/WeekTable";
import HelpPop from "@/app/kpi/labor/components/HelpPop";
import {
  buildFilteredActuals,
  buildWeekAggregates,
  buildGrouped,
  buildWorkerRoster,
  buildGrand,
  buildWorkerRangeTotals,
  computeResolvedPreset,
} from "@/app/kpi/labor/lib/aggregate";
import { inferRangeSelection } from "@/app/kpi/labor/lib/periods";

// LaborLedger consumes:
//   - labor: the response from /api/kpi/labor (or null when the
//            fetch has not landed / errored)
//   - laborError: string when the fetch failed. Rendered as an
//            inline note inside the fold so the Overview above
//            keeps rendering.
//   - account, start, end, today: passed straight into the
//            aggregation helpers and WeekTable.
//   - open, onToggle: controlled fold state owned by the page.
export default function LaborLedger({ labor, laborError, account, start, end, today, open, onToggle }) {
  // Row-level disclosure state stays local to the ledger. Kevin
  // ruling: "Row-level disclosure stays." Period and week chevrons
  // are presentation, not tooling.
  const [expandedPeriods, setExpandedPeriods] = useState(() => new Set());
  const [expandedWeeks, setExpandedWeeks] = useState(() => new Set());

  const rangeSelectionEarly = useMemo(() => inferRangeSelection(start, end), [start, end]);

  // No worker filter on this surface (that tooling was stripped).
  // Pass null so buildFilteredActuals returns actuals as-is.
  const filteredActuals = useMemo(
    () => buildFilteredActuals(labor?.actuals, null),
    [labor?.actuals],
  );

  const aggregateExcludedSet = useMemo(
    () => new Set(labor?.aggregate_excluded_members || []),
    [labor?.aggregate_excluded_members],
  );

  const weekAggregates = useMemo(
    () => buildWeekAggregates(filteredActuals, aggregateExcludedSet, labor?.board?.weeks),
    [filteredActuals, aggregateExcludedSet, labor?.board?.weeks],
  );

  const grouped = useMemo(
    () => buildGrouped(weekAggregates, rangeSelectionEarly, labor?.board),
    [weekAggregates, rangeSelectionEarly, labor?.board],
  );

  // Names mode always on (redact=false); the names/numbers toggle is
  // one of the tooling controls Kevin stripped.
  const workerRoster = useMemo(
    () => buildWorkerRoster(labor?.actuals, labor?.workers, false),
    [labor?.actuals, labor?.workers],
  );

  const grand = useMemo(
    () => buildGrand(grouped, today, labor?.board?.avg_rate),
    [grouped, today, labor?.board?.avg_rate],
  );

  // Editorial (2026-09-25) · fold header summary. Range-level hours
  // and dollars pulled from `grand`, which is already computed
  // upstream for WeekTable. Same pattern as PurchasingFold: a
  // collapsed fold still names what is inside. `null` when grand
  // is not yet available (payload still loading).
  const headerSummary = useMemo(() => {
    if (!grand) return null;
    // Kevin ruling 2026-09-25 (post PR-1222 review). Settled dollars
    // only. `grand.hours_regular + hours_overtime + hours_double_time`
    // excludes both `hours_without_dollars` and `draft_hours`, so the
    // hours side is a settled figure; using `amount + hatched` on the
    // dollar side would render an estimate (hatched = unpriced * rate
    // + draft * rate; see labor/lib/aggregate.js:352) as one
    // unlabelled figure sitting next to a settled hours count. The
    // two would count different populations. Amount only. The table
    // inside the fold explains the rest.
    const totalHrs = (grand.hours_regular || 0)
                   + (grand.hours_overtime || 0)
                   + (grand.hours_double_time || 0);
    const totalAmt = (grand.amount || 0);
    if (totalHrs <= 0 && totalAmt <= 0) return null;
    const hrs = Math.round(totalHrs).toLocaleString("en-US");
    const amt = (totalAmt < 0 ? "-$" : "$") + Math.abs(Math.round(totalAmt)).toLocaleString("en-US");
    return `${hrs} hrs · ${amt}`;
  }, [grand]);

  const workerRangeTotals = useMemo(
    () => buildWorkerRangeTotals(filteredActuals),
    [filteredActuals],
  );

  const resolvedPreset = useMemo(
    () => computeResolvedPreset(null, start, end, today, labor?.account_periods),
    [start, end, today, labor?.account_periods],
  );

  return (
    <div
      className={`kpi-ov-card kpi-ov-mt kpi-ov-fold-card kpi-ov-fold-panel${open ? " kpi-ov-fold-open" : ""}`}
      data-kpi-ov="labor-ledger"
      data-kpi-ov-open={open ? "1" : "0"}
    >
      {/* Consolidation PR 1 · commit 4 (2026-09-22). Header row
          holds the fold trigger and the HelpPop as SIBLINGS.
          Nesting HelpPop inside the trigger button would be
          button-in-button (invalid HTML). Sibling shape means a
          click on the "?" opens the popover without toggling the
          fold. .kpi-ov-fold-head layout in overview.css. Meta
          row (`{account} · {start} – {end}`) deleted per Kevin
          - the scope is already implied by the page filter and
          added a stray row between the fold header and the
          table's header row. Use id="qLaborFold" (not
          qWeekTable) - the labor page's own toolbar HelpPop is
          still on the page inside a display:none .kpi-tbar,
          so a duplicated id would put two data-hs-help="qWeek
          Table" nodes in the DOM and break existing probe
          selectors. */}
      <div className="kpi-ov-fold-head">
        <button
          type="button"
          className="kpi-ov-fold-trigger"
          data-kpi-ov="fold-labor"
          onClick={onToggle}
          aria-expanded={open ? "true" : "false"}
        >
          <span className="kpi-ov-eb">Rippling labor</span>
          {headerSummary && (
            <span className="kpi-ov-fold-summary" data-kpi-ov="labor-fold-summary">{headerSummary}</span>
          )}
          <span className="kpi-ov-fold-cv" aria-hidden="true">▾</span>
        </button>
        <HelpPop id="qLaborFold" title="The week table" body={WEEK_TABLE_POP_BODY} />
      </div>
      {open && (
        <>
          <div className="kpi-ov-cb">
            {laborError ? (
              <div className="kpi-ov-cp-led-warn" role="status" data-kpi-ov="labor-ledger-error">
                Labor detail could not load: {laborError}
              </div>
            ) : !labor ? (
              <div className="kpi-ov-cp-led-warn" role="status" data-kpi-ov="labor-ledger-loading">
                Loading labor detail…
              </div>
            ) : labor?.board?.applies === false || !labor?.actuals ? (
              <div className="kpi-ov-cp-led-warn" role="status" data-kpi-ov="labor-ledger-empty">
                No labor detail for this range.
              </div>
            ) : (
              // WeekTable · tooling props deliberately omitted or set
              // to no-ops so Expand all / Collapse all / Workers
              // filter / Names-Numbers toggle do not render. Kevin:
              // "If WeekTable takes props to drive any of the four
              // items above, pass them off rather than editing
              // WeekTable, so the labor page keeps its behavior for
              // Stage A."
              //
              // Correction to the PR 1 commit 2 message (2026-09-22):
              // that message said `boardKind="single_period_in_
              // progress"` hides all four toolbar clusters. It hides
              // THREE (Expand/Collapse, Workers filter, Names/
              // Numbers). The jump chips have their own gate at
              // WeekTable.js:495 (`chips.length >= 2`) and the
              // toolbar spacer, rule and HelpPop are unconditional.
              // The remaining clusters are hidden by the
              // `.kpi-app .kpi-ov-fold-card .kpi-tbar { display:
              // none }` rule in overview.css, added in commit 4 -
              // one scoped CSS rule, no WeekTable JSX change.
              //
              // onWorkersChange and onToggleRedact absent below so
              // those clusters do not render even if boardKind were
              // something else.
              <WeekTable
                account={account}
                grouped={grouped}
                grandTotal={grand}
                boardKind="single_period_in_progress"
                workers={labor.workers}
                actuals={labor.actuals || []}
                redact={false}
                workerRoster={[]}
                selectedWorkers={null}
                expandedPeriods={expandedPeriods}
                onTogglePeriod={(p) => {
                  setExpandedPeriods(prev => {
                    const next = new Set(prev);
                    if (next.has(p)) next.delete(p); else next.add(p);
                    return next;
                  });
                }}
                expandedWeeks={expandedWeeks}
                onToggleWeek={(w) => {
                  setExpandedWeeks(prev => {
                    const next = new Set(prev);
                    if (next.has(w)) next.delete(w); else next.add(w);
                    return next;
                  });
                }}
                todayISO={today}
                workerRangeTotals={workerRangeTotals}
                aggregateMode={false}
                budgetPeriods={labor?.budget_periods || []}
                weekBudgets={labor?.week_budgets || []}
                salary={labor?.salary_included ? {
                  rate_basis: labor.rate_basis,
                  blended_rate_hourly: labor.blended_rate_hourly,
                } : null}
                avgRate={labor?.board?.avg_rate ?? null}
                onPickAccount={null}
                rangeSelection={rangeSelectionEarly}
                resolvedPreset={resolvedPreset}
                rolledUpMembers={labor?.rolled_up_members || []}
                aggregateExcludedMembers={labor?.aggregate_excluded_members || []}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
