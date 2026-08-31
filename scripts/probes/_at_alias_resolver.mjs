// scripts/probes/_at_alias_resolver.mjs
//
// ESM resolver hook loaded by _at_alias_hook.mjs via module.register().
// Maps `@/*` -> `./src/*` per the repo's jsconfig.json path alias.
//
// Ships alongside its bootstrap so parity + sentinel probes can import
// Next-aliased modules from outside the Next runtime.

import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { resolve as pathResolve, dirname } from "node:path";

const RESOLVER_URL = new URL(import.meta.url);
const REPO_ROOT = pathResolve(dirname(fileURLToPath(RESOLVER_URL)), "..", "..");
const SRC_ROOT = pathResolve(REPO_ROOT, "src");

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2);
    const candidates = [
      pathResolve(SRC_ROOT, rel),
      pathResolve(SRC_ROOT, rel + ".js"),
      pathResolve(SRC_ROOT, rel + ".mjs"),
      pathResolve(SRC_ROOT, rel, "index.js"),
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        return { url: pathToFileURL(p).href, format: "module", shortCircuit: true };
      }
    }
    throw new Error(`_at_alias_resolver: cannot resolve ${specifier} in ${SRC_ROOT}`);
  }
  return nextResolve(specifier, context);
}
