"use client";
// src/app/kpi/labor/components/Shell.js
//
// V7 shell - single command bar.
//
// Layout, left to right:
//   title -> Section dropdown -> Range control -> fiscal meta ->
//   flexible space -> Export -> freshness chip (opens diagnostics popover).
//
// Shared control skin is `.kpi-ctl` in kpi.css.

import { useEffect, useRef, useState } from "react";
import { fmtTimestamp, hoursSinceISO, freshnessTint } from "../lib/formatting";
import { SECTIONS } from "../lib/accounts";
import { RangeMenu } from "./RangeMenu";

function SectionMenu({ activeKey }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const active = SECTIONS.find(s => s.key === activeKey) || SECTIONS[1];
  return (
    <div className="kpi-secmenu" ref={rootRef}>
      <button
        type="button"
        className={`kpi-ctl kpi-ctl-sel ${open ? "on" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open ? "true" : "false"}
        onClick={() => setOpen(o => !o)}
      >
        <span className="kpi-ctl-k">Section</span>
        <span className="kpi-ctl-v">{active.label}</span>
      </button>
      {open && (
        <div className="kpi-cmd-pop" role="menu" aria-label="Section">
          {SECTIONS.map(s => (
            <button
              key={s.key}
              type="button"
              role="menuitem"
              className={`kpi-cmd-pop-item ${s.enabled ? "" : "ghost"} ${s.key === activeKey ? "on" : ""}`}
              aria-disabled={s.enabled ? undefined : "true"}
              onClick={() => { if (s.enabled) setOpen(false); }}
            >
              <span>{s.label}</span>
              {!s.enabled && <small>SOON</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FreshnessChip({ freshness, freshnessH, dataLoading, popContent }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const tint = dataLoading ? "warm" : (freshnessTint(freshnessH) === "kpi-chip-stale" ? "stale" : freshnessTint(freshnessH) === "kpi-chip-warm" ? "warm" : "");
  const stamp = fmtTimestamp(freshness?.last_walk_at);
  const label = freshnessH != null
    ? `Data current · ${stamp}`
    : dataLoading ? "Loading data..." : "no successful walk";
  return (
    <div className="kpi-fresh-anchor" ref={rootRef}>
      <button
        type="button"
        className={`kpi-fresh ${tint}`}
        aria-haspopup="dialog"
        aria-expanded={open ? "true" : "false"}
        title="Show pipeline diagnostics"
        onClick={() => setOpen(o => !o)}
      >
        <span className="kpi-fresh-dot" aria-hidden="true" />
        <span>{label}</span>
      </button>
      {open && popContent && (
        <div className="kpi-cmd-pop kpi-fresh-pop" role="dialog" aria-label="Pipeline diagnostics">
          {popContent}
        </div>
      )}
    </div>
  );
}

export function Shell({
  account,        // e.g. "CIN - OH"
  fiscal,         // { today, period, week }
  freshness,     // { last_walk_at }
  dataLoading,    // boolean
  activeSection = "labor", // V7-3
  // Range (V7-4) - Range menu inputs, wired straight through.
  rangeProps,     // { startISO, endISO, todayISO, hasPeriods, accountPeriods, resolvedPreset, selectedPeriodNo, selectedMonth, onCommit }
  // Export (V7-7)
  exportHref,     // string or null
  onExport,
  exportRedact,
  exportDisabledReason,
  // Freshness popover content (V7-9 in C1; C3 expands with coverage + In view).
  freshnessPop,   // node - rendered inside the popover
  // Print scope line (kept from v6 for @media print sheet identification).
  printScopeText,
  // Layout children.
  folioRail,      // left aside
  main,           // middle content
  rail,           // right aside (retired in C3; C1 still renders it)
}) {
  const freshH = hoursSinceISO(freshness?.last_walk_at);
  return (
    <>
      <a className="kpi-sr" href="#kpi-main">Skip to KPI content</a>
      <div className="kpi-sr" id="kpi-live" role="status" aria-live="polite" />
      <div className="kpi-printhdr" id="kpi-printhdr">
        <div><strong>KPI Labor · {account}</strong></div>
        {printScopeText && <div>{printScopeText}</div>}
        <div>Generated {new Date().toLocaleString()}</div>
      </div>

      {/* V7-7 - single command bar. */}
      <div className="kpi-cmd" role="banner">
        <span className="kpi-cmd-title">KPI Dashboard <span className="kpi-cmd-dot" aria-hidden="true">·</span> {account}</span>

        <SectionMenu activeKey={activeSection} />

        {rangeProps && (
          <RangeMenu
            startISO={rangeProps.startISO}
            endISO={rangeProps.endISO}
            todayISO={rangeProps.todayISO}
            hasPeriods={rangeProps.hasPeriods}
            accountPeriods={rangeProps.accountPeriods}
            resolvedPreset={rangeProps.resolvedPreset}
            selectedPeriodNo={rangeProps.selectedPeriodNo}
            selectedMonth={rangeProps.selectedMonth}
            onCommit={rangeProps.onCommit}
          />
        )}

        <div className="kpi-meta">
          {fiscal?.today && (<span>Today<b>{fiscal.today}</b></span>)}
          {fiscal?.today && fiscal?.period != null && <span className="kpi-meta-sep" aria-hidden="true" />}
          {fiscal?.period != null && (<span>Period<b>{fiscal.period}</b></span>)}
          {fiscal?.period != null && fiscal?.week != null && <span className="kpi-meta-sep" aria-hidden="true" />}
          {fiscal?.week != null && (<span>Week<b>{fiscal.week}</b></span>)}
        </div>

        <span className="kpi-cmd-spacer" aria-hidden="true" />

        {exportHref && !exportDisabledReason && (
          <a
            className="kpi-ctl"
            title="Download this view as a spreadsheet"
            href={exportHref}
            download
            onClick={() => onExport?.(exportHref)}
          >
            <svg className="kpi-i" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M7 10l5 5 5-5M12 15V3" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Export</span>
          </a>
        )}
        {exportDisabledReason && (
          <button
            type="button"
            className="kpi-ctl kpi-ctl-off"
            title={exportDisabledReason}
            aria-label={`Export disabled: ${exportDisabledReason}`}
            disabled
          >
            <svg className="kpi-i" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M7 10l5 5 5-5M12 15V3" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Export</span>
          </button>
        )}

        <FreshnessChip
          freshness={freshness}
          freshnessH={freshH}
          dataLoading={dataLoading}
          popContent={freshnessPop}
        />
      </div>

      {/* 3-zone grid (rail retires in C3; folio+main is the two-col target). */}
      <div className="kpi-page">
        <div className="kpi-cols">
          <aside className="kpi-folio" aria-label="Accounts">{folioRail}</aside>
          <div className="kpi-main" id="kpi-main">{main}</div>
          {rail && <aside className="kpi-rail" aria-label="Actions and context">{rail}</aside>}
        </div>
      </div>
    </>
  );
}
