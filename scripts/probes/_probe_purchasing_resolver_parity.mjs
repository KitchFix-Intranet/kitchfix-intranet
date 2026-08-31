// scripts/probes/_probe_purchasing_resolver_parity.mjs
//
// OVERVIEW PHASE 2 PR-2 - purchasing resolver parity probe.
//
// **MERGE GATE.**  Two implementations of the same purchasing numbers
// coexist for one PR (the client folds in src/app/kpi/purchasing/lib/
// board.js and the new server-side resolver in
// src/app/kpi/purchasing/lib/resolver.js), which is the defect class
// this system exists to prevent.  This probe asserts to the cent that
// both paths, fed the SAME raw route payload, produce the SAME numbers
// on every scenario the board covers.  When the Overview lands and the
// client folds retire per §11 E-10, this probe becomes the retirement
// guard - it stays permanently.
//
// **The probe imports the ACTUAL client functions - it does NOT
// reimplement them.**  If both sides were computed from the same probe-
// local logic the probe would pass while proving nothing (Kevin's
// pattern law).  The imports at the top of this file are the whole
// point of the probe - if they change, the probe changes.
//
// ─── How to run ──────────────────────────────────────────────────────
//
//   node --import ./scripts/_setup/register-aliases.mjs \
//        --env-file=.env.local \
//        scripts/probes/_probe_purchasing_resolver_parity.mjs
//
// The --import flag registers the @/ path alias loader (resolver.js
// imports from @/lib/accountModels, @/app/kpi/labor/lib/periods.js,
// etc.).  The probe spawns its own dev server on a dedicated port
// with TEST_MODE=true (src/middleware.js:5 lets local + CI reach
// authed routes when TEST_MODE=true), fetches the raw purchasing
// route payload for each scenario, and compares client-fold vs
// resolver output cent-for-cent.
//
// ─── Seeded failure case ─────────────────────────────────────────────
//
// To exercise the FAIL path this probe protects against, temporarily
// edit src/app/kpi/purchasing/lib/board.js:GL_PREFIX_FOR_BUCKET so the
// `food` entry matches on `startsWith("3201")` instead of `"3200"`.
// Rerun this probe: it will fire non-zero with a named FAIL line
// (e.g. "FAIL ALL FYTD bucket 3200 period_total: client=... resolver=...").
// Revert the edit.  This documents the failure path this probe
// protects against.
//
// ─── Scenarios ───────────────────────────────────────────────────────
//
// 12 scenarios required by the brief:
//   ALL / TBR - FL (at-risk) / CIN - OH (mgmt-fee) / STL - MO (pass-through)
//   × FYTD / P8 / P9
//
// Plus the frozen sentinel: TBR - FL P8 3200.1 bill.com = $39,373.74.

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

// KEVIN'S RULE - IMPORT THE ACTUAL CLIENT FUNCTIONS.
// Do NOT reimplement them.  Same input to both sides, comparison at
// the output.  These four exports are the client-fold path.
import {
  bucketWeeklySpend,
  periodWeeklySpend,
  bucketBudget,
  kpiBudget,
} from "../../src/app/kpi/purchasing/lib/board.js";

// The NEW server-side resolver under test.
import { buildPurchasingBoard } from "../../src/app/kpi/purchasing/lib/resolver.js";

// ─── Env preflight (rule: PRESENT/ABSENT only) ───────────────────────

function envPresence(name) {
  console.log(`  ${name}: ${process.env[name] ? "PRESENT" : "ABSENT"}`);
}
console.log("[env] presence check:");
envPresence("SUPABASE_URL");
envPresence("SUPABASE_SERVICE_ROLE_KEY");
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[fatal] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY - restore .env.local");
  process.exit(2);
}

// ─── Constants ───────────────────────────────────────────────────────

const PORT = "3299";
const BASE = `http://localhost:${PORT}`;
const READY_TIMEOUT_MS = 240_000;

const FY_START = "2025-12-29";
const TODAY = new Date().toISOString().slice(0, 10);

