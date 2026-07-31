# Intranet design audit - patterns for Sous V1 (read-only)

**Date:** 2026-07-31
**Source SHA:** `e7dd912` (main HEAD; worktree `docs/intranet-design-audit`)
**Method:** `[code-read]` across `src/`. Five parallel Explore agents pulled file+line citations for the eight surfaces and the seven pattern families. No screenshots consulted. **No component or CSS changes; no proposals.**

Every claim below carries file+line. The audit exists so the Sous V1 build can copy the real thing rather than approximate it.

---

## Lead - the module identity table + the Sous accent answer

| Module | Route | CSS prefix | Accent (token → hex) | Nav icon | Nav active treatment |
|---|---|---|---|---|---|
| Home | `/` | (uses shared `kf-`) | (brand-neutral - no dedicated accent) | `Home` SVG | `TopNav.css:103-111` |
| People Portal | `/people` | `pp-` | `--accent-people` → `#7C3AED` (purple) | `People` SVG | `TopNav.css:103-111` |
| Ops Hub | `/ops` | `oh-` | `--accent-ops` = `var(--amber-500)` → `#D97706` (mustard) | `Clipboard` SVG | `TopNav.css:103-111` |
| Service Calendar | `/service-calendar` | `sc-` | `--accent-sc` → `#0F6E56` (green) | `Calendar` SVG | `TopNav.css:103-111` |
| Playbook / OPD | `/playbook` | `pb-` (+ `opd-`) | `--accent-playbook` → `#0F6E56` (teal) | `Book` SVG | `TopNav.css:103-111` |
| Team Directory | `/directory` | (varies) | `--accent-directory` → `#C41E3A` (crimson) | `Directory` SVG | `TopNav.css:103-111` |
| News | (embedded in Home) | `kf-news-` / `nf-` | (brand-neutral) | (no top-nav slot) | (n/a) |
| **Sous** | `/sous` | `sa-` | **NO DEDICATED TOKEN** - uses shared navy `--kf-navy` + amber `--amber-500` underline | `Sparkle` SVG | `TopNav.css:103-111` |

**Accent tokens live in** `src/app/tokens.css:86`. The Sous prefix `sa-` is at `src/app/sous/sous.css:1-2`. The navy header + amber underline choice sits at `src/app/sous/sous.css:48`.

### Sous accent - the answer

**Sous has no accent-colour token of its own.** Every other module has a dedicated token (`--accent-people`, `--accent-ops`, `--accent-sc`, `--accent-playbook`, `--accent-directory`); Sous does not. Its current header borrows navy from the base palette and an amber underline that's already Ops Hub's colour. **This is a decision Kevin has to make** - either mint `--accent-sous` (and pick a hex), or explicitly declare Sous brand-neutral like Home + News. There is no "borrowing navy is deliberate" declaration anywhere in the code that would resolve this by default.

---

## Task 2 - hero banner pattern

**Hero implementation is per-module, not shared.** Six modules render a hero using module-specific CSS classes (`pp-hero`, `oh-hero`, `pb-hero`, `td-hero`, `sc-hero` reuses `oh-hero`, `kf-hero` on Home). The structural pattern is consistent (photographic bg, navy left-weighted gradient overlay, white bold headline + subhead) but each module wrote its own CSS block. There is no shared `<HeroBanner>` component.

### Coverage

| Module | File:line | Hero class | Right slot? |
|---|---|---|---|
| Home | `src/app/page.js:225` | `kf-hero-container` (`globals.css:90-105`) | weather badge in meta row, no right slot |
| People Portal | `src/app/people/page.js:287` | `pp-hero` (`people.css:50-71`) | none |
| Ops Hub | `src/app/ops/page.js:89` | `oh-hero` (`ops-shared.css:66-88`) | none |
| Playbook | `src/app/playbook/PlaybookClient.js:666` | `pb-hero` (`playbook.css:92-130`) | **"Build dashboard" owner-only link (`playbook.css:340-365`)** |
| Team Directory | `src/app/directory/page.js:155` | `td-hero` (`directory.css:48-61`) | none |
| Service Calendar | `src/app/service-calendar/page.js:107` | reuses `oh-hero` | none |
| **Sous** | `src/app/sous/page.js:86-92` | **`sa-header` - NAVY FIELD, NO PHOTO** | (n/a) |
| News | (embedded in Home; not a standalone module) | | |

