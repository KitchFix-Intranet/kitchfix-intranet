"use client";
// src/app/kpi/overview/components/AlsoTracked.js
//
// Three lines watched together, not part of gross margin or cost of
// goods sold:
//   5002.1 Gen. Repair & Maintenance
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

function Row({ row, isOpen }) {
  const { line_code, label, actual, budget, actual_display, budget_display, variance } = row;
  const bothNullish = (actual == null || actual === 0) && (budget == null || budget === 0);
  const noBudget = (budget == null || budget === 0) && actual != null && actual !== 0;
  // Kevin ruling 2026-09-03 item 3: on closed ranges an empty tracked
  // row reads "no spend" - the period is over and the money genuinely
  // wasn't spent. On open ranges keep "no activity" - the period is
  // still running so the truth of whether anything landed is not yet
  // final. Same word for both sides of the row.
  const emptyPhrase = isOpen ? "no activity" : "no spend";

  return (
    <tr data-kpi-ov="tracked-row" data-kpi-ov-line-code={line_code}>
      <td className="l">
        <span className="kpi-ov-glc kpi-ov-num">{line_code}</span>
        {label}
      </td>
      {/* Plan band: Budget cell carries the band class row-by-row.
          Kevin PR-B item 3 (2026-09-03): the empty plan cell on This
          period reads `no budget` (same treatment This year already
          gets) rather than a dash. Budget-null is the same signal
          across both ranges - render it once. */}
      <td className="kpi-ov-num kpi-ov-nb plan plan-first plan-last">
        {bothNullish ? <DashOrValue state="no_budget" />
          : noBudget ? <DashOrValue state="no_budget" />
          : <DashOrValue value={budget_display} reported={budget != null} />}
      </td>
      <td className="kpi-ov-num">
        {bothNullish
          ? <DashOrValue state="missing" />
          : <DashOrValue value={actual_display} reported={row.reported} />}
      </td>
      <td className="kpi-ov-num">
        {/* Kevin ruling 2026-09-03 item 3: empty tracked rows read
            "no spend" on closed, "no activity" on open - see Row().
            Kevin PR-B item 3 (2026-09-03): a line with spend but no
            budget shows the spend in vs-budget, uncoloured - there
            is no budget to be over. Not a dash, not coloured red. */}
        {bothNullish ? <span className="kpi-ov-dash" data-kpi-ov="tracked-empty">{emptyPhrase}</span>
          : noBudget ? <span className="kpi-ov-nb" data-kpi-ov="tracked-nobudget-actual">{actual_display}</span>
          : variance != null && Math.abs(variance) < 1 ? <span className="kpi-ov-nb">on budget</span>
          : variance != null
            ? <span className={variance <= 0 ? "kpi-ov-good" : "kpi-ov-bad"}>{fmtMoney(Math.abs(variance))} {variance <= 0 ? "under" : "over"}</span>
            : <span className="kpi-ov-dash" data-kpi-ov="tracked-empty">{emptyPhrase}</span>}
      </td>
    </tr>
  );
}

export default function AlsoTracked({ payload }) {
  if (!payload?.also_tracked || payload.also_tracked.length === 0) return null;
  const isOpen = payload.period_state === "open";
  // Kevin 2026-09-02 language pass Items 21-22: "Period to date" ->
  // "Spend thru P8"; "Budget to date" -> "Budget thru P8". On
  // verified closed, "Actual" stays; on single open, "Spend period
  // to date" per range_labels.through. Ranges without a period label
  // fall back to the classic strings.
  const rl = payload.range_labels;
  // Kevin PR-B item 5 (2026-09-03): also-tracked was reverting to
  // generic "Actual" / "Budget" on single closed periods, while the
  // other tables on the same screen carried the period. Fork per
  // range kind:
  //   FYTD           -> "Spend thru P8"  / "Budget thru P8"
  //   single_closed  -> "Final P8"       / "P8 budget"
  //   single_open    -> "Spend period to date" / "Budget period to date"
  const isSingleClosed = rl?.kind === "single_closed";
  const actualHeader = isSingleClosed
    ? rl.actuals
    : (rl?.through ? `Spend ${rl.through}` : "Actual");
  const budgetHeader = isSingleClosed
    ? `${rl.period_last} budget`
    : (rl?.through ? `Budget ${rl.through}` : "Budget");

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
                Gen. Repair & Maintenance, equipment and perks sit outside
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
        <table className="kpi-ov-lev kpi-ov-tband">
          <thead>
            {/* Kevin ruling final-presentation (2026-09-03) item 3:
                Plan / Actual band. Sub-headers: Budget (plan) ·
                Spent + vs budget (actual). "Spent" not "Actual". */}
            <tr className="kpi-ov-tband-grp" data-kpi-ov="tband-group">
              <th className="l"></th>
              <th className="plan plan-first plan-last kpi-ov-tband-plan">Plan</th>
              <th colSpan={2} className="kpi-ov-tband-act">Actual</th>
            </tr>
            <tr>
              <th className="l">Line</th>
              <th className="plan plan-first plan-last">Budget</th>
              <th>Spent</th>
              <th style={{ width: 100 }}>vs budget</th>
            </tr>
          </thead>
          <tbody>
            {payload.also_tracked.map((r) => (
              <Row key={r.line_code} row={r} isOpen={isOpen} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
