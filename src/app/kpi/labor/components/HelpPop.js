"use client";
// src/app/kpi/labor/components/HelpPop.js
//
// PR-E portal refactor. Owner ruling 2026-08-24 after live inspect on
// qPace open at CIN - OH P9 traced the popover-behind-sticky-column
// symptom to a stacking-context trap:
//
//   .kpi-hs-pop      z-index 500      ← irrelevant
//   .kpi-hs-qwrap.on auto, relative
//   .kpi-sig         z-index 20, position relative   ← STACKING CONTEXT
//   ...
//   .kpi-tbl-lcol    z-index 20, sticky   ← overlapping neighbour
//
// A `z-index: 20 + position: relative` element creates a NEW stacking
// context; every descendant's z-index is scoped inside it and can never
// exceed 20 against the page. The table's sticky first column is also
// at 20, and at equal z-index the later DOM node wins. Raising 500 to
// 5000 changes nothing - the popover cannot escape its parent card.
//
// Fix: render the popover in a PORTAL at document.body. It then sits
// outside every card's stacking context and cannot be trapped by one.
// This holds regardless of what z-index anything else adopts. Position
// from the trigger's getBoundingClientRect(); keep the existing
// viewport flip-up, outside-click, Escape, and reposition on scroll +
// resize.
//
// Classes: kpi-hs-* preserved for CSS. Popover position inherits from
// inline style (position: fixed, computed top/left/right/bottom); the
// kpi.css .kpi-hs-pop rule's `position: absolute; right: 0; top: ...`
// is overridden by inline style. The .kpi-hs-pop-flip class is no
// longer used - flip is a computed coord, not a CSS variant.
//
// Contract preserved from the pre-portal shape:
//   - `id` becomes data-hs-help={id} on the trigger (Playwright hook)
//   - `title` is the popover heading, also becomes aria-label
//   - `body` is a ReactNode the caller composes
//   - Escape and outside-click close; both trigger and portalled pop
//     are considered "inside" for outside-click detection
//   - The portalled popover has data-hs-pop and data-hs-help-for={id}
//     so a probe can find the popover linked to a specific trigger.

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";

export default function HelpPop({ id, title, body }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const popRef = useRef(null);

  const computePos = useCallback(() => {
    if (!triggerRef.current || !popRef.current) return;
    const t = triggerRef.current.getBoundingClientRect();
    const p = popRef.current.getBoundingClientRect();
    const vH = window.innerHeight;
    const margin = 8;
    // Flip up when the natural downward placement would clip against
    // the viewport bottom. Same rule the pre-portal implementation used.
    const wantsFlip = (t.bottom + p.height + margin) > vH;
    // Right-anchor to the trigger's right edge, then clamp so the pop
    // does not slip off the left of the viewport on narrow layouts.
    const left = Math.max(8, Math.min(window.innerWidth - p.width - 8, t.right - p.width));
    if (wantsFlip) {
      setPos({ position: "fixed", top: Math.max(8, t.top - p.height - 6), left });
    } else {
      setPos({ position: "fixed", top: t.bottom + 6, left });
    }
  }, []);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    // First layout pass: popover renders off-screen (top: -9999) so
    // getBoundingClientRect can measure it. computePos then snaps it
    // into place before paint.
    computePos();
  }, [open, computePos]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScrollOrResize = () => computePos();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // Capture-phase scroll so we catch every scroll container, not just
    // the window - portalled popover sits at body level but its trigger
    // may live inside a scrolling card / table wrapper.
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, computePos]);

  return (
    <span className="kpi-hs-qwrap">
      <button
        type="button"
        ref={triggerRef}
        className="kpi-hs-qbtn"
        aria-haspopup="dialog"
        aria-expanded={open ? "true" : "false"}
        aria-label={`About: ${title}`}
        data-hs-help={id}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >?</button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          className="kpi-hs-pop"
          role="dialog"
          aria-label={title}
          data-hs-pop
          data-hs-help-for={id}
          style={pos ?? { position: "fixed", top: -9999, left: -9999 }}
        >
          <b className="kpi-hs-pop-title">{title}</b>
          <div className="kpi-hs-pop-body">{body}</div>
        </div>,
        // HS FB1 PR-2 verify 2026-08-25: portal into .kpi-app not
        // document.body so --kpi-* tokens resolve. tokens.css :root
        // provides --rad-*/--card-shadow*, but --kpi-t-*, --kpi-sp-*,
        // --kpi-card-*, --kpi-lane-*, and --kf-scale are scoped to
        // .kpi-app - a body-level portal loses all of them, making the
        // popover's width:min() invalid so left+right fall back and
        // the box renders viewport-wide. .kpi-app has no position or
        // z-index, so this portal target still escapes every card's
        // stacking context (which was the point of the portal).
        document.querySelector(".kpi-app") ?? document.body,
      )}
    </span>
  );
}
