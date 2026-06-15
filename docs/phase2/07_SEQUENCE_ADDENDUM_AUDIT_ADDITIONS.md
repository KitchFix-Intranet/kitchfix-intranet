# OPD / SousAI Phase 2 - Sequence Addendum: Audit Additions

**What this is:** an amendment to the Phase 2 Master Charter §4 integrated sequence. It folds four audit additions into the existing pass/checkpoint structure. It does NOT change the current read-only run (Pass 0 -> 1 -> 2); that prompt stands as written. These additions apply downstream.
**Pair with:** the Master Charter (§3 method, §4 sequence, §5 conflicts register, §6 status mapping), the Audit Brief v2, the Intelligence & SousAI Brief v2.
**Convention:** hyphens only, no em-dashes.

---

## 1. The four additions, at a glance

| # | Addition | Lands at | Type | Gates | Open decision |
|---|---|---|---|---|---|
| 1 | Format-compliance consolidation | CK-3 reporting (current run output) | Reporting roll-up, not a new pass | nothing - it is a view | none |
| 2 | Duplicate / overlap sweep | Pass 4 (re-audit) | New library-level check | flags SSOT violations + Sous retrieval noise | D-1 (threshold) |
| 3 | Structure / chunking-readiness gate | Pass 5 (against converted Google Docs) | New go/no-go gate | blocks embed (Step 9) | none |
| 4 | Drive render-verification | CK-6 pre-flight | Upgraded from checkbox to per-doc gate | blocks promotion to Live (Step 8) | D-2 (authority) |

Backlog (not promoted unless Kevin says): **-ES bilingual parity check** - see §6.

---

## 2. Amended Charter §4 sequence

Additions marked **[ADD]**. Everything else is the Charter §4 sequence unchanged.

| Step | WS | What happens | Checkpoint |
|---|---|---|---|
| 0 | A | Pass 0 - deep knowledge build + dependency graph + Library Understanding | **CK-1** |
| 3 | A | Pass 1 + Pass 2 - the audit; scorecards + contradiction log + gap map. **[ADD] Format-compliance consolidation: roll the per-doc A4 findings into one table in the report.** | **CK-3** (Critical first) |
| 4 | A | Pass 3 - revision: reconcile conflicts + enrich with actuals | **CK-4** |
| 5 | A | Pass 4 - re-audit the revised library; confirm no new conflicts. **[ADD] Duplicate / overlap sweep over the revised set.** | **CK-5** |
| 6 | A | Pass 5 - finalize card_line / summary / keywords / relationships. **[ADD] Structure / chunking-readiness gate, run against the converted Google Docs (go/no-go per doc).** | yes - spot-check + chunking go/no-go |
| 1 | B | Drive: share parent folder with the service account; confirm cascade | yes - confirm render |
| 2 | B | Catalog hygiene: reconcile IDs, shelves, status mapping (§6) | **CK-2** |
| 7 | B | Pre-flight: which docs are Live-ready. **[ADD] Drive render-verification is now a per-doc gate here, not a checkbox: every Live-bound doc gets a real test-render, pass/fail, before promotion.** | **CK-6** |
| 8 | B | Bulk catalog write / promote to Live (subject to `chk_live_complete` + the render gate) | yes - confirm operator catalog renders |
| 9 | B | SousAI embed loop (only docs that passed the chunking go/no-go) | **CK-7** |
| 10 | B | Retrieval regression + no-answer-gap re-verification at scale | **CK-8** |
| 11 | A/B | Close or defer company-identity + intranet-knowledge corpus gaps | yes |

(Workstream B steps 1-2 run in parallel early per the Charter; ordered here by checkpoint flow for readability.)

---

## 3. Addition detail

### 3.1 Format-compliance consolidation (CK-3 reporting)

**Not a new pass.** The per-doc print/document-format audit (STD-001 compliance, class-correct format - condensed POL vs PB/SOP with TOC + version history, metadata-table integrity) already runs in the current pass as Scorecard A4, checked against the docx. The gap is only that those findings are scattered across ~60 scorecards.

**Add:** when CC reports the current run, it rolls the A4 findings into one **format-compliance table** (doc, class, STD-001 pass/issues/fail, the specific format break, metadata-integrity status) so the pattern is visible at a glance instead of hunted per doc.

**Gates:** nothing. It is a reporting view.

### 3.2 Duplicate / overlap sweep (Pass 4)

**Why Pass 4 and not now:** the contradiction hunt catches docs that *disagree*. It does not catch docs that *silently agree but should not both exist* - a policy authored twice under different IDs, or heavy topical overlap. That is a single-source-of-truth violation (a stated KitchFix convention) and retrieval noise for Sous (two docs answer the same query, one is staler). It is cheapest at Pass 4 because the dependency map is already built, and it should run over the *revised* library so it reflects the post-fix state.

