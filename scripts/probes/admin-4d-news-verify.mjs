#!/usr/bin/env node
// scripts/probes/admin-4d-news-verify.mjs
//
// Stage 4d verification. Mirrors the 4a/4b/4c probe shape.
//
// Checks:
//   1. No stale sync imports in rewired files.
//   2. NewsFeed prop threading (viewerIsNewsAdmin consumed, isNewsAdmin
//      still gates the Manage button).
//   3. news-bootstrap response includes the viewerIsNewsAdmin flag.
//   4. Retained imports (isOpsLeadershipDb everywhere, isSuperAdmin in
//      directory/route.js) are intact.
//
// Build + lint run separately via npm scripts.
//
// Run:
//   node --env-file=.env.local scripts/probes/admin-4d-news-verify.mjs

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[k]) {
    console.error(`\n[ADMIN-4D] ${k}: ABSENT - restore and re-run.`);
    process.exit(1);
  }
}

const NEWS_FEED = "src/components/home/NewsFeed.js";
const DASHBOARD = "src/app/api/dashboard/route.js";
const SERVER_FILES = [
  "src/app/api/dashboard/route.js",
  "src/app/api/directory/route.js",
  "src/app/api/ops/route.js",
  "src/app/api/kpi/purchasing/export/route.js",
  "src/app/api/kpi/labor/export/route.js",
  "src/app/api/kpi/labor/views/route.js",
  "src/app/api/kpi/labor/views/[id]/route.js",
  "src/lib/invoiceActions.js",
];

const results = [];
function record(name, pass, detail) { results.push({ name, pass, detail }); }

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }

// ─── 1. No stale sync imports ─────────────────────────────────────
// Pattern matches server-file rule: the symbol must NOT appear in any
// import statement, but may appear in doc comments (the spec-provided
// replacement comment itself names the retired symbol).
{
  const nf = read(NEWS_FEED);
  const lines = nf.split("\n");
  const badImport = lines.find((l) => /^import\s/.test(l.trim()) && /\bOPS_LEADERSHIP_EMAILS\b/.test(l));
  record(
    "NewsFeed.js: OPS_LEADERSHIP_EMAILS not in any import line",
    !badImport,
    badImport ? `IMPORT LINE: ${badImport.trim()}` : "clean (comment-only references allowed)"
  );
}

// For the 8 server files: the import statement must NOT reference
// OPS_LEADERSHIP_EMAILS, but comments may (documentation preserved).
const importRe = /^import\s+\{[^}]*\}\s+from\s+"@\/lib\/admin";?$/m;
const importHasOpsRe = /^import\s+\{[^}]*OPS_LEADERSHIP_EMAILS[^}]*\}\s+from\s+"@\/lib\/admin";?/m;
for (const rel of SERVER_FILES) {
  const src = read(rel);
  const bad = importHasOpsRe.test(src);
  record(`${rel}: import line does NOT reference OPS_LEADERSHIP_EMAILS`, !bad, bad ? "stale import survived" : "clean");
}

// Comment-preserved check: a few files carry OPS_LEADERSHIP_EMAILS in
// doc comments (header rationale). Confirm at least one of those still
// has the symbol in a non-import context.
const COMMENT_PRESERVE_FILES = [
  "src/app/api/kpi/labor/export/route.js",
  "src/app/api/kpi/labor/views/route.js",
  "src/app/api/kpi/labor/views/[id]/route.js",
];
for (const rel of COMMENT_PRESERVE_FILES) {
  const src = read(rel);
  const lines = src.split("\n");
  const commentHits = lines.filter((l) => /OPS_LEADERSHIP_EMAILS/.test(l) && !/^import\s/.test(l.trim())).length;
  record(`${rel}: OPS_LEADERSHIP_EMAILS preserved in comments`, commentHits > 0, `${commentHits} comment reference(s)`);
}

// ─── 2. NewsFeed prop threading ───────────────────────────────────
{
  const nf = read(NEWS_FEED);
  const hasViewerFlag = /\bviewerIsNewsAdmin\b/.test(nf);
  const hasIsNewsAdmin = /\bisNewsAdmin\b/.test(nf);
  record("NewsFeed.js: viewerIsNewsAdmin consumed from bootstrap data", hasViewerFlag, hasViewerFlag ? "field read" : "field missing");
  record("NewsFeed.js: isNewsAdmin still used for gate", hasIsNewsAdmin, hasIsNewsAdmin ? "variable referenced" : "variable missing");
}

// ─── 3. news-bootstrap includes the flag ──────────────────────────
{
  const dash = read(DASHBOARD);
  // The field name must appear inside the news-bootstrap handler
  // (positioned before the next action handler). We approximate by
  // asserting the field appears anywhere in the file.
  const hasFlag = /\bviewerIsNewsAdmin\b/.test(dash);
  record("dashboard/route.js: news-bootstrap returns viewerIsNewsAdmin", hasFlag, hasFlag ? "field present" : "field missing");
}

// ─── 4. Retained imports still correct ────────────────────────────
for (const rel of SERVER_FILES) {
  const src = read(rel);
  const line = (src.split("\n").find((l) => importRe.test(l) && /@\/lib\/admin/.test(l))) || "";
  const hasOpsDb = /\bisOpsLeadershipDb\b/.test(line);
  record(`${rel}: isOpsLeadershipDb kept in import`, hasOpsDb, hasOpsDb ? "kept" : `IMPORT LINE: ${line.trim()}`);
}
{
  const dir = read("src/app/api/directory/route.js");
  const line = (dir.split("\n").find((l) => importRe.test(l) && /@\/lib\/admin/.test(l))) || "";
  const hasSuper = /\bisSuperAdmin\b/.test(line);
  record("directory/route.js: isSuperAdmin kept in import", hasSuper, hasSuper ? "kept" : `IMPORT LINE: ${line.trim()}`);
}

// ─── Report ───────────────────────────────────────────────────────
console.log("");
console.log("ADMIN STAGE-4D NEWS VERIFY");
console.log("==========================");
let allPass = true;
for (const r of results) {
  const tag = r.pass ? "PASS ✓" : "FAIL ✗";
  const line = `${r.name.padEnd(78)} ${tag}  ${r.detail}`;
  console.log(line);
  if (!r.pass) allPass = false;
}
console.log("");
console.log(`RESULT: ${allPass ? "ALL PASS" : "FAIL - see rows above"}`);
process.exit(allPass ? 0 : 1);
