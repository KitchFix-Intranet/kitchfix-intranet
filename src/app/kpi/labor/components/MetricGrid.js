"use client";
// src/app/kpi/labor/components/MetricGrid.js
//
// D2 P5 (grid half) - eight cards, two rows (BUDGET · HOURS). F10/F17
// resolved: existing 8-card grid retained with consistency pass -
// equal-height cards, two-line reserved captions.
//
// Estimate discipline (+c doctrine): estimates render with `~` prefix
// and distinct weight, rate in caption, never in a Dollars column,
// never summed into totals (D27).

import { fmt$, fmtHrs } from "../lib/formatting";
import { budgetForRange, elapsedPct, presetSuffix } from "../lib/budgets";

export function MetricGrid({
  account,
  totals,          // { hours_regular, hours_overtime, hours_double_time, amount, hours_without_dollars }
  weekCount,
  lastPreset,
  start,
  end,
  today,
  currentPeriodNo,
}) {
  const r = Number(totals?.hours_regular || 0);
  const o = Number(totals?.hours_overtime || 0);
  const h = Number(totals?.hours_double_time || 0);
  const nd = Number(totals?.hours_without_dollars || 0);
  const dollars = Number(totals?.amount || 0);

  const worked = r + o + h;
  const avg = worked > 0 ? dollars / worked : 0;
  const budget = budgetForRange(account, weekCount);
  const over = dollars - budget;
  const pace = budget > 0 ? (dollars / budget) * 100 : 0;
  const elapsed = elapsedPct(start, end, today);
  const paceBad = budget > 0 && pace > elapsed + 2;
  const budHrs = avg > 0 ? budget / avg : 0;
  const estUnpriced = nd * avg;
  const otShare = worked > 0 ? (o / worked) * 100 : 0;
  const otWarn = worked > 0 && (o / worked) > 0.12;

  const suffix = presetSuffix(lastPreset, start, end, currentPeriodNo);

  const dash = <span className="kpi-dash">—</span>;

  return (
    <>
      <div className="kpi-metgrp">Budget</div>
      <div className="kpi-mets">
        <div className="kpi-met">
          <div className="kpi-met-l">Budget{suffix}</div>
          <div className="kpi-met-v kpi-mono">{budget > 0 ? fmt$(budget) : dash}</div>
          <div className="kpi-met-m">illustrative until real budgets load</div>
        </div>
        <div className="kpi-met">
          <div className="kpi-met-l">Over / under</div>
          <div className="kpi-met-v kpi-mono" style={{ color: over > 0.004 ? "var(--red-600)" : "var(--green-800)" }}>
            {budget > 0 ? (over > 0.004 ? "+" : "-") : ""}{budget > 0 ? fmt$(Math.abs(over)) : "—"}
          </div>
          <div className="kpi-met-m">priced dollars vs budget · illustrative</div>
        </div>
        <div className="kpi-met">
          <div className="kpi-met-l">Pace</div>
          <div className={`kpi-met-v kpi-mono ${paceBad ? "warn" : ""}`}>
            {budget > 0 ? `${pace.toFixed(0)}%` : "—"}
          </div>
          <div className="kpi-met-m">
            {budget > 0 ? `of budget · ${elapsed.toFixed(0)}% elapsed` : "no budget · illustrative"}
          </div>
        </div>
        <div className="kpi-met">
          <div className="kpi-met-l">Est. unpriced total</div>
          <div className="kpi-met-v kpi-mono kpi-est">
            {nd > 0.004 ? `~${fmt$(estUnpriced)}` : dash}
          </div>
          <div className="kpi-met-m">
            {nd > 0.004 ? `${fmtHrs(nd)} hrs × ${fmt$(avg)}/hr avg · estimate, never summed` : "nothing unpriced"}
          </div>
        </div>
      </div>

      <div className="kpi-metgrp">Hours</div>
      <div className="kpi-mets">
        <div className="kpi-met">
          <div className="kpi-met-l">Total hours</div>
          <div className="kpi-met-v kpi-mono">{fmtHrs(Math.round(worked * 100) / 100)}</div>
          <div className="kpi-met-m">{nd > 0.004 ? `+ ${fmtHrs(nd)} unpriced known` : "all priced"}</div>
        </div>
        <div className="kpi-met">
          <div className="kpi-met-l">Budget in hours</div>
          <div className="kpi-met-v kpi-mono">{budHrs > 0 ? fmtHrs(Math.round(budHrs * 100) / 100) : dash}</div>
          <div className="kpi-met-m">@ {fmt$(avg)}/hr avg rate</div>
        </div>
        <div className="kpi-met">
          <div className="kpi-met-l">Overtime</div>
          <div className={`kpi-met-v kpi-mono ${otWarn ? "warn" : ""}`}>{fmtHrs(Math.round(o * 100) / 100)}</div>
          <div className="kpi-met-m">{otShare.toFixed(1)}% of worked hours</div>
        </div>
        <div className="kpi-met">
          <div className="kpi-met-l">Unpriced hours</div>
          <div className={`kpi-met-v kpi-mono ${nd > 0.004 ? "warn" : ""}`}>{fmtHrs(Math.round(nd * 100) / 100)}</div>
          <div className="kpi-met-m">{nd > 0.004 ? "known hours, no dollar path yet" : "none in range"}</div>
        </div>
      </div>
    </>
  );
}
