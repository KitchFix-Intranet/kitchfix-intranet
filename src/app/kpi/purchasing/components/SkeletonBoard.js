"use client";
// src/app/kpi/purchasing/components/SkeletonBoard.js
//
// PR 5 - loading skeleton.
//
// Grey blocks at the shape of the real layout so the page does not
// appear to vanish while the fetch is in flight. Renders the KPI
// board shell exactly - period card, three bucket rows, three-up
// flatrow, reimbursable row, card purchases, drill table. Only the
// board area swaps; Shell + FolioRail stay live (they do not depend
// on the fetch).
//
// Rules:
//   - No new tokens; existing spacing / neutrals only.
//   - Pulse animation via CSS. `prefers-reduced-motion` disables it
//     (see .kpi-p-skel-pulse rule in purchasing.css).
//   - No copy that could be mistaken for real data ($0.00, "no
//     spend", etc.) - only structural bars.
//
// The freshness pill shows a loading state (not "Data current" or
// "Data stale") - handled at the Shell prop level in page.js by
// passing dataLoading + freshness: null.

export function SkeletonBoard() {
  return (
    <div className="kpi-p-board kpi-p-skel" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading purchasing board</span>

      {/* Live-note strip */}
      <div className="kpi-p-skel-livenote">
        <span className="kpi-p-skel-bar kpi-p-skel-w60 kpi-p-skel-pulse" />
      </div>

      {/* Period card */}
      <div className="kpi-p-card kpi-p-skel-card">
        <SkelHead />
        <div className="kpi-p-skel-row">
          <SkelCol />
          <SkelCol />
        </div>
        <div className="kpi-p-skel-plot kpi-p-skel-pulse" />
      </div>

      {/* Three bucket rows */}
      <SkelBucketRow />
      <SkelBucketRow />
      <SkelBucketRow />

      {/* Three-up flatrow: Equipment + R&M + Vendor breakdown */}
      <div className="kpi-p-flatrow kpi-p-flatrow-3up">
        <SkelLedgerCard />
        <SkelLedgerCard />
        <SkelLedgerCard tall />
      </div>

      {/* Reimbursable full-width */}
      <div className="kpi-p-card kpi-p-skel-card">
        <SkelHead wide />
        <div className="kpi-p-skel-row">
          <SkelCol />
          <SkelCol />
        </div>
        <div className="kpi-p-skel-list">
          <span className="kpi-p-skel-lrow kpi-p-skel-pulse" />
          <span className="kpi-p-skel-lrow kpi-p-skel-pulse" />
          <span className="kpi-p-skel-lrow kpi-p-skel-pulse" />
        </div>
      </div>

      {/* Card purchases full-width */}
      <div className="kpi-p-card kpi-p-skel-card">
        <SkelHead />
        <div className="kpi-p-skel-list">
          <span className="kpi-p-skel-lrow kpi-p-skel-pulse" />
          <span className="kpi-p-skel-lrow kpi-p-skel-pulse" />
          <span className="kpi-p-skel-lrow kpi-p-skel-pulse" />
          <span className="kpi-p-skel-lrow kpi-p-skel-pulse" />
        </div>
      </div>

      {/* Drill table shell */}
      <div className="kpi-p-card kpi-p-skel-card">
        <div className="kpi-p-skel-toolbar">
          <span className="kpi-p-skel-bar kpi-p-skel-w20 kpi-p-skel-pulse" />
          <span className="kpi-p-skel-bar kpi-p-skel-w10 kpi-p-skel-pulse" />
          <span className="kpi-p-skel-bar kpi-p-skel-w30 kpi-p-skel-pulse" />
        </div>
        <div className="kpi-p-skel-tbl">
          <span className="kpi-p-skel-lrow kpi-p-skel-pulse" />
          <span className="kpi-p-skel-lrow kpi-p-skel-pulse" />
          <span className="kpi-p-skel-lrow kpi-p-skel-pulse" />
          <span className="kpi-p-skel-lrow kpi-p-skel-pulse" />
          <span className="kpi-p-skel-lrow kpi-p-skel-pulse" />
        </div>
      </div>
    </div>
  );
}

function SkelHead({ wide }) {
  return (
    <div className="kpi-p-skel-head">
      <span className={`kpi-p-skel-bar ${wide ? "kpi-p-skel-w40" : "kpi-p-skel-w30"} kpi-p-skel-pulse`} />
      <span className="kpi-p-skel-bar kpi-p-skel-w20 kpi-p-skel-pulse" />
    </div>
  );
}

function SkelCol() {
  return (
    <div className="kpi-p-skel-col">
      <span className="kpi-p-skel-bar kpi-p-skel-w20 kpi-p-skel-pulse" />
      <span className="kpi-p-skel-bar kpi-p-skel-w60 kpi-p-skel-hero kpi-p-skel-pulse" />
      <span className="kpi-p-skel-bar kpi-p-skel-w40 kpi-p-skel-pulse" />
    </div>
  );
}

function SkelBucketRow() {
  return (
    <div className="kpi-p-card kpi-p-skel-card kpi-p-skel-bucket">
      <SkelHead />
      <div className="kpi-p-skel-row">
        <SkelCol />
        <SkelCol />
      </div>
      <div className="kpi-p-skel-plot kpi-p-skel-pulse" />
    </div>
  );
}

function SkelLedgerCard({ tall }) {
  return (
    <div className={`kpi-p-card kpi-p-skel-card ${tall ? "kpi-p-skel-tall" : ""}`}>
      <SkelHead />
      <div className="kpi-p-skel-row">
        <SkelCol />
      </div>
      <div className="kpi-p-skel-list">
        <span className="kpi-p-skel-lrow kpi-p-skel-pulse" />
        <span className="kpi-p-skel-lrow kpi-p-skel-pulse" />
        <span className="kpi-p-skel-lrow kpi-p-skel-pulse" />
      </div>
    </div>
  );
}
