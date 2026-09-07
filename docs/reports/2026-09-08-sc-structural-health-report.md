# SC STRUCTURAL HEALTH REPORT

**2026-09-08 · Report before build (Task 1) + report only (Tasks 2 + 3) · SC scope only.**

Follow-up to the perf+health audit (`docs/reports/2026-09-08-sc-perf-health-audit.md`). This is the structural half — the pattern behind this week's bugs, not the tidiness list.

---

## TASK 1 — Fix `isInServiceOnDay` properly: approach report

### The problem

- `DayDetail.js:252` (client): `if (!svc.activeUntil) return true; return dayDate < String(svc.activeUntil).slice(0, 10);`
- `route.js:2984` (server, inline arrow): `if (!svc.active_until) return true; return dayDate < String(svc.active_until).slice(0, 10);`

Same rule. Two implementations. Different input field casing (`activeUntil` vs `active_until`) reflecting where the data originated (transformed payload vs raw DB row). Joined only by a comment at `DayDetail.js:250` that cites `route.js:2475-2478` — the actual location has drifted to 2984. The comment is already lying about where the sibling lives.

PR #1003 changed `<=` to `<` and had to touch both copies by hand. Next time, one gets missed.

### Approach: extract AND test

**Both, per your lean. Neither alone is sufficient:**

- Extract-only prevents drift ONLY as long as everyone uses the shared module. Two years from now, someone adds a third callsite that reimplements it inline "because it's just two lines" and the extraction fails silently.
- Test-only lets the duplication continue, but the test locks the rule and screams if either side drifts.
- Together: extraction removes the duplication that exists today, test protects against the duplication that gets reintroduced tomorrow.

### Client/server boundary check

**Yes, extraction is feasible.** Precedent exists — `src/lib/billing/qboMode.js` and `src/lib/billing/variance.js` are both pure-JS modules dual-imported by client components AND `route.js`. Neither carries DB, framework, or server-only dependencies. The predicate is a pure function over `(activeUntil, dayDate)` — no async, no context, nothing environment-specific. Same shape.

### Proposed shape

