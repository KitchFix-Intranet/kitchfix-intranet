"use client";
// src/app/kpi/overview/components/BillbackPeriodCard.js
//
// Kevin ruling 2026-10-12. Single-period face of the billed-back card.
// On management-fee accounts, a closed single period renders this in the
// split-right slot where Current Year renders <BillbackCard> and non-MF
// renders <Chart>. Mirrors Direction A, scoped to the one period, fed by
// the billback_period payload (same source as the purchasing fold's goal
// row, so the two always agree). No by-type breakdown (that period's
// by-type detail is in the purchasing fold below). Tone: over amber
// (pass-through, notable not a loss), under green, on/na neutral.

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
const TONE_FOOT = { over: "kpi-ov-foot-warn", under: "kpi-ov-foot-good", on: "", na: "" };

const BILLBACK_HELP = (
  <>
    <p>Reimbursable spend the club pays back for this period, against the period&rsquo;s share of the annual <b>goal</b> (allocated by projected meal count).</p>
    <p>This is a <b>goal</b>, not a budget. Over-goal means the club reimburses more than planned - notable, not a loss, since reimbursables are pass-through.</p>
  </>
);

export default function BillbackPeriodCard({ billbackPeriod }) {
  const bb = billbackPeriod;
  if (!bb) return null;

  const header = (pill) => (
    <div className="kpi-ov-ch">
      <span className="kpi-ov-eb">Billed back to club</span>
      <span className="kpi-ov-gl">P{bb.period_no} · goal, not budget</span>
      <HelpPop id="qBillbackPeriodCard" title="Billed back to club" body={BILLBACK_HELP} />
      {pill}
    </div>
  );

  // Pre-season period: reimbursables roll into the first goaled period.
  if (bb.state === "pre_season") {
    return (
      <div className="kpi-ov-card kpi-ov-card-bb kpi-ov-mt" data-kpi-ov="billback-period" data-kpi-ov-state="pre-season">
        {header(null)}
        <div className="kpi-ov-cb kpi-ov-bb-nogoal">
          Pre-season · reimbursable spend here rolls into P{bb.first_goal_period}&rsquo;s billed-back goal.
        </div>
      </div>
    );
  }
  if (bb.goal == null) {
    return (
      <div className="kpi-ov-card kpi-ov-card-bb kpi-ov-mt" data-kpi-ov="billback-period" data-kpi-ov-state="no-goal">
        {header(null)}
        <div className="kpi-ov-cb kpi-ov-bb-nogoal">No billed-back goal for this period.</div>
      </div>
    );
  }

  const pillCls = TONE_PILL[bb.tone] || "kpi-ov-pill-neutral";
  const footToneCls = TONE_FOOT[bb.tone] || "";
  const running = bb.state === "in_progress";
  const notStarted = bb.state === "not_started";
  const incomplete = running || notStarted;
  const arrow = bb.delta > 0 ? "▲" : bb.delta < 0 ? "▼" : "";

  const pill = incomplete
    ? null
    : <span className={`kpi-ov-pill ${pillCls}`} data-kpi-ov="billback-period-pill" data-kpi-ov-tone={bb.tone}>{fmtPctWhole(bb.pct)} of goal</span>;

  return (
    <div className="kpi-ov-card kpi-ov-card-bb kpi-ov-mt" data-kpi-ov="billback-period" data-kpi-ov-state="has-goal">
      {header(pill)}
      <div className="kpi-ov-cb">
        <div className="kpi-ov-pair" data-kpi-ov="billback-period-actual">
          <span className="kpi-ov-pair-k">Billed back · P{bb.period_no}{running ? " so far" : ""}</span>
          <span className="kpi-ov-pair-v kpi-ov-num kpi-ov-bb-lead">{fmtMoney(bb.actual)}</span>
        </div>
        <div className="kpi-ov-pair-rule" aria-hidden="true" />
        <div className="kpi-ov-pair kpi-ov-pair-ref" data-kpi-ov="billback-period-goal">
          <span className="kpi-ov-pair-k">P{bb.period_no} goal</span>
          <span className="kpi-ov-pair-v kpi-ov-num">{fmtMoney(bb.goal)}</span>
        </div>
        {incomplete ? (
          <div className="kpi-ov-foot">
            <span className="kpi-ov-foot-k">Vs goal</span>
            <span className="kpi-ov-foot-v kpi-ov-bb-soft">{running ? "period in progress" : "not started"}</span>
          </div>
        ) : (
          <div className={`kpi-ov-foot ${footToneCls}`} data-kpi-ov="billback-period-vs">
            <span className="kpi-ov-foot-k">Vs goal</span>
            <span className="kpi-ov-foot-v">{arrow ? <span aria-hidden="true">{arrow} </span> : null}{fmtMoney(Math.abs(bb.delta))}</span>
          </div>
        )}
        {bb.is_first_goal_period && bb.pre_season_amount > 0.005 && (
          <div className="kpi-ov-bb-sub">
            Billed back includes {fmtMoney(bb.pre_season_amount)} pre-season reimbursables (P1&ndash;P{bb.first_goal_period - 1}); it exceeds this period&rsquo;s transactions below by that amount, matching the Current-Year ledger.
          </div>
        )}
      </div>
    </div>
  );
}
