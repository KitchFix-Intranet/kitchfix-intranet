// ─────────────────────────────────────────────────────────────────────────────
// scripts/sousai-extract-and-chunk.mjs
// SousAI · Layer 2 CLI · extract + chunk PB-002 (NO embedding, NO storage)
//
// Run:
//   node --env-file=.env.local scripts/sousai-extract-and-chunk.mjs
//
// Output: title, section count, chunking path (structure-aware vs size-based
// fallback), then each chunk's metadata + full content text.
//
// On auth failure (service account doesn't have Viewer on the Drive file),
// the script surfaces the GOOGLE_SERVICE_ACCOUNT_EMAIL value (and only that
// value) so Kevin can grant access from the Drive Share dialog, then re-run.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import { extractGoogleDoc } from "../src/lib/sousai/extract.js";
import { chunkSections } from "../src/lib/sousai/chunk.js";

const DOC_ID = "PB-002";
const DRIVE_FILE_ID = "1oH7CNiBh1EQg-3QhBgpUYPFnGE1UnernCKrBXKbNVTk";

function looksLikeDriveAuthError(err) {
  const msg = String(err?.message || "");
  return (
    /permission|forbidden|access|caller does not have|not found|404|403/i.test(msg)
  );
}

try {
  // Pull the canonical operator-facing title from the documents catalog. The
  // Docs API's title field is usually the Drive filename ("Allergen_Playbook_
  // PB-002_v1_0") - operators should never see that in a Sous citation, so
  // documents.title ("Allergen Playbook") is the source of truth for the
  // header text the chunker stamps onto every chunk.
  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data: docRow, error: docErr } = await sb
    .from("documents")
    .select("id, title")
    .eq("id", DOC_ID)
    .single();
  if (docErr || !docRow) {
    throw new Error(
      `documents catalog lookup failed for ${DOC_ID}: ${docErr?.message || "not found"}`
    );
  }
  const canonicalTitle = docRow.title;

  console.log(`Extracting ${DOC_ID} (Drive file ${DRIVE_FILE_ID}) ...`);
  console.log();

  const extracted = await extractGoogleDoc(DRIVE_FILE_ID);
  console.log(`Drive title:      ${extracted.driveTitle}`);
  console.log(`Catalog title:    ${canonicalTitle}  ← used for citations`);
  console.log(`Sections found:   ${extracted.sections.length}`);
  if (extracted.sections.length > 0) {
    console.log(`Section breakdown (ancestry > self):`);
    for (const s of extracted.sections) {
      if (s.heading) {
        const chain = [...(s.ancestry || []), s.heading].join(" > ");
        console.log(`  H${s.level ?? "?"}: ${chain} (${s.text.length} chars)`);
      } else {
        console.log(`  (unsectioned preamble, ${s.text.length} chars)`);
      }
    }
  }
  console.log();

  const { path, chunks } = chunkSections(extracted, {
    docId: DOC_ID,
    docTitle: canonicalTitle,
  });
  console.log(`Chunking path:    ${path === "structure-aware" ? "STRUCTURE-AWARE (headings detected, primary path)" : "SIZE-BASED FALLBACK (no headings - doc was structurally flat)"}`);
  console.log(`Chunks produced:  ${chunks.length}`);
  console.log();

  for (const c of chunks) {
    console.log(`──── chunk ${c.chunk_index} ─ section: ${c.section ?? "(no heading)"} ─ ${c.content.length} chars ─ ~${c.token_count} tokens ────`);
    console.log(c.content);
    console.log();
  }
} catch (e) {
  console.error(`ERROR: ${e.message}`);
  if (looksLikeDriveAuthError(e)) {
    console.error();
    console.error("This looks like a Drive auth issue. The service account needs Viewer");
    console.error("access on the PB-002 Drive file before extraction can read it.");
    console.error();
    const saEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "(GOOGLE_SERVICE_ACCOUNT_EMAIL not set in env)";
    console.error(`  Service account to share with:  ${saEmail}`);
    console.error();
    console.error("Open the PB-002 Drive file -> Share -> add that address as Viewer ->");
    console.error("then re-run this script.");
  }
  process.exit(1);
}
