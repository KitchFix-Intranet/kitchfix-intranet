// scripts/_probe_kpi_v40.mjs
//
// V40 acceptance - two salary math bugs, toggle clarity, cold-load
// shell. The labor /api route is auth-gated (TEST_MODE only bypasses
// middleware, not the SessionProvider), so this probe verifies each
// fix in two auth-less ways: code-read (the file wires the fix) and
// data-read (Supabase confirms the numbers the route will ship).
//
//   V40-1 table Rate column reads blended_rate_hourly on the salary
//         path (WeekTable.js + salary prop threaded from page.js)
//   V40-2 week_budgets on the salary path recomputes from merged
//         budget_periods (same source as the week strip); table +
//         strip cannot disagree
//   V40-3 folio renders STATIC_DIRECTORY in the grouped 3-card shape
//         on the cold paint; desc slot reserved via CSS
//   V40-4 toggle carries kpi-seg-salary-on when on; kpi.css paints the
//         active segment amber-600; title pill renders when on
//   V40-5 salaried worker rows resolve names via resolveWorkerMeta
//         after withSalary (BUG 5); shared helper is called from all
//         three merge sites (aggregate, D26, single-account)
//   sentinel CIN - OH 2026-06-29: reg 113.98 / ot 2.32 / amt 4,328.27
//
// Usage: node --env-file=.env.local scripts/_probe_kpi_v40.mjs

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..", "..");

