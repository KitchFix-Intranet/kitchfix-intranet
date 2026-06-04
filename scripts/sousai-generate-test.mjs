// ─────────────────────────────────────────────────────────────────────────────
// scripts/sousai-generate-test.mjs
// SousAI demo test - 7 candidate questions through retrieve→generate.
// ─────────────────────────────────────────────────────────────────────────────
//
// Function-first demo: shows real Sous answers before any UI is built.
// Run:
//   node --env-file=.env.local scripts/sousai-generate-test.mjs
//
// Reads the SousAI character spec via the system prompt embedded in
// src/lib/sousai/generate.js. Tune that prompt + re-run this script.
// ─────────────────────────────────────────────────────────────────────────────

import { generateSousAnswer, SOUSAI_SIMILARITY_THRESHOLD, SOUSAI_TOP_K, SOUSAI_MODEL } from "../src/lib/sousai/generate.js";

const QUESTIONS = [
  // ── IN-CORPUS (Sous should answer, grounded + cited) ─────────────────────
  {
    label: "1. IN-CORPUS - allergic reaction (the safety key one)",
    q: "What do I do if someone has an allergic reaction?",
    expect: "PB-002 + SOP-002, route to documented protocol, cite both",
  },
  {
    label: "2. IN-CORPUS - top 9 allergens (clean factual recall)",
    q: "What are the top 9 allergens?",
    expect: "PB-002 Top 9 list, cite PB-002",
  },
  {
    label: "3. IN-CORPUS - safety incident procedure (favor SOP-002)",
    q: "What's the procedure for a safety incident?",
    expect: "SOP-002 six steps, cite SOP-002",
  },
  {
    label: "4. IN-CORPUS - big rules (different domain, confidentiality)",
    q: "What are the big rules?",
    expect: "AGR-001 confidentiality content",
  },
  {
    label: "5. IN-CORPUS - medical refusal form (route to form, don't paraphrase)",
    q: "What form do I use when someone refuses medical treatment?",
    expect: "Point to FORM-001 + SOP-002 §7.1 context, don't improvise medical-refusal language",
  },
  // ── OUT-OF-CORPUS (Sous should decline honestly, not invent) ─────────────
  {
    label: "6. OUT-OF-CORPUS - labor budget (no figure in corpus)",
    q: "What is our labor budget formula?",
    expect: "Honest decline, point to RDO / accounting",
  },
  {
    label: "7. OUT-OF-CORPUS - brand promise (not authored yet, per spec §13)",
    q: "What is our company's brand promise?",
    expect: "Honest decline (the company-identity corpus isn't loaded yet)",
  },
];

console.log(`SousAI generation test`);
console.log(`  Model:     ${SOUSAI_MODEL}`);
console.log(`  Top-K:     ${SOUSAI_TOP_K}`);
console.log(`  Floor:     ${SOUSAI_SIMILARITY_THRESHOLD} (below = decline without LLM call)`);
console.log();

let totalInputTokens = 0;
let totalOutputTokens = 0;
let answeredCount = 0;
let declinedCount = 0;
let errorCount = 0;

for (const Q of QUESTIONS) {
  console.log("════════════════════════════════════════════════════════════════════════════");
  console.log(`  ${Q.label}`);
  console.log(`  Q: "${Q.q}"`);
  console.log(`  Expect: ${Q.expect}`);
  console.log("════════════════════════════════════════════════════════════════════════════");

  try {
    const t0 = Date.now();
    const r = await generateSousAnswer({ question: Q.q });
    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

    if (r.declined) {
      console.log(`  [Layer-1 decline - retrieval below floor]`);
      console.log(`  ${r.decline_reason}`);
      console.log();
      console.log(`  Top retrieval (informational - Sous did NOT see these as answer material):`);
      for (const c of (r.retrieval || []).slice(0, 5)) {
        const sec = c.section || "(no section)";
        console.log(`    sim=${c.similarity.toFixed(4)}  ${c.doc_id}  ${sec}`);
      }
      const u = r.usage || {};
      const tok = `${u.input_tokens ?? "?"}in / ${u.output_tokens ?? "?"}out`;
      console.log();
      console.log(`  Spoken decline (${elapsedSec}s, ${tok}):`);
      console.log();
      for (const line of (r.answer || "(empty)").split("\n")) {
        console.log(`    ${line}`);
      }
      totalInputTokens += u.input_tokens || 0;
      totalOutputTokens += u.output_tokens || 0;
      declinedCount++;
    } else {
      console.log(`  Sources Sous had in context (${r.sources_in_context.length}):`);
      for (const s of r.sources_in_context) {
        const sec = s.section || "(no section)";
        console.log(`    sim=${s.similarity.toFixed(4)}  ${s.doc_id} · ${s.title}`);
        console.log(`               ${sec}`);
      }
      const u = r.usage || {};
      const tok = `${u.input_tokens ?? "?"}in / ${u.output_tokens ?? "?"}out`;
      console.log();
      console.log(`  Answer (${elapsedSec}s, ${tok}):`);
      console.log();
      for (const line of r.answer.split("\n")) {
        console.log(`    ${line}`);
      }
      totalInputTokens += u.input_tokens || 0;
      totalOutputTokens += u.output_tokens || 0;
      answeredCount++;
    }
  } catch (e) {
    console.error(`  ERROR: ${e.message}`);
    errorCount++;
  }
  console.log();
}

console.log("════════════════════════════════════════════════════════════════════════════");
console.log("  Summary");
console.log("════════════════════════════════════════════════════════════════════════════");
console.log(`  answered:  ${answeredCount}`);
console.log(`  declined:  ${declinedCount}  (retrieval-floor, deterministic, no LLM cost)`);
console.log(`  errors:    ${errorCount}`);
console.log(`  total tokens: ${totalInputTokens} in / ${totalOutputTokens} out`);