**Sous does not have a photographic hero.** It uses `sa-header` - a navy field with an amber underline. This is the largest single visual break between Sous and every other module.

### Hero dimensions + type

| Property | People Portal | Ops Hub | Playbook | Team Directory | SC | Home |
|---|---|---|---|---|---|---|
| Height mobile | 84px | 84px | 200px min | 120px | 84px | 84px |
| Height desktop | 96px | 96px | 200px min | 120px | 96px | 96px |
| Overlay gradient | `rgba(15,48,87)` 0.95→0.78→0.32→0.18, 90deg left-weighted (`people.css:74-83`) | `rgba(15,48,87)` same, 90deg (`ops-shared.css:90-99`) | `rgba(15,23,42)` 0.62→0.42→0.78, 180deg (`playbook.css:123-129`) | `rgba(15,48,87)` 0.95→0.85→0.2, 90deg right-weighted (`directory.css:64-71`) | same as Ops | `rgba(15,23,42)` 0.1→0.85 vertical (`globals.css:117-129`) |
| Headline size | 20/24px | 20/24px | 26/36px | 28px | 20/24px | 18/22px |
| Headline weight | 800 | 800 | 800 | 800 | 800 | 800 |
| Subhead size / colour | 12/13px, white 0.88 | 12/13px, white 0.88 | 13px, white 0.78 | 14px, white 0.9 | 12/13px, white 0.88 | 11px, white 0.9 |
| Eyebrow | none | none | none | none | none | none |

### Image source

Six modules fetch hero images **from server-side pools** - either dynamic per-module tables (`hero_images`, `directory_images`) or the global `hero_images` PG table with `team_key NULL`. No static paths. Fetch happens in the module's bootstrap API (`/api/dashboard`, `/api/ops`, `/api/service-calendar`, `/api/playbook`). The image lands as a prop or state field and gets applied inline via CSS `background-image` on the hero div.

### Verbatim JSX (Ops Hub, exemplar)

```jsx
<header
  className="oh-hero"
  style={{ backgroundImage: `url(${heroImage})` }}
>
  <div className="oh-hero-overlay" />
  <div className="oh-hero-inner">
    <h1 className="oh-hero-title">Ops Hub</h1>
    <p className="oh-hero-sub">…</p>
  </div>
</header>
```

---

## Task 3 - pill-tab bar

**Only two modules use it.** People Portal and Ops Hub both put a horizontal pill-tab row on a white rounded container under the hero. Playbook uses filter dropdowns (`pb-filter-bar`, `playbook.css:399-457`) instead. Team Directory uses level filter chips (`td-chip`, `directory.css:140-160`). Service Calendar has its own chrome bar. **Sous has no pill-tab.**

### Coverage

- People Portal: `PeopleNav` at `src/components/people/PeopleNav.js:18-31`
- Ops Hub: `OpsNav` at `src/app/ops/components/OpsNav.js:18-32`

Both use identical structure with different accent tokens.

### CSS treatment table

| Property | Active | Inactive | Container |
|---|---|---|---|
| Background | People `#7c3aed` / Ops `#d97706` | transparent | white |
| Text colour | white | grey `#64748b` | (n/a) |
| Padding | 10px 28px | 10px 28px | 5px |
| Border radius | 50px (pill) | 50px | 50px |
| Font weight | 700 | 700 | (n/a) |
| Font size | 14px | 14px | (n/a) |
| Box shadow | `0 4px 12px rgba(accent, 0.3)` | none | `var(--*-shadow-sm)` |

