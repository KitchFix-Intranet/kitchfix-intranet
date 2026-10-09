"use client";
// src/app/kpi/overview/components/BillbackLedger.js
//
// Kevin ruling 2026-10-09 (PR-billback-1). Bottom-of-the-Overview
// fold on the single-account split branch, multi-period only. Fold
// chrome mirrors LaborLedger exactly - same shell, same head layout,
// same chevron. The body is a ledger table that reuses the Purchasing
// fold's .kpi-ov-cp-led-tbl family so the visual grammar matches the
// surface beside it.
//
// Columns: Period | Goal | Billed back | vs goal | % of goal
//
// Row rules:
//   - periods[] starts at first_goal_period (pre-season folded in).
//   - running period: in-progress tag + dash in vs-goal / %.
//   - off-season (0 projected meals) period in range: "no goal" in
//     Goal, dashes elsewhere.
//   - Foot row: "FY{year} · thru P{through_period}" with YTD values,
//     toned.
//
// Mount is unconditional in page.js; the component self-hides on
// billback=null (non-MF and single-period ranges).

import HelpPop from "@/app/kpi/labor/components/HelpPop";

function fmtMoney(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  const v = Number(n);
  const abs = Math.abs(Math.round(v));
  const s = "$" + abs.toLocaleString("en-US");
  return v < 0 ? "-" + s : s;
}
function fmtPctWhole(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Math.round(Number(n)).toLocaleString("en-US") + "%";
}

const TONE_CLS = {
  over: "kpi-ov-bb-amber",
  under: "kpi-ov-bb-good",
  on: "kpi-ov-bb-neutral",
  na: "kpi-ov-bb-neutral",
};

const BILLBACK_FOLD_HELP = (
  <>
    <p>Each period&rsquo;s billed-back goal (from the annual goal, allocated by projected meal count) and what the club has actually reimbursed. Pre-season reimbursables fold into the first goaled period.</p>
    <p>YTD sums periods the board has settled - closed, R-93 cleared. Running and future periods appear here but do not contribute to YTD.</p>
  </>
);

const DASH = "—";

export default function BillbackLedger({ billback, open, onToggle }) {
  if (!billback) return null;
  const { annual_goal, fiscal_year, through_period, periods, ytd } = billback;

  // Fold summary (collapsed state): one-line "{actual_to_date} ·
  // {pct_of_goal_to_date}% of goal", toned like the Labor fold.
  const summary = annual_goal != null
    ? `${fmtMoney(ytd.actual_to_date)} · ${fmtPctWhole(ytd.pct_of_goal_to_date)} of goal`
    : `no goal set for FY${fiscal_year}`;

  const footToneCls = TONE_CLS[ytd.tone] || "kpi-ov-bb-neutral";

  return (
    <div
      className={`kpi-ov-card kpi-ov-mt kpi-ov-fold-card kpi-ov-fold-panel${open ? " kpi-ov-fold-open" : ""}`}
      data-kpi-ov="billback-ledger"
      data-kpi-ov-open={open ? "1" : "0"}
    >
      {/* Head holds the fold trigger + a sibling HelpPop. Nesting
          would put a button inside a button - invalid HTML. The id
          qBillbackFold is distinct from qBillbackCard (card) so two
          HelpPop instances do not collide on data-hs-help. */}
      <div className="kpi-ov-fold-head">
        <button
          type="button"
          className="kpi-ov-fold-trigger"
          data-kpi-ov="fold-billback"
          onClick={onToggle}
          aria-expanded={open ? "true" : "false"}
        >
          <span className="kpi-ov-eb">Billed back to club</span>
          {summary && (
            <span className="kpi-ov-fold-summary" data-kpi-ov="billback-fold-summary">{summary}</span>
          )}
          <span className="kpi-ov-fold-cv" aria-hidden="true">▾</span>
        </button>
        <HelpPop id="qBillbackFold" title="Billed back by period" body={BILLBACK_FOLD_HELP} />
      </div>
      {open && (
        <div className="kpi-ov-cb">
          {annual_goal == null ? (
            <div className="kpi-ov-cp-led-warn" role="status" data-kpi-ov="billback-ledger-no-goal">
              No billed-back goal set for FY{fiscal_year}.
            </div>
          ) : (
            <div className="kpi-ov-cp-led-scroll">
              <table className="kpi-ov-cp-led-tbl">
                <thead>
                  <tr>
                    <th className="kpi-ov-cp-led-l">Period</th>
                    <th>Goal</th>
                    <th className="kpi-ov-bb-col-emph">Billed back</th>
                    <th>vs goal</th>
                    <th>% of goal</th>
                  </tr>
                </thead>
                <tbody>
                  {(periods || []).map(r => {
                    const isRunning = r.state === "in_progress";
                    const isOff = r.state === "off_season";
                    const vsCls = TONE_CLS[r.tone] || "kpi-ov-bb-neutral";
                    return (
                      <tr key={r.period_no} className="kpi-ov-cp-led-vrow" data-kpi-ov="billback-row" data-kpi-ov-period={r.period_no} data-kpi-ov-state={r.state}>
                        <td className="kpi-ov-cp-led-l">
                          P{r.period_no}
                          {isRunning && <span className="kpi-ov-cp-led-cx" data-kpi-ov="billback-running">running</span>}
                        </td>
                        <td>{isOff ? <span className="kpi-ov-cp-led-dim">no goal</span> : fmtMoney(r.goal)}</td>
                        <td className="kpi-ov-bb-col-emph">{fmtMoney(r.actual)}</td>
                        <td className={isRunning || isOff ? "" : vsCls}>
                          {isRunning || isOff || r.delta == null
                            ? <span className="kpi-ov-cp-led-dim">{DASH}</span>
                            : fmtMoney(r.delta)}
                        </td>
                        <td className={isRunning || isOff ? "" : vsCls}>
                          {isRunning || isOff || r.pct == null
                            ? <span className="kpi-ov-cp-led-dim">{DASH}</span>
                            : fmtPctWhole(r.pct)}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="kpi-ov-cp-led-vrow kpi-ov-bb-foot" data-kpi-ov="billback-foot">
                    <td className="kpi-ov-cp-led-l">
                      FY{fiscal_year}
                      {through_period ? <span className="kpi-ov-cp-led-cx">thru P{through_period}</span> : null}
                    </td>
                    <td>{fmtMoney(ytd.goal_to_date)}</td>
                    <td className="kpi-ov-bb-col-emph">{fmtMoney(ytd.actual_to_date)}</td>
                    <td className={footToneCls}>{fmtMoney(ytd.delta)}</td>
                    <td className={footToneCls}>{fmtPctWhole(ytd.pct_of_goal_to_date)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
