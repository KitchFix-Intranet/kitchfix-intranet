// ════════════════════════════════════════════════════════════════════════════
// PROBE: F5 rasterization test - does qlmanage high-DPI rendering recover
// readable numbers on known-bad Kuna scans?
//
// READ-ONLY. ~$0.10 API cost.
//
// Compares native (pdf-lib embedded image extraction, what the live pipeline
// uses) vs qlmanage page render at -s 2500 (~225 DPI on US-letter) on Kuna
// #22416-00, which Q2 just showed has most numbers null. If the rasterized
// variant produces additional numeric reads, rasterization is worth piloting.
// If results are identical, the embedded image IS the bottleneck and the
// floor is real.
// ════════════════════════════════════════════════════════════════════════════

import { writeFile, mkdir, stat } from "node:fs/promises";
import { execSync } from "node:child_process";
import { PDFDocument, PDFName } from "pdf-lib";
import { getServiceAccountDriveClient, safeRead, SHEET_IDS } from "../src/lib/sheets.js";
import { EXTRACTION_PROMPT } from "../src/lib/invoiceActions.js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY missing"); process.exit(2); }

// Test on three Kuna invoices: the catch-weight pair + the worst scan-quality N/A pair
const TARGETS = ["22416-00", "215530-00"];

const { rows: subRows } = await safeRead(SHEET_IDS.COLLECTION, "invoice_submissions_26");
const SUB_IDX = { uuid: 0, vendor: 4, invoiceNumber: 6, driveUrls: 10, rawDriveUrl: 16 };

