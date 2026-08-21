// Shared helpers for the SC admin rail forms (price / fee / archive /
// reactivate). Extracted from the retired PriceEditPanel / FeeEditPanel
// / ArchiveServicePanel so the rail forms share ONE implementation of
// the mechanics that pre-date this PR:
//
//   1. Client-local date math (LOCAL clock, not UTC - Vercel runs in
//      UTC and "Today" picked in a US-evening session would silently
//      roll to tomorrow if the server decided).
//   2. roundCents so 5-decimal stored prices do not show false-
//      positive changes.
//   3. Backdate fence: min BACKDATE_FLOOR ("2024-01-01"), max
//      yesterday.
//   4. Backdate-preview fetch (POST sc-admin-backdate-preview) with
//      the same idle / loading / ready contract as the retired
//      PriceEditPanel.
//
// No new endpoints. No API changes. Payload shapes unchanged.

export const BACKDATE_FLOOR = "2024-01-01";

export function roundCents(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function localTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function localYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Inclusive calendar-day count between two YYYY-MM-DD strings. Used
// by the backdate warning for the span text. Pure date math against
// T00:00:00 so DST cannot drift the count by an hour.
export function daysBetweenInclusive(fromDate, toDate) {
  if (!fromDate || !toDate) return 0;
  const a = new Date(fromDate + "T00:00:00");
  const b = new Date(toDate + "T00:00:00");
  const MS = 24 * 60 * 60 * 1000;
  return Math.round((b - a) / MS) + 1;
}

export function fmtPrice(n) {
  return "$" + Number(n).toFixed(2);
}
export function fmtAmount(n) {
  return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
export function fmtDateHuman(iso) {
  if (!iso) return "";
  const [y, m, day] = String(iso).slice(0, 10).split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[Number(m) - 1]} ${Number(day)}, ${y}`;
}

// Format ["4","5","6","7"] -> "P4, P5, P6 and P7". Matches the
// pre-existing backdate warning voice (no Oxford comma).
export function fmtPeriodListWithAnd(periods) {
  const p = periods.map((x) => `P${x}`);
  if (p.length === 0) return "";
  if (p.length === 1) return p[0];
  if (p.length === 2) return `${p[0]} and ${p[1]}`;
  return p.slice(0, -1).join(", ") + " and " + p[p.length - 1];
}

// Backdate readiness check - the same predicate the retired
// PriceEditPanel / FeeEditPanel used to gate their preview fetch.
export function isBackdateReady({ mode, backdateDate, extra = true }) {
  if (mode !== "backdate") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(backdateDate)) return false;
  const y = localYesterday();
  if (backdateDate < BACKDATE_FLOOR || backdateDate > y) return false;
  return !!extra;
}