**File+line:**
- People active: `people.css:150-154`, inactive: `people.css:131-143`, container: `people.css:120-129`
- Ops active: `ops-shared.css:155-159`, inactive: `ops-shared.css:139-151`, container: `ops-shared.css:128-137`

### Overflow

`overflow-x: auto; -webkit-overflow-scrolling: touch` on the container (`people.css:127-128`, `ops-shared.css:135-136`). Pills stay a fixed size; the container scrolls horizontally on narrow viewports. No wrap, no hide.

### Verbatim markup (People Portal)

```jsx
<div className="pp-nav-wrapper">
  <nav className="pp-nav-pill">
    {tabs.map((t) => (
      <button
        key={t.id}
        className={`pp-nav-item${activeView === t.id ? " pp-nav-item--active" : ""}`}
        onClick={() => onNavigate(t.id)}
      >
        {t.label}
      </button>
    ))}
  </nav>
</div>
```

---

## Task 4 - cards, buttons, pills

### Launchpad cards (Ops Hub, People Portal, Home)

Six card instances in `src/app/ops/components/OpsHome.js:36-235`, five in `src/components/people/DashboardView.js:43-231`. Distinct CSS prefixes, identical markup pattern.

| Property | Value | File:line |
|---|---|---|
| Container padding | 28px 24px | `ops-shared.css:183` |
| Container radius | 16px (`var(--oh-radius)`) | `ops-shared.css:182` |
| Container border | 1px solid `#e2e8f0` | `ops-shared.css:185` |
| Base shadow | `0 1px 3px rgba(15,48,87,0.04)` | `ops-shared.css:184` |
| Hover shadow | `0 12px 24px -4px rgba(217,119,6,0.12)` | `ops-shared.css:196` |
| Hover transform | `translateY(-4px)` | `ops-shared.css:194` |
| Icon-tile size | 48x48px | `ops-shared.css:230` |
| Icon-tile radius | 12px | `ops-shared.css:230` |
| Icon-tile bg | `#fffbeb` (mustard-soft) | `ops-shared.css:231` |
| Icon colour | `#d97706` (mustard) | `ops-shared.css:231` |
| Status chip: font | 11px / weight 700 | `ops-shared.css:223` |
| Status chip: padding | 8px 12px | `ops-shared.css:223` |
| Status chip: radius | 8px | `ops-shared.css:223` |

### Verbatim card JSX

```jsx
<div className="oh-card oh-card--interactive" onClick={() => onNavigate("inventory")}>
  <div className="oh-card-header-row">
    <div className="oh-icon-box oh-icon-mustard"><ClipboardIcon /></div>
  </div>
  <h3 className="oh-card-title">Inventory</h3>
  <p className="oh-card-desc">Monthly inventory counts by location.</p>
  <div className="oh-action-chips">
    <div className={`oh-chip ${F.daysUrgency(days) === "safe" ? "oh-chip-mustard" : "oh-chip-danger"}`}>
      {days < 0 ? "⚠️" : "📋"} {F.daysLabel(days)}
    </div>
  </div>
  <button className="oh-card-cta oh-card-cta--primary">
    <span>Launch Tool</span>
    <ArrowRight />
  </button>
</div>
```

### Primary / secondary buttons

| Property | Primary | Secondary/danger |
|---|---|---|
| Height (implicit) | 44px | ~34px |
| Padding | 10px 20px | 8px 16px |
| Radius | 10px | 10px |
| Font weight | 700 | 700 |
| Font size | 13px | 12px |
| Background | accent (mustard/purple) | transparent |
| Border | none | 1.5px accent-light |
| Shadow | `0 2px 8px rgba(accent, 0.25)` | none |
| Arrow suffix | separate SVG `<ArrowRight />` component with 8px gap | none |

**File+line:** `people.css:335-344` (primary), `people.css:346-358` (danger), `ops-shared.css:206-214` (primary), arrow-suffix pattern at `OpsHome.js:10-11, 65`.

**The arrow-suffix is a separate SVG, not a `→` glyph in the label text.** This matters for accessibility (aria-hidden on the SVG, actionable text in the span) and for i18n.

