/**
 * INVOICE STAMP RENDERER — stampInvoice.js
 * 
 * Combines raw invoice photos into a single PDF with a machine-readable
 * GL Coding Summary page appended. The summary page uses real PDF text
 * (not rasterized) so downstream AP systems (Bill.com, Rippling) can
 * parse account codes, amounts, and vendor data via text extraction.
 *
 * Also exports createRawInvoicePDF() which assembles pages into a clean
 * PDF with no stamp or GL summary — used as an archive copy so AP can
 * reprocess if the operator made an input error.
 *
 * Dependency: pdf-lib (pure JS, no native deps — Vercel-safe)
 *   npm install pdf-lib
 *
 * Usage:
 *   import { createStampedInvoicePDF, createRawInvoicePDF } from "@/lib/stampInvoice";
 *   const { pdfBase64, pdfBuffer } = await createStampedInvoicePDF(pages, metadata);
 *   const { pdfBuffer: rawBuffer } = await createRawInvoicePDF(pages);
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// ── Color Palette ──
const NAVY = rgb(15 / 255, 48 / 255, 87 / 255);       // #0f3057
const MUSTARD = rgb(217 / 255, 119 / 255, 6 / 255);    // #d97706
const GREY = rgb(100 / 255, 116 / 255, 139 / 255);     // #64748b
const LIGHT_BG = rgb(248 / 255, 250 / 255, 252 / 255); // #f8fafc
const WHITE = rgb(1, 1, 1);
const DIVIDER = rgb(226 / 255, 232 / 255, 240 / 255);  // #e2e8f0

/**
 * Create a stamped invoice PDF
 *
 * @param {string[]} pages - Array of base64 image strings (with or without data URI prefix)
 * @param {Object} meta - Invoice metadata
 * @param {string} meta.account - Account label (e.g., "STL - FL")
 * @param {string} meta.vendor - Vendor name
 * @param {string} meta.vendorId - Vendor ID
 * @param {string} meta.invoiceNumber - Invoice # (may be empty for CC receipts)
 * @param {string} meta.invoiceDate - YYYY-MM-DD
 * @param {number} meta.totalAmount - Total dollar amount
 * @param {Array<{code:string, amount:string, name?:string}>} meta.glRows - GL breakdown
 * @param {string} meta.formType - "invoice" | "credit" | "cc_receipt"
 * @param {string} meta.submittedBy - User email
 * @returns {Promise<{ pdfBase64: string, pdfBuffer: Buffer }>}
 */
export async function createStampedInvoicePDF(pages, meta) {
  const pdfDoc = await PDFDocument.create();

  // Embed fonts
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

// ── 1. Add each invoice image as a page ──
  for (let i = 0; i < pages.length; i++) {
    // Support both string (legacy) and object (with rotation) page formats
    const pageData = typeof pages[i] === "string" ? pages[i] : pages[i].data;
    const rotation = typeof pages[i] === "object" ? (pages[i].rotation || 0) : 0;

    const raw = pageData.includes(",") ? pageData.split(",")[1] : pageData;
    const imgBytes = Uint8Array.from(Buffer.from(raw, "base64"));

    let image;
    try {
      image = await pdfDoc.embedJpg(imgBytes);
    } catch {
      try {
        image = await pdfDoc.embedPng(imgBytes);
      } catch (embedErr) {
        console.warn(`[Stamp] Failed to embed page ${i + 1}:`, embedErr.message);
        continue;
      }
    }

    const pageWidth = 612;
    const pageHeight = 792;
    const margin = 24;
    const maxW = pageWidth - margin * 2;
    const maxH = pageHeight - margin * 2;

    // For 90/270 rotation, swap effective image dimensions for scaling
    const isRotated = rotation === 90 || rotation === 270;
    const effectiveW = isRotated ? image.height : image.width;
    const effectiveH = isRotated ? image.width : image.height;
    const scale = Math.min(maxW / effectiveW, maxH / effectiveH, 1);
    const drawW = image.width * scale;
    const drawH = image.height * scale;

    const page = pdfDoc.addPage([pageWidth, pageHeight]);

    if (rotation === 0) {
      // No rotation — simple centered draw
      const x = (pageWidth - drawW) / 2;
      const y = (pageHeight - drawH) / 2;
      page.drawImage(image, { x, y, width: drawW, height: drawH });
    } else {
      // Apply rotation around center of page
      // pdf-lib rotation is counter-clockwise in radians
      const radians = (rotation * Math.PI) / 180;
      const cx = pageWidth / 2;
      const cy = pageHeight / 2;

      // Calculate the draw origin based on rotation
      // After rotation, we need to position so the image is centered
      let x, y;
      if (rotation === 90) {
        x = cx - drawH / 2;
        y = cy - drawW / 2;
      } else if (rotation === 180) {
        x = cx + drawW / 2;
        y = cy + drawH / 2;
      } else if (rotation === 270) {
        x = cx + drawH / 2;
        y = cy + drawW / 2;
      }

      page.drawImage(image, {
        x, y, width: drawW, height: drawH,
        rotate: { type: "degrees", angle: -rotation },
      });
    }
    
    // ── Thin reference strip at bottom of first page only ──
    if (i === 0) {
      const stripH = 22;
      const stripY = 6;

      // Semi-transparent background strip
      page.drawRectangle({
        x: 0, y: stripY, width: pageWidth, height: stripH,
        color: NAVY, opacity: 0.85,
      });

      const refParts = [meta.account, meta.vendor];
      if (meta.invoiceNumber) refParts.push(`#${meta.invoiceNumber}`);
      refParts.push(`$${Number(meta.totalAmount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
      refParts.push("GL coding on last page");
      const refText = refParts.join("  ·  ");

      page.drawText(refText, {
        x: 12,
        y: stripY + 7,
        size: 8,
        font: fontRegular,
        color: WHITE,
        opacity: 0.9,
      });
    }
  }

  // ── 2. Add GL Coding Summary page (real text — machine-readable) ──
  const summaryPage = pdfDoc.addPage([612, 792]);
  let cursor = 740; // Start near top

  // Helper: draw text and advance cursor
  function drawLine(text, opts = {}) {
    const size = opts.size || 10;
    const font = opts.bold ? fontBold : fontRegular;
    const color = opts.color || NAVY;
    const x = opts.x || 48;
    summaryPage.drawText(text, { x, y: cursor, size, font, color });
    cursor -= opts.lineHeight || size + 6;
  }

  function drawDivider() {
    summaryPage.drawRectangle({
      x: 48, y: cursor + 4, width: 516, height: 1, color: DIVIDER,
    });
    cursor -= 12;
  }

  // ── Header ──
  // Logo area / brand bar
  summaryPage.drawRectangle({
    x: 0, y: 756, width: 612, height: 36, color: NAVY,
  });
  summaryPage.drawText("KITCHFIX  ·  GL CODING SUMMARY", {
    x: 48, y: 768, size: 12, font: fontBold, color: WHITE,
  });

  // Type badge
  const typeLabel = meta.formType === "credit" ? "CREDIT / RETURN"
    : meta.formType === "cc_receipt" ? "CC RECEIPT"
    : "VENDOR INVOICE";
  const typeColor = meta.formType === "credit" ? rgb(99 / 255, 102 / 255, 241 / 255) // purple
    : meta.formType === "cc_receipt" ? rgb(14 / 255, 165 / 255, 233 / 255)           // blue
    : MUSTARD;

  summaryPage.drawText(typeLabel, {
    x: 440, y: 768, size: 10, font: fontBold, color: typeColor,
  });

  cursor = 730;

  // ── Invoice Details Block ──
  drawLine("INVOICE DETAILS", { size: 9, bold: true, color: GREY, lineHeight: 18 });

  const details = [
    ["Account", meta.account],
    ["Vendor", meta.vendor],
    ["Vendor ID", meta.vendorId || "—"],
  ];
  if (meta.invoiceNumber) {
    details.push(["Invoice #", meta.invoiceNumber]);
  }
  details.push(["Date", formatDate(meta.invoiceDate)]);
  details.push(["Total", `$${Number(meta.totalAmount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`]);
  details.push(["Pages", `${pages.length}`]);
  details.push(["Type", typeLabel]);

  for (const [label, value] of details) {
    drawLine(`${label}:`, { size: 9, bold: true, color: GREY, x: 48, lineHeight: 4 });
    summaryPage.drawText(value, { x: 160, y: cursor + 4, size: 10, font: fontRegular, color: NAVY });
    cursor -= 14;
  }

  cursor -= 8;
  drawDivider();

  // ── GL Breakdown Table ──
  drawLine("GL CODE BREAKDOWN", { size: 9, bold: true, color: GREY, lineHeight: 18 });

  // Table header
  summaryPage.drawRectangle({
    x: 48, y: cursor - 2, width: 516, height: 18, color: LIGHT_BG,
  });
  summaryPage.drawText("GL Code", { x: 56, y: cursor + 2, size: 8, font: fontBold, color: GREY });
  summaryPage.drawText("Description", { x: 160, y: cursor + 2, size: 8, font: fontBold, color: GREY });
  summaryPage.drawText("Amount", { x: 480, y: cursor + 2, size: 8, font: fontBold, color: GREY });
  cursor -= 22;

  // GL rows
  const validGLRows = (meta.glRows || []).filter((r) => r.code && Number(r.amount) > 0);
  let glTotal = 0;

  for (const row of validGLRows) {
    const amount = Number(row.amount) || 0;
    glTotal += amount;
    const amountStr = `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    const codeName = row.name || row.code;

    summaryPage.drawText(String(row.code), {
      x: 56, y: cursor, size: 10, font: fontBold, color: NAVY,
    });
    summaryPage.drawText(truncate(codeName, 45), {
      x: 160, y: cursor, size: 9, font: fontRegular, color: NAVY,
    });
    // Right-align amount
    const amountWidth = fontRegular.widthOfTextAtSize(amountStr, 10);
    summaryPage.drawText(amountStr, {
      x: 564 - amountWidth, y: cursor, size: 10, font: fontBold, color: NAVY,
    });

    cursor -= 16;

    // Safety: don't overflow the page
    if (cursor < 100) {
      drawLine("... additional rows omitted", { size: 8, color: GREY });
      break;
    }
  }

  // Total line
  cursor -= 4;
  summaryPage.drawRectangle({
    x: 380, y: cursor - 2, width: 184, height: 1, color: NAVY,
  });
  cursor -= 14;
  const totalStr = `$${glTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  summaryPage.drawText("TOTAL", {
    x: 400, y: cursor, size: 9, font: fontBold, color: GREY,
  });
  const totalWidth = fontBold.widthOfTextAtSize(totalStr, 11);
  summaryPage.drawText(totalStr, {
    x: 564 - totalWidth, y: cursor, size: 11, font: fontBold, color: NAVY,
  });

  // Balance check
  const diff = Math.abs(Number(meta.totalAmount) - glTotal);
  if (diff > 0.01) {
    cursor -= 16;
    const diffStr = diff > 0 ? `Unallocated: $${diff.toFixed(2)}` : `Over-allocated: $${Math.abs(diff).toFixed(2)}`;
    summaryPage.drawText(diffStr, {
      x: 400, y: cursor, size: 8, font: fontRegular, color: rgb(239 / 255, 68 / 255, 68 / 255),
    });
  }

  // ── Footer ──
  const footerY = 48;
  summaryPage.drawRectangle({
    x: 0, y: 0, width: 612, height: footerY + 12, color: LIGHT_BG,
  });
  summaryPage.drawText(
    `Coded by ${meta.submittedBy || "KitchFix Ops Hub"}  ·  ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`,
    { x: 48, y: footerY - 4, size: 8, font: fontRegular, color: GREY }
  );
  summaryPage.drawText(
    "This document was generated by the KitchFix Ops Hub Invoice Capture system.",
    { x: 48, y: footerY - 16, size: 7, font: fontRegular, color: GREY }
  );

  // ── 3. Serialize ──
  const pdfBytes = await pdfDoc.save();
  const pdfBuffer = Buffer.from(pdfBytes);
  const pdfBase64 = pdfBuffer.toString("base64");

  return { pdfBase64, pdfBuffer };
}


/**
 * createRawInvoicePDF — assembles pages into a clean PDF with no stamp or GL summary.
 * Used as an archive copy so AP can reprocess if the operator made an input error.
 *
 * @param {Array<string|{data:string, rotation?:number}>} pages - Same format as createStampedInvoicePDF
 * @returns {Promise<{ pdfBase64: string, pdfBuffer: Buffer }>}
 */
export async function createRawInvoicePDF(pages) {
  const pdfDoc = await PDFDocument.create();

  for (let i = 0; i < pages.length; i++) {
    const pageData = typeof pages[i] === "string" ? pages[i] : pages[i].data;
    const rotation = typeof pages[i] === "object" ? (pages[i].rotation || 0) : 0;
    const raw = pageData.includes(",") ? pageData.split(",")[1] : pageData;
    const imgBytes = Uint8Array.from(Buffer.from(raw, "base64"));

    let image;
    try {
      image = await pdfDoc.embedJpg(imgBytes);
    } catch {
      try {
        image = await pdfDoc.embedPng(imgBytes);
      } catch {
        continue;
      }
    }

    const pageWidth = 612;
    const pageHeight = 792;
    const margin = 24;
    const maxW = pageWidth - margin * 2;
    const maxH = pageHeight - margin * 2;

    const isRotated = rotation === 90 || rotation === 270;
    const effectiveW = isRotated ? image.height : image.width;
    const effectiveH = isRotated ? image.width : image.height;
    const scale = Math.min(maxW / effectiveW, maxH / effectiveH, 1);
    const drawW = image.width * scale;
    const drawH = image.height * scale;

    const page = pdfDoc.addPage([pageWidth, pageHeight]);

    if (rotation === 0) {
      const x = (pageWidth - drawW) / 2;
      const y = (pageHeight - drawH) / 2;
      page.drawImage(image, { x, y, width: drawW, height: drawH });
    } else {
      const cx = pageWidth / 2;
      const cy = pageHeight / 2;

      let x, y;
      if (rotation === 90) {
        x = cx - drawH / 2;
        y = cy - drawW / 2;
      } else if (rotation === 180) {
        x = cx + drawW / 2;
        y = cy + drawH / 2;
      } else if (rotation === 270) {
        x = cx + drawH / 2;
        y = cy + drawW / 2;
      }

      page.drawImage(image, {
        x, y, width: drawW, height: drawH,
        rotate: { type: "degrees", angle: -rotation },
      });
    }
  }

  const pdfBytes = await pdfDoc.save();
  const pdfBuffer = Buffer.from(pdfBytes);
  const pdfBase64 = pdfBuffer.toString("base64");

  return { pdfBase64, pdfBuffer };
}


// ── Helpers ──
function truncate(str, max) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}