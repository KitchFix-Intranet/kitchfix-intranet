# Team Knowledge

This file is the canonical source for **team-facing knowledge** that KitchFix team members would want to ask about. It is the seed corpus for the future Sous AI intranet search feature (see `docs/SPEC_INTRANET_AI_SEARCH.md`).

This is **not** the place for:
- Technical/architectural docs (see `docs/ARCHITECTURE.md`)
- Migration-critical business rules (see `docs/BUSINESS_NOTES.md`)
- Hard-won debugging lessons (see `docs/GOTCHAS.md`)
- Coding conventions (see `docs/CONVENTIONS.md`)

This **is** the place for:
- "How do I do X?" answers a chef, regional, or admin would ask
- Company policies team members reference
- Definitions of KitchFix-specific terms
- Account-specific quirks people need to know
- What each tool in the intranet does and when to use it

## Entry template

Each entry uses this shape:

### Title (short, specific)
- **What:** The answer in 1-3 sentences.
- **Why it matters:** Why a team member would care. Context.
- **Where:** Source of truth - file path, tool, person to ask.
- **Last updated:** YYYY-MM-DD (and PR if relevant)
- **Related:** Cross-references to other docs/entries.

Keep entries terse. If something needs paragraphs, link out.

---

## How-to

Procedural guides. "How do I submit X?" "How do I add a vendor?"

*(empty - to be populated as audits and conversations surface team-facing procedures)*

---

## Policy

Company policies team members reference. Uniform, time-off, code of conduct, etc.

### Invoice and vendor data visibility model
- **What:** Invoice data (amounts, vendors, scanned PDFs) and vendor data (master records, account links) are NOT treated as confidential within KitchFix. Cross-account visibility is operationally intentional - chefs cross-reference invoices, regionals oversee multiple accounts, AP has full view. The "admin only" framing in the Invoice Tool and Vendor Portal UIs is a CONVENIENCE FILTER, not a security boundary.
- **Why it matters:** Future audits will look at these patterns and flag them as "bugs" by default security thinking. They are not. Document explicitly so future audits don't try to "fix" intentional design.
- **Where:** `src/lib/invoiceActions.js` - `handleInvoiceGet` (cross-account invoice reads), `handleVendorList` with `allAccounts=true` (cross-account vendor reads). Frontend convenience filters live in `InvoiceAdmin.js` and the Vendor admin views.
- **Last updated:** 2026-05-18 (Audit #4+#5)
- **Related:** [[business_notes_inventory_ap_fanout]] (same data-visibility-is-intentional pattern, different module)

### Vendor portal credentials and business continuity
- **What:** Vendor portal credentials (login URL, username, password) are stored in plaintext in `HUB.vendor_accounts` cols J/K/L (portal URL, username, password) and are available to ALL authenticated KitchFix users. This is intentional, not a security oversight.
- **Why it matters:** Business continuity. If a chef quits without notice, the incoming chef or any sous chef on that account must be able to access vendor portals immediately - no IT involvement, no password reset cycles, no business disruption. Encrypting or restricting access would block this recovery path.
- **Where:** `HUB.vendor_accounts` cols J/K/L. Returned in invoice-bootstrap response to all callers (filtered by account param if provided).
- **Last updated:** 2026-05-18 (Audit #4+#5)
- **Related:** [[business_notes_f25_race_window]] (different Sheets-era pattern, similar floor-first thinking)

### Three admin role scopes
- **What:** KitchFix has THREE distinct admin role lists, not one. Each represents a different scope of permissions:
  - **Ops Leadership** (`src/lib/admin.js` `OPS_LEADERSHIP_EMAILS`): backend gate for destructive ops actions (vendor deactivation, future chef-request approvals). Currently 6 people.
  - **Invoice Admin** (`InvoiceAdmin.js` `INVOICE_ADMIN_USERS`): frontend UI access to the Invoice Admin tab (reject, delete, dismiss-dupe actions). Currently 7 people.
  - **Labor Admin** (`LaborTool.js` `ADMIN_EMAILS`): frontend UI access to labor admin tools. Currently 8 people.
- **Why it matters:** The three lists OVERLAP significantly but are intentionally distinct. Consolidating them to a single list would break role separation. Examples of intentional differences: m.chavez is ops leadership + labor admin but NOT invoice admin. s.castro is invoice admin + labor admin but NOT ops leadership. Audits and refactors must verify SCOPE before treating these as duplicates.
- **Where:** `src/lib/admin.js`, `src/app/ops/components/invoice/InvoiceAdmin.js`, `src/app/ops/components/labor/LaborTool.js`
- **Last updated:** 2026-05-18 (Audit #4+#5)
- **Related:** [[team_knowledge_vendor_deactivate_stopgap]] (uses OPS_LEADERSHIP_EMAILS for backend gate)

---

## Glossary

Definitions of KitchFix-specific terms.

*(empty - to be populated)*

---

## Account-specific

Quirks specific to individual accounts (e.g. why TXR-V works differently, what's unique about CIN PDC).

*(empty - to be populated)*

---

## Tool reference

What each tool in the Ops Hub does, who uses it, and when.

### Vendor merge process
- **What:** When two `vendor_master` rows represent the same actual vendor (e.g. "ABC Foods" and "ABC Foods, Inc."), they can be merged. The keeper row is preserved; the dupe rows get blanked (name/category/website cleared) with notes set to "DELETED" - a soft delete. All `vendor_accounts` links pointing to dupe vendor_ids get reassigned to the keeper. Dupe names get appended to the keeper's aliases (pipe-separated). A Slack notification fires on every merge.
- **Why it matters:** Kevin is currently the only person with merge access (`handleVendorMerge` intentionally has no per-user gate today because Kevin is the sole gatekeeper). The Slack notification serves as the audit trail - no separate `vendor_audit_log` table is needed at current operational scale. Future-Kevin or future-admin doing a merge should know: the dupe rows are NOT hard-deleted, they remain in `vendor_master` with DELETED markers, and the merge is reversible via manual sheet edit if needed.
- **Where:** `src/lib/invoiceActions.js` - `handleVendorMerge`
- **Last updated:** 2026-05-18 (Audit #4+#5)
- **Related:** [[business_notes_vendor_alias_auto_learning]]

### Vendor deactivation - current state and planned follow-up
- **What:** As of Audit #4+#5 (sub-phase 4), the vendor-deactivate action requires Ops Leadership permission (`OPS_LEADERSHIP_EMAILS`). Non-admin chefs hitting the deactivate button receive: "Vendor deactivation requires admin approval. Contact Kevin to deactivate a vendor."
- **Why it matters:** This is a STOPGAP. The planned follow-up is a chef-request approval workflow: chef submits a deactivation request → notification to admin → admin reviews and approves/rejects → action fires on approval. The stopgap closes the "anyone can accidentally deactivate" gap until that workflow is built.
- **Where:** `src/lib/invoiceActions.js` - `handleVendorDeactivate` (admin check), `src/lib/admin.js` (allowlist)
- **Last updated:** 2026-05-18 (Audit #4+#5 sub-phase 4)
- **Related:** [[team_knowledge_three_admin_roles]], `docs/SUPABASE_MIGRATION.md` backlog item for the follow-up PR

### KitchFix common vendor list (Photo Gate)
- **What:** The `invoice-photo-gate` AI prompt at `invoiceActions.js` (in `handleInvoicePost`) lists known KitchFix vendors that the model uses as recognition cues. When a chef photographs an invoice, the photo-gate AI is more likely to correctly identify document type if it sees vendor names from this list.
- **Why it matters:** As KitchFix onboards new vendors, this list should be updated to maintain photo-gate accuracy. The list is currently embedded in the prompt text (not data-driven from `HUB.vendor_master`).
- **Where:** `src/lib/invoiceActions.js` - invoice-photo-gate prompt section
- **Last updated:** 2026-05-18 (Audit #4+#5 Phase 3)
- **Related:** Future improvement - data-drive this from `HUB.vendor_master` active rows

### GL code handwriting tolerance
- **What:** Operators (chefs, regionals) routinely write GL codes on physical invoices in marker. The `invoice-photo-gate` AI prompt explicitly tolerates handwriting as expected/normal, not an error condition. Photos with handwritten GL annotations should pass the photo-gate check.
- **Why it matters:** Future engineers tightening the photo-gate prompt for "clean documents only" would inadvertently break the normal KitchFix invoice-handling workflow. Handwriting is expected on physical invoices.
- **Where:** `src/lib/invoiceActions.js` - invoice-photo-gate prompt rules section
- **Last updated:** 2026-05-18 (Audit #4+#5 Phase 3)
- **Related:** [[team_knowledge_photo_gate_vendor_list]]

### Blank trailing pages handling
- **What:** When a chef prints a multi-page PDF from a browser (e.g. Cut+Dry, Sysco's portal), the print often includes a blank trailing page. The `invoice-photo-gate` AI prompt explicitly handles this: a blank trailing page is normal artifact, not "missing content" or an error. The `invoice-consistency-check` AI also tolerates this pattern.
- **Why it matters:** Future engineers cleaning up the prompts might inadvertently start blocking submissions that include blank trailing pages. This would break the print-from-portal workflow.
- **Where:** `src/lib/invoiceActions.js` - invoice-photo-gate and invoice-consistency-check prompt rules
- **Last updated:** 2026-05-18 (Audit #4+#5 Phase 3)
- **Related:** [[team_knowledge_gl_handwriting_tolerance]], [[team_knowledge_drive_filename_prefixes]]

### Drive filename prefixes
- **What:** Invoice PDFs uploaded to Drive use specific filename prefixes:
  - `FIXED_RESUBMITTED_<original_filename>` - applied to stamped PDFs of resubmission invoices (correction flow with `correctedFromUuid` set)
  - `RAW_<original_filename>` - applied to the raw unstamped archive copy of every invoice (preserved for audit)
- **Why it matters:** AP team members browsing Drive can identify resubmissions (`FIXED_RESUBMITTED_` prefix = "this is a correction, look for the original separately") and distinguish stamped vs raw copies. Stage 1 migration to a different document store should preserve this naming convention or replace it with explicit metadata columns.
- **Where:** `src/lib/invoiceActions.js` - invoice-submit Drive upload section (`uploadStampedPDF` and `uploadInvoicePages` calls)
- **Last updated:** 2026-05-18 (Audit #4+#5 Phase 3 F31)
- **Related:** [[business_notes_cut_dry_invoice_number_rule]]

### AI category taxonomy (Smart Inventory)
- **What:** The OCR pipeline extracts each invoice line item and assigns it to one of 10 categories: produce, dry_goods, protein, dairy, other, beverage, supplies, packaging, cleaning, smallwares. Current distribution across the ~3,800-row corpus: produce 32%, dry_goods 19%, protein 16%, dairy 9%, other 8%, beverage 6%, supplies 5%, packaging 4%, cleaning 2%, smallwares <1%.
- **Why it matters:** These categories drive any future Smart Inventory analytics and dashboards. Changes to the taxonomy ripple to every downstream view. The "other" bucket catches items the AI can't slot - if "other" grows past 10%, that's a signal the taxonomy needs an additional bucket rather than expanding "other".
- **Where:** OCR prompt in `src/lib/invoiceActions.js` (invoice-ocr action) defines the 10-category enum. Categorization happens at OCR time, written into the `AI_LINE_ITEMS` sheet.
- **Last updated:** 2026-05-18 (Audit #4+#5 sub-phase 7).
- **Related:** [[business_notes_ai_invoice_line_item_collection]]
