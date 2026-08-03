// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/receiptCheck.js
// Shared receipt-check core - the containment logic Tier 1 was built on,
// promoted to a runtime module so the agent loop can use the same checker
// the harness grades with. Kevin's architecture ruling 2026-08-04: after
// M1 dropped one run of the ship gate with a fabricated category-breakdown
// table under an amended prompt-line, the numeric-receipt rule stops
// being "checked in the harness after the fact" and becomes a loop-level
// reject-and-retry step. See agent.js's runtime backstop and the harness's
// Tier 1 grader - both consume `checkReceipts()` below.
// ─────────────────────────────────────────────────────────────────────────────

// Match a number-shape: comma-grouped, decimal, money, or 2+ digit integer,
// with optional trailing % and optional leading $. Single digits ("1", "0")
// are excluded on purpose - they collide with prose and ordinals.
export const NUMBER_RE = /\$?\d{1,3}(?:,\d{3})+(?:\.\d+)?|\$?\d+\.\d+|\$?\d{2,}(?:\.\d+)?%?/g;

// Strip decorators so "$244,954" and "244954" and "244,954" all normalize
// to the same key. 2026-08-04 fix: parse-and-back via Number() so trailing
// zeros collapse ("1269807.30" and "1269807.3" both become "1269807.3";
// "50.00" and "50" both become "50"). This bug ate an M1 pass in the
// architecture-ruling run - answer had "$1,269,807.30", payload had the
// same value as a JS number 1269807.3, and string-compare after strip-
// only left them unequal because of the trailing zero.
export function normalizeNumeric(raw) {
  const stripped = String(raw).replace(/[$,%]/g, "").trim();
  if (!stripped) return stripped;
  const asNum = Number(stripped);
  if (Number.isFinite(asNum)) return String(asNum);
  return stripped;
}

// ── Exemptions per Kevin's architecture ruling ──────────────────────────────
// Kevin: "figures the user supplied in their own question; ordinals and
// list positions; dates. Numbers inside quoted document text are content,
// not claims - same principle as the citation-surface rule."
// Each redactor replaces its target span with whitespace BEFORE extraction
// so the numeric regex never sees the exempted digits.

