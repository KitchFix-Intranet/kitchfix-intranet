# 05 - Doc Set 1 Chunking-Readiness Report

**Prepared:** 2026-06-12 by CC after scanning `/Users/kevinfietek/Documents/OPD v2.0.SB/Doc Set 1`.
**Probe:** `scripts/_probe_docx_chunking_readiness.mjs` (read-only, re-runnable).
**Pairs with:** Charter §5E (heading-style dependency), [`01_CODE_VERIFICATION_REPORT.md`](./01_CODE_VERIFICATION_REPORT.md) §3 (chunker behavior).
**Convention:** hyphens only, no em-dashes.

> **TL;DR.** Of 55 `.docx` files in Doc Set 1, **43 lack Word "Heading 1/2/3" styles entirely**. Those 43 will chunk as a single undifferentiated blob each when uploaded to Google Docs - the SousAI chunker will silently fall back to size-based mode and retrieval quality collapses for those docs. **This is Charter §5E playing out in real numbers.** The 8 currently-Live docs are well-structured, which is why retrieval works today; the next ~43 are not. Heading-style restyling at the Word source must happen before upload. This is a content-side fix; engineering cannot patch around it.

---

## 1. The scope

| Verdict | Count | What it means |
|---|---|---|
| **GOOD** | 8 | Real `Heading 1`/`2`/`3` styles used. Will chunk as multiple structured chunks with ancestry paths. Retrieval will be sharp. |
| **THIN** | 4 | `Title` style only, no heading levels. Likely intentional for short single-section docs (the JD TEMPLATEs). Will fall back gracefully. |
| **FLAT-RISK** | 43 | Zero heading styles, many bold runs. The chunker treats this as one unstructured section. Result: one chunk per doc, no section ancestry, contextual header points only at the doc title. Retrieval becomes "find the right document" with no within-document precision. |

For comparison, the 8 currently-Live docs (all GOOD): `PB-002`, `PB-003`, `SOP-002`, `STD-001` (both versions), `AGR-001`, plus 2 not-yet-Live GOODs (`PB-001`, `POL-003`).

The pattern is clear: the well-structured docs are the ones currently working. The next round of promotions cannot land on the unstructured docs as-is.

---

## 2. Why this matters (in operator terms)

The Allergen Playbook (`PB-002`) today chunks into 31 distinct sections (`6 H1 + 19 H2 + 6 H3`). When a chef asks "what do I do if someone has an allergic reaction?" the retrieval hits the specific section "If Someone Has a Reaction > 6.1 The Six Steps > Step 4" with high similarity. Sous answers from that chunk and cites it.

If `SOP-008` (Food Safety Management) gets uploaded as-is - 144 bold runs, 0 heading styles - the entire document becomes one chunk. When a chef asks "what's the cooling-step time limit for soup?" the retrieval might hit a chunk that contains both the answer AND 15 unrelated paragraphs. Similarity drops. Top-K may not surface it. If it does surface, the cited "section" is just the doc title - no ancestry to ground the operator.

