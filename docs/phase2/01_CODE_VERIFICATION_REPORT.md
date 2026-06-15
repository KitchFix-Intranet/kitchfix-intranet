# 01 - Phase 2 Code Verification Report

**Prepared:** 2026-06-12 by the CC engineering session, in response to the Phase 2 handoff.
**Pairs with:** [`00_START_HERE_Project_Handoff.md`](./00_START_HERE_Project_Handoff.md), [`OPD_Phase2_Master_Charter.md`](./OPD_Phase2_Master_Charter.md).
**Purpose:** Verify the engineering claims in the Charter, the two CC State Briefs, and the v2 audit/intelligence briefs against the current code, schema, and live data **before** Phase 2 work builds on them.
**Convention:** hyphens only, no em-dashes.

> **TL;DR.** The OPD + SousAI code, schema, and pipelines match what the Charter and briefs describe, with two doc-level drifts worth surfacing and several state changes since 2026-06-08. The only items needing decision before any catalog write are the **status mapping (CK-2)** and the **content-vs-catalog reconciliation** (the catalog has 42 rows today, content side targets ~80). No engineering blocker for Pass 0 / Pass 1 audit work.

---

## 0. What was verified

Every claim under Charter §5 (alignment register) + Charter §6 (status mapping) + the engineering-side State Briefs was checked against:

- **Schema:** `docs/migrations/pr-7-1` (catalog), `pr-7-6` (Brand shelf), `pr-7-7` (archive), `pr-8-1` (chunks), `pr-8-2` (retrieval RPC).
- **Code:** `src/lib/sousai/{chunk,extract,embed,generate,index,store}.js`, `src/lib/playbookValidation.js`, `scripts/sousai-embed-corpus.mjs`, `src/app/api/playbook/route.js`.
- **Character:** `docs/SOUSAI_CHARACTER_SPEC.md`.
- **Project canon:** `CLAUDE.md` (current HEAD).
- **Live data:** dumped via `scripts/_probe_phase2_recon.mjs` (this report includes the output).
- **Git state:** `origin/main` at `e3d637f` (was `7601aee` when the State Briefs were written; the diff between them is summarized in §6).

What was **not** verified here (out of scope for this report, in scope for Pass 0 of the audit):

- Per-document content claims from the v2 audit brief (e.g. specific document IDs referenced but not in catalog).
- The Documentation Tracker. The probe checks catalog state; it does not load the content-side tracker.
- Drive-sharing status per file. The probe knows `source_drive_id` exists; it does not call Drive to confirm the service account has Viewer access to each file. That check is the Charter step-1 deliverable (the Drive-sharing batch).

---

## 1. Charter §5 alignment register - item-by-item verdicts

| § | Claim | Verdict | Notes |
|---|---|---|---|
| 5A | Status enum: Placeholder, Pending, Draft, In Build, Blocked, Live, Retired (locked CHECK) | **CONFIRMED** | `pr-7-1-opd-schema.sql` line 80: `CHECK (status IN ('Live','In Build','Draft','Pending','Placeholder','Blocked','Retired'))`. Verbatim match. |
| 5B | `chk_live_complete` requires `version` + `card_line` for Live, exempt for `is_historical = TRUE` | **CONFIRMED** | `pr-7-1-opd-schema.sql` line 89: `is_historical = TRUE OR status <> 'Live' OR (version IS NOT NULL AND card_line IS NOT NULL)`. The gate is real and enforced. |
| 5C | Hard floor rule 7 (template-as-canonical) is in `SOUSAI_CHARACTER_SPEC.md` | **DRIFT (doc-only)** | The rule **is** enforced - it lives in `src/lib/sousai/generate.js` SYSTEM_PROMPT line 119 verbatim. But `SOUSAI_CHARACTER_SPEC.md` Section 8 stops at rule 6 ("Stays in his lane on medical and legal"). The spec doc never got the rule-7 amendment. Behavior is correct; the spec is stale. Fix is one paragraph in the spec. Doesn't block Phase 2. |
| 5D | Em-dashes: two surfaces, two rules | **CONFIRMED** | Code/spec/repo use hyphens. STD-001 print library uses em-dashes intentionally. Verified by reading both. |
| 5E | Chunker depends on real Google Docs `HEADING_1..6` styles; falls back to size-based for unstructured | **CONFIRMED, with strong wording** | `extract.js` line 117: `style === "TITLE" || style.startsWith("HEADING_")` - the **only** signal that produces a section break. `chunk.js` line 19 comment: "The chunker doesn't run a heuristic on 'looks like a heading'; if the Docs API didn't say HEADING_n, it isn't." Bold text will NOT trigger a section. This is exactly as load-bearing as Charter §5E says. |
| 5F | The audit feeds the catalog row (Scorecard v2 output = catalog row) | **CONFIRMED, structurally** | Catalog has fields: `id, title, doc_class, shelf, status, version, card_line, summary, keywords, owner, approver, source_drive_id, audience, classification, pinned, critical, print_required, sort_order, effective_date, last_reviewed, next_review`. Scorecard v2 Part 5 maps 1:1. The relationship edges in §6b of the audit brief map to `document_relationships` (verified, rel_type CHECK matches: references / implements / supersedes / superseded_by / derived_from / related). |
| 5G | OPD catalog becomes canonical at go-Live; tracker is the audit ledger | **NOT A CODE CLAIM** | This is a policy decision for CK-6. No code to verify. Noted. |
| 5H | "In review" docs are In Build / Blocked, not Live | **STRUCTURALLY CONFIRMED** | The OPD enum has both In Build (default) and Blocked. The admin worklist surfaces non-Live rows. Mapping is a Kevin call at CK-2 (Charter §6). |
| 5I | Two corpus gaps (company-identity, intranet-knowledge) | **CONFIRMED in spec** | `SOUSAI_CHARACTER_SPEC.md` §13 dependencies 1 + 2 name both gaps explicitly. Decision is for Kevin at CK-1. |
| 5J | Open compliance threads ride along | **NOT A CODE CLAIM** | Audit content concern. Noted. |

