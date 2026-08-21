// scripts/_probe_daily_source_purity.mjs
//
// PR-3a acceptance. Server-only. Exercises the daily-source branch
// against a real Supabase service_role client - not a code-read. The
// client-side "hit the route via HTTP" acceptance moves to PR-3b
// where the client can actually generate partial-week requests.
//
// Assertions
//   P1  partial-week request returns source='daily' body with
//       actuals_range + actuals_daily + budget_prorate keys AND
//       omits board / budget_periods / week_budgets keys
//   P2  same request with include_salary=1 populates salary_summary
//       + salary_prorate + adds salaried=true rows to actuals_range
//   P3  same request with include_salary=0 returns salary_summary
//       null + salary_prorate null + zero salaried=true rows
//   P4  pro-rated budget total is the exact rounded sum of unrounded
//       slices (LRM invariant); slices sum to total to the cent
//   P5  pro-rated salary total is the exact rounded sum of unrounded
//       per-worker slices (LRM invariant); per-worker slices sum to
//       total to the cent
//   P6  refusal shape (via resolveRangeSource pure function) - a
//       partial-week request starting before the floor returns
//       source=null, refused=true, and the owner-approved message
//   P7  route.js code-shape: refusal branch inline in GET handler
//       still omits every data key (regression guard for PR-2's
//       [route-shape] assertion)
//   P8  sentinel - CIN - OH week 2026-06-29 whole-week request via
//       the WEEKLY branch (not daily) still yields the weekly
//       sentinel $4,328.27. Confirms no PR-3a regression on the
//       weekly path.
//
// Usage: node --env-file=.env.local scripts/_probe_daily_source_purity.mjs

import { createClient } from "@supabase/supabase-js";
import { resolveRangeSource } from "../../src/lib/labor/rangeResolver.js";
import { buildDailyRangeBody } from "../../src/lib/labor/dailyRangeBody.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..", "..");

let hardFail = 0;
function ok(line)   { console.log(`  OK    ${line}`); }
function fail(line) { console.log(`  FAIL  ${line}`); hardFail++; }
function skip(line) { console.log(`  SKIP  ${line}`); }

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

console.log("=".repeat(72));
console.log("PR-3a daily source-purity probe");
console.log("=".repeat(72));

// Corporate caller stub - full permission, no per-account gating.
const corporateCaller = { role: "corporate", scope: null, can_see_salary: true };

// Worker-meta resolver stub - probe assertions don't inspect the
// workers dict, so a no-op preserves shape without pulling in the
// (Next-only) resolveWorkerMeta module tree.
async function resolveWorkerMetaStub() {
  return { workerMeta: {}, resolvedNames: [], usersReachable: false };
}

const commonCtx = {
  supa,
  landing_account: "ALL",
  accounts_directory: [],
  regional_directors_display: { East: "S. Lynch", West: "R. Moore" },
  freshness: { last_walk_at: null, last_walk_ids_seen: null, last_derive_at: null },
  dailyFloorISO: "2026-04-20",
  caller: corporateCaller,
  resolveWorkerMeta: resolveWorkerMetaStub,
};

// ─── P1 partial-week body shape ─────────────────────────────────────
console.log("");
console.log("[P1] partial-week request -> daily body shape (source='daily', no weekly-shape keys)");
await (async () => {
  const rs = resolveRangeSource({ startISO: "2026-07-09", endISO: "2026-07-12", dailyFloorISO: "2026-04-20" });
  const out = await buildDailyRangeBody({
    ...commonCtx,
    account: "CIN - AZ", start: "2026-07-09", end: "2026-07-12", today: "2026-08-20",
    rangeSource: rs,
    salary_available: false, includeSalary: false,
  });
  if (out.error) { fail(`build error: ${JSON.stringify(out.error)}`); return; }
  const body = out.body;
  const hasDaily = body.source === "daily"
    && Array.isArray(body.actuals_range)
    && Array.isArray(body.actuals_daily)
    && body.budget_prorate && typeof body.budget_prorate === "object";
  if (hasDaily) ok(`source='daily' + actuals_range (${body.actuals_range.length}) + actuals_daily (${body.actuals_daily.length}) + budget_prorate`);
  else fail(`daily body missing keys: source=${body.source} actuals_range=${Array.isArray(body.actuals_range)} actuals_daily=${Array.isArray(body.actuals_daily)} budget_prorate=${!!body.budget_prorate}`);
  const weeklyLeaks = ["board", "budget_periods", "week_budgets"].filter(k => body[k] !== undefined);
  if (weeklyLeaks.length === 0) ok("daily body omits weekly-shape keys (board / budget_periods / week_budgets)");
  else fail(`daily body leaks weekly-shape keys: ${weeklyLeaks.join(", ")}`);
})();

