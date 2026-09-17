// Kevin ruling 2026-09-17. Sub-lines roll up their children.
//
// A GL code of the form `X.Y.Z` (two dots) is a child of the canonical
// sub-line `X.Y`. The Overview cost table and the Purchasing route both
// aggregated actuals with exact-equality matches - `r.gl_line_code === gl` -
// so `3200.1.1` and `3200.1.2` never landed on `3200.1`. On accounts
// with sub-sub codes this made the sub-line understate by tens of
// thousands of dollars; on CIN - AZ 1374.1 it made the sub-line read
// $0 despite $7,010 of child spend behind it.
//
// The parent (3200 / 3400 / 3500 / 13xx) already rolls up via
// startsWith across all depths, so parent totals are unaffected.
//
// Match rule: `code === line` OR `code.startsWith(line + '.')`.
// The dot check is load-bearing - a bare startsWith would let
// `3200.1` swallow `3200.12`, `3200.11`, etc. (Not present in
// today's data; the guard is against a future code being minted.)

// Canonical top-level sub-line for a raw GL code.
//   "3200"      -> "3200"      (parent itself)
//   "3200.1"    -> "3200.1"    (canonical sub-line - unchanged)
//   "3200.1.1"  -> "3200.1"    (rolls up to the sub-line above)
//   "3200.1.2"  -> "3200.1"
//   "1385.3.2"  -> "1385.3"
export function canonicalSubLine(code) {
  if (typeof code !== "string" || !code) return null;
  const dot1 = code.indexOf(".");
  if (dot1 < 0) return code;
  const dot2 = code.indexOf(".", dot1 + 1);
  if (dot2 < 0) return code;
  return code.slice(0, dot2);
}

// True if `code` (from raw data) rolls up into `line` (canonical sub-line).
// Dot check prevents `3200.1` swallowing `3200.12`.
export function isDescendantOfLine(code, line) {
  if (typeof code !== "string" || typeof line !== "string" || !line) return false;
  if (code === line) return true;
  return code.startsWith(line + ".");
}

// Sum an amount field over every row whose gl_line_code rolls up into
// `line`. `rows` iterates raw records; `getCode` and `getAmount`
// extract the code and numeric amount from each row.
export function sumRollupByLine({ rows, line, getCode, getAmount }) {
  let s = 0;
  for (const r of rows) {
    if (isDescendantOfLine(getCode(r), line)) s += Number(getAmount(r) || 0);
  }
  return s;
}
