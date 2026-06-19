// ════════════════════════════════════════════════════════════════════════════
// CANARY: re-extract ONE silent-gap invoice
//
// Default: DRY-RUN (downloads PDF + extracts pages + reports, no Claude
// call, no writes). --execute required to call extractAndStoreLineItems
// for real.
//
// WHAT IT DOES (--execute mode)
//   1. Resolves the invoice_submissions row by either client_uuid or PG id.
//   2. PRE-FLIGHT asserts: PG ai_line_items count = 0 AND Sheets count = 0
//      for this invoice. Aborts otherwise (PG dedup would 23505, or Sheets
//      append would silently duplicate).
//   3. Resolves raw_drive_url, downloads PDF bytes via service account.
//   4. Extracts image XObjects per page (DCTDecode/JPEG-only path, matching
//      backfill-stl-mo-line-items.mjs). Aborts if 0 usable pages produced.
//   5. Calls extractAndStoreLineItems(submission.client_uuid, pages, metadata) -
//      the same code path live submissions use via triggerAIScan.
//   6. POST-FLIGHT: re-counts PG + Sheets line items, prints final
//      ai_scan_status and ai_scan_complete.
//
// SAFETY
//   - DRY-RUN reads Drive + parses PDF but does NOT call Claude and does
//     NOT write anything to PG or Sheets. Lets you preview pages-found
//     and bail before paying for the model call.
//   - --execute is required for the Claude call + writes. Belt-and-
//     suspenders gate.
//   - PG partial UNIQUE index on (invoice_uuid, line_num) WHERE
//     is_historical=FALSE prevents duplicate PG inserts; Sheets has no
//     dedup, so the pre-flight Sheets=0 check is the only thing
//     protecting Sheets from silent duplicates.
//
// WHAT IT WILL NOT FIX
//   The root-cause bug at invoiceActions.js:1337 (markScanStatus('complete')
//   runs unconditionally after the try block, even when parsed.lineItems
//   is empty or when insertAILineItems threw via the inner try/catch at
//   line 1331). This script just recovers individual stranded invoices by
//   re-running the extraction path. New silent gaps can still appear from
//   future failed extractions until that bug is fixed as a separate PR.
//
// FAILURE MODES TO WATCH FOR
//   - Claude returns 0 line items (same as original failure mode for some
//     of the stranded set): post-flight shows PG=0 again, ai_scan_status=
//     'complete'. The invoice re-strands. Examine the [AI Scan] console
//     output for clues.
//   - Drive PDF has 0 image XObjects (digital PDF, not a photo wrapper):
//     dry-run extracts 0 pages and aborts before Claude. Needs a
//     different render path (out of scope for this canary).
//
// ARGS
//   --uuid=<id>   REQUIRED. Either client_uuid (the user-facing one) or
//                 PG submission.id (the FK in ai_line_items.invoice_uuid).
//                 Probe output shows both.
//   --execute     Required to do the Claude call + writes.
//
// USAGE
//   Dry-run (default):
//     node --import ./scripts/_setup/register-aliases.mjs \
//          --env-file=.env.local scripts/_rescan_silent_gap.mjs --uuid=<id>
//
//   Real:
//     node --import ./scripts/_setup/register-aliases.mjs \
//          --env-file=.env.local scripts/_rescan_silent_gap.mjs --uuid=<id> --execute
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";
import { PDFDocument, PDFName } from "pdf-lib";
import { getServiceAccountDriveClient, safeRead, SHEET_IDS } from "../src/lib/sheets.js";

// ── Args ──
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=", 2)[1];
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
}
const UUID = getArg("uuid");
const EXECUTE = args.includes("--execute");

if (!UUID) {
  console.error("[rescan] --uuid required (either client_uuid or PG submission.id)");
  process.exit(2);
}

// ── Env ──
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[rescan] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(2);
}
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log(`[rescan] ──────────────────────────────────────────────────────────`);
console.log(`[rescan] CANARY  uuid="${UUID}"  mode=${EXECUTE ? "EXECUTE" : "dry-run"}`);
console.log(`[rescan] ──────────────────────────────────────────────────────────`);

