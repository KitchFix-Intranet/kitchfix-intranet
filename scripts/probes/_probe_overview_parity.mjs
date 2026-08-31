// scripts/probes/_probe_overview_parity.mjs
//
// Overview Phase 2 PR-3 - parity between the Overview resolver and the
// two engines it composes.
//
// Assertion (Kevin's PR-3 brief):
//   Overview 3100 == labor.board.spent_to_date + range_budget on the
//     SAME range x account, to the cent.
//   Overview 3200 / 3400 / 3500 (and tracked 5002.1 / 5002.5 / 5017.3)
//     == purchasing board's totals + per-bucket period_total + budget,
//     to the cent.
//
// Purchasing check imports buildPurchasingBoard directly and runs it
// against the same raw inputs, per Kevin's PR-2 turn rule:
//   "Compute the client-fold side by importing and running the actual
//   client functions. Do not reimplement their logic in the probe."
// Node's @/ path alias resolves via ./_at_alias_hook.mjs (installed
// via --import; see USAGE below).
//
// Scenarios (12 - 4 accounts x 3 ranges):
//   ALL / TBR - FL / STL - FL / STL - MO   x   FYTD / P8 / P9
//
// Chosen accounts represent: aggregate portfolio (ALL), per-meal
// single (TBR - FL), fee (STL - FL), pass-through (STL - MO).
//
// USAGE (external dev server):
//   # in one terminal:
//   TEST_MODE=true node --env-file=.env.local -e "process.env.TEST_MODE='true'; \
//     import('next/dist/bin/next').then(m => m.default(['start','-p','3311']));" &
//   # in another:
//   node --env-file=.env.local --import ./scripts/probes/_at_alias_hook.mjs \
//        scripts/probes/_probe_overview_parity.mjs
//
// Seeded failure: set SEEDED_FAILURE=1 to bake in one wrong-expected
// assertion so the FAIL path proves it fires (Kevin's rule).

// ── Env presence (USE/SEE compliance) ─────────────────────────────
function envPresence() {
  console.log(`SUPABASE_URL: ${process.env.SUPABASE_URL ? "PRESENT" : "ABSENT"}`);
  console.log(`SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? "PRESENT" : "ABSENT"}`);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[abort] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
    process.exit(2);
  }
}
envPresence();

const PORT = process.env.PORT || "3311";
const BASE = `http://localhost:${PORT}`;
const SEEDED = process.env.SEEDED_FAILURE === "1";
const TOL = 0.02;

const RANGES = [
  { key: "FYTD", rangeParam: "fytd",     start: "2025-12-29", end: new Date().toISOString().slice(0, 10) },
  { key: "P8",   rangeParam: "period:8", start: "2026-07-13", end: "2026-08-09" },
  { key: "P9",   rangeParam: "period:9", start: "2026-08-10", end: "2026-09-06" },
];

const ACCTS = [
  { key: "ALL",      kind: "portfolio" },
  { key: "TBR - FL", kind: "per-meal" },
  { key: "STL - FL", kind: "fee" },
  { key: "STL - MO", kind: "pass-through" },
];

const acct = (k) => encodeURIComponent(k);
const RESULTS = [];

function approxEq(a, b, tol = TOL) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) <= tol;
}

function assert(scenario, name, got, expected, tol = TOL) {
  const ok = approxEq(got, expected, tol);
  RESULTS.push({ scenario, name, ok, got, expected });
  const marker = ok ? "PASS " : "FAIL ";
  console.log(`    ${marker} ${name}: got=${got} expected=${expected}`);
  return ok;
}

async function jget(url) {
  const t = Date.now();
  const r = await fetch(url);
  const ms = Date.now() - t;
  if (!r.ok) throw new Error(`${url} -> ${r.status}: ${await r.text().catch(() => "")}`);
  const j = await r.json();
  return { j, ms };
}

