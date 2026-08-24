// scripts/probes/_probe_kpi_multiselect_ranges.mjs
//
// Range PR-2 acceptance. Owner rulings 2026-08-24:
//   S1 P1-P3 resolves to the same date range as the equivalent manual
//      selection, and the chip labels "P1 - P3"
//   S2 Jan-Apr routes correctly and the chip labels "Jan - Apr 2026"
//   S3 a pre-floor month refuses through the EXISTING path - assert
//      no new refusal branch was added
//   S4 last_13wk is gone from the preset list AND from any saved-view
//      payload that referenced it
//   S5 non-contiguous selection is unreachable
//   S6 a URL with a `label` that disagrees with its start/end renders
//      the DATE RANGE, not the stale label
//
// Pure-function probe. Reads the source directly for the deleted-key
// sweep (S4); pulls rangeForPeriod / rangeForFiscalMonth for S1/S2;
// calls resolveRangeSource for S3; parses/validates labels for S6.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { resolveRangeSource } from "../../src/lib/labor/rangeResolver.js";
import { rangeForPeriod, rangeForFiscalMonth } from "../../src/app/kpi/labor/lib/periods.js";
import {
  parseLabel,
  labelToRange,
  validateLabel,
  formatSelection,
  serializeSelection,
} from "../../src/app/kpi/labor/lib/rangeLabel.js";
import { PRESET_KEYS } from "../../src/app/kpi/labor/lib/accounts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

let hardFail = 0;
function ok(line)   { console.log(`  OK    ${line}`); }
function fail(line) { console.log(`  FAIL  ${line}`); hardFail++; }
function eq(a, b, msg) {
  if (JSON.stringify(a) === JSON.stringify(b)) ok(msg);
  else fail(`${msg}   got=${JSON.stringify(a)}  want=${JSON.stringify(b)}`);
}

console.log("=".repeat(72));
console.log("Range PR-2 multi-select acceptance");
console.log("=".repeat(72));

// ─── S1 P1-P3 resolves + labels ─────────────────────────────────────
console.log("");
console.log("[S1] P1-P3 resolves to same range as manual + chip labels 'P1 - P3'");
{
  const a = rangeForPeriod(1);
  const b = rangeForPeriod(3);
  const parsed = parseLabel("P1-P3");
  eq(parsed?.kind, "periods", "  parses as periods range");
  eq(parsed?.start, 1, "  start=1");
  eq(parsed?.end, 3, "  end=3");
  const range = labelToRange(parsed);
  eq(range.startISO, a.startISO, "  startISO == rangeForPeriod(1).startISO");
  eq(range.endISO,   b.endISO,   "  endISO   == rangeForPeriod(3).endISO");
  eq(formatSelection(parsed), "P1 - P3", "  chip label");
  eq(serializeSelection(parsed), "P1-P3", "  URL serialization round-trips");
}

// ─── S2 Jan-Apr labels + routes ─────────────────────────────────────
console.log("");
console.log("[S2] Jan-Apr routes correctly + chip labels 'Jan - Apr 2026'");
{
  const parsed = parseLabel("2026-01_2026-04");
  eq(parsed?.kind, "months", "  parses as months range");
  eq(parsed?.start, { year: 2026, monthIndex: 0 }, "  start=Jan 2026");
  eq(parsed?.end,   { year: 2026, monthIndex: 3 }, "  end=Apr 2026");
  const a = rangeForFiscalMonth(2026, 0);
  const b = rangeForFiscalMonth(2026, 3);
  const range = labelToRange(parsed);
  eq(range.startISO, a.startISO, "  startISO == rangeForFiscalMonth(Jan)");
  eq(range.endISO,   b.endISO,   "  endISO   == rangeForFiscalMonth(Apr)");
  eq(formatSelection(parsed), "Jan - Apr 2026", "  chip label");
}
// Cross-year edge (FY2026 starts 2025-12-29 - straddles calendar years).
{
  const parsed = parseLabel("2026-11_2027-02");
  eq(formatSelection(parsed), "Nov 2026 - Feb 2027", "  cross-year label reads year on both ends");
}

// ─── S3 pre-floor month refuses through EXISTING path ───────────────
console.log("");
console.log("[S3] pre-floor month refuses through the existing refusal path");
{
  // Feb 2026 partial - fully pre-floor (floor 2026-04-20).
  const r = resolveRangeSource({
    startISO: "2026-02-02", endISO: "2026-02-28", dailyFloorISO: "2026-04-20",
  });
  eq(r.source, null,        "  source=null (existing refusal)");
  eq(r.refused, true,       "  refused=true");
  eq(r.reason, "range_partial_before_floor",
     "  reason names the existing branch, NOT a new month-specific reason");
  // Zero new resolver branches added.
  const resolverSrc = readFileSync(join(REPO_ROOT, "src/lib/labor/rangeResolver.js"), "utf8");
  if (!/month.*refus|refuse.*month/i.test(resolverSrc)) ok("  no month-specific refusal branch in rangeResolver.js");
  else fail("  rangeResolver.js appears to contain a month-specific refusal - refusal must go through the existing path");
}

