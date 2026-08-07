# KPI Dashboard Design Spec - Labor surface

> **Purpose:** The locked starting design spec for the KPI Dashboard page and its Labor
> section. Build from this. Where it disagrees with the repo, the repo wins and the
> disagreement gets flagged as a P2 doc-drift item.
>
> **Status:** LOCKED 2026-08-07. Kevin approved. Changes require a new revision and a
> captain's log entry.
> **Visual reference:** `kpi-dashboard-labor-v3.html` prototype, plus the six adjustments in
> §8 which are part of this spec and are **not** in that prototype.
> **Companion docs:** `DESIGN_PRINCIPLES.md`, `DESIGN_SYSTEM_REFERENCE.md`,
> `DESIGN_REVIEW_PERSONA.md`, `DESIGN_TOKENS.md`, `KPI_DASHBOARD_PLAYBOOK.md`

---

## 1. Scope

**In:** the KPI Dashboard page shell, its in-page navigation, and the Labor section end to
end - filters, table, right rail, all seven states, both viewports.

**Out:** the Overview tab's content design, the Food / Other COGS / Revenue / P&L sections,
and anything about how figures are derived. Derivation is governed by the playbook and by
D33-D39.

---

## 2. Information architecture - three navigation layers

**Layer 1 - global top nav.** The existing white pill bar. Home, People, Ops Hub, Service,
Playbook, Sous, Directory. KPI is added as a peer. Active state is the pale blue pill
(`#e8f0fe` background, `#1a56c4` text) already used by Service.

**Layer 2 - module command bar.** The `--sc2-cmd` navy bar, same primitive Service Calendar
uses. Carries the module title, the **account selector**, fiscal context (Today / Period /
Week), a derive-freshness chip, and export plus re-run icon buttons.

The account selector lives here, not in the filters, because it scopes the entire page.
Changing it changes every tab.

**Layer 3 - in-page tabs.** The Ops Hub pill strip. Overview, Labor, Food, Other COGS,
Revenue, P&L. Unbuilt sections render at 45% opacity with a `soon` chip and are
non-interactive. Horizontally scrollable below 1024px.

**The KPI Dashboard is per-account and Overview is its landing tab.** Labor is a section
within it, never a standalone destination.

---

## 3. Page anatomy

```
┌─ global top nav ────────────────────────────────────────────┐
├─ command bar (navy) - title | account | context | actions ──┤
├─ tab strip - Overview | Labor | ...                         │
├──────────────────────────────────┬──────────────────────────┤
│ filters                          │ FY-to-date figure        │
│ metric cards                     │ alarms                   │
│ period-grouped table             │ pipeline health          │
│                                  │ coverage + legend        │
└──────────────────────────────────┴──────────────────────────┘
```

Main column and rail are `minmax(0,1fr) 320px`. Below 1024px the rail moves **above** the
main column, because its alarms matter more on a small screen than the table does.

Page max width is `--sc2-shell-max` (1520px).

---

## 4. Density

Density (compact) on desktop. This is a director financial surface; the reference doc puts
Analytics in Density and anchors it to Ramp and Brex.

Implemented as `[data-density="compact"]` on the page root, matching `tokens.css:223`.
**Comfortable is the base; compact is opt-in.** A `matchMedia("(min-width:1024px)")` listener
sets the attribute, so any viewport under 1024px renders Comfortable. That is the
non-negotiable mobile override, not a nice-to-have.

---

## 5. Coverage states - the load-bearing taxonomy

Five states. Every one is encoded by **badge label, badge icon, and row tint** - never color
alone.

| State | Meaning | Badge | Row |
|---|---|---|---|
| `complete` | Every entry has dollars | green, check | default |
| `partial` | Some entries have no pay segment | white, info circle | amber tint |
| `hours_only` | Before the 2026-04-20 floor (D35) | amber fill, clock | amber tint |
| `no_labor` | Real zero - nobody worked | neutral, minus | `--fill-off` |
| `unknown` | No successful presence walk | white, warning | red tint |

**Red is reserved for `unknown` only.** That is a system error, not a data gap. Amber carries
every gap state. This follows the principle that red means instructional danger, never
decoration.

### The three empty markers must stay distinct

| Rendering | Means |
|---|---|
| `—` | Bucket empty this week. Not zero |
| `0.00` | Genuinely zero |
| `?` | Unknown - we have no basis for a figure |

This distinction is the reason the surface exists. The shipped CIN-OH report collapsed all
three into `0.00` and understated hours by 39.91. **Do not let a future tidy-up merge them.**

---

## 6. Table columns

`Week of | Coverage | Regular | OT 1.5x | Holiday 2x | No dollars | Dollars`

Hours split by pay-rate bucket per D37. `No dollars` is the hours we know about with no
dollar path - the 42,036 hours that previously rendered as zero. It is a separate column, not
folded into any rate bucket, because those hours have no known rate class.

`hours_toward_ot_threshold` is **derived, never stored**. Holiday hours count toward the
weekly 40 (measured, R3 P6.2), so a chef reading regular hours alone will mis-forecast
overtime.

Expandable week rows reveal per-worker detail. Workers are surrogate employee numbers.
**Names are never rendered** unless Kevin explicitly asks for a real labor report.

Every dollar figure is a Rippling pay-segment amount. **No surface computes hours times rate,
ever** (D27).

---

## 7. Right rail

Four blocks, in this order:

1. **FY-to-date figure** with a completeness bar. Big number, `--size-display` weight 700.
2. **Alarms.** Freshness first, then unknown weeks, then hours-without-dollars. Left-rail
   accent primitive, 4px border, success / warning / danger.
