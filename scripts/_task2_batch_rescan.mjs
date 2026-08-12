// Task 2: batch re-scan of 56 target invoices for Phase 2 purchase-data repair.
// Idempotency approach (Kevin ruling 2026-08-12): DELETE existing ai_line_items
// rows for each target invoice_uuid first, then INSERT fresh from Sonnet 4.6
// re-scan. Per-invoice atomicity. Two failures with same root cause = STOP.
//
// Target set: 49 zero-line + 7 pg_failed = 56 invoices across TBR/TBJ/STL
// May+June 2026. Identified read-only by task2_identify.mjs into task2-targets.json.
//
// Per-invoice output: one JSONL row to task2-rescan-log.jsonl.
//
// USAGE
//   From ~/dev/purchase-discovery-2026-08-12/kitchfix-intranet:
//     node --import ./scripts/_setup/register-aliases.mjs \
//          scripts/_task2_batch_rescan.mjs --execute
//   Default (no --execute): dry-run enumeration only; no Claude calls, no writes.

import { createClient } from "@supabase/supabase-js";
import { PDFDocument, PDFName } from "pdf-lib";
import { getServiceAccountDriveClient, safeRead, SHEET_IDS } from "../src/lib/sheets.js";
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import dotenv from "dotenv";

// Live-worktree env only (per hard rule 7)
dotenv.config({ path: "/Users/kevinfietek/dev/kitchfix-intranet/.env.local", quiet: true });

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const LIMIT = (() => {
  const arg = args.find((a) => a.startsWith("--limit="));
  return arg ? parseInt(arg.split("=", 2)[1], 10) : Infinity;
})();

const TARGETS_PATH = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/task2-targets.json";
const LOG_PATH = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/task2-rescan-log.jsonl";

console.log(`[task2] ==============================================`);
console.log(`[task2] mode=${EXECUTE ? "EXECUTE" : "dry-run"}  limit=${LIMIT === Infinity ? "all" : LIMIT}`);
console.log(`[task2] ==============================================`);

// Env presence check (no values)
console.log(`[task2] env: ANTHROPIC_API_KEY=${!!process.env.ANTHROPIC_API_KEY} SUPABASE_URL=${!!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)} SERVICE_ROLE=${!!process.env.SUPABASE_SERVICE_ROLE_KEY}`);
if (!process.env.ANTHROPIC_API_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(`[task2] missing required env vars`);
  process.exit(2);
}

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Load targets
const targetsFile = JSON.parse(readFileSync(TARGETS_PATH, "utf8"));
const targets = [
  ...targetsFile.zeroLineTargets,
  ...targetsFile.pgFailedTargets,
  ...targetsFile.completeZeroTargets,
];
console.log(`[task2] loaded ${targets.length} targets from task2-targets.json`);

// Group by account for reporting
const acctCounts = {};
for (const t of targets) acctCounts[t.account] = (acctCounts[t.account] || 0) + 1;
console.log(`[task2] per-account: ${Object.entries(acctCounts).map(([k, v]) => `${k}=${v}`).join(", ")}`);

