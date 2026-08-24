"use client";
// src/app/kpi/labor/components/RangeMenu.js
//
// V6-3..V6-8 - the ONE time surface. Replaces the D2 scope band's
// preset chips + separate calendar-popover trigger with a single
// button + three-column menu (PRESETS · FISCAL PERIODS · MONTHS)
// and an inline Custom-range expansion that reuses the existing
// two-month picker.
//
// Selection semantics (V6-4):
//   preset -> existing relative resolution (this/last period, last
//             4/13 wk, FYTD)
//   period -> that period's exact dates (rangeForPeriod)
//   month  -> the CALENDAR month clamped to FY bounds. Post PR-2
//             follow-up 2026-08-24: was fiscal-week-based via
//             rangeForFiscalMonth, which broke PR-1's calendar-month
//             promise. See rangeForCalendarMonth for the clamp.
//   custom -> arbitrary dates via the inline calendar, Apply-gated
//
// Custom-expansion rules: staged endpoints live in local state;
// nothing commits until Apply. Cancel/Escape collapses the inline
// area but leaves the menu open. Outside-click closes the menu
// entirely and discards staging. Matches the v5 #calapply pattern
// D2.1 shipped (#665).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtDate } from "../lib/formatting";
import {
  FY_START_ISO,
  fiscalMonthsWithWeeks,
  rangeForCalendarMonth,
  rangeForPeriod,
} from "../lib/periods";
import { addDaysISO } from "@/lib/kpi/dateResolve";
import { FY_START } from "../lib/accounts";
import {
  MonthPanel,
  isoOf,
  parseISOLocal,
  startOfMonth,
  addMonths,
} from "./CalendarPopover";
import { validateLabel, formatSelection } from "../lib/rangeLabel";

// Range PR-2 2026-08-24: `last_13wk` preset retired. Joe asked what
// it was for in the 2026-08-19 review and neither he nor Kevin could
// answer. Nothing stays on the board that nobody can justify.
const PRESETS = [
  { key: "this_period", label: "This period" },
  { key: "last_period", label: "Last period" },
  { key: "last_4wk",    label: "Last 4 wk"   },
  { key: "fytd",        label: "FYTD"        },
];
const MONTH_ABBR = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const MONTH_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// Turn a preset key into a concrete range using the same rules
// applyPreset() uses in page.js. Kept local to avoid a page.js
// circular dep; page.js still owns the setLastPreset side-effect.
function resolvePreset(kind, { today, accountPeriods }) {
  if (kind === "fytd")      return { startISO: FY_START,             endISO: today };
  if (kind === "last_4wk")  return { startISO: addDaysISO(today, -27), endISO: today };
  const past = (accountPeriods || [])
    .filter(p => p.start && p.end && p.start <= today)
    .sort((a, b) => a.start.localeCompare(b.start));
  if (kind === "this_period") {
    const cur = past[past.length - 1];
    return cur ? { startISO: cur.start, endISO: cur.end } : null;
  }
  if (kind === "last_period") {
    const prev = past[past.length - 2];
    return prev ? { startISO: prev.start, endISO: prev.end } : null;
  }
  return null;
}

// V6-4 - the visible label on the trigger button. Reads canonical
// vocabulary: preset labels, "PERIOD n", "<MONTH> <year>", or
// "CUSTOM · <dates>" fallback.
//
// Returns { primary, dates } so the caller can render the date tail
// in its own span and let it ellipse first at narrow widths (S-10).
//
// Range PR-2 2026-08-24: URL `?label` hint takes precedence when it
// validates against the actual dates. Formats:
//   P1 - P3       multi-period
//   July 2026     single month (full name, was "JUL 2026")
//   Jan - Apr 2026 / Nov 2026 - Feb 2027   multi-month
// See lib/rangeLabel.js for parse/validate/format.
function triggerLabel({ startISO, endISO, resolvedPreset, monthSelected, periodSelected, urlLabel }) {
  const dates = `${fmtDate(startISO)} – ${fmtDate(endISO)}`;
  // URL label wins whenever it resolves back to the current dates.
  // A label that lies (dates changed under it) falls through so the
  // chip renders the date range instead of a stale name.
  const validated = validateLabel(urlLabel, startISO, endISO);
  if (validated) return { primary: formatSelection(validated), dates };
  if (resolvedPreset) {
    const preset = PRESETS.find(p => p.key === resolvedPreset);
    if (preset) return { primary: preset.label, dates };
  }
  // V33 item 4e - unify uppercase everywhere: table total prints
  // `TOTAL · PERIOD N` and the spend-card eyebrow prints `PERIOD N`;
  // the range-menu trigger matches. Multi-selection goes through
  // urlLabel above; the singletons here still read as before so
  // pre-PR-2 links keep their existing chip vocabulary.
  if (periodSelected != null) return { primary: `PERIOD ${periodSelected}`, dates };
  if (monthSelected) return { primary: `${MONTH_LONG[monthSelected.monthIndex]} ${monthSelected.year}`, dates };
  return { primary: "Custom", dates };
}

