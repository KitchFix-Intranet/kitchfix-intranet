// ─────────────────────────────────────────────────────────────────────────────
// scripts/sousai-retrieval-test.mjs
// SousAI · preliminary retrieval test harness (UNCOMMITTED)
// ─────────────────────────────────────────────────────────────────────────────
//
// NO Claude. NO generation. Just: question -> OpenAI embedding -> pgvector
// cosine similarity -> top N chunks. Lets us see what retrieval actually
// pulls for a given question, before any LLM is in the loop.
//
// Requires the match_document_chunks() RPC to exist in the DB (see
// docs/migrations/pr-8-2-sousai-match-fn.sql).
//
// The embedding model used for the question MUST match the model used
// when the chunks were embedded (text-embedding-3-small) - otherwise the
// vectors live in different latent spaces and similarity is meaningless.
// embedTexts() is the same helper the chunk-embed pipeline uses, so they
// stay aligned by construction.
//
// Run:
//   node --env-file=.env.local scripts/sousai-retrieval-test.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import { embedTexts } from "../src/lib/sousai/embed.js";

const TOP_N = 5;
const PREVIEW_CHARS = 150;

// pr-7-12 dropped the 2-arg match_document_chunks() overload; the function
// now ALWAYS takes allowed_levels TEXT[] (NULL = no filter). The harness
// reads ALLOWED_LEVELS from the env so each retrieval test can scope to a
// tier without code edits:
//   ALLOWED_LEVELS=unrestricted node ... (default operator viewer)
//   ALLOWED_LEVELS=unrestricted,restricted,slt node ... (SLT viewer)
//   ALLOWED_LEVELS= node ... (NULL / unfiltered, service-role only)
// The default is 'unrestricted' so the harness matches the normal operator
// scope and doesn't accidentally surface tier-restricted content to a test
// run that didn't ask for it.
const ALLOWED_LEVELS = (process.env.ALLOWED_LEVELS ?? "unrestricted")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOWED_LEVELS_ARG = ALLOWED_LEVELS.length > 0 ? ALLOWED_LEVELS : null;

// Regression suite for retrieval at 8+ docs / 190+ chunks. Replaces the
// preliminary 9-question set that validated retrieval at 4 docs - that
// set proved retrieval works on the first corpus but didn't exercise
// doc-level discrimination, form retrieval, or the no-answer gap at
// scale. The 10 questions below were run on the 2026-06-04 scaled-
// corpus retest and all passed; rerun this harness whenever the corpus
// grows materially to confirm the same behaviors hold.
const QUESTIONS = [
  // ── DISCRIMINATION UNDER OVERLAP (the new hard tests at 8+ docs) ─────────
  {
    label: "1. OVERLAP - allergic reaction (PB-002 + SOP-002 should both appear)",
    q: "what do I do if someone has an allergic reaction",
    expect: "PB-002 Section 6 steps AND SOP-002 §7.3 in top 5 (cross-doc reference)",
  },
  {
    label: "2. OVERLAP - safety incident procedure (favor SOP-002)",
    q: "what's the procedure for a safety incident",
    expect: "SOP-002 incident management, NOT PB-002 allergen-specific",
  },
  {
    label: "3. FORM retrieval - medical refusal form",
    q: "what form do I use when someone refuses medical treatment",
    expect: "FORM-001 single fallback chunk surfaces",
  },
  {
    label: "4. ALLERGEN LIST (favor PB-002, resist pull to SOP-002 / POST-002)",
    q: "what are the 9 allergens",
    expect: "PB-002 Top 9 allergens - not crowded out by docs that just mention allergens",
  },
  // ── STANDING TESTS (from preliminary, confirm still hold as corpus grows) ─
  {
    label: "5. STANDING - typo / garbled",
    q: "r tomatoes a alergure",
    expect: "PB-002 allergen content (still pulls despite typos)",
  },
  {
    label: "6. STANDING - confidentiality / media",
    q: "can I talk about players to the media",
    expect: "AGR-001 confidentiality discriminates from safety/operations docs",
  },
  {
    label: "7. STANDING - Spanish cross-lingual",
    q: "¿los tomates son alérgenos?",
    expect: "PB-002 allergen content via cross-lingual embedding (documented degraded)",
  },
  // ── CRITICAL NEGATIVE (did corpus growth erode the no-answer gap?) ───────
  {
    label: "8. NEGATIVE - no answer in corpus (does the gap survive corpus growth?)",
    q: "what is the labor budget formula",
    expect: "LOW scores - at 2x growth the gap held at ~10pts (0.22 vs 0.32); rerun confirms",
  },
  // ── POSTER STUBS (don't pollute / surface appropriately) ─────────────────
  {
    label: "9. STUB-DOESN'T-POLLUTE - 'big rules' real-content query",
    q: "what are the big rules",
    expect: "AGR-001 content chunks ranked ABOVE POSTER-001 stub",
  },
  {
    label: "10. STUB SURFACES - 'allergen poster' query",
    q: "allergen poster",
    expect: "POST-002 stub surfaces appropriately",
  },
];

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// Batch-embed all questions in a single OpenAI call (the embedding API
// supports up to 2048 inputs per request; 10 is trivial).
const questionTexts = QUESTIONS.map((Q) => Q.q);
let questionEmbeddings;
try {
  questionEmbeddings = await embedTexts(questionTexts);
} catch (e) {
  console.error(`FATAL: question embedding failed: ${e.message}`);
  process.exit(1);
}

