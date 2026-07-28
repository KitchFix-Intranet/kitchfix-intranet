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
// SSE `token` write. It watches for the sentinel `[[STATUS`. When it appears
// in the stream, everything before it is forwarded; the sentinel itself and
// all subsequent deltas are dropped. This also handles the optional
// `[[REASON: ...]]` line since REASON only ever precedes STATUS.
//
// The tricky case is a sentinel split across multiple deltas. The helper
// maintains a small pending buffer of at most `SENTINEL.length - 1` chars
// (the longest suffix of the concatenated stream that could still turn into
// the sentinel). On each delta, the helper appends, decides how much to
// forward, and returns the remaining suffix.
//
// End of stream: if any pending chars are still held back, flush them -
// they never became the sentinel and are real prose.
//
// State shape: { pending: string, suppressed: boolean }
// Sentinel: literal string `[[STATUS`
// ═══════════════════════════════════════════════════════════════════════════

export const SENTINEL = "[[STATUS";

export function initFooterState() {
  return { pending: "", suppressed: false };
}

// advance(state, delta) -> { forward, next, hit }
//   forward - the text to send onto the SSE wire (may be "")
//   next    - the new state to keep for the next delta
//   hit     - true iff the sentinel was found and suppression flipped on in
//             this call. false otherwise. (Useful for the route to log or
//             assert; not required for correctness.)
export function advance(state, delta) {
  // Already suppressed: everything downstream is dropped.
  if (state.suppressed) {
    return { forward: "", next: state, hit: false };
  }
  if (typeof delta !== "string" || delta.length === 0) {
    return { forward: "", next: state, hit: false };
  }

  const combined = state.pending + delta;
  const sentinelIdx = combined.indexOf(SENTINEL);

  if (sentinelIdx !== -1) {
    // Sentinel appeared. Everything before it is legit prose.
    const forward = combined.slice(0, sentinelIdx);
    return {
      forward,
      next: { pending: "", suppressed: true },
      hit: true,
    };
  }

  // No full sentinel yet. Hold back the longest suffix of `combined` that
  // is a prefix of SENTINEL - that suffix could still become the sentinel
  // on a later delta. Everything before that suffix is safe to forward.
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
//   Called on stream end. If pending chars never completed the sentinel,
//   they were prose after all - return them so the route can send them.
export function flush(state) {
  if (state.suppressed) return "";
  return state.pending || "";
}

// Longest k such that combined.slice(-k) === SENTINEL.slice(0, k), for k
// in [0, SENTINEL.length - 1]. Range excludes the full sentinel length
// because that case is handled separately (full-sentinel appearance is
// caught by indexOf above).
function longestSentinelPrefixSuffix(combined) {
  const maxK = Math.min(SENTINEL.length - 1, combined.length);
  for (let k = maxK; k > 0; k -= 1) {
    if (combined.slice(-k) === SENTINEL.slice(0, k)) return k;
  }
  return 0;
}
