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
import { getServiceAccountDriveClient } from "../src/lib/sheets.js";

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

if (!["dry-run", "batch", "full"].includes(STAGE)) {
  console.error(`[backfill] Unknown --stage="${STAGE}". Valid: dry-run, batch, full.`);
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

// Return the preferred Drive URL for a submission row: rawDriveUrl first,
// then drive_urls[0]. Returns null if neither is usable.
function pickDriveUrl(row) {
  const raw = (row.raw_drive_url || "").trim();
  if (raw) return { source: "raw_drive_url", url: raw };
  const arr = Array.isArray(row.drive_urls) ? row.drive_urls : [];
  for (const u of arr) {
    if (typeof u === "string" && u.trim()) return { source: "drive_urls[0]", url: u.trim() };
  }
  return null;
}

// ── 1. Query target set ──
async function loadTargets() {
  // Fetch all candidate submissions (filters that index in PG).
  const { data: subs, error: subErr } = await supa
    .from("invoice_submissions")
    .select("id, client_uuid, submitted_at, submitter_email, account_key, vendor_name, vendor_id, invoice_number, invoice_date, page_count, raw_drive_url, drive_urls, ai_scan_status, status, type")
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

    const picked = pickDriveUrl(t);
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
  console.log(`[backfill] Stage 1 / 2 require the triggerAIScan refactor (extractAndStoreLineItems export)`);
  console.log(`[backfill] in src/lib/invoiceActions.js, which is not yet shipped. See the script docstring.`);
}

// ── Stage 1 / 2 stubs ──
async function stageBatchOrFull() {
  console.error(`[backfill] --stage=${STAGE} is NOT YET IMPLEMENTED in this script.`);
  console.error(`[backfill] Required to implement (next turn after Stage 0 review):`);
  console.error(`[backfill]   1) refactor triggerAIScan in src/lib/invoiceActions.js to expose`);
  console.error(`[backfill]      extractAndStoreLineItems(invoiceUuid, pages, metadata) as the`);
  console.error(`[backfill]      reusable extraction body.`);
  console.error(`[backfill]   2) server-side PDF -> JPEG render in this script (matches the live`);
  console.error(`[backfill]      client's pdfjs flow so the extractor sees the same input shape).`);
  console.error(`[backfill]   3) per-invoice loop: fetch Drive PDF via SA, render, call`);
  console.error(`[backfill]      extractAndStoreLineItems with metadata.account = row.account_key.`);
  console.error(`[backfill]   4) per-line arithmetic check report (mirrors the cron gate).`);
  console.error(`[backfill]   5) post-write verification: count ai_line_items + AI_LINE_ITEMS`);
  console.error(`[backfill]      Sheet rows for the processed UUIDs.`);
  process.exit(2);
}

// ── Main ──
async function main() {
  console.log(`[backfill] invoked: stage=${STAGE} limit=${LIMIT} execute=${EXECUTE}`);
  if (STAGE === "dry-run") {
    await stageDryRun();
    return;
  }
  await stageBatchOrFull();
}

main().catch((e) => {
  console.error(`[backfill] FATAL: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
