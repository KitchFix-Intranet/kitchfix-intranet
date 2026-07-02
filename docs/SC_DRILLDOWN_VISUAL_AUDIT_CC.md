# SC Drilldown vs Overview - Per-Property Parity Audit (CC)

**Read against `origin/main` HEAD `5addb1b`** (Merge PR #316 - docs/sc-token-readme). Detached worktree at `/Users/kevinfietek/dev/kf-parity-audit`. Read-only; no code, no build, no commit, no PR.

**Drill-in objective-alignment bundle (PR #317) NOT merged.** Verified via `gh pr view 317 --json state,mergedAt`: `{"state":"OPEN","mergedAt":null}`. Consequently: `dayDetail.css` / `Icons.js` / `useDialogA11y.js` do not exist in main; all `.sc-day-*` rules still live in `ops-sc.css` lines 149-479; DayDetail's coaching banner still carries 12 raw-hex tuples in JSX inline styles at `DayDetail.js:226-241` + `ServiceCalendar.js:1065`. This audit measures **the current shipped drilldown**, not #317.

**Reference visual for design intent:** `/Users/kevinfietek/Downloads/service-calendar_design-alignment_v2.html`. Not readable by this agent - all measurements below are code-grounded, screenshots kept as intent context for chat-Claude + Kevin.

---

## Method + reproducibility

Reads:
- Overview JS: `SeasonShell.js`, `MonthCard.js`, `PeriodCard.js`, `FullSeasonCard.js`, `ChromeBar.js`, `PhaseStrip.js`, `SeasonStepper.js`, `StateLegend.js`.
- Overview CSS: `season.css`, `chromeBar.css`, `seasonStepper.css`, `stateLegend.css`, `legendInfoPopup.css`, `stickyContext.css`.
- Drilldown JS: `PeriodWorkspace.js`, `DayDetail.js`, `ServiceCalendar.js` (overlay wiring).
- Drilldown CSS: `periodWorkspace.css`, `ops-sc.css` (the `.sc-day-*` block at lines 149-479 + `.sc-btn*` block 481-521).
- Shared atom (not gap): `DaySquare.js`, `DaySquare.css`.

DaySquare atom is shared cross-surface with size modifiers (`--sm` in overview grids, `--lg` in workspace grid). Not flagged - it's the parity baseline for cell-scale rendering.

---

## Axis 1 - Container / surface

Every measured value points at a semantic token (no raw hex or px in the container layer except two documented rgba hairline shadows on the card headers).

| Surface | Background | Border | Radius | Elevation | Outer padding | `file:line` |
|---|---|---|---|---|---|---|
| **Overview page** (`.sc-season`) | `--surface-page` | none | none | none | `var(--space-3) var(--space-4) var(--space-7)` | `season.css:26-38` |
| **Overview MonthCard** | `--surface-card` | `--border-thin --border-default` | `--radius-container` (10px) | none (rest) → `--elevation-raised` (hover) | `--space-3` | `season.css:278-289, 311-315` |
| **Overview PeriodCard** | `--surface-card` | `--border-thin --border-default` | `--radius-container` (10px) | none (rest) → `--elevation-raised` (hover) | `0` (subcomponents pad) | `season.css:610-621, 625-629` |
| **Overview FullSeasonCard** | `--surface-card` | `--border-thin --border-default` | `--radius-container` (10px) | none | `--space-4` | `season.css:784-793` |
| **Overview ChromeBar** | `--surface-card` | `--border-thin --border-default` bottom | `--radius-container-lg` (14px) top only | none | `--space-3 --space-4` | `chromeBar.css:7-18` |
| **Overview SeasonStepper** | `--surface-card` | `--border-thin --border-default` | `--radius-container` (10px) | none | `--space-card-pad --space-4` | `seasonStepper.css:7-14` |
| **Overview StateLegend (year-view)** | `--surface-card` | `--border-thin --border-default` top only | `0 0 --radius-container-lg --radius-container-lg` | none | `--space-3 --space-4` | `stateLegend.css:30-36` |
| **Drilldown Workspace page** (`.sc-workspace`) | `--surface-sunken` | none | none | none | `var(--space-3) var(--space-4) var(--space-7)` (gap: `--space-4`) | `periodWorkspace.css:7-15` |
| **Drilldown Financial Frame** | `--surface-card` | `--border-thin --border-default` | **`--radius-container-lg`** (14px) | none | **`18px 22px`** (raw px, not token) | `periodWorkspace.css:159-167` |
| **Drilldown Today Hero** | `linear-gradient(180deg, --surface-card 0%, --surface-sunken 100%)` | `--border-thin --status-off-bd` | **`--radius-container-lg`** (14px) | none | `--space-4 --space-5` | `periodWorkspace.css:343-352` |
| **Drilldown Day Grid Wrap** | `--surface-card` | `--border-thin --border-default` | **`--radius-container-lg`** (14px) | none | `14px --space-4 18px` (raw px) | `periodWorkspace.css:513-522` |
| **Drilldown Empty / Partial banner** | `--surface-card` / `--accent-backplate` | `--border-thin --border-default` / `--status-needs-bd` | `--radius-container-lg` | none | `36px` / `--space-2 14px` | `periodWorkspace.css:584-592, 593-599` |
| **Drilldown Overlay backdrop** | `rgba(0,0,0,0.32) + blur(1.5px)` | none | none | none | `--space-6` | `ops-sc.css:141-148` |
| **Drilldown Overlay card** | `--surface-card` | none | **`--radius-container-lg`** (14px) | **`--elevation-popover`** | none (children pad) | `ops-sc.css:149-157` |
| **Drilldown DayDetail body** | `--surface-card` (implicit) | `--border-thin --surface-sunken` header bottom | inherits | none | body `--space-3 --space-4`; header `--space-3 --space-4` | `ops-sc.css:169, 191` |
| **Drilldown DayDetail group card** | `--surface-card` | `--border-thin --border-default` | `--radius-container` (10px) | **`--elevation-card`** (`--sh-sm`) | overflow-hidden; children pad; `margin-bottom: --space-4` | `ops-sc.css:197-204` |
| **Drilldown DayDetail footer** | **`--surface-sunken`** | `--border-thin --border-default` top only | `0 0 --radius-container-lg --radius-container-lg` | none | `--space-3 --space-4` | `ops-sc.css:399-405` |

**Diverges:**
- **Radius:** Overview cards use `--radius-container` (10px) uniformly. Drilldown Financial Frame / Today Hero / Day Grid Wrap / DayDetail overlay all use **`--radius-container-lg` (14px)**. DayDetail's inner group card, however, uses `--radius-container` (matches overview).
- **Elevation:** Overview cards have zero elevation at rest, gain `--elevation-raised` on hover. Drilldown panels never elevate. DayDetail overlay elevates at `--elevation-popover` (correct for a modal); inner group cards at `--elevation-card` (a shadow the overview doesn't use on its cards).
- **Padding:** Overview uses whole `--space-*` tokens end-to-end. Drilldown Financial Frame, Today Hero CTA, Day Grid Wrap, Weeks, and today-pill fall back to `18px 22px`, `14px`, `28px`, `22px`, `6px 14px` - raw px microsizing that bypasses the density-aware semantic aliases.

---

## Axis 2 - Header structure

| Surface | DOM shape (JSX classes) | Container padding | Border / hairline | Phase / accent mechanism | `file:line` |
|---|---|---|---|---|---|
| **Overview PeriodCard header** | `<header .sc-season-period-card-header style={headerStyle}>` → `<.title>` [P{n} + · anchor] + `<.subtitle>` (phase / homestand / off / nbsp) | `var(--space-2) var(--space-3) var(--space-2)` | `border-bottom var(--border-thin) solid rgba(0,0,0,0.06)` | inline `style={{ background: primaryPhase.tint, color: primaryPhase.textTint }}` from `CANONICAL_PHASES[primary]` | `PeriodCard.js:71-73, 88-106`; `season.css:645-680` |
| **Overview MonthCard header** | `<header .sc-season-month-card-header>` → `<.name>` [month] + optional chevron | flex row `min-height: 36px` (no explicit padding) | `border-bottom var(--border-thin) solid rgba(0,0,0,0.06)` (matches PeriodCard - documented literal parity) | none - month name only; phase label sits in the *footer* since PR #310 (`.sc-season-month-card-phasefoot`) | `MonthCard.js:113-121`; `season.css:325-335, 724-728` |
| **Overview FullSeasonCard header** | `<.card-header>` → `<.eyebrow>` [FISCAL 2026] + `<.title>` [text] | `padding-bottom: --space-3`, header baseline aligned, `border-bottom --border-thin --surface-sunken` | uses the **`--surface-sunken`** hairline token, not the rgba literal | eyebrow uppercase `--track-caps`; no phase concept | `season.css:794-813` |
| **Drilldown Workspace header** | `<header .sc-workspace-header>` → `<.title>` [`.title-period` `.title-anchor` `.title-phase`] + `<.range>` [date range] | `padding: 0 --space-1`, `align-items: baseline`, `flex-wrap: wrap` | none (**no hairline separator - only spacing**) | `<.title-phase>` renders as a **pill** with `background: --status-needs-subtle`, `color: --accent-text`, `border-radius: --radius-container-lg` (14px) - not a phase tint, an amber chip. No inline `style` (no per-phase color) | `PeriodWorkspace.js:213-227`; `periodWorkspace.css:116-156` |
| **Drilldown DayDetail header** | `<.sc-day-header>` → `<.header-titles>` [`<h3 .title>` + optional `<.account>`] + `<.day-nav>` [prev/label/next + close] | `--space-3 --space-4` | `border-bottom --border-thin --surface-sunken` (same token as FullSeasonCard, not the `rgba(0,0,0,0.06)` literal the two overview card headers use) | none - fixed navy `--text-heading` title; no phase concept | `DayDetail.js:357-371`; `ops-sc.css:169-172` |

**Diverges:**
- **Hairline vocabulary:** three different bottom-hairline tokens in play - `rgba(0,0,0,0.06)` on MonthCard + PeriodCard headers (documented shared literal), `--surface-sunken` on FullSeasonCard + DayDetail headers, and **none** on the Workspace header. Three surfaces claiming the "header separator" job, three different values.
- **Phase presentation:** overview PeriodCard renders phase as an **inline-style background tint on the whole header** (soft, phase-family color). Workspace renders phase as an **amber pill inside the title row** (`--status-needs-subtle` fill + `--accent-text` color). DayDetail doesn't carry phase context at all.
- **Radius on the phase presentation:** PeriodCard header inherits its card radius (`--radius-container`, 10px). Workspace phase pill uses `--radius-container-lg` (14px) - a container-scale radius applied to a small chip.
- **Title element type + weight:** PeriodCard num is a `<span>` at `--size-body / --wt-display`. Workspace title-period is a `<span>` at `--size-h2 / --wt-display`. DayDetail title is a real `<h3>` at `--size-subhead / --wt-bold`. Same job, three different type roles.

---

## Axis 3 - Type scale per role

Analogous roles mapped across surfaces. All values are `--size-*` + `--wt-*` (+ tracking where set).

| Role | Overview | Drilldown | Diverges? |
|---|---|---|---|
| **Primary heading (surface title)** | PeriodCard num: `--size-body` / `--wt-display` / `--track-tight` (`-0.01em`) - `season.css:657-661`. FullSeasonCard title: `--size-subhead` / `--wt-display` / `--track-tight` - `season.css:808-813` | Workspace title-period: `--size-h2` / `--wt-display` / `-0.01em` - `periodWorkspace.css:130-135`. DayDetail title: `--size-subhead` / `--wt-bold` / `--lead-tight` - `ops-sc.css:171` | **YES.** Overview steps: body (PeriodCard) / subhead (FullSeasonCard). Workspace jumps to **h2** for the same job; DayDetail sits at subhead but at `--wt-bold` (not display). Three different scales for "primary title of the surface." |
| **Secondary label / anchor** | PeriodCard anchor: `--size-caption` / `--wt-medium` / inherits color / `opacity: 0.7` - `season.css:663-668` | Workspace anchor: `--size-body` / `--wt-medium` / `--text-muted` - `periodWorkspace.css:136-140`. Workspace range: `--size-body` / `--wt-medium` / `--text-muted` / `--num-tabular` - `periodWorkspace.css:151-156`. DayDetail account: `--size-caption` / `--wt-medium` / `--text-muted` - `ops-sc.css:172` | **YES.** PeriodCard anchor = caption; Workspace anchor + range = body; DayDetail account = caption. Workspace consumes a full step up for the same "secondary metadata beside the title." |
| **Body / service-name / row-name** | ChromeBar stats-value: `--size-caption` / `--wt-bold` - `chromeBar.css:147-151`. MonthCard summary: `--size-caption` / `--wt-semibold` - `season.css:370-380` | Workspace bulk-rest-btn / bulk-active-count / progress-label: `--size-caption` / semibold-to-bold - `periodWorkspace.css:437-473, 253-259`. DayDetail row-name: `--size-body` / `--wt-medium` / `--text-heading` - `ops-sc.css:260`. DayDetail group-name: `--size-body` / `--wt-semibold` / `--text-link` - `ops-sc.css:226-234` | Partial. Workspace mostly caps at caption; DayDetail rows use body (its rows are hero-input rows so scale is appropriate). Not a divergence for DayDetail's role, but Workspace's "body" ceiling and DayDetail's "row body" don't match. |
| **Caption / projected label / eyebrow** | FullSeasonCard eyebrow: `--size-micro` / `--wt-bold` / `--track-caps` uppercase - `season.css:801-807`. FullSeasonCard stat-label: `--size-micro` / `--wt-semibold` / `--track-caps` - `season.css:836-842`. ChromeBar stats-label: `--size-micro` / `--wt-semibold` / `--track-caps` - `chromeBar.css:140-146` | Workspace frame-labels + frame-stat-label + upcoming-tag: `--size-micro` / `--wt-bold` / `--track-caps` - `periodWorkspace.css:237-246, 322-328, 184-195`. Workspace today-hero-flag: `--size-micro` / `--wt-display` / `0.08em` (raw) - `periodWorkspace.css:358-366`. DayDetail total-label: `--size-micro` / `--wt-bold` / `--track-caps` - `ops-sc.css:423-429`. DayDetail row-proj-label: `--size-caption` / no weight override / `--text-subtle` - `ops-sc.css:261`. DayDetail group-hint: `--size-caption` / `--track-caps` uppercase - `ops-sc.css:240-245` | Mostly aligned on micro-eyebrow. **DayDetail row-proj-label uses `--size-caption` (12px) instead of micro (10px)** for what is functionally an eyebrow-scale label. Also DayDetail's today-hero-flag uses raw `0.08em` tracking instead of `--track-caps` (0.06em). |
| **Big figure (revenue / count hero)** | FullSeasonCard hero stat-value: `--size-subhead` / `--wt-display` / `--text-success` - `season.css:849-854`. FullSeasonCard non-hero stat-value: `--size-body` / `--wt-bold` - `season.css:843-848` | Workspace frame-entered (per-meal money hero): **`--size-display` (35px)** / `--wt-display` / `--text-success` - `periodWorkspace.css:219-225`. Workspace frame-hero-num (fee/operational): **`--size-h1` (29px)** / `--wt-display` - `periodWorkspace.css:289-297`. Workspace frame-stat-value: `--size-h3` (20px) / `--wt-bold` - `periodWorkspace.css:329-334`. DayDetail total-rev: `--size-h2` (24px) / `--wt-bold` / `--accent-sc-dark` - `ops-sc.css:437-442`. DayDetail review-total-rev: `--size-h2` / `--wt-bold` - `ops-sc.css:470` | **YES, biggest single divergence in the type layer.** Overview hero figure = `--size-subhead` (17px). Workspace hero for per-meal = `--size-display` (35px, top of the scale); workspace hero for fee = `--size-h1` (29px). DayDetail total = `--size-h2` (24px). Four different steps for "the surface's biggest number." |
| **Micro row labels + separators** | PeriodCard subtitle: `--size-micro` / `--wt-bold` / `0.04em` / `opacity: 0.85` - `season.css:669-680` | Workspace weeks-label: `--size-caption` / `--wt-bold` / `0.04em` / uppercase - `periodWorkspace.css:573-579` | Slight. Both are "compact right-side row label," but micro (10px) vs caption (12px). |

---

## Axis 4 - Spacing rhythm

Both sibling-block gap and inner card padding, as consumed today.

| Surface | Stack gap between siblings | Card padding (outer) | Inline gap inside a row | `file:line` |
|---|---|---|---|---|
| **Overview `.sc-season`** | grid gaps `--space-3` (period grid) / `--space-3` (month grid) | page padding `--space-3 --space-4 --space-7` | `.sc-season` has no inline gap; each card manages | `season.css:26-38, 580-587` |
| **Overview MonthCard** | body gap `--space-2` between header/dow/grid/footer | container `--space-3` | header gap `--space-2` | `season.css:278-289, 325-335` |
| **Overview PeriodCard** | column layout, `overflow: hidden`, header/dow/grid/footer stacked - no explicit gap | container `0` (children pad) | title gap `6px` (raw), header gap collapse | `season.css:610-621, 645-655` |
| **Overview FullSeasonCard** | body gap `--space-3` (post PR #306 harmonize) | container `--space-4` | KPI grid gap `--space-3 --space-4` | `season.css:784-828` |
| **Overview ChromeBar** | left/right clusters gap `--space-3`; stats internal gap `--space-2`; segments gap `--space-2` | container `--space-3 --space-4` | inline `--space-2` throughout | `chromeBar.css:7-159` |
| **Drilldown Workspace** | **inter-section gap `--space-4`** on `.sc-workspace` | page padding `--space-3 --space-4 --space-7` | header title gap `--space-2`; nav gap `--space-3` | `periodWorkspace.css:7-15, 116-128` |
| **Drilldown Financial Frame** | internal gap `--space-2` between frame children | container **`18px 22px` (raw)** | numbers row gap `--space-4`; money row gap `--space-3`; labels row gap `--space-6` | `periodWorkspace.css:159-246` |
| **Drilldown Today Hero** | internal gap `6px` (raw) | container `--space-4 --space-5` | eyebrow gap `--space-2` | `periodWorkspace.css:343-405` |
| **Drilldown Day Grid Wrap** | internal gap `--space-2`; grid gap `6px` (raw) | container **`14px --space-4 18px` (raw)** | grid-dow gap `6px`, grid gap `6px` (raw) | `periodWorkspace.css:513-559` |
| **Drilldown DayDetail body** | `.sc-day-group` bottom margin `--space-4` between groups | body padding `--space-3 --space-4` | row padding `--space-3 --space-4`; row gap `--space-3` | `ops-sc.css:191-204, 250-262` |
| **Drilldown DayDetail footer** | totals margin-bottom `--space-3` | footer padding `--space-3 --space-4` | totals-left gap `--space-2`; actions gap `--space-2` | `ops-sc.css:399-455` |

**Diverges:**
- Workspace's stack gap is `--space-4` (16px). Overview's period/month grids run at `--space-3` (12px). The workspace sits a step looser than the grid it drills into.
- Financial Frame's `18px 22px` and Day Grid Wrap's `14px --space-4 18px` bypass the density-aware `--space-card-pad` semantic (which is `--space-3` under `data-density="compact"` per `tokens.css:100-103`). DayDetail also uses whole `--space-*` values in its footer/body/rows and matches the density system.
- Today Hero's internal `6px` and grid gaps of `6px` are raw values not on the 4/8/12/16 rhythm - `6px = --space-1 + 2` doesn't map to a semantic step.

---

## Axis 5 - Figure / number treatment

| Slot | Overview | Drilldown | Diverges? |
|---|---|---|---|
| Revenue / big figure size | FullSeasonCard hero: `--size-subhead` (17px) / `--wt-display` / `--text-success` / `--num-tabular` (implicit on stat) - `season.css:849-854` | Workspace per-meal money: `--size-display` (35px) / `--wt-display` / `--text-success` / `--num-tabular` - `periodWorkspace.css:219-225`. Workspace fee/operational hero-num: `--size-h1` (29px) / `--wt-display` - `periodWorkspace.css:289-297`. DayDetail total-rev: `--size-h2` (24px) / `--wt-bold` / `--accent-sc-dark` - `ops-sc.css:437-442` | **YES** (see Axis 3). Also different **color token** for the hero: overview + workspace-per-meal use `--text-success` (green-600); DayDetail uses `--accent-sc-dark` (SC-family dark). Two different greens for "the number that matters." |
| Numeric tabular discipline | PeriodCard stats: `font-variant-numeric: --num-tabular` - `season.css:750`. FullSeasonCard stat-value: `--num-tabular` - `season.css:847`. ChromeBar stats: `--num-tabular` on the cluster - `chromeBar.css:133` | Workspace frame-entered / projected / delta / hero-num / stat-value / progress-label / weeks: all `--num-tabular` - `periodWorkspace.css:224, 230, 235, 296, 333, 256, 570`. DayDetail total-meals / total-pct / total-rev / row-delta (implicitly): all `--num-tabular` - `ops-sc.css:434, 436, 441` | No divergence - tabular is applied consistently across every numeric slot on both surfaces. |
| Projected vs entered delta color | MonthCard summary-rev: `--text-muted` (projected) / `--text-success` (actual) - `season.css:391-392`. FullSeasonCard stat--muted / --actual: `--text-subtle` / `--text-success` - `season.css:855-861` | Workspace frame-entered: `--text-success` (actual green). Workspace frame-projected: `--text-muted`. Workspace frame-delta: no explicit color (was raw hex per prior PR; now `var(--text-success)` / `var(--accent-text)` via PR #313 tokens - shipped) - `periodWorkspace.css:219-236`. DayDetail total-rev: `--accent-sc-dark`; DayDetail totals--projected .total-rev: `--text-muted` - `ops-sc.css:437-449` | Overview + Workspace agree on `--text-success` / `--text-muted`. **DayDetail uses `--accent-sc-dark` for entered rev** instead of `--text-success`. That's the third green in play (see Axis 5 row 1). |
| Prefix / unit rendering | Overview stat / summary: raw JSX strings ("$" via `fmt$` helper in `PeriodCard.js` / `DayDetail.js` etc). No inline unit tokens | Same in workspace + DayDetail. `PeriodWorkspace.js:43-49` defines `fmt$` and `fmtK`; `DayDetail.js:10` defines `fmt$` | No divergence. |

---

## Axis 6 - Status / legend vocabulary

| Slot | Overview | Drilldown | Diverges? |
|---|---|---|---|
| Day-cell state (via DaySquare atom) | Overview grids render `sc-daysq--sm` with `--status-entered / -needs / -overdue / -upcoming / -off` fills through the atom - shared code path | Workspace grid renders `sc-daysq--lg` (`periodWorkspace.css:557-559`) - **same atom, larger size** | Not a gap (atom shared). |
| StateLegend key | `<StateLegend showDayNight={false}>` rendered in Season shell footer band (`SeasonShell.js:196-200`); mirrors atom fills via the token vocabulary | `<StateLegend showDayNight={true}>` rendered inside PeriodWorkspace (`PeriodWorkspace.js:206-211`) - adds day/night MiLB modifiers | Consistent. Both consume the same `StateLegend` component. |
| Chrome urgency counts | `.sc-chrome-bar-stats-count--needs { color: --status-needs-fg; }` and `--overdue { color: --status-overdue-fg; }` - `chromeBar.css:194-195`. Clickable buttons that jump to first-of-type. | (n/a - workspace doesn't repeat urgency counts; those live in the ChromeBar which sits above both views) | No divergence; workspace intentionally delegates. |
| Coaching banner (DayDetail) | (n/a) | `.sc-day-coaching { border-bottom: --border-thin solid; }` with **JSX inline-style hex tuples** supplying bg + border + color per state (`DayDetail.js:226-241`): amber `#fffbeb/#fde68a/#92400e`, red `#fef2f2/#fecaca/#dc2626`, green `#E1F5EE/#9FE1CB/#085041`, grey `#f9fafb/#e5e7eb/#6b7280`. Bulk overlay same pattern (`ServiceCalendar.js:1065`). | **YES, biggest token break in the drilldown.** These four color tuples closely approximate `--status-needs-bg/-bd/-fg`, `--status-overdue-bg/-bd/-fg`, `--status-entered-bg/-bd/-fg`, and neutral surfaces (`--surface-sunken/--border-default/--text-muted`) but consume none of them. |
| Frame urgency signals | (via ChromeBar, above) | `.sc-workspace-frame-stat--warn .value { color: --accent-text; }` - `periodWorkspace.css:335`. `.sc-workspace-frame-progress-pending { color: --accent-text; }` - `periodWorkspace.css:259`. **`--accent-text` is amber-700 (the "amber as text" role), not `--status-needs-fg` (also amber-700 today).** These resolve to the same underlying primitive today but consume different semantic tokens for the same expression. | Slight - two tokens with the same current value expressing the same "action-needed" role. |
| Today marker | Atom + overview headers use `--status-today-ring` (navy) - e.g. `season.css:317, 321-322` (MonthCard) and `season.css:634-636` (PeriodCard) | Workspace today-hero-flag / today-pill-flag use `--status-today-ring` for the pill-flag chip background - `periodWorkspace.css:363, 426`. Correct. | No divergence. |
| Progress-bar palette | MonthCard bar-fill: `--status-entered-bg` (green-300) / `--text-success` (green-600) when complete - `season.css:565-573`. PeriodCard bar-fill same - `season.css:769-777`. FullSeasonCard bar-fill: same pair - `season.css:878-886` | Workspace progress-bar-fill: **`background` is set by JSX inline `style` from `PeriodWorkspace.js:367, 486` - post PR #313 = `--status-needs-strong` / `--accent-sc`, meaning the workspace progress bar is `--accent-sc` (SC-green) not `--status-entered-bg` (green-300)** | **YES.** Overview bars are cell-state green (`--status-entered-bg`). Workspace bar is identity-green (`--accent-sc`). Same visual language, two different tokens. |

---

## Axis 7 - Border / divider treatment

| Divider | Value | `file:line` |
|---|---|---|
| Overview MonthCard header bottom | `border-bottom: var(--border-thin) solid rgba(0, 0, 0, 0.06)` (documented literal-parity with PeriodCard) | `season.css:334` |
| Overview PeriodCard header bottom | `border-bottom: var(--border-thin) solid rgba(0,0,0,0.06)` | `season.css:650` |
| Overview FullSeasonCard header bottom | `border-bottom: var(--border-thin) solid var(--surface-sunken)` | `season.css:798` |
| Overview ChromeBar bottom | `border-bottom: var(--border-thin) solid var(--border-default)` | `chromeBar.css:14` |
| Overview StateLegend top | `border-top: var(--border-thin) solid var(--border-default)` | `stateLegend.css:33` |
| Overview PeriodCard offseason opacity | `opacity: 0.78` (dim not a divider) | `season.css:638-640` |
| **Drilldown Workspace header** | (no divider - only flex spacing) | `periodWorkspace.css:116-123` |
| Drilldown Financial Frame border | `border: var(--border-thin) solid var(--border-default)` on the container itself | `periodWorkspace.css:161` |
| **Drilldown Financial Frame--upcoming left accent** | `border-left: 3px solid var(--text-subtle)` | `periodWorkspace.css:174` |
| Drilldown Today Hero border | `border: var(--border-thin) solid var(--status-off-bd)` | `periodWorkspace.css:345` |
| Drilldown Day Grid Wrap border | `border: var(--border-thin) solid var(--border-default)` | `periodWorkspace.css:516` |
| Drilldown DayDetail header bottom | `border-bottom: var(--border-thin) solid var(--surface-sunken)` | `ops-sc.css:169` |
| Drilldown DayDetail coaching bottom | `border-bottom: var(--border-thin) solid;` (color-less; supplied via inline style hex) | `ops-sc.css:185` |
| **Drilldown DayDetail group header LEFT** | `border-left: 3px solid var(--text-link)` (navy accent bar) | `ops-sc.css:216-224` |
| Drilldown DayDetail group header bottom | `border-bottom: var(--border-thin) solid var(--border-default)` | `ops-sc.css:222` |
| Drilldown DayDetail row divider | `border-bottom: 0.5px solid var(--border-subtle)` (raw 0.5px, not `--border-thin`) | `ops-sc.css:255` |
| Drilldown DayDetail footer top | `border-top: var(--border-thin) solid var(--border-default)` | `ops-sc.css:401` |

**Diverges:**
- Three different hairline-bottom vocabularies (per Axis 2): `rgba(0,0,0,0.06)`, `--surface-sunken`, `--border-default`. All three appear on card headers.
- Workspace header has no divider at all.
- **Two unique left-accent structural bars** on drilldown that have no overview analog: `.sc-day-group-header` at `3px --text-link` (navy) and `.sc-workspace-frame--upcoming` at `3px --text-subtle` (slate). Both are legitimate structural cues, but the overview never uses a left-border accent as its structural bar.
- `.sc-day-row` uses raw `0.5px` for the row divider - the only sub-pixel border on either surface. `--border-thin` (1px) is the canonical value.

---

## Axis 8 - Button / control hierarchy

| Role | Overview | Drilldown | Diverges? |
|---|---|---|---|
| **Primary "commit"** | ChromeBar toggle active: `background --action-primary-bg` (navy) / `color --action-primary-text` (white) - `chromeBar.css:53-56`. Season toggle btn active same navy. | Workspace bulk-btn--primary: `--action-primary-bg` / `--action-primary-text` - `periodWorkspace.css:489-493`. Workspace today-hero-cta: **`--accent-sc`** (SC-green) - `periodWorkspace.css:385-397`. DayDetail `.sc-btn--primary`: **`--accent-sc`** / `--surface-card` with `box-shadow: 0 1px 2px rgba(15, 110, 86, 0.18)` - `ops-sc.css:505-510`. | **YES.** Overview + Workspace bulk pick **navy** for primary. Workspace today-hero + DayDetail commit pick **SC-green** for primary. Two different primary colors on the same surface family. |
| **Secondary / outline** | ChromeBar toggle inactive: `background: transparent`, `color: --text-default` - `chromeBar.css:38-49` | Workspace bulk-btn--outline: `--surface-card` / `--text-link` (navy) / `--border-default` - `periodWorkspace.css:495-500`. DayDetail `.sc-btn--outline`: `--surface-card` / **`--accent-sc`** (green) / `--accent-sc` border - `ops-sc.css:516-521` | **YES.** Workspace outline reads as navy link; DayDetail outline reads as green. |
| **Cancel / ghost** | (n/a - overview has no cancel affordance at this hierarchy) | Workspace bulk-cancel: `transparent`, `--text-muted`, no border - `periodWorkspace.css:501-511`. DayDetail `.sc-btn--cancel`: `transparent`, `--text-subtle` - `ops-sc.css:730-733` | Slight - `--text-muted` (n-600) vs `--text-subtle` (n-500) for the same "quiet cancel" role. |
| **Min tap size (desktop)** | ChromeBar toggle-btn: no explicit min-height; consumes text padding at `--space-1 --space-4` | Workspace nav-arrow-btn: 32x32 - `periodWorkspace.css:72-82`. Workspace nav-today: `6px 14px` padding - `periodWorkspace.css:94-106`. DayDetail nav-btn + close: 32x32 - `ops-sc.css:174, 181`. DayDetail `.sc-btn`: `min-height: 40px`, `padding: --space-2 --space-5` - `ops-sc.css:490-503` | Workspace/DayDetail internal buttons at 32x32; only `.sc-btn` hits 40px. Overview relies on padding for its toggle. No hard divergence but three different height ladders in play. |
| **Focus ring** | Overview toggles + card buttons + info-btn use `outline: --focus-ring-width solid --accent-sc; outline-offset: --focus-ring-offset` or `--status-today-ring` where "you-are-here" reads better - `chromeBar.css:57-60`, `season.css:316-319, 630-633`, `stateLegend.css:*` | Workspace uses `--focus-ring-color` (navy) - `periodWorkspace.css:57-60, 90-93, 110-113, 402-405, 449-452`. DayDetail (pre-#317): NO `.sc-btn:focus-visible` at all; `.sc-day-input:focus` uses `outline: none` + box-shadow ring at raw rgba - `ops-sc.css:307-312`. **PR #317 adds focus rings but hasn't merged.** | **YES.** Overview focus rings use **`--accent-sc`** (green) or the today-ring navy. Workspace uses `--focus-ring-color` (navy). DayDetail has no focus ring on `.sc-btn` at all right now. |

---

## Axis 9 - Elevation + radius inventory

**Radius tokens actually used, per surface:**

| Token | Overview surfaces | Drilldown surfaces |
|---|---|---|
| `--radius-cell` (4px) | day-cells + collapse trigger + drill hit-box + chrome-count focus outline (`season.css:242, 351, 412`, `chromeBar.css:182`) | atom cells via DaySquare; DayDetail today-pill-flag etc (`ops-sc.css:133`; `periodWorkspace.css:365, 428` today flag) |
| `--radius-control` (10px) | (Overview cards do not use `--radius-control` on card chrome) | Workspace nav-climb / nav-arrow-btn / bulk-rest-btn / bulk-btn / today-hero-cta (`periodWorkspace.css:46, 77, 445, 485, 394`); DayDetail nav-btn / close / input / notes-input / match / extras / collapsed / btn / archived-chip (`ops-sc.css:174, 181, 276, 351, 360, 368, 382, 496, 333`) |
| `--radius-container` (10px) | `.sc-season-strip`, MonthCard, PeriodCard, FullSeasonCard, StateLegend, SeasonStepper (`season.css:28, 272, 283, 606, 613, 787`; `seasonStepper.css:*`) | DayDetail group card (`ops-sc.css:200`); dropdown menu chrome (`ops-sc.css:118`) |
| `--radius-container-lg` (14px) | ChromeBar top corners, StateLegend bottom corners, LegendInfoPopup card - see `chromeBar.css:15-16` and `stateLegend.css:33`. **Overview cards do NOT use `-lg`.** | Financial Frame, Today Hero, Day Grid Wrap, Empty / Partial banner, Workspace phase pill (raw radius on a chip), DayDetail overlay-card top, DayDetail footer bottom (`periodWorkspace.css:149, 162, 346, 517, 591, 599`; `ops-sc.css:151, 403`) |
| `--radius-pill` | Toggle, chip, today-pill, progress-bars (`season.css:170, 203, 219, 561, 766, 875`; `chromeBar.css:34, 46, 73`) | Workspace nav-step + nav-arrow-btn + nav-today + progress-bar + today-pill (`periodWorkspace.css:69, 77, 102, 264, 416`) |
| `--radius-circle` | ChromeBar asof-dot + refresh (`chromeBar.css:82, 97, 109`); MiLB pill dot | DayDetail overdue-icon + success-check (`ops-sc.css:189, 364, 475`) |

**Elevation tokens actually used, per surface:**

| Token | Overview | Drilldown |
|---|---|---|
| `--elevation-card` (`--sh-sm`) | StickyContext at narrow width (`stickyContext.css:20`) | **DayDetail group cards** (`ops-sc.css:202`); admin blocks (`ops-sc.css:567`) |
| `--elevation-raised` (`--sh-md`) | MonthCard + PeriodCard hover (`season.css:312, 627`) | admin sub-cards (`ops-sc.css:16, 573`) |
| `--elevation-popover` (`--sh-lg`) | LegendInfoPopup (`legendInfoPopup.css:33`) | DayDetail overlay card (`ops-sc.css:152`); dropdown menu (`ops-sc.css:118`) |
| **Raw (non-token) elevation** | `seasonStepper.css:178`: `0 0 0 2px --status-needs-subtle, inset 0 0 0 1px rgba(255,255,255,0.4)` (intentional white-on-amber focus segment) | `ops-sc.css:311`: `.sc-day-input:focus` box-shadow `0 0 0 3px rgba(15,110,86,0.12)` (raw, no token). `ops-sc.css:509, 514`: `.sc-btn--primary` + `:hover` raw box-shadow drop shadows. |

**Diverges:**
- Overview cards use `--radius-container` (10px) exclusively. Drilldown uses **`--radius-container-lg` (14px)** on every top-level panel (Financial Frame, Today Hero, Day Grid Wrap) AND on a chip (the workspace phase pill). Radius vocabulary is one step larger on the drilldown for the same conceptual role.
- Overview cards rest at zero elevation and get `--elevation-raised` on hover. Drilldown Financial Frame + Today Hero + Day Grid Wrap use zero elevation full-stop (no hover lift). DayDetail group cards use `--elevation-card` at rest - a shadow the overview never puts on its cards.
- DayDetail carries **three raw-rgba box-shadows** (`.sc-day-input:focus`, `.sc-btn--primary` rest + hover) that don't consume any elevation token. Overview has only the one documented raw-rgba on the amber focus-segment (SeasonStepper).

---

## Divergence summary (flat list, no directions)

Every place the drilldown consumes a different token/value/structure than the overview for the same job. `file:line` cited.

**Radius:**
- Drilldown Financial Frame + Today Hero + Day Grid Wrap use `--radius-container-lg` (14px); overview cards use `--radius-container` (10px). `periodWorkspace.css:162, 346, 517` vs `season.css:283, 613, 787`.
- Workspace phase pill uses `--radius-container-lg` (14px, a container radius) for a chip. `periodWorkspace.css:149`.
- DayDetail row uses raw `0.5px` for the row divider; canonical is `--border-thin` (1px). `ops-sc.css:255`.

**Elevation:**
- DayDetail group cards elevate at `--elevation-card` at rest; overview cards do not elevate at rest. `ops-sc.css:202` vs `season.css:278-289`.
- DayDetail carries three raw-rgba box-shadows: `.sc-day-input:focus` (`ops-sc.css:311`), `.sc-btn--primary` (`ops-sc.css:509`), `.sc-btn--primary:hover` (`ops-sc.css:514`). No overview `.sc-*-card` selector carries a raw box-shadow.
- Workspace panels never lift on hover; overview cards do (`--elevation-raised` at `season.css:312, 627`).

**Padding:**
- Workspace Financial Frame `18px 22px` (raw). `periodWorkspace.css:163`.
- Workspace Today Hero CTA / hero-num internal `28px` / `14px` and Day Grid Wrap `14px --space-4 18px` (raw). `periodWorkspace.css:281, 386-387, 518`.
- Workspace Today Hero internal gap `6px` (raw); grid gaps `6px` (raw). `periodWorkspace.css:350, 526, 538`.

**Stack rhythm:**
- Workspace inter-section gap `--space-4`. Overview month/period grids run at `--space-3`. `periodWorkspace.css:14` vs `season.css:583`.

**Header structure:**
- Overview PeriodCard header tint mechanism: inline `style={{ background: primaryPhase.tint }}` from `CANONICAL_PHASES`. Workspace phase pill mechanism: static `--status-needs-subtle` amber chip. `PeriodCard.js:71-73, 88` vs `PeriodWorkspace.js:217-224` + `periodWorkspace.css:141-150`.
- Workspace header has no hairline divider; MonthCard/PeriodCard use `rgba(0,0,0,0.06)`; FullSeasonCard + DayDetail use `--surface-sunken`. `season.css:334, 650, 798`; `ops-sc.css:169`; `periodWorkspace.css:116-123`.
- Two left-accent bars unique to drilldown: `.sc-day-group-header border-left 3px --text-link` (`ops-sc.css:223`) and `.sc-workspace-frame--upcoming border-left 3px --text-subtle` (`periodWorkspace.css:174`). Overview has no left-accent bar convention.

**Type - primary title:**
- Overview PeriodCard num at `--size-body / --wt-display` (`season.css:657-661`).
- Overview FullSeasonCard title at `--size-subhead / --wt-display` (`season.css:808-813`).
- Workspace title-period at `--size-h2 / --wt-display` (`periodWorkspace.css:130-135`).
- DayDetail title at `--size-subhead / --wt-bold` (`ops-sc.css:171`).

**Type - anchor / secondary metadata:**
- Overview PeriodCard anchor at `--size-caption` (`season.css:663-668`).
- Workspace anchor at `--size-body` (`periodWorkspace.css:136-140`).
- DayDetail account at `--size-caption` (`ops-sc.css:172`).

**Type - big hero figure:**
- Overview FullSeasonCard hero at `--size-subhead` (17px). `season.css:849-854`.
- Workspace frame-entered at `--size-display` (35px). `periodWorkspace.css:219-225`.
- Workspace frame-hero-num at `--size-h1` (29px). `periodWorkspace.css:289-297`.
- DayDetail total-rev at `--size-h2` (24px). `ops-sc.css:437-442`.

**Type - hero color:**
- Overview + Workspace-per-meal hero: `--text-success` (green-600). `season.css:853`; `periodWorkspace.css:223`.
- DayDetail total-rev + review-total-rev: `--accent-sc-dark` (SC-family dark green). `ops-sc.css:440, 470`.

**Type - eyebrow / row micro-labels:**
- DayDetail row-proj-label at `--size-caption` (12px) for what functions as an eyebrow. Overview eyebrows/micro-labels all sit at `--size-micro` (10px). `ops-sc.css:261` vs `season.css:836-842, 801-807`, `chromeBar.css:140-146`.
- DayDetail today-hero-flag (workspace) uses raw `0.08em` tracking; overview eyebrow tracking is `--track-caps` (0.06em). `periodWorkspace.css:358-366`.

**Progress-bar palette:**
- Overview bars: `--status-entered-bg` (rest) → `--text-success` (complete). `season.css:565-573, 769-777, 878-886`.
- Workspace progress bar: JSX inline `background` from `PeriodWorkspace.js:367, 486` - post-#313 = `--status-needs-strong` / `--accent-sc`. `--accent-sc` (SC green) is not `--status-entered-bg` (green-300).

**Coaching-banner colors (drilldown-only role, but token break):**
- 12 raw hex tuples inline in JSX at `DayDetail.js:226-241` + `ServiceCalendar.js:1065`. Nearest tokens: `--status-{needs/overdue/entered}-{bg/bd/fg}` for the three colored branches; `--surface-sunken/-border-default/-text-muted` for the neutral. Not consumed today.

**Frame warn colors:**
- Workspace `.sc-workspace-frame-stat--warn .value` uses `--accent-text` (`periodWorkspace.css:335`) and `.progress-pending` also `--accent-text` (`:259`). ChromeBar counts consume `--status-needs-fg` / `--status-overdue-fg` (`chromeBar.css:194-195`). Both amber-700 today, but different semantic tokens for the same "action-needed" role.

**Buttons - primary color:**
- Overview ChromeBar toggle-btn--active: `--action-primary-bg` (navy). Workspace bulk-btn--primary: same navy.
- Workspace today-hero-cta: `--accent-sc` (green). DayDetail `.sc-btn--primary`: `--accent-sc` (green). `chromeBar.css:53-56` + `periodWorkspace.css:489-493` vs `periodWorkspace.css:385-397` + `ops-sc.css:505-510`.

**Buttons - focus ring:**
- Overview cards, toggles, chrome buttons use `outline: --focus-ring-width solid --accent-sc`. `chromeBar.css:57-60, 179-183`; `season.css:353-356, 425-428`.
- Workspace buttons use `outline: --focus-ring-width solid --focus-ring-color` (navy). `periodWorkspace.css:57-60, 90-93, 110-113, 402-405, 449-452`.
- DayDetail `.sc-btn` has no `:focus-visible` rule today (`ops-sc.css:490-521`). PR #317 adds the token ring but hasn't merged.

**Overlay chrome:**
- Overview LegendInfoPopup renders via `<div role="dialog" aria-modal>` with focus-trap + Escape (`LegendInfoPopup.js:80-100`).
- Drilldown DayDetail + bulk overlays render without `role="dialog"`, `aria-modal`, `aria-labelledby`, Escape, focus-in/return-focus, or trap (`ServiceCalendar.js:1036-1067`). PR #317 adds them; not merged.

**Icons:**
- Overview inline SVGs vary in stroke-width across surfaces (2, 2.4, 3 in different files - documented in `SC_DRILLIN_ALIGNMENT_AUDIT_CC.md`). No shared local icon file.
- Drilldown same story - no shared local icon file; day-nav uses HTML entities `&#8249;` / `&#8250;` (`DayDetail.js:364, 366`), close is an inline `<svg>` (`DayDetail.js:368`), bulk close inline `<svg>` (`ServiceCalendar.js:1062`). PR #317 introduces `src/app/service-calendar/Icons.js` with a `stroke-width="1.75"` house style; not merged.

---

## Blind-spot note (things I'd measure but the prompt didn't ask)

1. **Content-region heights.** The overview period-card has `min-height: 200px` and the FullSeasonCard has `min-height: 200px` (`season.css:619, 792`). The workspace day-grid-cell-empty carries `min-height: 80px` (`periodWorkspace.css:552`) and the atom at `sc-daysq--lg` inside the workspace grid is `min-height: 96px` (`periodWorkspace.css:557-559`). Not a divergence per the axes above, but useful for chat-Claude when comparing card silhouettes to workspace panel silhouettes.

2. **Text-transform + tracking inconsistency.** `--track-caps` (0.06em) is the canonical uppercase tracking. Several drilldown surfaces use raw values close to it: `.sc-workspace-progress-label` letter-spacing not set (implicit), `.sc-workspace-today-hero-status` `letter-spacing: 0.04em` (`periodWorkspace.css:370`), `.sc-workspace-today-hero-flag` `letter-spacing: 0.08em` (`:361`). DayDetail similar: `.sc-day-review-group-name` `letter-spacing: 0.05em` (`ops-sc.css:464`). Overview mostly consumes `--track-caps` or `0.04em`. Small-value drift, easy to consolidate.

3. **`--text-link` as a structural navy.** `.sc-day-group-header` uses `--text-link` (navy-700) for its 3px left border AND for the group name text (`ops-sc.css:223, 231`). The overview never uses `--text-link` for structural chrome; it's reserved for hyperlinks or non-structural navy accents. Might be a semantic mismatch even though the color is right.

4. **StateLegend density inside workspace.** The workspace renders `StateLegend` with `showDayNight={true}` (`PeriodWorkspace.js:210`), which the overview never does at the year scope (only at the workspace). Consistent with intent; noting because chat-Claude might see two different legend lengths side-by-side and want to know why.

5. **`data-density` on the SC surface.** SC root sets `data-density="compact"`; DayDetail + bulk overlay override to `"comfortable"` (`ServiceCalendar.js:1037, 1055`). Workspace inherits Compact - meaning its `--space-card-pad` semantic is `--space-3` (12px) today. Financial Frame using raw `18px 22px` INSTEAD of `--space-card-pad` is exactly the drift this remap was designed to avoid. Same story for Day Grid Wrap padding.

6. **`sc-day-notes-input` focus.** `.sc-day-notes-input:focus` at `ops-sc.css:393` is `outline: none; border-color: var(--accent-sc);` with **no paired ring** - loses the visible focus indicator entirely for keyboard users on the notes field. Not part of the prompt's axes but worth flagging. (PR #317 fixes this too.)

7. **Motion tokens.** Both surfaces consume `var(--motion-control)` and `var(--motion-surface)` consistently through transitions. No divergence to report here.

---

## Method notes (reproducibility)

- HEAD: `5addb1b` (Merge PR #316).
- Worktree: `/Users/kevinfietek/dev/kf-parity-audit` (detached).
- PR #317 open, not merged - measured surfaces reflect PRE-#317 state.
- No code changes. No build. No commit. No PR.

Key greps (already run):
```
grep -nE "^\.sc-season-month-card\b|^\.sc-season-period-card\b|^\.sc-season-fullseason|^\.sc-workspace\b|^\.sc-day\b|^\.sc-chrome-bar|^\.sc-stepper" <files>
grep -nE "var\(--radius-[a-z-]+" <files>
grep -nE "var\(--elevation-|box-shadow" <files>
grep -nE "border-left|border-bottom.*rgba" <files>
grep -nE "font-size.*var\(--size-|font-weight.*var\(--wt-" <files>
```

Screenshot reference: `/Users/kevinfietek/Downloads/service-calendar_design-alignment_v2.html`. Not opened by this agent; kept as design-intent context for chat-Claude + Kevin. All findings above are code-grounded.
