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
//     /time-entries AND on /custom-objects/*/records. INV-P14
//     (2026-08-25) claimed updated_at_gte was honoured on
//     spend_transaction_line_item_zo; direct re-measurement on the
//     same day (see kf-rippling-walk/scripts/probes/_probe_filter_*.mjs)
//     showed the endpoint returns identical first-page rows for a
//     far-future filter value, a 1-day-ago value, and no filter,
//     across ten parameter-name shapes (updated_at_gte,
//     updated_at__gte, updated_at[gte], updated_at.gte,
//     filter[updated_at][gte], mongo_updated_at_gte,
//     system_updated_at_gte, and three others). INV-P14 does not
//     reproduce. The filter is silently ignored.
//     Additionally: updated_at itself on this endpoint was bulk-
//     rewritten across every line item on 2026-08-07, so a delta
//     filter on it could not catch edits to old transactions even
//     if the filter were honoured.
//     When adding an incremental walk on a new custom-object
//     endpoint, always compare the filtered row count against an
//     unfiltered probe BEFORE relying on the filter - a filter that
//     is silently ignored returns everything and looks like it
//     worked.
//   - `cursor` on custom-objects is the SERVER-EMITTED `next_link`,
//     not a caller-constructed id. INV-P14 tried `cursor=<uuid>`
//     manually and got HTTP 500 - Rippling's cursors are signed and
//     the format is opaque to us.
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

// Full ISO-8601 datetime with an EXPLICIT offset (either `Z` or
// `+HH:MM` / `-HH:MM`). The regex is deliberately strict:
//   - a date-only "2026-11-03" has no `T` -> no match -> pass through
//   - "17:25:00" with no offset is ambiguous local time -> no match
//   - a duration "P1D" / numeric id / free text has no T + no offset -> no match
// A match is safe to canonicalize because the string unambiguously
// denotes an instant.
const ISO_DT_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

// Canonicalize ISO-8601 datetime strings carrying an explicit offset
// to the single UTC form `toISOString()` emits
// (`YYYY-MM-DDTHH:mm:ss.sssZ`). Non-string values and strings that do
// not match the strict ISO pattern pass through byte-identical.
//
// Why this exists (2026-11-02 time_entries measurement):
//   Rippling serializes the SAME INSTANT in two offset shapes between
//   calls on `segments[].start_time` / `.end_time`:
//     "2025-11-03T17:25:00+00:00"  <-> "2025-11-03T12:25:00-05:00"
//   Both are the same wall-clock instant. The JSON string differs,
//   the SHA-256 differs, and a new row lands even though nothing
//   substantive changed. 10,766 of 11,773 adjacent-version pairs
//   on rippling_raw_time_entries are this pattern (~97% noise).
//
// Why canonicalize at the hash input, not in the stored payload:
//   The stored payload must stay byte-identical to what Rippling
//   sent so downstream consumers see the shape the source emits.
//   Only the hash INPUT is normalized - the payload passes through.
//
// Scope: applies at every depth and on every endpoint (time_entries,
//   pay_segments, workers, users, time_entry_zo, compensations,
//   spend_lines). All of them can carry a datetime that re-serializes
//   between fetches; the users fix landed a per-endpoint exclude,
//   this is the universal shape fix.
function _canonicalizeScalar(v) {
  if (typeof v !== "string") return v;
  if (!ISO_DT_WITH_OFFSET.test(v)) return v;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return v;
  return new Date(t).toISOString();
}

