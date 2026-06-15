// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/resolver.mjs
// The single point where MDX source + a context becomes resolved text.
// Per brief §3.7.
//
// Token grammar (F1 - regex-based; swap to @mdx-js/mdx at F1.5 for nested JSX):
//   <Fact id="fact_id" />        atomic fact lookup, with override resolution
//   <Include doc="DOC-ID" section="..." />   transclude a section
//
// Resolution rules:
//   - global fact -> render the default value verbatim
//   - override-bearing fact in a scoped doc (applies_to has state/account/role)
//     -> render the most specific matching override, else the default
//   - override-bearing fact in a company-wide / unscoped context
//     -> render the default + "(varies by <dimension>)" qualifier
//     This is what keeps the corpus from teaching Sous a conditional as universal.
//
// flattenForCorpus walks the MDX body, strips JSX-style tokens after replacing
// them with resolved text, strips markdown noise that does not carry meaning
// to the chunker, and prepends the heading-ancestry path the existing chunker
// expects.
// ─────────────────────────────────────────────────────────────────────────────

const FACT_RE = /<Fact\s+id\s*=\s*"([^"]+)"\s*\/>/g;
const INCLUDE_RE = /<Include\s+doc\s*=\s*"([^"]+)"\s+section\s*=\s*"([^"]+)"\s*\/>/g;
// <NonCanonical> wraps inline specimen/example content (callouts, sample rows).
// The resolver strips these blocks during flatten so Sous never quotes a
// demonstration as fact. Implements SousAI hard floor rule 7 at the content
// layer (F1.5 §4 rule).
const NON_CANONICAL_RE = /<NonCanonical>[\s\S]*?<\/NonCanonical>/g;
// <SourceGoverns> emits a one-line preamble on derived/reference docs noting
// the canonical source. Used by CHK / REF / TPL classes that derive from a
// parent SOP / POL / PB. F1.5 §4 rule.
const SOURCE_GOVERNS_RE = /<SourceGoverns\s+doc\s*=\s*"([^"]+)"(?:\s+section\s*=\s*"([^"]+)")?\s*\/>/g;

/**
 * @param {object} fact   the parsed fact entry from operational-facts.yaml
 * @param {object} ctx    { applies_to: 'company-wide' | { states, account, role } }
 * @returns {{ value: string, authority: string, sourceFact: string, qualifier?: string, resolution: 'default'|'override'|'qualified' }}
 */
export function resolveFact(factId, fact, ctx) {
  if (!fact) {
    throw new Error(`Fact '${factId}' not found in operational-facts.yaml`);
  }
  if (fact.scope === "global") {
    return {
      value: String(fact.default.value),
      authority: fact.default.authority,
      sourceFact: factId,
      resolution: "default",
    };
  }
  // override-bearing
  const appliesTo = ctx?.applies_to;
  const scoped = appliesTo && typeof appliesTo === "object";
  if (scoped) {
    // pick the most-specific matching override (more matching dims wins)
    let best = null;
    let bestScore = -1;
    for (const ov of fact.overrides || []) {
      let score = 0;
      let matches = true;
      for (const [dim, val] of Object.entries(ov.when || {})) {
        const ctxVal = appliesTo[dim] || (Array.isArray(appliesTo[dim + "s"]) && appliesTo[dim + "s"][0]);
        // contextual state lookup: appliesTo.states is the doc's state list; match if it includes the override's state
        let matched = false;
        if (dim === "state") {
          const docStates = appliesTo.states || (appliesTo.state ? [appliesTo.state] : []);
          matched = docStates.includes(val);
        } else if (dim === "account") {
          matched = appliesTo.account === val;
        } else if (dim === "role") {
          matched = appliesTo.role === val;
        }
        if (!matched) { matches = false; break; }
        score++;
      }
      if (matches && score > bestScore) {
        best = ov;
        bestScore = score;
      }
    }
    if (best) {
      return {
        value: String(best.value),
        authority: best.authority,
        sourceFact: factId,
        resolution: "override",
      };
    }
    // scoped but no matching override -> fall back to default
    return {
      value: String(fact.default.value),
      authority: fact.default.authority,
      sourceFact: factId,
      resolution: "default",
    };
  }
  // company-wide / unscoped -> default + qualifier
  const dims = (fact.dimensions || []).join("/");
  const qualifier = dims ? `varies by ${dims}` : "varies by jurisdiction";
  return {
    value: String(fact.default.value),
    authority: fact.default.authority,
    sourceFact: factId,
    qualifier,
    resolution: "qualified",
  };
}

/**
 * Substitute <Fact /> tokens with resolved values in MDX source.
 * Returns the substituted source + a list of factResolutions for inspection.
 */
export function resolveFactTokens(mdxBody, facts, ctx) {
  const resolutions = [];
  const substituted = mdxBody.replace(FACT_RE, (_, id) => {
    const res = resolveFact(id, facts[id], ctx);
    resolutions.push(res);
    if (res.resolution === "qualified") {
      return `${res.value} (${res.qualifier})`;
    }
    return res.value;
  });
  return { mdx: substituted, resolutions };
}

/**
 * Find a section's body in an MDX document by section ref.
 *
 * Section matching (in order of priority):
 *   1. exact full H1/H2 title match    ("06 Nutritional Supplements Protocol")
 *   2. exact full text after the marker ("Staff Rules" matches "## Staff Rules")
 *   3. H1 number prefix                 ("06" matches "# 06 Nutritional Supplements Protocol")
 *
 * Returns body content from after the heading to the next heading at the same
 * level or higher (i.e., everything that belongs structurally to the section).
 * The section's own heading line is dropped so the Include caller's heading
 * remains the canonical parent.
 *
 * Headings inside the included body are NOT downshifted - they nest under the
 * caller's heading at whatever level they sit at. For typical use (transcluding
 * an H1 section under another H1) this preserves a clean hierarchy.
 */
export function getSectionBody(mdxBody, sectionRef) {
  const lines = mdxBody.split("\n");
  let startIdx = -1;
  let startLevel = 0;
  const refTrim = String(sectionRef).trim();
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!h) continue;
    const level = h[1].length;
    const text = h[2].trim();
    // Priority 1+2: exact text match (works for any heading level)
    if (text === refTrim) {
      startIdx = i; startLevel = level; break;
    }
    // Priority 3: numeric prefix match for H1 only
    if (level === 1) {
      const prefix = text.split(/\s+/)[0];
      if (prefix === refTrim) {
        startIdx = i; startLevel = level; break;
      }
    }
  }
  if (startIdx === -1) {
    return { found: false, body: "" };
  }
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const h = lines[i].match(/^(#{1,6})\s/);
    if (h && h[1].length <= startLevel) {
      endIdx = i;
      break;
    }
  }
  const bodyLines = lines.slice(startIdx + 1, endIdx);
  // Trim leading + trailing blank lines so the inlined block sits cleanly
  while (bodyLines.length && bodyLines[0].trim() === "") bodyLines.shift();
  while (bodyLines.length && bodyLines[bodyLines.length - 1].trim() === "") bodyLines.pop();
  return { found: true, body: bodyLines.join("\n") };
}