if (questionEmbeddings.length !== QUESTIONS.length) {
  console.error(
    `FATAL: got ${questionEmbeddings.length} embeddings for ${QUESTIONS.length} questions`
  );
  process.exit(1);
}

let rpcMissing = false;

for (let i = 0; i < QUESTIONS.length; i++) {
  const { label, q, expect } = QUESTIONS[i];
  const queryEmbedding = questionEmbeddings[i];

  console.log("════════════════════════════════════════════════════════════════════════════");
  console.log(`  ${label}`);
  console.log(`  Q: "${q}"`);
  console.log(`  expected: ${expect}`);
  console.log("════════════════════════════════════════════════════════════════════════════");

  const { data, error } = await sb.rpc("match_document_chunks", {
    query_embedding: queryEmbedding,
    match_count: TOP_N,
    allowed_levels: ALLOWED_LEVELS_ARG,
  });

  if (error) {
    if (/function .*match_document_chunks.* does not exist/i.test(error.message || "")) {
      console.error(`  ERROR: match_document_chunks RPC missing.`);
      console.error(`  Paste docs/migrations/pr-8-2-sousai-match-fn.sql in Supabase Studio first.`);
      rpcMissing = true;
      break;
    }
    console.error(`  ERROR: ${error.code || "?"}: ${error.message}`);
    console.log();
    continue;
  }

  if (!data || data.length === 0) {
    console.log("  (no results)");
    console.log();
    continue;
  }

  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    const score = typeof row.similarity === "number" ? row.similarity.toFixed(4) : "?";
    const section = row.section ?? "(no section / unsectioned)";
    // Strip the contextual "From: ..." header from the preview so the body
    // is what we actually see. The doc_id + section above already tell us
    // where the chunk lives; no need to repeat that in the preview.
    const headerEnd = (row.content || "").indexOf("\n\n");
    const body = headerEnd >= 0 ? row.content.slice(headerEnd + 2) : row.content || "";
    const flat = body.replace(/\s+/g, " ").trim();
    const preview = flat.slice(0, PREVIEW_CHARS) + (flat.length > PREVIEW_CHARS ? "..." : "");

    console.log(`  #${r + 1}  sim=${score}  ${row.doc_id}  chunk_index=${row.chunk_index}  lang=${row.language}`);
    console.log(`        section: ${section}`);
    console.log(`        body:    ${preview}`);
    console.log();
  }
}

if (rpcMissing) {
  console.log();
  console.log("Halted because the match_document_chunks RPC isn't in the DB.");
  console.log("Paste pr-8-2-sousai-match-fn.sql in Studio, then re-run this script.");
  process.exit(1);
}
