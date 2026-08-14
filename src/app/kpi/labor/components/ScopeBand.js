"use client";
// src/app/kpi/labor/components/ScopeBand.js
//
// V6-6 - Band 2 shape: one RangeMenu button on the left (owns time),
// Workers pill + Views + primary "+ Save view" on the right. All
// preset-chip / calendar-trigger surface area moved into RangeMenu.
//
// vdef line beneath (spec §3.3) still surfaces only when a saved view
// is active.

import { fmtDate } from "../lib/formatting";
import { RangeMenu } from "./RangeMenu";

export function ScopeBand({
  start,
  end,
  today,
  resolvedPreset,     // V6-7 - preset inferred by page.js; may be null
  selectedPeriodNo,   // integer if range matches a period, else null
  selectedMonth,      // { year, monthIndex } if range matches a month, else null
  hasPeriods,         // boolean
  accountPeriods,     // for this-period/last-period resolution
  onRangeCommit,      // (startISO, endISO, selection) => void
                      // selection: { kind, value? }
  workerRoster,       // [{ id, label }]
  selectedWorkers,    // Set<string> or null (all)
  onWorkersChange,    // (nextSet | null) => void
  views,
  activeView,
  onPickView,         // (viewId) => void
  onSaveView,         // () => void
  vdefLine,           // string, shown iff activeView present
}) {
  const totalWorkers = workerRoster?.length ?? 0;
  const shownWorkers = selectedWorkers && selectedWorkers.size > 0 ? selectedWorkers.size : totalWorkers;

  return (
    <div className="kpi-scope">
      <div className="kpi-scope-row">
        {/* V6-3 - single Range menu owns all of time */}
        <div className="kpi-pctl">
          <RangeMenu
            startISO={start}
            endISO={end}
            todayISO={today}
            hasPeriods={hasPeriods}
            accountPeriods={accountPeriods}
            resolvedPreset={resolvedPreset}
            selectedPeriodNo={selectedPeriodNo}
            selectedMonth={selectedMonth}
            onCommit={onRangeCommit}
          />
        </div>

        <span className="kpi-scope-spacer" aria-hidden="true" />

        {/* Workers popover - inline details/summary flow (C4.1). */}
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

      {/* vdef line - only when a saved view is active (spec §3.3) */}
      {activeView && vdefLine && (
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