// ── 1. Resolve submission ──
// Try client_uuid first; if no match, try PG id.
let sub;
{
  const byClient = await supa
    .from("invoice_submissions")
    .select("id, client_uuid, account_key, vendor_name, vendor_id, invoice_number, invoice_date, submitted_at, ai_scan_status, ai_scan_complete, total_amount, page_count, raw_drive_url, drive_urls, type, status, is_historical")
    .eq("client_uuid", UUID)
    .maybeSingle();
  if (byClient.data) sub = byClient.data;
  else {
    const byId = await supa
      .from("invoice_submissions")
      .select("id, client_uuid, account_key, vendor_name, vendor_id, invoice_number, invoice_date, submitted_at, ai_scan_status, ai_scan_complete, total_amount, page_count, raw_drive_url, drive_urls, type, status, is_historical")
      .eq("id", UUID)
      .maybeSingle();
    if (byId.data) sub = byId.data;
  }
}
if (!sub) {
  console.error(`[rescan] could not resolve uuid="${UUID}" (no client_uuid or id match)`);
  process.exit(2);
}

console.log(`[rescan] resolved submission:`);
console.log(`[rescan]   PG id           : ${sub.id}`);
console.log(`[rescan]   client_uuid     : ${sub.client_uuid}`);
console.log(`[rescan]   account_key     : ${sub.account_key}`);
console.log(`[rescan]   vendor          : ${sub.vendor_name || "(null)"}  vendor_id=${sub.vendor_id || "(null)"}`);
console.log(`[rescan]   invoice         : #${sub.invoice_number || "(null)"}  date=${sub.invoice_date || "(null)"}`);
console.log(`[rescan]   total           : $${Number(sub.total_amount || 0).toFixed(2)}`);
console.log(`[rescan]   submitted_at    : ${(sub.submitted_at || "").slice(0, 19)}`);
console.log(`[rescan]   status          : ${sub.status}  is_historical=${sub.is_historical}`);
console.log(`[rescan]   ai_scan_status  : ${sub.ai_scan_status}  ai_scan_complete=${sub.ai_scan_complete}`);
console.log(`[rescan]   page_count      : ${sub.page_count == null ? "(null)" : sub.page_count}`);
console.log(`[rescan]   raw_drive_url   : ${sub.raw_drive_url ? "present" : "MISSING"}`);
console.log("");

// ── 2. Pre-flight: PG count + Sheets count must both be 0 ──
const { count: pgCount, error: pgErr } = await supa
  .from("ai_line_items")
  .select("id", { count: "exact", head: true })
  .eq("invoice_uuid", sub.id);
if (pgErr) {
  console.error(`[rescan] PG count failed: ${pgErr.message}`);
  process.exit(1);
}

let sheetsCount;
try {
  const { rows } = await safeRead(SHEET_IDS.AI_LINE_ITEMS, sub.account_key);
  sheetsCount = (rows || []).filter((r) => String(r[0] || "").trim() === sub.id).length;
} catch (e) {
  console.error(`[rescan] Sheets count failed for tab "${sub.account_key}": ${e.message}`);
  process.exit(1);
}

console.log(`[rescan] pre-flight counts:`);
console.log(`[rescan]   PG ai_line_items      : ${pgCount || 0}`);
console.log(`[rescan]   Sheets ai_line_items  : ${sheetsCount}`);

if ((pgCount || 0) !== 0 || sheetsCount !== 0) {
  console.error("");
  console.error(`[rescan] ABORT: pre-flight requires PG=0 AND Sheets=0; got PG=${pgCount || 0} Sheets=${sheetsCount}.`);
  console.error(`[rescan] Re-extraction would either 23505 (PG UNIQUE) or duplicate (Sheets append).`);
  process.exit(2);
}

if (!sub.raw_drive_url || !sub.raw_drive_url.trim()) {
  console.error("[rescan] ABORT: raw_drive_url is missing; cannot fetch source PDF.");
  process.exit(2);
}

