// src/lib/billcom.js
//
// bill.com proxy client for the KPI PURCHASING PHASE 1 sync.
//
// The proxy is hosted alongside the QBO proxy (Josh's ngrok tunnel).
// Auth is a static X-API-Key header. Endpoints span TWO envelope shapes:
//   v2 (`response_data: []`, numeric status codes as STRINGS like
//       approvalStatus "3") - /bills, /chartofaccounts, /classes
//   v3 (`results: []` + `nextPage` cursor) - /vendors
// Do NOT mix parsers - use extractRowsV2 vs extractRowsV3 by endpoint.
//
// Endpoints used:
//   GET /billcom/bills/filtered?invoiceDateStart&invoiceDateEnd&start&max
//       page with start offset, max 500/page. Returns bill headers. v2.
//   GET /billcom/bills/{id}/lineItems
//       line items for a bill (if the /filtered call does not embed). v2.
//   GET /billcom/chartofaccounts?start&max
//       1,072 rows across 2 pages of 999. v2.
//   GET /billcom/classes?start&max
//       51 rows; the 13 that matter map 1:1 to sites. v2.
//   GET /billcom/vendors?max&page=<cursor>
//       vendor snapshot. v3 envelope (results + nextPage cursor).
//       Max capped at 100/page by the proxy. `start=` is IGNORED -
//       walk via page=<nextPage> only.
//
// Env:
//   BILLCOM_PROXY_BASE   proxy origin + /billcom prefix
//   BILLCOM_PROXY_KEY    static X-API-Key header value
//
// Discovery findings (Phase 0):
//   - /bills/filtered returns v2 envelope. `response_data` is the row
//     array. `next_start` / pagination.next may be absent - fall back
//     to checking length < max to detect end of pages.
//   - approvalStatus / paymentStatus are numeric codes returned as
//     STRINGS ("0", "1", "3", "4"). Never compare as number without
//     casting.
//   - amounts return as strings; the sync converts to Number on
//     content-hash and DB write.
//   - X-API-Key is a static header; the proxy holds the underlying
//     bill.com OAuth server-side.

import { createHash } from "node:crypto";

// ─── Env ─────────────────────────────────────────────────────────────

function _proxyBase() {
  const b = process.env.BILLCOM_PROXY_BASE;
  if (!b) throw new Error("billcom: BILLCOM_PROXY_BASE required");
  return String(b).replace(/\/+$/, "");
}

function _apiKey() {
  const k = process.env.BILLCOM_PROXY_KEY;
  if (!k) throw new Error("billcom: BILLCOM_PROXY_KEY required (never echoed)");
  return k;
}

function _headers() {
  return {
    "X-API-Key": _apiKey(),
    "Accept": "application/json",
    "User-Agent": "kitchfix-intranet/purchasing-sync",
  };
}

