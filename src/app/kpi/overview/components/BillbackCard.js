"use client";
// src/app/kpi/overview/components/BillbackCard.js
//
// Kevin ruling 2026-10-09 (PR-billback-1). Management-fee + multi-
// period only. Replaces <Chart> in the Overview's split-right column
// for MF accounts; non-MF accounts keep the chart. Lives at the same
// slot so the surrounding grid math is unchanged.
//
// Payload contract (resolver §17a-bb):
//   data.billback === null                   -> render nothing
//   data.billback.annual_goal === null       -> "no goal set" state
//   data.billback has periods / ytd / etc.   -> full card
//
// Numbers arrive raw from the payload; the client only formats them
// for display and maps tone -> color. The server shipped tone (over /
// under / on / na) so the color choice has one definition in the
// system (billback.js).
//
// Tone -> color (billed-back is pass-through the club reimburses, so
// over-goal is "notable" not a loss - amber, not red):
//   over    -> amber   (kpi-ov-pill-warn / kpi-ov-bb-amber)
//   under   -> green   (kpi-ov-pill-good / kpi-ov-bb-good)
//   on / na -> neutral (kpi-ov-pill-neutral)

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

const TONE_PILL = { over: "kpi-ov-pill-warn", under: "kpi-ov-pill-good", on: "kpi-ov-pill-neutral", na: "kpi-ov-pill-neutral" };
const TONE_CELL = { over: "kpi-ov-bb-amber", under: "kpi-ov-bb-good", on: "kpi-ov-bb-neutral", na: "kpi-ov-bb-neutral" };

const BILLBACK_HELP = (
  <>
    <p>Reimbursable spend the club pays back. The annual <b>goal</b> comes from the contract, allocated across periods by projected meal count.</p>
    <p>This is a <b>goal</b>, not a budget. Over-goal means the club reimburses more than planned - notable, not a loss, since reimbursables are pass-through.</p>
  </>
);

export default function BillbackCard({ billback, revenueModel }) {
  // Hard gates. The resolver already handles these but the component
  // defends against callers that forgot to check.
  if (!billback) return null;
  if (revenueModel !== "management_fee") return null;

  const { annual_goal, fiscal_year, through_period, ytd, breakdown } = billback;

  // "No goal set" quiet state. Kevin ruling: never NaN, never zero-
  // as-goal. Card chrome still renders so the slot does not visually
  // collapse.
  if (annual_goal == null) {
    return (
      <div className="kpi-ov-card kpi-ov-card-bb kpi-ov-mt" data-kpi-ov="billback" data-kpi-ov-state="no-goal">
        <div className="kpi-ov-ch">
          <span className="kpi-ov-eb">Billed back to club</span>
          <span className="kpi-ov-gl">goal, not budget</span>
          <HelpPop id="qBillbackCard" title="Billed back to club" body={BILLBACK_HELP} />
        </div>
        <div className="kpi-ov-cb kpi-ov-bb-nogoal" data-kpi-ov="billback-no-goal">
          No billed-back goal set for FY{fiscal_year}.
        </div>
      </div>
    );
  }

  const pillCls = TONE_PILL[ytd.tone] || "kpi-ov-pill-neutral";
  const vsCellCls = TONE_CELL[ytd.tone] || "kpi-ov-bb-neutral";
  const arrow = ytd.delta > 0 ? "▲" : ytd.delta < 0 ? "▼" : "";

  return (
    <div className="kpi-ov-card kpi-ov-card-bb kpi-ov-mt" data-kpi-ov="billback" data-kpi-ov-state="has-goal">
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">Billed back to club</span>
        <span className="kpi-ov-gl">goal, not budget</span>
        <HelpPop id="qBillbackCard" title="Billed back to club" body={BILLBACK_HELP} />
        <span className={`kpi-ov-pill ${pillCls}`} data-kpi-ov="billback-pct-pill" data-kpi-ov-tone={ytd.tone}>
          {fmtPctWhole(ytd.pct_of_goal_to_date)} of goal
        </span>
      </div>
      <div className="kpi-ov-cb kpi-ov-bb-stats" data-kpi-ov="billback-stats">
        <div className="kpi-ov-bb-cell" data-kpi-ov="billback-actual-to-date">
          <div className="kpi-ov-bb-lbl">
            {through_period ? `Billed back · thru P${through_period}` : "Billed back"}
          </div>
          <div className="kpi-ov-bb-val">{fmtMoney(ytd.actual_to_date)}</div>
        </div>
        <div className="kpi-ov-bb-cell" data-kpi-ov="billback-goal-to-date">
          <div className="kpi-ov-bb-lbl">Goal to date</div>
          <div className="kpi-ov-bb-val">{fmtMoney(ytd.goal_to_date)}</div>
          <div className="kpi-ov-bb-sub">of {fmtMoney(annual_goal)} annual</div>
        </div>
        <div className={`kpi-ov-bb-cell ${vsCellCls}`} data-kpi-ov="billback-vs-goal">
          <div className="kpi-ov-bb-lbl">vs goal</div>
          <div className="kpi-ov-bb-val">
            <span className="kpi-ov-bb-arrow" aria-hidden="true">{arrow}</span>
            {fmtMoney(Math.abs(ytd.delta))}
          </div>
        </div>
        <div className="kpi-ov-bb-cell" data-kpi-ov="billback-annual-used">
          <div className="kpi-ov-bb-lbl">Annual goal used</div>
          <div className="kpi-ov-bb-val">{fmtPctWhole(ytd.pct_of_annual)}</div>
          <div className="kpi-ov-bb-sub">{fmtMoney(ytd.goal_remaining)} goal left</div>
        </div>
      </div>
      {Array.isArray(breakdown) && breakdown.length > 0 && (
        <div className="kpi-ov-bb-chips" data-kpi-ov="billback-breakdown">
          {breakdown.map(b => (
            <span
              key={b.label}
              className={`kpi-ov-bb-chip${b.stray ? " kpi-ov-bb-chip-stray" : ""}`}
              data-kpi-ov="billback-chip"
              data-kpi-ov-stray={b.stray ? "1" : "0"}
            >
              <span className="kpi-ov-bb-chip-lbl">{b.label}</span>
              <span className="kpi-ov-bb-chip-val">{fmtMoney(b.amount)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
