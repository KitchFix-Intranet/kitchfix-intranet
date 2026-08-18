"use client";
// src/app/kpi/labor/components/SignalCards.js
//
// V31 item 3 - treatment A. Every SVG and bar element is deleted from
// the signal row. The visual lane becomes a FACTS ROW pinned to the
// card foot with a hairline separator: two-up per single card, three-up
// on the double-width Hours card. Every signed figure carries ▼ / ▲
// and colour. Overtime's hero turns amber past the watch line and red
// past the alarm line (thresholds from board.overtime config, never
// hardcoded).

import { fmt$, fmtHrs } from "../lib/formatting.js";

// V29-17 - pill vocabulary is the same across the row.
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

// V29-18 arrow-first signed figure. `▼` under (green), `▲` over (red).
function ArrowFigure({ v, size = "hero", fmt = fmt$ }) {
  if (v == null) return <span className={`kpi-sig-arrfig kpi-sig-arrfig-${size}`}>—</span>;
  const abs = Math.abs(v);
  if (abs < 0.5) return <span className={`kpi-sig-arrfig kpi-sig-arrfig-${size}`}>{fmt(0)}</span>;
  const under = v < 0;
  const cls = under ? "kpi-sig-arrfig-good" : "kpi-sig-arrfig-bad";
  const arrow = under ? "▼" : "▲";
  return (
    <span className={`kpi-sig-arrfig kpi-sig-arrfig-${size} ${cls}`}>
      <span className="kpi-sig-arrfig-arrow" aria-hidden="true">{arrow}</span>
      {fmt(abs)}
    </span>
  );
}

