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
  const isLoggedIn = !!session;
  const isLoginPage = request.nextUrl.pathname === "/login";
const isAuthRoute = request.nextUrl.pathname.startsWith("/api/auth");
  const isCronRoute = request.nextUrl.pathname.startsWith("/api/cron");

  // Allow auth API routes and cron jobs through
  if (isAuthRoute || isCronRoute) return NextResponse.next();
  // Redirect logged-in users away from login page
  if (isLoginPage && isLoggedIn) {
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