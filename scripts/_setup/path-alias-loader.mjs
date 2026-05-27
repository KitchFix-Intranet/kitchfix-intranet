// ════════════════════════════════════════════════════════════════════════════
// Node loader hook: resolves Next.js-style @/* path aliases for scripts.
//
// Mirrors jsconfig.json's paths config: @/* -> ./src/*. Used by backfill
// scripts (and any future scripts) that import from src/lib code which
// internally uses @/lib/* aliases. Registered via:
//
//   node --import ./scripts/_setup/register-aliases.mjs ...
//
// Tries extension/index fallback when the specifier has no extension:
//   `${target}.js`, `${target}.mjs`, `${target}/index.js`
//
// Throws an explicit error when the @ alias matches but no file is
// found across all candidates - clearer than Node's generic
// "module not found" for debugging future script invocations.
// ════════════════════════════════════════════════════════════════════════════

import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

// Project root = three levels up from this file (scripts/_setup/loader.mjs).
const PROJECT_ROOT = path.resolve(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  ".."
);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const target = path.join(PROJECT_ROOT, "src", specifier.slice(2));
    const candidates = path.extname(target)
      ? [target]
      : [`${target}.js`, `${target}.mjs`, `${target}/index.js`];
    for (const c of candidates) {
      if (existsSync(c)) {
        return nextResolve(pathToFileURL(c).href, context);
      }
    }
    throw new Error(
      `[path-alias-loader] @/ alias resolved to no existing file. ` +
        `Specifier: "${specifier}". Tried: ${candidates.join(", ")}`
    );
  }
  return nextResolve(specifier, context);
}
