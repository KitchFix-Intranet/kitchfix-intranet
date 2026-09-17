# SC Structural Health — post-training backlog

**Parked 2026-09-08, Kevin ruling. Nine days from training.** These items came out of the structural-health report (`docs/reports/2026-09-08-sc-structural-health-report.md`). The ONE finding that produced a wrong number on screen today (`detectNoService` vs `isOff`) shipped separately. Everything else waits.

**Governing principle**: right thing, wrong week. Structural changes to load-bearing paths in the run-up to training carry drift risk that outweighs the drift risk they'd remove. After training, these are the next pass.

---

## 1. `isInServiceOnDay` — extract to shared module + parity test

**Status today**: works. Both copies agree. Last touched by PR #1003 which had to hand-edit both.

**Files**:
- `src/app/service-calendar/DayDetail.js:252` (client, `svc.activeUntil`)
- `src/app/api/service-calendar/route.js:2984` (server, `svc.active_until`, inline arrow)
- Comment at `DayDetail.js:250` says "Server-side mirror at `route.js:2475-2478` must stay in sync" — the actual server location is `2984`; the comment already lies about where the sibling lives.

**Proposed fix**: extract to `src/lib/sc/serviceActiveOnDay.js` (new namespace). Accepts either `svc.activeUntil` or `svc.active_until` via `??` fallback so the two callers keep their existing input shapes. Direct migrate of all 7 callsites (`DayDetail.js:252 + 944`, `ServiceCalendar.js:2638 / 2716 / 2819 / 2889`, `route.js:2984`). No shim.

**Parity probe**: `scripts/probes/_probe_service_active_on_day.mjs`. Fixture set includes PR #1003's boundary case (`activeUntil=2026-08-15, dayDate=2026-08-15 → false` — strict `<`, the archive date is already OUT). Runs <100ms. Locks the rule against a future `<` → `<=` regression on one side.

**Risk if it drifts**: client shows a service as enterable while server refuses the write (or the reverse). Silent for the operator until they hit save.

**Why parked**: currently agrees. Zero screen impact today. The extraction is right; the timing is wrong.

### Worked example (2026-09-16): the duplication class arrived as a live defect

The `isInServiceOnDay` writeup framed the duplication risk as hypothetical — two copies that could drift. On 2026-09-16 the same class arrived non-hypothetical:

`scWeekFinalize.js:resolveFinalizeReviewSpan` (line 261-267) and `scWeekFinalize.js:runFinalizeEffects` step 2 (line 517-534, pre-hotfix) both looked up `sc_day_metadata` for `service_date = weekStart` to read `week_label`. Same query intent, two implementations, one file. `resolveFinalizeReviewSpan` filtered by `account_key`. `runFinalizeEffects` did not. The review gate showed 14 tiles correctly; the finalize path built a mis-aligned pair and `buildInvoicePayload` threw.

Biweekly finalize had never worked in production. CIN-AZ was the only biweekly account and this was the first time anyone finalized a biweekly close-week — the first real use surfaced a defect latent since the biweekly branch was written. The reason it hid so long is the same swallow-into-empty pattern this doc lists as a general concern: the destructure `const { data: meta } = ...` dropped `.maybeSingle()`'s `PGRST116` error on the 11-account row collision, meta became null, `weekIdx` fell through, `pairStart` stayed at close-week Monday, and the throw was one function downstream where the diagnostic doesn't obviously point back to the meta lookup.

Fix landed in a hotfix PR: add the account filter, surface `metaErr`, add a two-account regression test that would have caught this at write time. Sweep of the rest of `src/` found no other instances of the same shape — the sibling with the correct filter (`resolveFinalizeReviewSpan`) was the only structural template that could have caught it via consistency, and it was the one that got the query right.

**Point for the extraction work in this backlog item**: the duplication risk is real, not theoretical. When the extraction lands, add a note to the parity probe about the 2026-09-16 case — the failure mode wasn't a `<` → `<=` drift, it was a missing filter clause. Parity probes should assert query shape (filters present, error handling correct), not just output equality on happy-path fixtures.

### Worked example (2026-09-17): the duplication class arrived a second time — and the file admits it

The `isInServiceOnDay` writeup framed the risk hypothetically. `detectNoService` vs `isOff` was the first live instance. The 2026-09-17 labor-derive classifier is the second — and this time the file itself openly names the debt.

`src/lib/labor/deriveActuals.js:attribute()` (weekly) and `scripts/derive_labor_actuals_daily.mjs:attribute()` (daily) are two implementations of the same worker → account+line classifier. On 2026-09-17 the classifier learned a new rule: `labor_actuals` is hourly-only, so `line_code` must come from the account's 3100.1 pnl_line, not the worker's current dept pnl_line. Anna Hughes's promotion at TXR-AZ on 2026-09-07 moved her dept to a 3100.2 (salary) line, and the prior classifier retro-reclassified 20 weeks of her hourly labor as 3100.2 on every re-derive.