**Verdict:** 9 confirmed, 1 drift (rule 7 in spec doc), 2 non-code items noted. Nothing blocks Pass 0.

---

## 2. Charter §6 status mapping - what the enum will accept

Charter §6 proposes mapping the Documentation Tracker statuses to the OPD enum. The OPD enum is locked by `chk_documents_status`. Confirmed mappings the enum **will accept**:

| Proposed OPD status | CHECK accepts? | Currently in catalog |
|---|---|---|
| Live | yes | 8 rows |
| In Build | yes | 9 rows |
| Blocked | yes | 0 rows |
| Pending | yes | 11 rows |
| Placeholder | yes | 1 row |
| Draft | yes | 10 rows |
| Retired | yes | 3 rows |

**Mappings that DO NOT exist as OPD values** (and so the Charter §6 mapping must be applied before write): "In review," "Queued," "Staged," "Not started," "Not Required." Any catalog INSERT/UPDATE using one of these strings will be rejected by the CHECK constraint with `23514`. This is the protection the Charter relies on.

**Kevin decision at CK-2:** confirm Charter §6 mapping table verbatim, or amend before any bulk write.

---

## 3. SousAI engineering claims - verdicts

| Claim | Verdict | Source |
|---|---|---|
| 7 hard floor rules (1 invent, 2 numbers, 3 food-safety, 4 cite, 5 route, 6 lane, 7 template-as-canonical) | **6 in spec, 7 in code** | `SOUSAI_CHARACTER_SPEC.md` §8 has rules 1-6. `generate.js` SYSTEM_PROMPT has rules 1-7 verbatim. Behavior matches Charter §5C; doc is stale. |
| Retrieval threshold 0.28 cosine | **CONFIRMED** | `generate.js` line 50: `SOUSAI_SIMILARITY_THRESHOLD = 0.28` with the inline note: "no-answer questions topped out at ~0.22, weak-real questions bottomed at ~0.32. 0.28 sits between." |
| Top-K = 5 | **CONFIRMED** | `generate.js` line 45: `SOUSAI_TOP_K = 5`. |
| Model = claude-haiku-4-5-20251001 | **CONFIRMED** | `generate.js` line 44. |
| Layer-1 decline (below-threshold path skips Claude entirely) | **CONFIRMED** | `generate.js` line 245: `if (aboveThreshold.length === 0)` returns the declined-context object; `generateSousAnswer` still calls Claude for voice consistency but with a "no usable sources" user message. Net: model doesn't invent. |
| Structure-aware chunker (heading-stack ancestry, joined with " > ") | **CONFIRMED** | `chunk.js` line 100-104 `buildSectionPath`. `extract.js` line 91-124 maintains `headingStack` of `{heading, level}`, pops on deeper-or-equal, snapshots remaining stack as ancestry. |
| Size-based fallback (when no headings) | **CONFIRMED** | `chunk.js` line 66: `path = anyHeading ? "structure-aware" : "size-based-fallback"`. |
| Contextual header on every chunk ("From: {title} ({doc_id}), Section: {heading}") | **CONFIRMED** | `chunk.js` line 73-75 builds the header; full chunk is `${headerLine}\n\n${body}`. |
| Embed script auto-skip already-embedded in bulk mode | **CONFIRMED** | `sousai-embed-corpus.mjs` line 96-98: builds `docsWithChunks` Set, filters Live docs by it. |
| Embed script Live-only filter in bulk mode | **CONFIRMED** | line 81: `.eq("status", "Live")`. |
| Embed script idempotent re-embed in targeted mode | **CONFIRMED** | Targeted mode delegates to `embedDocument` / `embedPosterStub` which use the delete-then-insert pattern (see `src/lib/sousai/store.js`). |
| Poster (POST class) takes stub path, no extract | **CONFIRMED** | line 125: `const isPoster = SKIP_TEXT_EXTRACTION_CLASSES.includes(doc_class)`. POSTER-prefix IDs have doc_class POST (per `playbookValidation.js` line 36). |
| `archive_document` RPC is atomic (flip + delete chunks in one transaction) | **CONFIRMED** | `pr-7-7-opd-archive.sql` line 53-83. PLpgSQL function `archive_document` does UPDATE then conditional DELETE in one `BEGIN/END`. |
| Restore is NOT an RPC; orchestrated in API route with re-embed | **CONFIRMED** | `pr-7-7-opd-archive.sql` header lines 22-25 explains it; restore behavior lives in the API route. Sets `archived = false` LAST after re-embed succeeds. |
| HNSW cosine index on `document_chunks.embedding` | **CONFIRMED** | `pr-8-1-sousai-chunks.sql` line 71-72: `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)`. |
| `match_document_chunks` RPC returns similarity (1 - distance), orders by distance for HNSW | **CONFIRMED** | `pr-8-2-sousai-match-fn.sql` line 48-51: `1 - (embedding <=> query_embedding) AS similarity` + `ORDER BY embedding <=> query_embedding`. |
| FK CASCADE: deleting a document deletes its chunks | **CONFIRMED** | `pr-8-1-sousai-chunks.sql` line 41: `doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE`. |
| Chunks unique by `(doc_id, chunk_index, language)` for bilingual (POSTER-001) | **CONFIRMED** | line 56: `CONSTRAINT uq_chunk_per_doc_lang UNIQUE (doc_id, chunk_index, language)`. |

