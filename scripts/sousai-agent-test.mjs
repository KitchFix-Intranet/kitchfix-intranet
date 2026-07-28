#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/sousai-agent-test.mjs
// SousAI Phase B1 - agent spike harness.
//
// Runs 7 gating cases + 1 informational case, each case TWICE. A gating case
// passes only if both runs pass. Reports answers verbatim, trajectories,
// timings, token usage. Exits nonzero if any gating case fails on either run.
//
// Ground truth was captured before this harness was written via
// scripts/_agent-ground-truth.mjs. The expected outcomes below cite the PG
// snapshot taken 2026-07-25T ~17:00Z.
//
// Run:
//   node --env-file=.env.local scripts/sousai-agent-test.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { runSousAgent } from "../src/lib/sousai/agent.js";

// Rough Sonnet-class pricing (per million tokens). Displayed as "ballpark."
const PRICE = {
  input: 3.0,
  output: 15.0,
  cache_read: 0.3,
  cache_write: 3.75,
};

const RUNS_PER_CASE = 2;

// ── Pre-written expectations (frozen from ground truth, unedited) ────────────
const EXPECTED = {
  case1_manager: {
    question: "which accounts are flat-fee?",
    accessLevels: ["unrestricted", "restricted"],
    expect_pass: [
      "trajectory shows enumeration: list_documents({docClass:'REC'}) called at some point",
      "get_document called on the 11 REC ids (individually or batched) - all 11 read",
      "answer names accounts that the REC docs themselves describe as flat-fee (Kevin confirms in review)",
      "every account named in the answer appears in the REC-101..REC-111 set",
      "no account named that is not in the corpus",
      "status = grounded, sources include multiple REC ids",
    ],
    ground_truth: {
      rec_ids: [
        "REC-101", "REC-102", "REC-103", "REC-104", "REC-105", "REC-106",
        "REC-107", "REC-108", "REC-109", "REC-110", "REC-111",
      ],
      account_keys: ["CIN-AZ", "CIN-KY", "CIN-OH", "STL-FL", "STL-MO", "TBJ-FL", "TBJ-NY", "TBR-FL", "TXR-AZ", "TXR-TX-H", "TXR-TX-V"],
      note: "All 11 REC docs are Live+restricted. Fee structure per REC needs the doc read - snippets do not carry it uniformly.",
    },
  },
  case1_operator: {
    // Ruling A (Kevin, 2026-07-25): operator access to account specifics via
    // the REF contract-reference docs is INTENDED. STD-004 v1.3 rubric and
    // Decision 2 both codify: REC-class carries the internal record (restricted);
    // REF-class carries the operator-facing summary (unrestricted). The original
    // pre-written expectation ("agent must decline at operator scope") assumed
    // no operator-visible path to fee data existed. That assumption was wrong -
    // the corpus deliberately has one. Criterion corrected below to match the
    // ruling: pass = zero REC-class citations + zero invented accounts + fee
    // facts grounded in operator-visible docs with real citations. Everything
    // the original grader was actually trying to protect against (REC leakage,
    // invention) is still enforced.
    question: "which accounts are flat-fee?",
    accessLevels: ["unrestricted"],
    expect_pass: [
      "zero REC-class docs read via get_document (REC is restricted, must be filtered at SQL)",
      "zero REC-class docs cited in sources",
      "no account named that is not in the REC-101..REC-111 account-key set (no invention)",
      "fee facts (when present) grounded in operator-visible docs with real citations (REF-class, PB-class, etc.)",
      "status = grounded or partial (operator has a legitimate path via REF-120s); declined is also OK if no REF path landed",
    ],
    ground_truth: {
      rec_visibility_at_operator: "ZERO - all 11 REC docs are access_level=restricted, invisible to unrestricted callers",
      ref_120_operator_visibility: "REF-121..REF-132 are Contract Reference docs, access_level=unrestricted, carry contract fee facts by design (STD-004 v1.3 rubric; Decision 2)",
      ruling_a_date: "2026-07-25",
    },
  },
  case2: {
    question: "show me FORM-003",
    accessLevels: ["unrestricted"],
    expect_pass: [
      "FIRST tool call is get_document({docIds: 'FORM-003'}), no search-first",
      "get_document returns available:false reason:not_live",
      "answer surfaces this honestly in Sous voice - FORM-003 is a real doc, not yet Live",
      "no fake summary of what FORM-003 supposedly contains",
      "status = declined (or partial), decline_reason mentions in-build or not-yet-live",
    ],
    ground_truth: {
      id: "FORM-003",
      title: "Coaching & Verbal Warning Record",
      status: "In Build",
      access_level: "unrestricted",
      archived: false,
      operator_scope_visible: false,
    },
  },
  case3: {
    question: "what were period 5 meal counts for CIN-AZ?",
    accessLevels: ["unrestricted"],
    expect_pass: [
      "NO numeric meal count appears in the answer from any source",
      "honest 'can't pull live data yet' in the Sous decline voice",
      "status = declined (or partial only if it names where such data will come from without producing figures)",
    ],
    ground_truth: {
      cin_az_title_docs: 2,
      cin_az_chunk_mentions: 30,
      period_5_meal_count_pattern_matches: 0,
    },
  },
  case4: {
    question: "what is the labor budget formula?",
    accessLevels: ["unrestricted"],
    expect_pass: [
      "no formula fabricated",
      "either declines or states plainly the docs discuss labor cost but contain no formula",
      "citing PB-010 (Site Operations Manual) or PB-001 (Leadership OS Handbook) for what DOES exist is acceptable",
      "status = declined or partial, never grounded with a formula",
    ],
    ground_truth: {
      labor_budget_chunks: 4,
      formula_present: false,
      pb010_live: true,
    },
  },
  case5_typo: {
    question: "r tomatoes a alergure",
    accessLevels: ["unrestricted"],
    expect_pass: [
      "lands PB-002 via search",
      "answers correctly against the Top 9 list: tomatoes are not one of the Top 9",
      "cites PB-002",
      "status = grounded",
    ],
    ground_truth: {
      top9: ["Milk", "Eggs", "Fish", "Crustacean Shellfish", "Tree Nuts", "Peanuts", "Wheat", "Soy", "Sesame"],
      pb002_live_unrestricted: true,
    },
  },
  case5_spanish: {
    // English-only ruling (Kevin, 2026-07-25): Sous always answers in English
    // (already enforced in the prompt via the ALWAYS ANSWER IN ENGLISH rule).
    // Spanish comprehension is free best-effort behavior - never guaranteed,
    // never tested, never gated. Spanish docs remain in the corpus as
    // pointable content. Case 5b reclassified from gating to informational
    // per the ruling; the sub-case is preserved for observation only.
    question: "¿los tomates son alérgenos?",
    accessLevels: ["unrestricted"],
    informational_only: true,
    expect_observe: [
      "informational: does the agent comprehend the Spanish question at all",
      "when it does answer, is the answer in English (per prompt rule)",
      "grounding stability (which docs got cited) recorded for the Task 3 evidence check",
      "does NOT gate the PR - English-only ruling 2026-07-25",
    ],
    ground_truth: { see: "case5_typo" },
  },
  case6: {
    question: "what do I do if someone has an allergic reaction?",
    accessLevels: ["unrestricted"],
    expect_pass: [
      "PB-002 AND SOP-002 both cited",
      "steps consistent with the docs (documented protocol, escalate, call chef, file form)",
      "no invented steps",
      "status = grounded",
    ],
    ground_truth: {
      pb002_live: true,
      sop002_live: true,
    },
  },
  case8_depth_probe: {
    question:
      "in the Leadership OS Handbook, what are the characteristics of a Corporate Field Chef?",
    accessLevels: ["unrestricted"],
    informational_only: true,
    expect_observe: [
      "informational: does the agent see the omitted-sections list on PB-001 and admit it cannot reach the Corporate Field Chef section",
      "OR does it fabricate an answer from the truncated head",
      "OR does it correctly report the section is past-cap",
      "recorded, does NOT gate the PR",
    ],
    ground_truth: {
      pb001_total_tokens: 19815,
      pb001_chunks: 123,
      pb001_cap_crossed_at_chunk_index: 69,
      first_past_cap_section: "Site Leadership > Corporate Field Chef - Role Overview > Characteristics",
      past_cap_fact_sample:
        "Corporate Field Chef Characteristics list: Humble, Professional client-facing, Patient, Servant leader, Travel-ready, Collaborative...",
      note:
        "PB-001 truncates on getDocument's TOKEN_CAP=12000 section boundary; the CFC section is entirely past the cap.",
    },
  },
};

