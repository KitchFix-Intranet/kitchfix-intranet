"use client";
// ═══════════════════════════════════════════════════════════════════
// SkeletonSurface - account-switch loading state.
// 2026-09-03 (SC cleanup item 4, Approach C: structural skeleton).
// ═══════════════════════════════════════════════════════════════════
//
// Renders during ServiceCalendar's account-switch data window. Kevin's
// pre-fix bug: switching accounts flashed a wrong empty state
// (Select..., TODAY -, PERIOD -, $0.00 ENTERED) that read as data
// loss. This surface fills the same viewport slot with a structural
// skeleton - the LAYOUT is preserved, every content value is a
// shimmer bar. No placeholder dashes, no zero-shaped numbers, no
// text that could be mistaken for real data.
//
// Motion is the whole point of the design: shimmer bands sweep
// left-to-right on every skeleton element so the user reads "pending"
// instead of "empty." A static gray block would read like a blank
// state. See .sc-skel-shimmer in ./skeleton.css.
//
// Gate lives in the parent (ServiceCalendar.js). This component is
// pure presentation - it takes no props today because Kevin's design
// dropped the account-name caption ("Loading" without the name; the
// picker directly above already shows which account is loading).
//
// Layout mirrors the two-column drill (body + right rail) which is
// the shape of both scv2 drill views (period + month) and the season
// overview grid. Not view-scope-specific because the visual signal
// is identical across all views: rectangles shimmering in a grid.

import "./skeleton.css";

// One shimmer atom. Width variant controlled by className.
function SkeletonBar({ className = "" }) {
  return (
    <span
      className={`sc-skel-shimmer ${className}`}
      aria-hidden="true"
    />
  );
}

// One skeleton tile - preserves the day-cell / month-card shape.
function SkeletonTile() {
  return (
    <div className="sc-skel-tile">
      <span className="sc-skel-shimmer sc-skel-tile-top" aria-hidden="true" />
      <span className="sc-skel-shimmer sc-skel-tile-mid" aria-hidden="true" />
    </div>
  );
}

// Full surface: body grid + right rail. Ribbon values are skeletoned
// inline by the parent (via <Ribbon isLoading />) so the ribbon
// picker + toggles stay real.
export default function SkeletonSurface() {
  return (
    <div className="sc-skel-surface" role="status" aria-live="polite" aria-label="Loading">
      {/* Caption: plain "Loading" + spinner. No account name (Kevin
          ruling 2026-09-03: the picker directly above already shows
          the account, and a caption that names the account it is
          loading is one more thing that can render mid-swap with the
          wrong name. Less to get wrong). */}
      <div className="sc-skel-caption">
        <span className="sc-skel-caption-text">Loading</span>
      </div>

      <div className="sc-skel-body-and-rail">
        {/* Body: two rows of 7 tiles = 14, roughly a period drill
            span. Season overview grids similarly; the shape reads as
            "coming" either way. */}
        <div className="sc-skel-body">
          <div className="sc-skel-tile-row">
            <SkeletonTile /><SkeletonTile /><SkeletonTile /><SkeletonTile />
            <SkeletonTile /><SkeletonTile /><SkeletonTile />
          </div>
          <div className="sc-skel-tile-row">
            <SkeletonTile /><SkeletonTile /><SkeletonTile /><SkeletonTile />
            <SkeletonTile /><SkeletonTile /><SkeletonTile />
          </div>
          <div className="sc-skel-tile-row">
            <SkeletonTile /><SkeletonTile /><SkeletonTile /><SkeletonTile />
            <SkeletonTile /><SkeletonTile /><SkeletonTile />
          </div>
        </div>

        {/* Right rail: spinner atop, ENTERED label (real; label
            without a value is unambiguously pending, no zero-shaped
            number possible), shimmer bars for the ring + queue + notes
            + footer sections. */}
        <div className="sc-skel-rail">
          <div className="sc-skel-rail-hero">
            <SkeletonBar className="sc-skel-bar-hero" />
            <span className="sc-skel-rail-hero-label">ENTERED</span>
          </div>
          <div className="sc-skel-rail-section">
            <SkeletonBar className="sc-skel-bar-md" />
            <SkeletonBar className="sc-skel-bar-sm" />
          </div>
          <div className="sc-skel-rail-section">
            <SkeletonBar className="sc-skel-bar-lg" />
            <SkeletonBar className="sc-skel-bar-md" />
          </div>
          <div className="sc-skel-rail-section">
            <SkeletonBar className="sc-skel-bar-sm" />
          </div>
        </div>
      </div>
    </div>
  );
}
