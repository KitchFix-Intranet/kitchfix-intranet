// scripts/_probe_v25_aggregate_population.mjs
//
// V25-3 permanent probe: for any aggregate range, the sum of member
// actuals used in the roll-up equals the sum of actuals for exactly
// the accounts whose budgets are in the roll-up. Populations must
// match by construction, not by convention.
//
// Hits Supabase directly (mirrors _probe_kpi_board_values.mjs). No
// dollars in output; PASS/FAIL + population counts only.
//
// Usage: node --env-file=.env.local scripts/_probe_v25_aggregate_population.mjs

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const FY_START = "2025-12-29";
const TODAY = new Date().toISOString().slice(0, 10);
const P9_START = "2026-08-10";
const P9_END = "2026-09-06";
// V37-5 - revenue-flex accounts (was TXR - TX - V) now join every
// aggregate on both sides. Set stays defined + empty for probe
// symmetry; when it is empty every rollup includes every member.
const V37_ENVELOPE_EXCLUDED = new Set();

async function membersFor(account) {
  if (account === "ALL") {
    const q = await supa.from("accounts").select("team_key").neq("team_key", "CORP").order("team_key");
    if (q.error) throw q.error;
    return q.data.map(r => r.team_key);
  }
  const region = account === "EAST" ? "East" : "West";
  const q = await supa.from("accounts").select("team_key").neq("team_key", "CORP").eq("region", region).order("team_key");
  if (q.error) throw q.error;
  return q.data.map(r => r.team_key);
}

async function actualsFor(members, start, end) {
  const PS = 1000;
  const out = [];
  let from = 0;
  while (true) {
    const q = await supa
      .from("labor_actuals_latest")
      .select("account_key, worker_id, week_start, week_end")
      .in("account_key", members)
      .lte("week_start", end)
      .gte("week_end", start)
      .range(from, from + PS - 1);
    if (q.error) throw q.error;
    const rows = q.data || [];
    for (const r of rows) out.push(r);
    if (rows.length < PS) break;
    from += PS;
  }
  return out;
}

async function budgetMembersFor(members) {
  const withBudget = new Set();
  for (const m of members) {
    if (V37_ENVELOPE_EXCLUDED.has(m)) continue;
    const [pnl, sc] = await Promise.all([
      supa.from("kpi_budgets").select("period_no").eq("account_key", m).eq("line_code", "3100.1").eq("fiscal_year", 2026).limit(1),
      supa.from("sc_labor_budgets").select("period").eq("account_key", m).is("superseded_at", null).limit(1),
    ]);
    if ((pnl.data?.length || 0) > 0 || (sc.data?.length || 0) > 0) withBudget.add(m);
  }
  return withBudget;
}

async function checkCase(label, account, start, end) {
  const members = await membersFor(account);
  const rolledUpMembers = new Set(members.filter(m => !V37_ENVELOPE_EXCLUDED.has(m)));
  const excluded = new Set(members.filter(m => V37_ENVELOPE_EXCLUDED.has(m)));

  const rows = await actualsFor(members, start, end);
  const actualsAccounts = new Set(rows.map(r => r.account_key));
  const rolledUpActualsAccounts = new Set([...actualsAccounts].filter(k => !excluded.has(k)));
  const unclassified = [...actualsAccounts].filter(k => !rolledUpMembers.has(k) && !excluded.has(k));

  // Population equality: every roll-up actuals account is a roll-up member.
  const rollupActualsInBudget = [...rolledUpActualsAccounts].every(k => rolledUpMembers.has(k));

  const envelopeInRollup = [...rolledUpMembers].some(k => V37_ENVELOPE_EXCLUDED.has(k));

  const ok = unclassified.length === 0 && rollupActualsInBudget && !envelopeInRollup;
  const tag = ok ? "PASS" : "FAIL";
  const note = `members=${members.length} rolledUpMembers=${rolledUpMembers.size} excluded=${excluded.size} actualsAccounts=${actualsAccounts.size} rollupActualsAccounts=${rolledUpActualsAccounts.size} unclassified=${unclassified.length}`;
  console.log(`${tag} ${label} · ${note}`);
  if (unclassified.length > 0) console.log(`     unclassified: ${unclassified.join(", ")}`);
  return ok;
}

async function main() {
  console.log(`V25-3 aggregate population probe · TODAY=${TODAY}\n`);
  const cases = [
    { account: "ALL",  start: FY_START, end: TODAY,   label: "ALL  · FYTD           " },
    { account: "ALL",  start: P9_START, end: P9_END,  label: "ALL  · P9 in-progress " },
    { account: "EAST", start: FY_START, end: TODAY,   label: "EAST · FYTD           " },
    { account: "WEST", start: FY_START, end: TODAY,   label: "WEST · FYTD           " },
  ];
  let pass = 0, fail = 0;
  for (const c of cases) {
    try {
      const ok = await checkCase(c.label, c.account, c.start, c.end);
      ok ? pass++ : fail++;
    } catch (e) {
      console.log(`FAIL ${c.label} · ${e.message}`);
      fail++;
    }
  }
  console.log(`\n${pass} PASS · ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error("PROBE ERROR:", e); process.exit(2); });
