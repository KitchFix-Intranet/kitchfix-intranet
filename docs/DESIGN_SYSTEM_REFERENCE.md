# Design System Reference - KitchFix Ops Hub

> **Purpose:** Single source of truth for tokens, palette, roles, scales, and system facts. Used by humans coding solo and by AI assistants doing design review. When this disagrees with the actual repo, the repo wins - but the disagreement should be flagged and reconciled.
>
> **Last verified:** 2026-05-05
> **Verified against:** `globals.css`, `src/app/api/ops/route.js`, `src/app/service-calendar/`, `src/app/api/people/route.js`, `package.json`
> **Refresh cadence:** Quarterly, or whenever a token/role changes
> **Companion docs:** `DESIGN_REVIEW_PERSONA.md`, `DESIGN_PRINCIPLES.md`

---

## Stack

- **Framework:** Next.js 16, React 19
- **Auth:** NextAuth + Google OAuth
- **Backend:** Google Sheets (five-pillar architecture - see `ARCHITECTURE.md`)
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

Lucide is **not yet installed**. Current icons are inline SVG (~70 files) plus emoji ad hoc (`WeatherBadge.js`, `NewsFeed.js`, celebrations strip). Migration is **opportunistic**, not sweeping - when a module is being touched, swap its inline SVGs to Lucide as part of that work.

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