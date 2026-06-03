// ════════════════════════════════════════════════════════════════════════════
// BACKFILL: STL-MO AI line items missed by the hasDigitalPDF guard
//
// WHY
//   The hasDigitalPDF guard at src/lib/invoiceActions.js (removed in
//   commit 59a083e, deployed) pre-skipped AI line-item extraction for
//   submissions whose pages were all non-PDF (camera / image uploads).
//   STL-MO's submitter switched workflows in mid-April; 133 submissions
//   since 2026-04-15 have zero line items.
//
//   Their PDFs (stamped + raw) are in Drive via drive_urls /
//   raw_drive_url on invoice_submissions. Backfill = re-extract from
//   the Drive PDFs we already have, through the same extraction +
//   write path live submissions now use.
//
// STAGING
//   --stage=dry-run   (default) reconciliation only. No reads of PDF
//                     bytes, no model calls, no writes. Validates the
//                     target set against PG + Drive metadata.
//   --stage=batch     real writes, first --limit (default 5) invoices.
//                     Reuses the live extraction path (refactored
//                     extractAndStoreLineItems in invoiceActions.js).
//                     STOP for Kevin review after.
//   --stage=full      real writes, all remaining targets. Same per-
//                     invoice path as --stage=batch.
//
//   The --execute flag is ALSO required for any stage that writes.
//   Without --execute, --stage=batch and --stage=full run in their
//   own dry-run mode (resolve, fetch PDF metadata, would-extract but
//   skip the model call + writes). This is a belt-and-suspenders
//   guard against fat-fingered invocation.
//
// IDEMPOTENCY
//   Target set re-derived at run time as:
//     account_key = 'STL - MO'
//     submitted_at >= '2026-04-15'
//     ai_scan_status IS NULL OR ai_scan_status = 'photo-only'
//     no rows in ai_line_items for that submission.id
//
//   The 'NULL or photo-only' clause is load-bearing: post-PR-6.2
//   dual-write, the 'photo-only' status write was a Sheets-side no-op
//   so 132 of 133 are NULL and 1 is 'photo-only'. Filtering on
//   'photo-only' alone misses 132 of 133.
//
//   The 'no rows in ai_line_items' clause is the hard idempotency
//   key: a re-run after partial completion skips invoices already
//   processed. The live extraction's insertAILineItems writes by
//   submission.id (PG FK) so this check is exact.
//
// HISTORICAL PRICING
//   Backfilled line items carry the invoice's OWN invoice_date.
//   Because the cron's promotion to price_history / item_catalog
//   orders by invoice_date and the matched item's lastPrice updates
//   only when newer, a two-month-old backfilled line cannot present
//   as the current price.
//
//   The arithmetic gate (deployed in fix/arithmetic-gate-at-write
//   commit e555e62 in kitchfix-inventory-cron) runs on these rows
//   the same way it runs on live ones. Clean lines promote, bad
//   reads route to review_queue with reason='arithmetic_fail'.
//
// OUT OF SCOPE
//   Invoice CAPTURE / bill.com path. Item_catalog / price_history
//   direct writes (the cron owns those). Local-folder fallback for
//   submissions whose Drive PDFs are missing - flagged at dry-run,
//   not processed here.
//
// USAGE
//   Dry run (default):
//     node --import ./scripts/_setup/register-aliases.mjs \
//          --env-file=.env.local scripts/backfill-stl-mo-line-items.mjs
//
//   5-invoice batch (real writes):
//     node --import ./scripts/_setup/register-aliases.mjs \
//          --env-file=.env.local scripts/backfill-stl-mo-line-items.mjs \
//          --stage=batch --limit=5 --execute
//
//   Full (real writes):
//     node --import ./scripts/_setup/register-aliases.mjs \
//          --env-file=.env.local scripts/backfill-stl-mo-line-items.mjs \
//          --stage=full --execute
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";
import { PDFDocument, PDFName } from "pdf-lib";
import { getServiceAccountDriveClient, safeRead, appendRowsSA, SHEET_IDS } from "../src/lib/sheets.js";

// ── Args ──
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=", 2)[1];
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
}
const STAGE = getArg("stage", "dry-run");
const LIMIT = parseInt(getArg("limit", "5"), 10);
const EXECUTE = args.includes("--execute");

if (!["dry-run", "batch", "full", "replay-pg", "hold-overcount-kuna"].includes(STAGE)) {
  console.error(`[backfill] Unknown --stage="${STAGE}". Valid: dry-run, batch, full, replay-pg, hold-overcount-kuna.`);
  process.exit(2);
}

// ── Target set parameters ──
const ACCOUNT_KEY = "STL - MO";
const SUBMITTED_AT_MIN = "2026-04-15T00:00:00.000Z";

