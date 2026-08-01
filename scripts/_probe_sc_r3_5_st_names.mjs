// PROBE A for R3-5 (2026-08-01, read-only).
//
// Q: which accounts have services whose name ends in " - ST"?
//    If STL - FL is the only one, the R3-5 section construct is self-
//    fencing via name-suffix match and no allow-list is needed.
//    If other accounts have them, stop and report - extending to
//    additional accounts is a scope decision owner owns.
//
// Signal: sc_services.service_name ends in " - ST" (case-sensitive,
// matches the four seed services rendered in RENDER_STL_FL_SPRING_
// TRAINING.html: "Breakfast - ST", "Lunch - ST", plus whatever tier
// pair the account carries). Include archived services (active_until
// set) so a future R3-5 rebuild does not miss retired ST variants
// that might resurface next season.
//
// Join sc_services -> sc_service_groups -> account_key. Group in JS.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function fetchAll(query) {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

// Pull all services carrying the " - ST" suffix on service_name.
// ilike is PostgREST's case-insensitive LIKE. Use "%- ST" so we catch
// literal " - ST" endings (not "-ST" or "- st").
const services = await fetchAll(
  supa
    .from("sc_services")
    .select("id, service_name, group_id, active_until")
    .ilike("service_name", "%- ST")
);

console.log(`sc_services rows matching name LIKE '%- ST': ${services.length}`);

// Resolve each service_name to its account via sc_service_groups.
const groupIds = [...new Set(services.map((s) => s.group_id))];
const { data: groups, error: gErr } = await supa
  .from("sc_service_groups")
  .select("id, group_name, account_key")
  .in("id", groupIds);
if (gErr) { console.error(gErr.message); process.exit(1); }
const groupById = new Map(groups.map((g) => [g.id, g]));

// Aggregate: account -> [{name, group, active}]
const byAccount = new Map();
for (const s of services) {
  const g = groupById.get(s.group_id);
  const acct = g?.account_key || "(unknown)";
  if (!byAccount.has(acct)) byAccount.set(acct, []);
  byAccount.get(acct).push({
    name: s.service_name,
    group: g?.group_name || "(unknown)",
    active: !s.active_until,
    activeUntil: s.active_until,
  });
}

console.log(`\n=== accounts carrying " - ST" services ===`);
console.log(`account count: ${byAccount.size}`);
for (const [acct, arr] of [...byAccount.entries()].sort()) {
  console.log(`\n${acct}  (${arr.length} services)`);
  for (const s of arr.sort((a, b) => a.name.localeCompare(b.name))) {
    const status = s.active ? "LIVE" : `archived ${s.activeUntil}`;
    console.log(`  ${s.name.padEnd(35)} group=${s.group.padEnd(25)} [${status}]`);
  }
}

if (byAccount.size === 1 && byAccount.has("STL - FL")) {
  console.log(`\nCONSTRUCT SELF-FENCING: only STL - FL carries " - ST" services.`);
  console.log(`Name-suffix match is safe; no allow-list needed.`);
} else {
  console.log(`\nOTHER ACCOUNTS PRESENT: extending to ${byAccount.size} accounts is a scope decision.`);
  console.log(`STOP AND REPORT - owner rules before build.`);
}
