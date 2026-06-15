# Playbook Engine Audit (read-only)

**Date:** 2026-06-15
**Scope:** Map how `/playbook`, `/playbook/admin`, and the SousAI demo work *today*, against the actual code in `src/`. Read-only; no code, schema, or content changes.
**Source of truth:** repo files cited below. `src-backup/` ignored per brief.
**Method:** direct reads of `src/app/playbook/*`, `src/app/api/playbook/route.js`, `src/lib/dataStore/opd.js`, `src/lib/opdAcl.js`, `src/lib/sousai/*`, `docs/migrations/pr-7-1-opd-schema.sql`, and the AdminClient editing path. Where a finding is inferred (e.g., browser-level Drive auth), it is flagged "INFERRED" in line.

---

## Headlines

1. **The catalog already lives in Postgres**, not Sheets and not Drive. Greenfield PG-only domain since `pr-7-1-opd-schema.sql` (2026-05-29 reconstruction). The Sheets predecessor referred to in `ARCHITECTURE.md` does not apply to Playbook - that doc is **stale on this module** (P2 doc drift).
2. **Drive is decoration**, not data. Catalog rows carry a `source_drive_id` string. The reader builds `https://drive.google.com/file/d/{id}/preview` URLs at request time and renders them in an iframe. No Drive API call is made on the catalog read path. Drive is load-bearing in exactly two places: (a) the SousAI embedding extractor (Drive Docs API), and (b) the reader iframe authentication, which delegates to Google's own session cookies.
3. **UI data contract is one bootstrap call + one detail call.** Bootstrap returns `{ email, isOwner, shelves, documents[] }` where each document is the full Postgres row. Detail returns the row + enriched relationships + surfaces + four Drive URLs (EN/ES, view/preview). The MDX-to-Postgres projection has to satisfy these two response shapes - everything else falls out.
4. **Auth boundary is one rule, applied twice.** Page gate is `canViewPlaybook(actualEmail)` - owner-only, `k.fietek@kitchfix.com`. Read writes both use the Supabase service-role client (RLS is disabled on all four OPD tables). The page gate is the only protection on writes.
5. **The "Ask SousAI" search bar at the top of `/playbook` is a client-side string filter.** It does NOT call SousAI. The real SousAI streaming endpoint at `/api/playbook/sous-demo` is wired to a separate `SousModal` component, not to the search bar. This matters: F8's wiring point is the modal, not the hero search.
6. **Cleanest re-point seam:** swap the SlideOverReader's iframe path for an HTML render of the resolved MDX, and swap the embedding extractor's Drive call for the resolver output. Catalog reads are already correct. The Build Dashboard's write path is the one architectural decision still open (write back to MDX, or keep editing Postgres-only?).

---

## 1. The catalog store

### 1.1 Where it lives

**Postgres (Supabase).** Four tables defined in `docs/migrations/pr-7-1-opd-schema.sql`:

- `documents` - the catalog (TEXT PK = doc ID like `PB-006`, `SOP-002`, `REF-005-A`)
- `document_relationships` - directed edges with `chk_rel_type` constraining `references | implements | supersedes | superseded_by | derived_from | related`
- `document_surfaces` - many-to-many: where a doc appears in intranet tools (e.g., `kitchen`)
- `document_issues` - the report-an-issue inbox

All four have `archived` / `archived_at` columns (added by `pr-7-7-opd-archive.sql`) and bilingual `source_drive_id_es` (added by `pr-7-4-opd-bilingual-columns.sql`). RLS disabled on all four; the service-role client bypasses it. Grants present for `service_role`; `anon` / `authenticated` get only `REFERENCES, TRIGGER, TRUNCATE`.

The header comment on `src/lib/dataStore/opd.js` (line 4) is explicit: **"PG-ONLY DOMAIN. No Sheets predecessor, no dual-write, no cutover flag."** This is greenfield Postgres - nothing to retire on the database side.

### 1.2 Full field set per doc (from pr-7-1 schema + pr-7-4 + pr-7-7)