// ── Env validation ──
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[backfill] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(2);
}

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Drive URL -> file ID ──
function extractDriveFileId(url) {
  if (!url) return null;
  // Format 1: https://drive.google.com/file/d/{ID}/view
  const m1 = url.match(/\/file\/d\/([^/]+)\//);
  if (m1) return m1[1];
  // Format 2: https://drive.google.com/open?id={ID}
  const m2 = url.match(/[?&]id=([^&]+)/);
  if (m2) return m2[1];
  // Format 3: https://drive.google.com/uc?id={ID}
  // (covered by format 2 since id= is the query param)
  // Format 4: bare ID (defensive)
  if (/^[A-Za-z0-9_-]{20,}$/.test(url.trim())) return url.trim();
  return null;
}

// Return the RAW Drive URL ONLY. raw_drive_url is the unstamped photo
// PDF; drive_urls[0] is the stamped file (photo + GL-coding summary
// page) sent to bill.com. Extraction MUST use raw, never stamped, or
// the summary page is misread as line items. If raw is missing on a
// row, this returns null and the row is skipped at Stage 1; Stage 0
// reconciliation buckets it separately so we know it needs a fallback
// source (Sheet col Q lookup or local folder).
function pickRawDriveUrl(row) {
  const raw = (row.raw_drive_url || "").trim();
  if (raw) return { source: "raw_drive_url", url: raw };
  return null;
}

// ── 1. Query target set ──
async function loadTargets() {
  // Fetch all candidate submissions (filters that index in PG).
  const { data: subs, error: subErr } = await supa
    .from("invoice_submissions")
    .select("id, client_uuid, submitted_at, submitter_email, account_key, vendor_name, vendor_id, invoice_number, invoice_date, total_amount, page_count, raw_drive_url, drive_urls, ai_scan_status, status, type")
    .eq("account_key", ACCOUNT_KEY)
    .gte("submitted_at", SUBMITTED_AT_MIN)
    .or("ai_scan_status.is.null,ai_scan_status.eq.photo-only")
    .order("submitted_at", { ascending: true });
  if (subErr) throw new Error(`[backfill] target query failed: ${subErr.message}`);

  // Re-derive the "zero line items" filter at run time.
  const ids = subs.map((s) => s.id);
  if (ids.length === 0) return [];

  const { data: lineRows, error: lineErr } = await supa
    .from("ai_line_items")
    .select("invoice_uuid")
    .in("invoice_uuid", ids);
  if (lineErr) throw new Error(`[backfill] line-item count query failed: ${lineErr.message}`);

  const haveLineItems = new Set((lineRows || []).map((r) => r.invoice_uuid));
  return subs.map((s) => ({
    ...s,
    hasLineItems: haveLineItems.has(s.id),
  }));
}

// ── 2. Drive metadata HEAD check via SA ──
async function checkDriveFile(drive, fileId) {
  try {
    const res = await drive.files.get({
      fileId,
      fields: "id, name, mimeType, size, trashed",
      supportsAllDrives: true,
    });
    const f = res.data;
    if (f.trashed) return { ok: false, reason: "trashed" };
    if (!f.id) return { ok: false, reason: "no_id_returned" };
    return { ok: true, name: f.name, mimeType: f.mimeType, size: f.size };
  } catch (e) {
    const msg = e?.errors?.[0]?.message || e.message || String(e);
    // 404 -> dead. 403 -> SA lacks access. Both are "not fetchable now."
    const code = e?.code || e?.response?.status || 0;
    return { ok: false, reason: `drive_${code || "err"}: ${msg.slice(0, 120)}` };
  }
}

// ── Stage 0: dry-run reconciliation map ──
async function stageDryRun() {
  console.log(`[backfill] === STAGE 0: DRY RUN ===`);
  console.log(`[backfill] target filter: account_key='${ACCOUNT_KEY}', submitted_at >= '${SUBMITTED_AT_MIN}', ai_scan_status IS NULL OR = 'photo-only'`);
  console.log(`[backfill] re-deriving zero-line-items check at run time...`);

  const targets = await loadTargets();
  console.log(`[backfill] PG returned ${targets.length} submissions matching the status + window filter.`);

  const alreadyDone = targets.filter((t) => t.hasLineItems);
  const needsBackfill = targets.filter((t) => !t.hasLineItems);
  console.log(`[backfill] already have line items (idempotent skip): ${alreadyDone.length}`);
  console.log(`[backfill] need backfill: ${needsBackfill.length}`);

  // Auth Drive SA only when there is work to do.
  if (needsBackfill.length === 0) {
    console.log(`[backfill] Nothing to do; no fetchable check needed.`);
    return;
  }

  const drive = getServiceAccountDriveClient(["https://www.googleapis.com/auth/drive.readonly"]);
  const buckets = {
    fetchable: [],
    no_url_at_all: [],
    bad_url_format: [],
    drive_inaccessible: [],
  };
  const aiStatusCount = { null: 0, "photo-only": 0, other: 0 };

  let i = 0;
  for (const t of needsBackfill) {
    i++;
    const statusKey = t.ai_scan_status == null ? "null" : t.ai_scan_status;
    if (statusKey === "null") aiStatusCount.null++;
    else if (statusKey === "photo-only") aiStatusCount["photo-only"]++;
    else aiStatusCount.other++;

    const picked = pickRawDriveUrl(t);
    if (!picked) {
      buckets.no_url_at_all.push({ uuid: t.client_uuid, submitted_at: t.submitted_at });
      continue;
    }
    const fileId = extractDriveFileId(picked.url);
    if (!fileId) {
      buckets.bad_url_format.push({ uuid: t.client_uuid, source: picked.source, url: picked.url.slice(0, 80) });
      continue;
    }
    const meta = await checkDriveFile(drive, fileId);
    if (!meta.ok) {
      buckets.drive_inaccessible.push({ uuid: t.client_uuid, source: picked.source, fileId, reason: meta.reason });
      continue;
    }
    buckets.fetchable.push({
      uuid: t.client_uuid,
      submitted_at: t.submitted_at,
      source: picked.source,
      fileId,
      mimeType: meta.mimeType,
      size: meta.size,
      page_count: t.page_count,
    });

    if (i % 25 === 0) {
      console.log(`[backfill]   progress: checked ${i}/${needsBackfill.length} (fetchable=${buckets.fetchable.length}, missing=${buckets.no_url_at_all.length + buckets.bad_url_format.length + buckets.drive_inaccessible.length})`);
    }
  }

  console.log(``);
  console.log(`[backfill] RECONCILIATION MAP:`);
  console.log(`[backfill]   already_have_line_items   : ${alreadyDone.length}  (idempotent skip)`);
  console.log(`[backfill]   needs_backfill_total      : ${needsBackfill.length}`);
  console.log(`[backfill]     fetchable_pdf           : ${buckets.fetchable.length}`);
  console.log(`[backfill]     no_drive_url_at_all     : ${buckets.no_url_at_all.length}  (fallback-to-local-folder candidates)`);
  console.log(`[backfill]     bad_url_format          : ${buckets.bad_url_format.length}  (URL stored but unparseable; manual review)`);
  console.log(`[backfill]     drive_inaccessible      : ${buckets.drive_inaccessible.length}  (404 / 403 / trashed; manual review)`);
  console.log(``);
  console.log(`[backfill] AI_SCAN_STATUS DISTRIBUTION ON NEED-BACKFILL SET:`);
  console.log(`[backfill]   ai_scan_status IS NULL    : ${aiStatusCount.null}`);
  console.log(`[backfill]   ai_scan_status='photo-only': ${aiStatusCount["photo-only"]}`);
  if (aiStatusCount.other > 0) {
    console.log(`[backfill]   ai_scan_status=other      : ${aiStatusCount.other}  (unexpected; review)`);
  }

  if (buckets.no_url_at_all.length || buckets.bad_url_format.length || buckets.drive_inaccessible.length) {
    console.log(``);
    console.log(`[backfill] DEFERRED (will NOT be processed in batch/full stages):`);
    for (const r of buckets.no_url_at_all.slice(0, 10)) {
      console.log(`[backfill]   no_url: ${r.uuid}  ${r.submitted_at}`);
    }
    if (buckets.no_url_at_all.length > 10) console.log(`[backfill]   ... +${buckets.no_url_at_all.length - 10} more no_url`);
    for (const r of buckets.bad_url_format.slice(0, 10)) {
      console.log(`[backfill]   bad_url_format: ${r.uuid}  source=${r.source}  url="${r.url}"`);
    }
    if (buckets.bad_url_format.length > 10) console.log(`[backfill]   ... +${buckets.bad_url_format.length - 10} more bad_url_format`);
    for (const r of buckets.drive_inaccessible.slice(0, 10)) {
      console.log(`[backfill]   drive_inaccessible: ${r.uuid}  source=${r.source}  fileId=${r.fileId}  reason=${r.reason}`);
    }
    if (buckets.drive_inaccessible.length > 10) console.log(`[backfill]   ... +${buckets.drive_inaccessible.length - 10} more drive_inaccessible`);
  }

  console.log(``);
  console.log(`[backfill] STAGE 0 COMPLETE. No writes performed. No model calls made.`);
  console.log(`[backfill] To proceed: review the map, then re-run with --stage=batch --limit=5 --execute.`);
  console.log(`[backfill] Stage 1 (batch) requires the extractAndStoreLineItems export to be on main.`);
}

// ════════════════════════════════════════════════════════════════════════════
// PDF -> page images (no rasterizer needed for STL-MO photo wrappers)
// ════════════════════════════════════════════════════════════════════════════

// pdf-lib lookup helper: resolve a PDFRef (or pass through a direct
// object). Some pdf-lib API surfaces hand back refs, others hand back
// resolved objects; this normalizes.
function pdfLookup(pdf, refOrObj) {
  if (!refOrObj) return null;
  try {
    return pdf.context.lookup(refOrObj);
  } catch {
    return refOrObj;
  }
}

// Walk a page's Resources.XObject dict and return every Image XObject.
// For STL-MO raw PDFs (photo wrappers), this is one JPEG per page.
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

// Convert one extracted Image XObject into a live-path-shaped page entry.
// DCTDecode is raw JPEG bytes; we wrap as a data URL with type="image"
// (the REAL type for these photo-wrapped uploads). Other filters are
// flagged but not handled today; the cohort probe showed 100% DCTDecode.
function imageXObjectToPage(img) {
  if (!img.bytes) return null;
  const filter = String(img.filter || "");
  let mediaType;
  if (filter.includes("DCTDecode")) mediaType = "image/jpeg";
  else if (filter.includes("CCITTFaxDecode")) mediaType = "image/tiff"; // not Anthropic-supported
  else if (filter.includes("FlateDecode")) mediaType = null; // raw pixel data, not handled
  else mediaType = null;
  if (!mediaType) return { error: `unsupported filter ${filter}` };
  const base64 = Buffer.from(img.bytes).toString("base64");
  return {
    page: {
      data: `data:${mediaType};base64,${base64}`,
      rotation: 0,
      type: "image",
    },
    bytes: img.bytes.length,
    mediaType,
    width: img.width,
    height: img.height,
  };
}

async function fetchDrivePdfBytes(drive, fileId) {
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data);
}

