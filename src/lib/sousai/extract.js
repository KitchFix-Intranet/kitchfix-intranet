// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/extract.js
// SousAI · Layer 2 · Drive extraction (Google Docs API, service account)
// ─────────────────────────────────────────────────────────────────────────────
//
// Pulls a Google Doc's full content from Drive via the Docs API and returns
// it as a structured { title, sections } shape so the chunker can do
// section-aware splitting on real heading boundaries (HEADING_1 through
// HEADING_6 + TITLE), not just a flat text dump.
//
// Why Docs API and not Drive export to text/plain: text/plain export loses
// the heading hierarchy, which forces the chunker into size-based fallback
// even for well-structured docs. The Docs API returns the structured
// document tree (`body.content` with per-paragraph `paragraphStyle.named
// StyleType`), so we know exactly where the section boundaries are.
//
// Auth: service account via GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY
// (the existing pair `src/lib/sheets.js` already reads). Scope is read-only
// on Docs + Drive metadata. The service account needs Viewer access on the
// target Drive file - if it doesn't have it, the API throws a 403 with
// "The caller does not have permission" and the CLI runner surfaces the
// service account email so it can be granted via Drive's Share UI.
// ─────────────────────────────────────────────────────────────────────────────

import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];

function getJwtClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // GOOGLE_PRIVATE_KEY is stored single-line in .env with literal "\n"
  // sequences (the standard pattern). The JWT lib needs real newlines.
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error(
      "extract: missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY (check .env.local)"
    );
  }
  const privateKey = rawKey.replace(/\\n/g, "\n");
  return new google.auth.JWT({ email, key: privateKey, scopes: SCOPES });
}

/**
 * Extract a Google Doc and return its Drive-side title + ordered sections.
 *
 * @param {string} documentId - Drive file ID of a Google Doc
 * @returns {Promise<{ driveTitle: string, sections: Array<{ heading: string|null, level: number|null, ancestry: string[], text: string }> }>}
 *
 * NOTE on title: this returns `driveTitle` (the Docs API's title field, which
 * is usually the Drive filename and often filename-style like
 * "Allergen_Playbook_PB-002_v1_0"). Callers should override with the
 * canonical documents.title from the catalog for operator-facing citations;
 * the chunker takes docTitle as a required argument exactly to enforce this.
 *
 * Section semantics:
 *   - Each section corresponds to one heading-bounded body of text.
 *   - The first section before any heading (if there's preamble text) has
 *     heading = null, level = null, ancestry = [].
 *   - A heading paragraph becomes the boundary for the NEXT section. The
 *     heading text itself is held on the section's `heading` field, not
 *     repeated in its `text`.
 *   - level: 0 = TITLE, 1..6 = HEADING_1..HEADING_6, null = unsectioned.
 *   - ancestry: ordered list of heading text from outermost H1 down to the
 *     immediate parent. Empty array for top-level (H1) or unsectioned. TITLE
 *     is NOT tracked in ancestry (it's already in the doc-level docTitle the
 *     chunker prepends, so including it would duplicate).
 *     Example: an H3 "Step 4" inside H2 "6.1 The Six Steps" inside H1 "If
 *     Someone Has a Reaction" has ancestry = ["If Someone Has a Reaction",
 *     "6.1 The Six Steps"].
 *
 * Tables: cell text is walked recursively and accumulated into whichever
 * section is active at the time the table appears. Headings inside table
 * cells are rare in SOPs and are NOT treated as section breaks (they'd
 * create weird nested sections); table cells contribute body text only.
 */
export async function extractGoogleDoc(documentId) {
  const auth = getJwtClient();
  await auth.authorize();
  const docs = google.docs({ version: "v1", auth });
  const res = await docs.documents.get({ documentId });
  const doc = res.data || {};
  return {
    driveTitle: doc.title || "(untitled)",
    sections: parseSections(doc.body?.content || []),
  };
}

function parseSections(topLevelBlocks) {
  const sections = [];
  // Stack of currently-active HEADING_n ancestors as we walk the doc. Tracks
  // {heading, level} pairs. TITLE is NOT pushed here (see jsdoc). When we
  // encounter HEADING_N, pop entries with level >= N (they're closed by the
  // new heading), then the remaining stack IS the new section's ancestry.
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

  const paragraphText = (paragraph) =>
    (paragraph.elements || [])
      .map((el) => el.textRun?.content || "")
      .join("");

  const isHeadingStyle = (style) =>
    typeof style === "string" && (style === "TITLE" || style.startsWith("HEADING_"));

  // HEADING_N -> N, TITLE -> null (not tracked in ancestry).
  const headingStackLevel = (style) => {
    if (style?.startsWith("HEADING_")) return parseInt(style.replace("HEADING_", ""), 10);
    return null;
  };

  // Recursive walk: top-level blocks + table cell content. We only treat
  // heading paragraphs at the TOP level as section breaks; headings inside
  // table cells are body text (see jsdoc above).
  const walk = (blocks, insideTable = false) => {
    for (const block of blocks || []) {
      if (block.paragraph) {
        const style = block.paragraph.paragraphStyle?.namedStyleType || "NORMAL_TEXT";
        const text = paragraphText(block.paragraph);
        if (!text.trim()) {
          if (current.text && !current.text.endsWith("\n")) current.text += "\n";
          continue;
        }
        if (!insideTable && isHeadingStyle(style)) {
          flush();
          const trimmedHeading = text.trim();
          const stackLevel = headingStackLevel(style);
          if (stackLevel !== null) {
            // HEADING_N: close any deeper-or-equal ancestors, snapshot the
            // remaining stack as this section's ancestry, then push self.
            while (
              headingStack.length > 0 &&
              headingStack[headingStack.length - 1].level >= stackLevel
            ) {
              headingStack.pop();
            }
            const ancestry = headingStack.map((h) => h.heading);
            headingStack.push({ heading: trimmedHeading, level: stackLevel });
            current = {
              heading: trimmedHeading,
              level: stackLevel,
              ancestry,
              text: "",
            };
          } else {
            // TITLE: counts as a section break (so doc-level title text gets
            // its own section if it appears as a TITLE-styled paragraph), but
            // not tracked in ancestry. Existing stack is preserved through.
            current = {
              heading: trimmedHeading,
              level: 0,
              ancestry: headingStack.map((h) => h.heading),
              text: "",
            };
          }
        } else {
          // Normal text (or heading inside a table - treat as body).
          if (current.text && !current.text.endsWith("\n")) current.text += "\n";
          current.text += text;
        }
      } else if (block.table) {
        for (const row of block.table.tableRows || []) {
          for (const cell of row.tableCells || []) {
            walk(cell.content || [], true);
          }
        }
      }
      // Other block types (sectionBreak, tableOfContents) are ignored.
    }
  };

  walk(topLevelBlocks);
  flush();
  return sections;
}
