// Math-fail diagnostic: for the 3 worst-hit vendors (Cheney 17%, Sysco 26%,
// GFS 55%), re-extract via PDF mode (test rig style), then match each
// math-fail PDF-mode line against the production PG row (image mode) by
// description and print side-by-side. Includes Drive URL for eye-verification.
//
// Tells us:
//   - Pricing-model hypothesis: did PDF read per-lb where image read per-case?
//   - Multi-case hypothesis: did shippedCount differ between modes?
//   - Stage A presence in PDF-mode but absence in image-mode (the (B) question).
//   - Whether the math-fail lines in PDF mode are catch-weight (would cron-derive
//     to reconciling) or non-catch-weight (would just be queue-flood).
import { createClient } from "@supabase/supabase-js";
import { getServiceAccountDriveClient } from "@/lib/sheets";
import { EXTRACTION_PROMPT } from "@/lib/invoiceActions";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-4-20250514";

const TARGETS = [
  { vendor: "Cheney Brothers",     invoiceNumber: "20-910735530" },
  { vendor: "Sysco",               invoiceNumber: "532396224" },
  { vendor: "Gordon Food Service", invoiceNumber: "9036225940" },
];

function getDriveFileId(url) {
  if (!url) return null;
  const m = url.match(/\/file\/d\/([^/]+)/) || url.match(/[?&]id=([^&]+)/);
  return m ? m[1] : null;
}

async function downloadPdf(drive, fileId) {
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data);
}

async function extractWithClaude(pdfBuffer) {
  const base64 = pdfBuffer.toString("base64");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8192,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
          { type: "text", text: EXTRACTION_PROMPT },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const result = await res.json();
  const text = result.content?.[0]?.text || "";
  return JSON.parse(text.replace(/```json\s*|```/g, "").trim());
}

function mathOK(qty, up, am) {
  const calc = (Number(qty) || 0) * (Number(up) || 0);
  const amount = Number(am) || 0;
  return amount > 0 && Math.abs(calc - amount) <= 0.02 * Math.abs(amount) + 0.01;
}

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const drive = getServiceAccountDriveClient();

for (const target of TARGETS) {
  console.log("\n" + "=".repeat(78));
  console.log("VENDOR: " + target.vendor + "   INVOICE: " + target.invoiceNumber);
  console.log("=".repeat(78));

  const { data: sub } = await supa.from("invoice_submissions")
    .select("id, raw_drive_url, invoice_number, account_key, submitted_at")
    .eq("invoice_number", target.invoiceNumber)
    .single();
  if (!sub) { console.log("(invoice not in PG)"); continue; }
  console.log("Drive: " + (sub.raw_drive_url || "(none)"));
  console.log("Account: " + sub.account_key + "   Submitted: " + (sub.submitted_at || "").slice(0, 10));

  // Image-mode (production) lines
  const { data: prodLines } = await supa.from("ai_line_items")
    .select("description, quantity, unit, unit_price, extended_price, raw_json")
    .eq("invoice_uuid", sub.id);
  const prodByDesc = new Map();
  for (const r of prodLines || []) {
    prodByDesc.set((r.description || "").trim().toUpperCase(), r);
  }
  console.log("\nProduction (image mode) lines: " + (prodLines?.length || 0));
  const prodMathOK = (prodLines || []).filter((r) => mathOK(r.quantity, r.unit_price, r.extended_price)).length;
  console.log("  math reconciles: " + prodMathOK + "/" + (prodLines?.length || 0));

  // PDF-mode (test rig) extract
  process.stdout.write("\nRe-extracting PDF mode... ");
  const fileId = getDriveFileId(sub.raw_drive_url);
  if (!fileId) { console.log("no Drive ID"); continue; }
  let pdfBuf;
  try { pdfBuf = await downloadPdf(drive, fileId); }
  catch (e) { console.log("DRIVE ERROR: " + e.message); continue; }
  let parsed;
  try { parsed = await extractWithClaude(pdfBuf); }
  catch (e) { console.log("CLAUDE ERROR: " + e.message); continue; }
  const pdfLines = parsed.lineItems || [];
  const pdfMathOK = pdfLines.filter((it) => mathOK(it.quantity, it.unitPrice, it.extendedPrice)).length;
  console.log("got " + pdfLines.length + " line items, math reconciles: " + pdfMathOK + "/" + pdfLines.length);

  // Math-fail lines in PDF mode - print side-by-side vs production
  const pdfFails = pdfLines.filter((it) => !mathOK(it.quantity, it.unitPrice, it.extendedPrice));
  console.log("\nMath-fail lines (PDF mode):");
  console.log("Showing up to 8 per vendor.");
  let shown = 0;
  for (const it of pdfFails) {
    if (shown++ >= 8) break;
    const desc = (it.description || "").trim();
    const prod = prodByDesc.get(desc.toUpperCase());
    console.log("\n  Line: \"" + desc.slice(0, 70) + "\"");
    console.log("  PDF mode:   qty=" + it.quantity + " unit=\"" + it.unit + "\"  up=$" + it.unitPrice + "  amt=$" + it.extendedPrice);
    console.log("              shippedCount=" + it.shippedCount + "  packSize=\"" + (it.packSize || "") + "\"  uomRaw=\"" + (it.uomRaw || "") + "\"  weightLineValue=" + it.weightLineValue + "  catchMarker=\"" + (it.catchWeightMarker || "") + "\"");
    const am = Number(it.extendedPrice) || 0;
    const up = Number(it.unitPrice) || 0;
    if (up > 0) console.log("              implied if per-LB: weight " + (am / up).toFixed(2) + " lb");
    if (prod) {
      const prodOK = mathOK(prod.quantity, prod.unit_price, prod.extended_price);
      console.log("  Image mode: qty=" + prod.quantity + " unit=\"" + prod.unit + "\"  up=$" + prod.unit_price + "  amt=$" + prod.extended_price + "  math " + (prodOK ? "OK" : "FAILS"));
    } else {
      console.log("  Image mode: (no matching line by description - extraction differs)");
    }
  }
  console.log("\n  Total PDF-mode math-fail: " + pdfFails.length + "/" + pdfLines.length);
}

console.log("\n" + "=".repeat(78));
console.log("DONE");
process.exit(0);
