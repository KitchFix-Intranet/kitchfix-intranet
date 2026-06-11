// extraction-test-rig.mjs - held-out test for the extraction prompt.
//
// Pulls 10 invoices (2 per vendor across 5 vendors), downloads each PDF
// from Drive via the existing service-account client, sends each to Claude
// with a prompt-under-test (current EXTRACTION_PROMPT by default; can swap
// to a proposed prompt via --prompt-file), and reports per-vendor metrics:
//
//   - raw_json key count (presence of all 15 mandated fields)
//   - Stage A populated counts: weightLineValue, packSize, uomRaw, shippedCount
//   - math reconcile rate (qty*up == amount within B-1 tolerance)
//   - WCW no-regression: per-line (quantity, unit) recorded for comparison
//
// NO writes to PG, Sheets, or anywhere else. Read-only Drive, read-only PG
// (just the raw_drive_url lookup), Anthropic API for extraction.
//
// Usage:
//   node --import ./scripts/_setup/register-aliases.mjs \
//        --env-file=.env.local \
//        scripts/extraction-test-rig.mjs [--prompt-file <path>]
//
// Two-baseline calibration:
//   - "production baseline": what's actually in PG today (from
//     _probe_extraction_baseline.mjs). 0 Stage A keys across all vendors.
//   - "test rig baseline": this script's run against current EXTRACTION_PROMPT
//     using PDF document input. If they agree (both 0 Stage A), the rig is
//     well-calibrated and any improvement under the proposed prompt is the
//     actual gain. If they diverge, calibration issue to investigate before
//     trusting the proposed-prompt numbers.

import { createClient } from "@supabase/supabase-js";
import { getServiceAccountDriveClient } from "@/lib/sheets";
import { EXTRACTION_PROMPT } from "@/lib/invoiceActions";
import { readFile } from "node:fs/promises";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-4-20250514";

const HELDOUT = [
  { vendor: "Sysco",               invoiceNumber: "103353513" },
  { vendor: "Sysco",               invoiceNumber: "532396224" },
  { vendor: "Ben E Keith",         invoiceNumber: "57189446"  },
  { vendor: "Ben E Keith",         invoiceNumber: "57189438"  },
  { vendor: "Gordon Food Service", invoiceNumber: "9036225940"},
  { vendor: "Gordon Food Service", invoiceNumber: "9035380699"},
  { vendor: "Cheney Brothers",     invoiceNumber: "20-910735530" },
  { vendor: "Cheney Brothers",     invoiceNumber: "06910771693" },
  { vendor: "What Chefs Want",     invoiceNumber: "12728505"  },
  { vendor: "What Chefs Want",     invoiceNumber: "12713817"  },
];

const STAGE_A_KEYS = ["weightLineValue", "packSize", "uomRaw", "shippedCount", "itemNumber", "orderedCount", "amount", "catchWeightMarker"];
const FULL_SHAPE = ["lineNum","description","itemNumber","packSize","orderedCount","shippedCount","uomRaw","unitPrice","amount","weightLineValue","catchWeightMarker","quantity","unit","extendedPrice","category"];

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

