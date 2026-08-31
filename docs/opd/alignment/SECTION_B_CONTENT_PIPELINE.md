# Section B: Content Pipeline

## B6: /content -> live catalog

**Projection job.** `scripts/content/project-catalog.mjs` (836 lines). Node script, entry `main()` at `:733`. Reads MDX from `content/documents/`, validates, resolves `<Include>`/`<Fact>`/`<SourceGoverns>`/`<NonCanonical>` tokens, renders to HTML via `scripts/content/lib/md_to_html.mjs`, snapshots live Postgres, computes a diff, then in `--apply` mode runs `executeApply()` (`:326-441`). [verified]

**Trigger.** `.github/workflows/opd-autoprojection.yml`. [verified]
- `on: push` to `main`, `paths: content/documents/**` (workflow file lines 30-34). Also `workflow_dispatch` for manual runs. [code-read]
- Concurrency group `opd-autoprojection`, non-cancelling, so pushes queue rather than race the atomic swap. [code-read]
- Job steps: checkout with `fetch-depth: 0` -> `npm ci` -> `node scripts/content/project-catalog.mjs --apply` -> diff `PUSH_BEFORE..PUSH_AFTER` with `--diff-filter=ACMR` on `content/documents/*.mdx` and call `scripts/sousai-embed-doc.mjs <id>` for each changed doc (skips `POST-*` as no-text-extraction class). [code-read]

**Not a Next.js runtime read; not a Next.js build step.** The Next build produces no projection artifact - projection is a separate GitHub Actions job that fires only after merge to `main`. The Next server reads the projection's OUTPUT (Postgres tables) at request time via `src/lib/dataStore/opd.js`. [code-read]

**Target tables (five, in step order inside `executeApply`, `project-catalog.mjs:326-441`).** [code-read]
1. `documents` - UPSERT by `id` (`:346-357`). Preserves operator-owned fields (`source_drive_id`, `source_drive_id_es`, `archived`, `archived_at`, `created_at`, `storage_path`) by omitting them from the payload; `status` and `access_level` preserved via `mdxToDocRow(fm, existing)` in `scripts/content/lib/projection-core.mjs:33-73`.
2. `document_chunks` (via `archive_document` RPC) - archives docs present in PG but absent from MDX (`:360-367`). Atomic archive+chunk-delete per pr-7-7.
3. `document_relationships` - via `replace_document_relationships(p_rows)` RPC (`:379-397`). Atomic delete+insert inside a plpgsql function; runtime count guard halts on mismatch.
4. `document_surfaces` - via `replace_document_surfaces(p_rows)` RPC (`:403-417`). Same atomic pattern + count guard.
5. `document_content` - UPSERT on `(doc_id, lang)` with `html`, `content_hash`, `rendered_at` (`:420-434`).

**Deliberately NOT touched:** `document_pins` (`:28-30` comment: "pin is UI state, not document metadata; the projection reads pins only to preserve the count in the dry-run report"). [code-read]

**Post-projection.** The workflow's second step then per-doc calls `scripts/sousai-embed-doc.mjs <id>` (chains to `embedDocument` at `src/lib/sousai/index.js`) to write SousAI chunks/embeddings for each changed doc. [code-read]

