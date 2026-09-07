# LOADING UNIFICATION - PRE-BUILD REPORT

**2026-09-08 · #1047 merged, this report is the ONLY output of the first pass · no code changed.**

Kevin's instrumentation on production found in-page nav is single-state (clean), but every mount path is 3-5 states with two treatments visible simultaneously. This report answers the four questions from the prompt in order.

---

## 1. Every loading treatment that exists, app-wide

### Service Calendar (this session's deep-dive)

| Treatment | File:Line | Trigger | Introduced |
|---|---|---|---|
| Full-page `.oh-spinner` + "Loading Service Calendar..." | `src/app/service-calendar/page.js:186` | `status === "loading"` (NextAuth session hydration) | pre-migration |
| `SkeletonSurface` (structural shimmer, 21 tiles + rail) | `src/app/service-calendar/ServiceCalendar.js:3615` | `isAccountLoading && !isAdminView` | SC cleanup item 4, 2026-09-03 |
| `Ribbon` per-stat shimmer bars (`.sc-skel-shimmer .sc-skel-bar-ribbon`) | `src/app/service-calendar/v2/Ribbon.js:207` | `isLoading={isAccountLoading}` at parent | v2 ribbon landing |
| `PeriodHeaderNav` chrome-bar `.sc-chrome-drill-skel` bar | `src/app/service-calendar/season/PeriodHeaderNav.js:98` | `isLoading` prop (periodRanges/monthRange missing) | drill nav |
| `WorkspaceSkeleton` (grid frame + hero + 28 tiles, two variants: block + inline) | `src/app/service-calendar/season/PeriodWorkspace.js:375, 381, 1751-1762` | `loading && !periodDays && !partialError && loadState !== "failed"` | PR-B2a workspace |
| `PeriodCard` "failed" atom cascade | `src/app/service-calendar/season/PeriodCard.js:158` | `loadState === "failed"` | SC-033 |
| Empty-state placeholders that survive the gate: `$0.00 ENTERED`, `TODAY -`, `PERIOD -`, `Pick a period from the Season grid`, `Select...` | rendered by children of `.sc-body` when `isAccountLoading === false` | first-mount race (see §2) | inherent to the pre-fix render |
| `.sc-daysq-syncing-spinner` (per-day pip) | `src/app/service-calendar/DaySquare.js:362` | date in `syncingKeys` set | F3 |
| `.sc-export-spinner` | `src/app/service-calendar/season/ExportControl.js:167` | mid-export | export button |
| Admin `.oh-spinner` in `LaborBudgetsPanel` | `src/app/service-calendar/admin/LaborBudgetsPanel.js:132` | loading state | admin panel |

**Nine distinct loading affordances inside SC alone.** Two skeleton families (`sc-skel-*` from SkeletonSurface/Ribbon, `sc-workspace-skel-*` from PeriodWorkspace) with overlapping intent. One spinner family (`.oh-spinner`).

### The rest of the app (from parallel research)

**Full inventory in the Explore agent's return; the important findings for scope-setting:**

- **28+ loading treatments across the app.** No shared spinner, no shared skeleton, no shared "state machine" pattern.
- **Two spinner families**: `.oh-spinner` (Ops Hub, CSS keyframe) and `.pp-spin` / `.pb-loading-pulse` (People + Playbook, custom).
- **Four skeleton families**: `SkeletonSurface` (SC), `WorkspaceSkeleton` (SC), `SkeletonBoard` (KPI Overview + Purchasing, two separate files), `.pb-iframe-skeleton` (Playbook), `.opd-*--skel` (OPD three variants).
- **KPI has a real state machine** (`loadState = idle | loading | refetching | loaded | error | auth`, StateBox variants for each). Nothing else does.
- **KPI Purchasing has skeleton-show-delay (150ms)** to avoid flash. Nowhere else does.
- **/sous and /sousai/reports are server-rendered** - no client loading treatment at all.
- **Zero `loading.js` files.** Next 13+ route-level convention is unused.
- **Zero `<Suspense>` boundaries.** No streaming, no partial hydration fallback.
- **Empty-state-as-loading appears in People, Financial, Ops** (spinner blocks render until bootstrap; no ghost). It appears in **SC and KPI Purchasing** (skeleton + prior-data ghost). The two approaches co-exist without a rule.

---

## 2. Why the mount path bypasses `isAccountLoading` (verified)

**Chat-Claude's read is correct on the mechanism, and I found the exact line.**

At `src/app/service-calendar/ServiceCalendar.js:1575`:

