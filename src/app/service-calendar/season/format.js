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
