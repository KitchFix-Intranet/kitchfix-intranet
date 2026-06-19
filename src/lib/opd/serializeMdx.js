// ────────────────────────────────────────────────────────────────────────────
// src/lib/opd/serializeMdx.js
//
// Round-trip-faithful re-serializer for OPD MDX files. Default
// gray-matter.stringify rewrites quote styles, folds long strings, expands
// inline-flow YAML to block YAML, and turns dates into ISO timestamps.
// That makes "save with no edits" produce a giant noisy diff every time -
// not acceptable for the authoring contract.
//
// Strategy: surgical patching at the top-level key granularity.
// - Parse the ORIGINAL YAML block into ordered entries (each entry = a key
//   plus its full text spanning continuation lines).
// - For each entry, deep-equal the original value vs. the user's edited
//   value. Unchanged -> keep original entry text VERBATIM. Changed ->
//   re-dump just that entry via js-yaml. Removed -> drop. Added -> append.
// - The body is replaced verbatim with the user's body string.
//
// Result: unchanged save = byte-identical file (caller's no-op check sees
// equal content and skips the commit). Scalar edits = one or two lines
// diff. Complex-field edits (arrays, nested objects) re-dump in js-yaml's
// canonical block form for that one entry; bounded noise.
//
// gray-matter ships js-yaml as a transitive; we use it directly here.
// ────────────────────────────────────────────────────────────────────────────

import yaml from "js-yaml";
import { isDeepStrictEqual } from "node:util";

// Walk a value and convert Date objects to YYYY-MM-DD strings - the editor
// always sends date STRINGS back; the original gray-matter parse returns
// Dates. Equalize before comparison.
function normalizeDates(v) {
  if (v === null || v === undefined) return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map(normalizeDates);
  if (typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = normalizeDates(val);
    return out;
  }
  return v;
}

// Split a YAML block (the text between the two --- fences, exclusive)
// into ordered { key, text } entries. A top-level entry starts with
// /^[A-Za-z_][\w-]*:/ and continues until the next such line or end.
// Continuation lines start with whitespace, with '-' (sequence item under
// a top-level key), or are blank.
function parseEntries(yamlText) {
  const lines = yamlText.split("\n");
  const entries = [];
  let current = null;
  for (const line of lines) {
    const topMatch = /^([A-Za-z_][\w-]*):/.exec(line);
    if (topMatch && !line.startsWith(" ") && !line.startsWith("\t")) {
      // Close previous and start a new entry.
      if (current) entries.push(current);
      current = { key: topMatch[1], lines: [line] };
    } else if (current) {
      current.lines.push(line);
    } else {
      // Stray content before any key (shouldn't happen for valid YAML);
      // attach to a synthetic "preamble" entry so we don't lose it.
      if (!entries.length || entries[0].key !== "__preamble__") {
        entries.unshift({ key: "__preamble__", lines: [line] });
      } else {
        entries[0].lines.push(line);
      }
    }
  }
  if (current) entries.push(current);
  return entries;
}

// Dump a single { key: value } pair via js-yaml in a corpus-friendly shape:
// no line wrapping, double-quote style. The output may end with a trailing
// newline that js-yaml adds; strip it so callers can rejoin cleanly.
function dumpEntry(key, value) {
  const text = yaml.dump(
    { [key]: value },
    {
      lineWidth: -1,
      quotingType: '"',
      forceQuotes: false,
      noRefs: true,
      sortKeys: false,
    }
  );
  // js-yaml ends with "\n"; trim trailing whitespace, the joiner adds it back.
  return text.replace(/\n+$/, "");
}

/**
 * Reconstruct an MDX file from the user's edited frontmatter + body, using
 * the original file as the round-trip anchor.
 *
 * @param {object} args
 * @param {string} args.original    - the file's current content (from GitHub)
 * @param {object} args.userFm      - the user's edited frontmatter object
 * @param {string} args.userBody    - the user's edited body string
 *
 * @returns {{ content: string, unchanged: boolean }}
 *   `content` is the new file text (`---\n${yaml}\n---\n${body}`).
 *   `unchanged` is true when the user's data is deep-equal to the original
 *   data AND the user's body equals the original body - the caller should
 *   skip the commit entirely in that case.
 */
export function serializeMdx({ original, userFm, userBody }) {
  // Split the original into frontmatter YAML block + body.
  const normalizedOriginal = original.replace(/\r\n/g, "\n");
  const match = normalizedOriginal.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error("Original file has no parseable frontmatter block");
  }
  const originalYaml = match[1];
  const originalBody = match[2];

  // Parse the original data so we know the canonical shape to compare against.
  // The user's frontmatter arrived as JSON with date strings already
  // normalized by the read action; normalize the freshly-parsed original to
  // match.
  const originalData = normalizeDates(yaml.load(originalYaml) || {});
  const normalizedUserFm = normalizeDates(userFm);

  // No-op detection: data deep-equal AND body identical -> nothing to commit.
  if (
    isDeepStrictEqual(originalData, normalizedUserFm) &&
    userBody === originalBody
  ) {
    return { content: normalizedOriginal, unchanged: true };
  }

  // Surgical patch the YAML block.
  const entries = parseEntries(originalYaml);
  const userKeys = new Set(Object.keys(normalizedUserFm));
  const originalKeys = new Set(entries.map((e) => e.key).filter((k) => k !== "__preamble__"));

  const outLines = [];
  for (const entry of entries) {
    if (entry.key === "__preamble__") {
      outLines.push(...entry.lines);
      continue;
    }
    if (!userKeys.has(entry.key)) {
      // User removed this key.
      continue;
    }
    const origValue = normalizeDates(originalData[entry.key]);
    const userValue = normalizedUserFm[entry.key];
    if (isDeepStrictEqual(origValue, userValue)) {
      // Unchanged - keep the entry text byte-for-byte.
      outLines.push(...entry.lines);
    } else {
      // Re-dump just this entry.
      outLines.push(dumpEntry(entry.key, userValue));
    }
  }

  // Append any keys the user added that did not exist in the original.
  for (const key of userKeys) {
    if (!originalKeys.has(key)) {
      outLines.push(dumpEntry(key, normalizedUserFm[key]));
    }
  }

  // Join and assemble.
  const newYaml = outLines.join("\n");
  const content = `---\n${newYaml}\n---\n${userBody}`;
  return { content, unchanged: false };
}