// ── Arithmetic check: identical to the cron's gate ──
function arithmeticCheck(li) {
  const qty = Number(li.quantity ?? li.qty ?? 0);
  const unit = Number(li.unit_price ?? li.unitPrice ?? 0);
  const ext = Number(li.extended_price ?? li.extendedPrice ?? 0);
  const calc = qty * unit;
  const tol = 0.02 * Math.abs(ext) + 0.01;
  return { ok: Math.abs(calc - ext) <= tol, calc, ext, qty, unit, drift: Math.abs(calc - ext) };
}

// ── Stage 1 / 2: real writes via the live extraction path ──
async function stageBatchOrFull() {
  if (!EXECUTE) {
    console.log(`[backfill] --stage=${STAGE} requires --execute to write.`);
    console.log(`[backfill] Add --execute to perform real writes via extractAndStoreLineItems.`);
    process.exit(2);
  }

  // Import the live extractor at run time so dry-run never depends on
  // the refactor being merged.
  let extractAndStoreLineItems;
  try {
    const mod = await import("../src/lib/invoiceActions.js");
    extractAndStoreLineItems = mod.extractAndStoreLineItems;
  } catch (e) {
    console.error(`[backfill] failed to load invoiceActions.js: ${e.message}`);
    process.exit(2);
  }
  if (typeof extractAndStoreLineItems !== "function") {
    console.error(`[backfill] extractAndStoreLineItems is not exported on this branch.`);
    console.error(`[backfill] Pull main after PR #110 (refactor) merges, then retry.`);
    process.exit(2);
  }

  const cohort = await loadTargets();
  const pending = cohort.filter((t) => !t.hasLineItems);
  console.log(`[backfill] cohort=${cohort.length}  pending=${pending.length}`);

  const maxToProcess = STAGE === "batch" ? LIMIT : pending.length;
  const targets = [];
  for (const t of pending) {
    if (targets.length >= maxToProcess) break;
    const picked = pickRawDriveUrl(t);
    if (!picked) continue; // skip rows lacking raw_drive_url
    targets.push({ row: t, ...picked });
  }
  console.log(`[backfill] selected ${targets.length} target(s) for stage=${STAGE}`);

  const drive = getServiceAccountDriveClient(["https://www.googleapis.com/auth/drive.readonly"]);

  let cleanCount = 0, holdCount = 0, processed = 0, skippedIdempotent = 0, errored = 0;
  const perInvoice = [];

  for (const t of targets) {
    const uuid = t.row.client_uuid;
    const submissionId = t.row.id;
    const accountKey = t.row.account_key;
    console.log(``);
    console.log(`[backfill] ──── ${uuid}  (${t.row.vendor_name || "?"} #${t.row.invoice_number || "?"})  total=$${Number(t.row.total_amount || 0).toFixed(2)}`);

    // RE-DERIVE the zero-line-items idempotency check immediately
    // before processing. Defends against a race where another writer
    // (live submission, retry) inserted line items between loadTargets
    // and this loop iteration.
    const { count: existingCount } = await supa
      .from("ai_line_items")
      .select("id", { count: "exact", head: true })
      .eq("invoice_uuid", submissionId);
    if ((existingCount || 0) > 0) {
      console.log(`[backfill]   SKIP idempotent: ${existingCount} line item(s) already present`);
      skippedIdempotent++;
      perInvoice.push({ uuid, skipped: true });
      continue;
    }

    console.log(`[backfill]   url(raw): ${t.url}`);
    let bytes;
    try {
      const fileId = extractDriveFileId(t.url);
      bytes = await fetchDrivePdfBytes(drive, fileId);
    } catch (e) {
      console.log(`[backfill]   ERROR drive fetch: ${e.message}`);
      errored++;
      perInvoice.push({ uuid, error: `drive_fetch: ${e.message}` });
      continue;
    }
    console.log(`[backfill]   downloaded ${bytes.length} bytes`);

    let pages;
    try {
      const pdf = await PDFDocument.load(bytes);
      const pdfPageCount = pdf.getPageCount();
      pages = [];
      for (let i = 0; i < pdfPageCount; i++) {
        const pg = pdf.getPage(i);
        const imgs = pageImageXObjects(pdf, pg);
        if (imgs.length === 0) {
          console.log(`[backfill]   WARN page ${i + 1}: no image XObjects; skipped`);
          continue;
        }
        // Photo wrappers have 1 image per page. If more, use the largest.
        imgs.sort((a, b) => (Number(b.bytes?.length || 0) - Number(a.bytes?.length || 0)));
        const best = imgs[0];
        const result = imageXObjectToPage(best);
        if (!result || result.error) {
          console.log(`[backfill]   WARN page ${i + 1}: ${result?.error || "unsupported"}; skipped`);
          continue;
        }
        pages.push(result.page);
      }
      console.log(`[backfill]   pdf pages: ${pdfPageCount}  extracted: ${pages.length}  type(s): ${[...new Set(pages.map((p) => p.type))].join(",")}`);
    } catch (e) {
      console.log(`[backfill]   ERROR pdf parse: ${e.message}`);
      errored++;
      perInvoice.push({ uuid, error: `pdf_parse: ${e.message}` });
      continue;
    }

    if (pages.length === 0) {
      console.log(`[backfill]   ERROR no extractable pages`);
      errored++;
      perInvoice.push({ uuid, error: "no_pages" });
      continue;
    }

    const metadata = {
      account: accountKey,
      vendor: t.row.vendor_name || "",
      invoiceNumber: t.row.invoice_number || "",
      invoiceDate: t.row.invoice_date || "",
      formType: t.row.type || "invoice",
    };

    try {
      await extractAndStoreLineItems(uuid, pages, metadata);
    } catch (e) {
      console.log(`[backfill]   ERROR extractor: ${e.message}`);
      errored++;
      perInvoice.push({ uuid, error: `extractor: ${e.message}` });
      continue;
    }

    // POST-WRITE VERIFICATION: query both stores.
    const { data: pgLines, error: pgErr } = await supa
      .from("ai_line_items")
      .select("line_num, description, quantity, unit, unit_price, extended_price, category")
      .eq("invoice_uuid", submissionId)
      .order("line_num", { ascending: true });
    if (pgErr) {
      console.log(`[backfill]   ERROR pg verify: ${pgErr.message}`);
      errored++;
      perInvoice.push({ uuid, error: `pg_verify: ${pgErr.message}` });
      continue;
    }
    const pgLineCount = pgLines?.length || 0;

    let sheetLineCount = 0;
    try {
      const { rows: sheetRows } = await safeRead(SHEET_IDS.AI_LINE_ITEMS, accountKey);
      sheetLineCount = (sheetRows || []).filter((r) => String(r[0] || "").trim() === uuid).length;
    } catch (e) {
      console.log(`[backfill]   WARN sheet verify failed (non-blocking): ${e.message}`);
    }

    console.log(`[backfill]   PG ai_line_items rows: ${pgLineCount}`);
    console.log(`[backfill]   Sheet AI_LINE_ITEMS "${accountKey}" rows for uuid: ${sheetLineCount}`);

    // Per-line arithmetic + sum reconciliation.
    let cleanLines = 0, heldLines = 0;
    let extendedSum = 0;
    if (pgLineCount > 0) {
      console.log(`[backfill]   per-line arithmetic (|qty*unit - ext| <= 2%|ext| + 0.01):`);
      for (const li of pgLines) {
        const a = arithmeticCheck(li);
        extendedSum += a.ext;
        if (a.ok) cleanLines++;
        else heldLines++;
        const tag = a.ok ? "PASS" : "HOLD";
        const desc = String(li.description || "").slice(0, 50);
        console.log(`[backfill]     L${li.line_num}  ${tag}  qty=${a.qty}  unit=${a.unit.toFixed(4)}  ext=${a.ext.toFixed(2)}  calc=${a.calc.toFixed(2)}  drift=${a.drift.toFixed(4)}  "${desc}"`);
      }
    }
    cleanCount += cleanLines;
    holdCount += heldLines;

    const storedTotal = Number(t.row.total_amount || 0);
    const sumVsTotal = extendedSum - storedTotal;
    const totalOk = Math.abs(sumVsTotal) <= Math.max(0.5, 0.01 * Math.abs(storedTotal));
    console.log(`[backfill]   RECONCILIATION:`);
    console.log(`[backfill]     sum(extracted extended_price) = $${extendedSum.toFixed(2)}`);
    console.log(`[backfill]     stored total_amount           = $${storedTotal.toFixed(2)}`);
    console.log(`[backfill]     diff                          = $${sumVsTotal.toFixed(2)}  (${totalOk ? "MATCH within tol" : "MISMATCH"})`);

    processed++;
    perInvoice.push({
      uuid, vendor: t.row.vendor_name, invoiceNumber: t.row.invoice_number,
      sourceUrl: "raw_drive_url",
      pageCountStored: t.row.page_count,
      pdfPageCount: pages.length,
      pgLineCount, sheetLineCount,
      cleanLines, heldLines,
      extendedSum: Number(extendedSum.toFixed(2)),
      storedTotal,
      totalDiff: Number(sumVsTotal.toFixed(2)),
      totalReconciles: totalOk,
    });

    // Polite pacing between invoices (Anthropic + Drive rate limits).
    if (processed < targets.length) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  console.log(``);
  console.log(`[backfill] ════════════════════════════════════════════════`);
  console.log(`[backfill] STAGE ${STAGE === "batch" ? "1" : "2"} SUMMARY`);
  console.log(`[backfill]   targets attempted        : ${targets.length}`);
  console.log(`[backfill]   processed (wrote)        : ${processed}`);
  console.log(`[backfill]   skipped idempotent       : ${skippedIdempotent}`);
  console.log(`[backfill]   errored                  : ${errored}`);
  console.log(`[backfill]   total line items written : ${cleanCount + holdCount}`);
  console.log(`[backfill]     expected-clean (PASS)  : ${cleanCount}`);
  console.log(`[backfill]     expected-held (HOLD)   : ${holdCount}`);
  console.log(`[backfill] ════════════════════════════════════════════════`);
  console.log(`[backfill] STAGE COMPLETE. Per-invoice records:`);
  for (const r of perInvoice) console.log(`[backfill]   ${JSON.stringify(r)}`);
  console.log(`[backfill]`);
  console.log(`[backfill] No item_catalog / price_history writes performed; the cron's`);
  console.log(`[backfill] arithmetic gate applies on its next run (Railway nightly).`);
}

// ════════════════════════════════════════════════════════════════════════════
// REPLAY-PG: write the PG side for the Stage 1 cohort whose Sheet rows
// landed but whose PG rows did not (local .env.local was missing
// ai_line_items in DUAL_WRITE_TABLES while Vercel had it; first 5
// invoices were Sheet-only). Reads existing Sheet rows for each UUID
// and inserts them into PG ai_line_items directly. NO second model
// call, NO Sheet duplicates, NO live-code change.
//
// Source of truth for the values: the Sheet rows that Stage 1 wrote.
// Reading them back and inserting to PG is idempotent: re-running
// after a partial completion is safe because the per-UUID guard
// checks PG count first.
//
// Default UUIDs are the 5 from Stage 1. Override via
//   --uuids=uuid1,uuid2,...
// ════════════════════════════════════════════════════════════════════════════

const STAGE_1_UUIDS = [
  "9f009084-98c1-4d10-99b8-92111941366a", // City Seafood INV23661
  "1e43b586-0cbe-45e5-8216-09b88c2a4ab1", // Grey Eagle 604008
  "dc10f95e-c86a-4919-b06a-0ee4300703e8", // Grey Eagle 609400
  "512cda63-2de5-4b15-9f75-1bb7688c38bc", // What Chefs Want 12538734
  "7ea1ef30-a409-4726-ab7c-743e71cf5e7a", // What Chefs Want 12534477
];

function safeJsonParse(s) {
  try { return typeof s === "string" ? JSON.parse(s) : s; } catch { return null; }
}

function sheetRowToPgLine(row, sub) {
  // Schema (per LINE_IDX in dataStore/invoice.js):
  //   0 invoiceUuid, 1 timestamp, 2 account, 3 vendor, 4 invoice#,
  //   5 invoiceDate, 6 lineNum, 7 description, 8 quantity, 9 unit,
  //   10 unitPrice, 11 extendedPrice, 12 category, 13 confidence,
  //   14 rawJson
  const num = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    invoice_uuid:   sub.id,
    account_key:    sub.account_key,
    vendor_name:    String(row[3] || sub.vendor_name || "").trim(),
    invoice_number: String(row[4] || sub.invoice_number || "").trim() || null,
    invoice_date:   String(row[5] || "").trim() || sub.invoice_date || null,
    line_num:       num(row[6]) || 0,
    description:    String(row[7] || "").trim(),
    quantity:       num(row[8]),
    unit:           String(row[9] || "").trim() || null,
    unit_price:     num(row[10]),
    extended_price: num(row[11]),
    category:       String(row[12] || "").trim() || null,
    confidence:     String(row[13] || "").trim() || null,
    raw_json:       row[14] ? safeJsonParse(row[14]) : null,
  };
}

