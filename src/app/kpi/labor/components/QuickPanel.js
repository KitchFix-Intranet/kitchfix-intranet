"use client";
// src/app/kpi/labor/components/QuickPanel.js
//
// D2 P4 - top of the right rail. Counts + Copy link + Export + Hide
// names switch. F3 moved these here from the parameter strip so scope
// lives adjacent to the figures it scopes and actions/prefs sit as
// settings in the rail.
//
// Copy link: URL to current view state, feedback toast (M3 fuller
// implementation lands in Push 3). Export: opens the existing export
// route. Hide names: role="switch", governs BOTH screen AND export
// (B3 - the toggle is a data-scope control, not cosmetic; the export
// route reads ?redact=1 and produces a numbers-only file).

import { useState, useCallback } from "react";

export function QuickPanel({
  weekCount,          // number of week rows currently in view
  workerWeekCount,    // number of labor_actuals rows in view (worker-weeks)
  redact,
  onToggleRedact,
  exportHref,
  onCopyLink,
  onExport,           // (href) => void - lets page raise M4 toast + timing
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      const url = typeof window !== "undefined" ? window.location.href : "";
      await navigator.clipboard.writeText(url);
      setCopied(true);
      onCopyLink?.();
      // M3: revert after 1.2s (spec §7).
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // If clipboard denied, silently no-op. M3 morph doesn't fire.
    }
  }, [onCopyLink]);

  const handleExport = useCallback((e) => {
    // Let the anchor download fire; also signal the page for M4.
    onExport?.(exportHref);
  }, [onExport, exportHref]);

  return (
    <div className="kpi-rl-card" id="kpi-quickpanel">
      <div className="kpi-qp-row">
        <span className="kpi-rowcount">
          <b>{weekCount}</b> weeks · <b>{workerWeekCount}</b> worker-weeks
        </span>
      </div>
      <div className="kpi-qp-row">
        <button
          type="button"
          className={`kpi-btn kpi-btn-sm ${copied ? "done" : ""}`}
          onClick={handleCopy}
          title="Copy a link to this exact view"
        >
          {copied ? (
            <>
              <svg className="kpi-i" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg className="kpi-i" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Copy link
            </>
          )}
        </button>
        <a className="kpi-btn kpi-btn-sm" href={exportHref} download onClick={handleExport}>
          <svg className="kpi-i" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M7 10l5 5 5-5M12 15V3" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Export
        </a>
      </div>
      <button
        type="button"
        className="kpi-switch"
        role="switch"
        aria-checked={redact ? "true" : "false"}
        onClick={() => onToggleRedact?.(!redact)}
        title="Hides names on screen AND in the export file"
      >
        <span className="kpi-sw" aria-hidden="true" />
        Hide names
      </button>
    </div>
  );
}
