/**
 * INVOICE CAPTURE API — v2.1
 * Actions: invoice-bootstrap, invoice-submit, invoice-scan, vendor-add, vendor-search, invoice-history
 * NEW:     invoice-ocr (Feature #6 + #21 + #23)
 * NEW:     invoice-consistency-check (multi-page rogue detection)
 * UPDATED: invoice-photo-gate now returns pageNumber / totalPages / pageNumberConfidence
 */

import { readSheetSA, appendRowSA, appendRowsSA, findRowByValueSA, updateCellSA, updateRangeSA, batchUpdateRangesSA, deleteRowSA, getSheetIdSA, createTabSA, safeRead, SHEET_IDS } from "@/lib/sheets";
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

// ─── GL Code Parser (Grouped + Filtered) ───
const EXCLUDED_CATEGORIES = new Set([
  "income",
  "kitchen labor costs",
  "meal service",
  "wages",
  "insurance",
  "professional fees",
]);

const SECTION_MARKERS = new Set([
  "cost of goods sold",
  "expenses",
]);

const EXCLUDED_ITEMS = new Set([
  "telephone expense",
  "paid time off",
  "medical/dental/vision",
  "charitable contributions",
]);

function parseGLCodes(rows) {
  const groups = [];
  let currentCategory = null;
  let currentCodes = [];
  let skipUntilNextHeader = false;

  function saveCategory() {
    if (currentCategory && currentCodes.length > 0) {
      groups.push({ category: currentCategory, codes: [...currentCodes] });
    }
    currentCategory = null;
    currentCodes = [];
  }

  for (const row of rows) {
    const colA = String(row[0] || "").trim();
    const colB = row[1] != null ? String(row[1]).trim() : "";
    const hasCode = colB.length > 0 && colB !== "Account #";

    if (!colA || colA === "Account Name/Type") continue;

    if (!hasCode) {
      const lower = colA.toLowerCase();
      if (SECTION_MARKERS.has(lower)) { skipUntilNextHeader = false; continue; }
      if (EXCLUDED_CATEGORIES.has(lower)) { skipUntilNextHeader = true; continue; }
      skipUntilNextHeader = false;
      saveCategory();
      currentCategory = colA;
      continue;
    }

    if (skipUntilNextHeader) continue;

    const itemName = colA.replace(/^\s+/, "");
    if (EXCLUDED_ITEMS.has(itemName.toLowerCase())) continue;

    if (currentCategory) {
      currentCodes.push({ code: colB, name: itemName });
    }
  }

  saveCategory();
  return groups;
}

function flattenGLCodes(groups) {
  return groups.flatMap((g) => g.codes);
}

const GL_TAB_MAP = {
  "CORP": "CORP",
  "CIN - AZ": "CIN - AZ (REDS)",
  "CIN - KY": "CIN - KY (LBATS)",
  "CIN - OH": "CIN - OH (CINN)",
  "STL - FL": "STL - FL",
  "STL - MO": "STL - MO",
  "TBJ - FL": "TBJ - FL",
  "TBJ - BUF": "TBJ - BUF",
  "TBR - FL": "TBR - FL",
  "TXR - AZ": "TXR - AZ",
  "TXR - HOME": "TXR - Home",
  "TXR - TX - H": "TXR - Home",
  "TXR - VISTOR": "TXR - Vistor",
  "TXR - TX - V": "TXR - Vistor",
};

// ─── Line Item Tab Auto-Creation ───
const LINE_ITEM_HEADERS = [
  "Invoice UUID", "Timestamp", "Account", "Vendor", "Invoice #",
  "Invoice Date", "Line #", "Item Description", "Quantity", "Unit",
  "Unit Price", "Extended Price", "Category", "Confidence", "Raw JSON",
];

async function ensureLineItemTab(token, tabName) {
  const spreadsheetId = SHEET_IDS.AI_LINE_ITEMS;
  try {
    const sheetId = await getSheetIdSA(spreadsheetId, tabName);
    if (sheetId !== null) return true; // tab already exists

    const createResult = await createTabSA(spreadsheetId, tabName);
    if (!createResult.success) {
      console.error(`[ensureLineItemTab] Tab creation failed for "${tabName}":`, createResult.error);
      return false;
    }

    // Header row missing is recoverable manually; don't fail the path if header append fails.
    const headerResult = await appendRowSA(spreadsheetId, tabName, LINE_ITEM_HEADERS);
    if (!headerResult.success) {
      console.warn(`[ensureLineItemTab] Header append failed for "${tabName}":`, headerResult.error);
    }

    console.log(`[ensureLineItemTab] Created new tab: "${tabName}"`);
    return true;
  } catch (error) {
    console.error(`[ensureLineItemTab] Error:`, error.message);
    return false;
  }
}

