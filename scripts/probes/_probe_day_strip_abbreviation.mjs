// Day-strip abbreviation formatter contract.
//
// Owner ruling revised 2026-08-28. The prior strip-uniformity rule
// (every caption on one strip picks the same band) was cut - it
// assumed `$856` beside `$1.5k` would read as a bug, but live
// verify on CIN - OH ?homestand=2026-07-27 (22 captions) showed the
// opposite: a zero-dollar off-day rendering `$0.0k` reads as broken
// while mixed conventions read fine. Owner ruled per-value.
//
// Contract:
//   A1  fmtCompactDollars formats per value, correctly at boundaries
//        - zero is always "$0"
//        - |n| <   1,000  render plain "$XXX"
//        - |n| >=  1,000  render abbreviated "$X.Xk" or "$XXk"
//   A2  no caption ever renders any "$0.Xk" form (the specific
//        failure the owner flagged)
//   A3  Width - widest string fits the 28px column at
//        --kpi-t-meta (11px) on the 25-day stand. Widest sub-$1,000
//        plain string is "$999" (24.3px); confirm this against the
//        target column.
//   A4  >= prefix width - documented finding: the `>=` prefix
//        cannot host on day-strip captions at 28px columns.
//        Reserved for the What-it-cost card only.

import { fmtCompactDollars, fmt$0 } from "../../src/app/kpi/labor/lib/formatting.js";

let failures = 0;
function assert(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures += 1;
  console.log(`  ✗ ${name}`);
  if (extra !== undefined) console.log(`      ${JSON.stringify(extra)}`);
}

console.log("=== day-strip abbreviation contract (per-value) ===\n");

// A1 - per-value correctness at every boundary
{
  // zero always renders "$0" regardless of what else the strip contains
  assert("A1a  0 -> $0 (absence, not magnitude)",   fmtCompactDollars(0) === "$0");
  assert("A1b  -0 -> $0",                            fmtCompactDollars(-0) === "$0");

  // sub-$1,000 renders plain
  assert("A1c  1 -> $1 (never $0.0k)",               fmtCompactDollars(1) === "$1");
  assert("A1d  99 -> $99",                           fmtCompactDollars(99) === "$99");
  assert("A1e  234 -> $234",                         fmtCompactDollars(234) === "$234");
  assert("A1f  508 -> $508 (owner's live example)",  fmtCompactDollars(508) === "$508");
  assert("A1g  999 -> $999",                         fmtCompactDollars(999) === "$999");
  // 999.4 rounds to 999 - stays plain because the value is under $1000
  assert("A1h  999.4 -> $999",                       fmtCompactDollars(999.4) === "$999");

  // boundary - $1,000 crosses into abbreviation
  assert("A1i  1000 -> $1.0k (boundary)",            fmtCompactDollars(1000) === "$1.0k");
  assert("A1j  1509 -> $1.5k",                       fmtCompactDollars(1509) === "$1.5k");
  assert("A1k  9999 -> $10.0k",                      fmtCompactDollars(9999) === "$10.0k");

  // Band C - $XXk, rounded to nearest thousand
  assert("A1l  10000 -> $10k",                       fmtCompactDollars(10000) === "$10k");
  assert("A1m  12000 -> $12k",                       fmtCompactDollars(12000) === "$12k");
  assert("A1n  47500 -> $48k",                       fmtCompactDollars(47500) === "$48k");
  assert("A1o  999500 -> $1,000k",                   fmtCompactDollars(999500) === "$1,000k");

  // null preserved
  assert("A1p  null -> —",                           fmtCompactDollars(null) === "—");
}

// A2 - no caption ever renders any $0.Xk form. Comprehensive sweep
// across values 0 to 999 (the range where the prior rule would
// have produced $0.0k, $0.1k, $0.2k, etc when the strip's picked
// band was B). Under the new rule every one of these renders plain.
{
  const forbidden = /^\$0\.\d+k$/;
  const offenders = [];
  for (let v = 0; v < 1000; v++) {
    const s = fmtCompactDollars(v);
    if (forbidden.test(s)) offenders.push({ v, s });
  }
  assert(
    `A2  no value in [0, 999] renders any $0.Xk form (${offenders.length} offenders)`,
    offenders.length === 0,
    offenders.slice(0, 10),
  );
  // Also - zero itself never produces $0.0k regardless.
  assert("A2  fmtCompactDollars(0) === '$0' (never $0.0k)", fmtCompactDollars(0) === "$0");
}

