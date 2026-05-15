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

### Canonical navy: `#153968`

This is the only valid navy. Two existing values in the codebase are **drift to be corrected**, not parallel valid options:

| Location | Current value | Action |
|---|---|---|
| `globals.css` `--kf-navy` | `#0f3057` | **Drift** - update to `#153968` |
| Ops Hub dark navy | `#0b1d35` | **Drift** - update to `#153968`, OR document as deliberate dark variant if a darker navy is genuinely needed |

When proposing CSS, always use `#153968` for navy unless a different value is explicitly called out. Flag any non-canonical navy as P2 polish.

### PFS brand palette (customer-facing, Team Directory)

- Navy: `#153968`
- Sky Blue: `#C4E3E8`
- Red: `#E53530`

### Ops Hub palette (internal tools)

- Brand Navy: `#153968`
- Amber: `#d97706` / `#D97706`
- Neutral grays

### CSS variables (from `globals.css`)

css--kf-navy: #0f3057    /* DRIFT - should be #153968 */
--kf-blue: #2563eb
--kf-gold: #fbbf24
--kf-green: #10b981
--kf-red: #ef4444
--kf-purple: #6366f1
--kf-bg: #f0f4f8
--kf-border: #e2e8f0
--kf-card: #ffffff
--kk-teal: #0d9488
--kf-mustard: #fbbf24
--kf-mustard-light: #fffbeb
--kf-mustard-text: #92400e

---

## Typography

- **Screen UI (both density modes):** Inter (weights 400 / 600 / 800)
- **Print / PDF only (Pre-Service Materials):** Mulish (weights 400 / 700)
- Both loaded via Google Fonts in `globals.css`

**Mulish is demoted from screen.** All screen UI uses Inter regardless of density mode. Mulish remains canonical for the print/PDF pipeline (Pre-Service Materials) only. If you find Mulish on a screen surface, that's drift to fix.

Type scale lives inside the density mode tables below - there is no single screen type scale. See "Density modes."

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

Spacing values live inside the density mode tables below. Both modes can pull wider values (32 / 48 / 64) when hero/section breathing room is needed - the per-mode tables show the common case, not a ceiling.

---

## Radius scale

Radius values live inside the density mode tables below. Modal and pill values are mode-independent:

| Element | Value (both modes) |
|---|---|
| Modal | 12 |
| Pill | 999 |

---

## Elevation

| Level | Shadow |
|---|---|
| flat | none |
| card | 1–2px |
| modal | 8–12px |
| overlay | 16px+ |

---

## Motion

- Default: 150ms ease-out
- Layout shifts: 250ms
- Never exceed 400ms
- Always respect `prefers-reduced-motion`

---

## Z-index

**Current state in repo: chaotic.** 20+ different values across the codebase, no enforced scale. Common clusters: `1`, `2`, `10`, `100`, `1000`, `9999`. Z-index normalization is a known **P2 system-wide cleanup** - log once, not per module.

### Target scale (use for all new work)

| Value | Lane |
|---|---|
| 0 | Base |
| 10 | Sticky elements |
| 100 | Dropdowns |
| 1000 | Modals |
| 10000 | Toasts, overlays |

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

#### Type scale - Inter only

| Role | Density | Comfortable |
|---|---|---|
| Caption / metadata / label | 11 | 12 |
| Body small / table cell | 13 | 14 |
| Body (default reading) | 14 | 16 |
| Body emphasis / h3 | 16 | 18 |
| h2 / section head | 20 | 24 |
| h1 / hero | 24 | 32 |
| Line height - body | 1.3 | 1.5 |
| Line height - headings | 1.15 | 1.2 |

11px is reserved for table column headers and metadata labels. Never body.

#### Spacing scale

| Density | Comfortable |
|---|---|
| 4 / 8 / 12 / 16 / 20 / 24 | 8 / 12 / 16 / 24 / 32 / 48 |

Wider values (32 / 48 / 64) are available in both modes for hero/section breathing room. The table is the common case, not a ceiling.

#### Radius

| Element | Density | Comfortable |
|---|---|---|
| Card | 8 | 12 |
| Input / button | 4 | 8 |
| Modal | 12 | 12 |
| Pill | 999 | 999 |

#### Card padding

| Card type | Density | Comfortable |
|---|---|---|
| List / queue card | 12 | 24 |
| Content card | 16 | 24 |
| Hero / feature card | 20 | 32 |

#### Tap targets (mode-independent)

| Viewport | Minimum tap target |
|---|---|
| Desktop (≥1024px) | 32×32 |
| Tablet (768–1023px) | 48×48 |
| Phone (<768px) | 48×48 |

### CSS variable structure

Both mode token sets live in `globals.css`, gated by `data-density` attribute on the page root or module root:

css[data-density="compact"] {
--type-caption: 11px;
--type-body-sm: 13px;
--type-body: 14px;
--type-emphasis: 16px;
--type-h2: 20px;
--type-h1: 24px;
--line-body: 1.3;
--line-heading: 1.15;
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--radius-card: 8px;
--radius-input: 4px;
--pad-card-list: 12px;
--pad-card-content: 16px;
--pad-card-hero: 20px;
}[data-density="comfortable"] {
--type-caption: 12px;
--type-body-sm: 14px;
--type-body: 16px;
--type-emphasis: 18px;
--type-h2: 24px;
--type-h1: 32px;
--line-body: 1.5;
--line-heading: 1.2;
--space-1: 8px;
--space-2: 12px;
--space-3: 16px;
--space-4: 24px;
--space-5: 32px;
--space-6: 48px;
--radius-card: 12px;
--radius-input: 8px;
--pad-card-list: 24px;
--pad-card-content: 24px;
--pad-card-hero: 32px;
}@media (max-width: 1023px) {
[data-density="compact"] {
/* mobile override - fall back to comfortable tokens */
}
}

The mobile override block can either redefine all variables to match comfortable, or apply `data-density="comfortable"` programmatically at <1024px. Implementation choice; outcome is the same.

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