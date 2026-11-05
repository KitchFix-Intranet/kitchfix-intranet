# OPD State-of-the-System - Ground Truth Snapshot
**Prepared 2026-07-17 · Read-only orientation. Built-vs-planned flagged throughout. No edits, no PR.**

Method: file reads + PG SELECTs only. Every claim below is either a code path a grep points at, or a PG count. Nothing is derived from prior-session memory.

---

## §1. The pipeline (built vs. planned, per stage)

### 1.1 Authoring - **BUILT (Live)**

- **Corpus location:** `content/documents/*.mdx`
- **Count on disk:** 102 MDX files (matches active PG rows).
- **Schema:** `content/schema/frontmatter.schema.json` (draft-2020-12 JSON Schema, `additionalProperties: false`).
- **Required fields (4):** `id`, `title`, `doc_class`, `status`.
- **Full field inventory (30 top-level properties):**

| Field | Type | Notes |
|---|---|---|
| `id` | string | `^(PB|STD|POL|SOP|TPL|CHK|REF|AGR|FORM|POST|POSTER)-\d{3}(-[A-Z]+)?$`. POSTER-NNN maps to `doc_class=POST`. |
| `title` | string, minLength 1 | |
| `doc_class` | enum | PB / SOP / TPL / REF / STD / POL / AGR / FORM / POST / CHK |
| `shelf` | enum \| null | 6 shelves + null. |
| `subshelf` | enum \| null | HR-A..HR-F (People & Conduct sub-rail). |
| `status` | enum | Live / In Build / Pending / Placeholder / Blocked / Retired (6-set, pr-7-8). |
| `version` | string \| null | |
| `card_line`, `summary` | string \| null | |
| `keywords` | string[] | default `[]` |
| `surfaces` | string[] | Named widgets/workflows. Projected into `document_surfaces`. |
| `owner`, `approver` | string \| null | Role title (validator rejects personal names at gate). |
| `audience` | enum \| null | `operator` / `corporate` / `internal`. **Descriptive only - not an access gate.** |
| **`access_level`** | enum \| null | `unrestricted` / `restricted` / `slt`. Null → `unrestricted`. Overlay-preserved on projection. See §3. |
| `classification` | string | default `"KitchFix Internal"` |
| `lang` | enum | `en` / `es` |
| `in_corpus` | boolean | default `true`. False = out of SousAI corpus. See §5. |
| `applies_to` | union | `"company-wide"` OR object with `{states[], account, role}`. Feeds Fact override resolution. |
| `translation_of`, `source_version` | strings | -ES parity. |
| `approval` | object | `{approved_version, approved_by, approved_date, method}` (required for legal-class Live docs). |
| `last_reviewed`, `effective_date` | date \| null | |
| `review_interval_months` | integer | default 12. |
| `print_required`, `critical`, `pinned`, `derived` | boolean | |
| `sort_order` | integer | default 100. |
| `supersedes` | string \| null | Doc ID; projected as `superseded_by` relationship. |
| `relationships` | object[] | `{to, type, from_section?}`. Types: references / implements / supersedes / superseded_by / derived_from / related. |
| `obligations` | object[] | `{type, cadence, next_due?, owner, applies_to?}`. Feeds "compliance calendar + cert matrix" (framework noted, downstream consumer not audited this pass). |
| **`non_canonical_blocks`** | string[] | Section-ID list. **See §4 - declared but not consumed.** |

**Validation gate:** `scripts/content/validate.mjs` runs Ajv against this schema plus cross-doc checks (retired-pointer block, chk_live_complete for Live legal docs, `<Fact>` resolution, relationship-target existence, heading hierarchy, number hygiene, audience scope).

### 1.2 Projection - **BUILT (Live, running on main)**

- **Engine:** `scripts/content/project-catalog.mjs`.
- **Reads:** all MDX in `content/documents/`, `content/facts/operational-facts.yaml`.
- **Writes to PG (staging-then-swap):**
  - `documents` (UPSERT; **overlay-preserves `status` and `access_level`** on UPDATE, seeds on INSERT).
  - `document_relationships` (staging table → replace via `replace_document_relationships` RPC).
  - `document_surfaces` (staging → `replace_document_surfaces` RPC).
  - `document_content` (rendered HTML rows per doc; UPSERT).
  - **Archive path:** `archive_document(p_doc_id)` RPC flips `archived=true` AND deletes chunks atomically. Fires when a doc is absent from MDX (or archived-worthy).
