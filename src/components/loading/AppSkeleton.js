"use client";
// ═══════════════════════════════════════════════════════════════════
// AppSkeleton - the app-wide loading treatment.
// 2026-09-08 loading-unification PR 2.
// ═══════════════════════════════════════════════════════════════════
//
// Sibling to the Service Calendar's SkeletonSurface, using the same
// shimmer discipline. Where SkeletonSurface is SC-specific (7-column
// tile grid + right rail matching the drill workspace), this exports
// three general-purpose variants for the other sections:
//
//   variant="portal" - hero + card row + list. Fits People, Playbook
//                      landing, Ops nav grid. Structural skeleton
//                      that mimics the page's usual shape.
//   variant="list"   - toolbar + list of rows. Fits Directory,
//                      Playbook document view, Ops sub-tools.
//   variant="grid"   - toolbar + grid of tiles. Fits Playbook admin,
//                      Ops vendor grid.
//
// The principle any future extender must follow:
//   Skeletons make no claim; spinners and empty states both make
//   wrong ones. If a value is not present, render a shimmer bar
//   here, never a "-" or a "Loading..." text or a spinner.
//
// This is the primitive PR 2 of the loading-unification arc
// establishes. PR 3 handles KPI last (may keep SkeletonBoard as a
// documented variant if the card-grid layout warrants it).

import "./appSkeleton.css";

// ─── Atoms (exposed for section-specific compositions) ───

export function AppSkelBar({ className = "", width, height }) {
  const style = {};
  if (width) style.width = width;
  if (height) style.height = height;
  return (
    <span
      className={`app-skel-shimmer ${className}`}
      style={Object.keys(style).length ? style : undefined}
      aria-hidden="true"
    />
  );
}

export function AppSkelTile({ className = "" }) {
  return (
    <div className={`app-skel-tile ${className}`}>
      <span className="app-skel-shimmer app-skel-tile-top" aria-hidden="true" />
      <span className="app-skel-shimmer app-skel-tile-mid" aria-hidden="true" />
    </div>
  );
}

export function AppSkelRow({ className = "" }) {
  return (
    <div className={`app-skel-row ${className}`}>
      <span className="app-skel-shimmer app-skel-row-avatar" aria-hidden="true" />
      <div className="app-skel-row-lines">
        <span className="app-skel-shimmer app-skel-row-line1" aria-hidden="true" />
        <span className="app-skel-shimmer app-skel-row-line2" aria-hidden="true" />
      </div>
    </div>
  );
}

// ─── Variants ───

// Hero band + 3 card row + 4-item list. Fits pages with a hero and a
// mixed layout below (People, Playbook landing).
function PortalVariant({ label }) {
  return (
    <div className="app-skel-surface app-skel-surface--portal" role="status" aria-live="polite" aria-label={label || "Loading"}>
      <div className="app-skel-hero">
        <span className="app-skel-shimmer app-skel-hero-title" aria-hidden="true" />
        <span className="app-skel-shimmer app-skel-hero-sub" aria-hidden="true" />
      </div>
      <div className="app-skel-caption">
        <span className="app-skel-caption-text">{label || "Loading"}</span>
      </div>
      <div className="app-skel-card-row">
        <AppSkelTile />
        <AppSkelTile />
        <AppSkelTile />
      </div>
      <div className="app-skel-list">
        <AppSkelRow />
        <AppSkelRow />
        <AppSkelRow />
        <AppSkelRow />
      </div>
    </div>
  );
}

// Search bar + list of rows. Fits Directory + Playbook document list.
function ListVariant({ label }) {
  return (
    <div className="app-skel-surface app-skel-surface--list" role="status" aria-live="polite" aria-label={label || "Loading"}>
      <div className="app-skel-toolbar">
        <span className="app-skel-shimmer app-skel-toolbar-search" aria-hidden="true" />
        <span className="app-skel-shimmer app-skel-toolbar-chip" aria-hidden="true" />
        <span className="app-skel-shimmer app-skel-toolbar-chip" aria-hidden="true" />
      </div>
      <div className="app-skel-caption">
        <span className="app-skel-caption-text">{label || "Loading"}</span>
      </div>
      <div className="app-skel-list">
        <AppSkelRow />
        <AppSkelRow />
        <AppSkelRow />
        <AppSkelRow />
        <AppSkelRow />
        <AppSkelRow />
      </div>
    </div>
  );
}

// Toolbar + card grid. Fits Playbook admin + Ops vendor tools.
function GridVariant({ label }) {
  return (
    <div className="app-skel-surface app-skel-surface--grid" role="status" aria-live="polite" aria-label={label || "Loading"}>
      <div className="app-skel-toolbar">
        <span className="app-skel-shimmer app-skel-toolbar-search" aria-hidden="true" />
        <span className="app-skel-shimmer app-skel-toolbar-chip" aria-hidden="true" />
      </div>
      <div className="app-skel-caption">
        <span className="app-skel-caption-text">{label || "Loading"}</span>
      </div>
      <div className="app-skel-card-grid">
        <AppSkelTile /><AppSkelTile /><AppSkelTile />
        <AppSkelTile /><AppSkelTile /><AppSkelTile />
      </div>
    </div>
  );
}

export default function AppSkeleton({ variant = "portal", label }) {
  if (variant === "list") return <ListVariant label={label} />;
  if (variant === "grid") return <GridVariant label={label} />;
  return <PortalVariant label={label} />;
}