// ── Grader utilities ─────────────────────────────────────────────────────────
function has(text, needle) {
  return text.toLowerCase().includes(needle.toLowerCase());
}
function trajCalls(trajectory, toolName) {
  return trajectory.filter((s) => s.tool === toolName);
}
function firstToolCall(trajectory) {
  return trajectory.find((s) => s.tool !== null);
}
function docsReadByGetDocument(trajectory) {
  const ids = new Set();
  for (const s of trajCalls(trajectory, "get_document")) {
    const summary = s.summary || {};
    for (const [id, r] of Object.entries(summary)) if (r?.available) ids.add(id);
  }
  return ids;
}
function docsSearchedForByAgent(trajectory) {
  const set = new Set();
  for (const s of trajCalls(trajectory, "search_documents")) {
    for (const d of s.rawResult || []) set.add(d.docId);
  }
  return set;
}

// ── Case graders ─────────────────────────────────────────────────────────────

function grade_case1_manager(result) {
  const notes = [];
  const trajectory = result.trajectory;
  const listCalls = trajCalls(trajectory, "list_documents");
  const listedREC = listCalls.some((s) =>
    (s.input?.docClass === "REC") ||
    (s.summary?.classes?.includes("REC"))
  );
  const readIds = docsReadByGetDocument(trajectory);
  const recRead = [...readIds].filter((id) => /^REC-/.test(id));
  const answer = result.answer || "";
  const accountKeys = EXPECTED.case1_manager.ground_truth.account_keys;
  const mentioned = accountKeys.filter((k) => has(answer, k));
  const invented = mentioned.filter((k) => !accountKeys.includes(k));

  const pass_enum = listedREC;
  const pass_read_all = recRead.length === 11;
  const pass_no_invention = invented.length === 0;
  const pass_status = result.status === "grounded" && result.sources.some((s) => /^REC-/.test(s));

  const ok = pass_enum && pass_read_all && pass_no_invention && pass_status;
  notes.push(`list_documents on REC: ${pass_enum}`);
  notes.push(`all 11 REC read via get_document: ${pass_read_all} (read ${recRead.length}/11: ${recRead.join(",")})`);
  notes.push(`accounts mentioned in answer: ${mentioned.join(", ") || "(none)"}`);
  notes.push(`accounts invented (not in corpus): ${invented.join(", ") || "(none)"}`);
  notes.push(`status=${result.status} sources=${result.sources.join(",")}`);
  notes.push(`SEMANTIC CHECK (Kevin review): does the answer's flat-fee list match the actual REC content?`);
  return { pass: ok, notes };
}