// Period boundaries (must match src/app/kpi/labor/lib/periods.js).
const MS_PER_DAY = 86400000;
const DAYS_PER_PERIOD = 28;
function periodStartISO(p) {
  const fy = Date.UTC(2025, 11, 29);
  return new Date(fy + (p - 1) * DAYS_PER_PERIOD * MS_PER_DAY).toISOString().slice(0, 10);
}
function periodEndISO(p) {
  const fy = Date.UTC(2025, 11, 29);
  return new Date(fy + (p * DAYS_PER_PERIOD - 1) * MS_PER_DAY).toISOString().slice(0, 10);
}

// ACCOUNT SET (per Kevin's brief):
//   ALL                - aggregate
//   TBR - FL           - at-risk (KPI on COGS)
//   CIN - OH           - management-fee / pass-through (mgmt-fee card render)
//   STL - MO           - pass-through (Cardinals Busch Stadium mgmt-fee)
//
// "Management-fee" and "pass-through" are the same category in this
// codebase (PASS_THROUGH_ACCOUNTS in accountModels.js).  The distinction
// Kevin's brief makes is at the RENDERING surface (mgmt-fee card
// replaces the standard board on these accounts).  Picking two
// pass-through accounts covers both single-account rendering paths.
const ACCOUNTS = ["ALL", "TBR - FL", "CIN - OH", "STL - MO"];

const RANGES = [
  { key: "FYTD", start: FY_START,       end: TODAY },
  { key: "P8",   start: periodStartISO(8), end: periodEndISO(8) },
  { key: "P9",   start: periodStartISO(9), end: periodEndISO(9) },
];

// Sentinel: TBR - FL P8 3200.1 bill.com = $39,373.74 (frozen probe).
const SENTINEL_EXPECTED = 39373.74;

// ─── Supabase client (for resolver-side budgetMap assembly) ──────────
//
// The route's kpi_budgets query is server-internal; the payload only
// exposes `budget.by_gl_line_code` (pre-summed for the range).  The
// resolver's `budgetMap` needs the nested per-account-per-period shape.
// This block reproduces the SHAPE of loadPurchasingBudgets (the I/O
// part) - not the logic under test.  If any budget number differs
// between the two paths, that difference propagates through
// budgetForRange in the resolver and shows up as a FAIL in the budget
// column of the comparison table.
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const V6_PAGE = 1000;
const IN_CHUNK = 100;
function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

async function loadPurchasingBudgetsMirror(members, fiscalYear) {
  // Mirror of loadPurchasingBudgets in src/app/api/kpi/purchasing/route.js.
  // Pure I/O shape assembly.  Nothing under test lives here.
  const byLine = new Map();
  for (const memberChunk of chunk(members, IN_CHUNK)) {
    let from = 0;
    while (true) {
      const q = await supa.from("kpi_budgets")
        .select("account_key, line_code, period_no, amount")
        .eq("fiscal_year", fiscalYear)
        .in("account_key", memberChunk)
        .neq("line_code", "3100.1")
        .neq("line_code", "3100.2")
        .order("account_key", { ascending: true })
        .order("line_code", { ascending: true })
        .order("period_no", { ascending: true })
        .range(from, from + V6_PAGE - 1);
      if (q.error) throw new Error(`kpi_budgets: ${q.error.message}`);
      const rows = q.data || [];
      for (const r of rows) {
        const gl = String(r.line_code);
        const acct = String(r.account_key);
        if (!byLine.has(gl)) byLine.set(gl, new Map());
        if (!byLine.get(gl).has(acct)) byLine.get(gl).set(acct, new Map());
        byLine.get(gl).get(acct).set(Number(r.period_no), Number(r.amount));
      }
      if (rows.length < V6_PAGE) break;
      from += V6_PAGE;
    }
  }
  return byLine;
}

// Resolve members for an account param.
async function resolveMembers(account) {
  if (account === "ALL") {
    const q = await supa.from("accounts").select("team_key").neq("team_key", "CORP").order("team_key");
    if (q.error) throw new Error(q.error.message);
    return q.data.map(r => r.team_key);
  }
  if (account === "EAST" || account === "WEST") {
    const regionValue = account === "EAST" ? "East" : "West";
    const q = await supa.from("accounts").select("team_key").neq("team_key", "CORP").eq("region", regionValue).order("team_key");
    if (q.error) throw new Error(q.error.message);
    return q.data.map(r => r.team_key);
  }
  return [account];
}

