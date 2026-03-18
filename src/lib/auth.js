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
        },
      },
    }),
  ],
  callbacks: {
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