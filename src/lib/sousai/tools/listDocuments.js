// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/tools/listDocuments.js
// SousAI tool: catalog listing for enumeration questions.
//
// Makes questions like "which accounts are flat-fee" answerable via a
// list-then-read pattern (list docs -> agent picks -> getDocument each).
//
// Access + status + archived filtering happens in the SQL query, not in JS -
// same rule as searchDocuments and getDocument. status default is Live per
// Decision 4 (agent default). The status param exists so a non-agent caller
// can widen the filter later, but the agent default stands.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabase } from "./_client.js";

/**
 * @param {object} opts
 * @param {string} [opts.docClass] - filter to a single doc_class (e.g. "REC")
 * @param {string} [opts.status="Live"] - defaults to Live (agent default; Decision 4)
 * @param {string[]} opts.accessLevels - pre-resolved tier array
 * @returns {Promise<Array<{id, title, doc_class, status, access_level}>>}
 */
export async function listDocuments({ docClass, status = "Live", accessLevels } = {}) {
  if (!Array.isArray(accessLevels)) throw new Error("listDocuments: accessLevels must be an array");

  const sb = getSupabase();

  let q = sb
    .from("documents")
    .select("id, title, doc_class, status, access_level")
    .eq("archived", false)
    .eq("status", status)
    .in("access_level", accessLevels);
  if (docClass) q = q.eq("doc_class", docClass);
  q = q.order("id", { ascending: true });

  const { data, error } = await q;
  if (error) throw new Error(`listDocuments: query failed: ${error.code || "?"} ${error.message}`);
  return data || [];
}