**One document end-to-end (SOP-008 example).**
1. Author edits `content/documents/SOP-008.mdx` and pushes to `main` (or the cockpit's PR auto-merges - see B7). [verified]
2. `opd-autoprojection` workflow triggers because the path matches `content/documents/**`. [verified]
3. `project-catalog.mjs` parses all 129 MDX files (`parseCorpus` `:93-108`), validates each against `content/schema/frontmatter.schema.json` + cross-doc rules (`validateCorpus` `:111-213`). [code-read]
4. For SOP-008: `resolveAndRender` at `:224-251` runs `resolveIncludeTokens` -> `resolveFactTokens` (ctx = `{ applies_to: fm.applies_to || "company-wide" }`) -> `expandSourceGoverns` -> `markNonCanonical` -> `renderMarkdownToHtml`, producing `{ html, content_hash, lang, ... }`. [code-read]
5. `readLiveSnapshot` (`:254-293`) reads current `documents/document_relationships/document_surfaces/document_content/document_pins`. [code-read]
6. `computeDiff` (`scripts/content/lib/projection-core.mjs:130-`) categorises SOP-008 as INSERT/UPDATE/no-op vs the live row. [code-read]
7. `executeApply` does the 5-step ordered write above; SOP-008's rendered HTML lands as one `document_content` row keyed `(SOP-008, en)`. [code-read]
8. Workflow then runs `node scripts/sousai-embed-doc.mjs SOP-008` for corpus embedding. [code-read]
9. Reader at `/playbook/d/SOP-008` reads `documents` + `document_content` via `getDocument`/`getDocumentContent` in `src/lib/dataStore/opd.js` -> `src/app/api/playbook/route.js:259-266` -> renders `content_html` via `dangerouslySetInnerHTML` in `DocumentFullPageClient.js:489`. [code-read]

**129 -> 113 delta.** [verified] The 16 delta are the 16 MDX files that carry `status: Retired` in their frontmatter, confirmed by `grep -c '^status: Retired' content/documents/*.mdx` returning 16. The reader's `listDocuments` in `src/lib/dataStore/opd.js:74-78` excludes them with `.neq("status", "Retired")` in the default (active) mode, and `filterDocuments` at `src/lib/opdAcl.js:282-287` re-asserts the same guard (`d.status !== 'Retired'`). `visibleStatuses(isCorporate)` at `:274-279` never includes 'Retired'. So `129 total - 16 Retired = 113 visible`. The prompt's phrasing "16 archived" is slightly imprecise: the docs are `status='Retired'` in both MDX and PG - not `archived=true`. `archived` is a separate boolean flipped only by the `archive_document` RPC (currently 4 rows per the last dry-run at `docs/opd/foundation/PROJECTION_DRYRUN.md`).

## B7: Editor publish path

**Editor.** `MdxEditorSlideOver` in `src/app/playbook/admin/AdminClient.js:1743-`. Loads via `GET /api/playbook?action=mdx-source&id=<DOC-ID>` (`AdminClient.js:1783-1799`); mdx-source handler at `src/app/api/playbook/route.js:411-510` fetches raw MDX from GitHub Contents API, parses with `gray-matter`, normalizes YAML dates, returns `{ id, sha, frontmatter, body }` with `Cache-Control: no-store, private` (line 505-508). [code-read]

**Save handler.** `handleSave` at `AdminClient.js:1804-1867`: `POST /api/playbook?action=commit-mdx` with `{ id, frontmatter, body, sha }`. [code-read]

**"Publish through the PR gate" - the mechanical flow (`src/app/api/playbook/route.js:867-1267`).** [code-read]
1. **Validate frontmatter** against JSON schema via `@/lib/opd/validateFrontmatter` (`:916-923`). 422 on failure.
2. **MDX compile-check** via `@mdx-js/mdx compile()` (`:927-934`). 422 on failure.
3. **Stale-sha guard against main**: fetch current file from GitHub, compare `sha`; 409 if main advanced (`:942-982`).
4. **Round-trip-faithful serialize** via `@/lib/opd/serializeMdx` (`:985-998`). No-op detection: return `{ unchanged: true }` when byte-identical (`:1001-1003`).
5. **Branch write**: derive `opd-edit/<DOC-ID>`; create the branch off `main` if missing (`:1064-1125`), GET the file's blob sha on THAT branch (`:1131-1151`), PUT the new content to the branch (`:1153-1182`). Commit message `opd: edit <id> via cockpit`, committer `OPD Authoring <noreply@kitchfix.com>`.
6. **Open or find PR** with `head=opd-edit/<id>`, `base=main` (`:1184-1221`).
7. **Enable GitHub native auto-merge (GraphQL, mergeMethod: SQUASH)** via `enablePullRequestAutoMerge` mutation (`:1229-1256`). Non-fatal on "already enabled" errors.
8. Return `{ status: "submitted", pr_number, pr_url, branch, auto_merge_enabled }`.

**Why the PR gate exists.** Comment at `:867-891`: "Direct PUTs to main are blocked by ruleset 16364953 (Pull request required; required status check `Playwright tests`)". Auto-merge requires that check to pass, then the PR merges to `main`, which then triggers the `opd-autoprojection` workflow described in B6. [code-read]

**"Pending edits" indicator.** `GET /api/playbook?action=pending-edits` (`route.js:512-571`) lists open PRs whose head starts with `opd-edit/`, so a stuck/failing PR is visible in the cockpit. [code-read]

**Overlay path (status/access/pin edits) is separate from MDX publish** - see B10. Those never go through GitHub. [code-read]

## B8: Reader render path

**Resolved MDX -> Postgres HTML column -> `dangerouslySetInnerHTML`.** Drive is a legacy fallback only. [code-read]

**Route.** `/playbook/d/[docId]/page.js` (server component, 27 lines) -> `DocumentFullPageClient.js` (client) fetches `GET /api/playbook?action=document&id=<DOC-ID>`. [code-read]

**API handler.** `src/app/api/playbook/route.js:247-336` (`action === "document"`). Parallel reads (`:259-265`): `getDocument`, `getRelationships`, `getSurfaces`, `getDocumentContent(id, "en")`, `getDocumentContent(id, "es")`. Response includes `content_html`, `content_html_es`, `drive_view_url`, `drive_preview_url`, `drive_view_url_es`, `drive_preview_url_es`. [code-read]

**getDocumentContent.** `src/lib/dataStore/opd.js:193-203` selects `html, content_hash, rendered_at` from `document_content` on `(doc_id, lang)`. Returns null on miss. [code-read]

**Render decision** in `DocumentFullPageClient.js:484-510`: if `activeHtml` (from `content_html`) exists -> `<div dangerouslySetInnerHTML={{ __html: activeHtml }} />` at `:489`; else if `activeDriveUrl` -> "Open in Drive" link (no iframe on full-page); else empty state. [code-read]

**Slide-over reader** (`SlideOverReader.js:135-283`) uses the same three-way fallback but renders the Drive PDF as an actual `<iframe>` at `:277-` when `content_html` is missing. [code-read]

**One traced example (SOP-008 in full-page reader).**
1. Client mounts, calls `/api/playbook?action=document&id=SOP-008`. [code-read]
2. API calls `getDocumentContent("SOP-008", "en")` -> returns the row's `html` (populated by the projection's step-5 UPSERT into `document_content`). [code-read]
3. Client renders `<div dangerouslySetInnerHTML={{ __html: html }} />`. [code-read]
4. No Drive fetch. No MDX resolve. No React-server-side MDX compile. The HTML is a static string produced at projection time by `renderMarkdownToHtml` in `scripts/content/lib/md_to_html.mjs`. [code-read]

