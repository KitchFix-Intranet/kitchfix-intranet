# HS FB1 PR-2 handoff

**Date:** 2026-08-24
**Preceded by:** HS FB1 PR-1 (#806, merged 2026-08-24) - three of four P0 fixes verified live + the employee-name follow-up (below) + wired V30-5 static gate
**Companion:** `CC_PROMPT_HOMESTAND_FEEDBACK_1.md` (root of repo) - the authoritative spec. This handoff carries only what a fresh session cannot reconstruct from that prompt.
**Primary target file:** `src/app/kpi/kpi.css` (all 68 violations live here, in the `.kpi-hs-*` block)

## Verified fixed post-PR-1 (do NOT re-audit in PR-2)

Owner verified #806 live on 2026-08-24; three of four P0s landed. The fourth was a client-side field-name mismatch and was fixed in the same session:

- HS 9 day strip - source: daily, 38 rows, 8 bars with money  → FIXED (PR-1 defect 1b)
- card order - Season to date above the rail  → FIXED (PR-1 defect 1d)
- workers map - present, 5 workers  → FIXED (PR-1 defect 1a, via 1b's daily branch shipping `workers: workerMeta`)
- employee names rendering as ID fragments (`#5099 · Cook`, `#e4db · Dishwasher`) → FIXED in follow-up 2026-08-24: `HomestandBoard.js:623` read `meta.name`; the server payload writes `meta.display_name` (see `src/lib/kpi/resolveWorkerMeta.js:60`). Every other consumer in the app (`page.js:51`, `WeekTable.js:38`) reads `display_name` - HS was the outlier. One-line change: `meta.name` -> `meta.display_name`. The `#{4-char}` prefix came from the `slice(-4)` fallback branch on the same line, which further confirmed the source. No server change was needed; the map and its keying were correct.

PR-2 does NOT need to re-verify any of the four above. If any of them regress, treat as a separate PR-1 hotfix, not part of PR-2's token sweep.

## Purpose

PR-1 wired the V30-5 static gate at baseline=68 and shipped the P0 correctness fixes. PR-2 is the token-alignment pass: drive `d1` from 68 to 0 by replacing every raw px literal in the `.kpi-hs-*` block with the period board's role tokens, and normalise font-weight / letter-spacing to match the period board's role weights. When PR-2 lands, edit `BASELINE_D1` in `scripts/probes/_probe_kpi_css_token_gate.mjs` from 68 to 0 in the same PR so the floor locks.

## Role -> token mapping (from prompt, verified against period board)

Kevin's HS FB1 prompt gave this role table. Values on the right are the actual token names + period-board weights + letter-spacings as they exist in `src/app/kpi/kpi.css`. Where the code drifted from the prompt, both are shown.

| Role                    | Font-size token           | Weight | Letter-spacing | Transform  | Anchor selector in kpi.css |
|-------------------------|---------------------------|--------|----------------|------------|----------------------------|
| eyebrow / card title    | `--kpi-t-label`  (10px)   | 700    | 0.08em         | uppercase  | `.kpi-sig-eyebrow` L2411   |
| state pill / chip       | `--kpi-t-label`  (10px)   | 700    | 0.06em         | -          | `.kpi-sig-state` L2417     |
| sub-line / caption      | `--kpi-t-meta`   (11px)   | 500    | -              | -          | `.kpi-sig-sub-lane` L2456  |
| fact label              | `--kpi-t-label`  (10px)   | 600    | 0.06em         | uppercase  | `.kpi-sig-fact-lab` L2493  |
| fact value              | `--kpi-t-body`   (12.5px) | 700    | 0              | -          | `.kpi-sig-fact-val` L2500  |
| hero (prompt version)   | `--kpi-t-hero`   (28px)   | 800    | -0.018em       | -          | (prompt-stated)            |
| hero (period actual)    | `--kpi-t-value`  (20px)   | 800    | -0.01em        | -          | `.kpi-sig-hero-val` L2443  |
| table cell              | `--kpi-t-body`   (12.5px) | 600    | -              | -          | `.kpi-tbl` (see below)     |

**Hero drift - CODE WINS:** owner ruling 2026-08-24 - the prompt table above was written from the token file and went stale when V35-1 landed. V35-1 deliberately dropped the period signal-card hero one type step from `--kpi-t-hero` to `--kpi-t-value` so the story-card period budget is the only tier-1 number on the page. The period actual (`--kpi-t-value` weight 800 letter-spacing -0.01em) is the authoritative role for card heroes; the prompt's `--kpi-t-hero` weight 800 letter-spacing -0.018em is stale. **PR-2 must NOT "fix" the period value back to the prompt's hero token.** For the HS N spend hero specifically, follow the period actual: `--kpi-t-value` weight 800 letter-spacing -0.01em.

## Spacing token reference

All values scale via `--kf-scale = 0.9`.

| Token               | Base px | Typical role                                         |
|---------------------|---------|------------------------------------------------------|
| `--kpi-sp-1`        | 4       | tight vertical stack (label -> value margin-top)     |
| `--kpi-sp-2`        | 8       | pill horizontal padding, chip inner gap              |
| `--kpi-sp-3`        | 12      | grid gap, lane spacing, facts-row top padding        |
| `--kpi-sp-4`        | 16      | intra-card row spacing                               |
| `--kpi-sp-5`        | 20      | card outer padding (also `--kpi-card-pad`)           |
| `--kpi-sp-6`        | 24      | section spacing                                      |
| `--kpi-card-pad`    | 16      | card padding (period canonical)                      |
| `--kpi-lane-head`   | 20      | header row height (eyebrow + state pill)             |
| `--kpi-lane-hero`   | 38      | hero lane                                            |
| `--kpi-lane-sub`    | 16      | sub-line lane                                        |
| `--kpi-row`         | 40      | clickable / table row height                         |
| `--kpi-thead-h`     | var(--kpi-ctl) | table head height (aliases --kpi-ctl)         |

## 68-violation checklist

Regenerate with `npm run audit:kpi-scale`. The gate prints line numbers off the comment-stripped source, so the numbers below are recovered from the raw file - two identical snippets in the CSS may point to the same recovered line; grep for the snippet to disambiguate.

All 68 sit inside the `.kpi-hs-*` region (65 in `.kpi-hs-card*` / `.kpi-hs-tbl*` / `.kpi-hs-facts*`, 3 in `.kpi-hs-view-tab*`).

### `.kpi-hs-view-tab*` (Period | Homestand toggle)

- [ ] L3300  `padding: 9px 20px;`  -> `padding: var(--kpi-sp-2) var(--kpi-sp-5);` (align with `--kpi-ctl` control height per prompt 2c)
- [ ] L3313  `margin-left: 5px;`   -> `margin-left: var(--kpi-sp-1);` (or drop if token grid already provides gap)

### `.kpi-hs-card` header row + card skin

- [ ] L3345  `gap: 10px;`               -> `gap: var(--kpi-sp-3);`
- [ ] L3348  `padding-right: 22px;`     -> keep as `22px` if this is the corner-reserved slot for the `?` popover; PR-1 comment says "absolute-position `.kpi-hs-qwrap` in corner" - if that anchor moved to right:var(--kpi-sp-2), this padding may become `var(--kpi-sp-5)` (20). Verify against DOM before changing.
- [ ] L3368  `padding: 2px 9px;`        -> `padding: 0 var(--kpi-sp-2);` (match `.kpi-sig-state` L2422 - state pill inherits `--kpi-lane-head` height, so vertical padding is 0)
- [ ] L3369  `font-size: 10px;`         -> `font-size: var(--kpi-t-label);` (eyebrow / state pill role) - **7 occurrences of the same snippet in this file; grep and replace all**

### `.kpi-hs-card` body region

- [ ] L3378  `gap: 6px;`                -> `gap: var(--kpi-sp-1);` (or --kpi-sp-2 if it's a row gap) - **2 occurrences**
- [ ] L3400  `gap: 5px;`                -> `gap: var(--kpi-sp-1);`
- [ ] L3406  `padding: 4px 2px 0;`      -> `padding: var(--kpi-sp-1) 0 0;` (drop the odd 2px; period cards do not use asymmetric horizontal padding at this level)
- [ ] L3454  `margin-top: 5px;`         -> `margin-top: var(--kpi-sp-1);`
- [ ] L3458  `font-size: 9px;`          -> `font-size: var(--kpi-t-label);` (role is caption; 9px is a one-off shrink to fit that vanishes once the label token drives it) - **2 occurrences**
- [ ] L3466  `font-size: 8.5px;`        -> `font-size: var(--kpi-t-label);` (same role; the 8.5 is 10 * 0.85, not a distinct role)
- [ ] L3481  `gap: 14px;`               -> `gap: var(--kpi-sp-3);` (12) or `var(--kpi-sp-4)` (16) - review at report time; 14 is between the two
- [ ] L3487  `margin-right: 5px;`       -> `margin-right: var(--kpi-sp-1);`

### `.kpi-hs-card` fact/value cluster

- [ ] L3521  `gap: 22px;`               -> `gap: var(--kpi-sp-5);` (20) - closest role token; 22 is arbitrary
- [ ] L3522  `font-size: 10.5px;`       -> `font-size: var(--kpi-t-meta);` (sub-line role) - **2 occurrences**
- [ ] L3530  `font-size: 16px;`         -> `font-size: var(--kpi-t-medium);` (15) - closest role; verify visually
- [ ] L3535  `padding: 13px 16px;`      -> `padding: var(--kpi-sp-3) var(--kpi-sp-4);` (12/16 - align with period card canonical)
- [ ] L3537  `gap: 11px;`               -> `gap: var(--kpi-sp-3);`
- [ ] L3559  `margin: 0 4px 0 8px;`     -> `margin: 0 var(--kpi-sp-1) 0 var(--kpi-sp-2);`
- [ ] L3586  `font-size: 25.2px;`       -> **hero role decision needed.** 25.2 = 28 * 0.9 = `--kpi-t-hero` unscaled. But per V35-1 drift note above, card heroes now use `--kpi-t-value`. Ship as `var(--kpi-t-value)` unless Kevin rules otherwise.
- [ ] L3594  `font-size: 12px;`         -> `font-size: var(--kpi-t-body);` (12.5)
- [ ] L3597  `font-size: 11px;`         -> `font-size: var(--kpi-t-meta);` - **2 occurrences**
- [ ] L3598  `margin-top: 4px;`         -> `margin-top: var(--kpi-sp-1);`
- [ ] L3603  `gap: 16px;`               -> `gap: var(--kpi-sp-4);`
- [ ] L3604  `margin-top: 11px;`        -> `margin-top: var(--kpi-sp-3);` (12) - closest role token
- [ ] L3604  `padding-top: 9px;`        -> `padding-top: var(--kpi-sp-2);` (8) or `var(--kpi-sp-3)` (12) - review; 9 is between
- [ ] L3615  `font-size: 12.5px;`       -> `font-size: var(--kpi-t-body);` (exact match) - **2 occurrences**
- [ ] L3624  `margin-top: 9px;`         -> `margin-top: var(--kpi-sp-2);` (8) - **2 occurrences**

### `.kpi-hs-tbl*` (season table)

- [ ] L3666  `padding: 9px 12px;`       -> `padding: var(--kpi-sp-2) var(--kpi-sp-3);` - **2 occurrences (thead + tbody cells)**
- [ ] L3692  `padding-left: 38px;`      -> keep or express via `--kpi-sp-6 + --kpi-sp-3` (24+12); 38 is a specific indent for grouped rows - preserve intent, review against period `.kpi-tbl` grouping if any
- [ ] L3707  `padding: 8px 12px;`       -> `padding: var(--kpi-sp-2) var(--kpi-sp-3);`
- [ ] L3713  `margin: 4px 0 4px 26px;`  -> `margin: var(--kpi-sp-1) 0 var(--kpi-sp-1) var(--kpi-sp-6);` (24 for 26 - closest; review)
- [ ] L3721  `margin-left: 4px;`        -> `margin-left: var(--kpi-sp-1);`
- [ ] L3727  `margin-right: 6px;`       -> `margin-right: var(--kpi-sp-1);` (4) - closest role token
- [ ] L3733  `padding: 1px 6px;`        -> `padding: 0 var(--kpi-sp-1);` (drop 1px - table cell inner pill)
- [ ] L3735  `margin-left: 6px;`        -> `margin-left: var(--kpi-sp-1);`

### Busiest-week / detail popover cluster

- [ ] L3843  `padding: 12px 14px;`      -> `padding: var(--kpi-sp-3) var(--kpi-sp-4);` (12/16 - closest; 14 rounds to 16 per period canonical)
- [ ] L3844  `font-size: 11.5px;`       -> `font-size: var(--kpi-t-meta);` (11) - closest role
- [ ] L3860  `margin-bottom: 6px;`      -> `margin-bottom: var(--kpi-sp-1);`
- [ ] L3887  `margin-top: 6px;`         -> `margin-top: var(--kpi-sp-1);`
- [ ] L3913  `margin-left: 8px;`        -> `margin-left: var(--kpi-sp-2);`

**Working method:** replace in file-order (top -> bottom). After each cluster, re-run `npm run audit:kpi-scale` to watch the count drop. When count hits 0, drop `BASELINE_D1` from 68 to 0 in `scripts/probes/_probe_kpi_css_token_gate.mjs`. Do NOT lower the baseline incrementally - one atomic drop at the end so a mid-PR regression cannot slip in under a stale baseline.

## Font-weight normalisation (informational -> mandatory in PR-2)

The `[d2]` counter reported 31 weight literals inside `.kpi-hs-*`, distribution `{400:3, 500:2, 600:5, 700:4, 800:17}`. HS-side is 55% at 800; period-side is 25% at 800 - Kevin's "one step heavy" observation. PR-2 must map each `.kpi-hs-*` selector's role to the period weight per the mapping table above:

- eyebrow / card title / state pill -> 700
- sub-line / caption / muted values -> 500
- fact label -> 600
- fact value / table cell body -> 700 (values) or 600 (labels)
- hero -> 800

Any `font-weight: 800` on a non-hero selector is the target of the sweep. The 17 occurrences of 800 are the primary source of HS-side heaviness.

## Letter-spacing normalisation

Period board uses these letter-spacings by role (see mapping table). HS block has literals scattered ad-hoc. PR-2 replaces them per role:

- eyebrow / card title: `0.08em`
- state pill / chip / fact label: `0.06em`
- hero: `-0.01em` (period actual) or `-0.018em` (prompt) - see hero-drift note
- sub-line / body / value: no letter-spacing (unset)

## Rulings that are NOT in the prompt (standing, apply to every HS change)

These landed as owner rulings during PR-A / PR-B / PR-C / PR-1 and are not written into `CC_PROMPT_HOMESTAND_FEEDBACK_1.md`. They govern PR-2 decisions:

1. **Hatch means pending or estimated. Never for confirmed spend.**
   Why: hatch is a visual state, not a decoration. Applying hatch to a paid figure lies about its finality.
   How to apply: if the estimator or plan is the source, hatch is fine. If actuals fed the number, hatch is wrong.

2. **Colour encodes identity; pattern encodes state.**
   Why: colour is stable across time for a given entity (an account has a colour); state changes over time (a stand goes from planned -> partial -> played).
   How to apply: never repurpose the account palette to signal state. Use pattern / opacity / border for state.

3. **Author against tokens, never literals.** (This is the whole point of PR-2.)
   Why: the V30-5 gate exists to enforce this. 68 literals shipped because the gate was never wired. It is now wired.
   How to apply: every new declaration in `.kpi-hs-*` uses a `--kpi-*` token. If no token fits the role, propose adding one - do not inline a px.

4. **Verify against the deployed build.**
   Why: PR-C's header-height assertion was written and passed locally, but the defect still shipped because no one ran it against the deployed URL. Static gates + local Playwright are insufficient on their own.
   How to apply: after PR-2 lands on Vercel preview, load `?homestand=` for each of the 4 accounts (CIN-OH, STL-MO, TXR-TX-H, TBJ-FL) and visually confirm the card skin matches period. Kevin's evidence bar is [ran on prod] not [passed locally].

5. **Map by ROLE, not nearest number.**
   Why: 25.2px isn't a "size that needs the nearest token" - it's a HERO role that happens to have a numeric representation. Two literals at the same px may belong to different roles.
   How to apply: for each violation, ask "what is this element's role in the card visual hierarchy?" and pick the role token, even if a numerically-closer literal exists elsewhere.

6. **Do not "fix" the period board to match homestand.**
   Why: period is correct and on-scale. HS is the drift.
   How to apply: PR-2 only touches `.kpi-hs-*` selectors. If a fix would require editing period-side CSS, stop and file a note; do not fold it into PR-2.

7. **No silent scope additions.**
   Why: build discipline. A PR-2 that quietly bundles PR-3 items is unreviewable.
   How to apply: PR-2 = 65 literal swaps + font-weight normalisation + letter-spacing normalisation + card skin + toggle + pills + season table + Busiest week popover flip (per prompt 2a-2f). Everything else waits for PR-3.

## Open items carried from PR-1

1. **15s account-switch hang: vector removed, cause unknown.**
   PR-1 removed the dangling `homestand` param on account switch (`onPickAccount` sets `homestand: ""`), which eliminates the reproducer. But the root cause of the 15s hang was never identified - could not reproduce from CLI (no live browser session, auth expired). If a hang recurs after PR-2, capture browser console + network waterfall + server logs before touching code. Do not assume PR-1's fix was the actual cure.

2. **Font-weight gate is informational only.**
   `[d2]` in the static gate counts font-weight literals in `.kpi-hs-*` but does not fail on them. PR-2 normalises the weights; after PR-2, decide whether to make `[d2]` a hard gate or leave it informational. Kevin's stated preference is TBD - report the residual count after PR-2 and let him rule.

## What's out of scope for PR-2

Deferred to PR-3 per `CC_PROMPT_HOMESTAND_FEEDBACK_1.md` section 3:

- Rail `est.` removal
- Season to date arrow / color / copy
- Prep-day distinct legend color
- HS N spend hero flip
- AVG COST PER GAME renaming
- OT card copy split
- Forecast vs Actuals toggle

If any of these appear on the same page and are tempting to fold in - don't. See ruling #7.

## Verification bar for PR-2 report

- [ ] `npm run audit:kpi-scale` returns count=0, and `BASELINE_D1` in the probe was dropped to 0 in the same PR
- [ ] `.github/workflows/kpi-css-gate.yml` runs green on the PR (it runs on `pull_request` when `src/app/kpi/kpi.css` is touched)
- [ ] Vercel preview loaded for all 4 HS accounts (CIN-OH, STL-MO, TXR-TX-H, TBJ-FL), header-row height matches period, card padding / gap / pill sizing matches period at 375px + 1280px
- [ ] Font-weight residual reported: count + byValue distribution from `[d2]` after PR-2
- [ ] Busiest-week popover flip verified at narrow widths (per prompt 2f)

## Session bootstrap for the fresh session picking this up

1. `pwd` = `/Users/kevinfietek/dev/kf-cell-states`
2. `git status` clean, `git branch --show-current` = a fresh branch off main named `feat/kpi-hs-fb1-pr2` (or similar)
3. Read `CC_PROMPT_HOMESTAND_FEEDBACK_1.md` sections 2a-2f - the authoritative spec
4. Read this doc for the checklist + rulings
5. Read `src/app/kpi/kpi.css` L3290-L3920 for the `.kpi-hs-*` block
6. Run `npm run audit:kpi-scale` to confirm baseline is still 68 before starting
7. Work the checklist top-to-bottom, one cluster at a time; re-run the gate after each cluster
8. Kevin's evidence bar: [ran on prod] > [ran locally] > [code-read + anchor] > [needs-gate with concrete reason]. Never claim "risk low, no change" as evidence.
