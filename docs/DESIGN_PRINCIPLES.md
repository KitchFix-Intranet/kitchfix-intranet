# Design Principles - KitchFix Ops Hub

> **Purpose:** The philosophy and frameworks behind every design decision in the Ops Hub. Use this as onboarding for any new contributor (human or AI), as a check on proposed designs, and as the ground that the system reference and review persona stand on.
>
> **Last verified:** 2026-05-05
> **Refresh cadence:** Treat as a captain's log - additions only when understanding deepens, with date and a one-line note on what prompted the change.
> **Companion docs:** `DESIGN_REVIEW_PERSONA.md`, `DESIGN_SYSTEM_REFERENCE.md`

---

## Who we're designing for

The Ops Hub serves two ends of a spectrum that must both be honored:

- **Executive Chefs and site leads** in MLB, MiLB, PDC, and corporate kitchens - often on a phone, in a 38°F walk-in cooler, with wet or gloved hands, mid-service.
- **Ops directors and admins** at desks, juggling multiple accounts, expecting density and speed.
- **AP, HR, and culinary leadership** dipping in for specific workflows.

A sleek desktop layout that fails the cooler test is wrong. A chunky mobile-first layout that wastes a director's screen real estate is also wrong. Every design must work for both.

---

## Core frameworks

### Floor-first design

Every UX decision is gut-checked against:

> *Does this work for a chef on a phone in a 38°F walk-in cooler with wet hands?*

Tap targets, contrast, label clarity, and number of taps to value all flow from this. The floor wins ties. **The dual-mode density rule encodes this directly: any viewport <1024px renders Comfortable tokens regardless of module assignment.** See `DESIGN_SYSTEM_REFERENCE.md` for the full rule.

### The Four Gates

Before recommending or building any new pattern, run it through:

1. **Is this real?** - Does it solve an actual operational problem, or is it decoration?
2. **Will it work on the floor?** - Phone, gloves, noise, time pressure.
3. **Will it scale and last?** - Does it hold up across 8+ accounts and 2+ years of accretion?
4. **Can we sustain it?** - Will a one-person dev shop actually maintain this?

A pattern that fails any gate doesn't ship. A pattern that passes all four earns a spot.

### EI (Experience Intelligence) lens

Beyond UX/UI, factor the user's *state*: stressed, cold, rushed, distracted, accountable to a head coach. Design should reduce cognitive load and emotional friction, not add polish for polish's sake.

The vibe sits between **MLB clubhouse-grade professionalism** and **kitchen-line utility**. Not SaaS-startup playful. Not enterprise-banking sterile. Confident, dense, tactile.

### Density vs Comfortable - task-tuned, not user-tuned

The Ops Hub has two density modes (Density and Comfortable, full spec in `DESIGN_SYSTEM_REFERENCE.md`). The mode is chosen by **task**, not by user identity. A director filing their own PAF gets Comfortable. A chef counting 200 inventory items gets Density (on desktop) or Comfortable (on phone - mobile override). The rule:

> *Is this surface for triage/scanning/comparison (Density) or for single-task work that should forgive interruption (Comfortable)?*

Lists and queues take Density. Forms and entry take Comfortable. Mobile is always Comfortable. When uncertain, default to the module's mode and flag for review.

### Tokens are law
Every design value traces to a token. Components consume **semantic** tokens
(`--text-default`, `--surface-page`, `--status-overdue-fg`, `--radius-control`) - never
primitives, never raw hex or px. A raw color or pixel value in a component is a defect,
not a style choice. The canonical system is `src/app/tokens.css`, documented in
`docs/DESIGN_TOKENS.md`. Theming (dark, density, rebrand) is a remap of the semantic
layer with zero component edits - that is the whole point of the tier split.

---

## Best practices baseline (apply, don't recite)

These are the floor, not the ceiling. Apply silently; only call them out when a screen is failing one.

### Heuristics & laws

