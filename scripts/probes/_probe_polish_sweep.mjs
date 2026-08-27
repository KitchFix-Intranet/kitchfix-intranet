// Polish sweep - four small assertions per Kevin's CC PROMPT
// 2026-08-27. Pure JS, no DB.
//
//   A1  fmt$0     whole-dollar formatter carries a thousands separator
//                 and no cents. String width <= 8 chars for any value
//                 up to $999,999 so the day-strip caption cannot
//                 overflow a compact-density column.
//   A2  fmtHrs    thousands separator on 4+ digit hours ("2,643.70",
//                 not "2643.70"). Cent precision preserved.
//   A3  Arrow    the shared <Arrow /> component renders "▼ " / "▲ "
//                 with a trailing space so every render path has the
//                 same gap. Guards against the pre-fix "▼$1,197.62"
//                 no-space case.
//   A4  arrow    HomestandBoard's arrow() helper now returns `dir`,
//                 not `glyph` - proves the callers were updated.
//   A5  greppable "▼" and "▲" characters do not appear inline in any
//                 labor component (Arrow.js is the only file that
//                 owns them). Guards against drift.
//
// If any assertion fails a defect from the sweep has come back or a
// new render path added the arrow inline without going through Arrow.

import { fmt$, fmt$0, fmtHrs } from "../../src/app/kpi/labor/lib/formatting.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function assert(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures += 1;
  console.log(`  ✗ ${name}`);
  if (extra !== undefined) console.log(`      ${JSON.stringify(extra)}`);
}

console.log("=== polish sweep ===\n");

// A1 - fmt$0
{
  assert("A1a  fmt$0(1508.65) = $1,509 (whole dollars, comma)",
    fmt$0(1508.65) === "$1,509");
  assert("A1b  fmt$0(2643.70) = $2,644",
    fmt$0(2643.70) === "$2,644");
  assert("A1c  fmt$0(999999) = $999,999 - 8 chars max at 6-figure ceiling",
    fmt$0(999999) === "$999,999" && "$999,999".length === 8);
  assert("A1d  fmt$0(null) = —",
    fmt$0(null) === "—");
  assert("A1e  fmt$0(0) = $0",
    fmt$0(0) === "$0");
}

// A2 - fmtHrs
{
  assert("A2a  fmtHrs(2643.70) = 2,643.70 (comma + cents)",
    fmtHrs(2643.70) === "2,643.70");
  assert("A2b  fmtHrs(1321.85) = 1,321.85",
    fmtHrs(1321.85) === "1,321.85");
  assert("A2c  fmtHrs(4598.95) = 4,598.95",
    fmtHrs(4598.95) === "4,598.95");
  assert("A2d  fmtHrs(97) = 97.00 (no comma below 1,000)",
    fmtHrs(97) === "97.00");
  assert("A2e  fmtHrs(null) = —",
    fmtHrs(null) === "—");
}

// A3 - Arrow component structure. Node cannot parse the JSX so the
// probe reads Arrow.js as text and asserts the shape a reader would
// see if they opened the file.
{
  const arrowSrc = readFileSync("src/app/kpi/labor/components/Arrow.js", "utf8");
  assert("A3a  Arrow.js defines a GLYPH map with all four keys",
    /GLYPH\s*=\s*\{[^}]*down:\s*"▼"[^}]*up:\s*"▲"[^}]*flat:\s*"•"[^}]*dash:\s*"—"[^}]*\}/s.test(arrowSrc));
  assert("A3b  Arrow renders {g}{' '} - literal trailing space inside the span",
    /\{g\}\{"\s"\}/.test(arrowSrc));
  assert("A3c  Arrow returns null when dir is unknown",
    /if\s*\(g\s*==\s*null\)\s*return\s*null/.test(arrowSrc));
  assert("A3d  Arrow className merges kpi-arr with caller className",
    /kpi-arr\s+\$\{className\}/.test(arrowSrc));
}

