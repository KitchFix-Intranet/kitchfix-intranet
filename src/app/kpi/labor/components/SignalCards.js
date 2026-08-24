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

// PR-E - card-level help copy per kitchfix-help-copy.html.
// One body per signal card, verbatim. Kept out-of-render so the
// component bodies stay readable and Playwright can grep for the
// verbatim text.
const PACE_BODY = (
  <>
    Whether you are ahead or behind if the period&apos;s budget were spent evenly, day by day.
    <br /><br />
    <b>Down and green means behind the even line</b> - you have spent less than the calendar says you could have. Up and red means ahead of it.
    <br /><br />
    Being ahead is not automatically bad. A period with a heavy homestand early and a road trip after should run ahead in week one. What matters is whether the rest of the period has enough left in it.
    <span className="kpi-hs-pop-foot"><b>Projected end</b> takes your pace so far and runs it to the end of the period. It assumes the rest looks like what you have done, which is why a homestand that has not happened yet can move it.</span>
  </>
);

const OVERTIME_BODY = (
  <>
    Overtime hours as a share of all hours worked. <b>5.9% means about six of every hundred hours were paid at time and a half.</b>
    <br /><br />
    Overtime is not automatically a problem. The 40-hour clock resets every Monday, so a week with a lot of games packed into it carries overtime no matter how you schedule it - that is the calendar, not the crew.
    <br /><br />
    <b>Worth a look when</b> the same one or two people carry all of it, or when a light week still shows a high number.
    <span className="kpi-hs-pop-foot"><b>Hrs to target</b> is how many overtime hours you would need to shed to land on the 8% line. <b>Peak OT week</b> names the worst single week so you know where to look.</span>
  </>
);

const HOURS_LEFT_BODY = (
  <>
    How many more hours you can put on the schedule and still land on budget. <b>Budget left divided by your blended rate.</b>
    <br /><br />
    <b>Per week</b> spreads it evenly across the weeks remaining. <b>Per worker</b> divides that across your current crew - roughly what each person can still work.
    <br /><br />
    This is a ceiling, not a plan. It assumes your rate holds. If the weeks ahead carry overtime, those hours cost more and the real ceiling is lower.
    <span className="kpi-hs-pop-foot"><b>Blended rate</b> is total dollars over total hours - your actual average cost per hour, overtime included, not anyone&apos;s base wage.</span>
  </>
);

const PAYROLL_BODY = (
  <>
    How complete this period&apos;s numbers are. <b>10 of 10 means every person-week has pay data from Rippling</b> - nothing is missing.
    <br /><br />
    <b>Unapproved</b> is hours clocked but not yet approved by a manager. Rippling does not calculate pay until someone approves, so those hours carry no dollars yet and your spend will rise when they do.
    <br /><br />
    <b>Read this card first when a number looks too low.</b> Usually the answer is here.
    <span className="kpi-hs-pop-foot"><b>Final</b> means the period is closed and everything is in. <b>Partial</b> means hours are still landing.</span>
  </>
);
// PR-A - pure fact builders live in a plain-JS module so a Node probe
// can construct synthetic board payloads and assert without JSX
// compilation. The JSX render below consumes the same models; probe
// green implies the client would render green on the same inputs.
import {
  buildPaceCardModel,
  buildHoursLeftModel,
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
function PaceCard({ board }) {
  const m = buildPaceCardModel(board);
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
        { label: "OT workers", value: workersTotal > 0 ? `${otWorkers} of ${workersTotal}` : "—" },
        { label: "Peak OT week", value: longest ? `${longest.week_start.slice(5).replace("-", "/")} · ${fmtHrs(longest.hours)}` : "—", muted: !longest },
      ]} />
    </SignalCard>
  );
}

// ── Hours vs budget / Hours left to schedule ─────────────────────
// V32-8/V32-9. V34 - state is CONTEXTUAL. V35-2 - the card takes
// TWO shapes:
//   in progress: eyebrow HOURS LEFT TO SCHEDULE, hero = hours you
//     can still schedule, facts = per-week burn view.
//   closed:      eyebrow HOURS VS BUDGET, hero = signed delta hrs
//     (arrow + colour), facts = Budgeted / Used / Unused-or-Overrun
//     / Blended rate. The fact set swaps between shapes - it does
//     not dash out a fact that never applied.
// PR-A - HoursLeftCard is a thin JSX render over buildHoursLeftModel
// (signalCardModels.js). multi_period + running week uses the in-progress
// shape; multi_period fully closed returns { hidden: true } and this
// component returns null (card absent, not zeroed).
function HoursLeftCard({ board, salary }) {
  const m = buildHoursLeftModel(board, salary);
  if (m.hidden) return null;
  const hero = m.heroMute
    ? <span className="kpi-sig-hero-mute">—</span>
    : m.hero?.shape === "arrow"
      ? <ArrowFigure v={m.hero.v} size={m.hero.size} fmt={m.hero.fmt === "hrs" ? fmtHrs : fmt$} />
      : <span className={`kpi-sig-hero-val num ${m.hero?.over ? "kpi-sig-hero-bad" : ""}`}>{m.hero?.value}</span>;
  return (
    <SignalCard state={m.state}>
      <Head eyebrow={m.eyebrow} state={m.state} label={m.label} help={<HelpPop id="qHoursLeft" title="Hours left to schedule" body={HOURS_LEFT_BODY} />} />
      <Hero>{hero}</Hero>
      <Sub>{m.subMute ? <span className="kpi-sig-sub-mute">{m.subMute}</span> : m.heroSub}</Sub>
      <Facts items={renderFacts(m.facts)} />
    </SignalCard>
  );
}

