"use client";
// src/app/kpi/purchasing/components/ManagementFeeCard.js
//
// PR 3 - management-fee card (spec §6.7).
//
// The top card at CIN - OH, STL - FL, STL - MO. Food, packaging and
// supplies are billed back to the client - savings revert to them,
// overruns are billable. The card is a stewardship surface:
//   - hero: spend FYTD vs the annual client-agreed goal
//   - progress bar: fraction of goal used, with a marker at the
//     fraction of the year elapsed (so a bar past the marker reads
//     visibly hot without a red/green verdict)
//   - 8-period trend: per-period reimbursable spend as bar heights,
//     relative to the site's own average
//
// **No verdict anywhere.** No red, no green, no pass/fail. The board
// surfaces an outlier; a person (RDO, Kevin, Sebastian) decides.
// Kevin cut the "Worth a conversation" advisory copy in v22 - the
// judgement is not the dashboard's.
//
// Data flow:
//   goal        - static, from src/lib/accountModels.js MANAGEMENT_FEE_GOALS
//                 via goalFor(account). Includes salesTaxApplied flag +
//                 breakdown for STL - MO's amber caution.
//   goalFytdSpent - route.mgmt_fee.goal_fytd_spent (FYTD reimbursable
//                 spend for this account, independent of the range).
//   periodsTrend - route.mgmt_fee.periods_trend (P1..currentP with spent).
//   yearElapsedFrac - fraction of FY2026 elapsed as of today (client
//                 computes; the marker is a stable calendar reading).

import HelpPop from "@/app/kpi/labor/components/HelpPop.js";
import { fmt$, fmtPct } from "../lib/board";

const MODEL_BODY = (
  <>
    Food, packaging and supplies here are billed back to the client.
    Savings revert to them, overruns are billable.
    <br /><br />
    <b>Nothing on this card is a grade.</b> It exists so the team
    can see the shape of spend and spot an outlier early.
    <span className="kpi-hs-pop-foot">
      The board surfaces; a person decides. No advisory copy.
    </span>
  </>
);

const GOAL_BODY = (
  <>
    The goal is <b>annual</b>. Spend is <b>seasonal</b> - homestand
    weeks run hot, road-trip weeks run cold - so a bar past the
    year-elapsed marker in Period 5 is not on-plan the same way it
    would be in Period 12.
    <br /><br />
    Read the bar plus the marker together: the gap tells you whether
    the site is tracking the season or drifting ahead of it.
    <span className="kpi-hs-pop-foot">
      Goals are set by the client and KitchFix at the start of the
      season, not from `kpi_budgets`. Changing one is a contract
      conversation, not a spreadsheet edit.
    </span>
  </>
);

const AMBER_CAUTION = (breakdown) => (
  <>
    Missouri sales tax has not been applied to this goal. Base is
    <b> {fmt$(breakdown.base)}</b> plus <b>{fmt$(breakdown.water)}</b> for
    water. {breakdown.note}.
  </>
);