/**
 * Substitute <Include /> tokens by inlining the named section from another doc.
 * The docsMap is { docId: bodyString } - the caller is responsible for stripping
 * frontmatter and passing the resolved body of each doc.
 */
export function resolveIncludeTokens(mdxBody, docsMap, _ctx) {
  const includes = [];
  const substituted = mdxBody.replace(INCLUDE_RE, (_, doc, section) => {
    includes.push({ doc, section, resolved: false });
    const sourceBody = docsMap ? docsMap[doc] : null;
    if (!sourceBody) {
      return `<!-- INCLUDE: doc "${doc}" not in docsMap -->`;
    }
    const { found, body } = getSectionBody(sourceBody, section);
    if (!found) {
      return `<!-- INCLUDE: section "${section}" not found in ${doc} -->`;
    }
    includes[includes.length - 1].resolved = true;
    return `\n${body}\n`;
  });
  return { mdx: substituted, includes };
}

/**
 * Strip <NonCanonical>...</NonCanonical> blocks. The substituted text is what
 * appears in the corpus and in the print render; the source MDX keeps the
 * specimen content for human readers in the intranet view (next phase).
 * Returns { mdx, stripped } where stripped is the count for inspection.
 */
export function stripNonCanonical(mdxBody) {
  let stripped = 0;
  const mdx = mdxBody.replace(NON_CANONICAL_RE, () => {
    stripped++;
    return "";
  });
  return { mdx, stripped };
}