function getGLTabName(accountKey) {
  if (GL_TAB_MAP[accountKey]) return GL_TAB_MAP[accountKey];
  const parts = accountKey.split(" - ");
  if (parts.length >= 2) {
    const shortKey = `${parts[0].trim()} - ${parts[1].trim()}`;
    if (GL_TAB_MAP[shortKey]) return GL_TAB_MAP[shortKey];
  }
  return null;
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

function parseSubmissionRow(r) {
  return {
    uuid: String(r[0] || ""),
    timestamp: String(r[1] || ""),
    userEmail: String(r[2] || ""),
    account: String(r[3] || ""),
    vendor: String(r[4] || ""),
    vendorId: String(r[5] || ""),
    invoiceNumber: String(r[6] || ""),
    invoiceDate: String(r[7] || ""),
    totalAmount: Number(r[8]) || 0,
    glBreakdown: String(r[9] || ""),
    driveUrls: String(r[10] || ""),
    pageCount: Number(r[11]) || 1,
    emailSent: String(r[12] || "") === "TRUE",
    status: String(r[13] || "sent"),
    statusUpdatedAt: String(r[14] || ""),
    type: String(r[15] || "invoice"),
    rawDriveUrl: String(r[16] || ""),
    rejectionReason: String(r[17] || ""),
    rejectionNote: String(r[18] || ""),
    rejectedBy: String(r[19] || ""),
    rejectedAt: String(r[20] || ""),
    correctedFromUuid: String(r[21] || ""),
    dupeOverride: String(r[22] || ""),
  };
}

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
      const tabName = getGLTabName(accountParam);
      if (tabName) {
        try {
          const glRaw = await readSheetSA(SHEET_IDS.GL_CODES, tabName);
          glCodes = parseGLCodes(glRaw.rows);
        } catch (e) {
          console.warn(`[Invoice] GL codes for "${tabName}" failed:`, e.message);
        }
      }
    }

    let recentSubmissions = [];
    try {
      const subRaw = await safeRead(SHEET_IDS.COLLECTION, "invoice_submissions_26");
      recentSubmissions = subRaw.rows
        .filter((r) => { const acct = String(r[3] || "").trim(); return accountParam ? acct === accountParam : true; })
        .map(parseSubmissionRow)
        .slice(-200)
        .reverse();
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
    const subRaw = await safeRead(SHEET_IDS.COLLECTION, "invoice_submissions_26");
    const history = subRaw.rows
      .filter((r) => { const acct = String(r[3] || "").trim(); return accountParam ? acct === accountParam : true; })
      .map(parseSubmissionRow)
      .slice(-200)
      .reverse();
    return { success: true, history };
  }

  // ── Admin: All Submissions ──
  if (action === "invoice-admin-list") {
    const periodParam = searchParams.get("period") || "week";
    const subRaw = await safeRead(SHEET_IDS.COLLECTION, "invoice_submissions_26");
    let rows = subRaw.rows.map(parseSubmissionRow).reverse();

    if (periodParam === "week") {
      const cutoff = new Date(Date.now() - 7 * 86400000);
      rows = rows.filter((r) => new Date(r.timestamp) >= cutoff);
    } else if (periodParam === "month") {
      const cutoff = new Date(Date.now() - 30 * 86400000);
      rows = rows.filter((r) => new Date(r.timestamp) >= cutoff);
    }

    return { success: true, submissions: rows };
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
          model: "claude-sonnet-4-20250514",
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

STEP 1 — IMAGE QUALITY CHECK:
If the image is too blurry, too dark, severely cropped, upside down, not an invoice, or otherwise unreadable, respond ONLY with:
{
  "readable": false,
  "reason": "brief specific reason",
  "suggestion": "specific advice for fixing the upload"
}

IMPORTANT: A mostly-blank page with only a URL or footer text is a normal trailing page from a browser PDF print. It is NOT an error. Treat it as readable and extract what you can (likely null for all fields). Do NOT reject it.

Reason examples: "Document is too blurry to read", "Document is too dark to read", "Invoice is cut off - key details are missing", "This doesn't appear to be an invoice"
Suggestion examples: "Please re-export the PDF or try a different file", "Try downloading the invoice again from the vendor portal", "Upload the full invoice including all pages", "Please upload an invoice document"

STEP 2 — If readable, extract fields and respond with:
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
- For amounts, return a plain number (no $, no commas). Use the INVOICE TOTAL / grand total from the summary section — this is the final amount due at the bottom of the last page. NEVER use subtotals, group totals, or per-category totals.

VENDOR NAME RULES:
- vendorName = the company that ISSUED the invoice, NOT the ordering platform.
- Always extract the COMPLETE vendor/company name exactly as it appears on the invoice header, logo, or letterhead. Never abbreviate or use only part of the name. Examples: "Ben E. Keith" not "Keith", "What Chefs Want" not "Chefs Want", "Fortune Fish & Gourmet" not "Fortune Fish".
- IGNORE browser chrome, page headers/footers, and platform names like "Cut+Dry", "cutanddry.com", "BlueCart", "Orderve", "ChefSheet". These are ordering platforms, not vendors.
- Look for a "Vendor:" label, company logo, or letterhead INSIDE the document body.
- Common KitchFix vendors: Ben E. Keith, What Chefs Want, Fresh Point, Sysco, US Foods, Fortune Fish & Gourmet, Samuels Seafood, Performance Foodservice, Kuna Foodservice, Rolling Lawn Farms, City Seafood, Lohr Distribution, Truly Good Foods.

INVOICE NUMBER RULES:
- Look first for a field explicitly labeled "Invoice #" or "Invoice Number".
- If no "Invoice #" field exists, use "Order #" as the invoice number.
- If neither exists, use "Reference #".
- EXCEPTION: For "What Chefs Want" invoices (from Cut+Dry / cutanddry.com), ALWAYS use the "Reference #" as the invoice number, NOT the "Order #". The Reference # is typically a shorter number (e.g. 12524109) compared to the longer Order # (e.g. 928127343).
- NEVER use "Customer ID" as the invoice number.
- Return only the number value, not the label (e.g. "906637520" not "Order #: 906637520").

- confidence: "high" = all 4 fields clearly extracted, "medium" = 2-3 fields extracted, "low" = only 1 field or uncertain.
- If a field cannot be determined, use null — never guess.`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
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
          model: "claude-sonnet-4-20250514",
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
        const glTabName = getGLTabName(account);
        if (glTabName) {
          const glRaw = await readSheetSA(SHEET_IDS.GL_CODES, glTabName);
          const glGroups = parseGLCodes(glRaw.rows);
          const glLookup = {};
          for (const group of glGroups) {
            for (const item of group.codes) { glLookup[item.code] = item.name; }
          }
          for (const row of enrichedGlRows) {
            if (glLookup[row.code]) row.name = glLookup[row.code];
          }
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
      try {
        const dupRead = await readSheetSA(SHEET_IDS.COLLECTION, "invoice_submissions_26");
        if (dupRead.rows.some((r) => String(r[0] || "") === uuid)) {
          console.log(`[Invoice] F25 idempotency: clientUuid ${uuid.slice(0, 8)} already processed, returning dedup`);
          return { success: true, uuid, deduplicated: true };
        }
        if (!correctedFromUuid) {
          const normalizeInv = (n) => String(n || "").trim().replace(/^[#\s]+/, "").replace(/^0+/, "") || "0";
          const inputNorm = normalizeInv(invoiceNumber);
          const dupFound = dupRead.rows.find((r) => {
            const status = String(r[13] || "sent");
            const correctedFrom = String(r[21] || "");
            if (status === "corrected" || correctedFrom) return false;
            return String(r[4] || "").trim() === vendor
              && normalizeInv(r[6]) === inputNorm
              && String(r[7] || "").trim() === invoiceDate
              && Math.abs((Number(r[8]) || 0) - (Number(totalAmount) || 0)) < 0.01;
          });
          if (dupFound) {
            console.warn(`[Invoice] Server-side duplicate blocked: ${vendor} #${invoiceNumber} ${invoiceDate}`);
            return { success: false, error: "Duplicate invoice detected — this invoice was already submitted. Check History for the existing submission." };
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

      // 4. Log to sheet
      const row = [
        uuid, now.toISOString(), email, account, vendor,
        vendorId || "", invoiceNumber || "", invoiceDate,
        Number(totalAmount) || 0, JSON.stringify(glRows), JSON.stringify(driveUrls),
pages.length, "FALSE", "sent", "", type, rawDriveUrl,
        "", "", "", "", correctedFromUuid || "",
      ];

      const sheetResult = await appendRowSA(SHEET_IDS.COLLECTION, "invoice_submissions_26", row);
      if (!sheetResult.success) return { success: false, error: "Failed to log submission: " + sheetResult.error };

      // 4b. If this is a correction, mark the original as "corrected"
      if (correctedFromUuid) {
        try {
          const origRow = await findRowByValueSA(SHEET_IDS.COLLECTION, "invoice_submissions_26", 0, correctedFromUuid);
          if (origRow) {
            // Cols N,O contiguous → single range write
            await updateRangeSA(SHEET_IDS.COLLECTION, `invoice_submissions_26!N${origRow}:O${origRow}`, [["corrected", now.toISOString()]]);
            console.log(`[Invoice] Marked original ${correctedFromUuid} as corrected`);
          }
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
          const rowNum = await findRowByValueSA(SHEET_IDS.COLLECTION, "invoice_submissions_26", 0, uuid);
          if (rowNum) await updateCellSA(SHEET_IDS.COLLECTION, `invoice_submissions_26!M${rowNum}`, "TRUE");
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
    const { vendor, invoiceNumber, invoiceDate, totalAmount } = body;

    const { rows } = await safeRead(SHEET_IDS.COLLECTION, "invoice_submissions_26");
// Normalize invoice numbers: strip #, leading/trailing spaces, leading zeros
    const normalizeInvNum = (n) => String(n || "").trim().replace(/^[#\s]+/, "").replace(/^0+/, "") || "0";
    const inputInvNorm = normalizeInvNum(invoiceNumber);

    const match = rows.find((r) => {
      const v = String(r[4] || "").trim();
      const inv = normalizeInvNum(r[6]);
      const d = String(r[7] || "").trim();
      const amt = Number(r[8]) || 0;
      const status = String(r[13] || "sent");
      const correctedFrom = String(r[21] || "");
      // Skip corrected originals and resubmissions — they're expected to match
      if (status === "corrected" || correctedFrom) return false;
      return v === vendor && inv === inputInvNorm && d === invoiceDate && Math.abs(amt - Number(totalAmount)) < 0.01;
    });
        return {
      success: true,
      isDuplicate: !!match,
      existingInvoice: match
        ? { uuid: String(match[0] || ""), timestamp: String(match[1] || ""), userEmail: String(match[2] || "") }
        : null,
    };
  }

  // ── Reject / Return Invoice ──
  if (action === "invoice-reject") {
    const { uuid, reasons, note } = body;
    if (!uuid || !note) return { success: false, error: "Missing uuid or note" };

    const rowNum = await findRowByValueSA(SHEET_IDS.COLLECTION, "invoice_submissions_26", 0, uuid);
    if (!rowNum) return { success: false, error: "Submission not found" };

    // Read original row for notification context
    const { rows: allRows } = await safeRead(SHEET_IDS.COLLECTION, "invoice_submissions_26");
    const origRow = allRows.find((r) => String(r[0] || "") === uuid);
    const origVendor = String(origRow?.[4] || "Unknown");
    const origInvNum = String(origRow?.[6] || "");
    const origAccount = String(origRow?.[3] || "");
    const origTotal = Number(origRow?.[8]) || 0;
    const origSubmitter = String(origRow?.[2] || "");

    // Cols N,O and R-U are two non-adjacent ranges on the same row → single batched API call
    const rejectedAt = new Date().toISOString();
    await batchUpdateRangesSA(SHEET_IDS.COLLECTION, [
      { range: `invoice_submissions_26!N${rowNum}:O${rowNum}`, values: [["returned", rejectedAt]] },
      { range: `invoice_submissions_26!R${rowNum}:U${rowNum}`, values: [[(reasons || []).join(", "), note, email, rejectedAt]] },
    ]);

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

    const rowNum = await findRowByValueSA(SHEET_IDS.COLLECTION, "invoice_submissions_26", 0, uuid);
    if (!rowNum) return { success: false, error: "Submission not found" };

    const { rows: allRows } = await safeRead(SHEET_IDS.COLLECTION, "invoice_submissions_26");
    const origRow = allRows.find((r) => String(r[0] || "") === uuid);
    const origSubmitter = String(origRow?.[2] || "");
    const origVendor = String(origRow?.[4] || "Unknown");
    const origInvNum = String(origRow?.[6] || "");
    const origAccount = String(origRow?.[3] || "");

    // Cols N,O and R-U are two non-adjacent ranges on the same row → single batched API call
    await batchUpdateRangesSA(SHEET_IDS.COLLECTION, [
      { range: `invoice_submissions_26!N${rowNum}:O${rowNum}`, values: [["sent", new Date().toISOString()]] },
      { range: `invoice_submissions_26!R${rowNum}:U${rowNum}`, values: [["", "", "", ""]] },
    ]);

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

    const rowNum = await findRowByValueSA(SHEET_IDS.COLLECTION, "invoice_submissions_26", 0, uuid);
    if (!rowNum) return { success: false, error: "Submission not found" };

    await updateCellSA(SHEET_IDS.COLLECTION, `invoice_submissions_26!W${rowNum}`, "not_duplicate");
    console.log(`[Invoice] Dupe dismissed for ${uuid} by ${email}`);

    return { success: true };
  }

  // ── Delete Duplicate ──
  if (action === "invoice-delete-dupe") {
    const { uuid, vendor, invoiceNumber, totalAmount } = body;
    if (!uuid) return { success: false, error: "Missing uuid" };

    const rowNum = await findRowByValueSA(SHEET_IDS.COLLECTION, "invoice_submissions_26", 0, uuid);
    if (!rowNum) return { success: false, error: "Submission not found" };

    const sheetId = await getSheetIdSA(SHEET_IDS.COLLECTION, "invoice_submissions_26");
    if (sheetId === null) return { success: false, error: "Submissions tab not found" };

    // Delete the row (rowNum is 1-based, deleteRowSA uses 0-based)
    const deleteResult = await deleteRowSA(SHEET_IDS.COLLECTION, sheetId, rowNum - 1);
    if (!deleteResult.success) {
      console.error(`[Invoice] Delete failed for ${uuid}:`, deleteResult.error);
      return { success: false, error: "Failed to delete row" };
    }

    console.log(`[Invoice] Duplicate DELETED: ${vendor} #${invoiceNumber} ($${totalAmount}) uuid=${uuid} by ${email}`);

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

  // Skip line item extraction for photo-only submissions — phone photos produce
  // unreliable line item data. Only run extraction when at least one page is a
  // digital PDF upload (clean text, reliable parsing).
  const hasDigitalPDF = pages.some((p) => (typeof p === "object" ? p.type : null) === "pdf");
  if (!hasDigitalPDF) {
    console.log(`[AI Scan] ${invoiceUuid}: Photo-only submission — skipping line item extraction`);
    await updateScanStatus(token, invoiceUuid, "photo-only");
    return;
  }

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

    const prompt = `You are an invoice data extraction engine for KitchFix, a food service company. Extract ALL line items from this invoice.

Return ONLY valid JSON with this structure:
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
      "quantity": number,
      "unit": "case|lb|ea|gal|oz|bag|box|each|pack|other",
      "unitPrice": number,
      "extendedPrice": number,
      "category": "produce|protein|dairy|dry_goods|beverage|packaging|cleaning|supplies|smallwares|other"
    }
  ]
}

Rules:
- Extract every line item visible on the invoice
- For quantity and prices, use numbers only (no $ signs)
- Category should be your best guess based on the item description
- If a field is unclear, use null
- Return ONLY the JSON object, no markdown or explanation

CRITICAL — SKIP THESE ROWS (they are NOT line items):
- Summary rows: "GRAND TOTAL", "MAJOR CATEGORY SUMMARY", "CONTINUED", "SPLITS", any row that is a subtotal or category rollup
- Boilerplate/disclaimer text about perishable commodities, restock fees, return policies, credit terms, collection fees
- Weight notation lines like "Weight: 80.7" or "TOTAL = 37.7 ==>>>> 18.90 18.80" — these are supplementary detail for the line item above them, not separate items
- Distribution/freight fee lines (e.g., "DISTRIBUTION FEE", "FREIGHT") — extract these as a single line item with category "other", not as multiple items
- Column headers (ITEM NO, ORDERED, SHIPPED, DESCRIPTION, CASE PACK, UNIT, PRICE, AMOUNT)

CATCH-WEIGHT ITEMS (marked with *CS or *EA on Kuna/distributor invoices):
- These items are priced PER POUND, not per case. The PRICE column shows $/lb and the AMOUNT column shows the extended price based on actual delivered weight.
- For catch-weight items: use the AMOUNT column as extendedPrice, use the PRICE column as unitPrice (per lb), and set unit to "lb".
- quantity for catch-weight items = the weight shown (e.g., "Weight: 80.7" means qty 80.7 lb)
- If the weight line is not clearly readable, calculate: quantity = extendedPrice / unitPrice

QUANTITY RULES:
- Use the SHIPPED column, not the ORDERED column (shipped = what was actually delivered)
- If ordered and shipped differ, always use shipped quantity

UNIT RULES — always use "case" as the default unit for food service invoices unless:
- Item is marked *EA → use "each"
- Item is catch-weight *CS → use "lb" (see above)
- Item is clearly sold per pound with no case pack

Unit disambiguation — price reasonableness check:
- $15+ per "oz" is likely per "each" or per "jar" or per "bottle"
- $100+ per "lb" is likely per "case"
- $50+ per "gal" for a non-bulk item is likely per "case"
- Use context from other line items to calibrate. If most items are priced per case, a single item at a case-like price is probably per case.
- Normalize abbreviations: cs = case, ea = each, gal = gallon, bx = box, bg = bag, pk = pack

DUPLICATE DETECTION:
- Multi-page invoices may show the same header/boilerplate on each page. Do NOT extract the same item twice.
- If you see identical item numbers or descriptions across pages, include only one entry with the correct quantity.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        messages: [{ role: "user", content: [...imageBlocks, { type: "text", text: prompt }] }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[AI Scan] API error:", res.status, errText);
      await updateScanStatus(token, invoiceUuid, "failed");
      return;
    }

    const result = await res.json();
    const text = result.content?.[0]?.text || "";

    let parsed;
    try {
      const cleanJson = text.replace(/```json\s*|```/g, "").trim();
      parsed = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.error("[AI Scan] JSON parse failed:", parseErr.message);
      await updateScanStatus(token, invoiceUuid, "failed");
      return;
    }

    if (parsed.lineItems && parsed.lineItems.length > 0) {
      const now = new Date().toISOString();
      const lineRows = parsed.lineItems.map((item) => [
        invoiceUuid, now, metadata.account,
        metadata.vendor || parsed.vendor || "",
        metadata.invoiceNumber || parsed.invoiceNumber || "",
        metadata.invoiceDate || parsed.invoiceDate || "",
        item.lineNum || 0, item.description || "",
        item.quantity || 0, item.unit || "",
        item.unitPrice || 0, item.extendedPrice || 0,
        item.category || "other", "high", JSON.stringify(item),
      ]);

const accountTab = metadata.account || "Uncategorized";
      const tabReady = await ensureLineItemTab(token, accountTab);
      if (tabReady) {
        await appendRowsSA(SHEET_IDS.AI_LINE_ITEMS, accountTab, lineRows);
      } else {
        console.warn(`[AI Scan] Tab "${accountTab}" not ready, falling back`);
        await appendRowsSA(SHEET_IDS.AI_LINE_ITEMS, "Invoice Uploads", lineRows);
      }
        }

    await updateScanStatus(token, invoiceUuid, "complete");
    console.log(`[AI Scan] ${invoiceUuid}: Extracted ${parsed.lineItems?.length || 0} line items`);

  } catch (error) {
    console.error("[AI Scan] Error:", error.message);
    await updateScanStatus(token, invoiceUuid, "failed");
  }
}

async function updateScanStatus(token, uuid, status) {
  // AI scan status is logged but no longer written to column N,
  // which is now reserved for submission status (sent/returned/corrected).
  console.log(`[AI Scan] ${uuid}: scan status = ${status}`);
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