Multiply that across 43 docs and the no-answer gap at 80 docs (already SousAI's flagged risk per Charter §5E + brief Pass 9) compresses fast.

---

## 3. The detail (full verdict table)

```
    Verdict       H1  H2  H3  Title  Bold   Paras  File
    -----------   --  --  --  -----  ----   -----  ----
    GOOD           6  19   6      0   107    181   Allergen_Playbook_PB-002_v1_0.docx
    GOOD          14  43   8      0   647    657   Documentation_Format_Standard_STD-001_v1.0.docx
    GOOD          14  43   8      0   657    673   Documentation_Format_Standard_STD-001_v1_1.docx
    GOOD           9  39  89      0   312    976   Leadership_OS_Handbook_PB-001_v9_1_not_final.docx
    GOOD          11  14   0      0    82    258   POL-003_Drug_Alcohol_Policy_v1_1.docx
    GOOD          10  25   0      0   129    363   Safety_and_Incident_Management_SOP-002_v2_1.docx
    GOOD           5  16   0      0    86    134   Service_Recovery_Playbook_PB-003_v1_1.docx
    GOOD           9  25   0      0   107    186   The_Big_Rules_AGR-001_v1_0.docx

    THIN           0   0   0      2    61     97   JD TEMPLATE - Café Attendant.docx
    THIN           0   0   0      2    64     97   JD TEMPLATE - Cook.docx
    THIN           0   0   0      2    61     94   JD TEMPLATE - Culinary Delivery Driver.docx
    THIN           0   0   0      2    63     97   JD TEMPLATE - Dishwasher.docx

    FLAT-RISK      0   0   0      0    35     99   AGR-002_Laptop_Acceptance_Agreement_v1.0.docx
    FLAT-RISK      0   0   0      0    94    352   CHK-003_Health_Inspection_Readiness_v1_0.docx
    FLAT-RISK      0   0   0      0    22     58   FORM-003_Coaching_Verbal_Warning_Record_v1.0.docx
    FLAT-RISK      0   0   0      0    33    107   FORM-004_Written_Warning_v1.0.docx
    FLAT-RISK      0   0   0      0    31    113   FORM-005_Performance_Improvement_Plan_v1.0.docx
    FLAT-RISK      0   0   0      0    37    117   FORM-006_Separation_Record_v1.0.docx
    FLAT-RISK      0   0   0      0    50     99   FORM-007_Pay_Increase_Recommendation_v1_0.docx
    FLAT-RISK      0   0   0      0    25     59   FORM-008_Health_Reporting_Agreement_v1_0.docx
    FLAT-RISK      0   0   0      0    41    129   FORM-009_Knife_Skills_Verification_v1_0.docx
    FLAT-RISK      0   0   0      0    92    311   PB-004_Hourly_Employee_Handbook_v1.2.docx
    FLAT-RISK      0   0   0      0   100    210   PB-007_Workplace_Safety_Manual_v1_0.docx
    FLAT-RISK      0   0   0      0    69    147   PB-008_Emergency_Prep_Continuity_v1_0.docx
    FLAT-RISK      0   0   0      0    98    147   PB-009_Financial_Operations_Manual_v1_0.docx
    FLAT-RISK      0   0   0      0   148    281   PB-010_Site_Operations_Manual_v1_0 (1).docx
    FLAT-RISK      0   0   0      0   121    215   PB-010_Site_Operations_Manual_v1_0.docx
    FLAT-RISK      0   0   0      0   102    162   PB-012_Client_Account_Management_Playbook_v1_0.docx
    FLAT-RISK      0   0   0      0    83    149   PB-013_Training_Certification_Program_v1_0.docx
    FLAT-RISK      0   0   0      0    63    166   POL-001_Employee_Concerns_Policy_v1.0.docx
    FLAT-RISK      0   0   0      0    88    281   POL-002_Appearance_Dress_Code_Policy_v1.3.docx
    FLAT-RISK      0   0   0      0   101    153   POL-004_Attendance_Punctuality_Policy_v1_0.docx
    FLAT-RISK      0   0   0      0    66    131   POL-006-ES_Politica_contra_el_Acoso_v1_0.docx
    FLAT-RISK      0   0   0      0    65    129   POL-006_Anti-Harassment_Policy_v1_0.docx
    FLAT-RISK      0   0   0      0    76    168   POL-007_Compensation_Pay_Increase_Policy_v1_1.docx
    FLAT-RISK      0   0   0      0    31     78   POL-008_Wage_Hour_Policy_v1_0.docx
    FLAT-RISK      0   0   0      0    30     82   POL-009_IT_Acceptable_Use_v1_0.docx
    FLAT-RISK      0   0   0      0    35     84   POL-010_EEO_Non-Discrimination_Accommodation_v1_0.docx
    FLAT-RISK      0   0   0      0    29     83   POL-011_Anti-Retaliation_Whistleblower_v1_0.docx
    FLAT-RISK      0   0   0      0    35     78   POL-013_Employee_Classification_Seasonal_v1_0.docx
    FLAT-RISK      0   0   0      0    35     93   POL-014_Code_of_Conduct_Ethics_v1_0.docx
    FLAT-RISK      0   0   0      0    54    111   POL-015_Leave_Policies_v1_0.docx
    FLAT-RISK      0   0   0      0    37     83   POL-019_Permit_License_Compliance_Policy_v1_0.docx
    FLAT-RISK      0   0   0      0    25     66   REF-003_Disciplinary_Process_Manager_Quick_Reference_v1.0.docx
    FLAT-RISK      0   0   0      0    84    216   REF-006_Hourly_Pay_Bands_v1_1.docx
    FLAT-RISK      0   0   0      0    55    105   REF-007_Leadership_Pay_Bands_v1_0.docx
    FLAT-RISK      0   0   0      0    28     52   Refusal_of_Medical_Treatment_FORM-001_v1_0.docx
    FLAT-RISK      0   0   0      0    66    238   SOP-004_Formal_Disciplinary_Process_v1.0.docx
    FLAT-RISK      0   0   0      0    68    126   SOP-005_Onboarding_Process_SOP_v1_0.docx
    FLAT-RISK      0   0   0      0   144    285   SOP-008_Food_Safety_Management_v1_0.docx
    FLAT-RISK      0   0   0      0    37     96   SOP-010_Driver_Fleet_Safety_v1_0.docx
    FLAT-RISK      0   0   0      0    52    121   SOP-012_Pest_Control_IPM_v1_0.docx
    FLAT-RISK      0   0   0      0    37     98   SOP-014_Product_Recall_Mock_Recall_v1_0.docx
    FLAT-RISK      0   0   0      0    35     91   SOP-015_Emergency_Food_Safety_v1_0.docx
    FLAT-RISK      0   0   0      0    47    160   TPL-019_Master_Cleaning_Schedule_v1_0.docx
```

The PDF files (POSTER-001 EN+ES, POST-002 Allergen Awareness EN+ES, POST-003 Kitchen Safety) are not in the table because POST/POSTER class takes the stub path in the embed pipeline - no extraction or chunking is attempted. They're fine.

---

## 4. File-level issues to flag separately

These are catch-and-fix-before-upload items independent of heading styles:

**Duplicate of PB-010.** Two `PB-010_Site_Operations_Manual_v1_0` files exist in the same folder, one with a `(1)` suffix. Confirm which is canonical and delete the other before upload, or the catalog row will be ambiguous.

**Two STD-001 versions.** `Documentation_Format_Standard_STD-001_v1.0.docx` and `Documentation_Format_Standard_STD-001_v1_1.docx` both present. Different versions (v1.0 and v1.1). Pick the canonical one for upload; if both are intentional, the catalog row's `version` field gets the newer one and the older becomes either Retired or archive-only.

**JD TEMPLATE files have no doc ID in the filename.** `JD TEMPLATE - Café Attendant.docx`, `JD TEMPLATE - Cook.docx`, `JD TEMPLATE - Culinary Delivery Driver.docx`, `JD TEMPLATE - Dishwasher.docx`. These need TPL-class IDs assigned (e.g. `TPL-NNN`) before they can land in the catalog. The probe flagged them as THIN because they use the Title style only - that's fine for short JDs but they'll be one chunk each.

**Spanish doc.** `POL-006-ES_Politica_contra_el_Acoso_v1_0.docx` is the Spanish-translation companion to POL-006. Per the Audit Brief v2 §4 conventions, `-ES` docs are wall postings / handbook translations and are never queried through Sous. Recommend NOT loading this into the SousAI corpus; load only POL-006 in English. Audit Brief explicit on this.

---

## 5. What is and is not in scope to fix

**In scope (content side, before upload):** restyle the 43 FLAT-RISK docs to use real Word heading styles. The mechanical move per doc:
1. Open the docx.
2. Identify what is currently bold-text-acting-as-a-heading.
3. Apply `Heading 1` / `Heading 2` / `Heading 3` style to those paragraphs from the Styles pane.
4. Confirm visually that the document outline (View > Navigation Pane > Document Map) shows the structure.
5. Save.

Time estimate: 5-15 minutes per doc depending on length. Total: ~5-10 hours of focused work for all 43, but the value is permanent.

**Not in scope to engineering side-step:** we cannot get good chunking out of unstyled docs by tweaking the chunker. The Google Docs API does not invent heading-style information that isn't there. Bold text is bold text. The chunker comment in `chunk.js` is explicit: "if the Docs API didn't say HEADING_n, it isn't."

**Engineering will not do this for the content team.** Restyling is a content-authoring action, not a code action. Engineering can verify (this probe) and re-verify post-fix, but the per-doc styling pass is the content team's responsibility.

---

## 6. Suggested fix order (priority)

Restyle in this order, longest-and-most-Sous-queried first:

**Tier 1 (do first - long, central, will be queried hard):**
- `SOP-008_Food_Safety_Management_v1_0.docx` - 285 paragraphs, food-safety is hard-floor territory
- `PB-004_Hourly_Employee_Handbook_v1.2.docx` - 311 paragraphs, employee-handbook is high-query
- `PB-010_Site_Operations_Manual_v1_0.docx` - 215 paragraphs, operations manual
- `PB-007_Workplace_Safety_Manual_v1_0.docx` - 210 paragraphs, safety manual
- `CHK-003_Health_Inspection_Readiness_v1_0.docx` - 352 paragraphs (longest), checklist territory

**Tier 2 (after Tier 1, before bulk promotion):**
- All POL docs (the policy clarifications operators ask about most)
- All SOP docs (operational procedure docs)
- `REF-006_Hourly_Pay_Bands_v1_1.docx` and `REF-007_Leadership_Pay_Bands_v1_0.docx` (referenced often)

**Tier 3 (FORM docs - lower priority):**
- FORM docs are usually short and operationally have a "fill this out" purpose. They can ship FLAT-OK if they're short enough. The probe flagged them FLAT-RISK because they have bold runs > 5; if the doc is genuinely a one-page form with bold labels, leave it. Spot-check before deciding.

**Tier 4 (do not change):**
- The 8 GOOD docs (already structured correctly).
- The 4 THIN JD TEMPLATEs (Title-only is fine for one-page JDs; they get one chunk that has the doc title in the header and that's the right granularity for "is X a cook duty?").

---

## 7. Re-verification after restyle

Re-run the probe at any time:

```bash
node scripts/_probe_docx_chunking_readiness.mjs "/Users/kevinfietek/Documents/OPD v2.0.SB"
```

After the Word-side fix is done and the docs are uploaded to Google Drive, a second sanity check is the Google Docs API extract:

```bash
node --env-file=.env.local scripts/sousai-extract-and-chunk.mjs <docId>
```

Look at the output:
- `path: structure-aware` -> heading styles survived the upload, chunker is in the right mode
- `path: size-based-fallback` -> heading styles did NOT survive, either the Word restyle was incomplete or Google Docs flattened them on upload (unlikely but check)

---

## 8. What this changes about the runbook

This finding adds a step **between Charter step 1 (Drive sharing) and step 7 (Live-readiness pre-flight)**:

> **Step 1a (new) - Heading-style restyle pass on FLAT-RISK docs.** The 43 FLAT-RISK files in Doc Set 1 (plus any more in future Doc Sets) need real Word heading styles applied before upload to Drive. This is a content-side mechanical pass; engineering verifies via the probe pre-upload and via `sousai-extract-and-chunk.mjs` post-upload. Without this step, the bulk embed in step 9 produces one-blob-per-doc and the retrieval regression at step 10 will fail or compress hard.

The runbook (`02_ENGINEERING_RUNBOOK.md`) treats chunking-readiness as a CK-6 spot-check. This finding upgrades it to a pre-CK-1 hard prerequisite at full Doc-Set scope.

---

## 9. Conclusion

The Charter named this risk. The probe puts numbers on it: **78% of Doc Set 1 docx files (43 of 55) need heading-style restyling before they can be useful to SousAI.** The good news is that the fix is mechanical, has no engineering dependency, and the well-structured Live docs prove the design holds when the source is right. The not-good news is that this is content-team work that has to land before any meaningful Phase 2 catalog growth happens.

Engineering posture from here: the runbook is unchanged for the GOOD and THIN docs. For the FLAT-RISK docs, **the load is gated on the restyle**. Recommend Kevin batch this in tiers and have the content side re-run the probe per tier.
