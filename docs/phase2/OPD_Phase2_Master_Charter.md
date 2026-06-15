# OPD / SousAI - Phase 2 Master Charter & Handoff

**Prepared:** 2026-06-12 by the OPD/HR/Operations content session, for handoff to the Phase 2 CC session
**Pair with:** the SousAI Complete State Brief and the OPD Complete State Brief (both authored by the CC engineering session), the Documentation Tracker, the Document Inventory, STD-001, and STD-002.
**Convention for this package:** hyphens only, no em-dashes, per the project operating principle.

---

## 0. How to use this package

You (the Phase 2 CC session) are inheriting a roughly 80-document operational library and two built systems that will consume it: the OPD catalog (`/playbook`) and SousAI (the retrieval assistant). Your job spans both halves of the work: **review and revise the content** until it is correct, robust, and coherent, and then **load it** into the catalog and the SousAI corpus so it goes Live for operators.

This package has six inputs. Read them in this order:

1. **This Charter** - the orchestration: what Phase 2 is, the method, the sequence, the decisions Kevin owes you, and the boundaries.
2. **OPD Complete State Brief** (CC) - the catalog: schema, lifecycle, the `chk_live_complete` gate, Drive integration, the load mechanics.
3. **SousAI Complete State Brief** (CC) - the assistant: the pipeline, the character hard floor, the chunker, the retrieval thresholds, the open questions.
4. **OPD Library Audit Brief v2** - the content review method (Workstreams A): per-doc and library-level.
5. **OPD Intelligence & SousAI Brief v2** - the deeper content/intelligence method (Workstream B), re-aimed at the system that already exists.
6. **OPD Per-Document Scorecard v2** - the per-document worksheet whose output is both the audit record and the catalog/SousAI row.

Plus the **Documentation Tracker** (the content-side catalog of all ~80 docs) and the **Document Inventory** (the visual group map).

---

## 1. Phase 2 in one paragraph, and the end-state

KitchFix authored roughly 80 operational documents quickly, in order to get a foundation down. That foundation is real and good, but it was built incrementally: some documents were written before deeper operational knowledge existed, some lack the "actuals" of how the company truly operates, and some conflict with documents written later. Phase 2 takes that foundation from "authored" to "trustworthy and live": a full-depth review, a knowledge-informed revision, and a clean load into the catalog and SousAI so that operators - and the company's AI - can rely on it.

**End-state definition (what "done" looks like):**

- Every document destined for Live has been **deeply reviewed**, **revised for accuracy / robustness / non-contradiction**, and **enriched with the operational actuals** it was missing.
- Each Live doc has a complete, correct **catalog row** in the OPD `documents` table: id, title, class, shelf, status, version, `card_line`, summary, keywords, owner, approver, `source_drive_id`, audience, classification, relationships.
- Each Live doc's Google Drive file is **shared with the service account** (Viewer) and **renders** in the catalog iframe.
- The full set is **embedded in the SousAI corpus** (chunks in `document_chunks`).
- The **retrieval regression suite is green**, the **no-answer gap is re-verified at ~80 docs**, and the **verifier-step decision has been made** if the gap compressed.
- The **company-identity and intranet-knowledge corpus gaps are closed or explicitly deferred** (see §5, item I).

This is the company's brain coming online. It does not ship half-formed.

---

## 2. The two interlocking workstreams

Phase 2 is two streams of work that must stay coordinated. Do not let either run ahead blindly.

**Workstream A - Content (the library itself).** Review, revise, enrich, and reconcile the documents. Governed by the Audit Brief v2, the Intelligence & SousAI Brief v2, and the Scorecard v2. This is mostly a reading/writing/judgment job. **You cannot do most of it without Kevin**, because the missing piece in many docs is operational reality that only KitchFix knows - you will flag where you need the "actuals," and Kevin supplies them.

**Workstream B - Technical (the catalog + corpus).** Create/reconcile catalog rows, batch Drive sharing, promote to Live, run the embed loop, verify retrieval, tune. Governed by the two CC briefs. This is mostly a code/data job with production touchpoints.

