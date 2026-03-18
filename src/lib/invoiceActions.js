/**
 * INVOICE CAPTURE API — v2.1
 * Actions: invoice-bootstrap, invoice-submit, invoice-scan, vendor-add, vendor-search, invoice-history
 * NEW:     invoice-ocr (Feature #6 + #21 + #23)
 * NEW:     invoice-consistency-check (multi-page rogue detection)
 * UPDATED: invoice-photo-gate now returns pageNumber / totalPages / pageNumberConfidence
 */

import { readSheet, appendRow, appendRows, findRowByValue, updateCell, SHEET_IDS } from "@/lib/sheets";
import { uploadInvoicePages, uploadStampedPDF } from "@/lib/drive";
import { sendInvoiceEmail } from "@/lib/gmail";
import { createStampedInvoicePDF } from "@/lib/stampInvoice";

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


// ═══════════════════════════════════════
// VENDOR FUZZY MATCH ENGINE (Feature #21)
// ═══════════════════════════════════════

function fuzzyMatchVendor(detectedName, vendorRows) {
  if (!detectedName || !vendorRows?.length) return null;

  const detected = detectedName.toLowerCase().trim();
  const noise = ["inc", "llc", "ltd", "corp", "co", "company", "foods", "food", "supply", "supplies", "distributors", "distribution", "services"];

  function normalize(str) {
    return str.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").split(/\s+/).filter((w) => !noise.includes(w)).join(" ").trim();
  }

  const detectedNorm = normalize(detected);
  const detectedWords = detectedNorm.split(/\s+/);

  const candidates = vendorRows
    .map((r) => ({
      vendorId: String(r[0] || "").trim(),
      name: String(r[1] || "").trim(),
      category: String(r[2] || "").trim(),
    }))
    .filter((v) => v.vendorId && v.name)
    .map((v) => {
      const name = v.name.toLowerCase().trim();
      const nameNorm = normalize(name);
      const nameWords = nameNorm.split(/\s+/);
      let score = 0;

      if (name === detected || nameNorm === detectedNorm) {
        score = 100;
      } else if (name.includes(detected) || detected.includes(name)) {
        score = 85;
      } else if (nameNorm.includes(detectedNorm) || detectedNorm.includes(nameNorm)) {
        score = 80;
      } else {
        const matchedWords = detectedWords.filter((dw) =>
          nameWords.some((nw) => nw === dw || (nw.length >= 4 && dw.length >= 4 && (nw.includes(dw) || dw.includes(nw))))
        );
        if (matchedWords.length > 0) {
          score = Math.round((matchedWords.length / Math.max(detectedWords.length, nameWords.length)) * 70);
          if (detectedWords[0] && nameWords[0] && (detectedWords[0] === nameWords[0] || detectedWords[0].includes(nameWords[0]) || nameWords[0].includes(detectedWords[0]))) {
            score += 15;
          }
        }
      }

      return { ...v, score };
    })
    .filter((v) => v.score >= 30)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (candidates.length === 0) return null;

  return {
    bestMatch: candidates[0],
    confidence: candidates[0].score >= 80 ? "high" : candidates[0].score >= 50 ? "medium" : "low",
    alternatives: candidates.slice(1),
  };
}


// ═══════════════════════════════════════
// GET HANDLERS
// ═══════════════════════════════════════

