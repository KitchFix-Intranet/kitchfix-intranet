"use client";
// src/app/kpi/purchasing/components/PeriodCard.js
//
// Row 1 of the at-risk board (spec §6.1).
//
// Left half:
//   Card title       "Period N · MM/DD - MM/DD"
//   Meta             "week X of 4 · N% elapsed" / "closed"
//   Pill + Provisional/Final
//   Hero             Spent (KPI line: food + packaging + vehicle)
//   Secondary        Remaining (open) / Vs budget (closed)
//   Sub rows         Bills · Cards · Pending · Projected close (open)
//                    Actual · Budget · Variance (closed)
//
// Right half:
//   Week chart of the KPI line only (§4.1). Equipment + R&M stay off
//   this card and off its chart.
//
// EVERY reading pill / hero / chart comes from a single stateOf() call
// downstream of resolveCardState(). §9B one-source rule.

import { Pill, FinalPill, ProvisionalPill } from "./Pill";
import { WeekChart } from "./WeekChart";
import { fmt$, fmtPct, moneyArrow, resolveCardState } from "../lib/board";

export function PeriodCard({
  periodNo,
  rangeLabel,       // "07/13/26 - 08/09/26"
  weekOfPeriod,     // 1..4 (null when the range is closed or multi-period)
  elapsedFrac,      // 0..1
  closed,
  provisional,
  // Money
  spent,            // KPI-line spent (bills + coded cards)
  budget,           // KPI-line budget
  bills,            // KPI-line bills only
  cards,            // KPI-line coded card spend
  pending,          // whole-range pending (no bucket split)
  // Chart
  weekAmounts,      // [w1, w2, w3, w4] KPI-line spend per fiscal week
  weekLabels,       // [{date}, ...]
  runningWeekIdx,   // 0..3 running week index, null when closed
  original,
  adjusted,
  projectedClose,
}) {
  // ONE stateOf call - pill / hero / chart / secondary all read from it.
  const cs = resolveCardState({
    spent: Number(spent || 0) + Number(pending || 0),
    budget: Number(budget || 0),
    elapsedFrac,
    hasBills: Number(spent || 0) + Number(pending || 0) > 0,
    closed,
  });

  const rem = Number(budget || 0) - Number(spent || 0) - Number(pending || 0);
  const showOverArrow = rem < 0;
  const varz = Number(spent || 0) - Number(budget || 0);   // closed variance

  const spentUsed = Number(budget || 0) > 0 ? Number(spent || 0) / Number(budget || 0) : null;

  return (
    <div className="kpi-p-row" data-card="period">
      {/* LEFT */}
      <div className="kpi-p-card kpi-p-b-per">
        <div className="kpi-p-head">
          <div className="kpi-p-head-body">
            <span className="kpi-p-cardtitle">Period {periodNo != null ? periodNo : "-"}</span>
            {rangeLabel && <span className="kpi-p-cardsub">{rangeLabel}</span>}
            <div>
              <span className="kpi-p-cardmeta">
                {closed
                  ? "4 of 4 weeks · "
                  : (weekOfPeriod ? `week ${weekOfPeriod} of 4 · ` : "")}
              </span>
              <span
                style={{
                  fontSize: "var(--kpi-t-body)",
                  fontWeight: 800,
                  color: "var(--navy-700)",
                }}
              >
                {closed
                  ? "closed"
                  : (elapsedFrac != null ? `${(elapsedFrac * 100).toFixed(0)}% elapsed` : "in progress")}
              </span>
            </div>
          </div>
          <div className="kpi-p-pillrow">
            <Pill tone={cs.pillTone} label={cs.pillLabel} />
            {closed ? <FinalPill label="Final" /> : (provisional ? <ProvisionalPill /> : null)}
          </div>
        </div>

        <div className="kpi-p-nums">
          <div className="kpi-p-stk">
            <span className="kpi-p-label">Spent</span>
            <span className={`kpi-p-hero num ${cs.heroClass}`}>{fmt$(spent)}</span>
            <span className="kpi-p-subline">
              of <b>{fmt$(budget)}</b>
              {spentUsed != null && (
                <>
                  {" "}· <b>{fmtPct(spentUsed)}</b> used
                </>
              )}
            </span>
          </div>
          <div className="kpi-p-stk">
            <span className="kpi-p-label">{closed ? "Vs budget" : "Remaining"}</span>
            {closed ? (
              <span className={`kpi-p-value num ${varz > 0 ? "r" : "g"}`}>{moneyArrow(varz)}</span>
            ) : (
              <span className={`kpi-p-value num ${showOverArrow ? "r" : "b"}`}>
                {showOverArrow ? moneyArrow(-rem) : fmt$(rem)}
              </span>
            )}
            <span className="kpi-p-subline">
              {closed ? "period closed" : "net of pending"}
            </span>
          </div>
        </div>

        <div className="kpi-p-subs">
          {closed ? (
            <>
              <div className="kpi-p-sub">
                <span className="kpi-p-k">Actual<small>as closed on the P&amp;L</small></span>
                <span className="kpi-p-v num">{fmt$(spent)}</span>
                <span className="kpi-p-x" aria-hidden="true" />
              </div>
              <div className="kpi-p-sub">
                <span className="kpi-p-k">Budget<small>FY2026 plan</small></span>
                <span className="kpi-p-v num">{fmt$(budget)}</span>
                <span className="kpi-p-x" aria-hidden="true" />
              </div>
              <div className="kpi-p-sub">
                <span className="kpi-p-k">Variance<small>actual less budget</small></span>
                <span className={`kpi-p-v num ${varz > 0 ? "r" : "g"}`}>{fmt$(Math.abs(varz))}</span>
                <span className={`kpi-p-x ${varz > 0 ? "r" : "g"}`}>{varz > 0 ? "over" : "under"}</span>
              </div>
            </>
          ) : (
            <>
              <div className="kpi-p-sub">
                <span className="kpi-p-k">Bills<small>entered in bill.com</small></span>
                <span className="kpi-p-v num">{fmt$(bills)}</span>
                <span className="kpi-p-x">at least</span>
              </div>
              <div className="kpi-p-sub">
                <span className="kpi-p-k">Cards<small>coded to a P&amp;L line</small></span>
                <span className="kpi-p-v num">{fmt$(cards)}</span>
                <span className="kpi-p-x" aria-hidden="true" />
              </div>
              <div className="kpi-p-sub">
                <span className="kpi-p-k">Pending<small>card · not yet coded</small></span>
                <span className="kpi-p-v num a">{fmt$(pending)}</span>
                <span className="kpi-p-x a">not on a P&amp;L line</span>
              </div>
              {projectedClose != null && (
                <div className="kpi-p-sub">
                  <span className="kpi-p-k">Projected close<small>if this pace holds</small></span>
                  <span className={`kpi-p-v num ${projectedClose > Number(budget || 0) ? "r" : ""}`}>
                    {fmt$(projectedClose)}
                  </span>
                  <span className={`kpi-p-x ${projectedClose > Number(budget || 0) ? "r" : "g"}`}>
                    {projectedClose > Number(budget || 0) ? "▲ " : "▼ "}
                    {fmt$(Math.abs(projectedClose - Number(budget || 0)))}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* RIGHT */}
      <div className="kpi-p-card">
        <div className="kpi-p-lh">
          <span className="kpi-p-label">By week</span>
          <span className="kpi-p-legs">
            {original != null && (
              <span className="kpi-p-leg orig">
                <span className="kpi-p-dash" aria-hidden="true" />
                target {fmt$(original)}
              </span>
            )}
            {!closed && adjusted != null && (
              <span className="kpi-p-leg adj">
                <span className="kpi-p-dash" aria-hidden="true" />
                adjusted {fmt$(adjusted)}
              </span>
            )}
            <span
              className="kpi-p-cardmeta"
              style={{ marginLeft: "auto" }}
            >
              food + packaging + vehicle
            </span>
          </span>
        </div>
        <WeekChart
          weekAmounts={weekAmounts}
          weekLabels={weekLabels}
          original={original}
          adjusted={adjusted}
          identity="food"
          state={cs.state}
          closed={closed}
          runningWeekIdx={runningWeekIdx}
        />
      </div>
    </div>
  );
}
