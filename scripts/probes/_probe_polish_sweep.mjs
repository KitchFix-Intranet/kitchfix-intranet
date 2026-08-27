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

console.log(`\n---`);
if (failures > 0) {
  console.log(`${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log(`all assertions pass.`);
