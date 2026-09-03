"use client";
// src/app/kpi/labor/components/RangeMenu.js
//
// The ONE time surface across Overview, Labor and Purchasing.
//
// 2026-09-02 retire-months + retire-custom PRs: MONTHS column,
// last_4wk, custom-drag calendar, and the `custom` selection kind
// all removed in prior work.
//
// 2026-09-03 selector redesign (Kevin) + R-62: multi-period selection
// retired, "Next period" joins the preset row, every period button
// carries its dates, four period states (closed / running / next /
// not-started) with a legend, 5-across grid, stacked layout, and
// "FYTD" reads "This year" in the menu (the chip still reads FYTD
// where space is tight and the audience is Kevin).
//
// What remains:
//   QUICK RANGES  - this_period, next_period, last_period, fytd
//                   (in that order per item 6b)
//   PERIOD GRID   - single period (P1..P13), dates on every button,
//                   four states via periodPickerState()
//
// Selection semantics:
//   preset  - relative resolution (this/next/last period, FYTD)
//   period  - that period's exact dates via rangeForPeriod
//
// R-62: only the next period after the running one is enabled;
// everything past it is disabled. See periodPickerState().

import { useCallback, useEffect, useRef, useState } from "react";
import { fmtDate } from "../lib/formatting";
import { rangeForPeriod, currentPeriodNo, periodPickerState, periodDateShort } from "../lib/periods";
import { FY_START } from "../lib/accounts";
import { validateLabel, formatSelection } from "../lib/rangeLabel";

const PRESETS = [
  { key: "this_period", label: "This period" },
  { key: "next_period", label: "Next period" },
  { key: "last_period", label: "Last period" },
  { key: "fytd",        label: "This year"   },
];