// ── 3. Drive URL → file ID ──
function extractDriveFileId(url) {
  if (!url) return null;
  const m1 = url.match(/\/file\/d\/([^/]+)\//);
  if (m1) return m1[1];
  const m2 = url.match(/[?&]id=([^&]+)/);
  if (m2) return m2[1];
  if (/^[A-Za-z0-9_-]{20,}$/.test(url.trim())) return url.trim();
  return null;
}
const fileId = extractDriveFileId(sub.raw_drive_url);
if (!fileId) {
  console.error(`[rescan] ABORT: could not parse Drive file ID from raw_drive_url`);
  process.exit(2);
}
console.log(`[rescan]   raw drive fileId      : ${fileId}`);
console.log("");

// ── 4. Download PDF + extract pages (same in both dry-run and execute) ──
const drive = getServiceAccountDriveClient(["https://www.googleapis.com/auth/drive.readonly"]);

let bytes;
try {
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );
  bytes = Buffer.from(res.data);
} catch (e) {
  console.error(`[rescan] ABORT: Drive fetch failed: ${e.message}`);
  process.exit(1);
}
console.log(`[rescan] downloaded ${bytes.length} bytes from Drive`);

// PDF helpers (verbatim from scripts/backfill-stl-mo-line-items.mjs:310-380;
// duplicated rather than extracted into _lib/ because this canary is
// expected to be one-off recovery work. Re-extract to a shared helper if
// the rescan pattern gets reused.)
function pdfLookup(pdf, refOrObj) {
  if (!refOrObj) return null;
  try { return pdf.context.lookup(refOrObj); }
  catch { return refOrObj; }
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
    const width = dict.get(PDFName.of("Width"));
    const height = dict.get(PDFName.of("Height"));
    out.push({
      name: name?.encodedName || String(name),
      bytes: obj.contents,
      filter: filterName,
      width: width?.value?.() ?? width,
      height: height?.value?.() ?? height,
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
  else if (filter.includes("FlateDecode")) mediaType = null;
  else mediaType = null;
  if (!mediaType) return { error: `unsupported filter ${filter}` };
  const base64 = Buffer.from(img.bytes).toString("base64");
  return {
    page: { data: `data:${mediaType};base64,${base64}`, rotation: 0, type: "image" },
    bytes: img.bytes.length,
    mediaType,
    width: img.width,
    height: img.height,
  };
}

const pdf = await PDFDocument.load(bytes);
const pdfPageCount = pdf.getPageCount();
console.log(`[rescan] PDF page count: ${pdfPageCount}`);

const pages = [];
const pageReports = [];
for (let i = 0; i < pdfPageCount; i++) {
  const pg = pdf.getPage(i);
  const imgs = pageImageXObjects(pdf, pg);
  if (imgs.length === 0) {
    pageReports.push(`page ${i + 1}: no image XObjects (skipped)`);
    continue;
  }
  imgs.sort((a, b) => Number(b.bytes?.length || 0) - Number(a.bytes?.length || 0));
  const best = imgs[0];
  const result = imageXObjectToPage(best);
  if (!result || result.error) {
    pageReports.push(`page ${i + 1}: ${result?.error || "unsupported"} (skipped)`);
    continue;
  }
  pageReports.push(`page ${i + 1}: ${result.mediaType} ${result.width}x${result.height} ${result.bytes}B`);
  pages.push(result.page);
}
for (const r of pageReports) console.log(`[rescan]   ${r}`);
console.log(`[rescan] extracted ${pages.length} usable page image(s) (cap is 6 inside Claude prompt)`);
console.log("");

if (pages.length === 0) {
  console.error(`[rescan] ABORT: 0 usable pages extracted.`);
  console.error(`[rescan]   This canary only handles DCTDecode/JPEG photo-wrapped PDFs.`);
  console.error(`[rescan]   If this is a digital (born-digital text) PDF, a different`);
  console.error(`[rescan]   render path (pdf-to-image rasterizer) is needed; out of scope.`);
  process.exit(1);
}

// ── 5. Dry-run preview / execute branch ──
if (!EXECUTE) {
  console.log(`[rescan] DRY-RUN COMPLETE. Would, with --execute:`);
  console.log(`[rescan]   1. Call extractAndStoreLineItems(`);
  console.log(`[rescan]        invoiceUuid="${sub.id}",`);
  console.log(`[rescan]        pages=[${pages.length} page image(s)],`);
  console.log(`[rescan]        metadata={`);
  console.log(`[rescan]          account: "${sub.account_key}",`);
  console.log(`[rescan]          vendor: "${sub.vendor_name || ""}",`);
  console.log(`[rescan]          invoiceNumber: "${sub.invoice_number || ""}",`);
  console.log(`[rescan]          invoiceDate: "${sub.invoice_date || ""}",`);
  console.log(`[rescan]          formType: "${sub.type || "invoice"}"`);
  console.log(`[rescan]        }`);
  console.log(`[rescan]      )`);
  console.log(`[rescan]   2. Post-flight: re-count PG + Sheets, print final ai_scan_status.`);
  console.log("");
  console.log(`[rescan] Add --execute to do it for real (1 Claude call, writes to PG + Sheets).`);
  process.exit(0);
}

// ── 6. EXECUTE: load extractAndStoreLineItems, call it, post-flight ──
console.log(`[rescan] EXECUTE MODE — calling Claude + writing.`);
console.log("");

let extractAndStoreLineItems;
try {
  const mod = await import("../src/lib/invoiceActions.js");
  extractAndStoreLineItems = mod.extractAndStoreLineItems;
} catch (e) {
  console.error(`[rescan] failed to load invoiceActions.js: ${e.message}`);
  process.exit(1);
}
if (typeof extractAndStoreLineItems !== "function") {
  console.error(`[rescan] extractAndStoreLineItems not exported from invoiceActions.js`);
  process.exit(1);
}

const metadata = {
  account: sub.account_key,
  vendor: sub.vendor_name || "",
  invoiceNumber: sub.invoice_number || "",
  invoiceDate: sub.invoice_date || "",
  formType: sub.type || "invoice",
};

try {
  // CRITICAL: pass sub.client_uuid, NOT sub.id. The orchestrator's PG adapter
  // looks up by client_uuid (.eq("client_uuid", invoiceUuid) in
  // insertAILineItemsPostgres). Passing sub.id would write Sheets rows with
  // the wrong identifier + throw "submission X not in PG" - the bug that the
  // aborted sweep at task bo68osf5k hit. This script's bug was latent (no
  // successful --execute runs ever happened against current data), but
  // fixing it here removes the landmine.
  await extractAndStoreLineItems(sub.client_uuid, pages, metadata);
} catch (e) {
  console.error(`[rescan] extractAndStoreLineItems threw (unexpected; it catches internally): ${e.message}`);
}
console.log("");
console.log(`[rescan] extractAndStoreLineItems returned. Check "[AI Scan]" log lines above.`);
console.log("");

// ── 7. Post-flight ──
const { count: postPgCount } = await supa
  .from("ai_line_items")
  .select("id", { count: "exact", head: true })
  .eq("invoice_uuid", sub.id);

let postSheetsCount;
try {
  const { rows } = await safeRead(SHEET_IDS.AI_LINE_ITEMS, sub.account_key);
  postSheetsCount = (rows || []).filter((r) => String(r[0] || "").trim() === sub.id).length;
} catch (e) {
  postSheetsCount = `(read failed: ${e.message})`;
}

const { data: postSub } = await supa
  .from("invoice_submissions")
  .select("ai_scan_status, ai_scan_complete")
  .eq("id", sub.id)
  .maybeSingle();

console.log(`[rescan] post-flight:`);
console.log(`[rescan]   PG ai_line_items      : ${postPgCount || 0}  (was 0)`);
console.log(`[rescan]   Sheets ai_line_items  : ${postSheetsCount}  (was 0)`);
console.log(`[rescan]   ai_scan_status        : ${postSub?.ai_scan_status}`);
console.log(`[rescan]   ai_scan_complete      : ${postSub?.ai_scan_complete}`);
console.log("");
if ((postPgCount || 0) > 0) {
  console.log(`[rescan] ✓ canary appears successful (PG count > 0).`);
  console.log(`[rescan]   Verify the alarm's next silent-gap count drops by 1.`);
} else {
  console.log(`[rescan] ⚠ canary produced 0 PG rows. Possible causes:`);
  console.log(`[rescan]   - Claude returned 0 line items (same failure mode as the original strand)`);
  console.log(`[rescan]   - insertAILineItems threw and was swallowed at invoiceActions.js:1331`);
  console.log(`[rescan]   Read the "[AI Scan]" console output above for the exact path taken.`);
  console.log(`[rescan]   ai_scan_status='complete' on a 0-line-items row is the root-cause bug;`);
  console.log(`[rescan]   re-running this canary won't change the outcome without fixing it first.`);
}
console.log(`[rescan] ──────────────────────────────────────────────────────────`);
