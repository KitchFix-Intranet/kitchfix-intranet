// ════════════════════════════════════════════════════════════════════════════
// PROBE: STL-MO raw_drive_url presence + raw PDF structure inspection
//
// Read-only investigation that informs Stage 1 of the STL-MO backfill:
//
//   1. Does PG invoice_submissions.raw_drive_url have a value for every
//      STL-MO submission in the cohort? Or were some never migrated and
//      we have to source from Sheet col Q / a local folder?
//
//   2. Are the raw PDFs (created by createRawInvoicePDF at upload time)
//      genuine multi-element vector PDFs, or are they just photo
//      images wrapped in a single-image PDF? If the latter, we can
//      extract the embedded image with pdf-lib (already installed) and
//      pass it as a page with REAL type ("image"), no rasterizer dep
//      needed.
//
// USAGE
//   node --import ./scripts/_setup/register-aliases.mjs \
//        --env-file=.env.local scripts/_probe-stl-mo-raw-pdf.mjs
//
// SCOPE
//   Read-only. No writes, no model calls, no Sheet writes.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import { getServiceAccountDriveClient } from "../src/lib/sheets.js";

const ACCOUNT_KEY = "STL - MO";
const SUBMITTED_AT_MIN = "2026-04-15T00:00:00.000Z";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[probe] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function extractDriveFileId(url) {
  if (!url) return null;
  const m1 = url.match(/\/file\/d\/([^/]+)\//);
  if (m1) return m1[1];
  const m2 = url.match(/[?&]id=([^&]+)/);
  if (m2) return m2[1];
  if (/^[A-Za-z0-9_-]{20,}$/.test(url.trim())) return url.trim();
  return null;
}

async function fetchDrivePdfBytes(drive, fileId) {
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data);
}

