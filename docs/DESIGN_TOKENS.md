# Design Tokens - KitchFix (canonical)

`src/app/tokens.css` is the single source of truth for all design values. This document
explains the system and is the **rule**: components consume **semantic** tokens only -
never primitives, never raw hex/px. A raw color or pixel value in a component is a defect.

## The model - two tiers, one rule
- **Tier 1 - Primitives** (`--navy-700`, `--space-4`, `--rad-10`): raw values. Generated,
  not hand-picked. Components NEVER reference these directly.
- **Tier 2 - Semantic** (`--text-default`, `--surface-page`, `--status-overdue-fg`,
  `--radius-control`): intent. Each points at a primitive. **This is what components use.**
- Theming (dark / density / rebrand) is a remap of Tier 2 only - zero component edits.

## Color (OKLCH-generated, AA-verified)
Ramps: `--navy-50..900` (brand 700), `--amber-50..900` (accent 500), `--green-50..900`
(success 500), `--red-50..900` (danger 500), `--n-0..900` (neutral - warm surfaces to
cool ink). Soft state fills: `--fill-needs`, `--fill-upcoming`, `--fill-off` (+ `-bd`).

Semantic color roles:
- Text: `--text-heading/strong/default/muted/subtle/inverse/link/success/danger`.
  `--text-subtle` (n-500) is UI/placeholder/border only - it fails AA as body text; never
  use it for body copy.
- Surface: `--surface-page` (warm #F4F2EC) `/card` `/sunken` `/overlay`.
- Border: `--border-subtle/default/strong`.
- Action: `--action-primary-bg` (navy, white text) `/-bg-hover/-text`; `--action-secondary-*`.
- Accent (contrast-split): `--accent` (amber, dark text/icons), `--accent-solid` (amber-600,
  white text OK), `--accent-text` (amber-700, amber as text), `--accent-backplate` (CTA wash).
  Never put white text on `--accent`; use `--accent-solid`.
- Feedback: `--feedback-success/warning/danger/info`.

## Status family (cross-app, reuse everywhere - cell, badge, dot, row, bar)
Each status carries `-bg / -bd / -fg / -subtle / -strong`. The `-fg` values are the
computed darkest step that passes WCAG AA on the fill: entered green-800 (5.40), needs
amber-700 (5.72), overdue red-700 (4.83), upcoming/off n-700 (6.4+), today navy-700 ring.
Status is NOT calendar-only - use it in People, Vendor, dashboards.

## Tool accents (Tier 3 - per-surface identity)
`--accent-ops` (amber), `--accent-people` (#7C3AED), `--accent-directory` (#C41E3A),
`--accent-playbook` (#0F6E56). These carry surface identity; use the `--feedback-danger`
token (not `--accent-directory`) for actual error states.

## Type - modular scale (ratio 1.2), roles lock size/weight/leading/tracking
Fonts: `--font-ui` (Inter), `--font-body` (Mulish), `--font-mono` (JetBrains Mono).
Sizes: micro 10 / caption 12 / body 14 / subhead 17 / h3 20 / h2 24 / h1 29 / display 35.
Weights: 400/500/600/700/800. Roles: display 35/800, h1 29/700, h2 24/700, h3 20/700,
subhead 17/600, body 14/400 (Mulish), body-strong 14/600, caption 12/600, eyebrow 12/700
caps, micro 10/600. ALL numeric data uses `font-variant-numeric: var(--num-tabular)`.

## Shape - 6 radii + the rule
`--radius-cell` (4, data cells/swatches), `--radius-control` / `--radius-container` (10,
buttons/inputs/cards), `--radius-container-lg` (14, large cards/hero/modals),
`--radius-pill` (toggles/chips/tags), `--radius-circle` (avatars/icon-buttons/dots).
RULE: pills for controls, rounded-rect for containers, square-ish for data cells,
circles for avatars/icons/dots.

## Spacing, elevation, motion, focus, z, opacity
4px base: `--space-1..8`. Elevation: `--elevation-card/raised/popover`. Motion:
`--motion-control` (120ms) / `--motion-surface` (180ms), from `--duration-*` + `--ease-*`;
reduced-motion zeroes durations at the token layer. Focus: `--focus-ring-width/offset/color`
(2px navy ring) - apply a visible focus-visible ring on every interactive element. Z:
`--z-dropdown/sticky/overlay/popover/toast`. Opacity: `--opacity-disabled` (.45).

## Density mode
`[data-density="compact"]` remaps the semantic spacing/size tokens (`--space-stack`,
`--space-card-pad`, `--space-inline`, `--control-height`, `--row-height`, `--cell-size`).
Primitives stay fixed; only semantics remap. Components reading these re-snap automatically.

## Accessibility (constructed, not spot-checked)
Every text/background and status pair was computed against WCAG AA before shipping. The
amber accent fails white-text AA (3.19), which is why the accent is split. Status is never
encoded by color alone - always pair with glyph/label/shape.

## Governance
- `tokens.css` is canonical. If this doc and `tokens.css` ever diverge, `tokens.css` wins -
  fix the doc.
- Add-and-deprecate, never silently mutate a token's value.
- MIGRATION NOTE (temporary): `--space-1..6` and `--radius-card/-input` are still also
  defined in the `globals.css` `[data-density]` blocks (legacy primitive-remap density). They
  win by specificity, so current behavior is unchanged. They retire during the density
  refactor. The `.cs-root` inventory module keeps its own scoped tokens until Module 7.