```sql
documents:
  id               TEXT PRIMARY KEY            -- doc ID
  title            TEXT NOT NULL
  doc_class        TEXT NOT NULL               -- PB | SOP | TPL | REF | STD | POL | AGR | FORM | POST | CHK
  status           TEXT NOT NULL               -- 7 values, see §6
  version          TEXT
  shelf            TEXT                        -- 6 values, see §1.4
  card_line        TEXT
  summary          TEXT
  keywords         TEXT[] NOT NULL DEFAULT '{}'
  owner            TEXT
  approver         TEXT
  source_drive_id     TEXT                     -- Drive file id (EN)
  source_drive_id_es  TEXT                     -- Drive file id (ES); pr-7-4
  storage_path     TEXT                        -- reserved for Supabase Storage (unused)
  pinned           BOOLEAN DEFAULT false
  print_required   BOOLEAN DEFAULT false       -- POST class shows Print affordance
  critical         BOOLEAN DEFAULT false       -- safety-critical styling carryover
  sort_order       INTEGER DEFAULT 100
  audience         TEXT                        -- defined; enforcement deferred to page gate
  classification   TEXT DEFAULT 'KitchFix Internal'
  effective_date   DATE
  last_reviewed    DATE
  next_review      DATE
  is_historical    BOOLEAN DEFAULT false       -- seed/migrated row exempt from chk_live_complete
  data_provenance  TEXT DEFAULT 'manual_entry' -- app_scan | batch_rebuild | manual_entry | unknown
  created_at       TIMESTAMPTZ DEFAULT now()
  updated_at       TIMESTAMPTZ DEFAULT now()
  archived         BOOLEAN DEFAULT false       -- pr-7-7
  archived_at      TIMESTAMPTZ                 -- pr-7-7
```

Key constraint: `chk_live_complete` says a Live doc must carry both a `version` and a `card_line` unless `is_historical = TRUE`. This will bite the MDX projection if MDX-sourced rows are marked Live without those two fields populated.

### 1.3 The "8 / 38 LINKED TO DRIVE" stat

Computed in `AdminClient.js:292-296`:

```js
const linkedCount = useMemo(
  () => docs.filter((d) => d.source_drive_id).length,
  [docs]
);
const linkedPct = total > 0 ? Math.round((linkedCount / total) * 100) : 0;
```

`docs` comes from the bootstrap response, which itself is `listDocuments({ statuses: visibleStatuses(isCorp) })` from `dataStore/opd.js:59-87`. Active docs only - `archived = false` and `status != 'Retired'`. The 38 is the active corporate-visible catalog count at the moment the dashboard loaded. The 8 is how many of those 38 have a non-null `source_drive_id`.

### 1.4 Shelves

A locked array, defined twice (once in the route, once on the schema):

- `src/app/api/playbook/route.js:42-50` SHELVES = `["Safety", "Operations", "HR & People", "Culinary", "Brand & Standards", "Finance", "Site & Client"]` - **7 values, route-side**
- `pr-7-1-opd-schema.sql` chk_documents_shelf = `'Safety','Operations','HR & People','Culinary','Finance','Site & Client'` - **6 values, schema-side**

The route advertises "Brand & Standards" but the schema CHECK does not allow it. `pr-7-6-opd-add-brand-shelf.sql` exists - INFERRED that migration adds the seventh value. **Verify in Studio before any frontmatter-to-Postgres write tries to insert a "Brand & Standards" row.**

Shelf is a stored TEXT column, not derived. The card grid iterates `bootstrap.shelves` in order; cards are grouped by `doc.shelf === shelfName`.

### 1.5 Counting / filtering

`dataStore/opd.js:59-87` listDocuments:

- Default mode: `archived = false`, `status != 'Retired'`, `status IN (visibleStatuses)`. If `shelf` arg present, filter to it. Order: `pinned DESC, sort_order ASC, title ASC`.
- `archivedOnly: true` mode (admin Archive tab): only `archived = true`, order `archived_at DESC, id ASC`.

`visibleStatuses(isCorporate)` from `opdAcl.js:35-40`:

- Corporate user: `['Live', 'In Build', 'Draft', 'Pending', 'Placeholder', 'Blocked']`
- Non-corporate: `['Live']` only
- Retired: never returned to either

`isCorporateEmail(email)` looks up `contacts.team_key === 'CORP'` (will move to a `users.role` lookup when `AUTH_MODEL.md` ships).

---

## 2. The UI data contract (most important)

### 2.1 Bootstrap response (drives the card grid + filter chips)

`GET /api/playbook?action=bootstrap` returns:

```ts
{
  email: string,              // session.user.email, lowercased + trimmed
  isOwner: boolean,           // canViewPlaybook(email)
  shelves: string[],          // SHELVES constant (route-side, 7 values)
  documents: DocumentRow[]    // empty array for non-owners
}
```

