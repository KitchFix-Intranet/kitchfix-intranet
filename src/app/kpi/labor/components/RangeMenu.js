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
//   month  -> every fiscal week whose Monday falls in that calendar
//             month; date echo appends "· N fiscal wks"
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
  rangeForFiscalMonth,
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

const PRESETS = [
  { key: "this_period", label: "This period" },
  { key: "last_period", label: "Last period" },
  { key: "last_4wk",    label: "Last 4 wk"   },
  { key: "last_13wk",   label: "Last 13 wk"  },
  { key: "fytd",        label: "FYTD"        },
];
const MONTH_LABELS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

// Turn a preset key into a concrete range using the same rules
// applyPreset() uses in page.js. Kept local to avoid a page.js
// circular dep; page.js still owns the setLastPreset side-effect.
function resolvePreset(kind, { today, accountPeriods }) {
  if (kind === "fytd")      return { startISO: FY_START,             endISO: today };
  if (kind === "last_4wk")  return { startISO: addDaysISO(today, -27), endISO: today };
  if (kind === "last_13wk") return { startISO: addDaysISO(today, -90), endISO: today };
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
function triggerLabel({ startISO, endISO, resolvedPreset, monthSelected, periodSelected }) {
  if (resolvedPreset) {
    const preset = PRESETS.find(p => p.key === resolvedPreset);
    if (preset) return `${preset.label} · ${fmtDate(startISO)} – ${fmtDate(endISO)}`;
  }
  if (periodSelected != null) {
    return `Period ${periodSelected} · ${fmtDate(startISO)} – ${fmtDate(endISO)}`;
  }
  if (monthSelected) {
    return `${MONTH_LABELS[monthSelected.monthIndex]} ${monthSelected.year} · ${fmtDate(startISO)} – ${fmtDate(endISO)}`;
  }
  return `Custom · ${fmtDate(startISO)} – ${fmtDate(endISO)}`;
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
  onCommit,              // (startISO, endISO, selection) => void
                         // selection: { kind, value? }
  disabled,
}) {
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customPending, setCustomPending] = useState(null);   // Date | null
  const [customStaged, setCustomStaged] = useState(null);     // {start,end} | null
  const [customAnchor, setCustomAnchor] = useState(() => startOfMonth(parseISOLocal(startISO) || new Date()));
  const rootRef = useRef(null);

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
        className={`kpi-rmenu-trigger ${open ? "on" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open ? "true" : "false"}
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
      >
        <svg className="kpi-i" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="1.75" />
          <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <line x1="8"  y1="2" x2="8"  y2="6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <line x1="3"  y1="10" x2="21" y2="10" stroke="currentColor" strokeWidth="1.75" />
        </svg>
        <span className="kpi-rmenu-label">{label}</span>
        <span className="kpi-rmenu-caret" aria-hidden="true">▾</span>
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
              {Array.from({ length: 13 }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  type="button"
                  className={`kpi-rmenu-gp ${selectedPeriodNo === p ? "on" : ""}`}
                  onClick={() => {
                    const r = rangeForPeriod(p);
                    if (r) commit(r.startISO, r.endISO, { kind: "period", value: p });
                  }}
                >P{p}</button>
              ))}
            </div>
          </div>
          <div className="kpi-rmenu-col">
            <h5 className="kpi-rmenu-h">MONTHS · 2026</h5>
            <div className="kpi-rmenu-grid">
              {months.filter(m => m.year === 2026).map(m => {
                const on = selectedMonth && selectedMonth.year === m.year && selectedMonth.monthIndex === m.monthIndex;
                return (
                  <button
                    key={`${m.year}-${m.monthIndex}`}
                    type="button"
                    className={`kpi-rmenu-gp ${on ? "on" : ""}`}
                    title={`${m.weekCount} fiscal ${m.weekCount === 1 ? "wk" : "wks"}`}
                    onClick={() => {
                      const r = rangeForFiscalMonth(m.year, m.monthIndex);
                      if (r) commit(r.startISO, r.endISO, {
                        kind: "month",
                        value: { year: m.year, monthIndex: m.monthIndex },
                      });
                    }}
                  >{MONTH_LABELS[m.monthIndex]}</button>
                );
              })}
            </div>
          </div>
          <div className="kpi-rmenu-foot">
            <button
              type="button"
              className="kpi-rmenu-custom-btn"
              onClick={() => setCustomOpen(o => !o)}
              aria-expanded={customOpen ? "true" : "false"}
            >
              Custom range{customOpen ? " ▴" : " ▾"}
            </button>
            <span className="kpi-rmenu-foot-hint">expands below · Apply-gated</span>
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
