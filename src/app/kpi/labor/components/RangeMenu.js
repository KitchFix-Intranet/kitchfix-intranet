"use client";
// src/app/kpi/labor/components/RangeMenu.js
//
// The ONE time surface across Overview, Labor and Purchasing.
//
// 2026-09-02 "retire custom + rolling" PR (Kevin ruling): every
// range the platform will resolve is either FYTD or aligned to
// fiscal-period boundaries. That takes three things out of the
// menu:
//   - `last_4wk` preset (rolling window, straddles periods)
//   - the calendar popover (arbitrary dates - the input that
//      produced the 65.7% gross-margin defect on TBR - FL 08/03-
//      08/30)
//   - the `custom` selection kind (nothing consumes it after this
//      PR - zero unconsumed code)
//
// What remains:
//   PRESETS       - this_period, last_period, fytd (three items)
//   FISCAL PERIODS - single or multi (P1..P13), shift-click for a
//                   range (aligned by construction)
//   MONTHS        - calendar-month buttons; the server will snap
//                   these to the containing period per Kevin's
//                   rule 4 (see /api/kpi/*/route.js snapRange
//                   guard). The MONTHS column stays for now
//                   pending Kevin's read - flagged in the PR body.
//
// Selection semantics:
//   preset  - relative resolution (this/last period, FYTD)
//   period  - that period's exact dates via rangeForPeriod
//   periods - shift-click range (P1..P3), aligned to boundaries
//   month   - calendar-month clamped to FY (rangeForCalendarMonth)
//   months  - multi-month range

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtDate } from "../lib/formatting";
import {
  fiscalMonthsWithWeeks,
  rangeForCalendarMonth,
  rangeForPeriod,
} from "../lib/periods";
import { FY_START } from "../lib/accounts";
import { validateLabel, formatSelection } from "../lib/rangeLabel";

// PR-2 2026-08-24 retired `last_13wk`. This PR retires `last_4wk` -
// same reason: nobody could defend an arbitrary rolling window that
// straddles periods, and it produced the grain-mismatch defect
// (65.7% GM on TBR - FL 08/03-08/30).
const PRESETS = [
  { key: "this_period", label: "This period" },
  { key: "last_period", label: "Last period" },
  { key: "fytd",        label: "FYTD"        },
];
const MONTH_ABBR = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const MONTH_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// Turn a preset key into a concrete range.
function resolvePreset(kind, { today, accountPeriods }) {
  if (kind === "fytd") return { startISO: FY_START, endISO: today };
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

// Visible label on the trigger button. Reads canonical vocabulary:
// preset labels, "PERIOD n", "<MONTH> <year>", or "CUSTOM · <dates>"
// fallback. Returns { primary, dates } so the caller can render the
// date tail in its own span and let it ellipse first at narrow
// widths (S-10).
//
// URL `?label` hint takes precedence when it validates against the
// dates. See lib/rangeLabel.js.
function triggerLabel({ startISO, endISO, resolvedPreset, monthSelected, periodSelected, urlLabel, chipOverride, rangeSnap }) {
  const dates = `${fmtDate(startISO)} – ${fmtDate(endISO)}`;
  // 2026-09-02 snap disclosure: when the server snapped a
  // non-aligned URL to the containing period, the chip names it so
  // the operator sees where they landed rather than a chip that
  // silently reads a different range from the URL.
  if (rangeSnap && rangeSnap.snapped && rangeSnap.snapped_to?.period_no != null) {
    return {
      primary: `Period ${rangeSnap.snapped_to.period_no}`,
      dates: `${dates} · snapped from a custom range`,
    };
  }
  // HS PR-C: chipOverride wins ahead of every other path. Homestand
  // view names the stand rather than reading FYTD.
  if (chipOverride && chipOverride.primary) {
    return {
      primary: chipOverride.primary,
      dates: chipOverride.dates || dates,
    };
  }
  const validated = validateLabel(urlLabel, startISO, endISO);
  if (validated) return { primary: formatSelection(validated), dates };
  if (resolvedPreset) {
    const preset = PRESETS.find(p => p.key === resolvedPreset);
    if (preset) return { primary: preset.label, dates };
  }
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
  chipOverride,          // HS PR-C: { primary, dates } to override the trigger label
                         //   (homestand view names the stand: "HS 11 · MIA / STL")
  rangeSnap,             // { snapped, snapped_from, snapped_to } from payload.range_snap,
                         //   set when the server snapped a non-aligned URL to a period
  onCommit,              // (startISO, endISO, selection) => void
                         // selection.kind:
                         //   preset  | period  | month     (singleton)
                         //   periods | months            (multi-select)
  disabled,
}) {
  const [open, setOpen] = useState(false);
  // 2026-09-02: staged periods/months for multi-select. Only one may
  // be non-null at a time (units do not mix per spec).
  const [periodStaged, setPeriodStaged] = useState(null);
  const [monthStaged, setMonthStaged] = useState(null);
  const rootRef = useRef(null);
  // Clear staging whenever the menu closes so an abandoned first
  // click does not persist to the next open.
  useEffect(() => {
    if (!open) { setPeriodStaged(null); setMonthStaged(null); }
  }, [open]);

  // Outside-click closes the menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const months = useMemo(() => fiscalMonthsWithWeeks(), []);

  const commit = useCallback((s, e, selection) => {
    onCommit?.(s, e, selection);
    setOpen(false);
  }, [onCommit]);

  const label = triggerLabel({
    startISO, endISO, resolvedPreset,
    monthSelected: selectedMonth,
    periodSelected: selectedPeriodNo,
    urlLabel,
    chipOverride,
    rangeSnap,
  });

  const canPickPreset = (k) => !((k === "this_period" || k === "last_period") && !hasPeriods);

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
                return (
                  <button
                    key={p}
                    type="button"
                    className={`kpi-rmenu-gp ${isSelected ? "on" : ""} ${isStaged ? "staged" : ""}`}
                    aria-pressed={isSelected ? "true" : "false"}
                    onClick={(e) => {
                      // Multi-select semantics:
                      //   first click OR shift-click without staging
                      //     -> stage as start
                      //   second click on a DIFFERENT period, or
                      //   shift-click on any period, or click that
                      //   matches the staged one
                      //     -> commit as periods range (staged..this)
                      // Clicking a month while a period is staged
                      // (or vice versa) discards the cross-unit
                      // staging - units do not mix per spec.
                      setMonthStaged(null);
                      if (periodStaged == null || e.shiftKey === false && periodStaged === p) {
                        if (periodStaged === p) {
                          const r = rangeForPeriod(p);
                          if (r) commit(r.startISO, r.endISO, { kind: "period", value: p });
                          return;
                        }
                        setPeriodStaged(p);
                        return;
                      }
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
        </div>
      )}
    </div>
  );
}