async function extractWithClaude(prompt, pdfBuffer) {
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
          { type: "text", text: prompt },
        ],
      }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic ${res.status}: ${errText}`);
  }
  const result = await res.json();
  const text = result.content?.[0]?.text || "";
  const cleanJson = text.replace(/```json\s*|```/g, "").trim();
  return JSON.parse(cleanJson);
}

function classifyLine(item, vendor) {
  const keys = Object.keys(item);
  const presentStageA = STAGE_A_KEYS.filter((k) => k in item).length;
  const populatedStageA = STAGE_A_KEYS.filter((k) => {
    const v = item[k];
    return v !== null && v !== undefined && v !== "";
  }).length;
  const hasWeight       = Number(item.weightLineValue) > 0;
  const hasPackSize     = item.packSize && String(item.packSize).trim() !== "";
  const hasUomRaw       = item.uomRaw && String(item.uomRaw).trim() !== "";
  const hasShippedCount = Number(item.shippedCount) > 0;
  const fullShape       = FULL_SHAPE.every((k) => k in item);

  // Math reconcile: legacy qty * up vs amount/extendedPrice
  const am = Number(item.extendedPrice) || Number(item.amount) || 0;
  const calc = (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
  const mathOK = am > 0 && Math.abs(calc - am) <= 0.02 * Math.abs(am) + 0.01;

  // Catch-weight candidate: math fails AND implied weight is plausible
  const impliedWeight = (Number(item.unitPrice) || 0) > 0 ? am / Number(item.unitPrice) : 0;
  const catchWeightCandidate = !mathOK && impliedWeight > 5 && impliedWeight < 500;

  return { keys: keys.length, presentStageA, populatedStageA, hasWeight, hasPackSize, hasUomRaw, hasShippedCount, fullShape, mathOK, catchWeightCandidate, impliedWeight };
}

async function main() {
  const argv = process.argv.slice(2);
  let prompt = EXTRACTION_PROMPT;
  let promptLabel = "CURRENT (EXTRACTION_PROMPT)";
  const pfi = argv.indexOf("--prompt-file");
  if (pfi >= 0 && argv[pfi + 1]) {
    const path = argv[pfi + 1];
    prompt = await readFile(path, "utf8");
    promptLabel = "PROPOSED (" + path + ")";
  }

  console.log("===== Extraction test rig =====");
  console.log("Prompt: " + promptLabel);
  console.log("Model:  " + MODEL);
  console.log("Held-out invoices: " + HELDOUT.length);
  console.log();

  const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const drive = getServiceAccountDriveClient();

  // Resolve invoice_number -> raw_drive_url for the held-out set
  const numbers = HELDOUT.map((h) => h.invoiceNumber);
  const { data: subs } = await supa.from("invoice_submissions")
    .select("id, invoice_number, raw_drive_url, vendor_id")
    .in("invoice_number", numbers);
  const urlByNumber = new Map();
  for (const s of subs || []) urlByNumber.set(s.invoice_number, s.raw_drive_url);

  const allResults = [];
  const byVendor = new Map();

  for (const inv of HELDOUT) {
    const url = urlByNumber.get(inv.invoiceNumber);
    if (!url) {
      console.log("[SKIP] " + inv.vendor + " #" + inv.invoiceNumber + " - no Drive URL");
      continue;
    }
    const fileId = getDriveFileId(url);
    if (!fileId) {
      console.log("[SKIP] " + inv.vendor + " #" + inv.invoiceNumber + " - could not parse Drive ID");
      continue;
    }

    process.stdout.write("[" + inv.vendor + " #" + inv.invoiceNumber + "] downloading... ");
    let pdfBuf;
    try { pdfBuf = await downloadPdf(drive, fileId); }
    catch (e) { console.log("DRIVE ERROR: " + e.message); continue; }
    process.stdout.write("(" + (pdfBuf.length / 1024).toFixed(0) + " KB) extracting... ");
    let parsed;
    try { parsed = await extractWithClaude(prompt, pdfBuf); }
    catch (e) { console.log("CLAUDE ERROR: " + e.message); continue; }
    const items = parsed.lineItems || [];
    console.log("got " + items.length + " line items");

    const perLine = items.map((it) => classifyLine(it, inv.vendor));
    allResults.push({ vendor: inv.vendor, invoiceNumber: inv.invoiceNumber, items, perLine });
    if (!byVendor.has(inv.vendor)) byVendor.set(inv.vendor, []);
    byVendor.get(inv.vendor).push(...perLine);
  }

  // Per-vendor summary
  console.log();
  console.log("===== Per-vendor summary =====");
  console.log("vendor                 | lines | full-15 | weight | packSize | uomRaw | shippedCount | mathOK | catchWeightCand");
  for (const [vendor, lines] of byVendor) {
    const lc = lines.length;
    const sum = (key) => lines.filter((l) => l[key]).length;
    console.log("  " + vendor.padEnd(22) + "| " +
      String(lc).padStart(5) + " | " +
      String(sum("fullShape")).padStart(7) + " | " +
      String(sum("hasWeight")).padStart(6) + " | " +
      String(sum("hasPackSize")).padStart(8) + " | " +
      String(sum("hasUomRaw")).padStart(6) + " | " +
      String(sum("hasShippedCount")).padStart(12) + " | " +
      String(sum("mathOK")).padStart(6) + " | " +
      String(sum("catchWeightCandidate")).padStart(15));
  }

  // Aggregate
  const allLines = [...byVendor.values()].flat();
  if (allLines.length > 0) {
    console.log();
    console.log("===== Aggregate =====");
    console.log("Total lines: " + allLines.length);
    console.log("Full 15-key shape: " + allLines.filter((l) => l.fullShape).length + "  (" + ((allLines.filter(l => l.fullShape).length / allLines.length) * 100).toFixed(0) + "%)");
    console.log("Math reconciles:   " + allLines.filter((l) => l.mathOK).length + "  (" + ((allLines.filter(l => l.mathOK).length / allLines.length) * 100).toFixed(0) + "%)");
    console.log("Catch-weight candidates: " + allLines.filter((l) => l.catchWeightCandidate).length);
    console.log("Lines with weightLineValue populated: " + allLines.filter((l) => l.hasWeight).length);
    console.log("Lines with packSize:     " + allLines.filter((l) => l.hasPackSize).length);
    console.log("Lines with uomRaw:       " + allLines.filter((l) => l.hasUomRaw).length);
    console.log("Lines with shippedCount: " + allLines.filter((l) => l.hasShippedCount).length);
  }

  // WCW no-regression baseline (record qty/unit per line for diffing later)
  const wcw = allResults.filter((r) => r.vendor === "What Chefs Want");
  if (wcw.length > 0) {
    console.log();
    console.log("===== WCW no-regression baseline (qty, unit per line) =====");
    for (const inv of wcw) {
      console.log("Invoice #" + inv.invoiceNumber + " (" + inv.items.length + " lines):");
      for (const it of inv.items) {
        console.log("  qty=" + it.quantity + " unit=" + it.unit + "  desc=\"" + (it.description || "").slice(0, 60) + "\"");
      }
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
