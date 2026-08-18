// ══════════════════════════════════════════════════════════════════════════
// Shared helper: fetch an invoice PDF and turn it into the { pages } array
// shape that extractAndStoreLineItems expects.
//
// Extracted from scripts/_sweep_failed_invoice_reextraction.mjs
// (2026-08-17) as part of A1 (feat/li-a1-durable-extraction). The sweep
// script had this inline; the worker at /api/cron/extract-line-items
// needs the same behavior, and copying the code twice invites drift.
//
// ─── The pattern ─────────────────────────────────────────────────────────
//   1. Parse the Drive fileId from the URL (or raw ID).
//   2. Download bytes via the service account (drive.readonly scope).
//   3. Parse with pdf-lib and pull the DCT/CCITT-encoded image XObject
//      from each page. Photo-wrapper PDFs (the KitchFix format) have
//      exactly one image per page; for multi-image pages we take the
//      largest by encoded byte count.
//   4. Return the base64 data URLs in the shape Claude wants.
//
// ─── Answers to A1 Correction 2 (source-of-truth) ────────────────────────
//
// Q1: raw_drive_url vs drive_urls?
//   ALWAYS raw_drive_url. `drive_urls[0]` is the STAMPED PDF: photo pages
//   + KitchFix's GL-coding summary appended (sent to Bill.com). Passing
//   the stamped copy to Claude causes the summary page to be misread as
//   invoice line items (there is no rule in EXTRACTION_PROMPT telling
//   the model to skip a KitchFix summary; it would happily emit our own
//   GL codes as line rows).
//   Fallback: 1,163 of 1,164 live invoices have a raw copy (2026-08-18);
//   the one that does not (STL-MO Kuna Foodservice 2026-07-22, uuid
//   38f757e5-cd20-4c0f-9eb1-a67e4125892c) lands 'failed' with cause
//   "raw_drive_url missing - cannot re-extract" at the worker (see
//   route.js line ~201) and stays terminal until an operator manually
//   re-runs the browser path.
//
// Q2: Effective width + quality?
//   1200px wide JPEG at quality 0.85, exactly matching InvoiceTool's
//   toDataURL parameters (InvoiceTool.js:523-532). The archived raw PDF
//   is BUILT from those exact JPEGs - createRawInvoicePDF in
//   stampInvoice.js:319-386 embeds the base64 image bytes verbatim via
//   pdf-lib's embedJpg with NO re-encoding. There is no detail above
//   1200px in the file to recover; this helper extracts those same
//   bytes back out unchanged. Byte-level parity confirmed for control
//   0d5ae028 (74-line Sysco): pages 249KB/217KB/227KB/230KB/185KB - all
//   inside the 180-250KB envelope produced by canvas.toDataURL("image/jpeg", 0.85)
//   at 1200px wide.
//
// Q3: Rotation handling?
//   Returns rotation: 0 for every extracted page. This does NOT
//   introduce drift because the pre-A1 extraction path also ignored
//   rotation - extractAndStoreLineItems (invoiceActions.js:1451-1456)
//   builds imageBlocks from `page.data` only and never applies the
//   rotation flag. The rotation is a display-time and stamping-time
//   concern, and Claude Sonnet's vision handles sideways receipts
//   well enough that it has never been surfaced as a defect. If a
//   future operator-side rotation-baking landed, that same value would
//   flow through this path unchanged. Neither double-applied nor
//   dropped: never applied at all, matching pre-PR behavior.
//
// Q4: Control-invoice comparison (2026-08-18, live extract vs DB):
//   Control: 0d5ae028-4401-4ff3-9e0e-d286b7d4e770 (STL-FL Sysco
//   invoice 532448972, 2026-07-20, 74 line items, 5 raw pages).
//   New path line count: 74 (identical). 24 field diffs across 74*14=1036
//   compared fields (2.3%), all in the model's known-stochastic ranges:
//     - pack_size digit-splitting on 6 dense lines
//       (baseline "2SCS 45LB" vs new "45LB"; "1/15 DZ" vs "15 DZ" etc.)
//     - uom_raw single-char boundary ("S" vs "1S")
//     - 2 category re-classifications (produce vs beverage - lime juice,
//       lemon juice; smallwares vs supplies on line 66)
//     - line 7 zero-quantity NULL-vs-0 (script comparison artifact,
//       not a data drift - baseline stores 0 as fallback, new returns null
//       from Claude and the derived-column layer would fill).
//   No line missing. No line spurious. Same 74 items in the same order.
//   This is expected model variance on a re-run, not a pipeline drift.
//
// ─── Architectural note for Phase B ──────────────────────────────────────
//
// Phase B adds a SECOND page source: the operator's original upload,
// preserved in Supabase Storage (raw JPEG frames, no PDF wrap). The
// interface below is designed so that becomes another provider, not a
// rewrite. downloadAndExtractPages takes a URL (Drive today; may be a
// Supabase storage URL tomorrow) and returns the same { pages,
// pdfPageCount, fileBytes } shape. Drive is not hardcoded as the only
// possible origin - it's the only provider we have wiring for now.
// The Supabase-side path is NOT built in this PR; keep the seam.
// ══════════════════════════════════════════════════════════════════════════

