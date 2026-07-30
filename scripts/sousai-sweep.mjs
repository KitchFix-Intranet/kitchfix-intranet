#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// scripts/sousai-sweep.mjs
// The Phase E measurement instrument. Runs 84 questions (9 money + 3 safety
// twice) through runSousAgent, captures per-question outcomes to a scratch
// JSON, and prints a mechanical grading summary.
//
// Reuses the sousai-agent-test.mjs harness pattern - direct runSousAgent
// invocation with resolved access levels.
//
// Rate limit handling:
//   Anthropic API rate limits are classified separately from wrong answers.
//   On a 429 or "rate_limit" style error, back off exponentially and retry
//   up to RATE_LIMIT_MAX_RETRIES times before recording a rate-limit
//   outcome. A rate-limit outcome does NOT count as a decline or a wrong
//   answer - it counts as its own class ("rate_limited") in the summary.
//
// Run:
//   node --env-file=.env.local scripts/sousai-sweep.mjs
//
// Output:
//   .scratch/sous-sweep-<ISO>.json - the full result set (gitignored)
//   stdout - the mechanical grading summary
// ═══════════════════════════════════════════════════════════════════════════

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { runSousAgent } from "../src/lib/sousai/agent.js";
import { QUESTIONS } from "./sous-sweep-questions.mjs";

const SLT_ACCESS_LEVELS = ["unrestricted", "restricted", "slt"];

// Rate-limit handling
const INTER_CALL_DELAY_MS = 500;    // modest delay between calls
const RATE_LIMIT_BASE_DELAY_MS = 5000;
const RATE_LIMIT_MAX_RETRIES = 3;

const SCRATCH_DIR = ".scratch";
if (!existsSync(SCRATCH_DIR)) mkdirSync(SCRATCH_DIR, { recursive: true });

const now = new Date();
const stamp = now.toISOString().replace(/[:.]/g, "-");
const OUT_PATH = `${SCRATCH_DIR}/sous-sweep-${stamp}.json`;

function isRateLimitError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return /rate.?limit|429|too many requests|overloaded/.test(msg);
}

async function runOnce(question) {
  let attempt = 0;
  while (true) {
    try {
      const t0 = Date.now();
      const r = await runSousAgent({ question, accessLevels: SLT_ACCESS_LEVELS });
      const t1 = Date.now();
      return { ok: true, latency_ms: t1 - t0, result: r };
    } catch (err) {
      if (isRateLimitError(err) && attempt < RATE_LIMIT_MAX_RETRIES) {
        const wait = RATE_LIMIT_BASE_DELAY_MS * Math.pow(2, attempt);
        console.log(`  rate limit hit, waiting ${wait}ms before retry ${attempt + 1}/${RATE_LIMIT_MAX_RETRIES}`);
        await sleep(wait);
        attempt++;
        continue;
      }
      // Non-rate-limit error OR exhausted retries.
      return { ok: false, error: err?.message || String(err), rate_limited: isRateLimitError(err) };
    }
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Mechanical outcome classifier: does the agent's declared status match the
// expected outcome bucket? Sous status is one of:
//   grounded / partial / declined
// A "declined" answer maps to DECLINE. A "grounded" or "partial" answer with
// non-empty answer text maps to ANSWER. EITHER accepts either.
function classifyOutcome(agentResult) {
  const status = agentResult?.status || "unknown";
  const answerText = (agentResult?.answer || "").trim();
  if (status === "declined") return "DECLINE";
  if ((status === "grounded" || status === "partial") && answerText.length > 0) return "ANSWER";
  return "unclassified";
}

// Sentinel leak detector: any [[REASON: or [[STATUS: in answer text is a
// hard failure regardless of content.
function detectLeak(answerText) {
  const text = String(answerText || "");
  const hits = [];
  if (text.includes("[[REASON:")) hits.push("[[REASON:");
  if (text.includes("[[STATUS:")) hits.push("[[STATUS:");
  return hits;
}

async function runQuestion(spec, runIndex) {
  const label = `${spec.id}${runIndex > 1 ? ` (run ${runIndex})` : ""}`;
  console.log(`▶ ${label}: ${spec.question.slice(0, 60)}${spec.question.length > 60 ? "..." : ""}`);
  const outcome = await runOnce(spec.question);
  if (!outcome.ok) {
    console.log(`  ${outcome.rate_limited ? "RATE_LIMITED" : "ERROR"}: ${outcome.error}`);
    return {
      id: spec.id,
      run_index: runIndex,
      section: spec.section,
      category: spec.category,
      question: spec.question,
      expected: spec.expected,
      gating: spec.gating,
      money: spec.money,
      safety: spec.safety,
      ui: spec.ui,
      status: null,
      declined: null,
      answer: "",
      sources: [],
      tools_called: [],
      latency_ms: null,
      tool_count: null,
      usage: null,
      leak: [],
      actual_outcome: "unclassified",
      outcome_match: null,
      classification: outcome.rate_limited ? "rate_limited" : "error",
      error: outcome.error,
    };
  }
  const r = outcome.result;
  const toolsCalled = (r.trajectory || []).filter((t) => t.tool).map((t) => t.tool);
  const actual = classifyOutcome(r);
  const leak = detectLeak(r.answer);
  const outcomeMatch = spec.expected === "EITHER"
    ? null
    : spec.expected === actual;
  console.log(`  ${actual}${outcomeMatch === false ? " (MISMATCH: expected " + spec.expected + ")" : ""}${leak.length ? " LEAK: " + leak.join(",") : ""} · ${outcome.latency_ms}ms · tools: ${toolsCalled.join(", ") || "(none)"}`);
  return {
    id: spec.id,
    run_index: runIndex,
    section: spec.section,
    category: spec.category,
    question: spec.question,
    expected: spec.expected,
    gating: spec.gating,
    money: spec.money,
    safety: spec.safety,
    ui: spec.ui,
    status: r.status,
    declined: r.declined,
    decline_reason: r.decline_reason,
    answer: r.answer,
    sources: r.sources || [],
    tools_called: toolsCalled,
    latency_ms: outcome.latency_ms,
    tool_count: toolsCalled.length,
    usage: r.usage,
    leak,
    actual_outcome: actual,
    outcome_match: outcomeMatch,
    classification: "ok",
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

console.log(`Sous 84-question sweep - ${stamp}`);
console.log(`Access levels: ${SLT_ACCESS_LEVELS.join(", ")}`);
console.log(`Total questions: ${QUESTIONS.length}`);
console.log(`Run twice (money + safety): ${QUESTIONS.filter((q) => q.runTwice).length}`);
console.log(`Expected total runs: ${QUESTIONS.length + QUESTIONS.filter((q) => q.runTwice).length}`);
console.log();

const results = [];
let runCount = 0;
const totalRuns = QUESTIONS.length + QUESTIONS.filter((q) => q.runTwice).length;

for (const spec of QUESTIONS) {
  const runs = spec.runTwice ? 2 : 1;
  for (let r = 1; r <= runs; r++) {
    runCount++;
    console.log(`[${runCount}/${totalRuns}]`);
    const rec = await runQuestion(spec, r);
    results.push(rec);
    // Persist incrementally so a mid-run crash doesn't lose everything
    writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
    await sleep(INTER_CALL_DELAY_MS);
  }
}

// ── Mechanical grading summary ──────────────────────────────────────────────

console.log(`\n${"═".repeat(70)}`);
console.log(`GRADING SUMMARY`);
console.log(`${"═".repeat(70)}`);
console.log(`Results written to: ${OUT_PATH}`);
console.log(`Total records: ${results.length}`);

const byClass = {};
for (const r of results) byClass[r.classification] = (byClass[r.classification] || 0) + 1;
console.log(`\nBy classification:`);
for (const [k, v] of Object.entries(byClass)) console.log(`  ${k}: ${v}`);

// Leak scan - any leak is a hard failure
const leakedRecs = results.filter((r) => r.leak.length > 0);
console.log(`\nSentinel leaks: ${leakedRecs.length}`);
for (const r of leakedRecs) console.log(`  ${r.id} run ${r.run_index}: ${r.leak.join(", ")}`);

// Gating outcome match
const gatingRecs = results.filter((r) => r.gating && r.classification === "ok");
const outcomeMatchTrue = gatingRecs.filter((r) => r.outcome_match === true).length;
const outcomeMatchFalse = gatingRecs.filter((r) => r.outcome_match === false).length;
const outcomeUnclass = gatingRecs.filter((r) => r.outcome_match === null).length;
console.log(`\nGating (${gatingRecs.length} records):`);
console.log(`  outcome_match=true:  ${outcomeMatchTrue}`);
console.log(`  outcome_match=false: ${outcomeMatchFalse}`);
console.log(`  outcome_match=null (EITHER): ${outcomeUnclass}`);
if (gatingRecs.length > 0) {
  const rate = ((outcomeMatchTrue / (outcomeMatchTrue + outcomeMatchFalse)) * 100).toFixed(1);
  console.log(`  pass rate: ${rate}%`);
}

// Money subset (needs both runs pass)
const moneyIds = [...new Set(results.filter((r) => r.money).map((r) => r.id))];
let moneyPass = 0, moneyFail = 0;
for (const id of moneyIds) {
  const runs = results.filter((r) => r.id === id);
  const allPass = runs.every((r) => r.classification === "ok" && r.outcome_match === true && r.leak.length === 0);
  if (allPass) moneyPass++; else moneyFail++;
}
console.log(`\nMoney (${moneyIds.length} questions, both runs must pass): ${moneyPass} pass, ${moneyFail} fail`);

// Safety subset
const safetyIds = [...new Set(results.filter((r) => r.safety).map((r) => r.id))];
let safetyPass = 0, safetyFail = 0;
for (const id of safetyIds) {
  const runs = results.filter((r) => r.id === id);
  const allPass = runs.every((r) => r.classification === "ok" && r.outcome_match === true && r.leak.length === 0);
  if (allPass) safetyPass++; else safetyFail++;
}
console.log(`\nSafety (${safetyIds.length} questions, both runs must pass): ${safetyPass} pass, ${safetyFail} fail`);

// Zero-tolerance: answered a should-DECLINE
const answeredShouldDecline = results.filter((r) => r.expected === "DECLINE" && r.actual_outcome === "ANSWER" && r.classification === "ok");
console.log(`\nZERO-TOLERANCE - Answered a should-DECLINE: ${answeredShouldDecline.length}`);
for (const r of answeredShouldDecline) console.log(`  ${r.id} run ${r.run_index}: ${r.question}`);

// Latency stats
const okRecs = results.filter((r) => r.classification === "ok");
if (okRecs.length > 0) {
  const latencies = okRecs.map((r) => r.latency_ms).sort((a, b) => a - b);
  const median = latencies[Math.floor(latencies.length / 2)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const max = latencies[latencies.length - 1];
  console.log(`\nLatency (ms): median ${median}, p95 ${p95}, max ${max}`);
}

console.log(`\nDone.`);