async function stageReplayPg() {
  const override = getArg("uuids");
  const targets = (override ? override.split(",") : STAGE_1_UUIDS).map((s) => s.trim()).filter(Boolean);
  console.log(`[backfill] replay-pg targets: ${targets.length}`);

  if (!EXECUTE) {
    console.log(`[backfill] --stage=replay-pg requires --execute to write.`);
    process.exit(2);
  }

  let written = 0, skippedIdempotent = 0, errored = 0, noSheetRows = 0;
  const perInvoice = [];

  for (const uuid of targets) {
    console.log(``);
    console.log(`[backfill] ──── ${uuid}`);

    // Resolve PG submission row.
    const { data: sub, error: subErr } = await supa
      .from("invoice_submissions")
      .select("id, account_key, vendor_name, invoice_number, invoice_date, total_amount")
      .eq("client_uuid", uuid)
      .maybeSingle();
    if (subErr) {
      console.log(`[backfill]   ERROR submission lookup: ${subErr.message}`);
      errored++;
      perInvoice.push({ uuid, error: `sub_lookup: ${subErr.message}` });
      continue;
    }
    if (!sub) {
      console.log(`[backfill]   ERROR submission not in PG`);
      errored++;
      perInvoice.push({ uuid, error: "no_submission" });
      continue;
    }
    console.log(`[backfill]   ${sub.vendor_name} #${sub.invoice_number}  total=$${Number(sub.total_amount || 0).toFixed(2)}`);

    // Idempotency: skip if PG already has line items.
    const { count: existing } = await supa
      .from("ai_line_items")
      .select("id", { count: "exact", head: true })
      .eq("invoice_uuid", sub.id);
    if ((existing || 0) > 0) {
      console.log(`[backfill]   SKIP idempotent: ${existing} PG row(s) already present`);
      skippedIdempotent++;
      perInvoice.push({ uuid, skipped: true, pgLineCount: existing });
      continue;
    }

    // Read the Sheet rows for this UUID from the account tab.
    let sheetRows;
    try {
      const result = await safeRead(SHEET_IDS.AI_LINE_ITEMS, sub.account_key);
      sheetRows = result.rows || [];
    } catch (e) {
      console.log(`[backfill]   ERROR sheet read: ${e.message}`);
      errored++;
      perInvoice.push({ uuid, error: `sheet_read: ${e.message}` });
      continue;
    }
    const matching = sheetRows.filter((r) => String(r[0] || "").trim() === uuid);
    console.log(`[backfill]   sheet rows for uuid: ${matching.length}`);

    if (matching.length === 0) {
      console.log(`[backfill]   WARN no sheet rows; nothing to replay`);
      noSheetRows++;
      perInvoice.push({ uuid, error: "no_sheet_rows" });
      continue;
    }

    const pgRows = matching.map((r) => sheetRowToPgLine(r, sub));
    const { error: insErr } = await supa.from("ai_line_items").insert(pgRows);
    if (insErr) {
      console.log(`[backfill]   ERROR pg insert: ${insErr.message}`);
      errored++;
      perInvoice.push({ uuid, error: `pg_insert: ${insErr.message}` });
      continue;
    }
    written += pgRows.length;
    console.log(`[backfill]   wrote ${pgRows.length} PG row(s)`);

    // Verify post-write.
    const { count: postCount } = await supa
      .from("ai_line_items")
      .select("id", { count: "exact", head: true })
      .eq("invoice_uuid", sub.id);
    console.log(`[backfill]   PG ai_line_items rows: ${postCount}`);

    // Backfill ai_scan_status='complete' to match what markScanStatus
    // would have written in a successful live path.
    const { error: statusErr } = await supa
      .from("invoice_submissions")
      .update({ ai_scan_status: "complete" })
      .eq("id", sub.id);
    if (statusErr) {
      console.log(`[backfill]   WARN status update failed: ${statusErr.message}`);
    } else {
      console.log(`[backfill]   ai_scan_status -> 'complete'`);
    }

    perInvoice.push({ uuid, vendor: sub.vendor_name, invoiceNumber: sub.invoice_number, pgLineCount: postCount, written: pgRows.length });
  }

  console.log(``);
  console.log(`[backfill] ════════════════════════════════════════════════`);
  console.log(`[backfill] REPLAY-PG SUMMARY`);
  console.log(`[backfill]   targets attempted    : ${targets.length}`);
  console.log(`[backfill]   PG rows written      : ${written}`);
  console.log(`[backfill]   skipped idempotent   : ${skippedIdempotent}`);
  console.log(`[backfill]   no sheet rows        : ${noSheetRows}`);
  console.log(`[backfill]   errored              : ${errored}`);
  console.log(`[backfill] ════════════════════════════════════════════════`);
  for (const r of perInvoice) console.log(`[backfill]   ${JSON.stringify(r)}`);
}