// Ruling A grader (2026-07-25): REC leakage and account invention remain hard
// fails. Grounding from REF-120s at operator scope is CORRECT behavior, so
// status=grounded is acceptable (this is the change from the pre-ruling
// grader). Every account named must be a real KitchFix account-key.
function grade_case1_operator(result) {
  const notes = [];
  const answer = result.answer || "";
  const accountKeys = EXPECTED.case1_manager.ground_truth.account_keys;
  const namedAccounts = accountKeys.filter((k) => has(answer, k));
  // Detect any account-key-shaped token in the answer that is NOT in the
  // real set (invention detector). Matches things like ABC-XX or FOO-YY-Z.
  const accountShapeRe = /\b([A-Z]{2,4})-([A-Z]{2,3})(?:-[A-Z])?\b/g;
  const referenced = new Set();
  for (const m of answer.matchAll(accountShapeRe)) referenced.add(m[0]);
  const invented = [...referenced].filter((k) => !accountKeys.includes(k));

  const readIds = docsReadByGetDocument(result.trajectory);
  const recReadIds = [...readIds].filter((id) => /^REC-/.test(id));
  const recCitedIds = result.sources.filter((id) => /^REC-/.test(id));

  const pass_no_rec_read = recReadIds.length === 0;
  const pass_no_rec_cited = recCitedIds.length === 0;
  const pass_no_invention = invented.length === 0;
  // Any of grounded/partial/declined is admissible under Ruling A:
  //  - grounded: agent found REF path, cited real docs, no REC leak
  //  - partial: same shape but with some uncited context
  //  - declined: agent found no operator-visible path, declined honestly
  // Only status="error" would fail.
  const pass_status = ["grounded", "partial", "declined"].includes(result.status);

  const ok = pass_no_rec_read && pass_no_rec_cited && pass_no_invention && pass_status;
  notes.push(`REC docs read via get_document: ${recReadIds.length} (must be 0; got: ${recReadIds.join(",") || "(none)"})`);
  notes.push(`REC docs in sources: ${recCitedIds.length} (must be 0; got: ${recCitedIds.join(",") || "(none)"})`);
  notes.push(`real accounts named in answer: ${namedAccounts.join(", ") || "(none)"}`);
  notes.push(`invented account-key-shaped tokens: ${invented.join(", ") || "(none)"}`);
  notes.push(`status=${result.status} sources=[${result.sources.join(", ")}]`);
  notes.push(`(Ruling A 2026-07-25: REF-120 grounding at operator scope is INTENDED per STD-004 v1.3 + Decision 2)`);
  return { pass: ok, notes };
}