- **Modes:** default = dry-run (writes `docs/opd/foundation/PROJECTION_DRYRUN.md`); `--apply` = write to PG.
- **B2 auto-projection Action:** `.github/workflows/opd-autoprojection.yml`.
  - Trigger: `push` to `main`, paths-filtered to `content/documents/**` (plus `workflow_dispatch` manual override).
  - Concurrency group `opd-autoprojection`, no cancel-in-progress (serial swap protection).
  - Steps: projection `--apply` first, then per-doc embed via `scripts/sousai-embed-doc.mjs` for every ACMR-changed MDX in the push range. POST-* skipped (poster class, no text extraction).
  - Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY.
  - **Verified running on main:** last three runs succeeded (`opd autoprojection` on PR#445 merge, PR#446 merge, and PR#447 merge, all this morning per `gh run list --branch main`).

### 1.3 Facts - **BUILT (Live), dimensioned overrides USED-BUT-QUARANTINED**

- **File:** `content/facts/operational-facts.yaml`.
- **Resolver:** `scripts/content/resolver.mjs` (`resolveFactTokens`) - substitutes `<Fact id="..." />` in body text with the resolved value + `[authority]` tag.
- **Scale on disk:** 86 structural entries. 8 flagged `override-bearing` (per header comment: 3 floor-confirmed - sick_accrual, overtime_threshold, record_retention_disciplinary - and 4 quarantined - meal_break_rule, rest_break_rule, pay_band_hourly, pay_band_leadership).
- **Override dimensions declared in schema:** `states[]`, `account`, `role` via `applies_to` (both on facts and on doc frontmatter).
- **Scale in bodies (from last projection dry-run):** 89 Fact tokens resolved across the corpus, 0 unresolved.
- **Are dimensioned overrides USED IN ANGER TODAY?** The 4 override-bearing facts flagged as `quarantined` carry `non_canonical: true` on the yaml side so the resolver doesn't teach the corpus a value that's not counsel-confirmed. State-variant population is deferred to F4/F5 (per file header): "State-variant population happens at F4 / F5 once counsel + Finance confirm." **Framework is live; the state-variant fill has not shipped.**

### 1.4 Reader (operator UI) - **BUILT (Live)**

- **Entry route:** `src/app/playbook/page.js` → `PlaybookClient.js`.
- **API:** `src/app/api/playbook/route.js`.
- **Reads from:** PG projection (`documents`, `document_relationships`, `document_content`, `document_surfaces`) via `src/lib/dataStore/opd.js`.
- **Renders:** the shelved catalog + per-doc detail (`document_content.html_body` rendered under a slide-over reader, `SlideOverReader.js`).
- **Access enforcement:** `filterDocuments(docs, isCorp)` then `canSeeDoc(tier, d.access_level)` (route.js:226-228). Retired always excluded (`filterDocuments`).

### 1.5 Cockpit (admin) - **BUILT (Live)**

- **Entry route:** `src/app/playbook/admin/AdminClient.js`.
- **Page gate:** `PLAYBOOK_OWNER = 'k.fietek@kitchfix.com'` - owner-only until launch.
- **Writeable fields (via `updateDocument` in `dataStore/opd.js`):** `status`, `pinned`, `access_level` (per route.js:136 `PATCHABLE` set).
- **Status is a PG overlay** - confirmed. `mdxToDocRow` (`scripts/content/lib/projection-core.mjs:38`) sources `status` from `existing` PG row on UPDATE; MDX only seeds on INSERT. Same for `access_level` (line 69). Cockpit flips flow **PG → cockpit → PG**, never through MDX.
- **Pinned:** overlay is `document_pins` table (post-pr-7-9); the deprecated `documents.pinned` column stays but is no longer read.

### 1.6 SousAI - **PARTIALLY BUILT (ingestion only; retrieval NOT built)**

Present files in `src/lib/sousai/`:

| File | Layer | Purpose | State |
|---|---|---|---|
| `extractMdx.js` | 2 | Reads MDX → resolver pipeline (Include + Fact + SourceGoverns + **stripNonCanonical**) → section list. | BUILT |
| `chunk.js` | 2 | Structure-aware primary + size-fallback chunking. | BUILT |
| `embed.js` | 3 | OpenAI `text-embedding-3-small`, 1536 dims, raw fetch. | BUILT |
| `store.js` | 3 | `replaceChunksForDoc(supabase, docId, language, rows)` - delete-then-insert per doc. | BUILT |
| `index.js` | Orchestrator | `embedDocument({docId, language, docsMap})` end-to-end. Also `embedPosterStub`, `restoreDocument`. | BUILT |

**NOT BUILT (searched, not present):**
- No `src/lib/sousai/retrieve.js` / `query.js` / `answer.js`.
- No `src/app/api/sousai/*` route. Verified: `find src/app/api -type d` shows `playbook, financial, service-calendar, auth, directory, dashboard, people, ops, cron` - **no `sousai`, no `sous`, no `ask`.**
- **The `match_document_chunks` retrieval RPC EXISTS in PG** (created in `docs/migrations/pr-7-11-opd-access-level.sql`; 3-arg variant with `allowed_levels TEXT[]`). **No JS caller of it exists.** Only reference in code is a comment in `src/lib/opdAcl.js:120` saying the RPC would accept `allowedAccessLevels(viewerT)` output.
- **No user-facing "ask" endpoint** anywhere in the repo.

**Live vector index?** Yes - `document_chunks` table has 1348 rows (see §5). It's populated, but nothing reads from it via retrieval yet.

---

## §2. Current corpus status (PG ground truth)

Source: `SELECT id, status, doc_class, access_level, archived FROM documents;` at 2026-07-17 ~11:15 local.

**Row counts:** 106 total = 102 active + 4 archived (LEGACY-PR, LEGACY-WOW, PB-099, STD-005).

### Status distribution (active only)

| Status | Count | % of active |
|---|---:|---:|
| Live | 45 | 44.1% |
| In Build | 31 | 30.4% |
| Retired | 16 | 15.7% |
| Pending | 8 | 7.8% |
| Placeholder | 2 | 2.0% |
| **Total active** | **102** | **100%** |

### Class distribution (active only)

| Class | Count |
|---|---:|
| TPL | 21 |
| POL | 20 |
| SOP | 15 |
| PB | 15 |
| REF | 10 |
| FORM | 9 |
| POST | 5 |
| STD | 4 |
| AGR | 2 |
| CHK | 1 |
| **Total** | **102** |

**Confirmed: 45 Live, ~44.1% of the active corpus.**

---

## §3. `access_level` - THE key question

### 3.1 Is it enforced?

**Yes, at the reader. No, at SousAI retrieval (because retrieval isn't built).**

Three enforcement sites are declared in `src/lib/opdAcl.js`:

| Site | Code path | State |
|---|---|---|
| Reader list bootstrap | `src/app/api/playbook/route.js:228` - `statusVisible.filter((d) => canSeeDoc(tier, d.access_level))` | **BUILT and enforced.** |
| Reader detail handler | `src/app/api/playbook/route.js:267` - `if (!canSeeDoc(tier, doc.access_level))` returns 403 (or 404 - see route). | **BUILT and enforced.** |
| SousAI retrieval RPC | `allowedAccessLevels(viewerT)` → `match_document_chunks(..., allowed_levels)` | **PG side exists (RPC accepts the argument, tier filter written in the migration). JS caller does not exist.** |

The gate is hierarchical (`ACCESS_ORDER = {unrestricted:1, restricted:2, slt:3}`, viewer >= doc = allowed). Membership is hardcoded in `opdAcl.js`:
- `SLT_EMAILS`: 6 entries (Kevin, Josh, Joe, Britt, Mariela, Sebastian).
- `RESTRICTED_EMAILS`: 3 entries (Ryan Moore, Shane Lynch, Dec Inthavone).
- Everyone else: `unrestricted`.

`viewerTier(email)` is fail-safe: unknown email → `unrestricted` (but `canViewPlaybook` gate blocks non-owner from the whole route today until launch).

### 3.2 How many docs currently set access_level != unrestricted?

**2 docs.**

| doc_id | access_level | status |
|---|---|---|
| **STD-001** | `restricted` | Live |
| **REF-007** | `slt` | (Retired, per §5 hygiene) |

The other 100 active docs are `unrestricted`. So the tier is enabled and used, but at trivial scale.

### 3.3 Wiring gap for slt-billing data

For the pricing-summit port (which is where slt matters), the practical question is whether an `slt`-tagged doc is safe from unintended reader exposure today. Assessment:

- **Reader gate: YES.** Any `access_level=slt` row is filtered out for non-SLT viewers by both the list and detail handlers. A non-SLT `@kitchfix.com` user can't fetch it via `/api/playbook`.
- **SousAI retrieval: N/A.** No retrieval endpoint exists, so no retrieval can leak. The doc IS embedded into `document_chunks` (embed pipeline doesn't currently filter on `access_level` - see §5), so its content sits in the vector store. That's inert until a caller of `match_document_chunks` ships.
- **The RPC ITSELF is tier-aware.** When retrieval ships, the correct call is `sb.rpc('match_document_chunks', { query_embedding, match_count, allowed_levels: allowedAccessLevels(tier) })`. The migration file `pr-7-11-opd-access-level.sql` documents this contract.

**Conclusion:** landing `access_level=slt` billing content today is safe on the reader path. It IS embedded into the vector store on ingest (not a leak today, because no retrieval), but **before SousAI retrieval ships, the retrieval caller must pass `allowedAccessLevels(tier)`**. If a caller ships without that arg, the 3-arg RPC will surface it - but nothing enforces the caller-side discipline in code today.

Rough scope to close the future gap:
- Add a retrieve helper (`src/lib/sousai/retrieve.js`) that always requires a `tier` argument and calls the 3-arg RPC. ~50 lines.
- Wire any future `/api/sousai/ask` (or equivalent) route through the helper. ~30 lines route wrapper + tier resolution.
- Optionally: refuse embedding for `access_level=slt` docs (belt-and-suspenders). Trivial guard in `embedDocument`. Trade-off: retrieval works for SLT viewers only after this guard fires - so filter at retrieval, not at ingest, is the cleaner shape.

### 3.4 Can we safely land slt billing data today?

**Yes for the reader.** No retrieval exists to leak through. The prerequisite build (retrieval helper that always passes `allowedAccessLevels`) can land alongside or ahead of retrieval itself, not ahead of billing content authoring.

---

## §4. `non_canonical` - the other guardrail

Two separate concepts share this word - important to keep them straight.

### 4.1 `<NonCanonical>...</NonCanonical>` MARKUP in body - **BUILT and enforced**

- Body-level XML wrapper (e.g. `<NonCanonical>Example: ...</NonCanonical>`).
- **Regex:** `NON_CANONICAL_RE = /<NonCanonical>[\s\S]*?<\/NonCanonical>/g` (in `scripts/content/resolver.mjs:30`).
- **Two paths:**
  1. **Display path** (`scripts/content/lib/md_to_html.mjs:305-320`) - `markNonCanonical` transforms the block into an Example callout (kept, visible on the reader).
  2. **SousAI ingestion path** (`src/lib/sousai/extractMdx.js:114`) - `stripNonCanonical` (from `resolver.mjs`) **removes the block entirely** before chunking.
- **Verified last projection reported 182 NonCanonical blocks** across the corpus (kept as Example on the reader, stripped from SousAI).
- **Consumed:** yes, both paths.

### 4.2 `non_canonical_blocks` FRONTMATTER FIELD - **DECLARED but NOT consumed**

- Frontmatter array of section IDs (`non_canonical_blocks: [...]`) at the doc level.
- **Schema description** (line 234): "List of section IDs in this doc that are example / specimen / template content - NOT canonical (defends SousAI hard floor rule 7)."
- **Grep for consumers:** `grep -rnE 'non_canonical_blocks' src scripts` → zero hits outside the schema file itself.
- **State: declared, not read anywhere.** SousAI's guardrail today is the body-level markup (§4.1), not the section-ID list in frontmatter.

### 4.3 The other yaml-side `non_canonical` flag - facts

- `operational-facts.yaml` header notes 4 quarantined override-bearing facts carry `non_canonical: true` (comment: "flagged non_canonical: true so the resolver knows the value is unresolved").
- **This is a facts-yaml-level flag, distinct from both the body markup and the frontmatter field.** Not audited here for consumers; the header claim is that the resolver honors it.

**Summary:** the `<NonCanonical>` markup is enforced at ingestion (stripped from chunks). The `non_canonical_blocks` frontmatter field is unused. If Kevin needs section-ID-level exclusion from SousAI at the metadata level, that consumer would need to be built.

---

## §5. Index hygiene

Ground truth from `document_chunks` table.

- **Total rows:** 1,348
- **Distinct doc_ids embedded:** 102

Cross-reference against `documents`:

| Category | Count | doc_ids |
|---|---:|---|
| Healthy (active, non-Retired) | 86 | (majority) |
| **Retired docs still in the index** | **16** | PB-004-ES, POL-005, POL-012, POL-016, POL-017, POL-018, REF-005-A, REF-005-B, REF-008, REF-009, SOP-003, SOP-011, SOP-013, SOP-016, TPL-015, TPL-017 |
| Archived docs still in index | 0 | (archive_document RPC does clean up correctly on archive) |
| Orphan chunks (doc missing) | 0 | |

### The known gap, confirmed

**When a doc is flipped to `Retired` in the cockpit** (a PG-status overlay change, no archive), **its chunks are NOT deleted.** The archive RPC (`archive_document`) does delete chunks - but the cockpit's "flip to Retired" path doesn't call archive_document. The 3 docs I retired earlier this session (REF-005-A, REF-005-B, TPL-015) show up in this list: their chunks are still in the index, right next to legitimate Live doc content.

That's 16 Retired docs currently in the vector store. When SousAI retrieval ships, without a filter these will surface as citable results.

### Additional gap: `in_corpus: false` MDX docs are embedded

3 docs with `in_corpus: false` in their MDX frontmatter have chunks in the index today:
- `PB-004-ES` (also Retired)
- `POL-006-ES` (Live)
- `POST-001-ES` (Live)

The embed pipeline (`embedDocument` in `index.js`) does not currently guard on `in_corpus`. Neither does the auto-projection workflow. If Kevin's convention is that `in_corpus: false` = exclude from the SousAI corpus, that's a second wiring gap.

### Rough scope to close

Two independent guards, both small:
1. **Prune-on-Retire:** cockpit's status-flip write path (`updateDocument` in `dataStore/opd.js`) checks if new status is `Retired` and, if so, calls `archive_document` OR a lighter `delete_chunks(doc_id)` helper. Alternatively, a nightly reconciliation job. ~30 lines.
2. **`in_corpus: false` skip in embed:** `embedDocument` reads the documents row for `in_corpus` (or reads MDX frontmatter directly), skips the ingest if false. ~10 lines. Plus a one-shot backfill DELETE for the 3 -ES docs already in.

Neither is urgent as long as retrieval isn't shipping today. Both should land before retrieval ships.

---

## §6. `/docs` vs `/content` boundary

**Confirmed. Stated plainly for the migration:**

- `/content/documents/*.mdx` = **THE corpus.**
  - Projected to PG on push to main (§1.2).
  - Chunked + embedded by SousAI (§1.6 - ingest half).
  - Rendered by the reader (§1.4).
  - Governed by `content/schema/frontmatter.schema.json` + `validate.mjs`.
- `/docs/**/*.md` = **developer / architecture / audit docs.**
  - Includes `docs/pricing-summit/`, `docs/audits/`, `docs/migrations/`, `docs/opd/`, `docs/RUNBOOK.md`, `docs/CONVENTIONS.md`, etc.
  - **Not projected** - `project-catalog.mjs` only reads `content/documents/`.
  - **Not rendered** - the reader route doesn't know about `/docs/`.
  - **Not SousAI-ingested** - `extractMdx.js` reads from `content/documents/<docId>.mdx`; no other reader.

The auto-projection Action's path filter (`content/documents/**`) is the mechanical guarantee that a change to `docs/**` does NOT trigger projection or embedding.

Confirmed with grep + workflow file: nothing in the OPD pipeline reads from `docs/**` except developer humans.

---

## §7. Summary numbers

- 102 active docs · 45 Live (44.1%) · 16 Retired active · 4 archived (excluded from corpus by design).
- 1,348 chunks embedded from 102 distinct doc_ids.
- 2 docs at `access_level != unrestricted` (STD-001 restricted, REF-007 slt).
- 3 enforcement sites for access_level (2 BUILT in reader, 1 declared for SousAI - waits on retrieval build).
- 0 consumers of the `non_canonical_blocks` frontmatter field; 182 body-level `<NonCanonical>` blocks handled correctly by both display + ingest paths.
- **19 chunk-index pollutants today** (16 Retired doc-sets + 3 `in_corpus:false` -ES doc-sets). Inert until retrieval ships.

## §8. Report file

Path: `docs/audits/OPD_STATE_OF_SYSTEM_2026-07-17.md`.

Untracked (no commit, no PR). Corpus files untouched.
