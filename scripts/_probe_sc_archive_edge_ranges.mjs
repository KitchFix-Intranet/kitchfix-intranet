// PROBE: find (account, service, active_until) where active_until sits
// inside a currently-selectable date range on production. Feeds the
// P2B archive-edge guard PR - Chat-Claude needs a real (account, month)
// to gate the fix on. If no such row exists in prod, the fix ships on
// code-level verification only.
//
//   node --env-file=.env.local scripts/_probe_sc_archive_edge_ranges.mjs
//
// Read-only. No writes.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function findArchiveEdges() {
  console.log("\n=== ARCHIVE-EDGE SERVICES (active_until IS NOT NULL) ===\n");

  const { data: services, error } = await supa
    .from("sc_services")
    .select("id, account_key, service_name, active, active_until, group_id")
    .not("active_until", "is", null)
    .order("account_key", { ascending: true })
    .order("active_until", { ascending: true });

  if (error) {
    console.error(`  ERROR reading sc_services: ${error.message}`);
    return { edges: [] };
  }

  if (!services?.length) {
    console.log("  NONE - no services with active_until set on production.");
    console.log("  -> Archive-edge guard runs on code-level verification only.");
    return { edges: [] };
  }

  console.log(`  Found ${services.length} archived services:\n`);
  const todayISO = today();
  const edges = [];
  for (const s of services) {
    const au = String(s.active_until).slice(0, 10);
    const past = au < todayISO;
    const marker = past ? "  [past]" : "  [FUTURE / current]";
    console.log(`  ${s.account_key.padEnd(15)} ${au}  ${marker}  ${s.service_name}`);
    edges.push({
      account_key: s.account_key,
      service_id: s.id,
      service_name: s.service_name,
      active_until: au,
      is_future: !past,
    });
  }

  return { edges, todayISO };
}

async function findSelectableRanges(edges, todayISO) {
  console.log("\n=== SELECTABLE-RANGE OVERLAPS ===\n");
  console.log("A bulk selection can straddle an archive boundary when the drill");
  console.log("window includes dates BEFORE and AFTER a service's active_until.");
  console.log("Bulk on a past drill remains selectable per isBulkSelectable.\n");

  if (!edges.length) return;

  // For each archive edge, compute the fiscal month/year it falls in
  // and check whether that month has any actionable (needs-entry /
  // entered / overdue / future / no-service) days for the account -
  // that IS a "currently bulk-selectable" range from the operator's view.
  const byMonth = new Map();
  for (const e of edges) {
    const mk = e.active_until.slice(0, 7);
    const key = `${e.account_key}|${mk}`;
    if (!byMonth.has(key)) byMonth.set(key, { account_key: e.account_key, month: mk, edges: [] });
    byMonth.get(key).edges.push(e);
  }

  // Check each (account, month) for real day rows on either side of
  // the edge - i.e. the drill would actually contain days both in-
  // service and out-of-service for that service.
  console.log(`  Checking ${byMonth.size} (account, month) pair(s):\n`);
  for (const { account_key, month, edges: mEdges } of byMonth.values()) {
    const monthStart = `${month}-01`;
    const [yr, mo] = month.split("-").map(Number);
    const lastDay = new Date(Date.UTC(yr, mo, 0)).getUTCDate();
    const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}`;

    const { data: rev, error } = await supa
      .from("sc_daily_revenue")
      .select("service_date, service_id")
      .eq("account_key", account_key)
      .gte("service_date", monthStart)
      .lte("service_date", monthEnd)
      .limit(2000);
    if (error) { console.log(`    ${account_key} ${month}  ERROR: ${error.message}`); continue; }

    for (const e of mEdges) {
      const before = rev.filter(r => r.service_date <= e.active_until && r.service_id === e.service_id).length;
      const after = rev.filter(r => r.service_date > e.active_until).length; // any service after (drill still contains days)
      const marker = (before > 0 && after > 0) ? "  <- REAL EDGE" : "";
      console.log(`    ${account_key.padEnd(15)} ${month}  active_until=${e.active_until}  in-svc-days=${before}  post-days=${after}  ${e.service_name}${marker}`);
    }
  }
}

async function main() {
  const { edges, todayISO } = await findArchiveEdges();
  if (edges.length) await findSelectableRanges(edges, todayISO);
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });
