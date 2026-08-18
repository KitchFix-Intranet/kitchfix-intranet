"use client";
// src/app/kpi/labor/components/SignalCards.js
//
// V29-15..V29-19 - signal row REBUILD.
//   V29-15 payroll data card retired (priced/total lives in the SYSTEM
//          strip; unpriced hours lives in ALL THE NUMBERS).
//   V29-16 hours card answers ONE question - how many hours left to
//          schedule. One bar. Money as a footer chip. Blended rate as
//          quiet right-aligned text. Percentages, planned-rate
//          comparisons and rate-gap figures are EXPLICITLY forbidden.
//   V29-17 state pills carry a state word only: ON TARGET / WATCH / OVER.
//   V29-18 arrows never signs: ▼ for under, ▲ for over.
//   V29-19 shared lanes across the row (head 20 / hero 38 / sub 16 /
//          viz 58); a double-width card widens the VISUAL, not internals.

import { fmt$, fmtHrs } from "../lib/formatting.js";

// V29-17 - pill vocabulary is the SAME on every card. Verdict maps to
// the same three words regardless of which signal drove it.
function pillFor(verdict) {
  if (verdict === "on_track") return { label: "ON TARGET", tone: "good" };
  if (verdict === "watch")    return { label: "WATCH",     tone: "warn" };
  if (verdict === "over")     return { label: "OVER",      tone: "bad"  };
  return { label: "—", tone: "neutral" };
}

function Head({ eyebrow, verdict }) {
  const p = pillFor(verdict);
  return (
    <div className="kpi-sig-head">
      <span className="kpi-sig-eyebrow">{eyebrow}</span>
      <span className={`kpi-sig-state kpi-sig-state-${p.tone}`}>{p.label}</span>
    </div>
  );
}

// V29-18 - arrow-first signed figure. `▼` for under (v < 0, green),
// `▲` for over (v > 0, red). Never `+` or `-`.
function ArrowFigure({ v, size = "hero" }) {
  if (v == null) return <span className={`kpi-sig-arrfig kpi-sig-arrfig-${size}`}>—</span>;
  const abs = Math.abs(v);
  if (abs < 0.5) return <span className={`kpi-sig-arrfig kpi-sig-arrfig-${size}`}>{fmt$(0)}</span>;
  const under = v < 0;
  const cls = under ? "kpi-sig-arrfig-good" : "kpi-sig-arrfig-bad";
  const arrow = under ? "▼" : "▲";
  return (
    <span className={`kpi-sig-arrfig kpi-sig-arrfig-${size} ${cls}`}>
      <span className="kpi-sig-arrfig-arrow" aria-hidden="true">{arrow}</span>
      {fmt$(abs)}
    </span>
  );
}

// V29-19 - three-lane card shell. Every card in the row instantiates
// this so the computed `top` of each hero lane matches across the row.
function SignalCard({ children, wide, className }) {
  return (
    <div className={`kpi-sig ${wide ? "kpi-sig-wide" : ""} ${className || ""}`}>
      {children}
    </div>
  );
}
function Hero({ children }) { return <div className="kpi-sig-hero-lane">{children}</div>; }
function Sub({ children }) { return <div className="kpi-sig-sub-lane">{children}</div>; }
function Viz({ children }) { return <div className="kpi-sig-viz-lane">{children}</div>; }
function Footer({ children }) { return <div className="kpi-sig-foot-lane">{children}</div>; }

