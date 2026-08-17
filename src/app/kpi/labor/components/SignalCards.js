"use client";
// src/app/kpi/labor/components/SignalCards.js
//
// V21-17..V21-24 - viz-led signal cards. Four cards, one grammar:
// header lane (eyebrow + state pill) then a centred content region.
// No action links (V21-17), no prose sentences (V21-18). Equal card
// heights (V21-19). Card-specific bodies:
//   V21-20 OVER / UNDER BUDGET : signed variance + diverging bar
//   V21-21 OVERTIME            : centred arc with % inside, threshold
//                                band remains (unlabeled) - geometry
//                                comes from ot config, never hardcoded
//   V21-22 HOURS VS BUDGET     : fraction + avg-rate pill + bullet
//   V21-23 PAYROLL DATA        : priced/total + tick row (cap 13 weeks)

import { fmt$, fmtHrs } from "../lib/formatting.js";

function StatePill({ label, tone = "neutral" }) {
  return <span className={`kpi-sig-state kpi-sig-state-${tone}`}>{label}</span>;
}

function Head({ eyebrow, stateLabel, stateTone }) {
  return (
    <div className="kpi-sig-head">
      <span className="kpi-sig-eyebrow">{eyebrow}</span>
      <StatePill label={stateLabel} tone={stateTone} />
    </div>
  );
}

// V21-20
function OverUnderCard({ board }) {
  const v = board?.variance;
  const budget = board?.period_budget || board?.range_budget;
  if (v == null || !budget) {
    return (
      <div className="kpi-sig">
        <Head eyebrow="OVER / UNDER BUDGET" stateLabel="—" stateTone="neutral" />
        <div className="kpi-sig-body">
          <div className="kpi-sig-v">—</div>
          <div className="kpi-sig-sub">no budget in range</div>
        </div>
      </div>
    );
  }
  const sign = v < 0 ? "UNDER" : v > 0 ? "OVER" : "ON BUDGET";
  const tone = v <= 0 ? "good" : (board.verdict === "watch" ? "warn" : board.verdict === "over" ? "bad" : "neutral");
  const leadCls = v <= 0 ? "kpi-sig-lead-good" : "";
  const scale = Math.min(1, Math.abs(v) / (budget * 0.6));
  const barPct = 50 * scale;
  const valCls = v <= 0 ? "kpi-sig-v-good" : (v > 0 && board.verdict === "over" ? "kpi-sig-v-bad" : "");
  return (
    <div className={`kpi-sig ${v <= 0 ? "kpi-sig-lead" : ""} ${leadCls}`}>
      <Head eyebrow="OVER / UNDER BUDGET" stateLabel={sign} stateTone={tone} />
      <div className="kpi-sig-body">
        <div className={`kpi-sig-v num ${valCls}`}>
          {v < 0 ? "-" : v > 0 ? "+" : ""}{fmt$(Math.abs(v))}
        </div>
        <div className="kpi-sig-sub">of a {fmt$(budget)} budget</div>
        <div className="kpi-sig-dvg" role="img" aria-label={`Variance ${fmt$(Math.abs(v))} ${sign.toLowerCase()}`}>
          <span className="kpi-sig-dvg-zero" />
          <span
            className={`kpi-sig-dvg-bar ${v > 0 ? "kpi-sig-dvg-bar-over" : ""}`}
            style={v <= 0 ? { right: "50%", width: `${barPct}%` } : { left: "50%", width: `${barPct}%` }}
          />
        </div>
        <div className="kpi-sig-vlab"><span>under</span><span className="mid">on budget</span><span>over</span></div>
      </div>
    </div>
  );
}

// V21-21 - OT arc becomes the centrepiece. Percent SET INSIDE. Amber
// threshold band remains, unlabeled. Band geometry comes from the
// server-config watch_pct/alarm_pct - never hardcoded.
function OvertimeCard({ board }) {
  const ot = board?.overtime;
  const hours = ot?.hours ?? 0;
  const pct = ot?.pct ?? 0;
  const watch = ot?.watch_pct;
  const alarm = ot?.alarm_pct;
  const state = ot?.state ?? "clear";
  const tone = state === "alarm" ? "bad" : state === "watch" ? "warn" : "neutral";
  const totalHrs = board?.hours ?? 0;
  // Gauge geometry lives in a 150x94 viewBox. Arc from angle 180 (left)
  // to 0 (right) with radius 58 centred at (75, 82). Watch band from
  // watchAngle -> alarmAngle (both derived from config).
  const angleToPoint = (angle) => {
    const rad = (angle * Math.PI) / 180;
    return { x: 75 + 58 * Math.cos(rad), y: 82 - 58 * Math.sin(rad) };
  };
  // Bounding domain: 0..20% maps to 180..0 (same as before).
  const pctToAngle = (p) => Math.max(0, 180 - Math.min(20, p) / 20 * 180);
  const watchAngle = pctToAngle(watch || 0);
  const alarmAngle = pctToAngle(alarm || 0);
  const valueAngle = pctToAngle(pct);
  const start = angleToPoint(180);
  const end = angleToPoint(0);
  const wStart = angleToPoint(watchAngle);
  const wEnd = angleToPoint(alarmAngle);
  const vPoint = angleToPoint(valueAngle);
  const arcColor = state === "alarm" ? "var(--red-700)"
                 : state === "watch" ? "var(--amber-600)"
                 : "var(--green-500)";
  return (
    <div className="kpi-sig">
      <Head eyebrow="OVERTIME" stateLabel={state === "clear" ? "CLEAR" : state === "watch" ? "WATCH" : "ALARM"} stateTone={tone} />
      <div className="kpi-sig-body">
        <svg className="kpi-sig-gauge2" viewBox="0 0 150 94" aria-label={`Overtime ${pct.toFixed(1)}%`}>
          <path d={`M${start.x} ${start.y} A58 58 0 0 1 ${end.x} ${end.y}`} fill="none" stroke="var(--n-200)" strokeWidth="12" strokeLinecap="round" />
          <path d={`M${wStart.x} ${wStart.y} A58 58 0 0 1 ${wEnd.x} ${wEnd.y}`} fill="none" stroke="var(--amber-100)" strokeWidth="12" strokeLinecap="round" />
          {pct > 0.01 && (
            <path d={`M${start.x} ${start.y} A58 58 0 0 1 ${vPoint.x} ${vPoint.y}`} fill="none" stroke={arcColor} strokeWidth="12" strokeLinecap="round" />
          )}
          <text x="75" y="76" textAnchor="middle" fontSize="24" fontWeight="800" fill="var(--n-900)">{pct.toFixed(1)}%</text>
        </svg>
        <div className="kpi-sig-sub">{fmtHrs(hours)} OT hrs of {fmtHrs(totalHrs)} worked</div>
      </div>
    </div>
  );
}

