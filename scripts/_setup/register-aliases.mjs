// ════════════════════════════════════════════════════════════════════════════
// Registers the path-alias loader hook for Node scripts.
//
// Usage:
//   node --import ./scripts/_setup/register-aliases.mjs ...
//
// Or via the npm script convention:
//   npm run backfill:directory -- --table=accounts --execute
//
// One-time setup; reused by every script that imports from src/lib code
// using Next.js @/* path aliases. Pure Node, no extra deps, no build step.
// Does not affect Next.js production runtime - the loader is only active
// when invoked explicitly via --import.
// ════════════════════════════════════════════════════════════════════════════

import { register } from "node:module";

register("./path-alias-loader.mjs", import.meta.url);