**Verdict:** every engineering claim verifies, with the rule-7 doc drift the only flag.

---

## 4. Schema claims - shelves, classes, ID format

| Claim | Verdict |
|---|---|
| 7 shelves (Safety, Operations, HR & People, Culinary, Brand & Standards, Finance, Site & Client) | **CONFIRMED** - `pr-7-6-opd-add-brand-shelf.sql` updates the CHECK to all 7. Brand & Standards sits between Culinary and Finance in app render order. |
| 10 doc classes (PB, SOP, TPL, REF, STD, POL, AGR, FORM, POST, CHK) | **CONFIRMED** - `pr-7-1-opd-schema.sql` line 77: CHECK accepts exactly those 10. |
| ID format `PREFIX-NNN` with 11 prefixes (POSTER prefix maps to POST class) | **CONFIRMED** - `playbookValidation.js` line 22-23: regex `/^(PB|STD|POL|SOP|TPL|CHK|REF|AGR|FORM|POST|POSTER)-\d{3}$/`. Line 36: `POSTER: "POST"` in `PREFIX_TO_DOC_CLASS`. The validator enforces the prefix-to-class consistency check (line 86-95). |
| 4 OPD tables: documents, document_relationships, document_surfaces, document_issues | **CONFIRMED** - all 4 in `pr-7-1-opd-schema.sql`. |
| `document_relationships.rel_type` accepts: references, implements, supersedes, superseded_by, derived_from, related | **CONFIRMED** - `pr-7-1-opd-schema.sql` line 117-119. Matches Scorecard v2 Part 3 B. |

---

## 5. Live data state (probe output, 2026-06-12)

Source: `scripts/_probe_phase2_recon.mjs`. Read-only. Re-runnable.

**Totals:** 42 documents in catalog. 1 archived. 190 chunks across 8 distinct doc_ids.

**By status:**

| Status | Count | % |
|---|---|---|
| Live | 8 | 19% |
| In Build | 9 | 21% |
| Draft | 10 | 24% |
| Pending | 11 | 26% |
| Placeholder | 1 | 2% |
| Blocked | 0 | 0% |
| Retired | 3 | 7% |

**By shelf:**