**What CC produces:** an overlap map - clusters of docs covering the same ground, each flagged as (a) true near-duplicate (consolidate), (b) intentional point-don't-duplicate relationship (fine - the Handbook bundling pattern), or (c) genuine overlap to resolve. Each cluster cites doc IDs + sections. Critical where two docs both assert an authoritative answer to the same question.

**Gates:** feeds the Pass 4 sign-off (CK-5) - the revised set is not "coherent" if it carries unresolved duplicates.

**OPEN - D-1 (Kevin):** threshold. Flag near-duplicates only, or also two docs that cover the same topic from different angles? The second catches more and is noisier. **Pending Kevin's input after the Pass 0-2 report.**

### 3.3 Structure / chunking-readiness gate (Pass 5)

**The split:** a *preliminary* flag already runs in the current pass (Scorecard A5, read off the docx - catches the obvious "headings are just bold text" cases). The *authoritative* check is here at Pass 5, and it must run against the **converted Google Docs, not the docx**, because the docx -> Google Doc conversion is exactly where a real heading either survives as a `HEADING_1..6` style or collapses to bold. A doc whose headings did not survive chunks as one undifferentiated blob and retrieves badly - confidently, with a citation, off a bad chunk.

**Dependency:** requires the canonical Google Doc to exist (post-conversion / in Drive). So it sits after the Drive-sharing batch and at the metadata-finalize step, not earlier.

**What CC produces:** per multi-section doc, a **go/no-go**: real heading hierarchy present and chunk-clean (GO), or heading hierarchy missing/bold-only (NO-GO, with the fix - restyle the headings in the Google Doc).

**Gates:** **blocks embed (Step 9).** A NO-GO doc does not get embedded until its headings are real styles. This is the single most important technical-content interface point in the load (Charter item E).

### 3.4 Drive render-verification (CK-6)

**The failure it kills:** the blank-iframe silent failure - a doc is catalogued and flipped Live, but its Drive file is not shared with the service account or the link is wrong, so the operator opens it to a blank pane and nothing errors. The Charter names this as a top v1 risk but only as a sharing *action* (Step 1) plus batch render confirmations. This makes it a *per-doc gate*.

**Add:** at the pre-flight (CK-6), every Live-bound doc gets a real **test-render**, pass/fail, against the actual `source_drive_id` in the catalog iframe, before it is promoted. Failures are held out of the Live batch.

**Gates:** **blocks promotion to Live (Step 8)** for any doc that fails the render.

**OPEN - D-2 (Kevin):** authority. When a doc fails the render check, does CC hold it out of the Live batch automatically (faster), or surface it to Kevin for the call each time (keeps you in the loop on every promotion)? **Pending Kevin's input after the Pass 0-2 report.**

---

## 4. What gates on what (the dependency chain)

- Chunking go/no-go (3.3) -> blocks **embed** (Step 9).
- Drive render gate (3.4) -> blocks **promote-to-Live** (Step 8).
- Duplicate sweep (3.2) -> blocks **Pass 4 coherence sign-off** (CK-5).
- Format consolidation (3.1) -> blocks nothing; reporting only.

A doc that fails render never reaches embed (it is not Live). A doc that passes render but fails chunking is Live in the catalog but excluded from the corpus until its headings are fixed - it renders for operators, Sous just cannot retrieve it yet. That asymmetry is intentional and correct.

---

## 5. Guardrails (unchanged, restated for the new checks)

- Every finding cites **doc ID + section**, tagged CRITICAL / MAJOR / MINOR, Critical first.
- **Do not invent operational actuals** - name the gap, ask Kevin (Actuals Needed register).
- **Flag legal, do not rule.**
- Hyphens only in all CC output; do not strip em-dashes from the STD-001 print library.
- Do not flag intentional conventions as errors (Audit Brief §4) - point-don't-duplicate is a *feature*, so the duplicate sweep must distinguish it from accidental duplication.

---

## 6. Backlog - not promoted

**-ES bilingual parity check.** Does each `-ES` wall posting / handbook translation still match its current English source at the same version? A drifted translation is a posted document telling ESL floor staff something different from the English policy. It is a floor/compliance risk, not a Sous risk (Sous never queries `-ES`). Narrower than the four above. Sits here under POST-class handling unless Kevin promotes it.

---

## 7. Parked decisions (blocking before the relevant pass runs)

| ID | Decision | Blocks | Status |
|---|---|---|---|
| D-1 | Duplicate-sweep threshold: near-duplicates only, or also same-topic-different-angle | Pass 4 | Pending Kevin, after Pass 0-2 report |
| D-2 | Drive render gate authority: auto-hold failures, or surface each to Kevin | CK-6 | Pending Kevin, after Pass 0-2 report |
