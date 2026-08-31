#!/usr/bin/env node
// scripts/academy-issue.mjs
//
// Dry-run + apply for the Academy requirements engine (spec
// Sections 5, 6). Wraps src/lib/academy/requirements.js with a
// CLI that reports before writing.
//
// Usage:
//   node --env-file=.env.local scripts/academy-issue.mjs cycle    <cycle_id>  [--apply --published-by <email>]
//   node --env-file=.env.local scripts/academy-issue.mjs onboarding [--apply] [--backfill]
//   node --env-file=.env.local scripts/academy-issue.mjs rehire     [--apply]
//
// Default mode: dry-run. Nothing writes until --apply is passed.
// Even under --apply, cycle publishing goes through
// publish_cycle_atomic (the RPC in academy-5) so the status flip
// and requirement insert land atomically.
//
// Environment: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, per the
// CLAUDE.md USE-not-SEE rule (pass via --env-file, never read
// contents).
//
// The dry-run IS the verification. No UI in this PR; the numbers
// this script prints are what a reviewer gates on.

import { createClient } from "@supabase/supabase-js";
import {
  planCyclePublish,
  planOnboarding,
  planRehire,
  applyCyclePublish,
  applyRequirements,
  ACADEMY_LAUNCH_DATE,
} from "../src/lib/academy/requirements.js";

const argv = process.argv.slice(2);
const trigger = argv[0];
const args = argv.slice(1);
const hasFlag = (f) => args.includes(f);
const flagValue = (f) => {
  const i = args.indexOf(f);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};

if (!trigger) {
  console.error("usage:");
  console.error("  scripts/academy-issue.mjs cycle <cycle_id> [--apply --published-by <email>]");
  console.error("  scripts/academy-issue.mjs onboarding       [--apply] [--backfill]");
  console.error("  scripts/academy-issue.mjs rehire           [--apply]");
  process.exit(2);
}

function newClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  console.log(`SUPABASE_URL: ${url ? "PRESENT" : "ABSENT"}`);
  console.log(`SUPABASE_SERVICE_ROLE_KEY: ${key ? "PRESENT" : "ABSENT"}`);
  if (!url || !key) {
    console.error("FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be present.");
    console.error("       Pass via --env-file=.env.local; do not export or echo.");
    process.exit(1);
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function line() { console.log("-".repeat(72)); }
function h1(s)  { line(); console.log(s); line(); }

function printByObject(o) {
  const keys = Object.keys(o).sort();
  for (const k of keys) console.log(`  ${k.padEnd(28)} ${o[k]}`);
}

async function runCycle() {
  const cycleId = Number(args[0]);
  if (!Number.isInteger(cycleId) || cycleId <= 0) {
    console.error("cycle_id must be a positive integer");
    process.exit(2);
  }
  const apply = hasFlag("--apply");
  const publishedBy = flagValue("--published-by");
  if (apply && !publishedBy) {
    console.error("--apply requires --published-by <email>");
    process.exit(2);
  }

  const supa = newClient();
  const plan = await planCyclePublish(supa, cycleId);
  const r = plan.report;

  h1(`Cycle publish plan · cycle_id=${cycleId} · ${plan.cycle.label}`);
  console.log(`  period      : ${plan.cycle.period_start} .. ${plan.cycle.period_end}`);
  console.log(`  status      : ${plan.cycle.status}`);
  console.log(`  modules     : ${r.modules}`);
  console.log(`  people      : ${r.peopleAffected}`);
  console.log(`  requirements: ${r.totalRequirements}`);
  console.log("");
  // Audience scope: {} means no narrowing. Print it so the reader
  // always knows whether the plan is Kevin-only, region-only, etc.
  const scopeKeys = Object.keys(r.audienceScope || {});
  if (scopeKeys.length === 0) {
    console.log("  audience scope: {} (no narrowing - full obligation audience)");
  } else {
    console.log(`  audience scope: ${JSON.stringify(r.audienceScope)}`);
  }
  console.log("");
  console.log("  by class:");
  printByObject(r.byClass);
  console.log("");
  console.log("  by account (top rows):");
  const entries = Object.entries(r.byAccount).sort((a, b) => b[1] - a[1]);
  for (const [k, v] of entries) console.log(`    ${k.padEnd(20)} ${v}`);
  console.log("");
  if (r.minutesSummary) {
    console.log(`  minutes per person: min=${r.minutesSummary.min} avg=${r.minutesSummary.avg} max=${r.minutesSummary.max} total=${r.minutesSummary.total}`);
    console.log("");
  }
  if (r.skipped.length > 0) {
    console.log(`  skipped modules (${r.skipped.length}):`);
    for (const s of r.skipped) console.log(`    ${s.module}: ${s.reason}`);
    console.log("");
  }
  // Cycle-scope skips are separated from obligation-eligibility
  // skips so a reader can tell "this obligation does not apply to
  // you" (spec) from "this cycle was not published to you"
  // (operator choice). Same person can appear in both counts if
  // they are excluded by different modules for different reasons.
  const scopeSkipEntries = Object.entries(r.scopeSkippedByReason || {}).sort((a, b) => b[1] - a[1]);
  if (scopeSkipEntries.length > 0) {
    console.log(`  cycle-scope skipped (obligation × person, ${scopeSkipEntries.reduce((s, [, n]) => s + n, 0)} total):`);
    for (const [reason, n] of scopeSkipEntries) console.log(`    ${String(n).padStart(6)}  ${reason}`);
    console.log("");
  }
  if (r.roleWarnings.length > 0) {
    console.log(`  role warnings (${r.roleWarnings.length}):`);
    for (const w of r.roleWarnings.slice(0, 10)) console.log(`    ${w.module} / ${w.worker_id}: ${w.reason}`);
    if (r.roleWarnings.length > 10) console.log(`    ...and ${r.roleWarnings.length - 10} more`);
    console.log("");
  }
  // On-hire warning: a cycle carrying an on-hire obligation
  // conflates the cycle mechanism with the onboarding trigger.
  // Kevin decides whether a given cycle is a launch-catch-up.
  if ((r.onHireModules || []).length > 0) {
    console.log(`  WARNING - cycle contains ${r.onHireModules.length} on-hire cadence module(s):`);
    for (const m of r.onHireModules) console.log(`    ${m}`);
    console.log("    Rationale: a new hire in October would receive these from BOTH");
    console.log("    the onboarding trigger AND this cycle (different `source` values;");
    console.log("    unique index permits both). Defensible as a launch catch-up; not");
    console.log("    otherwise. Kevin's call.");
    console.log("");
  }
  // Publish-time refusals.
  if (r.wouldRefuseApply) {
    console.log("  PUBLISH WOULD BE REFUSED:");
    for (const reason of (r.refuseReasons || [])) {
      console.log(`    - ${reason}`);
    }
    console.log("");
  }

  if (!apply) {
    console.log("dry-run: no writes.");
    return;
  }

  h1(`Publishing cycle ${cycleId} via publish_cycle_atomic`);
  const result = await applyCyclePublish(supa, cycleId, publishedBy, plan);
  console.log(`  new_status:             ${result?.new_status || "?"}`);
  console.log(`  published_at:           ${result?.published_at || "?"}`);
  console.log(`  requirements_inserted:  ${result?.requirements_inserted ?? "?"}`);
  console.log(`  requirements_skipped:   ${result?.requirements_skipped ?? "?"}`);
}

async function runOnboarding() {
  const apply = hasFlag("--apply");
  const backfill = hasFlag("--backfill");

  const supa = newClient();
  const plan = await planOnboarding(supa, { backfill });
  const r = plan.report;

  h1(`Onboarding plan · launchDate=${plan.launchDate} · backfill=${backfill}`);
  console.log(`  obligations (on-hire only): ${r.obligations}`);
  console.log("");
  console.log("  Recommended boundary (status=HIRED OR start_date >= launchDate):");
  console.log(`    people affected: ${r.recommended.peopleAffected}`);
  console.log(`    requirements:    ${r.recommended.totalRequirements}`);
  console.log("    by class:");
  printByObject(r.recommended.byClass);
  console.log("");
  console.log("  Backfill alternative (all currently-eligible people):");
  console.log(`    people affected: ${r.backfillAlternative.peopleAffected}`);
  console.log(`    requirements:    ${r.backfillAlternative.totalRequirements}`);
  console.log("    by class:");
  printByObject(r.backfillAlternative.byClass);
  console.log("");
  if (r.boundaryPeople.length > 0) {
    console.log("  boundary stints (would receive rows):");
    for (const b of r.boundaryPeople) {
      console.log(`    ${b.worker_id}  ${b.display_name || "?"}  status=${b.status}  start=${b.start_date}  ${b.is_salaried ? "salaried" : "hourly"}  ${b.account_key || "?"}`);
    }
    console.log("");
  }
  if (Object.keys(r.skippedByReason).length > 0) {
    console.log("  skipped tally (obligation × person × reason):");
    const entries = Object.entries(r.skippedByReason).sort((a, b) => b[1] - a[1]);
    for (const [reason, n] of entries) console.log(`    ${String(n).padStart(6)}  ${reason}`);
    console.log("");
  }
  if (r.roleWarnings.length > 0) {
    console.log(`  role warnings (${r.roleWarnings.length}):`);
    for (const w of r.roleWarnings.slice(0, 10)) console.log(`    ${w.module}: ${w.reason}`);
    console.log("");
  }

  if (!apply) {
    console.log("dry-run: no writes.");
    return;
  }
  h1("Applying onboarding requirements");
  const res = await applyRequirements(supa, plan, { issuedBy: "system" });
  console.log(`  inserted: ${res.inserted}`);
  console.log(`  skipped:  ${res.skipped}`);
}

async function runRehire() {
  const apply = hasFlag("--apply");
  const supa = newClient();
  const plan = await planRehire(supa);
  const r = plan.report;

  h1("Rehire plan");
  console.log(`  obligations (on-hire only): ${r.obligations}`);
  console.log(`  candidate stints:           ${r.candidateStints}`);
  console.log(`  requirements:               ${r.totalRequirements}`);
  console.log("  by class:");
  printByObject(r.byClass);
  console.log("");
  if (r.driftCandidates.length > 0) {
    console.log(`  derive-drift candidates (${r.driftCandidates.length}) - no academy_person_stints row:`);
    for (const d of r.driftCandidates.slice(0, 20)) {
      console.log(`    ${d.worker_id}  ${d.display_name || "?"}  ${d.reason}`);
    }
    if (r.driftCandidates.length > 20) console.log(`    ...and ${r.driftCandidates.length - 20} more`);
    console.log("");
  }
  if (r.roleWarnings.length > 0) {
    console.log(`  role warnings (${r.roleWarnings.length}):`);
    for (const w of r.roleWarnings.slice(0, 10)) console.log(`    ${w.module}: ${w.reason}`);
    console.log("");
  }
  if (!apply) {
    console.log("dry-run: no writes.");
    return;
  }
  h1("Applying rehire requirements");
  const res = await applyRequirements(supa, plan, { issuedBy: "system" });
  console.log(`  inserted: ${res.inserted}`);
  console.log(`  skipped:  ${res.skipped}`);
}

async function main() {
  console.log(`academy-issue trigger=${trigger} launchDate=${ACADEMY_LAUNCH_DATE}`);
  if (trigger === "cycle")      await runCycle();
  else if (trigger === "onboarding") await runOnboarding();
  else if (trigger === "rehire")     await runRehire();
  else {
    console.error(`unknown trigger: ${trigger}`);
    process.exit(2);
  }
}

main().catch((e) => {
  console.error("FATAL:", e?.message || e);
  process.exit(1);
});
