import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function middleware(request) {
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