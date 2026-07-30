// ═══════════════════════════════════════════════════════════════════════════
// /api/sousai · suppressFooter.js · trailing-sentinel suppression
// ═══════════════════════════════════════════════════════════════════════════
//
// Pure helper for the live text-delta forwarder in route.js. Delta streaming
// (#541) broke the pre-delta assumption that the route chunked
// `result.answer` at settle - answer text was already stripped by
// parseAnswer() before chunking, so the machine footer `[[STATUS: ...]]`
// never reached the wire. Under live streaming the deltas reach the route
// BEFORE settle, and the agent has not yet stripped anything - so the model
// writes the footer and it leaks to the client.
//
// This helper sits between the agent's text-delta emit and the route's
// SSE `token` write. It watches for TWO sentinels - `[[REASON` and
// `[[STATUS` - and suppresses everything from the FIRST one that appears.
// Under a decline, the prompt (agentPrompt.js) instructs REASON first, then
// STATUS - so a single-sentinel watch on `[[STATUS` alone was inverted; it
// let the whole `[[REASON: <cause>]]` line leak to the client on every
// decline. Fixed 2026-07-29 (Phase F PR 2).
//
// The tricky case is a sentinel split across multiple deltas. The helper
// maintains a small pending buffer of at most (max-sentinel-length - 1) chars
// (the longest suffix of the concatenated stream that could still turn into
// EITHER sentinel). On each delta, the helper appends, decides how much to
// forward, and returns the remaining suffix.
//
// End of stream: if any pending chars are still held back, flush them -
// they never became either sentinel and are real prose.
//
// State shape: { pending: string, suppressed: boolean }
// Sentinels (module-visible for tests): `[[REASON`, `[[STATUS`
// ═══════════════════════════════════════════════════════════════════════════

export const SENTINELS = ["[[REASON", "[[STATUS"];
// Kept as an alias for callers/tests that reference the singular; both are
// watched now and either flips suppression.
export const SENTINEL = "[[STATUS";

const MAX_SENTINEL_LEN = Math.max(...SENTINELS.map((s) => s.length));

export function initFooterState() {
  return { pending: "", suppressed: false };
}

// advance(state, delta) -> { forward, next, hit }
//   forward - the text to send onto the SSE wire (may be "")
//   next    - the new state to keep for the next delta
//   hit     - true iff a sentinel was found and suppression flipped on in
//             this call. false otherwise.
export function advance(state, delta) {
  // Already suppressed: everything downstream is dropped.
  if (state.suppressed) {
    return { forward: "", next: state, hit: false };
  }
  if (typeof delta !== "string" || delta.length === 0) {
    return { forward: "", next: state, hit: false };
  }

  const combined = state.pending + delta;

  // Find the earliest occurrence of ANY sentinel. Whichever comes first
  // triggers suppression - REASON is emitted before STATUS on declines, so
  // watching STATUS alone would let REASON leak.
  let sentinelIdx = -1;
  for (const s of SENTINELS) {
    const idx = combined.indexOf(s);
    if (idx !== -1 && (sentinelIdx === -1 || idx < sentinelIdx)) {
      sentinelIdx = idx;
    }
  }

  if (sentinelIdx !== -1) {
    const forward = combined.slice(0, sentinelIdx);
    return {
      forward,
      next: { pending: "", suppressed: true },
      hit: true,
    };
  }

  // No full sentinel yet. Hold back the longest suffix of `combined` that
  // is a prefix of ANY sentinel - that suffix could still become one on a
  // later delta. Everything before it is safe to forward.
  const holdLen = longestSentinelPrefixSuffix(combined);
  const forward = combined.slice(0, combined.length - holdLen);
  const pending = combined.slice(combined.length - holdLen);
  return {
    forward,
    next: { pending, suppressed: false },
    hit: false,
  };
}

// flush(state) -> string
//   Called on stream end. If pending chars never completed a sentinel,
//   they were prose after all - return them so the route can send them.
export function flush(state) {
  if (state.suppressed) return "";
  return state.pending || "";
}

// Longest k such that combined.slice(-k) === some_sentinel.slice(0, k), for k
// in [1, MAX_SENTINEL_LEN - 1]. Range excludes full sentinel length because
// full-sentinel appearance is caught by indexOf above.
function longestSentinelPrefixSuffix(combined) {
  const maxK = Math.min(MAX_SENTINEL_LEN - 1, combined.length);
  for (let k = maxK; k > 0; k -= 1) {
    const suffix = combined.slice(-k);
    for (const s of SENTINELS) {
      if (k <= s.length && suffix === s.slice(0, k)) return k;
    }
  }
  return 0;
}