A `DocumentRow` is the full Postgres `documents` row (the `.select("*")` in `listDocuments`). The card grid in `PlaybookClient.js` reads these fields off each row:

| Field | Used for |
|---|---|
| `id` | key, onOpen handler arg, opens slide-over reader |
| `title` | card title |
| `doc_class` | CLASS_LABELS lookup + CLASS_FAMILY chip color (`gov` / `proc` / `tool` / `ref`) |
| `status` | STATUS_COLORS lookup + chip; `OPERATOR_STATUS_LABEL` maps `Live -> Ready` |
| `source_drive_id` | "alive" vs "recessed" card styling (alive = Drive-linked AND Live) |
| `pinned` | pin icon + sort priority |
| `print_required` | wall-poster mark on POST class |
| `card_line` | one-liner under the title |
| `version` | (read but rendered conditionally) |
| `shelf` | groups cards by shelf section |
| `sort_order` | server-side ordering |
| `keywords` | client-side search filter target |
| `summary` | client-side search filter target |

The Admin worklist row reads the same shape plus `archived`, `archived_at`, `created_at`, `updated_at`. Inline-editable fields per `AdminClient.js:589-720`: title (text), shelf (select), doc_class (select), status (select), version (text), pinned (toggle), source_drive_id (Part B confirmed write).

### 2.2 Document detail response (drives the slide-over reader)

`GET /api/playbook?action=document&id={DOC-ID}` returns:

```ts
{
  document: DocumentRow,                  // full row
  relationships: EnrichedRelationship[],  // see below
  surfaces: string[],                     // surface names a doc appears on
  drive_view_url: string | null,          // https://drive.google.com/file/d/{id}/view  (EN)
  drive_preview_url: string | null,       // https://drive.google.com/file/d/{id}/preview  (EN)
  drive_view_url_es: string | null,       // (ES)
  drive_preview_url_es: string | null     // (ES)
}
```

`EnrichedRelationship` (built at `route.js:240-260`):

```ts
{
  rel_type: 'references' | 'implements' | 'supersedes' | 'superseded_by' | 'derived_from' | 'related',
  direction: 'in' | 'out',
  other_id: string,
  other_title: string,
  other_class: string | null,
  other_status: string | null
}
```

The SlideOverReader (`SlideOverReader.js:132-157`) consumes:

- `document.*` fields for header (title, version, status pill, owner/approver, card_line, summary, etc.)
- `relationships` for the "See also" / "Part of" / "Based on" / "Source for" / "Related" panel, grouped by `direction` + `rel_type` via `RELATIONSHIP_LABELS_OUT` / `RELATIONSHIP_LABELS_IN`
- `surfaces` for a surface-list chip row (currently rendered if non-empty)
- `drive_preview_url` / `drive_preview_url_es` for the iframe; EN/ES toggle only renders when both are set
- `drive_view_url` / `drive_view_url_es` for the "Open in Drive" buttons

### 2.3 The Build Dashboard worklist contract

`AdminClient.js` calls bootstrap (same payload), then on column edits POSTs:

```ts
POST /api/playbook?action=update-document
body: { id: string, patch: Partial<{
  title: string,
  shelf: ShelfName | null,
  doc_class: ClassName,
  status: StatusName,
  version: string | null,
  pinned: boolean,
  source_drive_id: string | null,
  source_drive_id_es: string | null
}> }
response: { ok: true, document: DocumentRow } | { error: string }
```

Allowlist enforced in `validatePatch` (`route.js:96-189`). `id` is never editable; renames are a deliberate scripted operation (see `pr-7-5-opd-poster-id-fix.sql` for the POST-003 -> POSTER-001 rename).

---

## 3. The Google Drive read path

### 3.1 What Drive actually does for `/playbook`

**The catalog read path makes zero Drive API calls.** The route just constructs URLs from a stored ID:

```js
// src/app/api/playbook/route.js:262-272
const driveViewUrl = doc.source_drive_id
  ? `https://drive.google.com/file/d/${doc.source_drive_id}/view`
  : null;
const drivePreviewUrl = doc.source_drive_id
  ? `https://drive.google.com/file/d/${doc.source_drive_id}/preview`
  : null;
