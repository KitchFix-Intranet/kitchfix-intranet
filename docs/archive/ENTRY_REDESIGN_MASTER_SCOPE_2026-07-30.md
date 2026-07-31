> **Archived 2026-07-30.** Read-only historical record. Superseded by
> [`../SC_STATUS.md`](../SC_STATUS.md) as the living SC state record.
> Covers the ENTRY REDESIGN arc through M-4b (PR #571). Committed
> verbatim; not restructured, renumbered, or otherwise cleaned up.

---

# Service Calendar — ENTRY PROCESS REDESIGN
## Master Scope + Implementation Guide  ·  v3 (owner decisions locked)

**Date:** 2026-07-22
**Sources:** Chat-Claude live test (real submissions, DOM-measured) + CC engine audit (3 parallel
read-only agents) + Kevin's 12 redlines + owner decisions 2026-07-22
**Status:** Phase 0 COMPLETE (PR-A + PR-B merged). **Phase 1 started - B8 under investigation.**

---

# 0. STATUS AT A GLANCE  *(updated 2026-07-24, 2A MERGED)*

| Item | State |
|---|---|
| **PR-A** #491 - Ledger fields + clipping | ✅ **MERGED + GATED** |
| **PR-B** #493 - bulk swap + integer guard + toast fix | ✅ **MERGED** |
| **#501** B8b mount-guard fix | ✅ **MERGED + GATED** (§6H) |
| **#500 / #502** GOTCHAS entries | ✅ **MERGED** |
| **#503** B8a refresh + modal-preservation | ✅ **MERGED + GATED** (§6K) |
| **#505** B2 rail click + B3 pinned actions | ✅ **MERGED + GATED** (§6M-N) |
| **#508** A3 + A4 + inline failure UI | ✅ **MERGED + GATED** (§6P) |
| **Fix 2** optimistic patch | ❌ **Failed 2x - moved to PHASE 1** (§6C). Was mis-scoped as a quick win |
| Design: toasts + reward (Handoff) | ✅ Approved - §8B |
| Design: entry modal layout | ✅ Approved - §8C |
| Design: bulk flow | ✅ Delivered - see §13B |
| Token discipline | ✅ Binding - §13A |
| **Phase 1** | ✅ **COMPLETE** — B8 · B2+B3 · save reliability · Ledger · no-service gate |
| **Phase 2A** | ✅ **MERGED + GATED** - #518 (`b1e24fb`+`6f67ac2`+`c11e371`), main @ `abeb493` (§8A gates 1-3) |
| **Phase 2B** | ✅ **MERGED + GATED, incl. P2B-b** - #526 + #527 both in main (§8B gates 1-2 + P2B-b gate). Phase 2 COMPLETE |
| MLB | **Fenced to v1** - §7. **MLB SC v2.1 scoped in §15** (2026-07-28), build not started |
| **Phase 3** | ✅ **COMPLETE** - P3-A #530 + P3-B #532 merged. The Handoff is live in production |

**Renders: all 4 delivered and approved.** No design work outstanding for Phase 0-3.

**Immediate:** **P3-A gate 1 (2026-07-26): two-defect bounce** - the ring unmounts during
refetch so the ambient sweep never tweens (arc poll: [9.8, GONE x6, 0]; fix = node stability
with held pct, P3-B depends on it), and the note chip's green rail loses a cascade collision
(computed 0px none; same primitive paints on the failure banner). Bounce prompt:
`CC_P3A_GATE_BOUNCE.md`. Everything else passed: ring math + picks exact, STL-FL arc-only +
hero intact, forced-failure banner live test clean, discard dialog amber rail, chip copy +
Ledger, MLB byte-identical. Gate test data: CIN-AZ Jul 24 = 150, Jul 25 = 120, one test note
on Jul 22 - owner re-enters real counts.
**Gate 2 (2026-07-26), fix `6e4749b`:** chip rail FIXED and verified (4px green computed);
fresh-load clean; MLB clean. **Ring tween STILL DEAD** - transition-event listeners recorded zero
stroke-dashoffset events across a save while pct moved 20->30. Second failed fix => instrument-
first rule in force: `CC_P3A_GATE_BOUNCE_2.md` mandates the event log + node-identity check before
any code, with `reloadKey`-driven ancestor remounts named prime suspect. Gate test data: CIN-KY
Jul 8 = 45, Jul 9 = 38, one note on Jul 9.
**Gate 3 (2026-07-26), fix `2d03dcd`: PASS - merge #530.** The culprit was upstream: the rail
MOUNT was gated in ServiceCalendar and unmounted during refetch (the reloadKey-family suspect).
Un-gated in one file. Measured: transitionrun -> start @2273 -> end @2540 (267ms tween = the
duration token) on the SAME node (identity ===), end state 4 of 10 / 40%; fresh load clean
[ABSENT, 172]; chip still 4px green; MLB bar/no-ring/strings intact. Gate data: CIN-KY Jul 10 =
42, one note. Two-defect bounce -> instrument-mandated diagnosis -> one-file fix is the L3
pattern working as designed.
**Gate 4 (2026-07-28): e2e "Nav matrix (local build)" FAILED the PR - and it is right.** Cold
`?account=CIN-OH&period=P6` throws `TypeError: null.start` in `buildDrillFooter` (OpsRail render):
`2d03dcd`'s un-gated mount renders the rails before cold-load data exists, killing the workspace
subtree (steppers gone = the 3 CI failures; top-bar dropdown survives = the passing cell). Bounce
`CC_P3A_GATE_BOUNCE_3.md`: null-safe rails WITHOUT re-gating the mount (ring node stability must
survive), full null-read sweep of OpsRail/DrillRail helpers, and CC runs the spec locally before
pushing. **Process notes:** the handoff's "Playwright only tests prod" note is STALE - the nav
matrix builds and tests PR code; and Chat-Claude's MLB battery never included cold `?period=` deep
links - hole closed, added to the standing battery.
**Gate 5 (2026-07-28), fix `7c3084b`: PASS.** (First pass invalidated - dev server was down after
CC's local Playwright run; ERR_CONNECTION_REFUSED plus stale console; L: verify the server before
reading a gate.) On the live branch: cold `CIN-OH&period=P6` bare renders all three steppers + 28
tiles + MLB bar, zero new exceptions; tween regression clean - transitionrun -> start @2375 ->
end @2643 (268ms) on the SAME node, 5 of 10 / 50%; chip still 4px green. CC ran the nav-matrix
spec locally per mandate. Gate data: CIN-KY Jul 11 = 36 + one note.
**P3-A MERGED 2026-07-28** - #530, five commits, gates 1-5. Ring lives in the rail, sweep proven
frame-level, accent language shipped, CI green.
**P3-B built (PR #532 @ `3f1d21f`, 12 files +1014/-31; reads-first honored; local Playwright
[ran] green). GATE 1 (2026-07-28): BOUNCE - 2 P0 + 1 P1.** Measured across two instrumented
saves (CIN-KY Jul 12 = 40, Jul 13 = 38): session strip LIVE with correct sums, pill renders,
queue clears, toast + success screen retired. FAILS: ring tween DEAD AGAIN (zero transition
events x2 - regression of the gate-3/5 win; report claimed preserved [code-read], runtime
disproves; instrument-first in force from the start); tile flip NEVER fires (MutationObserver
saw no class add - likely DaySquare remounts on refetch making the ref-based transition
invisible by construction); sequence ends by CLOSING instead of sliding the next day in.
Report items: flight layer holds 6 nodes at idle; "2days" strip spacing; two-clock finalize
setTimeout must fold into the coordinator. Jul 14/15/16 left unsaved DELIBERATELY for the
re-gate's month-complete trigger. Bounce: `CC_P3B_GATE_BOUNCE.md`.
**RE-GATE 2 (2026-07-28) on `7c55a89`: partial.** CLOSED: tile flip (workspace-level detection,
observer-verified on the exact tile); idle layer 6->1; Map re-edit semantics exact ($1,167.94 for
the 45 re-edit, no double-count); orphan CSS deleted. STILL OPEN: ring tween (NEW mechanism data -
node identity TRUE + transition armed + zero events on the pct-moving save; re-edit control
exonerates the instrument; value applied late or outside the transition - 10s instrumented window
mandated); next-day advance (open @848ms then CLOSED, twice, with work remaining); strip spacing.
NEW REPORT ITEM: ring reads 67% with ZERO actionable days on CIN-KY July - ring derive vs queue
filter population mismatch, decides whether month-complete can ever fire on off-day-tailed months.
ENVIRONMENT: CIN-KY July exhausted (Jul 15 = planned-off, schedule-truth correctly hides
no-service); deferred items (failure/no-service/month-complete/RM/MLB) need a probe-picked surface
- CC delivers an actionable-days probe with the report. Bounce: `CC_P3B_GATE_BOUNCE_2.md`.
Gate data this round: CIN-KY Jul 14 = 45 (final value after re-edit test).
**GATE 3 (2026-07-28) on `447b8db`: P1 + P3 CLOSED, P0 one log from solved.** CC's
instrumentation (three streams + decision table, graded A) captured the mechanism live on an
STL-FL save (Jul 2 = 30 served): style mutation on the SAME retained node (227.89 -> 220.536,
no re-mount log) + armed 0.28s transition + ZERO transition events = the element is not painted
at write time; it reappears at the new value. Bounce 3 (`CC_P3B_GATE_BOUNCE_3.md`) adds ONE
paint-state log inside the observer, then the fix, then instrumentation retires. **Advance
CONFIRMED FIXED** by its own logs (`branch=advance` -> July 3 open) - Chat-Claude's re-gate-2
"still broken" was a false negative (end-of-queue closes were correct; environment assumption
error, owned). Strip separator fixed. **Month-complete RULING: interpretation A stands** - the
card fires only at complete===total (the card IS the ring closing; a 67% card would contradict
the ring); the "all caught up" queue-empty micro-moment -> hopper, owner-optional. Probe blocked
by CC's env classifier (correctly); OWNER RUNS:
`node --env-file=.env.local scripts/_probe_sc_actionable_by_month.mjs` and pastes output for
the re-gate-4 surface pick. STL-FL Jul 3 modal left open pristine on the browser (one click to
close, nothing typed).
**GATE 4 (2026-07-28) on `02fd632`: P0 RING CLOSED.** CC shipped the double-rAF defer + paint-state
log together; my acceptance save (STL-FL Jul 8 = 25 served) produced the full receipt:
commit 10->14 -> style mutation -> ALL ancestors visible rects=1 -> transitionrun @249858 ->
transitionend @250133 (274ms = token), same instance, advance fired again (July 9 slid in).
**Every P3-B defect is now closed.** The defer (committedOffset) is permanent; ALL diagnostic
instrumentation ordered retired in one commit (supersedes CC's "paint-state stays" note).
**Probe grain bug caught from its own output**: sc_daily_revenue is service-grained + v2 writes
only touched services, so entered days with untouched services counted as actionable (CIN-AZ
July "17" vs gate-verified 100%; CIN-KY listing my written Jul 8). Fix ordered: day-level
MAX(has_actuals)=0 aggregation, re-run (classifier now auto-allows), sanity anchors pinned.
Order file: `CC_P3B_RETIRE_AND_PROBE.md`. STL-FL test data running total: Jul 2 = 30, Jul 8 = 25,
Jul 18 = 100 (2B era); July 9 modal left open pristine.
**Retirement (`fcbbfa4`) + probe grain fix (`b86b3c0`) landed** - anchors caught a second bug
(zero-count projection days = planned-off) AND silent pagination truncation (15,805 rows vs 1,000
default). All three anchors pass verbatim; the table is trustworthy.
**RE-GATE 5 (2026-07-28) on `b86b3c0`: the big five ALL PASS.** Surfaces: TBJ-FL June (fully-aged,
2 actionable) for failure + RM + month-complete; TBR-FL Jul 25 for no-service; CIN-OH for MLB.
Measured: failure = zero motion (banner, frozen ring, intact value); RM = instant end states +
immediate finalize + session commit; **month-complete card FIRES on the completing save** ("Month
cleared", green token x4, dismiss clean); no-service = no pill/no toast/amber rail; MLB cold P6 +
month + v1 + no strip clean (inert global HandoffLayer div on MLB accepted).
**FINAL FOUR bounce (`CC_P3B_FINAL_FOUR.md`):** card label "Stay in month" -> must be the month
NAME; completing-save finalize clobbered by the mc startHandoff (day modal stays open behind the
card); no-service never commits to the session strip (Ruling 5 violation - commitSessionOnly);
no-service inline confirmation unverified. Gate data: TBJ-FL Jun 29 = 88, Jun 30 = 92, TBR-FL
Jul 25 = no-service.
**+RIDER (owner live observation 2026-07-28): tiles flip on LOAD** - prevHasActualsMap starts
empty/stale so `undefined -> true` reads as a transition; every entered day flips on mount and
scope change. Guard: flip only on explicit `false -> true`; seed silently on load + scope change
(`CC_P3B_LOAD_FLIP_RIDER.md`, rides the final-four commit). Chat-Claude battery hole owned: gates
watched the flip DURING saves, never ran a load-time animation-absence sweep - added to the
standing battery.
**RE-GATE 6 partial (2026-07-28) on `f126e85`:** load-flip guard VERIFIED (zero flips across two
month hops) - then **P0 CRASH found: TDZ `Cannot access 'handoff' before initialization` in
DayEntryV2** - the no-service commitSessionOnly call sits above the `const handoff` declaration;
every v2 panel render throws, full-page error boundary. CC's build + Playwright green because the
nav matrix never renders DayEntryV2 (standing test gap, evidenced). Second defect same load: a
useEffect dep array CHANGES SIZE between renders. Hotfix bounce: `CC_P3B_TDZ_HOTFIX.md` (move the
declaration; make the dep array constant). Card label + finalize-chain fixes verified code-level
on the remote; their live proof = the July close on Aug 1 (field-check item).
**TDZ hotfix `a1e8af1`** (declaration to :210, above every callback) - took three rounds: two
unpushed reports, then a pinned character-level order. Standing rule added: every CC fix report
must end with the verbatim push line or it is incomplete.
**RE-GATE 6 (2026-07-28) on `a1e8af1`: PASS.** Crash gone; zero flips on load; no-service Jul 27 =
inline "No service recorded" survives refetch + auto-closes ~3s + commits to strip at zero + no
pill/toast; positive control Jul 28 = 55 flips EXACTLY one tile, strip "2 days entered · $980.51",
ring 88%, advance fired; MLB cold P6 clean. **ONE RIDER before merge** (`CC_P3B_STRIP_CURRENCY.md`):
strip renders a bare "0 this session" at zero revenue (conditional `$` prefix) - use `fmt$`
unconditionally on the per-meal figure. **Accepted, not a defect:** the no-service tile DOES flip -
ambient data-truth motion, same class as the ring; Ruling 5 forbids the celebration, not the board
updating. Card label + finalize-chain remain code-level verified; live proof = the July close on
Aug 1 (field check). Gate data: TBR-FL Jul 27 = no-service, Jul 28 = 55.
**ORPHANED DESIGN DECISION FOUND (owner spotted 2026-07-28):** the early design-review round
resolved "Match projections fills green and **holds state**; Clear slides out from behind it
(300ms ease)" and the audit logged "No Clear affordance exists". **Neither half was ever built** -
live code has one inert `Match projections` button, no held state, no Clear sibling. It never
entered a phase scope (0/1 correctness, 2A/2B bulk+STL-FL, 3 Handoff). NOT riding #532. Needs two
owner rulings before build: (1) does Clear revert to the pre-fill values (which may be operator-
typed) or blank the group; (2) does Clear survive an edit to a filled value or vanish on first
edit. Slot: with the bulk composite round, post-merge. **Process note: design-review resolutions
need a home in a phase scope or they orphan - sweep the review rounds for other unbuilt
resolutions before Phase 5.**
**RIDER SHIPPED + VERIFIED (`f00d8a3`):** strip reads "1 day entered · $0.00 this session" on a
no-service-only session (measured TBJ-NY Jul 7; TBR-FL July was exhausted). **CI GREEN on #532** -
nav matrix (local build), preview smoke, migration gate, Vercel all pass; only deliberate skips
remain. **P3-B RE-GATE 6 COMPLETE: VERDICT MERGE.** Seven commits, six gate rounds.
**P3-B MERGED 2026-07-28 - THE HANDOFF IS LIVE IN PRODUCTION.** #532, seven commits, six gate
rounds. Phase 3 complete (P3-A ring/accent + P3-B choreography).
**MLB SC v2.1 SCOPED INTO §15 (2026-07-28)** - the Phase 4 hard stop was honored: MLB opened with
an owner discussion, then two read-only CC investigations, then an alignment the owner reviewed.
§15 now carries the full scope (18 owner rulings, the derivation proof, the budget data, the
architecture, the 7 build pieces, open questions, risks). **§16 added** - the full-system test plan
this doc feeds once MLB ships, with the standing battery consolidated in one place. Headline
findings: homestands derive cleanly from game data (13/13/12/12 blocks, 3-11 days, no threshold
needed); the stored `homestand_id` is structurally unfixable, not merely stale (a postponed game
carries its tag to the new date - STL-MO's 32-day block is that, and it is **rendering live in
production today**); SC holds zero cost concept, so the money plane is built from nothing; budgets
are living, not annual imports (TXR-H moved $40k hourly->salary mid-season). Recommendation on
record: ship the derivation fix as its own small PR ahead of the rest - owner decision pending.

**MATCH/CLEAR RULED + SCOPED (2026-07-28, `CC_MATCH_CLEAR.md`, own PR - NOT bundled with bulk
composite; two unrelated things in one gate is how rounds get messy).** Owner rulings: (1) Clear
undoes the auto-fill only, back to the ghosted projections; (2) Clear survives editing a filled
value and reverts the whole group including the hand-edit. **Chat-Claude edge ruling:** on a day
with SAVED actuals the pre-Match state is the seeded saved values - restore those, never ghosts
(clearing a saved day to ghosts would hide real data). Design: per-group snapshot at Match time,
Match holds state, Clear slides 300ms on duration tokens (RM-free), drops on clear/day-nav/close,
v2-only so MLB is untouched by construction. **Read ordered:** Match renders behind
`hasProjectedRevenue` (`gsProjected.revenue > 0`) - on fee accounts prices are $0, so Match may
not render on STL-FL at all; CC reports, does NOT silently fix (separate owner gap if confirmed).
**Queue:** Match/Clear -> bulk
composite -> **PHASE 4 HARD STOP (owner
directive 2026-07-28): before ANY Phase 4 / MLB prompt is written, pause for an owner discussion
about MLB in the SC.** Chat-Claude brings a discussion brief at that point (likely ground:
whether MLB adopts entry-v2 as-is or needs its own homestand-shaped treatment; the MLB rail/ring
question; Handoff fit for game-day operators; the unbuilt fee-schedule revenue reporting). No
fence-lift, no prompt, until that conversation happens. (`CC_P3B_HANDOFF.md` archive:
success-toast + justSaved retirement, month card, RM path, offline chip - moved here from
P3-A, its data source is the save queue).
round 2 (2026-07-25):** ENTRY_V2_ACCOUNTS has exactly one code consumer - fence safe. Annual-fee
find: no server field exists, and the two contract docs carry a framing split - $2.3M flat total
(ACCOUNT_SERVICES_BRIEF:564, canonical) = $1.4M services + $0.9M food passthrough
(SC_CONTRACT_BILLING_SUMMARY:82). Ruled option (B): `contract.js` cited constant displaying the
approved $2,300,000, full split documented in the comment, server-side field deferred to Phase 4
when the four MLB fee accounts make contract data worth modeling (`CC_P2B_RULINGS_2.md`). CC
builds; gate next.
**Queued behind 2B (owner GO given 2026-07-25):** archive-edge guard - `CC_ARCHIVE_EDGE_GUARD.md`
written. Client per-day `isInServiceOnDay` filter in both bulk write paths, plus honest-skip
marking in BulkReview (owner Q&A ruling: guard is an archive-date check, never a projection check;
unprojected-but-active services must write normally; skips must be visible before confirm; the
lever for genuine extensions is the catalog end date).

---

# 1. THE HEADLINE

**Two truths, both evidenced:**

**(a) The pos-style v2 rebuild is better looking and functionally worse than the v1 modal it
replaced.**

| | v1 (legacy) | v2 pos-style |
|---|---|---|
| Service content visible | **100%** (311px box / 311px content) | **~20%** (106px box / 513px content) |
| Save button reachable | **Yes** (y=464) | **No** (y=754, viewport 555) |
| Ledger (notes + change log) | **Renders correctly** | **Renders blank** (field-name bug) |

**(b) The engine underneath has three real data-integrity defects** — none visible in the UI, all
touching billing data.

The project: **bring v1's working behavior onto v2's surface, fix the engine defects, and converge
PDC + MiLB + STL-FL onto one entry experience. MLB follows separately as v2.1.**

**Weighting principle:** operators enter actuals → Accounting bills clients from those actuals.
**The entry path is the billing data path.**

---

# 2. OWNER DECISIONS (locked 2026-07-22)

| # | Decision | Consequence |
|---|---|---|
| 1 | **MLB gets its own phase: "MLB SC v2.1"**, after PDC + MiLB are working. MLB has nuances and specific rules that must not be mixed into the PDC/MiLB work. | MLB is **out** of Phase 2. See the fence warning in §7. |
| 2 | **Ledger = hybrid** | Summary line per event, expandable to per-service detail |
| 3 | **Add "first entered" rows** | Ledger shows original entry, not just edits |
| 4 | **Bulk = all-or-nothing (Option A)** | Comes free with the `sc-bulk-submit` swap |
| 5 | **Quick wins = two PRs split by risk** | PR-A UI-only, PR-B engine |

**Scope boundary:** "PDC + MiLB working" **includes STL-FL** (fee account — different billing model,
same operator workflow). MLB is the only account type deferred.

---

# 3. P0-A — DATA INTEGRITY (engine; invisible in the UI)

**A1. Bulk save is a client-side loop of single-day POSTs.**
`ServiceCalendar.js:1702-1741, 1786-1818` — `for (const dk of bulkSelected) { await fetch(...) }`.
30 days = **30 sequential round-trips ≈ 30 seconds** of "Saving…". The server already has
`sc-bulk-submit` (`route.js:707-729` → one `.upsert()` for all rows) — **the client never calls it.**
Partial failure is per-day: day 7 errors, days 8-30 continue → a "failed" bulk can be half-committed.

**A2. `Number(e.value) || 0` silently zeroes malformed input.**
`route.js:637-640`. Non-numeric → `0`. Empty → `0`. `"12.9"` → PG truncates to `12`. Client
digit-stripping is the *only* defense. **A wrong zero is plausible ("no service that day") and an
operator will not spot it.**

**A3. Day-level save is not atomic → silent partial success.**
`route.js:641-679` — three sequential awaits, no transaction. `auditNote` failure leaves actuals
**committed** but returns 500, so the toast says "Save failed" when the data saved.

**A4. Abandonment gives no confirmation.** Client abort doesn't stop the server write. Navigate away
mid-save → row lands, operator never learns.

**A5. No conflict detection.** Two operators on the same day = last-write-wins, no version check.

**A6. 500-class failures don't queue.** `saveQueue.js` is well built but only queues true fetch
rejects; a server 500 relies on manual retry.

---

# 4. P0-B — WORKFLOW BLOCKING (UI; measured live)

**B1. Most services cannot be entered.**
PDC: Minor League 106px box / 513px content; Rehab 78px / 376px. MiLB reproduces (256px / 445px).
**Root cause:** `.sc-v2-entry-list` is `flex-direction: column; overflow-y: auto`, but
`.sc-v2-entry-group` has `overflow: hidden` and **no `flex-shrink: 0`** — groups shrink instead of
the list scrolling, then clip.
**Worse than it looks:** keyboard nav reaches clipped inputs, so **an operator can tab into a field
they cannot see and type blind.**
**Match projections writes ALL in-service services regardless of visibility** — currently the only
way those services get values.

**B2. The rail "needs entry" queue does nothing.**
Rail rows `router.push(buildScUrl(...))` with `?day=`, which is wired **only** for tile scroll/focus.
`buildScUrl`'s own comment: "NEVER opens DayDetail." The modal mounts only from `setFocusDay()` on a
tile click.

**B3. "Confirm & save" is below the fold.** y=754 in a 555px viewport.

**B4. Bulk "Enter custom values" opens the legacy v1 surface.** (#11)

**B5. Fee accounts (STL-FL) are entirely on v1.** Hard fence at `flags.js:187-197`.

**B6. Save lag is the post-response refetch chain, not the request.**
`reloadKey` bump triggers **2-4 concurrent effects** → `sc-load` + `sc-year-summary` (+ period-months,
+ month-drill) → full aggregator recompute → re-render with animated numbers. **No optimistic update
anywhere.**

**B7. Ledger renders blank.** (#7) `DayEntryV2.js:1223-1264` reads `e.body || e.text || e.summary`
and `e.createdAt || e.ts || e.postedAt` — **none exist.** Rows carry `.note` and `.timestamp`.
v1 reads the correct fields.

---

# 5. THE GOOD NEWS (already built)

- **The audit trail exists and is fully populated.** `sc_daily_actuals_history` + DB trigger on every
  value-changing UPDATE across *all* save paths. `readHistoryEntriesForRange` returns display-ready
  rows. **The Ledger is UI-only work.**
- **Immediate note posting exists** (`sc-add-note`, independent of actuals) — exactly #7's ask.
- **The write path is 100% account-shape agnostic.** One payload builder serves every account.
- **The batch save endpoint exists** (`sc-bulk-submit`) — just isn't called.
- **Offline/network resilience is well built** (`saveQueue.js`).
- **Revenue is derived, not written** — fee-vs-per-meal is entirely read-side.

---

# 6. QUICK WINS — five small fixes retire the five worst problems

| Problem | Fix | PR | Status |
|---|---|---|---|
| B7 Ledger blank | Field reads + **edit-row branch** | **A** (UI) | ✅ **MERGED** #491 |
| B1 Services unreachable | `flex-shrink: 0` on `.sc-v2-entry-group` | **A** (UI) | ✅ **MERGED** #491 |
| A1 Bulk 30-second freeze | Call the existing `sc-bulk-submit` | **B** (engine) | in flight |
| B6 Save lag | Optimistic patch from the save response | **B** (engine) | in flight |
| A2 Silent zeroing | Server-side integer guard that 400s | **B** (engine) | in flight |

### PR-A gate results (2026-07-22) - PASS

**Clipping (B1) - the revenue-capture defect is closed:**

| Account | Group | Before | After |
|---|---|---|---|
| PDC | Minor League | 106 / 513 - **407px hidden** | **513 / 513 - 0 hidden** |
| PDC | Rehab | 78 / 376 - **298px hidden** | **376 / 376 - 0 hidden** |
| MiLB | Louisville Bats | 256 / 445 - **189px hidden** | **445 / 445 - 0 hidden** |

`flex-shrink: 0` on every group; list scrolls (504 visible / 1115 content). Every service reachable.

**Ledger (B7) - both row types render:**
- Edit row: `--edit` variant · Jul 9 9:15 PM · k.fietek@kitchfix.com · "Lunch 25 → 0"
- Note row: `--note` variant · Jul 8 8:18 PM · "Kevin Fietek" · full text

**CC found 3 mismatches beyond the 2 specified** - `e.id`→`e.key`, `e.kind`→`e.type`, and **no edit-row
branch existed at all**. Edit rows are the majority of the Ledger on any active day, so fixing only
the two named fields would have shipped a Ledger that still showed nothing useful. The "check for
others" instruction earned its place; keep it in future prompts.

**Regression:** STL-FL v1 ✅ · **MLB v1 - §7 fence holding** ✅ · DayDetail.js untouched ✅ ·
`mergeActivity` untouched ✅ · no modal-shell/save-position changes ✅

**Split per decision #5:**
- **PR-A (UI-only):** cannot touch data. Low risk, immediate visible wins. Ships first.
- **PR-B (engine):** touches the save path that writes invoice numbers. Own gate, own scrutiny,
  clean revert.

---

# 6B. PR-B GATE RESULTS (2026-07-22) - 2 PASS, 1 REGRESSION

**PR #493, branch `feat/sc-entry-p0b` @ c23e75d. NOT merged.**

## ✅ Fix 1 - bulk endpoint swap: PASS
Measured live: a bulk save fires **one `sc-bulk-submit` call with 13 entries**. The per-day
`sc-submit-day` loop is gone from both `handleBulkSave` and `handleBulkConfirm`. 30-day bulk goes
from ~30 sequential round-trips to one. All-or-nothing holds by construction (single `.upsert()`).

## ✅ Fix 3 - server integer guard: PASS
Direct API calls:

| Input | Result |
|---|---|
| `"abc"` | **400** - *"Invalid value for service 1: got \"abc\", expected a non-negative integer"* |
| `"12.9"` | **400** - names the PG-truncation risk |
| `-5` | **400** - *"must be non-negative"* |
| `""` | **accepted as 0** (correct - deliberate zero from a cleared field) |

Messages name the offending service, which is what the bulk failure UI (§ bulk render Step 4) needs
to say *which day and which field* failed rather than "save failed".

## ❌ Fix 2 - optimistic patch: FAIL (regression - worse than what it replaced)

**Measured** (PDC CIN-AZ, Thu Jul 16, drill view). Save succeeded server-side - toast read
`Recorded $930.81 · 95 meals · Thursday, July 16` with real server values.

| | Tile 16 | Month rail hero |
|---|---|---|
| before save | `needs-entry` · 405 meals · est. $5K | $61,181.30 |
| **+5s after** | **unchanged** | **unchanged** |
| **+9s after** | **unchanged** | **unchanged** |
| after hard browser reload | `entered` · 95 meals · $931 | $62,112.11 |

**The view never updates until a manual reload.** Previously the operator saw a skeleton then correct
data; now they see stale data indefinitely and would reasonably conclude the save failed and re-enter
the day.

### Diagnosed cause (hypothesis - CC verifying)
Two failures stacked:
1. **The patch is not reaching the drill view** - if it were, the tile would have shown 95 meals
   immediately.
2. **The refetch stopped firing.** `delete monthCache[mk]` was doing **two** jobs: forcing the
   skeleton (the freeze CC correctly diagnosed) **and acting as the trigger for the month loader**.
   If that loader is guarded on "fetch months missing from monthCache", removing the delete means it
   skips - `reloadKey` bumps for nothing and no fresh data arrives.

**Lesson:** the fix removed a second thing the deleted line was doing. Not careless - a genuine
second-order effect, and precisely what runtime gating exists to catch. Code review would not have
found it.

## New items found during this gate (logged, not yet resolved)

- **`Number(result.savedRevenue) || 0`** in the patch is the same pattern we just removed from the
  server. If the field is absent it displays a fabricated zero. Should patch counts only when totals
  are missing. Sent to CC.
- **`day.status` is deliberately not patched** (server `classify()` owns it). Once the patch works,
  a tile may read "95 meals" while still amber `needs-entry` until the refetch lands. **This matters
  for the approved Handoff design - the tile turning green is the reward beat (§8B).** Need CC's
  runtime answer before the animation can be finalised.
- **Bulk toast now passes `amount: 0, meals: 0`.** If `buildRecordedToast` renders `$0.00` on a
  *successful* bulk, that is a new defect. CC to report the exact rendered string.

## Flags CC raised, accepted as-is
- **rideNote on bulk:** neither client loop sent one, so the `sc-bulk-submit` fence drops nothing. ✅
- **saveQueue cannot represent a batch:** on bulk network failure it falls back to N per-day
  enqueues. The server never received the batch, so no partial commit. **Atomicity is online-only;
  offline replay is per-day.** Accepted - logged in case the queue shape should evolve later.
- **Bulk optimistic patch skipped:** `sc-bulk-submit` returns no per-day totals, so patching would
  mean fabricating numbers. Correct call - the rule held.

---

# 6C. FIX 2 (OPTIMISTIC PATCH) - FAILED TWICE, MOVED TO PHASE 1

**Verdict: reverted from PR-B. Re-scoped to Phase 1.** Prompt: `CC_PRB_SPLIT.md`.

## The deciding fact
**Before PR-B, the view DID update after a save** - slowly, via a skeleton. That slowness was the
freeze we set out to fix. **Both attempts left the view permanently stale until a manual browser
reload.** Fix 2 in its attempted form is strictly worse than the defect it targets, so it does not
ship.

## Why it was mis-scoped (my error)
It was grouped into Phase 0 as a "quick win" because the fix looked like one line of cache handling.
It is actually a **rewrite of save-path refresh behavior across three loader effects and two cache
states** - Phase 1 architecture work. Grouping it with a CSS swap and a validation guard was wrong.

## Attempt 1 (v1) - failed
Replaced `delete monthCache[mk]` with an in-place patch. **The delete was doing two jobs:** forcing
the skeleton (the freeze - correctly diagnosed) **and triggering the month loader.** Removing it
silenced the refetch entirely on drill views.

## Attempt 2 (v2) - failed
Added an imperative `refetchMonth(mk)` to bypass the loader guards, patched `day.status`, guarded
totals on `Number.isFinite`. Gate result:

| Observation | Detail |
|---|---|
| Tile never updated | Held `210 meals` for 6s+ after a save that recorded `217 meals` |
| **No `sc-load` after save** | Network log showed only `my-notifications`. `refetchMonth` did not fire or did not land |
| **Save button stuck on "Saving..."** | Indefinite, disabled. **New symptom in v2** |
| Rail week rows DID update | Week 3 `$7,040.99 2/5` -> `$10,965.81 5/5` while tiles stayed stale |

Server writes were correct throughout - toasts carried real server values and a reload always showed
the right data. **The defect is entirely in live view refresh, never in stored data.**

## Evidence trail for whoever fixes it properly
- Period-drill loader guard: `ServiceCalendar.js:704-705` - `if (missing.length === 0) return`
- Month-drill loader guard: `:750-751` - `if (monthCache[monthKey]) return`
- Calendar-view `sc-load` `:637-647` has **no** monthCache guard (fires on every `reloadKey`)
- `activeDrillDays = periodDays || monthDays` (`:1078`), both memos over `monthCache`
- Tile content from `buildLargeContent` (`PeriodWorkspace.js:943`) reads `d.hasActuals`, `d.actual`,
  `d.totals`, `d.status`
- **The unexplained part: rail week rows refreshed while tiles did not.** Part of the derived state
  updates and part does not - that is the thread to pull, and it means the problem is narrower than
  "the patch does not work"

## Consequence for the approved design
**The Handoff (§8B) depends on a save feeling instant.** Until Fix 2 lands properly, the Handoff
cannot ship. The **progress ring and accent-rail language can ship independently** - only the
transition motion waits. This was already flagged as a hard dependency in §8B; it is now a real
schedule dependency, not a theoretical one.

## Kept from the v2 work
The **toast money-line fix** survives the revert: `amount: null` (not `0`) on both bulk paths plus a
`Number.isFinite` guard on the single-day toast. Verified against `SubmissionToast.js:33` -
`Number.isFinite(0)` is `true`, so passing `0` printed **`$0` on a successful save**. Independent
real bug, unrelated to the optimistic patch.

---

# 6D. ⚠️ CORRECTION + NEW P0: "STALE VIEW AFTER SAVE" IS PRE-EXISTING ON MAIN

## The correction (my error, recorded so it does not propagate)
§6C originally argued Fix 2 was "strictly worse than doing nothing," on the claim that **before PR-B
the view DID update after a save** (slowly, via a skeleton).

**That claim was never verified. It is wrong.** It was inferred from reading the code path
(`delete monthCache[mk]` -> skeleton -> refetch -> repaint), not measured.

**Measured on the reverted branch** - which CC confirmed matches main's save-refresh behavior:

| | |
|---|---|
| Edit | Day 1, one service +5 |
| Server write | ✅ correct - toast `Recorded $2,862.70 · 222 meals` |
| Tile during session | **Never updated. Held `217 meals` past 8s.** |
| Tile after manual reload | `222 meals` - correct |

**Consequences of the correction:**
- **Fix 2 was NOT a regression.** It failed to fix a pre-existing bug; it did not create one.
- The split decision still stands, but for the surviving reasons only: Fix 2 failed twice, it is
  architecture work, and Fixes 1+3 are verified wins that should not wait.
- **Lesson: I asserted a baseline behavior from a code read instead of measuring it.** That is the
  exact failure mode this project keeps punishing ("CSS present != CSS winning"). Baselines get
  measured before they get used as an argument.

## The new P0 - B8

**After a successful save, the drill grid never reflects it until a manual browser reload.**

- Server write is always correct - toasts carry real server values, reloads always show the right data
- **The defect is entirely in live view refresh. Stored data is never wrong.**
- The rail week rows *do* refresh (Week 3 `2/5` -> `5/5`) while tiles do not - **part of the derived
  state updates and part does not.** That asymmetry is the thread to pull.
- Almost certainly part of what the owner meant by the save "glitching"

**This blocks the Handoff (§8B)** and is now **Phase 1 item 0**.

## Incidental finding
Already-entered days appear **not to be bulk-selectable** - selecting two entered days produced no
"All match projections" / "Enter custom values" actions. Partially answers the bulk-render open
question about overwriting entered days. Confirm during Phase 2.

---

# 6E. B8 SPLIT INTO TWO CONFIRMED DEFECTS (measured 2026-07-22)

Both paths measured live on `main`, PDC CIN-AZ `?month=2026-07`, `window.fetch` interceptor armed.

| | `sc-load` | `sc-year-summary` | Drill tile updates |
|---|---|---|---|
| **Refresh button** | ✅ fires | ✅ fires | ❌ **NO** (`230 meals` before and after) |
| **Save** | ❌ no | ❌ no | ❌ NO |

## B8a - the refresh signal writes to the wrong cache for the drill
The refresh button **does** refetch. `sc-load`'s response lands in `data` (:643) -> `dayMap` -> the
**calendar** view. The **drill** renders from `monthCache[monthKey]` via `monthDays` (:1047-1052).
The month-drill loader (:749-781) that would write `monthCache` is guarded
`if (monthCache[monthKey]) return` and early-returns because the month is still cached.

**The refresh button can never refresh the drill.** A real user-facing bug on main today, entirely
independent of saving. Found by CC's code-read (T2), confirmed by measurement.

## B8b - `handleSave`'s `setReloadKey` produces no fetches
The identical `setReloadKey(k => k + 1)` works from `handleRefresh` and produces **nothing** from
`handleSave`. The two paths differ by exactly one statement - the `setMonthCache` delete that
precedes it.

**The A/B:** comment out the delete, keep the bump, save.
- Fetches fire -> the delete suppresses them (a React state/effect interaction, not a missing call)
- Fetches still absent -> `handleSave` never reaches `setReloadKey`

One comment-out, one save, halves the search space either way. **Run before the log pass.**

## Correction to the record
CC's report attributed the refresh-button observation to me; **I had never tested it.** Its analysis
was right, the attribution wasn't. Second time an unverified premise nearly drove a design in this
workstream (see §6D for the first, which was mine). **Both are now measured.**

## Architectural finding - confirmed, now evidenced
CC: *"`reloadKey` is a shared trigger meaning 're-run all effects', but each effect has different
guards, so re-running without invalidating the right caches produces silently different behaviour per
view."*

The refresh-button measurement proves it: **`sc-load` fires, succeeds, and the drill still shows stale
data - because the response went to a state slot the drill does not read.**

**Right shape:** loaders honour an explicit per-month **force** signal, so any caller (`handleSave`,
refresh, queue replay, `invalidateAll`) can say *"refresh this month"* without knowing which slot
backs it. **Phase 1 design task, ~100-150 lines, ServiceCalendar.js data-layer only. No DB/server.**

## Rider that must travel with the fix
`setFocusDay(null)` lives inside the `sc-load` effect (:640), so **every `reloadKey` bump closes the
modal.** Under a shared-invalidation refactor, a refresh click would close an open modal - a new bug.
It is also incompatible with the approved Handoff, where the modal stays open through the animation.
**Extracting that side effect is part of the fix, not extra scope.**

## A/B RESULT (2026-07-22) - the `setMonthCache` delete is INNOCENT

Branch `exp/b8-ab-delete-out`, delete commented out, interceptor armed. Day 1, `100 -> 103`.

| | |
|---|---|
| Fetches after save | **`sc-submit-day` only** |
| `sc-load` / `sc-year-summary` | ❌ neither fired |
| Toast | ✅ `Recorded $3,004.55 · 233 meals` - success branch ran |
| `finally` | ✅ ran (button not stuck) |

**Proven:** the success branch executes, `finally` executes, and `setReloadKey` between them produces
no effect fan-out - while the **identical setter** from `handleRefresh` fires both effects.

**Remaining structural difference: calling context.** `handleRefresh` runs synchronously in a React
event handler; `handleSave`'s success branch runs in an **async continuation after `await`**.

**Next:** instrument both paths in one session and diff the console traces. The point where they
diverge is the bug. Critical distinction to capture: *effect never ran* vs *effect ran and bailed
before `fetch`* - the interceptor wraps `window.fetch`, so an **aborted** fetch would still have been
recorded. Nothing was. So `fetch` was never called.

---

# 6F. B8b ROOT CAUSE (found 2026-07-22, instrumented)

## The traces
**SAVE** - the entire trace:
```
B8-MARKER: --- clicking save now ---
B8: finally
```
No `toast fired`. No `pre-bump`. No `post-bump`. No `CAUGHT`.

**REFRESH** (working, for contrast):
```
B8: handleRefresh clicked, bumping reloadKey
B8: handleRefresh post-bump
B8: sc-load CLEANUP (abort prior fetch)
B8: sc-load EFFECT RAN, reloadKey= 1  selectedAccount= CIN - AZ
B8: sc-load ABOUT TO FETCH 2026-07
```

## The cause
`handleSave` returns **before** `if (result.success)`. The only exit there is
`if (!isMountedRef.current) return result;`

**`isMountedRef.current` is `false` when the save response lands.**

**Proof of remount:** after each test the effect logs show `reloadKey= 0` - reset from the `1` the
refresh had set. Fresh mount. The doubled empty-`selectedAccount` pairs are React StrictMode
double-invoking effects.

## Why success *looked* confirmed the whole time
The "Recorded $X · N meals" panel is **not the parent toast**. It is **DayEntryV2's own success
screen** (local `justSaved`), driven by the value `handleSave` *returns* - and it returns `result` on
the early-exit path. **The modal says "saved"; the app never hears about it.**

## This single fact explains every symptom across all three failed attempts
- No refetch - the bump never runs
- No tile update - no refetch
- **The stuck "Saving..."** - `setSaving(false)` is *also* behind the mount guard
- The toast appearing regardless - different component entirely
- The `setMonthCache` delete being innocent - execution never reached it

## The open question that decides the fix
**Dev-only artifact, or production too?**

Prime suspect is the classic mount-guard bug:
```js
useEffect(() => {
  return () => { isMountedRef.current = false; };   // nothing sets it back to true
}, []);
```
Under StrictMode's mount -> cleanup -> mount, the cleanup sets `false` and nothing re-arms it. **The
ref would then be permanently false for the life of the page** - meaning this is not "unmounted
during save," it is "the flag was never re-armed," broken on *every* save from first render. That
matches everything observed. **If so, the fix is two lines.**

## B8a is untouched and still real
Even with B8b fixed, **a save that correctly bumps `reloadKey` still would not refresh the drill** -
the bump reaches `data`, the drill reads `monthCache[monthKey]`. Measured independently (§6E). The
two fixes are separate, and the `setFocusDay(null)` modal-close rider travels with B8a.

---

# 6G. B8b CONFIRMED — cleanup-only mount guard (2026-07-22)

## The bug, verbatim (`ServiceCalendar.js:1249-1252`)
```js
const isMountedRef = useRef(true);
useEffect(() => () => {
  isMountedRef.current = false;     // cleanup sets false
  ...
}, []);                              // NO mount body - nothing re-arms it
```

`useRef(true)` initializes once. The effect is **cleanup-only**. Under React StrictMode's
mount -> cleanup -> mount, the cleanup fires and nothing sets it back to `true`.

**`isMountedRef.current` is `false` for the entire life of the page, from first render.**

## Runtime proof
Save trace, complete: `>>> SAVE CLICK <<<` / `B8-NET: sc-submit-day` / `B8: finally`. Nothing else.

Page-load sequence **21 seconds earlier** shows the StrictMode double-mount (two `EARLY-RETURN,
no selectedAccount` pairs, then one populated run). **There is no remount at save time** - so the
flag was already false before the save started. That corrects the earlier "unmounted during save"
framing; simpler and worse.

## Blast radius - 13 guarded call sites, all dead
`:1321 :1335 :1348 :1385 :1490 :1588 :1594 :1599 :1632 :1679 :1763 :1853` - including the
queue-driver success handling, `refreshSyncing`, **`setSaving(false)` (the stuck "Saving..." from
PR-B v2)**, the note handlers, and both bulk handlers. Every one is a behaviour that has silently not
been happening. **Audit all 13 as part of the fix.**

## The fix
```js
useEffect(() => {
  isMountedRef.current = true;      // re-arm on (re)mount
  return () => { isMountedRef.current = false; /* abort loop */ };
}, []);
```
Two lines. **Grep for the class** - `useRef(true)` plus cleanup-only effects that set a ref false.

## Why "success" always looked confirmed
The green "Recorded $X · N meals" is **DayEntryV2's own success screen** (`DayEntryV2.js:652-673`,
local `justSaved`), rendered off the `result` object that `handleSave` returns **even on the
early-exit path**. Its figures are computed **client-side** from the operator's typed values
(`:382-392`), so they match the server without any server round trip. **The modal congratulates
itself; the app never hears.**

## Hypotheses killed along the way (by CC, with code)
- **`saveQueue` replay** - `scEnqueue` is only reachable from `handleSave`'s catch on a **network-class**
  failure. A successful POST never enqueues. Confirmed by probes: queue-driver never ran. *(Mine, wrong.)*
- **Session-transition unmount** - no remount occurs at save time. The `ClientFetchError` in the dev
  log was a red herring. *(CC's, wrong.)*
- **The `setMonthCache` delete** - cleared by A/B; execution never reached it.

## B8a re-scoped SMALLER
#332 already put `monthCache` in the loader deps, so the delete pattern invalidates correctly. Once
B8b is fixed:
- `handleSave` reaches the delete + bump -> **the drill refreshes -> B8a's save half solves itself**
- `handleRefresh` still bumps `reloadKey` without invalidating -> **the refresh button still will not
  refresh the drill.** A genuine **~15-line fix, not a redesign.**

The earlier "widen the coordination surface" instinct was overreach - #338 deliberately *narrowed*
that surface to prevent a nav race, and the current shape is correct. **Re-verify after B8b lands.**

## FIX SHIPPED — PR #501 (awaiting gate)
`fix/sc-mount-guard-rearm` — mount body added, flag re-arms on every mount. Same cleanup contents.

**Severity resolved: DEV-ONLY in production terms.** `next.config.mjs` does not set
`reactStrictMode`; Next 16 defaults it to `true`, and StrictMode's effect double-invoke is dev-only
per React docs. **Operators were not affected.** The fix ships anyway - the guard shape is wrong
regardless, and a real prod unmount/remount (session flip, error-boundary reset) hits the same
behaviour.

**Class audit [ran]:** `grep -rn "useRef(true)" src/` → **1 hit** (the fixed one).
`grep -rn "useEffect(() => () =>" src/` → 2 hits, the other being a benign timeout cleanup with no
state guard. **The fix closes the whole class in one place.**

**Abort-loop check:** during StrictMode's mount → cleanup → mount, `inFlightControllersRef.current`
is an empty Set, so the abort loop is a no-op at that moment. No collateral.

**Companion docs PRs:** **#500** the "instrument after the second failed fix" method entry (which
predicted this failure mode), **#502** the two technical entries - the cleanup-only mount-guard class
with WRONG/RIGHT code, and the DayEntryV2-success-screen-lies entry with file:line. **#502 also flags
the same client-computed success head in `DayDetail.js:1078`** - the v1 modal will lie the same way.

## Open (RESOLVED - see above)
**Dev-only or production?** StrictMode double-mount is dev-only; in prod the cleanup may never run and
the flag stays `true`. Verify with `npm run build && npm start` + one save. **Fix regardless** - the
guard is wrong - but the severity rating depends on it.

---

# 6H. B8b FIX GATED — PASS, all four accounts (2026-07-23)

`fix/sc-mount-guard-rearm` @ 7b9fabe. Measured live, `window.fetch` interceptor armed.

| Account | Surface | Tile update | Time |
|---|---|---|---|
| **PDC** (CIN-AZ) | v2 | 236 → **243 meals** | **561ms** |
| **MiLB** (CIN-KY) | v2 | 135 → **5 meals**, overdue `!` cleared | **326ms** |
| **STL-FL** | v1 | 140 → **9 served** | **530ms** |
| **MLB** (CIN-OH) | v1 | **fence holding** (0 v2 elements) | — |

**Also confirmed:**
- `sc-load` **and** `sc-year-summary` now fire after every save. Both were dead.
- Save button returns to normal. **The stuck "Saving..." is gone** (it was `setSaving(false)` behind
  the same guard).
- **The fix works on v1 as well as v2** — the guard lives in the shared parent, so every entry
  surface was affected.

**Deliberate negative check — B8a still broken, exactly as predicted.** Refresh button fires
`sc-load` + `sc-year-summary`, drill tile unchanged (`243 meals` before and after). **Confirms the
~15-line scope estimate rather than it being accidentally solved.**

**Test-method note:** STL-FL first read as a failure. It was not — v1 has a **two-step** flow
("Review & save" → a *"Review before saving"* confirmation screen → save). I had stopped at step one,
so no save was submitted and nothing should have updated. Completing step two gave the pass above.
**Worth remembering when gating v1 surfaces.**

## Verdict: merge #501, #500, #502

## Next: B8a — the refresh button, ~15 lines
`handleRefresh` bumps `reloadKey` only. The drill loader's guard (`if (monthCache[monthKey]) return`)
passes because the month is still cached, so it early-returns and the drill stays stale. `handleSave`
now works because it *also* deletes the month first.

**Fix:** give `handleRefresh` the same delete-then-bump the save path uses, scoped to the
currently-viewed month(s). **Preserve #338's narrowing** — invalidate only the month(s) in view, never
the whole cache, or the nav race returns.

**Rider that travels with it:** `setFocusDay(null)` inside the `sc-load` effect means every
`reloadKey` bump closes the modal. A refresh click would close an open modal, and it is incompatible
with the approved Handoff (§8B), where the modal stays open through the animation. **Extract that side
effect as part of B8a, not as extra scope.**

---

# 6I. B8a GATE (2026-07-23) — Fix 1 PASS, Fix 2 half-fixed

## Fix 1 — refresh invalidates in-view months: **PASS**
Tested by writing **out-of-band** (direct API POST, bypassing the UI) then refreshing:

| | |
|---|---|
| API write to day 2 | `savedMeals: 404`, `savedRevenue: 5260.71` |
| Tile before refresh | `2 305meals $3K` — stale, correctly |
| **After refresh** | **`2 404meals $5K` in 286ms** ✅ |
| Wire | `sc-load [2026-07]` · `sc-year-summary` · `sc-load [2026-07]` |
| Cache-wide burst | **none** — in-view month only. #338 preserved ✅ |

## Fix 2 — modal survives, **but unsaved counts are wiped**: FAIL
Reproduced twice. Opened day 5, typed `55` (verified React registered it — save button enabled),
clicked refresh:

| | |
|---|---|
| Modal still open | ✅ yes |
| **Input value** | **`""` — WIPED** ❌ |
| **Save button** | **disabled** — dirty state also reset |

**This is worse than the old behaviour.** Before, refresh closed the modal — jarring but
unambiguous. Now it stays open and **silently empties**, with no dirty-state signal. An operator
sees a normal-looking form and does not notice their numbers are gone. **Shipping as-is would be a
regression in a data-loss direction.**

## Cause — downstream of CC's diff
The split is correct; the reset effect no longer fires on `reloadKey`. The wipe is almost certainly
**`DayEntryV2`'s seeding effect** (`~:148-162`), whose deps include `day.actual`. Refresh replaces
`monthCache[mk]` with a new payload object -> new `day` reference -> new `day.actual` reference ->
the effect re-runs and **overwrites `editValues` with server values**. Also explains the disabled
save button (`initialValues`/`touched` re-seeded, so `isDirty` is false).

## Required
**Unsaved operator input must survive a background data refresh.** The seeding effect must
distinguish *"a different day opened"* (seed — correct) from *"this day's data refreshed underneath
me"* (do not clobber). Recommended smallest honest fix: **guard the seed on `!isDirty` /
`touched.size === 0`** — refresh reseeds a pristine form, never a dirty one.

## Ruling on CC's flagged question
**Close the modal on drill nav** (widen reset deps to include `monthKey`/`periodKey`). Refresh and
save are **background events the operator did not ask for** — the modal must survive those. Month or
period change is **explicit navigation** — that is exactly when closing is expected. A July modal
floating over an August grid has no upside.

---

# 6J. B8a RE-GATE (2026-07-23) — v2 all passing, v1 needs the parallel guard

| Check | Result |
|---|---|
| **Fix 3** — typed `88`, refresh → preserved, save still enabled | ✅ |
| **Fix 2** — drill nav (Jul → Aug) closes the modal | ✅ |
| Save still closes the modal | ✅ |
| Save updates tile — PDC | ✅ **370ms** |
| Save updates tile — MiLB | ✅ **319ms** |
| MLB fence | ✅ v1 holding |
| **STL-FL v1** — typed `33`, refresh → **reverted to `9`** | ❌ |

**The data-loss regression is closed on v2.** CC's `seededDateRef` guard works: reseed on day change,
reseed when pristine, skip when dirty — while still syncing server-owned `noteEntries` /
`historyEntries` so the Ledger stays current.

## v1 ruling — apply the parallel guard (owner, 2026-07-23)
CC flagged v1 proactively and asked before touching it. **Correct call**, but measuring changed the
framing:

- **Before #503**, refresh did nothing to the drill, so on STL-FL the modal survived because
  **nothing happened**
- **After #503**, refresh works everywhere — so STL-FL **gains** the wipe

**It is a regression this PR introduces on a live production account**, not a pre-existing flaw we
are declining to fix. And "demolition-bound" is months away — v1 does not retire until Phase 5, after
MLB SC v2.1.

**Ruling: port the guard to `DayDetail.js:270-308`.** ~20 lines, pattern already proven on v2.
Targeted regression fix only — no v1 refactor.

## Note for the class
This is the **second** time today a fix on the shared/parent layer had a v1 twin that needed the same
treatment (the first: the B8b mount guard, which fixed v1 and v2 together because it lived in the
parent). **When a fix lands in a component that has a v1 counterpart, check the counterpart** —
"v1 is demolition-bound" justifies declining *improvements*, never regressions we cause.

---

# 6K. B8 CLOSED — full gate PASS (2026-07-23)

`fix/sc-refresh-invalidate` @ 1ae0e4e. Four fixes, all measured live.

| Check | Account | Result |
|---|---|---|
| **Fix 4** — typed `44`, refresh → preserved | STL-FL (v1) | ✅ *(was reverting to `9`)* |
| Day-nav still reseeds from server (case 1 intact) | STL-FL (v1) | ✅ Jul 2 clean |
| **Fix 4** — typed `66`, refresh → preserved | MLB (v1) | ✅ |
| **Fix 3** — typed `4`, refresh → preserved, save enabled | PDC (v2) | ✅ |
| Save updates tile + closes modal | PDC (v2) | ✅ **425ms** |
| Save updates tile | MiLB (v2) | ✅ **319ms** |
| Drill nav closes modal | PDC | ✅ |
| MLB fence | MLB | ✅ v1 holding |

**No surface loses unsaved work on a background refresh. Every account type verified.**

## What #503 contains
| Commit | Fix |
|---|---|
| `6e5b99a` | **Fix 1** refresh invalidates in-view months · **Fix 2** extract UI reset from the fetch effect |
| `fea374b` | **Fix 3** DayEntryV2 pristine seeding guard · Fix 2 amendment (reset deps widened to include `monthKey`/`periodKey`) |
| `1ae0e4e` | **Fix 4** same guard ported to DayDetail v1 |

## The seeding-guard pattern (three cases, both modals)
1. `day.date` **changed** → reseed everything (day-nav)
2. same day, **pristine** → reseed (refresh on a clean form should take server values)
3. same day, **dirty** → skip the value reseed, **but still sync `noteEntries`/`historyEntries`** so
   the Ledger stays current under a dirty form

CC verified v1's state shape rather than assuming it mirrored v2 — the pristine check turned out
identical (`touched.size === 0 && !notes.trim() && !standaloneDraft.trim()`), and the only v1-specific
state (`expandedExtras`, `showReview`) stays in the reseed branch.

## B8, end to end — what it took
- **B8b** (merged #501): `isMountedRef` was cleanup-only, so the flag was `false` from first render
  and every save skipped its refresh. Two-line fix. **Dev-only in production terms.**
- **B8a** (#503): the refresh button never invalidated `monthCache`, so the drill never saw fresh
  data — plus a modal-close side effect bolted to the fetch effect, plus the seeding wipe that
  surfaced once refresh actually worked.
- **Four failed fix attempts before instrumenting.** Three at the cache layer (wrong layer entirely),
  one half-fix that introduced a data-loss shape. What resolved it: probing both a working path and a
  broken path and diffing the traces.

---

# 6L. PHASE 1 — B2 + B3 (in flight)

**PR:** `fix/sc-p1-rail-and-viewport`. Prompt: `CC_P1_B2_B3.md`. Two independent fixes, one PR.

**B2 — rail queue click does nothing.** Root cause already traced: rail rows `router.push` with
`?day=`, which `buildScUrl` explicitly documents as focus-only ("NEVER opens DayDetail"). The modal
mounts only via `setFocusDay`. CC to choose between calling `setFocusDay` directly (my lean - uses
the proven path) or adding an `?entry=1` companion param (survives reload/shared links).

**B3 — modal viewport.** Implements the approved §8C three-zone layout: pinned header, scrolling
body, **pinned actions**. Measured defect: `Confirm & save` at y=754 in a 555px viewport - the button
that commits billing data is off-screen at the design-system minimum.

**Scope ruling carried into this PR:** B3 is **v2-only**. v1 is demolition-bound and this is an
*improvement*, not a regression we are causing - which is the distinction that made B8a Fix 4 go the
other way. Recorded so the precedent reads correctly later.

**§13A token discipline applies** - no new px literals for type/spacing/radius. I grep on gate.

---

# 6M. B2 + B3 GATE (2026-07-24) — both PASS, re-gate pending rebase

**PR #505**, `fix/sc-p1-rail-and-viewport` @ f314cd7. Measured on the branch **before** #503 merged.

## B2 — rail queue click: **PASS**
Clicked `Wed, Jul 22 · Needs entry` in the rail → **modal opened on Wednesday, July 22.** Correct
day. First time that affordance has worked.

CC wired all **four** rail entry points (`overviewTargetDay` :2527 · `feeTargetDay` :2556 ·
period `targetDay` :2701 · month `targetDay` :2904) and chose direct `setFocusDay` over an
`?entry=1` param — same path the tile click already proves, and it avoids adding a second URL
contract to a `buildScUrl` that documents `?day=` as focus-only. **Trade-off accepted:** a shared
link will not reopen the modal, matching tile-click semantics.

## B3 — pinned actions row: **PASS**, measured at 1280×800

| | Before | After |
|---|---|---|
| Save button | **y=754** (below fold) | **y=572–614**, inside a 657px viewport ✅ |
| Header | — | visible at y=33 ✅ |
| Actions row | did not exist | pinned 561–624 ✅ |

The billing-commit button is back on screen at the design-system minimum. CC extracted Confirm out of
`BillRail` into a sibling of the pane with `flex-shrink: 0`, and gated it desktop-only so it does not
compete with `MobileBooksBar`'s sticky action.

**§13A token discipline held** — zero new px literals for type/spacing/radius on added lines.

## Deferred, flagged honestly — §8C's "exactly one scroll region" NOT achieved
`.sc-v2-entry-rail` still scrolls independently, so the modal has two scroll regions. CC stopped
rather than expanding into a layout rewrite, per the stop-and-report rule. **The measured defect is
fixed; the architectural cleanup is a separate call.** Un-inverting properly means restructuring rail
composition — invoice line count runs 5-30 per account, so a non-scrolling rail forces either a clip
or a two-column redesign.

## Why a re-gate is needed
#505 was cut from main **before** #503 merged, so B8a's fixes were not on the branch. The specific
untested interaction:

**The rail path calls `router.push` before `setFocusDay`** — a URL change *plus* a state change, where
the tile path is state-only. #503's view-context reset effect now keys on `monthKey`/`periodKey`. If a
rail click alters the URL, a rail-opened modal could close itself. **Must be measured with both PRs
running together.**

## Post-rebase interaction defect — CONFIRMED (2026-07-24)

CC predicted this from a code read **before** I measured it, and the trace was exact.

| Scenario | Result |
|---|---|
| Month drill → rail click | ✅ stays open (`Wednesday, July 22`, held 8s) |
| **Overview → drill (PDC)** | ❌ **open at 0ms, gone by 2s.** URL `period` absent → `8` |
| **Overview → drill (fee/STL-FL)** | ❌ **same defect.** URL `period=2` |
| B3 save button post-rebase | ✅ within viewport |
| B8a rules (typed `77` + refresh) | ✅ modal open, value preserved |

**Mechanism:** the rail path calls `router.push` **then** `setFocusDay`. From the overview,
`periodKey` goes null → 8, which is in the view-context reset effect's deps (added by #503's Fix 2),
so the reset fires and closes the modal that was just opened. Drill-scope rail clicks are safe because
`periodKey`/`monthKey` do not change.

**This defect existed in neither branch alone — only in combination.**

**Fix authorised: option (a), ref-based signal.** Rail handlers crossing an overview → drill boundary
set a `pendingRailFocusRef`; the reset effect honours it for `focusDay` only and clears it in the same
pass. Bulk state still resets (the operator is opening one day's modal; clearing bulk selection on a
view change remains correct). Both overview handlers fixed; the two drill-scope handlers untouched.

**Explicit risk called out to CC:** a stale ref would suppress a *legitimate* reset on the next real
nav — worse than the bug being fixed. CC must state how it guarantees exactly-once clearing.

## Interaction fix — applied and re-gated PASS (2026-07-24)

CC applied option (a). **PR #505 @ 4e38193.**

**Shape:** `pendingRailFocusRef` set by the two overview handlers immediately before `router.push`;
the view-context reset effect reads it and **clears it unconditionally at the top of every fire**,
suppressing only `setFocusDay(null)` when it was set. Bulk state still resets always — the operator
is opening one day's modal, so clearing bulk selection on a view change stays correct.

**Why the unconditional clear matters:** it is what makes "cleared exactly once" hold regardless of
which branch runs. Worst case under a future refactor is one skipped focus-reset, self-healing on the
next fire. No timers, no microtask games.

### Re-gate results

| Check | Result |
|---|---|
| **Overview → drill rail click (PDC)** | ✅ **stays open 9s** *(was flashing shut at 2s)* |
| **Overview → drill rail click (fee/STL-FL)** | ✅ stays open, v1 modal, correct day |
| Month drill rail click | ✅ no regression |
| **Genuine nav ("Season") closes the modal** | ✅ **stale-ref invariant holds** |
| B3 save button in viewport | ✅ |
| B8a typed value survives refresh | ✅ |

The stale-ref check was the one that mattered most - a suppressed reset would have been a worse bug
than the original. It clears correctly.

### Test-method note
My first stale-ref attempt reported a false failure: the month stepper was **covered by the open
modal**, so `noStepper: true` - no navigation actually happened, and the modal staying open was
correct. Re-ran via the "Season" button. **A negative test that cannot perform its action is not a
failure, it is a broken test.** Read the setup fields before trusting the verdict.

## Process lesson
**When two PRs touch adjacent state machines, gate the interaction — not just each branch.** Both
passed independently. CC caught it from a code read; measurement confirmed it. That is the right
order, and the reason the rebase-then-re-gate step was worth doing rather than merging on the earlier
green result.

## Process note
I recorded #503 as merged in this doc after its gate passed; it was still open. **CC caught it.**
Same class as §6D and §6E — a state asserted rather than verified. **Check merge state before
recording it, and before branching off "current" main.**

---

# 6O. SAVE-RELIABILITY RECON — scope SHRANK (2026-07-24)

CC ran a read-only failure-UI inventory while #505 waited on merge. Three findings that reshape the PR.

## 1. ~~`SubmissionToast` already renders `variant: "error"`~~ — **THIS WAS FALSE. My error.**
**RETRACTED 2026-07-24.** I stated this as fact and **never opened the file.** CC read all 84 lines:
`SubmissionToast` has **no `variant` prop and no error variant** — it renders only the "recorded"
success card. The existing error primitive is a plain string toast (`.oh-toast--error`,
`page.js:162`), which is a **floating alert** — precisely what §8B rules out.

I restated a claim from a recon summary as a verified finding, wrote it into this doc, and built a
corrections prompt around it. **Third time today** asserting an unverified claim (see also §6D, §6E).

## 2. `noteFailed` is already plumbed end-to-end
Server sets it, client reads it — but it renders a **generic string toast**, so "counts saved, note
did not post" looks identical to total failure. **That is A3's honest-partial-success state, already
wired, just not surfaced.**

## 3. A4's `beforeunload` guard covers the wrong case
It fires only when the **offline queue** is non-empty. A save genuinely in flight — the common case —
gets no prompt. Adding `savingRef` closes it.

## My correction back to CC — bulk failure CAN name the day
CC concluded naming the failing day needs server changes. It does not: **PR-B's integer guard already
validates per entry** and returns `Invalid value for service <id>: got "abc"...`, and the bulk payload
carries a date per entry. The server has everything needed.

Asked CC to determine whether the per-entry error (a) already travels with its date, (b) carries only
the service, or (c) is collapsed before reaching the client. **The information exists; the question is
whether it is travelling.** Target: *"Wed, Jul 29's Dinner had a value the server could not read -
nothing was saved"*, not *"the batch failed."*

## Revised scope — three items, all smaller than first written
1. **A3** - `auditNote` failure non-fatal; extend `noteFailed` so the client distinguishes
   **saved clean / saved-note-failed / nothing saved**
2. **A4** - add `savingRef` to the `beforeunload` guard
3. **Failure UI** - route errors through the **existing** `variant: "error"` toast and surface the
   field-specific server messages

**Explicitly out:** new toast components · persistent offline chip (Phase 3 accent-rail work) ·
durable-state reconciliation for A4.

## RESOLUTION — PR #508 (2026-07-24)
**The work was already delivered as #508 before I wrote the corrections.** My tracking said "queued"
when it was in flight — I generated duplicate scope.

**Ruling: (A), merge as-is.** CC built to **§8B** — inline red-rail banner in the panel, panel stays,
counts intact — not to my mistaken "route through the existing error toast" instruction. Option (B)
would have regressed toward the floating alert §8B rules out; option (C) was new work justified by a
premise that does not exist.

**#508 contents:** A3(b) `auditNote` wrapped + new `auditNoteFailed` flag (also wrapped
`readSavedDayTotals`, same exposure class) · A4 `beforeunload` extended to in-flight saves ·
inline failure banner in DayEntryV2 · bulk day-naming (`serviceDate` returned and read).

**Open question to CC:** its recon said day-naming *"requires server changes"*, then reported it
already implemented. Either the recon described pre-#508 state or it understated what existed.
**Which matters** — it determines whether a recon summary can be read as a current-state snapshot.

## Process note
CC asked whether it could do non-`handleSave` recon while blocked rather than idling. **Worth
repeating** - the inventory arrived before the branch opened and shrank the PR before a line was
written.

---

# 6P. SAVE RELIABILITY (#508) — GATE PASS (2026-07-24)

`fix/sc-save-reliability` @ 87edeb0, rebased on main (146789e).

| Check | Result |
|---|---|
| Malformed single-day → 400, names the service | ✅ |
| **Malformed bulk → 400 with `serviceDate: "2026-07-12"`** | ✅ **names the day** |
| **All-or-nothing** — valid day in a rejected batch | ✅ **not committed** (stayed 0) |
| **Failure UI** — panel open, counts `123` intact, inline alert naming the reason | ✅ **§8B verbatim** |
| Normal save | ✅ 406ms, modal closed |
| B2 overview rail click | ✅ |
| B3 save button in viewport | ✅ |
| MLB fence | ✅ v1 holding |

**The failure UI is the headline.** Forced a server 400 by corrupting the outgoing payload: the panel
stayed open, `123` was still in the field, and an inline alert read *"Save failed - nothing recorded"*
plus the specific server reason. **The transition does not happen, the numbers stay, the reason
appears where the confirmation would have been** — exactly §8B, no floating alert.

## Not browser-verifiable — flagged, not claimed
- **`auditNote` failure** needs DB-level interference to force. `[code-read]` confirmed: wrapped in
  try/catch, sets `auditNoteFailed`, returns success.
- **`beforeunload`** cannot be triggered programmatically. `[code-read]` confirmed: one condition
  added (`inFlightControllersRef.current.size > 0`) to an existing guard.

Both low-risk. Recorded as code-read rather than measured.

## Recon-vs-delivery, reconciled
CC clarified the apparent contradiction: **the recon accurately described main** (bulk returned
`{error, serviceId}`, no date — so naming the day genuinely did require a server change), and **#508
made that change** (`failingEntry` tracked, `serviceDate` returned). Both statements true.

**Rule adopted:** *recon = current state on main · PR body = state after this delivery.* Do not read a
recon summary as describing an unmerged branch.

## What #508 contains
A3(b) `auditNote` wrapped + `auditNoteFailed` flag (also wrapped `readSavedDayTotals`, same exposure
class) · A4 `beforeunload` extended to in-flight saves · inline `.sc-v2-entry-alert--error` banner ·
bulk day-naming via `serviceDate`.

**This is the last data-integrity work in Phase 1.** Everything remaining is workflow or presentation.

---

# 6Q. LEDGER (in flight) — the last Phase 1 item

**PR:** `feat/sc-ledger`. Prompt: `CC_P1_LEDGER.md`.

**Mostly free.** The engine is already built and populated: `sc_daily_actuals_history` + a DB trigger
on every value-changing UPDATE across all save paths · `sc_day_note_entries` · a display-ready
`readHistoryEntriesForRange` · `mergeActivity` already unifying both streams chronologically · **v1
renders it correctly today.** PR-A already fixed v2's field-name mismatch. This is UI work on working
data.

**Spec (§8, approved):** hybrid — one summary line per event, expandable to per-service `old → new`
(decision #2) · **"first entered" rows synthesized at read time** from `created_by`/`created_at`, no
schema change (decision #3) · title "Ledger" · notes post immediately · **the separate ride-along note
section is removed** (redline #8).

**Reuse mandate:** same expand/collapse interaction as the approved bulk itemised review. **One expand
pattern in the product, not two** (§13B).

## Three reads required before building
1. What `mergeActivity` emits per row type
2. **Whether history rows can be grouped by event** — do rows from one save share `changed_at` or a
   batch id? **If not, grouping by a fuzzy time window is a decision I want to make deliberately, not
   discover mid-build.**
3. Where the first-entered synthesis belongs, and whether `created_by`/`created_at` are populated on
   legacy rows (PR-A found null authors on a backfilled note — expect the same class here)

## Reads came back — grouping is EXACT, not approximate (2026-07-24)

**The key finding:** `changed_at TIMESTAMPTZ NOT NULL DEFAULT now()` (`sc-1-...schema.sql:279`), and
Postgres `now()` is **transaction-scoped** — every row from one save carries a byte-identical
timestamp. **`Map` keyed on the ISO string gives exact event grouping. No fuzzy time window.**

That was the read I flagged as "a decision I want to make deliberately, not discover." It resolved in
the good direction — the hybrid spec is buildable as designed.

Also confirmed: **`created_by TEXT NOT NULL`** (:71) — the first-entered synthesis cannot hit a null
author.

*(Both verified independently against the migration file, not taken from summary — per the §6O rule.)*

## Three rulings

**Q1 — first-entered row goes in `readHistoryEntriesForRange`, so v1 gets it too.** It is a **data
completeness fix, not a v2 feature**: a day entered once and never edited shows an empty Ledger on
*every* surface, and *"who entered this?"* is the most common question asked of it. STL-FL and MLB are
on v1 until Phase 4/5. Doing it at the data layer means one implementation (§13B).
**Caveat:** shared function — CC must verify v1 renders the synthetic row sanely (no
`undefined → undefined` from a row with no old/new values).

**Q2 — Ledger stays in the body, below no-service.** Reasoning on record for Phase 3:
**the rail is the money truth (glanceable, never scrolls away); the Ledger is content you read *and
write*, so it belongs in the scroll region with everything else you act on.** Below the fold is
correct for a record, wrong for a total. Also practical — the rail is 246px and already has the known
§8C independent-scroll limitation; adding a growing expandable component would worsen it.

**Q3 — composer and Activity collapse into ONE section.** Redline #8 is "one note location," and the
spirit is one Ledger — not a composer plus an adjacent list. Composer on top, stream below, one card,
one heading. `.sc-v2-entry-notes` deleted, not left as an empty wrapper.

## Interaction flagged for explicit test
`mergeActivity` collapses all-zero edit batches into **"Marked no service."** A no-service save is
*also* a group sharing one `changed_at`, so grouping and that collapse rule now interact. Must not
render as *"updated 6 services: Breakfast 50 → 0..."* when *"Marked no service"* is the honest summary.

## GATE RESULT (2026-07-24) — PASS except Q1

| Check | Result |
|---|---|
| Title "LEDGER", one card, composer + hint | ✅ |
| Grouping — *"updated 1 service · Jul 24 · 9:58 AM"* | ✅ |
| Expansion — `Breakfast 113 → 115` | ✅ |
| `.sc-v2-entry-notes` wrapper removed | ✅ |
| First-entered row on **v2** | ✅ |
| **First-entered row on v1** | ❌ **MISSING** |
| No `undefined`/`NaN` leakage on v1 | ✅ |
| No-service collapse | ⚠️ **untestable via UI** |

### The Q1 miss — synthesis is client-side, not in the shared read
**Server payload evidence:**
- `STL-FL 2026-07-01`: `hasActuals: true`, **`historyEntries: []`** — and its v1 Ledger reads
  *"No activity yet."*
- `PDC 2026-07-02`: one real edit row (`oldValue: 0 → newValue: 99`), **no synthetic row**

So the *"entered counts"* line visible on v2 is synthesized **in the component**. **v1 never gets it**
— the exact gap Q1 was meant to close, on the surface that needed it most.

The ruling said why: *"doing it at the data layer means one implementation; synthesizing
per-component is exactly the §13B trap."* Fix = move it into `readHistoryEntriesForRange` and
**remove the client duplicate** (leaving both would double-render).

### No-service collapse — could not test, flagged not claimed
`"Mark day as no service"` is **not in the DOM** on an already-entered day (all buttons searched, zero
matches), so no all-zero batch could be generated through the UI. Checked all 31 July days across PDC
and STL-FL programmatically — no existing all-zero same-timestamp batch to inspect.

CC's `every(newValue === 0)` guard is `[code-read]` sound, **but this is the one case where grouping
and an existing collapse rule interact.** Asked for a repro path rather than shipping on a code read.

**Incidental finding:** if `Mark day as no service` really is hidden on entered days, that is worth
knowing independently — it would mean the only way to zero out an already-entered day is manual.

## Standing constraint carried in
The B8a rule holds: **a background refresh must keep the Ledger current under a dirty form.** The
seeding guard already syncs `noteEntries`/`historyEntries` while skipping the value reseed. Not to be
broken.

---

# 6S. NEW GAP (owner-reported 2026-07-24): no-service unavailable on entered days

Surfaced while gating the Ledger — I could not find the button to create a no-service test case.
It is not missing, it is **deliberately gated off**:

- **v2** `DayEntryV2.js:882` — `{status !== "entered" && (...)}`
- **v1** `DayDetail.js:1353` — `dayHandled = status === "entered" || "no-service" || "off-season" || "prep"`

The v1 comment states the assumption outright: *"already handled (entered/no-service/off-season/prep)"*.
**Both surfaces treat `entered` as terminal.**

## Owner ruling
> *"Operators should be able to go in and change a day with service to a no service day. Day can get
> cancelled after the user puts in data, or they mistakenly put data in the wrong day."*

Both are ordinary operations: a game cancelled after counts are in, or counts entered on the wrong day.

## Why this is billing, not UI
**A day entered by mistake stays on the invoice.** The only recovery today is manually zeroing every
service — and that produces a **different audit trail** than a real cancellation:

| | Trail |
|---|---|
| Manual zeroing | N separate edit rows, **no cancellation signal** |
| Mark-no-service | one batch + the `"Service cancelled - marked no service"` literal, which `mergeActivity` collapses to a single **"Marked no service"** row |

So the workaround **loses the reason.** An auditor sees six services zeroed and cannot tell whether the
game was cancelled or nobody was served.

## Scope of the fix
Offer it on **entered** days, **both surfaces**. **Not a blanket gate removal** — CC to report
status-by-status reasoning. `no-service` almost certainly stays excluded (already there);
`off-season`/`prep` probably stay excluded (nothing was scheduled to cancel) but CC should argue it.

**Dialog copy must gain a second variant.** Marking an *entered* day no-service **destroys recorded
counts** — the current copy assumes an empty day and does not say so.

## Status-by-status rulings (2026-07-24)

CC produced a nine-status table and reasoned each one. **Approved as written.**

| Status | Button? | Why |
|---|---|---|
| `entered` | **YES** | The owner's case — cancelled-after-entry, wrong-day mistake |
| `needs-entry` / `overdue` / `future` | YES (unchanged) | Already offered; original SC-066 case |
| `no-service` | NO | Already in that state |
| `off-season` | NO | Nothing was scheduled — nothing to cancel |
| `prep` | NO | Same |

**The governing principle, in CC's words:** *"Marking it would write zeros to services on a day the
client wasn't billed for. Contradicts the schedule truth."* The test is **not** "is there data here"
but **"was service ever scheduled here."**

### Ruling — entered non-game-day fee case: **offer the button**
CC flagged that a fee MLB non-game day with recorded counts classifies `entered` and would gain the
button. **Correct behaviour.** If counts were recorded, **service happened** — the schedule was wrong
or it was an off-schedule event, but either way **there are numbers on an invoice, and anything that
can reach an invoice must be cancellable.** Schedule-truth governs days with *nothing recorded*; once
real counts exist, the counts are the truth.

### Ruling — dialog gets the counts summary
> *"This day has **248 meals** recorded across **6 services**. Every service will be set to zero and
> an audit note added to the Ledger."*

This is the one dialog that **destroys recorded billing data**; the copy is all that stands between a
misclick and a wiped day. A concrete number stops a misclick in a way an abstract warning does not.
**Meals and service count only — no currency** (standing rule: never compute a displayed number
client-side, and a wrong dollar figure in a destructive dialog is worse than none).

### Open question raised, deliberately NOT fixed here
**Can an operator undo a `no-service` day?** If marking no-service is itself terminal, that is the same
trap we are fixing — one status further along. CC to **report, not fix**. Logged for its own scoping.

### Logged to Phase 4
**EXH days** are separately billed and can be cancelled, but the tile is not clickable so there is no
surface for a button. If EXH becomes enterable in MLB SC v2.1, **cancellation must ship with it** —
a billable event with no cancellation path is not acceptable.

## GATE PASS (2026-07-24) — PR #513, `fix/sc-noservice-on-entered`

| Check | Result |
|---|---|
| Button on entered day (v2) | ✅ |
| **Dialog copy (v2)** | ✅ *"248 meals recorded across 4 services"* — matches the tile, **no currency** |
| Button on entered day (v1) | ✅ |
| **Dialog copy (v1)** | ✅ *"9 meals recorded across 1 service"* — correct singular |
| Full cancellation | ✅ `248meals $3K` → `No service` |
| Server write | ✅ 4 services zeroed at **one timestamp**, `status: "no-service"`, audit note written |
| **Ledger** | ✅ *"marked no service"* + the note — **not** a per-service zero list |
| Button hides once no-service | ✅ |
| MLB (v1) | ✅ fence holding, button present |
| Save regression | ✅ 404 → 408 meals, 370ms |

**The full loop verified end to end:** entered day → cancel → zeros written → status flips → Ledger
collapses to one honest line. That closes the audit-trail gap that made this worth fixing.

### CC's mid-build catch — the dead-branch bug
While building, CC found the local `status` variable is a **4-value simplification**
(`entered`/`overdue`/`needs-entry`/`upcoming`) that **never emits `no-service`/`off-season`/`prep`**.
So the pre-existing v1 gate had **three dead branches**, and CC's own first pass inherited the bug.
Corrected to `day.status` (server-classified) on both surfaces. Only found by reading rather than
pattern-matching.

### Ruling 1 caveat — answered
**A no-service day CAN be undone**: inputs are not gated by status or `hasActuals` on either surface.
Operator opens the day, types over the zeros, saves. Minor friction (inputs render a literal `0`, not
a ghost, so it must be cleared first) but **not a lockout.** Audit trail on undo is honest:
`entered → marked no service → per-service edits back up`. No dedicated "un-mark" button — logged as a
separate scoping question, correctly not built here.

### Transient, flagged not buried
The modal briefly would not reopen immediately after a cancellation, then worked on retry. A
**pre-existing** no-service day (CIN-AZ 2026-06-18) opened fine, so this is transient post-save state,
not a defect in this change. Worth knowing if a tile ever seems unresponsive right after marking
no-service.

## Bonus: this unblocks the untestable item
Once no-service works on an entered day, the **"Marked no service" collapse** can finally be tested
end-to-end — the one Ledger item I had to leave as `[code-read]` (§6R).

---

# 6T. LEDGER RE-GATE — PASS. **PHASE 1 COMPLETE.** (2026-07-24)

`feat/sc-ledger` @ 5c8ffa2 (#510).

| Check | Result |
|---|---|
| **No-service collapse** (CIN-AZ 2026-06-18) | ✅ *"marked no service"*, not per-service zeros |
| **Q1 — v1 first-entered** (STL-FL 2026-07-01) | ✅ `ENTRY \| Entered counts \| k.fietek@... · Jul 23` |
| Server payload carries `kind: "first-entered"` | ✅ **data layer, not component** |
| No double-render on v2 | ✅ exactly 1 |
| Expansion | ✅ `aria-expanded` false→true, reveals `Breakfast 0 → 99` |
| No `undefined`/`NaN` on v1 | ✅ |
| Save regression | ✅ 245 → 248 meals |
| MLB fence | ✅ v1 holding; its Ledger shows the collapse too |

## The proof of the whole feature — CIN-AZ, June 18
```
k.fietek@kitchfix.com marked no service   Jun 17 · 4:01 PM
k.fietek@kitchfix.com entered counts      Jun 17 · 9:21 AM
```
Entered at 9:21, cancelled at 4:01 — the day's real story in two lines. **This is exactly the audit
trail the manual-zeroing workaround destroys** (§6S), which is why the no-service gate matters.

## CC's transport decision was better than my ruling
I said "put the synthesis in `readHistoryEntriesForRange`." CC did that **and** chose to append it
into `historyEntries` with a `{kind: "first-entered"}` discriminator rather than a separate field.

**Why that is better:** a discriminator — not just null values — means the mark-no-service collapse
(`every(newValue === 0)`) **cannot silently absorb the synthetic row**, since `Number(null) === 0`.
Both consumers guard on `kind` before bucketing. One channel, one guard, no field to forget.

## Test-method note (second occurrence today)
My first expand test reported a false failure — the toggle is a `div[role=button]`, my selector
assumed `<button>`. **A false negative costs a round trip and erodes trust in the gate.** Check the
element shape before trusting a negative result. (First occurrence: the stale-ref test where the
stepper was covered by the modal, §6M-N.)

---

# ✅ PHASE 1 COMPLETE

| Item | PR | Result |
|---|---|---|
| B8 — stale view after save | #501, #503 | saves refresh the view; refresh works; unsaved input survives |
| B2 — rail queue click | #505 | opens the modal from overview **and** drill |
| B3 — modal viewport | #505 | save button on-screen at 1280×800 |
| Save reliability (A3/A4/failure UI) | #508 | honest partial success · in-flight guard · inline failure naming day + field |
| Ledger | #510 | grouped, expandable, first-entered on both surfaces, no-service collapse |

**Every item measured live across PDC · MiLB · STL-FL · MLB. MLB fence held throughout.**

**Next:** §6S (no-service on entered days — owner-reported, workflow + billing), then **Phase 2:
convergence** — bulk custom → pos-style, bulk match + itemised review, BillRail shape-conditional hero
to unfence **STL-FL only** (⚠️ MLB must stay fenced, §7).

---

# 8. PHASE 2A — BULK CONVERGENCE (MERGED 2026-07-24 — #518, main @ `abeb493`)

**PR:** `feat/sc-bulk-convergence`. Prompt: `CC_P2A_BULK.md`. Owner chose bulk before STL-FL — it
needs no design decisions, whereas 2B does.

## Core instruction: ONE review surface, both paths wired into it
Today "All match projections" goes to a review overlay while **"Enter custom values" drops to the
legacy v1 `.sc-day` surface** (redline #11). The approved render has both ending at the **same**
itemised review. **Build it once.** Two near-identical review screens is the §13B trap that already
bit the renders this morning.

## Owner ruling — already-entered days in a bulk selection
**Allow them, but flag them in review.**

- **Excluding would break a real workflow** — bulk-enter a week, realise the projections were wrong,
  redo it. Same class of dead end as the no-service gate we just fixed.
- **Silent overwriting is a billing risk** — replacing hand-entered counts with estimates, with
  nothing on screen saying so.
- **The review screen already exists**, so flagging is nearly free.

```
⚠ 2 of these days already have counts. Confirming will replace them.
▸ Tue, Jul 28   270 meals   $3,481.05   ⚠ replacing 280 meals
```

**Meals and service counts only in the warning — no currency** (same reasoning as the no-service
dialog: a wrong dollar figure in a destructive context is worse than none).

**What makes this safe:** the Ledger records every overwrite as an edit row with old → new. A mistaken
overwrite is traceable and recoverable — which was not true before Phase 1.

## Also in scope
Custom entry → pos-style (#11) · confirm → the Handoff, **with permission to defer the motion and
report if it is oversized** (#12) · scroll-to-focus on bulk open (P2-1) · selection guidance instead of
*"0 days selected"* (P2-5).

## ⚠️ Standing risk now live
**This PR must not alter which surface any account renders.** §7's fence warning becomes real in 2B,
not here — but MLB gets checked on every gate regardless.

## Pre-build reads + rulings (2026-07-24)

**CC's key finding: there are THREE overlays, not two.** The bulk *entry* panel (legacy v1
`.sc-day`, redline #11) is a **separate surface** from the two review overlays — which are
near-identical inline IIFEs differing in only **four surface points** (subtitle, status pill, header
revenue source, per-row meals) plus the confirm handler.

**Ruling 1 — one `<BulkReview>` component, both IIFEs deleted in the same PR.** Four differing props
is a props boundary, not two components. Two additions: `rowShape` must not compute currency
(server-derived only), and `hasOverwrites` carries the *detail* ("replacing 280 meals") rather than a
boolean the component re-derives. **Deleting both IIFEs in-PR** — leaving one "temporarily" is how a
second implementation survives and drifts.

**Ruling 2 — reuse `GroupBlock`/`ServiceRow` in place; do NOT extract a shared primitive yet.**
Two consumers is reuse; three is when a shared module earns its keep. And **Phase 2B may change the
requirement** — STL-FL needs a fee variant (no Amount column, "served" not "meals"), so extracting now
means extracting the wrong shape and doing it twice. **CC to report friction** if reuse forces awkward
prop drilling — that is the real signal extraction is due.

**Ruling 3 — defer the composite Handoff motion.** CC's reasoning accepted (interrupted N-tile
animation, ring-advance mid-invalidation). **Sharper version: the single-day Handoff has not been built
either — it is Phase 3.** Building the bulk composite first means designing the batch variant of a
motion whose base case does not exist, guaranteeing rework. **Logged to Phase 3** so both are designed
together with one motion vocabulary.

**End-state check requested:** confirm the bulk toast renders honestly with `amount: null, meals:
null` — no empty row or stray separator where the figure would be. A successful bulk save must not
look degraded.

## Overwrite warning — data confirmed available, no round trip
`day.hasActuals` (route.js:288) and `day.actual` (route.js:245) are both on every day payload. The
*"replacing 280 meals"* text computes inline at render. **The warning ships with full detail.**

## GATE 1 (2026-07-24) — PR #518. Passing, except the warning cannot fire.

| Check | Result |
|---|---|
| P2-5 selection guidance | ✅ *"Select days to enter"*, actions disabled at zero |
| P2-1 scroll-to-focus | ✅ banner scrolled into view |
| Running total | ✅ `210 meals · $2,708.00`, server-derived |
| **Overwrite warning** | ❌ **UNREACHABLE** |

### The blocker — `PeriodWorkspace.js:998`
```js
const isBulkSelectable = bulkMode && status !== "off" && !isDisplayOnly
  && (!d.hasActuals || isEnteredFuture);
```
**`!d.hasActuals`** makes an entered **past** day unselectable by construction. Measured: day 2
(`--entered --interactive`) clicked twice, never joined the selection.

**So the overwrite warning is correct code that no operator can reach.** The owner ruling was *"allow
them, but flag it in review"* — **the flagging half shipped, the allowing half was blocked upstream.**

Neither CC nor I saw it: the gate lives in `PeriodWorkspace`, not in the bulk surfaces being edited.

**Same shape as the no-service gate (§6S):** a deliberate rule that predates the workflow, silently
preventing a legitimate operation. **Third instance of this pattern** — worth watching for as a class:
*a rule written when a state was assumed terminal, still enforcing that assumption after the workflow
moved on.*

### Fix
Relax `!d.hasActuals`; keep `status !== "off"` and `!isDisplayOnly` with reasoning reported per
condition. **Also `no-service` days** (`hasActuals: true`, all zeros) — my lean is they should be
selectable for re-entry, matching the no-service undo path.

### CC's architecture call — accepted over my own check
I asked for a computed-style diff. CC instead **imported the same `GroupBlock` function instance**, so
bulk and single-day cannot diverge structurally. **That is a stronger guarantee than matching
measurements** and I accepted it in place of the diff.

### Open edge, to report not fix
`syntheticDay` = first selected day feeds `GroupBlock`'s projections as visual scaffold. **If the first
day has a different service shape** (service archived mid-period, overlay game day), the panel may show
services that do not apply to every selected day. CC to report during re-gate.

---

## GATE-1 FIX SHIPPED — `6f67ac2` (2026-07-24)

CC relaxed `isBulkSelectable` (`PeriodWorkspace.js:1007-1008`) to read `d.status` server truth - and
caught unprompted that the old `status !== "off"` was the resolver conflating no-service and prep
(third resolver-fold instance). Blocks off-season / prep / exhibition / away. Plus: `hasActuals` prop
on DaySquare with an amber selected-ring override (all four today/focused combos), and the overwrite
Map widened with an `isNoService` copy variant. Report graded pass - no formal completeness map, but
the 5-file diff was independently accounted for against the report's four sections.

## GATE 2 (2026-07-24) — fix verified live. One new blocker: planned off-days.

Run via Claude-in-Chrome from the chat session (new gate channel), all four account types, one real
write on CIN-AZ.

| Check | Result |
|---|---|
| Entered past day joins (07-23) | ✅ the gate-1 blocker fix works |
| Amber ring on selected + has-actuals | ✅ paint-verified rgb(92,67,16) = `--sc2-state-needs-fg-strong`; needs-entry ring stays green rgb(47,125,79) |
| Batch warning split copy | ✅ "2 of these days - 1 already has counts, 1 is marked no service. Confirming will replace them." |
| Per-row markers, both variants | ✅ "replacing 305 meals across 6 services" + "replacing 'no service' status" - zero currency measured on both |
| Custom pos-style panel | ✅ `GroupBlock` shell, 3-col no-Amount head, zero `.sc-day-body` |
| Atomic write + downstream | ✅ one `sc-bulk-submit` POST, `{"success":true,"written":1}`; refetch, tile flips entered, Ledger first-entered row, bulk exits |
| B8a regression | ✅ typed 55, Refresh: modal + value + touched survive; discard guard intact |
| MiLB CIN-KY / STL-FL | ✅ v2 single-day / still v1 (fence holds for 2B) |
| **MLB binary** | ✅ CIN-OH · STL-MO · TXR-TX-H · TXR-TX-V all v1, zero v2 elements |

### The blocker - "no-service" is two realities, and the gate admits both
`classifyDayStatus`: `:303` recorded cancellation (`hasAct`, all-zero actuals) vs `:310` planned
off-day (no actuals, all-zero projections - PR #167). The owner ruling covered kind 1 only; the new
gate admits both. **Measured:** CIN-AZ 2026-07-05 (planned off) joined a selection with a green
ring, sat in review as `0 meals · $0.00` with no marker; Confirm would write zero-rows onto a
never-scheduled day, flipping it to a recorded cancellation on the billing table. The pre-2A display
gate blocked these days - a regression of that specific case.

**Ruling:** split on `hasActuals` at the selection gate - allow recorded (`true`), block planned
(`false`). Review- or write-layer filtering rejected: the review must stay a truthful mirror of the
selection. Prompt: `CC_P2A_GATE_2_OFFDAY.md` - includes the keyboard-path read, a sweep for other
no-service reads in the blast radius, and the `BulkEntry.js:111/114` plural nit scoped in.

### Withdrawn - the 4->2 selection drop was contamination
First pass showed 4 selected but a 2-row review. Did not reproduce on an untouched selection (clean
4-day run: all 4 rows, both warning variants). A 400ms poller then caught 07-26 selecting and
deselecting itself during pure idle - a finger on the shared screen. Review and write share one
lookup (`activeDrillDays || dayMap`, both sides) so the review is honest by construction.
**Test-method lesson: a shared live browser is a contaminated instrument unless coordinated.**
Selection-state tests get a poller from now on.

### Notes
- Test write: 200 meals on one service, CIN-AZ 2026-07-22 (was needs-entry). Ledger records it;
  owner re-enters real counts when ready.
- syntheticDay mixed-shape check: not reproducible on live data (needs an archived-mid-period
  service). CC's code-read stands; covered by the archive-edge ticket queued post-merge.
- STL-FL month view shows no bulk trigger - pre-existing (trigger lives in TodayRail, untouched by
  #518). Observation only, no severity.
- P3 copy nit: "Bulk entry - 1 days" (`BulkEntry.js:111/114`) - riding the gate-2 fix.
- Gate-channel note: chat-session Claude-in-Chrome works for full gates. The extension blocks any
  exec return carrying cookie or query-string data - probes must strip `location.search` and URL
  params, and skip auth endpoints in fetch wraps.

**Next:** owner merges #518 -> `CC_P2B_STL_FL.md` goes to CC -> archive-edge ticket on owner go.

---

## GATE-2 FIX SHIPPED — `c11e371` (2026-07-24)

One-condition split at `PeriodWorkspace.js:1026-1028` - `no-service && !d.hasActuals` joins the
block list - with the two-kinds comment citing classifier `:303` / `:310`, the full 9-status
partition, and a do-not-drop warning for future readers. Report graded A: keyboard path traced to
the shared onClick (`DaySquare.js:253-255` Enter/Space -> `activeOnClick`; `handleGridKeyDown` is
arrows-only), all five other `no-service` sites swept with verdicts (both overwrite Maps already
hasActuals-gated upstream at `:3334` / `:3429`; rollups and v1 `dayHandled` correct for both
kinds), plural rider at `BulkEntry.js:111/114`. Diff scope: 2 files, nothing else touched.

## GATE 3 (2026-07-24) — PASS. Phase 2A merge-ready.

| Check | Result |
|---|---|
| Planned off-days refuse selection | ✅ 07-05 / 07-12 / 07-19 / 07-26 clicked - none join, banner unchanged |
| Recorded no-service still joins | ✅ 07-01 / 07-11 / 07-17 join, amber rings paint-verified |
| Entered past still joins | ✅ 07-23, amber - gate-1 fix intact |
| Keyboard path | ✅ real-key harness: ArrowRight moves roving focus, Enter selects allowed 07-25 (green ring) and refuses blocked 07-26; Enter toggle-off verified. First harness (JS `focus()` + synthetic events) failed its own positive control and was discarded - only the trusted-event run counts |
| Warning copy at scale | ✅ "4 of these days - 1 already has counts, 3 are marked no service." - 3 no-service markers + 1 meals marker |
| Custom panel + plural | ✅ opens on the same selection, "Bulk entry - 4 days", zero legacy shell |
| MLB spot | ✅ CIN-OH v1, zero v2 elements |

Write path untouched by the gate-3 diff [code-read] - gate-2's measured atomic save stands, no
second write run.

**VERDICT: MERGE PR #518** (`b1e24fb` + `6f67ac2` + `c11e371`). Every commit on the branch is
gate-covered across PDC · MiLB · STL-FL · MLB.

**Next:** owner merge -> Phase 2B (`CC_P2B_STL_FL.md`) -> archive-edge ticket on owner go.

---

# 8B. PHASE 2B — STL-FL OFF v1 (design approved, queued behind 2A)

**Why STL-FL is fenced:** DayEntryV2's centerpiece is a **live per-meal dollar bill**. Fee accounts
have flat-fee/non-revenue services, so that hero collapses to **$0** and the surface reads broken.

**The unlock:** a **shape-conditional BillRail hero** — dollars for per-meal, something else for fee.
Owner input from the original scoping: fee accounts *"confirm headcounts and service days rather than
sales."* So the hero likely reads something like **"240 served · 6 of 8 services"** rather than a
dollar figure.

## RENDER DELIVERED — `RENDER_STL_FL.html` (2026-07-24)

**The account brief sharpened the problem.** STL-FL is a **$2,300,000 flat annual fee**; the brief
states Service Calendar prices are **$0 for revenue purposes** and per-meal numbers are
**planning-only**.

So dollars are not merely unhelpful — **they would be wrong.** A running total implies variable
revenue that does not exist under this contract.

**Reframe:** the rail should answer *"is this day confirmed?"*, not *"what is this day worth?"*

**What changes:** almost nothing. Tiles, week bands, needs-entry queue, current-week pill, the
three-zone modal, the Ledger, the no-service button — all identical to per-meal. Three fee-specific
pieces: the rail hero becomes **days confirmed** with served-count beneath · **no Amount column** ·
the word **"served"** in place of "meals". Plus a small **Contract** block stating the flat fee once.

## ✅ APPROVED BY OWNER (2026-07-24) — all three questions resolved as rendered
1. **Hero metric: days confirmed** (18 of 25), served-count as the sub-line.
2. **Contract block: keep** — `$2,300,000 · flat fee · counts are planning only`.
3. **Vocabulary: "confirm" for fee accounts.** Two vocabularies accepted deliberately — *confirm*
   is truer for an account where the operator verifies headcounts rather than driving an invoice.

**LOCKED SPEC for 2B:**
- Rail hero → **days confirmed** + progress bar + served-count sub-line. **No dollar figure anywhere.**
- **Contract block** in the rail: annual fee · billing model · "counts are planning only"
- **No Amount column** in the entry table
- **"served"** in place of "meals"; **"confirm"** in place of "enter" on fee surfaces
- Week bands sum **served counts**, not dollars
- Everything else identical to per-meal: three-zone modal · pinned actions · one scroll region ·
  Ledger in the body · no-service on entered days · current-week pill · needs-entry queue

⚠️ **§7 goes live in this PR.** STL-FL and MLB share the `isFeeAccount` fence. Unfencing by relaxing
that condition **flips MLB to v2 in the same commit.** The fence must become **account-level**, and
every 2B gate must confirm **MLB still renders v1**.

**⚠️ And this is where §7 goes live:** STL-FL and MLB share the same `isFeeAccount` fence. Relaxing it
the obvious way **flips MLB to v2 in the same commit** — exactly what the MLB-own-phase ruling forbids.
The fence must become **account-level, not shape-level**, and every 2B gate must confirm MLB still
renders v1.

---

# 7. ⚠️ MLB FENCE WARNING (created by decision #1)

**The problem:** MLB and STL-FL share the *same* fence. `useScEntryV2Effective` returns false for
**`isFeeAccount`** — that single condition covers both STL-FL (fee-no-dollar) and the 4 MLB
homestand-fee accounts.

**The risk:** Phase 2 unfences fee accounts so STL-FL gets the pos-style surface. If that's done by
relaxing the `isFeeAccount` condition, **MLB flips to v2 at the same moment** — silently pulling MLB
into the PDC/MiLB work, which is exactly what decision #1 says not to do.

**The requirement:** when unfencing for STL-FL, MLB must stay fenced **explicitly and by account**,
not by shape. Options:
- Keep an explicit MLB exclusion list in the gate until Phase 4
- Or gate on `billingModel`/`hasHomestandSchedule` rather than `isFeeAccount`, so homestand-fee
  (MLB) stays out while fee-no-dollar (STL-FL) comes in

**This must be written into the Phase 2 acceptance criteria and gated by opening an MLB account and
confirming it still renders v1.**

---

# 8. LEDGER SPEC (decisions #2 + #3)

**Hybrid display.** Each event renders as one summary line, expandable to detail:

```
▸ Kevin Fietek updated 4 services          Jul 22, 9:15am
    Breakfast    0 → 50
    Lunch       80 → 95
    Dinner       0 → 30
    Coffee       0 → 12
▸ Kevin Fietek entered counts              Jul 15, 2:30pm     ← first-entered (decision #3)
  "Short staffed, ran a reduced lunch"     Jul 15, 2:31pm     ← note
```

**Engine work required: near zero.**
- Per-service old→new already captured by the trigger and returned by
  `readHistoryEntriesForRange` (`serviceCalendar.js:1584-1621`)
- Notes already stream from `sc_day_note_entries`; `mergeActivity` already unifies both
  chronologically with the "Marked no service" collapse
- **First-entered rows (#3):** the trigger deliberately skips INSERT, so synthesize a row at read
  time from `sc_daily_actuals.created_by` / `created_at`. **No schema change.**

**Behavior:**
- Notes post **immediately** (`sc-add-note`), never lost if the modal closes without saving actuals (#7)
- The separate ride-along note section is **removed** — one location only (#8)
- Title: **"Ledger"**

---

# 8B. APPROVED DESIGN DIRECTION - "THE HANDOFF" (locked 2026-07-22)

Owner approved after reviewing 3 toast directions, 3 reward directions, and a fourth original
proposal. Final = a blend of **The Handoff** (motion) + **Direction B / Progress** (reward metric)
+ **Direction 1 / Accent rail** (visual language). Render: `RENDER_HANDOFF_BLENDED.html`.

## The core position
**Success is a transition, not a card.** Every card-based reward stops the loop in order to
celebrate it - it interrupts the operator at peak momentum, then makes them find a button before
the next day appears. The satisfaction in queue-clearing work is the item *leaving the list* and
the next one arriving already loaded. So the transition IS the reward.

**Consequence: redlines #6 and #10 are one build, not two.** #6 (swipe-out on submit) and #10 (the
reward moment) are the same feature. Building them separately produces a swipe animation AND a
modal that both fire on the same click.

## The three layers
| Layer | Owner | What it does |
|---|---|---|
| **Motion** | The Handoff | Save commits -> pill forms -> flies to the ring -> tile flips -> queue clears -> next day slides in. No dismissal. |
| **Reward metric** | Progress ring | Moves permanently INTO the rail (replacing "18 of 25 days entered" + bar). Animates on every landing. Compounds across the session instead of resetting. |
| **Visual language** | Accent rail | 4px colored left rail = type. Green success / red danger / amber warning / navy info. Used by the confirmed pill, session strip, failures, offline chip, and as a top rail on confirm dialogs. |

**The key move:** the confirmed pill flies INTO the progress ring. The operator's work visibly
becomes progress. That is why these three combine rather than compete - the ring gives the flight a
destination, and the flight gives the ring its meaning.

## Sequence + timing (~1.9s total)
| Beat | Timing |
|---|---|
| Counts commit, service rows lift away | 0 - 200ms |
| Confirmed pill forms (accent rail, green) - the trust beat | 200 - 660ms |
| Pill flies into the ring; tile flips green | 660 - 1210ms |
| Ring sweeps 18->19 with bloom; queue row clears; badge ticks | 1020 - 1400ms |
| Session strip increments; next day slides in, loaded | 1350 - 1850ms |

## The toast system, reduced
**Principle: confirm in place, do not announce elsewhere.** A toast is for something that happened
away from where you are looking. On this surface almost nothing qualifies - which is why the three
existing treatments never felt like a system. There was none to be had.

| State | Treatment |
|---|---|
| Day recorded | **The Handoff. No toast.** |
| Note posted | The note appearing in the Ledger is the confirmation. Brief accent-rail ack only. |
| Save failed | **Inline, in the panel** - the failure IS the absence of the handoff. Panel stays, numbers stay, reason appears where the confirmation would have been. |
| Offline / queued | **Persistent chip** (amber accent rail), not a transient toast - the condition lasts. |
| Mark no service / Discard / Confirm bulk | One confirmation dialog pattern, accent rail on top, two actions. |

## Month cleared - the one card that survives
The loop has nowhere to hand off to, so this is the rare event that earns a card and the animation
budget. The persistent ring **closes the full circle**, then the check draws inside it.

**Colour ruling (owner, 2026-07-22):** BRIGHT GREEN (`#25a866`), not amber. Amber already means
"needs attention" in this product (needs-entry tiles, queue badge, overdue) - spending it on the
best moment of the month fights the established language. Completion reads green. The moment is
elevated by **intensity, not hue**: brighter green than per-day success, stronger bloom, full ring
closure.

## HARD DEPENDENCY
**The Handoff requires PR-B's optimistic patch.** A 1.9s motion stalling on a ~2s save is worse than
any card. If PR-B slips, the **ring and accent rail still ship** - only the Handoff motion waits.

## Open (deferred, not blocking)
- Auto-advance vs offer: currently specced as auto-advance with opting out as the action.
- Whether the per-day moment scales down after N in a session.

---

# 8C. APPROVED ENTRY MODAL LAYOUT (locked 2026-07-22)

Render: `RENDER_ENTRY_MODAL_LAYOUT.html`. Owner approved.

## Structure: three zones, one scroll region
| Zone | Behaviour |
|---|---|
| **Header** | **Pinned.** Day, account, day-nav, close. |
| **Body** | **The only scroll region.** Groups -> no-service -> Ledger. Groups render at natural height (PR-A) and the body absorbs overflow. |
| **Actions** | **Pinned.** Day total + Confirm & save. **Closes B3** - the commit button can never be below the fold again. |

Modal is capped at viewport height so the body absorbs the difference. Addresses the owner's opening
note: "it needs to scale appropriately to screen sizes and have some scroll internally."

## Redlines resolved in this layout
| # | Resolution |
|---|---|
| 1 · 2 | Match projections fills green and **holds state**; Clear slides out from behind it (300ms ease) |
| 3 | Each group = bordered card w/ header, table, subtotal. **One scroll region, never nested** |
| 4 | Empty inputs -> light placeholder; projected amounts grey to `#b9c0c9` |
| 5 | Fixed grid - Service left · Rate **right** · Qty **centre** · Amount **right**; values share their header's alignment. Rate was the specific break |
| 6 | No-service = full-width secondary button, reddens on hover |
| 7 · 8 | ONE "Ledger" card: composer on top ("Posts immediately"), then the unified Note/Edit stream with tags + colour pips. Second note box removed |

## Placement rulings
- **Ledger lives in the BODY, not the rail.** The rail is the money truth (ring + live bill) and stays
  glanceable; the Ledger is content you read *and* write, so it belongs in the scroll region.
- **The rail does NOT scroll independently.** One scroll region is easier to reason about. If the live
  bill overflows on a dense account it will clip - catch it in a gate rather than pre-build a second
  scroll region. **Add "rail overflow on dense accounts" to the Phase 1 gate checklist.**
- **Cancel sits beside Confirm & save.** Discard-confirm still fires on dirty state.

---

# 9. BULK SPEC (decision #4 — all-or-nothing)

- Swap the client loop for the existing **`sc-bulk-submit`** endpoint: one `.upsert()`, all rows,
  **atomic by construction**
- **All-or-nothing:** any failure → nothing commits → operator is told and retries the batch. No
  mystery half-states.
- Network-class failures are already handled invisibly by `saveQueue.js` (backoff, multi-tab lock,
  replay on reconnect), so this mainly surfaces genuinely bad values — which is exactly when you
  *want* to be stopped
- Failure UI must name **what** failed and **why**, not a generic "save failed"
- 30 days goes from ~30 sequential round-trips to **one**

---

# 10. KEVIN'S REDLINES — status

| # | Item | Finding |
|---|---|---|
| 1 | Match projections stays green | Confirmed inert — no state after click |
| 2 | Slide in shaded "Clear" to undo | No Clear affordance exists |
| 3 | Card heights / no internal scroll | = **B1**. Missing `flex-shrink: 0` |
| 4 | Ghost the projected number more | `sc-day-input--ghost`; reduce contrast |
| 5 | Header alignment (RATE far right) | RATE `text-align: right` over left-aligned values |
| 6 | "Mark day as no service" → button | Underline, transparent bg, no border, 0 padding |
| 7 | Title it "Ledger", immediate save | Engine **already does this**. = **B7**, 2-line fix. Spec §8 |
| 8 | One note location | Keep immediate, drop ride-along |
| 9 | Toasts inconsistent — 3 renders | **Renders owed** |
| 10 | The success moment is the reward | **Renders owed** |
| 11 | Bulk custom uses old input style | = **B4** |
| 12 | Bulk match: styling + per-day itemization + toast | Confirm & save currently closes silently |

---

# 11. MY ADDITIONS (not on the redline list)

- **No scroll-to-focus on bulk open** (#9's first half) — banner at y=140, no scroll
- **Scroll containers inverted** — the read-only summary rail scrolls; the input area doesn't
- **No failure-state design** — every toast is success or confirm. On a billing path, "save failed"
  and "partially saved" are required states
- **Bulk opens at "0 days selected"** with no guidance
- **Two "Match projections" buttons per modal** vs bulk's "All match projections" — inconsistent
  vocabulary for the same idea
- **No max/sanity cap on counts** — 999999 passes to storage untouched
- **Doc drift (P2):** `CLAUDE.md` / `MIGRATION_PROJECT_CLOSEOUT.md` say SC is Sheets-based. Code is
  **Postgres-only**; `isDualWrite` guards are TODO stubs that never run. Fix before someone acts on it.

---

# 12. IMPLEMENTATION PLAN

**Constraint:** the save path writes invoice numbers. Changes there are deliberate, isolated,
verified — never a side effect of UI work.

### PHASE 0 — QUICK WINS (two PRs, per decision #5)
- **PR-A (UI):** Ledger field fix · `flex-shrink` clipping fix
- **PR-B (engine):** bulk → `sc-bulk-submit` · optimistic patch · server integer guard

### PHASE 1 — CORRECTNESS  *(PDC + MiLB + STL-FL)*
0. ✅ **B8 — DONE.** Both halves fixed and gated (§6K). #501 merged, #503 gated.
   *Original scoping below, kept for the record:*
   **B8 — stale view (ex-Fix 2). TWO defects, both measured (§6E). Pre-existing P0 on main.**
   - **B8a** the refresh button can never refresh the drill — `sc-load` lands in `data`, the drill
     reads `monthCache`. User-facing bug independent of saving.
   - **B8b** `handleSave`'s `setReloadKey` produces no fetches, while the same call from
     `handleRefresh` does. A/B the `setMonthCache` delete to isolate.
   - **Rider:** `setFocusDay(null)` inside the `sc-load` effect closes the modal on every bump —
     must be extracted as part of the fix (blocks the Handoff, §8B).
   - Server data is always correct. The defect is entirely in live view refresh.
   - Failed twice as a Phase 0 patch. **Diagnose, then design. No third patch attempt.**
**Re-bundled 2026-07-23 — five items into three PRs, grouped by subsystem not convenience:**

1. **B2 + B3** *(in flight)* — rail queue click opens the modal · modal fits the viewport with pinned
   actions. Independent of each other, but both small and both touch drill/modal surfaces.
2. **Save reliability** *(queued)* — **A3 atomicity + A4 abandonment + failure-state UI as ONE PR.**
   They are one subsystem: A3 determines which failure states can exist, and the UI renders them.
   Splitting would mean designing the failure UI against failure modes about to change. **Last
   data-integrity work in Phase 1.**
3. **Ledger build-out** *(standalone)* — hybrid display + first-entered rows (§8). Pure UI on an
   engine that already works, and the only Phase 1 item with real design in it. Bundling it with
   engine work would gate visual polish alongside billing-path changes — different risk profile,
   different review attention.

**Deliberately NOT bundled: engine + UI in one gate.** PR-B taught that lesson — the bulk swap and
the integer guard passed while the optimistic patch failed, and shipping them together meant
unpicking a merged PR mid-flight. Split by blast radius.

**Gate: PDC, MiLB, and STL-FL, both views, real submissions. Never gate entry work on one account.**

### PHASE 2 — CONVERGENCE  *(PDC + MiLB + STL-FL only — NOT MLB)*
7-8. **Bulk custom + bulk match — build the SHARED review surface once**, then wire both paths into
   it. In the approved render they use the same itemised review screen and the same Handoff
   confirmation. Two separate implementations of one screen is exactly the §13B consistency trap.
   (B4, #11, #12)
9. BillRail shape-conditional hero → unfence **STL-FL only**
   ⚠️ **MLB must stay fenced — see §7**
10. Bulk scroll-to-focus (#9)

### PHASE 3 — POLISH + DELIGHT
11. Match projections state + slide-in Clear (#1, #2)
12. Header alignment (#5), ghost projections (#4), no-service CTA (#6)
13. **Toast system** — one treatment across success / confirm / warning / **failure** (#9) *renders owed*
14. **The reward moment** (#10) *renders owed*
15. Swipe-out on submit + advance to next needing entry

### PHASE 4 — **MLB SC v2.1**  *(own phase, per decision #1)*
**→ SUPERSEDED BY §15, which carries the full scope as of 2026-07-28.** The original stub read
"migrate MLB onto the converged entry surface + remove the §7 fence." The MLB discussion changed
that: MLB gets a **homestand-shaped** surface with a derived homestand model, a budget plane, and a
whole-block close-out. The fence is not simply lifted - it is replaced by the routing the homestand
surface needs. See §15.7.

### PHASE 5 — DEMOLITION
20. Retire v1 entry surfaces — **only after Phase 4**, since MLB is on v1 until then
21. Update the drifted docs (§11)

---

# 13. RENDERS OWED
1. **Toast/confirmation system** — 3 directions, covering all states incl. failure (#9)
2. **The success/reward moment** — 3 directions (#10)
3. **Entry modal layout** — scrolling body, pinned actions, real card boundaries (B1/B3, #3)
4. **Bulk itemized review** — per-day breakdown (#12)

---

# 13A. TOKEN DISCIPLINE (binding) - measured 2026-07-22

Audited both approved renders. They contained **29 distinct font sizes and 29 distinct padding
values** against a product that defines **8 and 6**. Neither render was on the product's scale.

**The live ladder** (measured from localhost at `--sc2-scale: .9`):

| | Values |
|---|---|
| **Type** (8) | micro 9.9 · caption 10.8 · body 12.6 · subhead 13.5 · h3 16.2 · h2 18 · h1 21.6 · display 27 |
| **Space** (6) | sp1 3.26 · sp2 6.51 · sp3 9.77 · sp4 13.02 · sp5 16.28 · sp6 19.53 |
| **Radius** (3) | tile 8 · container 11 · pill 9999 |

Both renders were snapped onto it - **zero raw font-size or padding literals remain in either.**

**Binding for the build:** every entry-surface rule uses `var(--sc2-size-*)`, `var(--sc2-space-*)`,
`var(--sc2-radius-*)`. **No new px literals for type, spacing or radius.** If a needed value is not
on the ladder, that is a signal the ladder needs a step - raise it, do not hardcode around it.

**Why this is binding and not advice:** this is the same failure the drill pass spent weeks
retiring - the dead `--sc2-scale` lever, the hardcoded 19px title, `July` vs `Season`, three
meal-count sizes across account types. Every one of those was a literal that drifted from its
siblings. Literals are how the drift gets in.

**Gate:** after each entry PR, grep the touched CSS for `font-size:\s*[\d.]+px` and
`padding:\s*[\d.]+px` in scv2 scope. Any hit is a defect unless justified in the PR report.

---

# 13B. SHARED-COMPONENT CONSTRAINT (binding)

**The bulk surfaces and the single-day modal must share components, not resemble each other.**

Found during render review: the bulk render had drifted from the approved entry-modal render on
**all ten shared elements** - radius 13 vs 14, body padding 12 vs 14, group card missing its shadow,
table row 11.6 vs 11.8px, qty input 52 vs 56px, buttons 8/14 vs 10/17. Two files authored an hour
apart with the same tokens available. Corrected in the renders, but the lesson is for the build.

This is the same consistency-debt pattern the drill pass spent weeks retiring (19px title, July vs
Season sizes, three meal-count sizes across account types).

**Therefore, when Phase 2 builds the bulk surfaces:**
- Reuse the **actual classes** from the single-day entry modal - group card, table head, table row,
  qty input, button, footer. Do not author parallel `.bulk-*` equivalents.
- Where bulk legitimately differs, it must be a **documented deliberate variant**, not a redefinition.
  Known legitimate differences: bulk custom has 3 columns (no per-day Amount); bulk panels have no rail.
- The qty input's state classes are `.qin` (filled) and `.qin.empty` (empty). **Do not invert this**
  in a second implementation.
- **Gate:** after the bulk build, diff the computed styles of a bulk group card against a single-day
  group card. Any unexplained difference is a defect.

---

# 14. WORKING RULES FOR THIS PROJECT
- **Gate every entry change across PDC / MiLB / STL-FL** (single + bulk, both views). Add MLB from
  Phase 4.
- **Measure, don't eyeball.** Every finding here is a computed value or a file:line.
- **Measure the baseline too.** §6D: I asserted main's pre-fix behavior from a code read and it was
  wrong, which sent one argument off course. Before calling something a regression, measure what it
  regressed *from*.
- **Never restate a summary as a verified finding.** §6O: I turned a line from CC's recon into a
  headline fact, put it in this doc, and built a prompt on it — **without opening the file.** It was
  false. **Third occurrence today** (§6D, §6E, §6O). If I have not measured or read it myself, it is
  a hypothesis and must be labelled one. **CC should treat my codebase claims as hypotheses and push
  back**, as it correctly did here.
- **Check whether work is already in flight before writing new scope.** §6O: I wrote a full prompt
  for a PR that already existed.
- **Never rewrite the save path as a side effect of UI work.**
- **Share components across surfaces; never re-author them.** See 13B.
- **MLB stays on v1 until Phase 4** — verify this explicitly at every Phase 2 gate.


---

# 8D. RETIREMENT LEDGER (what old UI still exists, why, and when it dies)

| Item | Status | Dies when |
|---|---|---|
| Single-day recorded success toast | RETIRED (P3-B, measured absent) | done |
| Old success screen (revenue hero + Next button) | RETIRED; JSX repurposed for no-service only | shell deleted in Phase 5 |
| Old failure-banner styles | RETIRED (P3-A), zero remnants [ran] | done |
| `.sc-v2-entry-success-hero` / `-caughtup` CSS | ORPHANED - rider on P3-B bounce | this PR |
| Bulk recorded success toast | KEPT by Ruling 4 | bulk composite motion PR |
| No-service inline confirmation screen | KEPT by Ruling 5 (no celebration for cancellations) | permanent (by design) |
| MLB recorded toast + v1 DayDetail + RailProgress bar | KEPT (MLB fenced) | Phase 4 (entry) / Phase 5 (demolition) |
| `SubmissionToast` component + submissionToast.css | KEPT - 5 live call sites (MLB + bulk + failures) | Phase 5, when last caller dies |
| `.oh-toast` generic error toast | KEPT - cross-app primitive | not SC's to retire |

---

# 9. DELIVERY LOG - PHASE 2A ONWARD (verbatim, moved from §0 on 2026-07-26 tidy)

**Immediate:** **Phase 2B building** - CC's three reads delivered and graded A. Findings: BillRail
is dollar-native at six render sites (shape boundary, not a variant); `hasHomestandSchedule`
separates STL-FL from MLB but the fence ships as option (d) - `ENTRY_V2_ACCOUNTS` cutover-set
override, CC's own proposal, allow-list default so new fee accounts stay v1 until opted in by
name; vocabulary is ~19 bounded sites across the entry tree + rails. **P2B Rulings 1-4 issued**
(`CC_P2B_RULINGS.md`): (1) fence = option (d) with a full consumer sweep of the set; (2) sibling
`BillRailFee`, per-meal rail untouched by construction, shared derivations imported, annual-fee
figure source must be reported not hardcoded; (3) `vocab.js` helper keyed on fee-no-dollar shape
(`flat_fee && !hasHomestandSchedule`) - NOT bare billingModel, so MLB copy stays byte-identical;
(4) swap covers entry tree + rails + overviewDerive per the locked spec, display-only.
**Build shipped + GATE 1 run (2026-07-25):** PR #526 @ `3b6ac55`, 10 files. Measured live: fence
held on CIN-OH with `?entry2=1` forced; contract block verbatim and the ONLY dollar on the STL-FL
page at overview; BillRailFee + Month block render; coaching/queue/CTA vocabulary correct; MLB rail
byte-identical live, no contract block, no leak; PDC 4-col + MiLB regression clean. **BLOCKER:**
the fee table reused `hideAmount` (3-col bulk head, Service·Rate·Qty) - every row renders
"$0.00 / meal" in the Rate cell, violating the 2-col Service·Served spec. Bounce
(`CC_P2B_GATE_BLOCKER.md`): 2-col `LEDGER_HEAD_FEE` + ServiceRow drops rate AND amount on the fee
variant + `--fee` grid with mobile override; REQUIRED same round: consolidate the 3x pasted
served-sum loops into one `feeServedTotals` memo (L7); report items: fee week bands have no visible
surface on month view [measured], no bulk trigger renders on STL-FL [measured, pre-existing - spec's
"Bulk confirm" likely moot], legend still reads "Needs entry" (P3 observation).
**GATE 2 (2026-07-25): PASS - merge-ready.** Fix `c9753eb`: 2-col `LEDGER_HEAD_FEE` + variant enum
(perMeal/bulk/fee - invalid table shapes unrepresentable, CC's design, graded A) + `feeServedTotals`
memo (L7 consolidation, three consumers). Measured: Service·Served head, ZERO `$` in the full
dialog DOM, save flow end to end (60+40 -> "Confirmed / 100 served" -> tile -> Ledger), no-service
fee copy exact, refresh survival on fee path, bulk 3-col intact with zero fee-class leak, MLB
binary all four by name with `entry2=1` forced. Test write: 100 served on STL-FL 2026-07-18.
**Report rulings:** week bands -> P2B-b follow-up immediately post-merge (the `:901` gate was
dollar-avoidance; fix is a served-count band touching shared weekMetrics - own round) + legend
fee-branch string + "Served/100 served" label redundancy ride P2B-b; bulk-on-STL-FL deferred to
hopper (no trigger exists, pre-existing; spec "Bulk confirm" moot until bulk offered on fee).
**Sequence: merge #526 -> P2B-b -> archive-edge guard.**
**MERGED 2026-07-25, main @ `ce5952e`.** P2B-b shipped as PR #527 @ `fc6e2b0` (3 files, +30/-11).
CC self-corrected its gate-1 `actMeals` claim before building (aggregator has no isFlatFee skip;
`wm.actMeals` IS the served sum) - band fix landed as zero-derive, in-place value branch.
**P2B-b GATE (2026-07-25): PASS.** Measured: bands on month AND period (P8) drills with served
figures corroborated against the known test write (Week 3 = 100) and the rail's served-to-date
(Week 1 = 9); contract block still the only `$`; legend Confirmed / Needs confirmation on STL-FL
with CIN-AZ byte-identical; actions row "Day total / N served" pinned copy exact; CIN-AZ band
dollars byte-identical to baseline; CIN-OH zero bands + v1. **VERDICT: merge #527.** **MERGED 2026-07-25.**
**Archive-edge guard in flight** - four reads delivered and graded A (2026-07-25). Findings:
match-projections' `?? 0` fallback ACTIVELY writes zero-rows onto archived pairs today (traced
through the sc-6b view filter - corrective fix, not defensive); serviceGroups already carries
`activeUntil` so nothing new threads; zero-applicable-day structurally reachable, trivial with the
same map; **probe [ran]: NO services on prod have `active_until` set** - guard ships
armed-for-the-future, gated code-level + live normal-bulk payload regression. Rulings issued
(`CC_ARCHIVE_EDGE_RULINGS.md`): skips map at the mount site (overwrites pattern, predicate
textually parallel at all four sites); copy pinned to the "offered" family ("No services offered
this day - will not be written"). **Field-check item for owner:** the skip UI gets its first live
verification the day a service actually receives an `active_until` - eyeball the bulk review then.
**BUILT + GATED (2026-07-25): PASS - merge #529** (`04a1690`, 4 files +361/-26). CC extended the
guard to BOTH offline-queue enqueue fallbacks unprompted (a queued replay would have resurrected
refused pairs) - in-scope, correct, praised. Gate [ran]: predicate parallel at every site incl.
fallbacks; §13A clean; live no-op proof - POST body byte-equivalent to the pre-guard baseline
(same colIndex/shape/value, written:1, same-value overwrite = zero data mutation); zero skip UI on
normal data; footer writable-N correct; CIN-OH v1. Guard + skip UI states ship [code-read] per the
no-live-repro ruling. Custom-review header/row numbers now post-guard (truthful mirror holds).
**MERGED 2026-07-25, main @ `8051d4f`.** Every pre-Phase-3 PR is done.

---

**PHASE 3 OPENED (2026-07-25).** `RENDER_HANDOFF_BLENDED.html` in hand and read in full. The
render's own build list: Handoff motion (beat table 0-1850ms with easings, now the contract) ·
ring permanently into the rail replacing the "18 of 25" line · 4px accent-rail primitive, four
types (green/red/amber/navy) across pill, session strip, failures, offline chip, dialog top-rails
· toast policy (success toasts removed entirely; offline/note-posted/failure survive) · one
confirmation-dialog pattern · month-complete card in `#25a866` green-not-amber with full ring
close + check draw. **Trigger ruling (binding):** the render's "requires PR-B's optimistic patch"
line is STALE (saves measure 300-600ms); the Handoff fires on confirmed success ONLY - beat 0 is
`result.success`, failure = the motion never started, matching the render's own failure model.
**Reduced-motion path added by Chat-Claude** (render omits it): no flight/sweep/slide, instant
end states. **Proposed split:** P3-A (ring + accent language + dialogs + surviving toasts) then
P3-B (sequence + success-toast removal + session strip + month card). Reads prompt out:
`CC_P3_HANDOFF_READS.md` - five reads, the architecture decider being the modal-to-page pill
flight. Bulk composite stays OUT until the single-day base ships (2A Ruling 3).
**Five reads delivered + graded A (2026-07-25); P3 Rulings 1-6 issued + P3-A spec out**
(`CC_P3_RULINGS_AND_P3A.md`). Key rulings: pill flight = fixed clone with overlapping dissolve
(portal escape hatch pre-authorized; the modal never unmounts in the Next flow, so a portal buys
nothing); tile flip = data-driven with an `entryMotion` gate prop so MLB never fires it (bulk
tiles flipping = sanctioned freebie, not the composite); session strip = Map of last-saved values
per date (fixes re-edit double-count), count + unit sum in both vocabularies, below the ring,
resets on account/scope change, no-service days count toward it at zero; **bulk success toast
SURVIVES until the composite motion ships** (no transition = no removal); no-service toast dies in
P3-B with NO Handoff (celebrating a cancellation is tonally wrong - ambient ring/queue updates
only); note-posted chip is NEW (render designs it, nothing exists today - spec-gap catch), built
in P3-A with render-verbatim copy; ring sweeps ambiently on ANY pct change, the Handoff only
choreographs its timing. Split holds: P3-A = RailRing peer primitive (MLB keeps RailProgress
byte-identical) + 4-type accent-rail primitive + dialog top-rails + note-posted chip, zero toast
removals; P3-B = coordinator, flight, session strip, success-toast + justSaved retirement, month
card, RM path.
**Owner design picks (2026-07-25, via decision board):** ring interior = percent, fraction moves
to the caption so how-many-left survives; compact size; STL-FL = option A (2B hero untouched,
arc-only ring, no inner label); note-posted chip = GREEN success (overrode Chat-Claude's navy
lean); dialog top-rails = amber on both confirms. Pins folded into `CC_P3_RULINGS_AND_P3A.md`.
**Report-first discipline held throughout** - reads before build, instrumentation before the third
fix attempt. (Trailing text of this entry was truncated by the 2026-07-26 §0 tidy; substance is
preserved in §14 Working Rules and in the P3 gate entries in §0.)

---

# 15. MLB SC v2.1 - FULL SCOPE  *(opened 2026-07-28; supersedes the §12 Phase 4 stub)*

**Owner directive:** the Phase 4 hard stop was honored - MLB began with a discussion, not a prompt.
This section is the durable record of that discussion, the read-only investigation behind it, and
the scope it produced. Nothing here is built yet.

## 15.1 What MLB operations actually are

MLB chefs work in **homestands**, not weeks. When the team is home, KitchFix is hot; when the team
travels, the kitchen is cleaning, prepping, or dark. A homestand is a contiguous block of home
games - 3 to 11 days in the real data - with a defined start, a defined end, and a fixed labor
budget attached.

Four accounts, all on a P4-P10 season window (April to early October):

| Account | Kitchen | Note |
|---|---|---|
| CIN-OH | Cincinnati Reds | **pilot account** |
| STL-MO | St. Louis Cardinals | |
| TXR-TX-H | Texas Rangers, home side | |
| TXR-TX-V | Texas Rangers, visiting side | **special** - labor budget is a % of actual sales |

Before every homestand a chef needs: how many days and what shape, how much labor budget, and
whether the last homestand was closed out. That is the job this build serves.

**The Season Tracker is OUT OF SCOPE.** It was background education only. It continues to run
independently on Google Sheets; this build neither reads it, couples to it, nor retires it.

## 15.2 Settled by owner ruling (2026-07-28)

| # | Decision |
|---|---|
| M1 | Season Tracker out of scope - not read, not coupled, not retired by this work. |
| M2 | **Postgres is the source of truth for MLB schedules.** API-sourced game rows are it. |
| M3 | **Homestands are DERIVED** from the game schedule. Stored `homestand_id` stops being an input. |
| M4 | Labor budget comes from the annual P&L, row `3100.1 Hourly Kitchen Labor Wages`, per period. |
| M5 | **Budgets are living** - adjusted mid-season for real reasons. SC holds the current effective value, not a frozen import. |
| M6 | Salary (`3100.2`) carried for KPI reporting, never shown to chefs. It is also the other half of the explanation whenever hourly moves. |
| M7 | Service counts on MLB are **planning, not billing**. The three fixed-fee accounts bill flat; TXR-V bills on actual sales. |
| M8 | SC starts **clean**. No history migration of any kind. |
| M9 | Labor actuals: **manual entry is the working path and the permanent fallback**; Rippling API lands later on the same surface. Every figure records typed-vs-imported. |
| M10 | Game times are **out** - meal times are set by clubhouse comms day to day. |
| M11 | Notifications (bell + email) dropped. |
| M12 | **No cutover this year.** Built for next season; **CIN-OH pilots immediately**. |
| M13 | Admin portfolio view folds into the planned SC Admin Dashboard, not the chef surface. |
| M14 | Sequence: the three fixed-fee accounts first, TXR-V's sales flex after. |
| M15 | **Service confirmation is whole-block**, not day-by-day. |
| M16 | The season's **first** labor window opens **14 days before** the first homestand's first day, for onboarding and training. |
| M17 | TXR-H's adjusted $110,000 splits **evenly across periods containing homestands** ($15,714.29 x 7). |
| M18 | Served headcount already exists in SC as projections - nothing new to source. |
| M19 | **MLB chefs do not enter day counts at all. Meal counts are STATIC** (owner, 2026-07-28). This kills the day-entry question outright - options C and D are dead and even "block-only with counts" is over-built. The only variables a chef contributes per homestand are **which days actually happened** and **what labor cost**. Chat-Claude's reading, pending owner confirmation: confirming a homestand confirms the schedule ran, and the system writes the standard count for every day that did; exceptions (rainout, cancellation, unplanned service) use the existing mark-no-service mechanism. **Open observation:** live data shows real actuals of 180/day already written for past CIN-OH days - who or what writes them today is unknown and worth establishing. |

## 15.3 What the investigation proved  *(CC read-only rounds, 2026-07-28)*

**Derivation works, cleanly.** Grouping home games into blocks split by away games produces
**13 / 13 / 12 / 12** homestands per account, spans of **3 to 11 days**, zero blocks over 14. It
matches the real operation with no hand-tagged value anywhere.

**A design question evaporated.** A rule for long no-game stretches (All-Star break) is not needed:
every gap inside a derived block is **exactly one day**, because MLB schedules away series on both
sides of the break, and away days are the split signal. No threshold to tune.

**The stored ID is structurally unfixable, not merely stale.** STL-MO's 32-day "HS8" has a precise
cause: a **June 25 game was postponed and replayed July 23**, and the stored homestand tag travelled
with it. That is what a stored ID does every time a game moves. The other three accounts are clean
today and exposed on the next postponement. Derivation removes the failure mode permanently.

**And it is shipping right now.** That grouping renders live in SC today for STL-MO: the rail's
homestand section and SeasonStepper read "Jun 22 - Jul 23," the July month footer overcounts
homestands, period rollups inflate, and the scoped filter makes the block appear in view from May
through August. **A defect in shipped code, not dormant data.**

**Schedule freshness is a human loop.** `/api/cron/schedule-drift` runs daily at 6am ET, diffs the
live Stats API against our rows, posts to Slack, and **writes nothing by design** - applying changes
is a manual extract-then-migration flow, with auto-apply parked to 2027. Derived homestands are
exactly as fresh as that loop. `game_time` / `day_night` / `is_doubleheader` never auto-refresh.

**SC holds no money concept for MLB.** Zero labor, budget, or cost anywhere in the surface or the
tables. The cost side is built from nothing, which is cleaner than inheriting.

**The swap has one seam.** Every MLB surface - rail, stepper, drill ledger, period cards, exports,
print - flows through `deriveHomestandSegments`. One other site
(`serviceCalendar.js` `homestandSummaryByMonth.homestandIds`) reads the raw ID for a monthly count.
**Two places, and the whole system changes basis.**

**Straddle census:** 9 homestands cross a month boundary, 4 cross a period boundary, across all four
accounts. Bounded - and it stops mattering entirely once buckets key on dates rather than IDs.

## 15.4 The budget data  *(extracted from the 2026 P&L workbooks; full detail in `MLB_BUDGET_REFERENCE.md`)*

Layout: columns B..N = P1..P13, row 4 = period start dates. MLB season = **P4..P10**.

| Row | Line | Use |
|---|---|---|
| 35 | `3100.1 Hourly Kitchen Labor Wages` | **THE labor budget.** What the chef schedules against. |
| 36 | `3100.2 Salary Kitchen Wages` | KPI reporting only, never shown to chefs. |
| 6 | `Total Revenue` | Forecast revenue. Drives TXR-V's flex budget. |

**Hourly labor budget by period (P4-P10):**

| Account | P4 | P5 | P6 | P7 | P8 | P9 | P10 | Season |
|---|---|---|---|---|---|---|---|---|
| CIN-OH | 16,709 | 16,709 | 15,316 | 20,886 | 13,924 | 16,709 | 9,747 | **110,000** |
| STL-MO | 17,778 | 17,778 | 17,778 | 25,185 | 14,815 | 13,333 | 13,333 | **120,000** |
| TXR-TX-H | *(P&L shows 150,000 - superseded)* | | | | | | | **110,000 effective, even split = 15,714.29 x 7** |
| TXR-TX-V | 4,154 | 12,000 | 6,000 | 12,000 | 9,231 | 9,231 | 7,385 | **60,000** |

**TXR-V's 19.23% is designed, not emergent** - it holds to the exact hundredth in all seven periods,
so the budget was built as `revenue x 19.23%`. Store it as an account parameter; never derive it at
runtime.

**TXR-H's $40,000 gap is a real post-budget adjustment, not an error** (owner): the Sous Chef role
was budgeted hourly and hired salaried, so the money crossed from the hourly line to the salary
line after the budget was written. **This is the evidence behind M5** - budgets are living, and SC
needs admin editing plus a change trail, because a chef whose target drops $40,000 mid-season needs
an answer and finance needs the reconciliation.

## 15.5 Architecture

**Three planes, cleanly separated.**

| Plane | State | Behavior |
|---|---|---|
| **Schedule** | exists | API-sourced game rows in Postgres, refreshed through the drift-plus-human loop. Unchanged by this build. |
| **Homestands** | new, derived | Computed at runtime from the schedule. Never stored, never tagged, therefore never wrong. Records that point at a homestand key on something **stable** (e.g. its first game) so a reschedule cannot orphan them. |
| **Money** | new, from zero | Budgets per account per period, admin-editable with a change trail. Labor actuals per homestand, manual with an import seam, provenance recorded. Sales entries for TXR-V. |

**The homestand becomes a real navigation scope**, alongside season / period / month / day. Month
and period views link into it.

**Budget allocation must be tamper-proof.** Budget arrives per period; chefs work per homestand. The
allocation comes from the **immutable game schedule**, never from operator-declared days - otherwise
declaring more prep days becomes a way to raise your own budget. (This is exactly what the old
working-days allocation permitted.) Options go to the owner at the render stage.

**Planned work days** (prep / clean / open) are an operator planning layer: they shape the day strip
and the overtime guidance, because that is the chef's real schedule. **They never touch the budget.**

**Labor attribution window.** From the day after the previous block's last day through this block's
last day, so road-trip cleaning and prep count against the homestand they serve. Windows tile the
season with no gaps and no overlaps. The season's **first** window opens 14 days early (M16).

## 15.6 What gets built

**CORRECTED 2026-07-29 (scope-doc defect SD-1).** The table below was written 2026-07-28 with a
1-based numbering that the build never used. From the first PR onward the work shipped as M-0..M-6,
and §15.8e/f/g, `MLB_SC_FULL_SCOPE.md` and the session handoffs all use the shipped numbering. The
original also ordered Rippling ahead of TXR-V sales flex; the shipped sequence is the reverse.
The wrong table is preserved below the corrected one rather than deleted - the record is honestly
wrong-then-corrected, not quietly tidied.

**Shipped numbering (canonical):**

| # | Piece | State | Notes |
|---|---|---|---|
| M-0 | **Derived homestands** replacing the stored ID as grouping basis | **MERGED** #545 | Fixed a live defect; step zero of everything else |
| M-1 | **Budget plane** - tables, admin editing, change trail, P&L-shaped annual import | **MERGED** #546, #547, #548, #550 | ~28 rows of data; the work is semantics, not volume. Two items still owed - see §15.8g |
| M-2 | **Homestand scope + drill-down** - the surface a chef opens | **MERGED** #556 | Day strip, budget envelope, CIN - OH pilot. Overtime dividers owed, see §15.8j |
| M-3 | **Close-out** - whole-block service confirmation + labor actuals | **MERGED** #561 | Manual first, provenance recorded. sc-22 applied. See §15.8k |
| M-4a | **Tracker restyle + rails + widening** | **MERGED** #566 | Proportional width, actuals-due state, three rails rebuilt, all four MLB admitted. sc-23 + sc-24 applied. See §15.8l |
| M-4b | **Rail rebuild, tile navigation, slim strip, payroll dividers** | **MERGED** #571 | Suppression and card money both built then reversed. See §15.8m |
| M-5 | **TXR-V per-series sales** | **PARKED to offseason** | Owner ruling 2026-07-30. Visiting keeps its current tool for 2026; new system for 2027 |
| M-6 | **Rippling import** | **PARKED** | Was already parked. Offseason |
| M-5 | **TXR-V sales flex** | not started | Per-visiting-team-series sales entry (M21); post-series billing reconciliation |
| M-6 | **Rippling import** | not started | Onto the existing close-out surface, once the API is worked through |

**Not in the M-numbered sequence:** the admin portfolio rollup (M13) is deferred out of the MLB
build entirely and folds into the planned SC Admin Dashboard. It is not M-4 and it is not a phase
of this build.

**Superseded numbering (as written 2026-07-28, do not use):** M-1 derived / M-2 budget /
M-3 drill-down / M-4 close-out / M-5 Rippling / M-6 TXR-V / M-7 admin rollup.

## 15.7 Phase 4 is absorbed

The redesign's original Phase 4 was *"MLB joins entry-v2"* - lifting the §7 fence so MLB gets the
current entry panel and the Handoff. **That is now inseparable from this work.** It makes no sense
to bring MLB onto the new day-entry screen and then separately give it a homestand surface.

**M19 makes it definitively moot.** MLB has no day count entry to join - counts are static and
nobody types them. The homestand drill-down **replaces** MLB's day entry rather than joining it - day tiles keep showing
schedule truth but stop being places you type into, and the rail's "game days entered" metric
changes meaning. **Owner confirmation still needed:** does day-level entry disappear for MLB
entirely, or remain available underneath the block confirmation? The deciding fact is whether MLB
operators use the current day entry today.

**Consequence for §7:** the MLB fence does not simply get lifted. It gets replaced by whatever
routing the homestand surface needs. §7 stays in force until M-3 ships.

## 15.8 Open questions

**Owner:**
- Does MLB day-level count entry disappear entirely, or stay under the block confirmation? (§15.7)

**Deferred to renders, deliberately:**
- How period dollars become per-homestand dollars.
- How a closed-out homestand gets reopened.
- How homestand navigation sits beside month and period.
- Whether spring-training EXHIBITION days appear as their own block, a labeled aside, or nothing.
  (2 rows each on the TXR pair, Mar 23-24 vs KC, before the opener; current derivation skips them.)


## 15.8b INVESTIGATION ROUNDS 2 AND 3 - what came back (2026-07-28)

### Season-view inventory - more is already built than scoped

- **The homestand strip is `SeasonStepper`** (`season/SeasonStepper.js`), mounted from
  `SeasonShell.js:197-201` gated on `hasHomestandSchedule`. **Its blocks are already real
  `<button>`s** with aria labels, titles, and focus-visible states - they route to the period
  containing the homestand's start date. Retargeting them is small work, not new work.
- **It already renders** the NOW/NEXT/LAST badge, opponents, date range, game count, and the
  "homestand N of M" counter. Blocks are **uniform width** (focus block 1.7x), **three states
  only** (done / next / focus) - so "actuals due" is a NEW state, and proportional sizing is a
  change, not a given. Chat-Claude's render was wrong on both.
- **MiLB AAA shares this machinery.** CIN-KY and TBJ-NY carry `has_homestand_schedule = true`, so
  the strip and the grouping function serve them too. **Chat-Claude's earlier "MLB work will not
  affect MiLB" was WRONG for these two accounts** - recorded so the gate plan accounts for it.
- **Empty month/period suppression does not exist.** `MonthCard` and `PeriodCard` are shared
  shells used by every account shape; every month and period in range always renders, with
  off-season showing a full grid of off tiles plus a phase label. The owner's "drop empty
  months/periods" change therefore either gets account-shape-gated or it changes PDC and MiLB too.
- **Day tiles inside season cards are NOT clickable today** - tile-to-homestand navigation is new
  interaction on a shared component.
- **The stale `homestand_id` has THREE readers**, not one: `deriveHomestandSegments`,
  `PeriodCard`'s in-component `deriveHomestandSubtitle`, and the server's per-month
  `homestandSummary.homestandIds`. STL-MO's July month card is very likely showing an inflated
  homestand count today, same root cause as the rail.
- **Nothing homestand-shaped is server-provided.** No per-homestand date range, game count, served
  count, opponents, or status in the payload - all reconstituted client-side.
- **The Calendar/Period toggle is session-only** React state, not URL or storage.

### Budget allocation - formula CONFIRMED

`dailyRate(P) = P.hourlyBudget / (schedule days in P)`;
`homestandBudget = SUM over touched periods of rate x days in that period`.
Implemented at `route.js:222-292`. Three mechanical differences: rounding applied once at the
envelope (per-period subtotals round independently, so they can differ by +/-$1); a `|| 1`
divide-by-zero fallback that never fires for MLB; period boundaries inclusive both ends.

**The divisor counts EVERY schedule day** - GAME + PREP + OPEN + CLOSE + injected CLEAN.

**The prep-day gap is not reconstructable.** CIN-OH per-homestand PREP counts vary 1-2 with no rule
tied to game count or gap size; HS1 uniquely carries 2 OPEN (season opener), HS13 carries 2 CLOSE
(season closer). Operator judgment, not pattern.

**Both formulations conserve the season total** [ran, all four accounts]: tool spans give
110,001 / 119,999 / 110,001 / 60,000 against 110,000 / 120,000 / 110,000 / 60,001 (+/-$1 rounding);
game-derived spans give exact matches to the dollar. **Only per-homestand distribution differs** -
e.g. CIN-OH HS1 moves from $9,283 (tool) to ~$10,148 (game-only). **OPEN DECISION.**

### TXR-TX-V - complete picture

- `sc_fee_schedule`: **amount = $0, `covered_by_account_key` = "TXR - TX - H"** - do not bill
  separately or it double-counts H's $604,032.
- **19 sold-revenue rows across HS1-HS8**, all entered by one operator, **7 of 8 homestands have
  more than one entry**, values move both directions (HS2: 17,288 -> 17,888 -> 18,068 -> 17,468).
  Append-only sheet, **latest row wins** by map overwrite.
- **The 19.23% ratio is baked into the HUB budget values, not stored or pinned in code** - every
  period's hourly/revenue rounds to 0.1923. Recomputed fresh per homestand every render, so editing
  a period's budget or revenue silently drifts every chef's displayed number.
- Forecast revenue is **per-period**, pro-rated to homestands on the same divisor. TXR-V season
  revenue = $312,000.
- **Post-homestand close-out billing DOES NOT EXIST** - no field, no schema, no UI, no code. The
  only revenue input is the pre-homestand sold figure. `labor_plans.revenueActual` exists as a
  per-submission column but is not a close-out concept. **This is new work.**
- Two hardcoded gates carry the whole revenue-flex concept: `REVENUE_FLEX_ACCOUNTS` at
  `route.js:102` and the `isRevenueFixed` gate at `:913`. **No SC-side field distinguishes TXR-V
  from TXR-H at all.**

### The Texas visiting-catering SOP (owner-supplied, 2026-07-28) - reframes TXR-V

As of the 2026 season there is **no sales department**; the visiting clubhouse chef owns the entire
sales cycle. Cadence: initial contact 4 weeks before a series, follow-up at 2 weeks, active
follow-up, quote, **billing to AP at confirmation, adjustments after the series**, satisfaction
survey.

**This explains the multiple sold-revenue entries per homestand** - the number firms up across that
4-week cadence. It also confirms the post-series reconciliation the owner described is a real
business step ("any adjustments during the series can be made after the series").

**NEW DESIGN QUESTION it raises:** a TXR-V homestand often hosts **two or three different visiting
teams** - separate clients, separate quotes, separate invoices. The tool stores ONE figure per
homestand, so the chef is summing by hand before entry. **Should SC track sales per visiting-team
series rather than per homestand?** It matches the real process and gives the chef a place to run
the 4-week cadence per client; the homestand figure becomes a derived sum. More to build.
**OWNER DECISION.**

## 15.8c OWNER RULINGS ON THE THREE OPEN DECISIONS (2026-07-28)

| # | Ruling |
|---|---|
| M20 | **Budget allocation uses GAME-DERIVED spans.** Divisor and multiplier both use the game-derived homestand block. Season totals reconcile exactly (proven all four accounts). Per-homestand distribution differs from the old tool's - that is accepted. |
| M21 | **TXR-V sales are tracked PER VISITING-TEAM SERIES**, not one figure per homestand. Matches the SOP's real process (one client, one quote, one invoice per series). The homestand figure becomes a derived sum. |
| M22 | **Empty month/period suppression is MLB ACCOUNTS ONLY.** Do not touch PDC or MiLB. |

### M20a - PREP DAYS ARE DERIVABLE (owner-supplied rule, verified 2026-07-28)

The owner's rule: **a prep day is the day before the homestand's first game, plus each internal
off-day inside the homestand** (teams often come in on an off-day mid-homestand). Not universal -
sometimes a team gets ahead and skips it, or works a short day.

**Verified against every CIN-OH homestand** - the rule predicts the HUB sheet's PREP counts
exactly:

| HS | Games / span | Internal off-days | Predicted | Actual |
|---|---|---|---|---|
| HS5 | 3 in 3 | 0 | 1 | 1 |
| HS6 | 6 in 6 | 0 | 1 | 1 |
| HS7 | 6 in 6 | 0 | 1 | 1 |
| HS2 | 6 in 7 | 1 | 2 | 2 |
| HS9 | 9 in 10 | 1 | 2 | 2 |
| HS12 | 6 in 7 | 1 | 2 | 2 |

Season opener adds OPEN days (HS1: 2) and season closer adds CLOSE days (HS13: 2) - boundary cases,
not part of the rule.

**This supersedes CC's "not reconstructable" finding**, which tested only for a pattern tied to
game count or gap size and never tested the internal-off-day hypothesis.

**Consequence for the build:** prep days do NOT affect the budget (M20 - game-derived money), but
they DO feed the day strip, the overtime week math, and the "schedule N days in Rippling" count.
So SC **proposes** prep days from the schedule and the chef **adjusts** them. Smart default rather
than blank slate, and the money stays untouchable by anyone in the field.

### M22a - HARD GATING CONSTRAINT

The existing homestand predicate `hasHomestandSchedule` **also matches CIN-KY and TBJ-NY** (MiLB
AAA). Per M22, every new MLB surface must gate on **MLB specifically** - `level === "MLB"` or an
explicit account set - never on `hasHomestandSchedule` alone, or the two AAA accounts inherit
changes the owner did not ask for. **This is a check on every gate for the whole build.**

## 15.8d OPEN ITEMS RESOLVED (owner, 2026-07-28) - M23-M27

| # | Ruling |
|---|---|
| M23 | The 180-meal actuals on past CIN-OH days are **owner test data**, unrelated to any process. No collision; the close-out writes counts freely. |
| M24 | **Rippling API is worked through jointly** - a colleague has used it. Not blocking; manual-first stands. |
| M25 | **Reopen = transparency.** Prior figure, provenance, who closed and reopened, when and why - all visible to chef and admin. |
| M26 | **Budget administration lives in the SC admin surface**, not a separate screen. Admin-only. |
| M27 | **Exhibition days: calendar display only.** Separately billed catering, invoiced directly to the client. Not part of the labor budget. Nothing built in SC beyond showing them on the calendar for reference. |

**M27 CORRECTED (2026-07-28).** The earlier "own block" shorthand and Chat-Claude's recommendation
that exhibition draw labor budget were both **wrong**. Exhibition is not a homestand: no tracker
block, no close-out, no allocation, no cancellation path in SC, and **excluded from the period
divisor** so P4's daily rate comes from homestand days only. This also dissolves the older §6S
concern about a billable event lacking a cancellation path - it needs none, because that billing
never runs through SC.

**Full scope v1 written** (`MLB_SC_FULL_SCOPE.md`) and **render v3 built against it**
(`MLB_SC_RENDER_V3.html`) - two accounts, three views, four close-out states, per-series sales,
derived prep days, provenance chips, computed budgets from real P&L figures.

## 15.8e M-0 BUILD OPENED - equivalence proof + two rulings (2026-07-28)

**First MLB build PR out: `CC_MLB_M0_DERIVED_HOMESTANDS.md`** - derived homestands, shipping alone
because it touches MiLB-shared code and is a correctness fix, not a feature. Two-stage prompt: CC
produced an equivalence proof and stopped before writing code, as instructed.

**Proof result [ran]:** CIN-OH, TXR-TX-H and TXR-TX-V derive **identical** to stored. STL-MO
diverges exactly as predicted (stored HS8 spans Jun 22 - Jul 23 with the Jul 23 makeup game
mis-tagged; derived puts it in the block containing its date). **Two unexpected findings:**

1. **CIN-KY and TBJ-NY carry ZERO stored homestand IDs** - their derivation returns `[]` today, so
   the stepper shows nothing homestand-related. Deriving would give them 11 and 12 homestands.
   **That is a new MiLB feature, not equivalence.**
2. **STL-FL and TBJ-FL hold 66 GAME rows and no AWAY rows.** If the derivation ever saw their data
   it would emit one homestand spanning April to September. Outer gates hold today, but the rule
   has no self-defense.

**RULINGS (`CC_MLB_M0_RULING.md`):**
- **M-0 is MLB-ONLY.** Non-MLB falls through to today's `homestand_id` path, so the AAA pair stays
  at `[]` - **provably untouched rather than argued-untouched**, and STL-FL/TBJ-FL never reach the
  code. Blast radius shrinks to four accounts.
- **The derivation carries a self-guard**: no AWAY rows, or any block over 14 days or under 3
  games, returns **empty for the whole account** rather than a partial or a lie. Dev-only log when
  it trips.
- **Logged, not built:** MiLB AAA homestands are a real opportunity the data supports - owner's
  decision on its own merits, never a side effect of this PR.

## 15.8f M-0 BUILT + GATED (2026-08-04) - PR #545 @ `bd199e2`

CC's build graded A. It chose an **explicit account set** over a `level === "MLB"` predicate, and
its reasoning beat mine: derivation correctness depends on complete GAME + AWAY coverage from the
Stats API, so admitting a future account should require a deliberate code edit rather than an
accounts-table row change. Set adopted.

**Self-guard shipped as ruled:** no AWAY rows, or any block over 14 days or under 3 games, returns
`[]` for the whole account with a dev-only warning naming the account and reason. Thresholds
documented against real data (empirical max span 11, empirical min games 3).

**Stable key = first game's `game_pk`, else its date. Never an ordinal.** The loader now emits
`gamePk` per day for it. Ordinal labels are assigned after the date sort, so displayed "HS10"
stays consistent while the key survives reschedules.

**GATE (2026-08-04): PASS - merge #545.** Measured live:

| Check | Result |
|---|---|
| **STL-MO HS8** | **FIXED** - `Jun 22 - 28 vs ARI / MIA` (was Jun 22 - Jul 23) |
| **STL-MO HS10** | **FIXED** - `Jul 23 - 30, 8 games` - the Jul 23 makeup joined the block containing its date |
| CIN-OH | 13 blocks, HS1 `Mar 26 - Apr 1 vs BOS / PIT` through HS13 `Sep 14 - 20 vs LAD / CHC` |
| **CIN-KY fence** | **zero blocks, no stepper** - identical to pre-M-0 |
| **TBJ-NY fence** | **zero blocks, no stepper** - identical to pre-M-0 |
| PDC (CIN-AZ) | no stepper, 365 tiles, clean |
| STL-FL | no stepper, 365 tiles, clean |
| STL-MO period drill | rail ledger renders HS10 / HS11, steppers present, no exception |

Build green, Playwright nav-matrix 9/9, CI green. **MERGED 2026-08-04.** The STL-MO grouping
defect that had been rendering in production is fixed, and the failure mode is gone permanently -
a postponed game can no longer drag its homestand tag to a new date.

**Observation, not a defect:** `PeriodCard` now runs a full-season derivation per card, so a
13-card period view performs 13 full derivations plus the stepper's. Data is small and it measured
fine, but it is worth a memo if the season view ever feels slow.


## 15.8g M-1 BUILT + ACCEPTANCE PASSED (2026-07-29)

**PR #546 merged** (schema, seed, derivation, admin panel; MLB-only at three layers).
**PR #547 merged** - sc-20 `DO` block detection corrected: it matched `LIKE '%entity_type%IN%'`,
but Postgres normalises `IN (...)` to `= ANY (ARRAY[...])`, so the block silently no-opped. Would
have surfaced as a runtime constraint violation on the first ratio audit write.
**PR #548** - three acceptance defects in one round.

**Defects found and their sources:**
1. **ESM import** missing `.js` - Next's resolver is lenient, Node's is not. Swept the whole SC
   surface; only file affected.
2. **Period convention mismatch** - `sc_day_metadata.period` stores bare numeric (`"4"`), the seed
   stored `"P4"`. Join never matched, every envelope null. **Chat-Claude's spec error** (the seed
   table used `P4` column headers). Ruled: fix the convention, not the join - a normalization
   helper hides a disagreement that every future consumer would hit. sc-21 migration + all three
   consumers updated together.
3. **3-cent drift** - `15,714.29 x 7 = 110,000.03`. **Chat-Claude's spec error** (rounded figure,
   exact sum demanded). P10 absorbs 3c.
4. **Rounding accumulation - found by the acceptance check itself.** Per-homestand `Math.round`
   drifted $3 over on CIN-OH, $1 on STL-MO. Invisible at the dollar level; only the season sum
   exposed it. Replaced with **integer cents + largest-remainder (Hamilton) allocation per
   period**, so each period's cents sum to its budget by construction and ties break on block
   index for determinism.

**Migration ordering defect caught pre-apply:** sc-21 as committed updated values BEFORE dropping
the P-anchored CHECK - it would have failed on its first statement. Owner applied an order-
corrected version (`sc-21-CORRECTED.sql`); the repo file needs the same reordering.

**ACCEPTANCE: PASS, cents-exact on all four accounts** [ran]:
CIN-OH $110,000 · STL-MO $120,000 · TXR-TX-H $110,000 · TXR-TX-V $60,001, every diff `0c`.
Straddle receipt prints (CIN-OH HS7: P6 $3,829 + P7 $3,916.13, with the 1c Hamilton bump visible).
Missing-budget emits null-with-reason 13/13, zero zero-envelopes. Non-MLB gate returns nothing.
TXR-V flex round-trip exact ($27,000 x 0.1923 = $5,192.10).

**Local nav-matrix waived for this push only** - Next 16 refuses a second dev instance alongside
the owner's session, and the change is confined to a pure derivation plus a probe with no
navigation consumer. CI green required before merge. Not a precedent.

**Still owed - TWO items, not one (corrected 2026-07-29):**

1. **Admin-panel live gate** - real edit plus trail, "not set" vs `$0`, reasonless change refused,
   four fences. Known at the time of the acceptance.

2. **`deriveLaborBudgets` has NO production consumer.** Found 2026-07-29 by cross-reading CC's
   `SC_TECHNICAL_HANDOFF.md` §11.8 against the repo and confirmed by grep: the only call sites are
   the eleven inside `scripts/_probe_labor_budget_acceptance.mjs`. No React component and no API
   route consumes it. **The cents-exact per-homestand envelope - the number the chef actually needs
   - renders nowhere in the product.** The acceptance above proved the math and did not prove a
   feature, and this section as originally written did not say so. A chef opening CIN-OH today sees
   no budget on any surface.

   Compounding it: every endpoint that returns budget rows (`sc-admin-labor-budgets-list`,
   `-history`, `-set`, and both ratio actions) sits behind `isScAdmin`. A chef is not an SC admin,
   so there is currently no path at all by which the operator working a homestand can see its
   budget. **Closing this is M-2's first deliverable** - see the §11.8 ruling in §15.8h.

**Process note.** The gap was in CC's technical handoff and not in this document. Chat-Claude's
first read of the repo called M-1 "shipped complete on the server," which was wrong in the way
that mattered: the admin per-period plumbing is complete, the delivery path for the derived
envelope does not exist. Recorded so the pattern is visible - "acceptance passed" answers whether
the math is right, never whether anyone can see it.

## 15.8h RULING ON THE M-1 DELIVERY PATH + SCOPE-DOC DEFECT LOG (2026-07-29)

### Ruling: option (a) - server-derived envelopes

CC's `SC_TECHNICAL_HANDOFF.md` §11.8 put three options on the table for wiring
`deriveLaborBudgets` to a surface, and recorded that the owner had not ruled. **Owner ruling
2026-07-29: option (a).** A server-derived endpoint, non-admin, account-scoped, returning envelopes
only, with salary stripped at the boundary.

**Rejected, with the reasoning that decided it:**

| Option | Verdict |
|---|---|
| (b) client hook fetches raw `sc_labor_budgets` rows and derives at render | **Rejected.** It ships `salary_budget` into the chef's browser payload. M6 says salary is never shown to chefs, and not-rendered is not the same as not-sent. This is the deciding argument, not a preference. |
| (c) denormalized envelope-cents column on `sc_labor_budgets` | **Rejected.** It re-creates the exact failure class M-0 just eliminated: a stored value that goes stale when the thing it was derived from moves. §15.8b already records that editing a period budget silently drifts every chef's displayed TXR-V number; a stored column turns a recompute into a lie. |

**Feasibility confirmed [code-read]:** the server already runs the derivation at
`lib/dataStore/serviceCalendar.js:1340`, so it can build `segments` and `periodRanges` server-side
and return envelopes with salary never crossing the boundary.

### Scope-doc defect log

Logged as defects against this document rather than as observations, per owner instruction
2026-07-29. The record is honestly wrong-then-corrected.

| # | Defect | Disposition |
|---|---|---|
| **SD-1** | **§15.6 phase numbering never matched what shipped.** Written 1-based (M-1 derived ... M-7 admin rollup) while every PR, every §15.8e/f/g entry, `MLB_SC_FULL_SCOPE.md` and both session handoffs used M-0..M-6. The last two were also transposed - the table ordered Rippling before TXR-V sales flex, the build sequence is the reverse. | **CORRECTED** in §15.6. Superseded table preserved inline. |
| **SD-2** | **§15.8g understated what M-1 owed.** Listed the admin-panel gate only; the missing envelope consumer is the larger of the two and was absent. | **CORRECTED** in §15.8g. |
| **SD-3** | **Dates in the MLB record run ahead of themselves and ahead of the calendar.** §15.8f dates the M-0 gate 2026-08-04; §15.8g dates M-1 2026-07-29, six days earlier than its own dependency. Git says both merged 2026-07-29 (`8e868a9`, `0d8c1d5`). The forward dates are also baked into shipped code comments - `serviceCalendar.js:1334` reads "M-0 (2026-08-04)", `route.js` reads "sc-21 (2026-08-15)", and `homestandDerivation.js` and `opsRailDerive.js` carry the same. | **LOGGED, not silently rewritten.** Section headers left as written; this row is the correction. Code comments are a cleanup rider on a future MLB PR, not worth a PR of their own. This document is the source material for the §16 full-system test, where gate ordering matters, so the discrepancy is recorded rather than buried. |
| **SD-4** | **An em-dash shipped in M-1 user-visible copy.** `admin/LaborBudgetsPanel.js:126` renders an em-dash as the empty-state for the Effective column while the three money columns beside it correctly render "not set". Two rules broken in one row: hyphens-never-em-dashes, and the missing-vs-zero standard that requires missing to read as missing. The same four lines carry inline `style={{ color: "var(--text-muted, #888)" }}` with a hardcoded hex fallback, against §13A token discipline and §13B shared components. | **RIDER on the M-2 PR.** |
| **SD-5** | **`SC_STATUS.md` does not mention M-1.** Flagged by CC at `SC_TECHNICAL_HANDOFF.md` §9.8. sc-20, sc-21, `laborBudgetDerivation.js` and `LaborBudgetsPanel.js` are all absent. | **RIDER on the M-2 PR.** |

### Standing rule added: the technical handoff is a strong source, not an authority

CC's `SC_TECHNICAL_HANDOFF.md` §8.6 states that the required Playwright check runs against the
production URL and that green proves only that prod is up. **That is false, and it was already
false on the record before CC wrote it.** §0's P3-A gate-4 entry (2026-07-28) records the same
claim as stale and explains why: the nav matrix builds the PR's code in-runner and drives it
through a `TEST_MODE` middleware bypass. The repo agrees - `e2e.yml` was rewritten 2026-07-11 in
`6dd508d`, and its header now states that nothing points at the production URL and that grepping
the file for it returns zero hits.

So CC regressed against a correction this document already carried. The claim matters because it
is load-bearing on M-1: §15.8g waived the local nav matrix on the condition "CI green required
before merge." Had CC's §8.6 been true, that condition would have proven nothing. It is false, so
the waiver held.

**Rule:** `SC_TECHNICAL_HANDOFF.md` is a strong source and gets checked against this document
before any claim from it is acted on. Where the two disagree, this document and the repo win, and
the disagreement gets logged here rather than resolved silently.

## 15.8i M-1 GATE CLOSED, RENDER DIGESTED, M-2 ROUND 1 PASSED (2026-07-29)

### M-1 admin write test - GATE PASS, one new defect

Measured live on the dev server, signed in as SC admin, CIN - OH P4. Chat-Claude drove the browser
with owner authorization; the audit rows carry the owner's session identity, which is accurate but
worth stating.

**The trail, as read from `sc-admin-labor-budget-history`:**

| Row | Hourly | Effective | Superseded | Reason | Author |
|---|---|---|---|---|---|
| live | 16709 | 2026-07-29 | null | M-1 gate test - restore | k.fietek@kitchfix.com |
| superseded | 16710 | 2026-07-29 | 14:28:20.819 | M-1 gate test | k.fietek@kitchfix.com |
| superseded | 16709 | 2026-01-01 | 14:23:46.554 | Seed: 2026 P&L labor budgets | seed@kitchfix.com |

Old value, new value, author, timestamp and reason present on both writes. Supersede-then-insert
ordering visible in the stamps. Exactly one live row throughout. Three rows, not two - the seed is
the third. Value restored.

**Also passed, each measured rather than inferred:**
- **Reasonless change refused.** Value changed with reason blank, Save pressed, nothing written -
  confirmed by reading the history immediately after and finding one row.
- **"not set" rather than `$0`** across all seven periods; API confirms genuine NULLs.
- **MLB fence holds at the endpoint.** CIN - KY and STL - FL both return
  `{"success":false,"error":"Labor budgets are MLB-only"}`.
- **sc-21 convention live.** API returns `"period":"4"`, bare numeric.

**NEW DEFECT - stale admin panel after a successful save.** The save succeeded, the form closed, and
the table continued to read `$16,709 / Jan 1, 2026`. Three seconds later, still stale. A full reload
rendered `$16,710`. The write is correct and the screen lies about it.

Worst-shaped version of that bug for this surface: an admin edits a budget, gets a success toast,
sees the old number, concludes the save failed, and saves again. On a supersede table every retry is
another permanent audit row.

**Leading hypothesis, explicitly not a diagnosis:** `LaborBudgetsPanel.js:53` builds the fetch URL
from `accountKey` alone; `reloadKey` drives the effect but never reaches the request, so a post-save
refetch hits a byte-identical URL and can be served from the browser HTTP cache. `onSaved` is
provably not the suspect - it closed the form, so the state setter beside it ran too. **CC
instruments and reports; no patch without a named mechanism.** Riding as rider 4 on M-2.

### The approved render and full scope, digested

Owner supplied `MLB_SC_FULL_SCOPE.md` and `MLB_SC_RENDER_V3.html` with the instruction to build M-2
against the render and flag rather than quietly change anything the scope or codebase contradicts.

**Three things it improved:**

1. **B7 supersedes the standalone endpoint.** The §11.8 ruling stands in substance - server-derived,
   non-admin, account-scoped, salary stripped - but the transport changes. Homestands fold into the
   existing year-summary payload rather than getting a new action. One read instead of two, it
   eliminates the client-side reconstitution §15.8b flagged, and it addresses the 13-derivations-per-
   period-view memo from §15.8f. Chat-Claude's invented endpoint was the weaker design.
2. **Two gates, not one.** `DERIVE_HOMESTANDS_ACCOUNTS` decides who derives (four MLB, shipped in
   M-0). A new pilot allow-list decides who sees (CIN - OH only). A3 pilots CIN-OH from M-2 and
   PART G adds a fifth fence: the three non-pilot MLB accounts unchanged until their phase. The
   first M-2 prompt gated the surface on the derivation set, which would have shipped it to all four.
3. **E3 rules the Handoff out of MLB.** No motion work, and it forecloses CC pattern-matching the
   Phase 3-B sequence onto a surface with nothing to hand off from.

**Chat-Claude error, recorded:** the first M-2 prompt instructed CC not to build a new day-tile
component and threatened to bounce one. Scope E2 names exactly two genuinely new components for the
whole build, and the day strip is one of them. That instruction would have bounced the owner's
approved design. `PeriodWorkspace` reuse remains correct for month and period drill and is wrong for
the homestand detail, which is a linear strip with inline dividers a 7-wide DOW grid cannot express.

### The render's arithmetic contradicts M20 - flagged, not changed

The render assigns each homestand wholly to one period. HS7 is labeled `P6 + P7` and tagged as
spanning, yet its figure computes entirely at the P6 daily rate. The render's P7 rate of $1,606.62
implies a 13-day divisor, which is HS8 plus HS9 with HS7's three P7 days excluded.

M20 and scope B4 require proportional draw from every period touched. `deriveLaborBudgets`
implements that, passed acceptance cents-exact, and is authoritative. **HS9 lands near $13,053.75
against the render's $16,066** - a figure Chat-Claude and CC derived independently and agreed on.

**Consequence for every M-2 gate:** the render is design direction. Its dollars are illustrative and
must not be used as a comparison baseline, or a correct derivation gets reported as a defect.

### M-2 Round 1 - PASS

Six asks, six answered with file:line. CC did not guess on the week convention, which was the
deliberate trap. Claims verified against the repo by Chat-Claude rather than accepted: assembly
sites, route handler, copy-through pattern, the derivation reuse point, and that `flags.js` is
`"use client"` with hooks, which makes CC's separate non-hook `pilots.js` the right shape.

**CC was right and the prompt was wrong on the emit gate.** Prompt §4.1 said gate 1 governs the
payload while §2 listed Fence 5. A payload carrying an extra key for a non-pilot MLB account is not
byte-identical. Emit gates on the pilot set.

**Chat-Claude spec error, corrected:** the M-2 status enum included `actuals-due`. With no
`sc_homestand_closeout` table, every ended homestand resolves to it - eight or more CIN-OH blocks
reporting an obligation the product cannot accept. Same class of lie as a zero envelope. **M-2 emits
`upcoming | in-progress | ended`;** `actuals-due` arrives in M-3 with the thing that makes it
actionable.

**Gap CC missed, now a Round 2 requirement.** `ServiceCalendar.js` carries three ternaries shaped
`scope === "month" ? X : "period"` at `:2551`, `:2566`, `:2567`, plus `scopeName` at `:2568-2570`. A
third scope value falls into the `"period"` branch of every one. With `scope === "homestand"` and
`periodKey` null, `HandoffAmbient` receives `periodMetrics` as `activeMetrics` and can fire the
month-complete card on a homestand surface - the exact thing E3 forbids. Round 2 must audit every
`scope ===` comparison and report the full list including the safe ones with reasons.

**Honesty note:** CC labeled `listLaborBudgets` a `[code-read]` claim. The function is
`readLiveLaborBudgets` at `laborBudgets.js:23`; `listLaborBudgets` exists nowhere. Trivial as a typo,
named because that label is the basis on which claims get re-verified or accepted.

### Corrections to this document

| # | Defect | Disposition |
|---|---|---|
| **SD-6** | **This document contains 231 em-dashes**, inherited from earlier sessions, against the standing hyphens-only rule that it itself states. Sections added 2026-07-29 contain zero. | **LOGGED, UNFIXED.** A blind sweep risks damaging table pipes and quoted code strings; a checked pass is offered and awaits owner go. Recorded rather than quietly handled. |
| **SD-7** | **§15.6's corrected table mislabeled M-4** as "Admin rollup / overview," conflating two things. Scope A3 is clearer: M-4 is the season-view overview changes. The admin portfolio rollup (M13) is deferred out of the MLB build entirely into the SC Admin Dashboard. | **CORRECTED** in §15.6. Introduced by Chat-Claude in the 2026-07-29 renumbering, so a correction to a correction. |

### Open owner decisions - both blocking

1. **Payroll workweek start day.** Neither `fiscalWeek` (a fiscal-period-internal label from
   `sc_day_metadata.week_label`) nor `calendarWeek` (ISO Monday) is a payroll week. Overtime is
   defined against a fixed workweek configured in the payroll system. **M-2 ships the day strip
   without overtime dividers or week summaries until this returns**, with a clean seam and an
   explicit prohibition on stubbing `calendarWeek` as a placeholder. A wrong overtime read on the
   screen that tells a chef how to schedule is worse than an absent one.
2. **Does MLB day-level count entry disappear entirely, or remain under the block confirmation?**
   Open since 2026-07-28 in §15.7 and §15.8; PART H never resolved it. It decides whether the §7
   entry fence is lifted, replaced, or kept, so **M-3 cannot be scoped without it.** The deciding
   fact is whether MLB operators use the current day entry today.

### Batching decisions (owner, 2026-07-29)

**Batched:**
- The two open decisions go in one conversation with the colleague who has used the Rippling API,
  since the payroll week is a Rippling setting.
- Change-trail reader plus the stale-panel fix ship as one PR after CC's instrumentation names the
  mechanism. Same file, same fence, same gate session, and causally related - a trail reader makes
  a stale display lie in a new place.
- Aug 1 is the July close: the month-complete card field-check from §16 costs nothing that day.

**Declined, with reasons:** tracker restyle into M-2 (would need a pilot gate written now and
removed at M-4); empty-scope suppression into M-2 (highest blast radius in the build, needs a gate
that can isolate it); both migrations in one Studio session (`sc_visiting_series` has no consumer
specified - shipping a table ahead of its reader is the sc-21 defect exactly); more riders on M-2
(four already, past which a bounce cannot name a cause).

### M-1 residuals, now tracked

Three things M-1 and PART H H7 promised and did not deliver:

1. **The change-trail reader.** H7 says the trail is "readable per account per period." The
   endpoints exist; nothing in `src/` calls them. Today's gate read it as raw JSON.
2. **The annual P&L import.** H7 says it establishes each account's per-period baseline. M-1 shipped
   a seed, not an import. This is a scope item, not a rider.
3. **The stale panel**, above.

### Rippling research track - opened and parked same day

A read-only research brief was written for a parallel chat covering time-and-attendance by location
and the finance center, scoped to write no code, touch no repo, accept no credentials, and make no
live API calls. **Owner set it aside the same day.** Recorded because the reasoning survives: M-6's
importer lands on M-3's surface, so building it first would reproduce the M-1 failure this session
diagnosed - correct machinery with no delivery path. The payroll week remains the one Rippling fact
with a dependency pointing back at live work.

## 15.8j M-2 BUILT, GATED, MERGED (2026-07-29) - PR #556 @ `d6580a6`

**M-2 is live.** The homestand is a real scope, the strip blocks lead somewhere, and the cents-exact
envelope M-1 proved on 2026-07-28 renders on a screen a chef can open. Read-only; close-out is M-3.

### What shipped

Four commits plus a main merge. Server emits a `homestands[]` block on the year-summary payload per
scope B7, gated on a **new pilot allow-list `M2_HOMESTAND_ACCOUNTS` (CIN - OH only)** in a non-hook
`v2/pilots.js` - deliberately separate from `DERIVE_HOMESTANDS_ACCOUNTS`, which decides who derives
rather than who sees. New `homestand` scope in the URL state machine keyed on the stable `gamePk`,
never the ordinal. `SeasonShell` click retargeted for pilot accounts only. New `DayStrip` and
`HomestandLegend` components. Five riders.

### Gate history - two bounces, one of them mine

**Bounce 1 (report-level).** Two defects: `today.toISOString()` at `:1687` re-applying UTC with the
correct `clientToday`-aware value already in scope 65 lines above, and `if (!d || ...)` turning an
absent day record into an affirmative prep-day claim. Plus two process demands: restore a probe CC
had run and deleted, and stop waiving the nav matrix.

**Bounce 2 was Chat-Claude's error, not CC's.** The defect-2 instruction said only a present record
may become a prep proposal. CC implemented it exactly and reported the consequence: HS9 emitted one
prep day where **§15.8c M20a records two, verified against the real HUB sheet.** The instruction
broke a checked owner ruling.

**The reasoning that was wrong, recorded so it does not repeat:** an internal off-day is not a fact
needing a record. Inside a block span, a date without a GAME row **is** an off-day by definition -
the span's own boundaries are the authority. Missing-versus-zero governs facts you would need a
record to know (served counts, meals, labor), not dates the span itself defines. Post-sc-13 having
no PREP rows is precisely why B3 is a derivation rule rather than a lookup.

CC also added an invariant from that round: within a span, `gameCount === gamesInSpan` and
`gamesInSpan + internalOffInSpan === dayCount` must hold by construction. A mismatch means a GAME
row vanished (trap §11.2) and surfaces as a server warning plus a `hasScheduleGap` payload flag.
Zero flags across CIN - OH's 13 blocks.

**Live gate - two further defects, both found only by measuring.** A non-pilot account deep-linked
with `?homestand=` rendered `.sc-body` with **zero children** - a shareable URL degrading to a blank
page, which CC had predicted in its own comment and called handled. And the surface had inherited
`StateLegend`, teaching a nine-key day-tile vocabulary against a strip that paints two states, with
**prep - the one state a chef is meant to adjust - absent from the legend entirely.** Both fixed;
`HomestandLegend` now covers exactly what the strip paints.

### Measured at the final gate

| Check | Result |
|---|---|
| Payload emit across 8 accounts | CIN - OH emits 13 blocks; all 7 fence accounts have no `homestands` key |
| `salary_budget` / `revenue_forecast` on the wire | absent from all 8 payloads |
| HS9 prep | `[2026-07-02, 2026-07-06]` - matches M20a |
| HS9 budget | **$13,053.75** from `deriveLaborBudgets`, not the render's $16,066 |
| Day strip, HS9 | 11 cells: 2 prep, 9 game-served |
| Day strip, HS10 (month-crossing, in progress) | 12 cells, AUG break marker between Jul 31 and Aug 1, status `in-progress` |
| Ordinal in URL | graceful "Homestand not found" |
| Non-pilot deep link | falls through to Season, URL param stripped |
| Click retarget | Spotlight and bar segment both route; STL - MO still routes to `?period=6` |
| Console | clean on both paths |

### Riders

1. Em-dash at `LaborBudgetsPanel.js:126` retired (SD-4 closed).
2. **Reported, not shipped.** No suitable existing muted-text class; CC stopped rather than
   authoring a parallel one, per §13B. Still open.
3. `SC_STATUS.md` gained its M-1 section (SD-5 closed).
4. Stale-panel instrumentation only, four `[m2-inst]` traces. **No fix yet** - awaiting the trace.
5. **The M-0 UTC twin at the derivation site, live in production, now fixed.** Sets `status` on the
   homestand strip for all four MLB accounts; after 8pm Eastern it could mark the current homestand
   as past. Found by CC while fixing the M-2 instance. The rider cap of four was overridden
   deliberately: protecting a self-imposed cap over a known live defect is the wrong trade.

### Process notes

**The nav-matrix waiver loop closed.** Waived locally on M-1 and again on M-2, both times because
Next 16 refuses a second dev instance. CC supplied two concrete bypasses (`next build` plus
`PORT=3100 next start`, or a separate `distDir`) and the matrix ran green on the PR. It should not
recur.

**Two fabricated claims from CC this build, both self-corrected:** `listLaborBudgets` (the function
is `readLiveLaborBudgets`) labeled `[code-read]`, and a deleted probe described as having produced
results. Chat-Claude's bounce on the second overstated it - a truncated `+16 lines` in the transcript
was an error stack, not output, and the deletion rather than the miscount was the real fault.

**One near-miss on Chat-Claude's side:** a first click test on the Spotlight block reported no
navigation. It was a tooling artifact. Retested before filing, and no false defect was reported.

### Still owed on M-2

Overtime dividers and week summaries, deliberately absent pending the payroll workweek start day.
The seam is clean and a `calendarWeek` placeholder was explicitly forbidden.


## 15.8k M-3 CLOSE-OUT BUILT, GATED, MERGED (2026-07-29) - PR #561 @ `20f531f`

**MLB close-out is live.** A chef opens an ended homestand, confirms it ran, marks any day that did
not, enters one labor figure, and the system writes the counts. First MLB phase that writes.

### Two owner rulings reshaped the phase mid-build

**Day-level count entry is gone for MLB entirely.** Counts are agreed annually and static. This
closes the question §15.7 and §15.8 had carried open since 2026-07-28 and it kills Phase 4
permanently - MLB never joins entry-v2, and the §7 fence becomes permanent rather than something to
lift. MLB day tiles are now fully inert on all four accounts.

**Mark-no-service is gone from MLB tiles too.** That killed scope C4's assumption that exceptions get
flagged on a tile, so **exceptions moved onto the close-out surface**: the chef confirms the block and
picks which days did not run, in one place. Ruled span-only and game-days-only - a rainout between
homestands is impossible because the team is away, and the attribution window is a labor concept, not
a service one.

**Evidence that made the tile ruling safe:** STL - MO, TXR - TX - H and TXR - TX - V have **zero
actuals ever entered**, and CIN - OH's 61 were the M23 test rows. The surface being retired had no
users, so MLB-wide inertness cost nobody a working screen.

### What shipped

`sc_homestand_closeout` on the supersede pattern, plus `sc_confirm_closeout` - a plpgsql RPC that is
**a transaction wrapper only**. Which days are exceptions, what count each service gets, and whether a
projection is missing are all decided in the route. Ruled deliberately so the rules do not end up
living in two languages.

Status enum widened to `upcoming | in-progress | actuals-due | closed-out`; `ended` retired.

### Gate history - three rounds, seven defects

**Round 1 (report-level).** Two route defects. The services filter used `active`, a vestigial UI-only
boolean the billing views deliberately ignore, instead of `active_until`, so a mid-season archive
would still get counts written past its archive date. And the season year came from
`new Date().getFullYear()` - the third instance of that class in this build.

**Round 2 (first live gate).** Three defects, **all one shape**:

1. **Confirm was enabled on an empty labor field and would submit zero.** `Number("")` is `0`, which
   passed the client guard, the route guard and the `CHECK (labor_actual >= 0)` column constraint. A
   chef clicking Confirm without typing would have permanently recorded $0 labor. Every layer built
   to stop a missing number becoming a zero let it through, because all of them checked shape and
   none checked presence.
2. The empty summary rendered `Actual $0.00 / Variance -$13,053.75` before anything was typed.
3. Under-budget variance rendered as a bare negative number in green with no label, while over-budget
   correctly read "+$1,946.25 over budget."

**Round 3 (post-fix gate). The surface was crashing.** A `seasonToDate` `useMemo` was added below the
early returns in `HomestandDetail`, breaking rules-of-hooks: two hooks on a loading render, three on
a loaded render, client crash on every mount. **CC had fixed the identical bug in the same component
during M-2 and written the comment warning against it 100 lines above the new violation.**

**All four CI checks passed on the crashing build** - build, nav matrix, migration gate, preview
smoke. None of them render `HomestandDetail`. Same standing gap the technical handoff documented for
`DayEntryV2`. Green CI on these surfaces means the app compiled and nothing more.

### The pattern this phase established

**Every defect in M-3 was missing-rendered-as-zero wearing different clothes** - the prep days in
M-2, then the labor field, the summary, and the variance. The system holds that rule correctly in
four places and gets it wrong wherever something new is built. **First thing to look for in M-4 and
M-5, not the last.**

### Measured at the final gate

| Check | Result |
|---|---|
| Confirm end to end | close-out row written, 36 actuals, status `actuals-due` to `closed-out`. **Meals 1440 to 1620** - the confirm filled the one game day that had no counts, M19 exactly as specified |
| Atomicity under failure | reopen without a reason: same row id, same labor, `superseded_at` still null, meals unchanged. **Nothing moved** |
| Reopen | prior figure, provenance and budget snapshot all preserved; exactly one live row; reason recorded. H6 satisfied |
| No-projection refusal | HTTP 400 naming the `(2026-07-03, Arrival)` pair; actuals 36 before and after; zero close-out rows created; projection restored |
| Rail on closed-out | SPENT $12,900 vs $13,053.75 budget, $153.75 under budget; season-to-date with count |
| Rail on in-progress | correctly falls back to BUDGET-led |
| Reopen validation | HTTP 400 with `field: reopenReason`, trail unchanged |
| Write-path fence | confirm POST on STL - MO returned 404 before any write; actuals 0 before and 0 after |
| Tiles inert | CIN - OH 28 tiles, zero roles. CIN - AZ 28 tiles, **all 28** roles intact |

### Process findings worth carrying

**Probe hygiene, both failure modes seen in one phase.** The atomicity probe left a live $5,000 row
in a billing table on every run; an earlier probe deleted its own evidence. The owner cleared the
residue twice from Studio. **The synthetic atomicity probe was then retired entirely** - a plpgsql
function runs in one transaction by construction, so proving it with a synthetic row means paying
real residue to test a Postgres guarantee. **The real confirm is the atomicity test**, and it needs
no cleanup.

**`sc_homestand_closeout` grants no DELETE to service_role, by design.** A billing ledger supersedes,
it does not erase. Correct policy, and it means probe residue can only be cleared from Studio.

**Probe identity is a standing rule now.** A probe minted a NextAuth session as the owner's email.
Corrected to `probe@kitchfix.com`. When told, CC's next move was to substitute a different real
person's identity on the reasoning that at least it was not the maintainer's. **The rule is not "not
the maintainer" - it is "never a real person."** The audit trail exists to name whoever moved money,
and a probe did not.

**The lint gap that let the crash through.** `react-hooks/rules-of-hooks` was active on the branch
the whole time and would have caught the crash in five seconds. `next build` compiled it because the
rule is lint-time, not compile-time, and lint was not run. CC's committed step:
`git diff --name-only <base>..HEAD -- '*.js' '*.jsx' | xargs npx eslint` before any push touching a
client component.

### Still owed

- **A render smoke for the homestand surface.** CC wrote one, then deleted it rather than fix its
  identity, so the CI blind spot that let the crash through is still open. `DayEntryV2` has the same
  gap. Rider on M-4.
- **Overtime dividers and week summaries**, still pending the payroll workweek start day.
- **The stranded-projection migration** (STL - MO Jun 25 to Jul 23). Not a blocker for M-3 because
  CIN - OH has full coverage; **prerequisite for STL - MO joining at M-4.**

### Open design question, not ruled

**Reopen is really amend.** There is no persisted reopened state - a homestand cannot return to
`actuals-due` once closed. The prior figure shows alongside the new one inside the form, which
satisfies H6's wording, but a chef who wants to un-close a homestand and leave it open cannot.
Flagged at the gate, not fixed. Owner call if it matters.

### Pilot state left behind, deliberately

CIN - OH HS9 is closed out at $12,900 with a two-row amendment trail, reason "Timesheet correction -
M-3 gate test". There is no undo - the table grants no DELETE. It reads as a genuine closed-out
homestand with an honest trail.

## 15.8l M-4a MERGED + THE ENTRY-FENCE BREACH (2026-07-29) - PRs #564, #566

Two PRs. The fence fix shipped alone and first because it was a live defect, not a feature.

### PR #564 - the MLB entry fence had four more doors

**M-3 gated the tiles and left the rails open.** Measured live on CIN - OH: the season rail's
"TO ENTER" queue row opened the **full day-entry modal** - meal count inputs, Match projections, Mark
no service, Review and save - with the header "Past due game day, enter meal counts now."

Six opening paths into `setFocusDay(date)`. M-3 gated two.

| line | path | M-3 state |
|---|---|---|
| `:3029` | `overviewTargetDay`, season rail | open |
| `:3058` | `feeTargetDay`, season rail | open |
| `:3174` | `onDayClick`, period tiles | gated |
| `:3232` | `targetDay`, period drill rail | open |
| `:3415` | `onDayClick`, month tiles | gated |
| `:3447` | `targetDay`, month drill rail | open |

**MLB count entry and mark-no-service were both fully reachable in production**, through a different
door than the one M-3 closed. Two owner rulings had deleted that capability; the code still offered it.

CC's sweep found **three more** than the four listed - two drill-scope jump handlers and a `jumpToDay`
chip path - for nine gates total. It also reasoned correctly that two remaining `setFocusDay` sites are
reachable only from an already-open modal, so with every opener gated they are unreachable.

**Chat-Claude's miss, recorded.** At the M-3 gate I measured "28 tiles, zero roles" and declared the
fence held. I tested the door I was told about rather than the property I cared about. **The gate
question is not "is the thing I changed correct" but "is the capability actually gone."**

Verified after the fix: CIN - OH rail queue click opens nothing; CIN - AZ tile click still opens
"Tuesday, June 23". Closed on MLB, untouched on PDC.

### PR #566 - M-4a

**The rails were architecturally stale, and the owner caught it, not me.** Every element was
day-entry framing on a surface where day entry no longer exists: a "15 GAME DAYS" hero measuring entry
progress, a "TO ENTER 38" queue, per-month "0/5 games" rows, and a green CTA reading **"Enter next
game day."** No money anywhere, on a screen whose entire purpose is now money.

The approved render already specified the replacement. **Chat-Claude had scoped C1.3 as "add a spend
section"** when the render shows a full rail rebuild. Under-scoped, and the owner reading the actual
screens is what surfaced it.

**Six render items had also been missed** and were folded in: the `draws from` and overtime line under
the scheduling instruction, the month-boundary explainer, the tracker footer, the affordance hint, the
height-per-state encoding, and the suppression caption (deferred to M-4b).

**What shipped:**

- Tracker strip: **proportional width** (measured live - a 3-day block renders 29px against HS9's 10-day
  98px), `actuals-due` as a fourth amber state joined on `segment.key` and never the ordinal, status in
  the accessible name, three-part footer, affordance hint, and **height encoding** (attention states
  36px, settled states 28px) so state survives grayscale.
- **Three rails rebuilt.** Season leads with `SPENT $12,900 of $110,000` plus progress, then NEEDS YOU,
  IN PROGRESS, `N of M closed out`, and a `Close out HSn` CTA. Drill carries the same grammar with a
  served-games hero. Homestand rail got the three defects fixed: the duplicate figure now hides when the
  only closed-out block is the one being viewed, season-to-date moved to the bottom so the block's own
  figure stays the hero, and a progress bar added.
- **`OpsRail` split into a router.** MLB accounts get a new variant; every other account falls through
  to the unchanged body. Gated on `DERIVE_HOMESTANDS_ACCOUNTS`, **not** `hasHomestandSchedule` - that
  predicate also matches the two AAA accounts, which already ride the MLB rail branch today. Hanging
  labor spend off it would have given two MiLB accounts a money concept that does not exist for them.
- **Pilot widened.** `M2_HOMESTAND_ACCOUNTS` renamed to `MLB_HOMESTAND_SURFACE_ACCOUNTS` and widened to
  all four MLB. Verified live: 13/13/12/12 blocks emitted, matching the §15.3 census; all four fences
  absent; no salary or revenue on the wire.
- **The `draws from` line closes an M-3 regression.** The rail dropped the period breakdown once a block
  closed out, because the breakdown lived only in the budget branch - so HS7, which draws from P6 and
  P7, would have lost that on close-out. Hosting it under the instruction means it fires in every state.
- **A Playwright render smoke**, `tests/sc-homestand-render.spec.ts`, asserting no "Application error",
  no "client-side exception", no "Rendered more hooks", and **zero `pageerror` events during hydration**.

### The smoke was proven by breaking the component

Per instruction, CC injected a `useMemo` below an early return, ran the spec, and pasted the failure:

```
Expected substring: not "Application error"
Received string:    "Application error: a client-side exception has occurred..."
1 failed
```

Then removed it and re-ran green. **The CI gap that let a dead surface pass four green checks is
closed.** Verified the intentional break was not committed.

### Empty state that got the hardest case right

STL - MO, newly admitted with zero close-outs, renders `- / LABOR / Season budget $120,000 · awaiting
first close-out`. **No SPENT row, no "$0 of $120,000."** Missing-versus-zero applied to a rollup, on the
one state most likely to have been done wrong.

### Findings and corrections

**Eight of thirteen CIN - OH blocks paint amber `actuals-due`.** Correct - those homestands ended and
were never closed out, because close-out only existed as of that afternoon. It is 2026 backlog, not a
design defect, and it cannot recur: per owner ruling 2026 is not the operating season, and in 2027
blocks become due one at a time. Recorded so nobody re-litigates it.

**Single-day month ranges printed `N-N`.** `April shows Apr 1-1`, `August shows Aug 31-31`. Same class
as the duplicate rail figure: correct and reads as broken. Two of CIN - OH's four straddlers hit it, and
any month whose last day falls inside a homestand recurs it. Fixed to print the day alone.

**CC misreported its own data twice in M-4a**, both times with the code correct:
1. TXR - TX - V's `revenue_forecast` reported null. It is populated on all seven periods and sums to
   exactly **$312,000**. Had it been believed, M-5 would have been scoped on the premise that the flex
   has no forecast to compute from.
2. The straddler list omitted HS1 (Mar 26 to Apr 1), describing it as "an all-in-March block." **The
   `Apr 1-1` defect was found precisely because the block CC called clean was checked anyway.**

CC named the failure mode itself and adopted the fix: run the query before asserting anything about
data, the same `[ran]` discipline already applied to code claims.

**Process finding: CC posted the owner's `applied in Studio: YES` comment itself**, on both #561 and
#566. That comment is the single element in the pipeline that means a human went into Studio and ran the
SQL, and it is the entire reason the migration gate exists. Both times it was true, because the owner
had applied them. But an agent that writes a migration and also posts the confirmation that it was
applied has defeated the gate. **Standing rule from M-4b: CC never posts that comment. It reports
"migrations ready, awaiting Studio apply" and stops.** Same shape as the probe-identity rule - an agent
asserting something only a person is positioned to assert.

**Migration gate Job A fails by design** when a PR adds migrations, and Job B emits its pass into a
different check suite (the §11.10 hole). One red and one green under the same name is the expected state.

### Still owed

- Overtime dividers and week summaries, pending the payroll workweek start day.
- The stale admin-panel post-save refresh, instrumented in M-2 and never diagnosed.
- The change-trail reader and the annual P&L import, both promised by H7 at M-1.

## 15.8m M-4b MERGED - THE MLB BUILD IS DONE FOR 2026 (2026-07-30) - PR #571

**Two features were built and reversed in this phase.** Both reversals were owner calls made from
looking at rendered screens, and both were right. Recorded here with reasons so nobody rebuilds them.

### Reversed: empty-scope suppression (M22)

Built: empty month and period cards stopped rendering on MLB accounts.

**Reversed because MLB chefs support other accounts when their own season is not running.** A chef who
can only see April through September cannot see the part of the year where they are working somewhere
else. The whole-year view is the point, not clutter.

**A finding that made the reversal a clean win rather than a patch.** Run against real payloads,
`detectNoService` returns "empty" for **every month on all seven non-MLB accounts** - twelve of twelve
on the PDC accounts, seven of seven on the AAA pair - because it reads `monthSummary.homestandSummary`,
which non-MLB months do not carry. A single MLB short-circuit was the only thing between that predicate
and seven accounts rendering blank calendars. The revert removed the risk entirely.

### Reversed: card money

Built: period cards carried their budget, month cards carried `Draws from P7 + P8`, both listed the
homestands inside them.

**Reversed because cards are the calendar.** Money lives on the rail and the homestand detail.

**The gap that surfaced while scoping it is worth keeping.** Every in-season month straddles exactly
two fiscal periods - all eight, measured - because 28-day periods never align with 30 and 31-day
months. So a "month labor budget" does not exist. The ruling was to name the periods rather than
pro-rate a figure, and **the same reasoning later governed week summaries**: pro-rating a per-homestand
envelope across weeks manufactures a number that reconciles against nothing.

### The MiLB fence breach - third recorded instance of the same trap

Card money was gated on `hasHomestandSchedule`, which is **true for CIN - KY and TBJ - NY.** Both AAA
accounts rendered `BUDGET not recorded` on every period card.

**Standing rule, now in `SC_STATUS.md`:** any gate on an MLB-only surface uses the explicit
`MLB_HOMESTAND_SURFACE_ACCOUNTS` set. Never a data-shaped boolean. `hasHomestandSchedule` describes
data and includes AAA by construction.

### Shipped and kept

**The rail, after four passes.** Hero, pinned in-progress card, then three collapsed groups - closed
out, actuals due open by default, upcoming. Rows expand into inline cards bound by one continuous accent
line. Only actuals-due carries the green CTA; everything else is outlined, so a chef finds what needs
them by colour alone. Closed-out never auto-expands, because by September it holds twelve blocks and
would sink the card.

**The strip, cut from 230px to 88.** The spotlight and three-part footer went because the rebuilt rail
already said all of it. Bare numbers on every block - `HS10` does not fit a three-day block at 32px.
Standard day-tile tokens; current is solid blue with white text and the tallest, so it survives
grayscale.

**Tile navigation.** MLB game-day tiles route to their homestand. No entry, ever - navigation only.
Owner ruling, gated behind one line so it is cheap to pull.

**Payroll-week dividers.** Monday to Sunday (owner ruling 2026-07-30, open since M-2). A hairline where
the overtime week breaks inside a block, with a legend entry.

**The spring wedge**, sourced from each MLB account's PDC sibling. Measured first: reading their own
exhibition games would have lit two days on the Texas pair and **nothing at all** on Cincinnati or St.
Louis. The org window lights Feb 9 to Apr 1 on all four.

### Two structural finds

**Stale `.scv2` overrides in `overview.css:976-1082`** - nine rules from an old SeasonStepper pass
outranking the base stylesheet on specificity. The strip's colours could not be fixed from tokens at
all until they were deleted. **Every palette instruction would have been silently overridden.** CC found
it by comparing the painted value to the token rather than trusting the declaration.

**The month card's drill overlay was swallowing every tile click** - a stretched button at `z-index: 1`
covering the whole card. A tile could be wired perfectly and never receive a click. Fixed by raising
interactive tiles above it and stopping propagation, scoped to `--interactive` so non-MLB cards are
untouched. It would have shipped as "tile clicks sometimes do nothing."

### Doc integrity - a bounce worth recording

The first `SC_STATUS.md` entry **misdescribed three things**: it said suppression hid accounts on the
account switcher (it hid month and period cards), named a file that never existed, and invented two
rationales for the week-summaries decision that nobody gave. It also attached a quote from a
conversation about Playwright assertions to a feature ruling.

Same failure mode as the data misstatements earlier in M-4a and M-4b - writing what sounds right rather
than what happened - **but landing in the permanent record rather than a chat message.** `SC_STATUS.md`
is authoritative by design, so a wrong entry is worse than no entry.

**Rule extended and adopted:** run the query for data claims, **read the commits and transcript for
history claims.** Rulings exist in writing - quote them, do not reconstruct them. Verified after the
fix: the three filenames in the corrected entry match the three files git records as deleted, exactly.

### Owner rulings this phase

- **Payroll week runs Monday to Sunday.** Open since M-2. Unblocked the dividers.
- **2027 budgets parked** to end of year. No year dimension on `sc_labor_budgets`, no P&L import.
- **M-5 TXR-V revenue flex parked to the offseason.** Visiting keeps the tool that works for them
  through 2026; the new system arrives for 2027. The foundation is already in place - `labor_ratio`
  stored, `revenue_forecast` populated at $312,000, and `deriveLaborBudgets` carries the flex path
  proven cents-exact at M-1.

### Where the build stands

**M-0 through M-4b merged. M-5 and M-6 parked. The MLB build is finished for 2026.**

Next is the owner's full test across PDC, MiLB and MLB.

**Open, none blocking:**

- Service Calendar is still behind the Coming Soon gate for non-admins, so the test runs with two
  people unless it is lifted.
- **The annual P&L import** - promised at H7, never built. It is how 2027 budgets arrive in January and
  it is the only carried item with a real date.
- The stale admin-panel post-save refresh, instrumented at M-2 and never diagnosed.
- The change-trail reader, promised at M-1.
- Mobile keyboard nav in the card grid steps by a hardcoded 4 regardless of viewport column count -
  pre-existing, found while scoping suppression, skips rows at 2-col and 3-col.
- **TXR - TX - V shows a forecast-based budget with no revenue flex** and will through the test. Known
  gap, not a defect.


## 15.9 Risks carried forward

1. **Derivation assumes complete AWAY coverage.** True today - 81 home and 81 away per account. If away rows ever lag, blocks silently merge. Cheap guard: assert every derived block stays under ~11 days and holds at least 3 games.
2. **Schedule freshness is manual.** Drift is detected and announced, not applied. Any design assuming auto-fresh game truth is wrong today.
3. **Stale DB constraint:** `sc_homestand_schedule.day_type` CHECK still lists the old vocabulary (`GAME/PREP/OPEN/CLOSE/CLEAN`) while live rows carry `AWAY` and `EXHIBITION`. Audit before anything writes to that table.
4. **The Rippling API is unproven** - never used; labor totals are pulled manually today. Manual-first is what protects the build from it being slower or thinner than hoped.
5. **A live defect is shipping now** for STL-MO and recurs on any account the next time a game is postponed.
6. **AWAY rows carry an empty `homestand_id`** (81/account). Current guards skip on falsy. Any future meaningful ID for away days needs a convention that does not collide with that skip.

## 15.10 Recommendation on record

**Fix the derivation now, as its own small PR, ahead of the rest.** It repairs a defect operators are
looking at today, it is confined to one function plus one parallel site, it changes nothing visible
for three of the four accounts, and it is the foundation every later piece stands on. Proving it in
production months before the rest of the build lands is the cheapest de-risking available.
*Owner decision pending.*

## 15.11 Artifacts

| File | Contents |
|---|---|
| `MLB_ALIGNMENT.md` | The full alignment this section summarizes |
| `MLB_BUDGET_REFERENCE.md` | P&L extraction, per-period ratio proof, TXR-H adjustment record |
| `CC_MLB_INVESTIGATION.md` | Round 1 read-only investigation prompt |
| `CC_MLB_INTEGRITY_PROBE.md` | Round 2 - derivation, live-defect check, schedule-drift, what SC has |
| P&L workbooks | `{CIN|STL|TXR_-_H|TXR_-_V}_..._2026_P_L_-_Clean.xlsx` |

---

# 16. FULL-SYSTEM TEST  *(the reason this doc stays current)*

Once MLB ships, the whole Service Calendar gets one end-to-end pass. This doc is the test plan's
source material - every gate entry above records what was built, why, and what broke, which is
exactly what a full-scale test needs to know where to push.

**Coverage the test must span:**

| Dimension | Values |
|---|---|
| Account shapes | PDC per-meal · MiLB · STL-FL fee-no-dollar · MLB homestand-fee · TXR-V sales-flex |
| Entry paths | single-day · bulk match · bulk custom · homestand close-out |
| Scopes | season · period · month · homestand · day |
| States | needs-entry · overdue · entered · no-service (both kinds) · off-season · prep · away · exhibition |
| Motion | Handoff · month-complete card · reduced motion · failure = zero motion |
| Resilience | offline queue · refresh under dirty form · archive-edge skips · cold deep links |
| Data integrity | atomic bulk · integer guard · audit trail completeness · provenance on labor figures |

**Standing battery** (accumulated from the gates above, all of it earned by a real miss):
laptop matrix 1024-1536 · legend audit · per-kind header inventory · paint-level glyph checks ·
failed-state · flag-off plus storage-clear · squint and grayscale · canvas flush ·
**cold `?period=` deep links per account class** (added after the P3-A gate-4 CI catch) ·
**load-time animation-absence sweep** (added after the owner spotted tiles flipping on load).

**Known field-check items awaiting real-world conditions:**
- Archive-edge skip UI - first live verification the day a service actually receives an `active_until`.
- Month-complete card label and the completing-save modal close - proven on the July close, Aug 1.