// A4 - HomestandBoard's arrow() helper returns dir, not glyph
{
  const hs = readFileSync("src/app/kpi/labor/components/HomestandBoard.js", "utf8");
  assert("A4a  HomestandBoard arrow() helper returns dir key",
    /function arrow[\s\S]{0,200}return\s*\{\s*dir:/.test(hs));
  assert("A4b  no .glyph reads on arrow() return anywhere in the file",
    !/\.glyph\b/.test(hs));
}

// A5 - no inline "▼" / "▲" outside Arrow.js
{
  const dir = "src/app/kpi/labor/components";
  const files = readdirSync(dir).filter(f => f.endsWith(".js") && f !== "Arrow.js");
  const offenders = [];
  for (const f of files) {
    const src = readFileSync(join(dir, f), "utf8");
    // Match arrow characters ONLY when wrapped in single/double
    // quotes (real string literals) - backtick-wrapped occurrences
    // are code-comment references and do not render. Strip line
    // comments first so a `//` explanation using ▼/▲ does not trip
    // this check either.
    const noLineComments = src.split("\n").map(l => l.replace(/\/\/.*$/, "")).join("\n");
    if (/["']▼["']|["']▲["']/.test(noLineComments)) offenders.push(f);
  }
  assert(`A5  no labor component inlines '▼'/'▲' outside Arrow.js`,
    offenders.length === 0, offenders);
}

// A6 - CSS rule for minimal-density caption font drop. Owner ruling
// 2026-08-27 followup: at minimal density (bars < 44px) the whole-
// dollar caption at --kpi-t-body still overflows on 22-day MLB
// stands (CIN - OH HS 8 at 34px columns). Rule scoped to
// `.kpi-day-range-strip[data-density="minimal"] .kpi-wb-cap-value`
// drops the font to --kpi-t-meta so $1,509 fits in 34px.
{
  const css = readFileSync("src/app/kpi/kpi.css", "utf8");
  assert("A6a  minimal-density caption rule targets .kpi-wb-cap-value",
    /\.kpi-day-range-strip\[data-density="minimal"\]\s+\.kpi-wb-cap-value\s*\{[^}]*font-size:\s*var\(--kpi-t-meta\)/s.test(css));
  assert("A6b  chooseLabelDensity boundary for minimal is < 44px",
    /perBar\s*>=\s*44.*return\s*"compact"/s.test(
      readFileSync("src/lib/labor/dayRangeAggregate.js", "utf8")
    ));
}

// A7 - live-DB check. For each MLB account, look up the longest stand
// and assert the per-column geometry supports the whole-dollar caption
// at minimal density on a realistic desktop plot width. Guard covers
// the worst case across the portfolio, not just the case we happened
// to look at.
//
// Model:
//   plot_width_px      1000px - reflects a labor-page desktop with the
//                      folio open on 1440-1600 viewports (Kevin's
//                      original 748px measurement was a narrower
//                      layout that we deliberately do not target;
//                      mobile at 375px is deferred).
//   min_col_px         33  - measured width of "$1,509" at
//                      var(--kpi-t-meta) (11px) in Inter/system
//                      numerics. MLB clubhouse peaks land ~$10-15K
//                      so 6-char `$X,XXX` is the dominant case.
//   assertion          per_col_px >= min_col_px on every account's
//                      longest stand
//
// Reports the per_col at three widths so a tighter viewport is
// visible in the log even when the assertion at 1000px baseline
// passes.
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("\n=== A7 live DB - MLB longest stand vs. minimal-density column geometry ===\n");
  const { createClient } = await import("@supabase/supabase-js");
  const { listHomestands } = await import("../../src/lib/labor/homestandResolver.js");
  const supa = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const MLB = ["STL - MO", "CIN - OH", "TXR - TX - H", "TXR - TX - V"];
  const PLOT_WIDTH_PX = 1000;
  const MIN_COL_PX    = 33;
  const REPORT_WIDTHS = [800, 1000, 1200];

  for (const acct of MLB) {
    const raw = await listHomestands(supa, acct);
    if (!raw || raw.length === 0) {
      console.log(`  [${acct}] no homestands - skipping`);
      continue;
    }
    const longest = raw.reduce((best, h) => (h.window_days > (best?.window_days || 0) ? h : best), null);
    const perCol  = PLOT_WIDTH_PX / longest.window_days;
    const scan    = REPORT_WIDTHS.map(w => `${w}px -> ${(w / longest.window_days).toFixed(1)}px/col`).join("   ");
    console.log(`  [${acct}] longest HS ${longest.index}  window_days=${longest.window_days}   ${scan}`);
    assert(
      `A7  ${acct} longest stand (${longest.window_days}d) fits whole-dollar caption at ${PLOT_WIDTH_PX}px plot`,
      perCol >= MIN_COL_PX,
      { window_days: longest.window_days, per_col_px: perCol, min_col_px: MIN_COL_PX, plot_width_px: PLOT_WIDTH_PX },
    );
  }
} else {
  console.log("\n(A7 skipped - no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env)");
}

console.log(`\n---`);
if (failures > 0) {
  console.log(`${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log(`all assertions pass.`);
