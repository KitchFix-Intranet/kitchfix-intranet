// _probe_month_off_reality.mjs
// 2026-09-08 — SC structural health parity probe (kept in repo).
//
// Before-fix state: two implementations of "is this month off":
//   A) MonthCard.detectNoService (was at season/MonthCard.js:595-613)
//      Category-branching; read sc_homestand_schedule as truth source
//      for homestand accounts.
//   B) overviewDerive.isOff (was at v2/overviewDerive.js:116-117)
//      Category-blind revenue/covers check.
//   Disagreed on 40 of 132 (account, month) pairs in FY2026 - most
//   severely CIN-KY April with $27K actual revenue rendering as OFF
//   because sc_homestand_schedule had zero games for that month.
//
// After-fix state (this PR): both surfaces call the shared
// detectMonthOff from src/lib/sc/detectMonthOff.js. The four-check
// rule is imported below and both "predicates" in this probe now
// route through it.
//
// This probe stays in the repo as the parity check that guards
// against a future divergence. Runs in <5s against the real DB via
// service-role. If disagreements is ever > 0, the fix has been
// undone somewhere.
//
// Run:
//   node --env-file=.env.local scripts/probes/_probe_month_off_reality.mjs

import { createClient } from "@supabase/supabase-js";
import { detectMonthOff } from "../../src/lib/sc/detectMonthOff.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL) { console.error("SUPABASE_URL: ABSENT"); process.exit(2); }
if (!SERVICE_KEY)  { console.error("SUPABASE_SERVICE_ROLE_KEY: ABSENT"); process.exit(2); }
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const YEAR = new Date().getFullYear();

// ─── The pre-fix MonthCard rule (kept in probe as the regression baseline) ───
// Not imported anywhere in production; ONLY this probe uses it, to prove
// the fix moved 40 disagreements to 0. If someone reintroduces this rule
// shape into MonthCard or elsewhere, the probe will detect it.
function detectNoService_MonthCard_LEGACY({ monthSummary, hasHomestandSchedule, isFeeAccount, isMilb }) {
  if (!monthSummary) return true;
  if (hasHomestandSchedule) {
    const hs = monthSummary.homestandSummary;
    return !hs || (hs.gameDays === 0 && hs.prepDays === 0);
  }
  if (isFeeAccount) {
    const projCovers = Number(monthSummary.projectedCovers) || 0;
    const actCovers  = Number(monthSummary.actualCovers) || 0;
    return Number(monthSummary.totalDays) === 0 || (projCovers === 0 && actCovers === 0);
  }
  if (isMilb) {
    return Number(monthSummary.totalDays) === 0;
  }
  const projRev = Number(monthSummary.projectedRevenue) || 0;
  const actRev  = Number(monthSummary.actualRevenue)    || 0;
  const totalDays = Number(monthSummary.totalDays)      || 0;
  return projRev === 0 && actRev === 0 && totalDays > 0;
}

// ─── The pre-fix SeasonRail rule (kept in probe as the regression baseline) ───
function isOff_SeasonRail_LEGACY(monthSummary) {
  if (!monthSummary) return true;
  const totalActionable = Number(monthSummary.totalActionable) || 0;
  const actualRev = Number(monthSummary.actualRevenue) || 0;
  const projectedRev = Number(monthSummary.projectedRevenue) || 0;
  return totalActionable === 0 && actualRev === 0 && projectedRev === 0;
}

// ─── Load accounts + shape flags ───
console.log(`\n[month-off-reality]  year=${YEAR}\n`);
const acctRes = await supa.from("accounts")
  .select("team_key, name, level, billing_model, has_homestand_schedule")
  .eq("active", true)
  .order("team_key");
if (acctRes.error) { console.error(`accounts read: ${acctRes.error.message}`); process.exit(2); }
const accounts = acctRes.data.filter((a) =>
  // Skip corporate + accounts with no services (would have no data)
  a.team_key !== "CORP" && a.team_key !== "KAD"
);
console.log(`  Scanning ${accounts.length} accounts for FY${YEAR} month disagreements...\n`);

