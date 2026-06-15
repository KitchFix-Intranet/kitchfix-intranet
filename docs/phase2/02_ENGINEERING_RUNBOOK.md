# 02 - Phase 2 Engineering Execution Runbook

**Prepared:** 2026-06-12 by the CC engineering session.
**Pairs with:** [`00_START_HERE_Project_Handoff.md`](./00_START_HERE_Project_Handoff.md), [`OPD_Phase2_Master_Charter.md`](./OPD_Phase2_Master_Charter.md), [`01_CODE_VERIFICATION_REPORT.md`](./01_CODE_VERIFICATION_REPORT.md).
**Purpose:** The technical how-to that runs alongside the Charter's what-and-when. Every step here maps to a Charter §4 sequence row and a checkpoint (CK-1 through CK-8). Do not invent parallel checkpoints; the Charter's are canonical.
**Convention:** hyphens only, no em-dashes.

> **TL;DR.** Workstream B in this phase is small but exacting. There are five things to do, in this order: (1) share the Drive parent folder with the service account; (2) reconcile catalog rows against the content side; (3) build a Live-readiness pre-flight tool; (4) write/promote rows in batches; (5) embed, then regression-test the retrieval and decide the verifier-step. No schema changes are in scope. No new feature work is in scope. Broad Sous promotion (drop owner-only gate, drop Preview badge, move off `/playbook/sous-demo`) is **next phase**, per Charter §7.

---

## 0. Operating mode for this runbook

- **No schema changes anticipated.** The OPD + SousAI schema is complete (`pr-7-1` through `pr-8-2`, plus `pr-7-6` shelf + `pr-7-7` archive). If Phase 2 surfaces a new column requirement: migrations don't auto-apply on deploy (CLAUDE.md), so Studio paste first, verify probe, then ship dependent code. Treat this as a hard rule.
- **Use existing API actions.** `src/app/api/playbook/route.js` has `create-document`, `update-document`, `archive`, `restore`, `report-issue`, `list-archived`, `archive-impact`, `bootstrap`, `document`. No new actions should be needed.
- **One axis per PR.** A PR either reconciles status mapping, OR writes a batch of catalog rows, OR fixes a drift. Not all three.
- **The audit drives the load, not the other way around.** Engineering does not write catalog rows ahead of audit verdicts. The Charter's Pass 5 is the bridge.

---

## 1. Step-by-step (Charter §4 row by Charter §4 row)

### Step 0 (CK-1) - Pass 0 knowledge build, dependency graph, Library Understanding

**Workstream A. Engineering does not run this step.**

Engineering posture here: read-only. The probe (`scripts/_probe_phase2_recon.mjs`) gives the catalog state. The audit produces the graph and load-bearing register.

What engineering can do **for** the audit at CK-1, if asked:
- Stand up a one-shot "catalog row summary" output for a chosen doc ID (for cross-reference). Already in the bootstrap API action.
- Surface `document_relationships` rows that exist today (if any) - the audit's dependency graph will be the source of truth.

### Step 1 (parallel, confirms at the iframe render) - Drive-sharing batch

**Workstream B. Engineering owns this. Single biggest blocker for everything downstream.**

The current state: 8 of 42 catalog rows have `source_drive_id` set (all 8 Live docs). The other 34 catalog rows + the ~38 not-yet-in-catalog rows all need their Drive files shared with the service account and their IDs captured.

**Service account email** (from `extract.js`): `kitchfix-sheets@speedy-actor-487922-p4.iam.gserviceaccount.com` - share the parent folder, Viewer role; permissions cascade to children.

**The cascade-and-confirm pattern:**
1. Kevin shares the parent Drive folder once, with the service account, Viewer.
2. CC writes a one-shot script that walks the documents catalog, for each `source_drive_id` calls Docs API `documents.get`, and reports OK / 403 / 404.
3. Iframe render is the operator-side proof; the API call is the embed-pipeline proof. Both are required.

**Engineering deliverable for this step:** `scripts/_probe_drive_sharing.mjs` - takes the catalog, reports which rows pass the API call. Same `_probe_*.mjs` pattern as the inventory module's scripts.

**Checkpoint behavior:** confirm all files render in the catalog admin UI before treating this step as done.