// V21-22 - fraction, avg rate pill, bullet track.
function HoursVsBudgetCard({ board }) {
  const h = board?.hours_vs_budget;
  const worked = h?.worked ?? 0;
  const budgeted = h?.budgeted;
  const pct = h?.pct;
  const elapsedPct = board?.elapsed_pct;
  const avg = board?.avg_rate;
  if (budgeted == null) {
    return (
      <div className="kpi-sig">
        <Head eyebrow="HOURS VS BUDGET" stateLabel="—" stateTone="neutral" />
        <div className="kpi-sig-body">
          <div className="kpi-sig-v num">{fmtHrs(worked)}</div>
          <div className="kpi-sig-sub">no budgeted-hours estimate</div>
        </div>
      </div>
    );
  }
  const barPct = Math.max(0, Math.min(100, pct || 0));
  const markPct = elapsedPct != null ? Math.max(0, Math.min(100, elapsedPct)) : null;
  return (
    <div className="kpi-sig">
      <Head eyebrow="HOURS VS BUDGET" stateLabel="ON PACE" stateTone="neutral" />
      <div className="kpi-sig-body">
        <div className="kpi-sig-frac num">
          <span className="kpi-sig-frac-n">{Math.round(worked)}</span>
          <span className="kpi-sig-frac-of">of</span>
          <span className="kpi-sig-frac-d">{budgeted}</span>
        </div>
        <div className="kpi-sig-sub">budgeted hours used</div>
        {avg != null && <div className="kpi-sig-pill">avg rate <b>${avg.toFixed(2)}/hr</b></div>}
        <div className="kpi-sig-bullet" role="img" aria-label={`Hours ${barPct.toFixed(0)}% of budgeted`}>
          <span className="kpi-sig-bullet-f" style={{ width: `${barPct}%` }} />
          {markPct != null && <span className="kpi-sig-bullet-m" style={{ left: `${markPct}%` }} />}
        </div>
      </div>
    </div>
  );
}

// V21-23 - priced-of-total + tick row. Ticks omitted above 13 weeks.
function PayrollDataCard({ board }) {
  const pd = board?.payroll_data;
  const priced = pd?.priced_ww ?? 0;
  const total = pd?.total_ww ?? 0;
  const state = total === 0 ? "—"
              : priced === total ? "FINAL"
              : "PARTIAL";
  const tone = state === "PARTIAL" ? "warn" : "neutral";
  const weeks = board?.weeks || [];
  const weeksCount = weeks.length;
  const showTicks = weeksCount > 0 && weeksCount <= 13;
  const tickPriced = weeks.map(w => (w.complete_ww === w.total_ww && w.total_ww > 0));
  return (
    <div className="kpi-sig">
      <Head eyebrow="PAYROLL DATA" stateLabel={state} stateTone={tone} />
      <div className="kpi-sig-body">
        <div className="kpi-sig-v num">{priced} of {total}</div>
        <div className="kpi-sig-sub">worker-weeks priced</div>
        {showTicks && (
          <div
            className="kpi-sig-ticks"
            style={{ gridTemplateColumns: `repeat(${weeksCount}, minmax(0, 1fr))` }}
            role="img"
            aria-label={`${priced} of ${weeksCount} weeks priced`}
          >
            {tickPriced.map((on, i) => (
              <span key={i} className={`kpi-sig-tick ${on ? "kpi-sig-tick-on" : ""}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function SignalCards({ board }) {
  if (!board || board.applies === false) return null;
  return (
    <div className="kpi-sigs">
      <OverUnderCard board={board} />
      <OvertimeCard board={board} />
      <HoursVsBudgetCard board={board} />
      <PayrollDataCard board={board} />
    </div>
  );
}
