// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/selfCheck.js
// SousAI · L12 final self-check pass (round 0b, 2026-08-04)
// ─────────────────────────────────────────────────────────────────────────────
//
// A mechanical last pass before an answer ships. No additional model call.
// Runs after the runtime backstops (zero-tool citation retry, numeric-receipt
// retry) have settled but BEFORE the answer is written to log or streamed as
// the final envelope. Callers: agent.js, immediately before return.
//
// Fence (Kevin's spec):
//   - May ONLY remove or flag. Must NEVER rewrite content. Must NEVER strip
//     inside quoted document text (blockquote lines and "..." / '...' spans).
//   - Strip counters are exposed so the digest can count backstop firings
//     vs. residual escapes.
//
// Strip families (Part 4):
//   1. Agreement openers (from the retry-integrity spec, Part 1.2):
//      "you're right", "you are right", "good catch", "great question",
//      "apologies", "sorry" - case-insensitive, first sentence only.
//   2. Self-narration openers: "let me pull", "let me check", "let me look".
//   3. Internal-identifier leaks: reuse the shared no-plumbing list. Body
//      hits get stripped. Source-line hits get REPLACED with the human
//      source label from the tool envelope (see mapToolNameToHuman below).
//   4. Clock times in prose: "12:34 PM", "3:00 AM UTC" - freshness is
//      "PG live" plus a date only.
//
// Multi-part completeness (Part 5):
//   Detect multi-part questions (conjunctions joining interrogatives,
//   enumerations, "and who/what/when"). For each detected sub-question,
//   check the answer for at least one topical anchor or a role marker
//   (for "who" parts). If any part looks unaddressed, return an
//   `incomplete_multipart: {parts: [<unaddressed sub-question>]}` flag.
//   Conservative on purpose: biases toward false negatives so a real
//   answer isn't misgraded as partial.
// ─────────────────────────────────────────────────────────────────────────────

import {
  INTERNAL_IDENTIFIERS_BODY_ONLY,
  INTERNAL_IDENTIFIERS_ALWAYS,
  SOURCE_LINE_RE,
} from "./internalIdentifiers.js";

// ── Length-preserving quoted-content mask ─────────────────────────────────
// We may strip agreement openers, plumbing, clock times, etc., but we must
// never touch text inside blockquotes (leading `>`) or inline quotes.
// The strippers below all call this mask first to compute a "safe zone"
// and only remove ranges whose original position lies OUTSIDE quoted spans.

function isInsideQuoted(line, index) {
  // Blockquote line - the whole line is quoted content.
  if (/^\s*>/.test(line)) return true;
  // Inline quotes: walk the line and count quote toggles up to index.
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < index; i++) {
    const c = line[i];
    if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "'" && !inDouble) inSingle = !inSingle;
  }
  return inDouble || inSingle;
}

// ── Strip families ────────────────────────────────────────────────────────

const AGREEMENT_OPENERS = [
  /^\s*you['’]re\s+right[.,!:;\s-]*/i,
  /^\s*you\s+are\s+right[.,!:;\s-]*/i,
  /^\s*good\s+catch[.,!:;\s-]*/i,
  /^\s*great\s+question[.,!:;\s-]*/i,
  /^\s*apologies[.,!:;\s-]*/i,
  /^\s*sorry[.,!:;\s-]*/i,
];

const SELF_NARRATION_OPENERS = [
  /^\s*let\s+me\s+pull[^.]*[.!]?\s*/i,
  /^\s*let\s+me\s+check[^.]*[.!]?\s*/i,
  /^\s*let\s+me\s+look[^.]*[.!]?\s*/i,
];

// Strip openers in the FIRST SENTENCE only. Iterate the first-sentence
// candidates and remove any match. Returns {text, strips}.
function stripLeadingOpeners(text) {
  const strips = { agreement: 0, self_narration: 0 };
  if (!text) return { text, strips };
  let out = text;
  // Try repeatedly (multiple openers can chain: "Sorry, you're right ...").
  // Cap iterations to avoid pathological loops.
  for (let i = 0; i < 4; i++) {
    let fired = false;
    for (const re of AGREEMENT_OPENERS) {
      const m = out.match(re);
      if (m && m.index === 0) {
        out = out.slice(m[0].length);
        strips.agreement += 1;
        fired = true;
        break;
      }
    }
    for (const re of SELF_NARRATION_OPENERS) {
      const m = out.match(re);
      if (m && m.index === 0) {
        out = out.slice(m[0].length);
        strips.self_narration += 1;
        fired = true;
        break;
      }
    }
    if (!fired) break;
  }
  return { text: out, strips };
}

// Clock-time pattern. "12:34 PM", "3:00 AM UTC", "15:00", "9:15am".
// Requires the colon-separated H:MM shape to avoid gobbling ratios or
// digit-sequence-with-colon patterns.
const CLOCK_RE = /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:am|pm|AM|PM))?(?:\s+[A-Z]{2,4})?\b/g;

