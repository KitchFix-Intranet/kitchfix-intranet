import { NextResponse } from "next/server";

/**
 * KPI response caching helpers.
 *
 * Data changes once daily via the nightly Rippling sync pipeline
 * (02:00 CST / 07:00 UTC). Between runs, responses for a given
 * (account, date range, salary toggle, user role) are identical.
 *
 * private                 - browser only; no CDN (responses are role-gated)
 * max-age=3600            - fresh for 1 hour
 * stale-while-revalidate  - serve stale instantly for up to 24 hours while
 *                           revalidating in the background
 * Vary: Cookie            - different session = different cache entry
 */

const CACHED_HEADERS = {
  "Cache-Control": "private, max-age=3600, stale-while-revalidate=86400",
  Vary: "Cookie",
};

const UNCACHED_HEADERS = {
  "Cache-Control": "private, no-store",
};

/** Wrap a successful data response - browser-cacheable. */
export function cachedJson(payload, status = 200) {
  return NextResponse.json(payload, { status, headers: CACHED_HEADERS });
}

/** Wrap a landing, locked, error, or preview response - never cached. */
export function uncachedJson(payload, status = 200) {
  return NextResponse.json(payload, { status, headers: UNCACHED_HEADERS });
}
