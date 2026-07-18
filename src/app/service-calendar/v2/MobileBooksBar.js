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
//      unambiguous.
//
// W9 PR 1/2 fixes (post-live-verification):
//   F5 - controlled mode is now DIVERGENCE-PROOF. Detection uses ONE
//        signal only (`onOpenChange !== undefined`); a caller that
//        supplies `onOpenChange` is controlled AND the uncontrolled
//        state path is never taken. Half-controlled is impossible.
//   F2 - Esc listener registers with `capture: true` and, when open,
//        `stopPropagation()` + `preventDefault()` BEFORE `setOpen(false)`.
//        Prevents a single Esc from also firing the parent modal's Esc
//        handler (staged: Esc #1 closes the sheet, Esc #2 closes the
//        modal via its own guard).
//   F1 - `controlsId` prop optional. When `children` is falsy (bar-only
//        mode), aria-controls falls back to `controlsId` so the bar
//        still announces its association with whatever the parent
//        owns as the "sheet" (in DayEntryV2 that's the pre-existing
//        `.sc-v2-entry-rail` aside id).

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
  // W9 F1 - optional aria-controls target when in bar-only mode.
  // When `children` is truthy the shell owns the sheet aside and its
  // useId() id is used; when `children` is falsy the caller owns the
  // "sheet" externally and passes its id here so the bar's a11y
  // wiring still points at something real.
  controlsId,
  // W9 - controlled mode. Detection is DIVERGENCE-PROOF (F5): the
  // presence of `onOpenChange` alone determines the mode. When
  // controlled the internal state is never read or written; the
  // uncontrolled state literally cannot become an alternate truth.
  open: controlledOpen,
  onOpenChange,
}) {
  // F5 - the ONE signal. If `onOpenChange` is passed, we are
  // controlled - full stop. `open` (controlledOpen) may be `undefined`
  // for a brief render (defensive: treat as false) but the parent is
  // still authoritative.
  const isControlled = onOpenChange !== undefined;

  // useState must be called unconditionally per rules of hooks; the
  // returned value/setter are only READ in the uncontrolled branch,
  // so in the controlled branch they exist but have no effect.
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);

  const open = isControlled ? Boolean(controlledOpen) : uncontrolledOpen;
  const setOpen = (next) => {
    const resolved = typeof next === "function" ? next(open) : next;
    if (isControlled) {
      onOpenChange(resolved);
    } else {
      setUncontrolledOpen(resolved);
    }
  };

  const sheetId = useId();
  // F1 - aria-controls falls back to caller-supplied id in bar-only
  // mode. When both are absent the attr is omitted entirely.
  const ariaControlsId = children ? sheetId : controlsId;

  // F2 - Esc listener with capture-phase intercept. When the sheet
  // is open, Esc closes ONLY the sheet and stops the event from
  // bubbling/further-propagating so any parent modal's Esc handler
  // does NOT also fire on the same keypress. Read-surface mounts
  // are unaffected: they have no wrapping modal, so the extra
  // stopPropagation is a no-op there.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") {
        e.stopImmediatePropagation();
      }
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener("keydown", onKey, /* capture */ true);
    return () => document.removeEventListener("keydown", onKey, /* capture */ true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // When the sheet is open, close it on any navigation click coming
  // from a rail row so the target is visible under the collapsed
  // sheet.
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
        Sheet host - only rendered when children are passed. At >=768
        this is a normal grid child (byte-identical to pre-W8). At
        <=767 CSS turns it into a bottom sheet.
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

      {/* Backdrop - only alongside the sheet host. */}
      {children && (
        <div
          className={`sc-mobile-books-backdrop${open ? " sc-mobile-books-backdrop--open" : ""}`}
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/*
        Sticky bar - the "books entry point" at <=767. F3 - `bottom`
        is a token-driven custom property, so the `--with-action`
        modifier only needs to SET the property. Cascade order can't
        lose because the base rule uses a fallback value, not a
        static `bottom: 0`.
      */}
      <button
        type="button"
        className={`sc-mobile-books-bar${stickyAction ? " sc-mobile-books-bar--with-action" : ""}`}
        aria-expanded={open}
        aria-controls={ariaControlsId || undefined}
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
        F3 sticky action row. Explicit height so the bar+action stack
        totals exactly --sc2-mobile-footer-h. Only one row grows with
        the safe-area inset (the action row - it's the outer row) so
        the "one safe-area law" holds: env() is added exactly once
        per stack.
      */}
      {stickyAction && (
        <div className="sc-mobile-books-action">
          {stickyAction}
        </div>
      )}
    </>
  );
}
