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
// over-goal on billed back is amber (notable, not a loss); under green; on/na neutral.
const TONE_FOOT = { over: "kpi-ov-foot-warn", under: "kpi-ov-foot-good", on: "", na: "" };

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
  const footToneCls = TONE_FOOT[ytd.tone] || "";
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
      <div className="kpi-ov-cb">
        <div className="kpi-ov-pair" data-kpi-ov="billback-actual-to-date">
          <span className="kpi-ov-pair-k">
            {through_period ? `Billed back · thru P${through_period}` : "Billed back"}
          </span>
          <span className="kpi-ov-pair-v kpi-ov-num kpi-ov-bb-lead">{fmtMoney(ytd.actual_to_date)}</span>
        </div>
        <div className="kpi-ov-pair-rule" aria-hidden="true" />
        <div className="kpi-ov-pair kpi-ov-pair-ref" data-kpi-ov="billback-goal-to-date">
          <span className="kpi-ov-pair-k">Goal to date</span>
          <span className="kpi-ov-pair-v kpi-ov-num">
            {fmtMoney(ytd.goal_to_date)}
            <span className="kpi-ov-pair-sub">of {fmtMoney(annual_goal)}</span>
          </span>
        </div>
        <div className={`kpi-ov-foot ${footToneCls}`} data-kpi-ov="billback-vs-goal">
          <span className="kpi-ov-foot-k">Vs goal</span>
          <span className="kpi-ov-foot-v">
            {arrow ? <span aria-hidden="true">{arrow} </span> : null}{fmtMoney(Math.abs(ytd.delta))}
          </span>
        </div>
        {Array.isArray(breakdown) && breakdown.length > 0 && (
          <div className="kpi-ov-bb-brk" data-kpi-ov="billback-breakdown">
            {breakdown.map((b, i) => (
              <span key={b.label} data-kpi-ov-stray={b.stray ? "1" : "0"}>
                {i > 0 && <span className="kpi-ov-bb-brk-sep"> · </span>}
                <span className={b.stray ? "kpi-ov-bb-brk-stray" : undefined}>
                  <b>{fmtMoney(b.amount)}</b> {b.label}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