New file: `src/lib/sc/serviceActiveOnDay.js` (or extend an existing `src/lib/billing/` module; my mild preference is a new `src/lib/sc/` namespace for SC-domain predicates that aren't billing-specific).

```js
/**
 * Is a service in-service on a given day? Ships as the SINGLE
 * client + server implementation. Both callers import this module
 * so there is no way for the rule to drift.
 *
 * Client passes svc.activeUntil (camelCase, transformed payload).
 * Server passes svc.active_until (snake_case, raw DB row).
 * Accepts either shape via the `?? ` fallback.
 *
 * Semantic: active_until is the FIRST day OUT of service. So the
 * strict `<` is correct - on the archive date itself, the service
 * is already out. See PR #1003 rationale in the git history.
 */
export function isServiceActiveOnDay(svc, dayDate) {
  const activeUntil = svc?.activeUntil ?? svc?.active_until ?? null;
  if (!activeUntil) return true;
  return dayDate < String(activeUntil).slice(0, 10);
}
```

Callers (grep-verified):
- `DayDetail.js:252` — replace `isInServiceOnDay` export with a re-export from the shared module, OR migrate the 4 in-file callsites in `ServiceCalendar.js` (:2638, :2716, :2819, :2889) + the `DayDetail.js:944` display callsite to import from the shared module directly. **My lean: migrate directly, delete the DayDetail export.** Cleaner.
- `route.js:2984` — replace the inline arrow with an import.

### Proposed test

Ships as a lightweight assertion probe under `scripts/probes/_probe_service_active_on_day.mjs`. Not a Jest/Vitest suite — the codebase doesn't have one yet and adding one for one test is heavier than the test warrants. A Node script the pre-push hook can run in <100ms.

Fixture set (the shapes that historically bit):

| svc | dayDate | expected | Why |
|---|---|---|---|
| `{ activeUntil: null }` | any | `true` | Never-archived service |
| `{ active_until: null }` | any | `true` | snake_case parity |
| `{}` | any | `true` | Missing field defaults to active |
| `{ activeUntil: "2026-08-15" }` | `"2026-08-14"` | `true` | Day before archive |
| `{ activeUntil: "2026-08-15" }` | `"2026-08-15"` | `false` | **PR #1003 boundary case** — strict `<`, archive date is already OUT |
| `{ activeUntil: "2026-08-15" }` | `"2026-08-16"` | `false` | Day after archive |
| `{ active_until: "2026-08-15" }` | `"2026-08-15"` | `false` | snake_case boundary |
| `{ activeUntil: "2026-08-15T00:00:00Z" }` | `"2026-08-15"` | `false` | ISO with time - slice(0,10) trims |

**Test would have caught:**
- PR #1003's original drift risk (if only one file had been changed).
- Any future flip of `<` to `<=` on one side and not the other.
- Any regression where the field-name fallback breaks (someone edits the `??` chain).

Ships as `node --env-file=.env.local scripts/probes/_probe_service_active_on_day.mjs` or as a plain `node scripts/probes/...` (the probe reads no env; it's pure logic).

### Waiting for your ruling on

- Location: `src/lib/sc/serviceActiveOnDay.js` (new namespace) vs extend an existing `src/lib/billing/` module.
- Whether to migrate callsites directly to the shared import, or keep `DayDetail.js`'s `isInServiceOnDay` as a re-export shim during a soak period.
- Whether the probe lives under `scripts/probes/` (my lean, matches existing pattern) or begins a `tests/` unit-test tree.

Nothing built yet.

---

## TASK 2 — Same-shape sweep

Focus: correctness that depends on a human remembering, not on the code enforcing. Ranked by what happens when the memory fails.

### FIX candidates (would produce a wrong number or a broken flow)

**1. `MonthCard.detectNoService` vs `overviewDerive.isOff` — already disagree.**

- `season/MonthCard.js:595-613` — `detectNoService` branches on account category (homestand vs fee vs MiLB vs per-meal) and applies category-specific rules against `homestandSummary.gameDays`, `projectedCovers`, `totalDays`, etc.
- `v2/overviewDerive.js:116-117` — `isOff` uses a category-blind check: `!monthSummary || (totalActionable === 0 && actualRev === 0 && projectedRev === 0)`.
- Comment at `overviewDerive.js:85` says *"State classification mirrors MonthCard.js's monthState"* — **it does not.** MonthCard's `noService` handles a homestand account with zero games (`hs.gameDays === 0 && hs.prepDays === 0`) differently from a per-meal account with zero revenue. overviewDerive's `isOff` collapses all of that to one revenue-only check.
- **Consequence today:** a homestand month with actual game days but zero recorded revenue (unusual but possible in the away-season / prep-only window) renders as `in-progress` in the season-list rail via `overviewDerive` and as `off` in the MonthCard grid. Same month, two states, two colours. If Kevin has seen the season list disagree with the grid, this is why.
- **Enforcement:** extract `detectMonthOff({ monthSummary, accountShape })` into a shared helper both callers use. Same shape as Task 1's extraction. Parity test with fixtures for each account category.
- **Confidence:** HIGH — grep-verified both definitions, read both branches, verified they use different fields.

**2. `classifyDayStatus` mirrored between server (`dataStore/serviceCalendar.js`) and client (`scWeekFinalize.js` completeness predicate).**

- Server classifier in `dataStore/serviceCalendar.js` emits `status = "entered" | "needs-entry" | "overdue" | ...` per day.
- `scWeekFinalize.js:112-198` `computeWeekCompleteness` reimplements the "is this day complete" question via its own read of `sc_daily_actuals` + `sc_daily_projections`, then classifies with the comment "*Mirrors classify() output*" at :140.
- Comment on the classifier at `dataStore/serviceCalendar.js:326-333` similarly says the server classifier + client's completeness must agree.
- **Consequence today:** the completeness gate (blocks Finalize when a day isn't entered) reads the raw tables and applies its own rules. If server-side classifier semantics change (e.g. how zero-projection Sundays are handled), the finalize gate does NOT automatically follow — someone has to touch both.
- **Enforcement:** hardest of the extractions because completeness needs the raw rows for its own reason (fresh read post-write). Realistic shape: extract the per-day predicate `dayIsComplete(actualsRow, projectionsRow)` into a shared helper both the server classifier AND `computeWeekCompleteness` call.
- **Confidence:** MEDIUM — the shared predicate is smaller than the surrounding structure; extraction is straightforward, but the ROI depends on whether the two paths have actually drifted (I have not confirmed a live drift).

### CLEANUP candidates (would confuse the next person)

**3. Instruction-shaped comments in load-bearing spots.**

Six comments say "MUST NOT X" or "must stay in sync" or "must stay byte-identical". Each is a constraint the code doesn't carry.

| File:line | Constraint | Enforcement option |
|---|---|---|
| `ServiceCalendar.js:1586` + `:1604` (duplicated per finding #2 in perf-audit) | "MUST NOT reintroduce a truthy-check on selectedAccount here" | A single-line RAF trace test asserting `dashStats \| selectPh` is never emitted on cold mount. My PR #1050 shipped the probe (`tests/probe-loading-raf-trace.spec.ts`) - **it already exists and would catch a reversion.** Just needs the CI wire to actually run. |
| `DayDetail.js:250` | "Server-side mirror at route.js:2475-2478 must stay in sync" (line-number already wrong; actual is 2984) | Task 1 extraction + parity test |
| `v2/flags.js:227` | "This fee gate MUST stay ahead of the stored-preference check" | Order in a function body is hard to enforce structurally. Best a call-order comment can do; adding a unit test that asserts fee accounts always resolve to v1 regardless of stored preference would harden it. |
| `v2/entry/DayEntryV2.js:89` | "mergeActivity's output shape MUST NOT change (v1 consumers still read it)" | Shape assertion in the probe suite — read one merged output, verify the exact key set. |
| `v2/Rail.js:140` | "MLB rail composition must stay byte-identical" | Playwright snapshot of the mounted rail for one MLB account. Brittle in general but the "byte-identical" phrasing is the callout that the author knows a soft assertion isn't enough. |
| `lib/billing/variance.js:26` | "The check MUST NOT block, disable, or gate the save" | Unit test that calls the variance predicate and asserts the save flow is not affected by its return value. Requires calling `handleSubmit` in isolation, which is hard given its scope — realistic enforcement is a code-read on each variance touch. |

**4. Implicit contracts between components (CSS scope + prop threading).**

These are the shape of the `.scv2` toast, `DayGrid` sibling, and `weekReview.css` failures. Every one of them is a contract the code doesn't carry:

| Contract | What breaks if forgotten | What would enforce |
|---|---|---|
| Any modal / toast / overlay that reads `--sc2-*` tokens MUST mount as descendant of `.scv2` | Rendered outside .scv2, every var() falls back or resolves transparent. **4 of this week's 6 bugs are this shape.** | Playwright mount-verify probe (the pattern from my #1047 verify) run on every overlay component. Fixture asserts computed style resolves for a canary token. |
| Sibling function components that fire from parent state MUST have every referenced binding in their closure | ReferenceError at runtime, blank page. **DayGrid PR #1026.** | Every parent-state prop that's used inside a sibling function component gets a default in the signature (`showToast = null`). Not enforced by the language — enforced by discipline + a Playwright click-through test. |
| `HandoffProvider` MUST mount above `ServiceCalendar` | `useHandoff` returns null, MonthCompleteCard silently no-ops | React would warn if `useContext` returns undefined — but this returns `null` deliberately. A runtime check on first-render that fires a `console.error` if the provider is missing would catch it. |
| `scv2` class MUST be present on `.sc-root` for scV2 mode | Entire design system falls back to v1 tokens | The `useScV2()` hook gates the class conditionally. A mount-verify check on the first paint would catch a mode mismatch. |

The pattern is the same each time: an author writes a component that assumes an ancestor / provider / class exists. The assumption is documented in a comment. The comment is on the CHILD; the caller is somewhere else. **The child cannot enforce because it doesn't know who mounts it.**

Only two real enforcement patterns work:
- **Runtime assertion at mount** — `useEffect(() => { if (!condition) console.error("..."); }, [])`. Cheap. Fires in dev; can be gated off in prod.
- **Playwright test that mounts the component and reads computed style / DOM state.** Not per-component; per-critical-path.

### COSMETIC (note and leave)

**5. Ten "matches DayDetail.js:X-Y" comments in DayEntryV2 whose line references have drifted.**

- `DayEntryV2.js:444`, `:532`, `:606`, `:879`, `:1346` all cite specific `DayDetail.js` line ranges. DayDetail's `isDirty` is at line 410 (comment says :316-335), etc. Line-number drift.
- Neither implementation is currently broken; the v2 rewrite is stable and the v1 code path is used only when `useScEntryV2Effective` returns false.
- **Not a fix.** The two implementations HAVE diverged in practice (v2 has different UI, different Handoff hooks). The "matches" claim was true at authoring time and is now aspirational. Best cleanup: replace "matches DayDetail.js:X-Y" with "based on the v1 DayDetail pattern (isDirty / executeMarkNoService / handleAddNote); see git blame for history" — an EXPLANATION, not an instruction that pretends to be enforceable.

### Ordering requirements (none load-bearing today)

- **Migration → deploy order** — handled by the migration-gate workflow now (PR #416). Mechanical.
- **HandoffProvider mount site** — implicit but stable; hasn't broken since it moved to `page.js`.
- **URL-hydration effect → first render** — implicit; the `!selectedAccount || ...` gate I added in PR #1050 covers this now.

**Nothing in this category is currently held together by memory alone that would produce a wrong number.**

---

## TASK 3 — What a test suite would need to cover

Not a test plan. A ranked list of what's worth having, with the specific bug each catches. **Honest limit:** the pattern the failures share (contract violations at mount) is not what unit tests catch. Playwright mount-verify probes catch most of them.

### Rank 1 — Would have caught the most, cheapest to write

**A. Playwright mount-verify battery — one probe per critical overlay/surface.**

- Mount each surface in a real Playwright browser, assert:
  - The surface is a descendant of `.scv2` (structural).
  - A canary token resolves via `getComputedStyle` (not a class check — proves the ancestor chain works).
  - The primary CTA is not transparent (proves no unresolved tokens on the load-bearing element).
  - Every interactive control emits its POST when clicked (no ReferenceError inside a sibling function).
- Surfaces to cover: `Toast`, `WeekReview`, `FinalizeOverlay`, `DayEntryV2`, `BulkResetConfirm`, `SkeletonSurface`. Roughly six probes at ~50 lines each.
- **Would have caught:** `sc-toast-container` scope leak, `weekReview.css` missing tokens, `DayGrid` sibling crash, `sc-monthcomplete-ring svg` descendant selector spill.

Cost: about half a day. Runs on every PR via existing Playwright infra. The mount-verify probe I shipped with #1047 is already this shape — the battery just formalizes the pattern across the SC's other overlays.

### Rank 2 — Parity tests for extracted predicates

**B. `isServiceActiveOnDay` parity test.** Fixture set from Task 1. ~30 lines. Runs in <100ms. Catches PR #1003-shape drift.

**C. `MonthCard.detectMonthOff` vs `overviewDerive.detectMonthOff` parity test.** Requires the extraction first. Once extracted, one call site each; the parity is that they call the same function.

Cost: ~1 hour each after the extractions land. Adds no ongoing maintenance burden — pure functions with pure inputs.

### Rank 3 — RAF traces on the two working nav paths

**D. RAF-trace probe on hard-refresh, Ops→SC, period-switch, account-switch.** I shipped this in #1050 (`tests/probe-loading-raf-trace.spec.ts`). It's not currently wired to CI; adding it means one workflow-file line + running it on every PR. Would catch a regression of PR #1050's mount-gate fix or a new state that reintroduces `dashStats | selectPh`-style bad frames.

Cost: 15 minutes to wire.

### What NOT to build (and why)

- **Unit tests for every predicate in isolation.** High cost, low signal. The failures this week weren't in the predicates — they were in the seams between components. Unit tests validate that a function does what its author thinks it does; the bugs were "the function doesn't run in the context the author assumed."
- **Snapshot tests.** Brittle. Update-on-change makes reviewers rubber-stamp. High false-positive rate on a codebase with active design churn.
- **A test-coverage percentage target.** Rewards line coverage, not seam coverage. Would push toward the unit tests above.
- **End-to-end billing flow test.** Real value but requires QBO sandbox + a real accounts fixture. High cost, real ROI, but the shape of THIS week's bugs is not what an E2E billing flow test catches.

### The honest limit

**The mount-verify discipline catches more than a unit test suite would here.** Kevin has been the only test; that works day-to-day and stops working the week after training. The ranked list above is what would keep the safety net intact while Kevin is not clicking through daily — but only Rank 1 and Rank 3 are enforcement patterns that don't require someone to remember to update the fixture when the code changes. Rank 2 (parity tests for predicates) is real value but a smaller class of bug.

**Suggestion:** ship Rank 1 (mount-verify battery) alongside the Task 1 extraction. Wire the existing Rank 3 probes into CI at the same time. Rank 2 lands with each extraction as the extractions happen. Nothing lower on the list is worth building on the nine-day runway.

---

## Waiting on rulings

- **Task 1**: location + migration shape + probe location (see Task 1 section).
- **Task 2 findings 1 + 2** (MonthCard/overviewDerive + classifyDayStatus): do these get extracted now, or scheduled after Task 1 lands as a template?
- **Task 3**: is the Rank 1 mount-verify battery worth writing this week, or does it wait until after training?

Nothing built. No PRs opened.
