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
// dashboard.
export function buildPrintScopeLine({ start, end, workerRoster, selectedWorkers, redact }) {
  const total = workerRoster?.length ?? 0;
  const shown = selectedWorkers && selectedWorkers.size > 0 ? selectedWorkers.size : total;
  const workers = shown === total ? `all ${total} workers` : `${shown} of ${total} workers`;
  const names = redact ? "names hidden" : "names shown";
  return `Range ${fmtDate(start)} – ${fmtDate(end)} · ${workers} · ${names}`;
}
