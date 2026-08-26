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

// 2026-08-26 approvals card - rewrite from CC_PROMPT_APPROVALS_CARD.md.
// The card renamed from "Payroll data" to "Approvals" - that is the
// job an operator does in Rippling and the card hands it to them.
// Popover copy verbatim from the spec's five-paragraph body.
const APPROVALS_BODY = (
  <>
    Hours your crew has worked that nobody has approved yet.
    <br /><br />
    Two separate things happen to every hour. Rippling works out what it costs on its own, as soon as someone clocks out. A manager approving it is a second step, and it often happens days later.
    <br /><br />
    This card is the second step - the part that needs a person.
    <br /><br />
    <b>Oldest shift</b> is the one to watch. A shift sitting a month is a shift that may have missed its payroll.
    <br /><br />
    <b>Still costing</b> means approved but the money has not posted yet. It resolves on its own.
    <span className="kpi-hs-pop-foot"><b>Hourly only, always</b> - salaried staff do not clock in.</span>
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
function PaceCard({ board, approvalsHourly }) {
  const m = buildPaceCardModel(board);
  // 2026-08-26 - draft hours annotation on Covers comes from the
  // hourly-only pinned source. Salaried staff never clock in, so this
  // is technically hourly by construction, but reading from the pinned
  // field enforces the discipline structurally.
  const covers = buildCoversLine(board, "pace", {
    draftHoursHourly: approvalsHourly?.draft_hours ?? 0,
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
  // 2026-08-26 polish round 2 item 3 - "Hrs to target 27.83" at 0% OT
  // reads like a goal to reach; an operator does not want to reach an
  // overtime target. Label swap: "Headroom" when under, "Hrs over
  // target" when over (unchanged - already correct on CIN-OH at
  // 9.6%). Watch band still tones warn because the operator IS
  // approaching the ceiling; only the label changed.
  const hoursFact = remaining == null
    ? { label: "Headroom", value: "—", muted: true }
    : overTarget
      ? { label: "Hrs over target", value: fmtHrs(Math.abs(remaining)), tone: "bad" }
      : { label: "Headroom", value: `${fmtHrs(remaining)} hrs`, tone: state === "warn" ? "warn" : "good" };

  // V34 sub-line copy. Salary PR 3 C2 - when salary is on, OT % is
  // a share of HOURLY cost. 2026-08-26 polish round 2 item 3 - at
  // exactly 0% OT the "watch above 0%" copy implies an active watch
  // state that is not active; substitute a plain "no overtime"
  // statement so the sub-line matches the ON TARGET pill.
  const boundsCopy = salary
    ? "share of hourly cost"
    : pct === 0 && watch != null && alarm != null
      ? `no overtime ${board?.kind === "multi_period" ? "in range" : "this period"} · off target above ${alarm}%`
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
        // 2026-08-26 polish round 2 item 3 - Peak OT week ABSENT (not
        // dashed) when there is no OT. Standing rule: a fact whose
        // premise does not hold is gone, not "—". Wrap in conditional
        // spread so an empty pill collapses out of the grid.
        ...(longest ? [{ label: "Peak OT week", value: `${longest.week_start.slice(5).replace("-", "/")} · ${fmtHrs(longest.hours)}` }] : []),
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

// ── Approvals (action card) ───────────────────────────────────────
// Renamed 2026-08-26 from Payroll data. That is the job an operator
// does in Rippling and the card hands it to them. Reads from
// approvalsHourly unconditionally (round 1 pinning discipline; the
// salary toggle cannot reach this card by construction).
//
// Pill logic - reflects the AGE of the oldest draft, not just its
// existence. Owner ruling 2026-08-26 after finding a 29-day-old
// unapproved shift on STL - FL in a closed period - a real
// operational miss that no volume-based signal would have caught.
// Age is the signal, not volume.
//
//   nothing unapproved                 -> "ALL CLEAR"     green
//   immaterial (< 1% of hours)         -> "ALL CLEAR"     green
//                                          (round 2 materiality rule)
//   oldest draft <= 7 days             -> "THIS WEEK"     amber
//   oldest draft > 7  and <= 14 days   -> "N DAYS OLD"    amber
//   oldest draft > 14 days             -> "N DAYS OLD"    red
//   oldest_draft_date NULL with drafts -> "N DAYS OLD" state cannot
//                                          be computed; treat as
//                                          amber "PENDING" - the
//                                          absent-on-premise-fail
//                                          rule bites the Oldest
//                                          shift fact, not the pill.
//                                          (In practice: drafts + no
//                                          date only happens when
//                                          the derive has not run
//                                          since v43-1 apply.)
//
// Layout - three paths keyed on materiality:
//   1. NO DRAFTS       -> ALL CLEAR pill, "All in" hero, "every
//                         shift approved" sub, Approved + Coverage
//                         facts.
//   2. IMMATERIAL      -> ALL CLEAR pill, hero shows the residual
//                         hours (nothing is hidden), sub calls it
//                         out honestly.
//   3. MATERIAL        -> age-based amber/red pill, hero = drafts,
//                         sub = "need your approval · across N people".
//                         Facts: Approved so far (green), Oldest
//                         shift (date only - NO days suffix; pill
//                         carries the age, no duplication), Still
//                         costing (muted), Weeks affected.
//
// V42 distinction preserved: Will rise still reads unpriced_hours;
// the pending hero still reads draft_hours. Approved so far reads
// approved_hours (v43-1, new).
function ApprovalsCard({ board, freshness, approvalsHourly, hoursAvailableHourly }) {
  const priced = approvalsHourly?.priced_ww ?? 0;
  const total = approvalsHourly?.total_ww ?? 0;
  const unpricedHrs = approvalsHourly?.unpriced_hours ?? 0;
  const draftHrs = approvalsHourly?.draft_hours ?? 0;
  const totalHours = approvalsHourly?.total_hours ?? 0;
  const unapprovedWeeks = approvalsHourly?.unapproved_weeks ?? 0;
  const approvedHours = approvalsHourly?.approved_hours ?? 0;
  const stillCostingHours = approvalsHourly?.still_costing_hours ?? 0;
  const oldestDraftDate = approvalsHourly?.oldest_draft_date ?? null;
  const approvalPeople = approvalsHourly?.approval_people ?? 0;
  const rate = hoursAvailableHourly?.avg_rate ?? board?.avg_rate;
  const workers = hoursAvailableHourly?.distinct_workers ?? 0;
  const closedWeeks = board?.closed_weeks_count ?? 0;
  const weeksInPeriod = board?.weeks_in_period ?? board?.weeks_in_range;
  const hasUnapproved = draftHrs > 0.004;
  const hasWillRise = unpricedHrs > 0.004;
  // Materiality (round 2): draft_hours / total_hours. Strict < 1%
  // (owner ruling: warn when in doubt, so exactly 1% reads material).
  const materialityFrac = totalHours > 0 ? draftHrs / totalHours : 0;
  const isMaterial = hasUnapproved && materialityFrac >= 0.01;
  const isImmaterial = hasUnapproved && !isMaterial;
  const scopeWord = board?.kind === "multi_period" ? "in range" : "this period";
  const willRise = estimateUnpricedDollars(unpricedHrs, rate);
  const covers = buildCoversLine(board, "payroll_data");

  // Age-based pill (only bites on MATERIAL). Owner directive: dedup
  // pill and Oldest shift fact - pill carries the age, fact carries
  // the date. Drop "· N days" from the fact so the two do not restate
  // each other (same lesson as the bank figure).
  const pillFromAge = (() => {
    if (!hasUnapproved || !isMaterial) return { state: "good", label: "ALL CLEAR" };
    if (!oldestDraftDate) return { state: "warn", label: "PENDING" };  // NULL - do not claim an age
    const oldestDays = daysSince(oldestDraftDate);
    if (oldestDays > 14) return { state: "bad",  label: `${oldestDays} DAYS OLD` };
    if (oldestDays > 7)  return { state: "warn", label: `${oldestDays} DAYS OLD` };
    return { state: "warn", label: "THIS WEEK" };
  })();
  const oldestDaysForFact = oldestDraftDate ? daysSince(oldestDraftDate) : null;
  // Oldest shift fact tone tracks pill severity so red-pill + red-fact
  // read as one signal. Absent when oldestDraftDate NULL (owner rule:
  // NULL means "we do not know", not "nothing is old" and not green).
  const oldestFactTone = pillFromAge.state === "bad" ? "bad"
                       : pillFromAge.state === "warn" ? "warn"
                       : null;

  // Paths 1 + 2: no material drafts -> ALL CLEAR pill.
  // Path 1 (no drafts at all) keeps the current coverage-hero shape.
  // Path 2 (immaterial residual) shows the residual as hero so nothing
  // is hidden, but the pill softens.
  if (!hasUnapproved) {
    return (
      <SignalCard state={pillFromAge.state}>
        <Head eyebrow="APPROVALS" state={pillFromAge.state} label={pillFromAge.label} help={<HelpPop id="qApprovals" title="Approvals" body={APPROVALS_BODY} />} />
        <Hero>
          <span className="kpi-sig-hero-val num">All in</span>
        </Hero>
        <Sub>every shift approved</Sub>
        <Facts items={[
          { label: "Approved", value: `${fmtHrs(approvedHours)} hrs`, tone: "good" },
          { label: "Coverage", value: total > 0 ? `${priced} of ${total}` : "—" },
        ]} />
        <Covers text={covers} />
      </SignalCard>
    );
  }
  if (isImmaterial) {
    return (
      <SignalCard state={pillFromAge.state}>
        <Head eyebrow="APPROVALS" state={pillFromAge.state} label={pillFromAge.label} help={<HelpPop id="qApprovals" title="Approvals" body={APPROVALS_BODY} />} />
        <Hero>
          <span className="kpi-sig-hero-val num">
            {fmtHrs(draftHrs)}<span className="kpi-sig-hero-unit">hrs</span>
          </span>
        </Hero>
        <Sub>need approval · under 1% of hours {scopeWord}</Sub>
        <Facts items={[
          { label: "Weeks affected", value: `${unapprovedWeeks}` },
          { label: "Coverage", value: total > 0 ? `${priced} of ${total}` : "—" },
        ]} />
        <Covers text={covers} />
      </SignalCard>
    );
  }

  // Path 3: MATERIAL. Age-based pill (already computed above).
  return (
    <SignalCard state={pillFromAge.state}>
      <Head eyebrow="APPROVALS" state={pillFromAge.state} label={pillFromAge.label} help={<HelpPop id="qApprovals" title="Approvals" body={APPROVALS_BODY} />} />
      <Hero>
        <span className={`kpi-sig-hero-val num ${pillFromAge.state === "bad" ? "kpi-sig-hero-bad" : "kpi-sig-hero-warn"}`}>
          {fmtHrs(draftHrs)}<span className="kpi-sig-hero-unit">hrs</span>
        </span>
      </Hero>
      <Sub>need your approval · across <b>{approvalPeople} {approvalPeople === 1 ? "person" : "people"}</b></Sub>
      <Facts items={[
        { label: "Approved so far", value: `${fmtHrs(approvedHours)} hrs`, tone: "good" },
        // Oldest shift - date only. Pill above carries the age. Owner
        // directive: dedup - pill and fact must not restate each other.
        // Absent (not "—", not green) when oldestDraftDate NULL.
        ...(oldestDraftDate ? [{
          label: "Oldest shift",
          value: fmtShortDate(oldestDraftDate),
          tone: oldestFactTone,
        }] : []),
        // Still costing - the fourth box, muted. Resolves on its own;
        // no operator action. Absent when zero (standing rule: a fact
        // whose premise does not hold is gone, not dashed).
        ...(stillCostingHours > 0.004 ? [{
          label: "Still costing",
          value: `${fmtHrs(stillCostingHours)} hrs`,
          muted: true,
        }] : []),
        { label: "Weeks affected", value: `${unapprovedWeeks}`, tone: "warn" },
      ]} />
      <Covers text={covers} />
    </SignalCard>
  );
}

// Whole-day integer offset between an ISO date (YYYY-MM-DD) and today,
// UTC-based to match the derive's date arithmetic (start_time is UTC
// ISO from Rippling). Returns 0 for same day, positive for past dates.
function daysSince(iso) {
  const then = new Date(`${iso}T00:00:00.000Z`);
  const now = new Date();
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.floor((nowUtc - then.getTime()) / 86400000));
}
function fmtShortDate(iso) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// 2026-08-26 signal card revisions - `hoursAvailableHourly` and
// `approvalsHourly` are server-pinned hourly-only inputs (see
// salaryBoard.js `pinHourlyOnly`). Passed unconditionally; the two
// hourly-only cards NEVER read salary-inflated numbers regardless of
// the salary prop. Owner ruling: "if the read is unconditional, the
// toggle cannot reach these two cards by construction."
//
// v43-1 (2026-08-26): PayrollDataCard renamed to ApprovalsCard; prop
// renamed from payrollCoverageHourly to approvalsHourly. Card name and
// field name now match. The salary prop stays wired ONLY for the
// Overtime card's sub-line copy (a share-of-hourly-cost label).
export function SignalCards({ board, freshness, salary, isFutureRange, hoursAvailableHourly, approvalsHourly }) {
  if (!board || board.applies === false) return null;
  // Owner ruling 2026-08-24: a future range (server flag
  // `is_future_range`, true when start > today) hides Pace, Overtime,
  // and Approvals - the premise of each fails on a range that hasn't
  // started (no pace, no overtime hours, no approvals to work). Hours
  // available hides itself on any range other than
  // single_period_in_progress.
  return (
    <div className="kpi-sigs">
      {!isFutureRange && <PaceCard board={board} approvalsHourly={approvalsHourly} />}
      {!isFutureRange && <OvertimeCard board={board} salary={salary} />}
      <HoursLeftCard board={board} hoursAvailableHourly={hoursAvailableHourly} />
      {!isFutureRange && <ApprovalsCard board={board} freshness={freshness} approvalsHourly={approvalsHourly} hoursAvailableHourly={hoursAvailableHourly} />}
    </div>
  );
}
