// Server Component layout for /service-calendar. Its sole purpose is
// to force dynamic rendering for the route segment. See below.
//
// WHY force-dynamic:
//   /service-calendar/page.js is a "use client" component that reads
//   ?account= / ?period= / ?month= / ?view= via useSearchParams() and
//   drives its whole state machine from those params. Without this
//   segment config, Next 16 classifies the route as ○ Static and
//   prerenders a shell that does NOT include query params in its
//   internal router state. When the client hydrates on a URL that
//   CARRIES query params (a cold deep-load like a shared link or a
//   refresh at a drilled URL), the client-router state stays pinned
//   to the empty-query prerender. Every subsequent router.push
//   compares its target against the stale state, sees "no change,"
//   and silently no-ops.
//
//   Observed 2026-07-11 via #405 instrumentation (Kevin's Traces B/C):
//   cold deep-load at ?account=X&period=Y freezes every push (Season /
//   steppers / dropdown) with window.location never updating and NO
//   url-sync effect firing. Trace A (clean-root cold-load) works, which
//   pins the trigger to "query params in the initial URL."
//
// TRADEOFF:
//   /service-calendar loses ○ Static classification, moves to ƒ
//   Dynamic. This is nearly free in practice: page.js is "use client"
//   and gates on `useSession()` (client-only), so the "prerender" was
//   never producing meaningful HTML - just the loading spinner
//   fallback for status === "loading". The Coming Soon path for
//   non-devs and the ServiceCalendar body for devs are both fully
//   CSR-rendered post-hydration either way.
//
// PLAYWRIGHT VERIFICATION (see tests/sc-nav-matrix.spec.ts):
//   - Pre-fix (main @ 0121e42): 7/10 matrix cells FAIL with
//     "URL did not change" on deep-URL cold-load.
//   - Post-fix (this file present): 10/10 pass.
//
// PRIOR ATTEMPTS:
//   - A Suspense wrap in page.js was tried and reverted in #330
//     (attributed to Suspense swallowing click-through URL updates).
//     Re-attempted 2026-07-11 during this fix - Suspense alone does
//     NOT resolve H3. force-dynamic is the mechanism-correct fix.
export const dynamic = "force-dynamic";

export default function ServiceCalendarLayout({ children }) {
  return children;
}