### Step 2 (CK-2) - Catalog hygiene: IDs, shelves, status mapping

**Workstream B. This is the gate before any bulk write.**

Three sub-tasks:

**2a. ID assignment + prefix-to-class consistency.** For every authored doc that needs a catalog row, the ID format must match `STRICT_DOC_ID_RE` in `playbookValidation.js`:
- `(PB|STD|POL|SOP|TPL|CHK|REF|AGR|FORM|POST|POSTER)-NNN`.
- POSTER prefix maps to doc_class POST (the only special case).
- Bilingual posters use the `POSTER-NNN` prefix to make the bilingual case explicit at write time.

**2b. Shelf assignment.** Every Live-bound doc needs a shelf. The 7 valid shelves are encoded in `chk_documents_shelf` (after `pr-7-6`):
- Safety, Operations, HR & People, Culinary, Brand & Standards, Finance, Site & Client.
- NULL is allowed (Retired / unassigned). Do not promote a NULL-shelf row to Live.

**2c. Status mapping reconciliation (the Kevin decision at CK-2).** Charter §6 proposes the Documentation Tracker -> OPD enum mapping. Engineering posture: write nothing until Kevin confirms verbatim. Wrong status either hides a doc from operators (status filters in admin worklist) or exposes an unfinished one to them.

**Engineering deliverable for this step:** `scripts/_probe_catalog_diff.mjs` - takes a CSV/JSON dump of the content-side tracker, diffs against the OPD catalog, reports: (a) rows in catalog only, (b) rows in tracker only, (c) rows in both with status mismatch, (d) prefix-to-class violations. Read-only. Output is the CK-2 worksheet.

**Charter risk to mitigate at this step:** the CHECK constraints will reject any write using "In review," "Queued," "Staged," "Not started," or "Not Required" with `23514`. The probe catches these before the write attempt; do not rely on the database error as the only guardrail.

### Step 3 (CK-3) - Pass 1 + Pass 2 audit

**Workstream A. Engineering does not run this step.**

If asked to support the contradiction hunt: the embed corpus is already a useful lens. Same-question-across-many-docs is exactly what SousAI is built to do. A "contradiction-finder" mini-script could fan-out a fixed set of questions across the live corpus and surface ranked top-2 disagreements. Flag if added; do not silently scope-add. Not required for the Charter sequence.

### Steps 4-5 (CK-4, CK-5) - Revision + re-audit

**Workstream A. Engineering does not run these steps.**

The chunker has zero opinion about content quality. It chunks what it gets. So revisions happen entirely in Google Docs; no engineering action until the docs are re-saved and the catalog row is touched.

### Step 6 (Pass 5) - Finalize catalog + SousAI metadata

**Workstream A produces the data; Workstream B writes it.** This is the bridge step.

Per Charter §5F: the Scorecard v2 output IS the catalog row. Engineering's job here is to validate that the Scorecard fields map cleanly to columns:

| Scorecard v2 Part 5 field | `documents` column | Notes |
|---|---|---|
| `id` | `id` (TEXT PK) | regex-checked by `STRICT_DOC_ID_RE` |
| `title` | `title` (NOT NULL) | |
| `doc_class` | `doc_class` (CHECK 10 values) | |
| `shelf` | `shelf` (CHECK 7 values or NULL) | |
| `status` (OPD enum) | `status` (CHECK 7 values) | apply CK-2 mapping |
| `version` | `version` (nullable) | required for Live (`chk_live_complete`) |
| `card_line` | `card_line` (nullable) | required for Live (`chk_live_complete`) |
| `summary` | `summary` (nullable) | SousAI signal |
| `keywords` | `keywords` (TEXT[], default `{}`) | SousAI signal |
| `owner` | `owner` (nullable) | role title, never a name |
| `approver` | `approver` (nullable) | role title |
| `audience` | `audience` (nullable) | enforcement deferred per pr-7-1 |
| `classification` | `classification` (default 'KitchFix Internal') | |
| `source_drive_id` | `source_drive_id` (nullable) | required for non-POST Live |
| `source_drive_id_es` | (no column today) | **FLAG** - the bilingual support uses a separate Drive ID; check `pr-7-4-opd-bilingual-columns.sql` for the actual column name before writing the bilingual rows |
| `pinned` | `pinned` (default false) | |
| `critical` | `critical` (default false) | |
| `print_required` | `print_required` (default false) | POST class only |
| `sort_order` | `sort_order` (default 100) | |

