"use client";
// src/app/kpi/labor/components/DetailsStrip.js
//
// V21-13 - ALL THE NUMBERS. Two labeled groups side by side inside the
// existing bordered strip.
//   BUDGET · Budget · Spent to date · Pace · Projected end
//   CREW   · Workers · Avg rate · Weekly allowance · Unapproved hours
// Collapsed-by-default; state persisted (V8-12/S-12; key name unchanged).

import { useEffect, useState } from "react";
import { fmt$, fmtHrs } from "../lib/formatting.js";

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
  const workers = board.distinct_workers ?? 0;
  const avgRate = board.avg_rate;
  const budgetCaption = board.period_no ? "FY2026 budget" : "FY2026 range budget";
  const denomLeft = (board.in_progress_week_start ? 1 : 0) + (board.not_started_weeks_count || 0);

  return (
    <div className="kpi-det">
      <button type="button" className="kpi-det-h" onClick={toggle} aria-expanded={open ? "true" : "false"}>
        <span className="kpi-det-h-caret" aria-hidden="true">{open ? "⌄" : "›"}</span>
        <span className="kpi-det-h-t">ALL THE NUMBERS</span>
        <span className="kpi-det-h-hint">every figure the board is built from</span>
      </button>
      {open && (
        <div className="kpi-det-table">
          <div className="kpi-det-grp">
            <div className="kpi-det-grp-h">BUDGET</div>
            <div className="kpi-det-grp-cells">
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
                label="Pace"
                value={pace != null ? `${pace}%` : "—"}
                caption={elapsed != null ? `${elapsed}% elapsed` : ""}
                muted={pace == null}
              />
              <Cell
                label="Projected end"
                value={projected != null ? fmt$(projected) : "—"}
                caption={projected != null ? "at run rate" : "closed period"}
                muted={projected == null}
              />
            </div>
          </div>
          <div className="kpi-det-grp">
            <div className="kpi-det-grp-h">CREW</div>
            <div className="kpi-det-grp-cells">
              <Cell
                label="Workers"
                value={workers}
                caption="distinct people in range"
                muted={!workers}
              />
              <Cell
                label="Avg rate"
                value={avgRate != null ? `$${avgRate.toFixed(2)}` : "—"}
                caption="blended · $/hr"
                muted={avgRate == null}
              />
              {/* V33 item 4d - weekly allowance shows a bare dash with
                  `does not apply` on closed periods. Correct; the muted
                  colour tells the reader it is absent, not a value. */}
              <Cell
                label="Weekly allowance"
                value={allowance != null ? fmt$(allowance) : "—"}
                caption={allowance != null
                  ? `per week · ${denomLeft} left${board.budget_exhausted ? " · budget exhausted" : ""}`
                  : "does not apply"}
                muted={allowance == null}
              />
              {/* V33 item 4a - Unpriced -> Unapproved rename across the
                  board so the vocabulary does not fragment. */}
              <Cell
                label="Unapproved hours"
                value={fmtHrs(unpriced || 0)}
                caption={unpriced > 0 ? "in range" : "none in range"}
                muted={!(unpriced > 0)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