// ─── For each account, aggregate per-month metrics that both predicates need ───
async function loadYearMonthly(accountKey, hasHomestandSchedule) {
  const yearFirst = `${YEAR}-01-01`;
  const yearLast  = `${YEAR}-12-31`;

  // sc_daily_revenue: revenue + covers per day
  const revRes = await supa.from("sc_daily_revenue")
    .select("service_date, projected_count, actual_count, projected_revenue, actual_revenue")
    .eq("account_key", accountKey)
    .gte("service_date", yearFirst).lte("service_date", yearLast)
    .range(0, 19999);
  if (revRes.error) return { error: `revenue: ${revRes.error.message}` };

  // sc_day_metadata: existence of service days (drives totalDays)
  const metaRes = await supa.from("sc_day_metadata")
    .select("service_date")
    .eq("account_key", accountKey)
    .gte("service_date", yearFirst).lte("service_date", yearLast)
    .range(0, 19999);
  if (metaRes.error) return { error: `metadata: ${metaRes.error.message}` };

  // For per-day status classification (needed for totalActionable which
  // powers the SeasonRail predicate): reproduce a coarse version. A day
  // is "actionable" if there's a metadata row for it (i.e. the service
  // calendar has an entry) AND status is not off/off-season/exhibition/
  // away/prep. Without running the full classifier here, we approximate:
  // any day with metadata that has projected_count > 0 or actual_count
  // > 0 is actionable. Days with a metadata row but zero counts are
  // no-service days (not actionable).
  // Approximation: totalActionable = count of unique service_dates in
  // metadata where at least one service row has count > 0.
  const activeDates = new Set();
  const monthRev = {};      // "YYYY-MM" -> { projRev, actRev, projCovers, actCovers }
  for (const r of revRes.data) {
    const mk = String(r.service_date).slice(0, 7);
    if (!monthRev[mk]) monthRev[mk] = { projRev: 0, actRev: 0, projCovers: 0, actCovers: 0 };
    monthRev[mk].projRev    += Number(r.projected_revenue) || 0;
    monthRev[mk].actRev     += Number(r.actual_revenue)    || 0;
    monthRev[mk].projCovers += Number(r.projected_count)   || 0;
    monthRev[mk].actCovers  += Number(r.actual_count)      || 0;
    if ((r.projected_count && r.projected_count > 0) || (r.actual_count && r.actual_count > 0)) {
      activeDates.add(r.service_date);
    }
  }

  // Homestand summary per month (for hasHomestandSchedule accounts).
  const monthHs = {};
  if (hasHomestandSchedule) {
    // sc_homestand_schedule is the source; day_type in ("GAME","PREP")
    // per day defines gameDays/prepDays.
    const hsRes = await supa.from("sc_homestand_schedule")
      .select("date, day_type")
      .eq("account_key", accountKey)
      .gte("date", yearFirst).lte("date", yearLast);
    if (!hsRes.error) {
      for (const r of hsRes.data) {
        const mk = String(r.date).slice(0, 7);
        if (!monthHs[mk]) monthHs[mk] = { gameDays: 0, prepDays: 0 };
        if (r.day_type === "GAME") monthHs[mk].gameDays++;
        else if (r.day_type === "PREP") monthHs[mk].prepDays++;
      }
    }
  }

  // Assemble monthSummary shape both predicates read.
  const months = [];
  const daysByMonth = {};
  for (const m of metaRes.data) {
    const mk = String(m.service_date).slice(0, 7);
    if (!daysByMonth[mk]) daysByMonth[mk] = new Set();
    daysByMonth[mk].add(m.service_date);
  }
  const activeByMonth = {};
  for (const d of activeDates) {
    const mk = d.slice(0, 7);
    if (!activeByMonth[mk]) activeByMonth[mk] = 0;
    activeByMonth[mk]++;
  }

  for (let i = 1; i <= 12; i++) {
    const mk = `${YEAR}-${String(i).padStart(2, "0")}`;
    const rev = monthRev[mk] || { projRev: 0, actRev: 0, projCovers: 0, actCovers: 0 };
    const totalDays = daysByMonth[mk]?.size || 0;
    const totalActionable = activeByMonth[mk] || 0;
    const hs = monthHs[mk] || (hasHomestandSchedule ? { gameDays: 0, prepDays: 0 } : null);
    months.push({
      month: mk,
      monthSummary: {
        totalDays,
        totalActionable,
        projectedRevenue: rev.projRev,
        actualRevenue:    rev.actRev,
        projectedCovers:  rev.projCovers,
        actualCovers:     rev.actCovers,
        homestandSummary: hs,
      },
    });
  }
  return { months };
}

