# Labor board help copy

Verbatim extraction of every ? popover on the KPI Labor board, 2026-08-27.

Grouped by surface. One block per popover. Edit in place — the text below is what ships.

**Total popovers: 22** across 7 files.

Format notes:
- `**bold**` corresponds to `<b>` in source. Keep the markers.
- Blank line between paragraphs corresponds to `<br /><br />`.
- `_Foot:_ ...` is text that renders in a distinctly styled foot region (`kpi-hs-pop-foot`), separated from the body by extra spacing.
- `${expr}` marks interpolated values. Everything else is fixed copy.
- Conditional variants list every branch with its condition.

Also checked and empty: `RangeMenu.js`, `CalendarPopover.js` — neither carries a HelpPop.

Out of scope for this pass: purchasing board HelpPops live under `src/app/kpi/purchasing/components/` (11 files). Separate audit.

---

## Period board

### Spending pace
id: qPace
file: `src/app/kpi/labor/components/SignalCards.js:181`
surface: Period board — first signal card
shows when: every period view (single_period or multi_period)

---
Whether you are ahead or behind if the period's budget were spent evenly, day by day.

**Down and green means behind the even line** - you have spent less than the calendar says you could have. Up and red means ahead of it.

Being ahead is not automatically bad. A period with a heavy homestand early should run ahead in week one. What matters is whether the rest of the period has enough left in it.

_Foot:_ **Projected end** is where you finish if the rest of the period looks like what you have done so far. **Vs budget** is how far that lands over or under.

**Covers** tells you which weeks are in these figures - a week still running is included at whatever has been clocked so far.
---

### Overtime
id: qOvertime
file: `src/app/kpi/labor/components/SignalCards.js:254`
surface: Period board — second signal card
shows when: every period view

---
Overtime hours as a share of all hours worked. **5.3% means about five of every hundred hours were paid at time and a half.**

Overtime is not automatically a problem. The 40-hour clock resets every Monday, so a week with a lot of games packed into it carries overtime no matter how you schedule it - that is the calendar, not the crew.

**Worth a look when** the same one or two people carry all of it, or when a light week still shows a high number.

_Foot:_ **Week workers OT** is how many of the crew had any overtime. **Peak OT week** names the worst single week so you know where to look.

**Covers** tells you which weeks are in these figures.
---

### Hours available
id: qHoursLeft
file: `src/app/kpi/labor/components/SignalCards.js:298`
surface: Period board — third signal card
shows when: single_period_in_progress ONLY (absent on closed periods, FYTD, last-4-weeks, multi-period)

---
How many more hours you can put on the schedule and still land on budget for this period. **Budget left divided by your blended rate.**

**Per week** spreads it across the weeks remaining, so it is the number to build next week's schedule against.

This is a ceiling, not a plan. It assumes your rate holds - if the weeks ahead carry overtime, those hours cost more and the real ceiling is lower.

_Foot:_ **Hourly only, always.** Salaried staff are not scheduled by the hour, so the salary toggle does not change this card.

The card only appears on a period that is still running. On a finished period there are no hours left to schedule.
---

### Approvals
id: qApprovals
file: `src/app/kpi/labor/components/SignalCards.js:359,376` (same body, two card paths — zero-drafts and any-drafts)
surface: Period board — fourth signal card
shows when: every period view

---
Hours your crew has worked that nobody has approved yet.

Two separate things happen to every hour. Rippling works out what it costs on its own, as soon as someone clocks out. A manager approving it is a second step, and it often happens days later.

This card is the second step - the part that needs a person.

**Oldest shift** is the one to watch. A shift sitting a month is a shift that may have missed its payroll.

**Still costing** means approved but the money has not posted yet. It resolves on its own.

We started tracking approvals on ${APPROVAL_TRACKING_START_DISPLAY}. Anything before that is not counted here.

_Foot:_ **Hourly only, always** - salaried staff do not clock in.
---

### Your budget for this period
id: qBudgetCard
file: `src/app/kpi/labor/components/StoryBlock.js:231`
surface: Period board — spend card header
shows when: every period view

---
The hourly labor budget for these four weeks, from the FY2026 plan. **Spent so far** is what has actually been paid.

**Left to spend** is the difference - the money still available for the weeks remaining.

With the salary toggle on, this includes salaried staff. With it off, hourly only. The pill beside the status tells you which.

_Foot:_ Most periods' budgets come from the P&L; a few use an envelope allocation set at the region level. The number is the same shape either way, but the source can matter if you are comparing figures with finance.
---

### Week by week
id: qWeekByWeek
file: `src/app/kpi/labor/components/StoryBlock.js:743`
surface: Period board — week bar chart header
shows when: every period view

