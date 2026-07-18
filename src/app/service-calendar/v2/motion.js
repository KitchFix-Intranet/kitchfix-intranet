"use client";

// SC v2 shared motion helpers (W7 PR 2/3).
//
// One place for reduced-motion-aware scroll + one place for the
// "prefers-reduced-motion" check the JS layer needs when it can't
// defer to the CSS token cascade (scrollIntoView options, one-shot
// class-toggle timeouts).
//
// The CSS motion tokens (`--duration-*` in tokens.css) already
// collapse to 0ms under `prefers-reduced-motion: reduce` at the
// token layer - CSS-only animations don't need to consult this
// module. This module exists for JS-driven interactions (scroll,
// class-toggle timers) where the browser doesn't automatically
// swap behavior.

// Read the reduced-motion preference safely. SSR-safe (matchMedia
// is undefined server-side; returns false there so the first paint
// makes the standard assumption). The caller re-reads at each
// invocation because the preference can change at runtime (system
// pref toggled by the operator mid-session).
export function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// Scroll a DOM element into view, respecting the reduced-motion
// preference at call time. Behavior:
//   default:       smooth scroll (block: center unless overridden)
//   reduced-motion: instant jump to the same final position
// Same final position in both modes - reduced-motion only affects
// the transition, not the destination. Options mirror the
// scrollIntoView spec's ScrollIntoViewOptions shape so migrating a
// call site is a rename, not a rewrite.
//
// Migration sites (W7 PR 2/3):
//   - season/PeriodWorkspace.js DayGrid focus effect (?day= target)
//   - v2/DrillRail.js scrollToBand (week-line click)
// Both previously called el.scrollIntoView({ behavior: "smooth",
// block: "center" }) directly - now route through this helper so
// the RM branch is one implementation. See the PR body for
// before/after citations.
export function scrollIntoViewRM(el, opts = {}) {
  if (!el || typeof el.scrollIntoView !== "function") return;
  const reduce = prefersReducedMotion();
  el.scrollIntoView({
    behavior: reduce ? "auto" : "smooth",
    block: "center",
    inline: "nearest",
    ...opts,
    // Always override caller's behavior with the RM verdict - the
    // helper's job is exactly this reduce-guard so callers can't
    // opt out accidentally.
    behavior: reduce ? "auto" : (opts.behavior || "smooth"),
  });
}