**Flag worth noting now (not blocking):** the Scorecard names `source_drive_id_es` for bilingual posters. The migration `pr-7-4-opd-bilingual-columns.sql` defines the actual column name (in this repo for ~6 months). Read it before writing bilingual rows so the field name is right. The probe will catch it but better to know in advance.

**Relationships go in `document_relationships`** with `rel_type` in (`references`, `implements`, `supersedes`, `superseded_by`, `derived_from`, `related`). The unique constraint is `(from_doc, to_doc, rel_type)`. Write these alongside the catalog rows.

### Step 7 (CK-6) - Live-readiness pre-flight

**Workstream B. Single most important pre-write checkpoint.**

For every doc proposed to land at status Live, all of these must hold (or the database will reject the row via `chk_live_complete` or the operator catalog will silently break):

- `version IS NOT NULL`
- `card_line IS NOT NULL`
- `source_drive_id IS NOT NULL` (or `print_required = true` for POST class without a Drive file, if any)
- The Drive file passes the Step 1 iframe-render test (no cascade-permission failure)
- `owner` and `approver` are role titles, not names (per STD-001 convention)
- `shelf` is set (not NULL) and is one of the 7
- For multi-section docs that will use the structure-aware chunker: heading hierarchy in the source Google Doc uses real `HEADING_1..6` styles (Charter §5E). This is the **one** thing not check-able from the catalog row alone; spot-check via the chunking-readiness check in the next step.

**Engineering deliverable:** `scripts/_probe_live_readiness.mjs` - takes a list of proposed-Live doc IDs (or all status='Live' candidates), reports which ones fail which gate. Read-only. Output is the CK-6 verdict table.

**Chunking-readiness spot-check:** for any doc the pre-flight passes, do a dry-run extract via `scripts/sousai-extract-and-chunk.mjs` (already in repo) and confirm the chunker path is `structure-aware` (not `size-based-fallback`) for any multi-section manual. A manual that falls back chunks as one blob and retrieves badly.

### Step 8 - Bulk catalog write / promote

**Workstream B. Where most of the engineering effort lands.**

**Write strategy at 80-doc scale:**

The existing API `create-document` action takes one doc per call. With ~38 rows to add (more if Phase 2 also closes the company-identity corpus gap), the per-call pattern is acceptable but slow. Two paths:

- **Path A (recommended): batch via the existing API.** Wrap `create-document` in a CLI that takes a JSON manifest and posts one per row. No new code in the production API. Each row goes through the same validation (`validateCreatePayload`) as a manual create. Audit trail per row.
- **Path B (escape hatch): direct service-role insert.** Bypasses the API but also bypasses the validation. Only if Path A becomes a meaningful time sink. Flag if used.

Path A is the default. If Kevin OKs the JSON-manifest CLI, it lives in `scripts/_load_phase2_catalog.mjs` and posts to `/api/playbook` with `{ action: 'create-document', payload: <row> }`. Doc-by-doc skip on duplicate-id error so reruns are safe.

**Promote-to-Live flow:** writes happen at status In Build or whatever CK-2 settles. Live promotion is a SEPARATE pass after CK-6 confirms readiness. Don't promote on the initial write.

**PR boundaries for this step:**
- One PR for the load script + the JSON manifest (review the manifest before merge; review the script for safety on retries and dry-run mode).
- A second PR (or multiple) for the actual data load if a per-batch review is desired. The data lives in the manifest, not in code; this is more about review hygiene than code change.

### Step 9 (CK-7) - Bulk embed

**Workstream B. Standard, well-trodden path. Use the existing script.**

After Live promotion, run:

```bash
node --env-file=.env.local scripts/sousai-embed-corpus.mjs
```

In bulk missing-only mode (no args), this:
1. Loads all Live docs.
2. Skips any with existing chunks.
3. For each candidate, dispatches: POST class -> stub path; everything else -> full extract + chunk + embed.
4. Prints per-doc summary + a mid-doc sample chunk + aggregate counts.