function extractDriveFileId(url) {
  if (!url) return null;
  const m1 = url.match(/\/file\/d\/([^/]+)\//);
  if (m1) return m1[1];
  const m2 = url.match(/[?&]id=([^&]+)/);
  if (m2) return m2[1];
  if (/^[A-Za-z0-9_-]{20,}$/.test(url.trim())) return url.trim();
  return null;
}

const drive = getServiceAccountDriveClient(["https://www.googleapis.com/auth/drive.readonly"]);
async function fetchPdf(fileId) {
  const res = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
  return Buffer.from(res.data);
}

function pdfLookup(pdf, refOrObj) { try { return pdf.context.lookup(refOrObj); } catch { return refOrObj; } }
function pageImageXObjects(pdf, page) {
  const out = [];
  const Resources = page.node.normalizedEntries?.()?.Resources;
  if (!Resources) return out;
  const XObject = pdfLookup(pdf, Resources)?.get?.(PDFName.of("XObject"));
  if (!XObject) return out;
  const Resolved = pdfLookup(pdf, XObject);
  if (typeof Resolved?.entries !== "function") return out;
  for (const [, ref] of Resolved.entries()) {
    const obj = pdfLookup(pdf, ref);
    const dict = obj?.dict || obj;
    if (typeof dict?.get !== "function") continue;
    const subtypeName = dict.get(PDFName.of("Subtype"))?.encodedName || "";
    if (!subtypeName.includes("Image")) continue;
    const filter = dict.get(PDFName.of("Filter"))?.encodedName || "";
    const w = dict.get(PDFName.of("Width"));
    const h = dict.get(PDFName.of("Height"));
    out.push({ bytes: obj.contents, filter, width: w?.value?.() ?? w, height: h?.value?.() ?? h });
  }
  return out;
}

async function callClaude(imageBlocks) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514", max_tokens: 16384,
      messages: [{ role: "user", content: [...imageBlocks, { type: "text", text: EXTRACTION_PROMPT }] }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return j.content?.[0]?.text || "";
}

function parseResponse(raw) {
  try {
    const cleaned = raw.replace(/```json\s*|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) try { return JSON.parse(m[0]); } catch {}
    return null;
  }
}

function summarize(label, items) {
  console.log(`  ${label}: ${items.length} line item(s)`);
  let nullPriceCount = 0, nullAmountCount = 0, weightLineCount = 0;
  for (const it of items) {
    if (it.unitPrice == null || it.unitPrice === 0) nullPriceCount++;
    if (it.amount == null || it.amount === 0) nullAmountCount++;
    if (it.weightLineValue != null && it.weightLineValue !== "") weightLineCount++;
  }
  console.log(`    null/zero unitPrice: ${nullPriceCount}/${items.length}`);
  console.log(`    null/zero amount:    ${nullAmountCount}/${items.length}`);
  console.log(`    weightLineValue populated: ${weightLineCount}/${items.length}`);
  console.log("    first 5 lines:");
  for (let i = 0; i < Math.min(5, items.length); i++) {
    const it = items[i];
    console.log(`      ${i+1}. "${(it.description||"").slice(0,40)}"  qty=${it.shippedCount} unit=${it.unitPrice} amount=${it.amount} weight=${it.weightLineValue ?? "-"}`);
  }
}

await mkdir("/tmp/f5_raster", { recursive: true });

for (const invNum of TARGETS) {
  const sub = subRows.findLast?.((r) => String(r[SUB_IDX.invoiceNumber] || "").trim() === invNum)
    || [...subRows].reverse().find((r) => String(r[SUB_IDX.invoiceNumber] || "").trim() === invNum);
  if (!sub) { console.error(`[!] no submission for invoice#=${invNum}`); continue; }
  const url = sub[SUB_IDX.rawDriveUrl] || sub[SUB_IDX.driveUrls] || "";
  const fileId = extractDriveFileId(url);
  if (!fileId) { console.error(`[!] no Drive file id for ${invNum}`); continue; }

  console.log("\n" + "=".repeat(100));
  console.log(`INVOICE: Kuna #${invNum}  uuid8=${(sub[SUB_IDX.uuid]||"").slice(0,8)}`);
  console.log("=".repeat(100));

  const bytes = await fetchPdf(fileId);
  console.log(`pdf bytes: ${bytes.length}`);

  // Save PDF for qlmanage
  const pdfPath = `/tmp/f5_raster/${invNum.replace(/\W/g,"_")}.pdf`;
  await writeFile(pdfPath, bytes);

  // ── VARIANT A: embedded image extraction (what the live pipeline does) ──
  const pdf = await PDFDocument.load(bytes);
  const page1 = pdf.getPage(0);
  const imgs = pageImageXObjects(pdf, page1);
  imgs.sort((a, b) => Number(b.bytes?.length || 0) - Number(a.bytes?.length || 0));
  const top = imgs[0];
  let nativeRes = "n/a";
  let nativeBytes = null;
  let nativeMedia = "image/jpeg";
  if (top?.bytes) {
    nativeRes = `${top.width}x${top.height}, filter=${top.filter}`;
    nativeBytes = top.bytes;
    if (String(top.filter).includes("CCITTFax")) nativeMedia = "image/tiff";
  }
  console.log(`\n[native embedded image]  res=${nativeRes}  bytes=${nativeBytes?.length || 0}`);

  // ── VARIANT B: qlmanage rasterized PNG at -s 2500 ──
  try {
    execSync(`qlmanage -t -s 2500 -o /tmp/f5_raster "${pdfPath}" 2>/dev/null`, { stdio: "pipe" });
  } catch {}
  const rasterPath = `${pdfPath}.png`;
  let rasterBytes = null;
  let rasterDims = "n/a";
  try {
    await stat(rasterPath);
    const fs = await import("node:fs/promises");
    rasterBytes = await fs.readFile(rasterPath);
    // Read PNG dimensions from header (IHDR chunk at offset 16)
    const w = rasterBytes.readUInt32BE(16);
    const h = rasterBytes.readUInt32BE(20);
    rasterDims = `${w}x${h}`;
  } catch { console.log("[!] qlmanage produced no PNG"); }
  console.log(`[qlmanage @ -s 2500]      res=${rasterDims}  bytes=${rasterBytes?.length || 0}`);

  // Send each variant and compare
  if (nativeBytes) {
    console.log("\n  >>> sending NATIVE embedded image to Claude...");
    const raw = await callClaude([{ type: "image", source: { type: "base64", media_type: nativeMedia, data: Buffer.from(nativeBytes).toString("base64") } }]);
    const parsed = parseResponse(raw);
    if (!parsed) console.log(`  [!] could not parse response. raw[0:300]=${raw.slice(0, 300)}`);
    else summarize("native", parsed.lineItems || []);
  }

  if (rasterBytes) {
    console.log("\n  >>> sending QLMANAGE rasterized PNG to Claude...");
    const raw = await callClaude([{ type: "image", source: { type: "base64", media_type: "image/png", data: rasterBytes.toString("base64") } }]);
    const parsed = parseResponse(raw);
    if (!parsed) console.log(`  [!] could not parse response. raw[0:300]=${raw.slice(0, 300)}`);
    else summarize("raster", parsed.lineItems || []);
  }
}
console.log("\n" + "=".repeat(100));
console.log("Done. Look for: does rasterized variant produce more populated unitPrice/amount fields?");
console.log("If YES: rasterization helps; pilot path worth building.");
console.log("If NO: embedded image IS the source; rasterization is dead weight; review-queue floor accepted.");
console.log("=".repeat(100));