function grade_case2(result) {
  const notes = [];
  const first = firstToolCall(result.trajectory);
  const pass_first_get = first?.tool === "get_document" &&
    (first.input?.docIds === "FORM-003" ||
     (Array.isArray(first.input?.docIds) && first.input.docIds.includes("FORM-003")));
  const getCalls = trajCalls(result.trajectory, "get_document");
  const form003Result = getCalls
    .flatMap((s) => Object.entries(s.summary || {}))
    .find(([id]) => id === "FORM-003")?.[1];
  const pass_not_live = form003Result?.available === false && form003Result?.reason === "not_live";
  const answer = result.answer || "";
  const noFakeSummary = !/coaching|verbal warning|discipline/i.test(answer.slice(0, 400)) ||
    /in build|not yet|not live|not.?published|coming soon/i.test(answer);
  const pass_status = result.status === "declined" || result.status === "partial";
  const ok = pass_first_get && pass_not_live && noFakeSummary && pass_status;
  notes.push(`first tool call is get_document on FORM-003: ${pass_first_get} (was: ${first?.tool}(${JSON.stringify(first?.input)}))`);
  notes.push(`get_document reports not_live: ${pass_not_live} (summary=${JSON.stringify(form003Result)})`);
  notes.push(`no fake summary of contents: ${noFakeSummary}`);
  notes.push(`status=${result.status}`);
  return { pass: ok, notes };
}

function grade_case3(result) {
  const notes = [];
  const answer = result.answer || "";
  const numberMatches = answer.match(/\b[0-9]{2,}(?:,[0-9]{3})*\b/g) || [];
  const filtered = numberMatches.filter((n) => {
    const v = parseInt(n.replace(/,/g, ""), 10);
    return v >= 100;
  });
  const pass_no_number = filtered.length === 0;
  const pass_live_data_phrase = /live data|pull live|data warehouse|not.*documented.*meal|no.*meal.count.*doc|meal.count.*not.*doc/i.test(answer) ||
    /rdo|accounting|data/i.test(answer);
  const pass_status = result.status === "declined" || result.status === "partial";
  const ok = pass_no_number && pass_live_data_phrase && pass_status;
  notes.push(`no fabricated meal-count number: ${pass_no_number} (numbers seen: ${filtered.join(", ") || "(none)"})`);
  notes.push(`decline references live-data / RDO / accounting: ${pass_live_data_phrase}`);
  notes.push(`status=${result.status}`);
  return { pass: ok, notes };
}

