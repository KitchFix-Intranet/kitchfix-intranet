#!/usr/bin/env node
// scripts/probes/_probe_tbrfl_sc_live_walk.mjs
//
// Kevin blocker 2026-09-02:
//
//   Cap on loadScDailyRevenue must not break TBR - FL when its
//   sc_revenue_live flag flips on next. TBR - FL is currently
//   flag-off in production; the fixture below flips it on IN-PROCESS
//   (a Proxy intercepts .from("kpi_account_flags") on the Supabase
//   client and returns sc_revenue_live=true for TBR - FL). No prod
//   write, no local seed - the flag lives entirely inside this run.
//
//   Walks TBR - FL on three ranges (FYTD, P8 closed, P9 open) and
//   asserts:
//     - resolveOverview does not throw
//     - revenue_source_state === "live" on every range (or "verified"
//       on verified closed periods)
//     - sources.sc_revenue.through_date <= min(range.end, today - 1)
//     - hero_actual is a finite non-negative number
//   (R-52 2026-09-02: pace card + what_is_left retired; probe drops
//   the what_is_left presence check.)
//
// ─── Env preflight (rule: PRESENT/ABSENT only) ──────────────────────
//
// USAGE
//   node --import ./scripts/_setup/register-aliases.mjs \
//        --env-file=.env.local \
//        scripts/probes/_probe_tbrfl_sc_live_walk.mjs

import { createClient } from "@supabase/supabase-js";
import { resolveOverview } from "@/lib/kpi/overview/resolver.js";

function present(name) {
  console.log(`  ${name}: ${process.env[name] ? "PRESENT" : "ABSENT"}`);
}
console.log("[env] presence check:");
present("SUPABASE_URL");
present("SUPABASE_SERVICE_ROLE_KEY");
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[fatal] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing - restore .env.local");
  process.exit(2);
}

const supaReal = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// Intercept .from("kpi_account_flags"). The loader awaits a select
// that resolves to { data, error }. We return TBR - FL as
// sc_revenue_live=true, plus every real row for other accounts so
// the rest of the resolver still gets accurate flag state.
async function fetchRealFlags() {
  const q = await supaReal
    .from("kpi_account_flags")
    .select("account_key, sc_revenue_live, set_at, set_by");
  if (q.error) throw new Error(`fetchRealFlags: ${JSON.stringify(q.error)}`);
  return q.data || [];
}

function stubbedFlagsResponse(rows) {
  // The loader chains: .from("kpi_account_flags").select("...").
  // .select() returns a thenable that resolves to { data, error }.
  const chain = {
    select() { return chain; },
    then(onFulfilled) {
      return Promise.resolve({ data: rows, error: null }).then(onFulfilled);
    },
  };
  return chain;
}

function makeSupaWithTbrFlagOn(realFlags) {
  const overridden = new Map(realFlags.map(r => [r.account_key, r]));
  overridden.set("TBR - FL", {
    account_key: "TBR - FL",
    sc_revenue_live: true,
    set_at: new Date().toISOString(),
    set_by: "probe:tbrfl-sc-live-walk",
  });
  const rows = Array.from(overridden.values());
  return new Proxy(supaReal, {
    get(target, prop) {
      if (prop === "from") {
        return (name) => {
          if (name === "kpi_account_flags") return stubbedFlagsResponse(rows);
          return target.from(name);
        };
      }
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

const today = new Date().toISOString().slice(0, 10);
function todayMinus1() {
  const t = new Date(`${today}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}
const TODAY_MINUS_1 = todayMinus1();

const RANGES = [
  { tag: "FYTD",     range: { kind: "fytd" } },
  { tag: "P8 (closed)", range: { kind: "period", period_no: 8 } },
  { tag: "P9 (open)",   range: { kind: "period", period_no: 9 } },
];

async function walkOne(supa, r) {
  const p = await resolveOverview({
    supa,
    accountKey: "TBR - FL",
    range: r.range,
    caller: { role: "admin", scope: "ALL", can_see_salary: true },
    today,
  });
  if (p.error) {
    return { tag: r.tag, ok: false, why: `resolver error: ${JSON.stringify(p.error)}` };
  }
  const fails = [];
  // On an open range the SC-live account must resolve to "live".
  // On a verified closed period the state is "verified" (pnl_actuals
  // locked; SC read is redundant) - accept both.
  const allowedSrc = p.period_state === "verified" ? ["verified", "live"] : ["live"];
  if (!allowedSrc.includes(p.revenue_source_state)) {
    fails.push(`revenue_source_state=${p.revenue_source_state} (want one of ${allowedSrc.join("/")})`);
  }
  const through = p.sources?.sc_revenue?.through_date;
  const rangeEnd = p.range?.end;
  const expectedCap = rangeEnd && rangeEnd < TODAY_MINUS_1 ? rangeEnd : TODAY_MINUS_1;
  if (through && through > expectedCap) {
    fails.push(`sources.sc_revenue.through_date=${through} > expected cap ${expectedCap}`);
  }
  const revCard = p.cards?.find(c => c.key === "revenue");
  const hero = revCard?.hero_actual;
  if (hero == null || !Number.isFinite(Number(hero)) || Number(hero) < 0) {
    fails.push(`revenue.hero_actual=${hero} (want finite >=0)`);
  }
  return {
    tag: r.tag,
    ok: fails.length === 0,
    fails,
    stats: {
      revenue_source_state: p.revenue_source_state,
      through: through,
      range_end: rangeEnd,
      hero_actual: hero,
      period_state: p.period_state,
      sc_counts_without_dollars: !!p.sc_counts_without_dollars,
    },
  };
}

async function main() {
  console.log(`# TBR - FL sc_revenue_live=true in-process walk - ${today}`);
  console.log(`# today-1 (expected upper cap) = ${TODAY_MINUS_1}`);
  console.log("");
  const realFlags = await fetchRealFlags();
  const supa = makeSupaWithTbrFlagOn(realFlags);

  let failed = 0;
  for (const r of RANGES) {
    const res = await walkOne(supa, r);
    if (res.ok) {
      console.log(`  OK   ${res.tag}  src=${res.stats.revenue_source_state}  through=${res.stats.through}  hero=${res.stats.hero_actual}  state=${res.stats.period_state}  countsNoDollars=${res.stats.sc_counts_without_dollars}`);
    } else {
      failed++;
      console.log(`  FAIL ${res.tag}`);
      for (const f of (res.fails || [res.why])) console.log(`         ${f}`);
      if (res.stats) console.log(`         stats: ${JSON.stringify(res.stats)}`);
    }
  }

  console.log("");
  if (failed === 0) {
    console.log(`Result: TBR - FL walks clean on ${RANGES.length}/${RANGES.length} ranges with sc_revenue_live=true (in-process fixture, no prod write).`);
    process.exit(0);
  }
  console.log(`Result: ${failed} range(s) failed.`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
