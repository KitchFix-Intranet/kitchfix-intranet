# Phase A · PR1 · Session handoff

**Built:** 2026-06-15
**Branch:** worktree on `feat/sousai-demo` (post-audit; the MDX foundation + audit reports are untracked - to be staged into a Phase A branch off main when this PR opens).
**Scope of this PR:** A1 schema foundation (migrations + pin-path code change) + A2 projection engine (dry-run only).
**Out of scope:** reader changes, AdminClient editing changes (beyond the pin path), SousAI / embedding, Drive code, any production catalog data write.

---

## What landed

### A1 - Schema migrations + pin-path code change

Three new migration files in `docs/migrations/`, all idempotent, all reviewed-before-apply.

| File | What it does | Rollback |
|---|---|---|
| **pr-7-8-opd-status-set.sql** | Migrates the 10 prod `Draft` rows to `In Build` then tightens `chk_documents_status` from the 7-set to the 6-set (`Live | In Build | Pending | Placeholder | Blocked | Retired`). The MDX foundation never used `Draft`; `Blocked` stays. | Restore the 7-set CHECK constraint. The Draft -> In Build data migration is NOT individually reversible (acceptable per the cutover decision). |
| **pr-7-9-opd-pins-overlay.sql** | Creates `document_pins (doc_id PK, pinned_at, pinned_by, is_historical, data_provenance)` with FK CASCADE to documents. Backfills one row per `documents` row where `pinned = true`. RLS disabled + service_role grants matching the other OPD tables. **Leaves `documents.pinned` in place** (later PR drops it once the overlay has been live long enough that regressions surface). | `DROP TABLE IF EXISTS document_pins;` + the app code revert restores reads + writes from `documents.pinned`. Non-destructive because we kept the column. |
| **pr-7-10-opd-content-table.sql** | Creates `document_content (doc_id, lang, html, content_hash, rendered_at, ...)` with PK `(doc_id, lang)` and FK to documents. Empty until projection populates it. | `DROP TABLE IF EXISTS document_content;` Safe - no FK targets it. |

**Apply order:** pr-7-8 -> pr-7-9 -> pr-7-10. Each is independent enough to apply alone if needed.

**App code change (rides in this PR):**
- `src/lib/dataStore/opd.js`: pinned is now sourced from `document_pins` via `decoratePinned` (post-query JS pass; rows ordered `sort_order ASC, title ASC` at the DB, then re-sorted in JS to put pinned first). New helpers `setPinned(id, email)` / `clearPinned(id)` write to the overlay.
- `src/lib/dataStore/index.js`: re-exports the two new helpers.
- `src/app/api/playbook/route.js`: drops `Draft` from `VALID_STATUSES`. The `update-document` action now intercepts `patch.pinned`, redirects it to `setPinned` / `clearPinned`, and removes it from the catalog patch before `updateDocument` runs. If the patch is pin-only, the response re-fetches via `getDocument` so the overlay-derived `pinned` is returned.
- `src/app/playbook/PlaybookClient.js` + `admin/AdminClient.js` + `_shared.js`: drop `Draft` from `STATUS_CHIP_ORDER`, `STATUS_EDIT_OPTIONS`, `STATUS_COLORS`, `ALL_STATUSES` (all the surfaces that enumerate the status set).

### A2.0 - existing pipeline survey

Reused as-is from the F1-F6.5 MDX foundation work:

- `scripts/content/resolver.mjs` - `resolveFactTokens`, `resolveIncludeTokens` (functional after F6.5), `expandSourceGoverns`, `stripNonCanonical`, `getSectionBody` (section-walker). The projection script imports these directly.
- `scripts/content/lib/frontmatter.mjs` - `splitMdx`, `loadYaml` (gray-matter + js-yaml, ISO-date normalization).
- `scripts/content/lib/schema_validator.mjs` - Ajv (draft 2020-12) against the JSON schemas. The projection re-validates per-doc on every run.
- `scripts/content/project_pilot.mjs` - the existing per-doc resolution + flatten + chunk preview. The projection follows the same pipeline order (Include first, then Fact) but renders to display HTML instead of flat corpus text.

**Built new** (because the existing pipeline strips/flattens for the corpus, not the display):

- `scripts/content/lib/md_to_html.mjs` - a focused Markdown -> HTML converter matched to the corpus's actual subset (headings, paragraphs, lists, GFM tables, blockquotes including ANCHOR/NOTE/CRITICAL callouts, bold/italic, inline + fenced code, links, horizontal rules). Also `markNonCanonical` which converts `<NonCanonical>...</NonCanonical>` to a labeled `> EXAMPLE:` blockquote (kept for display; the corpus-stripping path is unchanged).

