// scripts/probes/_at_alias_hook.mjs
//
// Node ESM resolver-hook installer. Uses module.register() to inject a
// resolver that maps `@/` -> `./src/`. Load via `--import` (Node 20.6+
// pattern) on the parity + sentinel probes that need Next path
// aliases from outside the Next runtime.
//
// Two files: this bootstrap (--import target) + the actual resolver
// file (_at_alias_resolver.mjs).
//
// Overview Phase 2 PR-3 companion. Not on any prod path.

import { register } from "node:module";

// module.register's second arg is a URL string (the parent). Passing
// import.meta.url directly resolves `./_at_alias_resolver.mjs`
// relative to this file.
register("./_at_alias_resolver.mjs", import.meta.url);
