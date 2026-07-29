// ════════════════════════════════════════════════════════════════════════════
// mdLite - markdown-lite renderer for Sous answer bodies (Train 3)
// ════════════════════════════════════════════════════════════════════════════
//
// Sous writes markdown natively (plan v2.32: `**$515,712**` in the trace). This
// module renders that markdown to safe HTML for injection via
// dangerouslySetInnerHTML. Zero deps.
//
// The pipeline is intentionally minimal - only what Sous emits often:
//   1. Escape every HTML entity first (& < > " ')                      SECURITY
//   2. Bold spans: **text** -> <strong>text</strong>
//   3. List blocks: consecutive lines starting with "1. " / "- " / "* "
//      get wrapped in <ol> / <ul>
//   4. Remaining line breaks become <br>
//
// Applied per delta during streaming: unbalanced markers (an odd count of `**`,
// or a list opener without a following item) render as literal text until the
// closing token arrives. This is acceptable per the Train 3 prompt - the tiny
// visual jitter beats streaming a partial DOM tree.
//
// ONE HARD RULE: escape before ANY substitution. If a future variant adds a
// pattern that emits inline HTML from user text, escape that user text first.
// Otherwise script injection is one prompt away.
// ════════════════════════════════════════════════════════════════════════════

const HTML_ENTITY_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(input) {
  if (input == null) return "";
  return String(input).replace(/[&<>"']/g, (c) => HTML_ENTITY_MAP[c]);
}

// Applies bold spans. Runs on ALREADY-ESCAPED text so it never invents HTML.
// The greedy match is a non-greedy pair scanner: `**a **b**` becomes
// `<strong>a </strong>b**` (first pair wins). Fine for Sous's usage - a
// mid-answer un-closed `**` renders as literal `**` until the closer arrives.
function applyBold(text) {
  return text.replace(/\*\*([^\n*][^\n]*?)\*\*/g, (_, inner) => `<strong>${inner}</strong>`);
}

// Splits text into "list block" and "prose block" runs and wraps list blocks
// in <ol> / <ul>. A list block is 1+ consecutive lines that all start with
// the same marker family (numbered vs bulleted). Trailing text on a bullet
// line is emitted as the <li> content verbatim (after prior escape + bold).
//
// Applied on already-escaped, already-bold-substituted text so bold inside a
// bullet keeps rendering (e.g. `- **PB-002** Allergen protocol`).
function applyLists(text) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Numbered list: `1. `, `2. ` ... (allow one or more digits, dot, space)
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      out.push("<ol>");
      for (const it of items) out.push(`<li>${it}</li>`);
      out.push("</ol>");
      continue;
    }
    // Bulleted list: `- ` or `* `
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      out.push("<ul>");
      for (const it of items) out.push(`<li>${it}</li>`);
      out.push("</ul>");
      continue;
    }
    out.push(line);
    i += 1;
  }
  return out.join("\n");
}

// Turns raw \n outside of list wrappers into <br>. Runs last so it doesn't
// mangle the <ol>/<ul>/<li> structure - the split happens on \n but list
// tags are on their own lines, so replacing \n between them is safe (they
// become <ol><br><li>... which browsers ignore fine, so we strip the \n
// only between text runs).
function applyLineBreaks(text) {
  // Replace \n with <br>, but not immediately before/after <ol>/<ul>/</ol>/</ul>/<li>/</li>
  return text.replace(/\n(?!<\/?(ol|ul|li)>)|(?<!<\/?(ol|ul|li)>)\n/g, "<br>");
}

// The main entry. Escape first, then bold, then lists, then line breaks.
export function renderMdLite(input) {
  if (input == null) return "";
  const escaped = escapeHtml(input);
  const bolded = applyBold(escaped);
  const listed = applyLists(bolded);
  return applyLineBreaks(listed);
}
