"use client";
// src/app/kpi/labor/components/DetailsStrip.js
//
// V8-17 - one bordered strip titled ALL THE NUMBERS with six cells and
// vertical dividers. Cells whose value does not apply render a dash
// and mute the value color (V8-17). Collapsible; state persisted.

import { useEffect, useState } from "react";
import { fmt$, fmtHrs } from "../lib/formatting.js";

// S-12: default COLLAPSED, state persisted per user. Key name switched
// from `kpi:board:details` to `kpi.details.open` per spec S-12.
const OPEN_KEY = "kpi.details.open";

function Cell({ label, value, caption, muted }) {
  return (
    <div className="kpi-det-cell">
      <div className="kpi-det-k">{label}</div>
      <div className={`kpi-det-v num ${muted ? "kpi-det-v-mute" : ""}`}>{value}</div>
      {caption && <div className="kpi-det-c">{caption}</div>}
    </div>
  );
}

export function DetailsStrip({ board }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { const v = localStorage.getItem(OPEN_KEY); if (v === "0" || v === "1") setOpen(v === "1"); } catch {}
  }, []);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(OPEN_KEY, next ? "1" : "0"); } catch {}
  };
  if (!board || board.applies === false) return null;
  const budget = board.period_budget || board.range_budget;
  const allowance = board.weekly_allowance;
  const pace = board.pace_pct;
  const elapsed = board.elapsed_pct;
  const projected = board.projected_period_end;
  const unpriced = board.unpriced_hours;
  const budgetCaption = board.period_no ? "FY2026 budget" : "FY2026 range budget";
  return (
    <div className="kpi-det">
      <button type="button" className="kpi-det-h" onClick={toggle} aria-expanded={open ? "true" : "false"}>
        <span className="kpi-det-h-caret" aria-hidden="true">{open ? "⌄" : "›"}</span>
        <span className="kpi-det-h-t">ALL THE NUMBERS</span>
        <span className="kpi-det-h-hint">every figure the board is built from</span>
      </button>
      {open && (
        <div className="kpi-det-table">
          <Cell
            label={board.period_no ? `Budget · Period ${board.period_no}` : "Budget · range"}
            value={budget != null ? fmt$(budget) : "—"}
            caption={budget != null ? budgetCaption : "no budget"}
            muted={budget == null}
          />
          <Cell
            label="Spent to date"
            value={board.spent_to_date != null ? fmt$(board.spent_to_date) : "—"}
            caption={board.kind === "single_period_in_progress"
              ? `${(board.closed_weeks_count || 0) + (board.in_progress_week_start ? 1 : 0)} of ${board.weeks_in_period} weeks`
              : board.kind === "single_period_closed" ? "period closed"
              : "range total"}
          />
          <Cell
            label="Weekly allowance"
            value={allowance != null ? fmt$(allowance) : "—"}
            caption={allowance != null
              ? `per week · ${(board.in_progress_week_start ? 1 : 0) + (board.not_started_weeks_count || 0)} left${board.budget_exhausted ? " · budget exhausted" : ""}`
              : "does not apply"}
            muted={allowance == null}
          />
          <Cell
            label="Pace"
            value={pace != null ? `${pace}%` : "—"}
            caption={elapsed != null ? `of budget · ${elapsed}% elapsed` : ""}
            muted={pace == null}
          />
          <Cell
            label="Projected end"
            value={projected != null ? fmt$(projected) : "—"}
            caption={projected != null ? "at run rate" : "closed period"}
            muted={projected == null}
          />
          <Cell
            label="Unpriced hours"
            value={fmtHrs(unpriced || 0)}
            caption={unpriced > 0 ? "in range" : "none in range"}
            muted={!(unpriced > 0)}
          />
        </div>
      )}
    </div>
  );
}
