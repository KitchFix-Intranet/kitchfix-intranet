# Design System Reference - KitchFix Ops Hub

> **Purpose:** Single source of truth for tokens, palette, roles, scales, and system facts. Used by humans coding solo and by AI assistants doing design review. When this disagrees with the actual repo, the repo wins - but the disagreement should be flagged and reconciled.
>
> **Last verified:** 2026-08-07
> **Verified against:** `tokens.css`, `globals.css`, `src/app/api/ops/route.js`, `src/app/service-calendar/`, `src/app/api/people/route.js`, `package.json`, `docs/MIGRATION_PROJECT_CLOSEOUT.md`
> **Refresh cadence:** Quarterly, or whenever a token/role changes
> **Companion docs:** `DESIGN_REVIEW_PERSONA.md`, `DESIGN_PRINCIPLES.md`

---

## Stack

- **Framework:** Next.js 16, React 19
- **Auth:** NextAuth + Google OAuth
- **Backend:** Sheets + Postgres dual data layer. Six modules cut over to Postgres with Sheets dual-write as the rollback net (News, Directory, People-submissions, Vendor, Invoice, Playbook/OPD). New features build Postgres-native via `dataStore` orchestrators. See `MIGRATION_PROJECT_CLOSEOUT.md` for the six modules' state and `ARCHITECTURE.md` for the dual-layer shape. The five-pillar Google Sheets architecture remains for Labor, Financial (proxy retired), Legacy Inv Count, Service Calendar, Incidents, and Leadership Dugout. **Design tokens live in `src/app/tokens.css`**, imported by `globals.css` - not in `globals.css` itself.
- **Drive/Sheets writes:** Service account `kitchfix-sheets@speedy-actor-487922-p4.iam.gserviceaccount.com` - never user OAuth
- **AI:** Anthropic Claude API (Invoice OCR, Smart Inventory matching)
- **Hosting:** Vercel Pro
- **Crons:** Vercel cron + Railway (inventory nightly)
- **CSS:** Vanilla CSS with module-prefixed classes (primary). Tailwind v4 is imported in `globals.css` as utility backstop only - do not expand its usage.

---

## Brand & color

> Canonical values live in `src/app/tokens.css`; the system is documented in
> `docs/DESIGN_TOKENS.md`. This section is a usage guide only - do not duplicate values
> here.

---

## Typography

> Canonical values live in `src/app/tokens.css`; the system is documented in
> `docs/DESIGN_TOKENS.md`. This section is a usage guide only - do not duplicate values
> here.

---

## Module CSS prefixes (strict isolation - never cross-contaminate)

| Module | Prefix | Theme |
|---|---|---|
| People Portal | `pp-` | Purple |
| Vendor Portal | `oh-vp-` | Ops Hub navy/amber |
| Inventory Manager | `oh-inv-mgmt-` | Ops Hub navy/amber |
| Service Calendar | `sc-` | Ops Hub navy/amber |
| Team Directory | (varies - Cardinals red theme) | Cardinals red |
| News Feed | `kf-news-` | Brand neutral |

---

## Spacing scale

> Canonical values live in `src/app/tokens.css`; the system is documented in
> `docs/DESIGN_TOKENS.md`. This section is a usage guide only - do not duplicate values
> here.

---

## Shell width scale (SC v2)

Canvas widths for the Service Calendar v2 surfaces. Published as `:root` tokens with the
`--sc2-` prefix so they never collide with v1 module widths (which stay bound by `.oh-bound`'s
1024px max-width in `ops-shared.css`).

| Token | Value | Consumer |
|---|---|---|
| `--sc2-shell-max` | `1520px` | Overview + drill two-pane shells (`.oh-bound:has(.scv2)` override) |
| `--sc2-entry-max` | `1240px` | DayEntryV2 overlay card (`.sc-overlay-backdrop:has(.sc-v2-entry) .sc-overlay-card`) |

Values chosen to give v2 the working canvas the render frames imply (~1440-1600 workspace) while
preserving Decision 7 zoom posture (`SC_REDESIGN_PROGRAM_SCOPE.md` §17): at 150% display scaling
the compact fit still lands with zero horizontal scroll, because the two-pane rail-stacks below
1280 CSS px and 1535 physical × 150% = 1023 CSS px which is below that breakpoint. Wider maxima
stop binding on small effective viewports, they don't overflow them.