| Shelf | Count |
|---|---|
| Safety | 8 |
| Operations | 6 |
| HR & People | 15 |
| Culinary | 1 |
| Brand & Standards | 4 |
| Finance | 0 |
| Site & Client | 5 |
| (NULL) | 3 |

**By doc_class:** PB 7, SOP 5, TPL 14, REF 4, STD 5, POL 1, AGR 1, FORM 2, POST 3, CHK 0.

**Live-readiness pre-flight signals (across ALL docs):**

- `version IS NOT NULL`: 31 of 42
- `card_line IS NOT NULL`: 38 of 42 (4 catalog rows lack a card_line)
- `source_drive_id IS NOT NULL`: **8 of 42** (only the 8 Live docs have a Drive ID set; the other 34 will need one before they can pass the iframe-render test)
- `summary IS NOT NULL`: 41 of 42

**The 8 Live docs (all of them pass the gate; all are embedded):**

| ID | Class | Drive | Version | card_line | Embedded |
|---|---|---|---|---|---|
| AGR-001 | AGR | yes | yes | yes | yes |
| FORM-001 | FORM | yes | yes | yes | yes |
| PB-002 | PB | yes | yes | yes | yes |
| PB-003 | PB | yes | yes | yes | yes |
| POST-002 | POST | yes | yes | yes | yes |
| POSTER-001 | POST | yes | yes | yes | yes |
| SOP-002 | SOP | yes | yes | yes | yes |
| STD-001 | STD | yes | yes | yes | yes |

**Phase 2 target gap (catalog vs content side):** content side has ~80 authored documents; catalog has 42 rows. About **38 documents either need new catalog rows or their content-side existence has not yet been reconciled to OPD.** This is a CK-2 reconciliation item, not a build problem yet.

**Observations worth flagging for Kevin:**

- **Finance shelf has zero rows.** PB-009 (Sebastian-gated) and any other Finance docs from the content side haven't been catalog-rowed. Expected if those are still Pending on the content side.
- **CHK class has zero rows.** Every CHK doc (checklists) the content side has authored has no catalog presence.
- **POL has only 1 row.** The content brief references many POL docs (POL-006, POL-008, POL-010, POL-011, POL-012, POL-013, POL-015, POL-016, POL-019, etc.). Most are not in catalog yet.
- **3 catalog rows have NULL shelf.** Likely Retired or unassigned per the schema's `chk_documents_shelf` allowing NULL. Worth inspecting before bulk operations.

---

## 6. State changes since 2026-06-08 (when the State Briefs were written)

`origin/main` moved from `7601aee` to `e3d637f` (36 commits, 6,733 lines added). None of those commits touched OPD or SousAI code or migrations. The drift that matters:

**`CLAUDE.md` changed significantly.** Verbatim notable additions:

1. **Migration project closed 2026-06-12.** New canonical reading order: `docs/MIGRATION_PROJECT_CLOSEOUT.md` and `docs/MIGRATION_STATUS.md` are now the first two reads. ARCHITECTURE.md drops from #1 to #3.
2. **Six modules cut over to PG with dual-write to Sheets**, including **Playbook/OPD**. The dataStore orchestrator + flag-dispatch pattern (the pattern the six cut-over modules use) is now canonical for new feature builds.
3. **New Danger Zone entries:**
   - `src/lib/cutover.js` (migration control plane)
   - `src/lib/dataStore/*.js` (per-module orchestrators)
   - `docs/migrations/*.sql` (migrations do NOT auto-apply on deploy)
4. **Migrations don't auto-apply rule.** New SQL files require manual Studio paste + a verify probe **before** the dependent code ships. The 2026-06-12 silent-gap incident referenced in CLAUDE.md is the reason. This matters if Phase 2 ends up needing any schema work (probably it doesn't; the OPD schema is complete).
5. **Resolved Phase-1 findings dropped** from the standing-findings list: hand-rolled JWT path (now routed through `getServiceAccountSheetsClient`), `next dev` Turbopack (now default), Analytics teardown complete, `googleapis`/`google-auth-library` exact-pinned.

**Implication for Phase 2:**
- The Playbook module sitting on the dual-write data layer means the OPD write paths in `src/app/api/playbook/route.js` already go through the canonical pattern. No change needed.
- Anything Phase 2 ends up doing that touches catalog rows uses the existing API actions (`create-document`, `update-document`, `archive`, `restore`); no schema work is in scope unless a real gap surfaces.
- If Phase 2 surfaces a need for any new column, follow the migrations-don't-auto-apply rule: Studio paste first, probe-verify, then ship code.