// Turn a preset key into a concrete range.
// Redesign 2026-09-03: `next_period` joins the set (R-62 opens the
// one period after the running one). Resolved directly off the FY
// calendar - no accountPeriods entry is needed because the "next"
// period never has actuals yet by definition.
function resolvePreset(kind, { today, accountPeriods }) {
  if (kind === "fytd") return { startISO: FY_START, endISO: today };
  if (kind === "next_period") {
    const cur = currentPeriodNo(today);
    if (cur == null) return null;
    const r = rangeForPeriod(cur + 1);
    return r ? { startISO: r.startISO, endISO: r.endISO } : null;
  }
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
// preset labels, "PERIOD n", multi-period via urlLabel. Returns
// { primary, dates } so the caller can render the date tail in its
// own span and let it ellipse first at narrow widths (S-10).
//
// URL `?label` hint takes precedence when it validates against the
// dates. See lib/rangeLabel.js.
function triggerLabel({ startISO, endISO, resolvedPreset, periodSelected, urlLabel, chipOverride, rangeSnap }) {
  const dates = `${fmtDate(startISO)} – ${fmtDate(endISO)}`;
  // Snap disclosure: when the server snapped a non-aligned URL to
  // the containing period, the chip names it.
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
  urlLabel,              // string from ?label, may be null; validated against dates
  chipOverride,          // HS PR-C: { primary, dates } to override the trigger label
                         //   (homestand view names the stand: "HS 11 · MIA / STL")
  rangeSnap,             // { snapped, snapped_from, snapped_to } from payload.range_snap,
                         //   set when the server snapped a non-aligned URL to a period
  onCommit,              // (startISO, endISO, selection) => void
                         // selection.kind: preset | period
  disabled,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

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

  const commit = useCallback((s, e, selection) => {
    onCommit?.(s, e, selection);
    setOpen(false);
  }, [onCommit]);

  const label = triggerLabel({
    startISO, endISO, resolvedPreset,
    periodSelected: selectedPeriodNo,
    urlLabel,
    chipOverride,
    rangeSnap,
  });

  // Preset gates (2026-09-03 redesign):
  //   this_period, last_period - need historical periods
  //   next_period              - needs the running+1 slot inside FY
  //   fytd                     - always pickable
  const running = currentPeriodNo(todayISO);
  const canPickPreset = (k) => {
    if (k === "this_period" || k === "last_period") return !!hasPeriods;
    if (k === "next_period") return running != null && running + 1 <= 13;
    return true;
  };

  // Dates on every quick range (item 4). "This year" reads
  // "P1 – P{running} to date" so an operator knows the span at a
  // glance without opening the chip.
  const presetDates = (k) => {
    const r = resolvePreset(k, { today: todayISO, accountPeriods });
    if (!r) return null;
    if (k === "fytd") return running ? `P1 – P${running} to date` : null;
    // this / next / last: derive the period_no from the resolved range
    // so the date sub-label reads "P8 · 07/13 – 08/09".
    for (let p = 1; p <= 13; p += 1) {
      const rp = rangeForPeriod(p);
      if (rp && rp.startISO === r.startISO && rp.endISO === r.endISO) {
        return `P${p} · ${periodDateShort(p)}`;
      }
    }
    return `${fmtDate(r.startISO)} – ${fmtDate(r.endISO)}`;
  };

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
        <div className="kpi-rmenu-pop kpi-rmenu-pop-stack" role="dialog" aria-label="Select date range">
          {/* Item 5: sections stack; no 140px sidebar. Item 4: every
              quick range carries its dates. Item 6b: Next period
              joined the preset row. Item 6c: "FYTD" reads "This year"
              in the menu (label above). */}
          <div className="kpi-rmenu-sec">
            <h5 className="kpi-rmenu-h">Quick ranges</h5>
            <div className="kpi-rmenu-qr">
              {PRESETS.map(p => {
                const enabled = canPickPreset(p.key);
                const dates = enabled ? presetDates(p.key) : null;
                return (
                  <button
                    key={p.key}
                    type="button"
                    className={`kpi-rmenu-qrb ${resolvedPreset === p.key ? "on" : ""}`}
                    disabled={!enabled}
                    onClick={() => {
                      const r = resolvePreset(p.key, { today: todayISO, accountPeriods });
                      if (r) commit(r.startISO, r.endISO, { kind: "preset", value: p.key });
                    }}
                  >
                    <span className="kpi-rmenu-qrb-t">{p.label}</span>
                    {dates && <span className="kpi-rmenu-qrb-d">{dates}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="kpi-rmenu-sec">
            <h5 className="kpi-rmenu-h kpi-rmenu-h-row">
              A single period
              <span className="kpi-rmenu-h-note">FY2026</span>
            </h5>
            {/* Item 3: 5-across. Item 2: four period states via
                periodPickerState(); disabled attribute encodes
                not_started. Item 1: dates on every button. */}
            <div className="kpi-rmenu-pgrid">
              {Array.from({ length: 13 }, (_, i) => i + 1).map(p => {
                const state = periodPickerState(p, todayISO);
                const isSelected = selectedPeriodNo === p;
                const notStarted = state === "not_started";
                const cls = [
                  "kpi-rmenu-pgb",
                  `st-${state || "closed"}`,
                  isSelected ? "on" : "",
                ].filter(Boolean).join(" ");
                return (
                  <button
                    key={p}
                    type="button"
                    className={cls}
                    aria-pressed={isSelected ? "true" : "false"}
                    disabled={notStarted}
                    data-period-state={state}
                    onClick={() => {
                      const r = rangeForPeriod(p);
                      if (r) commit(r.startISO, r.endISO, { kind: "period", value: p });
                    }}
                  >
                    <span className="kpi-rmenu-pgb-n">P{p}</span>
                    <span className="kpi-rmenu-pgb-d">{periodDateShort(p)}</span>
                  </button>
                );
              })}
            </div>
            {/* Kevin ruling final-picker (2026-09-03) item 11: four
                states named. "running now" (was "running"); "next ·
                budget only" (was "next") - the sub-note names why
                the next-period board reads as a planning surface. */}
            <div className="kpi-rmenu-legend" data-kpi-rmenu="legend">
              <span><i className="kpi-rmenu-lgi kpi-rmenu-lgi-clo" />closed</span>
              <span><i className="kpi-rmenu-lgi kpi-rmenu-lgi-run" />running now</span>
              <span><i className="kpi-rmenu-lgi kpi-rmenu-lgi-nxt" />next · budget only</span>
              <span><i className="kpi-rmenu-lgi kpi-rmenu-lgi-fut" />not started</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
