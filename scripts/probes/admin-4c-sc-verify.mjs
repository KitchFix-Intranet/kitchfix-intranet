// scripts/probes/admin-4c-sc-verify.mjs
//
// Static verification of the Stage 4c Service Calendar consumer
// rewire. Does NOT exercise the API (no dev server, no auth) - lints
// the source tree to confirm the import removals + async wrapper
// swaps + client prop threading all landed.
//
// Usage:
//   node --env-file=.env.local scripts/probes/admin-4c-sc-verify.mjs
//
// Exit codes:
//   0 - all static checks pass
//   1 - any check failed (prints the specific issue)
//   3 - unexpected error

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(__filename), "..", "..");

console.log("ADMIN STAGE-4C SC VERIFY");
console.log("========================");

const results = [];
function record(name, ok, detail = "") {
  const pad = (name + ":").padEnd(44, " ");
  console.log(`${pad}${ok ? "PASS ✓" : "FAIL ✗"}  ${detail}`);
  results.push({ name, ok, detail });
}
function src(rel) {
  const p = join(REPO_ROOT, rel);
  if (!existsSync(p)) throw new Error(`missing file: ${rel}`);
  return readFileSync(p, "utf8");
}

const ROUTE_PATH    = "src/app/api/service-calendar/route.js";
const PERIOD_PATH   = "src/lib/scPeriodLock.js";
const FINALIZE_PATH = "src/lib/scWeekFinalize.js";
const CAL_PATH      = "src/app/service-calendar/ServiceCalendar.js";
const WORK_PATH     = "src/app/service-calendar/season/PeriodWorkspace.js";
const PAGE_PATH     = "src/app/service-calendar/page.js";

// ─── 1. No stale sync imports in rewired files ─────────────────────
{
  const problems = [];
  // Each check is "import ... <name> from @/lib/admin" (import line)
  // rather than mere mentions in comments.
  const importLineRe = (name) => new RegExp(`^import\\s[^;]*\\b${name}\\b[^;]*from\\s+["']@/lib/admin["']`, "m");

  const route = src(ROUTE_PATH);
  if (importLineRe("isScAdmin").test(route) && !importLineRe("isScAdminDb").test(route)) problems.push("route.js imports isScAdmin (sync) but not isScAdminDb");
  if (importLineRe("isScLockOverride").test(route) && !importLineRe("isScLockOverrideDb").test(route)) problems.push("route.js imports isScLockOverride (sync) but not isScLockOverrideDb");

  const period = src(PERIOD_PATH);
  if (importLineRe("isScLockOverride").test(period) && !importLineRe("isScLockOverrideDb").test(period)) problems.push("scPeriodLock.js imports sync isScLockOverride");

  const finalize = src(FINALIZE_PATH);
  if (importLineRe("isScLockOverride").test(finalize) && !importLineRe("isScLockOverrideDb").test(finalize)) problems.push("scWeekFinalize.js imports sync isScLockOverride");

  const cal = src(CAL_PATH);
  if (importLineRe("isScAdmin").test(cal)) problems.push("ServiceCalendar.js still imports isScAdmin from admin.js");

  const work = src(WORK_PATH);
  if (importLineRe("isScLockOverride").test(work)) problems.push("PeriodWorkspace.js still imports isScLockOverride from admin.js");

  const page = src(PAGE_PATH);
  if (importLineRe("SC_ADMINS").test(page)) problems.push("page.js still imports SC_ADMINS from admin.js");

  record("No stale sync imports in rewired files", problems.length === 0, problems.length === 0 ? "6 files clean" : problems.join(" | "));
}