Every non-v2 Ops Hub module keeps `.oh-bound`'s 1024px byte-identically. Flag OFF for SC also
uses the shared 1024px (no `.scv2` descendant → `:has(.scv2)` doesn't match).

---

## Radius scale

> Canonical values live in `src/app/tokens.css`; the system is documented in
> `docs/DESIGN_TOKENS.md`. This section is a usage guide only - do not duplicate values
> here.

---

## Elevation

> Canonical values live in `src/app/tokens.css`; the system is documented in
> `docs/DESIGN_TOKENS.md`. This section is a usage guide only - do not duplicate values
> here.

---

## Motion

> Canonical values live in `src/app/tokens.css`; the system is documented in
> `docs/DESIGN_TOKENS.md`. This section is a usage guide only - do not duplicate values
> here.

---

## Z-index

> Canonical values live in `src/app/tokens.css`; the system is documented in
> `docs/DESIGN_TOKENS.md`. This section is a usage guide only - do not duplicate values
> here.

---

## Density modes - Density and Comfortable

The Ops Hub has two density modes. Every module declares one as its default; individual surfaces inside a module can override.

### When to use which mode

> *Is this surface for triage/scanning/comparison (Density) or for single-task work that should forgive interruption (Comfortable)? When unsure, default to the module's mode.*

**Density** - director and admin surfaces. Tight type, tight spacing, table-friendly, more information per viewport. Calibrate against Linear and Ramp.

**Comfortable** - floor user, HR, onboarding, single-task forms. Generous type, generous spacing, forgiving padding, scaffolding for stress and interruption. Calibrate against Notion onboarding and Toast/Square POS entry.

### Mobile override (non-negotiable)

**Any viewport <1024px renders Comfortable tokens, regardless of module assignment.** Floor-first overrides density on phones - the cooler-test wins.

Implementation: media-query gate in each module's CSS, or a `data-density` attribute on the page root that flips at `min-width: 1024px`.

### Module assignments

**Density default:**
- Vendor Portal
- Inventory Manager (catalog/admin surfaces)
- Service Calendar (month admin view)
- Invoice Capture (admin queue)
- Season Tracker
- Analytics
- Leadership Dugout *(when built)*
- Calibration Queue *(when built)*

**Comfortable default:**
- People Portal dashboard
- Incident Reporting
- New Hire Wizard
- PAF Form
- Action Center submitter view
- Team Directory
- Home dashboard
- Login

**Surface-level overrides** (where a module default is overridden inside the module):

| Surface | Module default | This surface uses |
|---|---|---|
| Action Center admin queue | Comfortable | Density |
| People Portal Admin Queue | Comfortable | Density |
| Inventory count flow | Density | Comfortable |
| Invoice submission upload (chef side) | Density | Comfortable |
| Service Calendar day detail entry | Density | Comfortable |

The general rule: **lists and queues take density; forms and entry take comfortable, even inside a density module.**

### Token tables

> Canonical values live in `src/app/tokens.css`; the system is documented in
> `docs/DESIGN_TOKENS.md`. This section is a usage guide only - do not duplicate values
> here.

### CSS variable structure

> Canonical values live in `src/app/tokens.css`; the system is documented in
> `docs/DESIGN_TOKENS.md`. This section is a usage guide only - do not duplicate values
> here.

---

## Iconography

### Standard: Lucide React

- Single icon library going forward.
- Install: `npm install lucide-react`
- Stroke weight: 1.5 (default), 2 only for emphasis or large sizes
- Size scale: 14 (inline) / 16 (UI default) / 20 (buttons) / 24 (headers) / 32 (hero, empty state)

### Migration status

Lucide is **installed** (`lucide-react` in `package.json`) but **not yet adopted** - as of 2026-07 there are zero Lucide imports in the app; current icons are inline SVG (~70 files) plus emoji ad hoc (`WeatherBadge.js`, `NewsFeed.js`, celebrations strip). Migration is **opportunistic**, not sweeping - when a module is being touched, move its inline SVGs to Lucide, or to a scoped per-module icon file, as part of that work.

### Emoji policy

- **OK:** Slack notifications, news feed, celebrations strip, weather badge
- **Avoid:** Primary UI labels, form fields, button labels, section headers
- Emoji acting as a primary nav icon = Lucide-replacement candidate

### Photography & illustration

- **Photography:** Team Directory account cards only. No stock photography in ops tools.
- **Illustration:** Minimal. Empty states use icon + text, not illustrations.
- **Pre-Service Materials (print):** Exception - has its own illustration system using Mulish font.

### Logos

PFS Navy/White × Circle/Horizontal/Vertical files exist in `public/`. Use the right variant for the right surface. Never stretch, never recolor outside the brand book.

---

## Roles & permissions

The system uses Google OAuth via NextAuth. Middleware redirects unauthenticated users to `/login`. All Drive/Sheets writes go through the service account.

### Permission tiers (breadth: widest → narrowest)

**1. Authenticated User** - any `@kitchfix.com` Google account
- Read most views, submit forms, see own history, cancel/withdraw own requests

**2. Module Admins** - allowlists vary by tool

| Allowlist | Defined in | Members | Gates |
|---|---|---|---|
| `OPS_LEADERSHIP_EMAILS` | `src/app/api/ops/route.js` | k.fietek, a.wasserman, britt, joe, josh, m.chavez, s.lynch | Ops admin tabs, Vendor Admin, Labor cross-account, Invoice Admin |
| Service Calendar admin | `src/app/service-calendar/ServiceCalendar.js`, `ServiceConfig.js` | k.fietek, joe | Service config, calendar admin actions |
| People Portal admin | Sheet-driven (`admins` tab in HUB sheet, HR sub-flag in column C) | Configured in sheet | PAF approvals, HR-sensitive views (HR flag) |

**3. System Admin** - `k.fietek@kitchfix.com` only
- Analytics dashboard (`src/app/api/analytics/route.js`)

**Service Account** - `kitchfix-sheets@speedy-actor-487922-p4.iam.gserviceaccount.com`
- Not a user role. All Drive/Sheets writes route through this. Never use user OAuth tokens for writes.

When designing admin surfaces, **always check the actual allowlist before assuming**. Don't hardcode emails for People Portal - that's sheet-driven.

---

## Browser & device matrix

### Desktop

- **Chrome only**, latest 2 versions
- 1280×800 minimum / 1440×900 typical / 1920×1080 supported
- Don't optimize for Safari / Firefox / Edge desktop

**Height fit-floor.** Design target is 1280×800. The **720px height floor** is the lowest viewport at which a landing surface (hero + rail + first-run + composer) must render with zero vertical scroll. Below 720 the landing scrolls gracefully - nothing breaks, but the "everything in view" contract lapses. The sweep battery for any new landing checks 800/768/720 tall at each width in the laptop matrix. Answers scroll naturally at every height.

### Mobile

- **iOS Safari** (last 2 major versions)
- **Android Chrome** (last 2 major versions)
- iPhone SE (375×667) is the **narrow case test** - works there → works
- Tablets: not optimized; should not break

### Walk-in cooler reality

Worst-case wifi, 4G fallback, gloved fingers, screen glare. Performance and contrast budgets reflect this.

---

## Data volumes (rough - confirm when sharper data matters)

| Surface | Volume |
|---|---|
| Accounts | 8+ active, growing |
| Vendors per account | Dozens to low hundreds |
| Invoices per week per active account | Dozens |
| Action Center items | Variable, spikes during homestands |
| Service Calendar | ~180 service days per MLB account per season |
| Inventory items per account | Hundreds, growing |
| PAF / HR actions | Low volume, high stakes |

Patterns that work for 12 rows must also work for 1,200. If a pattern only works small, flag it. When exact volumes would change a recommendation (pagination, virtualization, search behavior), surface the question rather than guess.

---

## Reference anchors (calibrate against these)

| Product | When to reference |
|---|---|
| **Linear** | Density + keyboard + restraint. Director dashboards, Action Center admin queue, Vendor Portal lists. |
| **Notion** | Flexible structure, content-forward. Recipe / spec / briefing surfaces, onboarding flows. |
| **Toast / Square POS** | Kitchen utility, big tap targets, time pressure. Service Calendar day-detail entry, Inventory count flow, mobile-floor screens. |
| **Ramp / Brex** | Financial clarity, audit-grade tables, document-centric. Invoice Capture queue, AP queue, GL coding, Analytics. |
| **Resy host stand / OpenTable manager** | Operational pace, pre-service mindset. Homestand/season views. |

A recommendation should be locatable: *"This is closer to Toast than Linear - wrong for a director."* If a pattern doesn't fit any anchor, ask whether it belongs in the Ops Hub at all.

---

## Slack notification channels

- `#opshub-inventory-submissions`
- `#opshub-invoice-submissions`
- `#opshub-vendors`
- `#intranet-recap`

When a design choice could be reinforced by Slack notification quality, call it out.

---

## Localization

- **UI:** English only. No i18n on roadmap.
- **Pre-Service Materials (print/PDF):** Bilingual EN/ES, native Spanish speaker validation pending. Out of scope for screen UI reviews.

---

## Captain's log

*Add additions to system reference here with date and a one-line note on what prompted the change.*

- **2026-05-05** - Initial reference documented. Tokens, palette, roles, scales captured.
- **2026-05-05** - Dual-mode density rule added (Density / Comfortable). Inter locked as canonical screen typeface; Mulish demoted to print/PDF only. Type scale, spacing scale, radius, and card padding now live inside per-mode tables. Mobile override (<1024px = comfortable) added as non-negotiable rule. Module assignments and surface-level overrides documented. Reference anchors retuned to mode-specific guidance.
- **2026-08-01** - Height fit-floor codified. 720px is the lowest viewport at which a landing surface must render without vertical scroll; sweep battery height axis 800/768/720 named. Sous PR A polish pass is the first surface to bind against it. Design target restated as 1280×800.
- **2026-08-07** - Backend note corrected: the intranet is on a Sheets + Postgres dual data layer, not Sheets-only. Six modules cut over to Postgres with Sheets dual-write per `MIGRATION_PROJECT_CLOSEOUT.md`. Design-token location corrected: canonical tokens live in `src/app/tokens.css`, not in `globals.css`. Verified-against note bumped and `tokens.css` + `MIGRATION_PROJECT_CLOSEOUT.md` added to the verification sources. Prompted by PR B1 doc-drift review (kpi-8b).

<!-- GENERATED:reference START - do not edit by hand, run scripts/gen_design_docs.mjs -->
> Generated from the module stylesheets. Run `node scripts/gen_design_docs.mjs` to refresh. Prose outside this marker is hand-maintained.

### Namespaced token sets (per-module identity)

**`--sc2-*`** (188 declarations)

*Scope `:root`:* 11 tokens
*Scope `.scv2`:* 177 tokens

| Token | Scope | Value |
|---|---|---|
| `--sc2-band-cream-bg` | `:root` | #F5F0E4 |
| `--sc2-band-cream-bd` | `:root` | #E6DEC9 |
| `--sc2-band-cream-ink` | `:root` | #6B5B32 |
| `--sc2-accent-green-ink` | `:root` | #0A2416 |
| `--sc2-cmd-band-bg` | `:root` | #E7EEF8 |
| `--sc2-accent-red-bright` | `:root` | #E8635A |
| `--sc2-accent-amber-bright` | `:root` | #E5A054 |
| `--sc2-accent-amber-ink` | `:root` | #2B1A05 |
| `--sc2-shell-max` | `:root` | 1520px |
| `--sc2-entry-max` | `:root` | 1240px |
| `--sc2-canvas` | `:root` | #edeff2 |
| `--sc2-scale` | `.scv2` | 0.9 |
| `--sc2-size-micro` | `.scv2` | calc(clamp(9.5px,  calc(8.27px  + 0.12vw), 10px)  * var(-... |
| `--sc2-size-caption` | `.scv2` | calc(clamp(11px,   calc(8.54px  + 0.24vw), 12px)  * var(-... |
| `--sc2-size-body` | `.scv2` | calc(clamp(12.5px, calc(8.81px  + 0.36vw), 14px)  * var(-... |
| `--sc2-size-subhead` | `.scv2` | calc(clamp(15px,   calc(10.08px + 0.48vw), 17px)  * var(-... |
| `--sc2-size-h3` | `.scv2` | calc(clamp(17.5px, calc(11.35px + 0.60vw), 20px)  * var(-... |
| `--sc2-size-h2` | `.scv2` | calc(clamp(21px,   calc(13.62px + 0.72vw), 24px)  * var(-... |
| `--sc2-size-h1` | `.scv2` | calc(clamp(25px,   calc(15.15px + 0.96vw), 29px)  * var(-... |
| `--sc2-size-display` | `.scv2` | calc(clamp(29px,   calc(14.23px + 1.44vw), 35px)  * var(-... |
| `--sc2-size-rail-total` | `.scv2` | calc(clamp(26px,   calc(13.69px + 1.20vw), 31px)  * var(-... |
| `--sc2-space-1` | `.scv2` | calc(clamp(3px,    calc(0.54px  + 0.24vw), 4px)   * var(-... |
| `--sc2-space-2` | `.scv2` | calc(clamp(6px,    calc(1.08px  + 0.48vw), 8px)   * var(-... |
| `--sc2-space-3` | `.scv2` | calc(clamp(9px,    calc(1.62px  + 0.72vw), 12px)  * var(-... |
| `--sc2-space-4` | `.scv2` | calc(clamp(12px,   calc(2.15px  + 0.96vw), 16px)  * var(-... |
| `--sc2-space-5` | `.scv2` | calc(clamp(15px,   calc(2.69px  + 1.20vw), 20px)  * var(-... |
| `--sc2-space-6` | `.scv2` | calc(clamp(18px,   calc(3.23px  + 1.44vw), 24px)  * var(-... |
| `--sc2-space-7` | `.scv2` | calc(clamp(24px,   calc(4.31px  + 1.92vw), 32px)  * var(-... |
| `--sc2-space-8` | `.scv2` | calc(clamp(30px,   calc(5.38px  + 2.40vw), 40px)  * var(-... |
| `--sc2-radius-cell` | `.scv2` | 6px |
| `--sc2-radius-control` | `.scv2` | 9px |
| `--sc2-radius-container` | `.scv2` | 11px |
| `--sc2-radius-pill` | `.scv2` | 9999px |
| `--sc2-border-thin` | `.scv2` | 1px |
| `--sc2-border-medium` | `.scv2` | 1.5px |
| `--sc2-radius-card` | `.scv2` | 12px |
| `--sc2-radius-modal` | `.scv2` | 14px |
| `--sc2-radius-tile` | `.scv2` | 8px |
| `--sc2-font-ui` | `.scv2` | var(--font-ui) |
| `--sc2-font-mono` | `.scv2` | var(--font-mono) |
| `--sc2-wt-regular` | `.scv2` | 400 |
| `--sc2-wt-medium` | `.scv2` | 500 |
| `--sc2-wt-semibold` | `.scv2` | 600 |
| `--sc2-wt-bold` | `.scv2` | 700 |
| `--sc2-wt-display` | `.scv2` | 800 |
| `--sc2-surface` | `.scv2` | #f7f8fa |
| `--sc2-surface-card` | `.scv2` | #ffffff |
| `--sc2-surface-page` | `.scv2` | #e8e3d8 |
| `--sc2-surface-app` | `.scv2` | #f7f3ea |
| `--sc2-surface-band` | `.scv2` | #efe9dc |
| `--sc2-surface-sunken` | `.scv2` | #f0ede4 |
| `--sc2-ink-strong` | `.scv2` | #122238 |
| `--sc2-ink` | `.scv2` | #1f2d3d |
| `--sc2-ink-muted` | `.scv2` | #697077 |
| `--sc2-ink-soft` | `.scv2` | var(--sc2-ink) |
| `--sc2-ink-inverse` | `.scv2` | #ffffff |
| `--sc2-cmd-bg` | `.scv2` | #1a3050 |
| `--sc2-cmd-bg-deep` | `.scv2` | #122238 |
| `--sc2-cmd-text` | `.scv2` | #ffffff |
| `--sc2-cmd-text-muted` | `.scv2` | #c8d4e2 |
| `--sc2-cmd-meta` | `.scv2` | #b7c4d4 |
| `--sc2-cmd-pill-text` | `.scv2` | #eef2f7 |
| `--sc2-cmd-pill-border` | `.scv2` | rgba(255,255,255,0.22) |
| `--sc2-cmd-pill-hover-bg` | `.scv2` | rgba(255,255,255,0.07) |
| `--sc2-rail-bg` | `.scv2` | #15273c |
| `--sc2-rail-bg-shade` | `.scv2` | #23405f |
| `--sc2-rail-divider` | `.scv2` | #1c3149 |
| `--sc2-rail-border` | `.scv2` | #2c4867 |
| `--sc2-rail-text` | `.scv2` | #e8edf3 |
| `--sc2-rail-text-strong` | `.scv2` | #eafff2 |
| `--sc2-rail-text-item` | `.scv2` | #c9d7e8 |
| `--sc2-rail-text-muted` | `.scv2` | #aebfd4 |
| `--sc2-rail-text-subtle` | `.scv2` | #7f95af |
| `--sc2-rail-text-section` | `.scv2` | #88a5c2 |
| `--sc2-rail-text-ghost` | `.scv2` | #7391b5 |
| `--sc2-rail-accent-success` | `.scv2` | #8fd6ab |
| `--sc2-rail-accent-warn` | `.scv2` | #f2d49a |
| `--sc2-rail-accent-active` | `.scv2` | #9dc7e8 |
| `--sc2-rail-flag-bg` | `.scv2` | rgba(242,212,154,0.14) |
| `--sc2-rail-focus-halo` | `.scv2` | rgba(143,214,171,0.24) |
| `--sc2-toast-bg` | `.scv2` | #101B2D |
| `--sc2-toast-fg-mute` | `.scv2` | #8FA3C4 |
| `--sc2-toast-fg-bright` | `.scv2` | #D6E0F0 |
| `--sc2-toast-track` | `.scv2` | rgba(255,255,255,0.16) |
| `--sc2-rail-card-bg` | `.scv2` | #1c3450 |
| `--sc2-rail-cta-bg` | `.scv2` | #37a866 |
| `--sc2-rail-cta-bg-hover` | `.scv2` | #2f7d4f |
| `--sc2-rail-cta-text` | `.scv2` | #04220f |
| `--sc2-rail-cta-quiet-border` | `.scv2` | #2c4867 |
| `--sc2-rail-cta-quiet-text` | `.scv2` | #c4d3e5 |
| `--sc2-state-entered-bg` | `.scv2` | #a9dfc0 |
| `--sc2-state-entered-bd` | `.scv2` | #5cbf8b |
| `--sc2-state-entered-fg` | `.scv2` | #14532d |
| `--sc2-state-entered-strong` | `.scv2` | #14532d |
| `--sc2-state-upcoming-bg` | `.scv2` | #dff2e7 |
| `--sc2-state-upcoming-bd` | `.scv2` | #b9e2cc |
| `--sc2-state-upcoming-fg` | `.scv2` | #3e6b52 |
| `--sc2-state-needs-bg` | `.scv2` | #fcecc7 |
| `--sc2-state-needs-bd` | `.scv2` | #e4b45e |
| `--sc2-state-needs-fg` | `.scv2` | #7a5a17 |
| `--sc2-state-needs-fg-strong` | `.scv2` | #5c4310 |
| `--sc2-state-away-bg` | `.scv2` | #e3dded |
| `--sc2-state-away-fg` | `.scv2` | #544e66 |
| `--sc2-state-overdue-bg` | `.scv2` | #f8d9d3 |
| `--sc2-state-overdue-bd` | `.scv2` | #dd8a7b |
| `--sc2-state-overdue-fg` | `.scv2` | #8a3a2c |
| `--sc2-state-in-progress-bg` | `.scv2` | #1e5aa8 |
| `--sc2-state-in-progress-fg` | `.scv2` | #ffffff |
| `--sc2-state-off-bg` | `.scv2` | #f1f0ec |
| `--sc2-state-off-bd` | `.scv2` | transparent |
| `--sc2-state-off-fg` | `.scv2` | #8f8b80 |
| `--sc2-state-failed-bg` | `.scv2` | #fdf1ee |
| `--sc2-state-failed-bd` | `.scv2` | #d98070 |
| `--sc2-state-failed-fg` | `.scv2` | #a03b28 |
| `--sc2-state-loading-bg` | `.scv2` | #f1ede2 |
| `--sc2-state-loading-shimmer` | `.scv2` | #ddd7ca |
| `--sc2-today-ring` | `.scv2` | #1a3050 |
| `--sc2-selected-ring` | `.scv2` | #2f7d4f |
| `--sc2-focus-ring` | `.scv2` | #1a3050 |
| `--sc2-chip-pdc-bg` | `.scv2` | #3d5a80 |
| `--sc2-chip-pdc-fg` | `.scv2` | #dfe9f5 |
| `--sc2-chip-mlb-bg` | `.scv2` | #e9b45b |
| `--sc2-chip-mlb-fg` | `.scv2` | #4a3308 |
| `--sc2-chip-milb-bg` | `.scv2` | #cffafe |
| `--sc2-chip-milb-fg` | `.scv2` | #155e75 |
| `--sc2-chip-flat-bg` | `.scv2` | #e8edf3 |
| `--sc2-chip-flat-fg` | `.scv2` | #3f5169 |
| `--sc2-chip-flat-bd` | `.scv2` | #a9b6c6 |
| `--sc2-phase-off-bg` | `.scv2` | #eee9dd |
| `--sc2-phase-st-bg` | `.scv2` | #f3ddc4 |
| `--sc2-phase-st-fg` | `.scv2` | #8a5426 |
| `--sc2-phase-ext-bg` | `.scv2` | #dbe5ee |
| `--sc2-phase-ext-fg` | `.scv2` | #3f5169 |
| `--sc2-phase-cx-bg` | `.scv2` | #cfe0da |
| `--sc2-phase-cx-fg` | `.scv2` | #2f5c4a |
| `--sc2-phase-br-bg` | `.scv2` | #e8d9c2 |
| `--sc2-phase-br-fg` | `.scv2` | #7a5a22 |
| `--sc2-phase-ins-bg` | `.scv2` | #e6dcec |
| `--sc2-phase-ins-fg` | `.scv2` | #5d4a72 |
| `--sc2-phase-camp-bg` | `.scv2` | #f0e6cf |
| `--sc2-phase-camp-fg` | `.scv2` | #7a5a22 |
| `--sc2-phase-now-underline` | `.scv2` | var(--sc2-cmd-bg) |
| `--sc2-accent-amber` | `.scv2` | #a9761f |
| `--sc2-accent-copper` | `.scv2` | #c15b2e |
| `--sc2-accent-copper-wash` | `.scv2` | #f9efe9 |
| `--sc2-accent-copper-line` | `.scv2` | #e3c4b1 |
| `--sc2-accent-green` | `.scv2` | #2f7d4f |
| `--sc2-accent-green-deep` | `.scv2` | #1f6b41 |
| `--sc2-accent-green-bright` | `.scv2` | #37a866 |
| `--sc2-accent-green-wash` | `.scv2` | #f1f9f4 |
| `--sc2-accent-green-line` | `.scv2` | #cae3d6 |
| `--sc2-accent-red-deep` | `.scv2` | #8a3a2c |
| `--sc2-accent-red-mid` | `.scv2` | #b85440 |
| `--sc2-accent-red-line` | `.scv2` | #dd8a7b |
| `--sc2-accent-red-wash` | `.scv2` | #f8d9d3 |
| `--sc2-mark-gameday` | `.scv2` | var(--sc2-cmd-bg) |
| `--sc2-mark-spring` | `.scv2` | #b0722c |
| `--sc2-line` | `.scv2` | #eae4d6 |
| `--sc2-line-2` | `.scv2` | #e2dccd |
| `--sc2-ghost` | `.scv2` | #a49c8a |
| `--sc2-el-widget` | `.scv2` | 0 2px 8px rgba(18,34,56,0.08), 0 12px 32px rgba(18,34,56,... |
| `--sc2-el-card` | `.scv2` | 0 1px 3px rgba(18,34,56,0.08), 0 2px 8px rgba(18,34,56,0.05) |
| `--sc2-el-hover` | `.scv2` | 0 2px 6px rgba(18,34,56,0.10), 0 6px 16px rgba(18,34,56,0... |
| `--sc2-el-inset` | `.scv2` | 0 1px 2px rgba(18,34,56,0.04), 0 1px 4px rgba(18,34,56,0.03) |
| `--sc2-elevation-card` | `.scv2` | var(--sc2-el-card) |
| `--sc2-elevation-raised` | `.scv2` | 0 3px 8px rgba(18,34,56,0.10), 0 24px 64px rgba(18,34,56,... |
| `--sc2-elevation-inset-top` | `.scv2` | inset 0 1px 0 rgba(255,255,255,0.4) |
| `--sc2-ph-spring` | `.scv2` | #d3b06a |
| `--sc2-ph-ext` | `.scv2` | #9db8c9 |
| `--sc2-ph-complex` | `.scv2` | #78a892 |
| `--sc2-ph-bridge` | `.scv2` | #c9986f |
| `--sc2-ph-instr` | `.scv2` | #a58fc0 |
| `--sc2-ph-off` | `.scv2` | #b9b3a6 |
| `--sc2-period-wash` | `.scv2` | rgba(26,48,80,0.05) |
| `--sc2-today-ring-width` | `.scv2` | 2px |
| `--sc2-mobile-bar-h` | `.scv2` | 60px |
| `--sc2-mobile-footer-h` | `.scv2` | 116px |
| `--sc2-size-micro` | `.scv2` | calc(11px * var(--sc2-scale)) |
| `--sc2-size-caption` | `.scv2` | calc(12px * var(--sc2-scale)) |
| `--sc2-size-body` | `.scv2` | calc(14px * var(--sc2-scale)) |
| `--sc2-size-subhead` | `.scv2` | calc(15px * var(--sc2-scale)) |
| `--sc2-size-h3` | `.scv2` | calc(18px * var(--sc2-scale)) |
| `--sc2-size-h2` | `.scv2` | calc(20px * var(--sc2-scale)) |
| `--sc2-size-h1` | `.scv2` | calc(24px * var(--sc2-scale)) |
| `--sc2-size-display` | `.scv2` | calc(30px * var(--sc2-scale)) |
| `--sc2-size-rail-total` | `.scv2` | calc(30px * var(--sc2-scale)) |
| `--sc2-control-h` | `.scv2` | calc(36px * var(--sc2-scale)) |
| `--sc2-control-h-icon` | `.scv2` | calc(32px * var(--sc2-scale)) |

**`--opd-*`** (106 declarations)

*Scope `:root`:* 25 tokens
*Scope `.opd-frame`:* 16 tokens
*Scope `.opd-app`:* 65 tokens

| Token | Scope | Value |
|---|---|---|
| `--opd-r-1` | `:root` | 4px |
| `--opd-r-2` | `:root` | 8px |
| `--opd-r-3` | `:root` | 12px |
| `--opd-r-4` | `:root` | 16px |
| `--opd-r-5` | `:root` | 20px |
| `--opd-r-pill` | `:root` | 9999px |
| `--opd-font-display` | `:root` | 'Oswald', 'Inter', sans-serif |
| `--opd-font-body` | `:root` | 'Inter', sans-serif |
| `--opd-display` | `:root` | 36px |
| `--opd-h1` | `:root` | 26px |
| `--opd-h2` | `:root` | 18px |
| `--opd-h3` | `:root` | 16px |
| `--opd-body` | `:root` | 15px |
| `--opd-caption` | `:root` | 12.5px |
| `--opd-micro` | `:root` | 10px |
| `--opd-wt-regular` | `:root` | 400 |
| `--opd-wt-semibold` | `:root` | 600 |
| `--opd-wt-bold` | `:root` | 700 |
| `--opd-wt-display` | `:root` | 800 |
| `--opd-leading-body` | `:root` | 1.6 |
| `--opd-sky` | `:root` | #7DB9D5 |
| `--opd-anchor` | `:root` | #C4E3E8 |
| `--opd-teal` | `:root` | var(--kf-playbook-teal) |
| `--opd-teal-dark` | `:root` | var(--kf-playbook-teal-dark) |
| `--opd-teal-light` | `:root` | var(--kf-playbook-teal-light) |
| `--opd-cmd-bg` | `.opd-frame` | var(--n-900) |
| `--opd-chip-bg` | `.opd-frame` | var(--navy-50) |
| `--opd-chip-bg-hover` | `.opd-frame` | var(--navy-100) |
| `--opd-chip-fg` | `.opd-frame` | var(--text-link) |
| `--opd-class-gov-bg` | `.opd-frame` | rgba(33, 78, 130, 0.08) |
| `--opd-class-gov-bd` | `.opd-frame` | rgba(33, 78, 130, 0.22) |
| `--opd-class-gov-fg` | `.opd-frame` | #214e82 |
| `--opd-class-proc-bg` | `.opd-frame` | rgba(15, 110, 86, 0.08) |
| `--opd-class-proc-bd` | `.opd-frame` | rgba(15, 110, 86, 0.22) |
| `--opd-class-proc-fg` | `.opd-frame` | var(--opd-teal-dark) |
| `--opd-class-tool-bg` | `.opd-frame` | rgba(193, 122, 35, 0.09) |
| `--opd-class-tool-bd` | `.opd-frame` | rgba(193, 122, 35, 0.24) |
| `--opd-class-tool-fg` | `.opd-frame` | #7a4a1a |
| `--opd-class-ref-bg` | `.opd-frame` | rgba(120, 80, 35, 0.09) |
| `--opd-class-ref-bd` | `.opd-frame` | rgba(120, 80, 35, 0.24) |
| `--opd-class-ref-fg` | `.opd-frame` | #6b4f25 |
| `--opd-t-label` | `.opd-app` | 10px |
| `--opd-t-meta` | `.opd-app` | 11px |
| `--opd-t-ui` | `.opd-app` | calc(12px * var(--kf-scale)) |
| `--opd-t-ctl` | `.opd-app` | calc(13px * var(--kf-scale)) |
| `--opd-t-h3` | `.opd-app` | calc(14px * var(--kf-scale)) |
| `--opd-t-read` | `.opd-app` | 15px |
| `--opd-t-hero` | `.opd-app` | calc(23px * var(--kf-scale)) |
| `--opd-t-h2` | `.opd-app` | calc(25px * var(--kf-scale)) |
| `--opd-sp-1` | `.opd-app` | calc(4px  * var(--kf-scale)) |
| `--opd-sp-2` | `.opd-app` | calc(9px  * var(--kf-scale)) |
| `--opd-sp-3` | `.opd-app` | calc(15px * var(--kf-scale)) |
| `--opd-sp-4` | `.opd-app` | calc(22px * var(--kf-scale)) |
| `--opd-sp-5` | `.opd-app` | calc(28px * var(--kf-scale)) |
| `--opd-rail-w` | `.opd-app` | calc(242px * var(--kf-scale)) |
| `--opd-measure` | `.opd-app` | calc(640px * var(--kf-scale)) |
| `--opd-ease` | `.opd-app` | cubic-bezier(0.2, 0.9, 0.3, 1) |
| `--opd-t-fast` | `.opd-app` | 0.14s |
| `--opd-t-mid` | `.opd-app` | 0.28s |
| `--opd-t-slow` | `.opd-app` | 0.44s |
| `--opd-n50` | `.opd-app` | #FAFBFC |
| `--opd-n100` | `.opd-app` | #F5F7FA |
| `--opd-n200` | `.opd-app` | #EEF1F5 |
| `--opd-n300` | `.opd-app` | #E5E7EB |
| `--opd-n400` | `.opd-app` | #B8C2CF |
| `--opd-n500` | `.opd-app` | #94A3B8 |
| `--opd-n600` | `.opd-app` | #64748B |
| `--opd-n700` | `.opd-app` | #475569 |
| `--opd-n800` | `.opd-app` | #334155 |
| `--opd-n900` | `.opd-app` | #0A2548 |
| `--opd-navy` | `.opd-app` | #153968 |
| `--opd-navy50` | `.opd-app` | #EEF3F9 |
| `--opd-grn` | `.opd-app` | #16A34A |
| `--opd-grnbg` | `.opd-app` | #E8F6EE |
| `--opd-grnbd` | `.opd-app` | #BFE7CD |
| `--opd-grnfg` | `.opd-app` | #0B7A3E |
| `--opd-amb` | `.opd-app` | #D97706 |
| `--opd-ambbg` | `.opd-app` | #FBF3E3 |
| `--opd-ambbd` | `.opd-app` | #EFD9AC |
| `--opd-ambfg` | `.opd-app` | #8A5209 |
| `--opd-gov` | `.opd-app` | #214E82 |
| `--opd-govbg` | `.opd-app` | rgba(33, 78, 130, 0.08) |
| `--opd-govbd` | `.opd-app` | rgba(33, 78, 130, 0.22) |
| `--opd-chrome` | `.opd-app` | 215px |
| `--opd-teal` | `.opd-app` | #0F6E56 |
| `--opd-tealsub` | `.opd-app` | #E1F5EE |
| `--opd-pur` | `.opd-app` | #7C3AED |
| `--opd-purbg` | `.opd-app` | #F4EFFE |
| `--opd-purbd` | `.opd-app` | #DDCDFB |
| `--opd-govbg2` | `.opd-app` | rgba(33, 78, 130, 0.09) |
| `--opd-govbd2` | `.opd-app` | rgba(33, 78, 130, 0.24) |
| `--opd-procbg` | `.opd-app` | rgba(15, 110, 86, 0.09) |
| `--opd-procbd` | `.opd-app` | rgba(15, 110, 86, 0.24) |
| `--opd-toolbg` | `.opd-app` | rgba(193, 122, 35, 0.11) |
| `--opd-toolbd` | `.opd-app` | rgba(193, 122, 35, 0.28) |
| `--opd-tool` | `.opd-app` | #8A5209 |
| `--opd-sh-1` | `.opd-app` | 0 1px 2px rgba(10, 37, 72, 0.06), 0 10px 26px -10px rgba(... |
| `--opd-sh-2` | `.opd-app` | 0 1px 2px rgba(10, 37, 72, 0.04) |
| `--opd-sh-3` | `.opd-app` | 0 1px 2px rgba(10, 37, 72, 0.05), 0 6px 18px -6px rgba(10... |
| `--opd-t-row` | `.opd-app` | calc(13.5px * var(--kf-scale)) |
| `--opd-t-hero2` | `.opd-app` | calc(26px * var(--kf-scale)) |
| `--opd-t-h2b` | `.opd-app` | calc(20px * var(--kf-scale)) |
| `--opd-rail-w2` | `.opd-app` | calc(284px * var(--kf-scale)) |
| `--opd-gut` | `.opd-app` | 11px |
| `--opd-lead` | `.opd-app` | 44px |
| `--opd-lmax` | `.opd-app` | min(520px, calc(100vh - 330px)) |

**`--kpi-*`** (58 declarations)

*Scope `:root`:* 5 tokens
*Scope `.kpi-app`:* 53 tokens

| Token | Scope | Value |
|---|---|---|
| `--kpi-accent` | `:root` | var(--n-700) |
| `--kpi-accent-strong` | `:root` | var(--n-800) |
| `--kpi-accent-tint` | `:root` | var(--navy-50) |
| `--kpi-accent` | `:root` | var(--navy-700) |
| `--kpi-accent-tint` | `:root` | var(--navy-50) |
| `--kpi-t-label` | `.kpi-app` | calc(10px   * var(--kf-scale)) |
| `--kpi-t-meta` | `.kpi-app` | calc(11px   * var(--kf-scale)) |
| `--kpi-t-body` | `.kpi-app` | calc(12.5px * var(--kf-scale)) |
| `--kpi-t-medium` | `.kpi-app` | calc(15px   * var(--kf-scale)) |
| `--kpi-t-value` | `.kpi-app` | calc(20px   * var(--kf-scale)) |
| `--kpi-t-hero` | `.kpi-app` | calc(28px   * var(--kf-scale)) |
| `--kpi-size-title` | `.kpi-app` | calc(18px   * var(--kf-scale)) |
| `--kpi-size-caption` | `.kpi-app` | calc(11px   * var(--kf-scale)) |
| `--kpi-size-ctl` | `.kpi-app` | calc(12.5px * var(--kf-scale)) |
| `--kpi-sp-1` | `.kpi-app` | calc(4px    * var(--kf-scale)) |
| `--kpi-sp-2` | `.kpi-app` | calc(8px    * var(--kf-scale)) |
| `--kpi-sp-3` | `.kpi-app` | calc(12px   * var(--kf-scale)) |
| `--kpi-sp-4` | `.kpi-app` | calc(16px   * var(--kf-scale)) |
| `--kpi-sp-5` | `.kpi-app` | calc(20px   * var(--kf-scale)) |
| `--kpi-sp-6` | `.kpi-app` | calc(24px   * var(--kf-scale)) |
| `--kpi-h-lane` | `.kpi-app` | calc(20px   * var(--kf-scale)) |
| `--kpi-h-control` | `.kpi-app` | var(--kpi-ctl) |
| `--kpi-h-plot` | `.kpi-app` | calc(84px   * var(--kf-scale)) |
| `--kpi-h-arc` | `.kpi-app` | calc(68px   * var(--kf-scale)) |
| `--kpi-h-dvg` | `.kpi-app` | calc(12px   * var(--kf-scale)) |
| `--kpi-h-bullet` | `.kpi-app` | calc(8px    * var(--kf-scale)) |
| `--kpi-h-sig` | `.kpi-app` | calc(168px  * var(--kf-scale)) |
| `--kpi-ctl` | `.kpi-app` | calc(30px   * var(--kf-scale)) |
| `--kpi-row` | `.kpi-app` | calc(40px   * var(--kf-scale)) |
| `--kpi-row-2l` | `.kpi-app` | calc(48px   * var(--kf-scale)) |
| `--kpi-ctl-r` | `.kpi-app` | calc(8px    * var(--kf-scale)) |
| `--kpi-card-r` | `.kpi-app` | calc(12px   * var(--kf-scale)) |
| `--kpi-card-pad` | `.kpi-app` | calc(16px   * var(--kf-scale)) |
| `--kpi-lane-head` | `.kpi-app` | calc(20px   * var(--kf-scale)) |
| `--kpi-lane-hero` | `.kpi-app` | calc(38px   * var(--kf-scale)) |
| `--kpi-lane-sub` | `.kpi-app` | calc(16px   * var(--kf-scale)) |
| `--kpi-lane-viz` | `.kpi-app` | calc(58px   * var(--kf-scale)) |
| `--kpi-ctl-h` | `.kpi-app` | var(--kpi-ctl) |
| `--kpi-cmd-h` | `.kpi-app` | calc(60px   * var(--kf-scale)) |
| `--kpi-row-h` | `.kpi-app` | var(--kpi-row) |
| `--kpi-thead-h` | `.kpi-app` | var(--kpi-ctl) |
| `--kpi-band-h` | `.kpi-app` | calc(52px   * var(--kf-scale)) |
| `--kpi-wk-item-h` | `.kpi-app` | var(--kpi-ctl) |
| `--kpi-tbar-ctl-h` | `.kpi-app` | var(--kpi-ctl) |
| `--kpi-tbar-gap-in` | `.kpi-app` | var(--kpi-sp-2) |
| `--kpi-tbar-gap-out` | `.kpi-app` | var(--kpi-sp-5) |
| `--kpi-tbar-rad` | `.kpi-app` | 7px |
| `--kpi-folio-w` | `.kpi-app` | calc(260px  * var(--kf-scale)) |
| `--kpi-vb-bar` | `.kpi-app` | calc(58px   * var(--kf-scale)) |
| `--kpi-vb-delta` | `.kpi-app` | calc(72px   * var(--kf-scale)) |
| `--kpi-plot-b` | `.kpi-app` | calc(140px  * var(--kf-scale)) |
| `--kpi-plot-c` | `.kpi-app` | calc(150px  * var(--kf-scale)) |
| `--kpi-gauge2-w` | `.kpi-app` | calc(150px  * var(--kf-scale)) |
| `--kpi-gauge2-h` | `.kpi-app` | var(--kpi-h-arc) |
| `--kpi-lpill-h` | `.kpi-app` | calc(22px   * var(--kf-scale)) |
| `--kpi-blue-500` | `.kpi-app` | #3E97D1 |
| `--kpi-blue-100` | `.kpi-app` | #E4F1FA |
| `--kpi-purple-600` | `.kpi-app` | #7A3E9D |

**`--kf-*`** (3 declarations)

*Scope `:root`:* 1 tokens
*Scope `.kpi-app`:* 1 tokens
*Scope `.opd-app`:* 1 tokens

| Token | Scope | Value |
|---|---|---|
| `--kf-scale` | `:root` | 1 |
| `--kf-scale` | `.kpi-app` | 0.9 |
| `--kf-scale` | `.opd-app` | 0.9 |

### Font stacks in use

| Token | Value |
|---|---|
| `--font-ui` | 'Inter',-apple-system,system-ui,sans-serif |
| `--font-body` | 'Inter',-apple-system,system-ui,sans-serif |
| `--font-mono` | 'JetBrains Mono','SF Mono',Menlo,monospace |

### Type scale (root) with resolved values

**Type sizes**

| Token | Value |
|---|---|
| `--size-micro` | 10px |
| `--size-caption` | 12px |
| `--size-body` | 14px |
| `--size-subhead` | 17px |
| `--size-h3` | 20px |
| `--size-h2` | 24px |
| `--size-h1` | 29px |
| `--size-display` | 35px |

**Weights**

| Token | Value |
|---|---|
| `--wt-regular` | 400 |
| `--wt-medium` | 500 |
| `--wt-semibold` | 600 |
| `--wt-bold` | 700 |
| `--wt-display` | 800 |

**Leading + tracking**

| Token | Declared | Resolved |
|---|---|---|
| `--lb-caption` | calc(16/12) | calc(16/12) |
| `--lb-h3` | calc(24/20) | calc(24/20) |
| `--lb-h2` | calc(32/24) | calc(32/24) |
| `--lb-hero` | calc(40/35) | calc(40/35) |
| `--lead-tight` | 1.1 | 1.1 |
| `--lead-snug` | 1.25 | 1.25 |
| `--lead-normal` | 1.5 | 1.5 |
| `--track-tight` | -0.01em | -0.01em |
| `--track-caps` | 0.06em | 0.06em |
<!-- GENERATED:reference END -->