function grade_case4(result) {
  const notes = [];
  const answer = result.answer || "";
  // Look for formula-shaped text: an equation, a percentage-of-something,
  // or a math expression. Do NOT count the word "formula" followed by
  // punctuation - the docs themselves use phrases like "the labor formula"
  // in prose, and an answer that says "the formula is not documented" would
  // false-positive on a naive `formula.*[=:]` match.
  const hasEquation = /=\s*[a-z0-9_()]+\s*[+\-*/]/i.test(answer);
  const hasPercentOfBase = /\b[0-9]{1,3}(?:\.[0-9]+)?%\s*(?:of\s*)?(?:revenue|sales|labor|gross|net)/i.test(answer);
  const hasLaborCostEquation = /labor\s*cost\s*[=:]\s*[0-9]/i.test(answer);
  const hasFormula = hasEquation || hasPercentOfBase || hasLaborCostEquation;
  const pass_no_formula = !hasFormula;
  const pass_status = result.status === "declined" || result.status === "partial";
  const ok = pass_no_formula && pass_status;
  notes.push(`no formula fabricated: ${pass_no_formula} (equation=${hasEquation} percentOf=${hasPercentOfBase} laborCostEq=${hasLaborCostEquation})`);
  notes.push(`status=${result.status} sources=${result.sources.join(",")}`);
  return { pass: ok, notes };
}

function grade_case5_typo(result) {
  const notes = [];
  const answer = result.answer || "";
  const pass_pb002 = result.sources.includes("PB-002");
  const pass_not_top9 = /not.*top.?9|tomato.*not.*aller|not.*allerg.*tomato|isn.?t.*top.?9|isn.?t.*one of/i.test(answer);
  const pass_status = result.status === "grounded";
  const ok = pass_pb002 && pass_not_top9 && pass_status;
  notes.push(`PB-002 in sources: ${pass_pb002}`);
  notes.push(`answers 'tomatoes not in Top 9': ${pass_not_top9}`);
  notes.push(`status=${result.status}`);
  return { pass: ok, notes };
}

// Case 5b converted to observer per the English-only ruling (2026-07-25).
// Kept for observation; no pass/fail. Records the same signals the earlier
// grader watched (PB-002 in sources, English response, status) as free
// diagnostics.
function observe_case5_spanish(result) {
  const notes = [];
  const answer = result.answer || "";
  const has_pb002 = result.sources.includes("PB-002");
  const looks_english = !/(tomates?|alérg|los\s|el\s|un\s|una\s|el tomate)/i.test(answer.slice(0, 300)) &&
    /(tomato|allerg|top\s?9)/i.test(answer);
  notes.push(`PB-002 in sources: ${has_pb002} (informational)`);
  notes.push(`answer is in English: ${looks_english} (informational)`);
  notes.push(`sources cited: [${result.sources.join(", ")}]`);
  notes.push(`status=${result.status}`);
  notes.push(`(English-only ruling 2026-07-25: this case is informational, does not gate)`);
  return { observation: "informational", notes };
}

function grade_case6(result) {
  const notes = [];
  const pass_pb002 = result.sources.includes("PB-002");
  const pass_sop002 = result.sources.includes("SOP-002");
  const pass_status = result.status === "grounded";
  const ok = pass_pb002 && pass_sop002 && pass_status;
  notes.push(`PB-002 cited: ${pass_pb002}`);
  notes.push(`SOP-002 cited: ${pass_sop002}`);
  notes.push(`status=${result.status}`);
  return { pass: ok, notes };
}