### A2.1 - surfaces frontmatter + backfill

- Schema: `content/schema/frontmatter.schema.json` adds `surfaces` (string[], default []). Also drops `Draft` from the `status` enum to match pr-7-8.
- Backfill: `scripts/content/_apply_a21_surfaces_backfill.mjs` ran and added `surfaces:` blocks to 6 docs (AGR-001, PB-002, POST-001, POST-002, POSTER-001, SOP-002) covering all 10 production `document_surfaces` rows. MDX is now the source of truth for surfaces.

### A2.2 - projection script

`scripts/content/project-catalog.mjs` builds the full plan. Run with:

```bash
node --env-file=.env.local scripts/content/project-catalog.mjs            # default: --dry-run
node --env-file=.env.local scripts/content/project-catalog.mjs --dry-run  # explicit
node --env-file=.env.local scripts/content/project-catalog.mjs --apply    # REFUSED in PR1 (built but not executable)
```

Pipeline:
1. Parse MDX corpus (101 files, 0 parse errors).
2. Validate (schema via Ajv + cross-doc: status in 6-set, shelf in 7-set, doc_class matches ID prefix, Live docs satisfy `chk_live_complete`, every `relationships.to` / `translation_of` / `supersedes` target exists in MDX).
3. Resolve Includes, then Facts, expand SourceGoverns, mark NonCanonical as Example, render to HTML.
4. Read live Postgres snapshot of `documents`, `document_relationships`, `document_surfaces`, `document_pins`, `document_content`.
5. Compute insert/update/archive sets + planned relationships (authored + derived inverse for `supersedes <-> superseded_by`) + planned surfaces + planned content rows.
6. Write `docs/opd/foundation/PROJECTION_DRYRUN.md` + 5 sample HTML files in `scripts/content/.dryrun-samples/` (gitignored).

The `--apply` path is built as a staging-then-swap plan but refuses to execute. PR3 / Phase A3 is where apply runs.

### A2.3 - dry-run output

**`docs/opd/foundation/PROJECTION_DRYRUN.md` headline numbers:**