// A3 - Width at 11px numeric font (Inter tabular). Per-char
// approximations calibrated to Kevin's `$1,509` = 33px measurement.
function width11px(s) {
  let w = 0;
  for (const ch of s) {
    if (ch === "$")       w += 4.5;
    else if (ch === ".")  w += 2.5;
    else if (ch === ",")  w += 2.5;
    else if (ch === "k")  w += 5.5;
    else if (ch === "~")  w += 5.0;
    else if (ch === "≥")  w += 8.0;
    else if (ch === " ")  w += 3.0;
    else if (/\d/.test(ch)) w += 6.6;
    else                  w += 6.6;
  }
  return w;
}
{
  const columnPx = 28;   // CIN - OH HS 10 25-day case
  const widestPlain      = "$999";     // widest sub-$1,000
  const widestAbbrevB    = "$9.9k";    // widest $X.Xk
  const widestAbbrevC    = "$99k";     // realistic MLB stand max
  console.log(`  reference: column=${columnPx}px  widestPlain="${widestPlain}"=${width11px(widestPlain).toFixed(1)}px  widestAbbrevB="${widestAbbrevB}"=${width11px(widestAbbrevB).toFixed(1)}px  widestAbbrevC="${widestAbbrevC}"=${width11px(widestAbbrevC).toFixed(1)}px`);
  assert(`A3a  widest plain "${widestPlain}" fits ${columnPx}px column`,     width11px(widestPlain) <= columnPx);
  assert(`A3b  widest $X.Xk "${widestAbbrevB}" fits ${columnPx}px column`,   width11px(widestAbbrevB) <= columnPx);
  assert(`A3c  widest $XXk "${widestAbbrevC}" fits ${columnPx}px column`,    width11px(widestAbbrevC) <= columnPx);

  // Ghost prefix `~$X` finding. `~$999` overflows 28px by 1.3px;
  // `~$9.9k` overflows by 2.7px. Both catch on the CSS ellipsis
  // fallback. Reachable only on a hypothetical future 25-day MLB
  // stand; the current portfolio caps future stands at 22 days
  // (~32px columns, both fit). Documented, not asserted.
  const ghostPlain     = "~$999";
  const ghostAbbrev    = "~$9.9k";
  console.log(`  A3d finding: ghost prefix at ${columnPx}px column`);
  console.log(`    "${ghostPlain}"  = ${width11px(ghostPlain).toFixed(1)}px  ${width11px(ghostPlain) <= columnPx ? "fits" : "overflows by " + (width11px(ghostPlain) - columnPx).toFixed(1) + "px"}`);
  console.log(`    "${ghostAbbrev}" = ${width11px(ghostAbbrev).toFixed(1)}px  ${width11px(ghostAbbrev) <= columnPx ? "fits" : "overflows by " + (width11px(ghostAbbrev) - columnPx).toFixed(1) + "px"}`);
  console.log(`    CSS ellipsis fallback on .kpi-wb-cap-value catches both if they land.`);
}

// A4 - >= prefix cannot host on day-strip captions. Owner-requested
// check. Kept for parity with the previous probe version.
{
  const columnPx = 28;
  const geCases = [
    { s: "≥ $999",  band: "plain" },
    { s: "≥ $9.9k", band: "abbrev-B" },
    { s: "≥ $99k",  band: "abbrev-C" },
  ];
  console.log(`\n  A4 finding: >= prefix width vs ${columnPx}px column`);
  let geHostable = true;
  for (const c of geCases) {
    const w = width11px(c.s);
    const fits = w <= columnPx;
    if (!fits) geHostable = false;
    console.log(`    "${c.s}" (${c.band}) = ${w.toFixed(1)}px  ${fits ? "fits" : "DOES NOT FIT"}`);
  }
  assert(
    `A4  >= prefix cannot host on day-strip captions at 28px columns`,
    !geHostable,
    { note: "expected failure: if any of the >= cases fits, revisit the design. Today all overflow, so the >= prefix stays on the What-it-cost card hero only." },
  );
}

console.log(`\n---`);
if (failures > 0) {
  console.log(`${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log(`all assertions pass.`);