### Status pills

Three flavours coexist:

1. **"Live" version chip (Playbook)** - `pb-status-pill` at `playbook.css:1195-1225`. 10px font, 800 weight, 6px radius, transparent bg + 1.5px accent border. Colour comes from `STATUS_COLORS` in `_shared.js:57-63`: `Live` = bg `#a7f3d0` / text `#065f46`.

2. **Doc-status ghost badge** - same pill mechanism, inline `style` sets border + text colour per state.

3. **SC legend chips** - `oh-chip` family (`ops-shared.css:223-227`). 11px / 700 weight, 8px 12px padding, 8px radius, 1px border in family colour. Variants: `oh-chip-mustard`, `oh-chip-danger`.

### Document cards (Playbook grid) - doc-class colour map

`_shared.js:27-45` bins the 11 doc classes into 4 families:

| Family | Doc classes | Chip bg | Chip text |
|---|---|---|---|
| `gov` (governance) | STD, POL, AGR | `rgba(33, 78, 130, 0.10)` | `#214e82` (navy) |
| `proc` (procedures) | PB, SOP | `rgba(15, 110, 86, 0.10)` | `var(--kf-playbook-teal-dark)` |
| `tool` (work tools) | TPL, FORM, CHK | `rgba(193, 122, 35, 0.10)` | `#7a4a1a` (amber) |
| `ref` (reference) | POST, REF, REC | `rgba(120, 80, 35, 0.10)` | `#6b4f25` (manila) |

**File+line:** `playbook.css:1104-1107`.

### Doc card container

| Property | Value | File:line |
|---|---|---|
| Padding | 14px 14px 12px | `playbook.css:995` |
| Radius | 12px | `playbook.css:994` |
| Border | 1px `#e4e8ec` | `playbook.css:993` |
| Min height | 184px | `playbook.css:1010` |
| Hover transform | `translateY(-2px)` | `playbook.css:1033` |
| Hover shadow | `0 6px 14px rgba(15,48,87,0.1)` | `playbook.css:1034` |
| Hover border | `var(--kf-playbook-teal)` | `playbook.css:1035` |
| Title | 14px / 800 weight / navy | `playbook.css:1168-1170` |
| Description | 12.5px / grey, 2-line clamp | `playbook.css:1176-1180` |

---

## Task 5 - existing Sous entry points + the doc-detail-panel pattern

**This is the section that matters most for the slide-out. Two entry points exist and one right-side panel pattern already exists.**

### Entry point 1 - "Ask Sous" beside the Playbook hero search

**File:line:** `src/app/playbook/PlaybookClient.js:724-735`.

```jsx
<button
  type="button"
  className="pb-sous-btn"
  onClick={onOpenSous}
  aria-label="Ask Sous"
  title="Ask Sous"
>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2l2.39 4.84L20 8l-4 3.9.94 5.49L12 14.77 7.06 17.39 8 11.9 4 8l5.61-1.16z" />
  </svg>
  <span>Ask Sous</span>
</button>
```

**Style:** `pb-sous-btn` at `playbook.css:205-222`. Teal fill, white text, 12px radius, 48px min-height, `box-shadow: 0 4px 14px rgba(0,0,0,0.18)`.

**Behavior:** sets `sousOpen = true` (`PlaybookClient.js:525`).

**Context passed: NONE.** Opens a blank Ask Sous session.

### Entry point 2 - "Ask Sous about this doc" at the bottom of the doc detail panel

**File:line:** `src/app/playbook/SlideOverReader.js:360-374`.

```jsx
<button
  type="button"
  className="pb-sousai pb-sousai--live"
  onClick={() => onOpenSous(doc.id)}
  aria-label={`Ask Sous about ${doc.id}`}
  title={`Ask Sous about ${doc.id}`}
>
  <span className="pb-sousai-icon" aria-hidden="true">
    <svg width="16" height="16" viewBox="0 0 24 24" ...>
      <path d="M12 2l2.39 4.84L20 8l-4 3.9.94 5.49L12 14.77 7.06 17.39 8 11.9 4 8l5.61-1.16z" />
    </svg>
  </span>
  <span className="pb-sousai-text">Ask Sous about this doc</span>
</button>
```