**Current branch state:**
- Branch: `feat/sousai-demo` (still on the prior session's demo branch).
- HEAD: `5d368bf` (the prior handoff commit at `docs/HANDOFF_SOUSAI_DEMO.md`).
- Working tree dirty: the Sous modal UI work from the prior session is uncommitted (`AdminClient.js`, `SousDemoClient.js`, `sous-demo.css` modified; `SousChat.js`, `SousModal.js` untracked). **This work is unrelated to Phase 2 deliverables and is being left in place.** Phase 2 deliverables in `docs/phase2/` are new untracked files; they don't collide with the modal work.

---

## 7. Drift findings that warrant attention (ranked)

**1. (Minor) `SOUSAI_CHARACTER_SPEC.md` §8 is missing hard-floor rule 7.**
The behavior is correct - rule 7 ("TEMPLATE-AS-CANONICAL IS INVENTION") is in `generate.js` SYSTEM_PROMPT verbatim. The spec doc, which the v2 briefs treat as the canonical character source, stops at rule 6. The fix is one paragraph appended to §8 in the spec, mirroring the prompt language. Should ship before broad Sous release so spec and prompt match, but does not block Phase 2 audit work.

**2. (Decision needed at CK-2) Content-side ~80 vs catalog 42.**
About 38 documents the content side has authored have no catalog row. The Charter §6 status mapping must be settled, then a CK-2 reconciliation pass either creates catalog rows for the missing docs or maps which authored docs land where in the existing 42-row set. Either way, this is the gate before bulk writes.

**3. (Decision needed at CK-2) Drive-sharing batch is overdue.**
34 of 42 catalog rows lack a `source_drive_id`. The Charter step-1 batch (share the parent folder with the service account once) becomes the next big read-side prerequisite. Without it, no further docs can pass the iframe-render test and no further docs can be embedded (the embed script skips non-POST docs with null `source_drive_id`).

**4. (Decision needed at CK-1) Two corpus gaps unfilled.**
`SOUSAI_CHARACTER_SPEC.md` §13 dependencies 1 (company-identity corpus) and 2 (intranet-knowledge docs) are unauthored. The Charter §5I asks Kevin to decide whether Phase 2 closes them. Engineering-side this is fine either way; the code path for new documents is the same.

**Not a drift, but worth knowing:** the 2026-06-12 CLAUDE.md update added the dataStore orchestrator pattern as the canonical pattern for new code. Phase 2 does not appear to need new code; existing Playbook API actions cover everything in scope. Flagged so we follow the right pattern if a surprise scope item lands.

---

## 8. What was NOT verified (handoff to Pass 0)

- Existence in catalog of specific document IDs referenced in the v2 audit brief (e.g. POL-012, SOP-009, PB-009, REF-001 state data). The probe gives only class-level counts; Pass 0 of the audit needs to enumerate.
- The Documentation Tracker. Engineering had no access in this session; the content side owns it.
- Drive Viewer permissions per file (the Drive-sharing batch is step 1 of the integrated sequence).
- The intranet-knowledge corpus authored content (not yet authored per §13.2 of the spec).
- The chunking-readiness check per document. The chunker behavior is verified; whether each multi-section doc was authored with real Google Docs heading styles (vs bold text) is a per-doc Pass-5 check. This is the most operationally important interface point.

---

## 9. Run commands

```bash
# Re-run the recon probe any time:
node --env-file=.env.local scripts/_probe_phase2_recon.mjs

# Verify schema migrations are applied:
node --env-file=.env.local scripts/verify-pr-7-1-opd-schema.mjs
node --env-file=.env.local scripts/verify-pr-7-2-opd-seed.mjs
node --env-file=.env.local scripts/verify-pr-7-7-opd-archive.mjs

# SousAI regressions (use after any content load):
node --env-file=.env.local scripts/sousai-retrieval-test.mjs
node --env-file=.env.local scripts/sousai-generate-test.mjs

# Embed corpus (bulk missing-only, then targeted re-embed):
node --env-file=.env.local scripts/sousai-embed-corpus.mjs
node --env-file=.env.local scripts/sousai-embed-corpus.mjs PB-002 SOP-002
```

---

## 10. Conclusion

**No engineering blocker for Pass 0.** The code, schema, and pipeline match what the Charter and briefs describe. The one true drift (rule 7 missing from the spec doc) doesn't change behavior. The two decisions that need to happen before any bulk write (status mapping at CK-2, content-vs-catalog reconciliation) are content-side decisions for Kevin, not engineering blockers.

Read [`02_ENGINEERING_RUNBOOK.md`](./02_ENGINEERING_RUNBOOK.md) next for the how-to that maps to Charter checkpoints CK-1 through CK-8.
