// Count days per account that would flip status under the proposed
// classify() fix:
//   if (s.hasProj && !s.anyNonZeroProj && !s.hasAct) return "no-service";
//
// Reports: total flips per account, current-status breakdown of the
// flipped days, and date range affected.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const YEAR = 2026;
const LOCK_DAYS = 7;
const ACCOUNTS = ["CIN - AZ","CIN - KY","CIN - OH","STL - FL","STL - MO","TBJ - FL","TBJ - NY","TBR - FL","TXR - AZ","TXR - TX - H","TXR - TX - V"];
const first = `${YEAR}-01-01`;
const last  = `${YEAR}-12-31`;

const today = new Date();
today.setHours(0, 0, 0, 0);
const lockCutoff = new Date(today);
lockCutoff.setDate(lockCutoff.getDate() - LOCK_DAYS);

// Original classify
function classifyOld(s) {
  const d = new Date(s.date + "T12:00:00");
  const isPast = d < today;
  const isOverdue = d < lockCutoff;
  if (s.hasAct && !s.anyNonZeroAct) return "no-service";
  if (s.hasAct) return "entered";
  if (isPast && isOverdue) return "overdue";
  if (isPast) return "needs-entry";
  return "future";
}

// Proposed classify
function classifyNew(s) {
  const d = new Date(s.date + "T12:00:00");
  const isPast = d < today;
  const isOverdue = d < lockCutoff;
  if (s.hasAct && !s.anyNonZeroAct) return "no-service";
  if (s.hasAct) return "entered";
  // NEW: projection-all-zero + no-actuals -> planned off-day
  if (s.hasProj && !s.anyNonZeroProj && !s.hasAct) return "no-service";
  if (isPast && isOverdue) return "overdue";
  if (isPast) return "needs-entry";
  return "future";
}

async function fetchAllPaginated(buildQuery) {
  const PAGE = 1000;
  const out = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

console.log("══════ CLASSIFY-FIX IMPACT COUNT (2026) ══════\n");
console.log(`today=${today.toISOString().slice(0,10)}  lockCutoff=${lockCutoff.toISOString().slice(0,10)}\n`);

// Header: per-account summary
console.log("Account         total_flips  from_overdue  from_needs    from_future  date_range");
console.log("--------------  -----------  ------------  -----------   -----------  ------------------------");

const allFlipDates = []; // for global summary

for (const acct of ACCOUNTS) {
  const rows = await fetchAllPaginated(() =>
    supa.from("sc_daily_revenue")
      .select("service_date, service_id, projected_count, actual_count, has_actuals, has_projection")
      .eq("account_key", acct)
      .gte("service_date", first)
      .lte("service_date", last)
      .order("service_date", { ascending: true })
      .order("service_id", { ascending: true })
  );

  // Build per-day state (same shape as classify input)
  const dayState = new Map();
  for (const r of rows) {
    let st = dayState.get(r.service_date);
    if (!st) {
      st = { date: r.service_date, hasAct: false, anyNonZeroAct: false, hasProj: false, anyNonZeroProj: false };
      dayState.set(r.service_date, st);
    }
    if (r.has_actuals) st.hasAct = true;
    if (r.has_projection) st.hasProj = true;
    if (r.actual_count != null && Number(r.actual_count) > 0) st.anyNonZeroAct = true;
    if (r.projected_count != null && Number(r.projected_count) > 0) st.anyNonZeroProj = true;
  }

  const flips = [];
  for (const st of dayState.values()) {
    const oldS = classifyOld(st);
    const newS = classifyNew(st);
    if (oldS !== newS) flips.push({ date: st.date, oldStatus: oldS, newStatus: newS });
  }

  // Bucket by old status
  const buckets = { overdue: 0, "needs-entry": 0, future: 0, other: 0 };
  for (const f of flips) {
    if (f.oldStatus === "overdue") buckets.overdue++;
    else if (f.oldStatus === "needs-entry") buckets["needs-entry"]++;
    else if (f.oldStatus === "future") buckets.future++;
    else buckets.other++;
  }

  const dates = flips.map((f) => f.date).sort();
  const range = dates.length === 0 ? "-" : `${dates[0]}..${dates[dates.length-1]}`;

  console.log(`${acct.padEnd(14)}  ${String(flips.length).padStart(11)}  ${String(buckets.overdue).padStart(12)}  ${String(buckets["needs-entry"]).padStart(11)}  ${String(buckets.future).padStart(11)}  ${range}`);

  // Track for global summary
  for (const f of flips) allFlipDates.push({ account: acct, ...f });
}

// Global view: by current status across all accounts
const totals = { overdue: 0, "needs-entry": 0, future: 0, other: 0 };
for (const f of allFlipDates) {
  if (totals[f.oldStatus] != null) totals[f.oldStatus]++;
  else totals.other++;
}

console.log("\n══════ GLOBAL ══════");
console.log(`total flips:           ${allFlipDates.length}`);
console.log(`  from 'overdue'  (red):    ${totals.overdue}`);
console.log(`  from 'needs-entry' (yel): ${totals["needs-entry"]}`);
console.log(`  from 'future'  (blank):   ${totals.future}`);

// Sample of the past-day flips (most behavior-relevant)
const pastFlips = allFlipDates.filter((f) => f.oldStatus === "overdue" || f.oldStatus === "needs-entry");
if (pastFlips.length > 0) {
  console.log(`\n══════ Sample of past-day flips (overdue + needs-entry) ══════`);
  console.log(`Account         date         was        -> would_become`);
  // Sort by account then date, show first 30
  pastFlips.sort((a, b) => a.account.localeCompare(b.account) || a.date.localeCompare(b.date));
  for (const f of pastFlips.slice(0, 30)) {
    console.log(`  ${f.account.padEnd(14)}  ${f.date}  ${f.oldStatus.padEnd(12)}-> ${f.newStatus}`);
  }
  if (pastFlips.length > 30) console.log(`  ... +${pastFlips.length - 30} more`);
}