// ─── P2 daily with include_salary=1 ─────────────────────────────────
console.log("");
console.log("[P2] partial-week + include_salary=1 -> salary_summary + salary_prorate + salaried rows");
await (async () => {
  const rs = resolveRangeSource({ startISO: "2026-07-09", endISO: "2026-07-12", dailyFloorISO: "2026-04-20" });
  const out = await buildDailyRangeBody({
    ...commonCtx,
    account: "CIN - AZ", start: "2026-07-09", end: "2026-07-12", today: "2026-08-20",
    rangeSource: rs,
    salary_available: true, includeSalary: true,
  });
  if (out.error) { fail(`build error: ${JSON.stringify(out.error)}`); return; }
  const body = out.body;
  const salariedRows = (body.actuals_range || []).filter(r => r.salaried);
  const hasSalary = body.salary_summary && body.salary_prorate && salariedRows.length > 0;
  if (hasSalary) ok(`salary merged: ${salariedRows.length} salaried rows, summary.amount=$${body.salary_summary.amount}, prorate.label='${body.salary_prorate.label}'`);
  else fail(`salary not merged: summary=${!!body.salary_summary} prorate=${!!body.salary_prorate} salaried_rows=${salariedRows.length}`);
  if (body.salary_available === true) ok("salary_available=true (role gate + caller can see salary)");
  else fail(`salary_available=${body.salary_available}, expected true`);
  if (body.salary_included === true) ok("salary_included=true");
  else fail(`salary_included=${body.salary_included}, expected true`);
})();

// ─── P3 daily with include_salary=0 ─────────────────────────────────
console.log("");
console.log("[P3] partial-week + include_salary=0 -> salary null + zero salaried rows");
await (async () => {
  const rs = resolveRangeSource({ startISO: "2026-07-09", endISO: "2026-07-12", dailyFloorISO: "2026-04-20" });
  const out = await buildDailyRangeBody({
    ...commonCtx,
    account: "CIN - AZ", start: "2026-07-09", end: "2026-07-12", today: "2026-08-20",
    rangeSource: rs,
    salary_available: true, includeSalary: false,
  });
  if (out.error) { fail(`build error: ${JSON.stringify(out.error)}`); return; }
  const body = out.body;
  const salariedRows = (body.actuals_range || []).filter(r => r.salaried);
  if (body.salary_summary === null && body.salary_prorate === null && salariedRows.length === 0) {
    ok("salary_summary=null + salary_prorate=null + zero salaried rows");
  } else {
    fail(`unexpected: summary=${body.salary_summary} prorate=${body.salary_prorate} salaried_rows=${salariedRows.length}`);
  }
  if (body.salary_available === true) ok("salary_available=true is honest: caller CAN see salary; they just did not ask");
  else fail(`salary_available=${body.salary_available}, expected true`);
  if (body.salary_included === false) ok("salary_included=false");
})();

// ─── P4 budget pro-rate LRM invariant ───────────────────────────────
console.log("");
console.log("[P4] budget pro-rate: slice sum == total to the cent (LRM)");
await (async () => {
  const rs = resolveRangeSource({ startISO: "2026-07-09", endISO: "2026-07-19", dailyFloorISO: "2026-04-20" });
  const out = await buildDailyRangeBody({
    ...commonCtx,
    account: "STL - FL", start: "2026-07-09", end: "2026-07-19", today: "2026-08-20",
    rangeSource: rs,
    salary_available: false, includeSalary: false,
  });
  if (out.error) { fail(`build error: ${JSON.stringify(out.error)}`); return; }
  const body = out.body;
  const bp = body.budget_prorate;
  if (!bp) { fail("budget_prorate missing"); return; }
  const sliceSum = bp.periods.reduce((s, p) => s + Number(p.budget_slice), 0);
  const sliceCents = Math.round(sliceSum * 100);
  const totalCents = Math.round(bp.total * 100);
  if (sliceCents === totalCents) ok(`slice sum $${(sliceCents/100).toFixed(2)} == total $${(totalCents/100).toFixed(2)} EXACT`);
  else fail(`slice sum ${(sliceCents/100).toFixed(2)} != total ${(totalCents/100).toFixed(2)}`);
  if (bp.label) ok(`pro-rate label present: "${bp.label}"`);
  else fail("pro-rate label missing on a partial-week range");
})();