// Sentinel: TBR - FL P8 3200.1 bill.com.  Directly against
// purchasing_actuals - independent of both paths, so it acts as a
// third check.
async function fetchSentinel() {
  const q = await supa.from("purchasing_actuals")
    .select("amount")
    .eq("source", "billcom")
    .eq("excluded", false)
    .eq("account_key", "TBR - FL")
    .eq("gl_line_code", "3200.1")
    .gte("txn_date", periodStartISO(8))
    .lte("txn_date", periodEndISO(8));
  if (q.error) throw new Error(q.error.message);
  return (q.data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
}

// ─── Dev server helpers ──────────────────────────────────────────────

async function waitReady(deadline) {
  const probeUrl = `${BASE}/api/kpi/purchasing?account=${encodeURIComponent("CIN - OH")}&start=2026-07-06&end=2026-07-12`;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(probeUrl, { signal: AbortSignal.timeout(30_000) });
      if (r.status === 200 || r.status === 400 || r.status === 500 || r.status === 403) return true;
    } catch {}
    await sleep(1000);
  }
  return false;
}

async function fetchRawPayload({ account, start, end }) {
  const url = `${BASE}/api/kpi/purchasing?account=${encodeURIComponent(account)}&start=${start}&end=${end}`;
  const t0 = Date.now();
  const r = await fetch(url, { signal: AbortSignal.timeout(240_000) });
  const wallMs = Date.now() - t0;
  if (!r.ok) throw new Error(`route ${r.status} for ${account} ${start}..${end}`);
  const body = await r.json();
  return { body, wallMs };
}

// ─── Comparison helpers (cent-level) ─────────────────────────────────

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

function cmp(label, clientVal, resolverVal, failures) {
  const c = round2(clientVal);
  const r = round2(resolverVal);
  if (c === r) return true;
  failures.push({ label, client: c, resolver: r, delta: round2(r - c) });
  return false;
}

function cmpSeries(label, clientArr, resolverArr, failures) {
  // Compare two [{week_start, amount}] arrays element-wise.  Arrays
  // must be same length + same week_start ordering.
  if (!Array.isArray(clientArr) || !Array.isArray(resolverArr)) {
    failures.push({ label: `${label} shape`, client: typeof clientArr, resolver: typeof resolverArr });
    return false;
  }
  if (clientArr.length !== resolverArr.length) {
    failures.push({ label: `${label} length`, client: clientArr.length, resolver: resolverArr.length });
    return false;
  }
  let ok = true;
  for (let i = 0; i < clientArr.length; i += 1) {
    const cw = clientArr[i]?.week_start;
    const rw = resolverArr[i]?.week_start;
    if (cw !== rw) {
      failures.push({ label: `${label}[${i}].week_start`, client: cw, resolver: rw });
      ok = false;
      continue;
    }
    if (!cmp(`${label}[${cw}].amount`, clientArr[i]?.amount, resolverArr[i]?.amount, failures)) ok = false;
  }
  return ok;
}

// ─── Scenario runner ─────────────────────────────────────────────────