**Drive-fetch involvement.** Only in the fallback branch when `document_content` has no row for that (doc, lang). The comment at `SlideOverReader.js:154-158` calls this a "Phase A3 dual-path" that "A7 retires once every Live doc has a content row". Doc detail carries `source_drive_id`, `source_drive_id_es` from the `documents` row (schema `pr-7-1-opd-schema.sql:55`); the API composes the `drive_view_url` / `drive_preview_url` at `route.js:306-320`. No server-to-Drive fetch anywhere in the read path; the Drive URL is just constructed as `https://drive.google.com/file/d/${source_drive_id}/preview` and the browser iframe (or a link) does the load. [code-read]

## B9: Facts resolver at read time

**There is no read-time facts resolver.** The reader serves pre-rendered HTML from `document_content`. Facts are resolved at **projection time**, once, per doc, using only the document's own `applies_to`. [code-read]

**Where facts resolve.**
- `scripts/content/resolver.mjs:41-109` (`resolveFact`) is the resolution function. It CAN match overrides by `state` (contained in `applies_to.states`), `account` (exact match to `applies_to.account`), and `role` (exact match to `applies_to.role`), picking the most-specific override (most matching dims wins) or falling back to default. Scores at `:63-82`. [code-read]
- Called from `scripts/content/project-catalog.mjs:229` (`resolveAndRender`) with `factCtx = { applies_to: fm.applies_to || "company-wide" }` (`:226`). [code-read]
- Also called from `src/lib/sousai/extractMdx.js:112` with the SAME doc-scoped ctx (`:105`: `const ctx = { applies_to: fm.applies_to || "company-wide" }`). [code-read]

**The ctx is DOC-scoped, not VIEWER-scoped, in every current call site.** [verified] grep of `/src` for `applies_to.*account` / `applies_to.*role` / `resolveFact` returns no viewer-driven ctx anywhere in the app - only the projection/embed pipelines, both of which read `fm.applies_to`. [verified]

**Corpus effect.** For an override-bearing fact in a `applies_to: "company-wide"` doc, the resolver emits `"<default value> (varies by <dimensions>)"` (`resolver.mjs:99-108`) - the "quarantined" qualifier. Overrides only fire when a doc's own frontmatter narrows scope.

**Verdict on Academy reuse.** **Cannot be reused as-is; must be extended (or wrapped).**

Reasons: [code-read]
1. The resolver machinery for account/role matching exists and is correct - the primitives are reusable.
2. But no piece of it runs at read time. The resolver runs once, at projection, and burns the resolved string into `document_content.html`. A viewer's account/role never enters the pipeline.
3. Academy assignment resolution needs per-viewer resolution ("does THIS user, at THIS account, in THIS role, owe THIS training?") - the exact opposite of "resolve once at author time for the whole company".
4. The `obligations` frontmatter block (`content/schema/frontmatter.schema.json:176-226`) has the shape (per-obligation `applies_to` with `states/account/role`) but is unpopulated across all 129 docs, and the only consumer is `scripts/content/generate_derived.mjs` which builds a company-wide calendar (`.generated.mdx` output), not per-viewer assignments.
5. Academy needs a **new read-time resolver** that takes `(viewer_account, viewer_role)` as ctx and evaluates each doc's `obligations[]` against that ctx. It can share `resolveFact`'s scoring pattern (`resolver.mjs:60-82`), but the surface (called from an API handler on each request with a session-derived ctx) is entirely new.

## B10: status/access/pin seam

**Established fact:** these three fields are the operator-editable overlay that survives across projection applies while MDX authors everything else. This is the existing precedent for the content-vs-Postgres split.

**Where each lives (schema).** [code-read]
- `status` - `documents.status TEXT NOT NULL` with CHECK constraint (`docs/migrations/pr-7-1-opd-schema.sql:44,79-81`).
- `access_level` - `documents.access_level TEXT NOT NULL DEFAULT 'unrestricted'` (`docs/migrations/pr-7-11-opd-access-level.sql:74-82`), CHECK in `{unrestricted, restricted, slt}`.
- `pin` - **separate table `document_pins`** (`docs/migrations/pr-7-9-opd-pins-overlay.sql:54-67`). PK `doc_id` FK to `documents(id) ON DELETE CASCADE`. Rows carry `pinned_by`, `pinned_at`. Presence = pinned. `documents.pinned` column still exists (`pr-7-1-opd-schema.sql:58`) but is no longer read; column drop deferred (`src/lib/dataStore/opd.js:124-127` comment).

**Projection preservation** (this is what makes it a "seam"). `scripts/content/lib/projection-core.mjs:33-73` (`mdxToDocRow`):
- Line 38: `status: existing ? existing.status : fm.status` - MDX seeds on INSERT, PG wins on UPDATE.
- Line 69: `access_level: existing ? existing.access_level : (fm.access_level || "unrestricted")` - same pattern.
- `pinned` is omitted entirely from the projection payload (the field isn't in `mdxToDocRow`'s output at all); `document_pins` is never touched by the projection (`project-catalog.mjs:28-30` comment).
- `diffRow` at `projection-core.mjs:84-102` deliberately excludes `status` and `access_level` from the fields list (`:80-83` comment: "status + access_level are overlay-preserved... they are deliberately NOT in the fields list").