---
One bar per week. Bar height is what that week cost.

**The amber dashed line is your original weekly target** - budget split evenly across four weeks. **The blue dashed line is adjusted** - it moves as the period goes. Come in under one week and the line rises for the weeks left; go over and it drops.

**Hatched means the number will grow.** Hours are clocked but not yet priced by Rippling, so that bar is not final.

_Foot:_ A grey stub means nobody worked that day - genuinely zero, not missing.
---

### The week table
id: qWeekTable
file: `src/app/kpi/labor/components/WeekTable.js:685`
surface: Period board — week table header
shows when: every period view

---
Every week in the period, with its own spend, hours and overtime. **Click a week to open it and see who worked.**

**The amber chips mean different things:**

| chip | meaning |
|---|---|
| "N need attention" | broken punches |
| "awaiting approval" | just needs a click |
| "unpriced" | dollars still coming |

**Need attention is the only one that requires a fix** - somebody never clocked out, or a punch is under a minute. The others resolve on their own or with an approval.
---

### Compared to last period
id: qVsPrev
file: `src/app/kpi/labor/components/ComparisonStrip.js:113`
surface: Period board — comparison strip below the signal cards
shows when: every period view WITH a prior closed period available

**Two variants, chosen by** `salaryIncluded`:

---
**Base variant** (`salaryIncluded === false`):

How this period is running against the last **closed** one - only complete periods, so you are never comparing a half-finished period to a whole one.

**Down and green is better on every measure here.** A lower blended rate, less overtime, less spend per week.

**Spend per week and hours per week are the honest comparison** when the periods are different lengths. Totals are not.
---

---
**Salary variant** (`salaryIncluded === true`) — appends this foot after the base body above:

_Foot:_ Salary figures are base only; bonuses and one-time payments are not included.
---

### Freshness (data currency)
id: (no id — inline JSX, not a HelpPop)
file: `src/app/kpi/labor/page.js:794`
surface: Command bar — freshness chip opens this popover
shows when: `loadState === "ok"` AND data present

**Structure:** first line is the coverage plain-language line (one of five variants, keyed on `dominantCoverage`). Then fixed rows and a closing contract paragraph. Interpolated values marked.

---
**First line — five variants, one fires:**

- `dominantCoverage === "complete"` → Every shift in this range has priced hours. Nothing is missing from payroll.
- `dominantCoverage === "hours_only"` → Hours are in, pay data has not landed yet.
- `dominantCoverage === "partial"` → Some shifts are missing pay data - dollars for those weeks are incomplete.
- `dominantCoverage === "no_labor"` → No labor recorded in this range.
- `dominantCoverage === "unknown"` → The data feed has not covered part of this range.

**Then, always:**

- In view — ${weeksInRange} weeks · ${filteredActuals.length} worker-weeks
- Orphan facts — ${data?.unattributed?.length ?? 0}
- Unmapped earning types — ${data?.unmapped_names?.length ?? 0}
- Rippling data pulled — ${fmtTimestamp(data.derive_freshness.last_walk_at)} (or "—" if null)
- Dashboard figures rebuilt — ${fmtTimestamp(data.derive_freshness.last_derive_at)} (or "—" if null)

**Closing paragraph:**

Updates nightly around 2:00 AM CT. Hours land as timesheets are approved; dollars land when payroll processes, so the current week reads as partial until then.
---

---

## Homestand

### Season by homestand
id: qRail
file: `src/app/kpi/labor/components/HomestandBoard.js:93`
surface: Homestand — rail card header (top of homestand view)
shows when: MLB accounts, homestand view

---
One bar per homestand, height is what it cost. Green came in under budget, red went over.

The navy dashed line is the original budget for that stand. Pre-floor stands (before 04/20/26) render as estimates - the hatched bar shows what the schedule predicts against known weekly totals.

Click a stand to open its detail below. The cards there change depending on whether the stand is upcoming or already played.
---

### Season to date
id: qSeason
file: `src/app/kpi/labor/components/HomestandBoard.js:245`
surface: Homestand — season progress card header
shows when: MLB accounts, homestand view

---
The solid bar is what you have spent. The green hatch is budget you have not spent - the amount you are under target so far. The grey hatch is what is still budgeted for the stands you have left.

**Estimated** stands are before our daily detail starts, so these are worked out from the weeks around them.
---

### Busiest week
id: qPeak
file: `src/app/kpi/labor/components/HomestandBoard.js:435`
surface: Homestand — season table, "Peak" column header
shows when: MLB accounts, homestand view

---
The most game days that fall inside any single Monday-Sunday week during the stand. The 40-hour overtime clock resets Monday, so this number - not the total game count - is what drives overtime.
---