**Expected outputs:** chunk counts in the same ballpark as today's 8 docs / 190 chunks ratio (so ~80 docs should produce roughly 1,900-2,400 chunks; manual-heavy docs more, single-page forms fewer).

**If any doc fails:** the script does NOT exit on first failure. It reports the error per doc and exits 1 only if any errors occurred. Re-run with the failed doc IDs explicitly (targeted re-embed mode) after fixing the underlying issue (most likely cause: Drive permission missed in Step 1).

**CK-7 review:** chunk counts per doc, sample chunk per doc, any failures. The script's per-doc summary is the input here.

### Step 10 (CK-8) - Retrieval regression + no-answer-gap re-verification + verifier-step decision

**Workstream B. The release-readiness checkpoint.**

**Run order:**

```bash
# 1. Retrieval-only regression (no LLM cost):
node --env-file=.env.local scripts/sousai-retrieval-test.mjs

# 2. Full generation regression (one LLM call per question):
node --env-file=.env.local scripts/sousai-generate-test.mjs
```

**What to measure:**

- **No-answer gap.** At 8 docs the gap between weakest real hit (~0.32) and best out-of-corpus miss (~0.22) was ~10 points. SousAI brief flagged that 80 docs is exactly where this may compress. Re-run the generation test (which includes the 2 out-of-corpus questions) and read the top-similarity for both groups. If the gap compresses below ~5 points, the verifier-step decision becomes urgent.
- **Discrimination.** Confirm a query for allergens still hits PB-002, incident questions still hit SOP-002, etc. Test domain leakage at scale: do allergen queries pull in unrelated docs that now share vocabulary?
- **Citation discipline.** Hard floor rule 4 says every substantive claim cites doc + section. Read 5-10 generated answers and confirm citations exist and resolve.
- **Decline cleanliness.** Hard floor rule 1 + the Layer-1 decline path. Out-of-corpus questions should produce the "I don't have that documented" voice, not a fluent guess.
- **Template-as-canonical guardrail.** Hard floor rule 7 (the one drift-flagged in `01_CODE_VERIFICATION_REPORT.md` §7). Confirm STD-001 callout examples don't surface as canonical brand-promise content.

**The verifier-step decision:**

- Default: do not build.
- If the gap compresses below ~5 points AND the regression shows confident-wrong answers on weak retrievals: build the verifier step.
- The verifier step is: after retrieving top-K, ask Claude "is this content actually relevant to the question?" before answering, on the candidate chunks. Catches false confidence at the cost of one extra Claude call.
- **Deciding is in scope; building is next phase per Charter §7.** Document the decision in this step's output regardless.

**Tuning if needed:**
- The threshold `SOUSAI_SIMILARITY_THRESHOLD = 0.28` can be raised if discrimination tightens. Don't lower it.
- Top-K can be raised from 5 to 8 if multi-doc synthesis becomes load-bearing. Re-run the generation suite after.
- The system prompt can take a "more docs means more domain boundaries, route by domain when ambiguous" addition. Surgical; preserve the hard floor.

**PR boundaries for this step:**
- Tuning changes (threshold, top-K, system prompt) ship in one small PR with the regression evidence in the PR description.
- The verifier-step decision is a one-paragraph note in this directory; not a PR.

### Step 11 - Close corpus gaps or defer

**Workstream A primarily.** Engineering's job is identical to Step 8 for any new docs that come out of the gap-closing pass (catalog row + Drive sharing + embed).

The two gaps from Charter §5I and `SOUSAI_CHARACTER_SPEC.md` §13:

1. **Company-identity corpus.** Brand promise, history, pillars, Latin-cuisine identity, standard-bearer ethos. Decision at CK-1. If closed in Phase 2: 1-N new docs, treated like any other Live-bound doc through Steps 7-9-10.
2. **Intranet-knowledge docs.** Short descriptions of pages/tools/workflows. Charter §5I recommends a lightweight set. Same load mechanics.

If deferred: write the deferral as one-paragraph notes per gap in this directory, with the documented reason and the trigger for revisiting.

---

## 2. Run commands reference

