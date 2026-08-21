// PROBE 2 for R3-2 (2026-08-01, read-only, optional).
// AMENDED 2026-08-01 per owner ruling: original signature was confounded
// by no-service saves. Now reports two numbers.
//
// Q: how often has the Match-fill zero trap fired in production since
//    the Match/Clear machinery shipped (620ee39, 2026-07-28)?
//
// Trap signature: a per-meal account row on sc_daily_revenue where
//   has_actuals = true       (operator wrote something)
//   actual_count = 0         (they wrote a zero)
//   has_projection = false   (no projection existed for this service+day)
// = "written zero for an unprojected service."
//
// CONFOUND: Mark-no-service (DayEntryV2.js:471) writes exactly this
// signature by design - {colIndex, value: 0} for every in-service
// service, no projection test. Every no-service day on a mixed group
// produces trap-signature rows that are intentional operator actions,
// not Match zero-fills. Discriminator: no-service saves write the
// literal audit note "Service cancelled - marked no service" via
// addDayNoteEntry (route.js:882) into sc_day_note_entries. Exclude
// (account, date) pairs carrying that note; whatever survives is
// the Match population.
//
// Window: Jul 18+ per owner. (Match landed Jul 28; picking Jul 18 covers
// the earlier `fillGroupWithProjections` era from the entry-redesign
// import, when auto-fill without Clear was live.)
//
// Non-fee only (STL - FL never had Match render, so cannot have fired
// the trap on that account).

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const WINDOW_START = "2026-07-18";

const { data: accts } = await supa
  .from("accounts")
  .select("team_key, billing_model, has_homestand_schedule");

const nonFee = accts
  .filter((a) => !(a.billing_model === "flat_fee" && !a.has_homestand_schedule))
  .map((a) => a.team_key);

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

let hits = [];
for (const key of nonFee) {
  const rows = await fetchAll(
    supa
      .from("sc_daily_revenue")
      .select("account_key, service_date, service_name, group_name, actual_count, has_actuals, has_projection")
      .eq("account_key", key)
      .gte("service_date", WINDOW_START)
      .eq("has_actuals", true)
      .eq("actual_count", 0)
      .eq("has_projection", false)
  );
  hits.push(...rows);
}

const rawCount = hits.length;

// No-service discriminator: pull every (account, date) pair with the
// literal audit note. Any trap-signature row on such a pair is a
// no-service save, not a Match zero-fill.
const noServiceKeys = new Set();
for (const key of nonFee) {
  const rows = await fetchAll(
    supa
      .from("sc_day_note_entries")
      .select("account_key, service_date, note")
      .eq("account_key", key)
      .gte("service_date", WINDOW_START)
      .ilike("note", "%Service cancelled - marked no service%")
  );
  for (const r of rows) noServiceKeys.add(`${r.account_key}|${r.service_date}`);
}
console.log(`no-service audit-note (account,date) pairs since ${WINDOW_START}: ${noServiceKeys.size}`);

const matchOnly = hits.filter((h) => !noServiceKeys.has(`${h.account_key}|${h.service_date}`));

console.log(`\n=== trap-signature rows since ${WINDOW_START} (non-fee accounts) ===`);
console.log(`raw signature (has_actuals + actual_count=0 + !has_projection): ${rawCount}`);
console.log(`no-service-excluded (Match-attributable population):            ${matchOnly.length}`);

if (matchOnly.length === 0) {
  console.log("\nZero Match-attributable trap firings. The audit found a theoretical wound.");
  if (rawCount > 0) {
    console.log(`(All ${rawCount} raw-signature rows are on no-service days per the audit-note discriminator.)`);
  }
} else {
  const byAccount = new Map();
  for (const h of matchOnly) byAccount.set(h.account_key, (byAccount.get(h.account_key) || 0) + 1);
  console.log(`\nby account (Match-attributable):`);
  for (const [k, n] of [...byAccount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(15)} ${n}`);
  }
  console.log(`\nfirst 15 rows:`);
  for (const h of matchOnly.slice(0, 15)) {
    console.log(`  ${h.account_key.padEnd(15)} ${h.service_date}  ${(h.service_name || "").padEnd(30)}  group=${h.group_name}`);
  }
}
