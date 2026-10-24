// Phase 4 Path C - fetch invoice images for top-80% TBJ-FL unresolved
// protein SKUs and read the actual pack size + per-unit weight for each line.
// Same "READ FROM DOC, DO NOT INFER" rule as Path B.
//
// Also fetches raw_drive_url per invoice_uuid from invoice_submissions.

import fs from "node:fs";
import { PDFDocument, PDFName } from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/pdf-lib/dist/pdf-lib.esm.js";
import { createClient } from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/@supabase/supabase-js/dist/index.mjs";
import dotenv from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/dotenv/lib/main.js";
import Anthropic from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/node_modules/@anthropic-ai/sdk/index.mjs";
import { google } from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/googleapis/build/src/index.js";
import { P } from "./_common4.mjs";

dotenv.config({ path: "/Users/kevinfietek/dev/kitchfix-intranet/.env.local", quiet: true });

const IN = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_path_c_targets.json";
const OUT = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_path_c_invoice_reads.json";
const CACHE = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_path_c_cache.json";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-4-5-20250929";

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
});
const drive = google.drive({ version: "v3", auth });

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
  for (const [_name, ref] of ResolvedXObject.entries()) {
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
      bytes: obj.contents,
      filter: filterName,
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
  const linesTxt = lines.map((l, i) => `  Line ${i + 1}: description="${l.description}" pack_size_extracted="${l.pack_size || '(missing)'}" quantity_extracted=${l.quantity} extended_price=${l.extended_price}`).join("\n");
  return `You are reading a food service invoice image (Sysco / Cheney Brothers / Gordon Food Service). I need the ACTUAL pack size (units per case AND pounds per unit or the total weight shipped) for the following line items. The previous OCR either missed the pack size or the extracted value looks garbled.

For EACH line below, look at the invoice image and report EXACTLY what the pack size and/or weight-shipped text reads. Extract verbatim. If you cannot see it or the invoice doesn't show it, mark as "illegible" or "not_visible".

Lines to read:
${linesTxt}

Return JSON only, no prose. Schema:
{
  "reads": [
    {
      "line_index": 1,
      "pack_size_verbatim": "<exact string from invoice, e.g. '10/14 OZ' or '1/15 LB' or '4/10 LB'>" | "illegible" | "not_visible",
      "case_count": <integer number of packs per case, or null>,
      "unit_weight_lb": <pounds per unit (converting oz to lb), or null>,
      "total_lb_per_case": <case_count * unit_weight_lb, or null if not derivable>,
      "shipped_weight_lb": <if invoice explicitly prints "Total Weight Shipped" or "Catch Weight" for this line, put it here, else null>,
      "confidence": <0-100>,
      "notes": "<what you see, e.g. 'pack column shows 10/14 OZ' or 'pack column has just the item description, no pack shown'>"
    }
  ]
}

Rules:
- Do NOT infer or guess. READ from the image only.
- Do NOT use knowledge of typical product pack sizes.
- Convert oz to lb (1 oz = 0.0625 lb): "10/14 OZ" -> case_count=10, unit_weight_lb=0.875, total_lb_per_case=8.75.
- "1/15 LB" -> case_count=1, unit_weight_lb=15, total_lb_per_case=15.
- If pack shows "410#AVG" or "182#AVG" or "428-13#CAB": these are catch-weight indicators (units of "AVG" or "#" denote pounds-average) - report verbatim in pack_size_verbatim and give a best-effort case_count / unit_weight_lb.
- If unclear, set confidence low and describe in notes.`;
}

