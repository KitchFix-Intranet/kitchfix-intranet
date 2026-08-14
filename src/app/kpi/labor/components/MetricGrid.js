"use client";
// src/app/kpi/labor/components/MetricGrid.js
//
// D2 P5 (grid half) - eight cards, two rows (BUDGET · HOURS). F10/F17
// resolved: existing 8-card grid retained with consistency pass -
// equal-height cards, two-line reserved captions.
//
// V6-11 - definition system. Cards get 1px --n-300 border,
// --card-shadow, hover lift (translateY(-1px) + card-shadow-hover;
// reduced-motion zeroes the transition, state stays). 3px top accent
// per row: BUDGET navy gradient, HOURS amber gradient. Section
// eyebrows: tinted BUDGET / HOURS chips + hairline rule to the right.
//
// V6-12 - `View: Numbers | Visual` segmented control on the BUDGET
// section row governs BOTH rows. Persisted (localStorage
// kpi.cardsView). Visual mode adds a compact viz under the primary
// number (number stays primary). Envelope + missing-budget suppress
// budget-family viz exactly as they suppress numbers.
//
// kpi-2 · Budget / Over-under / Pace cards consume the range budget
// derived from budget_periods (Playbook 4.5 supersede-over-P&L).
// Envelope mode (TXR - TX - V per 4.6) dashes those three cards
// with "envelope-based". Static + no-budget-loaded dashes with
// "no budget loaded".

import { useEffect, useState } from "react";
import { fmt$, fmtHrs } from "../lib/formatting";
import {
  budgetForRange,
  elapsedPct,
  presetSuffix,
} from "../lib/budgets";

const CARDS_VIEW_KEY = "kpi:labor:cardsView";