- **Nielsen's 10 usability heuristics** - especially visibility of system status, match with real-world language, error prevention, recognition over recall, aesthetic minimalism
- **Fitts's Law** - primary actions get larger targets and shorter travel; destructive actions get distance
- **Hick's Law** - cap visible choices; use progressive disclosure, grouping, and defaults to compress decisions
- **Miller's Law** - chunk into 5–9 unit groups; never expose raw lists longer than that without structure
- **Jakob's Law** - lean on conventions users know from Gmail, Notion, Linear, Asana before inventing
- **Doherty Threshold** - interactions feel responsive under 400ms; longer needs optimistic UI, skeletons, or progress
- **Tesler's Law (conservation of complexity)** - complexity moves but doesn't disappear; absorb it in the system, not the user

### Accessibility - WCAG 2.2 AA minimum

- Text contrast ≥ 4.5:1, large text ≥ 3:1, non-text UI ≥ 3:1
- Tap targets ≥ 44×44pt iOS / 48×48dp Android, 8px spacing - cooler test pushes higher
- Never rely on color alone - pair with icon, label, or shape
- Visible focus states on every interactive element
- Keyboard navigation end-to-end
- Respect `prefers-reduced-motion` for any animation > 200ms
- Form fields: persistent labels, inline validation on blur, errors via `aria-describedby`, single-column for >3 fields
- Real semantics: real headings, real buttons, real lists. No `<div onClick>`

### Design all states for any data-driven surface

1. **Loading** - skeleton over spinner when shape is known
2. **Empty (first-time)** - explain what goes here and how to start
3. **Empty (cleared)** - confirm success, offer next action
4. **Partial / filtered** - show what's hidden and how to clear
5. **Error** - what happened, why, what to do, who to call
6. **Success** - toast > modal for non-critical
7. **Offline / stale** - common in coolers; show last-synced time

### Forms

- One column. Logical grouping. Required/optional clear.
- Inline validation on blur, not on every keystroke. Submit-time errors as last resort.
- Smart defaults > empty fields. Pre-fill what you know.
- Inputs typed correctly: `inputmode="numeric"`, `type="tel"`, native date pickers on mobile.
- Destructive actions need explicit confirmation **and** offer undo where reversible (undo > confirm dialog under ~10s).

### Information architecture & density

- Progressive disclosure: 80% case default, 20% on demand
- Density mode (table-friendly, tight spacing) for triage and admin surfaces; Comfortable mode (forgiving padding, generous type) for single-task and floor work - see `DESIGN_SYSTEM_REFERENCE.md` for the rule and module assignments
- Sort, filter, search are different verbs - don't conflate
- Bulk actions belong on selection, not on individual rows
- Tables on desktop become cards on mobile, never horizontal-scroll tables

### Microcopy & tone

- Buttons say what they do (`Save invoice`, not `Submit`)
- Errors blame the system, not the user. Always include a recovery path.
- Empty states are onboarding, not apologies.
- Plain English. Kitchen-floor English. No "leverage," "synergize," "utilize." We *use*.

### Performance perception

- Optimistic UI for low-risk writes; reconcile silently on failure
- Skeletons match final layout shape so there's no layout shift
- First meaningful paint < 1s on home; interactive < 2.5s on 4G

### Power-user affordances (for directors, admins, the operator)

- Keyboard shortcuts for repetitive flows; show in tooltips
- Sticky filters, remembered sort orders, last-used account preselected
- Command palette or universal search when 5+ tools reachable from a screen

### Mobile-specific (the cooler case)

- Primary actions in the **thumb zone** (bottom 1/3 on phone)
- No hover-only affordances - everything must work on tap
- Bottom sheets > modals on mobile
- Account for one-handed use and gloved fingers - bigger than you think
- Mobile is always Comfortable mode regardless of module - see `DESIGN_SYSTEM_REFERENCE.md`

### EI / emotional design

- Match tone to the user's state. A failed sync at 2pm during a homestand isn't a place for cheerful copy.
- Forgiveness over rigor - make undo, edit, withdraw, cancel easy.
- Confirmation, not celebration, for routine successes. Save the celebration for moments that earned it.
- Reduce surprise: predictable layouts, persistent navigation, no hidden state changes.

---

## Designing for AI features

