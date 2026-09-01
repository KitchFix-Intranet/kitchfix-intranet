"use client";
// src/app/kpi/overview/components/AlsoTracked.js
//
// Element 9. Three lines watched together, not part of gross margin
// or cost of goods sold:
//   5002.1 General repair and maintenance
//   5002.5 Equipment
//   5017.3 Perks
//
// D15 (PR 2, 2026-09-01): the strip is now a fold, collapsed by
// default, with a solid grey border. Prior version rendered a dashed
// band that stayed open below the P&L fold - a permanent decorative
// dashed outline on a section the operator rarely needs to open.
//
// Per §5.4 anatomy 9 + charter 11: "Not part of gross margin or cost
// of goods sold - watched together." No verdict, no pills, no ▲/▼.
//
// Perks explained (R-17c + §11 charter 11): 5017.3 is the budget for
// celebrating the team - parties, recognitions, doughnuts. Spent on
// the Rippling card.
//
// Dash-vs-zero rules apply the same as the levers table:
//   - both actual + budget nullish            -> "no activity"
//   - actual reported + budget nullish        -> "no budget" for budget cell
//   - actual reported + budget = 0            -> "no budget" for budget cell
//   - variance under $1                       -> "on budget"

import { useState } from "react";
import HelpPop from "@/app/kpi/labor/components/HelpPop";
import DashOrValue from "./DashOrValue";

function fmtMoney(n) {
  if (n == null || Number.isNaN(n)) return null;
  const abs = Math.abs(Math.round(Number(n)));
  const s = "$" + abs.toLocaleString("en-US");
  return n < 0 ? "-" + s : s;
}

function Row({ row, isOpen }) {
  const { line_code, label, actual, budget, actual_display, budget_display, variance } = row;
  const bothNullish = (actual == null || actual === 0) && (budget == null || budget === 0);
  const noBudget = (budget == null || budget === 0) && actual != null && actual !== 0;

  return (
    <tr data-kpi-ov="tracked-row" data-kpi-ov-line-code={line_code}>
      <td className="l">
        <span className="kpi-ov-glc kpi-ov-num">{line_code}</span>
        {label}
      </td>
      <td className="kpi-ov-num">
        {bothNullish ? (
          <DashOrValue state="missing" />
        ) : noBudget ? (
          <DashOrValue state="no_budget" />
        ) : (
          <DashOrValue value={budget_display} reported={budget != null} />
        )}
      </td>
      <td className="kpi-ov-num">
        {bothNullish ? (
          <DashOrValue state="missing" />
        ) : (
          <DashOrValue value={actual_display} reported={row.reported} />
        )}
      </td>
      <td className="kpi-ov-num">
        {bothNullish ? (
          <span className="kpi-ov-dash">no activity</span>
        ) : noBudget ? (
          <DashOrValue state="missing" />
        ) : variance != null && Math.abs(variance) < 1 ? (
          <span className="kpi-ov-nb">on budget</span>
        ) : variance != null ? (
          <span className={variance <= 0 ? "kpi-ov-good" : "kpi-ov-bad"}>
            {fmtMoney(Math.abs(variance))} {variance <= 0 ? "under" : "over"}
          </span>
        ) : (
          /* 2026-09-01 defect fix: unreported actual against a real
             budget can no longer render a phantom savings ($115 under
             on a line with no measured spend). Server sets variance
             to null when reported=false; client renders "no data" in
             neutral so the operator sees the gap for what it is. */
          <span className="kpi-ov-nb">no data</span>
        )}
      </td>
    </tr>
  );
}

export default function AlsoTracked({ payload }) {
  const [open, setOpen] = useState(false);
  if (!payload?.also_tracked || payload.also_tracked.length === 0) return null;
  const isOpen = payload.period_state === "open";

  return (
    <div
      className={`kpi-ov-card kpi-ov-card-plain kpi-ov-mt kpi-ov-fold-card${open ? " kpi-ov-fold-open" : ""}`}
      data-kpi-ov="also-tracked"
      data-kpi-ov-open={open ? "1" : "0"}
    >
      <button
        type="button"
        className="kpi-ov-fold-trigger"
        data-kpi-ov="fold-tracked"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open ? "true" : "false"}
      >
        <span className="kpi-ov-eb">Also tracked</span>
        <span className="kpi-ov-gl">repair, equipment and perks - not part of gross margin, watched together</span>
        <span className="kpi-ov-fold-cv" aria-hidden="true">▾</span>
      </button>
      {open && (
        <>
          <div className="kpi-ov-fold-meta">
            <HelpPop
              id="overview-also-tracked"
              title="Also tracked"
              body={<p>These sit outside gross margin and cost of goods sold. They are not part of how this account is measured - we watch them together because the site influences them.</p>}
            />
          </div>
          <div className="kpi-ov-cb">
            <table className="kpi-ov-lev">
              <thead>
                <tr>
                  <th className="l">Line</th>
                  <th>Budget{isOpen ? " to date" : ""}</th>
                  <th>Actual{isOpen ? " to date" : ""}</th>
                  <th style={{ width: 130 }}>vs budget</th>
                </tr>
              </thead>
              <tbody>
                {payload.also_tracked.map((r) => (
                  <Row key={r.line_code} row={r} isOpen={isOpen} />
                ))}
              </tbody>
            </table>
            <p className="kpi-ov-tracked-note">
              <b>Perks</b> is the budget for celebrating your team - parties, recognitions, the Friday doughnuts. Spent on the Rippling card.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