**The interlock:** Workstream A produces the **final, revised documents and their catalog/SousAI metadata**. Workstream B **consumes** that output. So the bulk of A precedes the bulk of B. But three parts of B can and should start early in parallel: (1) catalog-row hygiene (IDs, shelves, the status reconciliation in §6), (2) the Drive-sharing batch (share the parent folder with the service account once, early), and (3) the knowledge-graph build (it sharpens A). The embed loop and go-Live are the last steps, after content is final.

---

## 3. The method: deep knowledge first, then apply more than once

This is the heart of Phase 2, and it is Kevin's explicit direction. **Do not review document-by-document in isolation and fix as you go.** Documents in this library are interconnected; a fix to one can break a reference in another or create a new contradiction. And many documents are individually fine but wrong only *in relation* to a document written later. You cannot see that without the whole picture first.

Run the work in deliberate passes:

**Pass 0 - Build complete knowledge (no edits yet).** Read the entire library, both system briefs, the tracker, and STD-001/STD-002. Build the full interconnected mental model and the dependency graph (Audit Brief v2, Pass 3). Produce a written "Library Understanding" artifact: what exists, how it connects, what the load-bearing documents are, and where the system already looks thin or inconsistent. **Make no changes in this pass.** Understanding precedes surgery.

**Pass 1 - Document-level audit (with full-system context).** Now that you hold the whole picture, score every document (Scorecard v2). Because you have the full context, you catch the relational problems a linear review misses: the doc that contradicts a later one, the fact homed in two places, the reference to a retired doc.

**Pass 2 - Library-level audit.** The system checks: cross-reference integrity, the contradiction hunt, terminology consistency, coverage/gaps. This is where the "things that conflict" surface as a ranked list.

**Pass 3 - Revision (knowledge-informed, Kevin-directed).** Now revise. Two kinds of revision:
   - **Reconciliation:** fix the conflicts and broken references found in Pass 2.
   - **Enrichment with actuals:** make thin documents robust with how KitchFix really operates. **This is the one you cannot do alone.** Where a document needs operational reality you do not have, you do not invent it (that violates the SousAI hard floor in spirit and produces a confidently-wrong brain). You **flag it for Kevin with a specific question**, he supplies the actual, and you write it in. Maintain an "Actuals Needed" register.

**Pass 4 - Re-audit (apply the knowledge a second time).** This is the "more than once over." Revisions create new state. Re-run the cross-reference and contradiction checks against the *revised* library to confirm you did not introduce a new conflict, a new broken pointer, or a new single-source violation. A library is only coherent after the second pass, because the first pass changed it. Repeat narrowly on any cluster you touched heavily.

**Pass 5 - Finalize catalog + SousAI metadata.** For every Live-bound doc, finalize the `card_line`, summary, keywords, shelf, owner, approver, relationships, and confirm chunking-readiness (§5 item E). This is the bridge into Workstream B.

Only after the content is stable through Pass 4-5 does the technical load run.

---

## 4. The integrated Phase 2 sequence (with checkpoints)

Checkpoints are where Kevin looks before downstream work builds on the result. They are safety brakes; do not blow through them.