// ─── 2. Async wrapper call counts in server files ──────────────────
// Strip single-line (//) and multi-line (/* */) comments before
// counting - doc comments that mention the wrapper names should not
// inflate the count of real call sites.
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")  // /* ... */ blocks
    .replace(/^\s*\/\/.*$/mg, "")      // // line comments
    .replace(/\/\/[^\n]*$/mg, "");     // trailing // comments
}
{
  const route = stripComments(src(ROUTE_PATH));
  const scAdminDbCalls      = (route.match(/\bisScAdminDb\s*\(/g)      || []).length;
  const scLockOverrideCalls = (route.match(/\bisScLockOverrideDb\s*\(/g) || []).length;
  const scAccessCalls       = (route.match(/\bisScAccessDb\s*\(/g)     || []).length;
  // Expected: 17 isScAdmin sites (1 sc-load + 16 POST) + 1 sc-load
  // precompute reference => the sc-load value substitutes a precomputed
  // variable, so the final count is: 16 POST awaits + 1 await at the
  // precompute + 0 inline in the response => 17.
  // Actually: precompute line adds 1, response uses `scLoadScAdmin`
  // variable (no isScAdminDb token), POST sites = 16. Total = 17.
  // Handoff spec: 17 total.
  const expectAdmin = 17;
  const expectLock  = 2;  // 1 POST site (sc-revert-finalize) + 1 sc-load precompute
  const expectAccess = 1; // sc-hero augment
  const okAdmin = scAdminDbCalls === expectAdmin;
  const okLock  = scLockOverrideCalls === expectLock;
  const okAcc   = scAccessCalls === expectAccess;
  record("route.js isScAdminDb() count",      okAdmin, `${scAdminDbCalls}/${expectAdmin}`);
  record("route.js isScLockOverrideDb() count", okLock, `${scLockOverrideCalls}/${expectLock}`);
  record("route.js isScAccessDb() count",     okAcc, `${scAccessCalls}/${expectAccess}`);

  const period = stripComments(src(PERIOD_PATH));
  const pCalls = (period.match(/\bisScLockOverrideDb\s*\(/g) || []).length;
  record("scPeriodLock.js isScLockOverrideDb count", pCalls === 1, `${pCalls}/1`);

  const finalize = stripComments(src(FINALIZE_PATH));
  const fCalls = (finalize.match(/\bisScLockOverrideDb\s*\(/g) || []).length;
  record("scWeekFinalize.js isScLockOverrideDb count", fCalls === 1, `${fCalls}/1`);
}

// ─── 3. Client prop threading ──────────────────────────────────────
{
  const cal = src(CAL_PATH);
  const work = src(WORK_PATH);
  const page = src(PAGE_PATH);

  const problems = [];
  // ServiceCalendar should derive isAdmin from data.viewerIsScAdmin
  if (!/data\?\.viewerIsScAdmin/.test(cal)) problems.push("ServiceCalendar: data?.viewerIsScAdmin derivation missing");
  // ServiceCalendar should pass viewerIsLockOverride through to PeriodWorkspace
  if (!/viewerIsLockOverride=\{!!data\?\.viewerIsLockOverride\}/.test(cal)) problems.push("ServiceCalendar: viewerIsLockOverride={!!data?.viewerIsLockOverride} prop missing on PeriodWorkspace");
  // PeriodWorkspace should accept viewerIsLockOverride as a prop
  if (!/viewerIsLockOverride\s*=\s*false,/.test(work)) problems.push("PeriodWorkspace: viewerIsLockOverride prop default not declared");
  if (!/const\s+isOverrideUser\s*=\s*viewerIsLockOverride\s*;/.test(work)) problems.push("PeriodWorkspace: isOverrideUser derivation not from prop");
  // page.js should consume scAccess (viewerIsScAccess from sc-hero)
  if (!/scAccess/.test(page)) problems.push("page.js: scAccess state not threading through");
  if (!/viewerIsScAccess/.test(page)) problems.push("page.js: no reference to viewerIsScAccess");

  record("Client prop threading", problems.length === 0, problems.length === 0 ? "all three components wired" : problems.join(" | "));
}

// ─── Verdict ──────────────────────────────────────────────────────────
console.log("");
const failed = results.filter((r) => !r.ok);
if (failed.length === 0) {
  console.log("RESULT: ALL PASS");
  process.exit(0);
}
console.log(`RESULT: FAIL (${failed.length} check(s) failed)`);
for (const r of failed) console.log(`  - ${r.name}: ${r.detail}`);
process.exit(1);