export async function handleInvoiceGet(action, searchParams, token, email) {

  const safeRead = async (id, tab) => {
    try { return await readSheet(token, id, tab); }
    catch (e) { console.warn(`[Invoice] Sheet "${tab}" error:`, e.message); return { headers: [], rows: [] }; }
  };

  // ── Invoice Bootstrap ──
  if (action === "invoice-bootstrap") {
    const accountParam = searchParams.get("account");

    const [vendorMasterRaw, vendorAccountsRaw] = await Promise.all([
      safeRead(SHEET_IDS.HUB, "vendor_master"),
      safeRead(SHEET_IDS.HUB, "vendor_accounts"),
    ]);

    const vendorMaster = vendorMasterRaw.rows
      .map((r) => ({
        vendorId: String(r[0] || "").trim(),
        name: String(r[1] || "").trim(),
        category: String(r[2] || "").trim(),
        website: String(r[3] || "").trim(),
        notes: String(r[4] || "").trim(),
      }))
      .filter((v) => v.vendorId && v.name);

    const accountVendors = vendorAccountsRaw.rows
      .filter((r) => {
        const acct = String(r[2] || "").trim();
        const active = String(r[18] || "TRUE").trim().toUpperCase();
        return (accountParam ? acct === accountParam : true) && active !== "FALSE";
      })
      .map((r) => ({
        rowId: String(r[0] || "").trim(),
        vendorId: String(r[1] || "").trim(),
        account: String(r[2] || "").trim(),
        customerAccountNum: String(r[3] || "").trim(),
        salesRepName: String(r[4] || "").trim(),
        salesRepPhone: String(r[5] || "").trim(),
        salesRepEmail: String(r[6] || "").trim(),
        deliveryDays: String(r[7] || "").trim(),
        cutoffTime: String(r[8] || "").trim(),
        deliveryMethod: String(r[9] || "").trim(),
        portalUrl: String(r[10] || "").trim(),
        portalUsername: String(r[11] || "").trim(),
        portalPassword: String(r[12] || "").trim(),
        contactName: String(r[13] || "").trim(),
        contactEmail: String(r[14] || "").trim(),
        contactPhone: String(r[15] || "").trim(),
        paymentTerms: String(r[16] || "").trim(),
        minOrder: String(r[17] || "").trim(),
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
          const glRaw = await readSheet(token, SHEET_IDS.GL_CODES, tabName);
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
        .map((r) => ({
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
          aiScanStatus: String(r[13] || "pending"),
        }))
        .reverse()
        .slice(0, 20);
    } catch (e) {
      console.warn("[Invoice] History load failed:", e.message);
    }

    return { success: true, vendors, vendorMaster, glCodes, recentSubmissions };
  }

  // ── Vendor Search ──
  if (action === "vendor-search") {
    const query = (searchParams.get("q") || "").toLowerCase().trim();
    const { rows } = await safeRead(SHEET_IDS.HUB, "vendor_master");
    const results = rows
      .map((r) => ({ vendorId: String(r[0] || "").trim(), name: String(r[1] || "").trim(), category: String(r[2] || "").trim() }))
      .filter((v) => v.name && v.name.toLowerCase().includes(query))
      .slice(0, 20);
    return { success: true, vendors: results };
  }

  // ── Invoice History ──
  if (action === "invoice-history") {
    const accountParam = searchParams.get("account");
    const subRaw = await safeRead(SHEET_IDS.COLLECTION, "invoice_submissions_26");
    const history = subRaw.rows
      .filter((r) => { const acct = String(r[3] || "").trim(); return accountParam ? acct === accountParam : true; })
      .map((r) => ({
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
        aiScanStatus: String(r[13] || "pending"),
      }))
      .reverse()
      .slice(0, 20);
    return { success: true, history };
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

      const gatePrompt = `You are a document quality gate for KitchFix, a food service company. Chef operators photograph invoices and receipts to submit to accounts payable.

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
✓ A receipt or invoice held in a hand — the hand is irrelevant, the document is the subject
✓ Any thermal paper receipt, even if it appears small relative to the frame size
✓ Receipt on a car seat, steering wheel, lap, counter, or desk
✓ Document photographed from an angle or at a distance
✓ Blurry or dark photos where you can still make out it is a financial document
✓ Receipt partially cut off but still clearly identifiable as a receipt
✓ ANY image where you can read a merchant name, dollar amounts, or transaction details

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

═══ STEP 3: PHOTO QUALITY ═══
Quality should ONLY fail if the document genuinely cannot be processed by AP. Be very practical, not perfectionist.

QUALITY PASS — all of these are explicitly fine:
✓ Handwriting on the document — operators routinely write GL codes with marker. NORMAL and EXPECTED.
✓ Document at a slight angle or perspective
✓ Minor shadows that don't obscure text
✓ Slightly wrinkled, folded, or creased paper
✓ Stamps, stickers, staple marks, or tape
✓ PDF pages rendered as images (always pass — already digital)
✓ Thermal receipt paper, even slightly faded, as long as key text is readable
✓ A hand or fingers holding the document — this is the most common way field staff photograph receipts. NEVER treat a hand as an obstruction or quality failure.
✓ Hand visible prominently in frame — still fine
✓ Finger at the edge of or near the document
✓ Receipt being held up against any background (car interior, seat, counter, desk)
✓ Shadows from the hand holding the receipt
✓ Small receipt relative to overall frame size
✓ Document on a desk with visible desk surface around edges
✓ Car interior, steering wheel, or dashboard visible in background

═══ STEP 4: PAGE NUMBER DETECTION ═══
Look for page number indicators in headers or footers such as:
"Page 1 of 3", "Page 2", "1/3", "2 of 4", "pg. 1", or similar.

pageNumber: the current page number as an integer, or null if not found
totalPages: the total page count as an integer, or null if not found
pageNumberConfidence:
  "high"  = clearly printed "Page X of Y" or "X/Y" in a header or footer — you are certain
  "low"   = you found a number that might be a page number but you are not fully certain
  "none"  = no page number indicator detected anywhere on the document

QUALITY FAIL — only these specific problems:
✗ "too_blurry": Text is genuinely illegible — you cannot make out the totals or vendor name at all
✗ "too_dark": So underexposed that key financial data is completely unreadable
✗ "partial_capture": Critical data cut off — cannot see the total amount or vendor name

"Obstruction" only means an opaque object (pen, phone, piece of tape) physically ON TOP OF and hiding text fields. A hand HOLDING the document is NEVER an obstruction.

CRITICAL: Err very strongly toward passing quality. Only fail when a human accountant literally could not read the document to process it.

If quality fails, "message" should be a specific, helpful 1-sentence instruction for retaking.
If quality passes, "message" should be empty string "".`;

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
  "suggestion": "specific advice for retaking the photo"
}

Reason examples: "Image is too blurry — text is not legible", "Photo is too dark to read", "Invoice is cut off — key details are missing", "This doesn't appear to be an invoice"
Suggestion examples: "Hold your phone steady and tap to focus before shooting", "Move to a brighter area or turn on the flash", "Back up to capture the full page including all edges", "Please photograph the invoice document"

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
- vendorName = the company that issued the invoice (usually in the header/logo area).
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
          suggestion: parsed.suggestion || "Please retake the photo with better lighting and focus",
        };
      }

      // Feature #21: Vendor auto-detect via fuzzy matching
      let vendorMatch = null;
      if (parsed.vendorName) {
        try {
          const safeRead = async (id, tab) => {
            try { return await readSheet(token, id, tab); }
            catch { return { headers: [], rows: [] }; }
          };
          const vendorData = await safeRead(SHEET_IDS.HUB, "vendor_master");
          vendorMatch = fuzzyMatchVendor(parsed.vendorName, vendorData.rows);
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

For each page, check whether it belongs to the same invoice as the majority of pages. Look for mismatches in:
- Invoice number (most reliable signal)
- Vendor / company name
- Invoice date
- Document type (e.g. one page is clearly from a different vendor or a completely different document)

IMPORTANT: Be conservative. Only flag a page if you are reasonably confident it does not belong. "Page 2 of 3" text on continuation pages does NOT indicate a different invoice — those are the same invoice. Only flag genuine mismatches.

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
      contactName, contactEmail, contactPhone,
      paymentTerms, minOrder, existingVendorId,
    } = body;

    let vendorId = existingVendorId;

    if (!vendorId) {
      if (!vendorName?.trim()) return { success: false, error: "Vendor name is required" };
      const prefix = vendorName.trim().substring(0, 3).toUpperCase().replace(/[^A-Z]/g, "X");
      const suffix = String(Math.floor(Math.random() * 900) + 100);
      vendorId = `${prefix}-${suffix}`;

      const masterRow = [
        vendorId, vendorName.trim(), category || "", website || "", notes || "",
        email, new Date().toISOString(),
      ];

      const masterResult = await appendRow(token, SHEET_IDS.HUB, "vendor_master", masterRow);
      if (!masterResult.success) return { success: false, error: "Failed to create vendor: " + masterResult.error };
    }

    if (!account?.trim()) return { success: false, error: "Account is required" };

    const rowId = `${vendorId}_${account.split(" - ").slice(0, 2).join("-")}`;
    const accountRow = [
      rowId, vendorId, account,
      customerAccountNum || "", salesRepName || "", salesRepPhone || "", salesRepEmail || "",
      deliveryDays || "", cutoffTime || "", deliveryMethod || "",
      portalUrl || "", portalUsername || "", portalPassword || "",
      contactName || "", contactEmail || "", contactPhone || "",
      paymentTerms || "", minOrder || "", "TRUE",
      email, new Date().toISOString(),
      "",
      body.accountNotes || "",
    ];

    const accountResult = await appendRow(token, SHEET_IDS.HUB, "vendor_accounts", accountRow);

    if (accountResult.success && process.env.SLACK_VENDOR_WEBHOOK) {
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

    return { success: accountResult.success, vendorId, vendorName: body.vendorName || "", error: accountResult.error };
  }


  // ── Invoice Submit ──
  if (action === "invoice-submit") {
    const { account, vendor, vendorId, invoiceNumber, invoiceDate, totalAmount, glRows, pages, formType, ccSelf, apNote } = body;

    if (!account || !vendor || !invoiceDate || !totalAmount || !pages || pages.length === 0) {
      return { success: false, error: "Missing required fields" };
    }
    if (!glRows || glRows.length === 0) {
      return { success: false, error: "At least one GL code is required" };
    }

    const uuid = crypto.randomUUID();
    const now = new Date();
    const type = formType || "invoice";

    try {
      // 0. Enrich GL rows with human-readable descriptions
      const enrichedGlRows = glRows.filter((r) => r.code && Number(r.amount) > 0);
      try {
        const glTabName = getGLTabName(account);
        if (glTabName) {
          const glRaw = await readSheet(token, SHEET_IDS.GL_CODES, glTabName);
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

      // 2. Upload to Drive
      let driveUrls = [];
      try {
        if (pdfBuffer) {
          const pdfResult = await uploadStampedPDF(token, pdfBuffer, vendor, account, invoiceDate, invoiceNumber);
          if (pdfResult.fileUrl) driveUrls = [pdfResult.fileUrl];
        } else {
          const driveResults = await uploadInvoicePages(token, pages, vendor, account, invoiceDate);
          driveUrls = driveResults.filter((r) => r.fileUrl).map((r) => r.fileUrl);
        }
      } catch (driveErr) {
        console.error("[Invoice] Drive upload failed:", driveErr.message);
      }

      // 3. Log to sheet
      const row = [
        uuid, now.toISOString(), email, account, vendor,
        vendorId || "", invoiceNumber || "", invoiceDate,
        Number(totalAmount) || 0, JSON.stringify(glRows), JSON.stringify(driveUrls),
        pages.length, "FALSE", "pending", "", type,
      ];

      const sheetResult = await appendRow(token, SHEET_IDS.COLLECTION, "invoice_submissions_26", row);
      if (!sheetResult.success) return { success: false, error: "Failed to log submission: " + sheetResult.error };

      // 4. Send email to AP
      let emailSent = false;
      try {
        const emailResult = await sendInvoiceEmail(token, email, {
          account, vendor, vendorId, invoiceNumber, invoiceDate, totalAmount,
          glRows: enrichedGlRows, driveUrls, pageCount: pages.length, formType: type,
          ccSelf: ccSelf || false, pdfBase64: pdfBase64 || null,
          pdfFilename: pdfBuffer ? buildPdfFilename(vendor, invoiceDate, invoiceNumber) : null,
        }, pdfBase64 ? null : pages[0]);

        emailSent = emailResult.success;
        if (emailSent) {
          const rowNum = await findRowByValue(token, SHEET_IDS.COLLECTION, "invoice_submissions_26", 0, uuid);
          if (rowNum) await updateCell(token, SHEET_IDS.COLLECTION, `invoice_submissions_26!M${rowNum}`, "TRUE");
        }
      } catch (emailErr) {
        console.error("[Invoice] Email failed:", emailErr.message);
      }

      // 5. Fire async AI scan (non-blocking)
      triggerAIScan(token, email, uuid, pages, { account, vendor, invoiceNumber, invoiceDate, formType: type }).catch((err) => {
        console.error("[Invoice] AI scan trigger failed:", err.message);
      });

      if (process.env.SLACK_INVOICE_WEBHOOK) {
        const totalFmt = `$${Number(totalAmount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
        const glSummary = (glRows || []).filter(r => r.code && Number(r.amount) > 0).map(r => `${r.code}: $${Number(r.amount).toFixed(2)}`).join(", ");
        fetch(process.env.SLACK_INVOICE_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `Invoice submitted: ${vendor} ${totalFmt}`,
            blocks: [{
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Invoice Submitted*\n*Vendor:* ${vendor}\n*Account:* ${account}\n*Invoice #:* ${invoiceNumber || "N/A"}\n*Date:* ${invoiceDate}\n*Total:* ${totalFmt}\n*Type:* ${type}\n*GL:* ${glSummary || "N/A"}\n*Pages:* ${pages.length}\n*Submitted by:* ${email}`,
              },
            }],
          }),
        }).catch(() => {});
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

    const safeRead = async (id, tab) => {
      try { return await readSheet(token, id, tab); }
      catch { return { headers: [], rows: [] }; }
    };

    const { rows } = await safeRead(SHEET_IDS.COLLECTION, "invoice_submissions_26");
    const match = rows.find((r) => {
      const v = String(r[4] || "").trim();
      const inv = String(r[6] || "").trim();
      const d = String(r[7] || "").trim();
      const amt = Number(r[8]) || 0;
      return v === vendor && inv === invoiceNumber && d === invoiceDate && Math.abs(amt - Number(totalAmount)) < 0.01;
    });

    return {
      success: true,
      isDuplicate: !!match,
      existingInvoice: match
        ? { uuid: String(match[0] || ""), timestamp: String(match[1] || ""), userEmail: String(match[2] || "") }
        : null,
    };
  }

  return null;
}


