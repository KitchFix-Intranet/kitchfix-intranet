// Replicates the orchestrator's loadYearSummary classify() logic per
// account, end-to-end, using fetchAllPaginated against sc_daily_revenue.
// Reports per-account status breakdown for 2026 and flags any day where
// month-view would show data (has_actuals or has_projection) but
// year-view would render as no-service.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const YEAR = 2026;
const LOCK_DAYS = 7; // mirror orchestrator
const ACCOUNTS = ["CIN - AZ","CIN - KY","CIN - OH","STL - FL","STL - MO","TBJ - FL","TBJ - NY","TBR - FL","TXR - AZ","TXR - TX - H","TXR - TX - V"];

const first = `${YEAR}-01-01`;
const last  = `${YEAR}-12-31`;

const today = new Date();
today.setHours(0, 0, 0, 0);
const lockCutoff = new Date(today);
lockCutoff.setDate(lockCutoff.getDate() - LOCK_DAYS);

function classify(s) {
  const d = new Date(s.date + "T12:00:00");
  const isPast = d < today;
  const isOverdue = d < lockCutoff;
  if (s.hasAct && !s.anyNonZeroAct) return "no-service";
  if (s.hasAct) return "entered";
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

console.log("══════ YEAR-VIEW CLASSIFY AUDIT (2026) ══════\n");
console.log(`today=${today.toISOString().slice(0,10)}  lockCutoff=${lockCutoff.toISOString().slice(0,10)}\n`);

console.log("Account         days  entered  no-serv  overdue  needs    future  potential_missed");
console.log("--------------  ----  -------  -------  -------  -----    ------  ----------------");

for (const acct of ACCOUNTS) {
  const rows = await fetchAllPaginated(() =>
    supa.from("sc_daily_revenue")
      .select("service_date, service_id, projected_count, actual_count, has_actuals, has_projection, game_type")
      .eq("account_key", acct)
      .gte("service_date", first)
      .lte("service_date", last)
      .order("service_date", { ascending: true })
      .order("service_id", { ascending: true })
  );

  const dayState = new Map();
  for (const r of rows) {
    let st = dayState.get(r.service_date);
    if (!st) {
      st = {
        date: r.service_date,
        hasAct: false,
        anyNonZeroAct: false,
        hasProj: false,
        anyNonZeroProj: false,
      };
      dayState.set(r.service_date, st);
    }
    if (r.has_actuals) st.hasAct = true;
    if (r.has_projection) st.hasProj = true;
    if (r.actual_count != null && Number(r.actual_count) > 0) st.anyNonZeroAct = true;
    if (r.projected_count != null && Number(r.projected_count) > 0) st.anyNonZeroProj = true;
  }

  const counts = { entered: 0, "no-service": 0, overdue: 0, "needs-entry": 0, future: 0 };
  const potentialMissed = [];
  for (const st of dayState.values()) {
    const status = classify(st);
    counts[status]++;
    // POTENTIAL MISSED: day has non-zero projections OR actuals data (the
    // month-view will show something), but year-view classifies as no-service
    // or empty in a way that hides it.
    // (Pagination cap bug shape from #159: dayState missing this date entirely
    //  -> day doesn't appear -> rendered as transparent/grey. With pagination
    //  fix, dayState should include every date that has any sc_daily_revenue row.)
    if (status === "no-service" && st.anyNonZeroProj) {
      potentialMissed.push({ date: st.date, reason: "no-service status but non-zero projection exists" });
    }
  }

  const total = dayState.size;
  console.log(`${acct.padEnd(14)}  ${String(total).padStart(4)}  ${String(counts.entered).padStart(7)}  ${String(counts["no-service"]).padStart(7)}  ${String(counts.overdue).padStart(7)}  ${String(counts["needs-entry"]).padStart(5)}  ${String(counts.future).padStart(6)}  ${String(potentialMissed.length).padStart(16)}`);

  if (potentialMissed.length > 0 && potentialMissed.length <= 10) {
    for (const p of potentialMissed) console.log(`    ${p.date}  ${p.reason}`);
  } else if (potentialMissed.length > 10) {
    for (const p of potentialMissed.slice(0, 5)) console.log(`    ${p.date}  ${p.reason}`);
    console.log(`    ... +${potentialMissed.length - 5} more`);
  }
}

// PAGINATION SANITY: verify total sc_daily_revenue rows per account exceed 1000
// (the historical silent-cap threshold) -- if the pagination fix is regressed,
// large accounts would only get the first 1000 rows back.
console.log("\n══════ PAGINATION SANITY (sc_daily_revenue row counts per account) ══════");
for (const acct of ACCOUNTS) {
  const { count } = await supa.from("sc_daily_revenue")
    .select("*", { count: "exact", head: true })
    .eq("account_key", acct)
    .gte("service_date", first)
    .lte("service_date", last);
  const flag = count > 1000 ? "  (>1000 - pagination required)" : "";
  console.log(`  ${acct.padEnd(14)}  rows=${String(count).padStart(5)}${flag}`);
}
