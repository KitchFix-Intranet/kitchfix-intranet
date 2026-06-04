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

const QUESTIONS = [
  // ── DIRECT HITS ──────────────────────────────────────────────────────────
  {
    label: "1. DIRECT - 9 allergens",
    q: "what are the 9 allergens",
    expect: "PB-002 allergen content",
  },
  {
    label: "2. DIRECT - confidentiality / media",
    q: "can I talk about players or injuries to the media",
    expect: "AGR-001 confidentiality",
  },
  {
    label: "3. DIRECT - brand tokens / typography",
    q: "what font do documents use",
    expect: "STD-001 brand / typography",
  },
  // ── HARD TESTS ───────────────────────────────────────────────────────────
  {
    label: "4. HARD - typo / garbled spelling",
    q: "r tomatoes a alergure",
    expect: "PB-002 allergen content (despite typos) - THE HEADLINE TEST",
  },
  {
    label: "5. HARD - emergency response (Section 6 ancestry test)",
    q: "what do I do if someone has an allergic reaction",
    expect: "PB-002 Section 6 emergency-response step chunks",
  },
  {
    label: "6. HARD - Spanish question, English corpus (Fork 4)",
    q: "¿los tomates son alérgenos?",
    expect: "PB-002 allergen content via cross-lingual embedding",
  },
  // ── CRITICAL NEGATIVES ───────────────────────────────────────────────────
  {
    label: "7. NEGATIVE - no answer in corpus",
    q: "what is the labor budget formula",
    expect: "LOW similarity scores (proving retrieval can signal 'nothing relevant')",
  },
  {
    label: "8. POSTER STUB - poster query",
    q: "where's the big rules wall poster",
    expect: "POSTER-001 stub chunk pointing to AGR-001",
  },
  {
    label: "9. STUB-DOESN'T-POLLUTE - real-rules query",
    q: "what are the big rules",
    expect: "AGR-001 content chunks ranked ABOVE POSTER-001 stub",
  },
];

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// Batch-embed all questions in a single OpenAI call (the embedding API
// supports up to 2048 inputs per request; 9 is trivial).
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
