// PROBE (read-only): sc_homestand_schedule facts for the Season Tracker
// retirement scoping. NO WRITES. Owner-authorized read-only round.
//
//   node --env-file=.env.local scripts/_probe_sc_homestand_census.mjs

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const TARGET_ACCOUNTS = ["STL - MO", "CIN - OH", "TXR - TX - H", "TXR - TX - V"];

function monthOf(d) { return String(d).slice(0, 7); }

async function fetchAll(account) {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supa
      .from("sc_homestand_schedule")
      .select("account_key, service_date, day_type, opponent, homestand_id, is_doubleheader")
      .eq("account_key", account)
      .order("service_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { console.error(account, error.message); return []; }
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

async function main() {
  console.log(`=== sc_homestand_schedule census (as of ${new Date().toISOString().slice(0,10)}) ===\n`);

  for (const account of TARGET_ACCOUNTS) {
    const rows = await fetchAll(account);
    if (!rows.length) { console.log(`${account.padEnd(15)} NO ROWS\n`); continue; }
    const dates = rows.map(r => String(r.service_date).slice(0,10));
    const homestands = new Map();
    for (const r of rows) {
      const hs = String(r.homestand_id || "");
      if (!homestands.has(hs)) homestands.set(hs, { first: r.service_date, last: r.service_date, count: 0, opponents: new Set() });
      const b = homestands.get(hs);
      if (r.service_date < b.first) b.first = r.service_date;
      if (r.service_date > b.last) b.last = r.service_date;
      b.count++;
      if (r.opponent) b.opponents.add(r.opponent);
    }
    // day_type distribution
    const dt = new Map();
    for (const r of rows) dt.set(r.day_type, (dt.get(r.day_type) || 0) + 1);
    console.log(`${account}`);
    console.log(`  rows: ${rows.length}`);
    console.log(`  date range: ${dates[0]} .. ${dates[dates.length-1]}`);
    console.log(`  distinct homestand_id: ${homestands.size}`);
    console.log(`  day_type distribution: ${[...dt.entries()].map(([k,v]) => `${k}=${v}`).join(", ")}`);
    console.log(`  is_doubleheader true count: ${rows.filter(r => r.is_doubleheader).length}`);
    // straddle counts
    let monthStraddles = 0, monthStraddleList = [];
    for (const [hs, b] of homestands) {
      if (monthOf(b.first) !== monthOf(b.last)) {
        monthStraddles++;
        monthStraddleList.push(`${hs}(${b.first}..${b.last})`);
      }
    }
    console.log(`  month-straddling homestands: ${monthStraddles}${monthStraddleList.length ? " -> " + monthStraddleList.join(", ") : ""}`);
    // gaps
    const orderedHs = [...homestands.values()].sort((a, b) => a.first.localeCompare(b.first));
    const gaps = [];
    for (let i = 1; i < orderedHs.length; i++) {
      const prevEnd = new Date(orderedHs[i-1].last + "T00:00:00");
      const curStart = new Date(orderedHs[i].first + "T00:00:00");
      const gapDays = Math.round((curStart - prevEnd) / 86400000) - 1;
      gaps.push(gapDays);
    }
    if (gaps.length) {
      const min = Math.min(...gaps);
      const max = Math.max(...gaps);
      const sum = gaps.reduce((a, b) => a + b, 0);
      const avg = (sum / gaps.length).toFixed(1);
      const sorted = [...gaps].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      console.log(`  gap-between-homestands (days): n=${gaps.length}, min=${min}, median=${median}, avg=${avg}, max=${max}`);
      console.log(`  gap distribution: ${gaps.join(",")}`);
    }
    console.log("");
  }

  // Period-straddle count needs sc period boundaries. Try to derive from
  // sc_period_data if it exists; else say unknown.
  const { data: periods, error: perr } = await supa
    .from("sc_period_data")
    .select("*")
    .limit(1);
  if (perr) {
    console.log(`(sc_period_data probe: ${perr.message} - period-straddle census unknown from this probe)`);
  } else {
    console.log(`(sc_period_data probe: table exists, ${periods.length} sample row)`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
