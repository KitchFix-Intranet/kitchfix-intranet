// ════════════════════════════════════════════════════════════════════════════
// SWEEP: re-extract all status='failed' invoices from the last 30 days
// through the REAL fixed pipeline (extractAndStoreLineItems with the retry +
// ai_scan_error capture from PR #144).
//
// What it does per invoice:
//   1. Pre-flight: confirms PG=0 line items AND Sheets=0 line items AND
//      raw_drive_url present. Skips otherwise.
//   2. Downloads PDF from Drive via service account.
//   3. Extracts JPEG page images (DCTDecode path, same as
//      _rescan_silent_gap.mjs).
//   4. Calls extractAndStoreLineItems(invoiceUuid, pages, metadata) - the
//      production code path. This writes both stores (Sheets + PG) via the
//      orchestrator and updates ai_scan_status accordingly.
//   5. Post-flight: reads back the row's ai_scan_status, ai_scan_error, and
//      PG line item count.
//   6. Logs the outcome per invoice.
//
// Final summary: recovery rate + grouped ai_scan_error for any that still
// fail after retries.
//
// Cost: ~36 base Claude calls; retries multiply by up to 3x on transients.
// Worst case ~108 calls = ~$2-5.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";
import { PDFDocument, PDFName } from "pdf-lib";
import { getServiceAccountDriveClient, safeRead, SHEET_IDS } from "@/lib/sheets";
import { extractAndStoreLineItems } from "@/lib/invoiceActions";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const SINCE = new Date(Date.now() - 30 * 86400000).toISOString();

// ── Step 1: Pull current failed invoices ──────────────────────────────────
console.log(`Pulling status='failed' live invoices since ${SINCE.slice(0,10)}...`);
const { data: failed, error: pullErr } = await supa
  .from("invoice_submissions")
  .select("id, client_uuid, account_key, vendor_name, invoice_number, invoice_date, submitted_at, ai_scan_status, ai_scan_error, raw_drive_url, type, page_count")
  .eq("is_historical", false)
  .eq("ai_scan_status", "failed")
  .gte("submitted_at", SINCE)
  .order("submitted_at", { ascending: false });
if (pullErr) throw new Error(pullErr.message);

console.log(`Found ${failed.length} failed invoices in window.`);
const noUrl = failed.filter((f) => !f.raw_drive_url).length;
if (noUrl > 0) console.log(`  ${noUrl} have no raw_drive_url (cannot re-extract)`);
console.log("");

// ── Drive + PDF helpers (verbatim from _rescan_silent_gap.mjs) ────────────
const drive = getServiceAccountDriveClient(["https://www.googleapis.com/auth/drive.readonly"]);

