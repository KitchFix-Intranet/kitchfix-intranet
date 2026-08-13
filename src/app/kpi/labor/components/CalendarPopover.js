"use client";
// src/app/kpi/labor/components/CalendarPopover.js
//
// D2 · F2 - custom range picker.
// A single button "MM/DD/YY - MM/DD/YY" opens a two-month calendar
// popover. Selecting a start then an end commits back via onCommit.
// Dismiss with Escape or click-outside.
//
// v1 rules: no time components, no cross-year prev/next stumbling,
// end date must be >= start (swap silently if inverted). B11: display
// dates as MM/DD/YY, commit as ISO YYYY-MM-DD.

import { useState, useEffect, useRef, useMemo } from "react";
import { fmtDate } from "../lib/formatting";

function isoOf(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseISO(s) {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }

function monthGrid(monthAnchor) {
  // Returns 42-cell grid (6 weeks) starting Sunday of the week containing
  // the 1st of monthAnchor. Each cell: { date, inMonth }.
  const first = startOfMonth(monthAnchor);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({ date: d, inMonth: d.getMonth() === monthAnchor.getMonth() });
  }
  return cells;
}

function MonthPanel({ monthAnchor, startD, endD, onPick }) {
  const cells = useMemo(() => monthGrid(monthAnchor), [monthAnchor]);
  const label = monthAnchor.toLocaleString("en-US", { month: "long", year: "numeric" });
  const inRange = (d) => startD && endD && d >= startD && d <= endD;
  const isEndpoint = (d) => (startD && d.getTime() === startD.getTime()) || (endD && d.getTime() === endD.getTime());
  return (
    <div className="kpi-cal-month" role="group" aria-label={label}>
      <div className="kpi-cal-monthlabel">{label}</div>
      <div className="kpi-cal-dow">
        {["S", "M", "T", "W", "T", "F", "S"].map((c, i) => (
          <span key={i} aria-hidden="true">{c}</span>
        ))}
      </div>
      <div className="kpi-cal-grid">
        {cells.map((c, i) => {
          const cls = [
            "kpi-cal-cell",
            !c.inMonth ? "kpi-cal-cell-out" : "",
            inRange(c.date) ? "kpi-cal-cell-in" : "",
            isEndpoint(c.date) ? "kpi-cal-cell-endpoint" : "",
          ].filter(Boolean).join(" ");
          return (
            <button
              key={i}
              type="button"
              className={cls}
              onClick={() => onPick(c.date)}
              aria-label={c.date.toLocaleDateString()}
              aria-pressed={isEndpoint(c.date) ? "true" : "false"}
            >
              {c.date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CalendarPopover({ startISO, endISO, onCommit, disabled }) {
  const [open, setOpen] = useState(false);
  // Fix 5 (D2.1) - two staging slots, one commit path.
  // pending: single endpoint clicked, awaiting the second
  // staged:  both endpoints picked, awaiting Apply
  // Nothing commits until Apply fires; Cancel/Escape/outside-click
  // discards both. Matches v5 #calapply (lines 552 + 1748).
  const [pending, setPending] = useState(null);
  const [staged, setStaged] = useState(null);      // {start: Date, end: Date} | null
  const [anchor, setAnchor] = useState(() => startOfMonth(parseISO(startISO) || new Date()));
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) close(false); };
    const onKey  = (e) => { if (e.key === "Escape") close(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close(commit, next) {
    setOpen(false);
    setPending(null);
    setStaged(null);
    if (commit && next) {
      onCommit(isoOf(next.start), isoOf(next.end));
    }
  }

  function onPick(d) {
    // A third click after a completed stage starts a fresh selection.
    if (staged) {
      setStaged(null);
      setPending(d);
      return;
    }
    if (!pending) {
      setPending(d);
      return;
    }
    let s = pending, e = d;
    if (s > e) { const t = s; s = e; e = t; }
    setStaged({ start: s, end: e });
    setPending(null);
  }

  function apply() {
    if (staged) close(true, staged);
  }

  const startD = parseISO(startISO);
  const endD   = parseISO(endISO);
  const rangeLabel = startD && endD
    ? `${fmtDate(startISO)} - ${fmtDate(endISO)}`
    : "Pick date range";

  // Visualization precedence: staged > pending > committed. Keeps
  // both endpoints highlighted while the user reviews the Apply target.
  const visStart = staged ? staged.start : (pending || startD);
  const visEnd   = staged ? staged.end   : (pending ? null   : endD);
  const canApply = !!staged;
  const hintText = staged
    ? "Review and Apply, or pick a new start date."
    : pending
      ? "Pick the end date."
      : "Pick the start date.";

  return (
    <div className="kpi-cal-root" ref={rootRef}>
      <button
        type="button"
        className="kpi-cal-trigger"
        aria-haspopup="dialog"
        aria-expanded={open ? "true" : "false"}
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="kpi-i">
          <rect x="3" y="4" width="18" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="1.75" />
          <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" strokeWidth="1.75" />
        </svg>
        <span className="kpi-cal-trigger-label">{rangeLabel}</span>
      </button>
      {open && (
        <div className="kpi-cal-pop" role="dialog" aria-label="Pick date range">
          <div className="kpi-cal-nav">
            <button type="button" className="kpi-cal-navbtn" onClick={() => setAnchor(a => addMonths(a, -1))} aria-label="Previous month">‹</button>
            <button type="button" className="kpi-cal-navbtn kpi-cal-navbtn-right" onClick={() => setAnchor(a => addMonths(a, 1))} aria-label="Next month">›</button>
          </div>
          <div className="kpi-cal-months">
            <MonthPanel monthAnchor={anchor} startD={visStart} endD={visEnd} onPick={onPick} />
            <MonthPanel monthAnchor={addMonths(anchor, 1)} startD={visStart} endD={visEnd} onPick={onPick} />
          </div>
          <div className="kpi-cal-foot">
            <span className="kpi-cal-hint">{hintText}</span>
            <span className="kpi-cal-foot-actions">
              <button type="button" className="kpi-cal-cancel" onClick={() => close(false)}>Cancel</button>
              <button
                type="button"
                className="kpi-btn kpi-btn-primary-v5"
                onClick={apply}
                disabled={!canApply}
              >
                Apply range
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