// ─── P5 salary pro-rate LRM invariant ───────────────────────────────
console.log("");
console.log("[P5] salary pro-rate: per-worker slice sum == total to the cent (LRM)");
await (async () => {
  const rs = resolveRangeSource({ startISO: "2026-07-09", endISO: "2026-07-19", dailyFloorISO: "2026-04-20" });
  const out = await buildDailyRangeBody({
    ...commonCtx,
    account: "STL - FL", start: "2026-07-09", end: "2026-07-19", today: "2026-08-20",
    rangeSource: rs,
    salary_available: true, includeSalary: true,
  });
  if (out.error) { fail(`build error: ${JSON.stringify(out.error)}`); return; }
  const body = out.body;
  const sp = body.salary_prorate;
  if (!sp) { fail("salary_prorate missing"); return; }
  if (sp.workers.length === 0) { skip(`no salaried workers at STL - FL for range - salary sum $0 (${sp.workers.length} workers)`); return; }
  const sliceSum = sp.workers.reduce((s, w) => s + Number(w.slice), 0);
  const sliceCents = Math.round(sliceSum * 100);
  const totalCents = Math.round(sp.total * 100);
  if (sliceCents === totalCents) ok(`per-worker slice sum $${(sliceCents/100).toFixed(2)} == total $${(totalCents/100).toFixed(2)} EXACT across ${sp.workers.length} workers`);
  else fail(`per-worker slice sum ${(sliceCents/100).toFixed(2)} != total ${(totalCents/100).toFixed(2)}`);
  if (sp.label) ok(`pro-rate label present: "${sp.label}"`);
  else fail("salary pro-rate label missing");
  if (body.budget_prorate?.label === sp.label) ok("budget + salary labels agree for the range");
  else fail(`labels disagree: budget='${body.budget_prorate?.label}' salary='${sp.label}'`);
})();

// ─── P6 refusal shape from resolveRangeSource (pure function) ───────
console.log("");
console.log("[P6] pre-floor partial refusal: resolveRangeSource returns source=null + owner-approved message");
{
  const rs = resolveRangeSource({ startISO: "2026-04-19", endISO: "2026-04-25", dailyFloorISO: "2026-04-20" });
  if (rs.source === null && rs.refused === true) ok("source=null + refused=true");
  else fail(`unexpected: source=${rs.source} refused=${rs.refused}`);
  if (rs.refusalMessage === "Daily detail starts 04/20/26. Pick a range on or after that date, or use whole weeks.") {
    ok("refusal message verbatim per owner ruling");
  } else fail(`refusal message wrong: '${rs.refusalMessage}'`);
}

// ─── P7 route refusal branch omits data keys (regression guard) ─────
console.log("");
console.log("[P7] route.js refusal branch code-shape: omits every data key (guard for PR-2's [route-shape])");
{
  const routeSrc = fs.readFileSync(path.join(REPO_ROOT, "src/app/api/kpi/labor/route.js"), "utf8");
  const routeCode = routeSrc.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const refusalBlock = routeCode.match(/if \(rangeSource\.refused\) \{\s*return NextResponse\.json\(\{([\s\S]*?)\}\);\s*\}/);
  if (!refusalBlock) fail("refusal branch not found in route.js");
  else {
    const body = refusalBlock[1];
    const leaks = [];
    for (const key of ["board", "actuals", "budget_periods", "week_budgets", "actuals_daily", "actuals_range", "budget_prorate", "salary_prorate", "salary_summary"]) {
      if (new RegExp(`\\b${key}\\s*:`).test(body)) leaks.push(key);
    }
    if (leaks.length === 0) ok("refusal body omits all data keys (source, refused, reason, message, daily_floor, directory only)");
    else fail(`refusal body leaks data keys: ${leaks.join(", ")}`);
  }
}

// ─── P8 CIN - OH 06/29 weekly sentinel unchanged ─────────────────────
console.log("");
console.log("[P8] CIN - OH week 2026-06-29 whole-week -> weekly branch, sentinel $4,328.27");
await (async () => {
  const rs = resolveRangeSource({ startISO: "2026-06-29", endISO: "2026-07-05", dailyFloorISO: "2026-04-20" });
  if (rs.source === "weekly" && rs.isWholeWeeks) ok("resolveRangeSource routes 06/29-07/05 to weekly (whole week, not daily)");
  else fail(`unexpected: source=${rs.source} isWholeWeeks=${rs.isWholeWeeks}`);
  const q = await supa.from("labor_actuals_latest")
    .select("amount")
    .eq("account_key", "CIN - OH")
    .eq("week_start", "2026-06-29");
  const sum = (q.data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
  if (Math.abs(sum - 4328.27) < 0.005) ok(`labor_actuals CIN - OH 06/29 = $${sum.toFixed(2)}  (want $4,328.27)`);
  else fail(`sentinel drift: labor_actuals CIN - OH 06/29 = $${sum.toFixed(2)}`);
})();

console.log("");
console.log("=".repeat(72));
console.log(hardFail === 0 ? "PR-3a DAILY SOURCE PURITY: ALL PROBES PASS" : `PR-3a DAILY SOURCE PURITY: ${hardFail} FAILURE(S)`);
console.log("=".repeat(72));
process.exit(hardFail === 0 ? 0 : 1);
