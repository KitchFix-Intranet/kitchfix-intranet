// Q14 self-answer: for GFS invoices with 'NxN CO' pack code, does the invoice
// PDF show total case weight (TOT WT, CASE WT, WEIGHT, etc.) that our
// parser is currently missing?
//
// Method: sample 4 GFS invoices with NxN CO pack rows, fetch the PDF pages via
// Drive, hand them to Sonnet vision, ask a targeted question. Report per-invoice
// what the CASE lines show.

import fs from "node:fs";
import { PDFDocument, PDFName } from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/pdf-lib/dist/pdf-lib.esm.js";
import { createClient } from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/@supabase/supabase-js/dist/index.mjs";
import dotenv from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/dotenv/lib/main.js";
import Anthropic from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/node_modules/@anthropic-ai/sdk/index.mjs";
import { google } from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/googleapis/build/src/index.js";
import { P } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_common4.mjs";
import { P5 } from "./_common5.mjs";

dotenv.config({ path: "/Users/kevinfietek/dev/kitchfix-intranet/.env.local", quiet: true });

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
  const m1 = url.match(/\/file\/d\/([^/]+)\//); if (m1) return m1[1];
  const m2 = url.match(/[?&]id=([^&]+)/); if (m2) return m2[1];
  if (/^[A-Za-z0-9_-]{20,}$/.test(url.trim())) return url.trim();
  return null;
}
function pdfLookup(pdf, ro) { if (!ro) return null; try { return pdf.context.lookup(ro); } catch { return ro; } }
function pageImageXObjects(pdf, page) {
  const out = [];
  const Resources = page.node.normalizedEntries?.()?.Resources;
  if (!Resources) return out;
  const R = pdfLookup(pdf, Resources);
  const X = R?.get?.(PDFName.of("XObject")); if (!X) return out;
  const RX = pdfLookup(pdf, X); if (!RX || typeof RX.entries !== "function") return out;
  for (const [_, ref] of RX.entries()) {
    const obj = pdfLookup(pdf, ref); if (!obj) continue;
    const dict = obj.dict || obj; if (typeof dict.get !== "function") continue;
    const subtype = dict.get(PDFName.of("Subtype"));
    const stName = subtype?.encodedName || String(subtype || "");
    if (!stName.includes("Image")) continue;
    const filter = dict.get(PDFName.of("Filter"));
    const fName = filter?.encodedName || String(filter || "");
    out.push({ bytes: obj.contents, filter: fName });
  }
  return out;
}
function imgToInline(img) {
  if (!img.bytes) return null;
  const f = String(img.filter || "");
  let mt;
  if (f.includes("DCTDecode")) mt = "image/jpeg";
  else if (f.includes("CCITTFaxDecode")) mt = "image/tiff";
  else return null;
  return { mediaType: mt, base64: Buffer.from(img.bytes).toString("base64") };
}
async function fetchPages(driveUrl) {
  const fid = extractDriveFileId(driveUrl);
  if (!fid) throw new Error("no fileid");
  const res = await drive.files.get({ fileId: fid, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
  const bytes = Buffer.from(res.data);
  const pdf = await PDFDocument.load(bytes);
  const pages = [];
  for (let i = 0; i < pdf.getPageCount(); i++) {
    const pg = pdf.getPage(i);
    const imgs = pageImageXObjects(pdf, pg);
    if (imgs.length === 0) continue;
    imgs.sort((a,b)=> Number(b.bytes?.length||0) - Number(a.bytes?.length||0));
    const best = imgs[0];
    const inline = imgToInline(best);
    if (inline) pages.push(inline);
  }
  return pages;
}

// -------- Sample 4 GFS invoices that carry NxN CO rows ----------
const AUG = JSON.parse(fs.readFileSync(P.AUG, "utf8")).rows;
const target = AUG.filter(r => /GORDON/i.test(r.vendor_name || "") && /^\s*\d+\s*[xX]\s*\d+\s*CO\s*$/.test(r.pack_size || ""));
const uuidsSeen = new Set();
const sampleUuids = [];
for (const r of target) {
  if (!r.invoice_uuid || uuidsSeen.has(r.invoice_uuid)) continue;
  uuidsSeen.add(r.invoice_uuid);
  sampleUuids.push(r.invoice_uuid);
  if (sampleUuids.length >= 4) break;
}
console.log(`Sampling ${sampleUuids.length} GFS invoices with NxN CO rows`);

const { data: subs, error } = await supa
  .from("invoice_submissions")
  .select("id, raw_drive_url, invoice_number, vendor_id, account_key, invoice_date")
  .in("id", sampleUuids);
if (error) throw error;

const results = [];
let totalCost = 0;
for (const s of subs) {
  const lines = target.filter(r => r.invoice_uuid === s.id).slice(0, 5);
  console.log(`\n[${s.invoice_number || s.id}] ${lines.length} NxN CO lines`);
  if (!s.raw_drive_url) { results.push({ invoice_uuid: s.id, error: "no raw_drive_url" }); continue; }
  let pages;
  try { pages = await fetchPages(s.raw_drive_url); }
  catch (e) { results.push({ invoice_uuid: s.id, error: `fetch: ${e.message}` }); continue; }
  if (!pages.length) { results.push({ invoice_uuid: s.id, error: "no page images" }); continue; }

  const linesTxt = lines.map((l, i) =>
    `  Line ${i+1}: description="${l.description}" pack_size_extracted="${l.pack_size}" qty=${l.quantity} ep=$${l.extended_price}`
  ).join("\n");

  const prompt = `You are reading a Gordon Food Service (GFS) invoice PDF image. I have listed a few line items below where our parser extracted a pack_size like "60x1 CO" or "4x6 CO" - GFS's shorthand for "6 units of 10-oz" or similar. Our parser doesn't understand these codes AND we suspect that a separate CASE line elsewhere on the invoice shows the total shipped weight.

For each line below, look at the invoice image and REPORT VERBATIM what is printed:

1. What does the pack column literally read?
2. Is there a separate "CASE" line, "TOT WT" line, or any weight-in-pounds figure anywhere on the invoice that corresponds to this SKU? Copy the exact text verbatim.
3. Is there a "SHIPPED WT", "NET WT", or "TOTAL WEIGHT" summary column anywhere?

Lines:
${linesTxt}

Reply STRICT JSON only:
{
  "invoice_has_weight_column": true|false,
  "invoice_has_case_line_with_weight": true|false,
  "per_line": [
    { "line_index": 1, "pack_verbatim": "...", "weight_visible_lb": null | number, "weight_source": "case_line" | "totals_column" | "not_visible", "notes": "..." }
  ]
}`;

  const msgs = [{
    role: "user",
    content: [
      { type: "text", text: prompt },
      ...pages.slice(0, 3).map((p) => ({
        type: "image",
        source: { type: "base64", media_type: p.mediaType, data: p.base64 },
      })),
    ],
  }];

  const resp = await anthropic.messages.create({
    model: MODEL, max_tokens: 2048,
    system: "You are an assistant that READS what the invoice shows. Do not infer. Return STRICT JSON.",
    messages: msgs,
  });
  const usage = resp.usage;
  const inTok = usage.input_tokens || 0;
  const outTok = usage.output_tokens || 0;
  const cost = (inTok/1_000_000)*3 + (outTok/1_000_000)*15;
  totalCost += cost;
  const text = resp.content?.[0]?.text || "";
  let parsed = null;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
  } catch { }
  console.log(`  cost=$${cost.toFixed(3)} tokens=${inTok}/${outTok}`);
  if (parsed) {
    console.log(`  invoice_has_weight_column=${parsed.invoice_has_weight_column} case_line_with_weight=${parsed.invoice_has_case_line_with_weight}`);
    for (const pl of (parsed.per_line || [])) {
      console.log(`    L${pl.line_index}: pack="${pl.pack_verbatim}" weight_lb=${pl.weight_visible_lb} src=${pl.weight_source}`);
    }
  } else {
    console.log(`  raw response: ${text.slice(0,300)}`);
  }
  results.push({
    invoice_uuid: s.id, invoice_number: s.invoice_number, account: s.account_key,
    lines_probed: lines.length, cost, parsed, raw: text.slice(0, 1200),
  });
}

fs.writeFileSync(P5.Q14_GFS, JSON.stringify({
  model: MODEL,
  invoices_probed: sampleUuids.length,
  total_cost_usd: totalCost,
  results,
}, null, 2));
console.log(`\nTotal cost: $${totalCost.toFixed(3)}`);
console.log(`wrote ${P5.Q14_GFS}`);
