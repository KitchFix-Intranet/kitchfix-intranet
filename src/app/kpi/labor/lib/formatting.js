// src/app/kpi/labor/lib/formatting.js
//
// Shared formatters for the KPI Labor surface. Consumed by page.js and
// the section components.

export function fmt$(v) {
  if (v == null) return "—";
  return "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtHrs(v) {
  if (v == null) return "—";
  return Number(v).toFixed(2);
}

// B11: data dates render MM/DD/YY
export function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${m}/${d}/${y.slice(2)}`;
}

export function hoursSinceISO(iso) {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
}

// D1 · B8: timestamps render viewer-local with a zone label.
// UTC only in exports, logs, URLs (per spec §10).
export function fmtTimestamp(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
}

export function freshnessTint(hrs) {
  if (hrs == null) return "kpi-chip-stale";
  if (hrs < 30) return "kpi-chip-fresh";
  if (hrs < 54) return "kpi-chip-warm";
  return "kpi-chip-stale";
}

// Print-time scope line - kept for the @media print header on the
// dashboard. V41 C2 - a fourth segment states the salary scope so a
// printed sheet reads what the screen reads. Pass salaryIncluded as
// null (the default) when the caller cannot see salary at all; the
// segment is skipped in that case and the line stays byte-identical
// to what a permission-less caller saw before V41. The two permitted
// strings reuse wording already on the budget sub-line and the
// weekly-target legend.
export function buildPrintScopeLine({
  start, end, workerRoster, selectedWorkers, redact,
  salaryIncluded = null,
}) {
  const total = workerRoster?.length ?? 0;
  const shown = selectedWorkers && selectedWorkers.size > 0 ? selectedWorkers.size : total;
  const workers = shown === total ? `all ${total} workers` : `${shown} of ${total} workers`;
  const names = redact ? "names hidden" : "names shown";
  const base = `Range ${fmtDate(start)} – ${fmtDate(end)} · ${workers} · ${names}`;
  if (salaryIncluded === null || salaryIncluded === undefined) return base;
  return `${base} · ${salaryIncluded ? "hourly + salary" : "hourly only"}`;
}

// 2026-08-26 homestand-fixes round 2 item 3 - the ONE source for how
// a stand's window renders. Header, table row and command chip must
// all call this helper so they cannot drift apart again.
//
// Prior defect: HomestandBoard.js:310 rendered
//   `${fmtDate(stand.game_start)} - ${fmtDate(stand.game_end)}` (7 days)
// while the table cells + command chip already read window_start /
// window_end (11 days). Same failure class as the periodsInBoardWeeks
// drift owner fixed in polish round 2: three surfaces computing the
// same thing independently WILL diverge the next time one changes.
//
// Returns { start, end, days } as ISO strings + a number. Callers
// format for display via fmtDate + straight concatenation - the
// helper deliberately does not format so each caller can pick its
// own separator (` - `, ` – `, etc.) and the shape stays declarative.
export function standWindow(stand) {
  return {
    start: stand?.window_start ?? null,
    end:   stand?.window_end   ?? null,
    days:  stand?.window_days  ?? null,
  };
}
