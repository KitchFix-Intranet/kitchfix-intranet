#!/usr/bin/env node
// Static verification for the /directory retirement notice.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const PAGE  = "src/app/directory/page.js";
const CSS   = "src/app/directory/directory.css";
const PANEL = "src/components/people/PeopleAccessAdmin.js";
const DIRV  = "src/components/people/DirectoryView.js";
const PPL   = "src/app/people/page.js";
const KEEP  = [
  "src/components/directory/DirectoryAdmin.js",
  "src/components/directory/TeamGrid.js",
  "src/app/directory/directory.css",
];
const API_D = "src/app/api/directory/route.js";
const API_P = "src/app/api/people/route.js";

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const page = read(PAGE);
const ppl  = read(PPL);

const results = [];
function record(name, pass, detail) { results.push({ name, pass, detail }); }

// 1. /directory page: notice only, no team grid / admin drawer imports.
record(
  `${PAGE}: does NOT import TeamGrid`,
  !/import\s+TeamGrid\b/.test(page),
  "no grid"
);
record(
  `${PAGE}: does NOT import DirectoryAdmin`,
  !/import\s+DirectoryAdmin\b/.test(page),
  "no admin drawer"
);
record(
  `${PAGE}: notice heading present ("Directory has moved")`,
  /Directory has moved/.test(page),
  "heading text"
);
record(
  `${PAGE}: body text present`,
  /The Team Directory is now part of the People Portal/.test(page),
  "body text"
);
record(
  `${PAGE}: button links to /people?tab=directory via next/link`,
  /import\s+Link\s+from\s+"next\/link"/.test(page) &&
    /href="\/people\?tab=directory"/.test(page),
  "deep link wired"
);

// 2. Sibling component files still exist on disk.
for (const f of KEEP) {
  const exists = fs.existsSync(path.join(ROOT, f));
  record(`${f}: file still on disk (kept for later teardown PR)`, exists, exists ? "present" : "MISSING");
}

// 3. /people/page.js honors ?tab= / #hash on mount.
record(
  `${PPL}: reads initial tab from URL ?tab= or #hash`,
  /URLSearchParams\(window\.location\.search\)[\s\S]{0,120}window\.location\.hash/.test(ppl) &&
    /setView\(want\)/.test(ppl),
  "deep-link effect present"
);
record(
  `${PPL}: deep-link effect only setView on an allowlisted tab`,
  /VALID\s*=\s*new\s+Set\(\[[^\]]*"directory"/.test(ppl),
  "allowlist includes 'directory'"
);

// 4. No forbidden edits.
function gitDiff(file) {
  try {
    const out = execSync(`git diff --stat origin/main -- '${file}'`, { cwd: ROOT, encoding: "utf8" });
    return out.trim();
  } catch (err) {
    return `(git error: ${err.message})`;
  }
}
for (const f of [PANEL, DIRV, API_D, API_P, "src/middleware.js"]) {
  const diff = gitDiff(f);
  record(
    `${f}: unchanged vs origin/main`,
    diff === "",
    diff === "" ? "clean" : `CHANGED: ${diff}`
  );
}

// ─── Report ───────────────────────────────────────────────────────
console.log("");
console.log("DIRECTORY GATE VERIFY");
console.log("=====================");
let allPass = true;
for (const r of results) {
  const tag = r.pass ? "PASS ✓" : "FAIL ✗";
  console.log(`${r.name.padEnd(84)} ${tag}  ${r.detail}`);
  if (!r.pass) allPass = false;
}
console.log("");
console.log(`RESULT: ${allPass ? "ALL PASS" : "FAIL - see rows above"}`);
process.exit(allPass ? 0 : 1);