// ── V29-8/V29-19 Over/Under budget ─────────────────────────────────
function OverUnderCard({ board }) {
  const v = board?.variance;
  const budget = board?.period_budget || board?.range_budget;
  const verdict = board?.verdict;
  if (v == null || !budget) {
    return (
      <SignalCard>
        <Head eyebrow="OVER / UNDER BUDGET" verdict={null} />
        <Hero><span className="kpi-sig-hero-mute">—</span></Hero>
        <Sub><span className="kpi-sig-sub-mute">no budget in range</span></Sub>
        <Viz />
      </SignalCard>
    );
  }
  const under = v < 0;
  const scale = Math.min(1, Math.abs(v) / (budget * 0.6));
  const barPct = 50 * scale;
  return (
    <SignalCard className={under ? "kpi-sig-lead kpi-sig-lead-good" : ""}>
      <Head eyebrow="OVER / UNDER BUDGET" verdict={verdict} />
      <Hero>
        <ArrowFigure v={v} size="hero" />
      </Hero>
      <Sub>of a {fmt$(budget)} budget</Sub>
      <Viz>
        <div className="kpi-sig-dvg" role="img" aria-label={`Variance ${fmt$(Math.abs(v))} ${under ? "under" : "over"} budget`}>
          <span className="kpi-sig-dvg-zero" />
          <span
            className={`kpi-sig-dvg-bar ${!under ? "kpi-sig-dvg-bar-over" : ""}`}
            style={under ? { right: "50%", width: `${barPct}%` } : { left: "50%", width: `${barPct}%` }}
          />
        </div>
        <div className="kpi-sig-vlab"><span>under</span><span className="mid">on budget</span><span>over</span></div>
      </Viz>
    </SignalCard>
  );
}

// ── V29-11 Overtime arc ────────────────────────────────────────────
function OvertimeCard({ board }) {
  const ot = board?.overtime;
  const hours = ot?.hours ?? 0;
  const pct = ot?.pct ?? 0;
  const watch = ot?.watch_pct;
  const alarm = ot?.alarm_pct;
  const state = ot?.state ?? "clear";
  const verdict = state === "alarm" ? "over" : state === "watch" ? "watch" : "on_track";
  const totalHrs = board?.hours ?? 0;
  const angleToPoint = (angle) => {
    const rad = (angle * Math.PI) / 180;
    return { x: 75 + 58 * Math.cos(rad), y: 82 - 58 * Math.sin(rad) };
  };
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
  const hasBand = watch != null && alarm != null && watch > 0 && alarm > watch;
  return (
    <SignalCard>
      <Head eyebrow="OVERTIME" verdict={verdict} />
      <Hero>
        <span className="kpi-sig-hero-val num">{pct.toFixed(1)}%</span>
      </Hero>
      <Sub>{fmtHrs(hours)} OT hrs of {fmtHrs(totalHrs)} worked</Sub>
      <Viz>
        <svg className="kpi-sig-arc" viewBox="0 0 150 94" aria-label={`Overtime ${pct.toFixed(1)}%`} preserveAspectRatio="xMidYMid meet">
          <path d={`M${start.x} ${start.y} A58 58 0 0 1 ${end.x} ${end.y}`} fill="none" stroke="var(--n-200)" strokeWidth="12" strokeLinecap="round" />
          {hasBand && (
            <path d={`M${wStart.x} ${wStart.y} A58 58 0 0 1 ${wEnd.x} ${wEnd.y}`} fill="none" stroke="#F3D9AE" strokeWidth="12" strokeLinecap="round" />
          )}
          {pct > 0.01 && (
            <path d={`M${start.x} ${start.y} A58 58 0 0 1 ${vPoint.x} ${vPoint.y}`} fill="none" stroke={arcColor} strokeWidth="12" strokeLinecap="round" />
          )}
        </svg>
      </Viz>
    </SignalCard>
  );
}

