/**
 * INVOICE CAPTURE API — v2.1
 * Actions: invoice-bootstrap, invoice-submit, invoice-scan, vendor-add, vendor-search, invoice-history
 * NEW:     invoice-ocr (Feature #6 + #21 + #23)
 * NEW:     invoice-consistency-check (multi-page rogue detection)
 * UPDATED: invoice-photo-gate now returns pageNumber / totalPages / pageNumberConfidence
 */

import { uploadInvoicePages, uploadStampedPDF } from "@/lib/drive";
import { sendInvoiceEmail, sendRejectionEmail } from "@/lib/gmail";
import { createStampedInvoicePDF, createRawInvoicePDF } from "@/lib/stampInvoice";
import { OPS_LEADERSHIP_EMAILS } from "@/lib/admin";
import { fuzzyMatchVendor } from "@/lib/vendorMatching";
import {
  getVendorsForList,
  getVendorsForBootstrap,
  searchVendors,
  getVendor,
  getVendorsForMatching,
  upsertVendor,
  upsertVendorAccount,
  deactivateVendorAccount,
  learnVendorAlias,
  mergeVendors,
  getInvoiceSubmissions,
  getInvoiceSubmissionByUuid,
  findDuplicateSubmission,
  getGLCodes,
  upsertInvoiceSubmission,
  updateInvoiceFields,
  insertInvoiceRejection,
  unrejectInvoice,
  insertAILineItems,
} from "@/lib/dataStore";

// ─── Document Type Labels (Photo Gate) ───
const DOC_TYPE_LABELS = {
  vendor_invoice: "Vendor Invoice",
  cc_receipt: "Credit Card Receipt",
  credit_memo: "Credit / Return Memo",
  packing_slip: "Packing Slip",
  purchase_order: "Purchase Order",
  statement: "Account Statement",
  check: "Check",
  not_document: "Not a Document",
  unknown: "Unknown",
};

// PR 6.2 (S2): canonical invoice row -> legacy frontend shape. The
// orchestrators in src/lib/dataStore/invoice.js return camelCase records
// with array fields; the InvoiceTool / InvoiceAdmin frontends still
// consume the older parseSubmissionRow shape (string-encoded
// glBreakdown / driveUrls, "userEmail" instead of "submitterEmail",
// etc.). Translate at the handler boundary to keep response bytes
// identical pre/post PR 6.2.
function toLegacySubmission(c) {
  return {
    uuid:              c.uuid,
    timestamp:         c.submittedAt,
    userEmail:         c.submitterEmail,
    account:           c.accountKey,
    vendor:            c.vendorName,
    vendorId:          c.vendorId,
    invoiceNumber:     c.invoiceNumber,
    invoiceDate:       c.invoiceDate,
    totalAmount:       c.totalAmount,
    glBreakdown:       Array.isArray(c.glBreakdown) ? JSON.stringify(c.glBreakdown) : (c.glBreakdown || ""),
    driveUrls:         Array.isArray(c.driveUrls)   ? JSON.stringify(c.driveUrls)   : (c.driveUrls   || ""),
    pageCount:         c.pageCount,
    emailSent:         !!c.emailSent,
    status:            c.status,
    statusUpdatedAt:   c.statusUpdatedAt,
    type:              c.type,
    rawDriveUrl:       c.rawDriveUrl,
    rejectionReason:   c.rejectionReason,
    rejectionNote:     c.rejectionNote,
    rejectedBy:        c.rejectedBy,
    rejectedAt:        c.rejectedAt,
    correctedFromUuid: c.correctedFromUuid,
    dupeOverride:      c.dupeOverride,
  };
}

// PR 6.2 (C5 + S1): GL codes are stored flat in the dataStore. The
// invoice-bootstrap handler used to regroup by category as part of the
// Sheets parse; locked decision C5 keeps that regrouping client-visible
// but moves the categorization to the handler. The category map and
// flat-to-grouped reshape mirror the pre-PR-6.2 parseGLCodes output:
// [{ category, codes: [{ code, name }] }].
function regroupGLCodes(flatCodes) {
  const groups = [];
  const byCategory = new Map();
  for (const row of flatCodes) {
    const cat = String(row.category || "").trim() || "Other";
    if (!byCategory.has(cat)) {
      const g = { category: cat, codes: [] };
      byCategory.set(cat, g);
      groups.push(g);
    }
    byCategory.get(cat).codes.push({ code: row.code, name: row.name });
  }
  return groups;
}

function buildPdfFilename(vendor, invoiceDate, invoiceNumber) {
  const dateStr = (invoiceDate || "").replace(/-/g, "");
  const vendorClean = (vendor || "invoice").replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_");
  const invNum = invoiceNumber ? `_${invoiceNumber}` : "";
  return `${vendorClean}${invNum}_${dateStr}.pdf`;
}


// fuzzyMatchVendor moved to src/lib/vendorMatching.js (S1 consolidation, PR 5.2).
// Import is at the top of the file.


// ═══════════════════════════════════════
// GET HANDLERS
// ═══════════════════════════════════════

export async function handleInvoiceGet(action, searchParams, token, email) {

  // ── Invoice Bootstrap ──
  if (action === "invoice-bootstrap") {
    const accountParam = searchParams.get("account");

    // PR 5.2: routes through dataStore/vendor.js orchestrator. Flags off
    // by default = byte-identical to direct sheet read. The orchestrator
    // returns enriched accountVendors with the full account-link shape
    // the handler needs. accountVendors includes the `account` field
    // under its new canonical name `accountKey`; rename back to `account`
    // here for response shape parity.
    const { vendorMaster, accountVendors: accountVendorsRaw } =
      await getVendorsForBootstrap(accountParam || "", { module: "ops" });

    const accountVendors = accountVendorsRaw.map((av) => ({
      rowId:              av.rowId,
      vendorId:           av.vendorId,
      account:            av.accountKey,
      customerAccountNum: av.customerAccountNum,
      salesRepName:       av.salesRepName,
      salesRepPhone:      av.salesRepPhone,
      salesRepEmail:      av.salesRepEmail,
      deliveryDays:       av.deliveryDays,
      cutoffTime:         av.cutoffTime,
      deliveryMethod:     av.deliveryMethod,
      portalUrl:          av.portalUrl,
      portalUsername:     av.portalUsername,
      portalPassword:     av.portalPassword,
      // contactName/Email/Phone (vendor_accounts cols N/O/P) are
      // DEAD per the audit (0/54 fills); orchestrator drops them.
      // Emit as empty strings here to preserve byte-equal response
      // shape vs the pre-PR-5.2 handler (in case any frontend
      // consumer uses `'contactName' in bootstrap` checks).
      contactName:        "",
      contactEmail:       "",
      contactPhone:       "",
      paymentTerms:       av.paymentTerms,
      minOrder:           av.minOrder,
    }));

    const vendors = accountVendors.map((av) => {
      const master = vendorMaster.find((m) => m.vendorId === av.vendorId) || {};
      return { ...av, name: master.name || av.vendorId, category: master.category || "" };
    });

    let glCodes = [];
    if (accountParam) {
      try {
        const flat = await getGLCodes({ accountKey: accountParam, module: "ops" });
        glCodes = regroupGLCodes(flat);
      } catch (e) {
        console.warn(`[Invoice] GL codes for "${accountParam}" failed:`, e.message);
      }
    }

    let recentSubmissions = [];
    try {
      const { rows } = await getInvoiceSubmissions({
        accountKey: accountParam || undefined,
        page: 1,
        pageSize: 200,
        scope: "all",
        module: "ops",
      });
      // PR 6.2 C10: invoice-delete-dupe is now a soft delete (status='deleted').
      // Pre-PR-6.2 hard deletes were invisible to history; preserve that UX
      // by filtering soft-deleted rows at the handler boundary.
      recentSubmissions = rows.filter((r) => r.status !== "deleted").map(toLegacySubmission);
    } catch (e) {
      console.warn("[Invoice] History load failed:", e.message);
    }

    return { success: true, vendors, vendorMaster, glCodes, recentSubmissions };
  }

  // ── Vendor Search ──
  if (action === "vendor-search") {
    const query = searchParams.get("q") || "";
    const results = await searchVendors(query, { module: "ops" });
    return { success: true, vendors: results };
  }

  // ── Invoice History ──
  if (action === "invoice-history") {
    const accountParam = searchParams.get("account");
    const { rows } = await getInvoiceSubmissions({
      accountKey: accountParam || undefined,
      page: 1,
      pageSize: 200,
      scope: "all",
      module: "ops",
    });
    return { success: true, history: rows.filter((r) => r.status !== "deleted").map(toLegacySubmission) };
  }

  // ── Admin: All Submissions ──
  if (action === "invoice-admin-list") {
    const periodParam = searchParams.get("period") || "week";
    // PR 6.2: admin view historically read the full tab and filtered in
    // JS. Pass a large pageSize so the orchestrator yields the same
    // working set; period filter pushes down to the orchestrator.
    const { rows } = await getInvoiceSubmissions({
      period: periodParam === "all" ? undefined : periodParam,
      page: 1,
      pageSize: 5000,
      scope: "all",
      module: "ops",
    });
    return { success: true, submissions: rows.filter((r) => r.status !== "deleted").map(toLegacySubmission) };
  }

  return null;
}


// ═══════════════════════════════════════
// POST HANDLERS
// ═══════════════════════════════════════