3. **Pipeline health.** Orphan facts, unmapped earning types, segment and entry counts, week
   source. Orphan and unmapped counts are D36 and D37 signals - a nonzero value is a finding.
4. **Coverage counts with inline explanations.** See §8.4.

The rail is modelled on Service Calendar's SEASON BOOKS plus NEEDS ENTRY rail, which is a
protected pattern.

---

## 8. The six locked adjustments

**These are part of the spec and are not in the v3 prototype.** Build them.

### 8.1 Group weeks under fiscal periods

The table groups by fiscal period with a subtotal row per period, the way Service Calendar
subtotals each month. Three reasons: directors think in periods, the P&L that PR 2 brings is
period-grain so this is the join surface, and 17 weeks is a scroll while 156 weeks over three
seasons is unusable.

### 8.2 Collapse whole-row states to a single spanning cell

A `no_labor` row currently prints `0.00` five times. An `unknown` row prints `?` five times.
One fact stated five ways reads as noise, and five question marks falsely imply we might know
part of it.

Both collapse to one spanning cell: **"No labor recorded"** and **"No presence walk covers
this week."**

### 8.3 Give metric cards a visible border

`--surface-sunken` on a white panel does not separate. Add `1px solid var(--border-subtle)`
so they read as objects, matching the Ops Hub launchpad cards.

### 8.4 Merge the legend into the rail's coverage card

The bottom legend panel and the rail's coverage counts are the same five badges twice. Merge
them: coverage counts carry the explanations, the bottom panel is removed.

This still satisfies the visible-legend non-negotiable for tracker screens, removes the
duplication, and gives the rail content past row 12 where it currently runs empty.

### 8.5 Replace the Unattributed metric card with budget and variance

It shows `$0.00` and the Pipeline rail already reports orphans and unmapped types. Reserve
that slot for **budget and variance**, which is the actual point of a KPI dashboard and is
not yet on this surface. Reserve it before column widths lock.

### 8.6 Narrow the No dollars column

Twelve dashes and three numbers is a lot of horizontal space. Narrow it, or move the warning
glyph into the Dollars cell and let "not in Rippling" carry the meaning.

---

## 9. All seven states

Every one ships. No exceptions.

| State | Treatment |
|---|---|
| Loading | Skeleton rows matching final layout, no spinner, no layout shift |
| Empty first-time | Explains what appears here and how to start |
| Empty filtered | Names what is hidden and offers a one-tap clear |
| Partial | The `partial` coverage state |
| Error | What happened, that nothing changed, and a retry. Never a raw exception string |
| Success | Toast, never a modal |
| Offline / stale | Rail alarm with the last successful derive time |

Add an eighth in practice: **salaried-only accounts** (CIN-KY, TBJ-NY per D26) render an
explanatory state, not an empty table.

---

## 10. Accessibility - WCAG 2.2 AA, non-negotiable

- Expandable rows are real `<button>` elements with `aria-expanded`. **No `<tr onclick>`.**
- Tap targets 48px Comfortable, 36px compact, via a `--tap` token.
- Every state encoded by label plus icon plus tint. Never color alone.
- Visible `:focus-visible` ring at 2px `--navy-700`, offset 2px.
- `prefers-reduced-motion` honored on every transition.
- Real table semantics with `<caption>`, `scope="col"`, and a `<thead>`.

---

## 11. Mobile - the cooler case

**Tables become cards below 1024px. Never a horizontal-scroll table.**

Card carries week, coverage badge, and dollars in the header; the four hour buckets as
key-value rows; worker detail on expand. Rail moves above the table. Tab strip scrolls
horizontally. Global nav collapses to a burger.

375px is the narrow-case test.

---

## 12. Implementation constraints

- **CSS prefix `kpi-`.** Every class. No bare `.rail`, `.btn`, `.card`.
- **Consume `tokens.css`. Never redeclare.** A raw hex or px in a component is a High finding.
  The prototype redeclares tokens only because it is a standalone file.
- Vanilla CSS. No Tailwind expansion, no new UI dependencies.
- Icons: inline SVG at stroke 1.5, consistent with the ~70 files already doing this. Lucide
  is the documented standard but has zero adoption; migrate opportunistically, not here.
- No emoji in primary UI.

---

## 13. Open rulings - needed before this ships, not before it is built

1. **KPI module accent.** Ops is amber, People purple, Directory Cardinals red, Playbook and
   Service green, Sous flame. `tokens.css` has no financial accent. Navy-700 is the
   placeholder and reads correctly for a financial surface, but it leaves KPI as the only
   module without its own identity, and color-coded orientation is a protected pattern.
2. **KPI as a top-level nav item.** This touches IA, which is out of scope for design review
   without an explicit ask.
3. **Account selector scope.** Page-level or app-wide? A director switching accounts probably
   wants Service Calendar to follow.
4. **Overview tab content.** Its own design conversation, and it is the default view.
5. **Budget source** for the variance slot in §8.5. Budgets have a resolution order in
   playbook §4.5; actuals do not.

---

## 14. Captain's log

- **2026-08-07** - Initial spec locked. Built from three prototype rounds reviewed against
  `DESIGN_PRINCIPLES.md`, `DESIGN_SYSTEM_REFERENCE.md`, and `DESIGN_REVIEW_PERSONA.md`, then
  corrected against screenshots of the live intranet. Two P0s from round one (horizontal
  scroll tables on mobile, non-keyboard-accessible rows) are fixed and encoded here as
  requirements. The v1 and v2 chrome assumed a left rail that does not exist; the real
  pattern is top nav plus module command bar plus in-page tabs, and that is what §2 records.
