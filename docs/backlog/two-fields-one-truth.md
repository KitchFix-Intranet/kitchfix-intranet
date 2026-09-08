# Two fields, one truth - a recurring class

**Filed:** 2026-09-09. Four instances of the same shape found this week (three shipped, one ruled park).
**Status:** Report + ruling deferred until after training.
**Trigger to unpark:** post-training week, after Kevin has bandwidth to review the shape rather than each instance separately.

---

## What the class is

Two DB fields carry the same fact. Neither is designated authoritative. The code reads whichever field the writer happened to think of first. When the two fields disagree, the render is a wrong number or a wrong landing — with no error, no exception, no signal that the mismatch exists.

## The three instances found this week

### 1. detectMonthOff (PR #1058)

**Two fields**: `sc_homestand_schedule.day_type` (schedule truth from `.game_pk` + Rippling-adjacent loaders) vs `sc_daily_revenue.actual_revenue` + `.actual_count` (fact of what was served).

**The disagreement**: `MonthCard.detectNoService` read the homestand schedule as its "is this month off" truth source. Ignored actuals entirely. If the schedule table had zero games for a month (typical for a future month whose schedule hadn't been populated) but actuals + covers existed, MonthCard rendered the month as OFF while SeasonRail correctly rendered it IN-SERVICE.

**Blast radius before fix**: 40 of 132 (account, month) pairs on the FY2026 scan rendered wrong on the calendar grid.

**The load-bearing code comment shipped with the fix**:
> *"A schedule is a plan; revenue and covers are facts. A month with actuals is a month that happened, regardless of what any schedule says."*

**Fix shape**: one shared predicate `detectMonthOff` reading only actuals + covers. Schedule signal dropped as truth source.

### 2. seasonView vs lens (PR #1068)

**Two fields**: `ServiceCalendar.js:522` `lens` state vs `ServiceCalendar.js:3100` `seasonView` state. Both drive "which tab is active on the Season overview" but they are independently initialized and independently written.

**The disagreement**: Two prior fixes (SC cleanup item 1 + PR #1059) changed `lens` to default to `"period"`. Neither wrote `seasonView`. The Ribbon tab toggle reads `view={seasonView}`, not `view={lens}`. So `lens` correctly said Period; `seasonView` said Calendar; the tab render read the wrong field.

**Blast radius before fix**: every clean-URL cold mount for every SC user landed on Calendar despite the two prior fixes.

**Fix shape**: flipped `useState("calendar")` to `useState("period")` at :3100. Comment on the line names the two failed fixes so a future reader sees the arc.

### 3. contacts.name vs people.display_name (2026-09-09, Kevin ruling parked)

**Two fields**: `contacts.name` (free-text, hand-maintained) vs `people.display_name` (Rippling-sourced, structured, the answer to "what does this person go by").

**Two instances flagged, deliberately not fixed** (Kevin ruling 2026-09-09):

- **Liz Randall** (`e.randall@kitchfix.com`, TXR - AZ): `contacts.name = "Elizabeth Randall"`, `people.display_name = "Liz Randall"`.
- **Josh Forkner** (`j.forkner@kitchfix.com`, TXR - TX - H): `contacts.name = "Joshua Forkner"`, `people.display_name = "Josh Forkner"`.

**Why parked instead of overwritten**: A misspelling is unambiguously wrong. "Elizabeth" versus "Liz" is not - it is two correct answers to different questions, and overwriting one with the other destroys information rather than fixing it. Neither is currently causing a problem.

Both rows are the same shape: `people.display_name` carries what the person actually goes by (nickname); `contacts.name` was probably filled in with their formal name at some point. Both values are legitimate for different surfaces - a formal notification email might want "Elizabeth Randall" in the salutation; a Slack chase message wants "Liz". Overwriting one with the other for consistency destroys the information about which is which.

**The right question is not which value to keep. It is which field is authoritative for which surface.** That is exactly the two-fields-one-truth pattern this entry names.

**Spelling errors from the same sweep were fixed** (Claire's single-word name + Desiree / Diego / Jordan misspellings) via `docs/migrations/2026-09-09-contacts-name-spelling-fixes.sql`. Those are unambiguously wrong; the two nickname mismatches are ambiguously right.

### 4. contacts.role vs people.title (2026-09-09, PR #1069 - unshipped)

**Two fields**: `contacts.role` (free-text, hand-maintained) vs `people.title` (Rippling-sourced, structured).

**The disagreement** (two live instances found by the landing-data-health sweep):
- Claire Parry: `contacts.role = "Parry"` (surname), `people.title = "Performance Chef"`. Landing bug.
- Josh Forkner: `contacts.role = "Chef"` (bare), `people.title = "Sous Chef"`. Landing bug.

Both landed on Season overview instead of the Period workspace because `ROLE_TIERS` reads `contacts.role`, not `people.title`, and neither hand-typed contacts.role value mapped.

**Blast radius today**: 2 people out of 37 with SC access (5.4%). Kevin's rule from the sweep: **finding these now is cheaper than during training.**

**Data fix**: shipped separately. But the class of bug persists — nothing prevents the next hand-edit of `contacts.role` from producing a third mismatch.

## The pattern named plainly

Four instances in three days. Same shape each time:

1. Two fields carry overlapping truth.
2. Neither is authoritative in the DB layer (no CHECK, no trigger, no view alias).
3. The code arbitrarily reads one.
4. When the two disagree, the wrong render happens silently.
5. The disagreement is only noticed when a human sees the wrong output and reports it.

## The question Kevin needs to rule on

**Should `ROLE_TIERS` resolve against `people.title` rather than `contacts.role`?**

The reasoning that says yes:

- **`people` is the Rippling-sourced record**, refreshed by the HR feed. It carries structured titles from a controlled vocabulary.
- **`contacts` is hand-maintained**, free-text, and both known instances of role divergence had `contacts.role` wrong while `people.title` was right.
- The sc-accounts backend already reads both tables on every mount (`route.js:429-431`). Switching the tier-resolution input from `contacts.role` to `people.title` is a route-layer change; the client's `computeInitialView` API stays the same.
- Same shape as PR #1058's fix: pick the fact source (Rippling `people.title`), drop the hand-maintained shadow (`contacts.role`) as an input to landing.

The reasoning that says no or wait:

- `contacts.role` is used for OTHER things beyond SC landing (Slack chase, notification routing, etc). Dropping it as a landing input is fine, but the field still needs to exist and be correct for those consumers.
- `people.title` values may not always map cleanly to `ROLE_TIERS` either — Rippling's controlled vocabulary might use different casing / punctuation that would need its own mapping pass.
- The narrower question: **should a landing tier be derived from ONE authoritative field, and if so, which one?** Answering it invites a broader design conversation about the `people`/`contacts` boundary that may not be a training-week decision.

## Why parked

Kevin trains next week. Two instances shipped as data fixes with the code change to add `performance chef`. The class remains: another hand-edit to `contacts.role` next month could produce a third mismatch and nothing would catch it before an operator complains.

The right shape (single authoritative field, code reads it, guard on the boundary) is a real design decision. Not for this week.

**Trigger to unpark**: post-training week, once Kevin has time to look at the two `people`/`contacts` fields together rather than each instance in isolation.

## Related

- `docs/backlog/sc-structural-health-post-training.md` — includes `isInServiceOnDay` (client vs server dup) and `classifyDayStatus` vs `computeWeekCompleteness` (server classifier vs client re-derivation). Same class as this entry.
- `docs/backlog/silent-failure-sweep.md` — a companion sweep for the "silent failure" family. The two-fields-one-truth class produces silent WRONG-render; the silent-failure class produces silent NO-render. Both need the same "make the code enforce" treatment.
- `feedback_health_signal_survives_pipeline.md` — "a signal that only updates when the pipeline runs cannot report on the pipeline stopping." Same-shape memory in the reliability space; the read-the-fact-source-not-the-plan-source rule is the schema-level equivalent.
