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
import { estimateUnpricedDollars } from "@/lib/labor/estimateUnpricedDollars";
import HelpPop from "./HelpPop.js";

// PR-E - card-level help copy per kitchfix-help-copy.html; 2026-08-26
// rewritten from kitchfix-card-revisions.html. One body per signal
// card, verbatim from the owner-approved render. Kept out-of-render
// so the component bodies stay readable and Playwright can grep for
// the verbatim text. The thing that changed in all four: each now
// states what the card does NOT count, not just what it does - that
// omission is what caused the confusion.
const PACE_BODY = (
  <>
    Whether you are ahead or behind if the period&apos;s budget were spent evenly, day by day.
    <br /><br />
    <b>Down and green means behind the even line</b> - you have spent less than the calendar says you could have. Up and red means ahead of it.
    <br /><br />
    Being ahead is not automatically bad. A period with a heavy homestand early should run ahead in week one. What matters is whether the rest of the period has enough left in it.
    <span className="kpi-hs-pop-foot"><b>Projected end</b> is where you finish if the rest of the period looks like what you have done so far. <b>Vs budget</b> is how far that lands over or under.<br /><br /><b>Covers</b> tells you which weeks are in these figures - a week still running is included at whatever has been clocked so far.</span>
  </>
);

const OVERTIME_BODY = (
  <>
    Overtime hours as a share of all hours worked. <b>5.3% means about five of every hundred hours were paid at time and a half.</b>
    <br /><br />
    Overtime is not automatically a problem. The 40-hour clock resets every Monday, so a week with a lot of games packed into it carries overtime no matter how you schedule it - that is the calendar, not the crew.
    <br /><br />
    <b>Worth a look when</b> the same one or two people carry all of it, or when a light week still shows a high number.
    <span className="kpi-hs-pop-foot"><b>Week workers OT</b> is how many of the crew had any overtime. <b>Peak OT week</b> names the worst single week so you know where to look.<br /><br /><b>Covers</b> tells you which weeks are in these figures.</span>
  </>
);

const HOURS_LEFT_BODY = (
  <>
    How many more hours you can put on the schedule and still land on budget for this period. <b>Budget left divided by your blended rate.</b>
    <br /><br />
    <b>Per week</b> spreads it across the weeks remaining, so it is the number to build next week&apos;s schedule against.
    <br /><br />
    This is a ceiling, not a plan. It assumes your rate holds - if the weeks ahead carry overtime, those hours cost more and the real ceiling is lower.
    <span className="kpi-hs-pop-foot"><b>Hourly only, always.</b> Salaried staff are not scheduled by the hour, so the salary toggle does not change this card.<br /><br />The card only appears on a period that is still running. On a finished period there are no hours left to schedule.</span>
  </>
);

const PAYROLL_BODY = (
  <>
    Hours clocked in Rippling that a manager has not approved yet.
    <br /><br />
    <b>Rippling calculates the pay as soon as hours are clocked, but approval is a separate step.</b> So the money can be complete and the hours still be waiting on a signature. <b>Will rise</b> is what this period grows by once they are approved.
    <br /><br />
    <b>Read this card first when a number looks too low.</b> Usually the answer is here.
    <span className="kpi-hs-pop-foot"><b>Coverage</b> is how many worker-weeks have pay data at all - a different question from approval.<br /><br /><b>Hourly only, always.</b> Salaried staff do not clock in, so the salary toggle does not change this card.</span>
  </>
);
// PR-A - pure fact builders live in a plain-JS module so a Node probe
// can construct synthetic board payloads and assert without JSX
// compilation. The JSX render below consumes the same models; probe
// green implies the client would render green on the same inputs.
import {
  buildPaceCardModel,
  buildHoursLeftModel,
  buildCoversLine,
  pillFor as _pillForShared,
} from "../lib/signalCardModels.js";

