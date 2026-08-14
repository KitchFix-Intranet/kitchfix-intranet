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
  fiscal,         // { today, period, week } - week is week-of-period (V6-1)
  freshness,     // { last_walk_at } - present iff data loaded
  dataLoading,    // boolean - true while /api/kpi/labor is in flight
  activeTab = "labor",
  onTabClick,
  folioRail,      // node - left aside content (FolioRail)
  scopeBand,      // node - the F3 scope band (ScopeBand)
  main,           // node - middle content (hero, mets, trend, table)
  rail,           // node - right aside content (ContextRail)
  printScopeText, // string - B12 print-time scope line
  // V6-2 - Copy link + Export live in the command bar right, before
  // the freshness chip. Old rail-top home retired.
  onCopyLink,     // () => void - fires after the URL is copied
  exportHref,     // string - the /api/kpi/labor/export URL for current view
  onExport,       // (href) => void - fires alongside the anchor download
  exportRedact,   // boolean - governs "names redacted" toast + export param
  exportDisabledReason, // string - when set, Export renders disabled with
                        // this string as its title; used for aggregate
                        // pseudo-key views (interim gate until PR-3 lands
                        // the full per-account export column).
}) {
  const freshH = hoursSinceISO(freshness?.last_walk_at);
  const freshTint = dataLoading
    // Loading: neutral warm dot, never the red "stale" state - freshness
    // is legitimately unknown until the fetch resolves.
    ? "kpi-chip-warm"
    : freshnessTint(freshH);
  const freshText = fmtTimestamp(freshness?.last_walk_at)
    || (dataLoading ? "Loading data" : "no successful walk");

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

      {/* Command bar - V6-1 fiscal context (TODAY | PERIOD | WEEK where
          WEEK is week-of-period 1..4). V6-2 Copy link + Export live
          here as labeled buttons, freshness chip right of them. */}
      <div className="kpi-cmd" role="banner">
        <span className="kpi-cmd-t">KPI Dashboard · {account}</span>
        <span className="kpi-cmd-div" aria-hidden="true" />
        <span className="kpi-cmd-ctx">
          {fiscal?.today && (<>Today <b>{fiscal.today}</b> <span style={{ opacity: 0.4 }}>|</span> </>)}
          {fiscal?.period != null && (<>Period <b>{fiscal.period}</b> <span style={{ opacity: 0.4 }}>|</span> </>)}
          {fiscal?.week != null && (<>Week <b>{fiscal.week}</b></>)}
        </span>
        <div className="kpi-cmd-r">
          {onCopyLink && (
            <button
              type="button"
              className="kpi-cmd-act"
              title="Copy a link to this exact view"
              onClick={async () => {
                try {
                  const url = typeof window !== "undefined" ? window.location.href : "";
                  await navigator.clipboard.writeText(url);
                  onCopyLink?.();
                } catch { /* clipboard denied - silent no-op */ }
              }}
            >
              <svg className="kpi-i" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Copy link</span>
            </button>
          )}
          {exportHref && !exportDisabledReason && (
            <a
              className="kpi-cmd-act"
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
              className="kpi-cmd-act"
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
          <span
            className={`kpi-chip-fresh ${freshTint === "kpi-chip-fresh" ? "" : freshTint === "kpi-chip-stale" ? "stale" : "warm"}`}
            title={freshText}
          >
            <span className="kpi-chip-dot" aria-hidden="true" />
            <span>
              {freshH != null
                ? `Data current as of ${fmtTimestamp(freshness.last_walk_at)}`
                : dataLoading
                  ? "Loading data..."
                  : "no successful walk"}
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