```bash
# Recon and pre-flight (read-only)
node --env-file=.env.local scripts/_probe_phase2_recon.mjs          # current catalog state
node --env-file=.env.local scripts/_probe_drive_sharing.mjs         # to be written for step 1
node --env-file=.env.local scripts/_probe_catalog_diff.mjs          # to be written for step 2
node --env-file=.env.local scripts/_probe_live_readiness.mjs        # to be written for step 7

# Schema verification (idempotent, run any time)
node --env-file=.env.local scripts/verify-pr-7-1-opd-schema.mjs
node --env-file=.env.local scripts/verify-pr-7-2-opd-seed.mjs
node --env-file=.env.local scripts/verify-pr-7-7-opd-archive.mjs

# Single-doc dry-run before bulk embed
node --env-file=.env.local scripts/sousai-extract-and-chunk.mjs <docId>
node --env-file=.env.local scripts/sousai-embed-doc.mjs <docId>

# Bulk embed (Live + auto-skip already embedded)
node --env-file=.env.local scripts/sousai-embed-corpus.mjs

# Targeted re-embed (delete + re-insert)
node --env-file=.env.local scripts/sousai-embed-corpus.mjs PB-002 SOP-002

# Retrieval + generation regressions
node --env-file=.env.local scripts/sousai-retrieval-test.mjs
node --env-file=.env.local scripts/sousai-generate-test.mjs
```

---

## 3. PR boundaries (the whole sequence at a glance)

| PR | Purpose | Touches | Risk |
|---|---|---|---|
| 1 | Phase 2 docs landing (this directory) | `docs/phase2/*` only | none (docs) |
| 2 | Drive-sharing probe + report | `scripts/_probe_drive_sharing.mjs` (new) | none (read-only) |
| 3 | Catalog-diff probe + status mapping confirmed | `scripts/_probe_catalog_diff.mjs` (new) | none (read-only) |
| 4 | Live-readiness probe | `scripts/_probe_live_readiness.mjs` (new) | none (read-only) |
| 5 | Bulk catalog loader (if Path A) | `scripts/_load_phase2_catalog.mjs` (new) + JSON manifest | medium - writes catalog rows. Manifest is reviewable. |
| 6 | Spec doc drift fix | `docs/SOUSAI_CHARACTER_SPEC.md` (add rule 7 to §8) | none (doc) |
| 7 | SousAI tuning (if needed after CK-8) | `src/lib/sousai/generate.js` (threshold / top-K / prompt) | low - regression-evidenced |