// ─── Fetch (with retry) ──────────────────────────────────────────────

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// One GET with retry on 429/5xx + Retry-After honoring. Fails fast on
// other 4xx. Returns { ok, status, body, raw? }.
export async function fetchJson(url, opts = {}) {
  const maxAttempts   = opts.maxAttempts   ?? 6;
  const baseBackoffMs = opts.baseBackoffMs ?? 1000;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let r;
    try {
      r = await fetch(url, { headers: _headers() });
    } catch (err) {
      lastErr = err;
      await _sleep(baseBackoffMs * Math.pow(2, attempt - 1));
      continue;
    }
    if (r.ok) {
      const text = await r.text();
      let body;
      try { body = JSON.parse(text); } catch { body = null; }
      if (body == null) {
        return { ok: false, status: r.status, body: null, error: "non-json response", raw: text.slice(0, 500) };
      }
      return { ok: true, status: r.status, body };
    }
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

// v2 envelope row extractor. `response_data` is authoritative; fall
// back to `results` / `data` in case the proxy normalizes an endpoint.
export function extractRowsV2(body) {
  if (Array.isArray(body?.response_data)) return body.response_data;
  if (Array.isArray(body?.results))       return body.results;
  if (Array.isArray(body?.data))          return body.data;
  if (Array.isArray(body))                return body;
  return [];
}

// v3 envelope row extractor. `results` is authoritative. The v3 endpoint
// (verified for /vendors 2026-08-20) also carries a `nextPage` cursor
// string that the caller must pass back as `page=<cursor>` on the next
// request. Kept separate from extractRowsV2 so a "wrong parser" mistake
// is a compile-time miss on the import name, not a silent data drop.
export function extractRowsV3(body) {
  if (Array.isArray(body?.results))       return body.results;
  if (Array.isArray(body?.response_data)) return body.response_data;
  if (Array.isArray(body?.data))          return body.data;
  if (Array.isArray(body))                return body;
  return [];
}

// ─── Endpoint helpers ────────────────────────────────────────────────

// Build a URL for /billcom/bills/filtered with an inclusive
// invoiceDate window + pagination. `start` is the offset; `max` caps
// at 500 per page. Empty result -> caller stops paginating.
export function billsFilteredUrl({ invoiceDateStart, invoiceDateEnd, start = 0, max = 500 }) {
  if (!invoiceDateStart) throw new Error("billsFilteredUrl: invoiceDateStart required");
  if (!invoiceDateEnd)   throw new Error("billsFilteredUrl: invoiceDateEnd required");
  const base = _proxyBase();
  const qs = new URLSearchParams({
    invoiceDateStart: String(invoiceDateStart),
    invoiceDateEnd:   String(invoiceDateEnd),
    start:            String(start),
    max:              String(max),
  });
  return `${base}/bills/filtered?${qs.toString()}`;
}

// Chart of accounts URL. 1,072 rows across 2 pages of 999. Paginate
// with start/max.
export function chartOfAccountsUrl({ start = 0, max = 999 }) {
  const base = _proxyBase();
  const qs = new URLSearchParams({ start: String(start), max: String(max) });
  return `${base}/chartofaccounts?${qs.toString()}`;
}

// Classes URL. 51 rows; one page suffices.
export function classesUrl({ start = 0, max = 500 }) {
  const base = _proxyBase();
  const qs = new URLSearchParams({ start: String(start), max: String(max) });
  return `${base}/classes?${qs.toString()}`;
}

// Vendors URL. v3 envelope (top-level `results` array + `nextPage`
// cursor). Proxy caps max at 100 per page - verified 2026-08-20 (400
// with message "max: must be less than or equal to 100" when exceeded).
// Do NOT bump the default without re-probing.
//
// Pagination gotcha (verified 2026-08-20): `start=<n>` in the query
// string is IGNORED by the proxy on /vendors - every request returns
// the first 100 rows. The proxy advances ONLY when the caller passes
// `page=<nextPage>` where nextPage is the opaque cursor from the
// previous response. First page: pass nothing. Subsequent pages: pass
// page=<cursor>. Walking with `start=` is a silent-loop trap - an
// earlier probe hit the HARD page limit of 200 with 200 * 100 = 20,000
// "rows" that were the same 100 vendors on repeat.
export function vendorsUrl({ pageCursor = null, max = 100 }) {
  const base = _proxyBase();
  const capped = Math.min(Number(max) || 100, 100);
  const qs = new URLSearchParams({ max: String(capped) });
  if (pageCursor) qs.set("page", String(pageCursor));
  return `${base}/vendors?${qs.toString()}`;
}

// Optional per-bill line items endpoint (used only when /filtered
// does not embed lineItems in the response_data row). The v2 envelope
// on /bills returns lineItems embedded; the proxy respects that.
export function billLineItemsUrl(billId) {
  if (!billId) throw new Error("billLineItemsUrl: billId required");
  const base = _proxyBase();
  return `${base}/bills/${encodeURIComponent(billId)}/lineItems`;
}

// ─── Content hash ───────────────────────────────────────────────────
//
// Same discipline as src/lib/rippling.js: canonical projection with
// per-kind volatile field exclusion. bill.com bill headers carry
// `updatedTime` which ticks even on identical content, so exclude it.
// Line items carry `lineOrder` which is stable, `updatedTime` (exclude),
// and no signed URLs.

const HASH_EXCLUDE_TOP = {
  bill:      ["updatedTime", "cacheAt", "__meta"],
  bill_line: ["updatedTime", "cacheAt", "__meta"],
  account:   ["updatedTime", "cacheAt", "__meta"],
  class:     ["updatedTime", "cacheAt", "__meta"],
  vendor:    ["updatedTime", "cacheAt", "__meta"],
};

function _normalizeForHash(node, topExcludeSet) {
  if (node == null) return node;
  if (Array.isArray(node)) return node.map(v => _normalizeForHash(v, null));
  if (typeof node !== "object") return node;
  const out = {};
  const keys = Object.keys(node).sort();
  for (const k of keys) {
    if (topExcludeSet && topExcludeSet.has(k)) continue;
    out[k] = _normalizeForHash(node[k], null);
  }
  return out;
}

export function contentHash(payload, kind) {
  const topExclude = HASH_EXCLUDE_TOP[kind];
  if (!topExclude) throw new Error("billcom.contentHash: unknown kind '" + kind + "', expected one of: " + Object.keys(HASH_EXCLUDE_TOP).join(", "));
  const normalized = _normalizeForHash(payload, new Set(topExclude));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

// ─── paymentStatus mapping (v2 numeric codes as strings) ─────────────
//
// Standing bill.com v2 semantics per public docs + Phase 0 spike:
// First prod run 2026-08-18 observed distribution across 3367 bills:
//   status="0" -> 2640 bills, ALL with paidAmount >= amount     (PAID)
//   status="1" ->  727 bills, NONE  with paidAmount >= amount   (UNPAID)
//   status="2"/"3"/"4" -> 0 bills observed
//
// So for THIS tenant the paid set is {"0"}. Correcting from the old
// {"1","4"} default which was inverted for our tenant. The sync ALSO
// cross-checks paidAmount against amount (>= amount within 1 cent) as
// a defense-in-depth signal - if either the code says paid or paidAmount
// matches, the row's `paid` flag is TRUE.
export const PAYMENT_STATUS_PAID = new Set(["0"]);

export function isPaid(bill) {
  const codeIsPaid = bill?.paymentStatus != null && PAYMENT_STATUS_PAID.has(String(bill.paymentStatus));
  const amt = Number(bill?.amount || 0);
  const paidAmt = Number(bill?.paidAmount || 0);
  const amountMatches = amt > 0 && Math.abs(paidAmt - amt) < 0.01;
  return codeIsPaid || amountMatches;
}

// ─── gl_bucket prefix rule (spec §2 derive step) ─────────────────────
// 32/34/35 -> pl_cogs, 13 -> reimbursable, 5 -> sga, else other.
// Uses the numeric prefix of the account_number (e.g. "3200.1" -> 32).
export function glBucketFor(accountNumber) {
  if (!accountNumber) return null;
  const digits = String(accountNumber).match(/^(\d+)/);
  if (!digits) return "other";
  const prefix = digits[1];
  if (prefix.startsWith("32") || prefix.startsWith("34") || prefix.startsWith("35")) return "pl_cogs";
  if (prefix.startsWith("13")) return "reimbursable";
  if (prefix.startsWith("5"))  return "sga";
  return "other";
}
