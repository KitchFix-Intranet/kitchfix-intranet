"use client";
// src/app/kpi/labor/components/ScopeBand.js
//
// D2 P3 - one scope band replacing the two-band C4 arrangement per F3.
// Contains: range trigger (custom-only calendar - implementation defers
// to Push 3; button opens the existing input pair as a fallback for
// now), preset chips (This/Last period, Last 4/13 wk, FYTD),
// worker multi-select trigger (existing details popover pattern), and
// saved-view pills with the vdef definition line beneath.
//
// F15: clicking the active view deselects it. Order = range + presets
// + workers first, saved views after the divider.
//
// Redaction, Copy link, Export moved OUT of this band into QuickPanel
// at the rail top (F3).

import { PRESET_LABELS } from "@/lib/kpi/dateResolve";
import { fmtDate } from "../lib/formatting";
import { PRESET_KEYS } from "../lib/accounts";

export function ScopeBand({
  start,
  end,
  lastPreset,
  onDateChange,      // (which, iso) => void   which='start'|'end'
  onPresetClick,     // (kind) => void
  hasPeriods,        // boolean - are account_periods loaded?
  workerRoster,      // [{ id, label }]
  selectedWorkers,   // Set<string> or null (all)
  onWorkersChange,   // (nextSet | null) => void
  views,
  activeView,
  onPickView,        // (viewId) => void
  onSaveView,        // () => void  opens save dialog (kept in page)
  vdefLine,          // string like "Range: 06/29/26 – 07/26/26 · 138 workers · names shown"
}) {
  const totalWorkers = workerRoster?.length ?? 0;
  const shownWorkers = selectedWorkers && selectedWorkers.size > 0 ? selectedWorkers.size : totalWorkers;

  return (
    <div className="kpi-scope">
      <div className="kpi-scope-row">
        {/* Range picker - Push 3 upgrades to a proper dual-month calendar
            popover; for now uses two native date inputs (functional). */}
        <div className="kpi-pctl">
          <span className="kpi-range-inputs">
            <input
              type="date"
              className="kpi-param-date"
              value={start}
              max={end}
              onChange={(e) => onDateChange?.("start", e.target.value)}
              aria-label="Range start"
            />
            <span className="kpi-param-arrow" aria-hidden="true">→</span>
            <input
              type="date"
              className="kpi-param-date"
              value={end}
              min={start}
              onChange={(e) => onDateChange?.("end", e.target.value)}
              aria-label="Range end"
            />
          </span>
        </div>

        {/* Presets - F2: preset chips top-level, calendar popover is
            custom-only (custom popover deferred to Push 3). */}
        <div className="kpi-pchips">
          {PRESET_KEYS.map(k => (
            <button
              key={k}
              type="button"
              className={`kpi-pchip ${lastPreset === k ? "on" : ""}`}
              onClick={() => onPresetClick?.(k)}
              disabled={(k === "this_period" || k === "last_period") && !hasPeriods}
            >
              {PRESET_LABELS[k]}
            </button>
          ))}
        </div>

        {/* Workers - inline details/summary flow so it never overlays
            metric cards below (C4.1 constraint). */}
        <details className="kpi-pctl kpi-workers-details">
          <summary className="kpi-trig">
            <svg className="kpi-i" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" fill="none" stroke="currentColor" strokeWidth="1.75" />
              <circle cx="12" cy="7" r="4" fill="none" stroke="currentColor" strokeWidth="1.75" />
            </svg>
            <span>Workers · {shownWorkers === totalWorkers ? `all ${totalWorkers}` : `${shownWorkers} of ${totalWorkers}`}</span>
          </summary>
          <div className="kpi-pop kpi-pop-workers open">
            <div className="kpi-pop-head">
              <span className="kpi-pop-title">Workers</span>
              <span style={{ display: "flex", gap: 6 }}>
                <button type="button" className="kpi-btn kpi-btn-sm" onClick={() => onWorkersChange?.(null)}>All</button>
                <button type="button" className="kpi-btn kpi-btn-sm" onClick={() => onWorkersChange?.(new Set())}>None</button>
              </span>
            </div>
            <div className="kpi-wk-list">
              {workerRoster.map(w => {
                const checked = !selectedWorkers || selectedWorkers.size === 0 || selectedWorkers.has(w.id);
                return (
                  <label key={w.id} className="kpi-wk-item">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const currentAll = !selectedWorkers || (selectedWorkers && selectedWorkers.size === 0 && [...selectedWorkers][0] === "__none__");
                        let next;
                        if (currentAll || selectedWorkers?.size === 0) {
                          next = new Set(workerRoster.map(x => x.id));
                        } else {
                          next = new Set(selectedWorkers);
                        }
                        if (e.target.checked) next.add(w.id);
                        else next.delete(w.id);
                        onWorkersChange?.(next);
                      }}
                    />
                    <span>{w.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </details>

        {views && views.length > 0 && <span className="kpi-pdiv" aria-hidden="true" />}

        {/* Saved-view pills (F3 order: after the divider). */}
        {views && views.length > 0 && (
          <span className="kpi-views-inline">
            {views.map(v => {
              const isActive = activeView && v.id === activeView.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  className={`kpi-vpill ${isActive ? "on" : ""}`}
                  onClick={() => onPickView?.(isActive ? null : v.id)}
                  title={v.is_shared ? `Shared by ${v.owner_email}` : "Personal view"}
                >
                  {v.name}
                  {v.is_shared && <span className="kpi-vpill-owner">shared</span>}
                </button>
              );
            })}
            <button type="button" className="kpi-vpill kpi-vpill-add" onClick={onSaveView}>+ Save view</button>
          </span>
        )}
        {views && views.length === 0 && (
          <button type="button" className="kpi-vpill kpi-vpill-add" onClick={onSaveView}>+ Save view</button>
        )}
      </div>

      {/* vdef - resolved-range line beneath, spec §3.3 */}
      {vdefLine && (
        <div className="kpi-vdef">
          <span className="kpi-mono">{vdefLine}</span>
        </div>
      )}
    </div>
  );
}

// Helper for building the vdef line from state - kept beside the
// component so page.js orchestrator has a single import.
export function buildVdefLine({ start, end, resolvedActiveRange, activeView, workerRoster, selectedWorkers, redact }) {
  const range = resolvedActiveRange
    ? `${fmtDate(resolvedActiveRange.start)} – ${fmtDate(resolvedActiveRange.end)}`
    : `${fmtDate(start)} – ${fmtDate(end)}`;
  const totalWorkers = workerRoster?.length ?? 0;
  const shownWorkers = selectedWorkers && selectedWorkers.size > 0 ? selectedWorkers.size : totalWorkers;
  const workers = shownWorkers === totalWorkers ? `all ${totalWorkers} workers` : `${shownWorkers} of ${totalWorkers} workers`;
  const names = redact ? "names hidden" : "names shown";
  const viewPrefix = activeView ? `${activeView.name} · ` : "";
  return `${viewPrefix}Range ${range} · ${workers} · ${names}`;
}
