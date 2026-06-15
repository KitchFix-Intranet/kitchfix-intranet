#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/_apply_a21_surfaces_backfill.mjs
// A2.1: backfill surfaces from production document_surfaces into the
// corresponding MDX files' frontmatter. After this runs, MDX is the source
// of truth for surfaces and the projection script reads frontmatter only.
//
// The production surfaces set is small (10 rows / 6 docs as of 2026-06-15);
// the patches are content-anchored to land "surfaces: [...]" immediately
// after the "keywords:" block on each affected doc.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(__dirname, "..", "..", "content", "documents");

// Pulled from production document_surfaces on 2026-06-15 (see PROJECTION_DRYRUN.md).
const SURFACES = {
  "AGR-001":    ["new-hire-onboarding"],
  "PB-002":     ["incident-reporting", "kitchen", "new-hire-onboarding", "culinary"],
  "POST-001":   ["incident-reporting"],
  "POST-002":   ["incident-reporting", "kitchen"],
  "POSTER-001": ["new-hire-onboarding"],
  "SOP-002":   ["incident-reporting"],
};

function backfill(file, surfaces) {
  const src = readFileSync(file, "utf8");
  // Detect "surfaces: ..." already present
  if (/^surfaces:/m.test(src.split(/^---$/m)[1] || "")) {
    return { status: "skip", reason: "surfaces already in frontmatter" };
  }
  // Find the keywords block end (next key after the keywords array)
  // The keywords block is YAML; the next sibling is the next top-level key
  // at the same indentation. We anchor on the line AFTER the keywords array.
  // Simpler approach: insert "surfaces:" block right before "owner:" since
  // every doc has an owner line.
  const ownerIdx = src.indexOf("\nowner:");
  if (ownerIdx === -1) return { status: "fail", reason: "no owner: line found" };
  const yaml = surfaces.map((s) => `  - ${s}`).join("\n");
  const insert = `\nsurfaces:\n${yaml}`;
  const next = src.slice(0, ownerIdx) + insert + src.slice(ownerIdx);
  writeFileSync(file, next, "utf8");
  return { status: "applied", count: surfaces.length };
}

let applied = 0;
let skipped = 0;
let failed = 0;
const log = [];
for (const [id, surfaces] of Object.entries(SURFACES)) {
  const file = join(DOCS_DIR, `${id}.mdx`);
  try {
    const r = backfill(file, surfaces);
    log.push({ id, ...r, surfaces });
    if (r.status === "applied") applied++;
    else if (r.status === "skip") skipped++;
    else failed++;
  } catch (e) {
    log.push({ id, status: "fail", reason: e.message });
    failed++;
  }
}

console.log(`A2.1 surfaces backfill: ${applied} applied, ${skipped} skipped, ${failed} failed\n`);
for (const e of log) {
  if (e.status === "applied") {
    console.log(`  APPLY ${e.id.padEnd(14)} surfaces: [${e.surfaces.join(", ")}]`);
  } else {
    console.log(`  ${e.status.toUpperCase()}   ${e.id.padEnd(14)} ${e.reason || ""}`);
  }
}

if (failed > 0) process.exit(1);
