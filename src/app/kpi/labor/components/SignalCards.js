"use client";
// src/app/kpi/labor/components/SignalCards.js
//
// V8-13..V8-16 - four cards, one grammar, fixed lane heights, bottom-
// aligned. V8-15 color discipline: state pills are grey by default;
// color only appears on (a) the lead Over/Under card, (b) cards whose
// state is WATCH or worse. OT thresholds come from board.overtime
// (server config, not hardcoded strings).

import { fmt$, fmtHrs, fmtTimestamp } from "../lib/formatting.js";

function StatePill({ label, tone = "neutral" }) {
  return <span className={`kpi-sig-state kpi-sig-state-${tone}`}>{label}</span>;
}

function OverUnderCard({ board }) {
  const v = board?.variance;
  const budget = board?.period_budget || board?.range_budget;
  if (v == null || !budget) {
    return (
      <div className="kpi-sig">
        <div className="kpi-sig-st"><span>OVER / UNDER BUDGET</span><StatePill label="—" /></div>
        <div className="kpi-sig-v">—</div>
        <div className="kpi-sig-u">no budget in range</div>
        <div className="kpi-sig-sc">Variance cannot be computed without a period budget.</div>
        <div className="kpi-sig-vz" />
        <button type="button" className="kpi-sig-act">See budget by week ›</button>
      </div>
    );
  }
  const sign = v < 0 ? "under" : v > 0 ? "over" : "on budget";
  const tone = v <= 0 ? "good" : (board.verdict === "watch" ? "warn" : board.verdict === "over" ? "bad" : "neutral");
  const leadCls = v <= 0 ? "kpi-sig-lead-good" : "";
  // Diverging bar: center is the zero-line, bar extends left (under) or
  // right (over). Scale by |v| / (budget * 0.6) capped at 50% each side.
  const scale = Math.min(1, Math.abs(v) / (budget * 0.6));
  const barPct = 50 * scale;
  return (
    <div className={`kpi-sig ${v <= 0 ? "kpi-sig-lead" : ""} ${leadCls}`}>
      <div className="kpi-sig-st"><span>OVER / UNDER BUDGET</span><StatePill label={sign.toUpperCase()} tone={tone} /></div>
      <div className={`kpi-sig-v ${v <= 0 ? "kpi-sig-v-good" : v > 0 && board.verdict === "over" ? "kpi-sig-v-bad" : ""} num`}>
        {v < 0 ? "-" : v > 0 ? "+" : ""}{fmt$(Math.abs(v))}
      </div>
      <div className="kpi-sig-u">of the {fmt$(budget)} {board.period_no ? "period" : "range"} budget</div>
      <div className="kpi-sig-sc">
        {v < 0
          ? <><b>{fmt$(Math.abs(v))}</b> remains vs pace.</>
          : v > 0
            ? <><b>{fmt$(v)}</b> over pace to date.</>
            : <><b>On pace</b> against the {fmt$(budget)} budget.</>}
      </div>
      <div className="kpi-sig-vz">
        <span className="kpi-sig-vstack">
          <span className="kpi-sig-dvg" role="img" aria-label={`Variance ${fmt$(Math.abs(v))} ${sign}`}>
            <span className="kpi-sig-dvg-zero" />
            <span
              className={`kpi-sig-dvg-bar ${v > 0 ? "kpi-sig-dvg-bar-over" : ""}`}
              style={v <= 0 ? { right: "50%", width: `${barPct}%` } : { left: "50%", width: `${barPct}%` }}
            />
          </span>
          <span className="kpi-sig-vlab"><span>under</span><span className="mid">on budget</span><span>over</span></span>
        </span>
      </div>
      <button type="button" className="kpi-sig-act">See budget by week ›</button>
    </div>
  );
}

function OvertimeCard({ board }) {
  const ot = board?.overtime;
  const hours = ot?.hours ?? 0;
  const pct = ot?.pct ?? 0;
  const watch = ot?.watch_pct;
  const alarm = ot?.alarm_pct;
  const state = ot?.state ?? "clear";
  const tone = state === "alarm" ? "bad" : state === "watch" ? "warn" : "neutral";
  // Gauge geometry: 96x60 arc from angle 180 (left) to 0 (right).
  // Watch band spans from watchAngle -> 0. Value shown centered.
  const watchStartAngle = 180 - (watch / 20) * 180;
  const angleToPoint = (angle) => {
    const rad = (angle * Math.PI) / 180;
    return { x: 48 + 38 * Math.cos(rad), y: 52 - 38 * Math.sin(rad) };
  };
  const wStart = angleToPoint(watchStartAngle);
  const arcEnd = angleToPoint(0);
  const valueAngle = Math.max(0, 180 - Math.min(20, pct) / 20 * 180);
  const vPoint = angleToPoint(valueAngle);
  const vStart = angleToPoint(180);
  return (
    <div className="kpi-sig">
      <div className="kpi-sig-st"><span>OVERTIME</span><StatePill label={state === "clear" ? "CLEAR" : state === "watch" ? "WATCH" : "ALARM"} tone={tone} /></div>
      <div className="kpi-sig-v num">{fmtHrs(hours)}</div>
      <div className="kpi-sig-u">hrs · {pct.toFixed(1)}% of hours worked</div>
      <div className="kpi-sig-sc">
        {state === "clear"
          ? <>Nothing crossing the watch threshold this range.</>
          : state === "watch"
            ? <><b>OT rising</b> - past the watch line, below alarm.</>
            : <><b>OT alarm</b> - over the alarm threshold.</>}
      </div>
      <div className="kpi-sig-vz">
        <svg className="kpi-sig-gauge" viewBox="0 0 96 60" aria-label={`Overtime ${pct.toFixed(1)}%`}>
          <path d="M10 52 A38 38 0 0 1 86 52" fill="none" stroke="var(--n-200)" strokeWidth="9" strokeLinecap="round" />
          <path d={`M${wStart.x} ${wStart.y} A38 38 0 0 1 ${arcEnd.x} ${arcEnd.y}`} fill="none" stroke="var(--amber-100)" strokeWidth="9" strokeLinecap="round" />
          {pct > 0.01 && (
            <path d={`M${vStart.x} ${vStart.y} A38 38 0 0 1 ${vPoint.x} ${vPoint.y}`} fill="none" stroke={state === "alarm" ? "var(--red-700)" : state === "watch" ? "var(--amber-600)" : "var(--green-500)"} strokeWidth="9" strokeLinecap="round" />
          )}
          <text x="48" y="46" textAnchor="middle" fontSize="17" fontWeight="800" fill="var(--n-900)">{pct.toFixed(1)}%</text>
        </svg>
        <span className="kpi-sig-gcol">
          <span><b>{watch}%</b> watch</span>
          <span><b>{alarm}%</b> alarm</span>
        </span>
      </div>
      <button type="button" className="kpi-sig-act">See OT by worker ›</button>
    </div>
  );
}

