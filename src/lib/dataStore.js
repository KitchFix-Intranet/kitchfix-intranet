// Shim: re-exports from the dataStore module facade split (PR 4.1).
// Exists so `import "../src/lib/dataStore.js"` (the explicit-path form
// used by scripts/backfill-*.mjs) continues to resolve after the
// monolith was split into src/lib/dataStore/{index, shared,
// newsInteractions, directory, submissions}.js. Node ESM does not
// auto-resolve `.js` paths to directory index files.
//
// The 3 route handler imports (extension-less `@/lib/dataStore`)
// resolve to this file as well via Next path-alias + Node module
// resolution; either route reaches the same 20-export surface.
export * from "./dataStore/index.js";