export async function handleInvoicePost(action, body, token, email, userName) {

  // ═══════════════════════════════════════
  // PHOTO GATE — AI Quality & Classification Check
  // v3: now also returns pageNumber / totalPages / pageNumberConfidence
  // ═══════════════════════════════════════
  if (action === "invoice-photo-gate") {
    const { image, formType: expectedType } = body;

    if (!image) return { success: false, error: "No image provided" };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn("[Photo Gate] No API key — allowing passthrough");
      return { pass: true, quality: "pass", documentType: "unknown", issues: [], message: "Gate check unavailable", pageNumber: null, totalPages: null, pageNumberConfidence: "none" };
    }

    try {
      const base64 = image.includes(",") ? image.split(",")[1] : image;
      const mediaType = image.startsWith("data:image/png") ? "image/png" : "image/jpeg";

      const gatePrompt = `You are a document quality gate for KitchFix, a food service company. Operators upload digital invoices and receipts (PDF or scanned images) to submit to accounts payable.

Analyze this image and respond with ONLY a JSON object (no markdown, no backticks):

{
  "isDocument": true/false,
  "documentType": "vendor_invoice" | "cc_receipt" | "credit_memo" | "packing_slip" | "purchase_order" | "statement" | "check" | "not_document",
  "quality": "pass" | "fail",
  "issues": [],
  "message": "string",
  "pageNumber": null,
  "totalPages": null,
  "pageNumberConfidence": "none"
}

═══ STEP 1: IS THIS A FINANCIAL DOCUMENT? ═══
Set isDocument: false ONLY when the image contains ZERO financial content:
- Pure selfies with no document visible anywhere in frame
- Food/drink photos with no receipt or invoice present
- Random objects, scenery, memes with no document
- Completely blank or black images
- Screenshots of apps or websites (not of a financial document)

Set isDocument: TRUE in ALL of these cases — be very generous here:
✓ Any PDF page showing financial data (invoice, receipt, credit memo)
✓ Scanned documents, even at slight angles or with minor artifacts
✓ Any image where you can read a merchant name, dollar amounts, or transaction details
✓ Thermal paper receipts rendered as images
✓ Documents with handwriting, stamps, or annotations — operators routinely write GL codes with marker
✓ A partially visible document that is still clearly identifiable as a financial record

The ONLY question for isDocument is: "Is there a financial document somewhere in this image?"
If yes → true. Only return false for images that contain NO document whatsoever.

═══ STEP 2: DOCUMENT TYPE ═══
Classify what type of financial document this is:
- "vendor_invoice": Issued by a supplier/vendor. Has invoice number, vendor header, line items with prices, totals. Common vendors: Fresh Point, Sysco, US Foods, Fortune Fish, Samuels Seafood.
- "cc_receipt": Point-of-sale receipt from a store or restaurant (Publix, Walmart, Costco, Dunkin, HomeGoods, etc.). Usually printed on thermal paper, has transaction #, itemized purchases, payment method (Visa/credit).
- "credit_memo": Says "credit" or "return" prominently. Negative amounts.
- "packing_slip": Lists items shipped but no pricing.
- "purchase_order": Internal ordering document.
- "statement": Monthly account summary.

═══ STEP 3: DOCUMENT QUALITY ═══
Quality should ONLY fail if the document genuinely cannot be processed by AP. Most digital uploads will pass. Be very practical, not perfectionist.

QUALITY PASS — all of these are explicitly fine:
✓ Handwriting on the document — operators routinely write GL codes with marker. NORMAL and EXPECTED.
✓ Document at a slight angle (from scanning)
✓ Minor shadows or scan artifacts that don't obscure text
✓ Slightly wrinkled, folded, or creased paper that was scanned
✓ Stamps, stickers, staple marks, or tape
✓ PDF pages rendered as images (always pass — already digital)
✓ Thermal receipt paper, even slightly faded, as long as key text is readable
✓ Low-resolution scans where text is still readable

QUALITY FAIL — only these specific problems:
✗ "too_blurry": Text is genuinely illegible — you cannot make out the totals or vendor name at all
✗ "too_dark": So underexposed that key financial data is completely unreadable
✗ "partial_capture": Critical data cut off — cannot see the total amount or vendor name
✗ "corrupted": File appears corrupted or renders as garbled content

CRITICAL: Err very strongly toward passing quality. Only fail when a human accountant literally could not read the document to process it.

If quality fails, "message" should be a specific, helpful 1-sentence instruction (e.g. "Document is unreadable - please re-export the PDF or try a different file").
If quality passes, "message" should be empty string "".

═══ STEP 4: PAGE NUMBER DETECTION ═══
Look for page number indicators in headers or footers such as:
"Page 1 of 3", "Page 2", "1/3", "2 of 4", "pg. 1", or similar.

pageNumber: the current page number as an integer, or null if not found
totalPages: the total page count as an integer, or null if not found
pageNumberConfidence:
  "high"  = clearly printed "Page X of Y" or "X/Y" in a header or footer — you are certain
  "low"   = you found a number that might be a page number but you are not fully certain
  "none"  = no page number indicator detected anywhere on the document

BLANK TRAILING PAGES:
A mostly-blank page with only a URL, page number, or footer text at the bottom is a NORMAL artifact from browser PDF printing. This is NOT a quality failure and NOT a non-document. Set isDocument: true, quality: "pass", documentType to match the rest of the invoice (usually "vendor_invoice"), and message: "". These pages are harmless overflow — do not flag them.`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 300,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: gatePrompt },
            ],
          }],
        }),
      });

      if (!res.ok) {
        console.error("[Photo Gate] API error:", res.status);
        return { pass: true, quality: "pass", documentType: "unknown", issues: [], message: "Gate check unavailable", pageNumber: null, totalPages: null, pageNumberConfidence: "none" };
      }

      const result = await res.json();
      const text = result.content?.[0]?.text || "";

      let parsed;
      try {
        const clean = text.replace(/```json\s*|```/g, "").trim();
        parsed = JSON.parse(clean);
      } catch {
        console.error("[Photo Gate] JSON parse failed:", text.slice(0, 200));
        return { pass: true, quality: "pass", documentType: "unknown", issues: [], message: "Gate check inconclusive", pageNumber: null, totalPages: null, pageNumberConfidence: "none" };
      }

      const isDoc = parsed.isDocument !== false;
      const qualityOk = parsed.quality === "pass";
      const docType = parsed.documentType || "unknown";
      const issues = parsed.issues || [];

      let typeMismatch = false;
      let suggestedType = null;
      if (isDoc && expectedType) {
        const typeMap = { invoice: "vendor_invoice", credit: "credit_memo", cc_receipt: "cc_receipt" };
        const expected = typeMap[expectedType] || expectedType;
        if (docType !== "unknown" && docType !== expected) {
          typeMismatch = true;
          const reverseMap = { vendor_invoice: "invoice", credit_memo: "credit", cc_receipt: "cc_receipt" };
          suggestedType = reverseMap[docType] || null;
        }
      }

      const hardBlock = !isDoc;
      const pass = !hardBlock;
      const isWarning = pass && !qualityOk;

      return {
        pass,
        isWarning,
        quality: !isDoc ? "fail" : parsed.quality,
        documentType: docType,
        issues,
        message: !isDoc
          ? "This doesn't appear to be a financial document. Please upload an invoice, receipt, or credit memo."
          : (parsed.message || ""),
        typeMismatch,
        suggestedType,
        detectedTypeLabel: DOC_TYPE_LABELS[docType] || docType,
        pageNumber: typeof parsed.pageNumber === "number" ? parsed.pageNumber : null,
        totalPages: typeof parsed.totalPages === "number" ? parsed.totalPages : null,
        pageNumberConfidence: parsed.pageNumberConfidence || "none",
      };

    } catch (error) {
      console.error("[Photo Gate] Error:", error.message);
      return { pass: true, quality: "pass", documentType: "unknown", issues: [], message: "Gate check unavailable", pageNumber: null, totalPages: null, pageNumberConfidence: "none" };
    }
  }


  // ═══════════════════════════════════════
  // INVOICE OCR (Feature #6 + #21 + #23)
  // ═══════════════════════════════════════
  if (action === "invoice-ocr") {
    const { image, account } = body;

    if (!image) return { success: false, error: "No image provided" };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn("[Invoice OCR] No API key configured");
      return { success: false, error: "OCR not configured" };
    }

    try {
      const base64 = image.includes(",") ? image.split(",")[1] : image;
      const mediaType = image.startsWith("data:image/png") ? "image/png" : "image/jpeg";

const prompt = `You are an invoice data extraction engine for KitchFix, a food service company. Analyze this invoice image.

STEP 1 - IMAGE QUALITY CHECK:
If the image is too blurry, too dark, severely cropped, upside down, not an invoice, or otherwise unreadable, respond ONLY with:
{
  "readable": false,
  "reason": "brief specific reason",
  "suggestion": "specific advice for fixing the upload"
}

IMPORTANT: A mostly-blank page with only a URL or footer text is a normal trailing page from a browser PDF print. It is NOT an error. Treat it as readable and extract what you can (likely null for all fields). Do NOT reject it.

Reason examples: "Document is too blurry to read", "Document is too dark to read", "Invoice is cut off - key details are missing", "This doesn't appear to be an invoice"
Suggestion examples: "Please re-export the PDF or try a different file", "Try downloading the invoice again from the vendor portal", "Upload the full invoice including all pages", "Please upload an invoice document"

STEP 2 - If readable, extract fields and respond with:
{
  "readable": true,
  "confidence": "high" | "medium" | "low",
  "invoiceNumber": "string or null",
  "invoiceDate": "YYYY-MM-DD or null",
  "totalAmount": number or null,
  "vendorName": "string or null"
}

Rules:
- Return ONLY valid JSON. No markdown, no explanation, no backticks.
- For dates, always convert to YYYY-MM-DD.
- For amounts, return a plain number (no $, no commas). Use the INVOICE TOTAL / grand total from the summary section - this is the final amount due, usually at the bottom of the last page. NEVER use subtotals, group totals, or per-category totals.
- The grand total is typically the LARGEST dollar amount on the invoice and is usually labeled "Invoice Total", "Grand Total", "Total Due", "Amount Due", "Balance Due", or "TOTAL". If multiple total-like amounts are visible, choose the largest one. Do not use subtotals, group totals, or per-category totals when a grand total is also visible.

VENDOR NAME RULES:
- vendorName = the company that ISSUED the invoice, NOT the ordering platform.
- Always extract the COMPLETE vendor/company name exactly as it appears on the invoice header, logo, or letterhead. Never abbreviate or use only part of the name. Examples: "Ben E. Keith" not "Keith", "What Chefs Want" not "Chefs Want", "Fortune Fish & Gourmet" not "Fortune Fish".
- IGNORE browser chrome, page headers/footers, and platform names like "Cut+Dry", "cutanddry.com", "BlueCart", "Orderve", "ChefSheet". These are ordering platforms, not vendors.
- Look for a "Vendor:" label, company logo, or letterhead INSIDE the document body.
- Common KitchFix vendors: Ben E. Keith, What Chefs Want, Fresh Point, Sysco, US Foods, Fortune Fish & Gourmet, Samuels Seafood, Performance Foodservice, Kuna Foodservice, Rolling Lawn Farms, City Seafood, Lohr Distribution, Truly Good Foods.
- Fresh Point (a Sysco subsidiary) invoices may be printed on Ben E. Keith distribution letterhead. If the document shows BOTH "Fresh Point" and "Ben E. Keith" anywhere on the page (including small print or footers), return "Fresh Point" as the vendor.
- "Fresh Point" and "FreshPoint" are the same vendor. Always return "Fresh Point" (with the space).

INVOICE NUMBER RULES:
- Look first for a field explicitly labeled "Invoice #" or "Invoice Number".
- If no "Invoice #" field exists, use "Order #" as the invoice number.
- If neither exists, use "Reference #".
- EXCEPTION: For "What Chefs Want" invoices (from Cut+Dry / cutanddry.com), ALWAYS use the "Reference #" as the invoice number, NOT the "Order #". The Reference # is typically a shorter number (e.g. 12524109) compared to the longer Order # (e.g. 928127343).
- NEVER use "Customer ID" as the invoice number.
- Return only the number value, not the label (e.g. "906637520" not "Order #: 906637520").
- NEVER use these as invoice number, even if no "Invoice #" field exists: Customer ID, Customer #, Account #, Account Number, Bill of Lading (BOL) #, Delivery Ticket #, Document #, Manifest #, Route #, Stop #, Truck #, Driver #, PO # (the customer's purchase order is theirs, not the vendor's invoice ID).
- For Cheney Brothers invoices: use the number labeled "Invoice #" in the header (typically format like "06-910xxxxxx" or "20-910xxxxxx"). Do NOT use the "Order #" or "Account #" fields.
- For Sysco invoices: use the number labeled "Invoice Number" in the header box (e.g. "532093915", "103349834"). Do NOT use "Order #", "Customer #", or any "Item Number" from the line item table.
- For Fresh Point invoices: use the number labeled "Invoice #" or "Invoice Number". Do NOT use "Order #" or "PO #".
- Preserve the full invoice number EXACTLY as printed, including any leading zeros (e.g. "00243986" not "243986"), prefixes (e.g. "INV25729"), and embedded dashes/hyphens.
- If the number wraps to a second line on the document, concatenate both parts in printed order.
- If you must choose between two candidate numbers, prefer the one closest to a label containing the word "Invoice" or "INV".

INVOICE DATE RULES:
- invoiceDate = the date the INVOICE was issued by the vendor, not the delivery date, due date, order date, posting date, or service date.
- Look first for a field labeled "Invoice Date", "Inv. Date", "Date Issued", or just "Date" adjacent to the invoice number.
- IGNORE "Due Date", "Delivery Date", "Service Date", "Ship Date", "Order Date", "PO Date", "Posting Date". These are NOT the invoice date.
- If two dates are visible and one is labeled "Invoice Date" and the other "Due Date", use the Invoice Date. They are different dates.
- Read the year EXACTLY as printed adjacent to the invoice date label. Do NOT infer or assume the current year. Some invoices are from prior years (e.g. 2020) and were submitted late - the year must be preserved as printed.
- For Kuna Foodservice invoices: the date is in the top-right header labeled "INVOICE DATE" in format MM/DD/YY (e.g. "06/05/26" = June 5, 2026). The page is often rotated landscape - read the date in its printed orientation. Interpret a 2-digit year of "26" as 2026, "25" as 2025, "24" as 2024 (NOT 1926 or 2125). Do NOT confuse with the "TERMS" line (e.g. "14 DAYS") which describes payment terms, not a date.
- For Cintas and Alsco Uniforms invoices: invoices may legitimately be from prior years (e.g. 2020). Read the year exactly as printed; do not default to the current year.

- confidence: "high" = all 4 fields clearly extracted, "medium" = 2-3 fields extracted, "low" = only 1 field or uncertain.
- If a field cannot be determined, use null - never guess.`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 500,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: prompt },
            ],
          }],
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error("[Invoice OCR] API error:", res.status, errText);
        return { success: false, error: "OCR service unavailable" };
      }

      const result = await res.json();
      const text = result.content?.[0]?.text || "";

      let parsed;
      try {
        const clean = text.replace(/```json\s*|```/g, "").trim();
        parsed = JSON.parse(clean);
      } catch (parseErr) {
        console.error("[Invoice OCR] JSON parse failed:", text.slice(0, 200));
        return { success: false, error: "Failed to parse OCR result" };
      }

      // Feature #23: Unreadable image rejection
      if (!parsed.readable) {
        return {
          success: false,
          rejected: true,
          reason: parsed.reason || "Image could not be read",
          suggestion: parsed.suggestion || "Please try a different file or re-export the PDF from the vendor portal",
        };
      }

      // Feature #21: Vendor auto-detect via fuzzy matching (PR 5.2:
      // routes through dataStore orchestrator + shared matcher lib)
      let vendorMatch = null;
      if (parsed.vendorName) {
        try {
          const vendors = await getVendorsForMatching({ module: "ops" });
          vendorMatch = fuzzyMatchVendor(parsed.vendorName, vendors);
        } catch (e) {
          console.warn("[Invoice OCR] Vendor matching failed:", e.message);
        }
      }

      return {
        success: true,
        confidence: parsed.confidence || "medium",
        invoiceNumber: parsed.invoiceNumber || null,
        invoiceDate: parsed.invoiceDate || null,
        totalAmount: parsed.totalAmount || null,
        vendorName: parsed.vendorName || null,
        vendorMatch,
      };

    } catch (error) {
      console.error("[Invoice OCR] Error:", error.message);
      return { success: false, error: "OCR processing failed" };
    }
  }


  // ═══════════════════════════════════════
  // INVOICE CONSISTENCY CHECK
  // Checks whether all uploaded pages belong to the same invoice.
  // Called client-side after all pages finish scanning.
  // Returns rogue page PIDs with reasons.
  // ═══════════════════════════════════════
  if (action === "invoice-consistency-check") {
    const { pages: pageList, vendor: expectedVendor, invoiceNumber: expectedInvNum, invoiceDate: expectedDate } = body;

    if (!pageList || pageList.length < 2) {
      return { success: true, consistent: true, roguePages: [] };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { success: true, consistent: true, roguePages: [] };
    }

    try {
      const imageBlocks = pageList.slice(0, 6).map((p) => {
        const base64 = p.data.includes(",") ? p.data.split(",")[1] : p.data;
        const mediaType = p.data.startsWith("data:image/png") ? "image/png" : "image/jpeg";
        return { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };
      });

      const contextParts = [];
      if (expectedVendor) contextParts.push(`Vendor: ${expectedVendor}`);
      if (expectedInvNum) contextParts.push(`Invoice #: ${expectedInvNum}`);
      if (expectedDate) contextParts.push(`Date: ${expectedDate}`);
      const contextStr = contextParts.length > 0 ? `Known invoice details: ${contextParts.join(", ")}.` : "";

      const prompt = `You are checking whether all pages belong to the same invoice for KitchFix, a food service company. ${contextStr}

${pageList.length} page images are attached in order (page 1 first).

For each page, check whether it belongs to the same invoice as the majority of pages. Compare pages AGAINST EACH OTHER — look for mismatches in:
- Invoice number (most reliable signal)
- Vendor / company name
- Invoice date
- Document type (e.g. one page is clearly from a different vendor or a completely different document)

CRITICAL DATE RULE: The "Date" in the known invoice details above may be today's default and has NOT been verified from the document. Do NOT flag pages because their date differs from the known date. ONLY flag a page if its date differs from the OTHER PAGES in the set. If all pages show the same date, they are consistent — regardless of what the known date says.

IMPORTANT: Be conservative. Only flag a page if you are reasonably confident it does not belong. "Page 2 of 3" text on continuation pages does NOT indicate a different invoice — those are the same invoice. Continuation pages, blank trailing pages, and summary pages from the same vendor are all normal. Only flag genuine mismatches where one page is clearly from a different invoice or vendor than the others.

Respond ONLY with valid JSON, no markdown:
{
  "consistent": true,
  "roguePages": []
}

OR if you find rogue pages:
{
  "consistent": false,
  "roguePages": [
    { "pageIndex": 1, "reason": "Different vendor (Sysco vs US Foods)" }
  ]
}

pageIndex is 0-based. If all pages belong together, return consistent: true and empty array.`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 300,
          messages: [{
            role: "user",
            content: [...imageBlocks, { type: "text", text: prompt }],
          }],
        }),
      });

      if (!res.ok) {
        console.warn("[Consistency Check] API error:", res.status);
        return { success: true, consistent: true, roguePages: [] };
      }

      const result = await res.json();
      const text = result.content?.[0]?.text || "";

      let parsed;
      try {
        const clean = text.replace(/```json\s*|```/g, "").trim();
        parsed = JSON.parse(clean);
      } catch {
        console.warn("[Consistency Check] JSON parse failed:", text.slice(0, 100));
        return { success: true, consistent: true, roguePages: [] };
      }

      // Map pageIndex → pid
      const roguePages = (parsed.roguePages || [])
        .filter((r) => typeof r.pageIndex === "number" && pageList[r.pageIndex])
        .map((r) => ({
          pid: pageList[r.pageIndex].pid,
          reason: r.reason || "May not belong to this invoice",
        }));

      return {
        success: true,
        consistent: parsed.consistent !== false && roguePages.length === 0,
        roguePages,
      };

    } catch (error) {
      console.error("[Consistency Check] Error:", error.message);
      return { success: true, consistent: true, roguePages: [] };
    }
  }


  // ── Vendor Add ──
  if (action === "vendor-add") {
    const {
      vendorName, category, website, notes, account,
      customerAccountNum, salesRepName, salesRepPhone, salesRepEmail,
      deliveryDays, cutoffTime, deliveryMethod,
      portalUrl, portalUsername, portalPassword,
      paymentTerms, minOrder, existingVendorId,
    } = body;

    // F19b (Audit #4): client-UUID idempotency. Frontend sends body.uuid;
    // same UUID = same submit-click. PR 5.2: idempotency now handled by
    // the dataStore orchestrators (clientUuid stored at vendor_master
    // col J / vendor_accounts col X on Sheets; client_uuid UNIQUE
    // constraint on PG).
    const clientUuid = body.uuid || crypto.randomUUID();

    if (!account?.trim()) return { success: false, error: "Account is required" };

    let vendorId = existingVendorId;
    let resolvedVendorName = vendorName;
    let deduplicated = false;

    if (!vendorId) {
      if (!vendorName?.trim()) return { success: false, error: "Vendor name is required" };
      try {
        // F19a vendor ID generation is lifted to the orchestrator level
        // for cross-store coordination (PR #78 pattern). F19b dedup is
        // checked inside the orchestrator: same clientUuid -> short-
        // circuit return.
        const result = await upsertVendor({
          name:        vendorName.trim(),
          category:    category || "",
          website:     website  || "",
          notes:       notes    || "",
          createdBy:   email,
          clientUuid,
        });
        vendorId = result.vendorId;
        resolvedVendorName = result.vendorName || vendorName;
        if (result.deduplicated) {
          return { success: true, vendorId, vendorName: resolvedVendorName, deduplicated: true };
        }
      } catch (e) {
        return { success: false, error: "Failed to create vendor: " + e.message };
      }
    }

    // F19b account-side check is handled inside upsertVendorAccount;
    // if a prior row matched the clientUuid, the orchestrator returns
    // deduplicated: true and the handler short-circuits.
    try {
      const acctResult = await upsertVendorAccount({
        vendorId,
        accountKey:         account,
        customerAccountNum: customerAccountNum || "",
        salesRepName:       salesRepName       || "",
        salesRepPhone:      salesRepPhone      || "",
        salesRepEmail:      salesRepEmail      || "",
        deliveryDays:       deliveryDays       || "",
        cutoffTime:         cutoffTime         || "",
        deliveryMethod:     deliveryMethod     || "",
        portalUrl:          portalUrl          || "",
        portalUsername:     portalUsername     || "",
        portalPassword:     portalPassword     || "",
        paymentTerms:       paymentTerms       || "",
        minOrder:           minOrder           || "",
        accountNotes:       body.accountNotes  || "",
        createdBy:          email,
        clientUuid,
      });
      deduplicated = !!acctResult.deduplicated;
    } catch (e) {
      return { success: false, vendorId, vendorName: resolvedVendorName || "", error: e.message };
    }

    if (!deduplicated && process.env.SLACK_VENDOR_WEBHOOK) {
      fetch(process.env.SLACK_VENDOR_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `New vendor added: ${vendorName || body.vendorName}`,
          blocks: [{
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Vendor Added*\n*Name:* ${vendorName || body.vendorName || "Unknown"}\n*ID:* ${vendorId}\n*Account:* ${account}\n*Category:* ${category || "N/A"}\n*Payment Terms:* ${paymentTerms || "N/A"}\n*Added by:* ${email}`,
            },
          }],
        }),
      }).catch(() => {});
    }

    return {
      success:      true,
      vendorId,
      vendorName:   body.vendorName || resolvedVendorName || "",
      ...(deduplicated ? { deduplicated: true } : {}),
    };
  }


  // ── Invoice Submit ──
  if (action === "invoice-submit") {
const { account, vendor, vendorId, invoiceNumber, invoiceDate, totalAmount, glRows, pages, formType, correctedFromUuid } = body;

    if (!account || !vendor || !invoiceDate || !totalAmount || !pages || pages.length === 0) {
      return { success: false, error: "Missing required fields" };
    }
    if (!glRows || glRows.length === 0) {
      return { success: false, error: "At least one GL code is required" };
    }

    // F25 (Audit #4): accept client-supplied UUID so retries of the same submit-click are idempotent.
    // Falls back to server-generated for legacy clients that don't send uuid.
    const uuid = body.uuid || crypto.randomUUID();
    const now = new Date();
    const type = formType || "invoice";

    try {
      // 0. Enrich GL rows with human-readable descriptions
      const enrichedGlRows = glRows.filter((r) => r.code && Number(r.amount) > 0);
      try {
        const flatGL = await getGLCodes({ accountKey: account, module: "ops" });
        const glLookup = {};
        for (const item of flatGL) { glLookup[item.code] = item.name; }
        for (const row of enrichedGlRows) {
          if (glLookup[row.code]) row.name = glLookup[row.code];
        }
      } catch (glErr) {
        console.warn("[Invoice] GL enrichment failed (non-blocking):", glErr.message);
      }

      // 1. Generate Stamped Invoice PDF
      let pdfBuffer = null;
      let pdfBase64 = null;
      try {
        const stampResult = await createStampedInvoicePDF(pages, {
          account, vendor, vendorId, invoiceNumber, invoiceDate, totalAmount,
          glRows: enrichedGlRows, formType: type, submittedBy: email,
        });
        pdfBuffer = stampResult.pdfBuffer;
        pdfBase64 = stampResult.pdfBase64;
      } catch (stampErr) {
        console.error("[Invoice] PDF stamp generation failed:", stampErr.message);
      }

// 1b. Generate Raw (unstamped) PDF archive
      let rawPdfBuffer = null;
      try {
        const rawResult = await createRawInvoicePDF(pages);
        rawPdfBuffer = rawResult.pdfBuffer;
      } catch (rawErr) {
        console.error("[Invoice] Raw PDF generation failed:", rawErr.message);
      }

      // 2. F24+F25 (Audit #4): combined dedup check BEFORE Drive uploads to prevent orphan PDFs.
      // F25 idempotency check (always): same clientUuid means same submit-click; return existing result.
      // Field-based duplicate guard (skipped for corrections): same vendor+invoice+date+amount = block.
      // PR 6.2: pre-checks go through the dataStore orchestrators. The
      // upsert at step 4 also returns a dedup signal as a belt-and-
      // suspenders guard against a race between two parallel submits.
      try {
        const existing = await getInvoiceSubmissionByUuid(uuid, { module: "ops" });
        if (existing) {
          console.log(`[Invoice] F25 idempotency: clientUuid ${uuid.slice(0, 8)} already processed, returning dedup`);
          return { success: true, uuid, deduplicated: true };
        }
        if (!correctedFromUuid) {
          const dupFound = await findDuplicateSubmission(
            { vendorId, invoiceNumber, invoiceDate, totalAmount, accountKey: account },
            { module: "ops" }
          );
          if (dupFound) {
            console.warn(`[Invoice] Server-side duplicate blocked: ${vendor} #${invoiceNumber} ${invoiceDate}`);
            return { success: false, error: "Duplicate invoice detected - this invoice was already submitted. Check History for the existing submission." };
          }
        }
      } catch (dupErr) {
        console.warn("[Invoice] Server-side dup check failed (non-blocking):", dupErr.message);
      }

      // 3. Upload to Drive (after dedup; orphan PDFs no longer possible on duplicate-blocked submissions)
      let driveUrls = [];
            try {
        if (pdfBuffer) {
          const pdfResult = await uploadStampedPDF(token, pdfBuffer, vendor, account, invoiceDate, invoiceNumber, correctedFromUuid ? `FIXED_RESUBMITTED_${new Date().toISOString().slice(0,10).replace(/-/g,"")}_` : "");
          if (pdfResult.fileUrl) driveUrls = [pdfResult.fileUrl];
        } else {
          const driveResults = await uploadInvoicePages(token, pages, vendor, account, invoiceDate);
          driveUrls = driveResults.filter((r) => r.fileUrl).map((r) => r.fileUrl);
        }
} catch (driveErr) {
        console.error("[Invoice] Drive upload failed:", driveErr.message);
      }

      // 3b. Upload raw PDF archive
      let rawDriveUrl = "";
      try {
        if (rawPdfBuffer) {
          const rawResult = await uploadStampedPDF(token, rawPdfBuffer, vendor, account, invoiceDate, invoiceNumber, correctedFromUuid ? `FIXED_RESUBMITTED_RAW_${new Date().toISOString().slice(0,10).replace(/-/g,"")}_` : "RAW_");
          if (rawResult.fileUrl) rawDriveUrl = rawResult.fileUrl;
        }
      } catch (rawUpErr) {
        console.error("[Invoice] Raw PDF upload failed (non-blocking):", rawUpErr.message);
      }

      // 4. Log via dataStore orchestrator (Sheets unconditional + PG
      // conditional on dual-write flag). Returns a dedup signal which
      // guards a race between two parallel submits with the same uuid.
      let writeResult;
      try {
        writeResult = await upsertInvoiceSubmission({
          uuid,
          submitterEmail: email,
          accountKey: account,
          vendorName: vendor,
          vendorId: vendorId || "",
          invoiceNumber: invoiceNumber || "",
          invoiceDate,
          totalAmount: Number(totalAmount) || 0,
          glBreakdown: glRows,
          driveUrls,
          pageCount: pages.length,
          type,
          rawDriveUrl,
          correctedFromUuid: correctedFromUuid || null,
        });
      } catch (writeErr) {
        return { success: false, error: "Failed to log submission: " + writeErr.message };
      }

      if (writeResult.deduplicated) {
        console.log(`[Invoice] F25 race-window dedup at upsert: ${uuid.slice(0, 8)}`);
        return { success: true, uuid, deduplicated: true };
      }

      // 4b. If this is a correction, mark the original as "corrected"
      if (correctedFromUuid) {
        try {
          await updateInvoiceFields(correctedFromUuid, {
            status: "corrected",
            statusUpdatedAt: now.toISOString(),
          }, { module: "ops" });
          console.log(`[Invoice] Marked original ${correctedFromUuid} as corrected`);
        } catch (corrErr) {
          console.warn("[Invoice] Failed to mark original as corrected (non-blocking):", corrErr.message);
        }
      }

      // 5. Send email to AP
      let emailSent = false;
      try {
        const emailResult = await sendInvoiceEmail(token, email, {
          account, vendor, vendorId, invoiceNumber, invoiceDate, totalAmount,
          glRows: enrichedGlRows, driveUrls, pageCount: pages.length, formType: type,
          pdfBase64: pdfBase64 || null,
          pdfFilename: pdfBuffer ? buildPdfFilename(vendor, invoiceDate, invoiceNumber) : null,
}, pdfBase64 ? null : (pages[0]?.data || null));

        emailSent = emailResult.success;
        if (emailSent) {
          try {
            await updateInvoiceFields(uuid, { emailSent: true }, { module: "ops" });
          } catch (markErr) {
            console.warn("[Invoice] Failed to mark email_sent (non-blocking):", markErr.message);
          }
        }
      } catch (emailErr) {
        console.error("[Invoice] Email failed:", emailErr.message);
      }

      // 6. Fire async AI scan (non-blocking)
      triggerAIScan(token, email, uuid, pages, { account, vendor, invoiceNumber, invoiceDate, formType: type }).catch((err) => {
        console.error("[Invoice] AI scan trigger failed:", err.message);
      });

      if (process.env.SLACK_INVOICE_WEBHOOK) {
        const totalFmt = `$${Number(totalAmount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
        const glSummary = (glRows || []).filter(r => r.code && Number(r.amount) > 0).map(r => `${r.code}: $${Number(r.amount).toFixed(2)}`).join(", ");
        const isCorrection = !!correctedFromUuid;
        const headerEmoji = isCorrection ? "🔄" : "📄";
        const headerText = isCorrection ? "Invoice Corrected & Resubmitted" : "Invoice Submitted";
        const correctionLine = isCorrection ? `\n*Correction of:* ${correctedFromUuid.slice(0, 8)}...` : "";
        fetch(process.env.SLACK_INVOICE_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `${headerEmoji} ${headerText}: ${vendor} ${totalFmt}`,
            blocks: [{
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*${headerEmoji} ${headerText}*\n*Vendor:* ${vendor}\n*Account:* ${account}\n*Invoice #:* ${invoiceNumber || "N/A"}\n*Date:* ${invoiceDate}\n*Total:* ${totalFmt}\n*Type:* ${type}\n*GL:* ${glSummary || "N/A"}\n*Pages:* ${pages.length}\n*Submitted by:* ${email}${correctionLine}`,
              },
            }],
          }),
        }).catch(() => {});
      }

