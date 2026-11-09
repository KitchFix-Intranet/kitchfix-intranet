import { NextResponse } from "next/server";

/**
 * KPI response caching helpers.
 */

// 2026-11-09. Was `private, max-age=3600, stale-while-revalidate=86400` on the
// premise that actuals change only once daily (nightly Rippling sync). That
// premise is dead: purchasing actuals now re-derive mid-day (Stockpot re-scan /
// purchasing re-derive), and operators plan against these numbers. A mid-day
// derive left the board serving stale, double-counted spend for up to ~25h
// (max-age + stale-while-revalidate). The board must always reflect the live
// DB, so no-store. If per-request cost ever matters, the correct replacement is
// an ETag keyed to the latest derive version (max derived_at) returning 304 on
// no change - NOT a time-based cache that can serve a stale actual.
const CACHED_HEADERS = {
  "Cache-Control": "private, no-store",
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
