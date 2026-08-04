// src/lib/rippling.js
//
// Rippling REST helper for the raw ingest pipeline (PR 8a).
//
// Responsibilities:
//   - fetchPage(url):        one HTTP GET with auth + version + retry
//   - firstPageUrl(path):    build the starting URL with limit
//   - contentHash(obj, kind): stable SHA-256 across re-fetches for hash-
//                            dedup. Volatile-field set differs per kind.
//   - redactForPrint(obj):   strip signed URLs + PII for safe logging.
//
// Discovery findings (2026-08-04) baked into this file:
//   - Pagination cursor lives at `body.next_link`, not `next_cursor`
//     or `pagination.next`. Absent -> walk is done.
//   - Rows live at body.results / body.data / body.records (varies by
//     endpoint) - extractRows() normalizes.
//   - The API silently ignores date, worker_id, and sort filters on
//     /time-entries and /custom-objects/*/records. Only `limit` and
//     `cursor` are honored. Full walk mandatory.
//   - Measured mean latency: 8.08s/page across ~200 pages on
//     /time-entries. Pay segments similar shape, faster (~1.5s/page).
//   - Nested objects carry `display_value` (denormalized name),
//     `has_perm` (session-dependent), and `image` (signed URL with
//     Expires + Signature querystring). All three must be excluded
//     from the content hash or every re-fetch looks like a change.

import { createHash } from "node:crypto";

export const BASE = "https://rest.ripplingapis.com";
export const API_VERSION = "2024-08-01";

// Recursively-stripped fields on nested objects. `display_value` is a
// denormalized name; `has_perm` is a session-dependent permission flag;
// `image` is a signed URL whose querystring expires. Any of them
// changing without the underlying record changing would poison the
// hash.
const NESTED_STRIP_KEYS = new Set(["display_value", "has_perm", "image"]);

// Top-level volatile fields per object kind. Kept per-kind because
// `worker` on a time_entry is a big denormalized blob that changes
// with the worker's own edits; a pay_segment has no equivalent
// denormalized block and its `owner_role.id` is load-bearing (used
// to filter STL-MO in the verify script).
const HASH_EXCLUDE_TOP = {
  time_entries: ["updated_at", "worker", "time_card", "time_entry_summary", "__meta"],
  pay_segments: ["updated_at", "__meta"],
};

// ─── Fetch ───────────────────────────────────────────────────────────

function _headers(apiKey) {
  return {
    "Authorization": "Bearer " + apiKey,
    "X-Rippling-Api-Version": API_VERSION,
    "Accept": "application/json",
    "User-Agent": "kitchfix-intranet/rippling-sync",
  };
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Fetch one page with retry on 429/5xx. Honors Retry-After when
// present; otherwise exponential backoff (1s, 2s, 4s, 8s, 16s). Fails
// fast on other 4xx.
export async function fetchPage(url, apiKey, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 6;
  const baseBackoffMs = opts.baseBackoffMs ?? 1000;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let r;
    try {
      r = await fetch(url, { headers: _headers(apiKey) });
    } catch (err) {
      // Network-level failure (DNS, connection reset). Retry.
      lastErr = err;
      const wait = baseBackoffMs * Math.pow(2, attempt - 1);
      await _sleep(wait);
      continue;
    }
    if (r.ok) {
      const text = await r.text();
      let body;
      try { body = JSON.parse(text); } catch { body = null; }
      if (body == null) return { ok: false, status: r.status, body: null, error: "non-json response", raw: text.slice(0, 500) };
      return { ok: true, status: r.status, body };
    }
    // 429 / 5xx retry, other 4xx fail fast
    if (r.status !== 429 && r.status < 500) {
      const text = await r.text();
      return { ok: false, status: r.status, body: null, error: "client error", raw: text.slice(0, 500) };
    }
    const retryAfter = r.headers.get("retry-after");
    const wait = retryAfter ? Math.max(1000, Number(retryAfter) * 1000) : baseBackoffMs * Math.pow(2, attempt - 1);
    lastErr = new Error(`status ${r.status}`);
    await _sleep(wait);
  }
  return { ok: false, status: 0, body: null, error: lastErr?.message || "max attempts exhausted", raw: null };
}

// Normalize the row array location across endpoint shapes.
export function extractRows(body) {
  if (Array.isArray(body?.results)) return body.results;
  if (Array.isArray(body?.data))    return body.data;
  if (Array.isArray(body?.records)) return body.records;
  if (Array.isArray(body))          return body;
  return [];
}

// Build the starting URL for a full walk.
export function firstPageUrl(path, limit = 100) {
  const p = path.replace(/^\//, "");
  const url = BASE + "/" + p;
  if (url.includes("?")) {
    if (/[?&]limit=/.test(url)) return url;
    return url + "&limit=" + limit;
  }
  return url + "?limit=" + limit;
}

// ─── Content hash ────────────────────────────────────────────────────

function _normalizeForHash(node, topExcludeSet) {
  if (node == null) return node;
  if (Array.isArray(node)) return node.map(v => _normalizeForHash(v, null));
  if (typeof node !== "object") return node;
  const out = {};
  const keys = Object.keys(node).sort();
  for (const k of keys) {
    // Top-level exclusion only applies at the outermost call. Passing
    // null after that switches off top-level logic; nested-strip still
    // runs at every depth.
    if (topExcludeSet && topExcludeSet.has(k)) continue;
    if (NESTED_STRIP_KEYS.has(k)) continue;
    out[k] = _normalizeForHash(node[k], null);
  }
  return out;
}

// SHA-256 hex of a canonical projection of the record. `kind` selects
// the top-level exclusion list (see HASH_EXCLUDE_TOP above). Different
// kinds shed different volatile fields; sharing the function while
// per-kind-configuring the exclude list keeps hash semantics honest.
export function contentHash(payload, kind) {
  const topExclude = HASH_EXCLUDE_TOP[kind];
  if (!topExclude) throw new Error("contentHash: unknown kind '" + kind + "', expected one of: " + Object.keys(HASH_EXCLUDE_TOP).join(", "));
  const normalized = _normalizeForHash(payload, new Set(topExclude));
  const canonical = JSON.stringify(normalized);
  return createHash("sha256").update(canonical).digest("hex");
}

// ─── Redact for print ────────────────────────────────────────────────

const PII_KEYS = new Set([
  "ssn", "tax_id", "personal_email", "date_of_birth", "personal_phone",
  "address", "home_address", "bank_account", "routing_number",
  "citizenship", "race", "ethnicity", "gender",
]);

// Return a shallow-cloned projection safe to print. Keeps names +
// worker IDs (needed for debuggability), strips: signed image URLs,
// PII fields, tokens. Never mutates input.
export function redactForPrint(payload) {
  return _redact(payload);
}

function _redact(node) {
  if (node == null) return node;
  if (Array.isArray(node)) return node.map(_redact);
  if (typeof node !== "object") return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (PII_KEYS.has(k)) { out[k] = "[REDACTED_PII]"; continue; }
    if (k === "image" && typeof v === "string") { out[k] = "[REDACTED_SIGNED_URL]"; continue; }
    if (k === "Authorization" || k === "authorization") { out[k] = "[REDACTED_AUTH]"; continue; }
    out[k] = _redact(v);
  }
  return out;
}
