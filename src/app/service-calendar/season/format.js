// Shared money formatter for the SC surface. Consolidates three former
// call-site copies (DayDetail, ServiceCalendar inline in bulk review,
// SubmissionToast) that had drifted on precision:
//   DayDetail             - whole dollars
//   ServiceCalendar (bulk) - whole dollars
//   SubmissionToast       - two decimals (cents on a whole-dollar surface)
//
// SC-057 aligns the toast on whole dollars; consolidation lives here.
export function fmt$(n, opts) {
  const decimals = (opts && opts.decimals) || 0;
  const num = Number(n) || 0;
  const value = decimals === 0 ? Math.round(num) : num;
  return "$" + value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// K/M-compacting money formatter for tight tiles + month cards.
// Was: an identical local copy in MonthCard.js (`fmtK`) and
// DaySquare.js (`fmt$`, with the same K/M rules). One shape now.
// $M branch unreachable today; kept for defense against a future
// multi-account rollup.
export function fmt$K(n) {
  const v = Math.round(Number(n) || 0);
  if (Math.abs(v) >= 1_000_000) return "$" + (v / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (Math.abs(v) >= 1_000)     return "$" + Math.round(v / 1_000) + "K";
  return "$" + v.toLocaleString("en-US");
}

// Meal-count formatter with thousands separator. Was: a one-liner in
// DaySquare.js. Behavior identical.
export function fmtMeals(n) {
  return Number(n).toLocaleString("en-US");
}

// Short date formatter for compact contexts (e.g., bulk review row
// labels). Was: two identical IIFE-local copies in ServiceCalendar.js.
// Input: ISO date "YYYY-MM-DD"; output: "Mon, Jul 8" (browser locale
// short weekday + short month + numeric day, constructed from local Y/M/D
// to sidestep timezone shift).
export function fmtDateShort(iso) {
  const [y, m, dd] = iso.split("-").map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
