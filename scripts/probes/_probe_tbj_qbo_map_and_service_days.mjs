// _probe_tbj_qbo_map_and_service_days.mjs
// 2026-09-09 - report support for adding Media Meals + Scout Meals
// to sc_qbo_service_map for TBJ - FL.
//
// Reports:
//   1) Current sc_qbo_service_map rows for TBJ - FL (all fields)
//      so the new rows land in the right shape.
//   2) TBJ - FL sc_services rows for Media Meals and Scout Meals
//      (so we have the actual service_id + is_flat_fee + is_tax_free).
//   3) All TBJ - FL service_dates in FY2026 where Media Meals OR
//      Scout Meals had non-zero actuals OR projections. For each,
//      also report which OTHER services on the same account had
//      actuals/projections on that same date. This is the check
//      Kevin asked for: whether Media Meals or Scout Meals ever
//      share an invoice-week with the meal services, which would
//      change the slot recommendation.
//
// Run:
//   node --env-file=.env.local scripts/probes/_probe_tbj_qbo_map_and_service_days.mjs

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const ACCOUNT = "TBJ - FL";
const YEAR = 2026;

// ─── 1. Current sc_qbo_service_map rows for TBJ - FL ───────────────
console.log(`\n─── sc_qbo_service_map current rows for ${ACCOUNT} ───\n`);
const mapRes = await supa
  .from("sc_qbo_service_map")
  .select("service_id, qbo_item_id, qbo_line_description, aggregate_group, invoice_slot, tax_override, line_desc_style, active")
  .eq("account_key", ACCOUNT)
  .order("invoice_slot", { ascending: true })
  .order("aggregate_group", { ascending: true, nullsFirst: false });
if (mapRes.error) { console.error(mapRes.error.message); process.exit(2); }

const slotSet = new Set();
const groupSet = new Set();
for (const r of mapRes.data) {
  slotSet.add(r.invoice_slot);
  if (r.aggregate_group) groupSet.add(r.aggregate_group);
  console.log(`  ${r.qbo_item_id.padEnd(6)}  ${(r.qbo_line_description || "").padEnd(50)}  slot=${r.invoice_slot.padEnd(6)}  group=${r.aggregate_group || "(none)"}  tax=${r.tax_override || "TAX"}  desc=${r.line_desc_style || "(none)"}`);
}
console.log(`\n  slots in use: ${[...slotSet].sort().join(", ")}`);
console.log(`  groups in use: ${[...groupSet].sort().join(", ") || "(none)"}\n`);

// ─── 2. sc_services rows for the two services we're mapping ────────
console.log(`─── sc_services rows for the new mappings ─────────────\n`);
const svcRes = await supa
  .from("sc_services")
  .select("id, service_name, is_flat_fee, is_tax_free, is_non_revenue, active, active_until")
  .eq("account_key", ACCOUNT)
  .in("service_name", ["Media Meals", "Scout Meals"])
  .is("deleted_at", null);
if (svcRes.error) { console.error(svcRes.error.message); process.exit(2); }

const targetIds = [];
for (const s of svcRes.data) {
  console.log(`  ${s.service_name.padEnd(20)}  id=${s.id}  active=${s.active}  active_until=${s.active_until || "(none)"}  flat_fee=${s.is_flat_fee}  tax_free=${s.is_tax_free}`);
  targetIds.push({ id: s.id, name: s.service_name });
}
if (svcRes.data.length !== 2) {
  console.error(`\n  WARNING: expected 2 services, got ${svcRes.data.length}. Verify service names match exactly.`);
}
console.log();

// Check whether either is already mapped.
console.log(`─── Are these already in sc_qbo_service_map? ──────────\n`);
const alreadyMapped = mapRes.data.filter((r) => targetIds.some((t) => t.id === r.service_id));
if (alreadyMapped.length > 0) {
  for (const m of alreadyMapped) {
    const t = targetIds.find((t) => t.id === m.service_id);
    console.log(`  ${t.name}: ALREADY MAPPED to ${m.qbo_item_id} ${m.qbo_line_description} slot=${m.invoice_slot} - migration would need ON CONFLICT UPDATE`);
  }
} else {
  console.log(`  Neither is currently in sc_qbo_service_map. Clean INSERT.`);
}
console.log();

// ─── 3. Every date + week where Media Meals or Scout Meals had
//     activity, alongside every OTHER TBJ - FL service that had
//     activity in the SAME week. This is the slot check.
console.log(`─── Historical activity: Media/Scout Meals + peers ────\n`);

if (targetIds.length === 0) {
  console.log(`  Cannot check history - no matching sc_services rows.\n`);
  process.exit(0);
}