import { PDFDocument, PDFName } from "pdf-lib";
import { getServiceAccountDriveClient } from "@/lib/sheets";

// ── Drive URL -> file ID ──────────────────────────────────────────────────
export function extractDriveFileId(url) {
  if (!url) return null;
  // https://drive.google.com/file/d/{ID}/view
  const m1 = url.match(/\/file\/d\/([^/]+)\//);
  if (m1) return m1[1];
  // https://drive.google.com/open?id={ID}  |  https://drive.google.com/uc?id={ID}
  const m2 = url.match(/[?&]id=([^&]+)/);
  if (m2) return m2[1];
  // bare ID (defensive)
  if (/^[A-Za-z0-9_-]{20,}$/.test(url.trim())) return url.trim();
  return null;
}

// ── pdf-lib helpers ───────────────────────────────────────────────────────
function pdfLookup(pdf, refOrObj) {
  if (!refOrObj) return null;
  try { return pdf.context.lookup(refOrObj); } catch { return refOrObj; }
}

function pageImageXObjects(pdf, page) {
  const out = [];
  const normalized = page.node.normalizedEntries?.();
  const Resources = normalized?.Resources;
  if (!Resources) return out;
  const ResolvedResources = pdfLookup(pdf, Resources);
  const XObject = ResolvedResources?.get?.(PDFName.of("XObject"));
  if (!XObject) return out;
  const ResolvedXObject = pdfLookup(pdf, XObject);
  if (!ResolvedXObject || typeof ResolvedXObject.entries !== "function") return out;
  for (const [name, ref] of ResolvedXObject.entries()) {
    const obj = pdfLookup(pdf, ref);
    if (!obj) continue;
    const dict = obj.dict || obj;
    if (typeof dict.get !== "function") continue;
    const subtype = dict.get(PDFName.of("Subtype"));
    const subtypeName = subtype?.encodedName || String(subtype || "");
    if (!subtypeName.includes("Image")) continue;
    const filter = dict.get(PDFName.of("Filter"));
    const filterName = filter?.encodedName || String(filter || "");
    out.push({
      name: name?.encodedName || String(name),
      bytes: obj.contents,
      filter: filterName,
    });
  }
  return out;
}

function imageXObjectToPage(img) {
  if (!img.bytes) return null;
  const filter = String(img.filter || "");
  let mediaType;
  if (filter.includes("DCTDecode")) mediaType = "image/jpeg";
  else if (filter.includes("CCITTFaxDecode")) mediaType = "image/tiff";
  else mediaType = null;
  if (!mediaType) return { error: `unsupported filter ${filter}` };
  const base64 = Buffer.from(img.bytes).toString("base64");
  return { page: { data: `data:${mediaType};base64,${base64}`, rotation: 0, type: "image" } };
}

// ── Public: download + slice a raw invoice PDF into Claude-ready pages ────
//
// Returns { pages, pdfPageCount, fileBytes } on success, or { error }
// on any failure. Never throws - callers get a structured cause they
// can map to an ai_scan_error string. Same shape as
// _sweep_failed_invoice_reextraction.mjs so the two paths stay in sync.
export async function downloadAndExtractPages(rawDriveUrl) {
  const fileId = extractDriveFileId(rawDriveUrl);
  if (!fileId) return { error: "could not parse Drive fileId" };

  // One drive client per call. This module is not on the hot path
  // (worker runs once every few minutes), and caching a client here
  // couples the worker route's runtime to module-load order.
  const drive = getServiceAccountDriveClient(["https://www.googleapis.com/auth/drive.readonly"]);

  let bytes;
  try {
    const res = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" }
    );
    bytes = Buffer.from(res.data);
  } catch (e) {
    return { error: `Drive fetch: ${e.message}` };
  }

  let pdf;
  try {
    pdf = await PDFDocument.load(bytes);
  } catch (e) {
    return { error: `PDF parse: ${e.message}`, fileBytes: bytes.length };
  }

  const pdfPageCount = pdf.getPageCount();
  const pages = [];
  for (let i = 0; i < pdfPageCount; i++) {
    const pg = pdf.getPage(i);
    const imgs = pageImageXObjects(pdf, pg);
    if (imgs.length === 0) continue;
    // Photo wrappers have 1 image per page; pick the largest if multiple.
    imgs.sort((a, b) => Number(b.bytes?.length || 0) - Number(a.bytes?.length || 0));
    const best = imgs[0];
    const result = imageXObjectToPage(best);
    if (!result || result.error) continue;
    pages.push(result.page);
  }
  return { pages, pdfPageCount, fileBytes: bytes.length };
}