The fix reached the weekly. The daily kept emitting 3100.2 for the same rows. Five weeks (2026-07-13 through 2026-08-10) tied to the cent on amount and differed only on `line_code`. D1 stayed red for a second night on a rule the weekly had already learned.

`scripts/derive_labor_actuals_daily.mjs` line ~153 has been carrying this comment for weeks:

> Kept in sync with `src/lib/labor/deriveActuals.js`. If the weekly rules change (new D-ruling), update this too — PR-1 does not extract this into a shared helper because the weekly attribute closes over local `bumpUnattr` state; a shared version is a separate refactor.

The file admits the debt and describes the extraction as "a separate refactor." That punt is what cost a second night and a second PR. **The cost of two implementations is not theoretical: it is one fix reaching one of them.**

The regression probe (`scripts/probes/_probe_labor_actuals_line_codes.mjs`) had the same failure mode as the classifier: it imported `deriveLaborActuals` and asserted no 3100.2 in that in-memory result, so it went green while `labor_actuals_daily` on disk still held Anna's five bad rows. The probe extension added two table-state assertions against `labor_actuals_daily` — different check style (post-write DB read, not pre-write derive), same rule shape. A shared derive would replace both check styles with one probe against one code path.

**Point for the extraction work in this backlog item**: this is a separate extraction from `isInServiceOnDay` — different class of siblings (two derives, not client/server), different file layout — but the pattern and the lesson are the same. When the labor-derive extraction lands, the same discipline applies: a parity probe that asserts rule shape across every callsite, not output equality on one path. And when a file's own comment names a shared-helper punt, treat that comment as backlog debt in this doc, not just as documentation.

---

## 2. `classifyDayStatus` (server) vs `computeWeekCompleteness` (client-fetched) — parity probe

**Status today**: unverified whether they've drifted. Report couldn't confirm a live drift without running the two paths against real data.

**Files**:
- `src/lib/dataStore/serviceCalendar.js:326-333` emits `status = "entered" | "needs-entry" | "overdue" | ...` per day.
- `src/lib/scWeekFinalize.js:112-198` `computeWeekCompleteness` reimplements the "is this day complete" question via its own read of `sc_daily_actuals` + `sc_daily_projections`, with the comment "*Mirrors classify() output*" at :140.

**Proposed fix**: extract the per-day predicate `dayIsComplete(actualsRow, projectionsRow)` into a shared helper both callers use. Smaller than the surrounding structure, so extraction is straightforward. Parity probe against a fixture set covering zero-projection Sundays, planned-off days, manual no-service, and per-meal edge cases.

**Risk if it drifts**: the finalize gate blocks (or fails to block) on a day the server classifier considers complete (or incomplete). Wrong screen state on the Finalize button — either the operator can't finalize a week that IS complete, or the operator CAN finalize a week that isn't. The latter is the correctness hazard.

**Why parked**: harder than #1 because completeness reads fresh raw rows (not the classifier's output). Nine days from training is the wrong moment for a structural change to the predicate that gates finalize. If a real drift is discovered pre-training via operator report, revisit.

---

## 3. Playwright mount-verify battery — one probe per critical overlay

**Status today**: PR #1047 shipped one probe for `WeekReview`. The pattern works; the battery is the natural extension.

**Proposed fix**: 6 probes at ~50 lines each. One per surface: `Toast`, `WeekReview`, `FinalizeOverlay`, `DayEntryV2`, `BulkResetConfirm`, `SkeletonSurface`. Each mounts the surface in a real Playwright browser, asserts:
- The surface is a descendant of `.scv2` (structural).
- A canary token resolves via `getComputedStyle` (not a class check).
- The primary CTA is not transparent.
- Every interactive control emits its POST when clicked (no ReferenceError inside a sibling function).

**Risk if it doesn't ship**: this week's failures repeat. Four of the six bugs Kevin saw were CSS scope leaks / missing tokens / sibling function crashes — all of which a mount-verify probe catches at write time.

**Why parked**: half a day of build for the battery + wiring. Kevin trains in nine days. His daily click-through IS the current safety net; the battery replaces that safety net for after-training. Not urgent while he's still testing.

**Note**: this is the highest-ROI item on the backlog. First thing to build post-training.

---

## 4. RAF-trace probe wiring to CI

**Status today**: `tests/probe-loading-raf-trace.spec.ts` shipped with PR #1050. Not currently wired to CI.

**Proposed fix**: one line in the Playwright workflow file to include the spec in the PR-check battery. Catches a regression of PR #1050's mount-gate fix or a new state that reintroduces `dashStats | selectPh`-style bad frames on the two working nav paths.

**Cost**: 15 minutes.