// ─── S4 last_13wk gone from PRESET_KEYS and from saved-view payloads ─
console.log("");
console.log("[S4] last_13wk purged from preset list + saved-view schema");
{
  if (!PRESET_KEYS.includes("last_13wk")) ok("  PRESET_KEYS excludes 'last_13wk'");
  else fail("  PRESET_KEYS still includes 'last_13wk'");

  // The two API routes' VALID_PRESETS are the authoritative gate on
  // saved-view writes. Read them as source and assert last_13wk is
  // absent from both sets - a fresh POST or PATCH cannot land the
  // retired preset in the DB.
  const listRoute = readFileSync(join(REPO_ROOT, "src/app/api/kpi/labor/views/route.js"), "utf8");
  const idRoute   = readFileSync(join(REPO_ROOT, "src/app/api/kpi/labor/views/[id]/route.js"), "utf8");
  const seesL13 = (txt) => /VALID_PRESETS\s*=\s*new\s+Set\(\[[^\]]*['"]last_13wk['"]/.test(txt);
  if (!seesL13(listRoute)) ok("  views/route.js VALID_PRESETS excludes 'last_13wk'");
  else fail("  views/route.js VALID_PRESETS still contains 'last_13wk'");
  if (!seesL13(idRoute))   ok("  views/[id]/route.js VALID_PRESETS excludes 'last_13wk'");
  else fail("  views/[id]/route.js VALID_PRESETS still contains 'last_13wk'");

  // Migration exists and drops last_13wk from the CHECK constraint.
  const mig = readFileSync(join(REPO_ROOT, "docs/migrations/pr-2-range-drop-last-13wk.sql"), "utf8");
  if (/kpi_saved_views_preset_known/.test(mig) && !/last_13wk/.test(mig.split("ADD CONSTRAINT")[1] || "")) {
    ok("  migration adds new CHECK without 'last_13wk'");
  } else {
    fail("  migration missing or still contains 'last_13wk' in the ADD CONSTRAINT clause");
  }
}

// ─── S5 non-contiguous selection is unreachable ─────────────────────
console.log("");
console.log("[S5] non-contiguous selection is unreachable via the label vocabulary");
{
  // The URL serialization has no shape for gaps. Any two-endpoint
  // selection resolves to the whole span between them; the resolver
  // never sees a list-of-ranges. Assert the vocabulary.
  eq(parseLabel("P1,P3"),   null, "  no comma vocabulary for periods");
  eq(parseLabel("P1|P3"),   null, "  no pipe vocabulary either");
  eq(parseLabel("P1-P3-P5"), null, "  no three-endpoint vocabulary");
  // A pair with end < start rejects: the resolver never sees a
  // reversed range that would sneak through as two separate slices.
  eq(parseLabel("P3-P1"),   null, "  reversed pair rejected");
  eq(parseLabel("2026-04_2026-01"), null, "  reversed month pair rejected");
  // Multi-month underscore separator is unambiguous - a hyphen
  // separator '2026-01-2026-04' could be misparsed but is rejected
  // because our regex requires the underscore.
  eq(parseLabel("2026-01-2026-04"), null, "  hyphen between months rejected (unambiguous serialization)");
}

// ─── S6 URL label that disagrees with dates falls back to date range ─
console.log("");
console.log("[S6] label validated against dates - a label that lies renders the date range");
{
  const a = rangeForPeriod(1);
  const c = rangeForPeriod(3);
  // Truthful: label P1-P3 with dates that match P1 start .. P3 end.
  const truthful = validateLabel("P1-P3", a.startISO, c.endISO);
  if (truthful && truthful.kind === "periods" && truthful.start === 1 && truthful.end === 3) {
    ok("  label matches dates -> validated selection returned");
  } else {
    fail(`  truthful label validation failed: ${JSON.stringify(truthful)}`);
  }
  // Lying: label P1-P3 with dates that resolve to a different range.
  const b = rangeForPeriod(2);
  const lying = validateLabel("P1-P3", a.startISO, b.endISO);
  eq(lying, null, "  label 'P1-P3' + dates that resolve to P1-P2 -> null (fallback to dates)");
  // Lying month: single month label with wrong dates.
  const may = rangeForFiscalMonth(2026, 4);
  const lyingMonth = validateLabel("2026-07", may.startISO, may.endISO);
  eq(lyingMonth, null, "  label '2026-07' + May dates -> null");
  // Garbage label falls back.
  eq(validateLabel("garbage", a.startISO, c.endISO), null, "  unparseable label -> null");
  eq(validateLabel("",         a.startISO, c.endISO), null, "  empty label -> null");
  eq(validateLabel(null,       a.startISO, c.endISO), null, "  null label -> null");
}

// ─── Round-trip sanity ──────────────────────────────────────────────
console.log("");
console.log("[round-trip] every serialized selection parses back to itself");
{
  const cases = [
    { kind: "period", value: 5 },
    { kind: "periods", start: 1, end: 3 },
    { kind: "month", value: { year: 2026, monthIndex: 6 } },
    { kind: "months", start: { year: 2026, monthIndex: 0 }, end: { year: 2026, monthIndex: 3 } },
    { kind: "months", start: { year: 2026, monthIndex: 10 }, end: { year: 2027, monthIndex: 1 } },
  ];
  for (const sel of cases) {
    const s = serializeSelection(sel);
    const back = parseLabel(s);
    eq(back, sel, `  ${JSON.stringify(sel)} <-> "${s}"`);
  }
}

console.log("");
console.log("=".repeat(72));
console.log(hardFail === 0 ? "RANGE PR-2: ALL PROBES PASS" : `RANGE PR-2: ${hardFail} FAILURE(S)`);
console.log("=".repeat(72));
process.exit(hardFail === 0 ? 0 : 1);
