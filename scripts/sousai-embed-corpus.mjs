// ─────────────────────────────────────────────────────────────────────────────
// scripts/sousai-embed-corpus.mjs
// SousAI · corpus embed CLI · idempotent backfill + targeted re-embed
// ─────────────────────────────────────────────────────────────────────────────
//
// Run modes:
//
//   No args (bulk missing-only mode):
//     node --env-file=.env.local scripts/sousai-embed-corpus.mjs
//     - Loads all Live docs from the catalog
//     - Skips any doc that already has rows in document_chunks
//     - Dispatches each remaining doc to the right embed path
//
//   With doc IDs (targeted re-embed mode):
//     node --env-file=.env.local scripts/sousai-embed-corpus.mjs PB-002 AGR-001
//     - Re-embeds only the named docs, regardless of existing chunks
//     - Each dispatches through the same delete-then-insert path so the
//       end state is identical to a first-time run
//
// Per-doc dispatch (A5: MDX-sourced ingestion):
//   doc_class POST   -> embedPosterStub  (visual reference, no extraction)
//   else             -> embedDocument    (reads content/documents/{docId}.mdx,
//                                         resolves Facts + Includes, walks the
//                                         resolved markdown to produce
//                                         heading-bounded sections, chunks,
//                                         embeds, stores)
//
// Per-doc skip reasons (default mode):
//   - status != 'Live' (bulk mode only filters Live)
//   - already has chunks in document_chunks (bulk mode only)
//   - POST with no card_line/summary AND no title (nothing to stub from)
//   - content/documents/{docId}.mdx does not exist (e.g. LEGACY-* rows that
//     are catalog-only and have no MDX source)
//
// Resumability (A5 / important for the ~1000-chunk run):
//   Each doc's embed is per-doc transactional - the delete-then-insert
//   step inside replaceChunksForDoc happens AFTER successful extraction +
//   chunking + embedding. If a doc fails mid-pipeline (OpenAI 429, network
//   blip, etc.), its existing chunks are untouched (or partially gone if
//   the failure was between delete and insert - in which case re-run
//   recovers since the diff sees zero chunks for that doc).
//
//   Mid-run failure model: docs 1..N-1 are complete and intact. Doc N is
//   either untouched (failure before replaceChunksForDoc) or has new
//   chunks (success) or is empty (failure between delete and insert).
//   Re-running in BULK MISSING-ONLY mode resumes from where it died:
//   completed docs are skipped, doc N (if empty) is re-attempted, docs
//   N+1..K proceed. Re-running in TARGETED mode re-processes the named
//   docs regardless.
//
//   The script logs each doc's outcome individually so a tail of the log
//   shows progress; if it dies, the last line indicates which doc failed.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  embedDocument,
  embedPosterStub,
  SKIP_TEXT_EXTRACTION_CLASSES,
} from "../src/lib/sousai/index.js";
import { buildDocsMap } from "../src/lib/sousai/extractMdx.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const DOCS_DIR = join(REPO_ROOT, "content", "documents");

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const args = process.argv.slice(2);
const targetedMode = args.length > 0;

// ── Resolve the candidate set ────────────────────────────────────────────
let candidates;
if (targetedMode) {
  const { data, error } = await sb
    .from("documents")
    .select("id, title, status, doc_class, card_line, summary, archived")
    .in("id", args)
    .order("id");
  if (error) {
    console.error(`documents lookup failed: ${error.message}`);
    process.exit(1);
  }
  candidates = data || [];
  // Warn on docs requested but not found
  for (const id of args) {
    if (!candidates.find((c) => c.id === id)) {
      console.error(`SKIP ${id} - not found in documents catalog`);
    }
  }
  console.log(`Mode: targeted re-embed (A5: MDX-sourced ingestion)`);
  console.log(`Requested: ${args.length}, matched in catalog: ${candidates.length}`);
} else {
  // Bulk missing-only: Live docs - docs already in document_chunks
  const { data: liveDocs, error: liveErr } = await sb
    .from("documents")
    .select("id, title, status, doc_class, card_line, summary, archived")
    .eq("status", "Live")
    .eq("archived", false)
    .order("id");
  if (liveErr) {
    console.error(`Live docs lookup failed: ${liveErr.message}`);
    process.exit(1);
  }

  const { data: existingChunks, error: chunksErr } = await sb
    .from("document_chunks")
    .select("doc_id")
    .order("doc_id");
  if (chunksErr) {
    console.error(`existing chunks lookup failed: ${chunksErr.message}`);
    process.exit(1);
  }
  const docsWithChunks = new Set((existingChunks || []).map((c) => c.doc_id));

  candidates = (liveDocs || []).filter((d) => !docsWithChunks.has(d.id));

  console.log(`Mode: bulk missing-only (A5: MDX-sourced ingestion)`);
  console.log(`Live + active docs:             ${liveDocs?.length || 0}`);
  console.log(`Already in document_chunks:     ${docsWithChunks.size}`);
  console.log(`Candidates to embed this run:   ${candidates.length}`);
}
console.log();

if (candidates.length === 0) {
  console.log("Nothing to embed.");
  process.exit(0);
}

