#!/usr/bin/env node
/*
 * Time /api/kpi/purchasing across three paths so a before/after
 * comparison covers the surface Kevin named:
 *   1. ALL FYTD default              (paginateActuals + weekly etc)
 *   2. per-site CIN - AZ default     (must not regress - already fast)
 *   3. ALL FYTD ?drill=lines         (row-level; column trim MUST NOT
 *                                     apply here - includeLines keeps
 *                                     all 14 columns)
 *
 * Three cold runs each; report min / median / max. Also spot-checks the
 * key figures (buckets[].spent, totals.card.spent, pending.line_count,
 * compliance.total_count) so a wire shape change that killed a number
 * fails loud, not silently.
 *
 * Requires the dev server on port 3022 with TEST_MODE=true.
 */
const BASE = process.env.KPI_BASE || "http://localhost:3022";
const HEADERS = { "X-Test-Mode": "1" };

async function hit(path) {
  const t0 = performance.now();
  const r = await fetch(`${BASE}${path}`, { headers: HEADERS });
  const ms = performance.now() - t0;
  const size = Number(r.headers.get("content-length") || 0);
  const body = await r.json();
  const bodySize = JSON.stringify(body).length;
  return { ms, size, bodySize, body };
}

async function run(label, path, runs = 3) {
  console.log(`\n=== ${label} ===`);
  console.log(`  path: ${path}`);
  const times = [];
  let body = null;
  for (let i = 0; i < runs; i++) {
    const r = await hit(path);
    times.push(r.ms);
    body = r.body;
    console.log(`  run ${i+1}: ${r.ms.toFixed(0).padStart(5)}ms  body=${(r.bodySize / 1024).toFixed(1).padStart(6)}KB`);
  }
  times.sort((a, b) => a - b);
  const min = times[0], mid = times[Math.floor(times.length / 2)], max = times[times.length - 1];
  console.log(`  min=${min.toFixed(0)}ms  median=${mid.toFixed(0)}ms  max=${max.toFixed(0)}ms`);
  return { label, path, times, body };
}

const rall  = await run("ALL FYTD (default)",         "/api/kpi/purchasing?account=ALL");
const rsite = await run("per-site CIN - AZ",           "/api/kpi/purchasing?account=CIN%20-%20AZ");
const rdrill = await run("ALL FYTD ?drill=lines",      "/api/kpi/purchasing?account=ALL&drill=lines");

// ─── figure spot-check ──────────────────────────────────────────────
console.log("\n=== figure spot-check (per response, must be stable before/after) ===");
function report(label, body) {
  const b = body || {};
  const buckets = (b.buckets || []).map(x => `${x.key}=$${x.spent?.toFixed(2)}`).join(" ");
  console.log(`  [${label}]`);
  console.log(`    pending.line_count: ${b.pending?.line_count}`);
  console.log(`    pending.amount:     ${b.pending?.amount}`);
  console.log(`    buckets:            ${buckets}`);
  console.log(`    totals.card:        spent=${b.totals?.card?.spent}  uncoded=${b.totals?.card?.uncoded}  unattributed=${b.totals?.card?.unattributed}`);
  console.log(`    totals.pl_cogs:     ${b.totals?.pl_cogs?.spent}`);
  console.log(`    compliance:         ${b.compliance?.total_count}`);
  console.log(`    ledgers:            veh=${b.ledgers?.vehicle?.total_amount} eq=${b.ledgers?.equipment?.total_amount} rm=${b.ledgers?.repair?.total_amount} rb=${b.ledgers?.reimbursable?.total_amount}`);
  console.log(`    drill actuals rows: ${b.actuals?.length ?? "not shipped (default payload)"}`);
}
report(rall.label,  rall.body);
report(rsite.label, rsite.body);
report(rdrill.label, rdrill.body);