// V6-12 - viz primitives. All color+label+shape, never color alone.
// Inline SVG; no chart lib. Reduced-motion respected via CSS
// transition zero (handled globally at the media query).
function BulletBar({ pct, tickPct, tone }) {
  const cls = tone === "hours" ? "kpi-mvb kpi-mvb-h" : "kpi-mvb";
  const w = Math.max(0, Math.min(100, pct * 100));
  const tick = tickPct == null ? null : Math.max(0, Math.min(100, tickPct * 100));
  return (
    <div className={cls} role="img" aria-label={`${w.toFixed(0)}% of budget${tick != null ? `, ${tick.toFixed(0)}% elapsed` : ""}`}>
      <span className="kpi-mvb-fill" style={{ width: `${w}%` }} />
      {tick != null && <span className="kpi-mvb-tick" style={{ left: `${tick}%` }} />}
    </div>
  );
}
function DeltaBar({ pct, over }) {
  // pct = |over| / budget, capped for display. over=true -> right; false -> left.
  const w = Math.max(0, Math.min(50, pct * 50));
  const style = over
    ? { left: "50%", width: `${w}%`, background: "var(--red-500)" }
    : { right: "50%", width: `${w}%`, background: "var(--green-500)" };
  return (
    <div className="kpi-mvd" role="img" aria-label={over ? "over budget" : "under budget"}>
      <span className="kpi-mvd-zero" />
      <span className="kpi-mvd-bar" style={style} />
    </div>
  );
}
function Ring({ pct, tone, label }) {
  const r = 22, c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1.5, pct)));
  const stroke = tone === "hours" ? "var(--amber-600)" : "var(--kpi-accent-strong)";
  return (
    <svg className="kpi-mvring" viewBox="0 0 56 56" role="img" aria-label={label}>
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--n-200)" strokeWidth="7" />
      <circle cx="28" cy="28" r={r} fill="none" stroke={stroke} strokeWidth="7" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 28 28)" />
      <text x="28" y="32" textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--n-900)">{label}</text>
    </svg>
  );
}
function StackedBar({ segs, labelLeft, labelRight }) {
  // segs: [{ label, share, color }] shares sum to 1
  return (
    <div>
      <div className="kpi-mvstack" role="img" aria-label={segs.map(s => `${s.label} ${(s.share * 100).toFixed(1)}%`).join(", ")}>
        {segs.map((s, i) => s.share > 0 ? (
          <span key={i} title={`${s.label} ${(s.share * 100).toFixed(1)}%`}
            style={{ width: `${s.share * 100}%`, background: s.color }} />
        ) : null)}
      </div>
      {(labelLeft || labelRight) && (
        <div className="kpi-mvleg">
          <span>{labelLeft}</span><span>{labelRight}</span>
        </div>
      )}
    </div>
  );
}

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
  // V6-12 - segmented control state, persisted per user.
  const [viz, setViz] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v = window.localStorage.getItem(CARDS_VIEW_KEY);
      if (v === "1") setViz(true);
    } catch {}
  }, []);
  const setVizPersist = (next) => {
    setViz(next);
    try { if (typeof window !== "undefined") window.localStorage.setItem(CARDS_VIEW_KEY, next ? "1" : "0"); } catch {}
  };

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

  // Viz suppression mirrors the number suppression exactly.
  const showBudgetViz = viz && !isEnvelope && budget > 0;
  const showBudHrsViz = viz && budHrs > 0;

  return (
    <>
      {/* V6-11 - BUDGET section eyebrow + tinted chip + hairline + viz toggle */}
      <div className="kpi-metgrp-row">
        <span className="kpi-metgrp-tag kpi-metgrp-tag-budget">BUDGET</span>
        <span className="kpi-metgrp-rule" aria-hidden="true" />
        <span className="kpi-cardsview">
          View:
          <span className="kpi-seg" role="group" aria-label="Cards view">
            <button type="button" className={!viz ? "on" : ""} onClick={() => setVizPersist(false)} aria-pressed={!viz}>Numbers</button>
            <button type="button" className={viz ? "on" : ""} onClick={() => setVizPersist(true)} aria-pressed={viz}>Visual</button>
          </span>
        </span>
      </div>
      <div className="kpi-mets">
        <div className="kpi-met kpi-met-b">
          <div className="kpi-met-l">Budget{suffix}</div>
          <div className="kpi-met-v kpi-mono">{isEnvelope || budget <= 0 ? dash : fmt$(budget)}</div>
          <div className="kpi-met-m">{budgetCaption}</div>
          {showBudgetViz && (
            <div className="kpi-mviz">
              <BulletBar pct={dollars / budget} tickPct={elapsed / 100} tone="budget" />
              <div className="kpi-mvleg"><span>spent {fmt$(dollars)}</span><span>budget {fmt$(budget)}</span></div>
            </div>
          )}
        </div>
        <div className="kpi-met kpi-met-b">
          <div className="kpi-met-l">Over / under</div>
          <div className="kpi-met-v kpi-mono" style={{ color: !isEnvelope && budget > 0 ? (over > 0.004 ? "var(--red-600)" : "var(--green-800)") : undefined }}>
            {isEnvelope || budget <= 0 ? dash : `${over > 0.004 ? "+" : "-"}${fmt$(Math.abs(over))}`}
          </div>
          <div className="kpi-met-m">{overCaption}</div>
          {showBudgetViz && (
            <div className="kpi-mviz">
              <DeltaBar pct={Math.min(1, Math.abs(over) / budget)} over={over > 0.004} />
              <div className="kpi-mvleg"><span>under</span><span>over</span></div>
            </div>
          )}
        </div>
        <div className="kpi-met kpi-met-b">
          <div className="kpi-met-l">Pace</div>
          <div className={`kpi-met-v kpi-mono ${paceBad ? "warn" : ""}`}>
            {isEnvelope || budget <= 0 ? dash : `${pace.toFixed(0)}%`}
          </div>
          <div className="kpi-met-m">{paceCaption}</div>
          {showBudgetViz && (
            <div className="kpi-mviz">
              <Ring pct={pace / 100} tone="budget" label={`${pace.toFixed(0)}%`} />
            </div>
          )}
        </div>
        <div className="kpi-met kpi-met-b">
          <div className="kpi-met-l">Est. unpriced total</div>
          <div className="kpi-met-v kpi-mono kpi-est">
            {nd > 0.004 ? `~${fmt$(estUnpriced)}` : dash}
          </div>
          <div className="kpi-met-m">
            {nd > 0.004 ? `${fmtHrs(nd)} hrs × ${fmt$(avg)}/hr avg · estimate, never summed` : "nothing unpriced"}
          </div>
        </div>
      </div>

      <div className="kpi-metgrp-row">
        <span className="kpi-metgrp-tag kpi-metgrp-tag-hours">HOURS</span>
        <span className="kpi-metgrp-rule" aria-hidden="true" />
      </div>
      <div className="kpi-mets">
        <div className="kpi-met kpi-met-h">
          <div className="kpi-met-l">Total hours</div>
          <div className="kpi-met-v kpi-mono">{fmtHrs(Math.round(worked * 100) / 100)}</div>
          <div className="kpi-met-m">{nd > 0.004 ? `+ ${fmtHrs(nd)} unpriced known` : "all priced"}</div>
          {viz && worked > 0 && (
            <div className="kpi-mviz">
              <StackedBar
                segs={[
                  { label: "regular",    share: r / worked, color: "var(--n-500)" },
                  { label: "OT 1.5x",    share: o / worked, color: "var(--amber-600)" },
                  { label: "holiday 2x", share: h / worked, color: "var(--chart-hol)" },
                ]}
                labelLeft="regular"
                labelRight={o > 0.004 ? `OT ${fmtHrs(o)}` : "all regular"}
              />
            </div>
          )}
        </div>
        <div className="kpi-met kpi-met-h">
          <div className="kpi-met-l">Budget in hours</div>
          <div className="kpi-met-v kpi-mono">{budHrs > 0 ? fmtHrs(Math.round(budHrs * 100) / 100) : dash}</div>
          <div className="kpi-met-m">{budHrs > 0 ? `@ ${fmt$(avg)}/hr avg rate` : (isEnvelope ? "envelope-based" : "no budget")}</div>
          {showBudHrsViz && (
            <div className="kpi-mviz">
              <BulletBar pct={worked / budHrs} tone="hours" />
              <div className="kpi-mvleg"><span>worked {fmtHrs(worked)}</span><span>budget {fmtHrs(budHrs)}</span></div>
            </div>
          )}
        </div>
        <div className="kpi-met kpi-met-h">
          <div className="kpi-met-l">Overtime</div>
          <div className={`kpi-met-v kpi-mono ${otWarn ? "warn" : ""}`}>{fmtHrs(Math.round(o * 100) / 100)}</div>
          <div className="kpi-met-m">{otShare.toFixed(1)}% of worked hours</div>
          {viz && worked > 0 && (
            <div className="kpi-mviz">
              <Ring pct={o / worked} tone="hours" label={`${otShare.toFixed(1)}%`} />
            </div>
          )}
        </div>
        <div className="kpi-met kpi-met-h">
          <div className="kpi-met-l">Unpriced hours</div>
          <div className={`kpi-met-v kpi-mono ${nd > 0.004 ? "warn" : ""}`}>{fmtHrs(Math.round(nd * 100) / 100)}</div>
          <div className="kpi-met-m">{nd > 0.004 ? "known hours, no dollar path yet" : "none in range"}</div>
        </div>
      </div>
    </>
  );
}
