// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/lib/frontmatter.mjs
// F1.5: production-grade frontmatter extraction via gray-matter.
//
// gray-matter handles YAML 1.2, multi-line scalars, anchors, the full grammar
// we cannot cover in a hand-rolled parser. Replaces the F1 yaml_lite path.
// ─────────────────────────────────────────────────────────────────────────────

import matter from "gray-matter";

// YAML auto-typing turns unquoted ISO dates into Date objects. Our schemas
// declare these fields as `string` with `format: date` (YYYY-MM-DD), so the
// downstream pipeline (validator, catalog row, derived calendar) expects
// strings. Walk the parsed object after the YAML load and re-stringify any
// Date instance to its YYYY-MM-DD form.
function normalizeDates(obj) {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) {
    const iso = obj.toISOString();
    return iso.slice(0, 10);
  }
  if (Array.isArray(obj)) {
    return obj.map(normalizeDates);
  }
  if (typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = normalizeDates(v);
    }
    return out;
  }
  return obj;
}

/**
 * Split an MDX source into { frontmatter, body }.
 * Throws on malformed frontmatter or YAML parse error (with line info).
 */
export function splitMdx(source) {
  if (typeof source !== "string") {
    throw new Error("splitMdx: source must be a string");
  }
  // gray-matter accepts both LF and CRLF; normalize for parity with F1.
  const normalized = source.replace(/\r\n/g, "\n");
  const parsed = matter(normalized);
  if (!parsed || !parsed.data) {
    throw new Error("MDX source missing or empty frontmatter");
  }
  return { frontmatter: normalizeDates(parsed.data), body: parsed.content };
}

/**
 * Convenience: parse a stand-alone YAML string (for the facts file).
 */
export function loadYaml(source) {
  // gray-matter wraps the YAML loader; use it for consistency.
  const wrapped = `---\n${source}\n---\n`;
  return normalizeDates(matter(wrapped).data);
}
