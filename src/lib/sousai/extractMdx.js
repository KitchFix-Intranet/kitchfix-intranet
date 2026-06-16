// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/extractMdx.js
// SousAI · Layer 2 · MDX extraction (resolved-markdown source of truth)
// ─────────────────────────────────────────────────────────────────────────────
//
// A5 replacement for extract.js's Drive Docs API path. Reads the MDX file
// from content/documents/{docId}.mdx, runs it through the same resolver
// pipeline the projection uses (Include + Fact + SourceGoverns + strip
// NonCanonical), then walks the resolved markdown to emit the EXACT shape
// extractGoogleDoc returns: { driveTitle, sections: [{heading, level,
// ancestry, text}] }. Drop-in for chunkSections - chunk.js, embed.js, and
// store.js are unchanged.
//
// Section semantics (mirrors extract.js parseSections):
//   - The first section before any heading has heading=null, level=null,
//     ancestry=[] (the unsectioned preamble).
//   - ATX heading lines `#`..`######` become section breaks. The heading
//     text goes on the section's `heading` field; the text accumulated
//     until the NEXT heading becomes the section's `text`. The heading
//     line itself is NOT repeated in body text.
//   - level: 1..6 for `#`..`######`. (No TITLE concept in markdown - the
//     fm.title supplies driveTitle.)
//   - ancestry: outer-to-inner heading text stack. For H3 inside H2 inside
//     H1, ancestry = [H1.text, H2.text].
//
// Code-fence respect: lines inside ``` or ~~~ fences are body text even if
// they start with `#`. The MDX corpus uses fences sparingly but the
// projection's resolver may emit them; respecting them keeps the chunker
// from creating phantom sections.
//
// docsMap: corpus-level Include resolution requires every doc's raw body
// to be available. The caller (the corpus script) should build the map
// once and pass it through to every extractMdx call. For one-off use
// (the smoke-test script), this module exposes buildDocsMap() to build
// it on demand from the on-disk corpus.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { splitMdx, loadYaml } from "../../../scripts/content/lib/frontmatter.mjs";
import {
  resolveIncludeTokens,
  resolveFactTokens,
  expandSourceGoverns,
  stripNonCanonical,
} from "../../../scripts/content/resolver.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const DOCS_DIR  = join(REPO_ROOT, "content", "documents");
const FACTS_FILE = join(REPO_ROOT, "content", "facts", "operational-facts.yaml");

/**
 * Build a corpus docsMap (doc_id -> raw body string). The Include resolver
 * needs every doc's body so it can inline cross-references. For the corpus
 * embed loop, build this once and pass to every extractMdx() call to avoid
 * re-reading 101 files per doc.
 */
export function buildDocsMap() {
  const map = {};
  for (const f of readdirSync(DOCS_DIR).filter((x) => x.endsWith(".mdx"))) {
    const src = readFileSync(join(DOCS_DIR, f), "utf8");
    const { frontmatter, body } = splitMdx(src);
    if (frontmatter.id) map[frontmatter.id] = body;
  }
  return map;
}

let _factsCache = null;
function getFacts() {
  if (!_factsCache) {
    _factsCache = loadYaml(readFileSync(FACTS_FILE, "utf8"));
  }
  return _factsCache;
}

/**
 * Extract a doc by ID and return the same { driveTitle, sections } shape
 * extractGoogleDoc returns - so chunkSections() can consume it unchanged.
 *
 * @param {string} docId - e.g. "PB-002"
 * @param {object} [opts]
 * @param {object} [opts.docsMap] - corpus map for Include resolution.
 *   If omitted, built on-demand from the on-disk corpus (slower; use
 *   for one-off calls only).
 * @returns {Promise<{ driveTitle: string, sections: Array<{heading: string|null, level: number|null, ancestry: string[], text: string}> }>}
 *
 * Throws if the MDX file doesn't exist or the resolver fails.
 */
export async function extractMdx(docId, opts = {}) {
  const file = join(DOCS_DIR, `${docId}.mdx`);
  let src;
  try {
    src = readFileSync(file, "utf8");
  } catch (e) {
    throw new Error(
      `extractMdx: ${docId} - ${file.replace(REPO_ROOT + "/", "")} not found (${e.message})`
    );
  }

  const { frontmatter: fm, body } = splitMdx(src);
  const facts = getFacts();
  const docsMap = opts.docsMap || buildDocsMap();
  const ctx = { applies_to: fm.applies_to || "company-wide" };

  // Pipeline order matches the projection (post-F6.5): Include first so
  // any Fact carried in by an Include resolves in the calling doc's ctx,
  // then Facts. Then SourceGoverns becomes prose, then NonCanonical blocks
  // are stripped per the Hard Floor Rule (Sous never quotes specimens).
  const r1 = resolveIncludeTokens(body, docsMap, ctx);
  const r2 = resolveFactTokens(r1.mdx, facts, ctx);
  const sgBody = expandSourceGoverns(r2.mdx);
  const nc = stripNonCanonical(sgBody);
  const resolved = nc.mdx;

  return {
    driveTitle: fm.title || docId,
    sections: parseMarkdownSections(resolved),
  };
}

/**
 * Walk the resolved markdown line-by-line, tracking ATX headings as
 * section breaks and respecting fenced code blocks. Output matches
 * extractGoogleDoc.parseSections exactly: heading text on `heading`,
 * body text on `text`, ancestry as outer-to-inner heading stack.
 */
function parseMarkdownSections(md) {
  const sections = [];
  const headingStack = [];
  let current = { heading: null, level: null, ancestry: [], text: "" };

  const flush = () => {
    if (current.text.trim() || current.heading) {
      sections.push({
        heading: current.heading,
        level: current.level,
        ancestry: [...current.ancestry],
        text: current.text.trim(),
      });
    }
  };

  const lines = md.split("\n");
  let inFence = false;
  let fenceMarker = "";

  for (const rawLine of lines) {
    const line = rawLine;

    // Fenced code block tracking. The fence marker (``` or ~~~) toggles
    // inFence; lines while inFence are body text regardless of leading #.
    const fenceMatch = line.match(/^(\s{0,3})(```|~~~)/);
    if (fenceMatch) {
      const marker = fenceMatch[2];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (line.trimStart().startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = "";
      }
      // The fence line itself is body text.
      if (current.text && !current.text.endsWith("\n")) current.text += "\n";
      current.text += line;
      continue;
    }

    if (inFence) {
      if (current.text && !current.text.endsWith("\n")) current.text += "\n";
      current.text += line;
      continue;
    }

    // ATX heading detection: 1-6 leading `#` followed by a space + content.
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      flush();
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      // Close any deeper-or-equal ancestors so the new ancestry is the
      // remaining stack; then push self.
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1].level >= level
      ) {
        headingStack.pop();
      }
      const ancestry = headingStack.map((h) => h.heading);
      headingStack.push({ heading: text, level });
      current = { heading: text, level, ancestry, text: "" };
      continue;
    }

    // Normal body line. Skip empty lines unless we already have body text;
    // collapsing consecutive blanks keeps the chunker's size estimates
    // closer to the actual prose volume.
    if (!line.trim()) {
      if (current.text && !current.text.endsWith("\n\n")) current.text += "\n";
      continue;
    }
    if (current.text && !current.text.endsWith("\n")) current.text += "\n";
    current.text += line;
  }

  flush();
  return sections;
}
