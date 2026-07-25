// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/tools/getDocument.js
// SousAI tool: fetch the full SousAI-safe text of a document by id.
//
// Reconstructs the doc by concatenating stored chunks in chunk_index order,
// filtered by the doc's language field. This is the exact projection the
// chunker produced: NonCanonical stripped at extractMdx.js:114, Facts
// resolved, Includes expanded. No new extraction path - PG is the source
// of truth for what SousAI is allowed to quote.
//
// Access enforcement is JS-side because this tool bypasses the RPC. The
// checks must be identical to what the RPC does for search: doc.access_level
// must be in caller's accessLevels, doc.archived must be false, doc.status
// must be Live (agent Live-only default, Decision 4).
//
// Gate order matters and is deliberate:
//   1. not_found (row absent - can safely report before access check because
//      absence is not information; the fact of a doc id existing IS)
//   2. access - checked BEFORE archived/not_live so we do not leak the
//      status of a doc the caller may not see
//   3. archived
//   4. not_live
//
// POST-class docs return their single stub chunk - the docClass in the
// return tells the agent that.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabase } from "./_client.js";

export const TOKEN_CAP = 12000;

/**
 * @param {string} docId
 * @param {object} opts
 * @param {string[]} opts.accessLevels - pre-resolved tier array
 * @returns {Promise<
 *   | { available: false, reason: 'not_found' | 'access' | 'archived' | 'not_live' }
 *   | { available: true, docId, title, docClass, sections: string[], text: string, tokenTotal: number, truncated?: boolean, omittedSections?: string[] }
 * >}
 */
export async function getDocument(docId, { accessLevels } = {}) {
  if (!Array.isArray(accessLevels)) throw new Error("getDocument: accessLevels must be an array");
  if (!docId || typeof docId !== "string") return { available: false, reason: "not_found" };

  const sb = getSupabase();

  const { data: doc, error: docErr } = await sb
    .from("documents")
    .select("id, title, doc_class, status, access_level, archived")
    .eq("id", docId)
    .maybeSingle();
  if (docErr) throw new Error(`getDocument: documents fetch failed: ${docErr.code || "?"} ${docErr.message}`);

  if (!doc) return { available: false, reason: "not_found" };

  const docAccessLevel = doc.access_level || "unrestricted";
  if (!accessLevels.includes(docAccessLevel)) {
    return { available: false, reason: "access" };
  }
  if (doc.archived) return { available: false, reason: "archived" };
  if (doc.status !== "Live") return { available: false, reason: "not_live" };

  // documents has no lang column; the SousAI corpus is English by default.
  // document_chunks.language segregates translations (e.g. es for the
  // source_drive_id_es variant). Phase A serves English; a caller-supplied
  // language option can widen this later.
  const language = "en";

  const { data: chunks, error: chunksErr } = await sb
    .from("document_chunks")
    .select("chunk_index, section, content, token_count")
    .eq("doc_id", docId)
    .eq("language", language)
    .order("chunk_index", { ascending: true });
  if (chunksErr) throw new Error(`getDocument: chunks fetch failed: ${chunksErr.code || "?"} ${chunksErr.message}`);

  // Build sections list (unique, in first-seen order) and accumulate text
  // + token count. Truncate on a section boundary if we exceed TOKEN_CAP -
  // chunk boundaries are section boundaries by construction of the
  // structure-aware chunker (chunk.js) so stopping BEFORE a chunk = stopping
  // on a section boundary.
  const sectionsSeen = [];
  const sectionsInOrder = [];
  const includedChunks = [];
  const omittedSections = [];
  let tokenTotal = 0;
  let truncated = false;

  for (const c of chunks || []) {
    const sect = c.section ?? "";
    const wouldExceed = tokenTotal + (c.token_count ?? 0) > TOKEN_CAP;
    if (wouldExceed && includedChunks.length > 0) {
      // Stop before this chunk. Track this section (if new) as omitted.
      truncated = true;
      if (sect && !sectionsSeen.includes(sect) && !omittedSections.includes(sect)) {
        omittedSections.push(sect);
      }
      continue; // keep looping to catalog other omitted section names
    }
    // Included chunk.
    if (sect && !sectionsSeen.includes(sect)) {
      sectionsSeen.push(sect);
      sectionsInOrder.push(sect);
    }
    includedChunks.push(c);
    tokenTotal += c.token_count ?? 0;
  }

  const text = includedChunks.map((c) => c.content ?? "").join("\n\n");

  const result = {
    available: true,
    docId: doc.id,
    title: doc.title,
    docClass: doc.doc_class,
    sections: sectionsInOrder,
    text,
    tokenTotal,
  };
  if (truncated) {
    result.truncated = true;
    result.omittedSections = omittedSections;
  }
  return result;
}