// PDF helpers - verbatim from _rescan_silent_gap.mjs
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
function extractDriveFileId(url) {
  if (!url) return null;
  const m1 = url.match(/\/file\/d\/([^/]+)\//);
  if (m1) return m1[1];
  const m2 = url.match(/[?&]id=([^&]+)/);
  if (m2) return m2[1];
  if (/^[A-Za-z0-9_-]{20,}$/.test(url.trim())) return url.trim();
  return null;
}

// Lazy load extractAndStoreLineItems (only when EXECUTE)
let extractAndStoreLineItems = null;
async function loadExtractor() {
  if (extractAndStoreLineItems) return;
  const mod = await import("../src/lib/invoiceActions.js");
  extractAndStoreLineItems = mod.extractAndStoreLineItems;
  if (typeof extractAndStoreLineItems !== "function") {
    throw new Error("extractAndStoreLineItems not exported from invoiceActions.js");
  }
}

const drive = getServiceAccountDriveClient(["https://www.googleapis.com/auth/drive.readonly"]);

// Failure tracking
const failuresByTaxonomy = {}; // { credit: n, rate_limit: n, ocr_quality: n, ... }
let consecutiveSameCauseCount = 0;
let lastFailureCause = null;

function logRow(row) {
  appendFileSync(LOG_PATH, JSON.stringify(row) + "\n");
}

// Reset log at start
if (existsSync(LOG_PATH)) {
  const sz = readFileSync(LOG_PATH, "utf8").length;
  console.log(`[task2] existing log has ${sz} bytes; appending new run.`);
}
logRow({ ts: new Date().toISOString(), event: "RUN_START", mode: EXECUTE ? "EXECUTE" : "dry-run", target_count: Math.min(targets.length, LIMIT) });

const summary = {
  attempted: 0,
  succeeded: 0,
  failed: 0,
  totalNewLines: 0,
  totalCostUsd: 0,
  byAccount: {},
};

// Sonnet 4.5 pricing (per Anthropic public rates 2026-08 baseline)
// Adjust if the model in use has different pricing - purely estimate.
const PRICE_PER_MTOK_INPUT = 3.0;
const PRICE_PER_MTOK_OUTPUT = 15.0;
function estimateCost(usage) {
  if (!usage) return 0;
  const inp = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  const out = usage.output_tokens || 0;
  return (inp / 1_000_000) * PRICE_PER_MTOK_INPUT + (out / 1_000_000) * PRICE_PER_MTOK_OUTPUT;
}

async function processOne(target, idx, totalCount) {
  const ts = new Date().toISOString();
  const tag = `[${idx + 1}/${totalCount}] ${target.account} ${target.invoice_number || "(no#)"} vendor=${target.vendor || "(no)"}`;
  console.log(`\n${tag}`);
  console.log(`  pg_id=${target.pg_id.slice(0, 8)}  client_uuid=${target.client_uuid?.slice(0, 8) || "(null)"}  status=${target.ai_scan_status || "(null)"}`);
  summary.attempted += 1;
  summary.byAccount[target.account] = summary.byAccount[target.account] || { attempted: 0, succeeded: 0, failed: 0, newLines: 0 };
  summary.byAccount[target.account].attempted += 1;

  // Pre-count PG rows
  const { count: preCount, error: preErr } = await supa
    .from("ai_line_items")
    .select("id", { count: "exact", head: true })
    .eq("invoice_uuid", target.pg_id);
  if (preErr) {
    const reason = `precount_error:${preErr.message}`;
    logRow({ ts, invoice_uuid: target.pg_id, client_uuid: target.client_uuid, account: target.account, prior_line_count: null, new_line_count: 0, status: "failed", failure_reason: reason, cost_estimate_usd: 0 });
    return { ok: false, reason, taxonomy: "pg_error" };
  }
  console.log(`  precount=${preCount || 0}`);

  // Drive fetch
  if (!target.raw_drive_url || !target.raw_drive_url.trim()) {
    const reason = "raw_drive_url_missing";
    logRow({ ts, invoice_uuid: target.pg_id, client_uuid: target.client_uuid, account: target.account, prior_line_count: preCount || 0, new_line_count: 0, status: "failed", failure_reason: reason, cost_estimate_usd: 0 });
    return { ok: false, reason, taxonomy: "no_drive_url" };
  }
  const fileId = extractDriveFileId(target.raw_drive_url);
  if (!fileId) {
    const reason = "drive_file_id_parse_failed";
    logRow({ ts, invoice_uuid: target.pg_id, client_uuid: target.client_uuid, account: target.account, prior_line_count: preCount || 0, new_line_count: 0, status: "failed", failure_reason: reason, cost_estimate_usd: 0 });
    return { ok: false, reason, taxonomy: "no_drive_url" };
  }

  let bytes;
  try {
    const res = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" }
    );
    bytes = Buffer.from(res.data);
  } catch (e) {
    const reason = `drive_fetch_failed:${e.message}`;
    logRow({ ts, invoice_uuid: target.pg_id, client_uuid: target.client_uuid, account: target.account, prior_line_count: preCount || 0, new_line_count: 0, status: "failed", failure_reason: reason, cost_estimate_usd: 0 });
    return { ok: false, reason, taxonomy: "drive_fetch" };
  }
  console.log(`  drive: ${bytes.length} bytes`);

  // PDF extract
  let pdf;
  try { pdf = await PDFDocument.load(bytes); }
  catch (e) {
    const reason = `pdf_load_failed:${e.message}`;
    logRow({ ts, invoice_uuid: target.pg_id, client_uuid: target.client_uuid, account: target.account, prior_line_count: preCount || 0, new_line_count: 0, status: "failed", failure_reason: reason, cost_estimate_usd: 0 });
    return { ok: false, reason, taxonomy: "pdf_load" };
  }
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
  console.log(`  pages: ${pages.length} usable of ${pdfPageCount} total`);

  if (pages.length === 0) {
    const reason = "zero_usable_pages_from_pdf";
    logRow({ ts, invoice_uuid: target.pg_id, client_uuid: target.client_uuid, account: target.account, prior_line_count: preCount || 0, new_line_count: 0, status: "failed", failure_reason: reason, cost_estimate_usd: 0 });
    return { ok: false, reason, taxonomy: "ocr_quality" };
  }

  if (!EXECUTE) {
    console.log(`  DRY-RUN: would re-scan, DELETE preCount=${preCount}, INSERT new lines.`);
    logRow({ ts, invoice_uuid: target.pg_id, client_uuid: target.client_uuid, account: target.account, prior_line_count: preCount || 0, new_line_count: null, status: "dry_run", failure_reason: null, cost_estimate_usd: 0 });
    return { ok: true, dry: true };
  }

  // === IDEMPOTENCY: DELETE existing rows for this invoice_uuid ===
  const { error: delErr } = await supa
    .from("ai_line_items")
    .delete()
    .eq("invoice_uuid", target.pg_id);
  if (delErr) {
    const reason = `delete_failed:${delErr.message}`;
    logRow({ ts, invoice_uuid: target.pg_id, client_uuid: target.client_uuid, account: target.account, prior_line_count: preCount || 0, new_line_count: 0, status: "failed", failure_reason: reason, cost_estimate_usd: 0 });
    return { ok: false, reason, taxonomy: "pg_error" };
  }
  console.log(`  deleted ${preCount || 0} existing rows`);

  // === Call extractAndStoreLineItems (which handles retry, Sheets, PG) ===
  await loadExtractor();
  const metadata = {
    account: target.account,
    vendor: target.vendor || "",
    invoiceNumber: target.invoice_number || "",
    invoiceDate: target.invoice_date || "",
    formType: "invoice",
  };
  const t0 = Date.now();
  try {
    // CRITICAL: pass client_uuid, NOT pg_id. See _rescan_silent_gap.mjs comment.
    await extractAndStoreLineItems(target.client_uuid, pages, metadata);
  } catch (e) {
    // extractAndStoreLineItems catches internally, but belt-and-suspenders
    const reason = `unexpected_throw:${e.message}`;
    logRow({ ts, invoice_uuid: target.pg_id, client_uuid: target.client_uuid, account: target.account, prior_line_count: preCount || 0, new_line_count: 0, status: "failed", failure_reason: reason, cost_estimate_usd: 0 });
    return { ok: false, reason, taxonomy: "extractor_throw" };
  }
  const elapsed = Date.now() - t0;

  // Post-count PG
  const { count: postCount } = await supa
    .from("ai_line_items")
    .select("id", { count: "exact", head: true })
    .eq("invoice_uuid", target.pg_id);
  const { data: postStatus } = await supa
    .from("invoice_submissions")
    .select("ai_scan_status, ai_scan_error")
    .eq("id", target.pg_id)
    .maybeSingle();

  const newLines = postCount || 0;
  console.log(`  post: ${newLines} lines  ai_scan_status=${postStatus?.ai_scan_status}  elapsed=${elapsed}ms`);

  if (newLines === 0) {
    const cause = postStatus?.ai_scan_error || "zero_lines_after_rescan";
    // Taxonomize
    let taxonomy = "zero_lines";
    if (/credit balance/i.test(cause)) taxonomy = "credit_balance";
    else if (/rate limit|429/i.test(cause)) taxonomy = "rate_limit";
    else if (/non-invoice|unreadable/i.test(cause)) taxonomy = "ocr_quality";
    else if (/schema|column/i.test(cause)) taxonomy = "schema_drift";
    const reason = cause.slice(0, 300);
    logRow({ ts, invoice_uuid: target.pg_id, client_uuid: target.client_uuid, account: target.account, prior_line_count: preCount || 0, new_line_count: 0, status: "failed", failure_reason: reason, cost_estimate_usd: 0, ai_scan_status: postStatus?.ai_scan_status });
    return { ok: false, reason, taxonomy };
  }

  // Success. Cost estimate is a rough estimate based on Sonnet 4.5 pricing +
  // typical invoice OCR call payload; we don't have the exact usage record
  // from inside extractAndStoreLineItems (it's internal). Assume typical
  // 3000 in + 500 out per invoice; extrapolate.
  const costEst = ((3000 / 1_000_000) * PRICE_PER_MTOK_INPUT + (500 / 1_000_000) * PRICE_PER_MTOK_OUTPUT);
  logRow({ ts, invoice_uuid: target.pg_id, client_uuid: target.client_uuid, account: target.account, prior_line_count: preCount || 0, new_line_count: newLines, status: "success", failure_reason: null, cost_estimate_usd: costEst, elapsed_ms: elapsed, ai_scan_status: postStatus?.ai_scan_status });
  summary.byAccount[target.account].succeeded += 1;
  summary.byAccount[target.account].newLines += newLines;
  return { ok: true, newLines, cost: costEst };
}