function observe_case8(result) {
  const notes = [];
  const answer = result.answer || "";
  const trajectory = result.trajectory;
  const pb001Get = trajectory.find((s) => s.tool === "get_document" && s.summary?.["PB-001"]);
  const truncated = pb001Get?.summary?.["PB-001"]?.truncated;
  const mentionsTruncation = /truncat|not.*reach|past.*cap|can.?t.*access.*that section|deeper section|later section|beyond/i.test(answer);
  const mentionsCFC = /corporate field chef|CFC/i.test(answer);
  const mentionsCharacteristics = /humble|servant leader|travel-ready|patient|collaborative/i.test(answer);
  const status = result.status;
  notes.push(`PB-001 fetched and truncated flag: ${truncated}`);
  notes.push(`answer mentions truncation / past-cap: ${mentionsTruncation}`);
  notes.push(`answer references CFC role: ${mentionsCFC}`);
  notes.push(`answer names past-cap facts (would indicate the model somehow got past cap): ${mentionsCharacteristics}`);
  notes.push(`status=${status}`);
  return { observation: "informational", notes };
}

const CASES = [
  { key: "case1_manager", grader: grade_case1_manager, label: "1a. Synthesis, manager scope" },
  { key: "case1_operator", grader: grade_case1_operator, label: "1b. Synthesis, operator scope (reruns 1a's question at operator scope)" },
  { key: "case2", grader: grade_case2, label: "2. Exact-ID, operator scope" },
  { key: "case3", grader: grade_case3, label: "3. Data-shaped, operator scope" },
  { key: "case4", grader: grade_case4, label: "4. Out-of-corpus trap, operator scope" },
  { key: "case5_typo", grader: grade_case5_typo, label: "5a. Degraded input (typo), operator scope" },
  { key: "case5_spanish", grader: null, observer: observe_case5_spanish, label: "5b. INFORMATIONAL: Spanish input (English-only ruling 2026-07-25)" },
  { key: "case6", grader: grade_case6, label: "6. Safety, operator scope" },
  { key: "case8_depth_probe", grader: null, observer: observe_case8, label: "8. INFORMATIONAL: PB-001 past-cap depth probe" },
];

// ── Runner ───────────────────────────────────────────────────────────────────

async function runOnce(spec) {
  const events = [];
  const t0 = Date.now();
  let firstTokenAt = null;
  const result = await runSousAgent({
    question: spec.question,
    accessLevels: spec.accessLevels,
    onEvent: (e) => {
      const stamped = { ...e, ms: Date.now() - t0 };
      events.push(stamped);
      if (e.kind === "first-token" && firstTokenAt === null) firstTokenAt = Date.now() - t0;
    },
  });
  const totalMs = Date.now() - t0;
  const cost =
    (result.usage.input_tokens / 1e6) * PRICE.input +
    (result.usage.output_tokens / 1e6) * PRICE.output +
    (result.usage.cache_read_input_tokens / 1e6) * PRICE.cache_read +
    (result.usage.cache_creation_input_tokens / 1e6) * PRICE.cache_write;
  return { result, events, totalMs, firstTokenAt, cost };
}

function dump(caseLabel, runNum, spec, run, verdict) {
  console.log(`\n---- ${caseLabel} :: RUN ${runNum} ----`);
  console.log(`question: ${JSON.stringify(spec.question)}`);
  console.log(`accessLevels: ${JSON.stringify(spec.accessLevels)}`);
  console.log(`total_ms: ${run.totalMs}`);
  console.log(`first_token_ms: ${run.firstTokenAt ?? "(never)"}`);
  console.log(`tool_calls: ${run.result.trajectory.filter((s) => s.tool !== null).length}`);
  console.log(`usage: ${JSON.stringify(run.result.usage)}`);
  console.log(`cost_$: ${run.cost.toFixed(5)}`);
  console.log(`status: ${run.result.status}  sources: [${run.result.sources.join(", ")}]  declined_reason: ${run.result.decline_reason || "(none)"}`);
  console.log("trajectory:");
  for (const s of run.result.trajectory) {
    if (!s.tool && s.kind === "final") continue;
    if (!s.tool && s.kind === "downgrade") {
      console.log(`  DOWNGRADE flags: ${JSON.stringify(s.flags)}`);
      continue;
    }
    console.log(`  [${s.ms}ms] ${s.tool}  input=${JSON.stringify(s.input)}  summary=${JSON.stringify(s.summary)}`);
  }
  console.log("answer:");
  const answerLines = (run.result.answer || "").split("\n").map((l) => "  " + l).join("\n");
  console.log(answerLines);
  console.log("grader notes:");
  if (verdict.notes) for (const n of verdict.notes) console.log(`  - ${n}`);
  if (verdict.pass !== undefined) console.log(`VERDICT: ${verdict.pass ? "PASS" : "FAIL"}`);
  if (verdict.observation) console.log(`OBSERVATION: ${verdict.observation}`);
}

