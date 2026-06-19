// READ-ONLY verification probe for raising max_tokens to 16384.
// Calls Claude directly (NOT through extractAndStoreLineItems - no writes).
//
// Per-invoice checks:
//   (a) API accepts max_tokens: 16384 with claude-sonnet-4-20250514
//   (b) Response stop_reason is "end_turn" not "max_tokens" (= no truncation)
//   (c) JSON parses cleanly
//   (d) For normal invoices: line item count matches what's currently in PG
//   (e) For failed invoices: line item count is now > 0 (recovery viable)
//
// Selection:
//   2 known failures: 5a447c0a (What Chefs Want), 29c8ff9f (Truly Good Foods)
//   3 normal recovered invoices spanning small/medium/large:
//     6986d253 Shamrock  (1 item)
//     c8b968a3 Alsco     (16 items)
//     41bb0f73 Sysco     (34 items)
//
// Cost: 5 Claude calls @ ~$0.02-0.05 each = ~$0.10-0.25 total.

import { createClient } from "@supabase/supabase-js";
import { PDFDocument, PDFName } from "pdf-lib";
import { getServiceAccountDriveClient } from "@/lib/sheets";
import { EXTRACTION_PROMPT } from "@/lib/invoiceActions";

const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS_NEW = 16384;
const MAX_TOKENS_OLD = 8192;  // for context in the report

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── 5 target invoices (client_uuid prefixes) ──────────────────────────────
const TARGETS = [
  { prefix: "5a447c0a", expectedClass: "failure", expectedPgRows: 0,  vendorHint: "What Chefs Want" },
  { prefix: "29c8ff9f", expectedClass: "failure", expectedPgRows: 0,  vendorHint: "Truly Good Foods" },
  { prefix: "6986d253", expectedClass: "normal",  expectedPgRows: 1,  vendorHint: "Shamrock (small, 1 item)" },
  { prefix: "c8b968a3", expectedClass: "normal",  expectedPgRows: 16, vendorHint: "Alsco (medium, 16 items)" },
  { prefix: "41bb0f73", expectedClass: "normal",  expectedPgRows: 34, vendorHint: "Sysco (large, 34 items)" },
];

// ── Resolve each prefix -> full row ───────────────────────────────────────
console.log("Resolving target invoices...");
const resolved = [];
for (const t of TARGETS) {
  const { data } = await supa
    .from("invoice_submissions")
    .select("id, client_uuid, account_key, vendor_name, invoice_number, raw_drive_url, ai_scan_status, page_count")
    .ilike("client_uuid::text", `${t.prefix}%`);
  // The ilike trick doesn't quite work on uuid columns; fall back to a pull-and-filter
  if (!data || data.length === 0) {
    // Fallback: pull all live failed/null/complete recently and filter
    const { data: all } = await supa
      .from("invoice_submissions")
      .select("id, client_uuid, account_key, vendor_name, invoice_number, raw_drive_url, ai_scan_status, page_count")
      .eq("is_historical", false);
    const match = (all || []).find((r) => String(r.client_uuid).startsWith(t.prefix));
    if (!match) { console.log(`  ${t.prefix}: NOT FOUND`); continue; }
    resolved.push({ ...t, ...match });
  } else {
    resolved.push({ ...t, ...data[0] });
  }
  const r = resolved[resolved.length - 1];
  console.log(`  ${t.prefix} -> "${r.vendor_name}" account=${r.account_key} pages=${r.page_count} status=${r.ai_scan_status}`);
}
console.log("");

// ── Drive + PDF page extraction (reused from earlier probes) ──────────────
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
  for (const [, ref] of ResolvedXObject.entries()) {
    const obj = pdfLookup(pdf, ref);
    if (!obj) continue;
    const dict = obj.dict || obj;
    if (typeof dict.get !== "function") continue;
    const subtype = dict.get(PDFName.of("Subtype"));
    const subtypeName = subtype?.encodedName || String(subtype || "");
    if (!subtypeName.includes("Image")) continue;
    const filter = dict.get(PDFName.of("Filter"));
    const filterName = filter?.encodedName || String(filter || "");
    out.push({ bytes: obj.contents, filter: filterName });
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
  if (!mediaType) return null;
  const base64 = Buffer.from(img.bytes).toString("base64");
  return { data: `data:${mediaType};base64,${base64}`, rotation: 0, type: "image" };
}
async function downloadAndExtractPages(rawDriveUrl) {
  const fileId = extractDriveFileId(rawDriveUrl);
  if (!fileId) return { pages: [] };
  let bytes;
  try {
    const res = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
    bytes = Buffer.from(res.data);
  } catch (e) { return { pages: [], error: `Drive fetch: ${e.message}` }; }
  const pdf = await PDFDocument.load(bytes);
  const pages = [];
  for (let i = 0; i < pdf.getPageCount(); i++) {
    const pg = pdf.getPage(i);
    const imgs = pageImageXObjects(pdf, pg);
    if (imgs.length === 0) continue;
    imgs.sort((a, b) => Number(b.bytes?.length || 0) - Number(a.bytes?.length || 0));
    const result = imageXObjectToPage(imgs[0]);
    if (result) pages.push(result);
  }
  return { pages };
}

// ── One Claude call at the new max_tokens ─────────────────────────────────
async function callClaudeAt(maxTokens, pages) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const imageBlocks = pages.slice(0, 6).map((page) => {
    const data = typeof page === "string" ? page : page.data;
    const base64 = data.includes(",") ? data.split(",")[1] : data;
    const mediaType = data.startsWith("data:image/png") ? "image/png" : "image/jpeg";
    return { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };
  });
  const t0 = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: [...imageBlocks, { type: "text", text: EXTRACTION_PROMPT }] }],
    }),
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (!res.ok) return { ok: false, status: res.status, error: (await res.text()).slice(0, 300), elapsed };
  const result = await res.json();
  const text = result.content?.[0]?.text || "";
  const usage = result.usage || {};
  const stopReason = result.stop_reason || "?";
  let parsed = null;
  let parseError = null;
  try {
    const clean = text.replace(/```json\s*|```/g, "").trim();
    parsed = JSON.parse(clean);
  } catch (e) { parseError = e.message; }
  return {
    ok: true,
    elapsed,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    stopReason,
    truncated: stopReason === "max_tokens",
    parseOk: !parseError,
    parseError,
    itemCount: parsed?.lineItems?.length ?? 0,
    rawTextLen: text.length,
  };
}

// ── Main loop ──────────────────────────────────────────────────────────────
const results = [];
for (const sub of resolved) {
  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`  ${sub.prefix} "${sub.vendor_name}" account=${sub.account_key} (${sub.expectedClass}, expected PG=${sub.expectedPgRows})`);
  console.log("════════════════════════════════════════════════════════════════════");

  const { pages, error: extractErr } = await downloadAndExtractPages(sub.raw_drive_url);
  if (extractErr) {
    console.log(`  ABORT: ${extractErr}`);
    results.push({ sub, abort: extractErr });
    continue;
  }
  if (pages.length === 0) {
    console.log(`  ABORT: 0 usable pages`);
    results.push({ sub, abort: "0 usable pages" });
    continue;
  }
  console.log(`  Pages: ${pages.length}`);

  const r = await callClaudeAt(MAX_TOKENS_NEW, pages);
  if (!r.ok) {
    console.log(`  API ERROR ${r.status}: ${r.error.slice(0,200)}`);
    results.push({ sub, apiError: r.error, status: r.status });
    continue;
  }
  console.log(`  max_tokens=${MAX_TOKENS_NEW}  ${r.elapsed}s  in=${r.inputTokens}t out=${r.outputTokens}t  stop=${r.stopReason}  truncated=${r.truncated}  parsed=${r.parseOk}  items=${r.itemCount}  rawLen=${r.rawTextLen}`);
  if (!r.parseOk) console.log(`  parse err: ${r.parseError?.slice(0,120)}`);
  results.push({ sub, ...r });
}

// ── Summary report ────────────────────────────────────────────────────────
console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log("  SUMMARY");
console.log("════════════════════════════════════════════════════════════════════");
console.log("");
console.log(`  Model:    ${MODEL}`);
console.log(`  Tested:   max_tokens = ${MAX_TOKENS_NEW} (current production = ${MAX_TOKENS_OLD})`);
console.log("");
console.log(`  ${"uuid".padEnd(10)} ${"class".padEnd(8)} ${"vendor".padEnd(20)} ${"out_t".padStart(6)} ${"stop".padStart(10)} ${"trunc?".padStart(7)} ${"parse?".padStart(7)} ${"items".padStart(6)} ${"expect".padStart(7)}  verdict`);
console.log(`  ${"-".repeat(10)} ${"-".repeat(8)} ${"-".repeat(20)} ${"-".repeat(6)} ${"-".repeat(10)} ${"-".repeat(7)} ${"-".repeat(7)} ${"-".repeat(6)} ${"-".repeat(7)}  ──`);
for (const r of results) {
  if (r.abort) {
    console.log(`  ${r.sub.prefix.padEnd(10)} ${r.sub.expectedClass.padEnd(8)} ${r.sub.vendor_name.slice(0,20).padEnd(20)}  ABORT: ${r.abort}`);
    continue;
  }
  if (r.apiError) {
    console.log(`  ${r.sub.prefix.padEnd(10)} ${r.sub.expectedClass.padEnd(8)} ${r.sub.vendor_name.slice(0,20).padEnd(20)}  API ${r.status}: ${r.apiError?.slice(0,80)}`);
    continue;
  }
  let verdict;
  if (r.sub.expectedClass === "failure") {
    if (r.parseOk && r.itemCount > 0 && !r.truncated) verdict = "RECOVERED";
    else if (r.truncated) verdict = "STILL TRUNCATED (raise more?)";
    else if (!r.parseOk) verdict = "PARSE FAIL: " + r.parseError?.slice(0, 40);
    else verdict = "0 items";
  } else {
    const matches = r.itemCount === r.sub.expectedPgRows;
    verdict = matches ? "UNCHANGED ✓" : `DRIFT (${r.itemCount} vs ${r.sub.expectedPgRows})`;
  }
  console.log(`  ${r.sub.prefix.padEnd(10)} ${r.sub.expectedClass.padEnd(8)} ${r.sub.vendor_name.slice(0,20).padEnd(20)} ${String(r.outputTokens).padStart(6)} ${r.stopReason.padStart(10)} ${(r.truncated?"YES":"no").padStart(7)} ${(r.parseOk?"yes":"NO").padStart(7)} ${String(r.itemCount).padStart(6)} ${String(r.sub.expectedPgRows).padStart(7)}  ${verdict}`);
}
console.log("");
console.log("CHECKS:");
const failures = results.filter((r) => r.sub.expectedClass === "failure");
const normals  = results.filter((r) => r.sub.expectedClass === "normal");
const allFailRecover = failures.every((r) => r.parseOk && r.itemCount > 0 && !r.truncated);
const allNormalMatch = normals.every((r) => r.parseOk && r.itemCount === r.sub.expectedPgRows);
const noApiErrors    = results.every((r) => !r.apiError);
console.log(`  (a) API accepted max_tokens=${MAX_TOKENS_NEW}:    ${noApiErrors ? "YES ✓" : "NO ⚠"}`);
console.log(`  (b) 2 failures now extract clean valid JSON:  ${allFailRecover ? "YES ✓" : "NO ⚠"}`);
console.log(`  (c) 3 normals unchanged (item count match):   ${allNormalMatch ? "YES ✓" : "see drift above"}`);
