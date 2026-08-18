"use client";
// src/app/kpi/labor/components/SignalCards.js
//
// V31 item 3 - facts row replaces the viz lane. Pinned to card foot
// above a hairline; 2-up per card.
// V33 P0 - facts grid is always 2-col so four facts wrap 2x2.
// V34 - one mechanism for card colour. Every SignalCard now REQUIRES a
// `state` prop (good | warn | bad | info | neutral) that drives the
// left stripe, the pill class and any signed hero / fact tone from the
// SAME expression the card already used to pick its pill. The prior
// mechanism (kpi-sig-lead + kpi-sig-lead-good + kpi-sig-attn) reached
// only the first card, which is why three stripes stayed grey.

import { fmt$, fmtHrs } from "../lib/formatting.js";

// V34 - the pill and the card stripe come from ONE expression per card.
// Each caller derives its `state`; Head renders the pill from the same
// value so they can never disagree.
function Head({ eyebrow, state, label }) {
  return (
    <div className="kpi-sig-head">
      <span className="kpi-sig-eyebrow">{eyebrow}</span>
      <span className={`kpi-sig-state kpi-sig-state-${state}`}>{label}</span>
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

// V34 - state is required. Any caller that forgets it will render an
// unrecognised class and the CSS gate probe will fail.
function SignalCard({ children, state }) {
  return (
    <div className={`kpi-sig kpi-sig-st-${state}`}>
      {children}
    </div>
  );
}
function Hero({ children }) { return <div className="kpi-sig-hero-lane">{children}</div>; }
function Sub({ children }) { return <div className="kpi-sig-sub-lane">{children}</div>; }

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

// ── Pace / Final vs budget ────────────────────────────────────────
// V32-1..V32-4. State-dependent because the underlying figure changes
// definition between in-progress and closed periods.
function PaceCard({ board }) {
  const budget = board?.period_budget || board?.range_budget;
  const spent = board?.spent_to_date;
  const v = board?.variance;
  const verdict = board?.verdict;
  const kind = board?.kind;
  const elapsedPct = board?.elapsed_pct;
  const closedWeeks = board?.closed_weeks_count || 0;
  const projectedEnd = board?.projected_period_end;
  const inProgress = kind === "single_period_in_progress";
  const closed = kind === "single_period_closed";

  if (v == null || !budget) {
    return (
      <SignalCard state="neutral">
        <Head eyebrow={inProgress ? "SPENDING PACE" : "FINAL VS BUDGET"} state="neutral" label="—" />
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

  // V34 - state comes from the SAME expression the pill was already
  // using. verdict is the single source of truth for card colour.
  const { state, label } = pillFor(verdict);
  const eyebrow = inProgress ? "SPENDING PACE" : "FINAL VS BUDGET";

  // V32-2 + V33 P0 sub-line follows the SIGN of the variance.
  const subLine = inProgress
    ? (Math.abs(v) < 0.5
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
  const ofBudgetUsedPct = closed && budget > 0 && spent != null ? (spent / budget) * 100 : null;
  const leftUnspent = closed && spent != null ? budget - spent : null;

  // V34 - signed facts carry the tone that matches their sign so the
  // colour language on the card is unified. `Of budget used` is signed
  // in meaning: <=100% good, >100% bad.
  const facts = inProgress
    ? [
        { label: "Spent",        value: spent != null ? fmt$(spent) : "—" },
        { label: "Should be at", value: shouldBeAt != null ? fmt$(shouldBeAt) : "—" },
        { label: "Projected end", value: projectedFact.value, sub: projectedFact.sub, muted: projectedFact.muted },
        { label: "Left to spend", value: leftToSpend != null ? fmt$(leftToSpend) : "—" },
      ]
    : [
        { label: "Spent",  value: spent != null ? fmt$(spent) : "—" },
        { label: "Budget", value: fmt$(budget) },
        { label: "Of budget used",
          value: ofBudgetUsedPct != null ? `${ofBudgetUsedPct.toFixed(1)}%` : "—",
          tone: ofBudgetUsedPct == null ? undefined : ofBudgetUsedPct > 100 ? "bad" : "good" },
        leftUnspent != null && leftUnspent >= 0
          ? { label: "Left unspent", value: fmt$(leftUnspent), tone: "good" }
          : { label: "Overrun", value: leftUnspent != null ? fmt$(Math.abs(leftUnspent)) : "—", tone: "bad" },
      ];

  return (
    <SignalCard state={state}>
      <Head eyebrow={eyebrow} state={state} label={label} />
      <Hero>
        <ArrowFigure v={v} size="hero" />
      </Hero>
      <Sub>{subLine}</Sub>
      <Facts items={facts} />
    </SignalCard>
  );
}

// V29-17 - pill vocabulary is the same across the row. V34 - pill tone
// IS the card state. Overtime and Payroll compute their own state
// directly (they do not go through verdict) so this helper stays a
// thin verdict-to-tone map for cards that DO run off verdict.
function pillFor(verdict) {
  if (verdict === "on_track") return { state: "good", label: "ON TARGET" };
  if (verdict === "watch")    return { state: "warn", label: "WATCH" };
  if (verdict === "over")     return { state: "bad",  label: "OVER" };
  return { state: "neutral", label: "—" };
}

// ── Overtime ──────────────────────────────────────────────────────
// V32-5..V32-7. Thresholds come from server config (never hardcoded).
// V34 - state IS the pill tone: clear=good, watch=warn, alarm=bad.
// Hrs to target carries the same tone as the state (headroom good,
// close to limit watch, past limit bad).
function OvertimeCard({ board }) {
  const ot = board?.overtime;
  const pct = ot?.pct ?? 0;
  const workedHours = board?.hours ?? 0;
  const watch = ot?.watch_pct;
  const alarm = ot?.alarm_pct;
  const otState = ot?.state ?? "clear";

  // V34 - one expression, both surfaces read it.
  const state = otState === "alarm" ? "bad" : otState === "watch" ? "warn" : "good";
  const label = state === "bad" ? "OVER" : state === "warn" ? "WATCH" : "ON TARGET";
  const heroTone = state === "bad" ? "bad" : state === "warn" ? "warn" : null;

  const otCost = ot?.cost;
  const otWorkers = ot?.workers ?? 0;
  const workersTotal = ot?.workers_total ?? 0;
  const longest = ot?.longest_week;

  const allowed = (alarm != null && workedHours > 0) ? (workedHours * alarm / 100) : null;
  const remaining = (allowed != null) ? allowed - (ot?.hours ?? 0) : null;
  const overTarget = remaining != null && remaining < 0;
  // V34 - signed fact: colour follows the state. Under target with
  // headroom = good; under but close (state=watch) = warn; past target
  // = bad (label flips to "Hrs over target").
  const hoursFact = remaining == null
    ? { label: "Hrs to target", value: "—" }
    : overTarget
      ? { label: "Hrs over target", value: fmtHrs(Math.abs(remaining)), tone: "bad" }
      : { label: "Hrs to target",  value: fmtHrs(remaining), tone: state === "warn" ? "warn" : "good" };

  const boundsCopy = (watch != null && alarm != null)
    ? `watch above ${watch}% · off target above ${alarm}%`
    : "of hours worked";

  return (
    <SignalCard state={state}>
      <Head eyebrow="OVERTIME" state={state} label={label} />
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
        { label: "Peak OT week", value: longest ? `${longest.week_start.slice(5).replace("-", "/")} · ${fmtHrs(longest.hours)}` : "—", muted: !longest },
      ]} />
    </SignalCard>
  );
}

// ── Hours left to schedule ────────────────────────────────────────
// V32-8/V32-9. V34 - state is CONTEXTUAL: an in-progress range is
// information (blue), not a state to violate; a closed range is a
// verdict (good under budget, bad over). The pill label still reads
// "ON TARGET" / "OVER" so the badge stays legible.
function HoursLeftCard({ board }) {
  const budget = board?.period_budget || board?.range_budget;
  const spent = board?.spent_to_date ?? 0;
  const rate = board?.avg_rate;
  const workers = board?.distinct_workers ?? 0;
  const kind = board?.kind;
  const inProgress = kind === "single_period_in_progress";
  const closed = kind === "single_period_closed";
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

  if (budget == null || rate == null || rate <= 0) {
    return (
      <SignalCard state="neutral">
        <Head eyebrow="HOURS LEFT TO SCHEDULE" state="neutral" label="—" />
        <Hero><span className="kpi-sig-hero-mute">—</span></Hero>
        <Sub><span className="kpi-sig-sub-mute">no budget to compare</span></Sub>
        <Facts items={[
          { label: "Per week",     value: "—", muted: true },
          { label: "Per worker",   value: "—", muted: true },
          { label: "Budget left",  value: "—" },
          { label: "Blended rate", value: rate != null ? `$${rate.toFixed(2)}/hr` : "—" },
        ]} />
      </SignalCard>
    );
  }

  // V34 - in-progress -> info (blue); closed under -> good; closed
  // over -> bad. All three drive stripe + pill class from this one
  // expression.
  const state = inProgress ? "info" : (closed && isOver ? "bad" : "good");
  const label = closed && isOver ? "OVER" : "ON TARGET";

  const heroValue = isOver ? hoursOver : (hoursLeft ?? 0);
  const heroSub = isOver
    ? "beyond what the budget covers"
    : (closed ? "hours the period had left" : "you can still schedule this period");

  const perWeek = (inProgress && weeksRemaining > 0 && hoursLeft != null)
    ? hoursLeft / weeksRemaining
    : null;
  const perWorkerPerWeek = (perWeek != null && workers > 0) ? perWeek / workers : null;

  return (
    <SignalCard state={state}>
      <Head eyebrow="HOURS LEFT TO SCHEDULE" state={state} label={label} />
      <Hero>
        <span className={`kpi-sig-hero-val num ${isOver ? "kpi-sig-hero-bad" : ""}`}>{fmtHrs(heroValue)}</span>
      </Hero>
      <Sub>{heroSub}</Sub>
      <Facts items={[
        { label: "Per week",     value: perWeek != null ? fmtHrs(perWeek) : "—", muted: perWeek == null },
        { label: "Per worker",   value: perWorkerPerWeek != null ? fmtHrs(perWorkerPerWeek) : "—", muted: perWorkerPerWeek == null },
        { label: "Budget left",
          value: isOver ? <ArrowFigure v={Math.abs(dollarsLeft)} size="value" /> : fmt$(dollarsLeft ?? 0),
          tone: isOver ? "bad" : "good" },
        { label: "Blended rate", value: `$${rate.toFixed(2)}/hr` },
      ]} />
    </SignalCard>
  );
}

// ── Payroll data (action card) ────────────────────────────────────
// V32-10/V32-11. V34 - unapproved > 0 -> warn; complete -> good;
// no worker-weeks yet -> neutral. Unapproved hrs and Will rise carry
// the same tone the card carries; complete periods render `none` at
// good tone (not an em-dash).
function PayrollDataCard({ board, freshness }) {
  const pd = board?.payroll_data;
  const priced = pd?.priced_ww ?? 0;
  const total = pd?.total_ww ?? 0;
  const unpricedHrs = pd?.unpriced_hours ?? 0;
  const unapprovedWeeks = pd?.unapproved_weeks ?? 0;
  const rate = board?.avg_rate;
  const hasUnapproved = unpricedHrs > 0.004;
  const state = total === 0 ? "neutral" : hasUnapproved ? "warn" : "good";
  const label = total === 0 ? "—" : hasUnapproved ? "PARTIAL" : "FINAL";
  const willRise = (hasUnapproved && rate != null && rate > 0) ? unpricedHrs * rate : null;
  const willRiseTitle = willRise != null
    ? `Estimate. ${fmtHrs(unpricedHrs)} unapproved hrs x $${rate.toFixed(2)} blended rate. Unapproved hours skew to whoever has not been processed, so their true rate may differ from the blend.`
    : "";
  const lastPulled = freshness?.last_walk_at
    ? new Date(freshness.last_walk_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "—";

  return (
    <SignalCard state={state}>
      <Head eyebrow="PAYROLL DATA" state={state} label={label} />
      <Hero>
        <span className="kpi-sig-hero-val num">{priced} of {total}</span>
      </Hero>
      <Sub>worker-weeks with pay data in</Sub>
      {hasUnapproved && (
        <div className="kpi-sig-action-line">
          {fmtHrs(unpricedHrs)} hrs need approval in Rippling
        </div>
      )}
      <Facts items={[
        // V34 - `none` at good tone on complete periods (was an em-dash
        // in the muted style, which read as "no data" rather than "all
        // approved"). Warn tone + hour count when there IS an ask.
        { label: "Unapproved hrs",
          value: hasUnapproved ? fmtHrs(unpricedHrs) : "none",
          tone: hasUnapproved ? "warn" : "good" },
        {
          label: <span className="kpi-sig-fact-est" title={willRiseTitle}>Will rise</span>,
          value: hasUnapproved ? (willRise != null ? `~ ${fmt$(willRise)}` : "—") : "none",
          tone: hasUnapproved ? "warn" : "good",
        },
        // V34 - same "none @ good" pattern as unapproved / will rise so a
        // closed period never renders an em-dash on a payroll fact.
        { label: "Weeks affected",
          value: unapprovedWeeks > 0 ? `${unapprovedWeeks}` : "none",
          tone: unapprovedWeeks > 0 ? "warn" : "good" },
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
