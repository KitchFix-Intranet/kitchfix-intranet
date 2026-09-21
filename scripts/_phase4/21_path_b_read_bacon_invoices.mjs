// Phase 4 Path B - Rescan the 11 bacon invoices via Anthropic Sonnet vision to
// read the actual pack sizes for the 16 bacon lines Phase 3c excluded.
//
// Strict scope:
//   - READ-ONLY. No DB writes (no DELETE, no INSERT, no UPDATE).
//   - Only pack size, per-unit-weight, and case count are extracted (no rewrite
//     of the full invoice). Result stored in _path_b_invoice_reads.json.
//   - "Do NOT infer pack size from what would make the price look reasonable"
//     -> the prompt requires us to READ from the doc. If illegible: leave
//     unresolved. If legible: cite the exact string.

import fs from "node:fs";
import { PDFDocument, PDFName } from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/pdf-lib/dist/pdf-lib.esm.js";
import { createClient } from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/@supabase/supabase-js/dist/index.mjs";
import dotenv from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/dotenv/lib/main.js";
import Anthropic from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/node_modules/@anthropic-ai/sdk/index.mjs";
import { google } from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/googleapis/build/src/index.js";

dotenv.config({ path: "/Users/kevinfietek/dev/kitchfix-intranet/.env.local", quiet: true });

const IN = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_path_b_targets.json";
const OUT = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_path_b_invoice_reads.json";
const CACHE = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_path_b_cache.json";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-4-5-20250929";

function buildDriveClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY env");
  }
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return google.drive({ version: "v3", auth });
}
const drive = buildDriveClient();

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
      bytes: obj.contents,
      filter: filterName,
      width: width?.value?.() ?? width,
      height: height?.value?.() ?? height,
    });
  }
  return out;
}
function imageToInlineData(img) {
  if (!img.bytes) return null;
  const filter = String(img.filter || "");
  let mediaType;
  if (filter.includes("DCTDecode")) mediaType = "image/jpeg";
  else if (filter.includes("CCITTFaxDecode")) mediaType = "image/tiff";
  else return null;
  const base64 = Buffer.from(img.bytes).toString("base64");
  return { mediaType, base64, bytes: img.bytes.length };
}

async function fetchInvoicePages(driveUrl) {
  const fileId = extractDriveFileId(driveUrl);
  if (!fileId) throw new Error("cannot parse drive file id");
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );
  const bytes = Buffer.from(res.data);
  const pdf = await PDFDocument.load(bytes);
  const pageCount = pdf.getPageCount();
  const pages = [];
  for (let i = 0; i < pageCount; i++) {
    const pg = pdf.getPage(i);
    const imgs = pageImageXObjects(pdf, pg);
    if (imgs.length === 0) continue;
    imgs.sort((a, b) => Number(b.bytes?.length || 0) - Number(a.bytes?.length || 0));
    const best = imgs[0];
    const inline = imageToInlineData(best);
    if (inline) pages.push(inline);
  }
  return pages;
}

function buildPrompt(lines) {
  const linesTxt = lines.map((l, i) => `  Line ${i + 1}: description="${l.description}" pack_size_extracted="${l.pack_size}" quantity_extracted=${l.quantity} extended_price=${l.extended_price}`).join("\n");
  return `You are reading a Sysco invoice image. I need the ACTUAL pack size (units per case AND pounds per unit) for the following bacon line items. These are Sysco "LAYFLAT" bacon SKUs. The previous OCR extracted "115LB" or similar 3-digit LB shapes for pack size, which is almost certainly a garbled reading (the invoice likely prints "1/15 LB" or "10/14 OZ" or similar; the parser lost the slash).

For EACH line below, look at the invoice image and report EXACTLY what the pack size string reads. If you can see it in the image, extract the pack size text verbatim. If you cannot see it, or if the invoice does not show a pack size, mark it as illegible.

Lines to read:
${linesTxt}

Return JSON only, no prose. Schema:
{
  "reads": [
    {
      "line_index": 1,
      "pack_size_verbatim": "<exact string from invoice, e.g. '10/14 OZ' or '1/15 LB'>" | "illegible" | "not_visible",
      "case_count": <integer number of packs per case>,
      "unit_weight_lb": <pounds per unit>,
      "total_lb_per_case": <case_count * unit_weight_lb>,
      "confidence": <0-100>,
      "notes": "<brief description of what you see, or why illegible>"
    }
  ]
}

Rules:
- Do NOT infer or guess pack size from what would make the price look reasonable.
- Do NOT use knowledge of typical bacon pack sizes. READ from the image only.
- If the image shows "10/14 OZ": case_count=10, unit_weight_lb=0.875, total_lb_per_case=8.75.
- If the image shows "2/15 LB": case_count=2, unit_weight_lb=15, total_lb_per_case=30.
- If you cannot see the pack size clearly in the image, mark as "illegible" and confidence=0.`;
}

