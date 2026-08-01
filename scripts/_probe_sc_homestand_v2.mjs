// PROBE v2 (read-only): sc_homestand_schedule + period-boundary census.
// Excludes empty homestand_id (AWAY-only rows). Reads period ranges from
// sc_day_metadata.period per account.
//
//   node --env-file=.env.local scripts/_probe_sc_homestand_v2.mjs

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const TARGET = ["STL - MO", "CIN - OH", "TXR - TX - H", "TXR - TX - V"];

function monthOf(d) { return String(d).slice(0, 7); }

async function fetchAll(table, filters, cols) {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    let q = supa.from(table).select(cols).range(from, from + PAGE - 1);
    for (const [c, v] of Object.entries(filters)) q = q.eq(c, v);
    q = q.order("service_date", { ascending: true });
    const { data, error } = await q;
    if (error) { console.error(table, error.message); return []; }
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

async function periodsForAccount(account) {
  const rows = await fetchAll("sc_day_metadata", { account_key: account }, "period, service_date");
  const m = new Map();
  for (const r of rows) {
    if (!r.period) continue;
    const cur = m.get(r.period);
    if (!cur) m.set(r.period, { period: r.period, start: r.service_date, end: r.service_date });
    else if (r.service_date > cur.end) cur.end = r.service_date;
  }
  return [...m.values()].sort((a, b) => a.start.localeCompare(b.start));
}

function periodOf(date, periods) {
  for (const p of periods) if (date >= p.start && date <= p.end) return p.period;
  return null;
}

async function main() {
  console.log(`=== sc_homestand_schedule v2 census (today=${new Date().toISOString().slice(0,10)}) ===\n`);

  for (const account of TARGET) {
    const rows = await fetchAll("sc_homestand_schedule", { account_key: account },
      "account_key, service_date, day_type, opponent, homestand_id, is_doubleheader");
    const periods = await periodsForAccount(account);
    if (!rows.length) { console.log(`${account} NO ROWS\n`); continue; }

    // day_type distribution
    const dt = new Map();
    for (const r of rows) dt.set(r.day_type, (dt.get(r.day_type) || 0) + 1);

    // homestand grouping - EXCLUDE empty ids
    const homestands = new Map();
    for (const r of rows) {
      const hs = String(r.homestand_id || "").trim();
      if (!hs) continue;
      if (!homestands.has(hs)) homestands.set(hs, { first: r.service_date, last: r.service_date, count: 0, dayTypes: new Map(), opponents: new Set() });
      const b = homestands.get(hs);
      if (r.service_date < b.first) b.first = r.service_date;
      if (r.service_date > b.last) b.last = r.service_date;
      b.count++;
      b.dayTypes.set(r.day_type, (b.dayTypes.get(r.day_type) || 0) + 1);
      if (r.opponent) b.opponents.add(r.opponent);
    }

    // empty-id rows
    const emptyIdRows = rows.filter(r => !(r.homestand_id && String(r.homestand_id).trim()));

    // straddle counts
    const orderedHs = [...homestands.entries()].sort((a, b) => a[1].first.localeCompare(b[1].first));
    const monthStraddles = orderedHs.filter(([, b]) => monthOf(b.first) !== monthOf(b.last));
    const periodStraddles = orderedHs.filter(([, b]) => {
      const pS = periodOf(b.first, periods);
      const pE = periodOf(b.last, periods);
      return pS !== null && pE !== null && pS !== pE;
    });

    // gaps
    const gaps = [];
    for (let i = 1; i < orderedHs.length; i++) {
      const prev = orderedHs[i - 1][1];
      const cur = orderedHs[i][1];
      const gapDays = Math.round(
        (new Date(cur.first + "T00:00:00") - new Date(prev.last + "T00:00:00")) / 86400000
      ) - 1;
      gaps.push(gapDays);
    }

    console.log(account);
    console.log(`  total rows: ${rows.length}   distinct homestand_id (excl empty): ${homestands.size}`);
    console.log(`  date range: ${rows[0].service_date}..${rows[rows.length-1].service_date}`);
    console.log(`  day_type distribution: ${[...dt.entries()].map(([k,v])=>`${k}=${v}`).join(", ")}`);
    console.log(`  empty-homestand_id rows: ${emptyIdRows.length} (${emptyIdRows.length ? `${emptyIdRows[0].day_type}..${emptyIdRows[emptyIdRows.length-1].day_type} - typically AWAY` : "none"})`);
    console.log(`  is_doubleheader true count: ${rows.filter(r => r.is_doubleheader).length}`);
    console.log(`  periods known for account: ${periods.length}  (from sc_day_metadata.period)`);
    console.log(`  MONTH-straddling homestands: ${monthStraddles.length}${monthStraddles.length ? " -> " + monthStraddles.map(([id, b]) => `${id} (${b.first}..${b.last})`).join(", ") : ""}`);
    console.log(`  PERIOD-straddling homestands: ${periodStraddles.length}${periodStraddles.length ? " -> " + periodStraddles.map(([id, b]) => `${id} (${b.first}..${b.last} : ${periodOf(b.first, periods)} -> ${periodOf(b.last, periods)})`).join(", ") : ""}`);
    if (gaps.length) {
      const min = Math.min(...gaps), max = Math.max(...gaps);
      const sum = gaps.reduce((a,b)=>a+b,0);
      const avg = (sum/gaps.length).toFixed(1);
      const sorted = [...gaps].sort((a,b)=>a-b);
      const median = sorted[Math.floor(sorted.length/2)];
      console.log(`  homestand-gap days (excl empty ids): n=${gaps.length}, min=${min}, median=${median}, avg=${avg}, max=${max}`);
      console.log(`  gap distribution: [${gaps.join(", ")}]`);
    }
    // Show first 3 homestand summaries as samples
    console.log(`  sample homestand rows (first 3):`);
    for (const [id, b] of orderedHs.slice(0, 3)) {
      const dtStr = [...b.dayTypes.entries()].map(([k,v])=>`${k}=${v}`).join(",");
      const opStr = [...b.opponents].join("/");
      console.log(`    ${id}  ${b.first}..${b.last}  ${b.count}rows  {${dtStr}}  vs ${opStr}`);
    }
    console.log("");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
