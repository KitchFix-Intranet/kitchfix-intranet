// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Only send events from Vercel deploys (production + preview).
  // Local dev errors stay local to keep the dashboard clean.
  enabled: process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview",

  // Tag every event with the deployment environment so we can filter
  // production vs preview in the Sentry UI.
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",

  // 30% sample rate on production protects the 5K/month free-tier quota
  // from a single bad bug flooding the dashboard. 100% in preview
  // so we never miss anything during pre-merge testing.
  sampleRate: process.env.VERCEL_ENV === "production" ? 0.3 : 1.0,

  // Internal tool — capturing PII (user email, IP) is acceptable for
  // debugging user-specific bugs. Revisit if KitchFix ever serves
  // external tenants (Phase 5 multi-tenancy).
  sendDefaultPii: true,
});
