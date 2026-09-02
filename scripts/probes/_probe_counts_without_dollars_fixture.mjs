#!/usr/bin/env node
// scripts/probes/_probe_counts_without_dollars_fixture.mjs
//
// R-52 rehome check (Kevin 2026-09-02):
//
//   PacePanel is gone. Its counts-without-dollars variant was the
//   only surface that said "N service days are on the calendar for
//   this period but no meal counts have been entered". Kevin's rule
//   is that this state must render on the Revenue card - hero em-
//   dash, pill "Not yet reporting", sub-line with row count and
//   dates.
//
//   No live account is currently in that state on an open period
//   (TBJ - FL has real counts + revenue). This probe fabricates the
//   state IN-PROCESS by proxying the Supabase client so that
//   sc_daily_revenue returns rows with actual_revenue=0 for TBJ - FL
//   over P9. Also proxies kpi_account_flags so TBJ - FL stays SC-
//   live (which it already is in prod, but we make it explicit here
//   so the fixture is self-contained). No prod write.
//
//   Assertions:
//     A1  payload.sc_counts_without_dollars.row_count > 0
//     A2  revenue card pill.label === "Not yet reporting"
//     A3  revenue card pill.tone === "neutral"
//     A4  revenue card hero_reported === false (client renders em-dash)
//     A5  revenue card hero_actual === null
//     A6  cogs card pct_of_revenue === null (no verdict from null rev)
//     A7  status_line.state_copy is NOT "Behind target" / "At risk" -
//         a verdict derived from null revenue would be a lie; the
//         resolver's ticker classifier must fall back safely.
//
// USAGE
//   node --import ./scripts/_setup/register-aliases.mjs \
//        --env-file=.env.local \
//        scripts/probes/_probe_counts_without_dollars_fixture.mjs

import { createClient } from "@supabase/supabase-js";
import { resolveOverview } from "@/lib/kpi/overview/resolver.js";

function present(name) {
  console.log(`  ${name}: ${process.env[name] ? "PRESENT" : "ABSENT"}`);
}
console.log("[env] presence check:");
present("SUPABASE_URL");
present("SUPABASE_SERVICE_ROLE_KEY");
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[fatal] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  process.exit(2);
}

const supaReal = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// P9 dates.
const P9_START = "2026-08-10";
const P9_END = "2026-09-06";