// Auto-learn vendor alias from OCR detection (PR 5.2: orchestrator)
      if (body.ocrVendorName && vendorId) {
        learnVendorAlias({ vendorId, ocrName: body.ocrVendorName, learnedBy: email }).catch((err) => {
          console.warn("[Invoice] Alias learning failed (non-blocking):", err.message);
        });
      }

      return { success: true, uuid, driveUrls, emailSent, pageCount: pages.length, stampedPdf: !!pdfBuffer };

    } catch (error) {
      console.error("[Invoice] Submit error:", error.message);
      return { success: false, error: error.message };
    }
  }


  // ── Duplicate Check ──
  if (action === "invoice-duplicate-check") {
    const { vendor, vendorId, invoiceNumber, invoiceDate, totalAmount, account } = body;

    const match = await findDuplicateSubmission(
      { vendorId, vendorName: vendor, invoiceNumber, invoiceDate, totalAmount, accountKey: account },
      { module: "ops" }
    );

    return {
      success: true,
      isDuplicate: !!match,
      existingInvoice: match
        ? { uuid: match.uuid, timestamp: match.submittedAt, userEmail: match.submitterEmail }
        : null,
    };
  }

  // ── Reject / Return Invoice ──
  if (action === "invoice-reject") {
    const { uuid, reasons, note } = body;
    if (!uuid || !note) return { success: false, error: "Missing uuid or note" };

    const orig = await getInvoiceSubmissionByUuid(uuid, { module: "ops" });
    if (!orig) return { success: false, error: "Submission not found" };

    const origVendor = orig.vendorName || "Unknown";
    const origInvNum = orig.invoiceNumber || "";
    const origAccount = orig.accountKey || "";
    const origTotal = Number(orig.totalAmount) || 0;
    const origSubmitter = orig.submitterEmail || "";

    const rejection = await insertInvoiceRejection({
      submissionUuid: uuid,
      rejectedBy: email,
      reason: (reasons || []).join(", "),
      note,
    });
    const rejectedAt = rejection.rejectedAt;

    // Slack notification for rejection
    if (process.env.SLACK_INVOICE_WEBHOOK) {
      const totalFmt = `$${origTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
      fetch(process.env.SLACK_INVOICE_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `⚠️ Invoice returned: ${origVendor} ${totalFmt}`,
          blocks: [{
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*⚠️ Invoice Returned to Operator*\n*Vendor:* ${origVendor}\n*Account:* ${origAccount}\n*Invoice #:* ${origInvNum || "N/A"}\n*Total:* ${totalFmt}\n*Reason:* ${(reasons || []).join(", ") || "N/A"}\n*Note:* ${note}\n*Returned by:* ${email}\n*Original submitter:* ${origSubmitter}`,
            },
          }],
        }),
      }).catch(() => {});
    }

    // Email notification to original submitter
    if (origSubmitter) {
      try {
        await sendRejectionEmail(token, email, origSubmitter, {
          vendor: origVendor,
          invoiceNumber: origInvNum,
          account: origAccount,
          totalAmount: origTotal,
          reasons: reasons || [],
          note,
          rejectedBy: email,
        });
      } catch (emailErr) {
        console.warn("[Invoice Reject] Email notification failed (non-blocking):", emailErr.message);
      }
    }

    return { success: true, origSubmitter, origVendor, origInvNum, origAccount, origTotal };
  }

  // ── Unreject / Undo Return ──
  if (action === "invoice-unreject") {
    const { uuid } = body;
    if (!uuid) return { success: false, error: "Missing uuid" };

    const orig = await getInvoiceSubmissionByUuid(uuid, { module: "ops" });
    if (!orig) return { success: false, error: "Submission not found" };

    const origSubmitter = orig.submitterEmail || "";
    const origVendor = orig.vendorName || "Unknown";
    const origInvNum = orig.invoiceNumber || "";
    const origAccount = orig.accountKey || "";

    await unrejectInvoice(uuid, email, { module: "ops" });

    if (process.env.SLACK_INVOICE_WEBHOOK) {
      fetch(process.env.SLACK_INVOICE_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `↩️ Invoice return undone: ${origVendor}`,
          blocks: [{ type: "section", text: { type: "mrkdwn",
            text: `*↩️ Invoice Return Undone*\n*Vendor:* ${origVendor}\n*Invoice #:* ${origInvNum || "N/A"}\n*Account:* ${origAccount}\n*Undone by:* ${email}` } }],
        }),
      }).catch(() => {});
    }

    return { success: true, origSubmitter, origVendor, origInvNum, origAccount };
  }

  // ── Dismiss Duplicate Flag ──
  if (action === "invoice-dismiss-dupe") {
    const { uuid } = body;
    if (!uuid) return { success: false, error: "Missing uuid" };

    try {
      await updateInvoiceFields(uuid, { dupeOverride: "not_duplicate" }, { module: "ops" });
    } catch (e) {
      return { success: false, error: e.message };
    }
    console.log(`[Invoice] Dupe dismissed for ${uuid} by ${email}`);

    return { success: true };
  }

  // ── Delete Duplicate ──
  // PR 6.2 (BR1 admin gate + C10 soft-delete): restricted to ops
  // leadership emails. Switched from hard row-delete to status='deleted'
  // soft delete so audit/forensics + PG dual-write stay coherent.
  if (action === "invoice-delete-dupe") {
    const { uuid, vendor, invoiceNumber, totalAmount } = body;
    if (!uuid) return { success: false, error: "Missing uuid" };

    if (!OPS_LEADERSHIP_EMAILS.includes(email)) {
      console.warn(`[Invoice] delete-dupe denied: ${email} not in ops leadership`);
      return { success: false, error: "Forbidden" };
    }

    try {
      await updateInvoiceFields(uuid, {
        status: "deleted",
        statusUpdatedAt: new Date().toISOString(),
      }, { module: "ops" });
    } catch (e) {
      console.error(`[Invoice] Soft-delete failed for ${uuid}:`, e.message);
      return { success: false, error: "Failed to mark deleted" };
    }

    console.log(`[Invoice] Duplicate DELETED (soft): ${vendor} #${invoiceNumber} ($${totalAmount}) uuid=${uuid} by ${email}`);

    // Slack audit trail
    if (process.env.SLACK_INVOICE_WEBHOOK) {
      const totalFmt = `$${Number(totalAmount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
      fetch(process.env.SLACK_INVOICE_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `🗑️ Duplicate deleted: ${vendor || "?"} #${invoiceNumber || "N/A"} ${totalFmt}`,
          blocks: [{
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*🗑️ Duplicate Invoice Deleted*\n*Vendor:* ${vendor || "?"}\n*Invoice #:* ${invoiceNumber || "N/A"}\n*Total:* ${totalFmt}\n*Deleted by:* ${email}`,
            },
          }],
        }),
      }).catch(() => {});
    }

    return { success: true, deleted: true };
  }

  return null;
}