/**
 * Replace <SourceGoverns doc="..." section="..." /> with a one-line preamble.
 * Emitted near the top of derived / reference docs so a Sous answer carries
 * the source-of-truth pointer in-band.
 */
export function expandSourceGoverns(mdxBody) {
  const expanded = mdxBody.replace(SOURCE_GOVERNS_RE, (_, doc, section) => {
    const ref = section ? `${doc} ${section}` : doc;
    return `> This document derives from ${ref}. Where the two differ, ${doc} governs.`;
  });
  return expanded;
}

/**
 * Flatten resolved MDX into plain text the chunker can read.
 * The existing structure-aware chunker in src/lib/sousai/chunk.js expects:
 *   - real heading lines (we mark them with [H1]/[H2]/[H3] like the extract probe)
 *   - paragraph text with blank lines between paragraphs
 *
 * This function:
 *   - strips JSX-style elements that survived (not Fact/Include, which the
 *     callers should have resolved first)
 *   - converts markdown headings (`# `, `## `, `### `) into [H1]/[H2]/[H3] markers
 *   - normalizes excessive whitespace
 *   - prepends the doc identity line per the chunker's contextual-header pattern
 */
export function flattenForCorpus(mdxBody, frontmatter) {
  let s = mdxBody;
  // 0. Strip non-canonical blocks BEFORE any other JSX sweep so the specimen
  //    content never enters the corpus. F1.5 §4 rule.
  s = stripNonCanonical(s).mdx;
  // 0b. Expand SourceGoverns preambles to plain prose.
  s = expandSourceGoverns(s);
  // 1. Remove leftover JSX-ish self-closing tags (paranoid sweep)
  s = s.replace(/<[A-Z][A-Za-z0-9]*\b[^>]*\/>/g, "");
  s = s.replace(/<\/?[A-Z][A-Za-z0-9]*\b[^>]*>/g, "");
  // 2. Markdown headings -> [H1]/[H2]/[H3] markers
  s = s.replace(/^######\s+(.*)$/gm, "[H6] $1");
  s = s.replace(/^#####\s+(.*)$/gm, "[H5] $1");
  s = s.replace(/^####\s+(.*)$/gm, "[H4] $1");
  s = s.replace(/^###\s+(.*)$/gm, "[H3] $1");
  s = s.replace(/^##\s+(.*)$/gm, "[H2] $1");
  s = s.replace(/^#\s+(.*)$/gm, "[H1] $1");
  // 3. Strip MDX-flavored HTML comments
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  // 4. Strip leftover include stubs cleanly
  s = s.replace(/INCLUDE-STUB:.*$/gm, "");
  // 5. Collapse excessive blanks
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  // 6. Prepend the doc-identity header (matches the chunker's "From: ..." convention)
  const header = `From: ${frontmatter.title} (${frontmatter.id})`;
  return `${header}\n\n${s}`;
}

/**
 * Pretty-print a fact resolution for inspection output.
 */
export function formatResolution(r) {
  let mark = "";
  if (r.resolution === "override") mark = " [override]";
  else if (r.resolution === "qualified") mark = ` [qualified: ${r.qualifier}]`;
  return `  ${r.sourceFact}${mark} -> "${r.value}"  (authority: ${r.authority})`;
}