// V34 - the pill and the card stripe come from ONE expression per card.
// Each caller derives its `state`; Head renders the pill from the same
// value so they can never disagree.
// PR-E - optional `help` slot renders a ? popover to the right of the
// state pill. Wired for the four signal cards per kitchfix-help-copy.
function Head({ eyebrow, state, label, help }) {
  return (
    <div className="kpi-sig-head">
      <span className="kpi-sig-eyebrow">{eyebrow}</span>
      <span className={`kpi-sig-state kpi-sig-state-${state}`}>{label}</span>
      {help}
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

// 2026-08-26 signal card revisions - Covers dashed line pinned to the
// card foot below the facts. `text` is derived by buildCoversLine in
// signalCardModels.js from `board.weeks[]` counters; null means the
// card kind has no meaningful coverage answer and no line renders.
function Covers({ text }) {
  if (!text) return null;
  return <div className="kpi-sig-covers"><b>Covers</b>{" "}{text.replace(/^Covers\s+/, "")}</div>;
}

// ── Pace / Final vs budget ────────────────────────────────────────
// V32-1..V32-4. State-dependent. PR-A: multi_period is a third state
// (see signalCardModels.js for the model). This component is a thin
// JSX render over the model.
function renderFactValue(value) {
  if (value && typeof value === "object" && value.shape === "arrow") {
    return <ArrowFigure v={value.v} size={value.size} fmt={value.fmt === "hrs" ? fmtHrs : fmt$} />;
  }
  return value;
}
function renderFacts(items) {
  return items.map(it => ({ ...it, value: renderFactValue(it.value) }));
}
function PaceCard({ board, payrollCoverageHourly }) {
  const m = buildPaceCardModel(board);
  // 2026-08-26 - draft hours annotation on Covers comes from the
  // hourly-only pinned source. Salaried staff never clock in, so this
  // is technically hourly by construction, but reading from the pinned
  // field enforces the discipline structurally.
  const covers = buildCoversLine(board, "pace", {
    draftHoursHourly: payrollCoverageHourly?.draft_hours ?? 0,
  });
  return (
    <SignalCard state={m.state}>
      <Head eyebrow={m.eyebrow} state={m.state} label={m.label} help={<HelpPop id="qPace" title="Spending pace" body={PACE_BODY} />} />
      <Hero>
        {m.heroMute ? <span className="kpi-sig-hero-mute">—</span> : <ArrowFigure v={m.heroV} size="hero" />}
      </Hero>
      <Sub>
        {m.subMute ? <span className="kpi-sig-sub-mute">{m.subMute}</span> : m.subLine}
      </Sub>
      <Facts items={renderFacts(m.facts)} />
      <Covers text={covers} />
    </SignalCard>
  );
}

// PR-A - pillFor moved into signalCardModels.js so the pure model
// path uses it too; keep a local alias for any legacy callers here.
const pillFor = _pillForShared;

// ── Overtime ──────────────────────────────────────────────────────
// V32-5..V32-7. Thresholds come from server config (never hardcoded).
// V34 - state IS the pill tone: clear=good, watch=warn, alarm=bad.
// Hrs to target carries the same tone as the state (headroom good,
// close to limit watch, past limit bad).
function OvertimeCard({ board, salary }) {
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

  // V34 sub-line copy. Salary PR 3 C2 - when salary is on, OT % is
  // a share of HOURLY cost (spec explicit: putting salary into that
  // denominator would silently improve OT from 13% to 8% with
  // nobody doing anything). Sub-line labels the basis so the reader
  // sees the number and knows what it is a share of.
  const boundsCopy = salary
    ? "share of hourly cost"
    : (watch != null && alarm != null
      ? `watch above ${watch}% · off target above ${alarm}%`
      : "of hours worked");

  // 2026-08-26 - "OT workers" -> "Week workers OT" per owner. Same
  // figure (N with any OT / total distinct workers), clearer label.
  const covers = buildCoversLine(board, "overtime");
  return (
    <SignalCard state={state}>
      <Head eyebrow="OVERTIME" state={state} label={label} help={<HelpPop id="qOvertime" title="Overtime" body={OVERTIME_BODY} />} />
      <Hero>
        <span className={`kpi-sig-hero-val num ${heroTone === "bad" ? "kpi-sig-hero-bad" : heroTone === "warn" ? "kpi-sig-hero-warn" : ""}`}>
          {pct.toFixed(1)}%
        </span>
      </Hero>
      <Sub>{boundsCopy}</Sub>
      <Facts items={[
        { label: "OT cost", value: otCost != null ? fmt$(otCost) : "—" },
        hoursFact,
        { label: "Week workers OT", value: workersTotal > 0 ? `${otWorkers} of ${workersTotal}` : "—" },
        { label: "Peak OT week", value: longest ? `${longest.week_start.slice(5).replace("-", "/")} · ${fmtHrs(longest.hours)}` : "—", muted: !longest },
      ]} />
      <Covers text={covers} />
    </SignalCard>
  );
}

// ── Hours available ──────────────────────────────────────────────
// 2026-08-26 signal card revisions - three folded-in rulings:
//   1. Renders ONLY on single_period_in_progress (see model). Absent
//      on closed periods, FYTD, last-4-weeks and any multi-period
//      range.
//   2. Reads from `hoursAvailableHourly` (server-pinned in
//      salaryBoard.js pinHourlyOnly). Unconditional - never branches
//      on the salary prop. That is what makes the toggle unable to
//      reach this card by construction.
//   3. Drops `Per worker` (a fiction: assumed everyone works
//      equally), adds `Weeks left`, sub-line names the period.
function HoursLeftCard({ board, hoursAvailableHourly }) {
  const m = buildHoursLeftModel(board, hoursAvailableHourly);
  if (m.hidden) return null;
  const hero = m.heroMute
    ? <span className="kpi-sig-hero-mute">—</span>
    : m.hero?.shape === "arrow"
      ? <ArrowFigure v={m.hero.v} size={m.hero.size} fmt={m.hero.fmt === "hrs" ? fmtHrs : fmt$} />
      : <span className={`kpi-sig-hero-val num ${m.hero?.over ? "kpi-sig-hero-bad" : ""}`}>{m.hero?.value}</span>;
  const covers = buildCoversLine(board, "hours_available");
  return (
    <SignalCard state={m.state}>
      <Head eyebrow={m.eyebrow} state={m.state} label={m.label} help={<HelpPop id="qHoursLeft" title="Hours available" body={HOURS_LEFT_BODY} />} />
      <Hero>{hero}</Hero>
      <Sub>{m.subMute ? <span className="kpi-sig-sub-mute">{m.subMute}</span> : m.heroSub}</Sub>
      <Facts items={renderFacts(m.facts)} />
      <Covers text={covers} />
    </SignalCard>
  );
}

// ── Payroll data (action card) ────────────────────────────────────
// 2026-08-26 signal card revisions:
//   * READS from payrollCoverageHourly unconditionally. Never branch
//     on the salary prop. Structural pinning: if salary is on, this
//     card must still say the 25 hourly-only worker-weeks and 49.1
//     hourly-only draft hours - not the salary-inflated denominators.
//   * HERO FLIP when hasUnapproved: pending-approval hours become the
//     hero (it is the number someone acts on); coverage drops to a
//     fact. Owner read `2406 of 2406` as an approval figure when it
//     is coverage - the flip fixes that misread. When nothing is
//     pending, the existing "N of N / with pay data in" path stands.
function PayrollDataCard({ board, freshness, payrollCoverageHourly, hoursAvailableHourly }) {
  const priced = payrollCoverageHourly?.priced_ww ?? 0;
  const total = payrollCoverageHourly?.total_ww ?? 0;
  const unpricedHrs = payrollCoverageHourly?.unpriced_hours ?? 0;
  const draftHrs = payrollCoverageHourly?.draft_hours ?? 0;
  const unapprovedWeeks = payrollCoverageHourly?.unapproved_weeks ?? 0;
  // Will-rise estimator needs the hourly rate. The hourly rate is
  // pinned on hoursAvailableHourly.avg_rate (same server helper).
  // Unapproved hours are hourly by construction (salaried never
  // clock in), so multiplication by the hourly rate is correct.
  const rate = hoursAvailableHourly?.avg_rate ?? board?.avg_rate;
  const workers = hoursAvailableHourly?.distinct_workers ?? 0;
  const closedWeeks = board?.closed_weeks_count ?? 0;
  const weeksInPeriod = board?.weeks_in_period ?? board?.weeks_in_range;
  const hasUnapproved = draftHrs > 0.004;
  const hasWillRise = unpricedHrs > 0.004;
  const state = total === 0 ? "neutral" : hasUnapproved ? "warn" : "good";
  const label = total === 0 ? "—" : hasUnapproved ? "PARTIAL" : "FINAL";
  const willRise = estimateUnpricedDollars(unpricedHrs, rate);
  const lastPulled = freshness?.last_walk_at
    ? new Date(freshness.last_walk_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      + " · "
      + new Date(freshness.last_walk_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "—";
  const covers = buildCoversLine(board, "payroll_data");

  // Hero flip: on hasUnapproved, hero is the pending-approval hrs;
  // coverage moves to a fact. On no-unapproved, the existing
  // "N of N / with pay data in" hero stands.
  if (hasUnapproved) {
    return (
      <SignalCard state={state}>
        <Head eyebrow="PAYROLL DATA" state={state} label={label} help={<HelpPop id="qPayrollData" title="Payroll data" body={PAYROLL_BODY} />} />
        <Hero>
          <span className="kpi-sig-hero-val num kpi-sig-hero-warn">{fmtHrs(draftHrs)}</span>
        </Hero>
        <Sub>pending approval in Rippling</Sub>
        <Facts items={[
          ...(hasWillRise ? [{
            label: "Will rise",
            value: willRise != null ? `~ ${fmt$(willRise)}` : "—",
            tone: "warn",
          }] : []),
          { label: "Weeks affected", value: `${unapprovedWeeks}`, tone: "warn" },
          { label: "Coverage", value: total > 0 ? `${priced} of ${total}` : "—" },
          { label: "Last pulled", value: lastPulled },
        ]} />
        <Covers text={covers} />
      </SignalCard>
    );
  }

  // No unapproved: existing coverage-hero path stands.
  return (
    <SignalCard state={state}>
      <Head eyebrow="PAYROLL DATA" state={state} label={label} help={<HelpPop id="qPayrollData" title="Payroll data" body={PAYROLL_BODY} />} />
      <Hero>
        <span className="kpi-sig-hero-val num">{priced} of {total}</span>
      </Hero>
      <Sub>with pay data in</Sub>
      <Facts items={[
        { label: "Unapproved", value: "none", tone: "good" },
        { label: "Workers", value: workers > 0 ? `${workers}` : "—" },
        { label: "Weeks",
          value: weeksInPeriod ? `${closedWeeks} of ${weeksInPeriod}` : (closedWeeks > 0 ? `${closedWeeks}` : "—") },
        { label: "Last pulled", value: lastPulled },
      ]} />
      <Covers text={covers} />
    </SignalCard>
  );
}

// 2026-08-26 signal card revisions - `hoursAvailableHourly` and
// `payrollCoverageHourly` are server-pinned hourly-only inputs (see
// salaryBoard.js `pinHourlyOnly`). Passed unconditionally; the two
// hourly-only cards NEVER read salary-inflated numbers regardless of
// the salary prop. Owner ruling: "if the read is unconditional, the
// toggle cannot reach these two cards by construction."
//
// The salary prop stays wired ONLY for the Overtime card's sub-line
// copy - a share-of-hourly-cost label rather than a percentage
// interpretation - which is not a numeric change.
export function SignalCards({ board, freshness, salary, isFutureRange, hoursAvailableHourly, payrollCoverageHourly }) {
  if (!board || board.applies === false) return null;
  // Owner ruling 2026-08-24: a future range (server flag
  // `is_future_range`, true when start > today) hides Pace, Overtime,
  // and Payroll Data - the premise of each fails on a range that
  // hasn't started (no pace, no overtime hours, no payroll coverage
  // yet). HoursLeftCard now itself hides on any range other than
  // single_period_in_progress, so its future-range behaviour comes
  // from the model rather than a wrapper guard.
  return (
    <div className="kpi-sigs">
      {!isFutureRange && <PaceCard board={board} payrollCoverageHourly={payrollCoverageHourly} />}
      {!isFutureRange && <OvertimeCard board={board} salary={salary} />}
      <HoursLeftCard board={board} hoursAvailableHourly={hoursAvailableHourly} />
      {!isFutureRange && <PayrollDataCard board={board} freshness={freshness} payrollCoverageHourly={payrollCoverageHourly} hoursAvailableHourly={hoursAvailableHourly} />}
    </div>
  );
}