**No PR for:** running `sousai-embed-corpus.mjs` (that's an ops action, not a code change). No PR for `archive_document` calls; the API already exists.

---

## 4. Production safety notes

- **Owner-only gate on `/playbook` is doing real work.** `canViewPlaybook` in the route handler restricts catalog + Sous to `k.fietek@kitchfix.com`. During the bulk catalog work, broken or half-loaded state is invisible to other operators. Do not relax this gate during Phase 2. Charter §7 puts broad release in the next phase.
- **`/playbook/sous-demo` is also owner-only.** Same gate. The Preview badge and the demo-route URL stay until the verifier-step decision is logged and the broader-release call is explicitly made.
- **Branch-and-PR for everything.** Per CLAUDE.md, no direct commits to `main`. Vercel preview is the manual verification surface; production is `main`.
- **Migrations don't auto-apply on deploy.** If any schema work surfaces in Phase 2 (probably none): Studio paste first, verify probe, then ship dependent code.
- **CLAUDE.md Danger Zones - do not edit without Kevin sign-off.** Current list: `src/lib/sheets.js`, `src/lib/cutover.js`, `src/lib/dataStore/*.js`, `src/lib/auth.js`, `src/middleware.js`, `vercel.json`, `next.config.mjs`, `package.json`, `docs/migrations/*.sql`, anything matching `.env*`. None of Phase 2's expected work touches any of these.
- **`archive_document` is atomic but `restore` is orchestrated.** If Phase 2 needs to retire a doc that's currently Live: archive is one API call, atomic, safe. If a retired doc needs to come back: restore via the API action, which re-embeds. Don't manually flip `archived = false` in the database; you'll have a visible-but-not-embedded ghost row.
- **The chunker is silent about content quality.** It will happily produce one massive blob from a docx that uses bold text instead of HEADING styles. The only signal that this happened is `path = "size-based-fallback"` in the embed script output. Watch for it.

---

## 5. Scope honesty - what is and is not in this phase

**In scope (engineering side):**
- Drive-sharing batch (step 1).
- Status mapping reconciliation and CK-2 confirmation.
- Catalog hygiene: ID validation, shelf assignment, status reconciliation.
- Pre-flight probes (drive-sharing, catalog-diff, live-readiness).
- Bulk catalog write (via the existing API actions).
- Bulk embed (existing script).
- Retrieval regression + no-answer-gap re-verification at 80 docs.
- **Decision** on whether to build the verifier step.
- The spec doc drift fix (rule 7 in `SOUSAI_CHARACTER_SPEC.md` §8).

**Not in scope:**
- Building the verifier step as a feature (Charter §7).
- Productionizing SousAI broadly (drop owner-only gate, move off `/playbook/sous-demo`, drop Preview badge, role-shaped answers at scale).
- Conversation memory for Sous.
- Status / class / shelf filter UI in the admin worklist.
- Bulk-select actions in the admin worklist.
- Strategic / moat / expansion-readiness analyses (Pass 10 of the Intelligence brief).
- TypeScript conversion (Phase 2 of the older migration arc, which closed 2026-06-12 - this is a different "Phase 2").
- Any schema work unless a real gap surfaces (and if it does, follow the migrations-don't-auto-apply rule).

**Nice to have if cheap (flag before adding - no silent scope):**
- Bulk-import path beyond the JSON-manifest CLI (CSV input, etc.).
- A `document_relationships` populator that runs alongside the catalog load.
- A retrieval-test harness that varies through phrasings of the same question, to find weak chunks.

---

## 6. The "what if" cases

**What if a Live promotion is rejected by `chk_live_complete`?** The error is `23514`. The pre-flight probe (Step 7) should have caught this; if it slips through, the missing field is one of `version` or `card_line` (with `is_historical = FALSE`). Fix the row via `update-document` API action, then re-promote.

**What if a Drive permission is missing at embed time?** `extract.js` throws with the message including "permission" or "caller does not have." The embed script catches this and prints the service account email + Drive file ID. Share, then re-run the embed with that doc ID.

**What if a doc chunks as `size-based-fallback` when it shouldn't?** The Google Doc's headings are bold text rather than real heading styles. Two options: fix the source Google Doc to use heading styles (the right answer), or accept the degraded retrieval for that one doc and document why (not great). Always prefer the fix.

**What if the no-answer gap compresses below 5 points?** Log the data in the CK-8 output. Decide on the verifier step. Two interim options without building the verifier:
- Raise `SOUSAI_SIMILARITY_THRESHOLD` from 0.28 to e.g. 0.30 if the no-answer top-similarities cluster below 0.30 reliably. Risk: pushes some weak-real answers into decline.
- Tighten the system prompt's "I don't have that documented" instruction to be more aggressive on partial-match cases.

**What if the rule-7 template guardrail leaks at 80 docs?** Re-run the brand-promise question (the test case that already proved the guardrail works). If it leaks: the template wording in STD-001 has moved closer to canonical phrasing than it used to, OR the company-identity corpus needs to land so there's real canonical content to outscore the template. The first is a content fix; the second is the Charter §5I corpus gap.

---

## 7. Done state

The runbook treats Phase 2 as done when all of the following hold:

- Every Live-bound document has a complete catalog row (passes `chk_live_complete`).
- Every Live document's Drive file is shared with the service account and renders in the catalog iframe.
- Every Live document has chunks in `document_chunks` (visible in the recon probe's "distinct docs embedded" count).
- The retrieval regression is green at 80 docs.
- The no-answer gap has been re-measured and the verifier-step decision is logged.
- The company-identity corpus is closed or explicitly deferred with a documented reason.
- The spec doc has rule 7 in §8.

Broad SousAI release - the moment the owner-only gate comes off and the Preview badge comes down - is the next phase. Charter §7 is explicit on this. Do not slide the scope.

---

Read [`03_ENGINEERING_ORIENTATION.md`](./03_ENGINEERING_ORIENTATION.md) for the cross-link map across this whole package.