// ════════════════════════════════════════════════════════════════════════════
// HOLD-OVERCOUNT-KUNA: route ai_line_items of overcount Kuna invoices
// to review_queue with reason='overcount_suspect_reextract' so the
// cron's matching companion check skips promotion. Sheet + PG line
// items themselves are NOT touched; the holds are an additive
// review_queue write only. Goal: preserve every recoverable line
// (the real ones inside these invoices remain auditable).
//
// Criterion: sum(extended_price) > total_amount * 1.01 across the
// invoice's PG ai_line_items.
//
// Companion cron change (kitchfix-inventory-cron, branch
// feat/honor-overcount-suspect-holds): reads review_queue for
// invoice-level holds with this reason and filters those invoices
// out of newItems before promotion.
// ════════════════════════════════════════════════════════════════════════════

function uidShort() {
  const h = () => Math.random().toString(16).slice(2, 10);
  return `${h()}-${h().slice(0, 4)}-${h().slice(0, 4)}-${h()}`;
}

async function stageHoldOvercountKuna() {
  console.log(`[backfill] identifying overcount Kuna invoices (sum_ext > total_amount * 1.01)`);

  const { data: subs, error: subErr } = await supa
    .from("invoice_submissions")
    .select("id, client_uuid, invoice_number, invoice_date, total_amount, submitted_at")
    .eq("account_key", ACCOUNT_KEY)
    .eq("vendor_name", "Kuna Foodservice")
    .gte("submitted_at", SUBMITTED_AT_MIN)
    .order("submitted_at", { ascending: true });
  if (subErr) throw new Error(`Kuna submissions query: ${subErr.message}`);

  const subIds = subs.map((s) => s.id);
  if (subIds.length === 0) {
    console.log(`[backfill] no Kuna submissions in cohort; nothing to hold.`);
    return;
  }
  const { data: lines, error: lineErr } = await supa
    .from("ai_line_items")
    .select("invoice_uuid, line_num, description, quantity, unit, unit_price, extended_price, category, invoice_date")
    .in("invoice_uuid", subIds);
  if (lineErr) throw new Error(`Kuna ai_line_items query: ${lineErr.message}`);

  const byInvoice = {};
  for (const l of lines) {
    if (!byInvoice[l.invoice_uuid]) byInvoice[l.invoice_uuid] = [];
    byInvoice[l.invoice_uuid].push(l);
  }

  const held = [];
  const promotable = [];
  const noLines = [];
  for (const sub of subs) {
    const subLines = byInvoice[sub.id] || [];
    if (subLines.length === 0) {
      noLines.push(sub);
      continue;
    }
    const sumExt = subLines.reduce((s, l) => s + Number(l.extended_price || 0), 0);
    const total = Number(sub.total_amount || 0);
    const overBy = sumExt - total;
    const isHeld = sumExt > total * 1.01;
    const rec = {
      client_uuid: sub.client_uuid,
      invoice_number: sub.invoice_number,
      invoice_date: sub.invoice_date,
      total, sumExt, overBy,
      lineCount: subLines.length,
      lines: subLines,
    };
    if (isHeld) held.push(rec);
    else promotable.push(rec);
  }

  console.log(``);
  console.log(`[backfill] HELD Kuna invoices (sum_ext > total * 1.01):`);
  console.log(`[backfill]   invoice_num    | total      | sum_ext     | over_by    | lines`);
  for (const h of held) {
    console.log(`[backfill]   ${String(h.invoice_number || "?").padEnd(14)} | $${h.total.toFixed(2).padStart(9)} | $${h.sumExt.toFixed(2).padStart(10)} | $${h.overBy.toFixed(2).padStart(9)} | ${h.lineCount}`);
  }
  const heldLineTotal = held.reduce((s, h) => s + h.lineCount, 0);
  console.log(`[backfill]   total held invoices : ${held.length}`);
  console.log(`[backfill]   total held lines    : ${heldLineTotal}`);

  console.log(``);
  console.log(`[backfill] PROMOTABLE Kuna invoices (within 1% over or under-count):`);
  console.log(`[backfill]   invoice_num    | total      | sum_ext     | diff       | lines`);
  for (const p of promotable) {
    console.log(`[backfill]   ${String(p.invoice_number || "?").padEnd(14)} | $${p.total.toFixed(2).padStart(9)} | $${p.sumExt.toFixed(2).padStart(10)} | $${p.overBy.toFixed(2).padStart(9)} | ${p.lineCount}`);
  }
  console.log(`[backfill]   total promotable invoices : ${promotable.length}`);
  if (noLines.length > 0) {
    console.log(``);
    console.log(`[backfill]   Kuna submissions with zero PG lines (skipped from both lists):`);
    for (const n of noLines) console.log(`[backfill]     ${n.client_uuid}  INV${n.invoice_number}`);
  }

  if (!EXECUTE) {
    console.log(``);
    console.log(`[backfill] DRY RUN. Re-run with --execute to append the ${heldLineTotal} review_queue row(s).`);
    return;
  }

  // ── IDEMPOTENCY: skip held invoices that already have a
  // review_queue row with reason='overcount_suspect_reextract'.
  // Avoid double-appending on re-runs.
  const { rows: existingQueueRows } = await safeRead(SHEET_IDS.INVENTORY, "review_queue");
  const alreadyHeld = new Set();
  for (const r of existingQueueRows) {
    if (String(r[13] || "").trim() === "overcount_suspect_reextract" && String(r[5] || "").trim() === ACCOUNT_KEY) {
      const inv = String(r[3] || "").trim();
      if (inv) alreadyHeld.add(inv);
    }
  }
  const toWrite = held.filter((h) => !alreadyHeld.has(h.client_uuid));
  const skippedAlreadyHeld = held.length - toWrite.length;
  if (skippedAlreadyHeld > 0) {
    console.log(``);
    console.log(`[backfill] ${skippedAlreadyHeld} invoice(s) already have hold rows; skipping (idempotent).`);
  }
  if (toWrite.length === 0) {
    console.log(`[backfill] nothing new to append.`);
    return;
  }

  const queueRows = [];
  for (const h of toWrite) {
    for (const l of h.lines) {
      queueRows.push([
        `q_${uidShort()}`,                              // A queueId
        String(l.description || ""),                   // B lineItemText
        "Kuna Foodservice",                            // C vendor
        h.client_uuid,                                 // D invoiceId (client_uuid)
        String(l.invoice_date || h.invoice_date || ""),// E invoiceDate
        ACCOUNT_KEY,                                   // F account
        "",                                            // G suggestedMatchId
        "",                                            // H suggestedMatchName
        0,                                             // I confidence
        "pending",                                     // J status
        "",                                            // K reviewedBy
        "",                                            // L reviewedAt
        "",                                            // M resultItemId
        "overcount_suspect_reextract",                 // N reason
      ]);
    }
  }
  console.log(``);
  console.log(`[backfill] appending ${queueRows.length} review_queue row(s) for ${toWrite.length} invoice(s)...`);
  await appendRowsSA(SHEET_IDS.INVENTORY, "review_queue!A1", queueRows);
  console.log(`[backfill] DONE.`);
}

// ── Main ──
async function main() {
  console.log(`[backfill] invoked: stage=${STAGE} limit=${LIMIT} execute=${EXECUTE}`);
  if (STAGE === "dry-run") {
    await stageDryRun();
    return;
  }
  if (STAGE === "replay-pg") {
    await stageReplayPg();
    return;
  }
  if (STAGE === "hold-overcount-kuna") {
    await stageHoldOvercountKuna();
    return;
  }
  await stageBatchOrFull();
}

main().catch((e) => {
  console.error(`[backfill] FATAL: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