The Ops Hub uses Claude in production: Invoice Capture OCR, Smart Scan vendor auto-detect, Smart Inventory catalog matching (Railway cron). When designing AI-touched surfaces, design for these realities:

- **Confidence is information.** When AI extracts a value, surface its confidence - never hide uncertainty behind a clean form field.
- **Manual override is always one tap away.** Never trap a user in an AI suggestion. Known reliability ceiling: vendor auto-detect works; invoice numbers, dates, totals require manual entry.
- **AI failures need first-class UI.** A failed scan isn't an error state - it's an expected branch. Design the "AI didn't get this, please fill in" path as deliberately as the success path.
- **Don't dress up AI as magic.** Show the source (the scanned PDF, the matched catalog row). Audit trail beats vibes.
- **Latency framing.** AI calls take seconds. Skeletons, progress, optional background patterns. Never freeze the UI.
- **Batch AI vs. live AI.** The Railway nightly catalog match is a batch process - its UI is a "last updated" timestamp, not a spinner. Live OCR is interactive - show progress.

---

## What's already working - protected patterns

Before critiquing any module, identify **2–3 things the existing design gets right** and explicitly mark them as protected. Don't break these in pursuit of polish.

Patterns that have proven themselves across the Ops Hub:

- **Module-prefixed CSS** (`pp-`, `oh-vp-`, `oh-inv-mgmt-`, `sc-`, `kf-news-`, etc.) - module isolation is the intent and largely the practice. Known exceptions: `oh-inv-` collides between Inventory and Invoice Capture (see `GOTCHAS.md`); shared `oh-{utility}-*` classes deliberately cross modules (see `CONVENTIONS.md`).
- **Action Center split-panel inbox** (People Portal) - list + detail, fast triage. Already an implicit dual-density pattern: the list pane uses density tokens (queue triage), the detail pane uses comfortable tokens (form work). This is the canonical model for hybrid surfaces - when a tool needs both modes inside one screen, follow this pattern.
- **Card-based account grids** (Team Directory) with flip-card detail - works well for portfolio-scale browsing
- **Hero banner + launchpad nav cards** on home - clear, scannable, mobile-tolerant
- **Stamped PDF pipeline** (Invoice Capture) - surface the receipt, make audit trail visible
- **Submitter-side cancel/withdraw flows** - agency without admin bottleneck
- **Tight Slack notification loop** - operations feel live without anyone refreshing a page
- **Color-coded module theming** - purple People, navy/amber Ops, Cardinals red Directory. Each tool has a distinct identity that aids orientation.
- **Sheet-driven admin allowlist** (People Portal) - config without redeploy

This list is living. Add new "what's working" notes as patterns prove themselves.

---

## One-person dev shop reality

This entire system is built and maintained by one person. Recommendations are filtered through:

- **Surgical > sweeping.** A 4px tweak that fixes hierarchy beats a 4-day refactor that makes the design system "right."
- **Find/replace patches** preferred for small edits across 1–2 files. Full file replacements only for sprawling changes or new files.
- **Implementable in <4 hours** unless explicitly flagged as a larger effort with clear ROI.
- **No new tooling** unless explicitly requested. No design system overhauls. No Storybook. No Figma migrations.
- **Deploy → screenshot → terse feedback** is the loop. Match that pace.

If a recommendation can't survive these constraints, it isn't right for this system - even if it's "best practice" in the abstract.

---

## Captain's log

*Add additions to principles here with date and a one-line note on what prompted the change.*

- **2026-05-05** - Initial principles documented. Built from working memory of the Ops Hub's evolution: Floor-first, Four Gates, EI lens, AI design realities, what's working list.
- **2026-05-05** - Dual-mode density principle added. Density vs Comfortable is task-tuned, not user-tuned. Floor-first encoded into the mobile override rule (<1024px always Comfortable). Action Center protected pattern updated to acknowledge it as the canonical hybrid-surface model. IA bullet retuned to reference the dual-mode rule. Mobile bullet retuned to reference the override.
- **2026-05-05** - Module-prefixed CSS protected pattern softened to acknowledge known exceptions (`oh-inv-` collision, shared `oh-*` utilities). Honest framing replaces aspirational "strict isolation" claim.