#!/usr/bin/env node
// Verify the directory gear navigates to the Admin tab. Static checks.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const PAGE = "src/app/people/page.js";
const DIRV = "src/components/people/DirectoryView.js";
const page = fs.readFileSync(path.join(ROOT, PAGE), "utf8");
const dirv = fs.readFileSync(path.join(ROOT, DIRV), "utf8");

const results = [];
function record(name, pass, detail) { results.push({ name, pass, detail }); }

// 1. Prop passed in page.js inside the DirectoryView JSX.
{
  const blockRe = /<DirectoryView\b[^>]*?>|<DirectoryView\b[\s\S]*?\/>/;
  const m = page.match(/<DirectoryView[\s\S]*?\/>/);
  const block = m ? m[0] : "";
  record(
    `${PAGE}: DirectoryView JSX passes onNavigate={navigate}`,
    /onNavigate=\{navigate\}/.test(block),
    block ? "prop present" : "DirectoryView JSX not found"
  );
}

// 2. Prop accepted in DirectoryView signature.
record(
  `${DIRV}: function signature accepts onNavigate`,
  /export default function DirectoryView\(\{[^}]*\bonNavigate\b[^}]*\}\)/.test(dirv),
  "destructured prop present"
);

// 3. Placeholder toast removed.
record(
  `${DIRV}: "Admin editing coming soon." NOT present`,
  !/Admin editing coming soon\./.test(dirv),
  "placeholder gone"
);

// 4. Navigation wired.
record(
  `${DIRV}: onClick calls onNavigate("admin")`,
  /onNavigate\("admin"\)/.test(dirv),
  "nav call present"
);

// 5. No collateral damage.
record(
  `${DIRV}: gear button className still "pp-dir-admin-btn"`,
  /className="pp-dir-admin-btn"/.test(dirv),
  "classname preserved"
);
record(
  `${DIRV}: gear still gated by {isAdmin &&`,
  /\{isAdmin\s*&&/.test(dirv),
  "admin gate preserved"
);
record(
  `${PAGE}: view === "admin" AdminQueue block preserved`,
  /view\s*===\s*"admin"\s*&&\s*bootstrapData\?\.isAdmin/.test(page) && /AdminQueue/.test(page),
  "admin tab render path intact"
);

console.log("");
console.log("DIRECTORY GEAR NAV VERIFY");
console.log("=========================");
let allPass = true;
for (const r of results) {
  const tag = r.pass ? "PASS ✓" : "FAIL ✗";
  console.log(`${r.name.padEnd(74)} ${tag}  ${r.detail}`);
  if (!r.pass) allPass = false;
}
console.log("");
console.log(`RESULT: ${allPass ? "ALL PASS" : "FAIL - see rows above"}`);
process.exit(allPass ? 0 : 1);