**Style:** `pb-sousai--live` at `playbook.css:1754-1776`. Teal fill, white text, full-width.

**Behavior:** parent handler at `PlaybookClient.js:578-581`:
```js
onOpenSous={(docId) => {
  setSousPrefill(`In ${docId}: `);
  setSousOpen(true);
}}
```

**Context passed: YES - doc.id.** The parent prefills the Sous input with `"In {DOC-ID}: "` before opening the overlay. **This is important for the redesign** - the wire is already there; the Sous slide-out receives per-doc context today.

### The doc detail panel itself (SlideOverReader) - the candidate slide-out pattern

**Component:** `SlideOverReader` (default export) at `src/app/playbook/SlideOverReader.js:26`.

| Property | Value | File:line |
|---|---|---|
| Wrapper class | `.pb-slide` (on `<aside>`) | `SlideOverReader.js:87` |
| Width desktop | `max-width: 580px` | `playbook.css:1253` |
| Width mobile (<1024px) | `100vw` (full-viewport) | `playbook.css:1265` |
| Enter animation | `pb-slide-in 0.25s cubic-bezier(0.4, 0, 0.2, 1)` (translateX +100% → 0) | `playbook.css:1259, 1267-1268` |
| Backdrop scrim | `rgba(15, 23, 42, 0.45)`, `pb-fade-in 0.2s ease`, no blur | `playbook.css:1234-1239` |
| Header treatment | `.pb-slide-head` flex row; back button left, close × right; 12px padding | `playbook.css:1270-1276` |
| Close affordances | × button + backdrop-click + ESC key | `SlideOverReader.js:103, 71-75` |
| Scroll inside | `.pb-slide-body: flex: 1 1 auto; overflow-y: auto` + body-scroll-lock while open | `SlideOverReader.js:77-82` |
| Portal | **No portal** - inline in JSX fragment (`PlaybookClient.js:573`) | |
| Focus trap | `role="dialog" aria-modal="true"` | `SlideOverReader.js:87` |

### Verbatim enter-animation CSS

```css
@keyframes pb-slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
@keyframes pb-fade-in { from { opacity: 0; } to { opacity: 1; } }
```

### The critical structural finding

**Two right-side slide-over panels already exist and they do not share code:**

1. **`.pb-slide`** (SlideOverReader, 580px) - the document preview.
2. **`.pb-sous-panel`** (SousAIOverlay, 480px) - the current Ask Sous chat.

Both use `pb-slide-in`, both use `pb-fade-in` scrim, both stack at similar z-indices (4000 / 4001), both have ESC-key and click-to-close. **The CSS is copy-pasted** (`playbook.css:1234-1268` vs `playbook.css:2130-2150`). React render logic is separate. The Sous overlay is narrower by 100px (comment at `playbook.css:1247-1252` notes 720px overshot and rivaled the full-page reader).

**Recommendation for the redesign** (measurement, not proposal): the Sous slide-out should share the SlideOverReader shell rather than reimplement it a third time. But the shell needs to exist as a shared component first, which it currently does not.

---

## Task 6 - emoji, policy vs practice

### Policy (verbatim) - `docs/DESIGN_SYSTEM_REFERENCE.md:195-199`

```
### Emoji policy

- **OK:** Slack notifications, news feed, celebrations strip, weather badge
- **Avoid:** Primary UI labels, form fields, button labels, section headers
- Emoji acting as a primary nav icon = Lucide-replacement candidate
```

### Practice (what the code actually does)

The policy says "avoid in primary UI labels." These emoji hits are in primary UI labels:

| Emoji | Location | Category per policy |
|---|---|---|
| `📦 9D REMAINING` / `⚡ 9D REMAINING` | `src/app/ops/components/OpsHome.js:57` | UI status chip on Ops Hub card - **avoid per policy** |
| `⚠️` / `📋` | `src/app/ops/components/OpsHome.js:88` | Inventory card chip label - **avoid per policy** |
| `⚾ Homestand Planner` | `src/app/ops/components/OpsHome.js:124` | Season Tracker card chip - **avoid per policy** |
| `✨ All Caught Up` | `src/components/people/DashboardView.js:86` | People Portal status chip - **avoid per policy** |
| `📬` empty-state icon | `src/components/home/NewsFeed.js:18` | News feed empty state - **OK per policy** (news feed is in "OK" list) |

**Not resolved. Kevin rules on whether Sous uses emoji.** Four of the five hits contradict the policy directly; one is in the "OK" bucket. Either the policy is aspirational and the code is the truth, or the code violates the policy at 4/5 sites and needs cleanup. Not this PR.

---

## Task 7 - SC density + the freshness chip

### Density

| Element | Property | Value | File:line |
|---|---|---|---|
| Header bar | Padding | `var(--space-3) var(--space-4)` (~24px v) | `service-calendar/season/chromeBar.css:7-22` |
| Header bar | Border | `var(--border-thin) solid var(--border-default)` bottom | `chromeBar.css:15` |
| Header bar | Radius | `var(--radius-container-lg)` top-only | `chromeBar.css:16-17` |
| Tile (sm) | Size | `min-height: 44px` | `service-calendar/DaySquare.css:37` |
| Tile (lg) | Size | `min-height: 96px` | `DaySquare.css:52` |
| Tile | Border radius | `var(--radius-control)` | `DaySquare.css:22` |
| Right panel | Background | `var(--surface-card)` | `service-calendar/season/periodWorkspace.css:18` |
| Right panel | Border radius | `var(--radius-container)` | `periodWorkspace.css:20` |
| Right panel | Header font | `var(--size-h2) / var(--wt-bold) / tabular-nums` | `periodWorkspace.css:100` |
| Legend chip | Swatch size | 18x18px (desktop) / 12x12px (mobile) | `service-calendar/season/stateLegend.css:114-127` |
| Legend chip | Gap | `var(--space-4)` (desktop) / 6px (mobile) | `stateLegend.css:15, 114` |

### Freshness chip - the Sous provenance analogue

**This is what the audit came for.** The SC surface carries an `as of 1:55 PM` chip that is the closest existing analogue to what Sous needs for its per-answer provenance stamp.

**JSX render location:** `src/app/service-calendar/ServiceCalendar.js:2734-2736`.

```jsx
{asOf && (
  <AsOf asOf={asOf} onRefresh={handleRefresh} className="sc-hero-asof" />
)}
```

**Component:** `AsOf` at `src/app/service-calendar/season/ChromeBar.js:240-273`.

```jsx
export function AsOf({ asOf, onRefresh, className, fetchState = "fresh" }) {
  const label = formatAsOf(asOf);
  return (
    <span
      className={`sc-chrome-bar-asof ${className || ""}`.trim()}
      title={asOf.toLocaleString()}
      data-fetch-state={fetchState}
    >
      <span aria-hidden="true" className="sc-chrome-bar-asof-dot" />
      <span>{label}</span>
      {onRefresh && (
        <button
          type="button"
          className="sc-chrome-bar-asof-refresh"
          onClick={onRefresh}
          aria-label="Refresh data"
          title="Refresh data"
        >
          <svg width="12" height="12" ...><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />…</svg>
        </button>
      )}
    </span>
  );
}
```

**Timestamp formatter** at `ChromeBar.js:275-286`. Returns `as of {time}` when same-day, `as of {Mon} {DD}, {time}` otherwise.

**Style** at `service-calendar/season/chromeBar.css:91-111`:

```css
.sc-chrome-bar-asof {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
  background: var(--surface-sunken);
  border: var(--border-thin) solid var(--border-default);
  border-radius: var(--radius-pill);
  font-size: var(--size-caption);
  font-weight: var(--wt-medium);
  color: var(--text-default);
  font-variant-numeric: var(--num-tabular);
}
.sc-chrome-bar-asof-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-circle);
  background: var(--accent-sc);
  box-shadow: 0 0 0 2px var(--status-entered-subtle);
  flex-shrink: 0;
}
```

**Lifecycle:**
- Source: **load-time snapshot** at `ServiceCalendar.js:874` (`setAsOf(new Date())` after year-summary fetch succeeds).
- Display: desktop hero bottom-right; hidden on mobile (mobile carries freshness via StickyContext scroll-reveal).
- Refresh: optional `onRefresh` prop wires a user-triggered reload.
- `data-fetch-state="fresh|stale|failed"` attribute is extensible - can be re-tinted per state without JS.

**For Sous:** the AsOf component, the `formatAsOf` helper, and the `sc-chrome-bar-asof` class are the pattern to copy. Same three ingredients (green dot, tabular caption, refresh button) map cleanly to a per-answer provenance stamp. Whether it becomes `.sa-asof` or gets extracted into a shared `<Freshness>` is Kevin's call.

---

## Task 8 - design MDs vs the code reality

Reviewed the five core design docs and compared each against what the code actually does. Every doc has claim-to-code drift; the drift matters differently for Sous.

### The single biggest finding

**Sous is not in any of the five docs.** No `--accent-sous` token in the DESIGN_TOKENS enumeration. No `sa-` prefix in the DESIGN_SYSTEM_REFERENCE module list. No Sous mention in DESIGN_PRINCIPLES, DESIGN_REVIEW_PERSONA, or DESIGN_AUDIT_LEDGER. The docs represent a state where Sous either did not exist or was excluded on purpose - either way, a Sous V1 designer reading these docs would have no doc-side scaffolding to work from.

### Per-doc verdict

| Doc | Currency | Contradicts code? | Sous-relevant gaps |
|---|---|---|---|
| `DESIGN_SYSTEM_REFERENCE.md` (~13KB, 2026-05-05) | Recent, explicitly verified. Addresses the stable layer (tokens, palette, module prefixes). | **Yes.** (a) Emoji policy at lines 195-199 says "avoid emoji in primary UI labels"; code has `📦 9D REMAINING`, `⚠️`, `📋`, `⚾ Homestand Planner`, `✨ All Caught Up` as primary card-status affordances. (b) Module list at 41-51 does not include Sous. (c) Hero banner described as a stable pattern; code has 6 per-module CSS copies. (d) Right-side slide-over panels not mentioned at all. | No Sous module, no Sous accent token, no guidance on adding a new module's prefix or token set. Hero described as shared - a Sous builder reading this would inherit the antipattern. No spec for slide-over panels; Sous would reverse-engineer from code. |
| `DESIGN_PRINCIPLES.md` (~13KB, 2026-05-05) | Recent, living log with 2026-05-05 additions (dual-mode density, softened module-prefix isolation). Claims "non-negotiable" floor-first rule (mobile <1024px = Comfortable). | **Internal contradiction with REFERENCE.** PRINCIPLES doesn't forbid emoji; REFERENCE does; code sides with PRINCIPLES silently. Also claims heroes are a "protected pattern" (line 177) - code shows per-module copies. Softened notes acknowledge `oh-inv-` prefix collision as exception rather than antipattern. | No anti-patterns list. No new-module pathway. No definition of what "primary UI label" means in practice - a Sous builder has to guess whether a chat-turn footer counts. No examples of Four Gates in a real rejection. |
| `DESIGN_TOKENS.md` (~8KB) | Semi-stale in one specific way: describes the **diff from v3** rather than being the source of truth. Manual regeneration process for the HTML inventory - if `tokens.css` gets edited without regenerating, the HTML drifts. | Density-mode remapping referenced (line 112) but not spelled out. Status family has documented accessibility exceptions (amber not white-text safe) but no component-side guidance on the workaround. `--accent-sous` not in the accent-token enumeration. | Sous designer can't know whether to reuse `--accent-playbook` (teal is already Playbook), mint a new token, or ship brand-neutral like Home. Density-mode incomplete. HTML inventory stale-risk. |
| `DESIGN_REVIEW_PERSONA.md` (~9KB, 2026-05-05) | Recent, actively maintained. Density-mode review instruction added 2026-05-05. | No direct contradiction - the persona is coherent with itself. But its scope boundaries forbid "Navigation / IA overhauls" (line 56) and "Dashboard overhauls" without explicit ask. Sous V1 arguably introduces new IA (a chat surface where none existed) and new dashboard-shaped patterns (per-turn provenance stamps, source lists). The persona has no gate for those. | Written for reviewing *existing* modules. No pathway for designing a new module from scratch. No guidance on which docs to trust when they conflict. No mention of Sous. |
| `DESIGN_AUDIT_LEDGER.md` (~29KB, hyper-current) | Very active - last update 2026-07-12, post-PR #409. This is yesterday's work. | No contradiction; it's a tactical working log, not a spec. What it reveals: **design decisions are owner-ruled in review calls with Kevin, not derived from docs.** The ledger records the rulings; it doesn't create them. | SC-specific (phase timelines, PDC/MLB/MiLB, meal counts, fee logic). No equivalent ledger exists for People, Ops, Playbook, or Sous. Assumes an audit is complete; doesn't help design *in flight*. Reveals that the design docs are supporting scaffolding, not the source of truth. |

