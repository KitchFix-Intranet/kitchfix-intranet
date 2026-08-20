// scripts/_probe_v42_render_volume.mjs
//
// Report the actual per-account render volume the V42 board will
// paint on first look. Kevin: "18 anomalies spread across 8 accounts
// and 3a firing on four accounts is a lot of amber - if it reads as
// noise we should know now rather than after Jen sees it."
//
// State 2 (actionable, amber):        any week with any anomaly > 0
// State 3a (hygiene, amber-soft):     closed week + drafts + no unpriced
// State 3b (money, red-adjacent):     closed week + unpriced_hrs > 0
//
// Counts weeks-per-account for each state, so the tally reflects the
// actual number of amber chips a user would see when they land on
// each account's board.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const todayISO = new Date().toISOString().slice(0, 10);

console.log("=".repeat(72));
console.log(`V42 render-volume tally  (as of ${todayISO})`);
console.log("=".repeat(72));

// Pull the full worker-week grain for FY2026 forward. Aggregate to
// week granularity per account, then classify by state. Grouping
// happens client-side to match the board's exact classification.
// Paginate: supabase-js caps a single select at 1000 rows. labor_actuals
// has ~2,300 rows for FY2026, so a single call would drop half.
async function fetchAllRows() {
  const PAGE = 1000;
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supa.from("labor_actuals")
      .select("account_key, week_start, week_end, hours_without_dollars, draft_entry_count, anomaly_no_clockout, anomaly_under_1h, anomaly_over_16h")
      .gte("week_start", "2025-12-29")
      .order("week_start")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`labor_actuals read: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}
const data = await fetchAllRows();

const perAccount = new Map();
for (const r of data || []) {
  const acct = r.account_key;
  const wk = r.week_start;
  const k = `${acct}|${wk}`;
  const cur = perAccount.get(k) || {
    account: acct, week: wk, week_end: r.week_end,
    unpriced: 0, drafts: 0, noc: 0, u1: 0, o16: 0,
  };
  cur.unpriced += Number(r.hours_without_dollars || 0);
  cur.drafts   += Number(r.draft_entry_count || 0);
  cur.noc      += Number(r.anomaly_no_clockout || 0);
  cur.u1       += Number(r.anomaly_under_1h    || 0);
  cur.o16      += Number(r.anomaly_over_16h    || 0);
  perAccount.set(k, cur);
}

// Classify each (account, week) into a state.
const byAcctState = new Map();   // account -> { s2: [{wk, counts}], s3a: [], s3b: [] }
function pushState(acct, state, entry) {
  const cur = byAcctState.get(acct) || { s2: [], s3a: [], s3b: [] };
  cur[state].push(entry);
  byAcctState.set(acct, cur);
}

for (const w of perAccount.values()) {
  const isClosed  = w.week_end < todayISO;
  const anomalies = w.noc + w.u1 + w.o16;
  const unpriced  = w.unpriced;
  if (anomalies > 0) {
    pushState(w.account, "s2", { week: w.week, noc: w.noc, u1: w.u1, o16: w.o16 });
  }
  if (isClosed && unpriced > 0.004) {
    pushState(w.account, "s3b", { week: w.week, unpriced: unpriced, drafts: w.drafts });
  } else if (isClosed && w.drafts > 0) {
    pushState(w.account, "s3a", { week: w.week, drafts: w.drafts });
  }
}

const accts = [...byAcctState.keys()].sort();

console.log("");
console.log("Per-account chip counts");
console.log("─".repeat(72));
console.log("account          State 2  State 3a  State 3b   total amber chips");
console.log("─".repeat(72));
let totS2 = 0, tot3a = 0, tot3b = 0;
for (const a of accts) {
  const s = byAcctState.get(a);
  const c2 = s.s2.length, c3a = s.s3a.length, c3b = s.s3b.length;
  totS2 += c2; tot3a += c3a; tot3b += c3b;
  console.log(`${a.padEnd(14)}   ${String(c2).padStart(6)}   ${String(c3a).padStart(7)}   ${String(c3b).padStart(7)}          ${String(c2 + c3a + c3b).padStart(3)}`);
}
console.log("─".repeat(72));
console.log(`TOTAL            ${String(totS2).padStart(6)}   ${String(tot3a).padStart(7)}   ${String(tot3b).padStart(7)}          ${String(totS2 + tot3a + tot3b).padStart(3)}`);

// Show the actual chips inside each state so Kevin can eyeball the
// "reads as noise" question with real substance.
console.log("");
console.log("State 2 chips (actionable amber)");
console.log("─".repeat(72));
for (const a of accts) {
  const s = byAcctState.get(a).s2;
  if (s.length === 0) continue;
  for (const c of s) {
    const parts = [];
    if (c.noc > 0) parts.push(`${c.noc} never clocked out`);
    if (c.u1 > 0)  parts.push(`${c.u1} under 1h`);
    if (c.o16 > 0) parts.push(`${c.o16} over 16h`);
    console.log(`  ${a.padEnd(14)}  wk ${c.week}   ${parts.join(", ")}`);
  }
}

console.log("");
console.log("State 3a chips (closed week awaiting approval, dollars complete)");
console.log("─".repeat(72));
for (const a of accts) {
  const s = byAcctState.get(a).s3a;
  if (s.length === 0) continue;
  for (const c of s) {
    console.log(`  ${a.padEnd(14)}  wk ${c.week}   ${c.drafts} draft entries`);
  }
}

console.log("");
console.log("State 3b chips (closed week understated, money signal)");
console.log("─".repeat(72));
if (tot3b === 0) {
  console.log("  (none - the loudest flag is wired and silent)");
} else {
  for (const a of accts) {
    const s = byAcctState.get(a).s3b;
    if (s.length === 0) continue;
    for (const c of s) {
      console.log(`  ${a.padEnd(14)}  wk ${c.week}   ${c.unpriced.toFixed(2)} hrs unpriced (+ ${c.drafts} drafts)`);
    }
  }
}

console.log("");
console.log("=".repeat(72));
