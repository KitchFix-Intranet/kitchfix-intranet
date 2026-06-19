// ─────────────────────────────────────────────────────────────────────────────
// scripts/_probe_phase2_recon.mjs
// Phase 2 Deliverable 1 (verification) - one-shot Supabase recon.
//
// What this dumps:
//   - documents counts by status (the 7 enum values)
//   - documents counts by shelf (the 7 shelves + NULL)
//   - documents counts by doc_class (the 10 classes)
//   - archived count
//   - card_line readiness across the catalog (how many Live-bound docs need one)
//   - source_drive_id coverage (Drive sharing pre-flight)
//   - document_chunks: total + distinct doc_id (how many docs embedded)
//   - per-Live-doc embed status (which Live docs are/aren't embedded)
//
// Read-only. Safe to run anytime. Pattern matches the inventory/_probe_*
// scripts already in the repo.
//
// Run:
//   node --env-file=.env.local scripts/_probe_phase2_recon.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const STATUSES = ["Live", "In Build", "Draft", "Pending", "Placeholder", "Blocked", "Retired"];
const SHELVES = [
  "Safety",
  "Operations",
  "HR & People",
  "Culinary",
  "Brand & Standards",
  "Finance",
  "Site & Client",
];
const CLASSES = ["PB", "SOP", "TPL", "REF", "STD", "POL", "AGR", "FORM", "POST", "CHK"];

function bar(label, n, total) {
  const pct = total ? ((n / total) * 100).toFixed(0).padStart(3) : "  -";
  return `  ${label.padEnd(22)} ${String(n).padStart(4)}   ${pct}%`;
}

// ── Total documents ──────────────────────────────────────────────────────────
const { count: totalDocs, error: totalErr } = await sb
  .from("documents")
  .select("*", { count: "exact", head: true });
if (totalErr) {
  console.error(`documents total count failed: ${totalErr.message}`);
  process.exit(1);
}

console.log("═══════════════════════════════════════════════════════════════════");
console.log("  Phase 2 recon - Supabase catalog state");
console.log("═══════════════════════════════════════════════════════════════════");
console.log();
console.log(`  documents (total rows):           ${totalDocs}`);
console.log();

// ── By status ────────────────────────────────────────────────────────────────
console.log("  documents by status");
console.log("  -------------------");
for (const status of STATUSES) {
  const { count } = await sb
    .from("documents")
    .select("*", { count: "exact", head: true })
    .eq("status", status);
  console.log(bar(status, count || 0, totalDocs));
}
console.log();

// ── By shelf ─────────────────────────────────────────────────────────────────
console.log("  documents by shelf");
console.log("  ------------------");
for (const shelf of SHELVES) {
  const { count } = await sb
    .from("documents")
    .select("*", { count: "exact", head: true })
    .eq("shelf", shelf);
  console.log(bar(shelf, count || 0, totalDocs));
}
const { count: nullShelf } = await sb
  .from("documents")
  .select("*", { count: "exact", head: true })
  .is("shelf", null);
console.log(bar("(NULL)", nullShelf || 0, totalDocs));
console.log();

// ── By doc_class ─────────────────────────────────────────────────────────────
console.log("  documents by doc_class");
console.log("  ----------------------");
for (const cls of CLASSES) {
  const { count } = await sb
    .from("documents")
    .select("*", { count: "exact", head: true })
    .eq("doc_class", cls);
  console.log(bar(cls, count || 0, totalDocs));
}
console.log();

// ── Archived ─────────────────────────────────────────────────────────────────
const { count: archivedCount } = await sb
  .from("documents")
  .select("*", { count: "exact", head: true })
  .eq("archived", true);
console.log(`  archived = true:                   ${archivedCount || 0}`);
console.log();

// ── Live-readiness pre-flight signals ────────────────────────────────────────
console.log("  Live-readiness pre-flight signals (across ALL docs)");
console.log("  ----------------------------------------------------");
const { count: withVersion } = await sb
  .from("documents")
  .select("*", { count: "exact", head: true })
  .not("version", "is", null);
const { count: withCardLine } = await sb
  .from("documents")
  .select("*", { count: "exact", head: true })
  .not("card_line", "is", null);
const { count: withDrive } = await sb
  .from("documents")
  .select("*", { count: "exact", head: true })
  .not("source_drive_id", "is", null);
const { count: withSummary } = await sb
  .from("documents")
  .select("*", { count: "exact", head: true })
  .not("summary", "is", null);
console.log(`  version IS NOT NULL:               ${withVersion}`);
console.log(`  card_line IS NOT NULL:             ${withCardLine}`);
console.log(`  source_drive_id IS NOT NULL:       ${withDrive}`);
console.log(`  summary IS NOT NULL:               ${withSummary}`);
console.log();

// ── document_chunks ──────────────────────────────────────────────────────────
const { count: totalChunks } = await sb
  .from("document_chunks")
  .select("*", { count: "exact", head: true });
const { data: chunkDocIds } = await sb
  .from("document_chunks")
  .select("doc_id");
const distinctEmbedded = new Set((chunkDocIds || []).map((c) => c.doc_id));
console.log("  document_chunks");
console.log("  ---------------");
console.log(`  total chunks:                      ${totalChunks}`);
console.log(`  distinct docs embedded:            ${distinctEmbedded.size}`);
console.log();

// ── Per-Live-doc embed status ────────────────────────────────────────────────
const { data: liveDocs } = await sb
  .from("documents")
  .select("id, title, source_drive_id, version, card_line, doc_class")
  .eq("status", "Live")
  .order("id");

console.log("  Per-Live-doc Drive + embed status");
console.log("  ---------------------------------");
console.log(
  `  ${"id".padEnd(12)} ${"class".padEnd(6)} drive_id  ver  card  embedded?`
);
for (const d of liveDocs || []) {
  const id = d.id.padEnd(12);
  const cls = (d.doc_class || "?").padEnd(6);
  const drive = d.source_drive_id ? "YES     " : "no      ";
  const ver = d.version ? "Y" : "-";
  const card = d.card_line ? "Y" : "-";
  const embedded = distinctEmbedded.has(d.id) ? "YES" : "no";
  console.log(`  ${id} ${cls} ${drive} ${ver}    ${card}     ${embedded}`);
}
console.log();

// ── Gap: roughly-80-target vs actual ─────────────────────────────────────────
console.log("  Phase 2 target gap");
console.log("  ------------------");
console.log(`  Target (content side):              ~80 documents authored`);
console.log(`  In catalog now:                     ${totalDocs}`);
console.log(`  Catalog rows to author/migrate:     ~${Math.max(0, 80 - totalDocs)}`);
console.log();

console.log("═══════════════════════════════════════════════════════════════════");
console.log("  End probe.");
console.log("═══════════════════════════════════════════════════════════════════");
