// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/embed.js
// SousAI · Layer 3 · OpenAI embeddings (raw fetch, no SDK)
// ─────────────────────────────────────────────────────────────────────────────
//
// Wraps the OpenAI embeddings endpoint with batching + dimension checks.
// Raw fetch instead of the OpenAI SDK because (a) this is the only SousAI
// code path that talks to OpenAI - the surface is small enough to roll
// directly, and (b) the existing AI SDK consolidation work hasn't picked
// a single client yet, so pulling in the OpenAI SDK now would create
// drift to undo later.
//
// Model: text-embedding-3-small, 1536 dims. Locked at L0 of the SousAI
// build because it matches the pgvector column type and is the cheapest
// OpenAI embedding model that ranks well on the MTEB retrieval benchmarks.
//
// Auth failures: 401 surfaces a clear "invalid API key" message so it's
// obvious the key in .env.local is wrong. 429 surfaces "rate limit or
// quota exceeded" - the most likely real-world cause is billing not being
// set up on the OpenAI project yet.
// ─────────────────────────────────────────────────────────────────────────────

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const MODEL = "text-embedding-3-small";
const EXPECTED_DIM = 1536;
// OpenAI accepts up to 2048 inputs per request; 100 keeps batches small
// enough to fail-and-resume without losing too much work, and well within
// the 8191-tokens-per-input limit even for our largest chunks.
const BATCH_SIZE = 100;

/**
 * Embed an ordered array of texts with text-embedding-3-small.
 *
 * @param {string[]} texts - inputs to embed. Order is preserved in the result.
 * @returns {Promise<number[][]>} array of 1536-dim float arrays, same length
 *   and order as `texts`.
 *
 * Throws if:
 *   - OPENAI_API_KEY is missing from process.env
 *   - any batch returns non-2xx (401, 429, 5xx all surface clearly)
 *   - the API returns the wrong number of embeddings for a batch
 *   - any returned embedding isn't a 1536-dim float array
 */
export async function embedTexts(texts) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "embed: OPENAI_API_KEY missing from environment (check .env.local)"
    );
  }
  if (!Array.isArray(texts) || texts.length === 0) {
    return [];
  }

  const embeddings = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: MODEL, input: batch }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "(no body)");
      // Trim the body a bit so the error message isn't enormous.
      const trimmed = body.length > 800 ? `${body.slice(0, 800)}...` : body;
      if (res.status === 401) {
        throw new Error(
          `OpenAI 401 (invalid OPENAI_API_KEY or revoked): ${trimmed}`
        );
      }
      if (res.status === 429) {
        throw new Error(
          `OpenAI 429 (rate limit, quota exceeded, or billing not set up): ${trimmed}`
        );
      }
      throw new Error(
        `OpenAI embeddings failed: ${res.status} ${res.statusText} - ${trimmed}`
      );
    }

    const data = await res.json();
    if (!data.data || data.data.length !== batch.length) {
      throw new Error(
        `OpenAI returned ${data.data?.length ?? 0} embeddings for ${batch.length} inputs (batch starting at index ${i})`
      );
    }
    // OpenAI guarantees response order matches input order via the `index` field;
    // sort by it just in case to be defensive.
    const sorted = [...data.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    for (const item of sorted) {
      if (!Array.isArray(item.embedding) || item.embedding.length !== EXPECTED_DIM) {
        throw new Error(
          `OpenAI returned wrong-dim embedding: expected ${EXPECTED_DIM}, got ${item.embedding?.length ?? "?"} at batch-index ${item.index}`
        );
      }
      embeddings.push(item.embedding);
    }
  }
  return embeddings;
}