**Read paths.** [code-read]
- `status` and `access_level` - `getDocument` in `src/lib/dataStore/opd.js:164-185` (`select("*")` from `documents`).
- `access_level` filter - server-side at `src/app/api/playbook/route.js:229` (`.filter((d) => canSeeDoc(tier, d.access_level))`) using `viewerTier(email)` -> `canSeeDoc(tier, level)` from `src/lib/opdAcl.js`. Per-doc gate at `route.js:274-277` returns 404 on tier mismatch (not 403, so a viewer can't probe existence).
- `pin` - `decoratePinned` in `src/lib/dataStore/opd.js:141-158`. Batch SELECT of `document_pins.doc_id` for the row set; row-level overwrite `r.pinned = pinSet.has(r.id)`. `listDocuments` calls it at `:91`. Single-doc `getDocument` does its own overlay read at `:173-174`.

**Write paths.** [code-read]
- `status` and `access_level` - `POST /api/playbook?action=update-document` at `src/app/api/playbook/route.js:709-759`. Owner-gated. Allowlist `WRITABLE_FIELDS_A = new Set(["status", "pinned", "access_level"])` at `:136-138`. Per-field validator at `:144-180` (VALID_STATUSES, VALID_ACCESS_LEVELS enum checks). Delegates to `updateDocument(id, catalogPatch)` in `src/lib/dataStore/opd.js:287-311` which UPDATEs `documents` and stamps `updated_at`.
- `pin` write - intercepted BEFORE `updateDocument` call at `route.js:723-725` (`const pinChange = ("pinned" in v.clean) ? v.clean.pinned : undefined; ... delete catalogPatch.pinned`), then routed to `setPinned(id, actualEmail)` or `clearPinned(id)` at `:728-732`. Those helpers at `src/lib/dataStore/opd.js:317-332` UPSERT-with-`ON CONFLICT` / DELETE against `document_pins` respectively.
- MDX authoring path (commit-mdx, B7) is HARD-REJECTED for these fields: comment at `route.js:119-138` "a write to them would land in PG and then be silently overwritten on the next projection apply".

**Precise seam summary.**

| Field | Authored in | Stored in | Written by | Read by |
|---|---|---|---|---|
| `status` | MDX seeds on INSERT only | `documents.status` | `POST update-document` -> `updateDocument()` | `getDocument`/`listDocuments`, then `visibleStatuses`/`filterDocuments` at request time |
| `access_level` | MDX seeds on INSERT only | `documents.access_level` | `POST update-document` -> `updateDocument()` | `getDocument`/`listDocuments`, then `viewerTier`/`canSeeDoc` at request time |
| `pin` | never in MDX (overlay-only per pr-7-9) | `document_pins` (separate table) | `POST update-document` -> `setPinned`/`clearPinned` | `decoratePinned` (batch join) / per-doc overlay read |

## Contradictions with the prompt's Section 1 facts

- **"113 active vs 129 in `/content` (expected: 16 archived)"** - "archived" is slightly imprecise as a term. The 16 delta is 16 MDX files with `status: Retired`, not 16 rows with `archived=true`. `status='Retired'` and `archived=true` are orthogonal columns (`src/lib/dataStore/opd.js:74-78`: the default query does both `.eq("archived", false)` AND `.neq("status", "Retired")`). PG currently reports 4 archived rows (`docs/opd/foundation/PROJECTION_DRYRUN.md:16`) versus 16 Retired MDX docs; the 129-113 = 16 delta comes from the Retired filter, not the archived filter. [verified]
- Everything else in the prompt's established facts checks out against the code: 129 MDX docs [verified]; `content/facts/` + `content/schema/` + `content/components/` present [verified]; `obligations` key defined at `frontmatter.schema.json:176-226` with `cert_renewal`/`training` types and state/account/role scope [verified]; zero MDX docs currently populate `obligations` [verified] (grep `^obligations:` in `content/documents/*.mdx` returns nothing; the only consumers reference the field via `fm.obligations || []` which shows the empty-array default is normal).

## Completeness map

| Question | Confidence | What would promote to `[verified]` |
|---|---|---|
| B6 projection job/trigger/tables | [verified] (workflow file + apply function read end-to-end; delta arithmetic confirmed by grep) | Running the workflow on a test push and reading actual GHA log would replace [code-read] bits on step-order/RPC calls, but the code is unambiguous. |
| B7 publish path | [code-read] (full handler read; matches editor client's fetch calls) | Running an actual publish and observing `opd-edit/<id>` branch + auto-merge in GitHub. |
| B8 render path | [code-read] (component `dangerouslySetInnerHTML` read; API handler read; dataStore read) | DevTools inspection of a `/playbook/d/SOP-008` response payload. |
| B9 facts resolver at read time | [verified] for "no read-time viewer-ctx resolver exists in `/src`" (grep-confirmed); [code-read] for the projection-time resolver semantics | N/A - the absence is grep-verifiable, and the projection call site is unambiguous. |
| B10 status/access/pin seam | [verified] for table locations (schema files) + [code-read] for read/write paths (line-anchored) | Running a live `POST update-document` and observing the seam behavior end-to-end. |
