// ══════════════════════════════════════════════════════════════════════════
// Shared helper: download an invoice PDF from Drive and turn it into the
// { pages } array shape that extractAndStoreLineItems expects.
//
// Extracted verbatim from scripts/_sweep_failed_invoice_reextraction.mjs
// (2026-08-17) as part of A1 (feat/li-a1-durable-extraction). The sweep
// script had this inline; the worker at /api/cron/extract-line-items
// needs the same behavior, and copying the code twice invites drift.
//
// The pattern:
//   1. Parse the Drive fileId from the URL (or raw ID).
//   2. Download bytes via the service account (drive.readonly scope).
//   3. Parse with pdf-lib and pull the DCT/CCITT-encoded image XObject
//      from each page. Photo-wrapper PDFs (the KitchFix format) have
//      exactly one image per page; for multi-image pages we take the
//      largest by encoded byte count.
//   4. Return the base64 data URLs in the shape Claude wants.
//
// This is the raw path only. drive_urls[0] is the STAMPED PDF (photo +
// GL-coding summary page sent to bill.com); passing that to Claude
// causes the summary page to be misread as line items. Callers must
// hand this function the raw_drive_url or a specific unstamped URL.
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