// Fetch actuals + projections on Media/Scout dates.
const targetIdSet = new Set(targetIds.map((t) => t.id));
const [actRes, projRes] = await Promise.all([
  supa.from("sc_daily_actuals")
    .select("service_id, service_date, actual_count")
    .eq("account_key", ACCOUNT)
    .in("service_id", [...targetIdSet])
    .gt("actual_count", 0)
    .gte("service_date", `${YEAR}-01-01`).lte("service_date", `${YEAR}-12-31`),
  supa.from("sc_daily_projections")
    .select("service_id, service_date, projected_count")
    .eq("account_key", ACCOUNT)
    .in("service_id", [...targetIdSet])
    .gt("projected_count", 0)
    .gte("service_date", `${YEAR}-01-01`).lte("service_date", `${YEAR}-12-31`),
]);
if (actRes.error)  { console.error(actRes.error.message); process.exit(2); }
if (projRes.error) { console.error(projRes.error.message); process.exit(2); }

// Union of dates.
const activityByDate = new Map(); // date -> { services: Set<serviceId> }
for (const r of actRes.data) {
  if (!activityByDate.has(r.service_date)) activityByDate.set(r.service_date, { services: new Set() });
  activityByDate.get(r.service_date).services.add(r.service_id);
}
for (const r of projRes.data) {
  if (!activityByDate.has(r.service_date)) activityByDate.set(r.service_date, { services: new Set() });
  activityByDate.get(r.service_date).services.add(r.service_id);
}
const activeDates = [...activityByDate.keys()].sort();

if (activeDates.length === 0) {
  console.log(`  No historical activity found for Media Meals or Scout Meals in ${YEAR}.\n`);
  console.log(`  (Kevin's report mentioned three failing weeks: Jan 26, Feb 16, Jun 1.\n  If the counts were entered but the finalize threw, they may not be in\n  sc_daily_actuals. Check sc_daily_projections in the same window.)`);
  process.exit(0);
}

console.log(`  ${activeDates.length} dates with Media/Scout activity in ${YEAR}\n`);

// Determine each date's ISO week (Mon-Sun).
function mondayOf(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

// For each week that contains Media/Scout activity, pull every OTHER
// service's activity for the same week.
const weekSet = new Set(activeDates.map(mondayOf));
console.log(`  Weeks (Mon-Sun) containing Media/Scout activity: ${[...weekSet].sort().join(", ")}\n`);

// All TBJ - FL services (for name resolution + to see which services
// SHARED the invoice-week).
const allSvcRes = await supa
  .from("sc_services")
  .select("id, service_name, is_flat_fee")
  .eq("account_key", ACCOUNT)
  .is("deleted_at", null);
const svcName = new Map();
for (const s of allSvcRes.data) svcName.set(s.id, s.service_name);

// For each week, list every service that had ANY activity that week.
for (const wkStart of [...weekSet].sort()) {
  const wkEnd = (() => {
    const d = new Date(`${wkStart}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 6);
    return d.toISOString().slice(0, 10);
  })();
  const [wkAct, wkProj] = await Promise.all([
    supa.from("sc_daily_actuals")
      .select("service_id, service_date, actual_count")
      .eq("account_key", ACCOUNT)
      .gt("actual_count", 0)
      .gte("service_date", wkStart).lte("service_date", wkEnd),
    supa.from("sc_daily_projections")
      .select("service_id, service_date, projected_count")
      .eq("account_key", ACCOUNT)
      .gt("projected_count", 0)
      .gte("service_date", wkStart).lte("service_date", wkEnd),
  ]);
  const bucket = new Map(); // service_id -> { proj, act }
  for (const r of (wkAct.data || [])) {
    if (!bucket.has(r.service_id)) bucket.set(r.service_id, { proj: 0, act: 0 });
    bucket.get(r.service_id).act += Number(r.actual_count) || 0;
  }
  for (const r of (wkProj.data || [])) {
    if (!bucket.has(r.service_id)) bucket.set(r.service_id, { proj: 0, act: 0 });
    bucket.get(r.service_id).proj += Number(r.projected_count) || 0;
  }
  console.log(`  Week ${wkStart} .. ${wkEnd}`);
  const rows = [...bucket.entries()].map(([sid, v]) => ({
    sid, name: svcName.get(sid) || `(unknown ${sid})`, ...v,
    isTarget: targetIdSet.has(sid),
  }));
  rows.sort((a, b) => (b.isTarget - a.isTarget) || a.name.localeCompare(b.name));
  const targetsInWeek = rows.filter((r) => r.isTarget).map((r) => r.name);
  const peersInWeek = rows.filter((r) => !r.isTarget).map((r) => r.name);
  console.log(`    Media/Scout services present:  ${targetsInWeek.join(", ") || "(none)"}`);
  console.log(`    Other services present:        ${peersInWeek.length ? peersInWeek.join(", ") : "(none - Media/Scout WOULD be the only lines this week)"}`);
  for (const r of rows) {
    const tag = r.isTarget ? " ← TARGET" : "";
    console.log(`      ${r.name.padEnd(30)}  proj=${String(r.proj).padStart(5)}  act=${String(r.act).padStart(5)}${tag}`);
  }
  console.log(``);
}

process.exit(0);