function stripClockTimes(text) {
  if (!text) return { text, strips: 0 };
  let count = 0;
  const lines = text.split("\n");
  const outLines = lines.map((line) => {
    return line.replace(CLOCK_RE, (m, offset) => {
      if (isInsideQuoted(line, offset)) return m;
      count += 1;
      return "";
    });
  });
  return { text: outLines.join("\n"), strips: count };
}

// Map a tool name to its human source label. Used when the plumbing strip
// fires on a Source line - we replace the tool identifier with the sanctioned
// human label rather than leaving a hole in the citation. Kept conservative:
// if we can't confidently map, the plumbing name stays (grader will flag it)
// and we return the original token so the reader still has some string.
function mapToolNameToHuman(name) {
  switch (name) {
    case "sc_account_window":
    case "sc_portfolio_window":
    case "sc_homestand_detail":
    case "sc_service_price":
    case "sc_orientation":
      return "SC tools";
    case "spend_summary":
    case "spend_vendor_history":
    case "spend_top_vendors":
      return "spend tools";
    case "find_contact":
    case "list_accounts":
    case "list_contacts_by_role":
    case "get_account_team":
      return "leadership directory";
    case "search_documents":
    case "get_document":
    case "list_documents":
      return null;   // Doc answers should cite doc ids, not a generic label.
    default:
      return null;
  }
}

// Strip / rewrite internal identifiers. Body hits: mechanical strip.
// Source-line hits (tool names only - ALWAYS list is never sanctioned):
// replace with the mapped human label when we have one. Returns count.
function stripPlumbing(text) {
  if (!text) return { text, strips: 0 };
  let count = 0;
  const lines = text.split("\n");
  const outLines = lines.map((line) => {
    const isSource = SOURCE_LINE_RE.test(line);
    let out = line;
    // ALWAYS list - never sanctioned anywhere.
    for (const id of INTERNAL_IDENTIFIERS_ALWAYS) {
      if (out.includes(id)) {
        // Rewrite in a length-preserving way for position independence.
        while (out.includes(id)) {
          const idx = out.indexOf(id);
          if (isInsideQuoted(out, idx)) break;
          out = out.slice(0, idx) + out.slice(idx + id.length);
          count += 1;
        }
      }
    }
    // BODY_ONLY list - tool names. Sanctioned on Source line; stripped in body.
    for (const id of INTERNAL_IDENTIFIERS_BODY_ONLY) {
      if (out.includes(id)) {
        if (isSource) {
          const human = mapToolNameToHuman(id);
          if (human) {
            const before = out;
            out = out.split(id).join(human);
            if (out !== before) count += 1;
          }
          // If no human label, leave the tool name (harness grader still
          // catches this class - we don't want to silently break citations).
        } else {
          while (out.includes(id)) {
            const idx = out.indexOf(id);
            if (isInsideQuoted(out, idx)) break;
            out = out.slice(0, idx) + out.slice(idx + id.length);
            count += 1;
          }
        }
      }
    }
    return out;
  });
  return { text: outLines.join("\n"), strips: count };
}

// ── Multi-part detection (Part 5, L7) ─────────────────────────────────────

const WH_WORDS = ["who", "whose", "whom", "what", "when", "where", "why", "how", "which"];
const WH_ANY_RE = new RegExp(`\\b(?:${WH_WORDS.join("|")})\\b`, "i");
const AND_WH_RE = new RegExp(`\\band\\s+(?:${WH_WORDS.join("|")})\\b`, "i");

// Simple stop-word list for content-word overlap. Kept aggressively broad
// so common prepositions / discourse markers don't false-positive as an
// "addressed" signal - the live 2026-08-04 multi-part case tripped on
// "about" matching "asking about a different month", giving the model
// credit for addressing "who to contact" via a preposition.
const STOP_WORDS = new Set([
  "the","a","an","of","for","to","and","or","but","in","on","at","by","with","from",
  "is","are","was","were","be","been","being","do","does","did","have","has","had",
  "will","would","should","could","can","may","might","must",
  "i","you","he","she","it","we","they","me","him","her","us","them",
  "my","your","his","its","our","their","this","that","these","those",
  "so","if","then","than","as","not","no","yes","up","down","out","over","under",
  "each","any","all","some","one","two","most",
  // Common prepositions and discourse markers dropped so they don't
  // count as overlap evidence. Deliberately narrow - only words with
  // little semantic weight in the ops domain. Words like "behind",
  // "against", "before", "after" are load-bearing status/temporal
  // markers here and stay content-words.
  "about","into","onto","upon","among","between","through","around",
  "along","beside","near",
  ...WH_WORDS,
]);