// Top-level volatile fields per object kind. Kept per-kind because
// `worker` on a time_entry is a big denormalized blob that changes
// with the worker's own edits; a pay_segment has no equivalent
// denormalized block and its `owner_role.id` is load-bearing (used
// to filter STL-MO in the verify script).
const HASH_EXCLUDE_TOP = {
  time_entries: ["updated_at", "worker", "time_card", "time_entry_summary", "__meta"],
  pay_segments: ["updated_at", "__meta"],
  // workers: measured 2026-08-05, two pulls 14 min apart. Zero fields
  // moved on any of 1,126 workers - interval was uneventful. Only
  // exclude the technical markers; the universal nested-strip handles
  // the denormalized image / display_value / has_perm on any nested
  // objects that populate. Excluding department_id or manager_id at
  // top level would mask real re-assignments; we don't do that here.
  workers: ["updated_at", "__meta"],
  // time_entry_zo: measured 2026-08-06, two pulls ~6 min apart on
  // 4,100 records. 4,079 hashed identical; 21 differed due to real
  // duration_hours edits (correctly detected).
  //
  // Three timestamp fields (updated_at, mongo_updated_at,
  // system_updated_at) - Rippling ticks at least one of these on any
  // record refresh even when no substantive field changed, so exclude.
  // owner_role and role carry image URLs that rotate every few
  // minutes (signed URL Expires+Signature); universal image strip
  // catches those without needing to top-level-exclude the whole
  // objects - which keeps owner_role.id and role.id in the hash so a
  // worker-reassignment on a zo record correctly produces a new
  // observation. pay_period carries display_value which the universal
  // strip removes; pay_period.id stays.
  time_entry_zo: ["updated_at", "mongo_updated_at", "system_updated_at", "__meta"],
  // users: parallel to workers on this endpoint. Same shape reasoning
  // as workers - updated_at is the volatile marker and __meta is the
  // scope-annotation envelope.
  //
  // `photos`: added 2026-11-02. Original comment claimed the signed
  // URL on each photo entry lived in `.image` and the universal
  // nested-strip (NESTED_STRIP_KEYS: display_value, has_perm, image)
  // would catch it. Measured: the actual field is `photos[].value`.
  // Each `.value` is a CloudFront signed URL whose querystring
  // (`Expires`, `Signature`, `Key-Pair-Id`) rotates on every fetch
  // while the object path stays byte-identical, so the nested-strip
  // missed the volatile key and every users row re-hashed nightly.
  // Measured bloat before this fix: rippling_raw_users at 84,082 rows
  // against 901 distinct rippling_id (~93 versions / user) since
  // 2026-08-11. Strip the whole `photos` top-level array - the raw
  // payload still carries it (we want the photo URL readable), it
  // just no longer decides whether a user row is new. Trade-off: a
  // real new photo upload will not produce a new observation. That
  // is acceptable - the photo is cosmetic, not operational.
  users: ["updated_at", "photos", "__meta"],
  // compensations: salary PR 1. One record per (worker, effective
  // period). `updated_at` moves whenever Rippling touches the record
  // even if the amount + effective date did not; strip it. `__meta`
  // is the standard envelope. Every substantive field
  // (annual_compensation.value, payment_type, salary_effective_date,
  // hourly_wage.value, ...) stays in the hash - a real raise or a
  // reclassification produces a new observation.
  compensations: ["updated_at", "__meta"],
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

// R-148D · Card Authorization classifier. Kevin ruling 2026-09-24: a
// swipe hold is not a charge. This helper reads Rippling's own
// `Object Type` field from a report_txns row's `raw` jsonb and returns
// true when the row is a Card Authorization hold. Used by:
//   - scripts/purchasing_rippling_sync.mjs (derive-side holdSeen build)
//   - src/lib/purchasing/loaders.js       (loadCompliance filter)
// Same three-line predicate in both places; extracting it keeps the
// hold classification single-sourced. Object Type is null on report
// rows landed before 2026-07-28; callers decide whether to keep or
// drop those - this helper only answers "is this a hold?" for rows
// that actually carry the field.
export function isCardAuthorization(rawJsonb) {
  const objectType = rawJsonb && rawJsonb["Object Type"];
  return objectType === "Card Authorization";
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
  // Scalar branch. Canonicalize ISO-8601 datetime strings carrying
  // an explicit offset to the single UTC form; everything else
  // passes through byte-identical. See _canonicalizeScalar for the
  // regex gate (date-only, duration, numeric id, free text all
  // pass through untouched).
  if (typeof node !== "object") return _canonicalizeScalar(node);
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