```js
const isAccountLoading = !!selectedAccount && (
  !data ||
  data?.account?.key !== selectedAccount ||
  !yearData ||
  (lens === "period" && !periodRanges) ||
  (isMonthView && !monthCache[monthKey])
);
```

The `!!selectedAccount` clause is a hard gate. On first mount `selectedAccount` is `""` (initial useState at :487), and `setSelectedAccount(initial)` only fires inside the `sc-accounts` fetch resolver at :748. Between mount and that fetch resolving, the gate is `false`, so every one of the eight `!isAccountLoading && ...` conditional-render clauses (lines 3623, 3843, 4073, 4118, 4299, 4349, 4382) evaluates against empty data and renders the placeholder statements.

**This produces the "5 states" hard-refresh trace directly:**

| State | Time (approx from trace) | What renders | Why |
|---|---|---|---|
| 1 | 0ms | `page.js` .oh-spinner ("Loading Service Calendar...") | `status === "loading"` at page.js:182 |
| 2 | ~35ms | Empty placeholders: `Pick a period`, `Select...`, `TODAY -`, `$0.00 ENTERED` | Session hydrated, ServiceCalendar mounts, `isAccountLoading === false` (selectedAccount is "") - conditional-render clauses fire against empty data |
| 3 | ~150-300ms | Blank | `sc-accounts` fetch resolves, `setSelectedAccount(initial)` fires, `isAccountLoading` flips true, `<SkeletonSurface />` mounts but shimmer hasn't started animating yet (or the mid-swap between empty and skeleton is one paint-cycle blank) |
| 4 | ~400-600ms | Skeleton + partial data | `data` arrives with `data.account.key === selectedAccount`, gate flips false, real body renders. But `yearBannerStats` isn't computed yet, so hero reads `$0.00 ENTERED` for a beat. **This is the 580ms `$0.00 ENTERED` window Kevin flagged.** |
| 5 | ~600-900ms | Grid | All derivations settle. |

**Ops → SC path (client-side nav) skips state 1** (session already hydrated) but hits states 2-4 for the same reason. **Period-switch and account-switch stay clean** because both preserve `selectedAccount` truthy and the sc-load fetch fires with the gate already TRUE - it never bounces to false until fresh data lands.