// ── V29-16 Hours card - ONE UNIT, NO HYPOTHETICALS ────────────────
// The card answers ONE question: how many hours are left to schedule.
// Hero = hours remaining (in progress) OR hours over (closed/over).
// Visual = ONE bar in hours: solid navy for hours worked, hatched blue
// for hours remaining, red for the overrun past the end. Money is a
// footer chip; blended rate is quiet right-aligned text.
//
// NOT ON THIS CARD (owner ruled confusing after testing): percent-of-plan,
// planned-rate comparisons, rate-gap figures, or any second scenario.
function HoursLeftCard({ board }) {
  const budget = board?.period_budget || board?.range_budget;
  const spent = board?.spent_to_date ?? 0;
  const worked = board?.hours ?? 0;
  const rate = board?.avg_rate;
  const kind = board?.kind;
  const dollarsLeft = budget != null && budget > 0 ? budget - spent : null;
  // Blended hours-left = (budget - spent) / rate. Floored at 0.
  const hoursLeft = (rate != null && rate > 0 && dollarsLeft != null)
    ? Math.max(0, dollarsLeft / rate)
    : null;
  const isOver = dollarsLeft != null && dollarsLeft < 0;
  const hoursOver = isOver && rate != null && rate > 0
    ? Math.abs(dollarsLeft) / rate
    : 0;
  // Budgeted hours (for the bar denominator). Not surfaced as a
  // separate figure - only the bar denominator.
  const budgetedHours = (rate != null && rate > 0 && budget != null && budget > 0)
    ? budget / rate
    : null;

  // Verdict: use board.verdict (spend-based) for the pill so cards align.
  const verdict = board?.verdict;

  if (budget == null || rate == null || rate <= 0) {
    return (
      <SignalCard wide>
        <Head eyebrow="HOURS LEFT TO SCHEDULE" verdict={null} />
        <Hero><span className="kpi-sig-hero-val num">{fmtHrs(worked)}</span></Hero>
        <Sub><span className="kpi-sig-sub-mute">hours worked · no budget to compare</span></Sub>
        <Viz />
        <Footer />
      </SignalCard>
    );
  }

  const heroValue = isOver ? hoursOver : (hoursLeft ?? 0);
  const heroSub = isOver
    ? "beyond what the budget covers"
    : (kind === "single_period_closed" ? "hours the period had left" : "you can still schedule this period");

  // Bar geometry. Domain = max(budgetedHours, worked) so the overrun
  // segment has room past the end when over.
  const domain = Math.max(budgetedHours || 0, worked, 1);
  const workedPct = Math.min(100, Math.max(0, (worked / domain) * 100));
  const remainingHrs = Math.max(0, (budgetedHours || 0) - worked);
  const remainingPct = Math.min(100 - workedPct, (remainingHrs / domain) * 100);
  const overPct = isOver ? Math.min(100 - workedPct, (hoursOver / domain) * 100) : 0;

  return (
    <SignalCard wide>
      <Head eyebrow="HOURS LEFT TO SCHEDULE" verdict={verdict} />
      <Hero>
        <span className="kpi-sig-hero-val num">{fmtHrs(heroValue)}</span>
      </Hero>
      <Sub>{heroSub}</Sub>
      <Viz>
        <div className="kpi-sig-hbar" role="img" aria-label={`${fmtHrs(worked)} worked of ${fmtHrs(budgetedHours || 0)} budgeted`}>
          <span className="kpi-sig-hbar-worked" style={{ width: `${workedPct}%` }} />
          {!isOver && remainingPct > 0 && (
            <span className="kpi-sig-hbar-left" style={{ left: `${workedPct}%`, width: `${remainingPct}%` }} />
          )}
          {isOver && overPct > 0 && (
            <span className="kpi-sig-hbar-over" style={{ left: `${workedPct}%`, width: `${overPct}%` }} />
          )}
        </div>
        <div className="kpi-sig-hbar-lab">
          <span><b>{fmtHrs(worked)}</b>{" "}WORKED</span>
          <span>{isOver ? <><b>{fmtHrs(hoursOver)}</b>{" "}OVER</> : <><b>{fmtHrs(remainingHrs)}</b>{" "}LEFT</>}</span>
        </div>
      </Viz>
      <Footer>
        <span className="kpi-sig-chip">
          {isOver
            ? <><b>{fmt$(Math.abs(dollarsLeft))}</b>{" "}over budget</>
            : <><b>{fmt$(dollarsLeft ?? 0)}</b>{" "}of budget left</>}
        </span>
        <span className="kpi-sig-foot-rate">at {fmt$(rate)}/hr</span>
      </Footer>
    </SignalCard>
  );
}

export function SignalCards({ board }) {
  if (!board || board.applies === false) return null;
  return (
    <div className="kpi-sigs kpi-sigs-3">
      <OverUnderCard board={board} />
      <OvertimeCard board={board} />
      <HoursLeftCard board={board} />
    </div>
  );
}