async function serverReady() {
  for (let i = 0; i < 5; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/kpi/overview?account=CIN%20-%20AZ&range=fytd`);
      if (r.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function runScenario(a, r) {
  const scenario = `${a.key} · ${r.key} (${a.kind})`;
  console.log(`\n  Scenario: ${scenario}`);
  const ovUrl  = `${BASE}/api/kpi/overview?account=${acct(a.key)}&range=${r.rangeParam}`;
  const labUrl = `${BASE}/api/kpi/labor?account=${acct(a.key)}&start=${r.start}&end=${r.end}`;
  const purUrl = `${BASE}/api/kpi/purchasing?account=${acct(a.key)}&start=${r.start}&end=${r.end}`;

  let ov, lab, pur, timings;
  try {
    const [ovR, labR, purR] = await Promise.all([jget(ovUrl), jget(labUrl), jget(purUrl)]);
    ov = ovR.j; lab = labR.j; pur = purR.j;
    timings = { overview: ovR.ms, labor: labR.ms, purchasing: purR.ms };
    console.log(`    fetched: overview=${timings.overview}ms labor=${timings.labor}ms purchasing=${timings.purchasing}ms`);
  } catch (e) {
    console.log(`    ABORT fetch: ${e.message.slice(0, 200)}`);
    RESULTS.push({ scenario, name: "fetch", ok: false, error: e.message });
    return;
  }
  if (ov.error || ov.locked) { console.log(`    ABORT overview:`, JSON.stringify(ov).slice(0, 200)); RESULTS.push({ scenario, name: "overview error", ok: false }); return; }
  if (lab.error || lab.locked) { console.log(`    ABORT labor:`, JSON.stringify(lab).slice(0, 200)); RESULTS.push({ scenario, name: "labor error", ok: false }); return; }
  if (pur.error || pur.locked) { console.log(`    ABORT purchasing:`, JSON.stringify(pur).slice(0, 200)); RESULTS.push({ scenario, name: "purchasing error", ok: false }); return; }

  // ── Labor 3100 parity ──
  const ovLaborActual = ov.cards?.find(c => c.key === "cogs")?.mini?.find(m => m.label === "Labor")?.actual ?? null;
  const laborActual = lab.board?.applies ? lab.board.spent_to_date : null;
  assert(scenario, "3100 actual (Overview vs labor.board.spent_to_date)", ovLaborActual, laborActual);

  const ovLaborBudget = ov.levers?.find(l => l.line_code === "3100")?.budget ?? null;
  const laborBudget = lab.board?.applies ? (lab.board.range_budget ?? null) : null;
  assert(scenario, "3100 budget (Overview vs labor.board.range_budget)", ovLaborBudget, laborBudget);

  // ── labor board carries budget_to_date_days additive field ──
  if (lab.board?.applies) {
    const btd = lab.board?.budget_to_date_days;
    const btdOk = btd && typeof btd === "object" && "amount" in btd;
    RESULTS.push({ scenario, name: "labor.board.budget_to_date_days present + shape", ok: !!btdOk, got: JSON.stringify(btd), expected: "object w/ amount" });
    console.log(`    ${btdOk ? "PASS " : "FAIL "} labor.board.budget_to_date_days present + shape: ${JSON.stringify(btd)}`);
    // range_budget MUST NOT change (byte-identical field alongside btd)
    const rb = lab.board?.range_budget;
    RESULTS.push({ scenario, name: "labor.board.range_budget still present + numeric", ok: rb != null, got: rb, expected: "number" });
  }

  // ── Purchasing bucket parity via imported buildPurchasingBoard ──
  const { buildPurchasingBoard } = await import("@/app/kpi/purchasing/lib/resolver.js");
  const { createClient } = await import("@supabase/supabase-js");
  const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { loadPurchasingBudgets, fetchMembers } = await import("@/lib/purchasing/loaders.js");
  const mm = await fetchMembers(supa, a.key);
  if (mm.error) { console.log(`    ABORT fetchMembers: ${mm.error}`); return; }
  const bud = await loadPurchasingBudgets(supa, mm.members, 2026);
  if (bud.error) { console.log(`    ABORT loadPurchasingBudgets: ${bud.error}`); return; }
  const purBoard = buildPurchasingBoard({
    members: mm.members,
    start: r.start,
    end: r.end,
    today: new Date().toISOString().slice(0, 10),
    actualsRows: pur.actuals || [],
    weeklyRows: pur.weekly || [],
    pendingRow: pur.pending || { amount: 0, line_count: 0 },
    budgetMap: bud.data,
  });

  const ovFood = ov.cards?.find(c => c.key === "cogs")?.mini?.find(m => m.label === "Food")?.actual ?? null;
  assert(scenario, "3200 actual (Overview vs library buildPurchasingBoard.buckets[3200].period_total)", ovFood, purBoard.buckets["3200"]?.period_total ?? null);
  const ovFoodBudg = ov.levers?.find(l => l.line_code === "3200")?.budget ?? null;
  assert(scenario, "3200 budget (Overview vs library buildPurchasingBoard.buckets[3200].budget)", ovFoodBudg, purBoard.buckets["3200"]?.budget ?? null);

  const ovPkg = ov.cards?.find(c => c.key === "cogs")?.mini?.find(m => m.label === "Packaging")?.actual ?? null;
  assert(scenario, "3400 actual", ovPkg, purBoard.buckets["3400"]?.period_total ?? null);
  const ovPkgBudg = ov.levers?.find(l => l.line_code === "3400")?.budget ?? null;
  assert(scenario, "3400 budget", ovPkgBudg, purBoard.buckets["3400"]?.budget ?? null);

  const ovVeh = ov.cards?.find(c => c.key === "cogs")?.mini?.find(m => m.label === "Vehicle")?.actual ?? null;
  assert(scenario, "3500 actual", ovVeh, purBoard.buckets["3500"]?.period_total ?? null);
  const ovVehBudg = ov.levers?.find(l => l.line_code === "3500")?.budget ?? null;
  assert(scenario, "3500 budget", ovVehBudg, purBoard.buckets["3500"]?.budget ?? null);

  const ovRm = ov.also_tracked?.find(x => x.line_code === "5002.1")?.actual ?? null;
  assert(scenario, "5002.1 tracked actual", ovRm, purBoard.tracked["5002.1"]?.period_total ?? null);
  const ovEq = ov.also_tracked?.find(x => x.line_code === "5002.5")?.actual ?? null;
  assert(scenario, "5002.5 tracked actual", ovEq, purBoard.tracked["5002.5"]?.period_total ?? null);
  const ovPk = ov.also_tracked?.find(x => x.line_code === "5017.3")?.actual ?? null;
  assert(scenario, "5017.3 tracked actual", ovPk, purBoard.tracked["5017.3"]?.period_total ?? null);

  // Additive purchasing totals field.
  const btdBuckets = purBoard.totals?.buckets_budget_to_date_days;
  const btdOk = btdBuckets && typeof btdBuckets === "object" && "amount" in btdBuckets;
  RESULTS.push({ scenario, name: "purchasing.totals.buckets_budget_to_date_days present + shape", ok: !!btdOk, got: JSON.stringify(btdBuckets), expected: "object w/ amount" });
  console.log(`    ${btdOk ? "PASS " : "FAIL "} purchasing.totals.buckets_budget_to_date_days: ${JSON.stringify(btdBuckets)}`);
}

async function main() {
  const ready = await serverReady();
  if (!ready) {
    console.error(`\n[abort] server at ${BASE} not responding. Start with:`);
    console.error(`  TEST_MODE=true PORT=${PORT} node --env-file=.env.local \\`);
    console.error(`    -e "process.env.TEST_MODE='true'; process.env.PORT='${PORT}'; import('/Users/kevinfietek/dev/kf-cell-states/node_modules/next/dist/bin/next').then(m => m.default(['start','-p','${PORT}']))"`);
    process.exit(2);
  }
  console.log(`Server up at ${BASE}. Running parity across ${ACCTS.length} accounts x ${RANGES.length} ranges.\n`);

  for (const a of ACCTS) {
    for (const r of RANGES) {
      await runScenario(a, r);
    }
  }

  if (SEEDED) {
    console.log("\n=== SEEDED FAILURE ===");
    assert("SEEDED", "intentional wrong-expected", 1.00, 2.00);
  }

  console.log();
  console.log("=".repeat(70));
  let pass = 0, fail = 0;
  for (const r of RESULTS) { if (r.ok) pass += 1; else fail += 1; }
  console.log(`Parity result: ${pass} PASS, ${fail} FAIL across ${RESULTS.length} assertions`);
  console.log("=".repeat(70));
  if (fail > 0) {
    console.log("Failures:");
    for (const r of RESULTS.filter(x => !x.ok)) {
      console.log(`  ${r.scenario} · ${r.name}  got=${r.got}  expected=${r.expected}${r.error ? " · " + r.error : ""}`);
    }
  }
  process.exit((fail > 0 && !SEEDED) ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