const MONTHS = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)";
const DATE_PATTERNS = [
  /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g,                                     // 2026-08-04
  /\b\d{4}[-/]\d{1,2}\b/g,                                                // 2026-08
  /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g,                                   // 08/04/2026
  new RegExp(`\\b${MONTHS}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, "gi"),  // Feb 15, 2026
  new RegExp(`\\b${MONTHS}\\.?\\s+\\d{4}\\b`, "gi"),                                     // February 2026
  /\b20\d{2}\b/g,                                                         // standalone years 2000..2099
];
function redactDates(text) {
  // 2026-08-04: replace with SAME-LENGTH whitespace so position offsets
  // stay aligned between the redacted "checkable" text and the original.
  // The token-level redactor below depends on this to place [unverified]
  // markers back into the original text at the right byte positions.
  let out = String(text || "");
  for (const p of DATE_PATTERNS) out = out.replace(p, (m) => " ".repeat(m.length));
  return out;
}

const ORDINAL_PATTERNS = [
  // "top 25", "first 5", "part 3", "step 2", "row 10", "#12", "number 4"
  /\b(?:top|bottom|first|last|next|previous|part|chapter|section|step|row|column|item|number|no\.?)\s+\d+\b/gi,
  /#\d+\b/g,
  // "1st", "2nd", "3rd", "42nd"
  /\b\d+(?:st|nd|rd|th)\b/gi,
];
function redactOrdinals(text) {
  let out = String(text || "");
  for (const p of ORDINAL_PATTERNS) out = out.replace(p, (m) => " ".repeat(m.length));
  return out;
}

// Numbers inside quoted document text are content, not claims. Blank out
// blockquote lines (leading `>`) and inline "..." / '...' spans.
// Length-preserving so downstream position math stays aligned.
function redactQuoted(text) {
  return String(text || "")
    .split("\n")
    .map((line) => /^\s*>/.test(line)
      ? " ".repeat(line.length)
      : line
          .replace(/"[^"]*"/g, (m) => " ".repeat(m.length))
          .replace(/'[^']*'/g, (m) => " ".repeat(m.length)))
    .join("\n");
}

// Apply all exemption redactors in order. Length preserved.
function maskExempt(text) {
  return redactQuoted(redactOrdinals(redactDates(text)));
}

// Extract answer numbers with exemptions applied.
export function extractAnswerNumbers(answerText) {
  const scanned = maskExempt(answerText);
  const found = new Set();
  for (const m of scanned.matchAll(NUMBER_RE)) {
    found.add(normalizeNumeric(m[0]));
  }
  return [...found];
}

// 2026-08-04 (architecture ruling): token-level redaction. When the
// runtime numeric-receipt backstop has retried and STILL sees misses,
// mechanically replace each offending number token in the answer with
// `[unverified]` before ship. Kevin's spec: "token-level replacement
// only - no sentence extractor, no model call". Exemptions unchanged -
// numbers in dates, ordinals, quoted content are never redacted because
// their spans are masked to whitespace before the number-scan runs
// (so their positions can never match a miss token).
//
// Because maskExempt now preserves length, the number-token positions
// found in maskedText line up 1:1 with the same positions in the
// original text. We iterate matches, check normalized value against
// the miss set, and splice `[unverified]` into the original at the
// same [start, end).
export function redactMissingFigures(text, misses) {
  if (!text || !Array.isArray(misses) || misses.length === 0) return text;
  const missSet = new Set(misses.map((m) => normalizeNumeric(m)));
  const masked = maskExempt(text);
  const spans = [];   // [start, end) ranges to redact, non-exempt only
  for (const m of masked.matchAll(NUMBER_RE)) {
    const norm = normalizeNumeric(m[0]);
    if (missSet.has(norm)) {
      spans.push([m.index, m.index + m[0].length]);
    }
  }
  if (spans.length === 0) return text;
  // Splice in reverse so earlier indices stay valid.
  let out = text;
  for (const [start, end] of spans.reverse()) {
    out = out.slice(0, start) + "[unverified]" + out.slice(end);
  }
  return out;
}

// Extract WITHOUT exemptions - used for question-side lift (the user's
// figures are exempt regardless of shape).
export function extractRawNumbers(text) {
  const found = new Set();
  for (const m of String(text || "").matchAll(NUMBER_RE)) {
    found.add(normalizeNumeric(m[0]));
  }
  return [...found];
}

// Walk the trajectory's rawResult values and collect every number-shape.
// The LIVE trajectory carries rawResult; the stored trajectory has it
// stripped (see src/app/api/sousai/log.js). The runtime backstop reads
// the live trajectory; the harness reads the returned result's trajectory
// which also carries rawResult (runSousAgent doesn't strip before return).
export function extractPayloadNumbers(trajectory) {
  const found = new Set();
  const walk = (v) => {
    if (v == null) return;
    if (typeof v === "number") { found.add(normalizeNumeric(v)); return; }
    if (typeof v === "string") {
      for (const m of v.matchAll(NUMBER_RE)) {
        found.add(normalizeNumeric(m[0]));
      }
      return;
    }
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (typeof v === "object") { for (const x of Object.values(v)) walk(x); }
  };
  for (const step of trajectory || []) {
    if (step && step.rawResult != null) walk(step.rawResult);
  }
  return found;
}

// The core check. Given the model's answer text, this turn's trajectory,
// and (optionally) the user's question, return { pass, missing, grounded,
// answerNumbers, payloadCount }. Missing = numbers in the answer that do
// NOT trace to the payload AND were not supplied by the user in the
// question. Grounded = numbers that traced (or were user-supplied).
export function checkReceipts(answerText, trajectory, { question = "" } = {}) {
  const answerNums = extractAnswerNumbers(answerText);
  if (answerNums.length === 0) {
    return { pass: true, missing: [], grounded: [], answerNumbers: [], payloadCount: 0 };
  }
  const payloadNums = extractPayloadNumbers(trajectory);
  const payloadArr = [...payloadNums];
  const questionNums = new Set(extractRawNumbers(question));
  const missing = [];
  const grounded = [];
  for (const n of answerNums) {
    const bare = n.replace(/,/g, "");
    // User-supplied exemption: figures the user put in the question are
    // never fabrications - the user gave them to the model.
    if (questionNums.has(n) || questionNums.has(bare)) {
      grounded.push(n);
      continue;
    }
    // Direct or comma-stripped hit; or integer-prefix hit for money-
    // rounding ("244954" matches payload "244954.05"). Same rule the
    // harness has used since PR B.
    const hit = payloadNums.has(n) || payloadNums.has(bare) ||
      payloadArr.some((p) => p === bare || p.startsWith(bare + "."));
    if (hit) grounded.push(n);
    else missing.push(n);
  }
  return {
    pass: missing.length === 0,
    missing,
    grounded,
    answerNumbers: answerNums,
    payloadCount: payloadNums.size,
  };
}

// Does any step in the trajectory represent a successful data-tool call?
// The agent uses this to gate the runtime backstop - non-data-tool
// answers (pure document lookups, declines) do not carry numeric receipt
// claims and would be false-flagged. Takes `getTool` so this module has
// no direct registry dependency.
export function hasSuccessfulDataCall(trajectory, getTool) {
  if (!Array.isArray(trajectory)) return false;
  return trajectory.some((step) => {
    if (!step || !step.tool || step.tool_error) return false;
    const t = getTool(step.tool);
    if (!t || t.kind !== "data") return false;
    const r = step.rawResult;
    if (!r || r.error) return false;
    return true;
  });
}