// ═══════════════════════════════════════
// AI INVOICE SCANNER (Async, Non-Blocking)
// ═══════════════════════════════════════

async function triggerAIScan(token, userEmail, invoiceUuid, pages, metadata) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.warn("[AI Scan] No API key configured, skipping"); return; }

  try {
    const resizeForScan = (dataUrl) => {
      return dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
    };

    const imageBlocks = pages.slice(0, 3).map((page) => {
      const base64 = resizeForScan(page);
      const mediaType = page.startsWith("data:image/png") ? "image/png" : "image/jpeg";
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
- Return ONLY the JSON object, no markdown or explanation`;

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

      await appendRows(token, SHEET_IDS.AI_LINE_ITEMS, "Invoice Uploads", lineRows);
    }

    await updateScanStatus(token, invoiceUuid, "complete");
    console.log(`[AI Scan] ${invoiceUuid}: Extracted ${parsed.lineItems?.length || 0} line items`);

  } catch (error) {
    console.error("[AI Scan] Error:", error.message);
    await updateScanStatus(token, invoiceUuid, "failed");
  }
}

async function updateScanStatus(token, uuid, status) {
  try {
    const rowNum = await findRowByValue(token, SHEET_IDS.COLLECTION, "invoice_submissions_26", 0, uuid);
    if (rowNum) {
      await updateCell(token, SHEET_IDS.COLLECTION, `invoice_submissions_26!N${rowNum}`, status);
      if (status === "complete") {
        await updateCell(token, SHEET_IDS.COLLECTION, `invoice_submissions_26!O${rowNum}`, new Date().toISOString());
      }
    }
  } catch (e) {
    console.warn("[AI Scan] Status update failed:", e.message);
  }
}


// =============================================================================
// VENDOR PORTAL — API HANDLERS v2
// =============================================================================

const VENDOR_ADMIN_EMAILS = [
  "k.fietek@kitchfix.com",
  "a.wasserman@kitchfix.com",
  "britt@kitchfix.com",
  "joe@kitchfix.com",
  "josh@kitchfix.com",
  "m.chavez@kitchfix.com",
  "s.lynch@kitchfix.com",
];

// ── GET: vendor-list ──────────────────────────────────────────────────────────
export async function handleVendorList(searchParams, token, email) {
  const accountKey   = searchParams.get("accountKey");
  const category     = searchParams.get("category");
  const search       = (searchParams.get("search") || "").toLowerCase().trim();
  const page         = parseInt(searchParams.get("page") || "1", 10);
  const pageSize     = parseInt(searchParams.get("pageSize") || "10", 10);
  const showInactive = searchParams.get("active") === "false";
  const allAccounts  = searchParams.get("allAccounts") === "true";

  if (!accountKey && !allAccounts) return { success: false, error: "accountKey required" };

  const [masterResult, accountResult] = await Promise.all([
    readSheet(token, SHEET_IDS.HUB, "vendor_master"),
    readSheet(token, SHEET_IDS.HUB, "vendor_accounts"),
  ]);

  const linkMap = {};
  for (const r of accountResult.rows) {
    const vId = String(r[1] || "").trim();
    if (!vId) continue;
    if (!linkMap[vId]) linkMap[vId] = [];
    linkMap[vId].push({
      rowId:              String(r[0]  || "").trim(),
      accountKey:         String(r[2]  || "").trim(),
      customerAccountNum: String(r[3]  || "").trim(),
      salesRepName:       String(r[4]  || "").trim(),
      salesRepPhone:      String(r[5]  || "").trim(),
      salesRepEmail:      String(r[6]  || "").trim(),
      deliveryDays:       String(r[7]  || "").trim(),
      cutoffTime:         String(r[8]  || "").trim(),
      deliveryMethod:     String(r[9]  || "").trim(),
      portalUrl:          String(r[10] || "").trim(),
      portalUsername:     String(r[11] || "").trim(),
      portalPassword:     String(r[12] || "").trim(),
      contactName:        String(r[13] || "").trim(),
      contactEmail:       String(r[14] || "").trim(),
      contactPhone:       String(r[15] || "").trim(),
      paymentTerms:       String(r[16] || "").trim(),
      minOrder:           String(r[17] || "").trim(),
      active:             String(r[18] || "TRUE").trim().toUpperCase() !== "FALSE",
      createdBy:          String(r[19] || "").trim(),
      createdAt:          String(r[20] || "").trim(),
      accountNotes:       String(r[22] || "").trim(),
    });
  }

  let vendors = masterResult.rows
    .filter((r) => r[0])
    .map((r) => {
      const vendorId    = String(r[0]).trim();
      const links       = linkMap[vendorId] || [];
      const accountLink = accountKey ? links.find((l) => l.accountKey === accountKey) : null;
      return {
        vendorId,
        name:               String(r[1] || "").trim(),
        category:           String(r[2] || "").trim(),
        website:            String(r[3] || "").trim(),
        notes:              String(r[4] || "").trim(),
        createdBy:          String(r[5] || "").trim(),
        createdAt:          String(r[6] || "").trim(),
        customerAccountNum: accountLink?.customerAccountNum || "",
        salesRepName:       accountLink?.salesRepName       || "",
        salesRepPhone:      accountLink?.salesRepPhone      || "",
        salesRepEmail:      accountLink?.salesRepEmail      || "",
        deliveryDays:       accountLink?.deliveryDays       || "",
        cutoffTime:         accountLink?.cutoffTime         || "",
        deliveryMethod:     accountLink?.deliveryMethod     || "",
        portalUrl:          accountLink?.portalUrl          || "",
        portalUsername:     accountLink?.portalUsername     || "",
        portalPassword:     accountLink?.portalPassword     || "",
        contactName:        accountLink?.contactName        || "",
        contactEmail:       accountLink?.contactEmail       || "",
        contactPhone:       accountLink?.contactPhone       || "",
        paymentTerms:       accountLink?.paymentTerms       || "",
        minOrder:           accountLink?.minOrder           || "",
        accountNotes:       accountLink?.accountNotes       || "",
        active:             accountLink ? accountLink.active : true,
        linkedAccounts:     links.map((l) => l.accountKey),
      };
    });

  if (!allAccounts && accountKey) {
    vendors = vendors.filter((v) => (linkMap[v.vendorId] || []).some((l) => l.accountKey === accountKey));
  }

  vendors = vendors.filter((v) => showInactive ? !v.active : v.active !== false);
  if (category && category !== "All") vendors = vendors.filter((v) => v.category === category);
  if (search) vendors = vendors.filter((v) => v.name.toLowerCase().includes(search));

  const inactiveCount = accountKey
    ? masterResult.rows.filter((r) => {
        const vId  = String(r[0] || "").trim();
        const link = (linkMap[vId] || []).find((l) => l.accountKey === accountKey);
        return link && !link.active;
      }).length
    : 0;

  const total   = vendors.length;
  const start   = (page - 1) * pageSize;
  const paged   = vendors.slice(start, start + pageSize);
  const hasMore = start + pageSize < total;

  return { success: true, vendors: paged, total, inactiveCount, hasMore, page, pageSize };
}

// ── GET: vendor-get ───────────────────────────────────────────────────────────
export async function handleVendorGet(searchParams, token, email) {
  const vendorId   = searchParams.get("vendorId");
  const accountKey = searchParams.get("accountKey");
  if (!vendorId) return { success: false, error: "vendorId required" };

  const [masterResult, accountResult] = await Promise.all([
    readSheet(token, SHEET_IDS.HUB, "vendor_master"),
    readSheet(token, SHEET_IDS.HUB, "vendor_accounts"),
  ]);

  const masterRow = masterResult.rows.find((r) => String(r[0] || "").trim() === vendorId);
  if (!masterRow) return { success: false, error: "Vendor not found" };

  const allLinks    = accountResult.rows.filter((r) => String(r[1] || "").trim() === vendorId);
  const accountLink = accountKey ? allLinks.find((r) => String(r[2] || "").trim() === accountKey) : null;

  return {
    success: true,
    vendor: {
      vendorId:           String(masterRow[0] || "").trim(),
      name:               String(masterRow[1] || "").trim(),
      category:           String(masterRow[2] || "").trim(),
      website:            String(masterRow[3] || "").trim(),
      notes:              String(masterRow[4] || "").trim(),
      createdBy:          String(masterRow[5] || "").trim(),
      createdAt:          String(masterRow[6] || "").trim(),
      customerAccountNum: String(accountLink?.[3]  || "").trim(),
      salesRepName:       String(accountLink?.[4]  || "").trim(),
      salesRepPhone:      String(accountLink?.[5]  || "").trim(),
      salesRepEmail:      String(accountLink?.[6]  || "").trim(),
      deliveryDays:       String(accountLink?.[7]  || "").trim(),
      cutoffTime:         String(accountLink?.[8]  || "").trim(),
      deliveryMethod:     String(accountLink?.[9]  || "").trim(),
      portalUrl:          String(accountLink?.[10] || "").trim(),
      portalUsername:     String(accountLink?.[11] || "").trim(),
      portalPassword:     String(accountLink?.[12] || "").trim(),
      contactName:        String(accountLink?.[13] || "").trim(),
      contactEmail:       String(accountLink?.[14] || "").trim(),
      contactPhone:       String(accountLink?.[15] || "").trim(),
      paymentTerms:       String(accountLink?.[16] || "").trim(),
      minOrder:           String(accountLink?.[17] || "").trim(),
      accountNotes:       String(accountLink?.[22] || "").trim(),
      active:             String(accountLink?.[18] || "TRUE").trim().toUpperCase() !== "FALSE",
      linkedAccounts:     allLinks.map((r) => String(r[2] || "").trim()),
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
    contactName, contactEmail, contactPhone,
    paymentTerms, minOrder, accountNotes,
  } = body;

  if (!vendorId || !accountKey) return { success: false, error: "vendorId and accountKey required" };

  const { rows } = await readSheet(token, SHEET_IDS.HUB, "vendor_accounts");
  const rowIndex = rows.findIndex(
    (r) => String(r[1] || "").trim() === vendorId && String(r[2] || "").trim() === accountKey
  );
  if (rowIndex === -1) return { success: false, error: "Account link not found" };

  const sheetRow = rowIndex + 2;
  const existing = rows[rowIndex];
  const values = [[
    customerAccountNum ?? existing[3]  ?? "",
    salesRepName       ?? existing[4]  ?? "",
    salesRepPhone      ?? existing[5]  ?? "",
    salesRepEmail      ?? existing[6]  ?? "",
    deliveryDays       ?? existing[7]  ?? "",
    cutoffTime         ?? existing[8]  ?? "",
    deliveryMethod     ?? existing[9]  ?? "",
    portalUrl          ?? existing[10] ?? "",
    portalUsername     ?? existing[11] ?? "",
    portalPassword     ?? existing[12] ?? "",
    contactName        ?? existing[13] ?? "",
    contactEmail       ?? existing[14] ?? "",
    contactPhone       ?? existing[15] ?? "",
    paymentTerms       ?? existing[16] ?? "",
    minOrder           ?? existing[17] ?? "",
  ]];

  const cols = ["D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R"];
  await Promise.all([
    ...cols.map((col, i) => updateCell(token, SHEET_IDS.HUB, `vendor_accounts!${col}${sheetRow}`, values[0][i])),
    updateCell(token, SHEET_IDS.HUB, `vendor_accounts!W${sheetRow}`, accountNotes ?? existing[22] ?? ""),
  ]);

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
  const { vendorId, name, category, website, notes } = body;

  if (!vendorId) return { success: false, error: "vendorId required" };
  if (!name || !name.trim()) return { success: false, error: "Vendor name required" };

  const { rows } = await readSheet(token, SHEET_IDS.HUB, "vendor_master");
  const rowIndex = rows.findIndex((r) => String(r[0] || "").trim() === vendorId);
  if (rowIndex === -1) return { success: false, error: "Vendor not found" };

  const sheetRow = rowIndex + 2;
  const masterCols = ["B","C","D","E"];
  const values = [name.trim(), category || "", website?.trim() || "", notes?.trim() || ""];
  await Promise.all(masterCols.map((col, i) => updateCell(token, SHEET_IDS.HUB, `vendor_master!${col}${sheetRow}`, values[i])));

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
export async function handleVendorDeactivate(body, token, email) {
  const { vendorId, accountKey } = body;
  if (!vendorId || !accountKey) return { success: false, error: "vendorId and accountKey required" };
  return setVendorActive(vendorId, accountKey, false, token);
}

// ── POST: vendor-reactivate ───────────────────────────────────────────────────
export async function handleVendorReactivate(body, token, email) {
  const { vendorId, accountKey } = body;
  if (!vendorId || !accountKey) return { success: false, error: "vendorId and accountKey required" };
  return setVendorActive(vendorId, accountKey, true, token);
}

async function setVendorActive(vendorId, accountKey, active, token) {
  const { rows } = await readSheet(token, SHEET_IDS.HUB, "vendor_accounts");
  const rowIndex = rows.findIndex(
    (r) => String(r[1] || "").trim() === vendorId && String(r[2] || "").trim() === accountKey
  );
  if (rowIndex === -1) return { success: false, error: "Account link not found" };
  await updateCell(token, SHEET_IDS.HUB, `vendor_accounts!S${rowIndex + 2}`, active ? "TRUE" : "FALSE");

  if (process.env.SLACK_VENDOR_WEBHOOK) {
    const actionLabel = active ? "Reactivated" : "Deactivated";
    fetch(process.env.SLACK_VENDOR_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `Vendor ${actionLabel.toLowerCase()}: ${vendorId}`,
        blocks: [{ type: "section", text: { type: "mrkdwn", text: `*Vendor ${actionLabel}*\n*Vendor ID:* ${vendorId}\n*Account:* ${accountKey}` } }],
      }),
    }).catch(() => {});
  }

  return { success: true };
}

// ── Helper: update lastInvoiceDate after invoice submission ───────────────────
export async function updateVendorLastInvoiceDate(vendorId, isoTimestamp, token) {
  if (!vendorId) return;
  try {
    const { rows } = await readSheet(token, SHEET_IDS.HUB, "vendor_master");
    const rowIndex = rows.findIndex((r) => String(r[0] || "").trim() === vendorId);
    if (rowIndex === -1) return;
    await updateCell(token, SHEET_IDS.HUB, `vendor_master!H${rowIndex + 2}`, isoTimestamp);
  } catch (e) {
    console.warn("[updateVendorLastInvoiceDate] Non-fatal:", e.message);
  }
}

// ── POST: vendor-merge ────────────────────────────────────────────────────────
export async function handleVendorMerge(body, token, email) {
  const { keeperId, dupeIds } = body;
  if (!keeperId || !dupeIds?.length) return { success: false, error: "keeperId and dupeIds required" };

  const { rows: acctRows } = await readSheet(token, SHEET_IDS.HUB, "vendor_accounts");
  const acctUpdates = [];
  acctRows.forEach((row, i) => {
    if (i === 0) return;
    const rowVendorId = String(row[1] || "").trim();
    if (dupeIds.includes(rowVendorId)) {
      acctUpdates.push(updateCell(token, SHEET_IDS.HUB, `vendor_accounts!B${i + 2}`, keeperId));
    }
  });
  if (acctUpdates.length > 0) await Promise.all(acctUpdates);

  const { rows: masterRows } = await readSheet(token, SHEET_IDS.HUB, "vendor_master");
  const masterUpdates = [];
  masterRows.forEach((row, i) => {
    if (i === 0) return;
    const rowVendorId = String(row[0] || "").trim();
    if (dupeIds.includes(rowVendorId)) {
      masterUpdates.push(
        updateCell(token, SHEET_IDS.HUB, `vendor_master!B${i + 2}`, ""),
        updateCell(token, SHEET_IDS.HUB, `vendor_master!C${i + 2}`, ""),
        updateCell(token, SHEET_IDS.HUB, `vendor_master!D${i + 2}`, ""),
        updateCell(token, SHEET_IDS.HUB, `vendor_master!E${i + 2}`, "DELETED"),
      );
    }
  });
  if (masterUpdates.length > 0) await Promise.all(masterUpdates);

  return {
    success: true,
    keeperId,
    dupeIds,
    accountRowsReassigned: acctUpdates.length,
    vendorRowsDeleted: Math.floor(masterUpdates.length / 4),
  };
}