let cache = {};
if (fs.existsSync(CACHE)) {
  try { cache = JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch { cache = {}; }
}

const t = JSON.parse(fs.readFileSync(IN, "utf8"));
const results = [];
let costEst = 0;
const PRICE_IN = 3.0 / 1_000_000;
const PRICE_OUT = 15.0 / 1_000_000;

let stopReason = null;
let consecutiveFailures = 0;
let lastFailureKind = null;

for (let idx = 0; idx < t.invoices.length; idx++) {
  const inv = t.invoices[idx];
  console.log(`\n[${idx + 1}/${t.invoices.length}] ${inv.invoice_uuid} inv#=${inv.invoice_number}`);
  const cacheKey = inv.invoice_uuid;
  if (cache[cacheKey]) {
    console.log(`  cached, skip`);
    results.push(cache[cacheKey]);
    continue;
  }
  if (!inv.raw_drive_url) {
    console.log(`  no drive url, skip`);
    results.push({ invoice_uuid: inv.invoice_uuid, error: "no_drive_url", reads: [] });
    continue;
  }
  let pages;
  try {
    pages = await fetchInvoicePages(inv.raw_drive_url);
    console.log(`  fetched ${pages.length} pages`);
  } catch (e) {
    const kind = "drive_fetch";
    console.log(`  drive fetch failed: ${e.message}`);
    results.push({ invoice_uuid: inv.invoice_uuid, error: `drive_fetch:${e.message}`, reads: [] });
    if (lastFailureKind === kind) consecutiveFailures += 1; else { consecutiveFailures = 1; lastFailureKind = kind; }
    if (consecutiveFailures >= 2) { stopReason = `two failed drive fetches in a row`; break; }
    continue;
  }
  if (pages.length === 0) {
    const kind = "zero_pages";
    console.log(`  zero usable pages`);
    results.push({ invoice_uuid: inv.invoice_uuid, error: "zero_pages", reads: [] });
    if (lastFailureKind === kind) consecutiveFailures += 1; else { consecutiveFailures = 1; lastFailureKind = kind; }
    if (consecutiveFailures >= 2) { stopReason = `two invoices with zero usable pages`; break; }
    continue;
  }
  const prompt = buildPrompt(inv.lines);
  const content = [];
  for (const p of pages) {
    content.push({ type: "image", source: { type: "base64", media_type: p.mediaType, data: p.base64 } });
  }
  content.push({ type: "text", text: prompt });
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content }],
    });
    const usage = resp.usage;
    costEst += (usage.input_tokens + (usage.cache_creation_input_tokens || 0)) * PRICE_IN + usage.output_tokens * PRICE_OUT;
    const txt = resp.content?.[0]?.text || "";
    let jsonText = txt.trim();
    if (jsonText.startsWith("```")) jsonText = jsonText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (pe) {
      console.log(`  parse fail: ${pe.message}`);
      results.push({ invoice_uuid: inv.invoice_uuid, error: `parse:${pe.message}`, raw_text: txt, reads: [] });
      const kind = "parse";
      if (lastFailureKind === kind) consecutiveFailures += 1; else { consecutiveFailures = 1; lastFailureKind = kind; }
      if (consecutiveFailures >= 2) { stopReason = `two parse failures in a row`; break; }
      continue;
    }
    console.log(`  usage: in=${usage.input_tokens} out=${usage.output_tokens}  reads=${parsed.reads?.length || 0}`);
    for (const r of (parsed.reads || [])) {
      const line = inv.lines[r.line_index - 1];
      if (line) console.log(`    line ${r.line_index} (${(line.description || '').slice(0, 40)}...): pack="${r.pack_size_verbatim}" total_lb=${r.total_lb_per_case} conf=${r.confidence}`);
    }
    const out = {
      invoice_uuid: inv.invoice_uuid,
      invoice_number: inv.invoice_number,
      pages: pages.length,
      lines: inv.lines,
      reads: parsed.reads || [],
      usage,
    };
    cache[cacheKey] = out;
    fs.writeFileSync(CACHE, JSON.stringify(cache));
    results.push(out);
    consecutiveFailures = 0;
    lastFailureKind = null;
  } catch (e) {
    const kind = "api";
    console.log(`  api err: ${e.message}`);
    results.push({ invoice_uuid: inv.invoice_uuid, error: `api:${e.message}`, reads: [] });
    if (lastFailureKind === kind) consecutiveFailures += 1; else { consecutiveFailures = 1; lastFailureKind = kind; }
    if (consecutiveFailures >= 2) { stopReason = `two API failures in a row`; break; }
    continue;
  }
}

fs.writeFileSync(OUT, JSON.stringify({ results, cost_estimate_usd: Math.round(costEst * 10000) / 10000, stop_reason: stopReason }, null, 2));
console.log(`\n[4-pathB] wrote ${OUT}`);
console.log(`[4-pathB] est cost: $${(Math.round(costEst * 10000) / 10000).toFixed(4)}`);
if (stopReason) console.log(`[4-pathB] STOPPED: ${stopReason}`);