export function ManagementFeeCard({
  account,
  goal,               // { annual, salesTaxApplied, breakdown } | null
  goalFytdSpent,      // number - FYTD reimbursable spend
  periodsTrend,       // [{ period_no, start, end, spent }]
  yearElapsedFrac,    // 0..1 - calendar-year fraction elapsed today
  client,             // "St. Louis Cardinals", displayed in the hero-side blurb
}) {
  // Missing goal = render an honest amber hole. The prompt requires
  // this shape even when the value is present - keeps the render
  // valid if someone unwires the constant.
  if (!goal || !(Number(goal.annual) > 0)) {
    return (
      <div className="kpi-p-card kpi-p-mf" data-card="mgmt-fee-hole">
        <div className="kpi-p-head">
          <div className="kpi-p-head-body">
            <span className="kpi-p-cardtitle kpi-p-ct-reimb">
              Management fee account
            </span>
            <span className="kpi-p-cardsub">annual goal not configured</span>
          </div>
        </div>
        <div className="kpi-p-mf-hole">
          Annual goal figure is not yet set for <b>{account}</b>. The
          card will render once the goal lands in
          {" "}<code>MANAGEMENT_FEE_GOALS</code> in
          {" "}<code>src/lib/accountModels.js</code>.
        </div>
      </div>
    );
  }

  const spent = Number(goalFytdSpent || 0);
  const annual = Number(goal.annual);
  const usedFrac = annual > 0 ? spent / annual : 0;
  const usedPct  = annual > 0 ? spent / annual : null;

  const trend = Array.isArray(periodsTrend) ? periodsTrend : [];
  // Bar height: each period's spent divided by the site's own
  // recent average (trailing 8 periods here). A bar taller than the
  // average shows as `hi` (amber). Neutral if data insufficient.
  const spentVals = trend.map(t => Number(t.spent || 0));
  const avg = spentVals.length ? spentVals.reduce((s, v) => s + v, 0) / spentVals.length : 0;
  const maxRatio = spentVals.reduce((m, v) => (avg > 0 ? Math.max(m, v / avg) : m), 1);
  const scaleTop = Math.max(1.2, maxRatio + 0.1); // never a bar past the ceiling

  return (
    <div className="kpi-p-card kpi-p-mf" data-card="mgmt-fee">
      <div className="kpi-p-head">
        <div className="kpi-p-head-body">
          <span className="kpi-p-cardtitle kpi-p-ct-reimb">
            Management fee account
            {" "}<HelpPop id="qMgmtFeeModel" title="Management fee account" body={MODEL_BODY} />
          </span>
          <span className="kpi-p-cardsub">
            billed back to {client || account} · stewardship goal
          </span>
        </div>
        <div className="kpi-p-pillrow">
          <span className="kpi-p-modelbadge">management fee</span>
        </div>
      </div>

      <div className="kpi-p-mfhero">
        <span className="kpi-p-mfhero-big num">{fmt$(spent)}</span>
        <span className="kpi-p-mfhero-of">
          of <b>{fmt$(annual)}</b> annual goal
        </span>
        <span className="kpi-p-mfhero-p num">
          {usedPct != null ? fmtPct(usedPct) : "—"}
        </span>
      </div>

      <div className="kpi-p-mfbar" role="img" aria-label={`Progress ${fmtPct(usedFrac)} of ${fmt$(annual)} annual goal`}>
        <i style={{ width: `${Math.min(usedFrac, 1) * 100}%` }} />
        <span
          className="kpi-p-mfbar-yr"
          style={{ left: `${Math.min(Math.max(yearElapsedFrac, 0), 1) * 100}%` }}
          aria-hidden="true"
        />
      </div>
      <div className="kpi-p-mffoot">
        <span>spent FYTD</span>
        <span>
          marker = {fmtPct(yearElapsedFrac)} of the year gone
          {" "}<HelpPop id="qMgmtFeeGoal" title="Annual goal vs seasonal spend" body={GOAL_BODY} />
        </span>
      </div>

      {goal.salesTaxApplied === false && goal.breakdown && (
        <div className="kpi-p-mfcaution" role="note">
          {AMBER_CAUTION(goal.breakdown)}
        </div>
      )}

      <div className="kpi-p-mftrend">
        <span className="kpi-p-label">Spend by period</span>
        <span className="kpi-p-cardmeta">
          relative to this site&rsquo;s average
        </span>
        <div className="kpi-p-mfbars" role="img" aria-label="Per-period spend, 8-period trend">
          {trend.map((t) => {
            const ratio = avg > 0 ? Number(t.spent || 0) / avg : 0;
            const heightPct = Math.max(4, (ratio / scaleTop) * 100);
            const hi = ratio > 1.15;
            return (
              <div key={t.period_no} className="kpi-p-mfbars-c">
                <i
                  className={hi ? "kpi-p-mfbars-hi" : ""}
                  style={{ height: `${heightPct}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="kpi-p-mflab">
          {trend.map((t) => (
            <span key={`lab-${t.period_no}`}>{`P${t.period_no}`}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