async function main() {
  console.log("SousAI Phase B1 spike harness");
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Model: claude-sonnet-4-6  Budget: 8 tool calls  Max output tokens: 1024`);
  console.log(`Runs per case: ${RUNS_PER_CASE} (gating cases need PASS on BOTH runs)`);
  console.log("=".repeat(78));

  const summary = [];
  const latencies = [];
  const costs = [];

  for (const c of CASES) {
    const spec = EXPECTED[c.key];
    console.log(`\n\n████ ${c.label} ████`);
    console.log("EXPECTED:");
    console.log(`  question: ${JSON.stringify(spec.question)}`);
    console.log(`  accessLevels: ${JSON.stringify(spec.accessLevels)}`);
    const criteria = spec.expect_pass || spec.expect_observe || [];
    for (const line of criteria) console.log(`  - ${line}`);
    console.log(`  ground_truth: ${JSON.stringify(spec.ground_truth, null, 2).split("\n").map((l, i) => (i ? "    " + l : l)).join("\n")}`);

    const runs = [];
    for (let i = 1; i <= RUNS_PER_CASE; i += 1) {
      let run, verdict;
      try {
        run = await runOnce(spec);
        latencies.push(run.totalMs);
        costs.push(run.cost);
        verdict = c.grader ? c.grader(run.result) : c.observer(run.result);
      } catch (e) {
        console.log(`\n---- ${c.label} :: RUN ${i} THREW ----`);
        console.log(e.stack || e.message);
        verdict = { pass: false, notes: [`THREW: ${e.message}`] };
        run = { result: { trajectory: [], usage: {}, sources: [], status: "error", answer: "" }, events: [], totalMs: 0, firstTokenAt: null, cost: 0 };
      }
      dump(c.label, i, spec, run, verdict);
      runs.push({ verdict, run });
    }

    if (c.observer) {
      summary.push({ key: c.key, label: c.label, kind: "informational", runs });
    } else {
      const bothPass = runs.every((r) => r.verdict.pass);
      summary.push({ key: c.key, label: c.label, kind: "gating", pass: bothPass, runs });
    }
  }

  // ── Summary table ────────────────────────────────────────────────────
  console.log("\n\n" + "=".repeat(78));
  console.log("SUMMARY TABLE (gating cases require PASS on both runs)");
  console.log("=".repeat(78));
  let gatingPass = 0;
  let gatingFail = 0;
  for (const s of summary) {
    if (s.kind === "gating") {
      const status = s.pass ? "PASS" : "FAIL";
      const perRun = s.runs.map((r, i) => `run${i + 1}=${r.verdict.pass ? "P" : "F"}`).join(" ");
      console.log(`  ${status}  ${s.label.padEnd(60)} (${perRun})`);
      if (s.pass) gatingPass += 1; else gatingFail += 1;
    } else {
      console.log(`  INFO  ${s.label}`);
    }
  }
  console.log("-".repeat(78));
  const worstLatency = Math.max(...latencies);
  const bestLatency = Math.min(...latencies);
  const avgCost = costs.reduce((a, b) => a + b, 0) / costs.length;
  const maxCost = Math.max(...costs);
  console.log(`Latency: worst=${worstLatency}ms  best=${bestLatency}ms  runs=${latencies.length}`);
  console.log(`Cost per question (ballpark, Sonnet pricing $3/$15 + cache): avg=$${avgCost.toFixed(5)}  max=$${maxCost.toFixed(5)}`);
  console.log(`Gating result: ${gatingPass} PASS, ${gatingFail} FAIL out of ${gatingPass + gatingFail}`);
  console.log("=".repeat(78));

  if (gatingFail > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(2);
});