// ═══════════════════════════════════════
// AI INVOICE SCANNER (Async, Non-Blocking)
// ═══════════════════════════════════════

async function triggerAIScan(token, userEmail, invoiceUuid, pages, metadata) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.warn("[AI Scan] No API key configured, skipping"); return; }

  // Extract from every submission, regardless of page type. The earlier
  // hasDigitalPDF guard pre-skipped photo uploads to dodge unreliable
  // line-item math; that left STL-MO (and any other photo-upload
  // workflow) with zero line items for 133+ submissions. Bad reads are
  // now caught downstream at the cron's arithmetic gate (the price-write
  // chokepoint), which routes suspect lines to review_queue rather than
  // silently dropping them. The "photo-only" ai_scan_status value is
  // dead going forward; historical rows keep it for audit.

  return extractAndStoreLineItems(invoiceUuid, pages, metadata);
}

// Exported so scripts/_probe_stage_a_extraction.mjs (and any future
// validation harness) can test the EXACT live prompt without
// duplication drift. The string is module-level so the function body
// keeps a single reference to it.
export const EXTRACTION_PROMPT = `You are an invoice data extraction engine for KitchFix, a food service company. Extract ALL line items from this invoice into RAW LABELED columns. Downstream code derives the inventory/pricing values from the raw fields. Your job is fidelity to the invoice as printed, NOT derivation.

Return ONLY valid JSON:
{
  "vendor": "string",
  "invoiceNumber": "string",
  "invoiceDate": "YYYY-MM-DD",
  "subtotal": number,
  "tax": number,
  "total": number,
  "lineItems": [
    {
      "lineNum": 1,
      "description": "string",
      "itemNumber": "string|null",
      "packSize": "string|null",
      "orderedCount": number|null,
      "shippedCount": number|null,
      "uomRaw": "string|null",
      "unitPrice": number,
      "amount": number,
      "weightLineValue": number|null,
      "catchWeightMarker": "*CS|*EA|null",
      "quantity": number,
      "unit": "case|lb|ea|gal|oz|bag|box|each|pack|other",
      "extendedPrice": number,
      "category": "produce|protein|dairy|dry_goods|beverage|packaging|cleaning|supplies|smallwares|other"
    }
  ]
}

RAW LABELED FIELDS — the load-bearing part. Extract faithfully. NEVER infer, NEVER compute, NEVER substitute a default:
- itemNumber: ITEM #/SKU/PRODUCT CODE column value if present, else null.
- packSize: PACK/SIZE column or embedded pack notation as a STRING (e.g., "2/2 LB", "24/16OZ", "6-count"). NEVER a number. NEVER the quantity.
- orderedCount: ORDERED column raw value.
- shippedCount: SHIPPED/CASES column raw value — what was actually delivered. For distributor invoices (Ben E Keith, Cheney, Kuna) this is the Cases column, NOT pack count.
- uomRaw: UOM column raw text BEFORE normalization (e.g., "CS", "EA", "2/LB").
- unitPrice: PRICE column value (per-unit, or per-pound for catch-weight).
- amount: AMOUNT/EXTENDED column value (line total as printed).
- weightLineValue: TOTAL weight from any catch-weight sub-line beneath the item, expressed as a single number in pounds. Capture from ALL of these variants:
    • "Case weights: X.XX, X.XX, ..., TOTAL: Y.YY"   → use the TOTAL value (What Chefs Want)
    • "TOTAL WEIGHT: ##.###"                          → use that value (Gordon Food Service, Ben E Keith)
    • "CASE: <id> WEIGHT: ##.###" repeated per case   → SUM the WEIGHT values across cases (Gordon per-case)
    • "Total Weight ##.##" or "Weight: ##.##"        → use that value (Ben E Keith short form)
    • "T/WT= ##.###"                                  → use that value (Sysco)
    • "Weights: TOTAL= ##.##"                         → use that value (Kuna)
    • For invoices with a printed WEIGHT column (Cheney F4 catch-weight lines): the WEIGHT column value for that line, when weight × unitPrice ≈ amount makes structural sense.
  Else null. NEVER infer the weight from amount ÷ unitPrice.
- catchWeightMarker: "*CS" or "*EA" if the line is explicitly marked with that asterisk-prefixed text (Sysco-style inline marker), else null.

CRITICAL - DO NOT CONFLATE THESE:
- packSize is a DESCRIPTOR (e.g., "2/2 LB" means "2 inner units of 2 LB each"). It is NEVER the shipped quantity. NEVER the weight.
- shippedCount = the SHIPPED/CASES column value. NOT the PACK number. NOT the pack count. NOT the weight.
- For catch-weight items, populate BOTH shippedCount (case count) AND weightLineValue (total weight). Code decides which to use.
- If the SHIPPED/CASES column is unreadable (e.g., handwritten and illegible), return shippedCount: null. NEVER substitute a default. NEVER back-compute from amount ÷ unitPrice. A null is honest.

BACKWARDS-COMPAT FIELDS (downstream cron reads these - keep them populated as literal passthroughs, NOT derived values):
- quantity: SAME VALUE AS shippedCount (literal passthrough). If shippedCount is null, quantity is null. DO NOT derive, DO NOT substitute weightLineValue, DO NOT back-compute. Code does the catch-weight branching downstream.
- unit: normalized from uomRaw (cs→case, ea→each, gal→gallon, lb→pound, oz→ounce, pk→pack, bg→bag, ct→count, dz→dozen). Default "case" if unclear.
- extendedPrice: same numeric value as amount.
- category: your best guess from description.

Rules:
- Extract every line item visible on the invoice.
- For numeric fields, use numbers only (no $ signs).
- If a field is unclear, use null. Do not guess.
- Return ONLY the JSON object, no markdown or explanation.

CRITICAL — SKIP THESE ROWS (they are NOT line items):
- Summary rows: "GRAND TOTAL", "MAJOR CATEGORY SUMMARY", "CONTINUED", "SPLITS", any row that is a subtotal or category rollup.
- Boilerplate/disclaimer text about perishable commodities, restock fees, return policies, credit terms, collection fees.
- Weight notation lines like "Weight: 80.7" — these belong to the line item ABOVE them as weightLineValue; do NOT extract as separate items.
- Distribution/freight fee lines (e.g., "DISTRIBUTION FEE", "FREIGHT") — extract as a single line item with category "other", not as multiple items.
- Column headers (ITEM NO, ORDERED, SHIPPED, DESCRIPTION, CASE PACK, UNIT, PRICE, AMOUNT).

UNIT RULES — default "case" unless:
- Item is marked *EA → use "each"
- Item is marked *CS catch-weight → use "lb"
- Item is clearly sold per pound with no case pack.

Unit disambiguation — price reasonableness check:
- $15+ per "oz" is likely per "each" or per "jar" or per "bottle".
- $100+ per "lb" is likely per "case".
- $50+ per "gal" for a non-bulk item is likely per "case".
- Use context from other line items to calibrate. If most items are priced per case, a single item at a case-like price is probably per case.

DUPLICATE DETECTION:
- Multi-page invoices may show the same header/boilerplate on each page. Do NOT extract the same item twice.
- If you see identical item numbers or descriptions across pages, include only one entry with the correct quantity.`;

