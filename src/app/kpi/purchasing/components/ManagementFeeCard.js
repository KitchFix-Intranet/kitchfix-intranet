"use client";
// src/app/kpi/purchasing/components/ManagementFeeCard.js
//
// R14 - two-pane management-fee card.  Replaces the prior ManagementFeeCard
// + PassThroughPeriodCard + ReimbursableRow trio for the three pass-through
// accounts (CIN - OH, STL - FL, STL - MO).
//
// Structure (Kevin's hybrid render, 2026-08-27):
//   Left pane  = statement, scoped to the range picked
//     - card title / status line / pill stack
//     - hero: "Billed back to <client>" or "Reimbursable and fun money"
//     - categories with GL codes + share
//     - pending row, pinned below a divider at pane bottom
//   Right pane = the year, FYTD-anchored regardless of range
//     - "The year" title / FY2026 subtitle / management-fee badge
//     - hero: "Over the annual goal by" (red) or "Room in the annual goal" (navy)
//     - sub-caption: "$X spent of $Y" + tax caveat
//     - track bar with year-elapsed + spent markers
//     - sentence: crossed-in-period-N or $X-remains
//     - mini trend: per-period spend, above-average = solid
//
// Every value + caption comes from resolveMgmtFeeCard() in board.js.
// The component computes nothing.

import HelpPop from "@/app/kpi/labor/components/HelpPop.js";
import { resolveMgmtFeeCard } from "../lib/board";

const LEFT_BODY = (
  <>
    Food, packaging and supplies here are billed back to the client.
    <b> Nothing on this card is a grade</b> - the client approves and
    pays for the spend.  Fun money (3200.2) is the one KitchFix-borne
    line and only shows here when it is non-zero.
    <span className="kpi-hs-pop-foot">
      The range picker on top applies to this pane only.  The year
      pane at right stays FYTD.
    </span>
  </>
);

const RIGHT_BODY = (
  <>
    The annual stewardship goal for this site.  <b>It does not change
    with the range you pick</b> - it is the whole fiscal year, shown
    here so the range on the left has context.
    <span className="kpi-hs-pop-foot">
      Goals are set by the client and KitchFix at the start of the
      season, not from kpi_budgets.  Changing one is a contract
      conversation, not a spreadsheet edit.
    </span>
  </>
);