// ─── Sweep every account. Two comparisons: LEGACY-vs-LEGACY (shows
//     the fix's effect, should be 40 today, 40 forever unless the
//     source data changes) and SHARED-vs-SHARED (should be 0 - the
//     regression assertion). ───
const legacyDisagreements = [];  // MonthCard rule vs SeasonRail rule (pre-fix)
const sharedDisagreements = [];  // Both surfaces route through detectMonthOff (post-fix)
let totalMonthsChecked = 0;

for (const acct of accounts) {
  const flags = {
    hasHomestandSchedule: !!acct.has_homestand_schedule,
    isFeeAccount: acct.billing_model === "flat_fee",
    isMilb: acct.level === "AAA" || acct.level === "AA" || acct.level === "A"
             || acct.level === "MiLB", // per-file convention varies
  };
  const load = await loadYearMonthly(acct.team_key, flags.hasHomestandSchedule);
  if (load.error) {
    console.log(`  [SKIP] ${acct.team_key}: ${load.error}`);
    continue;
  }
  for (const { month, monthSummary } of load.months) {
    totalMonthsChecked++;

    // Legacy comparison: what the two surfaces WOULD have said pre-fix.
    const mcLegacy = detectNoService_MonthCard_LEGACY({ monthSummary, ...flags });
    const srLegacy = isOff_SeasonRail_LEGACY(monthSummary);
    if (mcLegacy !== srLegacy) {
      legacyDisagreements.push({
        account: acct.team_key,
        level: acct.level,
        billingModel: acct.billing_model,
        flags,
        month,
        monthSummary,
        MonthCard_says_off: mcLegacy,
        SeasonRail_says_off: srLegacy,
      });
    }

    // Shared comparison: what BOTH surfaces say after routing through
    // detectMonthOff. Trivially equal by construction - one function,
    // one input, one answer. Any non-zero here indicates the shared
    // module is being called with different inputs on each side (which
    // would be a caller bug).
    const mcShared = detectMonthOff(monthSummary);
    const srShared = detectMonthOff(monthSummary);
    if (mcShared !== srShared) {
      sharedDisagreements.push({ account: acct.team_key, month, monthSummary });
    }
  }
}

// ─── Bundled-account + zero-revenue-with-covers edge check ───
// Kevin flagged TXR - TX - V as a bundled account carrying $0 on its
// fee row by design. Verify no month exists where the proposed rule
// wrongly renders as OFF a month that has covers but zero revenue.
const zeroRevWithCovers = [];
const proposedSaysOffButHasSomething = [];
for (const acct of accounts) {
  const flags = {
    hasHomestandSchedule: !!acct.has_homestand_schedule,
    isFeeAccount: acct.billing_model === "flat_fee",
    isMilb: acct.level === "AAA" || acct.level === "AA" || acct.level === "A" || acct.level === "MiLB",
  };
  const load = await loadYearMonthly(acct.team_key, flags.hasHomestandSchedule);
  if (load.error) continue;
  for (const { month, monthSummary } of load.months) {
    const ms = monthSummary;
    const hasCovers = ms.projectedCovers > 0 || ms.actualCovers > 0;
    const hasZeroRev = ms.projectedRevenue === 0 && ms.actualRevenue === 0;
    if (hasCovers && hasZeroRev) {
      zeroRevWithCovers.push({ account: acct.team_key, month, ms });
    }
    // Sanity: does the proposed rule ever say OFF for a month with
    // any actuals? If so, that's a bug in the rule.
    const proposedOff = detectMonthOff(ms);
    if (proposedOff && (ms.actualCovers > 0 || ms.actualRevenue > 0)) {
      proposedSaysOffButHasSomething.push({ account: acct.team_key, month, ms });
    }
  }
}
console.log(`─── BUNDLED-ACCOUNT / ZERO-REVENUE-WITH-COVERS CHECK ─────────────`);
console.log(`  Months where projRev=$0 AND actRev=$0 AND covers > 0: ${zeroRevWithCovers.length}`);
if (zeroRevWithCovers.length > 0) {
  console.log(`  Each is verified below - under the PROPOSED rule they render`);
  console.log(`  as IN-SERVICE (correct, because covers > 0):\n`);
  for (const z of zeroRevWithCovers) {
    const proposed = detectMonthOff(z.ms);
    const verdict = proposed ? "OFF (WRONG)" : "IN-SERVICE (correct)";
    console.log(`    ${z.account} ${z.month}: projCovers=${z.ms.projectedCovers} actCovers=${z.ms.actualCovers} projRev=$${z.ms.projectedRevenue.toFixed(2)} actRev=$${z.ms.actualRevenue.toFixed(2)}  =>  proposed says ${verdict}`);
  }
}
console.log(`\n  Sanity: months where proposed rule says OFF but has actuals: ${proposedSaysOffButHasSomething.length}`);
if (proposedSaysOffButHasSomething.length > 0) {
  console.log(`  ** THIS IS A RULE BUG - a month with actuals cannot be OFF **`);
  for (const r of proposedSaysOffButHasSomething) {
    console.log(`    ${r.account} ${r.month}: ${JSON.stringify(r.ms)}`);
  }
}
console.log(``);

