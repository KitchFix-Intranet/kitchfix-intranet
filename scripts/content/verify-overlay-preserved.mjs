#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/verify-overlay-preserved.mjs
//
// Diff two snapshots produced by snapshot-overlay-state.mjs and report any
// (id, field) tuple that changed. Used as step 5 of the projection-preserve
// safety procedure.
//
// USAGE:
//   node scripts/content/verify-overlay-preserved.mjs <baseline.json> <post.json>
//
// EXIT CODES:
//   0 - clean: every (id, status, access_level, pinned, archived, archived_at)
//       tuple in baseline matches the corresponding tuple in post.
//   1 - divergence detected. Output lists every diff. Investigate before
//       trusting the projection apply.
//   2 - invalid input (missing arg, can't parse file, mismatched id sets).
//
// READ-ONLY: this script never touches Postgres. JSON diff only.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "node:fs";

const TRACKED_FIELDS = [
  "status",
  "access_level",
  "pinned",
  "archived",
  "archived_at",
];

function loadSnapshot(path, label) {
  if (!existsSync(path)) {
    console.error(`${label} not found: ${path}`);
    process.exit(2);
  }
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    console.error(`${label} read failed: ${e.message}`);
    process.exit(2);
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    console.error(`${label} parse failed: ${e.message}`);
    process.exit(2);
  }
  if (!Array.isArray(json)) {
    console.error(`${label} is not a JSON array`);
    process.exit(2);
  }
  return json;
}

function byId(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!r || typeof r.id !== "string") continue;
    map.set(r.id, r);
  }
  return map;
}

function main() {
  const [, , baselinePath, postPath] = process.argv;
  if (!baselinePath || !postPath) {
    console.error(
      "Usage: node scripts/content/verify-overlay-preserved.mjs <baseline.json> <post.json>"
    );
    process.exit(2);
  }

  const baseline = loadSnapshot(baselinePath, "baseline");
  const post = loadSnapshot(postPath, "post");
  const baseMap = byId(baseline);
  const postMap = byId(post);

  const diffs = [];
  const removed = [];
  const added = [];

  for (const [id, baseRow] of baseMap) {
    if (!postMap.has(id)) {
      removed.push(id);
      continue;
    }
    const postRow = postMap.get(id);
    for (const f of TRACKED_FIELDS) {
      const a = baseRow[f];
      const b = postRow[f];
      if (a !== b) {
        diffs.push({ id, field: f, from: a, to: b });
      }
    }
  }
  for (const id of postMap.keys()) {
    if (!baseMap.has(id)) added.push(id);
  }

  console.log(`Baseline: ${baseMap.size} docs (${baselinePath})`);
  console.log(`Post:     ${postMap.size} docs (${postPath})`);
  console.log("");

  if (diffs.length === 0 && removed.length === 0 && added.length === 0) {
    console.log("CLEAN: every tracked field is identical for every doc.");
    process.exit(0);
  }

  if (removed.length > 0) {
    console.log(`REMOVED docs (${removed.length}) - present in baseline, absent in post:`);
    for (const id of removed) console.log(`  - ${id}`);
    console.log("");
  }
  if (added.length > 0) {
    console.log(`ADDED docs (${added.length}) - present in post, absent in baseline:`);
    for (const id of added) console.log(`  + ${id}`);
    console.log("");
  }
  if (diffs.length > 0) {
    console.log(`FIELD CHANGES (${diffs.length}):`);
    // Group by field so the worst category is obvious.
    const byField = {};
    for (const d of diffs) {
      byField[d.field] = byField[d.field] || [];
      byField[d.field].push(d);
    }
    for (const [field, group] of Object.entries(byField).sort()) {
      console.log(`  ${field} (${group.length}):`);
      for (const d of group) {
        console.log(`    ${d.id}: ${JSON.stringify(d.from)} -> ${JSON.stringify(d.to)}`);
      }
    }
    console.log("");
  }

  console.log("DIVERGENCE DETECTED. Investigate before trusting the projection apply.");
  console.log("If the projection-preserve change shipped and status/access_level changed,");
  console.log("the conditional-include logic is buggy - revert the PR and restore values");
  console.log("from the baseline JSON via Studio.");
  process.exit(1);
}

main();