### Three broad failure modes for Sous V1

1. **Emoji policy is aspirational, not actual.** REFERENCE forbids emoji in primary labels; code adopted them as dashboard affordances (`📦 9D REMAINING`, `✨ All Caught Up`). A Sous builder reading the rule and following it would create style inconsistency with the surrounding modules; a Sous builder reading the code and copying it would create style inconsistency with the rule. Either the rule updates or the code cleans up - not this audit, but named.

2. **Sous doesn't exist in the docs.** Missing from all five. Either Sous predates the docs' "we do not document features in flight" convention, or the docs were written before Sous was on the roadmap. A Sous V1 designer opening these files would find no starting point.

3. **New-module design pathways are absent.** The docs describe how to review existing modules and what principles they follow. They don't describe how to *design a new module* from scratch - what to spec first, which decisions gate others, how to reconcile conflicting doc claims. The AUDIT_LEDGER makes plain that design decisions come out of owner review; the docs are what those decisions land into afterward.

### The pattern-actual-vs-doc drift

Two structural mismatches between docs and code that matter for the Sous slide-out:

- **Heroes described as shared, implemented per-module.** Six modules copy near-identical CSS instead of consuming a `<HeroBanner>` component. If Sous builds a new hero using shared tokens, it will still be a seventh copy - matching the antipattern rather than the doc's implied shared pattern.
- **Right-side slide-over panels described nowhere.** Two exist in code (`.pb-slide` 580px for docs, `.pb-sous-panel` 480px for the current Sous chat). The CSS is copy-pasted. Neither doc mentions the pattern at all. Sous V1 would be a third variant of the same shape unless extraction happens first.

### Not proposed here

Not proposing a `SOUS_V1_DESIGN_SPEC.md` bridging doc. Not proposing an emoji-policy reconciliation. Not proposing a shared `<HeroBanner>` extraction or a `<SlideOverPanel>` extraction. Kevin rules on all four.

---

## What this audit did not answer

- **Sous's accent-colour choice.** Named the gap; the pick is Kevin's.
- **Whether emoji use in `oh-card` / People `pp-card` status chips is a violation to clean up or a policy that needs updating.** Named the contradiction; not resolved.
- **Whether the two right-side panels should share code.** Recorded the copy-paste; refactor decision is out of scope.
- **The full News module surface.** News is embedded in Home rather than a route; treated as a component rather than a module here.
- **Any V2 or planned redesign work in the audit branches.** Only current `main` (SHA `e7dd912`) was read.
