"use client";

// SC v2 W8+W9 - shared mobile books-bar + sheet host.
//
// One grammar for "sticky mobile footer" across the whole SC v2
// surface: sticky bar (label + hero figure + status + chevron;
// aria-expanded) at viewport bottom + optional sticky action (Confirm
// CTA in entry) below it + optional bottom sheet host that raises the
// SAME rail component desktop mounts. RM-gated rise, safe-area inset,
// >=44px targets.
//
// STANDING LAWS (W8 §2 §3 · W9 §3):
//   1. Rails unchanged. This component wraps them without touching
//      their internals - `children` is the rail JSX; the sheet is
//      just a different SLOT for it at <=767.
//   2. Zero new derivation. The bar's figures are PASSED IN by the
//      mount site, which reads them from the same objects the rail
//      already consumes.
//   3. Desktop (>=768) is byte-identical to pre-W8: the aside renders
//      in place with the same className the mount site already used.
//      The bar + backdrop + action are display:none at >=768
//      (CSS-gated).
//   4. Every mount site gets its own sheet id so aria-controls is
//      unambiguous when more than one lives on the page (only one
//      does today; keep the id per-instance to future-proof).
//
// W9 PR 1/2 additions (footer unification per #469 drift-log note):
//   - `stickyAction` slot: renders below the bar as a fixed CTA
//     row. Used by DayEntryV2 to host its sticky Confirm; empty
//     for read surfaces (bar-only).
//   - Controlled mode: optional `open` / `onOpenChange` props let
//     the parent own the sheet state (used by DayEntryV2 so the
//     day-nav reset effect can still clear `mobileBillOpen` when
//     the day changes). Falls back to uncontrolled if either prop
//     is undefined.
//   - Conditional sheet host: `children` may be falsy for entry's
//     use case (the bar+action mount at the bottom; the entry sheet
//     is the whole modal, not a MobileBooksBar aside). When
//     `children` is falsy the aside + backdrop are skipped and only
//     the bar (+ optional stickyAction) render.

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
  // Children = the rail component instance (SeasonRail / DrillRail /
  // OpsRail). Optional - when omitted, only the sticky footer
  // (bar + stickyAction) renders; no sheet host.
  children,
  // W9 - sticky action below the bar (used by DayEntryV2 to host
  // Confirm; the second row of the mobile footer). Optional.
  stickyAction,
  // W9 - optional controlled open state. Both must be provided to
  // enter controlled mode.
  open: controlledOpen,
  onOpenChange,
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined && typeof onOpenChange === "function";
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (next) => {
    const resolved = typeof next === "function" ? next(open) : next;
    if (isControlled) onOpenChange(resolved);
    else setUncontrolledOpen(resolved);
  };
  const sheetId = useId();

  // Esc closes the sheet - keyboard parity with the entry finale's
  // requestClose flow. onClick on the bar is the primary open/close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        The container is IDENTICAL to the desktop aside at >=768 (same
        className, same aria-label, same children). At <=767 CSS turns
        it into a bottom sheet: fixed above the sticky bar, translated
        off-screen unless the `--open` state class is set. Skipped
        entirely when no children are passed (bar-only mode, used by
        DayEntryV2 for its unified footer).
      */}
      {children && (
        <aside
          ref={containerRef}
          id={sheetId}
          className={`${className || ""} sc-mobile-books-host${open ? " sc-mobile-books-host--open" : ""}`}
          aria-label={ariaLabel}
          onClick={onSheetClick}
        >
          {children}
        </aside>
      )}

      {/*
        Backdrop - visible at <=767 when the sheet is open. Tap-outside
        collapses. Guarded to a11y-inert when closed so it doesn't
        block screen readers on desktop. Skipped in bar-only mode.
      */}
      {children && (
        <div
          className={`sc-mobile-books-backdrop${open ? " sc-mobile-books-backdrop--open" : ""}`}
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/*
        Sticky bar - the "books entry point" at <=767. Renders below
        the fixed viewport bottom with safe-area inset. Bar figure is
        pass-through per law 2. aria-expanded + aria-controls wire
        the bar to the sheet aside above (if any).
      */}
      <button
        type="button"
        className={`sc-mobile-books-bar${stickyAction ? " sc-mobile-books-bar--with-action" : ""}`}
        aria-expanded={open}
        aria-controls={children ? sheetId : undefined}
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

      {/*
        W9 - sticky action row (below the bar). Used by DayEntryV2 to
        host the Confirm CTA. Visible at <=767 via CSS; skipped
        entirely at >=768 (the entry's own desktop rail-footer keeps
        Confirm on the rail). The wrapper div gives CSS a stable
        selector; the caller controls the button itself
        (executeConfirm, disabled state, label - all pass through).
      */}
      {stickyAction && (
        <div className="sc-mobile-books-action">
          {stickyAction}
        </div>
      )}
    </>
  );
}