// ── Payroll data (action card) ────────────────────────────────────
// V32-10/V32-11. V34 - unapproved > 0 -> warn; complete -> good;
// no worker-weeks yet -> neutral. Unapproved hrs and Will rise carry
// the same tone the card carries; complete periods render `none` at
// good tone (not an em-dash).
function PayrollDataCard({ board, freshness, salary }) {
  const pd = board?.payroll_data;
  const priced = pd?.priced_ww ?? 0;
  const total = pd?.total_ww ?? 0;
  const unpricedHrs = pd?.unpriced_hours ?? 0;
  const unapprovedWeeks = pd?.unapproved_weeks ?? 0;
  // Salary PR 3 - Will rise = unapproved HOURS * rate. Rate MUST be
  // the hourly-only rate, not the merged board's avg_rate (which is
  // mixed dollars over hourly hours). Unapproved hours are hourly
  // hours by construction (salaried people do not clock in - S1h
  // proves it), so multiplying by blended_rate_hourly is correct.
  const rateBasisHourlyOnly = salary?.rate_basis === "hourly_only";
  const rate = salary?.blended_rate_hourly ?? board?.avg_rate;
  const workers = board?.distinct_workers ?? 0;
  const closedWeeks = board?.closed_weeks_count ?? 0;
  // PR-A - weeks denominator: single_period uses weeks_in_period (4);
  // multi_period uses weeks_in_range (total in the range - e.g. 35 for
  // FYTD). Both fields ship on every board response; whichever is
  // populated for this kind is what we read.
  const weeksInPeriod = board?.weeks_in_period ?? board?.weeks_in_range;
  const hasUnapproved = unpricedHrs > 0.004;
  const state = total === 0 ? "neutral" : hasUnapproved ? "warn" : "good";
  const label = total === 0 ? "—" : hasUnapproved ? "PARTIAL" : "FINAL";
  // V42 REVISED (C2) - route through the shared estimator so the
  // week-bar hatched cap and this "Will rise" figure can never
  // disagree to the cent. See src/lib/labor/estimateUnpricedDollars.js
  // for the signal-source rationale (unpriced_hrs, not draft_hours).
  const willRise = estimateUnpricedDollars(unpricedHrs, rate);
  const rateLabelInTitle = rateBasisHourlyOnly ? "hourly rate" : "blended rate";
  const willRiseTitle = willRise != null
    ? `Estimate. ${fmtHrs(unpricedHrs)} unapproved hrs x $${rate.toFixed(2)} ${rateLabelInTitle}. Unapproved hours skew to whoever has not been processed, so their true rate may differ from the ${rateBasisHourlyOnly ? "hourly average" : "blend"}.`
    : "";
  // PR-B - "Last pulled Aug 24" gets time-of-day suffix per owner
  // ruling 2026-08-24. Reads like "Aug 24 · 7:36 AM" so an operator
  // knows how fresh the read is at a glance.
  const lastPulled = freshness?.last_walk_at
    ? new Date(freshness.last_walk_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      + " · "
      + new Date(freshness.last_walk_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "—";

  // V35-3 - the fact set SWAPS between "there is an ask" and
  // "everything is in". Complete periods report the crew + week
  // coverage; incomplete periods report the ask that has to be
  // resolved. Same rule as Hours: swap the set, do not dash it out.
  const facts = hasUnapproved
    ? [
        { label: "Unapproved hrs", value: fmtHrs(unpricedHrs), tone: "warn" },
        // PR-B - Will rise no longer carries a dotted-underline `?`
        // affordance. Verified live 2026-08-24: the tooltip renders
        // nothing, so the affordance was a promise the UI did not
        // keep. Figure stays; the label is plain text now.
        { label: "Will rise",
          value: willRise != null ? `~ ${fmt$(willRise)}` : "—", tone: "warn" },
        { label: "Weeks affected", value: `${unapprovedWeeks}`, tone: "warn" },
        { label: "Last pulled", value: lastPulled },
      ]
    : [
        { label: "Unapproved", value: "none", tone: "good" },
        { label: "Workers", value: workers > 0 ? `${workers}` : "—" },
        { label: "Weeks",
          value: weeksInPeriod ? `${closedWeeks} of ${weeksInPeriod}` : (closedWeeks > 0 ? `${closedWeeks}` : "—") },
        { label: "Last pulled", value: lastPulled },
      ];

  return (
    <SignalCard state={state}>
      <Head eyebrow="PAYROLL DATA" state={state} label={label} help={<HelpPop id="qPayrollData" title="Payroll data" body={PAYROLL_BODY} />} />
      <Hero>
        <span className="kpi-sig-hero-val num">{priced} of {total}</span>
      </Hero>
      {/* PR-B - "worker-weeks with pay data in" -> "pending approval"
          per owner ruling 2026-08-24. Reads as "N of M · pending
          approval" where N is priced (i.e. NOT pending). Kept because
          the sub-line is context for the hero ("N of M"), and the
          reason a row is not counted is precisely: pending approval. */}
      <Sub>pending approval</Sub>
      {hasUnapproved && (
        <div className="kpi-sig-action-line">
          {fmtHrs(unpricedHrs)} hrs need approval in Rippling
        </div>
      )}
      <Facts items={facts} />
    </SignalCard>
  );
}

export function SignalCards({ board, freshness, salary }) {
  if (!board || board.applies === false) return null;
  return (
    <div className="kpi-sigs">
      <PaceCard board={board} />
      <OvertimeCard board={board} salary={salary} />
      <HoursLeftCard board={board} salary={salary} />
      <PayrollDataCard board={board} freshness={freshness} salary={salary} />
    </div>
  );
}
