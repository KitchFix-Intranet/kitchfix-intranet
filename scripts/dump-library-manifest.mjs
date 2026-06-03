// scripts/dump-library-manifest.mjs
// One-shot diagnostic: dump library_manifest (HUB sheet) + reconcile against
// the pr-7-2 catalog seed by normalized title.
//
// Purpose: decide which catalog documents will auto-link to a Drive file on
// the PR 7.2 manifest backfill vs which need manual Drive IDs. Run before
// touching pr-7-2-opd-seed.sql so the numbers are real, not estimated.
//
// Usage:
//   node --env-file=.env.local scripts/dump-library-manifest.mjs

import { readSheetSA, SHEET_IDS } from "../src/lib/sheets.js";
import { readFile } from "node:fs/promises";

const TAB = "library_manifest";

function normalizeTitle(t) {
  return String(t || "").toLowerCase().trim().replace(/\s+/g, " ");
}

async function main() {
  // ─── 1. Read manifest ───
  const { headers, rows } = await readSheetSA(SHEET_IDS.HUB, TAB);

  console.log("=".repeat(96));
  console.log(`library_manifest (HUB sheet) — ${rows.length} data rows`);
  console.log("=".repeat(96));
  console.log(`Headers: ${JSON.stringify(headers)}`);
  console.log();
  console.log("Row | drive_file_id      | category    | title                                   | act | pin | crit | sort");
  console.log("-".repeat(120));
  rows.forEach((r, i) => {
    const driveId  = String(r[0] || "").trim();
    const category = String(r[1] || "").trim();
    const title    = String(r[2] || "").trim();
    const pinned   = String(r[6] || "").trim().toUpperCase() === "TRUE";
    const critical = String(r[7] || "").trim().toUpperCase() === "TRUE";
    const sortOrd  = String(r[8] || "").trim();
    const active   = String(r[9] || "").trim().toUpperCase() !== "FALSE"; // default true
    console.log(
      `${String(i + 1).padStart(3)} | ${driveId.padEnd(18)} | ${category.padEnd(11)} | ${title.padEnd(39).slice(0, 39)} | ${active ? "y" : "n"}   | ${pinned ? "y" : "n"}   | ${critical ? "y" : "n"}    | ${sortOrd}`
    );
  });

  // ─── 2. Extract catalog titles from pr-7-2-opd-seed.sql ───
  // Parse only the INSERT INTO documents block (not relationships/surfaces),
  // and handle SQL '' escapes inside titles (e.g., "Workers'' Comp State Annex").
  // CRITICAL: strip SQL line comments (-- ... \n) BEFORE locating the closing
  // semicolon — the seed has a comment like "intentionally empty shelf; renders
  // short" between Culinary and Site & Client sections; a naive indexOf(';')
  // would treat that as the INSERT closer and drop everything after it.
  const seedSqlRaw = await readFile("docs/migrations/pr-7-2-opd-seed.sql", "utf8");
  const seedSql = seedSqlRaw.replace(/--[^\n]*/g, "");
  const docInsertStart = seedSql.indexOf("INSERT INTO documents");
  if (docInsertStart === -1) {
    throw new Error("Could not find 'INSERT INTO documents' in pr-7-2 seed");
  }
  const docInsertEnd = seedSql.indexOf(";", docInsertStart);
  const docInsertChunk = seedSql.slice(docInsertStart, docInsertEnd + 1);

  // Regex: matches the opening of each tuple — '<DOC_ID>','<TITLE>' — where
  // TITLE may contain '' as an escaped single quote.
  const catalogRe = /\('([A-Z0-9-]+)','((?:[^']|'')*)'/g;
  const catalog = [];
  let m;
  while ((m = catalogRe.exec(docInsertChunk)) !== null) {
    catalog.push({ id: m[1], title: m[2].replace(/''/g, "'") });
  }

  console.log();
  console.log("=".repeat(96));
  console.log(`pr-7-2 catalog seed — ${catalog.length} documents (parsed from INSERT INTO documents block)`);
  console.log("=".repeat(96));

  // ─── 3. Reconcile by normalized title ───
  const manifestByNorm = new Map();
  rows.forEach((r, i) => {
    const driveId = String(r[0] || "").trim();
    const title   = String(r[2] || "").trim();
    const active  = String(r[9] || "").trim().toUpperCase() !== "FALSE";
    if (!driveId || !title || !active) return;
    const norm = normalizeTitle(title);
    if (!manifestByNorm.has(norm)) {
      manifestByNorm.set(norm, { driveId, title, rowIdx: i + 1 });
    }
  });

  const matched = [];
  const catalogOrphans = [];
  for (const c of catalog) {
    const norm = normalizeTitle(c.title);
    const hit = manifestByNorm.get(norm);
    if (hit) {
      matched.push({ id: c.id, title: c.title, driveId: hit.driveId, manifestRow: hit.rowIdx });
    } else {
      catalogOrphans.push({ id: c.id, title: c.title });
    }
  }

  const usedNorms = new Set(matched.map((x) => normalizeTitle(x.title)));
  const manifestOrphans = [];
  for (const [norm, info] of manifestByNorm.entries()) {
    if (!usedNorms.has(norm)) manifestOrphans.push(info);
  }

  console.log();
  console.log("=".repeat(96));
  console.log("RECONCILIATION (normalized title match — lowercase + trim + collapse whitespace)");
  console.log("=".repeat(96));
  console.log();
  console.log(`✅ MATCHED (${matched.length}) — catalog docs that AUTO-LINK to a Drive file at PR 7.2 backfill:`);
  matched.forEach((m) => {
    console.log(`   ${m.id.padEnd(12)} ← ${m.driveId.padEnd(18)} (manifest row ${m.manifestRow})  "${m.title}"`);
  });
  console.log();
  console.log(`❌ CATALOG WITHOUT MANIFEST MATCH (${catalogOrphans.length}) — need MANUAL Drive ID after PR 7.2:`);
  catalogOrphans.forEach((o) => {
    console.log(`   ${o.id.padEnd(12)}    "${o.title}"`);
  });
  console.log();
  console.log(`⚠️  MANIFEST WITHOUT CATALOG MATCH (${manifestOrphans.length}) — flag for review (likely real docs missing from tracker):`);
  manifestOrphans.forEach((o) => {
    console.log(`   ${o.driveId.padEnd(18)} (row ${o.rowIdx})  "${o.title}"`);
  });
  console.log();
  console.log("=".repeat(96));
  console.log(`SUMMARY: ${matched.length} auto-link / ${catalogOrphans.length} need manual Drive ID / ${manifestOrphans.length} manifest orphans`);
  console.log("=".repeat(96));
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  console.error(e.stack);
  process.exit(1);
});
