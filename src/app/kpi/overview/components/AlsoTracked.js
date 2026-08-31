"use client";
// src/app/kpi/overview/components/AlsoTracked.js
//
// Element 9. Dashed band, no pills. Three lines:
//   5002.1 General repair and maintenance
//   5002.5 Equipment
//   5017.3 Perks
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
          <DashOrValue state="missing" />
        )}
      </td>
    </tr>
  );
}

export default function AlsoTracked({ payload }) {
  if (!payload?.also_tracked || payload.also_tracked.length === 0) return null;
  const isOpen = payload.period_state === "open";

  return (
    <div className="kpi-ov-tracked" data-kpi-ov="also-tracked">
      <div className="kpi-ov-tracked-hd">
        <span className="kpi-ov-eb">Also tracked</span>
        <HelpPop
          id="overview-also-tracked"
          title="Also tracked"
          body={<p>These sit outside gross margin and cost of goods sold. They are not part of how this account is measured - we watch them together because the site influences them.</p>}
        />
      </div>
      <div className="kpi-ov-tracked-sub">
        Not part of gross margin or cost of goods sold - watched together.
      </div>
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
  );
}