```

The SlideOverReader then iframes `drive_preview_url` directly (`SlideOverReader.js:251`). **Authentication on the iframe is browser-level**: Google checks the user's logged-in Google session cookie against the file's sharing settings (INFERRED from the standard Drive embed behavior; the iframe carries no app-side auth header). If the user is signed into Google but does not have view permission on the underlying file, they see Google's permission-denied screen inside the iframe.

The Page 1 / 17 viewer chrome (the "X of Y pages" navigation and zoom controls) is Google's own embedded viewer - not something the app implements.

### 3.2 The actual Drive integrations in the app

These exist but are NOT in the `/playbook` read path:

- `src/lib/drive.js` - service-account-only Drive upload helpers (used by Invoice, Incident, etc.). Reads `GOOGLE_INVOICE_DRIVE_FOLDER_ID`. **Not called from `/playbook` or its admin.**
- `src/lib/sousai/extract.js` - calls Google Docs API on `source_drive_id` to extract structured text for embedding. **Drive-load-bearing for the SousAI embedding pipeline only.** Auth is the service account (see `sheets.js` getServiceAccountDriveClient).

### 3.3 Env vars referenced for Drive

From `src/lib/drive.js` header comment:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_INVOICE_DRIVE_FOLDER_ID` - **NOT relevant to Playbook.** This is invoice uploads only.

`BACKUP_FOLDER_ID` (mentioned in the audit brief) is not referenced anywhere in `src/lib/drive.js` or the Playbook surfaces (grep found no hit). INFERRED that this is Phase 1 backup-script work, not Playbook.

### 3.4 Bilingual handling

Bilingual works via two Drive IDs on one catalog row:

- `source_drive_id` for EN, `source_drive_id_es` for ES (pr-7-4)
- Reader renders EN/ES toggle only when both preview URLs are non-null (`SlideOverReader.js:148-149`)
- POSTER-001 is the first and currently only bilingual row (per route.js comment line 273)

There is **also** a parallel pattern for some docs where ES is its own catalog row with an `-ES` ID suffix (POST-001-ES, PB-004-ES, POL-006-ES in the MDX foundation). These two patterns are independent. The bilingual frontmatter pattern in the MDX foundation uses `translation_of:` for the suffix-ES rows. The Postgres pattern is the `source_drive_id_es` column. **Open question for re-point design**: which model wins post-cutover?

---

## 4. The Build Dashboard write path

### 4.1 Editing model

`AdminClient.js:6-30` header comment + the per-cell handlers around line 200:

- **Part A (auto-commit, optimistic)**: title, shelf, doc_class, status, version, pinned. UI updates immediately, write fires in background, 1.5s saved flash confirms, failure reverts.
- **Part B (explicit Save, confirmed)**: source_drive_id, source_drive_id_es. Not optimistic - there is a confirmation step + a "test render" link before save.
- `id` never editable (PK + FK target).

### 4.2 What gets written, where

All edits go to **one route**: `POST /api/playbook?action=update-document`. From there:

- Validation in `validatePatch` (route.js:96)
- `updateDocument(id, patch)` in `dataStore/opd.js:199` → Supabase service-role client → `documents` table UPDATE
- `updated_at` stamped at the orchestrator (not relying on schema trigger since the schema default only fires on INSERT)
- Returns the post-write row via `.select().single()` so the client gets the authoritative state

### 4.3 The other write actions

| Action | Route handler | Hits | Notes |
|---|---|---|---|
| `archive` | route.js:445 | `archive_document(p_doc_id)` Postgres RPC | Atomic: flips `archived = true` AND deletes `document_chunks` for the doc in one tx. Either-both-or-neither so Sous can never cite an archived doc. |
| `restore` | route.js:473 | `sousai.restoreDocument({docId})` then implicit flip | Re-embeds first (via Drive extract), THEN flips `archived = false`. No visible-but-empty state possible. |
| `create-document` | route.js:506 | `createDocument(payload)` after `validateCreatePayload` | Strict ID format + prefix↔doc_class consistency check (POSTER-NNN → POST class). |
| `report-issue` | route.js:380 | `createIssue` + Slack ping to `SLACK_OPD_WEBHOOK` (falls back to `SLACK_HELP_WEBHOOK`) | `reporter_email` is ALWAYS taken from session, never from the client body. |

### 4.4 Auth on writes

**Same service-role Supabase client used for reads.** The owner gate is enforced in the POST handler at `route.js:359-362`:

```js
if (!canViewPlaybook(actualEmail)) {
  return NextResponse.json({ error: "Not authorized" }, { status: 403 });
}
```

This is checked on EVERY request (not trusted from a client flag like `isOwner`). The client cannot bypass by lying about `isOwner=true` in the bootstrap response - the write endpoint re-checks the session email.