**`pageSpinner | shimmer` at 703ms on Ops → SC** (Chat-Claude's simultaneous-treatments finding): the `pageSpinner` label plausibly refers to `Ribbon`'s per-stat shimmer bars (they visually read like a spinner in the top strip) rendering simultaneously with `SkeletonSurface`'s body shimmer. Same underlying `.sc-skel-shimmer` CSS class, but *two components rendering it in different regions of the layout*, unaware of each other. This is not a bug in either - it's the missing concept the prompt named: no single owner of "we're in a load right now."

**Fix at the source** (one-line change): drop the `!!selectedAccount` clause and treat the pre-hydration window as loading:

```js
const isAccountLoading = (
  !selectedAccount ||                                       // pre-URL-hydration
  !data ||
  data?.account?.key !== selectedAccount ||
  !yearData ||
  (lens === "period" && !periodRanges) ||
  (isMonthView && !monthCache[monthKey])
);
```

This closes states 2 and 4 (the placeholder + the `$0.00 ENTERED` partial-render). It does NOT touch the two working paths - period-switch and account-switch both have `selectedAccount` truthy the entire time, so the `!selectedAccount` clause is inert for them.

---

## 3. What the single treatment should be, and what it costs

**Recommendation: `SkeletonSurface` becomes the single treatment for the whole app.** Not the KPI SkeletonBoard, not `.oh-spinner`, not `.pb-loading-pulse`.

**Reasoning:**

- Skeletons make no claim; spinners and empty-states both make wrong claims (the exact failure mode Kevin named).
- SkeletonSurface is the newest and the one Kevin already approved on the SC (Approach C, 2026-09-03).
- Its shimmer motion is the "pending" signal - a spinner just means "waiting" but not "waiting on something structured."
- It scales down (Ribbon uses the same `.sc-skel-shimmer` primitive as inline bars). One primitive can serve section-level AND field-level.
- Structural mimicry preserves layout, which prevents the CLS problem a spinner has.

**What can't use it**, and what should:

| Path | Recommended | Cost |
|---|---|---|
| SC first mount (cold refresh) | SkeletonSurface (extend gate per §2) | 1-line gate fix + verify §4 doesn't regress |
| SC Ops → SC nav | SkeletonSurface (same gate fix covers this) | included above |
| SC period-switch / account-switch | Already clean, no change | 0 |
| KPI Labor / Overview / Purchasing | Migrate their SkeletonBoard to be a SkeletonSurface variant OR reskin SkeletonSurface's rail to KPI's card grid | 1 shared skeleton primitive, per-section layout descriptors |
| People, Directory, Playbook | Replace `.oh-spinner` / `.pp-spin` / `.pb-loading-pulse` with SkeletonSurface | 1 spinner delete each + wire the surface into the page component's loading gate |
| Ops Hub subroutes (Financial, Vendors, Invoice, Inventory Manager) | Same: replace with SkeletonSurface | ~15 call-sites |
| Cold document load, pre-hydration (before React attaches at all) | `.oh-spinner` in `layout.js` root - the ONLY spinner that survives | 1 seam - the moment React hydrates, SkeletonSurface takes over. The seam is exactly the `RootLayout` → first client component mount. |
| Persistent chip/pill loaders (offline, syncing) | Keep as-is - these are notifications, not loading | 0 |
| Button-inline saving spinner (`oh-btn-spinner`) | Keep as-is - action-scoped, not page-scoped | 0 |

**Cost estimate:** ~30 call-sites migrated across ~15 files, one shared primitive extended, three redundant skeleton components deleted, one bad `!!selectedAccount` gate fixed. Approximately one PR the shape of SC cleanup item 4 but touching more surfaces.

**Corollary the prompt names:** never show a real-looking value during a load. This is the harder discipline than the primitive swap - it requires every render path to know whether it's in a loading window and either render the primitive OR render real data, never a placeholder that reads real. That's what the SC first-mount `$0.00 ENTERED` currently violates and what a section like KPI Labor's `StateEmptyFiltered` already does correctly (renders a state-box, not a zero).

---

## 4. Whether the same problem exists outside SC

**Yes, but shaped differently in each section.**

- **KPI (Labor, Overview, Purchasing)** - has the state machine + SkeletonBoard, so the SC-shaped `$0.00 ENTERED` mid-load isn't visible here. But the treatment is a *third* skeleton family. Unification would merge, not fix.
- **People, Ops, Financial, Inventory Manager** - use the "spinner blocks render" pattern. No wrong-real-value bug because nothing renders. But the spinner *is* a wrong claim: it's what Kevin called "glitchy." Same fix applies.
- **Directory** - uses "Loading…" text with cache-first render. The cached data shows immediately, then the fresh fetch merges. This is close to correct but the text-only fallback is a fifth treatment. Should switch to SkeletonSurface for consistency.
- **Playbook** - three treatments (`.pb-loading-pulse`, `SlideOverReader` text overlay, `.pb-iframe-skeleton`). The pulse and text should go; the iframe skeleton is genuinely different (external iframe mount, not our data) and could stay as a scoped variant.
- **/sous, /sousai/reports** - server-rendered, no client loading. Doesn't need the treatment. Confirms the "cold document load may need something else" case from the prompt.
- **Home dashboard `/`** - already has a SkeletonScreen (page.js:290-355). Different shape than SkeletonSurface but same intent. Worth harmonizing.

**Kevin's "any other section or action" answer: yes, everywhere except /sous. Every section is one of five patterns, none share a primitive, and three sections have contradictions inside themselves (Playbook, Ops, KPI).**

---

## Fences honored

- **Report-only.** No code changed.
- **The two working paths are named.** Period-switch and account-switch stay single-state after the §2 fix - the `!!selectedAccount` clause is inert on both because `selectedAccount` is truthy the entire time.
- **RAF verification is what the next step needs.** This report proves the mechanism via code-read; the next step (before Kevin approves the single treatment) is to re-run Chat-Claude's RAF sampling after the one-line gate fix to confirm states 2 and 4 collapse into the skeleton, and to compare Ops → SC before/after to see whether `pageSpinner | shimmer` becomes a single state.

## Awaiting Kevin's ruling on

1. **Is SkeletonSurface the single treatment?** (Alternatives: KPI's SkeletonBoard, Home's SkeletonScreen, a new one from scratch.)
2. **Do we ship the one-line gate fix first as a standalone PR** (proves the largest single win, gives Kevin a RAF trace to compare), **and then the full unification in a second PR**? Or bundle both?
3. **Scope of the unification PR:** SC-only first, then KPI, then Ops/People/Directory/Playbook in a third pass? Or all at once?
4. **The cold-hydration seam** - keep `.oh-spinner` in RootLayout as the one surviving spinner, or push SkeletonSurface earlier via a `loading.js` at the root?
