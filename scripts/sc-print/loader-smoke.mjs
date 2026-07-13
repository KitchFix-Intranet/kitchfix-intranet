#!/usr/bin/env node
// SC print loader smoke test - the mistyped-filter guard.
//
// Exercises all four print loaders (Month / Period / Season / Year)
// against real Supabase creds so a broken query text or a coerced-
// type filter can't ship silently again. Each loader is invoked on
// one representative account and the return shape is spot-checked.
//
// This is not a full property-based test - just a structural probe
// that catches PostgREST error surfaces + basic shape regressions.
// Extends to more accounts on demand.
//
// Usage (via tsx so @/ path aliases resolve like Next.js):
//   TSX_TSCONFIG_PATH=./jsconfig.json npx tsx --env-file=.env.local \
//     scripts/sc-print/loader-smoke.mjs
//
// Exit codes:
//   0  every loader returned a well-shaped context
//   1  one or more loaders threw
//   2  environment misconfigured (missing SUPABASE_* vars, etc.)

const YEAR = 2026;

// Cover matrix: exercise every distinct code path in the print
// module's data-source arm.
//   - month scope on a schedule account (loads homestand context)
//   - month scope on an overlay account (loads schedule overlay)
//   - period scope on a per-meal PDC (no homestand, no overlay)
//   - season scope on a schedule account (direct sc_homestand_schedule)
//   - year scope on all three account shapes (schedule / overlay /
//     no-schedule) - the Wave 2 regression surface
const CASES = [
  { name: "month · schedule account (CIN - OH · 2026-06)",
    fn: async (M) => M.loadMonthPrintData("CIN - OH", YEAR, "2026-06"),
    module: "monthSheet",
    check: (ctx) => ctx.account && ctx.grid && Array.isArray(ctx.grid.rows) },
  { name: "month · overlay account (STL - FL · 2026-03)",
    fn: async (M) => M.loadMonthPrintData("STL - FL", YEAR, "2026-03"),
    module: "monthSheet",
    check: (ctx) => ctx.account && ctx.grid && ctx.hasScheduleOverlay === true },
  { name: "period · per-meal PDC (CIN - AZ · P8)",
    fn: async (M) => M.loadPeriodPrintData("CIN - AZ", YEAR, "P8"),
    module: "monthSheet",
    check: (ctx) => ctx.account && ctx.periodStart && ctx.periodEnd },
  { name: "season · schedule account (CIN - KY)",
    fn: async (M) => M.loadSeasonPrintData("CIN - KY", YEAR),
    module: "seasonSheet",
    check: (ctx) => ctx.account && typeof ctx.byMonth === "object" && ctx.firstMonth },
  { name: "season · overlay account (TBJ - FL) [HOME SCHEDULE variant]",
    fn: async (M) => M.loadSeasonPrintData("TBJ - FL", YEAR),
    module: "seasonSheet",
    check: (ctx) => ctx.account && ctx.isOverlay === true },
  { name: "year · schedule account (STL - FL)",
    fn: async (M) => M.loadYearPrintData("STL - FL", YEAR),
    module: "yearSheet",
    check: (ctx) => ctx.account && ctx.homeDates instanceof Set && ctx.springDates instanceof Set },
  { name: "year · MLB fee account (CIN - OH)",
    fn: async (M) => M.loadYearPrintData("CIN - OH", YEAR),
    module: "yearSheet",
    check: (ctx) => ctx.account && ctx.hasSchedule === true && ctx.homeDates.size > 0 },
  { name: "year · per-meal PDC no schedule (CIN - AZ)",
    fn: async (M) => M.loadYearPrintData("CIN - AZ", YEAR),
    module: "yearSheet",
    check: (ctx) => ctx.account && ctx.hasSchedule === false && ctx.homeDates.size === 0 },
];

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  process.stderr.write("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env.\n");
  process.exit(2);
}

const modules = {
  monthSheet: await import("../../src/lib/print/monthSheet.js"),
  seasonSheet: await import("../../src/lib/print/seasonSheet.js"),
  yearSheet: await import("../../src/lib/print/yearSheet.js"),
};

let fails = 0;
for (const c of CASES) {
  process.stdout.write(`── ${c.name} ─────\n`);
  try {
    const ctx = await c.fn(modules[c.module]);
    const shapeOK = c.check(ctx);
    if (!shapeOK) {
      fails++;
      process.stdout.write(`  SHAPE FAIL: check() returned false. ctx keys: ${Object.keys(ctx).join(", ")}\n`);
    } else {
      process.stdout.write(`  OK\n`);
    }
  } catch (err) {
    fails++;
    process.stdout.write(`  THROW: ${err?.message}\n`);
    const line = (err?.stack || "").split("\n").slice(1, 3).join("\n");
    if (line) process.stdout.write(`  ${line}\n`);
  }
}

if (fails > 0) {
  process.stdout.write(`\n${fails}/${CASES.length} cases failed.\n`);
  process.exit(1);
}
process.stdout.write(`\nAll ${CASES.length} loader smoke cases passed.\n`);
