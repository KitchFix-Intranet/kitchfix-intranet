"use client";
// src/app/kpi/overview/components/CogsLevers.js
//
// Element 5. Four levers behind gross margin. Table columns:
//   Line | Actual | Budget | Variance | Actual % | Target % | vs Target
//
// Every dollar / percent / direction word arrives formatted on the
// payload's `levers[]` array (§9B: server computes every dollar).
//
// Dash-vs-zero rules (Phase D):
//   - Zero-budget line: "no budget" in the Budget column, "-" in
//     Variance + Target% + vs-target.
//   - Both actual + budget nullish -> "not active" spanning the row.
//   - Otherwise render the formatted values.

import HelpPop from "@/app/kpi/labor/components/HelpPop";
import DashOrValue from "./DashOrValue";

function directionClass(direction) {
  if (direction === "good") return "kpi-ov-good";
  if (direction === "bad") return "kpi-ov-bad";
  return "kpi-ov-nb";
}

function LeverRow({ lever, open }) {
  const { line_code, label, flag } = lever;
  const isNotActive = lever.actual == null && lever.budget == null;
  const isNoBudget = lever.budget == null && lever.actual != null;

  if (isNotActive) {
    return (
      <tr data-kpi-ov="lever-row" data-kpi-ov-line-code={line_code} data-kpi-ov-cell-state="not-active">
        <td className="l">
          <span className="kpi-ov-glc kpi-ov-num">{line_code}</span>
          {label}
        </td>
        <td><DashOrValue state="not_active" /></td>
        <td><DashOrValue state="not_active" /></td>
        <td><DashOrValue state="not_active" /></td>
        <td><DashOrValue state="not_active" /></td>
        <td><DashOrValue state="not_active" /></td>
        <td><DashOrValue state="not_active" /></td>
      </tr>
    );
  }

  return (
    <tr data-kpi-ov="lever-row" data-kpi-ov-line-code={line_code}>
      <td className="l">
        <span className="kpi-ov-glc kpi-ov-num">{line_code}</span>
        {label}
        {flag === "mapping_gap" && (
          <span className="kpi-ov-chip-absent" style={{ marginLeft: 8 }} data-kpi-ov="chip-mapping-gap">
            mapping gap
          </span>
        )}
      </td>
      <td className="kpi-ov-num" data-kpi-ov-cell="actual">
        <DashOrValue value={lever.actual_display} reported={lever.actual != null} />
      </td>
      <td className="kpi-ov-num" data-kpi-ov-cell="budget">
        {isNoBudget ? (
          <DashOrValue state="no_budget" />
        ) : (
          <DashOrValue value={lever.budget_display} reported={lever.budget != null} />
        )}
      </td>
      <td className={`kpi-ov-num ${directionClass(lever.direction)}`} data-kpi-ov-cell="variance">
        {isNoBudget ? (
          <DashOrValue state="missing" />
        ) : lever.variance_display ? (
          lever.variance_display
        ) : (
          <DashOrValue value={null} reported={false} />
        )}
      </td>
      <td className="kpi-ov-num" data-kpi-ov-cell="actual-pct">
        <DashOrValue value={lever.actual_pct_display} reported={lever.actual_pct != null} />
      </td>
      <td className="kpi-ov-num kpi-ov-nb" data-kpi-ov-cell="target-pct">
        {isNoBudget ? (
          <DashOrValue state="missing" />
        ) : (
          <DashOrValue value={lever.target_pct_display} reported={lever.target_pct != null} />
        )}
      </td>
      <td className={`kpi-ov-num ${directionClass(lever.direction)}`} data-kpi-ov-cell="vs-target">
        {isNoBudget ? (
          <DashOrValue state="missing" />
        ) : lever.variance_pct_display ? (
          lever.variance_pct_display
        ) : (
          <DashOrValue value={null} reported={false} />
        )}
      </td>
    </tr>
  );
}

export default function CogsLevers({ levers, cogsCard, open, postureLabel = "the levers behind gross margin", title = "Your cost of goods lines" }) {
  if (!Array.isArray(levers)) return null;
  return (
    <div className="kpi-ov-card kpi-ov-card-aa kpi-ov-mt" data-kpi-ov="levers">
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">{title}</span>
        <span className="kpi-ov-gl">{postureLabel}</span>
        <HelpPop
          id="overview-levers"
          title="Cost of goods lines"
          body={<p>Each line as a percent of revenue against its own target. You hit the gross margin target by landing these at or under - or by trading between them.</p>}
        />
        <span className="kpi-ov-pill kpi-ov-pill-neutral">{levers.length} lines</span>
      </div>
      <div className="kpi-ov-cb">
        <table className="kpi-ov-lev">
          <colgroup>
            <col />
            <col style={{ width: "13%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "12%" }} />
          </colgroup>
          <thead>
            <tr>
              <th className="l">Line</th>
              <th>Actual{open ? " to date" : ""}</th>
              <th>Budget{open ? " to date" : ""}</th>
              <th>Variance</th>
              <th>Actual %</th>
              <th>Target %</th>
              <th>vs target</th>
            </tr>
          </thead>
          <tbody>
            {levers.map((l) => (
              <LeverRow key={l.line_code} lever={l} open={open} />
            ))}
            {cogsCard && (
              <tr className="tot" data-kpi-ov="lever-total">
                <td className="l">Total cost of goods sold</td>
                <td className="kpi-ov-num">
                  <DashOrValue value={cogsCard.hero_actual_display} reported={cogsCard.hero_reported} />
                </td>
                <td className="kpi-ov-num">
                  <DashOrValue value={cogsCard.budget_to_date_display} reported={cogsCard.budget_to_date != null} />
                </td>
                <td className={`kpi-ov-num ${directionClass(cogsCard.delta_direction)}`}>
                  {cogsCard.delta_display || <DashOrValue value={null} reported={false} />}
                </td>
                <td className="kpi-ov-num">
                  <DashOrValue value={cogsCard.pct_of_revenue_display} reported={cogsCard.pct_of_revenue != null} />
                </td>
                <td className="kpi-ov-num kpi-ov-nb">
                  <DashOrValue value={cogsCard.target_pct_display} reported={cogsCard.target_pct_of_revenue != null} />
                </td>
                <td className={`kpi-ov-num ${directionClass(cogsCard.delta_direction)}`}>
                  {cogsCard.delta_pct_display || <DashOrValue value={null} reported={false} />}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
