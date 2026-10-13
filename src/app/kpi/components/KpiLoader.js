"use client";

/**
 * Unified KPI loading indicator (V1).
 *
 * Two modes:
 *   <KpiLoader />                     - cold load, replaces board area
 *   <KpiLoader overlay />             - warm refetch, floats over dimmed content
 *   <KpiLoader message="Custom..." /> - custom loading message
 *
 * The parent is responsible for:
 *   - Cold: rendering KpiLoader INSTEAD of the board
 *   - Overlay: wrapping the board in a div with className="kpi-loader-wrap",
 *     applying className="kpi-loader-dim" to the board, and rendering
 *     <KpiLoader overlay /> as a sibling after the board div
 *
 * Respects prefers-reduced-motion. Accessible via role="status".
 */
export default function KpiLoader({ overlay = false, message }) {
  const msg = message || (overlay ? "Updating…" : "Loading your data…");

  if (overlay) {
    return (
      <div className="kpi-loader-overlay" role="status" aria-live="polite" aria-busy="true">
        <div className="kpi-loader-float">
          <div className="kpi-loader-ring" aria-hidden="true" />
          <p className="kpi-loader-msg">{msg}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="kpi-loader" role="status" aria-live="polite" aria-busy="true">
      <div className="kpi-loader-ring" aria-hidden="true" />
      <p className="kpi-loader-msg">{msg}</p>
    </div>
  );
}