export function RangeMenu({
  startISO,
  endISO,
  todayISO,
  hasPeriods,
  accountPeriods,
  resolvedPreset,        // preset key inferred by page.js, may be null
  selectedPeriodNo,      // integer if the current range matches a period, else null
  selectedMonth,         // { year, monthIndex } if range matches a month, else null
  urlLabel,              // string from ?label, may be null; validated against dates
  onCommit,              // (startISO, endISO, selection) => void
                         // selection.kind:
                         //   preset  | period  | month     (singleton, unchanged)
                         //   periods | months            (multi-select, PR-2)
                         //   custom                        (custom drag)
  disabled,
}) {
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customPending, setCustomPending] = useState(null);   // Date | null
  const [customStaged, setCustomStaged] = useState(null);     // {start,end} | null
  const [customAnchor, setCustomAnchor] = useState(() => startOfMonth(parseISOLocal(startISO) || new Date()));
  // Range PR-2 - staged start for multi-select. `periodStaged` is a
  // period number (1..13); `monthStaged` is {year, monthIndex}. Only
  // one may be non-null at a time (units do not mix per spec).
  const [periodStaged, setPeriodStaged] = useState(null);
  const [monthStaged, setMonthStaged] = useState(null);
  const rootRef = useRef(null);
  // Clear staging whenever the menu closes so an abandoned first
  // click does not persist to the next open.
  useEffect(() => {
    if (!open) { setPeriodStaged(null); setMonthStaged(null); }
  }, [open]);

  // Outside-click closes menu AND discards Custom staging.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
        setCustomOpen(false);
        setCustomPending(null);
        setCustomStaged(null);
      }
    };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (customOpen) {
        setCustomOpen(false);
        setCustomPending(null);
        setCustomStaged(null);
      } else {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, customOpen]);

  const months = useMemo(() => fiscalMonthsWithWeeks(), []);

  const commit = useCallback((s, e, selection) => {
    onCommit?.(s, e, selection);
    setOpen(false);
    setCustomOpen(false);
    setCustomPending(null);
    setCustomStaged(null);
  }, [onCommit]);

  const label = triggerLabel({
    startISO, endISO, resolvedPreset,
    monthSelected: selectedMonth,
    periodSelected: selectedPeriodNo,
    urlLabel,
  });

  const canPickPreset = (k) => !((k === "this_period" || k === "last_period") && !hasPeriods);

  // Custom-picker click semantics (mirrors D2.1 CalendarPopover):
  // first click stages start; second stages full range; third resets
  // start. Apply commits; Cancel/Escape discards.
  function customPick(d) {
    if (customStaged) {
      setCustomStaged(null);
      setCustomPending(d);
      return;
    }
    if (!customPending) { setCustomPending(d); return; }
    let s = customPending, e = d;
    if (s > e) { const t = s; s = e; e = t; }
    setCustomStaged({ start: s, end: e });
    setCustomPending(null);
  }
  function applyCustom() {
    if (!customStaged) return;
    commit(isoOf(customStaged.start), isoOf(customStaged.end), { kind: "custom" });
  }
  function cancelCustom() {
    setCustomOpen(false);
    setCustomPending(null);
    setCustomStaged(null);
  }
  const visStart = customStaged ? customStaged.start : (customPending || parseISOLocal(startISO));
  const visEnd   = customStaged ? customStaged.end   : (customPending ? null   : parseISOLocal(endISO));

  const customHint = customStaged
    ? `${fmtDate(isoOf(customStaged.start))} – ${fmtDate(isoOf(customStaged.end))} staged · nothing applies until you press Apply`
    : customPending
      ? "Pick the end date."
      : "Pick the start date.";

  return (
    <div className="kpi-rmenu" ref={rootRef}>
      <button
        type="button"
        className={`kpi-ctl kpi-ctl-sel kpi-rmenu-trigger ${open ? "on" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open ? "true" : "false"}
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
      >
        <svg className="kpi-i" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="8"  y1="2" x2="8"  y2="6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="3"  y1="10" x2="21" y2="10" stroke="currentColor" strokeWidth="2.5" />
        </svg>
        <span className="kpi-rmenu-label kpi-rmenu-label-primary">{label.primary}</span>
        <span className="kpi-rmenu-label kpi-rmenu-label-dates">{label.dates}</span>
      </button>
      {open && (
        <div className="kpi-rmenu-pop" role="dialog" aria-label="Select date range">
          <div className="kpi-rmenu-col">
            <h5 className="kpi-rmenu-h">PRESETS</h5>
            <div className="kpi-rmenu-list">
              {PRESETS.map(p => (
                <button
                  key={p.key}
                  type="button"
                  className={`kpi-rmenu-item ${resolvedPreset === p.key ? "on" : ""}`}
                  disabled={!canPickPreset(p.key)}
                  onClick={() => {
                    const r = resolvePreset(p.key, { today: todayISO, accountPeriods });
                    if (r) commit(r.startISO, r.endISO, { kind: "preset", value: p.key });
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="kpi-rmenu-col">
            <h5 className="kpi-rmenu-h">FISCAL PERIODS</h5>
            <div className="kpi-rmenu-grid">
              {Array.from({ length: 13 }, (_, i) => i + 1).map(p => {
                const isSelected = selectedPeriodNo === p;
                const isStaged = periodStaged === p;
                // Between-range highlight: if the user has staged a
                // start, indicate every period in [staged, p]  or
                // [p, staged] on hover as pending inclusion. Static
                // for now (no hover state); the staging class tags
                // the clicked start.
                return (
                  <button
                    key={p}
                    type="button"
                    className={`kpi-rmenu-gp ${isSelected ? "on" : ""} ${isStaged ? "staged" : ""}`}
                    aria-pressed={isSelected ? "true" : "false"}
                    onClick={(e) => {
                      // Range PR-2 multi-select:
                      //   first click OR shift-click without staging
                      //     -> stage as start (single unit selected
                      //        if the user does not follow up)
                      //   second click on a DIFFERENT period, or
                      //   shift-click on any period, or click that
                      //   matches the staged one
                      //     -> commit as periods range (staged..this)
                      // Clicking a month while a period is staged
                      // (or vice versa) discards the cross-unit
                      // staging - units do not mix per spec.
                      setMonthStaged(null);
                      if (periodStaged == null || e.shiftKey === false && periodStaged === p) {
                        // Bare click with no staging OR clicking the
                        // exact staged period again = commit single.
                        if (periodStaged === p) {
                          const r = rangeForPeriod(p);
                          if (r) commit(r.startISO, r.endISO, { kind: "period", value: p });
                          return;
                        }
                        setPeriodStaged(p);
                        return;
                      }
                      // Second click with something staged: commit
                      // the range. Order the endpoints so start <= end.
                      const [start, end] = periodStaged <= p ? [periodStaged, p] : [p, periodStaged];
                      const a = rangeForPeriod(start);
                      const b = rangeForPeriod(end);
                      if (a && b) {
                        commit(a.startISO, b.endISO,
                          start === end
                            ? { kind: "period", value: start }
                            : { kind: "periods", start, end });
                      }
                    }}
                  >P{p}</button>
                );
              })}
            </div>
            {periodStaged != null && (
              <span className="kpi-rmenu-stagenote">click another period to set the end, or click P{periodStaged} again</span>
            )}
          </div>
          <div className="kpi-rmenu-col">
            <h5 className="kpi-rmenu-h">MONTHS · 2026</h5>
            <div className="kpi-rmenu-grid">
              {months.filter(m => m.year === 2026).map(m => {
                const isSelected = selectedMonth && selectedMonth.year === m.year && selectedMonth.monthIndex === m.monthIndex;
                const isStaged = monthStaged && monthStaged.year === m.year && monthStaged.monthIndex === m.monthIndex;
                // Range PR-2 follow-up 2026-08-24: calendar-month ranges,
                // FY-clamped. Tooltip reports span in days so an operator
                // reading "DEC" sees "3 days · clamped to fiscal year" -
                // Dec 2025 is 12/29-12/31, the only three FY days in
                // that calendar month.
                const r = rangeForCalendarMonth(m.year, m.monthIndex);
                const spanDays = r?.spanDays ?? 0;
                const daysInMonth = new Date(Date.UTC(m.year, m.monthIndex + 1, 0)).getUTCDate();
                const clamped = spanDays < daysInMonth;
                const title = r
                  ? `${spanDays} day${spanDays === 1 ? "" : "s"}${clamped ? " · clamped to fiscal year" : ""}`
                  : "outside fiscal year";
                return (
                  <button
                    key={`${m.year}-${m.monthIndex}`}
                    type="button"
                    className={`kpi-rmenu-gp ${isSelected ? "on" : ""} ${isStaged ? "staged" : ""}`}
                    aria-pressed={isSelected ? "true" : "false"}
                    title={title}
                    disabled={!r}
                    onClick={(e) => {
                      // Mirror the period logic. Discard any period
                      // staging so a period click after a month click
                      // starts fresh.
                      setPeriodStaged(null);
                      const same = monthStaged
                        && monthStaged.year === m.year
                        && monthStaged.monthIndex === m.monthIndex;
                      if (!monthStaged || (e.shiftKey === false && same)) {
                        if (same) {
                          const rr = rangeForCalendarMonth(m.year, m.monthIndex);
                          if (rr) commit(rr.startISO, rr.endISO, {
                            kind: "month",
                            value: { year: m.year, monthIndex: m.monthIndex },
                          });
                          return;
                        }
                        setMonthStaged({ year: m.year, monthIndex: m.monthIndex });
                        return;
                      }
                      // Compare {year, monthIndex} to order start <= end.
                      const other = monthStaged;
                      const clicked = { year: m.year, monthIndex: m.monthIndex };
                      const startFirst = (other.year < clicked.year)
                        || (other.year === clicked.year && other.monthIndex <= clicked.monthIndex);
                      const start = startFirst ? other : clicked;
                      const end   = startFirst ? clicked : other;
                      const a = rangeForCalendarMonth(start.year, start.monthIndex);
                      const b = rangeForCalendarMonth(end.year, end.monthIndex);
                      if (a && b) {
                        const isSame = start.year === end.year && start.monthIndex === end.monthIndex;
                        commit(a.startISO, b.endISO,
                          isSame
                            ? { kind: "month", value: start }
                            : { kind: "months", start, end });
                      }
                    }}
                  >{MONTH_ABBR[m.monthIndex]}</button>
                );
              })}
            </div>
            {monthStaged && (
              <span className="kpi-rmenu-stagenote">click another month to set the end, or click {MONTH_ABBR[monthStaged.monthIndex]} again</span>
            )}
          </div>
          <div className="kpi-rmenu-foot">
            {/* Range PR-2 2026-08-24: "expands below · Apply-gated"
                hint retired. It described the mechanism rather than
                the choice - the Custom range button already tells
                the operator what they get. */}
            <button
              type="button"
              className="kpi-rmenu-custom-btn"
              onClick={() => setCustomOpen(o => !o)}
              aria-expanded={customOpen ? "true" : "false"}
            >
              Custom range{customOpen ? " ▴" : " ▾"}
            </button>
          </div>
          {customOpen && (
            <div className="kpi-rmenu-custom">
              <div className="kpi-rmenu-custom-nav">
                <button type="button" className="kpi-cal-navbtn" onClick={() => setCustomAnchor(a => addMonths(a, -1))} aria-label="Previous month">‹</button>
                <button type="button" className="kpi-cal-navbtn kpi-cal-navbtn-right" onClick={() => setCustomAnchor(a => addMonths(a, 1))} aria-label="Next month">›</button>
              </div>
              <div className="kpi-cal-months">
                <MonthPanel monthAnchor={customAnchor} startD={visStart} endD={visEnd} onPick={customPick} />
                <MonthPanel monthAnchor={addMonths(customAnchor, 1)} startD={visStart} endD={visEnd} onPick={customPick} />
              </div>
              <div className="kpi-cal-foot">
                <span className="kpi-cal-hint">{customHint}</span>
                <span className="kpi-cal-foot-actions">
                  <button type="button" className="kpi-cal-cancel" onClick={cancelCustom}>Cancel</button>
                  <button
                    type="button"
                    className="kpi-btn kpi-btn-primary-v5"
                    onClick={applyCustom}
                    disabled={!customStaged}
                  >Apply range</button>
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
