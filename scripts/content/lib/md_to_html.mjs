// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/lib/md_to_html.mjs
// Focused Markdown -> HTML converter for the OPD content set.
//
// Covers the subset of Commonmark + GFM that the 101 MDX foundation docs
// actually use, identified by spot-reading the corpus:
//   - ATX headings (# .. ######)
//   - paragraphs (blank-line separated blocks)
//   - unordered lists ("- " or "* ")
//   - ordered lists ("1. ")
//   - GFM tables (| col | col |  +  |---|---| separator)
//   - blockquotes ("> "), including the brand callouts ANCHOR / NOTE / CRITICAL
//   - bold (**), italic (*  or _), inline code (`)
//   - fenced code blocks (``` or ~~~)
//   - links [text](url)
//   - horizontal rules (--- on its own line)
//   - line breaks at end-of-line (kept)
//
// What it does NOT do:
//   - reference-style links (none used in the corpus)
//   - HTML pass-through (the JSX tokens are resolved BEFORE this runs)
//   - footnotes
//   - autolinks
//   - the full Commonmark inline state machine (a couple of edge cases land
//     visibly degraded; flagged in the dry-run if encountered)
//
// The converter is intentionally regex-based + line-oriented. It is small,
// inspectable, and matches the corpus rather than the full spec. A real
// rehype pipeline would be the future swap if the content's complexity grew.
// ─────────────────────────────────────────────────────────────────────────────

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Inline: process **, _, `, links AFTER block-level handling.
// Order matters: code first (suspends ** / _), then **, then *, then _,
// then [text](url).
function renderInline(s) {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    // Inline code: backtick to next backtick
    if (ch === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > i) {
        const code = s.slice(i + 1, end);
        out += "<code>" + escapeHtml(code) + "</code>";
        i = end + 1;
        continue;
      }
    }
    // Bold: ** ... **
    if (ch === "*" && s[i + 1] === "*") {
      const end = s.indexOf("**", i + 2);
      if (end > i + 1) {
        const inner = s.slice(i + 2, end);
        out += "<strong>" + renderInline(inner) + "</strong>";
        i = end + 2;
        continue;
      }
    }
    // Italic: * ... * (single asterisk, no whitespace adjacent)
    if (ch === "*" && s[i + 1] !== "*" && s[i + 1] !== " ") {
      const end = s.indexOf("*", i + 1);
      if (end > i && s[end - 1] !== " " && end - i > 2) {
        const inner = s.slice(i + 1, end);
        if (!/\s/.test(inner.slice(0, 1)) && !/\s/.test(inner.slice(-1))) {
          out += "<em>" + renderInline(inner) + "</em>";
          i = end + 1;
          continue;
        }
      }
    }
    // Italic underscore: _word_ (must be surrounded by word boundaries)
    if (ch === "_") {
      const prev = i > 0 ? s[i - 1] : " ";
      if (/\s|[(\[]/.test(prev)) {
        const end = s.indexOf("_", i + 1);
        if (end > i + 1) {
          const next = end + 1 < s.length ? s[end + 1] : " ";
          if (/\s|[)\].,!?:;]/.test(next)) {
            const inner = s.slice(i + 1, end);
            out += "<em>" + renderInline(inner) + "</em>";
            i = end + 1;
            continue;
          }
        }
      }
    }
    // Link: [text](url)
    if (ch === "[") {
      const closeBracket = s.indexOf("]", i + 1);
      if (closeBracket > i && s[closeBracket + 1] === "(") {
        const closeParen = s.indexOf(")", closeBracket + 2);
        if (closeParen > closeBracket) {
          const text = s.slice(i + 1, closeBracket);
          const url = s.slice(closeBracket + 2, closeParen);
          out += `<a href="${escapeHtml(url)}">${renderInline(text)}</a>`;
          i = closeParen + 1;
          continue;
        }
      }
    }
    // Plain character
    out += escapeHtml(ch);
    i++;
  }
  return out;
}

// Strip the optional alignment row from a GFM table: |---|:---:|---:|
function isTableSeparator(line) {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("---");
}

function isTableRow(line) {
  return /^\s*\|.*\|\s*$/.test(line);
}

function splitTableRow(line) {
  // Trim leading + trailing pipe + whitespace; split on |
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

// Detect callout style on the first line of a blockquote, e.g., "> CRITICAL: ...".
const CALLOUT_RE = /^(ANCHOR|NOTE|CRITICAL|WARNING|TIP|DECISION):\s*/;

// ─────────────────────────────────────────────────────────────────────────────
// Block-level rendering. Walks the input line-by-line and emits HTML.
// ─────────────────────────────────────────────────────────────────────────────
export function renderMarkdownToHtml(md) {
  const lines = md.split("\n");
  const out = [];
  let i = 0;

  const flushParagraph = (buf) => {
    if (buf.length === 0) return;
    out.push(`<p>${renderInline(buf.join(" "))}</p>`);
    buf.length = 0;
  };

  let paraBuf = [];

  while (i < lines.length) {
    const line = lines[i];

    // Blank line ends a paragraph
    if (line.trim() === "") {
      flushParagraph(paraBuf);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      flushParagraph(paraBuf);
      out.push("<hr />");
      i++;
      continue;
    }

    // Fenced code block: ``` or ~~~
    const fenceMatch = line.match(/^([`~]{3,})\s*(\S*)\s*$/);
    if (fenceMatch) {
      flushParagraph(paraBuf);
      const fence = fenceMatch[1][0];
      const lang = fenceMatch[2] || "";
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith(fence.repeat(3))) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      const langAttr = lang ? ` class="lang-${escapeHtml(lang)}"` : "";
      out.push(
        `<pre><code${langAttr}>${escapeHtml(codeLines.join("\n"))}</code></pre>`
      );
      continue;
    }

    // ATX heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      flushParagraph(paraBuf);
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      out.push(`<h${level}>${renderInline(text)}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote (including callouts)
    if (/^>\s?/.test(line)) {
      flushParagraph(paraBuf);
      const blockLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        blockLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      // Detect callout on first non-empty line. Use markdown bold (**) on the
      // label so the recursive renderInline pass converts to <strong> without
      // being escaped. (Injecting raw HTML here would land via escapeHtml inside
      // renderInline and surface as &lt;strong&gt;.)
      let calloutClass = "";
      let firstNonEmpty = blockLines.find((l) => l.trim() !== "") || "";
      const calloutMatch = firstNonEmpty.match(CALLOUT_RE);
      if (calloutMatch) {
        calloutClass = ` class="callout callout-${calloutMatch[1].toLowerCase()}"`;
        for (let j = 0; j < blockLines.length; j++) {
          if (blockLines[j].trim() !== "") {
            blockLines[j] = blockLines[j].replace(
              CALLOUT_RE,
              `**${calloutMatch[1]}:** `
            );
            break;
          }
        }
      }
      // Recursively render the blockquote body (allows nested lists, etc.)
      const inner = renderMarkdownToHtml(blockLines.join("\n"));
      out.push(`<blockquote${calloutClass}>${inner}</blockquote>`);
      continue;
    }

    // Tables: a row followed by a separator row
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushParagraph(paraBuf);
      const header = splitTableRow(line);
      i += 2; // skip header + separator
      const bodyRows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        bodyRows.push(splitTableRow(lines[i]));
        i++;
      }
      let tableHtml = "<table><thead><tr>";
      for (const h of header) tableHtml += `<th>${renderInline(h)}</th>`;
      tableHtml += "</tr></thead><tbody>";
      for (const row of bodyRows) {
        tableHtml += "<tr>";
        for (const cell of row) tableHtml += `<td>${renderInline(cell)}</td>`;
        tableHtml += "</tr>";
      }
      tableHtml += "</tbody></table>";
      out.push(tableHtml);
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      flushParagraph(paraBuf);
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*[-*]\s+/, "");
        // Continuation lines: indented under the item
        const itemLines = [itemText];
        i++;
        while (
          i < lines.length &&
          lines[i].trim() !== "" &&
          !/^\s*[-*]\s+/.test(lines[i]) &&
          !/^\s*\d+\.\s+/.test(lines[i]) &&
          /^\s{2,}\S/.test(lines[i])
        ) {
          itemLines.push(lines[i].trim());
          i++;
        }
        items.push(itemLines.join(" "));
      }
      out.push(
        "<ul>" + items.map((it) => `<li>${renderInline(it)}</li>`).join("") + "</ul>"
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      flushParagraph(paraBuf);
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*\d+\.\s+/, "");
        items.push(itemText);
        i++;
      }
      out.push(
        "<ol>" + items.map((it) => `<li>${renderInline(it)}</li>`).join("") + "</ol>"
      );
      continue;
    }

    // Otherwise: accumulate paragraph
    paraBuf.push(line.trim());
    i++;
  }
  flushParagraph(paraBuf);

  return out.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Transform <NonCanonical>...</NonCanonical> wrappers into clearly-marked
// "Example" sections that the reader will style. Unlike the corpus path which
// STRIPS NonCanonical (defends SousAI hard floor rule 7), the display path
// KEEPS the content - a reviewer wants to see examples - and labels them.
// ─────────────────────────────────────────────────────────────────────────────
export function markNonCanonical(body) {
  let count = 0;
  const out = body.replace(/<NonCanonical>([\s\S]*?)<\/NonCanonical>/g, (_, inner) => {
    count++;
    return `\n> **EXAMPLE:** _The block below is illustrative content - not policy text._\n${inner.trim().split("\n").map((l) => "> " + l).join("\n")}\n`;
  });
  return { body: out, count };
}