function HoursVsBudgetCard({ board }) {
  const h = board?.hours_vs_budget;
  const worked = h?.worked ?? 0;
  const budgeted = h?.budgeted;
  const pct = h?.pct;
  const elapsedPct = board?.elapsed_pct;
  if (budgeted == null) {
    return (
      <div className="kpi-sig">
        <div className="kpi-sig-st"><span>HOURS VS BUDGET</span><StatePill label="—" /></div>
        <div className="kpi-sig-v num">{fmtHrs(worked)}</div>
        <div className="kpi-sig-u">hours worked · no budgeted-hours estimate</div>
        <div className="kpi-sig-sc">Rate observations needed to compute a budgeted-hours figure.</div>
        <div className="kpi-sig-vz" />
        <button type="button" className="kpi-sig-act">See hours by week ›</button>
      </div>
    );
  }
  const barPct = Math.max(0, Math.min(100, pct || 0));
  const markPct = elapsedPct != null ? Math.max(0, Math.min(100, elapsedPct)) : null;
  return (
    <div className="kpi-sig">
      <div className="kpi-sig-st"><span>HOURS VS BUDGET</span><StatePill label="ON PACE" /></div>
      <div className="kpi-sig-v num">{Math.round(worked)}</div>
      <div className="kpi-sig-u">of {budgeted} budgeted hours</div>
      <div className="kpi-sig-sc">
        {board?.distinct_workers ? <>Avg <b>{(worked / Math.max(1, (board?.total_ww || board?.distinct_workers))).toFixed(1)}</b> hrs per worker-week.</> : <>Rate-derived budgeted-hours estimate.</>}
      </div>
      <div className="kpi-sig-vz">
        <span className="kpi-sig-vstack">
          <span className="kpi-sig-bullet" role="img" aria-label={`Hours ${barPct.toFixed(0)}% of budgeted`}>
            <span className="kpi-sig-bullet-f" style={{ width: `${barPct}%` }} />
            {markPct != null && <span className="kpi-sig-bullet-m" style={{ left: `${markPct}%` }} />}
          </span>
          <span className="kpi-sig-vlab">
            <span>worked {barPct.toFixed(0)}%</span>
            {markPct != null && <span>│ today {markPct.toFixed(0)}%</span>}
          </span>
        </span>
      </div>
      <button type="button" className="kpi-sig-act">See hours by week ›</button>
    </div>
  );
}

function PayrollDataCard({ board, freshness }) {
  const pd = board?.payroll_data;
  const priced = pd?.priced_ww ?? 0;
  const total = pd?.total_ww ?? 0;
  const unpriced = pd?.unpriced_hours ?? 0;
  const feedTime = freshness?.last_walk_at ? fmtTimestamp(freshness.last_walk_at) : null;
  const state = total === 0 ? "—"
              : priced === total ? "FINAL"
              : "PARTIAL";
  const tone = state === "PARTIAL" ? "warn" : "neutral";
  return (
    <div className="kpi-sig">
      <div className="kpi-sig-st"><span>PAYROLL DATA</span><StatePill label={state} tone={tone} /></div>
      <div className="kpi-sig-v num">{priced} of {total}</div>
      <div className="kpi-sig-u">worker-weeks priced</div>
      <div className="kpi-sig-sc">
        {state === "FINAL"
          ? <>Nothing missing from payroll - <b>these numbers will not move</b>.</>
          : state === "PARTIAL"
            ? <><b>{total - priced}</b> worker-week{total - priced === 1 ? "" : "s"} unpriced.</>
            : <>No worker-weeks in range.</>}
      </div>
      <div className="kpi-sig-vz">
        <span className="kpi-sig-vstack">
          <span className="kpi-sig-chip"><b>{fmtHrs(unpriced)}</b> unpriced hrs</span>
          {feedTime && <span className="kpi-sig-chip">last feed <b>{feedTime}</b></span>}
        </span>
      </div>
      <button type="button" className="kpi-sig-act">Pipeline details ›</button>
    </div>
  );
}

export function SignalCards({ board, freshness }) {
  if (!board || board.applies === false) return null;
  return (
    <div className="kpi-sigs">
      <OverUnderCard board={board} />
      <OvertimeCard board={board} />
      <HoursVsBudgetCard board={board} />
      <PayrollDataCard board={board} freshness={freshness} />
    </div>
  );
}