// Exported extraction body of triggerAIScan; same code path reused by
// scripts/backfill-stl-mo-line-items.mjs. Pure move; no behavior change.
export async function extractAndStoreLineItems(invoiceUuid, pages, metadata) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  try {
    const getPageData = (p) => typeof p === "string" ? p : p.data;
    const resizeForScan = (dataUrl) => {
      return dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
    };

    const imageBlocks = pages.slice(0, 6).map((page) => {
      const data = getPageData(page);
      const base64 = resizeForScan(data);
      const mediaType = data.startsWith("data:image/png") ? "image/png" : "image/jpeg";
      return { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };
    });

    // Retry-wrapped Claude call. Audits over the 2026-06-12 fix-bundle window
    // (last 30 days) showed transient one-shot failures were the dominant
    // pass-rate hit: invoices marked 'failed' that re-extracted cleanly on
    // the very next call. Retry covers API errors (429/5xx/network), JSON
    // parse failures, and 0-item returns. accountKey check + outer catch are
    // NOT retried (input validation / unexpected error).
    const extraction = await extractWithRetry(invoiceUuid, apiKey, imageBlocks);
    if (!extraction.ok) {
      console.error(`[AI Scan] ${invoiceUuid}: extraction failed: ${extraction.cause}`);
      await markScanStatus(invoiceUuid, "failed", extraction.cause);
      return;
    }
    const parsed = extraction.parsed;
    const items = extraction.items;

    const accountKey = metadata.account;
    if (!accountKey) {
      // PR 6.2 (L1) dropped the "Invoice Uploads" junk-drawer fallback;
      // the Sheets orchestrator throws when accountKey is missing. Mark
      // failed (was silently complete-with-zero-rows pre-fix).
      const cause = "metadata.account missing - cannot route to per-account Sheets tab";
      console.warn(`[AI Scan] ${invoiceUuid}: ${cause}`);
      await markScanStatus(invoiceUuid, "failed", cause);
      return;
    }

    const baseVendor = metadata.vendor || parsed.vendor || "";
    const baseInvNum = metadata.invoiceNumber || parsed.invoiceNumber || "";
    const baseInvDate = metadata.invoiceDate || parsed.invoiceDate || "";
    const lineItems = items.map((item, idx) => ({
      // Existing fields — backwards compat for cron read at Sheets cols A-M.
      // Re-sequence line_num as a clean 1..N over actual extracted lines
      // instead of trusting Claude's labels. Claude's OCR sometimes emits the
      // same line_num twice on dense invoices (confirmed: fd004ff4 Ben E Keith
      // line 38, 8232e2b4 Cheney Brothers line 10). The PG partial unique
      // index ai_line_items_new_dedup_idx ON (invoice_uuid, line_num) WHERE
      // is_historical=FALSE rejects the second row with 23505, the whole
      // batch insert throws, and the invoice silently strands with rows in
      // Sheets but none in PG. Static inspection of both confirmed cases
      // showed the dup'd lines are real distinct items (different
      // descriptions, quantities, prices), so we re-sequence rather than
      // dedup — losing data isn't acceptable. line_num is a row counter, not
      // semantic data; the original Claude label survives in raw_json for
      // debugging.
      lineNum:       idx + 1,
      description:   item.description || "",
      quantity:      item.quantity || 0,
      unit:          item.unit || "",
      unitPrice:     item.unitPrice || 0,
      extendedPrice: item.extendedPrice || 0,
      category:      item.category || "other",
      confidence:    "high",
      rawJson:       JSON.stringify(item),
      vendorName:    baseVendor,
      invoiceNumber: baseInvNum,
      invoiceDate:   baseInvDate,

      // Stage A raw labeled fields — flat pass-through, no derivation here.
      // Number fields preserve NULL (don't coerce to 0); strings preserve null/empty.
      // The Stage B derivation layer reads these to recompute quantity-for-pricing.
      itemNumber:        item.itemNumber || null,
      packSize:          item.packSize || null,
      orderedCount:      item.orderedCount != null ? item.orderedCount : null,
      shippedCount:      item.shippedCount != null ? item.shippedCount : null,
      uomRaw:            item.uomRaw || null,
      amount:            item.amount != null ? item.amount : null,
      weightLineValue:   item.weightLineValue != null ? item.weightLineValue : null,
      catchWeightMarker: item.catchWeightMarker || null,
      rawColumns:        null,  // rawColumns dropped from prompt - was causing JSON truncation on dense F5 invoices; column kept in DB as backstop, always null going forward.
    }));

    try {
      await insertAILineItems(invoiceUuid, lineItems, { accountKey, module: "ops" });
    } catch (insErr) {
      // Distinguish dual-write PG failures from Sheets-side failures so each
      // silent-gap shape becomes visible:
      //   "[dataStore.invoice.pg]"     -> status='pg_failed' (Sheets has rows, PG empty)
      //   "[dataStore.invoice.sheets]" -> status='failed'    (both stores empty - Sheets-first ordering)
      //   anything else                -> status='failed'    (unexpected; capture cause)
      // ai_scan_error captures insErr.message UNCONDITIONALLY (was: only on
      // pg_failed). The 2026-06-17 inverse drift incident showed Sheets
      // failures need the same loud-cause visibility pg_failed already has.
      const isPgFailure = insErr.message.includes("[dataStore.invoice.pg]");
      const status = isPgFailure ? "pg_failed" : "failed";
      console.error(`[AI Scan] ${invoiceUuid}: line item insert ${status}:`, insErr.message);
      await markScanStatus(invoiceUuid, status, insErr.message);
      return;
    }

    await markScanStatus(invoiceUuid, "complete");
    console.log(`[AI Scan] ${invoiceUuid}: Extracted ${lineItems.length} line items`);

  } catch (error) {
    const cause = `unexpected error in extractAndStoreLineItems: ${error.message}`;
    console.error(`[AI Scan] ${invoiceUuid}: ${cause}`);
    await markScanStatus(invoiceUuid, "failed", cause);
  }
}

// ── Claude extraction with retry on transient failures ──────────────────────
//
// Wraps the Claude OCR call in a bounded retry loop. Audits over the
// 2026-06-12 fix-bundle window showed that the dominant pass-rate hit was
// transient one-shot failures - invoices marked 'failed' that re-extracted
// cleanly on the very next call. None of the 6 sampled "failed" Cheney /
// Peddler's / Shamrock invoices required a different model or layout
// handling; both production and the candidate newer model succeeded on the
// same input the second time.
//
// What's retried:
//   - Network errors (fetch threw - DNS / connection refused / etc.)
//   - HTTP 429 (rate limit)
//   - HTTP 5xx (server-side)
//   - JSON parse failures on Claude's response text
//   - 0-item returns (Claude's output is non-deterministic; same image
//     can yield N items once and 0 the next call)
//
// What's NOT retried:
//   - HTTP 4xx other than 429 (auth / malformed request - retry won't help)
//   - missing accountKey on metadata (input validation, handled in caller)
//   - outer-catch unexpected errors (handled in caller)
//
// 0-item AFTER retries: distinct cause string ("possible non-invoice or
// unreadable layout") so we can diagnose them separately from one-shot
// transients.
async function extractWithRetry(invoiceUuid, apiKey, imageBlocks) {
  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = [1000, 3000]; // before attempts 2 and 3

  let lastResult = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      const wait = BACKOFF_MS[attempt - 2];
      console.log(`[AI Scan] ${invoiceUuid}: retry ${attempt}/${MAX_ATTEMPTS} after ${wait}ms (last: ${(lastResult?.cause || "").slice(0, 80)})`);
      await new Promise((r) => setTimeout(r, wait));
    }
    lastResult = await callClaudeOnce(apiKey, imageBlocks);
    if (lastResult.ok) {
      if (attempt > 1) {
        console.log(`[AI Scan] ${invoiceUuid}: extraction succeeded on attempt ${attempt}/${MAX_ATTEMPTS}`);
      }
      return { ok: true, parsed: lastResult.parsed, items: lastResult.items, attempts: attempt };
    }
    if (!lastResult.retryable) {
      return { ok: false, cause: lastResult.cause, attempts: attempt };
    }
  }

  // Exhausted retries. If the final attempt was a 0-item return, surface a
  // distinct cause - those are diagnostically different from API/parse fails
  // (likely a non-invoice photo, blank page, or genuinely unextractable layout).
  const cause = lastResult.zeroItems
    ? `Claude returned 0 line items after ${MAX_ATTEMPTS} attempts - possible non-invoice or unreadable layout`
    : `${lastResult.cause} (after ${MAX_ATTEMPTS} attempts)`;
  return { ok: false, cause, attempts: MAX_ATTEMPTS };
}

// ── One attempt at the Claude extraction call ────────────────────────────
// Returns a unified result object:
//   success:  { ok: true, parsed, items }
//   failure:  { ok: false, retryable: bool, cause: string, zeroItems?: true }
async function callClaudeOnce(apiKey, imageBlocks) {
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        // Raised from 8192 -> 16384 after the 2026-06-12 sweep audit found
        // two persistent failures (5a447c0a What Chefs Want, 29c8ff9f Truly
        // Good Foods) whose JSON output truncated at the old cap. Verified
        // against this model via scripts/_probe_max_tokens_16384_verification.mjs:
        //   - API accepts 16384 cleanly
        //   - Both failed invoices now produce complete valid JSON
        //     (48 items / 8203 out_t, 52 items / 9296 out_t - just over 8192)
        //   - 3 normal invoices (1/16/34 items) extract identically; small
        //     invoices use modest token counts (267/2649/5866) so the higher
        //     ceiling has no cost impact on the typical case
        // 16384 leaves ~7000 tokens of headroom over the largest observed
        // response, comfortably handling invoices with 100+ line items.
        // Cost: only used when actually generated. max_tokens is a ceiling,
        // not a target - normal invoices won't pay more.
        max_tokens: 16384,
        messages: [{ role: "user", content: [...imageBlocks, { type: "text", text: EXTRACTION_PROMPT }] }],
      }),
    });
  } catch (fetchErr) {
    // Network-level failure (DNS, connection refused, timeout) - retryable
    return { ok: false, retryable: true, cause: `Claude API network error: ${fetchErr.message}` };
  }

  if (!res.ok) {
    const errText = await res.text();
    // 429 (rate limit) and 5xx (server-side) are retryable.
    // Other 4xx (401/403/400/etc.) are auth/request errors - retry won't help.
    const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
    return { ok: false, retryable, cause: `Claude API ${res.status}: ${errText.slice(0, 200)}` };
  }

  const result = await res.json();
  const text = result.content?.[0]?.text || "";

  let parsed;
  try {
    const cleanJson = text.replace(/```json\s*|```/g, "").trim();
    parsed = JSON.parse(cleanJson);
  } catch (parseErr) {
    return { ok: false, retryable: true, cause: `Claude output JSON parse failed: ${parseErr.message}` };
  }

  const items = parsed.lineItems || [];
  if (items.length === 0) {
    return { ok: false, retryable: true, cause: "Claude returned 0 line items", zeroItems: true };
  }

  return { ok: true, parsed, items };
}

async function markScanStatus(uuid, status, errorMessage = null) {
  // PR 6.2 (S4): the previous updateScanStatus stub only wrote to a log
  // line because the Sheets schema never had a dedicated ai_scan_status
  // column. PG does (PR 6.1), so we propagate via updateInvoiceFields -
  // a no-op on the Sheets side when no FIELD_TO_COL mapping exists, an
  // actual update on the PG side once dual-write is on for invoices.
  //
  // status='pg_failed' (Module 6 dual-write visibility fix, m6-pg-failed-
  // visibility.sql) means Sheets has line items but the PG insert threw.
  // Caller passes the throw message via errorMessage so the row records
  // the precise cause - this is the gap-recurrence safety net.
  try {
    const fields = { aiScanStatus: status };
    if (errorMessage !== null) fields.aiScanError = errorMessage;
    await updateInvoiceFields(uuid, fields, { module: "ops" });
  } catch (e) {
    console.warn(`[AI Scan] ${uuid}: status update failed (non-blocking):`, e.message);
  }
}

// =============================================================================
// VENDOR PORTAL — API HANDLERS v2
// =============================================================================

// ── GET: vendor-list ──────────────────────────────────────────────────────────
export async function handleVendorList(searchParams, token, email) {
  const accountKey   = searchParams.get("accountKey");
  const category     = searchParams.get("category");
  const search       = searchParams.get("search") || "";
  const page         = parseInt(searchParams.get("page") || "1", 10);
  const pageSize     = parseInt(searchParams.get("pageSize") || "10", 10);
  const showInactive = searchParams.get("active") === "false";
  const allAccounts  = searchParams.get("allAccounts") === "true";

  if (!accountKey && !allAccounts) return { success: false, error: "accountKey required" };

  // PR 5.2: routes through dataStore/vendor.js orchestrator. The
  // orchestrator owns the master + accounts join, filtering, and
  // pagination logic identically to the pre-PR-5.2 handler. With
  // flags off (default), behavior is byte-identical.
  const result = await getVendorsForList({
    accountKey, allAccounts, category, search,
    page, pageSize, showInactive,
    module: "ops",
  });

  // Add contactName/Email/Phone empty-string keys for backwards-
  // compatible response shape (dead vendor_accounts cols N/O/P are
  // dropped by the orchestrator but the handler historically emitted
  // them as empty strings; preserve that for any frontend consumer
  // doing `'contactName' in row` checks).
  const vendors = result.vendors.map((v) => ({
    ...v,
    contactName:  "",
    contactEmail: "",
    contactPhone: "",
  }));

  return {
    success:       true,
    vendors,
    total:         result.total,
    inactiveCount: result.inactiveCount,
    hasMore:       result.hasMore,
    page:          result.page,
    pageSize:      result.pageSize,
  };
}

// ── GET: vendor-get ───────────────────────────────────────────────────────────
export async function handleVendorGet(searchParams, token, email) {
  const vendorId   = searchParams.get("vendorId");
  const accountKey = searchParams.get("accountKey");
  if (!vendorId) return { success: false, error: "vendorId required" };

  // PR 5.2: routes through dataStore/vendor.js orchestrator. The
  // orchestrator returns the canonical vendor record or null.
  const vendor = await getVendor(vendorId, accountKey, { module: "ops" });
  if (!vendor) return { success: false, error: "Vendor not found" };

  // Add contactName/Email/Phone empty strings for response shape parity
  // (dead vendor_accounts cols N/O/P; orchestrator drops them).
  return {
    success: true,
    vendor: {
      ...vendor,
      contactName:  "",
      contactEmail: "",
      contactPhone: "",
    },
  };
}

// ── POST: vendor-update ───────────────────────────────────────────────────────
export async function handleVendorUpdate(body, token, email) {
  const {
    vendorId, accountKey,
    customerAccountNum, salesRepName, salesRepPhone, salesRepEmail,
    deliveryDays, cutoffTime, deliveryMethod,
    portalUrl, portalUsername, portalPassword,
    paymentTerms, minOrder, accountNotes,
  } = body;

  if (!vendorId || !accountKey) return { success: false, error: "vendorId and accountKey required" };

  // PR 5.2: routes through dataStore/vendor.js orchestrator. The
  // orchestrator's upsertVendorAccount handles the read-existing /
  // partial-update flow that the pre-PR-5.2 handler did inline.
  // Only fields present in the body propagate; absent fields preserve
  // the existing values in both stores.
  const payload = { vendorId, accountKey };
  if (customerAccountNum !== undefined) payload.customerAccountNum = customerAccountNum;
  if (salesRepName       !== undefined) payload.salesRepName       = salesRepName;
  if (salesRepPhone      !== undefined) payload.salesRepPhone      = salesRepPhone;
  if (salesRepEmail      !== undefined) payload.salesRepEmail      = salesRepEmail;
  if (deliveryDays       !== undefined) payload.deliveryDays       = deliveryDays;
  if (cutoffTime         !== undefined) payload.cutoffTime         = cutoffTime;
  if (deliveryMethod     !== undefined) payload.deliveryMethod     = deliveryMethod;
  if (portalUrl          !== undefined) payload.portalUrl          = portalUrl;
  if (portalUsername     !== undefined) payload.portalUsername     = portalUsername;
  if (portalPassword     !== undefined) payload.portalPassword     = portalPassword;
  if (paymentTerms       !== undefined) payload.paymentTerms       = paymentTerms;
  if (minOrder           !== undefined) payload.minOrder           = minOrder;
  if (accountNotes       !== undefined) payload.accountNotes       = accountNotes;

  try {
    await upsertVendorAccount(payload);
  } catch (e) {
    // TEMP DEBUG (Module 5 cutover diagnosis)
    console.error(`[debug.handleVendorUpdate CATCH] vendorId=${body.vendorId} accountKey=${body.accountKey} message=${e.message} stack=${e.stack?.slice(0, 500)}`);
    return { success: false, error: e.message };
  }

  if (process.env.SLACK_VENDOR_WEBHOOK) {
    fetch(process.env.SLACK_VENDOR_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `Vendor updated: ${vendorId}`,
        blocks: [{ type: "section", text: { type: "mrkdwn", text: `*Vendor Updated*\n*Vendor ID:* ${vendorId}\n*Account:* ${accountKey}\n*Updated by:* ${email}` } }],
      }),
    }).catch(() => {});
  }

  return { success: true };
}

// ── POST: vendor-master-update ────────────────────────────────────────────────
export async function handleVendorMasterUpdate(body, token, email) {
  const { vendorId, name, category, website, notes, aliases } = body;

  if (!vendorId) return { success: false, error: "vendorId required" };
  if (!name || !name.trim()) return { success: false, error: "Vendor name required" };

  // PR 5.2: routes through dataStore/vendor.js orchestrator.
  // upsertVendor with existing vendorId performs the update path
  // (Sheets: cells B/C/D/E/I; PG: matching columns). Aliases is the
  // pipe-string per existing convention.
  try {
    await upsertVendor({
      vendorId,
      name:     name.trim(),
      category: category || "",
      website:  website?.trim() || "",
      notes:    notes?.trim() || "",
      ...(aliases !== undefined ? { aliases } : {}),
      createdBy: email,
    });
  } catch (e) {
    // TEMP DEBUG (Module 5 cutover diagnosis)
    console.error(`[debug.handleVendorMasterUpdate CATCH] vendorId=${body.vendorId} message=${e.message} stack=${e.stack?.slice(0, 500)}`);
    return { success: false, error: e.message };
  }

  if (process.env.SLACK_VENDOR_WEBHOOK) {
    fetch(process.env.SLACK_VENDOR_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `Vendor master updated: ${name}`,
        blocks: [{ type: "section", text: { type: "mrkdwn", text: `*Vendor Master Updated*\n*Name:* ${name}\n*ID:* ${vendorId}\n*Category:* ${category || "N/A"}\n*Updated by:* ${email}` } }],
      }),
    }).catch(() => {});
  }

  return { success: true };
}

// ── POST: vendor-deactivate ───────────────────────────────────────────────────
// Stopgap admin gate (F12, Audit #4): full chef-request-approval workflow is a follow-up PR.
export async function handleVendorDeactivate(body, token, email) {
  const { vendorId, accountKey } = body;
  if (!vendorId || !accountKey) return { success: false, error: "vendorId and accountKey required" };
  if (!OPS_LEADERSHIP_EMAILS.includes(email)) {
    return { success: false, error: "Vendor deactivation requires admin approval. Contact Kevin to deactivate a vendor." };
  }
  return setVendorActiveViaOrchestrator(vendorId, accountKey, false, email);
}

// ── POST: vendor-reactivate ───────────────────────────────────────────────────
export async function handleVendorReactivate(body, token, email) {
  const { vendorId, accountKey } = body;
  if (!vendorId || !accountKey) return { success: false, error: "vendorId and accountKey required" };
  return setVendorActiveViaOrchestrator(vendorId, accountKey, true, email);
}

// Shared adapter for de/reactivate: shells to the orchestrator and
// fires the Slack notification on success. The legacy setVendorActive
// helper was deleted in PR 5.2; this is its replacement and only the
// 2 vendor handlers above call it.
async function setVendorActiveViaOrchestrator(vendorId, accountKey, active, email) {
  try {
    await deactivateVendorAccount({ vendorId, accountKey, active });
  } catch (e) {
    return { success: false, error: e.message };
  }

  if (process.env.SLACK_VENDOR_WEBHOOK) {
    const actionLabel = active ? "Reactivated" : "Deactivated";
    fetch(process.env.SLACK_VENDOR_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `Vendor ${actionLabel.toLowerCase()}: ${vendorId}`,
        blocks: [{ type: "section", text: { type: "mrkdwn", text: `*Vendor ${actionLabel}*\n*Vendor ID:* ${vendorId}\n*Account:* ${accountKey}\n*By:* ${email}` } }],
      }),
    }).catch(() => {});
  }

  return { success: true };
}

// learnVendorAlias helper deleted - replaced by orchestrator import
// at the top of this file. Call site (invoice-submit, ~L1070) uses
// the orchestrator's { vendorId, ocrName, learnedBy } signature.

// ── POST: vendor-merge ────────────────────────────────────────────────────────
// BR1 (Audit #4): admin-only. Same OPS_LEADERSHIP gate as
// handleVendorDeactivate. Added in PR 5.2.
export async function handleVendorMerge(body, token, email) {
  const { keeperId, dupeIds } = body;
  if (!keeperId || !dupeIds?.length) return { success: false, error: "keeperId and dupeIds required" };
  if (!OPS_LEADERSHIP_EMAILS.includes(email)) {
    return { success: false, error: "Vendor merge requires admin approval. Contact Kevin to merge vendors." };
  }

  // PR 5.2: routes through dataStore/vendor.js orchestrator. The
  // orchestrator handles the 3-step Sheets sequence + the
  // (sequential, non-atomic in PR 5.1; transactional in PR 5.3) PG
  // sequence. Returns the same counts the old handler reported.
  let result;
  try {
    result = await mergeVendors({ keeperId, dupeIds, email });
  } catch (e) {
    return { success: false, error: e.message };
  }

  if (process.env.SLACK_VENDOR_WEBHOOK) {
    fetch(process.env.SLACK_VENDOR_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `Vendors merged: ${dupeIds.join(", ")} -> ${keeperId}`,
        blocks: [{ type: "section", text: { type: "mrkdwn",
          text: `*Vendors Merged*\n*Kept:* ${keeperId}\n*Removed:* ${dupeIds.join(", ")}\n*Aliases added:* ${result.aliasesAdded.join(", ") || "none"}\n*Accounts reassigned:* ${result.accountRowsReassigned}\n*By:* ${email}` } }],
      }),
    }).catch(() => {});
  }

  return {
    success:               true,
    keeperId:              result.keeperId,
    dupeIds:               result.dupeIds,
    accountRowsReassigned: result.accountRowsReassigned,
    vendorRowsDeleted:     result.vendorRowsDeleted,
    aliasesAdded:          result.aliasesAdded,
  };
}