| Step | Workstream | What happens | Checkpoint? |
|---|---|---|---|
| 0 | A | Pass 0 - deep knowledge build + dependency graph + Library Understanding artifact | **CK-1: Kevin reviews the graph + the load-bearing list before any audit** |
| 1 | B (parallel) | Drive: share the parent folder with the service account once; confirm cascade | yes - confirm all files render |
| 2 | B (parallel) | Catalog hygiene: reconcile IDs, shelves, and the status mapping (§6); create/align rows | **CK-2: Kevin confirms ID + status mapping before any bulk write** |
| 3 | A | Pass 1 + Pass 2 - the audit; produce scorecards + the contradiction log + the gap map | **CK-3: Kevin reviews Critical findings first, in their own summary** |
| 4 | A | Pass 3 - revision: reconcile conflicts + enrich with actuals (Actuals Needed register) | **CK-4: Kevin directs every revision; supplies the actuals; nothing invented** |
| 5 | A | Pass 4 - re-audit the revised library; confirm no new conflicts | **CK-5: Kevin signs off that the revised set is coherent** |
| 6 | A | Pass 5 - finalize card_line / summary / keywords / relationships per doc | yes - spot-check a sample |
| 7 | B | Pre-flight: which docs are Live-ready (version + card_line + Drive + sharing)? Report gaps | **CK-6: Kevin reviews the Live-readiness pre-flight before promotion** |
| 8 | B | Bulk catalog write / promote to Live (subject to `chk_live_complete`) | yes - confirm operator catalog renders |
| 9 | B | Run the SousAI embed loop across the batch | **CK-7: Kevin reviews embed results (chunk counts, any failures)** |
| 10 | B | Retrieval regression suite + no-answer-gap re-verification at ~80 docs | **CK-8: the verifier-step decision is made here if the gap compressed** |
| 11 | A/B | Close or defer the company-identity + intranet-knowledge corpus gaps (§5 item I) | yes |

---

## 5. Alignment & conflicts register (read this carefully - this is the value-add)

These are the places where the content world and the technical world interlock or disagree. Several need a Kevin decision. Do not silently resolve them.

**A. Status vocabulary does not match between the two catalogs.** The content-side **Documentation Tracker** uses statuses (Live, In review, Queued, Staged, Not started, Draft, Pending, Retired, Not Required). The OPD `documents` table uses a *locked CHECK-constraint enum* (Placeholder, Pending, Draft, In Build, Blocked, Live, Retired). They do not map 1:1. A proposed mapping is in §6 - **Kevin must confirm it before any catalog write** (CK-2), because a wrong status either hides a doc from operators or exposes an unfinished one.

**B. The `chk_live_complete` gate means the audit must PRODUCE content, not just judge it.** A doc cannot go Live without both `version` and `card_line`. Most of the library has versions but **does not yet have a `card_line`** (the one-line operator description shown on the browse card). Writing a sharp, operator-grade `card_line` for every Live-bound doc is **content work and part of this audit** - it is in Scorecard v2. The same pass should draft the `summary` and `keywords`, which are SousAI's retrieval signal.

**C. The "template-as-canonical" trap is a content-audit responsibility.** SousAI's hard floor rule 7 says specimen/example content is not canonical, and the brand-promise example in STD-001 already caused a (correct) decline. The audit must **flag every place where example, template, specimen, or "fill-in" content could be retrieved and mistaken for real policy** - especially STD-001's callout examples and all TPL-class documents. Mark these clearly so the load and the chunker handle them as non-canonical. This protects Sous from confidently quoting a demonstration as a rule.

**D. Em-dashes: two surfaces, two rules - do not "fix" the library.** The operational document **library uses em-dashes** per STD-001 and Kevin's standing preference; that is correct and intentional for print/PDF docs. The **intranet, repo, commits, and Sous's answer voice use hyphens only**. These are different surfaces. **Do not strip em-dashes from the STD-001 library documents** thinking they violate the no-em-dash rule - that rule governs code and Sous's voice, not the printed playbook. (Sous paraphrases and cites; he does not reproduce a doc's em-dashes, so there is no leak.)

**E. Chunking quality depends on real heading hierarchy surviving the docx -> Google Doc conversion.** SousAI's chunker is structure-aware: it splits on Google Docs `HEADING_1..6` styles and builds the ancestry path that makes retrieval good. A doc with a clean heading hierarchy chunks beautifully; a doc without one falls back to a single size-based chunk (fine for a short form, bad for a manual). The library is authored in docx (STD-001 section structure). **When those docx files become the canonical Google Docs, the section structure must map to actual Google Docs heading styles, not just bold text.** Confirm this during Pass 5 for every multi-section doc, or the manuals will chunk as undifferentiated blobs and retrieval will degrade. This is the single most important technical-content interface point in the whole load.

**F. The content audit feeds the catalog directly.** The Scorecard v2 output for each doc *is* its catalog row plus its SousAI metadata plus its revision worklist. Treat the audit as the data-entry pass for the catalog, not a separate report. This is what keeps the two workstreams from drifting.

