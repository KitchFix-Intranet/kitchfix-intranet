// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a user loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  // Client-side env vars require the NEXT_PUBLIC_ prefix in Next.js.
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only send events from Vercel deploys (production + preview).
  // Local dev errors stay local to keep the dashboard clean.
  enabled: process.env.NODE_ENV === "production",

  // NODE_ENV is "production" on Vercel builds, "development" locally.
  environment: process.env.NODE_ENV,

  // Client error volume is much lower than server. 100% sampling.
  // Adjust later if a flood of client errors exhausts the quota.
  sampleRate: 1.0,

  // Internal tool — capturing PII (user email, IP) is acceptable for
  // debugging user-specific bugs. Revisit if KitchFix ever serves
  // external tenants (Phase 5 multi-tenancy).
  sendDefaultPii: true,
});

// Capture errors during Next.js client-side route transitions.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