export function ManagementFeeCard({
  account,               // "STL - MO"
  goal,                  // MANAGEMENT_FEE_GOALS[account] | null
  mgmtFee,               // route.mgmt_fee (extended block with reimb_categories etc.)
  reimbSpentRange,       // client-computed 13xx sum for the RANGE (not FYTD)
  pending,               // route.pending
  yearElapsedFrac,       // fraction of FY2026 elapsed today
  cardTitle,             // "Fiscal year to date" | "Period 8" | ...
  rangeLabel,            // "07/13/26 - 08/09/26" for the meta line
  closed, provisional, isFutureRange,
  weekOfPeriod, weeksInPeriod, elapsedFrac,
}) {
  // Missing goal = honest amber hole.  Keeps the surface valid if
  // someone unwires the constant.
  if (!goal || !(Number(goal.annual) > 0)) {
    return (
      <div className="kpi-p-card kpi-p-mf-hole" data-card="mgmt-fee-hole">
        <div className="kpi-p-mf-hole-body">
          Annual goal figure is not yet set for <b>{account}</b>. The
          card will render once the goal lands in{" "}
          <code>MANAGEMENT_FEE_GOALS</code> in{" "}
          <code>src/lib/accountModels.js</code>.
        </div>
      </div>
    );
  }

  const d = resolveMgmtFeeCard({
    accountKey: account,
    goalRow: goal,
    mgmtFee,
    reimbSpentRange: Number(reimbSpentRange || 0),
    pending,
    yearElapsedFrac,
    closed, provisional, isFutureRange,
    weekOfPeriod, weeksInPeriod, elapsedFrac,
    cardTitle,
  });

  return (
    <div className="kpi-p-card kpi-p-mf" data-card="mgmt-fee">
      {/* ─── LEFT PANE: statement, range-scoped ───────────────────── */}
      <div className="kpi-p-mf-pane kpi-p-mf-pane-l">
        <div className="kpi-p-head">
          <div className="kpi-p-head-body">
            <span className="kpi-p-cardtitle kpi-p-ct-mf">
              {d.cardTitle}
              {" "}<HelpPop id="qMgmtFeeStatement" title="This statement" body={LEFT_BODY} />
            </span>
            {rangeLabel && <span className="kpi-p-cardsub">{rangeLabel}</span>}
            {d.statusLineText && (
              <div>
                <span className="kpi-p-cardmeta">{d.statusLineText}</span>
              </div>
            )}
          </div>
          <div className="kpi-p-pillrow">
            <span className={`kpi-p-pill ${d.pillTone}`}><i />{d.pillLabel}</span>
            {d.showFinalPill && <span className="kpi-p-pill n"><i />Final</span>}
            {d.showProvisionalPill && <span className="kpi-p-pill n"><i />Provisional</span>}
          </div>
        </div>

        <div className="kpi-p-mf-lhero">
          <span className="kpi-p-label">
            {d.leftHeroLabel}
            <span className="kpi-p-mf-lhero-code"> · {d.leftHeroCodeSubtitle}</span>
          </span>
          <span className="kpi-p-hero num">{d.leftHeroValueText}</span>
        </div>

        <div className="kpi-p-mf-cats">
          {d.categoryRows.map((r, i) => (
            <div
              key={`${r.gl_line_code || 'tail'}-${i}`}
              className={`kpi-p-mf-cat${r.isTail ? ' kpi-p-mf-cat-tail' : ''}${r.isFunMoney ? ' kpi-p-mf-cat-fun' : ''}`}
            >
              <span className="kpi-p-mf-cat-k">
                {r.label}
                {r.gl_line_code && !r.isTail && (
                  <small>{r.gl_line_code}</small>
                )}
              </span>
              <span className={`kpi-p-mf-cat-v num${r.stateClass ? ` ${r.stateClass}` : ''}`}>
                {r.valueText}
              </span>
              <span className="kpi-p-mf-cat-p num">
                {/* Fun money carries "of $Y · Z% used" instead of the
                    share%.  The verdict colour is on the value; the
                    caption is neutral (small, grey) so the row still
                    fits the row-cell vocabulary. */}
                {r.isFunMoney ? r.captionText : r.shareText}
              </span>
            </div>
          ))}
        </div>

        {d.showPendingRow && (
          <div className="kpi-p-mf-pending">
            <span className="kpi-p-mf-cat-k">
              Card spend not yet coded
              <small>headed for 13xx or 3200.2</small>
            </span>
            <span className="kpi-p-mf-cat-v num a">{d.pendingValueText}</span>
          </div>
        )}
      </div>

      {/* ─── RIGHT PANE: the year, FYTD-anchored ─────────────────── */}
      <div className="kpi-p-mf-pane kpi-p-mf-pane-r">
        <div className="kpi-p-head">
          <div className="kpi-p-head-body">
            <span className="kpi-p-cardtitle kpi-p-ct-mf">
              The year
              {" "}<HelpPop id="qMgmtFeeYear" title="The year" body={RIGHT_BODY} />
            </span>
            <span className="kpi-p-cardsub">FY2026</span>
          </div>
          <div className="kpi-p-pillrow">
            <span className="kpi-p-mf-badge">Management fee</span>
          </div>
        </div>

        {d.rightHeroLabel && (
          <div className="kpi-p-mf-yhero">
            <span className="kpi-p-label">{d.rightHeroLabel}</span>
            <span className={`kpi-p-hero num ${d.rightHeroClass}`}>{d.rightHeroValueText}</span>
            <span className="kpi-p-mf-yhero-sub">
              <b>{d.rightSubSpentText}</b> spent of <b>{d.rightSubGoalText}</b>
              {d.rightTaxCaption && (
                <span className="kpi-p-mf-tax"> · {d.rightTaxCaption}</span>
              )}
            </span>
          </div>
        )}

        <div className="kpi-p-mf-track">
          <div className="kpi-p-mf-tbar" aria-hidden="true">
            <i
              className="kpi-p-mf-tbar-sp"
              style={{ width: `${(d.trackSpentFrac * 100).toFixed(2)}%` }}
            />
            {d.trackOverFrac > 0 && (
              <i
                className="kpi-p-mf-tbar-over"
                style={{
                  left:  `${(d.trackSpentFrac * 100).toFixed(2)}%`,
                  width: `${(d.trackOverFrac * 100).toFixed(2)}%`,
                }}
              />
            )}
            <span
              className="kpi-p-mf-tbar-cap"
              style={{ left: `${(d.goalMarkerFrac * 100).toFixed(2)}%` }}
              aria-hidden="true"
            />
            <span
              className="kpi-p-mf-tbar-yr"
              style={{ left: `${(d.yearMarkerFrac * 100).toFixed(2)}%` }}
              aria-hidden="true"
            />
          </div>
          <div className="kpi-p-mf-tmark">
            <span style={{ left: `${(d.yearMarkerFrac * 100).toFixed(2)}%` }}>
              {d.yearMarkerText}
            </span>
            <span
              className="kpi-p-mf-tmark-hi"
              style={{ left: `${((d.trackSpentFrac + d.trackOverFrac) * 100).toFixed(2)}%` }}
            >
              {d.spentMarkerText}
            </span>
          </div>
        </div>

        {d.sentenceText && (
          <p className="kpi-p-mf-sent">{d.sentenceText}</p>
        )}

        {d.miniBars.length > 0 && (
          <div className="kpi-p-mf-mini-wrap">
            <span className="kpi-p-label">
              Spend by period
              <span className="kpi-p-cardmeta"> · solid = above average</span>
            </span>
            <div className="kpi-p-mf-mini" role="img" aria-label="Per-period spend, above-average solid">
              <span
                className="kpi-p-mf-mini-avg"
                style={{ bottom: `${(d.miniAvgFrac * 100).toFixed(2)}%` }}
                aria-hidden="true"
              />
              {d.miniBars.map((b) => (
                <div key={b.periodNo} className="kpi-p-mf-mini-c">
                  <i
                    className={
                      b.isRunning ? "kpi-p-mf-mini-run"
                      : b.isAbove ? "kpi-p-mf-mini-hi"
                      : ""
                    }
                    style={{ height: `${b.heightPct.toFixed(2)}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="kpi-p-mf-mini-lab">
              {d.miniBars.map((b) => (
                <span key={`lab-${b.periodNo}`} className={b.isRunning ? "now" : ""}>
                  P{b.periodNo}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