### What you have
id: qUpHave
file: `src/app/kpi/labor/components/HomestandBoard.js:692`
surface: Homestand — UpcomingCards, card 1
shows when: game-state is not `all_played` (future or in-progress stand)

---
The budget for this homestand. Spent so far is anything already clocked in the window - usually prep-day labor before the games start. Left is what remains for the days ahead.
---

### What it should cost
id: qUpPlan
file: `src/app/kpi/labor/components/HomestandBoard.js:706`
surface: Homestand — UpcomingCards, card 2
shows when: game-state is not `all_played`

---
What a typical low-OT stand of this shape costs - night game / day game / prep day rates from this account's own history, applied to the games on this homestand's calendar. Not a forecast we made at the time; a benchmark that lets us compare what the stand actually cost against what a typical one does.
---

### Hours to schedule
id: qUpHrs
file: `src/app/kpi/labor/components/HomestandBoard.js:726`
surface: Homestand — UpcomingCards, card 3
shows when: game-state is not `all_played`

---
The regular hours behind the plan. Divide across the working days for the per-day number; divide again across a crew of N for a rough per-person estimate. This is the ceiling, not the schedule - overtime + doubleheaders will move it.
---

### Expect overtime
id: qUpOT
file: `src/app/kpi/labor/components/HomestandBoard.js:742`
surface: Homestand — UpcomingCards, card 4
shows when: game-state is not `all_played`

---
The 40-hour clock resets Monday, so a packed week carries overtime no matter how you schedule it. This is what stands with the same peak-week shape have run at this season.
---

### What it cost
id: qPlCost
file: `src/app/kpi/labor/components/HomestandBoard.js:818`
surface: Homestand — PlayedCards, card 1
shows when: game-state is `all_played`

---
Actual hourly labor for the stand's window, against the budget from your season plan. Under is green; over is red.

**If unapproved hours exist,** the hero shows a `≥ $X` prefix. Approving those hours may grow the number.
---

### Vs the plan
id: qPlVs
file: `src/app/kpi/labor/components/HomestandBoard.js:840`
surface: Homestand — PlayedCards, card 2
shows when: game-state is `all_played`

---
Game-day spend against what a typical low-OT stand of this shape costs, using this account's own night / day / prep rates. Not what we forecast at the time - a benchmark. When they differ, that gap is signal: HS 8's 41% OT against an expected 21% is the model telling you something true about six-game weeks. **Accuracy** is 100 percent minus the absolute error divided by the actual. Direction is stated in words (low or high), never as a signed number.
---

### Prep & off days
id: qPlPrep
file: `src/app/kpi/labor/components/HomestandBoard.js:855`
surface: Homestand — PlayedCards, card 3
shows when: game-state is `all_played`

---
Labor on days outside the games - prep the day before openers, cleanup the day after closers, and any off day inside the window. These are stand-related costs even though nobody was at the ballpark.
---

### Overtime (played)
id: qPlOT
file: `src/app/kpi/labor/components/HomestandBoard.js:870`
surface: Homestand — PlayedCards, card 4
shows when: game-state is `all_played`

---
Actual overtime as a share of all hours worked. The plan expected roughly the norm shown below.

**Sum-over-sum**: total OT hours divided by total hours across the crew. A per-worker-avg formula inflates whenever a subset carries the OT (the reason this reading was 72% pre-fix on a stand that ran 41%).
---

---

## Custom range

### Budget for these days
id: qCustomBudget
file: `src/app/kpi/labor/components/DayStrip.js:284`
surface: Custom range — day strip, budget card
shows when: custom-range view (Monday-Sunday alignment produces this card)

---
**Budgets are set by period, not by day.** So for a range that does not land on whole weeks, this takes that week's share of the days you picked.

The label tells you exactly which slice - **"4 of 7 days of wk 08/03"** means four sevenths of that week's target.

It is the right yardstick for a short range, but nobody set it as a goal. Your spend beside it is exact; this side is arithmetic.

_Foot:_ Pick a range that starts on a Monday and ends on a Sunday and no slicing happens - you get the real weekly budget.
---

### What these days cost
id: qCustomSpent
file: `src/app/kpi/labor/components/DayStrip.js:294`
surface: Custom range — day strip, spent card
shows when: custom-range view

---
**Every dollar here is real** - actual hourly labor on the exact days you picked, down to the day.

The comparison underneath is against the pro-rated budget, so read it as a rough check rather than a verdict. **The spend is precise; the yardstick is a slice.**

_Foot:_ Days with no bar are days nobody worked - a genuine zero, not missing data.
---