// ── Build the docsMap ONCE for Include resolution ────────────────────────
// extractMdx accepts a docsMap to avoid re-walking content/documents/ on
// every doc. Build it once here and pass through.
console.log("Building docsMap from content/documents/ ...");
const t0Map = Date.now();
const docsMap = buildDocsMap();
console.log(`  ${Object.keys(docsMap).length} docs loaded into map in ${((Date.now()-t0Map)/1000).toFixed(1)}s`);
console.log();

// ── Per-doc dispatch ─────────────────────────────────────────────────────
let extractions = 0;
let stubs = 0;
let skipped = 0;
let errors = 0;

for (const doc of candidates) {
  const { id: docId, title, doc_class, card_line, summary, archived } = doc;

  console.log(`──────────────────────────────────────────────────────────────────`);
  console.log(`  ${docId}  ·  ${title}  ·  doc_class=${doc_class}`);
  console.log(`──────────────────────────────────────────────────────────────────`);

  if (archived) {
    console.log(`  SKIP - doc is archived`);
    console.log();
    skipped++;
    continue;
  }

  const isPoster = SKIP_TEXT_EXTRACTION_CLASSES.includes(doc_class);
  const hasStubMaterial = !!(card_line || summary || title);
  const mdxPath = join(DOCS_DIR, `${docId}.mdx`);
  const mdxExists = existsSync(mdxPath);
  const t0 = Date.now();

  try {
    let result;
    if (isPoster) {
      if (!hasStubMaterial) {
        console.log(`  SKIP - poster has no title/card_line/summary to stub from`);
        console.log();
        skipped++;
        continue;
      }
      console.log(`  → poster stub path`);
      result = await embedPosterStub({ docId });
      stubs++;
    } else {
      if (!mdxExists) {
        console.log(`  SKIP - no MDX file at content/documents/${docId}.mdx`);
        console.log();
        skipped++;
        continue;
      }
      console.log(`  → MDX extraction path  (content/documents/${docId}.mdx)`);
      result = await embedDocument({ docId, docsMap });
      extractions++;
    }
    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

    const pathLabel = result.isStub
      ? "stub"
      : result.chunkingPath || "(unknown)";
    console.log(
      `  done in ${elapsedSec}s  ·  path: ${pathLabel}  ·  deleted ${result.chunksReplaced.deleted}, inserted ${result.chunksReplaced.inserted}`
    );

    // Read-back sanity per doc: count + dim range + token-count stats + sample
    const { data: chunks, error: chunksErr } = await sb
      .from("document_chunks")
      .select("chunk_index, section, content, token_count, embedding")
      .eq("doc_id", docId)
      .order("chunk_index", { ascending: true });
    if (chunksErr) {
      console.error(`  read-back failed: ${chunksErr.message}`);
      console.log();
      errors++;
      continue;
    }

    let nonNull = 0;
    let dimMin = Infinity;
    let dimMax = 0;
    for (const c of chunks) {
      if (c.embedding == null) continue;
      nonNull++;
      const parsed = typeof c.embedding === "string" ? JSON.parse(c.embedding) : c.embedding;
      const dim = Array.isArray(parsed) ? parsed.length : 0;
      if (dim < dimMin) dimMin = dim;
      if (dim > dimMax) dimMax = dim;
    }
    const tc = chunks.map((c) => c.token_count).filter((t) => t != null);
    const minT = tc.length ? Math.min(...tc) : 0;
    const maxT = tc.length ? Math.max(...tc) : 0;
    const avgT = tc.length ? Math.round(tc.reduce((a, b) => a + b, 0) / tc.length) : 0;

    console.log(
      `  rows: ${chunks.length}  ·  non-null 1536-dim: ${nonNull}/${chunks.length}  ·  dim: ${dimMin === Infinity ? "n/a" : dimMin}..${dimMax}  ·  tokens min/max/avg: ${minT}/${maxT}/${avgT}`
    );

    // Mid-doc sample - or only-chunk for stubs
    const sampleIdx = chunks.length > 1 ? Math.max(1, Math.floor(chunks.length / 2)) : 0;
    const sample = chunks[sampleIdx];
    if (sample) {
      console.log(`  sample chunk ${sample.chunk_index} (${chunks.length === 1 ? "only chunk" : "mid-doc"}):`);
      console.log(`    section: ${sample.section ?? "(null)"}`);
      const sampleLines = sample.content.split("\n");
      for (const line of sampleLines.slice(0, 6)) {
        console.log(`    ${line}`);
      }
      if (sampleLines.length > 6) {
        console.log(`    ... (${sampleLines.length - 6} more lines truncated for display)`);
      }
    }
    console.log();
  } catch (e) {
    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`  ERROR after ${elapsedSec}s: ${e.message}`);
    if (/permission|forbidden|access|caller does not have|not found|404|403/i.test(e.message)) {
      console.error(`    likely MDX path or catalog issue. Confirm content/documents/${docId}.mdx exists.`);
    }
    console.log();
    errors++;
  }
}

// ── Aggregate ────────────────────────────────────────────────────────────
console.log(`══════════════════════════════════════════════════════════════════`);
console.log(`  Summary`);
console.log(`══════════════════════════════════════════════════════════════════`);
console.log(`  MDX text extractions:   ${extractions}`);
console.log(`  poster stubs:           ${stubs}`);
console.log(`  skipped:                ${skipped}`);
console.log(`  errors:                 ${errors}`);

process.exit(errors > 0 ? 1 : 0);
