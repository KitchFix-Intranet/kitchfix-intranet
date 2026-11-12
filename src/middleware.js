import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function middleware(request) {
  // TEST_MODE bypass: enables Playwright to drive real UI without an
  // OAuth login step. Double-gated:
  //   - TEST_MODE === "true"    - explicit test intent
  //   - VERCEL !== "1"          - Vercel Runtime always sets VERCEL=1,
  //                               so this branch is UNREACHABLE on Vercel
  //                               regardless of env vars
  // This lets us drive the matrix against `next build && next start`
  // locally (production build, still off Vercel -> VERCEL is unset ->
  // bypass fires). Every deploy that could reach real users runs on
  // Vercel, so a mistaken TEST_MODE=true env there still routes through
  // the real auth.
  if (process.env.TEST_MODE === "true" && process.env.VERCEL !== "1") {
    return NextResponse.next();
  }

  const session = await auth();
  const hasRefreshError = session?.error === "RefreshTokenError";
  const isLoggedIn = !!session;
  const pathname = request.nextUrl.pathname;
  const isLoginPage = pathname === "/login";
  const isAuthRoute = pathname.startsWith("/api/auth");
  const isCronRoute = pathname.startsWith("/api/cron");
  const isApiRoute = pathname.startsWith("/api/");

  // Allow auth API routes and cron jobs through
  if (isAuthRoute || isCronRoute) return NextResponse.next();

  // Dead Google connection on a page navigation: route the user back to
  // sign-in. Scoped to page routes only - /api/* requests pass through
  // unchanged so an in-flight submit still reaches its handler. The
  // invoice backup sender (PR #1355) depends on this: a stale session
  // POSTing to /api/ops/invoices must save the row and run the SA
  // fallback, not be turned into a 401 by middleware.
  if (!isApiRoute && hasRefreshError && !isLoginPage) {
    return NextResponse.redirect(new URL("/login?error=SessionExpired", request.url));
  }

  // Redirect logged-in users away from login page - unless their session
  // is flagged, in which case they came here to sign back in.
  if (isLoginPage && isLoggedIn && !hasRefreshError) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Redirect unauthenticated users to login
  if (!isLoginPage && !isLoggedIn) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};