**Why parked**: with the battery (#3), this is a one-day PR. On its own it's a 15-minute PR but the ROI story is weaker without the surrounding battery — CI green on one narrow trace catches one class of regression. Better to ship both together post-training.

---

## 5. Instruction-comments in load-bearing spots

**Status today**: six comments say `MUST NOT X` / `must stay in sync` / `must stay byte-identical` in places where the code carries no enforcement.

| File:line | Constraint | Enforcement option |
|---|---|---|
| `ServiceCalendar.js:1586 + :1604` (duplicated per finding #2 in perf-audit — merge artifact) | "MUST NOT reintroduce a truthy-check on selectedAccount here" | RAF trace probe from PR #1050 catches it, once wired to CI (#4) |
| `DayDetail.js:250` | "Server-side mirror at route.js:2475-2478 must stay in sync" | Backlog #1 extraction removes this constraint |
| `v2/flags.js:227` | "This fee gate MUST stay ahead of the stored-preference check" | Unit test: fee accounts always resolve to v1 regardless of stored preference |
| `v2/entry/DayEntryV2.js:89` | "mergeActivity's output shape MUST NOT change (v1 consumers still read it)" | Shape assertion in the mount-verify battery (#3) |
| `v2/Rail.js:140` | "MLB rail composition must stay byte-identical" | Playwright snapshot in the mount-verify battery (#3) |
| `lib/billing/variance.js:26` | "The check MUST NOT block, disable, or gate the save" | Code-read at each variance touch; hard to enforce structurally |

**Why parked**: three of these get resolved by items #1, #3, #4 above. The remaining three are enforcement gaps that don't currently disagree with reality. Nice-to-have.

---

## 6. Implicit contracts between components

**Status today**: this is the shape of `sc-toast-container` outside `.scv2`, `DayGrid` sibling scope-boundary crash, `weekReview.css` missing tokens, `sc-monthcomplete-ring svg` descendant selector spill. Four of this week's six bugs.

**The pattern**: an author writes a component that assumes an ancestor / provider / class exists. The assumption is documented on the CHILD. The caller is somewhere else. The child cannot enforce because it doesn't know who mounts it.

**Only two real enforcement patterns work**:
- **Runtime assertion at mount**: `useEffect(() => { if (!condition) console.error("..."); }, [])`. Fires in dev; can be gated off in prod.
- **Playwright test that mounts the component and reads computed style / DOM state** (mount-verify battery, #3).

**Why parked**: the mount-verify battery (#3) is the enforcement mechanism. Runtime assertions at mount are a smaller add — could ship alongside #3 or as a companion PR.

---

## 7. Comment line-number drift

**Status today**: two known instances.

- `ServiceCalendar.js:147-148` — comment says "see wiring near line ~1740"; actual `setSelectedAccount` wiring is at line 3245.
- `DayDetail.js:250` — comment cites `route.js:2475-2478` for the `isInServiceOnDay` mirror; actual location is `:2984`.

Plus 5 instances in `DayEntryV2.js` (`:444 / :532 / :606 / :879 / :1346`) that cite specific DayDetail line ranges that have drifted.

**Why parked**: cosmetic. Neither implementation is broken. Fix is a search-and-update sweep, deferrable indefinitely.

---

## 8. Cleanup findings from the perf+health audit (2026-09-08)

Already logged in `docs/reports/2026-09-08-sc-perf-health-audit.md`. Ten findings, one FIX-tier (isInServiceOnDay — this became backlog #1 above), seven CLEANUP-tier, two COSMETIC. The seven CLEANUP items:

- Duplicate comment block at `ServiceCalendar.js:1575-1610` (merge artifact from PR #1050).
- Duplicate fetch on cold mount (current calendar month fetched twice into `data` then `monthCache`).
- Dead CSS: `.sc-daysq--loading` + keyframe `scDaySqPulse` (no caller passes `status="loading"` to `resolveDayStatus`).
- `sc-year-summary` reads `accounts` table twice per call (~54ms wasted on critical path at route.js:791).
- Legacy `weekDays` prop + `legacyMissing` fallback in `WeekFinalizeControl.js:81 + 143`.
- Three overlapping loading state variables + one derived `isAccountLoading` (yearLoadState / drillLoadState / loading).
- Two comment line-number drifts (already covered by #7 above).

**Why parked**: none currently produce a wrong number on screen. Kevin's ruling stands: the ONE finding that WAS wrong on screen (`detectMonthOff`) shipped separately. The rest waits.

---

## What's not on this list

- **Anything outside SC**. Loading arc closed. KPI stays as-is per Kevin's ruling (`GOTCHAS.md` entry: `AppSkeleton is the app-wide loading primitive; KPI's SkeletonBoard is a deliberate exception`). Ops, People, Directory, Playbook, Financial — done.
- **Migration/schema work**. sc-42 landed with PR #1047. No new migrations needed for the parked items.

---

## Ordering when this reopens

Rough priority if all shipped in one sweep post-training:

1. **#3 (mount-verify battery) + #4 (RAF wire)** — one PR, half a day. Highest ROI. Every subsequent structural change lands under the safety net.
2. **#1 (isInServiceOnDay extraction)** — smallest, fastest. Template for future extractions.
3. **#2 (classifyDayStatus parity)** — larger, riskier. Only after #1 has soaked.
4. **#5–#8** — janitor PR, batchable, no urgency.

Only Ranks 1 and 3 above (mount-verify + RAF) do NOT require someone to remember to update fixtures. That is the same principle this whole arc was about, applied to the tests themselves.
