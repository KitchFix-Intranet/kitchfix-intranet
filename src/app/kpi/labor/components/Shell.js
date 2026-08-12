"use client";
// src/app/kpi/labor/components/Shell.js
//
// D2 P1 - three-zone shell + chrome. Command bar (plain title per F1,
// freshness chip viewer-local per B8, fiscal context), ghosted tabs
// (K5 - Labor active; others visible but disabled), cols grid wrapper
// (232 · main · 300 per spec §3). Density opt-in stays on the outer
// .kpi-app element (owned by page.js).
//
// This is the outer chassis. Middle and right-rail children are passed
// as props so page.js keeps orchestration.

import { fmtTimestamp, hoursSinceISO, freshnessTint } from "../lib/formatting";
import { TABS } from "../lib/accounts";

export function Shell({
  account,        // e.g. "CIN - OH"
  fiscal,         // { today, period, week } - strings/numbers
  freshness,     // { last_walk_at }
  activeTab = "labor",
  onTabClick,
  folioRail,      // node - left aside content (FolioRail)
  scopeBand,      // node - the F3 scope band (ScopeBand)
  main,           // node - middle content (hero, mets, trend, table)
  rail,           // node - right aside content (QuickPanel + alarms + coverage + otwatch + pipeline)
  printScopeText, // string - B12 print-time scope line ("CIN - OH · 06/29/26 - 07/26/26 · all 138 workers · names shown")
}) {
  const freshH = hoursSinceISO(freshness?.last_walk_at);
  const freshTint = freshnessTint(freshH);
  const freshText = fmtTimestamp(freshness?.last_walk_at) || "no successful walk";

  return (
    <>
      {/* Live region (B10) + skip link + print header hook */}
      <a className="kpi-sr" href="#kpi-main">Skip to KPI content</a>
      <div className="kpi-sr" id="kpi-live" role="status" aria-live="polite" />
      {/* B12 print-only header: replaces the hidden chrome so the printed
          sheet identifies its scope. Only visible under @media print. */}
      <div className="kpi-printhdr" id="kpi-printhdr">
        <div><strong>KPI Labor · {account}</strong></div>
        {printScopeText && <div>{printScopeText}</div>}
        <div>Generated {new Date().toLocaleString()}</div>
      </div>

      {/* Command bar (F1: plain title, no styled account pseudo-select) */}
      <div className="kpi-cmd" role="banner">
        <span className="kpi-cmd-t">KPI Dashboard · {account}</span>
        <span className="kpi-cmd-div" aria-hidden="true" />
        <span className="kpi-cmd-ctx">
          {fiscal?.today && (<>Today <b>{fiscal.today}</b> <span style={{ opacity: 0.4 }}>|</span> </>)}
          {fiscal?.period != null && (<>Period <b>{fiscal.period}</b> <span style={{ opacity: 0.4 }}>|</span> </>)}
          {fiscal?.week != null && (<>Week <b>{fiscal.week}</b></>)}
        </span>
        <div className="kpi-cmd-r">
          <span
            className={`kpi-chip-fresh ${freshTint === "kpi-chip-fresh" ? "" : freshTint === "kpi-chip-stale" ? "stale" : "warm"}`}
            title={freshText}
          >
            <span className="kpi-chip-dot" aria-hidden="true" />
            <span>
              {freshH != null ? `Data current as of ${fmtTimestamp(freshness.last_walk_at)}` : "no successful walk"}
            </span>
          </span>
        </div>
      </div>

      {/* Tab strip (K5 - ghosted future tabs) */}
      <div className="kpi-tabs" role="tablist" aria-label="KPI sections">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`kpi-tab ${t.key === activeTab ? "on" : ""} ${!t.enabled ? "ghost" : ""}`}
            role="tab"
            aria-selected={t.key === activeTab}
            aria-disabled={!t.enabled}
            disabled={!t.enabled}
            onClick={() => t.enabled && onTabClick?.(t.key)}
          >
            {t.label}{!t.enabled && <small>soon</small>}
          </button>
        ))}
      </div>

      {/* Scope band (F3 - dates + presets + workers + views) */}
      {scopeBand}

      {/* 3-zone grid: folio · main · rail */}
      <div className="kpi-page">
        <div className="kpi-cols">
          <aside className="kpi-folio" aria-label="Accounts">{folioRail}</aside>
          <div className="kpi-main" id="kpi-main">{main}</div>
          <aside className="kpi-rail" aria-label="Actions and context">{rail}</aside>
        </div>
      </div>
    </>
  );
}