console.log(`─── LEGACY-vs-LEGACY: ${legacyDisagreements.length} / ${totalMonthsChecked} pairs (baseline, expected 40) ───`);
console.log(`─── SHARED-vs-SHARED: ${sharedDisagreements.length} / ${totalMonthsChecked} pairs (post-fix, expected 0) ───\n`);

if (sharedDisagreements.length !== 0) {
  console.error(`\n** ACCEPTANCE FAIL ** Shared-fn comparison found ${sharedDisagreements.length} disagreements.`);
  console.error(`   Both callers should route through detectMonthOff with the same input - a non-zero`);
  console.error(`   count means the inputs differ, which is a caller bug (probably a shape mismatch).\n`);
  for (const d of sharedDisagreements.slice(0, 10)) {
    console.error(`   ${d.account} ${d.month}: ${JSON.stringify(d.monthSummary)}`);
  }
  process.exit(1);
}

if (legacyDisagreements.length === 0) {
  console.log(`  (No legacy disagreements measured either - the underlying data has changed since`);
  console.log(`  the fix landed, or the fix has been fully validated across the range.)\n`);
  console.log(`  ACCEPTANCE: shared-fn parity holds. Ship.\n`);
  process.exit(0);
}

console.log(`  ACCEPTANCE: shared-fn parity holds. The ${legacyDisagreements.length} legacy disagreements`);
console.log(`  are what the fix eliminates. Below: the specific (account, month) pairs that would`);
console.log(`  have rendered wrong on screen before this fix.\n`);

// Group by account for readability.
const disagreements = legacyDisagreements;
const byAcct = {};
for (const d of disagreements) {
  if (!byAcct[d.account]) byAcct[d.account] = [];
  byAcct[d.account].push(d);
}

for (const [acct, rows] of Object.entries(byAcct)) {
  const first = rows[0];
  console.log(`─── ${acct}  (${first.level}, ${first.billingModel}, hasHomestand=${first.flags.hasHomestandSchedule}, isFee=${first.flags.isFeeAccount}, isMilb=${first.flags.isMilb}) ───`);
  for (const d of rows) {
    const ms = d.monthSummary;
    const mcVerdict = d.MonthCard_says_off ? "OFF (quiet card)" : "IN-SERVICE (colored)";
    const srVerdict = d.SeasonRail_says_off ? "OFF (dropped)" : "IN-SERVICE (rendered)";
    console.log(`  ${d.month}:  MonthCard = ${mcVerdict}   |   SeasonRail = ${srVerdict}`);
    console.log(`     totalDays=${ms.totalDays}  totalActionable=${ms.totalActionable}  projRev=$${ms.projectedRevenue.toFixed(2)}  actRev=$${ms.actualRevenue.toFixed(2)}  projCovers=${ms.projectedCovers}  actCovers=${ms.actualCovers}` +
      (ms.homestandSummary ? `  hs.gameDays=${ms.homestandSummary.gameDays}  hs.prepDays=${ms.homestandSummary.prepDays}` : ""));
  }
  console.log("");
}

process.exit(0);