| Item | Count |
|---|---|
| MDX docs parsed | 101 |
| Parse errors | 0 |
| Validation errors | **0** (PR1 follow-up cleared 2 supersedes_missing; PR1 collision-fix removed 4 redundant supersedes pointers) |
| Live PG documents | 42 |
| Would INSERT | 63 |
| Would UPDATE | 38 |
| Would ARCHIVE | 3 (LEGACY-PR, LEGACY-WOW, STD-005 - last item is Kevin's call) |
| Relationships planned | **369** authored only |
| - relationships block entries | 369 |
| - supersedes frontmatter field | **0** (4 removed at the collision-fix pass) |
| Surfaces planned | 10 |
| Content rows that would render | 101 |
| Stray tokens (unresolved) | 0 |

Relationship count history across this PR: 381 (initial: 372 authored + 9 derived inverse) → 373 (post Task 2: inverse-derivation removed; 2 supersedes pointers also removed in Task 1) → **369** (post collision-fix: 4 redundant forward `supersedes:` frontmatter fields removed).

**Sample HTML files** (gitignored; for Kevin to eyeball locally):

- `SOP-008.html` (long SOP, many Fact resolutions including 41F / 0F / 135F temperatures)
- `POL-003.html` (long POL with the F6.5 supplement protocol; the doc whose §06 is the Include target)
- `SOP-009.html` (the only doc with an `<Include>` - POL-003 §06 inlined and the F6.5 "client-directed" wording shows through correctly)
- `POST-001.html` (English bilingual exemplar)
- `POST-001-ES.html` (Spanish counterpart - minimal stub matching source)

### Validation findings - 2 fail-loud diagnostics for Kevin

Both were `supersedes_missing`. **CLEARED in the PR1 follow-up pass (2026-06-15):**

1. AGR-001 supersedes LEGACY-PFS-CONF - the `supersedes:` field was removed from `content/documents/AGR-001.mdx`. Body lineage note: AGR-001's body does **not** mention what it supersedes; no prose was invented per the brief.
2. SOP-001 supersedes LEGACY-PR - the `supersedes:` field was removed from `content/documents/SOP-001.mdx`. Body lineage note: SOP-001's body does **not** mention what it supersedes; no prose was invented.

LEGACY-PFS-CONF / LEGACY-PR / LEGACY-WOW were NOT added as MDX placeholder stubs (per brief: "we are not keeping docs alive just to be supersede-targets"). The supersedes pointers were historical metadata that lost meaning when the LEGACY rows became PG ghosts.

**Post-fix dry-run: 0 validation errors. Idempotent.**

### Inverse-edge audit (PR1 follow-up, Task 2)

**Finding:** the projection's `INVERSE_REL` derivation step would have caused double-rendering. Verified end-to-end:

- `dataStore/opd.js:114-127` `getRelationships(id)` returns ALL rows where `from_doc=id OR to_doc=id` - both directions of every stored edge.
- `route.js:240-260` enrich block computes `direction: 'in'|'out'` per request based on `r.from_doc === id`. Each request returns ONE entry per stored edge, with the appropriate direction.
- `SlideOverReader.js:380-386` maps each enriched entry through `RELATIONSHIP_LABELS_OUT[r.rel_type]` for direction=out OR `RELATIONSHIP_LABELS_IN[r.rel_type]` for direction=in.

**Concretely:** one stored edge "A supersedes B" already renders correctly from both ends - "Supersedes: B" on A's reader and "Replaces (older): A" on B's reader. Storing an additional derived `B superseded_by A` would have shown A's reader BOTH "Supersedes: B" (authored) AND "Replacement for: B" (derived superseded_by inverse, looked up via LABELS_IN). Same relationship, two rendered entries, conflicting labels.

**Fix applied:** the `INVERSE_REL` block + the inverse-derivation step were removed from `project-catalog.mjs` (`computeDiff`). Each authored edge now stores exactly once. Direction handles the inverse at read time.

**Bidirectional-authoring collision check (Task 5 of follow-up).** After confirming the reader inverts via `direction`, ran a second pass to verify no AUTHORED collisions remain - i.e., no pair where both ends author the same X↔Y lineage from opposite directions. **3 collisions found and resolved:**

| Predecessor (Retired) | Successor (active) | Resolution |
|---|---|---|
| POL-017 (relationships: superseded_by → POL-015) | POL-015 (frontmatter: supersedes: POL-017) | Removed `supersedes:` from POL-015 |
| REF-008 (relationships: superseded_by → POL-019) | POL-019 (frontmatter: supersedes: REF-008) | Removed `supersedes:` from POL-019 |
| SOP-003 (relationships: superseded_by → PB-003) | PB-003 (frontmatter: supersedes: SOP-003) | Removed `supersedes:` from PB-003 |

Plus a 4th orphan: **STD-002 had `supersedes: STD-002`** (self-reference). Body summary explicitly says "v0.2 promotes the standard to live status from v0.1 draft" - a normal in-doc version bump, not a supersedes lineage. No real predecessor exists. **Removed the `supersedes:` field entirely** (no corrected pointer to substitute - there's nothing to point at).

Authoring convention preserved across all 6 surviving lineage edges: the **Retired predecessor** authors `superseded_by: <successor>` in its `relationships:` block. The successor doesn't duplicate the lineage; the reader renders both ends via `direction: in|out`.

**Label sanity check on the IN-direction labels for singly-stored edges:** all five active rel_types read correctly. None flagged for A3 reader-PR follow-up.

| rel_type | OUT label | IN label | Reads OK as inverse? |
|---|---|---|---|
| `references` | "See also" | "Part of" | Yes |
| `implements` | "Implements" | "Implemented by" | Yes |
| `supersedes` | "Supersedes" | "Replaces (older)" | Yes |
| `derived_from` | "Based on" | "Source for" | Yes |
| `related` | "Related" | "Related" | Yes |

`superseded_by` would only fire on an explicitly-authored `superseded_by` entry (rare in practice; not used in the corpus); its labels "Superseded by" / "Replacement for" are also coherent. Nothing to flag.

**Relationship count delta:** authored 372 + derived inverse 9 = 381 → authored 373 + derived 0 = **373**. The +1 in authored is a noise-level recount; the meaningful change is the 9 derived inverse edges no longer being stored.

### STD-005 - confirm-intended-archive review item (PR1 follow-up, Task 3)

STD-005 "Project OPD Playbook" is in the would-archive set but is NOT a validation error and does NOT block a green dry-run. Reporting for Kevin's decision before PR3 apply.

**What it is:** the meta/spec doc that documents the OPD system itself. The pr-7-1 schema header reads "Reconstructed from STD-005 §10"; the seed row comment says it "self-registered" as row one of the catalog it defines. Production state: status In Build, shelf "Brand & Standards", audience **internal**, is_historical=true, data_provenance=batch_rebuild, no source_drive_id, 0 relationships pointing at it.

**MDX state:** no `STD-005.mdx` exists in `content/documents/`. The doc lives ONLY in Postgres.

**Inferred reason for absence from MDX:** the F1-F6.6 work scoped operational documents (PB / SOP / POL / FORM / TPL / POST / etc.) - things operators consume. STD-005 is project-meta scaffolding, the kind of artifact that lives in `docs/` rather than `content/documents/`. Intentional-vs-missed is ambiguous; not presumed either way.

**Kevin decides between three options before PR3:**
- a. **Let it archive** (default - what the current dry-run plans). audience:internal means almost no UI surface loss; admin worklist drops it too; the catalog row stays in the DB for audit. Recommended if STD-005's content lives elsewhere as project docs.
- b. **Author STD-005 into MDX** as a real catalog row before apply runs. Would drop the would-archive count from 3 to 2.
- c. **Move STD-005 contents to `docs/` permanently** and treat its current PG row as legacy (still archives).

If no decision is recorded, the projection archives it.

---

## What was deliberately NOT done

- **No production catalog data writes.** The dry-run only reads from PG.
- **`--apply` mode is built but refuses to execute.** PR3 runs apply after Kevin reviews the dry-run.
- **No reader changes.** SlideOverReader still iframes Drive previews.
- **No AdminClient editing changes beyond the pin path move and the Draft drop.**
- **No SousAI / embedding changes.** The embedding extractor still hits Drive.
- **No Drive code touched.**
- **`documents.pinned` column not dropped.** Deferred to a later PR (post-overlay-live stability).
- **`source_drive_id` / `source_drive_id_es` not touched by projection.** Operator/admin choices preserved.

---

## Gating before PR3 (apply)

1. **Kevin reviews `docs/opd/foundation/PROJECTION_DRYRUN.md`** (now clean - 0 validation errors) + eyeballs the 5 sample HTML files in `scripts/content/.dryrun-samples/`.
2. **Kevin applies the 3 A1 migrations to production** (pr-7-8, pr-7-9, pr-7-10) via Studio - same flow as the existing pr-7-* migrations.
3. **Kevin decides STD-005 fate** (archive / author into MDX / move to docs/). If undecided, the projection archives it as planned.
4. **Kevin merges this PR** (A1 code + A2 script + handoff).
5. **PR3 / Phase A3 runs `--apply`** under a Kevin-monitored execution.

---

## Files touched in this PR

### New
- `docs/migrations/pr-7-8-opd-status-set.sql`
- `docs/migrations/pr-7-9-opd-pins-overlay.sql`
- `docs/migrations/pr-7-10-opd-content-table.sql`
- `scripts/content/project-catalog.mjs`
- `scripts/content/lib/md_to_html.mjs`
- `scripts/content/_apply_a21_surfaces_backfill.mjs`
- `docs/opd/foundation/PROJECTION_DRYRUN.md`
- `docs/opd/foundation/PHASE_A_PR1_HANDOFF.md` (this file)
- `scripts/content/.dryrun-samples/*.html` (gitignored)

### Modified
- `src/lib/dataStore/opd.js` - pin overlay read path + setPinned / clearPinned helpers
- `src/lib/dataStore/index.js` - re-export setPinned, clearPinned
- `src/app/api/playbook/route.js` - drop Draft from VALID_STATUSES + redirect pinned patches to overlay
- `src/app/playbook/PlaybookClient.js` - drop Draft from STATUS_CHIP_ORDER
- `src/app/playbook/admin/AdminClient.js` - drop Draft from STATUS_EDIT_OPTIONS
- `src/app/playbook/_shared.js` - drop Draft from STATUS_COLORS + ALL_STATUSES
- `content/schema/frontmatter.schema.json` - add `surfaces` field; drop Draft from status enum
- `scripts/content/validate.mjs` - drop Draft from VALID_STATUSES
- `.gitignore` - add `scripts/content/.dryrun-samples/`
- 6 MDX docs (AGR-001, PB-002, POST-001, POST-002, POSTER-001, SOP-002) - surfaces backfill
- `docs/PROJECT_DASHBOARD.md` - add Phase A note

---

## Open questions still open (from the engine audit)

These remain on the table for Kevin / chat to land before PR3:

1. Bilingual pattern - `source_drive_id_es` column model vs. suffix-ES MDX pattern.
2. Poster render path post-cutover.
3. "Open in Drive" button - remove or repoint to GitHub.
4. "Ask SousAI" hero bar wiring - this PR vs. F8.
5. `document_surfaces` editability - read-only post-projection or operator-editable in PG?
6. `is_historical` flag - projection writes `false` (current behavior); confirm strictness is wanted.
