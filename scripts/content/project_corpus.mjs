// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/project_corpus.mjs
// Source MDX -> resolved -> flattened text -> existing structure-aware chunker.
// Per brief §5 + §3.7.
//
// F1: produces the flattened text + a STUB integration with the existing
// chunker (src/lib/sousai/chunk.js). Demonstrates the contract; no actual
// embed call. At F8 this script wires to embed.js + the document_chunks
// upsert; F1 only proves the shape.
//
// Audience scoping (brief §6): docs with audience='corporate' / 'internal'
// are excluded when projecting for an 'operator' query. F1: we filter at
// projection time by the doc's own audience field.
// ─────────────────────────────────────────────────────────────────────────────

import { resolveFactTokens, resolveIncludeTokens, flattenForCorpus } from "./resolver.mjs";

/**
 * @param {{ frontmatter: object, body: string }} doc
 * @param {{ facts: object, docsMap: object, ctx: object }} env
 * @returns {{ included: boolean, reason?: string, flattenedText?: string, resolutions?: Array, includes?: Array }}
 */
export function projectCorpusForDoc(doc, env) {
  const { facts, docsMap, ctx } = env;
  const fm = doc.frontmatter;
  if (fm.in_corpus === false) {
    return { included: false, reason: `in_corpus=false (lang=${fm.lang || "en"})` };
  }
  if (fm.status === "Retired") {
    return { included: false, reason: "status=Retired" };
  }
  // Audience-scope - F1 simple rule: if the doc's audience is corporate or
  // internal and the caller has not asked for that audience, exclude.
  if (fm.audience && fm.audience !== "operator" && ctx?.targetAudience && ctx.targetAudience !== fm.audience) {
    return { included: false, reason: `audience=${fm.audience} not in scope for targetAudience=${ctx.targetAudience}` };
  }
  // Resolve Includes FIRST (so Fact tokens carried in by an Include resolve in
  // the calling doc's ctx), then Facts.
  const factCtx = { applies_to: ctx?.applies_to_override || fm.applies_to || "company-wide" };
  const r1 = resolveIncludeTokens(doc.body, docsMap, factCtx);
  const r2 = resolveFactTokens(r1.mdx, facts, factCtx);
  const flattenedText = flattenForCorpus(r2.mdx, fm);
  return {
    included: true,
    flattenedText,
    resolutions: r2.resolutions,
    includes: r1.includes,
  };
}

/**
 * The existing chunker expects { driveTitle, sections } per
 * src/lib/sousai/chunk.js. F1 shows how the flattened text adapts to that
 * input. At F8 we wire this directly to the chunker + embed step.
 *
 * For F1 we just split on [H1]/[H2]/[H3] markers and emit a fake-chunk count
 * so the round-trip output is visible.
 */
export function previewChunks(flattenedText, frontmatter) {
  // very rough preview - split on H1 markers, then count words per section
  const sections = flattenedText.split(/\n\[H1\]\s*/);
  const out = [];
  let idx = 0;
  // first segment may be the header line - keep it as a preamble chunk
  if (sections[0] && sections[0].trim()) {
    out.push({ chunk_index: idx++, section: null, preview: sections[0].slice(0, 120), char_count: sections[0].length });
  }
  for (let i = 1; i < sections.length; i++) {
    const seg = "[H1] " + sections[i];
    const headingLine = seg.split("\n")[0].replace(/^\[H1\]\s*/, "");
    out.push({
      chunk_index: idx++,
      section: headingLine,
      preview: seg.slice(0, 120).replace(/\n/g, " "),
      char_count: seg.length,
    });
  }
  return out;
}