async function runScenario({ account, range }) {
  const label = `${account} ${range.key}`;
  const failures = [];
  const t0 = Date.now();

  // Fetch RAW route payload - this is what both consumption paths use.
  let payload, routeMs;
  try {
    const r = await fetchRawPayload({ account, start: range.start, end: range.end });
    payload = r.body;
    routeMs = r.wallMs;
  } catch (e) {
    return { label, ok: false, failures: [{ label: "route_fetch", error: String(e) }], resolverMs: 0, routeMs: 0 };
  }

  if (!payload?.ok) {
    return { label, ok: false, failures: [{ label: "route_body", error: payload?.error || "no ok:true" }], resolverMs: 0, routeMs };
  }

  // Rebuild the resolver's budgetMap from Supabase (shape reproduction
  // of loadPurchasingBudgets; not under test).  Uses the SAME members
  // list the route resolved (echoed in payload.filters or re-derived).
  const members = await resolveMembers(account);
  const budgetMap = await loadPurchasingBudgetsMirror(members, payload.fiscal?.fiscal_year || 2026);

  // ─── CLIENT-FOLD SIDE (imported functions from board.js) ───────────
  //
  // The route's fiscal-week widening (PR-2 R4 Part A) means the client
  // consumes weekly[] against [effStart, effEnd], not [start, end].
  // Since the payload doesn't expose effStart/effEnd but does expose
  // weekly[] filtered to that widened window, we pass the ORIGINAL
  // user range to the client folds.  The folds use weekStartsInRange
  // to enumerate weeks in that range - which is what the client does
  // when it renders.  If widening ever leaks a week that's outside the
  // user range, the client's own weekStartsInRange will drop it (same
  // as the resolver).  Same input, same output.
  const clientFoldFood      = bucketWeeklySpend({ weekly: payload.weekly, bucketKey: "food",      start: range.start, end: range.end });
  const clientFoldPackaging = bucketWeeklySpend({ weekly: payload.weekly, bucketKey: "packaging", start: range.start, end: range.end });
  const clientFoldVehicle   = bucketWeeklySpend({ weekly: payload.weekly, bucketKey: "vehicle",   start: range.start, end: range.end });
  const clientFoldEquip     = bucketWeeklySpend({ weekly: payload.weekly, bucketKey: "equip",     start: range.start, end: range.end });
  const clientFoldRm        = bucketWeeklySpend({ weekly: payload.weekly, bucketKey: "rm",        start: range.start, end: range.end });
  const clientFoldPerks     = bucketWeeklySpend({ weekly: payload.weekly, bucketKey: "perks",     start: range.start, end: range.end });
  const clientFoldKpi       = periodWeeklySpend({ weekly: payload.weekly,                          start: range.start, end: range.end });

  const clientFoldFoodTotal      = clientFoldFood.reduce((s, w) => s + w.amount, 0);
  const clientFoldPackagingTotal = clientFoldPackaging.reduce((s, w) => s + w.amount, 0);
  const clientFoldVehicleTotal   = clientFoldVehicle.reduce((s, w) => s + w.amount, 0);
  const clientFoldEquipTotal     = clientFoldEquip.reduce((s, w) => s + w.amount, 0);
  const clientFoldRmTotal        = clientFoldRm.reduce((s, w) => s + w.amount, 0);
  const clientFoldPerksTotal     = clientFoldPerks.reduce((s, w) => s + w.amount, 0);
  const clientFoldKpiTotal       = clientFoldKpi.reduce((s, w) => s + w.amount, 0);

  const clientFoldBudgetFood      = bucketBudget({ byGlLineCode: payload.budget?.by_gl_line_code, bucketKey: "food" });
  const clientFoldBudgetPackaging = bucketBudget({ byGlLineCode: payload.budget?.by_gl_line_code, bucketKey: "packaging" });
  const clientFoldBudgetVehicle   = bucketBudget({ byGlLineCode: payload.budget?.by_gl_line_code, bucketKey: "vehicle" });
  const clientFoldBudgetKpi       = kpiBudget({    byGlLineCode: payload.budget?.by_gl_line_code });

  // For the tracked lines the client folds don't have a preset helper
  // (they're rendered as separate ledger cards driven by
  // payload.ledgers).  For parity purposes we use bucketBudget with
  // the tracked bucket keys (equip/rm/perks) - all three collapse to
  // a single-line predicate, so the sum matches the resolver's
  // per-line budget lookup exactly.  This still routes through the
  // imported client function (bucketBudget), not a probe reimplementation.
  const clientFoldBudgetRm    = bucketBudget({ byGlLineCode: payload.budget?.by_gl_line_code, bucketKey: "rm" });
  const clientFoldBudgetEquip = bucketBudget({ byGlLineCode: payload.budget?.by_gl_line_code, bucketKey: "equip" });
  const clientFoldBudgetPerks = bucketBudget({ byGlLineCode: payload.budget?.by_gl_line_code, bucketKey: "perks" });

  // ─── RESOLVER SIDE ──────────────────────────────────────────────
  const resolverT0 = Date.now();
  const resolverOut = buildPurchasingBoard({
    members,
    start: range.start,
    end: range.end,
    today: TODAY,
    actualsRows: payload.actuals || [],   // present only on drill=lines; empty is fine (resolver doesn't read it in this contract)
    weeklyRows: payload.weekly,
    pendingRow: payload.pending,
    budgetMap,
  });
  const resolverMs = Date.now() - resolverT0;

  // ─── Cent-level comparisons ────────────────────────────────────

  // Bucket period totals (three)
  cmp(`${label} bucket 3200 period_total`, clientFoldFoodTotal,      resolverOut.buckets["3200"].period_total, failures);
  cmp(`${label} bucket 3400 period_total`, clientFoldPackagingTotal, resolverOut.buckets["3400"].period_total, failures);
  cmp(`${label} bucket 3500 period_total`, clientFoldVehicleTotal,   resolverOut.buckets["3500"].period_total, failures);

  // Bucket week series (cent per week)
  cmpSeries(`${label} bucket 3200 week_series`, clientFoldFood,      resolverOut.buckets["3200"].week_series, failures);
  cmpSeries(`${label} bucket 3400 week_series`, clientFoldPackaging, resolverOut.buckets["3400"].week_series, failures);
  cmpSeries(`${label} bucket 3500 week_series`, clientFoldVehicle,   resolverOut.buckets["3500"].week_series, failures);

  // Bucket budgets (three)
  cmp(`${label} bucket 3200 budget`, clientFoldBudgetFood,      resolverOut.buckets["3200"].budget, failures);
  cmp(`${label} bucket 3400 budget`, clientFoldBudgetPackaging, resolverOut.buckets["3400"].budget, failures);
  cmp(`${label} bucket 3500 budget`, clientFoldBudgetVehicle,   resolverOut.buckets["3500"].budget, failures);

  // KPI-line total (matches periodWeeklySpend and kpiBudget)
  cmp(`${label} kpi_total client-fold vs resolver.totals`,   clientFoldKpiTotal,   resolverOut.totals.buckets_period_total, failures);
  cmp(`${label} kpi_budget client-fold vs resolver.totals`,  clientFoldBudgetKpi,  resolverOut.totals.buckets_budget,       failures);

  // Tracked (5002.1, 5002.5, 5017.3) - period_total, week_series, budget
  cmp(`${label} tracked 5002.1 period_total`, clientFoldRmTotal,    resolverOut.tracked["5002.1"].period_total, failures);
  cmp(`${label} tracked 5002.5 period_total`, clientFoldEquipTotal, resolverOut.tracked["5002.5"].period_total, failures);
  cmp(`${label} tracked 5017.3 period_total`, clientFoldPerksTotal, resolverOut.tracked["5017.3"].period_total, failures);
  cmpSeries(`${label} tracked 5002.1 week_series`, clientFoldRm,    resolverOut.tracked["5002.1"].week_series, failures);
  cmpSeries(`${label} tracked 5002.5 week_series`, clientFoldEquip, resolverOut.tracked["5002.5"].week_series, failures);
  cmpSeries(`${label} tracked 5017.3 week_series`, clientFoldPerks, resolverOut.tracked["5017.3"].week_series, failures);
  cmp(`${label} tracked 5002.1 budget`, clientFoldBudgetRm,    resolverOut.tracked["5002.1"].budget, failures);
  cmp(`${label} tracked 5002.5 budget`, clientFoldBudgetEquip, resolverOut.tracked["5002.5"].budget, failures);
  cmp(`${label} tracked 5017.3 budget`, clientFoldBudgetPerks, resolverOut.tracked["5017.3"].budget, failures);

  return {
    label,
    ok: failures.length === 0,
    failures,
    routeMs,
    resolverMs,
    totalMs: Date.now() - t0,
    values: {
      food_total: round2(clientFoldFoodTotal),
      pkg_total:  round2(clientFoldPackagingTotal),
      veh_total:  round2(clientFoldVehicleTotal),
      rm_total:   round2(clientFoldRmTotal),
      eq_total:   round2(clientFoldEquipTotal),
      pk_total:   round2(clientFoldPerksTotal),
      food_budget: round2(clientFoldBudgetFood),
      kpi_total:   round2(clientFoldKpiTotal),
      kpi_budget:  round2(clientFoldBudgetKpi),
    },
  };
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log(`[env] today: ${TODAY}`);
  console.log(`[env] PORT: ${PORT}`);
  console.log("[dev-server] spawning next dev with TEST_MODE=true");

  const proc = spawn("npm", ["run", "dev", "--", "--port", PORT], {
    env: { ...process.env, TEST_MODE: "true", NODE_ENV: "development", PORT },
    stdio: ["ignore", "pipe", "pipe"],
    cwd: process.cwd(),
  });
  proc.stdout?.on("data", () => {});
  proc.stderr?.on("data", () => {});

  let ready = false;
  try {
    ready = await waitReady(Date.now() + READY_TIMEOUT_MS);
    if (!ready) {
      console.error("[fatal] dev server not ready within timeout");
      process.exit(3);
    }
    console.log("[dev] ready\n");

    // Sentinel check first (independent of both paths).
    const sentinelActual = round2(await fetchSentinel());
    const sentinelPass = sentinelActual === SENTINEL_EXPECTED;
    console.log(`[sentinel] TBR - FL P8 3200.1 bill.com = $${sentinelActual.toFixed(2)}  expected $${SENTINEL_EXPECTED.toFixed(2)}  ${sentinelPass ? "PASS" : "FAIL"}`);
    if (!sentinelPass) {
      console.log("[warn] sentinel drift - either the derive changed or the frozen value needs a refresh.  Continuing to run scenarios.");
    }
    console.log();

    const results = [];
    for (const account of ACCOUNTS) {
      for (const range of RANGES) {
        console.log(`[scenario] ${account}  ${range.key}  (${range.start} .. ${range.end})`);
        const r = await runScenario({ account, range });
        results.push(r);
        if (r.ok) {
          console.log(`  PASS  route=${r.routeMs}ms resolver=${r.resolverMs}ms  food=$${r.values.food_total}  pkg=$${r.values.pkg_total}  veh=$${r.values.veh_total}  rm=$${r.values.rm_total}  eq=$${r.values.eq_total}  perks=$${r.values.pk_total}  kpi_total=$${r.values.kpi_total}  kpi_budget=$${r.values.kpi_budget}`);
        } else {
          console.log(`  FAIL  ${r.failures.length} assertion(s) failed:`);
          for (const f of r.failures.slice(0, 20)) {
            if (f.error) console.log(`    - ${f.label}: ${f.error}`);
            else console.log(`    - ${f.label}: client=${f.client}  resolver=${f.resolver}  delta=${f.delta}`);
          }
          if (r.failures.length > 20) console.log(`    - ... and ${r.failures.length - 20} more`);
        }
      }
    }

    // Summary table
    console.log("\n─── PARITY SUMMARY ───");
    console.log(`| scenario | ok | route ms | resolver ms | food $ | pkg $ | veh $ | rm $ | eq $ | perks $ | kpi $ | kpi budget $ |`);
    console.log(`| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
    for (const r of results) {
      const v = r.values || {};
      console.log(`| ${r.label} | ${r.ok ? "PASS" : "FAIL"} | ${r.routeMs} | ${r.resolverMs} | ${v.food_total ?? "-"} | ${v.pkg_total ?? "-"} | ${v.veh_total ?? "-"} | ${v.rm_total ?? "-"} | ${v.eq_total ?? "-"} | ${v.pk_total ?? "-"} | ${v.kpi_total ?? "-"} | ${v.kpi_budget ?? "-"} |`);
    }
    const passCount = results.filter(r => r.ok).length;
    console.log(`\n[result] ${passCount}/${results.length} scenarios PASS`);
    console.log(`[sentinel] ${sentinelPass ? "PASS" : "FAIL"}  actual=$${sentinelActual.toFixed(2)} expected=$${SENTINEL_EXPECTED.toFixed(2)}`);
    const overallOk = passCount === results.length && sentinelPass;
    console.log(`[gate] ${overallOk ? "PASS" : "FAIL"}`);

    if (!overallOk) process.exitCode = 1;
  } finally {
    try { proc.kill("SIGTERM"); } catch {}
    // Give the dev process a moment to release the port.
    await sleep(500);
    try { proc.kill("SIGKILL"); } catch {}
  }
}

main().catch(e => {
  console.error("[fatal]", e);
  process.exit(1);
});