async function main() {
  console.log(`[probe] PART 1: raw_drive_url presence on the STL-MO cohort`);

  const { data: subs, error: subErr } = await supa
    .from("invoice_submissions")
    .select("id, client_uuid, submitted_at, invoice_number, vendor_name, total_amount, page_count, raw_drive_url, drive_urls")
    .eq("account_key", ACCOUNT_KEY)
    .gte("submitted_at", SUBMITTED_AT_MIN)
    .or("ai_scan_status.is.null,ai_scan_status.eq.photo-only")
    .order("submitted_at", { ascending: true });
  if (subErr) throw new Error(`PG query failed: ${subErr.message}`);

  // Re-derive zero-line-items at run time (matches Stage 0).
  const ids = subs.map((s) => s.id);
  const { data: lineRows, error: lineErr } = await supa
    .from("ai_line_items")
    .select("invoice_uuid")
    .in("invoice_uuid", ids);
  if (lineErr) throw new Error(`PG line-item count failed: ${lineErr.message}`);
  const haveLineItems = new Set((lineRows || []).map((r) => r.invoice_uuid));
  const cohort = subs.filter((s) => !haveLineItems.has(s.id));

  console.log(`[probe] cohort size (zero line items): ${cohort.length}`);

  const withRaw = cohort.filter((s) => (s.raw_drive_url || "").trim());
  const withoutRaw = cohort.filter((s) => !(s.raw_drive_url || "").trim());
  console.log(`[probe]   with raw_drive_url    : ${withRaw.length}`);
  console.log(`[probe]   without raw_drive_url : ${withoutRaw.length}`);

  if (withoutRaw.length > 0) {
    console.log(`[probe] missing-raw sample (first 5):`);
    for (const r of withoutRaw.slice(0, 5)) {
      const driveArr = Array.isArray(r.drive_urls) ? r.drive_urls : [];
      console.log(`[probe]   ${r.client_uuid}  ${r.submitted_at}  drive_urls=${driveArr.length} entries`);
    }
  }

  // For PART 2 we need at least one raw URL.
  if (withRaw.length === 0) {
    console.log(`[probe] Cannot proceed to PART 2: no raw_drive_url available in PG.`);
    return;
  }

  console.log(``);
  console.log(`[probe] PART 2: structure inspection on the first raw PDF`);

  // Look for City Seafood INV25406 specifically (per Stage 1 spec); if not in
  // the cohort, fall back to the first available raw.
  const targetCS = withRaw.find((s) => {
    const inv = String(s.invoice_number || "").trim();
    const vendor = String(s.vendor_name || "").toLowerCase();
    return inv === "INV25406" || inv === "25406" || (vendor.includes("city seafood") && inv.includes("25406"));
  });
  const cs = withRaw.find((s) => String(s.vendor_name || "").toLowerCase().includes("city seafood"));
  const sample = targetCS || cs || withRaw[0];
  console.log(`[probe] sample: client_uuid=${sample.client_uuid}`);
  console.log(`[probe]   vendor=${sample.vendor_name || "?"}, invoice#=${sample.invoice_number || "?"}, total=${sample.total_amount}, page_count_stored=${sample.page_count}`);
  console.log(`[probe]   raw_drive_url=${sample.raw_drive_url}`);

  const fileId = extractDriveFileId(sample.raw_drive_url);
  if (!fileId) {
    console.log(`[probe] could not parse fileId from raw_drive_url. Cannot proceed.`);
    return;
  }

  const drive = getServiceAccountDriveClient(["https://www.googleapis.com/auth/drive.readonly"]);
  const bytes = await fetchDrivePdfBytes(drive, fileId);
  console.log(`[probe]   downloaded ${bytes.length} bytes from Drive (SA)`);

  const pdf = await PDFDocument.load(bytes);
  const pageCount = pdf.getPageCount();
  console.log(`[probe]   pdf-lib page count: ${pageCount}`);

  // Inspect each page's content: count embedded image objects vs other.
  // pdf-lib does not expose render-level info, but we can introspect the
  // raw page dictionary's XObject map. The presence of a single Image
  // XObject + minimal content stream means "photo wrapped in a PDF".
  for (let i = 0; i < pageCount; i++) {
    const page = pdf.getPage(i);
    const { width, height } = page.getSize();

    // Walk the page's Resources -> XObject dictionary.
    const resources = page.node.Resources?.();
    let imageCount = 0;
    let xObjectCount = 0;
    let imageNames = [];
    if (resources) {
      const xObjects = resources.lookup ? resources.lookup(/* PDFName('XObject') */ undefined) : null;
      // The pdf-lib API for resource introspection is brittle in user-code.
      // Use the PDF object map directly.
      const dict = page.node.dict || page.node;
      try {
        const xobjEntry = page.node.get?.(/* try to retrieve */ undefined);
        // Fall through to the lower-level approach below.
      } catch { /* ignore */ }
    }
    // Lower-level: walk the page dict's Resources/XObject directly via
    // the PDFDict map. pdf-lib exposes node.dict.context indirectly.
    try {
      const Resources = page.node.normalizedEntries?.().Resources;
      const xobjDict = Resources?.lookup?.(/* PDFName.of('XObject') */) ;
      // Best-effort: stringify keys.
      // If introspection is too brittle, fall back to a textual scan of
      // the page's content stream below.
    } catch { /* ignore */ }

    // Textual heuristic on the rendered page content stream.
    const contentStream = page.node.normalizedEntries?.().Contents;
    let streamText = "";
    if (contentStream) {
      const streams = Array.isArray(contentStream) ? contentStream : [contentStream];
      for (const s of streams) {
        try {
          const obj = page.doc.context.lookup(s);
          if (obj && obj.contents) {
            streamText += Buffer.from(obj.contents).toString("latin1");
          }
        } catch { /* ignore */ }
      }
    }

    // Heuristic markers:
    //   "/Im" or "Do" - image XObject invocation
    //   "BT ... ET"   - text rendering blocks
    //   "re"/"f"      - vector rect fills (form chrome)
    const hasImageDo = /\/Im\d+\s+Do|\bDo\b/.test(streamText);
    const textBlocks = (streamText.match(/\bBT\b/g) || []).length;
    const vectorOps  = (streamText.match(/\b(re|f|S|B)\b/g) || []).length;
    const streamLen  = streamText.length;

    console.log(`[probe]   page ${i + 1}: ${Math.round(width)}x${Math.round(height)}  stream=${streamLen}B  image_invocations=${hasImageDo ? "YES" : "no"}  text_blocks=${textBlocks}  vector_ops=${vectorOps}`);
  }

  // Direct introspection of image XObjects, the authoritative answer.
  // Walk the document's indirect object map and count Image XObjects.
  const allObjs = pdf.context.enumerateIndirectObjects();
  let imageObjects = 0;
  let imageSummaries = [];
  for (const [ref, obj] of allObjs) {
    try {
      const dict = obj.dict;
      if (!dict || typeof dict.get !== "function") continue;
      const Type = dict.get(/* PDFName.of('Type') */ pdf.context.obj("Type"));
      const Subtype = dict.get(pdf.context.obj("Subtype"));
      // pdf-lib name lookups may return PDFName instances; compare by name.
      const typeStr = Type?.encodedName || Type?.value?.() || String(Type || "");
      const subtypeStr = Subtype?.encodedName || Subtype?.value?.() || String(Subtype || "");
      if (subtypeStr.includes("Image")) {
        imageObjects++;
        const Width = dict.get(pdf.context.obj("Width"));
        const Height = dict.get(pdf.context.obj("Height"));
        const Filter = dict.get(pdf.context.obj("Filter"));
        const filterStr = Filter?.encodedName || Filter?.value?.() || String(Filter || "");
        imageSummaries.push({
          ref: `${ref.objectNumber} ${ref.generationNumber}`,
          width: Width?.value?.() ?? Width,
          height: Height?.value?.() ?? Height,
          filter: filterStr,
          size: obj.contents?.length ?? 0,
        });
      }
    } catch { /* ignore */ }
  }
  console.log(`[probe]   total image XObjects in pdf: ${imageObjects}`);
  for (const s of imageSummaries.slice(0, 8)) {
    console.log(`[probe]     ref ${s.ref}: ${s.width}x${s.height}  filter=${s.filter}  bytes=${s.size}`);
  }

  console.log(``);
  console.log(`[probe] VERDICT GUIDANCE:`);
  console.log(`[probe]   - If image XObjects == page count AND filter includes DCTDecode (JPEG)`);
  console.log(`[probe]     or FlateDecode/CCITTFaxDecode, the pages are photos wrapped in PDFs.`);
  console.log(`[probe]     We can extract the embedded image bytes with pdf-lib (already installed)`);
  console.log(`[probe]     and pass them to extractAndStoreLineItems as type="image" pages. NO`);
  console.log(`[probe]     rasterizer dep needed.`);
  console.log(`[probe]   - If image XObjects << page count OR vector_ops/text_blocks dominate,`);
  console.log(`[probe]     the pages have real PDF structure and must be rasterized. Then we`);
  console.log(`[probe]     need pdfjs-dist + @napi-rs/canvas (or equivalent).`);
}

main().catch((e) => {
  console.error(`[probe] FATAL: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