**G. The tracker and the OPD catalog must be reconciled, not duplicated.** The Documentation Tracker is the content-side source of truth today (owner, approver, status, notes per doc). The OPD `documents` table is the technical catalog. They overlap. Decide and state the canonical relationship: my recommendation is the **OPD catalog becomes canonical at go-Live**, the tracker remains the working/audit ledger through Phase 2, and the two are reconciled at CK-6. Do not let them silently diverge.

**H. "In review" docs are not Live docs.** The 55 docs currently "In review" on the content side are authored but not approved, and several are gated on an SME (Britt for culinary/SOP-009, Sebastian for PB-009 finance, counsel for the legal-sensitive POLs, HR for PB-013/SOP-005) or carry intentional placeholders. In OPD terms they are **In Build** (default) or **Blocked** (if SME/counsel-gated), **not Live**. They appear in the admin worklist, not the operator catalog, until the audit + revision + approval flips them. This aligns cleanly: the audit happens while docs are In Build, then they go Live.

**I. Two corpus gaps that SousAI itself flagged - decide whether Phase 2 closes them.** SousAI's character spec and brief flag two unauthored content sets that change what Sous can answer:
   - **Company-identity corpus** (brand promise, history, pillars, Latin-cuisine identity, standard-bearer ethos). Without it, Sous correctly declines "what is our brand promise?" These are *content* deliverables - exactly this session's domain. Recommend authoring them in Phase 2 (or explicitly deferring), because the brand promise is foundational and its absence is visible to every user on day one.
   - **Intranet-knowledge docs** (short descriptions of each page/tool/workflow) so Sous can answer "how do I link a Drive file in the admin dashboard." Recommend a lightweight set, or defer with eyes open.
   Flag both for a Kevin decision at CK-1; do not let them fall through the gap between "library" and "system."