function contentWords(s) {
  return String(s || "").toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

// Split a question into sub-questions on:
//   - "?" boundaries (compound questions)
//   - ", and <wh>" / " and <wh>" boundaries
function extractParts(question) {
  const q = String(question || "").trim();
  if (!q) return [];
  // Split on `?` OR (`, and <wh>` | ` and <wh>`), keeping the wh-word with
  // its sub-question so downstream can classify by wh-type.
  const withMarkers = q.replace(/,?\s+and\s+(who|whose|whom|what|when|where|why|how|which)\b/gi, "|||$1");
  const chunks = withMarkers.split(/\?|\|\|\|/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  return chunks;
}

// A "who" sub-question is answered if the answer contains a role marker,
// a contact-shaped verb, or a proper-noun-shaped token.
const ROLE_MARKERS_RE = /\b(?:rdo|regional\s+director|ec\b|executive\s+chef|sous\s+chef|hospitality\s+manager|director|manager|dietitian|counsel|slt|kevin|josh|joe|britt|mariela|sebastian|hr|accounting|chef)\b/i;
const CONTACT_VERBS_RE = /\b(?:call|contact|reach|email|ping|text|ask|talk|check\s+with|route\s+to)\b/i;

function partAddressedByAnswer(part, answer) {
  const partWh = (part.match(WH_ANY_RE) || [""])[0].toLowerCase();
  const words = contentWords(part);
  const lowerAnswer = String(answer || "").toLowerCase();
  // "who"-family: REQUIRE role-marker OR contact-verb evidence. Term
  // overlap is too loose here - a "who to contact" sub-question has few
  // content words ("contact", "each") that either don't appear in a
  // legitimate routing answer or false-positive on a preposition. Live
  // 2026-08-04 case: "who should I contact about each" tripped as
  // "addressed" because "about" was in the answer. Strict path only.
  if (partWh === "who" || partWh === "whose" || partWh === "whom") {
    return ROLE_MARKERS_RE.test(answer) || CONTACT_VERBS_RE.test(answer);
  }
  // Other wh-classes: term overlap on filtered content words. At least
  // one word from the sub-question must appear substantively in the
  // answer body.
  for (const w of words) {
    if (lowerAnswer.includes(w)) return true;
  }
  // Empty-content edge: no content words to check - assume addressed (bias
  // toward false negatives per fence).
  return words.length === 0;
}

/**
 * Detect + evaluate a multi-part question. Returns:
 *   { isMultiPart, parts, unaddressed }
 * unaddressed is a list of sub-question strings that no overlap was found for.
 * When isMultiPart is false, unaddressed is always empty.
 */
export function checkMultiPart(question, answer) {
  const q = String(question || "");
  const hasAndWh = AND_WH_RE.test(q);
  const questionMarks = (q.match(/\?/g) || []).length;
  const parts = extractParts(q);
  // Multi-part signal: `and <wh>` conjunction OR ≥2 sub-questions.
  const isMultiPart = hasAndWh || questionMarks >= 2 || parts.length >= 2;
  if (!isMultiPart) return { isMultiPart: false, parts: [], unaddressed: [] };
  // Only keep parts that carry a wh-word - a leading part without one is
  // usually context ("in February, which accounts...").
  const whParts = parts.filter((p) => WH_ANY_RE.test(p));
  const targetParts = whParts.length >= 2 ? whParts : parts;
  const unaddressed = targetParts.filter((p) => !partAddressedByAnswer(p, answer));
  return { isMultiPart: true, parts: targetParts, unaddressed };
}

// ── Public entry: run every strip family + multi-part check in order ──────

/**
 * Apply the L12 self-check pass. Returns:
 *   { answer, strips, unaddressedParts }
 * Where:
 *   - answer: text with strips applied (never rewritten, only removed or
 *     Source-line plumbing replaced with human labels).
 *   - strips: { agreement, self_narration, plumbing, clock } - integers.
 *   - unaddressedParts: array of sub-question strings for which no evidence
 *     of an answer was found; empty when question is single-part or fully
 *     addressed. Caller uses this to flag `incomplete_multipart` and set
 *     the reason chip.
 */
export function applySelfCheck(answer, { question = "" } = {}) {
  const initial = { text: String(answer || ""), strips: {} };
  const opener = stripLeadingOpeners(initial.text);
  const plumbing = stripPlumbing(opener.text);
  const clock = stripClockTimes(plumbing.text);
  const finalText = clock.text;
  const multi = checkMultiPart(question, finalText);
  return {
    answer: finalText,
    strips: {
      agreement: opener.strips.agreement,
      self_narration: opener.strips.self_narration,
      plumbing: plumbing.strips,
      clock: clock.strips,
    },
    unaddressedParts: multi.unaddressed,
    multiPart: multi.isMultiPart,
  };
}
