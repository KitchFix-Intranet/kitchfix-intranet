// Playwright spec adoption of assertBoardLoaded.
//
// Owner ruling 2026-08-27. Every browser spec in this repo shares
// tests/.auth/user.json. When that file expired on 2026-08-10 every
// spec started failing against a session-expired panel - some with
// 30s timeout messages, one (my viewport-clip spec) as a silent
// vacuous green.
//
// Fix landed in three parts:
//   1. tests/auth.setup.ts age guard   fails setup at 25d
//   2. tests/lib/board-loaded.ts       shared assertBoardLoaded()
//   3. adoption sweep across 23 specs  every page.goto backed by the guard
//
// This probe holds part 3 in place. A new spec written next week
// with a page.goto and no assertBoardLoaded would silently regress
// to the "confusing 30s timeout" class. The probe fails the moment
// that happens so it comes back on the PR that introduced it.
//
// Assertion: every `tests/**/*.spec.ts` file that contains
// `page.goto(` also imports `assertBoardLoaded`. Opt-out by writing
// `// no-auth-guard: <reason>` on a comment line anywhere in the
// file - explicit, greppable, blame-attributable.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const TESTS_DIR = "tests";
const OPT_OUT_MARKER = "no-auth-guard:";

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) out.push(...walk(path));
    else if (name.endsWith(".spec.ts")) out.push(path);
  }
  return out;
}

let failures = 0;
function assert(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures += 1;
  console.log(`  ✗ ${name}`);
  if (extra !== undefined) console.log(`      ${JSON.stringify(extra)}`);
}

console.log("=== Playwright spec auth-guard adoption ===\n");

const specs = walk(TESTS_DIR).sort();
console.log(`scanning ${specs.length} spec files under ${TESTS_DIR}/\n`);

const violators = [];
const optOuts = [];
for (const spec of specs) {
  const src = readFileSync(spec, "utf8");
  const hasGoto = /\bpage\.goto\s*\(/.test(src);
  if (!hasGoto) continue;
  const hasGuard = /\bassertBoardLoaded\b/.test(src);
  const hasOptOut = src.includes(OPT_OUT_MARKER);
  if (hasGuard) continue;
  if (hasOptOut) { optOuts.push(spec); continue; }
  violators.push(spec);
}

assert(
  `every spec with page.goto imports assertBoardLoaded (opt-out via "// ${OPT_OUT_MARKER} <reason>")`,
  violators.length === 0,
  violators,
);
if (optOuts.length > 0) {
  console.log(`\n  ${optOuts.length} spec(s) opted out with "// ${OPT_OUT_MARKER}":`);
  for (const s of optOuts) console.log(`    - ${s}`);
}

console.log(`\n---`);
if (failures > 0) {
  console.log(`${failures} spec(s) call page.goto without importing assertBoardLoaded.`);
  console.log(`\nFix: add\n  import { assertBoardLoaded } from './lib/board-loaded';\nand call assertBoardLoaded(page, '<real-board-selector>') after each page.goto that navigates to a fresh authed page.`);
  console.log(`\nOr opt out by adding a comment line: // ${OPT_OUT_MARKER} <reason>`);
  process.exit(1);
}
console.log(`all ${specs.length} spec files satisfy the adoption contract.`);
