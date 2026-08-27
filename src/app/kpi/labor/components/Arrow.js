"use client";
// src/app/kpi/labor/components/Arrow.js
//
// 2026-08-27 polish sweep - defect 4. Every arrow across the labor
// board renders through this component. Prior state: four to seven
// render paths inline (hero, fact, table cell, rail caption,
// comparison strip, week bar delta, story block week caption). Some
// wrote `{arrow} {value}` with a literal space, others wrote
// `<span>{arrow}</span>{value}` with none. Result:
//   spending pace hero:   ▼$1,197.62      no space
//   facts and table:      ▼ $605 under    space
//
// Fixing the CSS on each existing arrow class was rejected - "one
// shared formatter, not a fix at each site" (owner ruling). A
// callable component makes the space part of the arrow, so a caller
// who forgets it does not exist.
//
// Usage:
//   <Arrow dir="down" />                        // ▼ + trailing space
//   <Arrow dir="up" className="kpi-vb-d-bad" /> // ▲ + trailing space
//   <Arrow dir={delta < 0 ? "down" : "up"} />
//
// The trailing space is a real space character inside the span (not
// margin-right) so line-break behaviour stays the same as inline
// text - the arrow and its number stay together on wrap.

const GLYPH = {
  down: "▼",
  up:   "▲",
  flat: "•",
  dash: "—",
};

export default function Arrow({ dir, className = "" }) {
  const g = GLYPH[dir];
  if (g == null) return null;
  return (
    <span className={`kpi-arr ${className}`.trim()} aria-hidden="true">
      {g}{" "}
    </span>
  );
}