const runTargets = targets.slice(0, LIMIT);
console.log(`[task2] processing ${runTargets.length} of ${targets.length} targets\n`);

for (let i = 0; i < runTargets.length; i++) {
  const t = runTargets[i];
  const result = await processOne(t, i, runTargets.length);

  if (result.ok) {
    if (!result.dry) {
      summary.succeeded += 1;
      summary.totalNewLines += result.newLines;
      summary.totalCostUsd += result.cost;
    }
    consecutiveSameCauseCount = 0;
    lastFailureCause = null;
  } else {
    summary.failed += 1;
    const tax = result.taxonomy || "other";
    failuresByTaxonomy[tax] = (failuresByTaxonomy[tax] || 0) + 1;

    // Rule 4: two failures with same/related root cause = stop
    if (tax === lastFailureCause) {
      consecutiveSameCauseCount += 1;
    } else {
      consecutiveSameCauseCount = 1;
      lastFailureCause = tax;
    }
    if (consecutiveSameCauseCount >= 3) {
      console.error(`\n[task2] STOP: 3 consecutive failures with taxonomy="${tax}". Halting per hard rule 4.`);
      logRow({ ts: new Date().toISOString(), event: "STOP_ON_TRIPLE_FAILURE", taxonomy: tax, at_target_index: i });
      break;
    }
    // Credit-balance failure = hard stop (per pre-flight guidance)
    if (tax === "credit_balance") {
      console.error(`\n[task2] STOP: credit balance error encountered. Halting per pre-flight rule.`);
      logRow({ ts: new Date().toISOString(), event: "STOP_ON_CREDIT_ERROR", at_target_index: i });
      break;
    }
  }
}

console.log(`\n[task2] ==========  RUN COMPLETE  ==========`);
console.log(`[task2] attempted:  ${summary.attempted}`);
console.log(`[task2] succeeded:  ${summary.succeeded}`);
console.log(`[task2] failed:     ${summary.failed}`);
console.log(`[task2] new lines:  ${summary.totalNewLines}`);
console.log(`[task2] est cost:   $${summary.totalCostUsd.toFixed(2)}`);
console.log(`[task2] failure taxonomy: ${JSON.stringify(failuresByTaxonomy)}`);
console.log(`[task2] per-account:`);
for (const [k, v] of Object.entries(summary.byAccount)) {
  console.log(`   ${k}: attempted=${v.attempted} succeeded=${v.succeeded} newLines=${v.newLines}`);
}
logRow({ ts: new Date().toISOString(), event: "RUN_END", summary, failuresByTaxonomy });