**J. The open compliance threads ride along.** The audit must respect the known open threads: E-Verify / Arizona (POL-012 on hold; SOP-005's work-auth step flagged open), the People-Operations-to-Human-Resources naming sweep (pending), the handbook reconciliation, and the Tier-3 orphans. None of these block the load mechanically, but a doc that asserts a wrong answer on one of them is a Critical finding because it becomes a wrong SousAI answer.

---

## 6. Proposed status mapping (Documentation Tracker -> OPD enum) - confirm at CK-2

| Tracker status | Proposed OPD status | Operator-visible? | Notes |
|---|---|---|---|
| Live | **Live** | Yes | The 8 already embedded; plus any that pass audit + approval |
| In review | **In Build** | No | Authored, in the audit/publish pipeline (default) |
| In review (SME/counsel-gated) | **Blocked** | No | PB-009 (Sebastian), SOP-009 (Britt), legal POLs (counsel), PB-013/SOP-005 (HR) |
| Queued | **Pending** | No | Authoring teed up, not started |
| Staged (Aug / Leadership Dugout) | **Pending** | No | Deliberately deferred; note the August timing |
| Not started | **Placeholder** | No | Catalog row only, no content (e.g. PB-011) |
| Draft | **Draft** | No | Authoring active |
| Pending | **Pending** | No | Direct match |
| Not Required | **Retired** | No | e.g. POL-005, absorbed into AGR-001 |
| Retired | **Retired** | No | The 13 retired; keep supersede pointers |

The OPD enum has **no "In review," "Queued," "Staged," "Not started," or "Not Required"** - that is why the mapping is needed. Confirm before writing.

---

## 7. Scope boundaries (be honest about what is in this phase)

**Must do as part of Phase 2 (the load):**
- The full multi-pass content audit and revision (Passes 0-5).
- The catalog hygiene, status reconciliation, Drive sharing, and bulk load.
- Promote audited/approved docs to Live; embed them; verify retrieval.
- Re-verify the no-answer gap at ~80 docs and make the verifier-step decision.
- Close or explicitly defer the company-identity corpus gap (it is foundational content).

**Nice to have, fold in if cheap (but flag before adding - no silent scope):**
- A bulk-import path (CSV/JSON) if per-doc catalog entry proves too slow at 80.
- A Live-readiness pre-flight report tool (which docs are missing what).
- Populating `document_relationships` densely during the load (it helps SousAI retrieval).
- The intranet-knowledge corpus (lightweight).

**Real next phase, not this one:**
- Productionizing SousAI broadly: relaxing the owner-only gate to all authenticated users, promoting the demo surface off `/playbook/sous-demo`, dropping the Preview badge, role-based answer shaping at scale.
- Building the verifier step *as a feature* (deciding it is needed is in scope; building it may spill).
- Conversation memory for Sous.
- The Workstream B "at scale" admin niceties (status/class/shelf filters, bulk-select actions).
- The strategic/moat and expansion-readiness analyses (high value, not load-blocking).

---

## 8. Risks to v1 production

The corpus load is additive and the embed loop is idempotent, so the core load is non-destructive. The real risks:

- **Going Live with wrong or unshared Drive links** -> blank iframe for operators (a silent failure). Mitigation: the Drive-sharing batch and the test-render verification *before* go-Live (step 1, step 7).
- **Going Live without `version` + `card_line`** -> `chk_live_complete` rejects it. Mitigation: the Live-readiness pre-flight (step 7) and producing the card_line in the audit (item B).
- **A revision introducing a new contradiction** -> a confidently-wrong SousAI answer. Mitigation: Pass 4 re-audit (the "apply more than once").
- **A doc that chunks badly** (no heading hierarchy) -> degraded retrieval. Mitigation: item E, checked at Pass 5.
- **The no-answer gap compressing at 80 docs** -> Sous answers from weak retrievals. Mitigation: the regression + the verifier-step decision (step 10).
- **Touching CLAUDE.md Danger Zone files** (`sheets.js`, `auth.js`, `middleware.js`, `vercel.json`, `next.config.mjs`, `package.json`, `.env*`) without approval. Mitigation: don't, without explicit Kevin sign-off. Branch-and-PR for everything; direct push to main is blocked.

---

## 9. Operating principles to honor (Kevin's working agreement)

These come straight from both CC briefs and apply to every session, including this one:

- **No silent scope additions.** Flag additions before folding them in; surface and wait.
- **Verify, don't assume.** Memory and brief notes are point-in-time. Check current code/state before relying on a file path, function name, or row count.
- **No em-dashes** in code, comments, commits, PRs, repo docs, and Sous's voice (the STD-001 print library is the documented exception - see item D).
- **Surgical over sweeping.** A 4-line fix that solves the real thing beats a 400-line refactor.
- **Branch-and-PR for everything.** Direct push to main is blocked; the Playwright check tests production health, not PR code.
- **Floor-first design.** Anything UI must work for a chef on a phone in a cold cooler with wet hands; mobile is Comfortable density automatically.
- **CLAUDE.md is canonical** for project ground rules; Danger Zone files need explicit approval.
- **The runbook is code.** Infra changes update `docs/RUNBOOK.md` + `docs/ENV_VARS.md` in the same commit.

---

## 10. What the next session is handed

- This Charter and the three updated content documents (Audit Brief v2, Intelligence & SousAI Brief v2, Scorecard v2).
- The two CC State Briefs (OPD, SousAI).
- The **document folder** (~80 docs in current state) on Kevin's machine.
- The **Documentation Tracker** (content-side catalog) and the **Document Inventory** (group map).
- STD-001 and STD-002 (the print standards - audit against, do not use as web UI references).
- In the repo: CLAUDE.md, `docs/SOUSAI_CHARACTER_SPEC.md`, `docs/HANDOFF_SOUSAI_DEMO.md`, `docs/DESIGN_SYSTEM_REFERENCE.md`, the migration files.

---

## 11. The first move

When you pick this up: **do not start editing or loading.** Start with Pass 0 - read everything, build the dependency graph, and produce the Library Understanding artifact. Bring it to Kevin at CK-1 along with the company-identity-corpus decision (item I) and the status mapping (item A / §6). Everything downstream builds on getting that picture right first. That is the whole point of "deep knowledge first, then apply more than once."
