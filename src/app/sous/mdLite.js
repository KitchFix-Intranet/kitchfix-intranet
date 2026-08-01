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
//   3. Table blocks: GFM-style pipe tables -> <table>                  (PR #566)
//   4. Headings: `##` -> <h3>, `###` -> <h4>                           (PR A polish)
//   5. Horizontal rule: `---` on its own line -> <hr>                  (PR A polish)
//   6. List blocks: consecutive lines starting with "1. " / "- " / "* "
//      get wrapped in <ol> / <ul>
//   7. Remaining line breaks become <br>
//
// Table support added 2026-07-29 (Phase F PR 2). Sous emits tables when the
// answer is tabular (per-account price rows, category breakdowns) and the
// pre-PR renderer left them as literal pipes. A malformed table (bad
// separator row, mismatched cell count) stays literal rather than producing
// broken HTML - same degraded-until-complete behavior as unbalanced bold.
//
// Headings + hr added 2026-08-01 (PR A polish). The model was emitting
// `## FORM-004` and `---` in tabular answers and the renderer left them as
// literal characters. Downshifted one level (`##` -> h3 not h2) so h2 stays
// reserved for the surface hero. Escape order remains: HTML always first.
//
// Applied per delta during streaming: unbalanced markers (an odd count of `**`,
// a list opener without a following item, or a table split across deltas)
// render as literal text until the closing token arrives. This is acceptable
// per the Train 3 prompt - the tiny visual jitter beats streaming a partial
// DOM tree.
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
  // Replace \n with <br>, but not adjacent to a block element opening/closing
  // tag. h3/h4/hr added for the PR A heading + rule pass.
  return text.replace(/\n(?!<\/?(ol|ul|li|h3|h4|hr)>)|(?<!<\/?(ol|ul|li|h3|h4|hr)>)\n/g, "<br>");
}

// GFM-style pipe tables. Matches a header row + separator row + one or more
// body rows. Escape has already run, so pipe chars are literal `|` (not HTML
// entities) - the parser reads them directly. Cell content is trusted only
// because it went through escapeHtml at step 1; the ONLY new HTML we emit is
// the table structure. That is the entire security posture.
//
// Shape:
//   | col1 | col2 |
//   |---|---|
//   | a1  | a2   |
//   | b1  | b2   |
//
// Rules:
//   - Header row: starts with `|`, ends with `|`, has 2+ pipes.
//   - Separator row (next line): each cell is `-`+ optionally colon-padded
//     for alignment. Cell count must equal header cell count.
//   - Body rows: same shape as header until a non-`|` line, blank line, or
//     row-shape mismatch. Rows with fewer/more cells than the header are
//     dropped from the table and left as literal text - safer than
//     silently backfilling.
//   - Malformed table (missing separator, no rows, cell mismatch): the
//     block stays as its original lines, unchanged.
function applyTables(text) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (isTableRow(lines[i]) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headerCells = splitTableRow(lines[i]);
      const sepCells = splitTableRow(lines[i + 1]);
      if (headerCells.length >= 2 && sepCells.length === headerCells.length) {
        // Collect body rows.
        const bodyRows = [];
        let j = i + 2;
        while (j < lines.length && isTableRow(lines[j])) {
          const cells = splitTableRow(lines[j]);
          if (cells.length !== headerCells.length) break; // shape mismatch stops the table
          bodyRows.push(cells);
          j += 1;
        }
        // A table needs at least one body row to be worth emitting; a bare
        // header + separator with no rows stays literal.
        if (bodyRows.length > 0) {
          out.push(buildTableHtml(headerCells, bodyRows));
          i = j;
          continue;
        }
      }
    }
    out.push(lines[i]);
    i += 1;
  }
  return out.join("\n");
}

function isTableRow(line) {
  if (!line) return false;
  const t = line.trimEnd();
  return t.startsWith("|") && t.endsWith("|") && t.length >= 3 && (t.match(/\|/g) || []).length >= 2;
}

function isTableSeparator(line) {
  if (!isTableRow(line)) return false;
  const cells = splitTableRow(line);
  if (cells.length < 2) return false;
  // Each cell must match the alignment pattern: optional colon, one-or-more
  // dashes, optional colon, surrounded by optional whitespace.
  return cells.every((c) => /^:?-+:?$/.test(c.trim()));
}

function splitTableRow(line) {
  // Strip leading/trailing `|` then split on `|`. Preserve inner whitespace
  // and trim only surrounding whitespace on each cell.
  const t = line.trim();
  const inner = t.replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((c) => c.trim());
}

// Numeric-cell heuristic. Strips bold, currency, commas, percent, parens (for
// negatives), leading/trailing whitespace - then asks if what's left parses as
// a finite number. Empty cells are neutral (don't flip a column non-numeric).
function isNumericCell(text) {
  if (text == null) return true;
  const stripped = String(text)
    .replace(/\*\*/g, "")
    .replace(/[$,%()]/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (stripped === "" || stripped === "-" || stripped === "—") return true;
  return Number.isFinite(Number(stripped));
}

function buildTableHtml(headerCells, bodyRows) {
  // For each column, check if every non-empty body cell parses numeric. If so,
  // tag th+td with data-num so CSS can right-align + tabular-nums.
  const numericCols = headerCells.map((_, colIdx) => {
    let sawAny = false;
    for (const row of bodyRows) {
      const cell = row[colIdx];
      if (cell != null && String(cell).trim() !== "") {
        sawAny = true;
        if (!isNumericCell(cell)) return false;
      }
    }
    return sawAny;
  });
  const head = "<tr>" + headerCells
    .map((c, i) => `<th${numericCols[i] ? " data-num" : ""}>${applyBold(c)}</th>`)
    .join("") + "</tr>";
  const body = bodyRows
    .map((row) => "<tr>" + row
      .map((c, i) => `<td${numericCols[i] ? " data-num" : ""}>${applyBold(c)}</td>`)
      .join("") + "</tr>")
    .join("");
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

// Block-level `##`/`###` on their own line become <h3>/<h4>. `---` on its
// own line becomes <hr>. Runs on already-escaped, already-bold-substituted
// text; needs to run BEFORE lists so a `## Foo` line isn't accidentally
// swept into a list block. Downshift: `##` -> h3 (not h2) because h2 stays
// reserved for the surface hero.
function applyHeadingsAndRule(text) {
  const lines = text.split("\n");
  return lines.map((line) => {
    const t = line.trim();
    if (/^---+$/.test(t)) return "<hr>";
    let m = t.match(/^###\s+(.+)$/);
    if (m) return `<h4>${m[1]}</h4>`;
    m = t.match(/^##\s+(.+)$/);
    if (m) return `<h3>${m[1]}</h3>`;
    return line;
  }).join("\n");
}

// The main entry. Escape first, then bold, then tables, then headings+hr,
// then lists, then line breaks. Table pass runs AFTER bold so cell content
// can still carry **strong** spans; runs BEFORE headings because a `|` row
// is not a heading. Headings run BEFORE lists so `## Foo` doesn't become
// part of a hyphen-bullet block. Tables/headings/hr/lists never overlap -
// each pattern owns its own line shape.
export function renderMdLite(input) {
  if (input == null) return "";
  const escaped = escapeHtml(input);
  const bolded = applyBold(escaped);
  const tabled = applyTables(bolded);
  const headed = applyHeadingsAndRule(tabled);
  const listed = applyLists(headed);
  return applyLineBreaks(listed);
}
