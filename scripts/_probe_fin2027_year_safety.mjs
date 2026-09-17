// scripts/_probe_fin2027_year_safety.mjs
//
// FIN-2027 W1 PR-A standing guard. Static scan for year-unsafe reads
// against year-keyed KPI tables. Exit 0 if 0 unsafe reads; exit 2 if
// any unsafe read remains (each printed with file:line + context).
//
// Usage:
//   node scripts/_probe_fin2027_year_safety.mjs
//
// Table classes:
//   - year-column tables: kpi_budgets, pnl_actuals, kpi_period_status,
//     labor_actuals, labor_actuals_daily, inventory_adjustments
//     -> require .eq("fiscal_year", ...) or a fiscalYear-shaped
//        variable predicate within 20 lines of the .from().
//   - date-scoped tables: sc_labor_budgets (no fiscal_year column;
//     scope by effective_from date range),
//     labor_actuals when the read is time-window-oriented
//     (week_start range in same block acceptable).
//
// A read is UNSAFE if it does not carry EITHER form of scoping in
// the same statement (typically within 12 lines of the `.from()`
// call).
//
// Stopgaps are ALLOWED - the scan checks for scoping, not
// parameterization. A hardcoded `.eq("fiscal_year", 2026)` is
// treated as safe (it is scoped, just pinned).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = new URL("../", import.meta.url).pathname;

// Tables to check + their acceptable scoping predicates.
// Any of the accepted predicates within LOOKAHEAD lines of the
// .from("<table>") call makes the read SAFE.
const RULES = [
  {
    tables: ["kpi_budgets", "pnl_actuals", "kpi_period_status", "inventory_adjustments"],
    acceptable: [
      /\.eq\("fiscal_year",\s*[^)]+\)/,
      /fiscalYear[,\s)]/,
    ],
    label: "year-column",
  },
  {
    tables: ["labor_actuals", "labor_actuals_daily"],
    acceptable: [
      /\.eq\("fiscal_year",\s*[^)]+\)/,
      /fiscalYear[,\s)]/,
      /\.(gte|lte|lt|gt)\("week_start"/,
      /\.eq\("week_start"/,
      /\.(gte|lte|lt|gt)\("work_date"/,  // labor_actuals_daily date column
      /\.eq\("work_date"/,
      /week_start.*FY_(START|END)_ISO/,
      /\.eq\("week_label"/, // per-week probes are inherently scoped
    ],
    label: "date-scoped (week_start or work_date)",
  },
  {
    tables: ["sc_labor_budgets"],
    acceptable: [
      /\.eq\("fiscal_year",\s*[^)]+\)/,
      /\.(gte|lte|lt|gt)\("effective_from"/,
      /effective_from.*FY_(START|END)_ISO/,
      /period",\s*"__NO_MATCH__"/, // explicit no-match sentinel
    ],
    label: "date-scoped (effective_from)",
  },
];

const LOOKAHEAD = 12;

const IGNORE_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", ".vercel", "coverage"]);
const CODE_EXTS = new Set([".js", ".mjs", ".ts", ".tsx", ".jsx"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (IGNORE_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else {
      const dot = name.lastIndexOf(".");
      const ext = dot >= 0 ? name.slice(dot) : "";
      if (CODE_EXTS.has(ext)) out.push(p);
    }
  }
  return out;
}

const files = walk(join(REPO_ROOT, "src"));

let unsafeCount = 0;
let scanned = 0;

for (const abs of files) {
  const rel = relative(REPO_ROOT, abs);
  const src = readFileSync(abs, "utf8");
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // Match .from("<table>") - either bare or via a supabase client
    const m = line.match(/\.from\("([a-zA-Z0-9_]+)"\)/);
    if (!m) continue;
    const table = m[1];
    let rule = null;
    for (const r of RULES) { if (r.tables.includes(table)) { rule = r; break; } }
    if (!rule) continue;
    scanned += 1;
    const window = lines.slice(i, Math.min(lines.length, i + LOOKAHEAD)).join("\n");
    // Also allow the fresh table-schema convention: some builders
    // do supa.from(name); pattern - if the read is bounded by a
    // .limit(1).maybeSingle() and does no data access on the
    // rows, it might still be intentionally global (freshness).
    // We do not carve exceptions here - the fix has to add scope.
    const safe = rule.acceptable.some((rx) => rx.test(window));
    if (!safe) {
      unsafeCount += 1;
      console.log(`UNSAFE  ${rel}:${i + 1}  from("${table}")  · ${rule.label}`);
      // Print the offending block for review
      for (let k = 0; k < 6 && i + k < lines.length; k += 1) {
        console.log(`   ${String(i + 1 + k).padStart(5)}  ${lines[i + k]}`);
      }
      console.log("");
    }
  }
}

console.log(`\nScanned ${scanned} year-keyed .from() calls under src/`);
console.log(`Unsafe reads: ${unsafeCount}`);
console.log(unsafeCount === 0 ? "GUARD PASS" : "GUARD FAIL");
process.exit(unsafeCount === 0 ? 0 : 2);
