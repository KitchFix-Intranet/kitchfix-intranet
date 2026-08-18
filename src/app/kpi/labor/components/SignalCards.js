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
// V33 P0 - facts grid is always 2-col (see .kpi-sig-facts CSS) so four
// facts wrap 2x2. Prior JSX set columns from items.length inline, so
// four facts landed in one 57.6px x4 row that clipped 18 label/value
// pairs at 1180.
function Facts({ items }) {
  return (
    <div className="kpi-sig-facts">
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

  // V32-2 + V33 P0 sub-line follows the SIGN of the variance (words
  // and arrow must agree). Negative variance = spent LESS than the
  // prorated budget = the account is BEHIND its even burn (spending
  // slower than plan). Positive variance = spent MORE = ahead of it.
  // Prior wording was inverted, so `▼ $1,330` (green, under pace) read
  // as "ahead of an even burn" - the words said the opposite of the
  // arrow.
  const subLine = inProgress
    ? (v == null || Math.abs(v) < 0.5
        ? `on an even burn, ${elapsedPct != null ? Math.round(elapsedPct) : "—"}% into the period`
        : `${under ? "behind" : "ahead of"} an even burn, ${elapsedPct != null ? Math.round(elapsedPct) : "—"}% into the period`)
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

// ── V32-5..V32-7 Overtime ─────────────────────────────────────────
// Thresholds: 0% on target (green), above 0 up to `watch_pct` amber
// warning, above `alarm_pct` red off-target. BOTH bounds come from
// server config (board.overtime.watch_pct / .alarm_pct); the copy
// renders whatever config holds. `Hrs to target` flips to `Hrs over
// target` at the alarm bound - allowed = worked_hours * alarm_pct/100;
// remaining = allowed - ot_hours (positive = under target, negative =
// over target; we render the absolute value with the appropriate label).
function OvertimeCard({ board }) {
  const ot = board?.overtime;
  const pct = ot?.pct ?? 0;
  const workedHours = board?.hours ?? 0;
  const watch = ot?.watch_pct;
  const alarm = ot?.alarm_pct;
  const state = ot?.state ?? "clear";
  const verdict = state === "alarm" ? "over" : state === "watch" ? "watch" : "on_track";
  const heroTone = state === "alarm" ? "bad" : state === "watch" ? "warn" : null;

  const otCost = ot?.cost;
  const otWorkers = ot?.workers ?? 0;
  const workersTotal = ot?.workers_total ?? 0;
  const longest = ot?.longest_week;
  // Sign convention: allowed = worked * alarm_pct/100 (the "off target"
  // bound); remaining = allowed - actual. Positive remaining = hours
  // still under the target (labeled "Hrs to target"); negative =
  // hours already past the target (labeled "Hrs over target", absolute).
  const allowed = (alarm != null && workedHours > 0) ? (workedHours * alarm / 100) : null;
  const remaining = (allowed != null) ? allowed - (ot?.hours ?? 0) : null;
  const overTarget = remaining != null && remaining < 0;
  const hoursFact = remaining == null
    ? { label: "Hrs to target", value: "—" }
    : overTarget
      ? { label: "Hrs over target", value: fmtHrs(Math.abs(remaining)), tone: "bad" }
      : { label: "Hrs to target",  value: fmtHrs(remaining) };

  const boundsCopy = (watch != null && alarm != null)
    ? `watch above ${watch}% · off target above ${alarm}%`
    : "of hours worked";

  return (
    <SignalCard>
      <Head eyebrow="OVERTIME" verdict={verdict} />
      <Hero>
        <span className={`kpi-sig-hero-val num ${heroTone === "bad" ? "kpi-sig-hero-bad" : heroTone === "warn" ? "kpi-sig-hero-warn" : ""}`}>
          {pct.toFixed(1)}%
        </span>
      </Hero>
      <Sub>{boundsCopy}</Sub>
      <Facts items={[
        { label: "OT cost", value: otCost != null ? fmt$(otCost) : "—" },
        hoursFact,
        { label: "OT workers", value: workersTotal > 0 ? `${otWorkers} of ${workersTotal}` : "—" },
        { label: "Peak OT week", value: longest ? `${longest.week_start.slice(5).replace("-", "/")} · ${fmtHrs(longest.hours)}` : "—" },
      ]} />
    </SignalCard>
  );
}

// ── V32-8/V32-9 Hours left (single width, back on the 4-card row) ──
// Facts: Per week (hours left / weeks not finished) · Per worker/wk
// (that / distinct workers) · Budget left · Blended rate. `Worked`
// drops off the card - it lives in ALL THE NUMBERS. Per-week facts
// render a muted dash on ranges with no meaningful weeks-remaining
// denominator (closed periods, FYTD, multi-period).
function HoursLeftCard({ board }) {
  const budget = board?.period_budget || board?.range_budget;
  const spent = board?.spent_to_date ?? 0;
  const rate = board?.avg_rate;
  const workers = board?.distinct_workers ?? 0;
  const kind = board?.kind;
  const inProgress = kind === "single_period_in_progress";
  const notStarted = board?.not_started_weeks_count || 0;
  const weeksRemaining = inProgress ? (board?.in_progress_week_start ? 1 : 0) + notStarted : 0;
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
      <SignalCard>
        <Head eyebrow="HOURS LEFT TO SCHEDULE" verdict={null} />
        <Hero><span className="kpi-sig-hero-mute">—</span></Hero>
        <Sub><span className="kpi-sig-sub-mute">no budget to compare</span></Sub>
        <Facts items={[
          { label: "Per week",     value: "—", muted: true },
          { label: "Per worker", value: "—", muted: true },
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

  // Per-week facts: only apply when the range has an in-progress
  // period with weeks-remaining. Closed and multi-period ranges get
  // muted dashes (V8-19 pattern).
  const perWeek = (inProgress && weeksRemaining > 0 && hoursLeft != null)
    ? hoursLeft / weeksRemaining
    : null;
  const perWorkerPerWeek = (perWeek != null && workers > 0) ? perWeek / workers : null;

  return (
    <SignalCard>
      <Head eyebrow="HOURS LEFT TO SCHEDULE" verdict={verdict} />
      <Hero>
        <span className={`kpi-sig-hero-val num ${isOver ? "kpi-sig-hero-bad" : ""}`}>{fmtHrs(heroValue)}</span>
      </Hero>
      <Sub>{heroSub}</Sub>
      <Facts items={[
        { label: "Per week",     value: perWeek != null ? fmtHrs(perWeek) : "—", muted: perWeek == null },
        { label: "Per worker", value: perWorkerPerWeek != null ? fmtHrs(perWorkerPerWeek) : "—", muted: perWorkerPerWeek == null },
        { label: "Budget left",  value: isOver ? <ArrowFigure v={Math.abs(dollarsLeft)} size="value" /> : fmt$(dollarsLeft ?? 0) },
        { label: "Blended rate", value: `$${rate.toFixed(2)}/hr` },
      ]} />
    </SignalCard>
  );
}

// ── V32-10/V32-11 Payroll data (ACTION card) ─────────────────────
// Unapproved hours = someone must approve them in Rippling or those
// people do not get paid. This card names Rippling in the sub-line
// when the situation calls for action. `Dollars will rise` is an
// estimate (unapproved_hrs * blended_rate) and is marked as one via
// a dotted-underline label + a hover reading the derivation.
function PayrollDataCard({ board, freshness }) {
  const pd = board?.payroll_data;
  const priced = pd?.priced_ww ?? 0;
  const total = pd?.total_ww ?? 0;
  const unpricedHrs = pd?.unpriced_hours ?? 0;
  const unapprovedWeeks = pd?.unapproved_weeks ?? 0;
  const rate = board?.avg_rate;
  const state = total === 0 ? null
              : unpricedHrs > 0 ? "watch"
              : "on_track";
  const pillLabel = total === 0 ? "—" : unpricedHrs > 0 ? "PARTIAL" : "FINAL";
  const pillTone = unpricedHrs > 0 ? "warn" : total === 0 ? "neutral" : "good";
  const hasUnapproved = unpricedHrs > 0.004;
  const willRise = (hasUnapproved && rate != null && rate > 0) ? unpricedHrs * rate : null;
  const willRiseTitle = willRise != null
    ? `Estimate. ${fmtHrs(unpricedHrs)} unapproved hrs x $${rate.toFixed(2)} blended rate. Unapproved hours skew to whoever has not been processed, so their true rate may differ from the blend.`
    : "";
  const lastPulled = freshness?.last_walk_at
    ? new Date(freshness.last_walk_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "—";

  return (
    <SignalCard>
      <div className="kpi-sig-head">
        <span className="kpi-sig-eyebrow">PAYROLL DATA</span>
        <span className={`kpi-sig-state kpi-sig-state-${pillTone}`}>{pillLabel}</span>
      </div>
      <Hero>
        <span className="kpi-sig-hero-val num">{priced} of {total}</span>
      </Hero>
      {/* V33 P0 payroll sub - "worker-weeks with pay data in" is the
          main sub-line. When unapproved > 0 the action sentence renders
          on its OWN LINE below (was concatenated, missing space, and
          clipped at 294px card width). */}
      <Sub>
        worker-weeks with pay data in
      </Sub>
      {hasUnapproved && (
        <div className="kpi-sig-action-line">
          {fmtHrs(unpricedHrs)} hrs need approval in Rippling
        </div>
      )}
      <Facts items={[
        { label: "Unapproved hrs", value: hasUnapproved ? fmtHrs(unpricedHrs) : "—", tone: hasUnapproved ? "warn" : undefined },
        {
          label: <span className="kpi-sig-fact-est" title={willRiseTitle}>Will rise</span>,
          value: willRise != null ? `~ ${fmt$(willRise)}` : "—",
          muted: willRise == null,
        },
        { label: "Weeks affected", value: unapprovedWeeks > 0 ? `${unapprovedWeeks}` : "—", muted: unapprovedWeeks === 0 },
        { label: "Last pulled", value: lastPulled },
      ]} />
    </SignalCard>
  );
}

export function SignalCards({ board, freshness }) {
  if (!board || board.applies === false) return null;
  return (
    <div className="kpi-sigs">
      <PaceCard board={board} />
      <OvertimeCard board={board} />
      <HoursLeftCard board={board} />
      <PayrollDataCard board={board} freshness={freshness} />
    </div>
  );
}
