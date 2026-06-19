// ─────────────────────────────────────────────────────────────────────────────
// scripts/sousai-embed-doc.mjs
// SousAI · Layer 3 CLI · embed one doc end-to-end + Checkpoint 3 verification
//
// Run:
//   node --env-file=.env.local scripts/sousai-embed-doc.mjs            (defaults to PB-002)
//   node --env-file=.env.local scripts/sousai-embed-doc.mjs PB-002     (explicit id)
//   SOUSAI_DOC_ID=AGR-001 node --env-file=.env.local scripts/sousai-embed-doc.mjs
//
// Doc id resolution order: argv[2] > env SOUSAI_DOC_ID > "PB-002" default.
// The default preserves the original demo behavior. The argv form is what
// the B2 GitHub Action uses to embed each changed content file.
//
// Output:
//   1. Runs the embedDocument(...) orchestrator (extract -> chunk -> embed
//      -> store) end-to-end for the chosen doc.
//   2. Reports the orchestrator's summary (chunks deleted + inserted).
//   3. Verifies post-state by querying document_chunks back:
//        - row count for the doc
//        - every row has a non-null 1536-dim embedding
//        - token-count distribution
//        - sample row dump (metadata + content, NO raw vector)
//
// The sample row dumped is chunk_index 28 (Section 06 > Step 4 in PB-002)
// because that's the load-bearing case from L2 - confirms the ancestry chain
// made it through to storage. For other docs it may or may not exist; the
// PASS/FAIL gate is doc-independent (all chunks have valid 1536-dim vectors).
//
// Auth/billing failures surface immediately - OPENAI_API_KEY missing or
// invalid is the most likely first-run issue; the script catches and
// re-formats those errors before exiting.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import { embedDocument } from "../src/lib/sousai/index.js";

const DOC_ID = process.argv[2] || process.env.SOUSAI_DOC_ID || "PB-002";
const SAMPLE_CHUNK_INDEX = 28; // Section 06 > 6.1 Six Steps > Step 4 (PB-002 reference)

function looksLikeOpenAiAuthError(err) {
  const msg = String(err?.message || "");
  return /OPENAI_API_KEY|OpenAI 401|OpenAI 429|invalid|quota|billing/i.test(msg);
}

try {
  console.log(`Embedding ${DOC_ID} ...`);
  console.log();

  const t0 = Date.now();
  const result = await embedDocument({
    docId: DOC_ID,
  });
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`embedDocument completed in ${elapsedSec}s`);
  console.log(`  doc:             ${result.docId} (${result.docTitle})`);
  console.log(`  language:        ${result.language}`);
  console.log(`  chunking path:   ${result.chunkingPath}`);
  console.log(`  chunks deleted:  ${result.chunksReplaced.deleted}`);
  console.log(`  chunks inserted: ${result.chunksReplaced.inserted}`);

  // ── Checkpoint 3 verification (read-back from document_chunks) ───────────
  console.log();
  console.log("── Checkpoint 3 verification ──");

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { count, error: countErr } = await sb
    .from("document_chunks")
    .select("*", { count: "exact", head: true })
    .eq("doc_id", DOC_ID);
  if (countErr) {
    throw new Error(`count query failed: ${countErr.message}`);
  }
  console.log(`  rows in document_chunks for ${DOC_ID}: ${count}`);

  const { data: rows, error: rowsErr } = await sb
    .from("document_chunks")
    .select("chunk_index, section, content, token_count, embedding, is_historical, data_provenance, language")
    .eq("doc_id", DOC_ID)
    .order("chunk_index", { ascending: true });
  if (rowsErr) {
    throw new Error(`rows fetch failed: ${rowsErr.message}`);
  }

  // Per-row dim check. PostgREST returns vector(N) as a string like "[a,b,...]";
  // parse defensively without assuming shape.
  let nonNullVecs = 0;
  let dimMin = Infinity;
  let dimMax = 0;
  for (const r of rows) {
    if (r.embedding == null) continue;
    nonNullVecs++;
    const parsed = typeof r.embedding === "string" ? JSON.parse(r.embedding) : r.embedding;
    const dim = Array.isArray(parsed) ? parsed.length : 0;
    if (dim < dimMin) dimMin = dim;
    if (dim > dimMax) dimMax = dim;
  }
  console.log(`  rows with non-null embedding: ${nonNullVecs} / ${rows.length}`);
  console.log(`  embedding dim observed (min..max): ${dimMin === Infinity ? "n/a" : dimMin}..${dimMax}`);

  const tokenCounts = rows.map((r) => r.token_count).filter((t) => t != null);
  if (tokenCounts.length > 0) {
    const minT = Math.min(...tokenCounts);
    const maxT = Math.max(...tokenCounts);
    const avgT = Math.round(tokenCounts.reduce((a, b) => a + b, 0) / tokenCounts.length);
    console.log(`  token counts: min ${minT}, max ${maxT}, avg ${avgT}`);
  }

  // Sample row dump - chunk 28 (Section 06 > Step 4). Metadata + content
  // only; the raw vector is intentionally suppressed.
  console.log();
  console.log(`── Sample row: chunk_index ${SAMPLE_CHUNK_INDEX} (Section 06 > Step 4 - ancestry test) ──`);
  const sample = rows.find((r) => r.chunk_index === SAMPLE_CHUNK_INDEX);
  if (!sample) {
    console.log(`  (no row found at chunk_index ${SAMPLE_CHUNK_INDEX})`);
  } else {
    const parsedEmb = typeof sample.embedding === "string" ? JSON.parse(sample.embedding) : sample.embedding;
    const embDim = Array.isArray(parsedEmb) ? parsedEmb.length : "?";
    console.log(`  chunk_index:      ${sample.chunk_index}`);
    console.log(`  language:         ${sample.language}`);
    console.log(`  section:          ${sample.section ?? "(null)"}`);
    console.log(`  token_count:      ${sample.token_count}`);
    console.log(`  is_historical:    ${sample.is_historical}`);
    console.log(`  data_provenance:  ${sample.data_provenance}`);
    console.log(`  embedding:        vector(${embDim}) [values intentionally hidden]`);
    console.log();
    console.log("  content:");
    for (const line of sample.content.split("\n")) {
      console.log(`    ${line}`);
    }
  }

  console.log();
  const allHaveVecs = nonNullVecs === rows.length;
  const allCorrectDim = dimMin === 1536 && dimMax === 1536;
  if (allHaveVecs && allCorrectDim) {
    console.log("PASS - Checkpoint 3 complete.");
  } else {
    console.log("FAIL - one or more checks did not pass:");
    if (!allHaveVecs) console.log(`  - ${rows.length - nonNullVecs} row(s) missing embedding`);
    if (!allCorrectDim) console.log(`  - dim mismatch: expected 1536, got ${dimMin}..${dimMax}`);
    process.exit(1);
  }
} catch (e) {
  console.error(`ERROR: ${e.message}`);
  if (looksLikeOpenAiAuthError(e)) {
    console.error();
    console.error("OpenAI auth/billing issue. Most common causes:");
    console.error("  - OPENAI_API_KEY missing from .env.local");
    console.error("  - key revoked or wrong format");
    console.error("  - OpenAI project has no active billing");
    console.error();
    console.error("Test the key independently (do NOT paste the value here):");
    console.error('  curl -sS https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY" | head -c 200');
  }
  process.exit(1);
}
