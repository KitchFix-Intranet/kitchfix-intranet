// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/chunk.js
// SousAI · Layer 2 · Chunking (structure-aware primary, size-based fallback)
// ─────────────────────────────────────────────────────────────────────────────
//
// Turns an extracted doc ({ title, sections }) into an ordered list of
// chunks ready to be embedded. Two paths:
//
//   STRUCTURE-AWARE (primary): one chunk per heading-bounded section. If a
//   section is small enough, it stays a single chunk. If it overflows the
//   target size, that section is split into multiple chunks via paragraph-
//   aware overlap windows; the section heading stays on each piece via the
//   contextual header.
//
//   SIZE-BASED FALLBACK: triggered when extraction returned NO headings at
//   all (every section.heading is null - i.e. the doc was structurally
//   flat). The whole doc body becomes one "unsectioned" section and gets
//   size-windowed with overlap. The chunker doesn't run a heuristic on
//   "looks like a heading"; if the Docs API didn't say HEADING_n, it isn't.
//
// Every chunk's `content` has a contextual header prepended so the embedded
// vector carries the doc identity and section name. That header is what
// gets embedded and stored, NOT just the raw body text. The header lets
// retrieval surface "this snippet is from {Doc Title} ({DOC-ID}), Section
// {heading}" without an extra join at query time.
//
// Token counts are a char-based estimate (4 chars per token) until tiktoken
// is wired in. Good enough for sizing the chunks; precise counts come later
// when the embedding pipeline matters about staying under the 8191-token
// input limit.
// ─────────────────────────────────────────────────────────────────────────────

const TARGET_CHARS = 3200;     // ~800 tokens at 4 chars/token
const OVERLAP_CHARS = 400;     // ~100 tokens
const CHARS_PER_TOKEN = 4;     // rough estimate; refine when tiktoken lands

/**
 * Build the list of chunks from an extracted doc.
 *
 * @param {{ driveTitle: string, sections: Array<{ heading: string|null, level: number|null, ancestry: string[], text: string }> }} extracted
 * @param {{ docId: string, docTitle: string, language?: string }} opts
 *   `docTitle` is REQUIRED and should be the canonical title from the
 *   `documents` catalog row (e.g. "Allergen Playbook"), NOT the Drive
 *   filename. The chunker does not fall back to extracted.driveTitle - the
 *   caller is responsible for resolving the operator-facing citation text.
 * @returns {{
 *   path: 'structure-aware' | 'size-based-fallback',
 *   chunks: Array<{ chunk_index: number, section: string|null, content: string, token_count: number, language: string }>,
 * }}
 *
 * The `section` field on each chunk is the FULL ancestry path joined with
 * " > " (e.g. "If Someone Has a Reaction > 6.1 The Six Steps > Step 4 ..."),
 * not just the immediate heading. This keeps safety-critical orphan H3s
 * anchored to their parent context for retrieval.
 */
export function chunkSections(extracted, { docId, docTitle, language = "en" }) {
  if (!docTitle) {
    throw new Error(
      "chunkSections: docTitle is required (use documents.title from the catalog, not extracted.driveTitle)"
    );
  }
  const sections = (extracted.sections || []).filter((s) => s.text && s.text.trim());

  // Path decision: did extraction return ANY heading-bound sections?
  const anyHeading = sections.some((s) => s.heading);
  const path = anyHeading ? "structure-aware" : "size-based-fallback";

  const chunks = [];
  let idx = 0;

  for (const section of sections) {
    const sectionPath = buildSectionPath(section);
    const headerLine = sectionPath
      ? `From: ${docTitle} (${docId}), Section: ${sectionPath}`
      : `From: ${docTitle} (${docId})`;
    const body = section.text.trim();
    if (!body) continue;

    const reserved = headerLine.length + 2; // header + "\n\n" separator
    const bodyTarget = Math.max(800, TARGET_CHARS - reserved);

    const full = `${headerLine}\n\n${body}`;

    if (full.length <= TARGET_CHARS * 1.15) {
      chunks.push(makeChunk(idx++, sectionPath, full, language));
    } else {
      const pieces = splitWithOverlap(body, bodyTarget, OVERLAP_CHARS);
      for (const piece of pieces) {
        const content = `${headerLine}\n\n${piece}`;
        chunks.push(makeChunk(idx++, sectionPath, content, language));
      }
    }
  }

  return { path, chunks };
}

// Joined ancestry + own heading. Returns null for unsectioned preamble so
// the chunk falls back to a header without a "Section:" suffix.
function buildSectionPath(section) {
  if (!section.heading) return null;
  const chain = [...(section.ancestry || []), section.heading];
  return chain.join(" > ");
}

function makeChunk(chunk_index, section, content, language) {
  return {
    chunk_index,
    section,
    content,
    token_count: Math.ceil(content.length / CHARS_PER_TOKEN),
    language,
  };
}

/**
 * Split `text` into pieces of approximately `target` chars each, with
 * `overlap` chars carried from the tail of the previous piece into the
 * head of the next. Splits prefer paragraph boundaries (\n\n+); within
 * a single oversized paragraph it falls through to sentence boundaries;
 * within a single oversized sentence it does a hard char cut as a last
 * resort.
 */
function splitWithOverlap(text, target, overlap) {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const pieces = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim()) pieces.push(current.trim());
  };

  const startNextWithOverlap = () => {
    if (overlap > 0 && current.length > 0) {
      const tail = current.slice(-overlap);
      // Snap to nearest paragraph or sentence boundary if possible so the
      // overlap doesn't start mid-word.
      const snapAt = Math.max(tail.indexOf("\n"), tail.indexOf(". "), tail.indexOf("? "), tail.indexOf("! "));
      current = snapAt >= 0 ? tail.slice(snapAt + 1).trim() : tail;
    } else {
      current = "";
    }
  };

  for (const paragraph of paragraphs) {
    // Case A: this paragraph alone exceeds target. Sentence-split it.
    if (paragraph.length > target) {
      // Flush whatever's accumulated, start over with the oversized paragraph.
      if (current.trim()) {
        pushCurrent();
        startNextWithOverlap();
      }
      const sentences = paragraph.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [paragraph];
      for (const sentence of sentences) {
        const candidate = current ? `${current} ${sentence.trim()}` : sentence.trim();
        if (candidate.length > target && current) {
          pushCurrent();
          startNextWithOverlap();
          current = current ? `${current} ${sentence.trim()}` : sentence.trim();
        } else {
          current = candidate;
        }
      }
      continue;
    }

    // Case B: normal paragraph - greedy append until we'd exceed target.
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > target && current) {
      pushCurrent();
      startNextWithOverlap();
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    } else {
      current = candidate;
    }
  }

  pushCurrent();
  return pieces;
}