let hardFail = 0;
function log(line, ok = true) {
  if (!ok) hardFail++;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${line}`);
}
function stripComments(src) {
  return src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const routeSrc  = fs.readFileSync(path.join(REPO_ROOT, "src/app/api/kpi/labor/route.js"), "utf8");
const salBoard  = fs.readFileSync(path.join(REPO_ROOT, "src/lib/labor/salaryBoard.js"), "utf8");
const weekSrc   = fs.readFileSync(path.join(REPO_ROOT, "src/app/kpi/labor/components/WeekTable.js"), "utf8");
const pageSrc   = fs.readFileSync(path.join(REPO_ROOT, "src/app/kpi/labor/page.js"), "utf8");
const shellSrc  = fs.readFileSync(path.join(REPO_ROOT, "src/app/kpi/labor/components/Shell.js"), "utf8");
const folioSrc  = fs.readFileSync(path.join(REPO_ROOT, "src/app/kpi/labor/components/FolioRail.js"), "utf8");
const acctsSrc  = fs.readFileSync(path.join(REPO_ROOT, "src/app/kpi/labor/lib/accounts.js"), "utf8");
const cssSrc    = fs.readFileSync(path.join(REPO_ROOT, "src/app/kpi/kpi.css"), "utf8");
const resolvSrc = fs.readFileSync(path.join(REPO_ROOT, "src/lib/kpi/resolveWorkerMeta.js"), "utf8");

async function main() {
  console.log("=".repeat(72));
  console.log("V40 acceptance probe");
  console.log("=".repeat(72));

  console.log("\n[V40-1 - table Rate column reads blended_rate_hourly on salary path]");
  const week = stripComments(weekSrc);
  log("WeekTable accepts salary prop",              /export function WeekTable\([\s\S]*?salary[,\s]/.test(weekSrc));
  log("WeekTable derives rateBasisHourlyOnly",      /rateBasisHourlyOnly\s*=\s*salary\?\.rate_basis\s*===\s*"hourly_only"/.test(weekSrc));
  log("WeekTable defines displayRate helper",       /const\s+displayRate\s*=/.test(weekSrc));
  // WeekTable owns two rate sites (period totals :~664, grand total :~717)
  // that call displayRate(blendedRate(...)). The third site lives inside
  // FragmentRows (:~806), which cannot see WeekTable's local scope; the
  // V40 hotfix inlines rateBasisHourlyOnly?hourlyRate:blendedRate(...) via
  // props. Total rate-swap coverage stays 3.
  const displayCalls  = [...week.matchAll(/displayRate\s*\(\s*blendedRate\s*\(/g)];
  const inlineCalls   = [...week.matchAll(/rateBasisHourlyOnly\s*\?\s*hourlyRate\s*:\s*blendedRate\s*\(/g)];
  const rateSwapSites = displayCalls.length + inlineCalls.length;
  log(`displayRate wraps blendedRate at two WeekTable sites (found ${displayCalls.length}, want 2)`, displayCalls.length === 2);
  log(`FragmentRows inlines the same rule at 1 site (found ${inlineCalls.length}, want 1)`,          inlineCalls.length === 1);
  log(`total rate-swap coverage across the file = ${rateSwapSites} (want 3)`,                        rateSwapSites === 3);
  log("Rate column <th> uses rateHeaderLabel",      /<th>\{rateHeaderLabel\}<\/th>/.test(weekSrc));
  log("HelpPop consumes rateBasisHourlyOnly",       /function HelpPop\(\{[^}]*rateBasisHourlyOnly/.test(weekSrc));
  log("page.js threads salary prop to WeekTable",   /salary=\{data\?\.salary_included\s*\?\s*\{\s*rate_basis:\s*data\.rate_basis/.test(pageSrc));

  console.log("\n[V40-2 - week_budgets recomputed from merged budget_periods (BUG 2)]");
  const sal = stripComments(salBoard);
  log("withSalary signature accepts buildWeekBudgets",  /export function withSalary\(body,\s*\{[\s\S]*?buildWeekBudgets/.test(sal));
  log("withSalary rebuilds week_budgets from merged.periods",
      /week_budgets\s*=\s*\(typeof buildWeekBudgets === "function"\)\s*\?\s*buildWeekBudgets\(\s*\{[\s\S]*?budget_periods:\s*merged\.periods/.test(sal));
  const buildWeekBudgetsCalls = [...routeSrc.matchAll(/buildWeekBudgets,/g)];
  // Import line + three withSalaryMerge sites (agg, D26, single-account).
  log(`route.js passes buildWeekBudgets at 3 withSalaryMerge sites (found ${buildWeekBudgetsCalls.length - 1}, want 3)`, buildWeekBudgetsCalls.length - 1 === 3);

  console.log("\n[V40-3 - cold-load folio + skeleton]");
  log("lib/accounts.js exports STATIC_DIRECTORY",       /export const STATIC_DIRECTORY\s*=/.test(acctsSrc));
  log("lib/accounts.js exports STATIC_RDO_DISPLAY",     /export const STATIC_RDO_DISPLAY\s*=\s*\{\s*East:/.test(acctsSrc));
  const dirCount = (acctsSrc.match(/team_key:\s*"[^"]+"/g) || []).length;
  log(`STATIC_DIRECTORY has 11 rows (found ${dirCount})`, dirCount === 11);
  log("FolioRail imports STATIC_DIRECTORY + STATIC_RDO_DISPLAY", /STATIC_DIRECTORY,\s*STATIC_RDO_DISPLAY/.test(folioSrc));
  log("FolioRail falls back to STATIC_DIRECTORY on cold paint",
      /const\s+directory\s*=\s*hasLive\s*\?\s*accountsDirectory\s*:\s*STATIC_DIRECTORY/.test(folioSrc));
  log("MemberRow always renders desc slot",             /<span className="kpi-acct-desc">/.test(folioSrc));
  log("kpi.css reserves desc-line min-height",          /\.kpi-acct-desc[\s\S]*?min-height:\s*1\.25em/.test(cssSrc));
  log("BoardSkeleton renders companion top card",       /kpi-skel-companion/.test(pageSrc));
  log("BoardSkeleton renders numbers header",           /kpi-skel-nums/.test(pageSrc));
  log("kpi.css defines .kpi-skel-companion + .kpi-skel-nums",
      /\.kpi-skel-companion\s*\{[^}]*height/.test(cssSrc) && /\.kpi-skel-nums\s*\{[^}]*height/.test(cssSrc));

  console.log("\n[V40-4 / V41 - toggle + symmetric scope pill]");
  log("Shell.js adds kpi-seg-salary-on when on",        /kpi-seg-salary-on/.test(shellSrc));
  log("kpi.css paints .kpi-seg-salary-on button.on amber",
      /\.kpi-seg\.kpi-seg-salary-on\s+button\.on\s*\{[^}]*var\(--amber-600\)/.test(cssSrc));
  log("kpi.css tightens inactive seg text to n-700",    /\.kpi-seg button\s*\{\s*color:\s*var\(--n-700\)/.test(cssSrc));

  console.log("\n[V41 - .kpi-cmd-scope pill renders in both salary states]");
  // Rename gate: the old .kpi-cmd-title-salary class is gone from src.
  const oldClassInSrc = /kpi-cmd-title-salary/.test(shellSrc) || /kpi-cmd-title-salary/.test(cssSrc) || /kpi-cmd-title-salary/.test(pageSrc);
  log("no source file references the retired .kpi-cmd-title-salary class", !oldClassInSrc);
  // Pill renders whenever salaryToggle EXISTS, not only when .on.
  log("Shell.js renders scope pill on salaryToggle presence (both states)",
      /\{salaryToggle\s*&&\s*\(\s*\/\/[\s\S]*?<span[\s\S]*?kpi-cmd-scope/.test(shellSrc));
  log("Shell.js emits HOURLY ONLY when off + Hourly labor only aria",
      /"HOURLY ONLY"/.test(shellSrc) && /"Hourly labor only"/.test(shellSrc));
  log("Shell.js emits + SALARY when on + Salary included aria",
      /"\+ SALARY"/.test(shellSrc) && /"Salary included"/.test(shellSrc));
  log("Shell.js switches modifier class on salaryToggle.on",
      /kpi-cmd-scope--salary[\s\S]*?kpi-cmd-scope--hourly|kpi-cmd-scope--hourly[\s\S]*?kpi-cmd-scope--salary|salaryToggle\.on\s*\?\s*"kpi-cmd-scope--salary"\s*:\s*"kpi-cmd-scope--hourly"/.test(shellSrc));
  log("kpi.css defines .kpi-cmd-scope base geometry",
      /\.kpi-cmd-scope\s*\{[^}]*border-radius:\s*999px[\s\S]*?align-self:\s*center/.test(cssSrc));
  log("kpi.css --hourly modifier is transparent + muted text + faint border",
      /\.kpi-cmd-scope--hourly\s*\{[^}]*background:\s*transparent[\s\S]*?color:\s*#C8D4E2[\s\S]*?border:\s*1px solid rgba\(255,\s*255,\s*255,\s*0\.30\)/.test(cssSrc));
  log("kpi.css --salary modifier keeps amber fill",
      /\.kpi-cmd-scope--salary\s*\{[^}]*background:\s*var\(--amber-600\)[\s\S]*?color:\s*var\(--n-0\)/.test(cssSrc));
  // V30 gate - the .kpi-cmd-scope* rules only introduce px in border
  // (1px) and reuse pre-existing sizes (2px padding, 999px radius);
  // no new dimensional px slipped in.
  const scopeBlock = (cssSrc.match(/\.kpi-cmd-scope[\s\S]*?\.kpi-cmd-scope--salary\s*\{[\s\S]*?\}/) || [""])[0];
  const pxLiterals = [...scopeBlock.matchAll(/\d+px/g)].map(m => m[0]).sort();
  const allowed = new Set(["1px", "2px", "999px"]);
  const stray = pxLiterals.filter(p => !allowed.has(p));
  log(`no unexpected raw px literals in .kpi-cmd-scope rules (found: ${[...new Set(pxLiterals)].join(", ")}; stray: ${stray.join(", ") || "none"})`,
      stray.length === 0);

  console.log("\n[V41 C2 - print scope line carries salary segment]");
  // Wire check: page.js reads from data?.salary_available + salary=1 URL flag.
  log("page.js wires salaryIncluded from data.salary_available + salary URL flag",
      /salaryIncluded:\s*data\?\.salary_available\s*===\s*true[\s\S]*?searchParams\.get\("salary"\)\s*===\s*"1"[\s\S]*?:\s*null/.test(pageSrc));
  // Unit-run the helper.
  const { buildPrintScopeLine } = await import(path.join(REPO_ROOT, "src/app/kpi/labor/lib/formatting.js"));
  const roster = Array.from({ length: 36 }, (_, i) => ({ id: `w${i}`, label: `#${i}` }));
  const fx = { start: "2026-07-13", end: "2026-08-09", workerRoster: roster, selectedWorkers: null, redact: false };
  const lineHourly = buildPrintScopeLine({ ...fx, salaryIncluded: false });
  const lineSalary = buildPrintScopeLine({ ...fx, salaryIncluded: true });
  const lineNone   = buildPrintScopeLine({ ...fx, salaryIncluded: null });
  const lineOmit   = buildPrintScopeLine(fx);
  log(`salaryIncluded=false line ends with " · hourly only" (got: "${lineHourly}")`,   /·\s*hourly only$/.test(lineHourly));
  log(`salaryIncluded=true  line ends with " · hourly + salary" (got: "${lineSalary}")`, /·\s*hourly \+ salary$/.test(lineSalary));
  log("salaryIncluded=null line contains neither hourly/salary segment",
      !/hourly only|hourly \+ salary/.test(lineNone));
  log("omitting salaryIncluded is byte-identical to null (pre-V41 shape)",
      lineNone === lineOmit && !/hourly only|hourly \+ salary/.test(lineOmit));

  console.log("\n[V40 hotfix - WeekTable-local function helpers must not leak into siblings]");
  // Regression check for PR #720 crash: FragmentRows called displayRate
  // (defined inside WeekTable) and ReferenceError'd on band expand.
  // Narrowly scan for FUNCTION helpers (arrow fns + fn decls) declared
  // inside WeekTable, and verify none are referenced from FragmentRows
  // / ChildRow. Data locals (bandLabel, hourlyRate, etc.) are excluded
  // because they get intentionally threaded as props and would cause
  // false positives here.
  const weekLines = weekSrc.split(/\r?\n/);
  const bodyLines = weekLines.slice(302, 729).join("\n");
  const fnLocals = new Set();
  for (const m of bodyLines.matchAll(/\b(?:const|let)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(?[A-Za-z_,\s{}]*\)?\s*=>/g)) {
    fnLocals.add(m[1]);
  }
  for (const m of bodyLines.matchAll(/\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    fnLocals.add(m[1]);
  }
  const siblings = stripComments(weekLines.slice(732).join("\n"));
  const leaks = [];
  for (const name of fnLocals) {
    const re = new RegExp(`(?<![\\.A-Za-z0-9_])${name}\\s*\\(`);
    if (re.test(siblings)) leaks.push(name);
  }
  log(`no WeekTable-local helpers called from FragmentRows / ChildRow (leaks: ${leaks.length === 0 ? "none" : leaks.join(", ")})`, leaks.length === 0);

  console.log("\n[V40-5 - BUG 5: salaried worker rows resolve names via shared helper]");
  log("resolveWorkerMeta exists",                       /export async function resolveWorkerMeta\(supa,\s*workerIds\)/.test(resolvSrc));
  log("resolveWorkerMeta calls resolveWorkerName",      /resolveWorkerName\(p,\s*userPayload\)/.test(resolvSrc));
  log("route.js imports resolveWorkerMeta",             /import\s*\{\s*resolveWorkerMeta\s*\}\s*from\s*"@\/lib\/kpi\/resolveWorkerMeta"/.test(routeSrc));
  log("route.js no longer inlines the resolver block",  !/rippling_raw_workers_latest[\s\S]*?rippling_raw_users_latest[\s\S]*?resolveWorkerName/.test(stripComments(routeSrc)));
  const postSalaryCalls = [...routeSrc.matchAll(/resolveWorkerMeta\(supa,\s*salaryOnly\)/g)];
  log(`resolveWorkerMeta called at 3 post-merge sites (found ${postSalaryCalls.length}, want 3)`, postSalaryCalls.length === 3);

  console.log("\n[V40 data-read: CIN - AZ salary rows have resolvable users]");
  const cinAzRows = await supa
    .from("labor_salary_actuals")
    .select("worker_id");
  if (cinAzRows.error) {
    console.log("  labor_salary_actuals error:", cinAzRows.error.message);
    hardFail++;
  } else {
    const azIds = [...new Set((cinAzRows.data || []).map(r => r.worker_id))];
    const { data: workers, error: wErr } = await supa
      .from("rippling_raw_workers_latest")
      .select("payload")
      .in("rippling_id", azIds);
    if (wErr) { console.log("  workers error:", wErr.message); hardFail++; }
    const userIds = [...new Set((workers || []).map(r => r.payload?.user_id).filter(Boolean))];
    log(`salary worker_ids (${azIds.length}) all carry a user_id (${userIds.length})`, azIds.length > 0 && userIds.length === azIds.length);
    const { data: users, error: uErr } = await supa
      .from("rippling_raw_users_latest")
      .select("rippling_id")
      .in("rippling_id", userIds);
    if (uErr) { console.log("  users error:", uErr.message); hardFail++; }
    log(`every salary user_id resolves in rippling_raw_users_latest (${(users || []).length} of ${userIds.length})`,
        (users || []).length === userIds.length && userIds.length > 0);
  }

  console.log("\n[sentinel - CIN - OH 06/29 - carried forward (account-week sum)]");
  const { data: sentRows, error: sErr } = await supa
    .from("labor_actuals_latest")
    .select("hours_regular, hours_overtime, amount")
    .eq("account_key", "CIN - OH")
    .eq("week_start", "2026-06-29");
  if (sErr) {
    console.log("  sentinel error:", sErr.message); hardFail++;
  } else if (!sentRows || sentRows.length === 0) {
    log("CIN - OH 2026-06-29 rows present", false);
  } else {
    const reg = sentRows.reduce((s, r) => s + Number(r.hours_regular  || 0), 0);
    const ot  = sentRows.reduce((s, r) => s + Number(r.hours_overtime || 0), 0);
    const amt = sentRows.reduce((s, r) => s + Number(r.amount         || 0), 0);
    log(`hours_regular  = ${reg.toFixed(2)}   (want 113.98)`, Math.abs(reg - 113.98) < 0.01);
    log(`hours_overtime = ${ot.toFixed(2)}    (want 2.32)`,   Math.abs(ot  - 2.32)   < 0.01);
    log(`amount         = ${amt.toFixed(2)}   (want 4328.27)`, Math.abs(amt - 4328.27) < 0.01);
  }

  console.log("\n" + "=".repeat(72));
  console.log(hardFail === 0 ? "V40 ACCEPTANCE: ALL PROBES PASS" : `V40 ACCEPTANCE: ${hardFail} FAILURE(S)`);
  console.log("=".repeat(72));
  process.exit(hardFail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });
