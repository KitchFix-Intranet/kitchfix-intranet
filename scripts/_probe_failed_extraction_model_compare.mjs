// READ-ONLY: re-extract a sample of failed Shamrock/Cheney/Peddler's/Sunfresh
// invoices using both the CURRENT production model + a CANDIDATE newer model.
// Side-by-side comparison shows whether failure mode is "model output" vs
// "genuinely unreadable input." NO WRITES to any store - this is a pure
// Anthropic-call probe.
//
// Drive + PDF + image-extraction pattern reused verbatim from
// scripts/_rescan_silent_gap.mjs (DCTDecode/JPEG path).
//
// Cost note: each invoice = 2 Anthropic calls (one per model). Production
// rate is ~$0.02-0.05 per call; 5 invoices x 2 models = ~$0.20-0.50 total.

import { createClient } from "@supabase/supabase-js";
import { PDFDocument, PDFName } from "pdf-lib";
import { getServiceAccountDriveClient } from "../src/lib/sheets.js";
import { EXTRACTION_PROMPT } from "../src/lib/invoiceActions.js";

const PROD_MODEL = "claude-sonnet-4-20250514";
const CANDIDATE_MODEL = "claude-sonnet-4-6";  // current Sonnet upgrade from Sonnet 4 (May 2025)

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── Pick 5 failed invoices spread across high-fail vendors ────────────────
const { data: candidates } = await supa
  .from("invoice_submissions")
  .select("id, client_uuid, account_key, vendor_name, invoice_number, submitted_at, page_count, raw_drive_url")
  .eq("is_historical", false)
  .eq("ai_scan_status", "failed")
  .in("vendor_name", ["Shamrock Foods", "Cheney Brothers", "Peddler's Son", "Sunfresh Produce-Englewood"])
  .order("submitted_at", { ascending: false })
  .limit(20);
// take 1-2 per vendor to spread coverage
const byVendor = new Map();
const sample = [];
for (const c of candidates) {
  if (!c.raw_drive_url) continue;
  const taken = byVendor.get(c.vendor_name) || 0;
  if (taken >= 2) continue;
  byVendor.set(c.vendor_name, taken + 1);
  sample.push(c);
  if (sample.length >= 6) break;
}
console.log(`Selected ${sample.length} failed invoices:`);
for (const s of sample) console.log(`  ${s.client_uuid.slice(0,8)}  ${s.account_key.padEnd(14)}  "${s.vendor_name}"  inv#=${s.invoice_number}  pages=${s.page_count}`);
console.log("");

// ── Drive download + PDF page-image extraction (verbatim from rescan canary) ──
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

async function extractPagesForInvoice(sub) {
  const fileId = extractDriveFileId(sub.raw_drive_url);
  if (!fileId) return { error: "Could not parse Drive fileId", pages: [] };
  let bytes;
  try {
    const res = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" }
    );
    bytes = Buffer.from(res.data);
  } catch (e) {
    return { error: `Drive fetch: ${e.message}`, pages: [] };
  }
  const pdf = await PDFDocument.load(bytes);
  const pdfPageCount = pdf.getPageCount();
  const pages = [];
  const pageReports = [];
  for (let i = 0; i < pdfPageCount; i++) {
    const pg = pdf.getPage(i);
    const imgs = pageImageXObjects(pdf, pg);
    if (imgs.length === 0) {
      pageReports.push(`page ${i + 1}: no image XObjects`);
      continue;
    }
    imgs.sort((a, b) => Number(b.bytes?.length || 0) - Number(a.bytes?.length || 0));
    const best = imgs[0];
    const result = imageXObjectToPage(best);
    if (!result || result.error) {
      pageReports.push(`page ${i + 1}: ${result?.error || "unsupported"}`);
      continue;
    }
    pageReports.push(`page ${i + 1}: ${result.mediaType} ${result.width}x${result.height} ${(result.bytes/1024).toFixed(0)}KB`);
    pages.push(result.page);
  }
  return { pages, pageReports, fileBytes: bytes.length };
}

// ── Anthropic call ────────────────────────────────────────────────────────
async function callClaude(model, pages) {
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
      model,
      max_tokens: 8192,
      messages: [{ role: "user", content: [...imageBlocks, { type: "text", text: EXTRACTION_PROMPT }] }],
    }),
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (!res.ok) {
    return { ok: false, error: `${res.status} ${await res.text()}`, elapsed };
  }
  const result = await res.json();
  const text = result.content?.[0]?.text || "";
  const usage = result.usage || {};
  // Detect truncation: stop_reason !== "end_turn" + max output_tokens
  const stopReason = result.stop_reason || "?";
  const truncated = stopReason === "max_tokens";

  let parsed = null;
  let parseError = null;
  try {
    const cleanJson = text.replace(/```json\s*|```/g, "").trim();
    parsed = JSON.parse(cleanJson);
  } catch (e) {
    parseError = e.message;
  }
  const items = parsed?.lineItems || [];
  return {
    ok: true,
    elapsed,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    stopReason,
    truncated,
    parseOk: !parseError,
    parseError,
    itemCount: items.length,
    rawTextLen: text.length,
    firstItem: items[0] ? { desc: items[0].description, qty: items[0].quantity, price: items[0].unitPrice } : null,
  };
}

// ── Main: per-invoice download + dual-model call + report ─────────────────
const results = [];
for (const sub of sample) {
  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`  ${sub.client_uuid.slice(0,8)}  ${sub.account_key}  "${sub.vendor_name}"  inv#=${sub.invoice_number}  pages=${sub.page_count}`);
  console.log("════════════════════════════════════════════════════════════════════");

  const { pages, pageReports, error: extractErr, fileBytes } = await extractPagesForInvoice(sub);
  if (extractErr) {
    console.log(`  ABORT: ${extractErr}`);
    results.push({ sub, prodOk: false, prodNote: "drive/pdf abort: " + extractErr });
    continue;
  }
  console.log(`  Drive PDF: ${(fileBytes/1024).toFixed(0)}KB`);
  for (const r of pageReports) console.log(`    ${r}`);
  console.log(`  Usable page images extracted: ${pages.length}`);
  if (pages.length === 0) {
    console.log(`  ABORT: 0 usable pages (would have failed in prod too - probably non-DCT PDF)`);
    results.push({ sub, prodOk: false, prodNote: "0 usable pages from PDF" });
    continue;
  }

  // PROD model run
  console.log(`  Running PROD model: ${PROD_MODEL}`);
  const prodResult = await callClaude(PROD_MODEL, pages);
  if (!prodResult.ok) {
    console.log(`    API ERROR: ${prodResult.error.slice(0,120)}`);
  } else {
    console.log(`    ${prodResult.elapsed}s  in=${prodResult.inputTokens}t out=${prodResult.outputTokens}t  stop=${prodResult.stopReason}  truncated=${prodResult.truncated}  parsed=${prodResult.parseOk}  items=${prodResult.itemCount}`);
    if (prodResult.firstItem) console.log(`    first item: "${prodResult.firstItem.desc?.slice(0,40)}" qty=${prodResult.firstItem.qty} $${prodResult.firstItem.price}`);
    if (!prodResult.parseOk) console.log(`    parse err: ${prodResult.parseError?.slice(0,100)}`);
  }

  // CANDIDATE model run
  console.log(`  Running CANDIDATE model: ${CANDIDATE_MODEL}`);
  const candResult = await callClaude(CANDIDATE_MODEL, pages);
  if (!candResult.ok) {
    console.log(`    API ERROR: ${candResult.error.slice(0,120)}`);
  } else {
    console.log(`    ${candResult.elapsed}s  in=${candResult.inputTokens}t out=${candResult.outputTokens}t  stop=${candResult.stopReason}  truncated=${candResult.truncated}  parsed=${candResult.parseOk}  items=${candResult.itemCount}`);
    if (candResult.firstItem) console.log(`    first item: "${candResult.firstItem.desc?.slice(0,40)}" qty=${candResult.firstItem.qty} $${candResult.firstItem.price}`);
    if (!candResult.parseOk) console.log(`    parse err: ${candResult.parseError?.slice(0,100)}`);
  }
  results.push({ sub, prodResult, candResult, pageImageCount: pages.length });
  console.log("");
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log("════════════════════════════════════════════════════════════════════");
console.log("  SUMMARY");
console.log("════════════════════════════════════════════════════════════════════");
console.log(`  Invoices tested: ${results.length}`);
console.log("");
console.log(`  ${"uuid".padEnd(10)} ${"vendor".padEnd(20)} ${"pages".padStart(6)}  ${"PROD items".padStart(12)} ${"PROD stop".padStart(13)}  ${"NEW items".padStart(10)} ${"NEW stop".padStart(12)}`);
console.log(`  ${"-".repeat(10)} ${"-".repeat(20)} ${"-".repeat(6)}  ${"-".repeat(12)} ${"-".repeat(13)}  ${"-".repeat(10)} ${"-".repeat(12)}`);
for (const r of results) {
  if (!r.prodResult) {
    console.log(`  ${r.sub.client_uuid.slice(0,10).padEnd(10)} ${r.sub.vendor_name.slice(0,20).padEnd(20)} ${String(r.sub.page_count).padStart(6)}  ${r.prodNote || "(skipped)"}`);
    continue;
  }
  const pi = r.prodResult.itemCount ?? "?";
  const ci = r.candResult?.itemCount ?? "?";
  const ps = r.prodResult.stopReason ?? "?";
  const cs = r.candResult?.stopReason ?? "?";
  console.log(`  ${r.sub.client_uuid.slice(0,10).padEnd(10)} ${r.sub.vendor_name.slice(0,20).padEnd(20)} ${String(r.sub.page_count).padStart(6)}  ${String(pi).padStart(12)} ${ps.padStart(13)}  ${String(ci).padStart(10)} ${cs.padStart(12)}`);
}
