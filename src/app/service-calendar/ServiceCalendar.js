"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DayDetail from "./DayDetail";
import { X } from "./Icons";
import { useDialogA11y } from "./useDialogA11y";
import SeasonShell from "./season/SeasonShell";
import PeriodWorkspace from "./season/PeriodWorkspace";
import StateLegend from "./season/StateLegend";
import ChromeBar, { AsOf } from "./season/ChromeBar";
import ExportControl from "./season/ExportControl";
import PeriodHeaderNav, { PeriodTodayChip, OverviewTodayChip } from "./season/PeriodHeaderNav";
import MonthHeaderNav from "./season/MonthHeaderNav";
import StickyContext from "./season/StickyContext";
import { fmt$, fmtDateShort } from "./season/format";
import { isActionableDay } from "./season/dayPredicates";
import { derivePhaseTimeline, collectSpringDates } from "./season/phaseDerivation";
import { isScAdmin } from "@/lib/admin";
import AdminPanel from "./admin/AdminPanel";
import { tierFromRoles, computeInitialView } from "./computeInitialView";
import { useScV2, useScEntryV2Effective } from "./v2/flags";
import Ribbon from "./v2/Ribbon";
import SeasonRail from "./v2/SeasonRail";
import DrillRail from "./v2/DrillRail";
import OpsRail from "./v2/OpsRail";
import MobileBooksBar from "./v2/MobileBooksBar";
// Phase 2A bulk convergence (2026-07-24): shared review + pos-style
// custom entry. Both bulk paths converge on BulkReview; BulkEntry
// replaces the legacy .sc-day bulk shell.
import BulkEntry from "./v2/bulk/BulkEntry";
import BulkReview from "./v2/bulk/BulkReview";
import "./v2/bulk/bulk.css";
// HF-7 (2026-07-20) - overview ribbon Today-jump routes through
// scrollIntoViewRM so the RM branch is respected.
import { scrollIntoViewRM } from "./v2/motion";
// W8 - the bar figures are read from the SAME derives the rails
// consume internally. Not a new derivation path: SeasonRail also calls
// deriveHeroTotals(yearData) + deriveQueue(...) at its top; the bar
// call at the mount site passes the same yearData in, guaranteeing
// identical outputs by construction. See MobileBooksBar.js law 2.
import { deriveHeroTotals, deriveQueue, fmtOverviewMoney } from "./v2/overviewDerive";
import { deriveOpsHeroTotals } from "./v2/opsRailDerive";
// fmt$ already imported at line 15 for the bulk-review rows; reused
// at the W8 mobile-bar sites.
import DayEntryV2 from "./v2/entry/DayEntryV2";
import "./v2/shell.css";
import "./v2/overview.css";
import "./v2/drill.css";
import {
  queueKey as scQueueKey,
  getAll as scGetAll,
  getEntry as scGetEntry,
  enqueue as scEnqueue,
  dequeue as scDequeue,
  bumpAttempts as scBumpAttempts,
  acquireLock as scAcquireLock,
  releaseLock as scReleaseLock,
  nextDelayMs as scNextDelayMs,
  isNetworkError as scIsNetworkError,
} from "./saveQueue";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// "2026-06-29" + "2026-07-26" -> ["2026-06", "2026-07"]. Returns the
// 1 or 2 calendar months a fiscal period spans, used to drive the
// period-data fetch in lens=period.
function monthsBetween(startStr, endStr) {
  if (!startStr || !endStr) return [];
  const out = [];
  const [sy, sm] = startStr.split("-").map(Number);
  const [ey, em] = endStr.split("-").map(Number);
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2,"0")}`);
    m++; if (m > 12) { m = 1; y++; }
    if (out.length > 3) break; // defensive: a fiscal period never spans >2 months
  }
  return out;
}

const CAT_ORDER = { PDC: 1, MLB: 2, MiLB: 3 };
const CAT_LABELS = { PDC: "Player Development", MLB: "Major League", MiLB: "Minor League" };

// 2026-07-11 (nav rehydration, redo after the #399/#400 revert cycle):
// URL builder for every state->URL push. Params emitted in insertion
// order; falsy values omitted so the URL stays clean.
//
// Unlike the earlier #399 attempt, this helper is ONLY used on the
// WRITE side. Reads split into two effects (see below):
//   - Mount-time init: reads `?account=` ONCE at first paint. Deps [].
//   - URL-sync effect: reads view/period/month only. Deps
//     [searchParams, isAdmin] - the pre-#399 shape. Does NOT read
//     or write selectedAccount, so it cannot re-fire on its own
//     writes.
// The AccountDropdown moves state DIRECTLY via setSelectedAccount
// and pushes the URL in parallel (see wiring near line ~1740). The
// URL-sync re-fire that follows the push sees no scope/lens/etc
// change and no-ops. This is the unidirectional flow that #399
// tried and failed to achieve.
function buildScUrl({ account, period, month, view, day } = {}) {
  const params = new URLSearchParams();
  if (view)    params.set("view", view);
  if (account) params.set("account", account);
  if (period)  params.set("period", period);
  if (month)   params.set("month", month);
  // W5: ?day=YYYY-MM-DD is a drill-only tile-targeting param. Scrolls
  // + focuses the tile; NEVER opens DayDetail. Ignored in year view
  // (no drill = no target). Cleared on leaving drill + on ?reset=1
  // (below). Simple YYYY-MM-DD shape check to keep junk out.
  if (day && (period || month) && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    params.set("day", day);
  }
  const qs = params.toString();
  return qs ? `/service-calendar?${qs}` : "/service-calendar";
}

// Aggregate the workspace metrics (totals + per-week subtotals) from a
// days array. Shared by periodMetrics (fiscal period) and monthMetrics
// (calendar month) so the range-based PeriodWorkspace reads either
// identically. Revenue comes from day.totals.* (the #257-corrected
// sc_daily_revenue source - never recomputed client-side).
//
// PR-D drill Phase 1 (2026-07-20): the grouping backend gains an
// explicit branch on the second arg. Period scope stays byte-identical
// (default "fiscalWeek"); month scope opts into "calendarWeek" where
// each bucket keys on the ISO Monday of the day's calendar week. Fiscal
// buckets can straddle a Mon-Sun visual row when a period boundary sits
// mid-week - the old bug was labeling the row by the FIRST day's fiscal
// week and totaling only that fiscal slice. Under "calendarWeek" the
// bucket totals the actual 7 days that Mon-Sun row shows; the rail
// Weeks list iterates the same output so bands and rail lines stay in
// sync (correctness gate DP1-13). Consumers below the aggregate read
// `wm.label` (human) + `wm.startDate` / `wm.endDate` (calendar bounds)
// + `wm.periods` (the fiscal periods the days belong to) rather than
// keying on the bucket key directly, so calendar Monday keys don't leak
// into the UI as raw date strings.
function weekMondayISO(dateStr) {
  // dateStr is YYYY-MM-DD. Convert to a UTC date noon to sidestep
  // DST edges (same shape buildWorkspaceWeekGrid uses at :1258-1263).
  const d = new Date(dateStr + "T12:00:00");
  const dow = d.getDay();                // 0 = Sunday
  const daysBeforeMonday = dow === 0 ? 6 : dow - 1;
  d.setDate(d.getDate() - daysBeforeMonday);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDaysISO(dateStr, n) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function aggregateWorkspaceMetrics(days, { groupBy = "fiscalWeek" } = {}) {
  const out = {
    projMeals: 0, actMeals: 0,
    projRev: 0, actRev: 0,
    complete: 0, needsEntry: 0, overdue: 0,
    // SC-043: service/game day counts drive the week-card denominators
    // + the "No service" / "No games" week variant. Kind-agnostic here;
    // WeekSubtotals picks which one applies.
    serviceDays: 0, serviceDaysEntered: 0,
    gameDays: 0, gameDaysEntered: 0,
    total: 0,
    weeks: {},
  };
  if (!days?.length) return out;
  for (const day of days) {
    // Kevin's ruling 2026-07-11 (superseding SC-066 step 0's widened
    // "complete" predicate): the "X of Y entered" numerator counts
    // ONLY actionable days with recorded actuals. A no-service day
    // (auto or manual) drops out of BOTH numerator and denominator
    // (see out.total assignment at end + isServiceDay derivation
    // below). See season/dayPredicates.js for the full rule.
    // `hasActuals` remains the readable signal for the completion
    // color pass because status="entered" IS the classifier's
    // hasActuals verdict for actionable service days.
    const isDayEntered = day.status === "entered";
    // isActionableTotal drives out.total (the denominator). Same
    // predicate as isActionableDay() in dayPredicates.js; kept inline
    // here so the week aggregate and the period aggregate stay in
    // lockstep without a second helper import.
    const isActionableTotal = day.status !== "no-service"
      && day.status !== "off-season"
      && day.status !== "prep"
      && day.status !== "exhibition"
      && day.status !== "away";
    if (isDayEntered) out.complete++;
    if (isActionableTotal) out.total++;
    // isDayComplete retained locally for the fee/game-day paths below
    // (SC-066's "hasActuals || no-service" still describes the tile
    // color state; only the "X of Y entered" ratio has changed).
    const isDayComplete = day.hasActuals || day.status === "no-service";
    if (day.status === "overdue") out.overdue++;
    else if (day.status === "needs-entry") out.needsEntry++;
    // SC-043: service-day predicate. Excludes the non-service statuses.
    // For MLB homestand the classifier emits entered/future so both count;
    // for per-meal/MiLB/STL-FL, no-service days drop out.
    // sc-12 (2026-07-10): exhibition is billed outside the contract - it
    // is NOT a service day for rollup purposes, so the week/period
    // subtotals don't inflate their serviceDays denominator.
    // sc-13 (2026-07-10): away days - team is on the road - are also
    // not a service day; same exclusion so the road-trip weeks don't
    // inflate the serviceDays denominator.
    const isServiceDay = day.status !== "no-service"
      && day.status !== "off-season"
      && day.status !== "prep"
      && day.status !== "exhibition"
      && day.status !== "away";
    if (isServiceDay) {
      out.serviceDays++;
      // Step-0 widening also applies to serviceDaysEntered so the fee
      // "days entered" chip agrees with the per-meal "days" tile.
      if (isDayComplete) out.serviceDaysEntered++;
    }
    // SC-043: game-day predicate (MLB homestand). meta.gameType is
    // populated from sc_daily_revenue.game_type for game days;
    // PREP/OPEN/CLOSE/CLEAN days have no game_type.
    const isGameDay = !!day.meta?.gameType;
    if (isGameDay) {
      out.gameDays++;
      // MLB homestand path: no "no-service" status is emitted, so
      // isDayComplete on a game day collapses to day.hasActuals.
      if (isDayComplete) out.gameDaysEntered++;
    }
    out.projRev += day.totals?.projectedRevenue || 0;
    if (day.hasActuals) out.actRev += day.totals?.actualRevenue || 0;
    for (const ci of Object.keys(day.projected || {})) {
      const pv = day.projected[ci];
      if (pv != null) out.projMeals += pv;
      if (day.hasActuals && day.actual?.[ci] != null) out.actMeals += day.actual[ci];
    }
    // PR-D drill Phase 1: bucket key branches on groupBy.
    //   "fiscalWeek" (period scope default): existing day.meta.week key.
    //   "calendarWeek" (month scope): ISO Monday of day's calendar week.
    // Fiscal bucket carries its own label as the key. Calendar bucket
    // stores startDate/endDate (Mon..Sun) so downstream can identify
    // "today's week" without keying on meta.week (which would still be
    // fiscal). Both bucket shapes track periods[] so band render can
    // prefix P7 / P8 / straddle-P7-8 without a second derivation.
    const wk = groupBy === "calendarWeek"
      ? weekMondayISO(day.date)
      : (day.meta?.week || "W?");
    if (!out.weeks[wk]) {
      out.weeks[wk] = {
        actRev: 0, projRev: 0, actMeals: 0,
        complete: 0, total: 0, needsEntry: 0, overdue: 0,
        serviceDays: 0, serviceDaysEntered: 0,
        gameDays: 0, gameDaysEntered: 0,
        // Human label - post-processed for calendarWeek (Week 1..N in
        // insertion order); fiscalWeek keeps its key as its label.
        label: groupBy === "calendarWeek" ? null : wk,
        // Calendar bounds for both branches. calendarWeek fills from
        // the key; fiscalWeek fills as the min/max day.date it sees.
        startDate: groupBy === "calendarWeek" ? wk : null,
        endDate:   groupBy === "calendarWeek" ? addDaysISO(wk, 6) : null,
        // Unique fiscal periods the days belong to (order of first
        // insertion). Drives DP1-11 P7 / P7-8 prefix rendering.
        periods: [],
      };
    }
    const w = out.weeks[wk];
    // Track periods (both branches - useful for calendar buckets to
    // detect straddle; fiscalWeek buckets carry a single period by
    // definition but keeping the array uniform simplifies consumers).
    const dayPeriod = day.meta?.period || null;
    if (dayPeriod && !w.periods.includes(dayPeriod)) w.periods.push(dayPeriod);
    // Fiscal bucket: track startDate/endDate as min/max seen.
    if (groupBy !== "calendarWeek") {
      if (w.startDate === null || day.date < w.startDate) w.startDate = day.date;
      if (w.endDate   === null || day.date > w.endDate)   w.endDate   = day.date;
    }
    // Kevin's ruling 2026-07-11: weeks track actionable-only counts
    // too so the week-card counter agrees with the period counter
    // for the same range. w.total = actionable days in this week.
    if (isActionableTotal) w.total++;
    w.projRev += day.totals?.projectedRevenue || 0;
    if (day.status === "overdue") w.overdue++;
    else if (day.status === "needs-entry") w.needsEntry++;
    if (isServiceDay) {
      w.serviceDays++;
      if (isDayComplete) w.serviceDaysEntered++;
    }
    if (isGameDay) {
      w.gameDays++;
      if (isDayComplete) w.gameDaysEntered++;
    }
    // Kevin's ruling 2026-07-11: week's `complete` follows the
    // actionable-and-entered numerator too (superseding SC-066's
    // widened predicate). No-service days are excluded from BOTH
    // sides of the week ratio, matching the period ratio.
    if (isDayEntered) w.complete++;
    // Revenue/meals accumulators STAY gated on hasActuals: a case-1
    // no-service Sunday has no actual_revenue to sum, and inflating
    // actMeals with a projection-derived zero is a no-op anyway.
    if (day.hasActuals) {
      w.actRev += day.totals?.actualRevenue || 0;
      for (const ci of Object.keys(day.actual || {})) {
        const av = day.actual[ci];
        if (av != null) w.actMeals += av;
      }
    }
  }
  // out.total is accumulated per-day above via isActionableTotal
  // (Kevin's ruling 2026-07-11). Prior version set out.total =
  // days.length here, which inflated the denominator with away /
  // no-service / exhibition / off-season / prep days.
  //
  // PR-D drill Phase 1: calendarWeek buckets get "Week N" labels in
  // insertion order (which is calendar-time order because callers
  // pass days sorted asc by date). fiscalWeek buckets already carry
  // their key as the label.
  if (groupBy === "calendarWeek") {
    let n = 1;
    for (const k of Object.keys(out.weeks)) {
      out.weeks[k].label = `Week ${n++}`;
    }
  }
  return out;
}

function AccountDropdown({ accounts, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = accounts.find(a => a.key === value);
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const grouped = {};
  accounts.forEach(a => { const cat = a.category || "Other"; if (!grouped[cat]) grouped[cat] = []; grouped[cat].push(a); });
  const catOrder = Object.keys(grouped).sort((a, b) => (CAT_ORDER[a]||9) - (CAT_ORDER[b]||9));
  return (
    <div className="sc-dropdown" ref={ref}>
      <button className="sc-dropdown-trigger" onClick={() => setOpen(!open)}>
        <span className="sc-dropdown-val">{selected ? `${selected.key} - ${selected.name}` : "Select..."}</span>
        <svg className={`sc-dropdown-arrow ${open ? "sc-dropdown-arrow--open" : ""}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && (
        <div className="sc-dropdown-menu">
          {catOrder.map(cat => (
            <div key={cat}>
              <div className="sc-dropdown-cat">{CAT_LABELS[cat] || cat}</div>
              {grouped[cat].map(a => (
                <button key={a.key} className={`sc-dropdown-item ${a.key === value ? "sc-dropdown-item--active" : ""}`}
                  onClick={() => { onChange(a.key); setOpen(false); }}>
                  <span>{a.key} - {a.name}</span>
                  {a.key === value && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ServiceCalendar({ showToast, session, heroImage, firstName, isDev = false }) {
  const scV2 = useScV2();
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState("");
  // year is hardcoded to the active season; month initializes from the
  // CLIENT's local clock, not the server's. The calendar fetch below
  // always sends ?month=YYYY-MM explicitly, so the server-side UTC
  // fallback in route.js sc-load is never reached in practice.
  // Operators span CT/ET/AZ; a server-side default would land the
  // wrong month for an evening operator near a month boundary. Keep
  // this client-local.
  const [year] = useState(2026);
  const [month, setMonth] = useState(new Date().getMonth());
  // View state - two orthogonal axes plus a parallel admin surface.
  // PR-A internal rename of the legacy viewMode tri-state. PR-B/D extend
  // these without changing the shape further.
  //   scope  = altitude within a lens. PR-A ships only year/month under
  //            lens=calendar; the enum includes period/week/day for future
  //            stages. day is reserved for an explicit day-scope mode;
  //            today the day-detail overlay sits orthogonal as focusDay.
  //   lens   = how time is carved. PR-B1 ships only "calendar" (the
  //            year-of-months grid + single-month grid surfaces). PR-B2
  //            adds "period" with its own scope hierarchy. The lens used
  //            to be called "month"; renamed to "calendar" in B1.1 so it
  //            does not collide with the "Month" scope segment.
  //   isAdminView = the in-page admin parallel surface. NOT a lens or
  //            scope. Flipping it on suppresses (scope, lens) rendering
  //            and shows AdminPanel; flipping it off restores scope +
  //            lens to whatever they were underneath.
  // Server-side isScAdmin still gates every admin POST action in
  // route.js - the boolean here is render-only.
  // Initial scope=year so the SeasonShell skeleton renders during
  // the brief mount-to-accounts-loaded window; computeInitialView
  // overrides this once roles arrive (floor users land on Period).
  const [scope, setScope] = useState("year");
  const [lens, setLens]   = useState("calendar");
  const [isAdminView, setIsAdminView] = useState(false);
  const [roleTier, setRoleTier] = useState("unknown");
  // F2: raw contacts.role strings kept alongside the derived tier so
  // computeInitialView can be called with the multi-role-aware `roles`
  // input (floor-wins tiebreaker) rather than a pre-collapsed string.
  const [rawRoles, setRawRoles] = useState([]);
  // F2: hasHomeAccount = user_accounts.account exists AND is in the
  // sorted account list the dropdown carries. Gates the floor-tier
  // Period-workspace redirect - a floor role without a home account
  // lands on the Season overview instead of the CIN-AZ fallback.
  const [hasHomeAccount, setHasHomeAccount] = useState(false);
  const [adminView, setAdminView] = useState({ mode: "overview" });
  const [data, setData] = useState(null);
  // Account-level fee-branch derivation. Hoisted from its former home
  // in the account-mode block (was ~line 1072) so the Phase 6 cutover
  // hook below can consume it directly - one source for the fee-branch
  // signal across the whole component. Byte-identical predicate.
  const isFeeAccount = data?.account?.billingModel === "flat_fee";
  // W7 PR 3/3 Phase 6 cutover - the effective entry-v2 gate for the
  // account currently loaded. Precedence handled inside the hook
  // (stored-off wins; storedOn wins over cutover list; absent falls
  // through to env default OR ENTRY_V2_ACCOUNTS membership). Hook is
  // called unconditionally per React rules. Consumes the CANONICAL
  // mount-site variables: `selectedAccount` (the URL / picker /
  // hydration source of truth - the key that every fetch already
  // uses) and `isFeeAccount` (the guard every other branch reads).
  // No second derivation of a load-bearing gate. Safe when
  // selectedAccount is "" (hydration not run yet) - the hook sees
  // undefined and returns envDefault only.
  const scEntryV2 = useScEntryV2Effective(selectedAccount || undefined, isFeeAccount);
  const [yearData, setYearData] = useState(null);
  // SC-033: track the year-summary fetch state so a whole-fetch failure
  // renders the failed atoms on every overview cell instead of silently
  // stalling on the loading skeleton (the pre-fix behavior).
  //   "idle"    -> not yet requested (SSR default; no request in flight)
  //   "loading" -> request in flight; skeleton renders
  //   "loaded"  -> success; normal render
  //   "failed"  -> error or !d.success; overview forces failed cells
  const [yearLoadState, setYearLoadState] = useState("idle");
  // SC-047: mirror the overview loadState pattern for the drill-in
  // scopes. Month drill is single-fetch; period drill is 1-2 parallel
  // month fetches - "failed" here means TOTAL failure (all requested
  // months failed). Partial failure keeps using partialError +
  // WorkspacePartialBanner.
  const [drillLoadState, setDrillLoadState] = useState("idle");
  const [yearToday, setYearToday] = useState(null);
  // Period lens state.
  //   periodKey   = which period ("P7") the user is viewing.
  //   monthCache  = { "2026-06": <sc-load payload>, ... } - already-
  //                 fetched calendar months, merged 1-2 into a period
  //                 view without refetching.
  //   periodRanges = [{ period, start, end }, ...] from sc-year-summary;
  //                  drives prev/next period nav + period -> calendar-
  //                  month derivation.
  //   partialError = null | { failedMonth: "2026-07" } for the honest
  //                  partial-data state.
  const [periodKey, setPeriodKey] = useState(null);
  // Month drill: which calendar month ("YYYY-MM") the user drilled into
  // from the Calendar overview. Mutually exclusive with periodKey - the
  // URL sync effect below picks one via the ?period / ?month gate.
  const [monthKey, setMonthKey] = useState(null);
  const [monthCache, setMonthCache] = useState({});
  const [periodRanges, setPeriodRanges] = useState(null);
  const [partialError, setPartialError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [focusDay, setFocusDay] = useState(null);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // F3: save-queue state. syncingKeys is the set of `${account}|${date}`
  // for entries currently pending replay across ALL accounts (the driver
  // needs the full set; the tile UI filters below to just the current
  // account). refreshSyncing() reads the localStorage-backed queue -
  // called after every enqueue/dequeue and on the storage event so
  // sibling tabs stay in sync too.
  //
  // Hoisted to the main state section 2026-07-10 (fix/sc-f3-tdz-hook-order):
  // consumers appear earlier in the render body (syncingDates useMemo,
  // the driver useEffect, the three save handlers). Declaring the state
  // here keeps declaration < first-use for every consumer, which JS
  // requires - `const` is TDZ, referring to it before this line throws
  // ReferenceError at first render. `next build` cannot catch this
  // (client components aren't executed at build). Any new F3-adjacent
  // hook goes below this block, not above it.
  const [syncingKeys, setSyncingKeys] = useState(() => new Set());
  const refreshSyncing = useCallback(() => {
    setSyncingKeys(new Set(scGetAll().map(e => scQueueKey(e.accountKey, e.date))));
  }, []);
  // F3: the driver exposes a scheduler via ref so a fresh handleSave
  // enqueue can kick a retry immediately without waiting on the driver
  // effect to re-run. Ref is populated by the useEffect below (mount).
  const scheduleReplayRef = useRef(null);
  const kickReplay = useCallback((key) => {
    scheduleReplayRef.current?.(key);
  }, []);

  // Design Batch 2: data-freshness timestamp. Tracks when the year
  // summary (the SC's primary data anchor) last landed. Rendered as
  // "as of <time>" in the chrome bar (rubric Part 3 data-freshness).
  const [asOf, setAsOf] = useState(null);

  // Admin gate (client-side - just controls whether the toggle + body
  // RENDER, not authorization). Server-side isScAdmin checks on every
  // admin POST action in route.js remain the security boundary.
  const isAdmin = isScAdmin(session?.user?.email);

  // Derived view booleans - pure functions of (scope, lens, isAdminView).
  // Use these for render conditions; effects must depend on the
  // underlying scope/lens state so they don't over-fire.
  // Year is lens-agnostic at scope=year (SeasonShell's internal toggle
  // handles the calendar/period sub-view). Period scope only renders
  // when lens=period.
  const isYearView   = !isAdminView && scope === "year"   && (lens === "calendar" || lens === "period");
  const isPeriodView = !isAdminView && scope === "period" && lens === "period";
  const isMonthView  = !isAdminView && scope === "month"  && lens === "calendar";

  // URL ?view=admin sync (App Router shallow update).
  const router = useRouter();
  const searchParams = useSearchParams();

  /* V3 §9.2 H1 - effective load-state resolves the ?debug=failed
     hook ONCE for every consumer. SC-033 wired the hook only at the
     SeasonShell mount below (line ~2205); the rail + as-of pill kept
     reading raw yearLoadState so those surfaces never went failed on
     the test URL. Zero write-path: test-hook only, gated on isDev
     per SC-033; production fetch behavior is unchanged (real
     failures still set yearLoadState = "failed" via the fetch
     effect). */
  const effectiveYearLoadState = (isDev && searchParams?.get("debug") === "failed")
    ? "failed"
    : yearLoadState;

  // Bulk mode
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false);
  const [bulkReviewOpen, setBulkReviewOpen] = useState(false);
  // SC-062: bulk custom-values path now has a review step between the
  // entry form and the write, mirroring the match-projections path.
  // The entry form's "Save to N days" pushes into review instead of
  // firing handleBulkSave directly; the review's Confirm & save is what
  // ultimately calls handleBulkSave. Go back closes the review and
  // leaves bulkValues intact so the operator can adjust.
  const [bulkCustomReviewOpen, setBulkCustomReviewOpen] = useState(false);
  const [bulkValues, setBulkValues] = useState({});

  useEffect(() => {
    fetch("/api/service-calendar?action=sc-accounts")
      .then(r => r.json())
      .then(d => {
        if (!d.success || !d.accounts?.length) return;
        const sorted = d.accounts.sort((a, b) => (CAT_ORDER[a.category]||9) - (CAT_ORDER[b.category]||9) || a.key.localeCompare(b.key));
        setAccounts(sorted);
        // Account-selection fallback chain (2026-07-11 refactor: URL now
        // wins so a hard refresh at /?account=TXR-TX-H&period=P1 lands on
        // TXR-TX-H, not the user's default):
        //   1. `?account=` in the URL (if it maps to a loaded account)
        //   2. user's mapped account (defaultAccount from user_accounts)
        //   3. CIN-AZ (corp/admin/unmapped operator default)
        //   4. first account in the sorted list
        // The match-against-list check guards against a mapping pointing
        // at an account that isn't currently imported (e.g. CORP rows
        // from the contacts seed; CORP has no sc_services so it's not in
        // the dropdown).
        //
        // This is the ONLY place URL->selectedAccount hydration happens.
        // It runs ONCE per mount (the effect's deps are [showToast],
        // captured stable). No self-refire is possible because
        // selectedAccount is only WRITTEN here, never read as a dep.
        const urlAccount = searchParams?.get("account") || null;
        const fallbacks = [urlAccount, d.defaultAccount, "CIN - AZ"].filter(Boolean);
        let initial = sorted[0].key;
        for (const f of fallbacks) {
          if (sorted.find(a => a.key === f)) { initial = f; break; }
        }
        setSelectedAccount(initial);
        // Mount default: routed through computeInitialView() so the
        // role-conditional landing (floor -> Period workspace at the
        // current period; leadership -> Season overview) is one body
        // edit in the helper, not a scatter here.
        //
        // Role activation: sc-accounts now returns `roles[]` from
        // contacts.role for the requesting user. A user can have
        // multiple contacts rows (one per role/account combo, per
        // sc-3 seed), so we pass the array - the helper applies the
        // floor-wins tiebreaker (tierFromRoles). Empty/missing roles
        // resolve to "unknown" tier -> Season default (no regression).
        // The URL is the source of truth for the routed view (see the
        // URL->state effect below), so the mount no longer sets
        // scope/lens/periodKey/isAdminView here. We only capture the
        // role tier, used by the floor-default landing redirect.
        setRoleTier(tierFromRoles(d.roles || []));
        setRawRoles(d.roles || []);
        // F2 (R-A ruling 2026-07-09): hasHomeAccount is TRUE only when
        // user_accounts.account resolves to a live account in the
        // dropdown list. A stale mapping (row points at an unimported
        // account) or a missing row both resolve to FALSE, which
        // demotes a floor user's landing from the Period workspace to
        // the Season overview. Same in-list guard the account fallback
        // above uses so the two decisions cannot disagree.
        setHasHomeAccount(!!(d.defaultAccount && sorted.some(a => a.key === d.defaultAccount)));
        // landOnCurrentPeriod handled by the periodRanges-init effect
        // below: when a floor role lands and periodRanges arrives,
        // periodKey gets set to the period containing today. The
        // existing init effect already does this for the no-periodKey
        // case, so the floor landing piggybacks on it for free.
      })
      .catch(() => showToast("Failed to load accounts", "error"));
    // searchParams + isAdmin captured at mount only; subsequent URL
    // updates are driven by the sync effect below (router.replace), not
    // by this fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showToast]);

  // Today's date key. Declared here (high in the component) so the
  // PR-B2 period effects below can use it without TDZ. Computed every
  // render but the value is stable across the day - no perf cost.
  const today = dateKey(new Date());

  // Clear cached data the instant the account changes. Without this,
  // switching accounts on the year view briefly rendered the NEW
  // account's yearData (light fetch, returns first) under the OLD
  // account's data-billing / data-category attribute (heavier sc-load,
  // returns second) - so PDC dots would flash through fee-account
  // CSS overrides for ~200ms before snapping into place. Clearing
  // both forces the year body's "is everything loaded?" gate to fail
  // until BOTH responses land for the new account.
  useEffect(() => {
    setData(null);
    setYearData(null);
    setYearToday(null);
    // PR-B2: also clear period state on account-switch. monthCache
    // is per-account; without clearing it a switch would render the
    // PRIOR account's period days briefly. periodRanges is also
    // per-account (the year-summary refetch will repopulate).
    // periodKey is now owned by the URL (the URL->state effect), so we
    // do NOT clear it here - the view persists across an account switch
    // and the new account's data refetches underneath it. Clearing
    // monthCache already prevents the prior account's days from showing.
    setMonthCache({});
    setPeriodRanges(null);
    setPartialError(null);
    setDrillLoadState("idle");
  }, [selectedAccount]);

  const mk = `${year}-${String(month+1).padStart(2,"0")}`;
  // B8a Fix 2 (2026-07-23): view-context UI reset extracted here from
  // the sc-load fetch effect below. Prior to this split, closing the
  // day-entry modal and clearing bulk state were bundled into the
  // fetch effect's body - which fires on every reloadKey bump. That
  // meant a refresh or save closed the modal mid-edit (data-loss-shaped
  // on refresh once B8a Fix 1 wires it, and incompatible with the
  // Handoff animation §8B that keeps the modal open through save).
  //
  // Now: these resets fire ONLY when the operator changes the VIEW,
  // which is either an account switch, a calendar-month change (mk),
  // or a drill nav (monthKey / periodKey). reloadKey is deliberately
  // NOT in the deps - a data refresh must not touch UI state.
  //
  // Drill nav closure: opening a modal on July 5 then stepping to
  // August is a deliberate navigation; closing the July modal is the
  // expected behavior. Refresh and save are BACKGROUND data events
  // the operator did not ask for - modal must survive those.
  useEffect(() => {
    // B2/B8a interaction guard (2026-07-24): read + CLEAR the ref
    // at the top of every fire. See pendingRailFocusRef declaration
    // (~:1274) for the full contract. Clear must run unconditionally
    // - that's what makes the "cleared exactly once" invariant hold
    // regardless of whether we skip focusDay reset or not.
    const suppressFocusReset = pendingRailFocusRef.current !== null;
    pendingRailFocusRef.current = null;
    if (!suppressFocusReset) {
      setFocusDay(null);
    }
    setBulkMode(false);
    setBulkSelected(new Set());
    setBulkPanelOpen(false);
  }, [selectedAccount, mk, monthKey, periodKey]);
  useEffect(() => {
    if (!selectedAccount) return;
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/service-calendar?action=sc-load&account=${selectedAccount}&month=${mk}&clientToday=${encodeURIComponent(today)}`, { signal: controller.signal })
      .then(r => r.json())
      .then(d => { if (d.success) setData(d); else { showToast(d.error || "Failed", "error"); setData(null); } })
      .catch(e => { if (e.name !== "AbortError") { showToast("Network error", "error"); setData(null); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selectedAccount, mk, showToast, reloadKey, today]);

  useEffect(() => {
    // Depend on the underlying scope/lens state (PRIMARY state pieces),
    // not on the derived isYearView boolean. isYearView is a per-render
    // constant whose reference changes every render - depending on it
    // would re-fire this effect on every render and trigger extra
    // network calls. The guard inside handles the short-circuit.
    //
    // PR-B2: also fires for lens=period to capture periodRanges (the
    // [{ period, start, end }, ...] aggregation added in the dataStore
    // extension). One endpoint, two consumers - the year heatmap and
    // the period nav both feed from sc-year-summary.
    // Drill P2 PR-1 DP2-02 (2026-07-20): also fire on isMonthView so
    // yearData + yearToday populate on the month drill. Without this,
    // a cold URL landing directly on ?month=YYYY-MM leaves yearData
    // null - which nulls yearBannerStats + yearToday - which renders
    // the ribbon's Today-group readout as "TODAY -  PERIOD -" empty
    // dashes on month, even though period view (which trips
    // needsPeriodRanges) populates it fine. Same lightweight
    // sc-year-summary endpoint; already fires on year + period; now
    // month too. Account-switch reset at :620 still clears everything;
    // fetch re-fires under the new account.
    const needsYearData = isYearView || isMonthView;
    const needsPeriodRanges = lens === "period";
    if (!selectedAccount || (!needsYearData && !needsPeriodRanges)) return;
    // reloadKey is in the dep array so a save in the month view also
    // refreshes the year heatmap on next visit; without it, the heatmap
    // showed stale grey dots after data flipped to "entered" in PG.
    setYearLoadState("loading");
    fetch(`/api/service-calendar?action=sc-year-summary&account=${selectedAccount}&clientToday=${encodeURIComponent(today)}`)
      .then(r => r.json()).then(d => {
        if (!d.success) { setYearLoadState("failed"); return; }
        setYearData(d.months);
        setYearToday(d.today || null);
        if (d.periodRanges) setPeriodRanges(d.periodRanges);
        setYearLoadState("loaded");
        // Design Batch 2: stamp the load time once data lands.
        setAsOf(new Date());
      }).catch(() => { setYearLoadState("failed"); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, lens, isAdminView, selectedAccount, reloadKey, today]);

  // PR-B2 period-data effect. Derives the 1-2 calendar months the
  // current period spans and fetches only the missing months in
  // parallel, merging them into monthCache. Deps use PRIMARY state
  // (lens / account / periodKey / periodRanges / reloadKey) - NEVER
  // the derived isPeriodView (would over-fire). monthCache IS in the
  // deps (fixed in #332): the `missing.length === 0` guard self-
  // terminates, so a fresh closure on cache clear (account switch /
  // reloadKey invalidation) reliably re-triggers the fetch instead of
  // silently skipping via a stale closure.
  useEffect(() => {
    if (lens !== "period" || !selectedAccount || !periodKey || !periodRanges) return;
    const range = periodRanges.find(r => r.period === periodKey);
    if (!range) return;
    const monthsNeeded = monthsBetween(range.start, range.end);
    const missing = monthsNeeded.filter(mk => !monthCache[mk]);
    if (missing.length === 0) { setPartialError(null); setDrillLoadState("loaded"); return; }
    const controller = new AbortController();
    setLoading(true);
    setPartialError(null);
    setDrillLoadState("loading");
    Promise.allSettled(missing.map(mk =>
      fetch(`/api/service-calendar?action=sc-load&account=${selectedAccount}&month=${mk}&clientToday=${encodeURIComponent(today)}`, { signal: controller.signal })
        .then(r => r.json())
        .then(d => d.success ? { mk, payload: d } : Promise.reject({ mk, error: d.error || "Failed" }))
    ))
      .then(results => {
        if (controller.signal.aborted) return;
        const ok = []; let failed = null;
        for (const r of results) {
          if (r.status === "fulfilled") ok.push(r.value);
          else if (!failed && r.reason?.mk) failed = r.reason.mk;
        }
        if (ok.length > 0) {
          setMonthCache(prev => {
            const next = { ...prev };
            for (const { mk, payload } of ok) next[mk] = payload;
            return next;
          });
        }
        setPartialError(failed ? { failedMonth: failed } : null);
        // SC-047: total failure = every requested month failed. Partial
        // failure keeps the existing partialError banner path; drill
        // stays "loaded" so cells that DID land render normally.
        setDrillLoadState(ok.length === 0 ? "failed" : "loaded");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // monthCache IS in deps: the guard `missing.length === 0` self-terminates,
    // so a fresh closure on cache clear (account switch / reloadKey invalidation)
    // reliably re-triggers the fetch. Excluding it silently skipped the refetch
    // when the reset effect cleared monthCache, leaving the drill blank.
  }, [lens, selectedAccount, periodKey, periodRanges, reloadKey, today, monthCache]);

  // Month drill fetch. When the user opens ?month=YYYY-MM, ensure
  // monthCache[monthKey] is loaded. Deep-links land here cold; drilling
  // from the Calendar overview may hit the cache from the year-summary
  // path if that month was already fetched, in which case this is a
  // no-op. Mirrors the period-months effect shape (functional set,
  // abort on unmount, partial-error surface).
  useEffect(() => {
    if (!isMonthView || !selectedAccount || !monthKey) return;
    if (monthCache[monthKey]) { setPartialError(null); setDrillLoadState("loaded"); return; }
    const controller = new AbortController();
    setLoading(true);
    setPartialError(null);
    setDrillLoadState("loading");
    fetch(`/api/service-calendar?action=sc-load&account=${selectedAccount}&month=${monthKey}&clientToday=${encodeURIComponent(today)}`, { signal: controller.signal })
      .then(r => r.json())
      .then(d => {
        if (controller.signal.aborted) return;
        if (d.success) {
          setMonthCache(prev => ({ ...prev, [monthKey]: d }));
          setPartialError(null);
          setDrillLoadState("loaded");
        } else {
          setPartialError({ failedMonth: monthKey });
          setDrillLoadState("failed");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPartialError({ failedMonth: monthKey });
          setDrillLoadState("failed");
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // monthCache IS in deps: the guard `if (monthCache[monthKey]) return`
    // self-terminates, so a fresh closure on cache clear (account switch /
    // reloadKey invalidation) reliably re-triggers the fetch. Excluding it
    // silently skipped the refetch and left the grid blank.
  }, [isMonthView, selectedAccount, monthKey, reloadKey, today, monthCache]);

  // PR-B2 periodKey initialization. When entering lens=period and
  // periodRanges arrives, land on the period containing today (or the
  // first period if today is outside the year's coverage). Preserves
  // an existing periodKey if it's still valid (so prev/next nav
  // doesn't get clobbered by a periodRanges refresh).
  useEffect(() => {
    if (lens !== "period" || !periodRanges?.length) return;
    if (periodKey && periodRanges.some(r => r.period === periodKey)) return;
    const containingToday = periodRanges.find(r => today >= r.start && today <= r.end);
    setPeriodKey(containingToday ? containingToday.period : periodRanges[0].period);
  }, [lens, periodRanges, periodKey, today]);

  // URL-sync effect for the ROUTED VIEW ONLY (view/period/month). Any
  // URL change - mount, in-app push, browser back/forward - derives
  // view state from the URL. Redundant sets are no-ops (React bails
  // when primitives are unchanged).
  //
  // 2026-07-11 nav-rehydration redo (post-#399 revert): this effect
  // DELIBERATELY does not read or write `selectedAccount`. Account
  // hydration lives in the accounts-init fetch below (runs once per
  // mount, reads `?account=` from the initial URL). The dropdown moves
  // selectedAccount DIRECTLY via setSelectedAccount and pushes the URL
  // in parallel - the URL-sync re-fire that follows the push touches
  // only view/period/month, sees no scope change, no-ops.
  //
  // Deps stay at [searchParams, isAdmin] - the pre-#399 shape - so
  // the effect cannot re-fire in response to its own writes. Adding
  // selectedAccount or accounts to these deps is exactly what caused
  // the self-refire loop in #399.
  useEffect(() => {
    const view = searchParams?.get("view") || null;
    const period = searchParams?.get("period") || null;
    const month = searchParams?.get("month") || null;
    if (view === "admin" && isAdmin) {
      setIsAdminView(true); setScope("year"); setLens("calendar"); setPeriodKey(null); setMonthKey(null);
    } else if (period) {
      // Any non-empty ?period= means "show this period's workspace."
      // The identifier is the bare period number (e.g. "1"), NOT "P1" -
      // the old /^P\d+$/ guard never matched, so drilling changed the
      // URL but never opened the workspace. An unknown value renders the
      // workspace empty state (graceful), so no format regex is needed.
      // Precedence: ?period= wins if both ?period= and ?month= present.
      setIsAdminView(false); setScope("period"); setLens("period"); setPeriodKey(period); setMonthKey(null);
    } else if (month && /^\d{4}-\d{2}$/.test(month)) {
      // ?month=YYYY-MM opens the month drill-in. Shape guard prevents
      // junk values from creating a scope=month state with no valid
      // month lookup - falls through to the year default instead.
      setIsAdminView(false); setScope("month"); setLens("calendar"); setPeriodKey(null); setMonthKey(month);
    } else {
      setIsAdminView(false); setScope("year"); setLens("calendar"); setPeriodKey(null); setMonthKey(null);
    }
  }, [searchParams, isAdmin]);

  // Floor-role default landing (preserved behavior): a floor user with a
  // clean URL lands on the current period workspace. Fires once
  // periodRanges is ready, and only while the URL is still clean - a
  // deep-link or any navigation takes precedence. Replace (not push) so
  // the default does not sit in the back-stack behind first paint.
  //
  // F2: the "should I redirect" decision is delegated to
  // computeInitialView so the ROLE_TIERS map + the hasHomeAccount gate
  // stay in one place. A floor role WITHOUT a resolved home account now
  // stays on the Season overview instead of being force-landed on the
  // CIN-AZ fallback they don't own.
  const floorRedirectDone = useRef(false);
  useEffect(() => {
    // P1.1 (2026-07-10): fresh-landing intent is signaled by TopNav via
    // `?reset=1`, not by the URL being clean.
    //
    // Why: the top-nav Service Calendar click AND the in-app `<- Season`
    // button both push the identical clean `/service-calendar` URL.
    // Two DIFFERENT intents, same URL shape: (1) "land fresh - re-run
    // the F2 landing" vs (2) "show me the overview and stay here".
    // P1 #379's unconditional clean-URL latch-clear bounced floor+home
    // users back into their period on (2). The pre-#347 latch comment
    // at :637-640 describes exactly this bounce - the P1 clear
    // reintroduced it.
    //
    // Discriminator: the ONLY honest signal is an explicit marker. The
    // TopNav intercept now pushes `?reset=1`; the Season button + every
    // other clean-URL path stay as before. We read the marker here,
    // clear the latch, then router.replace-strip it so the URL after
    // this pass is a plain `/service-calendar` (URL-sync + downstream
    // consumers see the same clean URL they saw before). `reset` is
    // transient - it must NOT count as an explicit deep-link in the
    // latch-on-explicit-URL branch below.
    //
    // Behaviors after this fix:
    //   - Leadership, drilled -> top-nav -> `?reset=1` -> stripped ->
    //     landing.landOnCurrentPeriod is FALSE -> Season overview. (Kevin's
    //     original P1 symptom, still fixed.)
    //   - Floor+home, drilled -> `<- Season` button -> plain URL, no
    //     marker -> latch stays true, landing skipped -> stays on Season.
    //     (The regression - fixed.)
    //   - Floor+home -> top-nav -> `?reset=1` -> stripped -> landing
    //     re-fires -> router.replace(?period=...) -> their period + today.
    //     (F2 semantic preserved.)
    //   - Deep links (`?period=P7`, `?month=YYYY-MM`, `?view=admin`) ->
    //     latch, no bounce. (Unchanged; the exclude-`reset` guard below
    //     matters here.)
    //   - Cold load, clean URL -> landing fires once. (Unchanged.)
    if (searchParams?.get("reset")) {
      floorRedirectDone.current = false;
      // Preserve `?account=` across the reset strip so a Top-nav click
      // while on a non-default account keeps that account (dropping the
      // drill scope is enough, no need to also bounce to CIN-AZ).
      router.replace(buildScUrl({ account: selectedAccount || undefined }), { scroll: false });
      return;
    }

    if (floorRedirectDone.current) return;
    // Latch "explicit URL wins" the FIRST time we see an explicit URL,
    // even before periodRanges arrives. `reset` is transient (stripped
    // above) - it must NOT trip this latch.
    const hasExplicitScope =
      searchParams?.get("view") || searchParams?.get("period") || searchParams?.get("month");
    if (hasExplicitScope) {
      floorRedirectDone.current = true;
      return;
    }
    if (!periodRanges?.length) return;
    const landing = computeInitialView({
      urlView: null, urlPeriod: null, isAdmin,
      roles: rawRoles,          // raw contacts.role strings; helper resolves tier via floor-wins
      hasHomeAccount,
    });
    if (!landing.landOnCurrentPeriod) return;
    const containingToday = periodRanges.find(r => today >= r.start && today <= r.end);
    const target = containingToday ? containingToday.period : periodRanges[0].period;
    floorRedirectDone.current = true;
    router.replace(buildScUrl({ account: selectedAccount || undefined, period: target }), { scroll: false });
  }, [rawRoles, hasHomeAccount, isAdmin, periodRanges, searchParams, today, router, selectedAccount]);

  // Save invalidation: each save handler now drops ONLY the calendar
  // month(s) it wrote to, surgically. The prior blanket setMonthCache({})
  // effect fired on every save and (since #332 put monthCache in the
  // fetch-effect deps) cascaded into refetching every cached month in
  // parallel - a burst that raced the header nav ("dead right after a
  // save"). reloadKey stays a real dep on the year-summary + sc-load
  // effects, so the heatmap + today-month `data` still refresh after a
  // save without wiping monthCache.

  const dayMap = useMemo(() => { const m = {}; if (data?.days) data.days.forEach(d => { m[d.date] = d; }); return m; }, [data]);

  // F3: filter the full syncing set down to just the current account
  // for tile rendering. syncingKeys carries entries across ALL accounts
  // (the driver needs the full set); syncingDates is the per-account
  // subset the DaySquare consumers ask about ("is THIS date syncing?").
  const syncingDates = useMemo(() => {
    if (!selectedAccount) return new Set();
    const prefix = selectedAccount + "|";
    const out = new Set();
    for (const k of syncingKeys) {
      if (k.startsWith(prefix)) out.add(k.slice(prefix.length));
    }
    return out;
  }, [syncingKeys, selectedAccount]);
  const priceLookup = useMemo(() => { const p = {}; if (data?.serviceGroups) data.serviceGroups.forEach(g => g.services.forEach(s => { p[s.colIndex] = s.price; })); return p; }, [data]);

  // PR-B2 periodDays: merge the 1-2 needed calendar months from
  // monthCache, dedupe by date, filter to meta.period === periodKey,
  // sort. Returns NULL if any needed month is missing (-> the
  // partial-data path renders the skeleton header instead of a wrong
  // total from half data). Memo keyed on (periodKey, periodRanges,
  // monthCache) - intentionally NOT on weekKey so week switch is
  // a 0ms visible-slice of already-loaded data, not a re-render.
  const periodDays = useMemo(() => {
    if (lens !== "period" || !periodKey || !periodRanges) return null;
    const range = periodRanges.find(r => r.period === periodKey);
    if (!range) return null;
    const monthsNeeded = monthsBetween(range.start, range.end);
    if (monthsNeeded.some(mk => !monthCache[mk])) return null;
    const merged = [];
    const seen = new Set();
    for (const mk of monthsNeeded) {
      for (const d of monthCache[mk].days || []) {
        if (!seen.has(d.date) && d.meta?.period === periodKey) {
          seen.add(d.date);
          merged.push(d);
        }
      }
    }
    return merged.sort((a, b) => a.date.localeCompare(b.date));
  }, [lens, periodKey, periodRanges, monthCache]);

  // PR-B2 periodServiceGroups: pulled from the first available month
  // in monthCache. serviceGroups is the same shape across months for
  // a given account (it describes the account's service catalog,
  // not the month's days), so either month's payload works. Required
  // by DayDetail when a day-tile in the period view is clicked.
  const periodServiceGroups = useMemo(() => {
    if (!monthCache) return null;
    const first = Object.values(monthCache)[0];
    return first?.serviceGroups || null;
  }, [monthCache]);

  // PR-B2 periodMetrics: mirrors the month metrics, scoped to
  // periodDays, with per-week subtotals for the sub-nav. Revenue
  // reads from day.totals.actualRevenue / projectedRevenue (the
  // #257-corrected sc_daily_revenue source - NEVER recomputed
  // client-side; that drift was the bug that pricing-fix landed).
  const periodMetrics = useMemo(() => {
    if (!periodDays) return null;
    return aggregateWorkspaceMetrics(periodDays);
  }, [periodDays]);

  // periodHomestandMap: merge the per-month homestandMap entries across
  // the 1-2 calendar months the period spans. The route's sc-load
  // returns homestandMap scoped to ONE calendar month; monthCache stores
  // each fetched month's full payload (route.js:390 includes
  // responsePayload.homestandMap). When a fiscal period crosses a month
  // boundary (e.g. Period 9 = Jun 22 - Jul 19), the second-month days
  // need the second-month's map for opponent + day_type. Without this
  // merge, days in the off-data month look up an absent key and render
  // blank (the symptom audited in docs/SC_DATA_AUDIT.md PART B).
  //
  // Per-meal accounts have no homestandMap in their payloads, so the
  // merged result is {} (same as today's data.homestandMap fallback).
  const periodHomestandMap = useMemo(() => {
    if (lens !== "period" || !periodKey || !periodRanges) return null;
    const range = periodRanges.find((r) => r.period === periodKey);
    if (!range) return null;
    const monthsNeeded = monthsBetween(range.start, range.end);
    const merged = {};
    for (const mk of monthsNeeded) {
      const m = monthCache[mk];
      if (m?.homestandMap) Object.assign(merged, m.homestandMap);
    }
    return merged;
  }, [lens, periodKey, periodRanges, monthCache]);

  // sc-17 (2026-07-11): parallel merge for the schedule overlay -
  // same cross-month merge pattern as the homestand map above,
  // sourced from responsePayload.scheduleOverlay (fetched only for
  // accounts flagged has_schedule_overlay=true; today STL - FL
  // only). Overlay drives ONLY the lg tile render decoration
  // (opponent chip + pill on top of the existing served count).
  const periodScheduleOverlay = useMemo(() => {
    if (lens !== "period" || !periodKey || !periodRanges) return null;
    const range = periodRanges.find((r) => r.period === periodKey);
    if (!range) return null;
    const monthsNeeded = monthsBetween(range.start, range.end);
    const merged = {};
    for (const mk of monthsNeeded) {
      const m = monthCache[mk];
      if (m?.scheduleOverlay) Object.assign(merged, m.scheduleOverlay);
    }
    return Object.keys(merged).length > 0 ? merged : null;
  }, [lens, periodKey, periodRanges, monthCache]);

  // ─── Month drill derivations (parallel to the period ones) ─────
  // Same range-based inputs PeriodWorkspace consumes; the workspace body
  // is reused as-is with a calendar-month range instead of a fiscal-
  // period range.
  const monthRange = useMemo(() => {
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return null;
    const [y, m] = monthKey.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return {
      start: `${monthKey}-01`,
      end:   `${monthKey}-${String(lastDay).padStart(2, "0")}`,
    };
  }, [monthKey]);

  const monthDays = useMemo(() => {
    if (!isMonthView || !monthKey) return null;
    const payload = monthCache[monthKey];
    if (!payload) return null;
    return payload.days || [];
  }, [isMonthView, monthKey, monthCache]);

  const monthMetrics = useMemo(() => {
    if (!monthDays) return null;
    // PR-D drill Phase 1 (2026-07-20): month scope groups by calendar
    // week (Mon-Sun). Period scope stays on the fiscalWeek default -
    // so periodMetrics is byte-identical to prior behavior.
    return aggregateWorkspaceMetrics(monthDays, { groupBy: "calendarWeek" });
  }, [monthDays]);

  const monthHomestandMap = useMemo(() => {
    if (!monthKey) return null;
    return monthCache[monthKey]?.homestandMap || {};
  }, [monthKey, monthCache]);

  // sc-17 (2026-07-11): parallel single-month overlay for the month
  // scope (parallel to periodScheduleOverlay above).
  const monthScheduleOverlay = useMemo(() => {
    if (!monthKey) return null;
    return monthCache[monthKey]?.scheduleOverlay || null;
  }, [monthKey, monthCache]);

  // Unified drill-active days for the DayDetail lookup + day nav. Works
  // from either scope; whichever memo is populated wins. Exactly one of
  // periodDays/monthDays is non-null at a time (period/month are
  // mutually exclusive scopes).
  const activeDrillDays = periodDays || monthDays || null;

  // Drill-in exception queue (overdue + needs-entry, in date order).
  // Backs the strip's clickable chips AND the DayDetail post-save
  // iterator ("Next needing entry"). Overdue days are older by
  // definition, so simple date-sort naturally yields overdue-then-needs.
  const drillExceptions = useMemo(() => {
    if (!activeDrillDays?.length) return [];
    return activeDrillDays
      .filter(d => d.status === "overdue" || d.status === "needs-entry")
      .map(d => d.date);
  }, [activeDrillDays]);

  // Chip jumps: open DayDetail at the OLDEST unentered day of that
  // status inside the current drill. Deliberately drill-scoped
  // (activeDrillDays), NOT the year-scoped handleJumpToNeeds/Overdue
  // above - those would jump out of the current period/month.
  const handleJumpFirstOverdueInDrill = useCallback(() => {
    const first = activeDrillDays?.find(d => d.status === "overdue");
    if (first) setFocusDay(first.date);
  }, [activeDrillDays]);
  const handleJumpFirstNeedsInDrill = useCallback(() => {
    const first = activeDrillDays?.find(d => d.status === "needs-entry");
    if (first) setFocusDay(first.date);
  }, [activeDrillDays]);

  // Iterator handler for DayDetail's post-save Next-needing-entry
  // button. Finds the next exception STRICTLY AFTER the current
  // focusDay, so the just-saved day (whose status hasn't refetched yet)
  // is naturally skipped. Returns null when the queue is empty -
  // DayDetail renders the all-caught-up close in that case.
  const onNextExceptionHandler = useMemo(() => {
    if (!focusDay) return null;
    const nextDate = drillExceptions.find(d => d > focusDay);
    if (!nextDate) return null;
    return () => setFocusDay(nextDate);
  }, [focusDay, drillExceptions]);

  // PR-B2b idle-prefetch. After the current period renders, fetch the
  // calendar months for the PREV and NEXT periods on idle so the
  // prev/next period buttons feel instant. Best-effort + silent: a
  // prefetch failure does NOT surface the partial banner or any
  // error - that's only for the ACTIVE period's fetch.
  //
  // Early-return when no neighbor months are missing prevents the
  // effect from looping after the prefetch lands (monthCache is in
  // deps and changes when the prefetch updates it, but on the next
  // run `needed` is empty and the effect exits).
  useEffect(() => {
    if (lens !== "period" || !selectedAccount || !periodKey || !periodRanges?.length) return;
    const idx = periodRanges.findIndex(r => r.period === periodKey);
    if (idx === -1) return;
    const neighbors = [
      idx > 0 ? periodRanges[idx - 1] : null,
      idx < periodRanges.length - 1 ? periodRanges[idx + 1] : null,
    ].filter(Boolean);
    const needed = [];
    for (const n of neighbors) {
      for (const mk of monthsBetween(n.start, n.end)) {
        if (!monthCache[mk] && !needed.includes(mk)) needed.push(mk);
      }
    }
    if (needed.length === 0) return;
    const controller = new AbortController();
    const schedule = typeof window !== "undefined" && window.requestIdleCallback
      ? window.requestIdleCallback
      : (cb) => setTimeout(cb, 250);
    const cancel = typeof window !== "undefined" && window.cancelIdleCallback
      ? window.cancelIdleCallback
      : clearTimeout;
    const idleId = schedule(() => {
      if (controller.signal.aborted) return;
      Promise.allSettled(needed.map(mk =>
        fetch(`/api/service-calendar?action=sc-load&account=${selectedAccount}&month=${mk}&clientToday=${encodeURIComponent(today)}`, { signal: controller.signal })
          .then(r => r.json())
          .then(d => (d && d.success) ? { mk, payload: d } : null)
          .catch(() => null)
      )).then(results => {
        if (controller.signal.aborted) return;
        const ok = results
          .filter(r => r.status === "fulfilled" && r.value)
          .map(r => r.value);
        if (ok.length === 0) return;
        setMonthCache(prev => {
          const next = { ...prev };
          for (const { mk, payload } of ok) {
            if (!next[mk]) next[mk] = payload;
          }
          return next;
        });
      }).catch(() => { /* silent: prefetch failures are best-effort */ });
    });
    return () => {
      try { cancel(idleId); } catch { /* ignore */ }
      controller.abort();
    };
  }, [lens, selectedAccount, periodKey, periodRanges, monthCache, reloadKey, today]);

  // Account-level mode classification (consumed by SeasonShell and
  // PeriodWorkspace via props). Three display modes per spec section 6
  // (the two-axis polymorphism: operational shape x financial frame):
  //   1. hasHomestandSchedule              -> homestand-fee (MLB fee)
  //   2. !hasHomestandSchedule && isFeeAccount -> operational-only (STL-FL)
  //   3. !isFeeAccount                     -> per-meal (everyone else)
  // MiLB is hybrid: per-meal financially + schedule rhythm operationally.
  // (isFeeAccount hoisted upstream to feed the Phase 6 cutover hook -
  // one source for the fee-branch signal across the component.)
  //
  // G6 + F1 (2026-07-19): the gate READS FROM the account-level flag.
  // G6 used `data.account.hasHomestandSchedule` but F1 caught that on
  // year-overview scope the client seed can be sc-year-summary alone -
  // whose payload is `{ success, accountKey, today, periodRanges,
  // months }` with NO account object. sc-load populates `data.account`
  // only after its own fetch resolves, so the stepper gate raced with
  // the mount and often computed undefined even for MLB fee (CIN-OH
  // works when sc-load has been visited; MiLB AAA reliably failed).
  // Fix: derive from the SELECTED account's record in the accounts
  // list ServiceCalendar already holds - `sc-accounts` (route.js:149)
  // ships hasHomestandSchedule for every row. Zero API change; client-
  // side only. Downstream self-guard unchanged: SeasonStepper's
  // deriveHomestandSegments returns [] and the component returns null
  // if yearData carries no homestandId - so the render still gates on
  // actual data. Item 18 carve-out guards still satisfied.
  const selectedAccountRecord = accounts.find(a => a.key === selectedAccount) || null;
  const hasHomestandSchedule = !!selectedAccountRecord?.hasHomestandSchedule;
  const homestandMap = data?.homestandMap || {};
  // sc-17 (2026-07-11): the current-month scheduleOverlay from the
  // sc-load payload. Non-flagged accounts NEVER see a scheduleOverlay
  // key in the response (api/route.js gates on has_schedule_overlay),
  // so this stays null for every account except STL - FL. Feeds the
  // period + month rollups above via monthCache.
  const scheduleOverlay = data?.scheduleOverlay || null;
  const isMilb = data?.account?.category === "MiLB";

  // sc-19 (2026-07-12): client-side derivation of the account's phase
  // timeline + Spring Training date set. phaseCalendar.js is the source
  // of truth (Kevin's ruling: NOT the API). Non-PDC accounts get an
  // empty Set; PDC accounts without recorded phase data (none today -
  // all 5 PDCs have blocks) would also get an empty Set. Threaded to
  // SeasonShell + PeriodWorkspace for the sm corner wedge, the lg "ST"
  // pill, and the chrome bar rider.
  const phaseTimeline = useMemo(
    () => derivePhaseTimeline(data?.account?.key, data?.account?.category, year),
    [data?.account?.key, data?.account?.category, year]
  );
  const springDateSet = useMemo(
    () => collectSpringDates(phaseTimeline),
    [phaseTimeline]
  );

  // Momentum toast helpers - the four submission successes below emit a
  // rich <SubmissionToast /> payload via showToast({ variant:"recorded",
  // ... }). SC-051: the toast's amount + meals come from the server's
  // response (savedRevenue + savedMeals, read from sc_daily_revenue AFTER
  // the write with effective-dated prices), NOT a client recompute
  // against the current catalog. Bulk paths sum per-day response values
  // in their loop. buildRecordedToast wraps the sum with period-progress
  // context (daysEntered = current complete count + the newly-entered
  // adjustment; scopeWord from the active drill scope). Errors still
  // route through the plain oh-toast path.
  //
  // SC-055: mount-ref guard so a mid-flight modal/page close doesn't
  // fire setToast on an unmounted parent. Each save handler bails out
  // of the post-fetch work if isMountedRef.current is false. The
  // double-click guard (disabled={saving}) stays unchanged.
  //
  // C1b (F4): plus a Set of live AbortControllers so unmount aborts
  // any fetch that is still on the wire. Day-nav within the DayDetail
  // modal does NOT abort - a save in flight for day A must complete
  // even if the operator pages to day B; the server write is the
  // point. Only page unmount triggers the abort loop below.
  const isMountedRef = useRef(true);
  const inFlightControllersRef = useRef(new Set());
  // B2/B8a interaction fix (2026-07-24): rail queue clicks from the
  // OVERVIEW cross into a period drill by changing `periodKey`, which
  // then triggers the view-context reset effect from #503 (deps
  // `[selectedAccount, mk, monthKey, periodKey]`), which calls
  // setFocusDay(null), which closes the modal B2 just opened. Only
  // the two OVERVIEW handlers (overviewTargetDay, feeTargetDay)
  // straddle this boundary; drill-scope targetDay handlers stay
  // within the same periodKey/monthKey and don't fire the reset.
  //
  // Option (a): those two handlers set this ref before/alongside
  // setFocusDay. The reset effect below reads the ref, and if set,
  // preserves focusDay and clears the ref in the same pass.
  //
  // Cleared exactly once: the reset effect ALWAYS clears the ref at
  // its top on every fire. This means the ref cannot outlive one
  // reset-effect cycle. Since the two handlers cause deterministic
  // periodKey transitions (null -> N), the effect fires reliably.
  // If a future refactor breaks that guarantee, worst case is the
  // NEXT nav skips its focusDay reset once - not catastrophic, no
  // silent data loss.
  //
  // Bulk state (setBulkMode/setBulkSelected/setBulkPanelOpen) is
  // NOT suppressed by this ref: the operator is opening a single
  // day's modal; clearing bulk selection on a view change is still
  // correct.
  const pendingRailFocusRef = useRef(null);
  // B8b fix (2026-07-23): the mount body was missing - previously this
  // was a cleanup-only effect. `useRef(true)` initialized `.current`
  // once; StrictMode's dev double-mount (mount -> cleanup -> mount)
  // ran the cleanup body between them, setting `.current = false`,
  // and nothing re-armed it on the second mount. Result: for the
  // entire life of the page in dev, isMountedRef.current stayed
  // false. Every `isMountedRef.current` guard in this file (13 call
  // sites) silently short-circuited, including handleSave's toast +
  // monthCache delete + reloadKey bump at :1490 - which is why the
  // drill never refreshed after a save. Adding the mount body
  // re-arms the flag on every mount. Prod builds are unaffected
  // (StrictMode double-invoke is dev-only per React docs), but the
  // guard shape was wrong either way. See docs/GOTCHAS.md.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      for (const c of inFlightControllersRef.current) {
        try { c.abort(); } catch { /* ignore */ }
      }
      inFlightControllersRef.current.clear();
    };
  }, []);

  // F3: retry driver. One useEffect owns the timer map, the online +
  // storage listeners, and the beforeunload guard. Rebound whenever the
  // driver needs stale-free closures - syncingKeys is a proxy for
  // "queue changed"; refreshSyncing captures the setState function.
  // (State declarations for syncingKeys / refreshSyncing / kickReplay /
  // scheduleReplayRef live in the main state section - hoisted 2026-07-10
  // fix/sc-f3-tdz-hook-order to keep declaration < first-use for the
  // syncingDates memo at ~:695.)
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Mount-time refresh so state agrees with the localStorage truth
    // before the first render paints stale.
    refreshSyncing();

    const timers = new Map(); // key -> timeoutId
    let cancelled = false;

    const tryReplay = async (key) => {
      if (cancelled) return;
      const entry = scGetEntry(key);
      if (!entry) return;
      if (!scAcquireLock(key)) return; // another tab is on it
      try {
        const res = await fetch("/api/service-calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "sc-submit-day",
            accountKey: entry.accountKey,
            date: entry.date,
            entries: entry.entries,
            auditNote: entry.auditNote || undefined,
            // P2 item 2: replay carries the operator's ride note along
            // with the actuals write. If the post-save note append
            // fails on replay, the server surfaces noteFailed:true;
            // the queue treats the save itself as successful (dequeue)
            // because the actuals landed - the note is a follow-up.
            rideNote: entry.rideNote || undefined,
          }),
        });
        // Server responded. Distinguish success vs known-bad payload:
        //   success       -> dequeue + monthCache invalidate + refresh
        //   non-success   -> dequeue + one visible toast (this is a
        //                    data-loss event; the badge alone would be
        //                    a silent drop). Kevin's N1 no-page-indicator
        //                    rule applies to the normal queued-in-flight
        //                    state; a REJECTED replay is exceptional.
        let json = null;
        try { json = await res.json(); } catch { /* fallthrough */ }
        if (res.ok && json?.success) {
          // P2 (item 2 amend, 2026-07-10): actuals landed - dequeue
          // as-is (requeueing would double-save on the next replay).
          // The note is a separate concern: if the post-save append
          // failed on replay, mirror the foreground path's honest
          // partial toast. Foreground already handles noteFailed in
          // handleSave's success branch; the queue driver replaying
          // under network recovery cleared the draft at queued-close
          // (see executeSave setNotes("")), so a silent dequeue here
          // would eat the failure with no path back to the operator.
          // SC-079 class: a note failing after successful actuals
          // must never be silent.
          scDequeue(key);
          if (isMountedRef.current) {
            refreshSyncing();
            if (json.noteFailed) {
              showToast(`Saved ${entry.date} - its note couldn't post, re-add it from the day`, "error");
            }
            const mk = entry.date.slice(0, 7);
            setMonthCache(prev => {
              if (!(mk in prev)) return prev;
              const next = { ...prev }; delete next[mk]; return next;
            });
            setReloadKey(k => k + 1);
          }
        } else {
          scDequeue(key);
          if (isMountedRef.current) {
            refreshSyncing();
            showToast(`A queued save for ${entry.date} was rejected on retry`, "error");
          }
        }
      } catch (err) {
        // Network-class replay failure - bump attempts and reschedule
        // with the next backoff step. AbortError should not happen here
        // (no controller passed) but keep the guard for symmetry.
        if (err?.name === "AbortError") { scReleaseLock(key); return; }
        scBumpAttempts(key);
        scReleaseLock(key);
        const bumped = scGetEntry(key);
        if (bumped && isMountedRef.current) {
          scheduleNext(bumped);
        }
      } finally {
        // Success path already dequeued; failure path released above.
        // Belt-and-suspenders release for any other exit.
        const still = scGetEntry(key);
        if (still?.lockedAt) scReleaseLock(key);
      }
    };

    const scheduleNext = (entry) => {
      const key = scQueueKey(entry.accountKey, entry.date);
      const delay = scNextDelayMs(entry.attempts || 0);
      if (timers.has(key)) clearTimeout(timers.get(key));
      const id = setTimeout(() => tryReplay(key), delay);
      timers.set(key, id);
    };

    // Kick every queued entry on driver mount - covers page reload with
    // items still in the queue AND the second-tab-opens case.
    for (const entry of scGetAll()) scheduleNext(entry);

    const onOnline = () => {
      // Immediate attempts on network return. Clear existing timers so
      // we do not double-fire when the backoff timeout also lands.
      for (const [k, id] of timers) { clearTimeout(id); timers.delete(k); }
      for (const entry of scGetAll()) tryReplay(scQueueKey(entry.accountKey, entry.date));
    };

    const onStorage = (e) => {
      if (e.key !== "kf_sc_save_queue_v1") return;
      // Sibling tab wrote the queue. Refresh local state so the badge
      // reflects the sibling's enqueue/dequeue AND schedule replays for
      // any entries the sibling added (the driver only auto-schedules
      // its own kicks + the mount pass; sibling-added entries would
      // otherwise wait for the next online event or refresh).
      if (isMountedRef.current) refreshSyncing();
      for (const entry of scGetAll()) {
        const key = scQueueKey(entry.accountKey, entry.date);
        if (!timers.has(key)) scheduleNext(entry);
      }
    };

    const onBeforeUnload = (e) => {
      const anyQueued = scGetAll().length > 0;
      // A4 fix (2026-07-24): also prompt when a save is genuinely
      // in flight (fetch on the wire). Prior behavior: closing the
      // tab mid-save let the server write complete silently while
      // the client never knew - operator could re-enter the same
      // day with different values, LWW clobbering the first write.
      // Extending the existing beforeunload guard is the cheapest
      // and most honest fix; full durable-state reconciliation
      // (localStorage + mount-time replay for in-flight saves) is
      // scoped separately in the PR body.
      const anyInFlight = inFlightControllersRef.current.size > 0;
      if (!anyQueued && !anyInFlight) return;
      // Browser shows its native "leave / stay" prompt; the specific
      // message string is ignored on modern browsers but the returnValue
      // is what triggers the dialog.
      e.preventDefault();
      const msg = anyInFlight ? "A save is still in flight." : "A save is still syncing.";
      e.returnValue = msg;
      return msg;
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("storage", onStorage);
    window.addEventListener("beforeunload", onBeforeUnload);

    // Expose scheduleNext so handleSave's post-enqueue kick fires a
    // fresh retry timer without waiting on this effect to rebind.
    // Assignment must sit BEFORE the return cleanup - the previous
    // version put it after and it was silently dead code, so the
    // classic "network fails while navigator.onLine stays true"
    // (server unreachable / DNS / captive-portal-style dead route)
    // never retried until the tab reloaded.
    scheduleReplayRef.current = (key) => {
      const entry = scGetEntry(key);
      if (entry) scheduleNext(entry);
    };

    return () => {
      cancelled = true;
      for (const id of timers.values()) clearTimeout(id);
      timers.clear();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("beforeunload", onBeforeUnload);
      scheduleReplayRef.current = null;
    };
    // Run-once by design. The scheduler ref covers same-tab enqueues;
    // the storage listener covers sibling-tab enqueues; the online
    // listener covers network return. Closures over showToast +
    // setMonthCache + setReloadKey are stable (useState setters + a
    // callback with a stable identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildRecordedToast = useCallback((opts) => {
    const { amount = 0, meals = 0, newlyEntered = 0, isBulk = false, bulkDays = 0, noService = false } = opts;
    // Step-0 (SC-066): mirror aggregateWorkspaceMetrics's widened
     // "complete" predicate so the toast progress bar agrees with the
    // header the operator just read.
    const currentComplete = activeDrillDays
      ? activeDrillDays.filter(d => d.hasActuals || d.status === "no-service").length
      : null;
    const totalDays = activeDrillDays?.length ?? null;
    const scopeWord = isPeriodView ? "period" : isMonthView ? "month" : "period";
    return {
      variant: "recorded",
      amount,
      meals,
      daysEntered: currentComplete != null ? currentComplete + newlyEntered : null,
      totalDays,
      scopeWord,
      isBulk,
      bulkDays,
      isFeeAccount,
      // SC-066: SubmissionToast reads this to override the headline to
      // "No service recorded" and drop the money line (which would be
      // $0 - visually confusing on a per-meal day).
      noService,
    };
  }, [activeDrillDays, isPeriodView, isMonthView, isFeeAccount]);

  // P0-2: returns the API result ({ success, error? }) so DayDetail's
  // executeSave can gate the success screen on a confirmed write. Empty
  // entries are guarded upstream (DayDetail won't even call onSave).
  //
  // SC-079: dayNotes retired from the save path. Regular saves just
  // send { entries }; mark-no-service passes opts.auditNote so the
  // server posts a ledger entry alongside the actuals write. Author
  // is derived server-side from the session in both cases.
  // SC-051: toast reads amount/meals from response (savedRevenue,
  // savedMeals), not a client recompute.
  const handleSave = useCallback(async (day, entries, opts = {}) => {
    if (!data?.account) return { success: false, error: "No account loaded" };
    setSaving(true);
    // C1b (F4): AbortController joins the tracked set so page unmount
    // aborts in flight. Removed on completion in finally.
    const controller = new AbortController();
    inFlightControllersRef.current.add(controller);
    try {
      // spreadsheetId + sheetRow were leftover from the Sheets-era route;
      // the PG route ignores them. Dropped to keep the payload honest.
      const res = await fetch("/api/service-calendar", { method: "POST", headers: { "Content-Type": "application/json" },
        // P2 item 2: rideNote flows through to the server, which
        // appends it via addDayNoteEntry AFTER the actuals save
        // succeeds. Server author-derives from the session.
        body: JSON.stringify({ action: "sc-submit-day", accountKey: data.account.key, date: day.date, entries, auditNote: opts.auditNote, rideNote: opts.rideNote }),
        signal: controller.signal });
      const result = await res.json();
      if (!isMountedRef.current) return result;
      if (result.success) {
        const newlyEntered = day.hasActuals ? 0 : 1;
        // P2 item 2 + A3 amend (2026-07-24): partial-success cases.
        // Save landed but a note append failed post-save. Both flags
        // surface honestly:
        //   noteFailed       - rideNote (operator-authored) failed
        //   auditNoteFailed  - no-service audit note failed
        // Different literal messages; same partial-success shape.
        if (result.noteFailed) {
          showToast("Saved - note couldn't post, use Add note", "error");
        } else if (result.auditNoteFailed) {
          showToast("Saved - no-service note couldn't post", "error");
        } else {
          // PR-B kept toast fix (2026-07-22): guard amount/meals on
          // Number.isFinite. If server response omits either total
          // (queued replay or future server variant), pass null so
          // SubmissionToast's Number.isFinite gate at :33 hides the
          // money line instead of printing a fabricated "$0". Prior
          // `Number(x) || 0` would coerce absent to 0 -> "$0".
          const rawSavedRevenue = Number(result.savedRevenue);
          const rawSavedMeals   = Number(result.savedMeals);
          const hasFiniteTotals = Number.isFinite(rawSavedRevenue) && Number.isFinite(rawSavedMeals);
          showToast(buildRecordedToast({
            amount: hasFiniteTotals ? rawSavedRevenue : null,
            meals:  hasFiniteTotals ? rawSavedMeals   : null,
            newlyEntered,
            // SC-066: mark-no-service flag flows through so the toast
            // reads "No service recorded" instead of "0 meals / $0".
            noService: !!opts.noService,
          }));
        }
        // Surgical monthCache invalidation: drop only the month we wrote
        // to so the drill-in refetches just that month, not the whole
        // cache (see the note above the dayMap memo).
        // PR-B (2026-07-22): the delete + reloadKey shape is main's
        // proven behavior - slow (skeleton flash + refetch) but correct
        // across every surface. Fix 2 (optimistic patch) was attempted
        // here twice and reverted after failing the gate both times.
        // See PR #493 body for Phase 1 hand-off notes (period +
        // month-drill loader guards; the rail-vs-tile split-refresh
        // anomaly; the setFocusDay-null-on-reloadKey close-the-modal
        // interaction). The correct fix belongs to Phase 1 where the
        // cache/render architecture is in scope.
        const mk = day.date.slice(0, 7);
        // #418 (2026-07-12): if a rideNote was appended successfully,
        // patch yearData[m].days[i].hasNoteEntries=true BEFORE the
        // monthCache invalidation so the sm-tile bubble reflects the
        // note immediately (yearData survives monthCache refetch and
        // is refreshed by the reloadKey bump below). The note TEXT
        // itself arrives in DayDetail via the paired refetch of the
        // invalidated month - typically 100-300ms, and DayDetail's
        // own local `noteEntries` state (seeded from day.noteEntries
        // via handleAddNote's ride-through pattern) already shows the
        // draft in the open composer. Choice: sc-submit-day does NOT
        // return the appended entry (Kevin's guardrail: no server
        // note-path changes), so we can't do the direct entry patch
        // used in handleAddNote. Chose "trigger the minimal targeted
        // refetch of that day" (via the existing month invalidation)
        // over client-fabrication of the entry to preserve server-
        // derived author/timestamp truth.
        const rideNoteAppended = !!(opts.rideNote && (opts.rideNote || "").trim().length > 0 && !result.noteFailed);
        if (rideNoteAppended) {
          setYearData(prev => {
            if (!prev) return prev;
            let touched = false;
            const next = prev.map(m => {
              if (!m.days) return m;
              const patched = m.days.map(d => {
                if (d.date !== day.date) return d;
                touched = true;
                return { ...d, hasNoteEntries: true };
              });
              return touched ? { ...m, days: patched } : m;
            });
            return touched ? next : prev;
          });
        }
        setMonthCache(prev => {
          if (!(mk in prev)) return prev;
          const next = { ...prev }; delete next[mk]; return next;
        });
        setReloadKey(k => k + 1);
        return result;
      }
      // A3 failure-UI amend (2026-07-24): caller can suppress the
      // floating toast when it renders the failure inline in its own
      // panel (per §8B "failure is the absence of the handoff"). v2
      // DayEntryV2 passes silentFailure:true; v1 DayDetail leaves it
      // absent to preserve existing failure behavior.
      if (!opts.silentFailure) {
        showToast(result.error || "Save failed", "error");
      }
      return result;
    } catch (err) {
      // C1b (F4): user navigated away mid-save; mount-ref already
      // suppresses state writes, no toast needed.
      if (err?.name === "AbortError") return { success: false, error: "aborted" };
      // F3: NETWORK-CLASS failure -> queue for replay. Server 4xx/5xx
      // with a valid JSON body never lands in this catch (that's the
      // `if (!result.success)` branch above), so anything here is a
      // fetch-level rejection - offline / DNS / TLS / reset. The N1
      // ruling: no toast, no page-level indicator, just the tile badge.
      if (scIsNetworkError(err)) {
        // P2 item 2: rideNote joins the queue payload alongside
        // auditNote so a queued replay carries the operator's note
        // through and DayDetail can clean-close instead of routing
        // through the discard-confirm-on-queued-close carve-out.
        scEnqueue({ accountKey: data.account.key, date: day.date, entries, auditNote: opts.auditNote, rideNote: opts.rideNote });
        if (isMountedRef.current) {
          refreshSyncing();
          kickReplay(scQueueKey(data.account.key, day.date));
        }
        return { success: true, queued: true };
      }
      if (!isMountedRef.current) return { success: false, error: "Network error" };
      showToast("Network error", "error");
      return { success: false, error: "Network error" };
    } finally {
      inFlightControllersRef.current.delete(controller);
      if (isMountedRef.current) setSaving(false);
    }
  }, [data, showToast, buildRecordedToast, refreshSyncing, kickReplay]);

  // SC-079: POST one authored note entry to sc-add-note. DayDetail
  // owns the draft + local ledger; this just moves it over the wire.
  // Server derives author from the session - never accepts a client
  // value. Returns { success, entry } so the child can prepend
  // optimistically. Errors surface a plain oh-toast.
  //
  // #418 (2026-07-12): before this fix, standalone Add note posts
  // succeeded server-side and DayDetail's local ledger prepended the
  // server-returned entry (see DayDetail.js:422), but neither
  // `monthCache[mk].days[i].noteEntries` (the drill-in day record) nor
  // `yearData[m].days[i].hasNoteEntries` (the sm-tile bubble source)
  // were patched. On close/reopen, DayDetail re-mounted with `day` from
  // the stale monthCache and the note was gone until hard refresh.
  // Fix: on success, patch both caches with the server-returned entry
  // so reopen reads the fresh state without a refetch. Mirror of the
  // savedRevenue/savedMeals response-echo pattern in handleSave.
  const handleAddNote = useCallback(async (day, note) => {
    if (!data?.account) return { success: false, error: "No account loaded" };
    // C1b (F4): AbortController joins the tracked set (see handleSave).
    const controller = new AbortController();
    inFlightControllersRef.current.add(controller);
    try {
      const res = await fetch("/api/service-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sc-add-note", account: data.account.key, date: day.date, note }),
        signal: controller.signal,
      });
      const result = await res.json();
      if (!isMountedRef.current) return result;
      if (result.success && result.entry) {
        // #418: patch the drill-in day record. Prepends the server-
        // returned entry (author + timestamp server-derived) and flips
        // hasNoteEntries to true so DayDetail reopen and sm-tile bubble
        // both reflect reality immediately.
        const mk = day.date.slice(0, 7);
        setMonthCache(prev => {
          const monthEntry = prev[mk];
          if (!monthEntry?.days) return prev;
          const patchedDays = monthEntry.days.map(d => {
            if (d.date !== day.date) return d;
            return {
              ...d,
              noteEntries:    [result.entry, ...(d.noteEntries || [])],
              hasNoteEntries: true,
            };
          });
          return { ...prev, [mk]: { ...monthEntry, days: patchedDays } };
        });
        // #418: patch the year-summary hasNoteEntries so the sm-tile
        // bubble appears on the overview grid without a refetch. Full
        // note text lives only in monthCache; year-summary carries a
        // boolean per the P2-item-3 compact-payload rule (see
        // dataStore/serviceCalendar.js:1160-1164).
        setYearData(prev => {
          if (!prev) return prev;
          let touched = false;
          const next = prev.map(m => {
            if (!m.days) return m;
            const patched = m.days.map(d => {
              if (d.date !== day.date) return d;
              touched = true;
              return { ...d, hasNoteEntries: true };
            });
            return touched ? { ...m, days: patched } : m;
          });
          return touched ? next : prev;
        });
      }
      if (!result.success) {
        showToast(result.error || "Failed to add note", "error");
      }
      return result;
    } catch (err) {
      // C1b (F4): silent on abort (unmount-triggered only).
      if (err?.name === "AbortError") return { success: false, error: "aborted" };
      if (isMountedRef.current) showToast("Network error", "error");
      return { success: false, error: "Network error" };
    } finally {
      inFlightControllersRef.current.delete(controller);
    }
  }, [data, showToast]);

  // ── Bulk save: writes same values to all selected days ──
  const handleBulkSave = useCallback(async () => {
    if (!data?.account || !data?.serviceGroups || bulkSelected.size === 0) return;
    // P0-1: only include services where the chef actually typed a value.
    // An untouched bulk input means "leave this service alone for each day"
    // - we must NOT write 0 to it (would zero out existing actuals).
    const entries = [];
    for (const g of data.serviceGroups) {
      for (const s of g.services) {
        const val = bulkValues[s.colIndex];
        if (val !== undefined && val !== "") {
          entries.push({ colIndex: s.colIndex, value: Number(val) });
        }
      }
    }
    if (entries.length === 0) {
      showToast("Enter at least one value before bulk saving", "error");
      return;
    }
    setSaving(true);
    // PR-B Fix 1 (2026-07-22): swap the client for-loop of per-day
    // sc-submit-day POSTs for a single sc-bulk-submit call. Was 30
    // sequential round-trips at ~1s each on a 30-day bulk; now one.
    // sc-bulk-submit is server-atomic (single .upsert() with N rows
    // per serviceCalendar.js:1727-1753) - all-or-nothing per owner
    // decision #4. No per-day retry / partial-commit fallback.
    // Payload shape: entries carry per-day date (not top-level).
    // rideNote/auditNote are not accepted here (see route.js:716-721);
    // the two client loops didn't send them anyway.
    const days = [];
    const perDayEntries = [];
    for (const dk of bulkSelected) {
      const day = activeDrillDays?.find(d => d.date === dk) || dayMap[dk];
      if (!day) continue;
      days.push(day);
      for (const e of entries) {
        perDayEntries.push({ colIndex: e.colIndex, date: day.date, value: e.value });
      }
    }
    if (days.length === 0 || perDayEntries.length === 0) {
      setSaving(false);
      return;
    }
    const controller = new AbortController();
    inFlightControllersRef.current.add(controller);
    let successCount = 0;
    let newlyEntered = 0;
    let queuedCount = 0;
    try {
      const res = await fetch("/api/service-calendar", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sc-bulk-submit", accountKey: data.account.key, entries: perDayEntries }),
        signal: controller.signal });
      const result = await res.json();
      if (result.success) {
        successCount = days.length;
        for (const day of days) if (!day.hasActuals) newlyEntered++;
      } else {
        // A3 failure-UI (2026-07-24): server returns serviceDate for
        // validation failures on the bulk path (route.js sc-bulk-submit
        // catch). Name the offending day inline so the operator knows
        // WHICH day to fix - per §8B all-or-nothing message. Nothing
        // committed (bulk is server-atomic).
        const bulkErr = result.error || "Bulk save failed";
        const dayHint = result.serviceDate ? `on ${result.serviceDate} - ` : "";
        showToast(`Bulk rejected: ${dayHint}${bulkErr}. Nothing committed.`, "error");
      }
    } catch (err) {
      if (err?.name !== "AbortError") {
        if (scIsNetworkError(err)) {
          // saveQueue can't represent a batch under its (accountKey,
          // date) key shape (saveQueue.js:3-8). Fall back to N per-day
          // enqueues so offline resilience is preserved - the batch
          // never touched the server, so there's no partial commit to
          // worry about. Replay is per-day via sc-submit-day, matching
          // the queue's existing semantic.
          for (const day of days) {
            scEnqueue({ accountKey: data.account.key, date: day.date, entries });
            queuedCount++;
          }
        } else {
          showToast("Bulk save failed", "error");
        }
      }
    } finally { inFlightControllersRef.current.delete(controller); }
    if (!isMountedRef.current) return;
    setSaving(false);
    if (queuedCount > 0) refreshSyncing();
    if (successCount > 0) {
      // PR-B kept toast fix (2026-07-22): amount/meals null (not 0)
      // so SubmissionToast's Number.isFinite gate hides the money
      // line - sc-bulk-submit returns no per-day totals and printing
      // "$0" for a successful bulk save would be a lie. Days-count
      // progress meta still renders.
      showToast(buildRecordedToast({ amount: null, meals: null, newlyEntered, isBulk: true, bulkDays: successCount }));
    }
    // Surgical monthCache invalidation: drop the affected months so
    // the drill-in refetches them. main's proven pattern - slow
    // (skeleton flash + refetch) but correct. Fix 2 (optimistic patch)
    // deferred to Phase 1.
    const affected = new Set();
    for (const day of days) affected.add(day.date.slice(0, 7));
    if (affected.size > 0) {
      setMonthCache(prev => {
        let changed = false;
        const next = { ...prev };
        for (const mk of affected) if (mk in next) { delete next[mk]; changed = true; }
        return changed ? next : prev;
      });
    }
    setBulkMode(false); setBulkSelected(new Set()); setBulkPanelOpen(false);
    setReloadKey(k => k + 1);
  }, [data, dayMap, activeDrillDays, bulkSelected, bulkValues, showToast, buildRecordedToast, refreshSyncing]);

  // Bulk confirm as projected for all selected.
  // PR-B Fix 1 (2026-07-22): mirror handleBulkSave's sc-bulk-submit
  // swap - one batch call, atomic all-or-nothing, saveQueue falls back
  // to per-day enqueue on network failure. Difference from bulkSave:
  // each day carries its OWN projected values, so perDayEntries is
  // built per-day inside the flatten loop.
  const handleBulkConfirm = useCallback(async () => {
    if (!data?.account || !data?.serviceGroups || bulkSelected.size === 0) return;
    setSaving(true);
    const days = [];
    const perDayEntries = [];
    for (const dk of bulkSelected) {
      const day = activeDrillDays?.find(d => d.date === dk) || dayMap[dk];
      if (!day) continue;
      days.push(day);
      for (const g of data.serviceGroups) {
        for (const s of g.services) {
          perDayEntries.push({ colIndex: s.colIndex, date: day.date, value: day.projected[s.colIndex] ?? 0 });
        }
      }
    }
    if (days.length === 0 || perDayEntries.length === 0) {
      setSaving(false);
      return;
    }
    const controller = new AbortController();
    inFlightControllersRef.current.add(controller);
    let successCount = 0;
    let newlyEntered = 0;
    let queuedCount = 0;
    try {
      const res = await fetch("/api/service-calendar", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sc-bulk-submit", accountKey: data.account.key, entries: perDayEntries }),
        signal: controller.signal });
      const result = await res.json();
      if (result.success) {
        successCount = days.length;
        for (const day of days) if (!day.hasActuals) newlyEntered++;
      } else {
        // A3 failure-UI (2026-07-24): mirror handleBulkSave's enhanced
        // error message. Confirm-as-projected uses the same bulk
        // endpoint, so serviceDate can flow through the same way.
        const bulkErr = result.error || "Confirm as projected failed";
        const dayHint = result.serviceDate ? `on ${result.serviceDate} - ` : "";
        showToast(`Bulk rejected: ${dayHint}${bulkErr}. Nothing committed.`, "error");
      }
    } catch (err) {
      if (err?.name !== "AbortError") {
        if (scIsNetworkError(err)) {
          // Same per-day enqueue fallback as handleBulkSave. Each day's
          // slice of projected values enqueues under (accountKey, date).
          for (const day of days) {
            const dayEntries = [];
            for (const g of data.serviceGroups) {
              for (const s of g.services) {
                dayEntries.push({ colIndex: s.colIndex, value: day.projected[s.colIndex] ?? 0 });
              }
            }
            scEnqueue({ accountKey: data.account.key, date: day.date, entries: dayEntries });
            queuedCount++;
          }
        } else {
          showToast("Confirm as projected failed", "error");
        }
      }
    } finally { inFlightControllersRef.current.delete(controller); }
    if (!isMountedRef.current) return;
    setSaving(false);
    if (queuedCount > 0) refreshSyncing();
    if (successCount > 0) {
      // Same rationale as handleBulkSave: null amount/meals skips the
      // money line rather than fabricating "$0".
      showToast(buildRecordedToast({ amount: null, meals: null, newlyEntered, isBulk: true, bulkDays: successCount }));
    }
    // Surgical monthCache invalidation: same main-shape pattern as
    // handleBulkSave.
    const affected = new Set();
    for (const day of days) affected.add(day.date.slice(0, 7));
    if (affected.size > 0) {
      setMonthCache(prev => {
        let changed = false;
        const next = { ...prev };
        for (const mk of affected) if (mk in next) { delete next[mk]; changed = true; }
        return changed ? next : prev;
      });
    }
    setBulkMode(false); setBulkSelected(new Set()); setBulkPanelOpen(false);
    setReloadKey(k => k + 1);
  }, [data, dayMap, activeDrillDays, bulkSelected, showToast, buildRecordedToast, refreshSyncing]);

  const toggleBulkSelect = useCallback((dk) => {
    setBulkSelected(prev => { const next = new Set(prev); if (next.has(dk)) next.delete(dk); else next.add(dk); return next; });
  }, []);

  // DayDetail focus-day data + nav. After Stage 6 the day-detail overlay
  // only opens from the Period workspace, so periodDays is the canonical
  // day-list. dayMap stays as a fallback for the rare case the focused
  // day isn't yet in periodDays (e.g. mid-fetch race).
  const focusDayData = focusDay
    ? (activeDrillDays?.find(d => d.date === focusDay) || dayMap[focusDay] || null)
    : null;
  const dayList = activeDrillDays
    ? activeDrillDays.map(d => d.date)
    : (data?.days?.map(d => d.date) || []);
  const focusIdx = focusDay ? dayList.indexOf(focusDay) : -1;
  const canPrev = focusIdx > 0; const canNext = focusIdx < dayList.length - 1;
  const navDay = useCallback((dir) => { const ni = focusIdx + dir; if (ni >= 0 && ni < dayList.length) setFocusDay(dayList[ni]); }, [focusIdx, dayList]);

  // Dialog a11y for the two SC overlays. Both share .sc-overlay-card
  // so they follow the same contract: role/aria-modal/aria-labelledby
  // on the card, Escape closes, focus moves in on open, focus returns
  // to the trigger on close, and Tab/Shift+Tab cycle within.
  const dayOverlayCardRef = useRef(null);
  const bulkOverlayCardRef = useRef(null);
  const bulkReviewOverlayCardRef = useRef(null);
  const bulkCustomReviewOverlayCardRef = useRef(null);
  const dayOverlayOpen = Boolean(focusDay && focusDayData && (data?.serviceGroups || periodServiceGroups));
  const bulkOverlayOpen = Boolean(bulkPanelOpen && data?.serviceGroups);
  const bulkReviewOverlayOpen = Boolean(bulkReviewOpen && data?.serviceGroups);
  const bulkCustomReviewOverlayOpen = Boolean(bulkCustomReviewOpen && data?.serviceGroups);
  // SC-063: guarded close for the day overlay - the imperative handle
  // on DayDetail's forwardRef lets it show its own discard-confirm when
  // dirty. requestClose() returns false when the confirm took over.
  const dayDetailRef = useRef(null);
  const handleGuardedDayClose = useCallback(() => {
    const wantsClose = dayDetailRef.current?.requestClose?.();
    // requestClose returns true iff the parent may proceed with the
    // close (pristine or discard-confirmed). false means the confirm
    // dialog is showing; parent MUST NOT close.
    if (wantsClose === false) return;
    setFocusDay(null);
  }, []);
  useDialogA11y({ cardRef: dayOverlayCardRef, isOpen: dayOverlayOpen, onClose: handleGuardedDayClose });
  useDialogA11y({ cardRef: bulkOverlayCardRef, isOpen: bulkOverlayOpen, onClose: () => setBulkPanelOpen(false) });
  useDialogA11y({ cardRef: bulkReviewOverlayCardRef, isOpen: bulkReviewOverlayOpen, onClose: () => setBulkReviewOpen(false) });
  useDialogA11y({ cardRef: bulkCustomReviewOverlayCardRef, isOpen: bulkCustomReviewOverlayOpen, onClose: () => setBulkCustomReviewOpen(false) });

  const acctObj = accounts.find(a => a.key === selectedAccount);
  const category = acctObj?.category || "";

  // Init bulk values from first selected day's projections
  useEffect(() => {
    if (bulkPanelOpen && data?.serviceGroups) {
      const vals = {};
      for (const g of data.serviceGroups) { for (const s of g.services) { vals[s.colIndex] = ""; } }
      setBulkValues(vals);
    }
  }, [bulkPanelOpen, data]);

  // Year-view banner stats. Aggregates across yearData (months[]):
  // per-meal/MiLB get days-recorded + needs/overdue counts + meals YTD;
  // fee accounts get game-days-recorded + meals YTD only (no urgency).
  // Status names match classify() output - we count days[] across all
  // months for the urgency tallies; days[].status === "needs-entry" |
  // "overdue" only appear on per-meal/MiLB classify paths so the same
  // count loop works for both.
  const yearBannerStats = useMemo(() => {
    if (!yearData) return null;
    let daysRecorded = 0, totalDays = 0, needsEntry = 0, overdue = 0, mealsYTD = 0;
    let gameDaysEntered = 0, totalGameDays = 0;
    // Kevin's ruling 2026-07-11: BOTH the numerator (daysRecorded) and
    // denominator (totalDays) count actionable days only. See
    // season/dayPredicates.js for the full spec + supersession of
    // P1 item 4 (which widened the numerator to include no-service).
    // The FullSeasonCard hero (`daysRecorded / totalDays`) now agrees
    // with MonthCard + PeriodCard on the actionable-day math -
    // away / no-service / exhibition / off-season / prep drop out.
    for (const m of yearData) {
      if (m.days) {
        for (const d of m.days) {
          if (d.status === "entered") daysRecorded++;
          if (d.status === "needs-entry") needsEntry++;
          else if (d.status === "overdue") overdue++;
          if (isActionableDay(d)) totalDays++;
        }
      }
      mealsYTD += m.actualCovers || 0;
      if (m.homestandSummary) {
        gameDaysEntered += m.homestandSummary.gameDaysEntered || 0;
        totalGameDays += m.homestandSummary.gameDays || 0;
      }
    }
    const now = new Date();
    const shortMonth = MONTHS[now.getMonth()].slice(0, 3);
    const todayLabel = `${shortMonth} ${now.getDate()}`;
    return { todayLabel, daysRecorded, totalDays, needsEntry, overdue, mealsYTD, gameDaysEntered, totalGameDays };
  }, [yearData]);

  // Two targeted jump goals - the earliest day of each status. Replaces
  // the single jump-to-next now that the chrome surfaces both counts
  // independently (CTA redesign, Direction B). Each resolves its
  // containing period so the click opens the right workspace and
  // focuses the day. Pure memo over yearData + periodRanges; no fetch,
  // no engine touch.
  const jumpTargets = useMemo(() => {
    const attachPeriod = (t) => {
      if (!t) return null;
      if (!periodRanges?.length) return t;
      const range = periodRanges.find(r => t.date >= r.start && t.date <= r.end);
      return { ...t, period: range?.period || null };
    };
    if (!yearData) return { needs: null, overdue: null };
    let needs = null, overdue = null;
    for (const m of yearData) {
      if (!m.days) continue;
      for (const d of m.days) {
        if (d.status === "needs-entry") {
          if (!needs || d.date < needs.date) needs = { date: d.date };
        } else if (d.status === "overdue") {
          if (!overdue || d.date < overdue.date) overdue = { date: d.date };
        }
      }
    }
    return { needs: attachPeriod(needs), overdue: attachPeriod(overdue) };
  }, [yearData, periodRanges]);

  const jumpToDay = useCallback((t) => {
    if (!t) return;
    if (t.period) {
      router.push(buildScUrl({ account: selectedAccount || undefined, period: t.period }), { scroll: false });
    }
    setFocusDay(t.date);
  }, [router, selectedAccount]);
  const handleJumpToNeeds = useCallback(() => jumpToDay(jumpTargets.needs), [jumpToDay, jumpTargets]);
  const handleJumpToOverdue = useCallback(() => jumpToDay(jumpTargets.overdue), [jumpToDay, jumpTargets]);

  // The chrome bar's Calendar | Period toggle controls the Season
  // shell's SUB-view (year-of-months grid vs 4x3-periods grid),
  // matching the legacy CalendarPeriodToggle that used to live inside
  // SeasonShell. It does NOT drive the Season-vs-Workspace switch -
  // that's driven by drilling (month-card or period-card click).
  // We lift the sub-view here so the chrome bar can host the toggle.
  const [seasonView, setSeasonView] = useState("calendar");
  const handleSeasonViewChange = useCallback((next) => {
    setSeasonView(next === "period" ? "period" : "calendar");
  }, []);

  // B8a Fix 1 (2026-07-23): the refresh button was reloadKey-only and
  // never invalidated monthCache - so on a drill view the loader guard
  // (`if (monthCache[monthKey]) return`) passed, the drill loader
  // early-returned, sc-load fired only for the calendar view (writing
  // `data`, not `monthCache`), and the drill tile stayed stale. Now:
  // invalidate the in-view month(s) first (same delete-guard shape as
  // handleSave + handleBulkSave), then bump reloadKey. The loaders'
  // guards fail, they fetch, monthCache refills, tile updates.
  //
  // Which months per view:
  //   month drill   -> [monthKey]
  //   period drill  -> monthsBetween(range.start, range.end)  (matches
  //                    the periodDays memo at :949 - mirrors, not
  //                    re-derives)
  //   season overview -> no monthCache invalidation; overview reads
  //                    `data` (unguarded calendar sc-load) and
  //                    `yearData` (unguarded year-summary), both
  //                    refresh on the reloadKey bump.
  //
  // Never `setMonthCache({})` - preserves #338's narrowing.
  const handleRefresh = useCallback(() => {
    let affected = null;
    if (isMonthView && monthKey) {
      affected = [monthKey];
    } else if (isPeriodView && periodKey && periodRanges) {
      const range = periodRanges.find(r => r.period === periodKey);
      if (range) affected = monthsBetween(range.start, range.end);
    }
    if (affected && affected.length > 0) {
      setMonthCache(prev => {
        let changed = false;
        const next = { ...prev };
        for (const mk of affected) if (mk in next) { delete next[mk]; changed = true; }
        return changed ? next : prev;
      });
    }
    setReloadKey(k => k + 1);
  }, [isMonthView, monthKey, isPeriodView, periodKey, periodRanges]);

  const handleAdminToggle = useCallback(() => {
    if (isAdminView) {
      router.push(buildScUrl({ account: selectedAccount || undefined }), { scroll: false });
    } else {
      // Admin panel is global; account stays on the URL so exiting
      // admin lands back on the same account.
      router.push(buildScUrl({ account: selectedAccount || undefined, view: "admin" }), { scroll: false });
      setFocusDay(null);
      setBulkMode(false);
    }
  }, [isAdminView, router, selectedAccount]);

  // PR 3: drill-in nav handlers are lifted here so both the ChromeBar's
  // PeriodHeaderNav slot and PeriodWorkspace (before Commit 4 strips
  // its own nav) can share them. Derivations (drillPeriodRange /
  // canPrevPeriod / canNextPeriod / isCurrentPeriod) live at the same
  // scope so the header slot can render outside the workspace.
  const handleClimbToSeason = useCallback(() => {
    router.push(buildScUrl({ account: selectedAccount || undefined }), { scroll: false });
    setFocusDay(null);
    setBulkMode(false);
    setBulkSelected(new Set());
  }, [router, selectedAccount]);
  const handlePrevPeriod = useCallback(() => {
    if (!periodRanges?.length) return;
    const idx = periodRanges.findIndex(r => r.period === periodKey);
    if (idx > 0) router.push(buildScUrl({ account: selectedAccount || undefined, period: periodRanges[idx - 1].period }), { scroll: false });
  }, [periodRanges, periodKey, router, selectedAccount]);
  const handleNextPeriod = useCallback(() => {
    if (!periodRanges?.length) return;
    const idx = periodRanges.findIndex(r => r.period === periodKey);
    if (idx >= 0 && idx < periodRanges.length - 1) router.push(buildScUrl({ account: selectedAccount || undefined, period: periodRanges[idx + 1].period }), { scroll: false });
  }, [periodRanges, periodKey, router, selectedAccount]);
  const handleTodayJump = useCallback(() => {
    if (!periodRanges?.length) return;
    const containingToday = periodRanges.find(r => today >= r.start && today <= r.end);
    if (containingToday) router.push(buildScUrl({ account: selectedAccount || undefined, period: containingToday.period }), { scroll: false });
  }, [periodRanges, today, router, selectedAccount]);

  const drillPeriodRange = periodRanges?.find(r => r.period === periodKey) || null;
  const drillPeriodIdx = periodRanges?.findIndex(r => r.period === periodKey) ?? -1;
  const canPrevPeriod = drillPeriodIdx > 0;
  const canNextPeriod = drillPeriodIdx >= 0 && drillPeriodIdx < (periodRanges?.length ?? 0) - 1;
  const isCurrentPeriod = !!(drillPeriodRange && today >= drillPeriodRange.start && today <= drillPeriodRange.end);

  // Month drill handlers + derived clamps. Month stepper is clamped to
  // Jan-Dec of the year (Kevin's decision - a month view doesn't cross
  // years). handleMonthTodayJump routes to today's calendar month.
  const handlePrevMonth = useCallback(() => {
    if (!monthKey) return;
    const m = Number(monthKey.slice(5, 7));
    const y = monthKey.slice(0, 4);
    if (m <= 1) return;
    router.push(buildScUrl({ account: selectedAccount || undefined, month: `${y}-${String(m - 1).padStart(2, "0")}` }), { scroll: false });
  }, [monthKey, router, selectedAccount]);
  const handleNextMonth = useCallback(() => {
    if (!monthKey) return;
    const m = Number(monthKey.slice(5, 7));
    const y = monthKey.slice(0, 4);
    if (m >= 12) return;
    router.push(buildScUrl({ account: selectedAccount || undefined, month: `${y}-${String(m + 1).padStart(2, "0")}` }), { scroll: false });
  }, [monthKey, router, selectedAccount]);
  const handleMonthTodayJump = useCallback(() => {
    const mk = today ? today.slice(0, 7) : null;
    if (!mk) return;
    router.push(buildScUrl({ account: selectedAccount || undefined, month: mk }), { scroll: false });
  }, [today, router, selectedAccount]);
  // HF-7 (2026-07-20) - overview Today-jump. Finds the current-month
  // card ([data-state="current"] on MonthCard's article - see
  // MonthCard.js:134), scrolls it into view, and one-shot-pulses it
  // via .sc-season-month-card--today-pulse (~1200ms; see
  // season.css:376-399 for the keyframes). Silent no-op if no
  // current-month card exists in the DOM (off-season / wrong year -
  // the OverviewTodayChip also hides itself in that case via its
  // `hasCurrentMonth` prop, so the button shouldn't have been
  // clickable in the first place).
  const handleOverviewTodayJump = useCallback(() => {
    const el = document.querySelector('.sc-season-month-card[data-state="current"]');
    if (!el) return;
    scrollIntoViewRM(el, { block: "center" });
    el.classList.remove("sc-season-month-card--today-pulse");
    // Force reflow so the animation restarts if the user clicks Today
    // twice in a row without leaving the current month.
    void el.offsetWidth;
    el.classList.add("sc-season-month-card--today-pulse");
    setTimeout(() => {
      el.classList.remove("sc-season-month-card--today-pulse");
    }, 1250);
  }, []);

  const drillMonthIdx = monthKey ? Number(monthKey.slice(5, 7)) : -1;
  const canPrevMonth = drillMonthIdx > 1;
  const canNextMonth = drillMonthIdx >= 1 && drillMonthIdx < 12;
  const isCurrentMonth = !!(monthKey && today && today.slice(0, 7) === monthKey);

  // Design Batch 2: the chrome bar holds the picker / toggle / Admin
  // (the controls that used to be scattered) and the as-of timestamp.
  // The compressed hero sits below it. Both render in every view
  // (Season + Period + admin) so they don't flash on toggle.
  const accountDropdown = isAdminView ? (
    <div className="sc-header-admin-label">
      <span className="sc-admin-mode-chip">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        {adminView.mode === "overview" ? "Admin · all accounts" : "Admin"}
      </span>
      {adminView.mode !== "overview" && (
        <button
          type="button"
          className="sc-admin-overview-back"
          onClick={() => setAdminView({ mode: "overview" })}
        >
          ← Overview
        </button>
      )}
    </div>
  ) : (
    <AccountDropdown
      accounts={accounts}
      value={selectedAccount}
      onChange={(next) => {
        // 2026-07-11 nav-rehydration redo (dual-push): state moves
        // DIRECTLY here (no round-trip through the URL) AND the URL
        // persists in parallel. This is what fixes the #399 dropdown
        // regression:
        //   - setSelectedAccount runs synchronously with the click ->
        //     the click "sticks" no matter what the URL-sync effect
        //     does downstream.
        //   - router.push updates the URL for refresh/sharing.
        //   - The URL-sync effect that fires from the router.push
        //     reads view/period/month only. It does NOT touch
        //     selectedAccount, so it cannot revert our setState.
        setSelectedAccount(next);
        router.push(buildScUrl({
          account: next || undefined,
          period: isPeriodView ? periodKey : undefined,
          month: isMonthView ? monthKey : undefined,
          view: isAdminView ? "admin" : undefined,
        }), { scroll: false });
      }}
    />
  );

  return (
    <>
      {!scV2 && (
        <div
          className="oh-hero"
          style={heroImage ? { backgroundImage: `url(${heroImage})` } : {}}
        >
          <div className="oh-hero-overlay" />
          <div className="oh-hero-content">
            <h1 className="oh-hero-title">Service Calendar</h1>
            <p className="oh-hero-subtitle">Welcome back, {firstName}.</p>
          </div>
          {/* Redesign PR 1A: admin entry in the hero's top-right corner.
              Bundle 1 (Section A) makes the button a TOGGLE - it now
              renders in admin view too, switching to a back-arrow icon
              so the operator has an exit path (the previous gate hid the
              button in admin view, leaving no way back). Wires to the
              same handleAdminToggle the old ChromeBar button used;
              isAdminView state + URL sync are unchanged. */}
          {isAdmin && (
            <button
              type="button"
              className="sc-hero-admin"
              onClick={handleAdminToggle}
              aria-label={isAdminView ? "Return to the calendar" : "Service Calendar admin (corporate only)"}
              title={isAdminView ? "Return to the calendar" : "Service Calendar admin (corporate only)"}
              aria-pressed={isAdminView}
            >
              {isAdminView ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M19 12H5" />
                  <path d="m12 19-7-7 7-7" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="11" width="18" height="10" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              )}
            </button>
          )}
          {/* As-of pill relocated from the ChromeBar into the hero's
              bottom-right corner so the bar can sit on one row at
              desktop widths. Reuses the existing .sc-chrome-bar-asof
              base styling and layers an on-photo .sc-hero-asof modifier
              that mirrors the .sc-hero-admin treatment above. Hidden on
              phones via the modifier; StickyContext carries freshness
              context there. */}
          {asOf && (
            <AsOf asOf={asOf} onRefresh={handleRefresh} className="sc-hero-asof" />
          )}
        </div>
      )}
    <div
      className={`sc-root${scV2 ? " scv2" : ""}`}
      data-density="compact"
      data-billing={isFeeAccount ? "flat_fee" : "per_meal"}
      data-category={data?.account?.category || ""}
    >
      {scV2 && (() => {
        /* Drill P1 PR-A DP1-02: drill-scope controls that ChromeBar
           used to host now flow into the Ribbon. Compute the two
           slots once here and pass to both Ribbon (scv2) and
           ChromeBar (v1) so the drill-nav JSX has one source. */
        const drillNavSlot = !isAdminView
          ? (isPeriodView ? (
              <PeriodHeaderNav
                account={data?.account}
                year={year}
                periodKey={periodKey}
                periodRange={drillPeriodRange}
                canPrev={canPrevPeriod}
                canNext={canNextPeriod}
                isLoading={!periodRanges}
                onClimbToSeason={handleClimbToSeason}
                onPrevPeriod={handlePrevPeriod}
                onNextPeriod={handleNextPeriod}
              />
            ) : isMonthView ? (
              <MonthHeaderNav
                monthKey={monthKey}
                monthRange={monthRange}
                canPrev={canPrevMonth}
                canNext={canNextMonth}
                isLoading={!monthRange}
                onClimbToSeason={handleClimbToSeason}
                onPrevMonth={handlePrevMonth}
                onNextMonth={handleNextMonth}
                phaseTimeline={phaseTimeline}
              />
            ) : null)
          : null;
        // HF-7 (2026-07-20) - drillNavEndSlot now covers YEAR view too:
        // OverviewTodayChip scrolls the current-month card into view +
        // pulses it. The chip hides itself when hasCurrentMonth is
        // false (viewing a non-current year - never rendered as a dead
        // control per owner ruling). isCurrentYear compares the fixed
        // season year (2026) to the client wall clock so an operator
        // reading the intranet in 2027 sees no Today button.
        const isCurrentYear = year === new Date().getFullYear();
        const drillNavEndSlot = !isAdminView
          ? (isPeriodView ? (
              <PeriodTodayChip
                today={today}
                isCurrentPeriod={isCurrentPeriod}
                onTodayJump={handleTodayJump}
              />
            ) : isMonthView ? (
              <PeriodTodayChip
                today={today}
                isCurrentPeriod={isCurrentMonth}
                onTodayJump={handleMonthTodayJump}
              />
            ) : isYearView ? (
              <OverviewTodayChip
                hasCurrentMonth={isCurrentYear}
                onTodayJump={handleOverviewTodayJump}
              />
            ) : null)
          : null;
        return (
        <Ribbon
          asOf={asOf}
          onRefresh={handleRefresh}
          /* V3 §9.2 + §9.6 - fetchState from effectiveYearLoadState. */
          fetchState={effectiveYearLoadState === "failed" ? "failed" : "fresh"}
          isAdmin={isAdmin}
          isAdminView={isAdminView}
          onAdminToggle={handleAdminToggle}
          /* OV-3 Wave 2 + Drill P1 PR-A (2026-07-20): chrome content
             flows into the ribbon under scv2 for BOTH overview AND
             drill. ChromeBar below suppresses for `scV2 && !isAdminView`
             (admin still uses ChromeBar). Drill nav slots (Season
             back / stepper / phase pill / Today jump) come in via
             the drillNav + drillNavEnd props. */
          accountDropdown={accountDropdown}
          /* DP1-06: type pill renders in ALL non-admin scopes (was
             overview-only). Consistent structure across the 4 account
             shapes. */
          category={!isAdminView ? category : null}
          view={seasonView}
          onViewChange={handleSeasonViewChange}
          showToggle={!isAdminView && isYearView}
          drillNav={drillNavSlot}
          drillNavEnd={drillNavEndSlot}
          todayLabel={yearBannerStats?.todayLabel}
          periodNum={yearToday?.period ? (String(yearToday.period).match(/\d+/)?.[0] ?? null) : null}
          weekNum={yearToday?.week ? (String(yearToday.week).match(/\d+/)?.[0] ?? null) : null}
          hasHomestandSchedule={hasHomestandSchedule}
          isFeeAccount={isFeeAccount}
          gameDaysEntered={yearBannerStats?.gameDaysEntered || 0}
          totalGameDays={yearBannerStats?.totalGameDays || 0}
          exportControl={
            // HF-5 (2026-07-20): export renders in ribbon-right on
            // ALL non-admin scopes (was year-view only). Scope prop
            // follows the current view. Rail still mounts an export
            // in drill via DrillRail.js:359 / OpsRail.js:263 (PR-C
            // scope) - flagged in PR body for owner ruling on the
            // duplicate.
            !isAdminView && selectedAccount
              ? (
                <ExportControl
                  scope={isPeriodView ? "period" : isMonthView ? "month" : "year"}
                  year={year}
                  periodKey={isPeriodView ? periodKey : null}
                  monthKey={isMonthView ? monthKey : null}
                  accountKey={selectedAccount}
                  showToast={showToast}
                  hasHomestandSchedule={!!data?.account?.hasHomestandSchedule}
                  hasScheduleOverlay={!!data?.account?.hasScheduleOverlay}
                />
              ) : null
          }
        />
        );
      })()}
      {/* Drill P1 PR-A DP1-02: ChromeBar suppresses for ALL scv2
          non-admin scopes (overview + drill). Admin still uses
          ChromeBar (its own admin-scope render path). v1 also uses
          it as before. */}
      {!(scV2 && !isAdminView) && <ChromeBar
        accountDropdown={accountDropdown}
        category={!isAdminView ? category : null}
        view={seasonView}
        onViewChange={handleSeasonViewChange}
        showToggle={!isAdminView && isYearView}
        showStats={!isAdminView && isYearView}
        exportControl={
          // W5 (v5) + W6 update: ExportControl moves to the rail
          // footer whenever a drill rail is being rendered. W6 opens
          // the drill rail to fee accounts too (OpsRail path), so the
          // ChromeBar export slot must suppress for scV2 + drill +
          // !admin, regardless of fee vs per-meal. Overview year view
          // and v1 keep the ChromeBar export.
          !isAdminView && selectedAccount
          && !(scV2 && (isPeriodView || isMonthView))
            ? (
              <ExportControl
                scope={isPeriodView ? "period" : isMonthView ? "month" : "year"}
                year={year}
                periodKey={isPeriodView ? periodKey : null}
                monthKey={isMonthView ? monthKey : null}
                accountKey={selectedAccount}
                showToast={showToast}
                hasHomestandSchedule={!!data?.account?.hasHomestandSchedule}
                hasScheduleOverlay={!!data?.account?.hasScheduleOverlay}
              />
            ) : null
        }
        drillNav={
          isPeriodView ? (
            <PeriodHeaderNav
              account={data?.account}
              year={year}
              periodKey={periodKey}
              periodRange={drillPeriodRange}
              canPrev={canPrevPeriod}
              canNext={canNextPeriod}
              isLoading={!periodRanges}
              onClimbToSeason={handleClimbToSeason}
              onPrevPeriod={handlePrevPeriod}
              onNextPeriod={handleNextPeriod}
            />
          ) : isMonthView ? (
            <MonthHeaderNav
              monthKey={monthKey}
              monthRange={monthRange}
              canPrev={canPrevMonth}
              canNext={canNextMonth}
              isLoading={!monthRange}
              onClimbToSeason={handleClimbToSeason}
              onPrevMonth={handlePrevMonth}
              onNextMonth={handleNextMonth}
              phaseTimeline={phaseTimeline}
            />
          ) : null
        }
        drillNavEnd={
          isPeriodView ? (
            <PeriodTodayChip
              today={today}
              isCurrentPeriod={isCurrentPeriod}
              onTodayJump={handleTodayJump}
            />
          ) : isMonthView ? (
            <PeriodTodayChip
              today={today}
              isCurrentPeriod={isCurrentMonth}
              onTodayJump={handleMonthTodayJump}
            />
          ) : null
        }
        todayLabel={yearBannerStats?.todayLabel}
        periodNum={yearToday?.period ? (String(yearToday.period).match(/\d+/)?.[0] ?? null) : null}
        weekNum={yearToday?.week ? (String(yearToday.week).match(/\d+/)?.[0] ?? null) : null}
        isFeeAccount={isFeeAccount}
        needsEntry={yearBannerStats?.needsEntry || 0}
        overdue={yearBannerStats?.overdue || 0}
        gameDaysEntered={yearBannerStats?.gameDaysEntered || 0}
        totalGameDays={yearBannerStats?.totalGameDays || 0}
        onJumpToNeeds={handleJumpToNeeds}
        onJumpToOverdue={handleJumpToOverdue}
      />}

      {!isAdminView && (
        <StickyContext
          accountKey={selectedAccount}
          todayLabel={yearBannerStats?.todayLabel}
          periodNum={yearToday?.period ? (String(yearToday.period).match(/\d+/)?.[0] ?? null) : null}
          weekNum={yearToday?.week ? (String(yearToday.week).match(/\d+/)?.[0] ?? null) : null}
          pctRecorded={hasHomestandSchedule
            ? (yearBannerStats?.totalGameDays > 0
                ? Math.round((yearBannerStats.gameDaysEntered / yearBannerStats.totalGameDays) * 100)
                : null)
            : (yearBannerStats?.totalDays > 0
                ? Math.round((yearBannerStats.daysRecorded / yearBannerStats.totalDays) * 100)
                : null)
          }
          isFeeAccount={isFeeAccount}
          needsEntry={yearBannerStats?.needsEntry || 0}
          overdue={yearBannerStats?.overdue || 0}
          gameDaysEntered={yearBannerStats?.gameDaysEntered || 0}
          totalGameDays={yearBannerStats?.totalGameDays || 0}
        />
      )}

      <div className="sc-body">
        {isYearView && (() => {
          const seasonShell = (
            <SeasonShell
              account={data?.account}
              year={year}
              yearData={yearData}
              yearToday={yearToday}
              yearBannerStats={yearBannerStats}
              hasHomestandSchedule={hasHomestandSchedule}
              isFeeAccount={isFeeAccount}
              isMilb={isMilb}
              springDateSet={springDateSet}
              loading={loading || !data || !yearData}
              loadState={effectiveYearLoadState /* SC-033 + V3 H1: hook derived once at effectiveYearLoadState above */}
              // Calendar month-card drill: opens the MONTH scope drill-in
              // (un-deprecates the month view). Prior behavior forwarded
              // to the containing fiscal period; the two scopes now
              // coexist - month click opens ?month=, period click opens
              // ?period= (below).
              onMonthClick={(mi) => {
                const mk = `${year}-${String(mi + 1).padStart(2, "0")}`;
                router.push(buildScUrl({ account: selectedAccount || undefined, month: mk }), { scroll: false });
                setFocusDay(null);
                setBulkMode(false);
              }}
              periodRanges={periodRanges}
              onPeriodClick={(periodLabel) => {
                router.push(buildScUrl({ account: selectedAccount || undefined, period: periodLabel }), { scroll: false });
              }}
              // Lifted view toggle (the action signal moved to the chrome
              // bar, so the season shell no longer carries jump props).
              view={seasonView}
              onViewChange={handleSeasonViewChange}
              syncingDates={syncingDates}
              scV2={scV2}
            />
          );
          // v2 two-pane: SeasonShell left, rail right. W6: drop the
          // !isFeeAccount gate - fee accounts now enter the two-pane
          // with the OpsRail (games/meals-forward, zero dollars).
          // Non-admin still applies. Below 1280px the rail leaves the
          // side and stacks under the grid full width.
          const useTwoPane = scV2 && !isAdminView && !!yearData;
          if (!useTwoPane) return seasonShell;
          // Rail selection by account shape:
          //   fee -> OpsRail (MLB fee variant if hasHomestandSchedule,
          //     else STL-FL variant)
          //   per-meal -> SeasonRail (money rail, W2-W4 shape)
          // CIN-KY (per-meal + hasHomestandSchedule=true) stays on the
          // money rail per bundle scope; its drill money rail gains
          // the HS section (Step 2).
          const overviewTargetDay = (date, period /*, source */) => {
            if (period) {
              // B2/B8a interaction (2026-07-24): this handler crosses
              // the overview -> drill boundary (periodKey null -> N),
              // which fires the view-context reset effect and would
              // close the modal we're about to open. Set the pending-
              // rail-focus signal BEFORE the URL change so the reset
              // effect sees it. See pendingRailFocusRef declaration
              // (~:1274) for the full contract.
              pendingRailFocusRef.current = date;
              router.push(buildScUrl({
                account: selectedAccount || undefined,
                period,
                day: date,
              }), { scroll: false });
              // B2 (2026-07-24): rail queue rows previously navigated
              // without opening the entry modal - buildScUrl's ?day=
              // is documented focus-only (see :98-113), and no code
              // turned it into setFocusDay. Explicit setFocusDay opens
              // the modal the operator expected. router.push above still
              // updates the URL (preserves tile-focus scroll + shareable
              // link semantics).
              setFocusDay(date);
            }
          };
          const overviewDrillMonth = (mi) => {
            const mk = `${year}-${String(mi + 1).padStart(2, "0")}`;
            router.push(buildScUrl({ account: selectedAccount || undefined, month: mk }), { scroll: false });
            setFocusDay(null);
            setBulkMode(false);
          };
          const overviewDrillPeriod = (periodLabel) => {
            router.push(buildScUrl({ account: selectedAccount || undefined, period: periodLabel }), { scroll: false });
          };
          // W6: the OpsRail queue+footer target a bare `?day=` on a
          // year-view URL - but ?day= is drill-only. Route through
          // the containing period so the target lands on a drill.
          const feeTargetDay = (date) => {
            const containingPeriod = periodRanges?.find(r => date >= r.start && date <= r.end);
            if (containingPeriod) {
              // B2/B8a interaction (2026-07-24): same overview-to-drill
              // boundary as overviewTargetDay above. Signal the reset
              // effect via pendingRailFocusRef so it preserves focusDay.
              pendingRailFocusRef.current = date;
              router.push(buildScUrl({
                account: selectedAccount || undefined,
                period: containingPeriod.period,
                day: date,
              }), { scroll: false });
              // B2 (2026-07-24): open the entry modal after navigating.
              // See overviewTargetDay above.
              setFocusDay(date);
            }
          };
          const rail = isFeeAccount ? (
            <OpsRail
              mode="overview"
              scopeLabel={`SEASON · ${year} BOOKS`}
              hasHomestandSchedule={hasHomestandSchedule}
              year={year}
              yearData={yearData}
              today={today}
              onTargetDay={feeTargetDay}
              onDrillToMonth={overviewDrillMonth}
              onDrillToPeriod={overviewDrillPeriod}
            />
          ) : (
            <SeasonRail
              mode={seasonView === "period" ? "period" : "calendar"}
              year={year}
              yearData={yearData}
              periodRanges={periodRanges}
              onDrillToDay={overviewTargetDay}
              onDrillToMonth={overviewDrillMonth}
              onDrillToPeriod={overviewDrillPeriod}
              /* V3 §9.2 - failed-state signal + retry hook. Rail
                 renders a banner + retry button when the year-summary
                 fetch failed; kicks reload via handleRefresh (same
                 signal the AsOf pill uses). Reads
                 effectiveYearLoadState so ?debug=failed hits here too
                 (H1). Zero write-path. */
              loadState={effectiveYearLoadState}
              onRetry={handleRefresh}
            />
          );
          // W8 - shared mobile books-bar figures. Read from the SAME
          // derives the rails consume internally (law 2). Per-meal:
          // deriveHeroTotals + deriveQueue over yearData; the rail
          // calls the same two functions with the same input, so the
          // values are identical by construction. Fee: OpsRail's
          // deriveOpsHeroTotals, same input.
          const overviewBar = isFeeAccount
            ? (() => {
                const t = deriveOpsHeroTotals(yearData, hasHomestandSchedule, today);
                const num = hasHomestandSchedule ? t.gameDaysEntered : t.daysEntered;
                const den = hasHomestandSchedule ? t.totalGameDays : t.totalActionableDays;
                return {
                  label: hasHomestandSchedule ? "GAME DAYS" : "DAYS ENTERED",
                  value: `${num} of ${den}`,
                  status: null,
                };
              })()
            : (() => {
                const totals = deriveHeroTotals(yearData);
                const q = deriveQueue(yearData, periodRanges, today);
                return {
                  label: "SEASON BOOKS",
                  value: fmtOverviewMoney(totals.actualRevenue || 0),
                  status: q.length > 0 ? `${q.length} need entry` : null,
                };
              })();
          return (
            <div className="sc-overview">
              <div className="sc-overview-main">{seasonShell}</div>
              <MobileBooksBar
                className="sc-overview-rail"
                ariaLabel={isFeeAccount ? "Season books - fee account" : "Season books"}
                barLabel={overviewBar.label}
                barValue={overviewBar.value}
                barStatus={overviewBar.status}
              >
                {rail}
              </MobileBooksBar>
            </div>
          );
        })()}


        {isPeriodView && (() => {
          // Read the ?day= target once; only meaningful when the
          // target date falls inside the current drill window
          // (URL-cleared per Step 0 contract on ?reset=1 / leaving drill).
          const dayTarget = searchParams?.get("day") || null;
          const focusTargetDate = (
            dayTarget && drillPeriodRange
            && dayTarget >= drillPeriodRange.start
            && dayTarget <= drillPeriodRange.end
          ) ? dayTarget : null;
          const workspaceLoadState = (isDev && searchParams?.get("debug") === "failed")
            ? "failed"
            : drillLoadState;
          const workspace = (
            <PeriodWorkspace
              account={data?.account}
              year={year}
              periodKey={periodKey}
              periodRange={drillPeriodRange}
              periodRanges={periodRanges}
              periodDays={periodDays}
              periodMetrics={periodMetrics}
              hasHomestandSchedule={hasHomestandSchedule}
              isFeeAccount={isFeeAccount}
              isMilb={isMilb}
              homestandMap={periodHomestandMap || homestandMap}
              scheduleOverlay={periodScheduleOverlay || scheduleOverlay}
              springDateSet={springDateSet}
              phaseTimeline={phaseTimeline}
              today={today}
              loading={loading && !periodDays}
              loadState={workspaceLoadState}
              partialError={partialError}
              onDayClick={(date) => setFocusDay(date)}
              bulkMode={bulkMode}
              onBulkModeToggle={(next) => { setBulkMode(next); if (!next) setBulkSelected(new Set()); }}
              bulkSelected={bulkSelected}
              onBulkTileClick={toggleBulkSelect}
              onBulkOpenPanel={() => setBulkPanelOpen(true)}
              onBulkReview={() => setBulkReviewOpen(true)}
              onBulkConfirmAsProjected={handleBulkConfirm}
              onBulkCancel={() => { setBulkMode(false); setBulkSelected(new Set()); setBulkPanelOpen(false); setBulkReviewOpen(false); }}
              saving={saving}
              onJumpFirstOverdue={handleJumpFirstOverdueInDrill}
              onJumpFirstNeeds={handleJumpFirstNeedsInDrill}
              syncingDates={syncingDates}
              scV2={scV2}
              focusTargetDate={focusTargetDate}
            />
          );
          // W6: drop !isFeeAccount from the drill guard - fee accounts
          // now enter the two-pane with OpsRail. Rail selection:
          //   fee -> OpsRail drill mode (games/meals; ZERO $)
          //   per-meal -> DrillRail (money hero + weeks) with an
          //     optional HOMESTANDS section when hasHomestandSchedule
          //     (CIN-KY is the proof case).
          const useDrillRail = scV2 && !isAdminView && !!periodMetrics;
          if (!useDrillRail) return workspace;
          const targetDay = (date) => {
            router.push(buildScUrl({
              account: selectedAccount || undefined,
              period: periodKey,
              day: date,
            }), { scroll: false });
            // B2 (2026-07-24): open the entry modal after navigating.
            // See overviewTargetDay in the overview branch above.
            setFocusDay(date);
          };
          // HF-5 dedup (2026-07-20): the rail's exportControl slot
          // (DrillRail.js:359 / OpsRail.js:263) is deliberately not
          // fed on scv2 drill - HF-5 mounts export in the ribbon
          // instead (ServiceCalendar.js:2170-2189, single source).
          // The rail's `{exportControl && ...}` conditional keeps
          // the prop contract intact for any future overview mount
          // that wants a rail-footer export; drill just passes null.
          const rail = isFeeAccount ? (
            <OpsRail
              mode="drill"
              scopeLabel={periodKey ? `P${String(periodKey).replace(/^P/i, "")}` : "PERIOD"}
              hasHomestandSchedule={hasHomestandSchedule}
              year={year}
              yearData={yearData}
              today={today}
              periodDays={periodDays}
              /* DP2-06 v3 (2026-07-21): source of truth for the drill
                 hero + caption. Same `m` the strip reads. */
              periodMetrics={periodMetrics}
              periodRange={drillPeriodRange}
              loading={loading && !periodDays}
              incomplete={!!partialError}
              exportControl={null}
              onTargetDay={targetDay}
            />
          ) : (
            <DrillRail
              scope="period"
              scopeLabel={periodKey ? `P${String(periodKey).replace(/^P/i, "")}` : ""}
              periodMetrics={periodMetrics}
              periodDays={periodDays}
              periodRange={drillPeriodRange}
              hasHomestandSchedule={hasHomestandSchedule}
              yearData={yearData}
              today={today}
              loading={loading && !periodDays}
              incomplete={!!partialError}
              exportControl={null}
              onTargetDay={targetDay}
              onEnterToday={targetDay}
              onEnterOldest={targetDay}
              /* Drill P1 PR-A DP1-08 - bulk entry secondary CTA in rail. */
              onBulkModeToggle={(next) => { setBulkMode(next); if (!next) setBulkSelected(new Set()); }}
            />
          );
          // W8 - drill mobile books-bar.
          //
          // Per-meal: periodMetrics.actRev is the SAME value
          // DrillRail.js:71 assigns to heroActRev. Bar scope = drill
          // scope (period).
          //
          // Fee: OpsRail's hero is SEASON-scoped even in drill mode
          // (OpsRail.js:79 calls deriveOpsHeroTotals(yearData,
          // hasHomestandSchedule, iso) with FULL yearData - no
          // periodRange filter; its meta at :90-91 reads "meals YTD").
          // The bar therefore mirrors the rail's season-scoped hero
          // by calling the same derive with the same inputs. Not a
          // period window - explicit season scope. Whether drill-mode
          // OpsRail SHOULD scope its hero to the drill window is an
          // upstream design question logged for W9/V3; the bar
          // matches whatever the rail shows so bar vs sheet stay in
          // truth-agreement (F1 verdict, PR #469).
          const drillBar = isFeeAccount
            ? (() => {
                // DP2-06 real fix (2026-07-21): period-drill bar mirrors
                // the rail hero (truth-agreement law) - both now read
                // the DRILLED window. Prior code used yearData +
                // "SEASON BOOKS" suffix, which would contradict the
                // now-scoped rail hero. Label drops the suffix so it
                // describes the scope its numbers describe.
                // DP2-06 v3 (2026-07-21): bar mirrors the rail hero,
                // which now reads periodMetrics directly (same source
                // as the strip). complete/total on MLB = game days
                // (SC-078 status widening); on STL-FL = actionable
                // days. Same field applies to both account shapes.
                const num = periodMetrics?.complete || 0;
                const den = periodMetrics?.total || 0;
                return {
                  label: `PERIOD ${periodKey ? `P${String(periodKey).replace(/^P/i, "")}` : ""}`,
                  value: `${num} of ${den}`,
                  status: null,
                };
              })()
            : {
                label: `PERIOD ${periodKey ? `P${String(periodKey).replace(/^P/i, "")}` : ""}`,
                value: fmt$(periodMetrics?.actRev || 0),
                status: periodMetrics?.total && periodMetrics?.complete != null
                  ? `${periodMetrics.complete} of ${periodMetrics.total} entered`
                  : null,
              };
          return (
            <div className="sc-drill">
              <div className="sc-drill-main">
                {workspace}
                {/* Drill P1 PR-B DP1-19: legend renders inside
                    .sc-drill-main so its inline edges match the
                    calendar card and stop at the rail column edge
                    (was a sibling of .sc-drill - stretched full
                    width including rail). scv2 only; v1 path (the
                    !scV2 branch above the drill scope) still uses
                    the sibling render at :2774. */}
                {scV2 && (
                  <StateLegend
                    hasHomestandSchedule={hasHomestandSchedule}
                    isFeeAccount={isFeeAccount}
                    isMilb={isMilb}
                    showDayNight={true}
                    /* DP2-05 (2026-07-20): scv2 drill legend bar
                       carries the FIGURES trailer. v1 fallback mount
                       below (:2917) leaves the prop off - v1 legend
                       stays untouched.
                       Bundle-A #10 (2026-07-21): drop the game-day
                       + spring-training markers on drill (they paint
                       on sm overview tiles, not lg drill tiles).
                       Bundle-B follow-up (2026-07-22): drill also
                       drops EXH + Day/Night so every account type
                       reads the same concise state spine.
                       Coverage split (2026-07-22): three
                       independent flags because overview wants a
                       different subset (day/night only). Popup keeps
                       every category explained. */
                    showFigures={true}
                    dropMarkers={true}
                    dropExhibition={true}
                    dropDayNight={true}
                  />
                )}
              </div>
              <MobileBooksBar
                className="sc-drill-rail"
                ariaLabel="Period books"
                barLabel={drillBar.label}
                barValue={drillBar.value}
                barStatus={drillBar.status}
              >
                {rail}
              </MobileBooksBar>
            </div>
          );
        })()}

        {/* Month drill: reuses the same range-based PeriodWorkspace body
            with a calendar-month range (start = mk-01, end = mk-<last>).
            monthDays / monthMetrics / monthHomestandMap flow from the
            monthCache directly (single-month payload; no cross-month
            merge). Header nav swaps to MonthHeaderNav via ChromeBar's
            drillNav slot above. */}
        {isMonthView && (() => {
          const dayTarget = searchParams?.get("day") || null;
          const focusTargetDate = (
            dayTarget && monthRange
            && dayTarget >= monthRange.start
            && dayTarget <= monthRange.end
          ) ? dayTarget : null;
          const workspace = (
            <PeriodWorkspace
              scope="month"
              account={data?.account}
              year={year}
              periodKey={null}
              periodRange={monthRange}
              periodRanges={null}
              periodDays={monthDays}
              periodMetrics={monthMetrics}
              hasHomestandSchedule={hasHomestandSchedule}
              isFeeAccount={isFeeAccount}
              isMilb={isMilb}
              homestandMap={monthHomestandMap || homestandMap}
              scheduleOverlay={monthScheduleOverlay || scheduleOverlay}
              springDateSet={springDateSet}
              phaseTimeline={phaseTimeline}
              today={today}
              loading={loading && !monthDays}
              partialError={partialError}
              onDayClick={(date) => setFocusDay(date)}
              bulkMode={bulkMode}
              onBulkModeToggle={(next) => { setBulkMode(next); if (!next) setBulkSelected(new Set()); }}
              bulkSelected={bulkSelected}
              onBulkTileClick={toggleBulkSelect}
              onBulkOpenPanel={() => setBulkPanelOpen(true)}
              onBulkReview={() => setBulkReviewOpen(true)}
              onBulkConfirmAsProjected={handleBulkConfirm}
              onBulkCancel={() => { setBulkMode(false); setBulkSelected(new Set()); setBulkPanelOpen(false); setBulkReviewOpen(false); }}
              saving={saving}
              onJumpFirstOverdue={handleJumpFirstOverdueInDrill}
              onJumpFirstNeeds={handleJumpFirstNeedsInDrill}
              syncingDates={syncingDates}
              scV2={scV2}
              focusTargetDate={focusTargetDate}
            />
          );
          const useDrillRail = scV2 && !isAdminView && !!monthMetrics;
          if (!useDrillRail) return workspace;
          const targetDay = (date) => {
            router.push(buildScUrl({
              account: selectedAccount || undefined,
              month: monthKey,
              day: date,
            }), { scroll: false });
            // B2 (2026-07-24): open the entry modal after navigating.
            // See overviewTargetDay in the overview branch above.
            setFocusDay(date);
          };
          // Human month label ("Jul 2026") for the rail section header
          const monthLabel = monthKey ? (() => {
            const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            const [y, m] = monthKey.split("-").map(Number);
            return m >= 1 && m <= 12 ? `${MON[m-1]} ${y}` : monthKey;
          })() : "";
          // HF-5 dedup (2026-07-20): month-scope rail export removed;
          // ribbon owns export (see period-scope note above).
          const rail = isFeeAccount ? (
            <OpsRail
              mode="drill"
              scopeLabel={monthLabel}
              hasHomestandSchedule={hasHomestandSchedule}
              year={year}
              yearData={yearData}
              today={today}
              periodDays={monthDays}
              /* DP2-06 v3 (2026-07-21): monthMetrics feeds the drill
                 hero + caption. Same object the month strip reads. */
              periodMetrics={monthMetrics}
              periodRange={monthRange}
              loading={loading && !monthDays}
              incomplete={!!partialError}
              exportControl={null}
              onTargetDay={targetDay}
            />
          ) : (
            <DrillRail
              scope="month"
              scopeLabel={monthLabel}
              periodMetrics={monthMetrics}
              periodDays={monthDays}
              periodRange={monthRange}
              hasHomestandSchedule={hasHomestandSchedule}
              yearData={yearData}
              today={today}
              loading={loading && !monthDays}
              incomplete={!!partialError}
              exportControl={null}
              onTargetDay={targetDay}
              onEnterToday={targetDay}
              onEnterOldest={targetDay}
              /* Drill P1 PR-A DP1-08 - bulk entry secondary CTA in rail. */
              onBulkModeToggle={(next) => { setBulkMode(next); if (!next) setBulkSelected(new Set()); }}
            />
          );
          // W8 - month-drill mobile books-bar. Mirrors the period-drill
          // pattern (see the period drill mount above). Per-meal:
          // monthMetrics.actRev = DrillRail.js:71 heroActRev when
          // scope="month". Fee: season-scoped, matching OpsRail.js:79
          // (yearData, no window; meta reads "meals YTD"). Bar vs
          // sheet stay in truth-agreement.
          const monthBar = isFeeAccount
            ? (() => {
                // DP2-06 real fix (2026-07-21): month-drill bar mirrors
                // the rail hero - both DRILLED window. Prior code used
                // yearData + "SEASON BOOKS" suffix which contradicted
                // the scoped rail. Suffix dropped so the label matches
                // its numbers' scope.
                // DP2-06 v3 (2026-07-21): bar reads monthMetrics
                // directly (same as the rail hero + top strip).
                const num = monthMetrics?.complete || 0;
                const den = monthMetrics?.total || 0;
                return {
                  label: monthLabel.toUpperCase() || "MONTH",
                  value: `${num} of ${den}`,
                  status: null,
                };
              })()
            : {
                label: monthLabel.toUpperCase() || "MONTH",
                value: fmt$(monthMetrics?.actRev || 0),
                status: monthMetrics?.total && monthMetrics?.complete != null
                  ? `${monthMetrics.complete} of ${monthMetrics.total} entered`
                  : null,
              };
          return (
            <div className="sc-drill">
              <div className="sc-drill-main">
                {workspace}
                {/* Drill P1 PR-B DP1-19: legend renders inside
                    .sc-drill-main so its inline edges match the
                    calendar card and stop at the rail column edge
                    (was a sibling of .sc-drill - stretched full
                    width including rail). scv2 only; v1 path (the
                    !scV2 branch above the drill scope) still uses
                    the sibling render at :2774. */}
                {scV2 && (
                  <StateLegend
                    hasHomestandSchedule={hasHomestandSchedule}
                    isFeeAccount={isFeeAccount}
                    isMilb={isMilb}
                    showDayNight={true}
                    /* DP2-05 (2026-07-20): scv2 drill legend bar
                       carries the FIGURES trailer. v1 fallback mount
                       below (:2917) leaves the prop off - v1 legend
                       stays untouched.
                       Bundle-A #10 (2026-07-21): drop the game-day
                       + spring-training markers on drill (they paint
                       on sm overview tiles, not lg drill tiles).
                       Bundle-B follow-up (2026-07-22): drill also
                       drops EXH + Day/Night so every account type
                       reads the same concise state spine.
                       Coverage split (2026-07-22): three
                       independent flags because overview wants a
                       different subset (day/night only). Popup keeps
                       every category explained. */
                    showFigures={true}
                    dropMarkers={true}
                    dropExhibition={true}
                    dropDayNight={true}
                  />
                )}
              </div>
              <MobileBooksBar
                className="sc-drill-rail"
                ariaLabel="Month books"
                barLabel={monthBar.label}
                barValue={monthBar.value}
                barStatus={monthBar.status}
              >
                {rail}
              </MobileBooksBar>
            </div>
          );
        })()}

        {/* Drill-in state legend as a direct child of .sc-body, matching
            the overview's SeasonShell pattern - the .sc-body >
            .sc-state-legend rule (stateLegend.css) turns it into a flush
            bottom band with a hairline top divider and bottom card
            radii. When rendered inside .sc-workspace it stays the default
            pill; this placement lets the existing CSS take over. */}
        {/* Drill P1 PR-B DP1-19: scv2 drill renders StateLegend
            INSIDE .sc-drill-main (see the two drill blocks above).
            v1 (flag off) keeps the sibling render here so v1
            layout is byte-identical. */}
        {(isPeriodView || isMonthView) && !scV2 && (
          <StateLegend
            hasHomestandSchedule={hasHomestandSchedule}
            isFeeAccount={isFeeAccount}
            isMilb={isMilb}
            showDayNight={true}
          />
        )}

        {/* Admin in-page view mode. Renders ONLY for
            isAdmin - the API server-side gates on every admin POST action
            remain the security boundary; this gate is just about not
            showing a control to non-admins (and not rendering the body
            if a non-admin somehow lands on ?view=admin). */}
        {isAdminView && isAdmin && (
          <div className="sc-admin-body sc-fade-in">
            <AdminPanel
              view={adminView}
              onViewChange={setAdminView}
              showToast={showToast}
            />
          </div>
        )}
      </div>

      {/* Day detail overlay. serviceGroups fall back to periodServiceGroups
          since the focused day may belong to a calendar month different
          from `data` (a period can span two months). */}
      {focusDay && focusDayData && (data?.serviceGroups || periodServiceGroups) && (
        <div className="sc-overlay-backdrop" onClick={(e) => { if (e.target === e.currentTarget) handleGuardedDayClose(); }}>
          <div
            ref={dayOverlayCardRef}
            className="sc-overlay-card"
            data-density="comfortable"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sc-day-detail-title"
            tabIndex={-1}
          >
            {/* W7 mount matrix (scope §5 + standing law 3):
                scV2 OFF                          -> DayDetail v1 always (pixel parity).
                scV2 ON  + entry OFF              -> DayDetail v1 inside v2 chrome (today's shipped state).
                scV2 ON  + entry ON + per-meal    -> DayEntryV2.
                scV2 ON  + entry ON + isFeeAccount-> DayDetail v1 (live bill meaningless without per-meal $;
                                                    fee accounts locked to v1 in scope §7).
                Note: the mount matrix lives here to keep the flag gate load-bearing and one-place-only.
                W7 PR 1/3 fix F3: props hoisted to a single object so PRs 2/3 edit ONE list, not two. */}
            {(() => {
              const dayEntryProps = {
                ref: dayDetailRef,
                day: focusDayData,
                serviceGroups: data?.serviceGroups || periodServiceGroups,
                overrides: data?.overrides?.filter(o => o.date === focusDay) || [],
                onSave: handleSave,
                onAddNote: handleAddNote,
                saving,
                dayIndex: focusIdx,
                totalDays: dayList.length,
                monthRevenue: periodMetrics?.actRev || periodMetrics?.projRev || 0,
                scopeLabel: "period",
                accountName: acctObj?.name || "",
                accountSegment: acctObj?.category || "",
                isFeeAccount,
                homestandContext: (periodHomestandMap || homestandMap)[focusDay] || null,
                onPrev: canPrev ? () => navDay(-1) : null,
                onNext: canNext ? () => navDay(1) : null,
                onNextException: onNextExceptionHandler,
                onClose: () => setFocusDay(null),
              };
              // W7 PR 3/3 Phase 6 - scEntryV2 is now the effective gate
              // (scV2 && !isFeeAccount already folded in via
              // useScEntryV2Effective at the top of the component). The
              // stored-off kill switch beats the cutover list; storedOn
              // beats the cutover list too; absent falls through to env
              // default OR ENTRY_V2_ACCOUNTS.has(accountKey).
              return scEntryV2
                ? <DayEntryV2 {...dayEntryProps} />
                : <DayDetail {...dayEntryProps} />;
            })()}
          </div>
        </div>
      )}

      {/* Bulk custom-entry - pos-style panel (Phase 2A 2026-07-24,
          redline #11). Legacy .sc-day inline shell replaced by
          <BulkEntry>, which reuses GroupBlock / ServiceRow from the
          single-day modal for structural parity. First selected day
          serves as the syntheticDay template (matches the pre-existing
          "Init bulk values from first selected day's projections"
          pattern at :2035). */}
      {bulkPanelOpen && data?.serviceGroups && (() => {
        const firstDate = Array.from(bulkSelected).sort()[0];
        const syntheticDay = firstDate
          ? (activeDrillDays?.find(d => d.date === firstDate) || dayMap?.[firstDate])
          : null;
        if (!syntheticDay) return null;
        return (
          <BulkEntry
            cardRef={bulkOverlayCardRef}
            daysCount={bulkSelected.size}
            serviceGroups={data.serviceGroups}
            values={bulkValues}
            onChange={(colIndex, value) => setBulkValues(prev => ({ ...prev, [colIndex]: value }))}
            onCancel={() => setBulkPanelOpen(false)}
            onReview={() => { setBulkPanelOpen(false); setBulkCustomReviewOpen(true); }}
            saving={saving}
            accountSegment={data?.account?.category || ""}
            syntheticDay={syntheticDay}
          />
        );
      })()}

      {/* Bulk match-projections review (Phase 2A 2026-07-24, owner
          Ruling 1). Was an inline IIFE; both bulk paths converge on
          <BulkReview> now. Header revenue = sum of per-day rounded
          server-derived projected revenue (Bundle 1 convention).
          Per-service expand shows what each service will be written
          for on each day (projected values). Overwrite warning
          computed from day.actual for days that already have counts. */}
      {bulkReviewOverlayOpen && (() => {
        const days = [];
        for (const dk of bulkSelected) {
          const d = activeDrillDays?.find(x => x.date === dk) || dayMap?.[dk];
          if (d) days.push(d);
        }
        days.sort((a, b) => a.date.localeCompare(b.date));
        // Header totals: server-derived per-day figures pre-rounded,
        // then summed once. Same shape as pre-rewrite so the number
        // an operator computes on screen still checks out.
        let totMeals = 0, totRev = 0;
        for (const d of days) {
          for (const v of Object.values(d.projected || {})) totMeals += v || 0;
          totRev += Math.round(Number(d.totals?.projectedRevenue) || 0);
        }
        // Overwrite detection: days with existing actuals. Counts +
        // services only, no currency - meals summed from day.actual.
        const overwrites = new Map();
        for (const d of days) {
          if (!d.hasActuals) continue;
          let prevMeals = 0, prevServices = 0;
          for (const v of Object.values(d.actual || {})) {
            const n = Number(v);
            if (Number.isFinite(n) && n > 0) { prevMeals += n; prevServices += 1; }
          }
          if (prevMeals > 0 || prevServices > 0) {
            overwrites.set(d.date, { prevMeals, prevServices });
          }
        }
        // Per-service expand: emit one row per in-service service with
        // its projected value on that day.
        const perDayServices = (d) => {
          const rows = [];
          for (const g of data.serviceGroups) {
            for (const s of g.services) {
              const proj = d.projected?.[s.colIndex] ?? 0;
              rows.push({ serviceId: s.colIndex, serviceName: s.name, value: proj });
            }
          }
          return rows;
        };
        return (
          <BulkReview
            cardRef={bulkReviewOverlayCardRef}
            days={days}
            serviceGroups={data.serviceGroups}
            subtitle={`Match projections - ${days.length} day${days.length !== 1 ? "s" : ""}`}
            statusPill="projected totals"
            headerTotals={{ meals: totMeals, revenue: totRev }}
            perDayRow={(d) => {
              let m = 0;
              for (const v of Object.values(d.projected || {})) m += v || 0;
              return { meals: m, revenue: Number(d.totals?.projectedRevenue) || 0 };
            }}
            perDayServices={perDayServices}
            overwrites={overwrites}
            isFeeAccount={isFeeAccount}
            acctName={acctObj?.name}
            saving={saving}
            confirmLabel="Confirm & save"
            onConfirm={() => { setBulkReviewOpen(false); handleBulkConfirm(); }}
            onBack={() => setBulkReviewOpen(false)}
          />
        );
      })()}

      {/* Bulk custom-values review (Phase 2A 2026-07-24). Same
          <BulkReview> component as the match-projections path -
          differs only in the four surface points identified in the
          pre-build read (subtitle, pill, header source, per-row
          meals source). Meals identical across days; revenue is
          effective-dated per day via day.priceAtDate. */}
      {bulkCustomReviewOverlayOpen && (() => {
        // Same entries the write path will send.
        const entries = [];
        for (const g of data.serviceGroups) {
          for (const s of g.services) {
            const val = bulkValues[s.colIndex];
            if (val !== undefined && val !== "") {
              entries.push({ colIndex: s.colIndex, serviceName: s.name, value: Number(val) });
            }
          }
        }
        const totalMealsPerDay = entries.reduce((s, e) => s + (Number(e.value) || 0), 0);

        const days = [];
        for (const dk of bulkSelected) {
          const d = activeDrillDays?.find(x => x.date === dk) || dayMap?.[dk];
          if (d) days.push(d);
        }
        days.sort((a, b) => a.date.localeCompare(b.date));

        const perDayRev = (d) => {
          let rev = 0;
          for (const e of entries) {
            const price = d.priceAtDate?.[e.colIndex] ?? 0;
            rev += (Number(e.value) || 0) * price;
          }
          return rev;
        };

        let totRev = 0;
        for (const d of days) totRev += Math.round(perDayRev(d));
        const totMeals = totalMealsPerDay * days.length;

        const overwrites = new Map();
        for (const d of days) {
          if (!d.hasActuals) continue;
          let prevMeals = 0, prevServices = 0;
          for (const v of Object.values(d.actual || {})) {
            const n = Number(v);
            if (Number.isFinite(n) && n > 0) { prevMeals += n; prevServices += 1; }
          }
          if (prevMeals > 0 || prevServices > 0) {
            overwrites.set(d.date, { prevMeals, prevServices });
          }
        }
        return (
          <BulkReview
            cardRef={bulkCustomReviewOverlayCardRef}
            days={days}
            serviceGroups={data.serviceGroups}
            subtitle={`Custom values - ${days.length} day${days.length !== 1 ? "s" : ""}`}
            statusPill="custom totals"
            headerTotals={{ meals: totMeals, revenue: totRev }}
            perDayRow={(d) => ({ meals: totalMealsPerDay, revenue: perDayRev(d) })}
            perDayServices={() => entries.map(e => ({
              serviceId: e.colIndex,
              serviceName: e.serviceName,
              value: e.value,
            }))}
            overwrites={overwrites}
            isFeeAccount={isFeeAccount}
            acctName={acctObj?.name}
            saving={saving}
            confirmLabel="Confirm & save"
            onConfirm={() => { setBulkCustomReviewOpen(false); handleBulkSave(); }}
            onBack={() => setBulkCustomReviewOpen(false)}
          />
        );
      })()}

    </div>
    </>
  );
}
