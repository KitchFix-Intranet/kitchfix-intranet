"use client";
// src/app/kpi/overview/components/AlsoTracked.js
//
// Three lines watched together, not part of gross margin or cost of
// goods sold:
//   5002.1 General repair and maintenance
//   5002.5 Equipment
//   5017.3 Perks
//
// PR-2 item 21 (Kevin, 2026-09-02): always-visible card in the
// right rail. NO fold wrapper - the explanatory note moves into
// the ? tooltip. Prior D15 shipped a fold; a visible three-row
// card in the rail carries no cost and removes the click.
//
// Per §5.4 anatomy 9 + charter 11: "Not part of gross margin or
// cost of goods sold - watched together." No verdict, no pills,
// no ▲/▼.

import HelpPop from "@/app/kpi/labor/components/HelpPop";
import DashOrValue from "./DashOrValue";

function fmtMoney(n) {
  if (n == null || Number.isNaN(n)) return null;
  const abs = Math.abs(Math.round(Number(n)));
  const s = "$" + abs.toLocaleString("en-US");
  return n < 0 ? "-" + s : s;
}

function Row({ row }) {
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
        {bothNullish
          ? <DashOrValue state="missing" />
          : <DashOrValue value={actual_display} reported={row.reported} />}
      </td>
      <td className="kpi-ov-num kpi-ov-nb">
        {bothNullish ? <DashOrValue state="missing" />
          : noBudget ? <DashOrValue state="no_budget" />
          : <DashOrValue value={budget_display} reported={budget != null} />}
      </td>
      <td className="kpi-ov-num">
        {bothNullish ? <span className="kpi-ov-dash">no activity</span>
          : noBudget ? <DashOrValue state="missing" />
          : variance != null && Math.abs(variance) < 1 ? <span className="kpi-ov-nb">on budget</span>
          : variance != null
            ? <span className={variance <= 0 ? "kpi-ov-good" : "kpi-ov-bad"}>{fmtMoney(Math.abs(variance))} {variance <= 0 ? "under" : "over"}</span>
            : <span className="kpi-ov-nb">no data</span>}
      </td>
    </tr>
  );
}

export default function AlsoTracked({ payload }) {
  if (!payload?.also_tracked || payload.also_tracked.length === 0) return null;
  const isOpen = payload.period_state === "open";

  return (
    <div className="kpi-ov-card kpi-ov-card-tracked" data-kpi-ov="also-tracked">
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">Also tracked</span>
        <HelpPop
          id="overview-also-tracked"
          title="Also tracked"
          body={
            <>
              <p>
                Repair and maintenance, equipment and perks sit outside
                gross margin and cost of goods sold. They are not part of
                how this account is measured - watched together because
                the site influences them.
              </p>
              <p style={{ marginTop: 6 }}>
                <b>Perks</b> is the budget for celebrating your team -
                parties, recognitions, the Friday doughnuts. Spent on the
                Rippling card.
              </p>
            </>
          }
        />
        <span className="kpi-ov-pill kpi-ov-pill-neutral">Not scored</span>
      </div>
      <div className="kpi-ov-cb">
        <table className="kpi-ov-lev">
          <thead>
            <tr>
              <th className="l">Line</th>
              <th>{isOpen ? "Period to date" : "Actual"}</th>
              <th>{isOpen ? "Budget to date" : "Budget"}</th>
              <th style={{ width: 100 }}>vs budget</th>
            </tr>
          </thead>
          <tbody>
            {payload.also_tracked.map((r) => (
              <Row key={r.line_code} row={r} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
