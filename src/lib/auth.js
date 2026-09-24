import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { logEventSA } from "@/lib/analytics";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/spreadsheets",
"https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/gmail.send",
].join(" "),
          access_type: "offline",
          prompt: "consent",
          // UX hint only. Surfaces KitchFix accounts first in Google's
          // account chooser. NOT a security control - the user can
          // pick any Google account regardless. The real domain gate
          // is the signIn callback below; do not delete that thinking
          // this covers it.
          hd: "kitchfix.com",
        },
      },
    }),
  ],
  callbacks: {
    // 2026-09-23: gate sign-in to @kitchfix.com. Prior state: no
    // signIn callback, no hosted-domain restriction; any Google
    // account on earth completed login and passed middleware's
    // session-exists check. Chat-Claude verified against production
    // that zero active people and zero contacts rows carry a non-
    // @kitchfix.com email, so nobody legitimate is locked out.
    //
    // Deny-by-default: missing / non-string / non-suffix emails all
    // return false. Exact-suffix match on "@kitchfix.com" only -
    // .includes() would let "kitchfix.com.attacker.net" pass.
    async signIn({ user, profile }) {
      const raw = user?.email ?? profile?.email ?? null;
      const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
      const allowed = email.endsWith("@kitchfix.com");
      // Log every attempt so "did anyone unexpected sign in?" is
      // answerable via Vercel runtime logs. Durable history (a
      // sign_in_attempts table) is follow-up scope; this PR does not
      // touch the migration gate.
      console.log(`[Auth signIn] ${allowed ? "ALLOW" : "DENY"} email=${email || "<missing>"}`);
      return allowed;
    },
    async jwt({ token, account }) {
      // First sign-in: save all Google tokens
if (account) {
        console.log("[Auth] Fresh login — saving tokens");
        logEventSA({ email: token.email, userName: token.name, category: "auth", action: "login", detail: { email: token.email, name: token.name } });
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at, // Unix timestamp in seconds
        };
      }

      // Subsequent requests: check if token is still valid
      // expires_at is in seconds, Date.now() is in milliseconds
      if (token.expiresAt && Date.now() < token.expiresAt * 1000) {
        // Token still valid
        return token;
      }

      // Token expired — refresh it
      console.log("[Auth] Access token expired, refreshing...");
      try {
        const response = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            grant_type: "refresh_token",
            refresh_token: token.refreshToken,
          }),
        });

        const refreshed = await response.json();

        if (!response.ok) {
          console.error("[Auth] Refresh failed:", refreshed);
          throw new Error(refreshed.error || "Refresh failed");
        }

        console.log("[Auth] Token refreshed successfully");
        return {
          ...token,
          accessToken: refreshed.access_token,
          expiresAt: Math.floor(Date.now() / 1000) + refreshed.expires_in,
          // Keep the existing refresh token (Google doesn't always return a new one)
          refreshToken: refreshed.refresh_token ?? token.refreshToken,
        };
      } catch (error) {
        console.error("[Auth] Token refresh error:", error.message);
        // Return token with error flag — the session callback can handle this
        return {
          ...token,
          error: "RefreshTokenError",
        };
      }
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.error = token.error;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});