function daysBetween(start, end) {
  const out = [];
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// Build the zero-revenue P9 rows for TBJ - FL that trigger the
// sc_counts_without_dollars diagnostic. rowCount > 0, sum = 0.
function buildFixtureRows() {
  const days = daysBetween(P9_START, P9_END);
  const rows = [];
  for (const day of days) {
    rows.push({
      account_key: "TBJ - FL",
      service_date: day,
      service_id: `fixture-${day}`,
      actual_revenue: 0,
      is_non_revenue: false,
    });
  }
  return rows;
}

// Chainable stub that mimics the supabase-js builder for
// sc_daily_revenue reads. The pnl-loader chain is:
//   .from(t).select(...).in().gte().lte().not().order().order().order()
//   .range(from, to)
// resolves to { data, error }.
function makeScStub(rows) {
  const chain = {
    _rows: rows,
    select() { return this; },
    in() { return this; },
    gte(_col, val) { this._gte = val; return this; },
    lte(_col, val) { this._lte = val; return this; },
    not() { return this; },
    order() { return this; },
    range() {
      // Return everything in one page - the fixture is small.
      const data = this._rows.filter(r => (!this._gte || r.service_date >= this._gte)
                                       && (!this._lte || r.service_date <= this._lte));
      return Promise.resolve({ data, error: null });
    },
    then(onFulfilled) {
      return Promise.resolve({ data: this._rows, error: null }).then(onFulfilled);
    },
  };
  return chain;
}

// Chainable stub for kpi_account_flags - flip TBJ - FL to sc_live.
async function realFlags() {
  const q = await supaReal
    .from("kpi_account_flags")
    .select("account_key, sc_revenue_live, set_at, set_by");
  if (q.error) throw new Error(`realFlags: ${JSON.stringify(q.error)}`);
  return q.data || [];
}
function makeFlagsStub(rows) {
  const overridden = new Map(rows.map(r => [r.account_key, r]));
  overridden.set("TBJ - FL", {
    account_key: "TBJ - FL",
    sc_revenue_live: true,
    set_at: new Date().toISOString(),
    set_by: "probe:counts-without-dollars-fixture",
  });
  const list = [...overridden.values()];
  return {
    select() { return this; },
    then(onFulfilled) {
      return Promise.resolve({ data: list, error: null }).then(onFulfilled);
    },
  };
}

function makeSupa(scStubFactory, flagsStub) {
  return new Proxy(supaReal, {
    get(target, prop) {
      if (prop === "from") {
        return (name) => {
          if (name === "sc_daily_revenue") return scStubFactory();
          if (name === "kpi_account_flags") return flagsStub;
          return target.from(name);
        };
      }
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

const today = new Date().toISOString().slice(0, 10);
const FAILS = [];
function fail(w, why) { FAILS.push(`${w}  ${why}`); }

async function main() {
  console.log(`# counts-without-dollars fixture - ${today}`);
  console.log("");

  const flags = await realFlags();
  const rows = buildFixtureRows();
  const supa = makeSupa(() => makeScStub(rows), makeFlagsStub(flags));

  const p = await resolveOverview({
    supa,
    accountKey: "TBJ - FL",
    range: { kind: "period", period_no: 9 },
    caller: { role: "admin", scope: "ALL", can_see_salary: true },
    today,
  });
  if (p.error) {
    fail("resolveOverview", `error: ${JSON.stringify(p.error)}`);
  } else {
    // A1
    if (!p.sc_counts_without_dollars || p.sc_counts_without_dollars.row_count <= 0) {
      fail("A1", `sc_counts_without_dollars missing or empty: ${JSON.stringify(p.sc_counts_without_dollars)}`);
    }
    const revCard = p.cards?.find(c => c.key === "revenue");
    const cogsCard = p.cards?.find(c => c.key === "cogs");
    // A2 + A3
    const pill = revCard?.pill;
    if (pill?.label !== "Not yet reporting") {
      fail("A2", `revenue pill label=${JSON.stringify(pill?.label)} (want "Not yet reporting")`);
    }
    if (pill?.tone !== "neutral") {
      fail("A3", `revenue pill tone=${JSON.stringify(pill?.tone)} (want "neutral")`);
    }
    // A4
    if (revCard?.hero_reported !== false) {
      fail("A4", `revenue hero_reported=${revCard?.hero_reported} (want false)`);
    }
    // A5
    if (revCard?.hero_actual !== null) {
      fail("A5", `revenue hero_actual=${revCard?.hero_actual} (want null)`);
    }
    // A6
    if (cogsCard?.pct_of_revenue != null) {
      fail("A6", `cogs pct_of_revenue=${cogsCard?.pct_of_revenue} (want null under null revenue)`);
    }
    // A7 - status_line must not carry a "Behind" / "At risk" verdict
    // built from null revenue. "Behind target" and "At risk" are the
    // dangerous labels; "On track" or "No target" or a fall-through
    // are acceptable. Also acceptable: a "neutral" or "unknown" copy.
    const bannedVerdicts = new Set(["Behind target", "At risk"]);
    const sc = p.status_line?.state_copy;
    if (sc && bannedVerdicts.has(sc)) {
      fail("A7", `status_line.state_copy=${JSON.stringify(sc)} - a verdict from null revenue is a lie`);
    }

    console.log(`  scRowCount: ${p.sc_counts_without_dollars?.row_count}`);
    console.log(`  scDates: ${JSON.stringify(p.sc_counts_without_dollars?.dates_covered)}`);
    console.log(`  revenue.pill: ${JSON.stringify(pill)}`);
    console.log(`  revenue.hero_actual: ${revCard?.hero_actual}`);
    console.log(`  revenue.hero_reported: ${revCard?.hero_reported}`);
    console.log(`  cogs.pct_of_revenue: ${cogsCard?.pct_of_revenue}`);
    console.log(`  cogs.pill: ${JSON.stringify(cogsCard?.pill)}`);
    console.log(`  status_line.state_copy: ${JSON.stringify(sc)}`);
  }

  console.log("");
  if (FAILS.length === 0) {
    console.log(`Result: counts-without-dollars state routes to the Revenue card correctly (no PacePanel needed).`);
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