function SignalCard({ children, wide, className }) {
  return (
    <div className={`kpi-sig ${wide ? "kpi-sig-wide" : ""} ${className || ""}`}>
      {children}
    </div>
  );
}
function Hero({ children }) { return <div className="kpi-sig-hero-lane">{children}</div>; }
function Sub({ children }) { return <div className="kpi-sig-sub-lane">{children}</div>; }
// V31 item 3 - facts row replaces the viz lane. Pinned to foot above
// a hairline. n-up grid; every item is label + medium-size value.
function Facts({ items }) {
  return (
    <div className="kpi-sig-facts" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((it, i) => (
        <div key={i} className="kpi-sig-fact">
          <div className={`kpi-sig-fact-lab ${it.labClass || ""}`}>{it.label}</div>
          <div className={`kpi-sig-fact-val ${it.tone ? `kpi-sig-fact-val-${it.tone}` : ""} ${it.muted ? "kpi-sig-fact-val-mute" : ""}`}>{it.value}</div>
          {it.sub && <div className="kpi-sig-fact-sub">{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ── V32-1..V32-4 Pace card (was mislabelled "over/under budget") ──
// State-dependent because the underlying figure changes definition
// between in-progress and closed periods. Card that keeps one title
// across that change tells two stories with one label.
function PaceCard({ board }) {
  const budget = board?.period_budget || board?.range_budget;
  const spent = board?.spent_to_date;
  const v = board?.variance;
  const verdict = board?.verdict;
  const kind = board?.kind;
  const elapsedPct = board?.elapsed_pct;
  const elapsedWeeks = board?.elapsed_weeks;
  const weeksInPeriod = board?.weeks_in_period || 4;
  const closedWeeks = board?.closed_weeks_count || 0;
  const projectedEnd = board?.projected_period_end;
  const inProgress = kind === "single_period_in_progress";
  const closed = kind === "single_period_closed";

  if (v == null || !budget) {
    return (
      <SignalCard>
        <Head eyebrow={inProgress ? "SPENDING PACE" : "FINAL VS BUDGET"} verdict={null} />
        <Hero><span className="kpi-sig-hero-mute">—</span></Hero>
        <Sub><span className="kpi-sig-sub-mute">no budget in range</span></Sub>
        <Facts items={[
          { label: "Spent", value: spent != null ? fmt$(spent) : "—" },
          { label: "Budget", value: "—" },
        ]} />
      </SignalCard>
    );
  }

  const under = v < 0;
  const eyebrow = inProgress ? "SPENDING PACE" : "FINAL VS BUDGET";

  // V32-2 sub-line differs per state.
  const subLine = inProgress
    ? (v == null || Math.abs(v) < 0.5
        ? `on an even burn, ${elapsedPct != null ? Math.round(elapsedPct) : "—"}% into the period`
        : `${under ? "ahead of" : "behind"} an even burn, ${elapsedPct != null ? Math.round(elapsedPct) : "—"}% into the period`)
    : "period closed";

  // V32-3 in-progress: Spent · Should be at · Projected end · Left to spend
  //       closed:      Spent · Budget · Of budget used · Left unspent / Overrun
  const shouldBeAt = inProgress
    ? (spent != null && v != null ? spent - v : null)
    : null;
  const projectedFact = inProgress
    ? (closedWeeks < 1
        ? { value: "—", sub: "needs a closed week", muted: true }
        : (projectedEnd != null
            ? { value: <ArrowFigure v={projectedEnd - budget} size="value" /> }
            : { value: "—", muted: true }))
    : null;
  const leftToSpend = inProgress && spent != null ? Math.max(0, budget - spent) : null;
  const ofBudgetUsedPct = closed && budget > 0 && spent != null ? Math.round((spent / budget) * 100) : null;
  const leftUnspent = closed && spent != null ? budget - spent : null;

  const facts = inProgress
    ? [
        { label: "Spent",        value: spent != null ? fmt$(spent) : "—" },
        { label: "Should be at", value: shouldBeAt != null ? fmt$(shouldBeAt) : "—" },
        { label: "Projected end", value: projectedFact.value, tone: projectedFact.muted ? undefined : undefined, sub: projectedFact.sub, muted: projectedFact.muted },
        { label: "Left to spend", value: leftToSpend != null ? fmt$(leftToSpend) : "—" },
      ]
    : [
        { label: "Spent",  value: spent != null ? fmt$(spent) : "—" },
        { label: "Budget", value: fmt$(budget) },
        { label: "Of budget used", value: ofBudgetUsedPct != null ? `${ofBudgetUsedPct}%` : "—" },
        leftUnspent != null && leftUnspent >= 0
          ? { label: "Left unspent", value: fmt$(leftUnspent) }
          : { label: "Overrun", value: leftUnspent != null ? fmt$(Math.abs(leftUnspent)) : "—", tone: "bad" },
      ];

  return (
    <SignalCard className={under ? "kpi-sig-lead kpi-sig-lead-good" : ""}>
      <Head eyebrow={eyebrow} verdict={verdict} />
      <Hero>
        <ArrowFigure v={v} size="hero" />
      </Hero>
      <Sub>{subLine}</Sub>
      <Facts items={facts} />
    </SignalCard>
  );
}

// ── Overtime ──────────────────────────────────────────────────────
// V31 item 3 - OT hero turns amber past watch, red at alarm. Thresholds
// come from board.overtime.watch_pct / .alarm_pct (server config; never
// hardcoded). Facts row: "Watch line <N>%" (only the 8% watch is stated;
// the 12% alarm label is dropped from copy but still drives colour) and
// "Vs last period" (not currently in the board payload; shows dash
// until the server ships a prior-period OT figure - see "found not
// fixed").
function OvertimeCard({ board }) {
  const ot = board?.overtime;
  const pct = ot?.pct ?? 0;
  const watch = ot?.watch_pct;
  const state = ot?.state ?? "clear";
  const verdict = state === "alarm" ? "over" : state === "watch" ? "watch" : "on_track";
  const heroTone = state === "alarm" ? "bad" : state === "watch" ? "warn" : null;
  const vsLast = ot?.vs_last_period_pct;   // not currently populated
  return (
    <SignalCard>
      <Head eyebrow="OVERTIME" verdict={verdict} />
      <Hero>
        <span className={`kpi-sig-hero-val num ${heroTone === "bad" ? "kpi-sig-hero-bad" : heroTone === "warn" ? "kpi-sig-hero-warn" : ""}`}>
          {pct.toFixed(1)}%
        </span>
      </Hero>
      <Sub>of hours worked</Sub>
      <Facts items={[
        { label: "Watch line", value: watch != null ? `${watch}%` : "—" },
        { label: "Vs last period", value: vsLast != null ? <ArrowFigure v={vsLast} size="value" fmt={(n) => `${n.toFixed(1)}%`} /> : "—" },
      ]} />
    </SignalCard>
  );
}

// ── Hours left (double-width) ─────────────────────────────────────
function HoursLeftCard({ board }) {
  const budget = board?.period_budget || board?.range_budget;
  const spent = board?.spent_to_date ?? 0;
  const worked = board?.hours ?? 0;
  const rate = board?.avg_rate;
  const kind = board?.kind;
  const dollarsLeft = budget != null && budget > 0 ? budget - spent : null;
  const hoursLeft = (rate != null && rate > 0 && dollarsLeft != null)
    ? Math.max(0, dollarsLeft / rate)
    : null;
  const isOver = dollarsLeft != null && dollarsLeft < 0;
  const hoursOver = isOver && rate != null && rate > 0
    ? Math.abs(dollarsLeft) / rate
    : 0;
  const verdict = board?.verdict;

  if (budget == null || rate == null || rate <= 0) {
    return (
      <SignalCard wide>
        <Head eyebrow="HOURS LEFT TO SCHEDULE" verdict={null} />
        <Hero><span className="kpi-sig-hero-val num">{fmtHrs(worked)}</span></Hero>
        <Sub><span className="kpi-sig-sub-mute">hours worked · no budget to compare</span></Sub>
        <Facts items={[
          { label: "Worked",       value: fmtHrs(worked) },
          { label: "Budget left",  value: "—" },
          { label: "Blended rate", value: rate != null ? `$${rate.toFixed(2)}/hr` : "—" },
        ]} />
      </SignalCard>
    );
  }

  const heroValue = isOver ? hoursOver : (hoursLeft ?? 0);
  const heroSub = isOver
    ? "beyond what the budget covers"
    : (kind === "single_period_closed" ? "hours the period had left" : "you can still schedule this period");

  return (
    <SignalCard wide>
      <Head eyebrow="HOURS LEFT TO SCHEDULE" verdict={verdict} />
      <Hero>
        <span className={`kpi-sig-hero-val num ${isOver ? "kpi-sig-hero-bad" : ""}`}>{fmtHrs(heroValue)}</span>
      </Hero>
      <Sub>{heroSub}</Sub>
      <Facts items={[
        { label: "Worked",       value: fmtHrs(worked) },
        { label: "Budget left",  value: isOver ? <ArrowFigure v={Math.abs(dollarsLeft)} size="value" /> : fmt$(dollarsLeft ?? 0) },
        { label: "Blended rate", value: `$${rate.toFixed(2)}/hr` },
      ]} />
    </SignalCard>
  );
}

export function SignalCards({ board }) {
  if (!board || board.applies === false) return null;
  return (
    <div className="kpi-sigs kpi-sigs-3">
      <PaceCard board={board} />
      <OvertimeCard board={board} />
      <HoursLeftCard board={board} />
    </div>
  );
}
