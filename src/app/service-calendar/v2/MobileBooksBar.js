"use client";

// SC v2 W8 - shared mobile books-bar + sheet host.
//
// One grammar for "books at ≤767": a sticky bar pinned above the
// viewport bottom (label + hero figure + status + chevron;
// aria-expanded) that raises the SAME rail component the desktop
// aside would render, hosted in a bottom sheet. RM-gated rise,
// safe-area inset, ≥44px targets.
//
// STANDING LAWS (W8 §2 §3):
//   1. Rails unchanged. This component wraps them without touching
//      their internals - `children` is the rail JSX; the sheet is
//      just a different SLOT for it at ≤767.
//   2. Zero new derivation. The bar's figures are PASSED IN by the
//      mount site, which reads them from the same objects the rail
//      already consumes (e.g. deriveHeroTotals(yearData) for the
//      season rail, periodMetrics.actRev for the drill rail).
//   3. Desktop (≥768) is byte-identical to pre-W8: the aside renders
//      in place with the same className the mount site already used.
//      The bar + backdrop are display:none at ≥768 (CSS-gated).
//   4. Every mount site gets its own sheet id so aria-controls is
//      unambiguous when more than one lives on the page (only one
//      does today; keep the id per-instance to future-proof).
//
// The "shared mobile grammar" note in the PR body maps to the ENTRY
// finale's sticky footer at the semantic level (bar + sheet, one
// gesture, one discard-guard). Structural unification of entry's
// own footer with this shared shell is a W9 demolition task - one
// refactor, once, when v2/ merges into season/.

import { useEffect, useRef, useState, useId } from "react";

import "./mobileBooksBar.css";

export default function MobileBooksBar({
  // Container plumbing - keeps the desktop aside byte-identical
  className,       // the class every desktop path used (e.g., "sc-overview-rail")
  ariaLabel,       // the same aria-label the desktop aside carries
  // Bar figures - law 2: passed in, no re-derive
  barLabel,        // e.g., "Season books"
  barValue,        // pre-formatted string (e.g., "$1.2M" or "5 of 7")
  barStatus,       // pre-formatted status (e.g., "3 need entry"); optional
  // Children = the rail component instance (SeasonRail / DrillRail / OpsRail)
  children,
}) {
  const [open, setOpen] = useState(false);
  const sheetId = useId();

  // Esc closes the sheet - keyboard parity with the entry finale's
  // requestClose flow. onClick on the bar is the primary open/close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // When the sheet is open, close it on any navigation click coming
  // from a rail row so the target is visible under the collapsed
  // sheet. Captures at the sheet container level via onClick bubble;
  // any interactive descendant that fires an onClick (queue rows,
  // month lines, footer CTAs) will bubble up here. Guard: only close
  // on <a>/<button> targets - the sheet's own drag handle (if we add
  // one later) shouldn't collapse itself.
  const onSheetClick = (e) => {
    if (!open) return;
    const t = e.target;
    if (!t?.closest) return;
    if (t.closest("button") || t.closest("a")) {
      setOpen(false);
    }
  };

  const containerRef = useRef(null);

  return (
    <>
      {/*
        The container is IDENTICAL to the desktop aside at ≥768 (same
        className, same aria-label, same children). At ≤767 CSS turns
        it into a bottom sheet: fixed above the sticky bar, translated
        off-screen unless the `--open` state class is set.
      */}
      <aside
        ref={containerRef}
        id={sheetId}
        className={`${className || ""} sc-mobile-books-host${open ? " sc-mobile-books-host--open" : ""}`}
        aria-label={ariaLabel}
        onClick={onSheetClick}
      >
        {children}
      </aside>

      {/*
        Backdrop - visible at ≤767 when the sheet is open. Tap-outside
        collapses. Guarded to a11y-inert when closed so it doesn't
        block screen readers on desktop.
      */}
      <div
        className={`sc-mobile-books-backdrop${open ? " sc-mobile-books-backdrop--open" : ""}`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      {/*
        Sticky bar - the "books entry point" at ≤767. Renders below
        the fixed viewport bottom with safe-area inset. Bar figure is
        pass-through per law 2. aria-expanded + aria-controls wire
        the bar to the sheet aside above.
      */}
      <button
        type="button"
        className="sc-mobile-books-bar"
        aria-expanded={open}
        aria-controls={sheetId}
        aria-label={open ? `Collapse ${barLabel || "books"}` : `Expand ${barLabel || "books"}`}
        onClick={() => setOpen(v => !v)}
      >
        <span className="sc-mobile-books-bar-body">
          {barLabel && (
            <span className="sc-mobile-books-bar-label">{barLabel}</span>
          )}
          {barValue != null && (
            <span className="sc-mobile-books-bar-value">{barValue}</span>
          )}
        </span>
        {barStatus && (
          <span className="sc-mobile-books-bar-status">{barStatus}</span>
        )}
        <span className="sc-mobile-books-bar-chevron" aria-hidden="true">
          {open ? "▾" : "▴"}
        </span>
      </button>
    </>
  );
}