let cache = {};
if (fs.existsSync(CACHE)) {
  try { cache = JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch { cache = {}; }
}

const t = JSON.parse(fs.readFileSync(IN, "utf8"));

// Fetch raw_drive_url for each invoice_uuid
const uuids = t.invoices.map((i) => i.invoice_uuid);
console.log(`[4-pathC] fetching raw_drive_url for ${uuids.length} invoices...`);
const urls = {};
// Batch fetch
const chunkSize = 50;
for (let i = 0; i < uuids.length; i += chunkSize) {
  const chunk = uuids.slice(i, i + chunkSize);
  const { data, error } = await supa.from("invoice_submissions").select("id, raw_drive_url, invoice_number, invoice_date, status").in("id", chunk);
  if (error) throw error;
  for (const r of data) urls[r.id] = r;
}
for (const inv of t.invoices) {
  const u = urls[inv.invoice_uuid];
  inv.raw_drive_url = u?.raw_drive_url || null;
  inv.invoice_number = u?.invoice_number || null;
  inv.status = u?.status || null;
}
const withUrl = t.invoices.filter((i) => i.raw_drive_url);
console.log(`[4-pathC] ${withUrl.length} of ${t.invoices.length} have raw_drive_url`);

const results = [];
let costEst = 0;
const PRICE_IN = 3.0 / 1_000_000;
const PRICE_OUT = 15.0 / 1_000_000;
let stopReason = null;
let consecutiveFailures = 0;
let lastFailureKind = null;

for (let idx = 0; idx < withUrl.length; idx++) {
  const inv = withUrl[idx];
  console.log(`\n[${idx + 1}/${withUrl.length}] ${inv.invoice_uuid.slice(0, 8)} inv#=${inv.invoice_number} lines=${inv.lines.length}`);
  const cacheKey = inv.invoice_uuid;
  if (cache[cacheKey]) {
    console.log(`  cached`);
    results.push(cache[cacheKey]);
    continue;
  }
  let pages;
  try {
    pages = await fetchInvoicePages(inv.raw_drive_url);
    console.log(`  fetched ${pages.length} pages`);
  } catch (e) {
    console.log(`  drive fetch failed: ${e.message}`);
    results.push({ invoice_uuid: inv.invoice_uuid, error: `drive_fetch:${e.message}`, reads: [] });
    if (lastFailureKind === "drive") consecutiveFailures += 1; else { consecutiveFailures = 1; lastFailureKind = "drive"; }
    if (consecutiveFailures >= 2) { stopReason = `2 drive fetch failures`; break; }
    continue;
  }
  if (pages.length === 0) {
    console.log(`  zero usable pages`);
    results.push({ invoice_uuid: inv.invoice_uuid, error: "zero_pages", reads: [] });
    if (lastFailureKind === "zero_pages") consecutiveFailures += 1; else { consecutiveFailures = 1; lastFailureKind = "zero_pages"; }
    if (consecutiveFailures >= 2) { stopReason = `2 zero_pages`; break; }
    continue;
  }
  const prompt = buildPrompt(inv.lines);
  const content = [];
  for (const p of pages) content.push({ type: "image", source: { type: "base64", media_type: p.mediaType, data: p.base64 } });
  content.push({ type: "text", text: prompt });
  try {
    const resp = await anthropic.messages.create({ model: MODEL, max_tokens: 4096, messages: [{ role: "user", content }] });
    const usage = resp.usage;
    costEst += (usage.input_tokens + (usage.cache_creation_input_tokens || 0)) * PRICE_IN + usage.output_tokens * PRICE_OUT;
    let jsonText = (resp.content?.[0]?.text || "").trim();
    if (jsonText.startsWith("```")) jsonText = jsonText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    let parsed;
    try { parsed = JSON.parse(jsonText); }
    catch (pe) {
      console.log(`  parse fail: ${pe.message}`);
      results.push({ invoice_uuid: inv.invoice_uuid, error: `parse:${pe.message}`, raw_text: jsonText.slice(0, 500), reads: [] });
      if (lastFailureKind === "parse") consecutiveFailures += 1; else { consecutiveFailures = 1; lastFailureKind = "parse"; }
      if (consecutiveFailures >= 2) { stopReason = `2 parse failures`; break; }
      continue;
    }
    console.log(`  usage: in=${usage.input_tokens} out=${usage.output_tokens} reads=${parsed.reads?.length || 0}`);
    for (const r of (parsed.reads || [])) {
      const line = inv.lines[r.line_index - 1];
      if (line) console.log(`    line ${r.line_index}: pack="${r.pack_size_verbatim}" total_lb=${r.total_lb_per_case} shipped=${r.shipped_weight_lb} conf=${r.confidence}`);
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
    console.log(`  api err: ${e.message}`);
    results.push({ invoice_uuid: inv.invoice_uuid, error: `api:${e.message}`, reads: [] });
    if (lastFailureKind === "api") consecutiveFailures += 1; else { consecutiveFailures = 1; lastFailureKind = "api"; }
    if (consecutiveFailures >= 2) { stopReason = `2 API failures`; break; }
    continue;
  }
}

fs.writeFileSync(OUT, JSON.stringify({ results, cost_estimate_usd: Math.round(costEst * 10000) / 10000, stop_reason: stopReason }, null, 2));
console.log(`\n[4-pathC] wrote ${OUT}`);
console.log(`[4-pathC] est cost: $${(Math.round(costEst * 10000) / 10000).toFixed(4)}`);
if (stopReason) console.log(`[4-pathC] STOPPED: ${stopReason}`);
