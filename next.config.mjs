import { withSentryConfig } from '@sentry/nextjs';
/** @type {import('next').NextConfig} */
const nextConfig = {
  // SC print spike (2026-07-13): puppeteer-core + @sparticuz/chromium
  // must NOT be bundled by Turbopack - they resolve files at runtime
  // (chromium binary tarballs in node_modules/@sparticuz/chromium/bin/).
  // Bundling swallows those files. serverExternalPackages leaves them
  // as external require()s and preserves the on-disk layout. The
  // matching outputFileTracingIncludes ensures Vercel's function
  // bundler carries the /bin/ tarballs into the deployment for the
  // print route only (they're ~55MB - keep them off every other
  // function).
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/service-calendar/print": [
      "./node_modules/@sparticuz/chromium/bin/**",
      // Self-hosted fonts (Kevin's guardrail: no runtime Google Fonts
      // fetch). Only the specific latin WOFF2 weights used by the sheet
      // templates are traced - the Cyrillic / Greek / Vietnamese subsets
      // and italic variants stay unbundled.
      "./node_modules/@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2",
      "./node_modules/@fontsource/mulish/files/mulish-latin-400-normal.woff2",
      "./node_modules/@fontsource/mulish/files/mulish-latin-600-normal.woff2",
      "./node_modules/@fontsource/mulish/files/mulish-latin-700-normal.woff2",
      "./node_modules/@fontsource/mulish/files/mulish-latin-800-normal.woff2",
      // KitchFix mark - inlined as data URI in the brand band.
      "./public/PFS_PrimaryLogo_White_Circle.png",
    ],
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "kitchfix",

  project: "kitchfix-intranet",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Uncomment to route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  // tunnelRoute: "/monitoring",

  webpack: {
    // automaticVercelMonitors: requires Sentry Team plan. Doesn't work
    // with App Router route handlers (which is all our crons). Disabled
    // pending Sentry App Router support + plan upgrade decision.
    automaticVercelMonitors: false,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  }
});