function extractDriveFileId(url) {
  if (!url) return null;
  const m1 = url.match(/\/file\/d\/([^/]+)\//);
  if (m1) return m1[1];
  const m2 = url.match(/[?&]id=([^&]+)/);
  if (m2) return m2[1];
  if (/^[A-Za-z0-9_-]{20,}$/.test(url.trim())) return url.trim();
  return null;
}
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

async function downloadAndExtractPages(rawDriveUrl) {
  const fileId = extractDriveFileId(rawDriveUrl);
  if (!fileId) return { error: "could not parse Drive fileId" };
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
  const pdf = await PDFDocument.load(bytes);
  const pdfPageCount = pdf.getPageCount();
  const pages = [];
  for (let i = 0; i < pdfPageCount; i++) {
    const pg = pdf.getPage(i);
    const imgs = pageImageXObjects(pdf, pg);
    if (imgs.length === 0) continue;
    imgs.sort((a, b) => Number(b.bytes?.length || 0) - Number(a.bytes?.length || 0));
    const best = imgs[0];
    const result = imageXObjectToPage(best);
    if (!result || result.error) continue;
    pages.push(result.page);
  }
  return { pages, pdfPageCount, fileBytes: bytes.length };
}

// ── Per-invoice sweep ─────────────────────────────────────────────────────
const outcomes = [];
let i = 0;
for (const sub of failed) {
  i++;
  const tag = `[${i}/${failed.length}] ${sub.client_uuid.slice(0,8)} ${sub.account_key.padEnd(14)} "${(sub.vendor_name||"").slice(0,20)}"`;

  // Pre-flight 1: raw_drive_url
  if (!sub.raw_drive_url) {
    console.log(`${tag} SKIP: no raw_drive_url`);
    outcomes.push({ sub, outcome: "skip_no_url" });
    continue;
  }

  // Pre-flight 2: PG line items count = 0
  const { count: prePgCount } = await supa.from("ai_line_items").select("*", { count: "exact", head: true }).eq("invoice_uuid", sub.id);
  if (prePgCount !== 0) {
    console.log(`${tag} SKIP: PG already has ${prePgCount} line items (would dup)`);
    outcomes.push({ sub, outcome: "skip_pg_nonzero", prePgCount });
    continue;
  }

  // Pre-flight 3: Sheets line items count = 0 (avoid duplicating Sheets rows on append)
  let preSheetsCount;
  try {
    const { rows } = await safeRead(SHEET_IDS.AI_LINE_ITEMS, sub.account_key);
    preSheetsCount = (rows || []).filter((r) => String(r[0] || "").trim() === sub.id).length;
  } catch (e) {
    console.log(`${tag} SKIP: Sheets read failed: ${e.message}`);
    outcomes.push({ sub, outcome: "skip_sheets_read_err", err: e.message });
    continue;
  }
  if (preSheetsCount !== 0) {
    console.log(`${tag} SKIP: Sheets already has ${preSheetsCount} rows (would dup)`);
    outcomes.push({ sub, outcome: "skip_sheets_nonzero", preSheetsCount });
    continue;
  }

  // Download PDF + extract pages
  const t0 = Date.now();
  const { pages, error: dlErr, pdfPageCount, fileBytes } = await downloadAndExtractPages(sub.raw_drive_url);
  if (dlErr) {
    console.log(`${tag} SKIP: ${dlErr}`);
    outcomes.push({ sub, outcome: "skip_dl_fail", err: dlErr });
    continue;
  }
  if (!pages || pages.length === 0) {
    console.log(`${tag} SKIP: 0 usable pages (PDF=${pdfPageCount}p, ${(fileBytes/1024).toFixed(0)}KB; likely non-DCT)`);
    outcomes.push({ sub, outcome: "skip_no_pages", pdfPageCount, fileBytes });
    continue;
  }

  // RUN production extraction (writes both stores + updates status via the orchestrator)
  //
  // CRITICAL: pass sub.client_uuid, NOT sub.id. The orchestrator's PG adapter
  // (insertAILineItemsPostgres in src/lib/dataStore/invoice.js) looks up the
  // submission via .eq("client_uuid", invoiceUuid). Production callers from
  // /api/ops pass client_uuid. Passing sub.id (the PG row UUID) here would
  // make the orchestrator write Sheets rows with the wrong identifier in
  // col A and then throw "submission X not in PG" - the bug that the
  // aborted bo68osf5k run hit.
  const metadata = {
    account: sub.account_key,
    vendor: sub.vendor_name || "",
    invoiceNumber: sub.invoice_number || "",
    invoiceDate: sub.invoice_date || "",
    formType: sub.type || "invoice",
  };
  try {
    await extractAndStoreLineItems(sub.client_uuid, pages, metadata);
  } catch (e) {
    // extractAndStoreLineItems catches internally; any throw here is exceptional
    console.log(`${tag} ERR: extractAndStoreLineItems threw: ${e.message}`);
    outcomes.push({ sub, outcome: "throw", err: e.message });
    continue;
  }

  // Post-flight: re-read status + line items
  const { data: postSub } = await supa
    .from("invoice_submissions")
    .select("ai_scan_status, ai_scan_error")
    .eq("id", sub.id)
    .maybeSingle();
  const { count: postPgCount } = await supa.from("ai_line_items").select("*", { count: "exact", head: true }).eq("invoice_uuid", sub.id);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // Check Stage A population on a sample row (just first one)
  let stageAPopulated = "?";
  if (postPgCount > 0) {
    const { data: oneRow } = await supa.from("ai_line_items").select("item_number, pack_size, amount, uom_raw, shipped_count").eq("invoice_uuid", sub.id).limit(1);
    const r = oneRow?.[0] || {};
    const hasStageA = r.item_number !== null || r.pack_size !== null || r.amount !== null || r.uom_raw !== null || r.shipped_count !== null;
    stageAPopulated = hasStageA ? "yes" : "NO";
  }

  const verdict = postSub?.ai_scan_status === "complete" ? "RECOVERED"
                : postSub?.ai_scan_status === "failed"   ? "STILL FAILED"
                : postSub?.ai_scan_status === "pg_failed"? "PG_FAILED"
                : `??(${postSub?.ai_scan_status})`;
  console.log(`${tag} ${verdict} ${elapsed}s  PG=${postPgCount} stageA=${stageAPopulated}${postSub?.ai_scan_error ? `  err=${postSub.ai_scan_error.slice(0,80)}` : ""}`);

  outcomes.push({
    sub,
    outcome: postSub?.ai_scan_status,
    aiScanError: postSub?.ai_scan_error,
    postPgCount,
    stageAPopulated,
    elapsed,
  });

  // Brief pause between invoices to be nice to Anthropic rate limits
  await new Promise((r) => setTimeout(r, 500));
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log("  SWEEP SUMMARY");
console.log("════════════════════════════════════════════════════════════════════");
const recovered = outcomes.filter((o) => o.outcome === "complete");
const stillFailed = outcomes.filter((o) => o.outcome === "failed");
const pgFailedNow = outcomes.filter((o) => o.outcome === "pg_failed");
const skipped = outcomes.filter((o) => String(o.outcome || "").startsWith("skip_"));
const thrown = outcomes.filter((o) => o.outcome === "throw");
const totalAttempted = outcomes.length - skipped.length;

console.log(`Total invoices in window: ${outcomes.length}`);
console.log(`Skipped (pre-flight):     ${skipped.length}`);
console.log(`Attempted extraction:     ${totalAttempted}`);
console.log("");
console.log(`  RECOVERED (complete + PG rows):  ${recovered.length}`);
console.log(`  STILL FAILED:                    ${stillFailed.length}`);
console.log(`  PG_FAILED (PG-side throw):       ${pgFailedNow.length}`);
console.log(`  threw uncaught:                  ${thrown.length}`);
console.log("");
const recoveryRate = totalAttempted > 0 ? ((recovered.length / totalAttempted) * 100).toFixed(1) : 0;
console.log(`Recovery rate: ${recovered.length} / ${totalAttempted} = ${recoveryRate}%`);

// Stage A coverage on the recovered
const recWithStageA = recovered.filter((o) => o.stageAPopulated === "yes").length;
console.log(`Stage A populated on recovered: ${recWithStageA} / ${recovered.length}`);

// Skip reasons
console.log("");
console.log("Skip reasons:");
const skipReasons = new Map();
for (const o of skipped) skipReasons.set(o.outcome, (skipReasons.get(o.outcome) || 0) + 1);
for (const [r, c] of [...skipReasons.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${r.padEnd(24)} ${c}`);

// Persistent-failure ai_scan_error breakdown
if (stillFailed.length > 0) {
  console.log("");
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  STILL-FAILED ai_scan_error breakdown");
  console.log("════════════════════════════════════════════════════════════════════");
  const byErr = new Map();
  for (const o of stillFailed) {
    const sig = (o.aiScanError || "(null - retry didn't write error?)").slice(0, 200);
    if (!byErr.has(sig)) byErr.set(sig, []);
    byErr.get(sig).push(o);
  }
  for (const [sig, rows] of [...byErr.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log("");
    console.log(`  ── ${rows.length} invoice(s) ──`);
    console.log(`     ${sig}`);
    for (const o of rows.slice(0, 5)) {
      console.log(`       ${o.sub.client_uuid.slice(0,8)} ${o.sub.account_key.padEnd(14)} "${o.sub.vendor_name}"`);
    }
    if (rows.length > 5) console.log(`       ... and ${rows.length - 5} more`);
  }
}

// Same for pg_failed
if (pgFailedNow.length > 0) {
  console.log("");
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  PG_FAILED ai_scan_error breakdown");
  console.log("════════════════════════════════════════════════════════════════════");
  for (const o of pgFailedNow) {
    console.log(`  ${o.sub.client_uuid.slice(0,8)} ${o.sub.account_key.padEnd(14)} "${o.sub.vendor_name}"`);
    console.log(`    ${(o.aiScanError || "").slice(0, 200)}`);
  }
}

console.log("");
console.log("Done.");
