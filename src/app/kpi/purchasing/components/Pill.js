"use client";
// src/app/kpi/purchasing/components/Pill.js
//
// State pill. One tone per state (see PILL_COPY in ../lib/board.js).
// Copy and tone MUST come from the same resolveCardState() output the
// hero and chart consume - §9B one-source rule.
//
// `finalMarker` optionally renders a second neutral-steel "Final" pill
// (period card only, closed period). `Provisional` is a lifecycle
// marker, not a state.

export function Pill({ tone, label }) {
  return (
    <span className={`kpi-p-pill ${tone || "n"}`}>
      <i />
      {label}
    </span>
  );
}

export function FinalPill({ label }) {
  return (
    <span className="kpi-p-pill f">
      <i />
      {label}
    </span>
  );
}

export function ProvisionalPill() {
  return (
    <span className="kpi-p-pill n">
      <i />
      Provisional
    </span>
  );
}
