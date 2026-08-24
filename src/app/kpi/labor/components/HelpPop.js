"use client";
// src/app/kpi/labor/components/HelpPop.js
//
// PR-E - shared help popover. Extracted from HomestandBoard's HsHelpPop
// (which shipped 2026-08-21 with the PR-2 audit) so the period-board
// cards, story block, comparison strip, week table and custom-range
// cards all render the same trigger + surface + close behaviour.
//
// Classes stay kpi-hs-* because the CSS in kpi.css:3689-3789 was
// authored under that prefix; renaming would ripple across the
// homestand callsites and the existing Playwright tests without
// changing anything visible. The `hs` prefix is historical, not
// scope-specific.
//
// Contract:
//   - `id` is a stable string; the trigger gets data-hs-help={id} so
//     Playwright can target a specific popover.
//   - `title` renders as the popover heading; `body` is a ReactNode
//     the caller composes however it likes (paragraphs, tables, etc.).
//   - Outside-click and Escape close. Popover flips upward when the
//     trigger sits near the bottom of the viewport.

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export default function HelpPop({ id, title, body }) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const rootRef = useRef(null);
  const popRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !popRef.current) return;
    const r = popRef.current.getBoundingClientRect();
    setFlip(r.bottom > window.innerHeight - 8);
  }, [open]);

  return (
    <span className={`kpi-hs-qwrap ${open ? "on" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="kpi-hs-qbtn"
        aria-haspopup="dialog"
        aria-expanded={open ? "true" : "false"}
        aria-label={`About: ${title}`}
        data-hs-help={id}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >?</button>
      {open && (
        <div
          ref={popRef}
          className={`kpi-hs-pop ${flip ? "kpi-hs-pop-flip" : ""}`}
          role="dialog"
          aria-label={title}
          data-hs-pop
        >
          <b className="kpi-hs-pop-title">{title}</b>
          <div className="kpi-hs-pop-body">{body}</div>
        </div>
      )}
    </span>
  );
}
