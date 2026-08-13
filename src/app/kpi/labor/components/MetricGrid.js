"use client";
// src/app/kpi/labor/components/MetricGrid.js
//
// D2 P5 (grid half) - eight cards, two rows (BUDGET · HOURS). F10/F17
// resolved: existing 8-card grid retained with consistency pass -
// equal-height cards, two-line reserved captions.
//
// kpi-2 · Budget / Over-under / Pace cards now consume the range
// budget derived from budget_periods (Playbook 4.5 supersede-over-P&L).
// Envelope mode (TXR - TX - V per 4.6) dashes those three cards with
// "envelope-based" so nothing implies a static budget exists.
// Static + no-budget-loaded (missing periods entirely) dashes with
// "no budget loaded" - the existing budget > 0 gate hides the varpill.
// The K9 "illustrative" copy has been retired from every card caption
// and hover title on this surface.

import { fmt$, fmtHrs } from "../lib/formatting";
import {
  budgetForRange,
  elapsedPct,
  presetSuffix,
} from "../lib/budgets";

export function MetricGrid({
  account,
  totals,          // { hours_regular, hours_overtime, hours_double_time, amount, hours_without_dollars }
  weekCount,
  lastPreset,
  start,
  end,
  today,
  currentPeriodNo,
  budgetPeriods,   // from labor route
  budgetMode,      // 'static' | 'envelope'
}) {
  const r = Number(totals?.hours_regular || 0);
  const o = Number(totals?.hours_overtime || 0);
  const h = Number(totals?.hours_double_time || 0);
  const nd = Number(totals?.hours_without_dollars || 0);
  const dollars = Number(totals?.amount || 0);

  const worked = r + o + h;
  const avg = worked > 0 ? dollars / worked : 0;
  const isEnvelope = budgetMode === "envelope";
  const budget = isEnvelope ? 0 : budgetForRange(budgetPeriods, start, end);
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

  // Budget-card copy varies by mode:
  //   envelope       -> "envelope-based"
  //   static, budget -> "FY2026 budget"
  //   static, none   -> "no budget loaded"
  const budgetCaption = isEnvelope
    ? "envelope-based"
    : budget > 0
      ? "FY2026 budget"
      : "no budget loaded";

  const overCaption = isEnvelope ? "envelope-based" : "priced dollars vs budget";
  const paceCaption = isEnvelope
    ? "envelope-based"
    : budget > 0
      ? `of budget · ${elapsed.toFixed(0)}% elapsed`
      : "no budget";

  return (
    <>
      <div className="kpi-metgrp">Budget</div>
      <div className="kpi-mets">
        <div className="kpi-met">
          <div className="kpi-met-l">Budget{suffix}</div>
          <div className="kpi-met-v kpi-mono">{isEnvelope || budget <= 0 ? dash : fmt$(budget)}</div>
          <div className="kpi-met-m">{budgetCaption}</div>
        </div>
        <div className="kpi-met">
          <div className="kpi-met-l">Over / under</div>
          <div className="kpi-met-v kpi-mono" style={{ color: !isEnvelope && budget > 0 ? (over > 0.004 ? "var(--red-600)" : "var(--green-800)") : undefined }}>
            {isEnvelope || budget <= 0 ? dash : `${over > 0.004 ? "+" : "-"}${fmt$(Math.abs(over))}`}
          </div>
          <div className="kpi-met-m">{overCaption}</div>
        </div>
        <div className="kpi-met">
          <div className="kpi-met-l">Pace</div>
          <div className={`kpi-met-v kpi-mono ${paceBad ? "warn" : ""}`}>
            {isEnvelope || budget <= 0 ? dash : `${pace.toFixed(0)}%`}
          </div>
          <div className="kpi-met-m">{paceCaption}</div>
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
          <div className="kpi-met-m">{budHrs > 0 ? `@ ${fmt$(avg)}/hr avg rate` : (isEnvelope ? "envelope-based" : "no budget")}</div>
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
