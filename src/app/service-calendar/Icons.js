"use client";

// Service Calendar icon set - local, hand-rolled inline SVGs.
//
// Per docs/SC_REDESIGN_SPEC.md §13.1 and docs/SC_DESIGN_TOKEN_README.md,
// this is the SC's icon canon: NOT a Lucide import (Lucide is installed
// but has zero adoption app-wide), just Lucide-shaped paths hand-inlined
// so the SC drill-in redesign can consume ONE vocabulary without
// pulling in an unadopted dependency.
//
// Rules of the road:
//   - stroke="currentColor" so icons pick up the text-color context.
//   - stroke-width 1.75 (a11y-tuned midpoint between Lucide's 1.5 hairline
//     and 2 emphasis; reads at small sizes without going bold).
//   - Sized via the design tokens --icon-sm (16px), --icon-md (20px),
//     --icon-lg (24px) through the `size` prop (or pass any raw string).
//   - Decorative by default (`aria-hidden="true"`); pass `label="Save"`
//     to make it a meaningful icon (`role="img"` + `aria-label`). The
//     containing button usually carries the accessible name via its own
//     aria-label - in that case the icon stays decorative.
//   - DaySquare keeps its Unicode status dingbats (✎ ! ○ ⚠) - those are
//     the atom's non-color state cue, not part of this icon set.

const SIZE = {
  sm: "var(--icon-sm)",
  md: "var(--icon-md)",
  lg: "var(--icon-lg)",
};

function Icon({ size = "md", label, children }) {
  const dim = SIZE[size] || size;
  return (
    <svg
      width={dim}
      height={dim}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : "true"}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {children}
    </svg>
  );
}

// ── Mechanical UI glyphs ──────────────────────────────────────
export const X = (props) => (
  <Icon {...props}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Icon>
);
export const ChevronLeft = (props) => (
  <Icon {...props}>
    <path d="m15 18-6-6 6-6" />
  </Icon>
);
export const ChevronRight = (props) => (
  <Icon {...props}>
    <path d="m9 18 6-6-6-6" />
  </Icon>
);

// ── §13.1 concept glyphs ──────────────────────────────────────
export const CheckCircle = (props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);
export const Pencil = (props) => (
  <Icon {...props}>
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </Icon>
);
export const AlertTriangle = (props) => (
  <Icon {...props}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Icon>
);
export const Clock = (props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </Icon>
);
export const Moon = (props) => (
  <Icon {...props}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </Icon>
);
export const Calendar = (props) => (
  <Icon {...props}>
    <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
    <line x1="16" x2="16" y1="2" y2="6" />
    <line x1="8" x2="8" y1="2" y2="6" />
    <line x1="3" x2="21" y1="10" y2="10" />
  </Icon>
);
export const DollarSign = (props) => (
  <Icon {...props}>
    <line x1="12" x2="12" y1="1" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </Icon>
);
export const RefreshCw = (props) => (
  <Icon {...props}>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    <path d="M3 21v-5h5" />
  </Icon>
);
export const Lock = (props) => (
  <Icon {...props}>
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Icon>
);
export const ArrowRight = (props) => (
  <Icon {...props}>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </Icon>
);
export const Download = (props) => (
  <Icon {...props}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" x2="12" y1="15" y2="3" />
  </Icon>
);
// P2 (item 3, R3, 2026-07-10): chat-bubble outline for the DaySquare
// note indicator and the legend row. Same stroke discipline as the
// rest of the SC icon set. Consumers pass a raw size string (11px on
// tiles, 12px in the legend) so it never inherits an inflated icon
// scale.
export const MessageSquare = (props) => (
  <Icon {...props}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </Icon>
);

// ── MiLB day/night glyphs ──────────────────────────────────────
// Standalone, NOT wrapped by <Icon> because their fill semantics
// differ from the stroke-only house style: sun combines a filled
// disc with stroke rays; moon is a filled crescent. viewBox 0 0 24 24
// + currentColor discipline preserved. Sized via a raw `size` prop
// (px number or CSS string) so the three consumer sites (DaySquare
// MilbPill 12px, StateLegend swatch 10px, LegendInfoPopup MilbRow
// 12px) match exactly.
export function SunGlyph({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="12" y1="2" x2="12" y2="4" />
        <line x1="12" y1="20" x2="12" y2="22" />
        <line x1="2" y1="12" x2="4" y2="12" />
        <line x1="20" y1="12" x2="22" y2="12" />
        <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
        <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
        <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
        <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
      </g>
    </svg>
  );
}
export function MoonGlyph({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
