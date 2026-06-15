# 04 - Update for the Content-Side Claude Chat (paste this in)

**Prepared:** 2026-06-12 by CC after verifying the Phase 2 package against the live repo + database.
**Use:** paste this into the content-side Claude chat so it knows what shifted between the Charter being written and right now. Short on purpose.
**Convention:** hyphens only, no em-dashes.

---

You are the content-side Claude continuing OPD/SousAI Phase 2. CC has finished the engineering verification of the Phase 2 package. Here is what CC found, in the order it matters.

---

## 1. The package is sound. Almost nothing in the Charter or briefs is wrong.

CC verified every code-side claim in the Charter §5 alignment register and §6 status mapping, every engineering claim in the two CC State Briefs, every schema claim in the v2 audit + intelligence briefs. **9 of 10 substantive claims confirm verbatim.** Detail is in `docs/phase2/01_CODE_VERIFICATION_REPORT.md`.

The status enum, `chk_live_complete` gate, 7 shelves, 10 doc classes, POSTER-prefix-maps-to-POST special case, chunker's HEADING-dependency, 0.28 cosine threshold, archive RPC atomicity, embed-script auto-skip, FK cascade - all match the briefs exactly. **You can build on the Charter without rechecking.**

---

## 2. One real drift in the character spec doc.

`docs/SOUSAI_CHARACTER_SPEC.md` §8 has SIX hard floor rules. The implementation's system prompt (`src/lib/sousai/generate.js` line 119) has SEVEN. The seventh rule is "TEMPLATE-AS-CANONICAL IS INVENTION" - the rule that produced the correct decline on the STD-001 brand-promise example.

**Implications for content work:**
- Audit Brief v2 §5 SousAI-readiness check (template-as-canonical risk) is correct and load-bearing.
- The spec doc is stale relative to the code. Fix is a one-paragraph append to §8. Doesn't change anything Phase 2 needs to do.
- Treat the implementation as the source of truth for behavior.

---

## 3. The live data state, as of 2026-06-12.

CC ran `scripts/_probe_phase2_recon.mjs` against production Supabase. Numbers:

- **42 documents** in the catalog (vs ~80 authored on the content side - gap is ~38).
- **8 Live** documents, all passing `chk_live_complete`, all with `source_drive_id`, all embedded.
- **190 chunks** in `document_chunks` across those 8 docs.
- **34 of 42 catalog rows lack `source_drive_id`.** The Drive-sharing batch (Charter step 1) is the operational blocker before more docs can pass the iframe test or be embedded.
- **31 of 42 have `version`**, **38 of 42 have `card_line`**, **41 of 42 have `summary`**. So most catalog rows are mostly-ready on the lifecycle fields - the gating gap is Drive.
- **Finance shelf has 0 rows. CHK class has 0 rows. POL class has 1 row.** Lots of authored content isn't catalog-rowed yet.

By status: Live 8, In Build 9, Draft 10, Pending 11, Placeholder 1, Blocked 0, Retired 3.

---

## 4. The decisions Kevin owes (these gate the next moves).

**CK-1 decision (Charter §5I):** does Phase 2 close the two corpus gaps?
1. Company-identity corpus (brand promise, history, pillars, Latin-cuisine identity, standard-bearer ethos). Without it, Sous correctly declines "what is our brand promise?" CC verified this is exactly the case today.
2. Intranet-knowledge docs (short descriptions of each page/tool/workflow).

**Recommendation in Charter §5I is to close the company-identity gap in Phase 2 and decide on intranet-knowledge.** Kevin needs to confirm at CK-1.

**CK-2 decision (Charter §6):** confirm the Documentation Tracker -> OPD enum status mapping table verbatim. The OPD enum CHECK constraint will reject "In review," "Queued," "Staged," "Not started," "Not Required" with error `23514`. The mapping must be settled before any catalog write.

**Additionally surfaced by CC verification:** the catalog-vs-content reconciliation (~38 docs to write or reconcile). This isn't a separate decision; it's the work CK-2 enables.

---

## 5. What is in scope vs not.

**In scope (per Charter §7, confirmed by CC):**
- Multi-pass content audit (Passes 0-5).
- Catalog hygiene + bulk write + Live promotion.
- Bulk embed + retrieval regression at 80 docs.
- The verifier-step DECISION.
- Closing or deferring the company-identity corpus.

**Not in scope - DO NOT scope-add to Phase 2:**
- Broad SousAI release (owner-only gate stays on, Preview badge stays, demo route stays).
- BUILDING the verifier step (decision in, build maybe next phase).
- Conversation memory.
- The strategic / moat / expansion analyses (Passes 10-11 of the Intelligence brief).
- Admin worklist filters or bulk-select actions.

---

## 6. The single thing that fails Phase 2 worst.

A confidently-wrong document that becomes a confidently-wrong SousAI answer. The hard floor catches the worst cases but the chunk you wrote will still rank.

The mitigation is the Charter's method: deep knowledge first, then apply more than once. Pass 0 before any change. Pass 4 re-audit after revisions. **Do not invent operational actuals** - flag the gap, ask Kevin, write what he supplies.

---

## 7. Pointers (where everything lives now).

In the repo at `/Users/kevinfietek/dev/kitchfix-opd/docs/phase2/`:
- `00_START_HERE_Project_Handoff.md` (your front door, unchanged).
- `OPD_Phase2_Master_Charter.md` (the plan, unchanged).
- `OPD_Library_Audit_Brief_v2.md`, `OPD_Intelligence_and_SousAI_Brief_v2.md`, `OPD_Per-Document_Scorecard_v2.md` (the method, unchanged).
- `01_CODE_VERIFICATION_REPORT.md` (CC's verification - read this for any code-side ground truth).
- `02_ENGINEERING_RUNBOOK.md` (the how, mapped to CK-1 through CK-8).
- `03_ENGINEERING_ORIENTATION.md` (short reading map for the next CC session).
- `04_CC_VERIFIED_UPDATE_FOR_CONTENT_CHAT.md` (this doc).

In the repo at `/Users/kevinfietek/dev/kitchfix-opd/scripts/`:
- `_probe_phase2_recon.mjs` (read-only, re-runnable, dumps current catalog state).

In the repo, canonical (not Phase 2 specific):
- `CLAUDE.md` (was rewritten 2026-06-12 - new Danger Zone entries, migrations-don't-auto-apply rule).
- `docs/SOUSAI_CHARACTER_SPEC.md` (character; note the §8 drift CC flagged above).

---

## 8. Your first move (content side).

Per Charter §7: do not start editing or loading anything. Start with **Pass 0**: read the entire library, build the dependency graph, write the Library Understanding artifact. Bring it to Kevin at CK-1 along with the company-identity-corpus decision and the status mapping confirmation.

Engineering side is not blocked. Once Kevin clears CK-1 and CK-2, the runbook takes over from §1 step 1.