**Against the documented OAuth-write rule:** `docs/GOTCHAS.md:177-181` says "All Drive uploads use the service account. Always. There is no exception." The Playbook write path writes to Postgres, not Drive - and uses the service account. **Compliant**. No write to Drive happens from the Playbook flow.

### 4.5 The "Owner editing - Active documents only" footer

INFERRED that this string lives in the Admin client's footer (line not found in this audit pass; verify if needed). The constraint it advertises is enforced by the route: archived docs are returned only via `list-archived` action and edits only go through `update-document` which doesn't filter by archived. **Possible drift**: an owner can edit an archived doc by id if they know the id. Confirm intended behavior.

---

## 5. API routes / action-dispatch

Per the action-dispatch pattern in `docs/CONVENTIONS.md:10`. Two route files for Playbook:

### `/api/playbook/route.js`

GET actions:

| `?action=` | Returns | Auth |
|---|---|---|
| `bootstrap` | `{ email, isOwner, shelves, documents }` (empty docs for non-owner) | Session + owner gate fork |
| `document` | `{ document, relationships, surfaces, drive_*_url[_es] }` | Owner-only (403 otherwise) |
| `list-archived` | `{ documents }` (archived rows only) | Owner-only |
| `archive-impact` | `{ document_id, title, incoming_relationships, chunks_count }` | Owner-only; for confirm dialog |

POST actions:

| `?action=` | Body | Effect | Auth |
|---|---|---|---|
| `report-issue` | `{ doc_id, issue_text }` | Insert `document_issues` row + Slack ping; `reporter_email` from session | Owner-only |
| `update-document` | `{ id, patch }` | UPDATE `documents`; allowlist-validated | Owner-only |
| `archive` | `{ id }` | Call `archive_document` RPC (flip + chunk-delete atomically) | Owner-only |
| `restore` | `{ id }` | `sousai.restoreDocument` (re-embed via Drive extract) then flip archived=false | Owner-only |
| `create-document` | `{ id, title, doc_class, ... }` | Strict validation then INSERT `documents` | Owner-only |

### `/api/playbook/sous-demo/route.js`

POST only:

| Body | Effect | Auth |
|---|---|---|
| `{ question }` | NDJSON streaming response: meta event + many text chunks + done. Pipeline: `prepareSousContext` (pgvector retrieval + similarity threshold + prompt build) → Anthropic streaming. | Owner-only |

`ANTHROPIC_API_KEY_SOUS` env var; never exposed to client.

---

## 6. Status vocabulary

### 6.1 The two sets

**Portal status set (7 values):** Per `pr-7-1` `chk_documents_status` + `VALID_STATUSES` in route.js:

`Live | In Build | Draft | Pending | Placeholder | Blocked | Retired`

**MDX foundation status set (5 values):** Per the F1-F6.6 work in `content/documents/`:

`Live | In Build | Pending | Placeholder | Retired`

**Drift:** the portal has `Draft` and `Blocked` that the MDX foundation does not use. Conversely the MDX side is the intersection - everything in the MDX set exists in the portal set.

### 6.2 Where the mapping happens

