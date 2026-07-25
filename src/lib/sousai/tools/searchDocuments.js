// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/tools/searchDocuments.js
// SousAI tool: doc-level search over document_chunks.
//
// The retrieval unit the agent sees is the document (SOUSAI_AGENT_PLAN §6
// item 1). Chunks locate; the tool returns docs ranked by best chunk hit,
// with the top matching snippets attached so the agent can decide whether
// to open the whole doc via getDocument.
//
// Access enforcement lives inside the match_document_chunks RPC (pr-7-11
// allowed_levels + pr-7-17 status <> 'Retired' + archived=false). We pass
// the caller's accessLevels through verbatim; we do not post-filter on
// access in JS - the RPC is the security boundary for search.
//
// Status is a quality boundary per Decision 4 (Live-only for agent-facing
// calls). Since the RPC excludes Retired but not other non-Live statuses,
// this file JS-filters the document set to Live after the candidate fetch.
// Over-fetching (match_count 30) leaves headroom so the Live-only filter
// rarely starves the returned k.
// ─────────────────────────────────────────────────────────────────────────────

import { embedTexts } from "../embed.js";
import { getSupabase } from "./_client.js";

const OVERFETCH_COUNT = 30;
const SNIPPETS_PER_DOC = 3;

/**
 * @param {string} query - natural-language question
 * @param {object} opts
 * @param {string[]} opts.accessLevels - pre-resolved tier array (see opdAcl.allowedAccessLevels)
 * @param {number} [opts.k=5] - number of docs to return
 * @returns {Promise<Array<{docId, title, docClass, bestSimilarity, snippets: Array<{section, content, similarity}>}>>}
 */
export async function searchDocuments(query, { accessLevels, k = 5 } = {}) {
  if (!query || typeof query !== "string") return [];
  if (!Array.isArray(accessLevels)) throw new Error("searchDocuments: accessLevels must be an array");

  const sb = getSupabase();

  // Embed the query. embedTexts takes an array; unpack the first (only) result.
  const embeddings = await embedTexts([query]);
  const queryEmbedding = embeddings[0];

  const { data: chunks, error } = await sb.rpc("match_document_chunks", {
    query_embedding: queryEmbedding,
    match_count: OVERFETCH_COUNT,
    allowed_levels: accessLevels,
  });
  if (error) throw new Error(`searchDocuments: RPC failed: ${error.code || "?"} ${error.message}`);
  if (!chunks || chunks.length === 0) return [];

  // Group by doc_id. Preserve first-seen ordering of chunks per doc for stability.
  const byDoc = new Map();
  for (const row of chunks) {
    if (!byDoc.has(row.doc_id)) byDoc.set(row.doc_id, []);
    byDoc.get(row.doc_id).push(row);
  }

  // Fetch the Live-status filter data for the candidate docs.
  const candidateIds = [...byDoc.keys()];
  const { data: docRows, error: docErr } = await sb
    .from("documents")
    .select("id, title, doc_class, status, access_level")
    .in("id", candidateIds);
  if (docErr) throw new Error(`searchDocuments: documents fetch failed: ${docErr.code || "?"} ${docErr.message}`);
  const docMeta = new Map(docRows.map((d) => [d.id, d]));

  // Assemble doc-level results, dropping non-Live (Decision 4).
  const results = [];
  for (const [docId, docChunks] of byDoc.entries()) {
    const meta = docMeta.get(docId);
    if (!meta) continue; // shouldn't happen; the RPC's JOIN guarantees the doc exists
    if (meta.status !== "Live") continue; // Live-only for agent

    const sortedChunks = [...docChunks].sort((a, b) => b.similarity - a.similarity);
    const bestSimilarity = sortedChunks[0].similarity;
    const snippets = sortedChunks.slice(0, SNIPPETS_PER_DOC).map((c) => ({
      section: c.section ?? "",
      content: c.content ?? "",
      similarity: c.similarity,
    }));

    results.push({
      docId,
      title: meta.title,
      docClass: meta.doc_class,
      bestSimilarity,
      snippets,
    });
  }

  results.sort((a, b) => b.bestSimilarity - a.bestSimilarity);
  return results.slice(0, k);
}