- **No mapping happens today.** The portal renders raw status values, with one cosmetic relabel: `OPERATOR_STATUS_LABEL = { Live: "Ready" }` in `PlaybookClient.js:36-44`. All other values display as-is.
- Filter chips on `/playbook` are built dynamically from whatever distinct statuses exist in the visible docs (`PlaybookClient.js:65, 503`), rendered in `STATUS_CHIP_ORDER` for stability. So if the visible docs only have Live + Pending, only those two chips show up.
- Status badge colors via `STATUS_COLORS` in `_shared.js:46-54` are defined for all 6 active statuses (Retired excluded since it's never shown to operators).

### 6.3 The reconciliation question

When MDX → Postgres projection runs:

- MDX rows projected with `status: In Build` map cleanly to portal `In Build` ✓
- MDX rows with `status: Placeholder` map cleanly ✓
- MDX rows with `status: Pending` map cleanly ✓
- MDX rows with `status: Live` need `version` + `card_line` populated to satisfy `chk_live_complete` ✓ (MDX has both)
- MDX rows with `status: Retired` map cleanly but the portal never shows them ✓

The portal's `Draft` and `Blocked` have no MDX counterpart. Per the brief, this reconciliation is a known Phase A item; surfacing here for the record.

---

## 7. Relationships

### 7.1 Where the data lives

`document_relationships` table. Six rel_types per `chk_rel_type`: `references | implements | supersedes | superseded_by | derived_from | related`. UNIQUE on `(from_doc, to_doc, rel_type)`.

### 7.2 Read path

`dataStore/opd.js:114-127` `getRelationships(id)`:

- Returns ALL edges where `from_doc = id OR to_doc = id` (both directions)
- `id` validated against `DOC_ID_RE = /^[A-Z0-9-]+$/` before interpolation into PostgREST's `.or()` filter, since `.or()` takes raw expression strings

The route then enriches each edge with the "other" doc's title / doc_class / status via a batched `getDocument` per other-id (`route.js:240-260`), returning the `EnrichedRelationship` shape in §2.2.

### 7.3 Reader rendering

`SlideOverReader.js` groups the enriched edges by `direction` + `rel_type` and uses the labels from `_shared.js:80-99`:

- `derived_from` OUT → "Based on"
- `derived_from` IN → "Source for"
- `references` OUT → "See also"
- `references` IN → "Part of"
- `implements` OUT / IN → "Implements" / "Implemented by"
- `supersedes` OUT / IN → "Supersedes" / "Replaces (older)"
- `superseded_by` OUT / IN → "Superseded by" / "Replacement for"
- `related` either → "Related"

The example from the brief (SOP-002 → POST-001, FORM-001, FORM-002, REF-001) implies POST-001 is a child of SOP-002 (`derived_from` SOP-002 in POST-001's row, rendered as "Source for" under SOP-002), and the FORM rows likely `implements` SOP-002 (rendered as "Implemented by"). Easy to verify by selecting from the table; the renderer is purely a label/direction lookup.

### 7.4 MDX projection

The MDX foundation already has `relationships:` blocks in frontmatter (see `content/documents/SOP-002.mdx`). Projection to `document_relationships` is one row per MDX entry. F6.5 added 14 such edges; F6.6 added Counsel as co-approver on 11 docs but did not touch relationships. The projection is direct: `{ from_doc: parent_id, to_doc: rel.to, rel_type: rel.type }`.

---

## 8. SousAI / search

### 8.1 What is wired today

| Surface | Status |
|---|---|
| **Hero search bar** ("Ask SousAI, or search…") | **Client-side string filter only.** `PlaybookClient.js:580-595`. `onChange={(e) => setQuery(e.target.value)}` updates local state; line 378 does `const q = query.trim().toLowerCase()` then `.filter()` over the bootstrap documents. Filters against title + summary + keywords (the brief said the chip "Ask SousAI about this doc" is COMING SOON - that matches). |
| **Sticky search bar** (slim navy bar that slides in on scroll) | Same state, same filter. No SousAI call. |
| **`SousModal` / `SousChat` (sous-demo)** | **Wired to live SousAI streaming.** `src/app/playbook/sous-demo/`. AdminClient imports `SousModal` (`AdminClient.js:42`). PlaybookClient does NOT use SousModal. The modal posts to `/api/playbook/sous-demo` and renders the NDJSON stream. |
| **"Ask SousAI about this doc"** stub (per brief: "COMING SOON" label) | Not wired. INFERRED that the SlideOverReader has this stub button somewhere - not found in this audit pass. The `/api/playbook/sous-demo` endpoint already supports a generic question; adding doc-scoped retrieval is a generation-side change in `sousai/generate.js`. |

### 8.2 The embedding pipeline (the F8 endpoint)

`src/lib/sousai/index.js` exports:

- `embedDocument({ docId, driveFileId, language })` - calls `extractGoogleDoc` (Drive Docs API), chunks, embeds via OpenAI, replaces `document_chunks` for that doc. **Drive-load-bearing.**
- `embedPosterStub({ docId, language })` - one stub chunk for POST class docs (visual references)
- `restoreDocument({ docId })` - dispatches by doc_class

`document_chunks` is the pgvector store (not in pr-7-1; presumably defined in an earlier sousai migration - not in scope for this audit).

### 8.3 What F8 plugs into

The current `embedDocument` extracts from Drive. The MDX projection from `scripts/content/project_pilot.mjs` produces resolved text (Facts resolved, Includes inlined, NonCanonical stripped, flattened with `[H1]/[H2]` markers ready for the structure-aware chunker at `sousai/chunk.js`). The cleanest swap:

- Replace `extractGoogleDoc(driveFileId)` with `loadResolvedMdx(docId)` (reads the projected text from a known path or computes on demand)
- Everything downstream (chunk → embed → store) is unchanged

The "Ask SousAI" hero bar wiring is a separate, smaller change - hook the input to a debounced call against the same `prepareSousContext` retrieval endpoint, render a results panel (modal or inline).

---

## 9. The seams (synthesis)

### 9.1 Read-path seams (where MDX projection lands)

| Surface | Current source | Re-point lands here | Effort |
|---|---|---|---|
| Card grid (bootstrap) | `documents` table | Projection writes to `documents` table directly. **No app code change.** | Schema-side ETL only |
| Document detail (header, relationships, surfaces) | `documents` + `document_relationships` + `document_surfaces` | Same. Projection populates relationships from MDX `relationships:` frontmatter. Surfaces stay editable in Postgres (not in MDX frontmatter today). | ETL only |
| Reader iframe (PDF) | `https://drive.google.com/file/d/{source_drive_id}/preview` | **Render resolved MDX as HTML.** New `/api/playbook/render?id=DOC` endpoint returns HTML (or returns the resolved MDX and client renders). Reader checks for `mdx_render_url || drive_preview_url` and iframes/renders whichever exists. | App change in SlideOverReader + new render route |
| EN/ES toggle | Two Drive IDs on one row | Two MDX docs (id + id-ES) OR same row with EN/ES variants. **Open design decision.** | Depends on §3.4 question |
| SousAI corpus | Drive Docs API via `extractGoogleDoc` | Resolver output via `project_pilot.mjs` projected-text path | Swap inside `embedDocument`; chunk+embed stays |

### 9.2 Write-path seams (Build Dashboard)

This is the architectural decision still open:

- **Option A: Postgres-only edits.** Dashboard keeps editing `documents` directly. MDX is read-only source for INITIAL projection only. Subsequent edits diverge MDX from Postgres. Easiest engineering; loses MDX-as-source-of-truth.
- **Option B: Dual-write.** Dashboard writes both Postgres (live UI) and MDX file (via API + git commit). Two writes, two failure modes, but the source stays authoritative. Most complex.
- **Option C: Read-only dashboard.** Status / pin / version / shelf edits move to MDX frontmatter via PR. Dashboard becomes a viewer. Cleanest source-of-truth story, biggest UX regression for power-user editing.

The brief explicitly says this is Kevin + chat-Claude's decision - flagging it for visibility, not recommending one.

### 9.3 Where Drive is load-bearing in non-obvious ways

- **Embedding extract** (sousai/extract.js) - the Drive Docs API call is the corpus's source of truth today. **F8 swaps this for the resolver output.** No portal change needed.
- **Iframe authentication** - browser-level Drive session. Replacing with rendered MDX HTML removes this entirely. **Side effect:** users without Drive permission today see a Google permission screen in the iframe; after re-point they see the doc. Worth flagging - some current behavior may have been silently relying on Drive ACL.
- **Print workflow for posters** - operators currently use Drive's print button inside the iframe. POSTER class docs need a separate print path in the rendered-HTML world (CSS print stylesheet or a server-rendered print view).
- **"Open in Drive"** button on the reader (lines 238, 286) - direct link to source-of-truth Drive doc. Becomes obsolete when MDX is canon; either remove or repoint to a link to the MDX repo location.
- **The bilingual `source_drive_id_es` column** - rendering pattern only. Easy to retire if MDX adopts the suffix-ES pattern uniformly.

### 9.4 The auth boundary, restated

- **Page gate:** `canViewPlaybook(actualEmail)` v1-owner-only. Same on read and write. No RLS; the gate IS the boundary.
- **Read path auth:** Supabase service-role client (RLS disabled).
- **Write path auth:** Same service-role client. Owner gate is checked on every request via session.
- **Drive iframe auth:** Browser-level Google session cookie. Bypasses app auth entirely - this is why a "Live" doc with the user lacking Drive permission shows a permission error inside the iframe.
- **SousAI streaming auth:** Owner gate + `ANTHROPIC_API_KEY_SOUS` env var server-side.

The auth boundary post-cutover does not need to change. Service-role for Postgres reads/writes stays; owner gate stays; only the Drive iframe auth disappears (replaced by app-rendered HTML served via the owner-gated render endpoint).

### 9.5 P2 doc drift flags

These are documentation problems, not code problems - low priority but worth recording:

- `docs/ARCHITECTURE.md` describes the stack as "Database: Google Sheets (five spreadsheets)" - true for the rest of the app, **not true for Playbook/OPD which is greenfield Postgres**. No mention of Supabase, pgvector, or the OPD schema. Update at next pass.
- `docs/ARCHITECTURE.md` "Last verified: 2026-05-05" predates the pr-7-1 OPD schema apply (post-2026-05-29 per `dataStore/opd.js` comment). Re-verify against post-OPD code.
- `CUTOVER_PLAYBOOK.md` is referenced from `dataStore/opd.js:6` but **does not exist** under `docs/` (verified). The reference is stale or the doc moved.
- The route exposes 7 shelves but the schema constrains 6. `pr-7-6-opd-add-brand-shelf.sql` presumably adds the seventh - verify it has been applied in production.

---

## Open questions for Kevin / chat

1. **Source-of-truth on edits:** when the dashboard edits a status, version, shelf, or pin, where does that write land - Postgres only (Option A), MDX + Postgres dual-write (Option B), or MDX-only via PR (Option C)? §9.2 above.
2. **Bilingual pattern:** keep the `source_drive_id_es` column model (one row, two language IDs), or move uniformly to the suffix-ES pattern from MDX (POST-001 + POST-001-ES as two rows linked by `translation_of`)? §3.4 and §9.1.
3. **Posters render path:** POSTER class docs are currently visual PDFs. The MDX foundation has POSTER-001 / POSTER-002 / POSTER-003 stubs (POST class with print_required). What renders for posters post-cutover - a print-stylesheet view of the MDX, a separately-authored visual asset, or the existing Drive PDF kept as the "rendered" output?
4. **"Open in Drive" button after cutover** - remove from the reader UI, or repoint to a link to the MDX file in the repo (GitHub URL) for operators who want to see the source?
5. **"Ask SousAI" hero bar** - is the plan to wire it to the existing `/api/playbook/sous-demo` endpoint as part of the re-point, or is it a separate F8 deliverable?
6. **`Draft` and `Blocked` portal statuses** - keep in the schema for future use, or trim to match the MDX 5-set as part of the cutover? Trimming would simplify but break any future doc that wants a "blocked on legal" state.
7. **`document_surfaces`** - currently a separate table editable in Postgres but not declared in MDX frontmatter. Add a `surfaces:` field to MDX schema, or keep it as a Postgres-only catalog concern?
8. **`is_historical` flag on the projection** - if MDX-projected rows are marked `is_historical = TRUE`, the `chk_live_complete` constraint is exempted. Is that the right behavior, or should MDX rows be marked `is_historical = FALSE` (forcing the version + card_line gate)?

---

## Appendix - files read in this audit

| File | Purpose |
|---|---|
| `src/app/playbook/page.js` | Route entry; renders PlaybookClient |
| `src/app/playbook/PlaybookClient.js` | Card grid, filter chips, hero search (client-side) |
| `src/app/playbook/SlideOverReader.js` | Reader drawer; consumes detail response + Drive URLs |
| `src/app/playbook/_shared.js` | CLASS_LABELS, CLASS_FAMILY, STATUS_COLORS, RELATIONSHIP_LABELS |
| `src/app/playbook/admin/page.js` | Admin route entry |
| `src/app/playbook/admin/AdminClient.js` | Worklist + inline editing + metrics + archive workflow |
| `src/app/api/playbook/route.js` | All catalog actions (bootstrap, document, list-archived, archive-impact, report-issue, update-document, archive, restore, create-document) |
| `src/app/api/playbook/sous-demo/route.js` | SousAI streaming NDJSON endpoint |
| `src/lib/dataStore/opd.js` | Postgres data layer for documents / relationships / surfaces / issues |
| `src/lib/opdAcl.js` | canViewPlaybook + visibleStatuses + filterDocuments |
| `src/lib/playbookValidation.js` | validateCreatePayload + ID format regex + prefix→class map |
| `src/lib/sousai/index.js` | embedDocument + embedPosterStub + restoreDocument |
| `src/lib/drive.js` | Service-account Drive helpers (not in Playbook read path) |
| `docs/migrations/pr-7-1-opd-schema.sql` | OPD schema (4 tables, constraints, grants) |
| `docs/ARCHITECTURE.md` | Stack doc (stale on Playbook - P2 drift) |
| `docs/CONVENTIONS.md` | Action-dispatch pattern |
| `docs/GOTCHAS.md` | Drive-upload-via-service-account rule |
