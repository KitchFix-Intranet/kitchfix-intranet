# Build Dashboard - Independent Expert Design Audit (CC)

**Reviewer:** Claude Code (Opus 4.7, 1M context) - independent leg of the three-way audit
**Date:** 2026-06-17
**Surface:** `/playbook/admin` (Build Dashboard)
**Mode:** Read-only critique + propose. No edits, no PR.
**Code grounding:** `src/app/playbook/admin/AdminClient.js`, `src/app/api/playbook/route.js`, `src/lib/dataStore/opd.js`, `src/lib/opdAcl.js`, `scripts/content/project-catalog.mjs`, `src/app/playbook/SlideOverReader.js`, `docs/migrations/pr-7-1-opd-schema.sql` + pr-7-9/10/11/13/14.
**Scope override:** The persona doc's "not in scope" list is explicitly waived by Kevin for this audit. Clean-slate rebuild is on the table.

---

## Verdict: **rework**

This is the single most consequential finding of the audit, so it leads:

> The dashboard's editing model is fundamentally broken against the current architecture. Five of the eight editable fields are silent-data-loss traps - the operator can edit them, see the green "saved" flash, and the value will be silently overwritten the next time `project-catalog.mjs --apply` runs. The three leading KPI cards and the most visually emphasized element on the page (the 9% "Linked to Drive" progress bar) measure a dimension - Drive linkage - that the doc-format arc has retired. The dashboard is a high-quality v1 implementation of a model that no longer exists.

Status: **rework**. Not a polish pass. The IA, the editing surface, the KPI choice, and the New-Document flow all need to be rebuilt against the current MDX-canonical / overlay-only / 3-tier-gated reality. Several pieces should be preserved (archive flow, slide-over reader reuse, status pill row, inline-edit ergonomics) - but the center of gravity has to move.

---

## Density mode

**Identified:** Density mode (table-friendly, tight padding, ~13px body, table cells under 20px-tall, single-line status pills). Matches the persona's "admin queue" surface assignment.

**Mobile:** Not Comfortable-overridden. At 375px the 9-column worklist is unusable - horizontal scroll, the Drive Link Panel inflates row height past 200px when expanded. Per the persona this would normally be a P0 floor-first violation, but the surface is explicitly owner-only and the owner is at a desk. Logging it as **P2 (single-user surface exception)** rather than P0; if the dashboard later opens to more roles it becomes P0.

---

## What's working (protect through any rebuild)

1. **The Archive flow.** `ArchiveDialog` pre-fetches incoming relationships + chunk count and shows them in the confirmation overlay (`AdminClient.js:1302-1403`). The dependency-shows-up-before-you-archive pattern is genuinely good and rare. The atomic `archive_document` RPC (pr-7-7) backs it with transactional integrity. Don't break this.
2. **Reusing `SlideOverReader` for in-place inspection.** Clicking an ID opens the same reader operators see (`AdminClient.js:563-565`, `SlideOverReader.js`). The doc-format arc just made that reader genuinely enterprise-grade, and the admin gets that polish for free. Action-Center-pattern-aligned (split list + detail).
3. **Inline edit ergonomics.** Optimistic write + green flash + reconcile-or-revert + error chip (`AdminClient.js:209-277`) is well-shaped UX *for the fields where editing is actually safe*. The mechanics are reusable; only the field set is wrong.

Bonus protected pattern: server-side re-validation of the owner gate on every write (`route.js:437`, `WRITABLE_FIELDS_A` allowlist at `route.js:109-119`). Don't lose this in any rewrite.

---

## Lens 1: source-of-truth integrity (the central finding)

Per `mdxToDocRow()` in `scripts/content/project-catalog.mjs:385-429` and `diffRow()` at `:431-451`, every field the projection authors is overwritten from MDX on every `--apply`. The projection explicitly comments which fields it preserves (line 425-427: `source_drive_id*` preserved; the diff fields list explicitly omits `pinned`, `archived`, `archived_at`, `storage_path`, `created_at`).

### Field-by-field map of what the dashboard touches

Sourced from `WRITABLE_FIELDS_A` (`route.js:109`), `STATUS_EDIT_OPTIONS` (`AdminClient.js:55`), the worklist columns (`AdminClient.js:469-479`), and the CreateModal form (`AdminClient.js:1480-1633`).

| Field | Dashboard exposes | Truth source | Projection behavior | Verdict |
|---|---|---|---|---|
| `id` | Read (chip / open-reader btn) | MDX `frontmatter.id` | Used as upsert key, never changed | OK |
| `title` | **Edit** (inline text) | MDX `frontmatter.title` | **Overwritten on apply** | **SILENT-DATA-LOSS TRAP** |
| `shelf` | **Edit** (dropdown) | MDX `frontmatter.shelf` | **Overwritten on apply** | **SILENT-DATA-LOSS TRAP** |
| `doc_class` | **Edit** (dropdown) | MDX `frontmatter.doc_class` (locked to ID prefix by validator) | **Overwritten on apply** | **SILENT-DATA-LOSS TRAP** (and an inconsistent doc_class will fail the next projection run anyway) |
| `status` | **Edit** (dropdown) | MDX `frontmatter.status` | **Overwritten on apply** | **SILENT-DATA-LOSS TRAP** |
| `version` | **Edit** (inline text) | MDX `frontmatter.version` | **Overwritten on apply** | **SILENT-DATA-LOSS TRAP** |
| `pinned` | **Edit** (toggle) | `document_pins` overlay (pr-7-9) | Projection NEVER touches `document_pins` (script header L29) | **OK - genuinely overlay** |
| `source_drive_id` | **Edit** (Drive Link Panel) | `documents.source_drive_id` overlay | Preserved by projection (omitted from upsert) | **Overlay-safe, but DEAD** (Drive retired) |
| `source_drive_id_es` | **Edit** (Drive Link Panel) | `documents.source_drive_id_es` overlay | Preserved by projection | **Overlay-safe, but DEAD** |
| `archived` / `archived_at` | **Edit** (archive/restore flow, via RPC) | overlay | Projection auto-archives MDX-absent docs but never un-archives | **OK - genuinely overlay** |
| `card_line` | Hidden (not shown, not editable) | MDX | Overwritten on apply | Hidden, MDX-authored - safe |
| `summary` | Hidden | MDX | Overwritten | Safe-but-invisible |
| `keywords` | Hidden | MDX | Overwritten | Safe-but-invisible |
| `owner` | Hidden | MDX | Overwritten | Safe-but-invisible |
| `approver` | Hidden | MDX | Overwritten | Safe-but-invisible |
| `audience` | Hidden | MDX | Overwritten | Safe-but-invisible |
| `classification` | Hidden | MDX | Overwritten | Safe-but-invisible |
| `print_required` | Hidden | MDX | Overwritten | Safe-but-invisible |
| `critical` | Hidden | MDX | Overwritten | Safe-but-invisible |
| `sort_order` | Hidden | MDX | Overwritten | Safe-but-invisible (and operational - operator browse order!) |
| `effective_date` | Hidden | MDX | Overwritten | Safe-but-invisible |
| `last_reviewed` | Hidden | MDX | Overwritten | Safe-but-invisible (and operational - review staleness!) |
| `next_review` | Hidden | Projection-computed | Overwritten | Safe-but-invisible |
| `approved_date` | Hidden | MDX `frontmatter.approval.approved_date` | Overwritten | Safe-but-invisible |
| `access_level` | **Hidden** | MDX `frontmatter.access_level` | Overwritten (defaults to `unrestricted`) | **HIGH-IMPACT INVISIBLE** - the 3-tier gate is wired but unsurfaced |
| `subshelf` | Hidden | MDX `frontmatter.subshelf` (HR-A/B/C) | Read by future rail expansion | Operational, invisible |
| `surfaces` (where doc appears) | Hidden | MDX `frontmatter.surfaces` -> `document_surfaces` table | Overwritten | Operational, invisible |
| `relationships` | Hidden in dashboard, visible in slide-over | MDX | Overwritten | OK (visible elsewhere) |
| `storage_path` | Hidden | overlay (reserved for Supabase Storage) | Preserved | OK |
| `created_at` / `updated_at` | Hidden | overlay | Preserved | OK |

### Score

- **5 silent-data-loss traps** (title, shelf, doc_class, status, version) - every one of these is a labeled editable cell with optimistic UI and a green "Saved" flash that will lie. Edit a title here today and the change survives until Kevin runs `--apply`, after which it disappears with no notification. This is the single worst thing in the dashboard.
- **2 safe-but-dead** (source_drive_id, source_drive_id_es) - genuinely overlay but pointing at a retired system. They dominate dashboard real estate (KPIs, sort column, expandable row panel, soft warning on status-to-Live) for zero current value.
- **1 actually-safe-and-live** field: `pinned`. The toggle works correctly, lives in the overlay, never gets clobbered, ships operational value to the catalog (floats the doc to the top of its shelf). It is also the smallest, most easily overlooked control on the page (a tiny pin icon column).
- **2 actually-safe-and-operational** flows: archive + restore. These work correctly.
- **Several high-impact MDX-authored fields hidden entirely** that the owner *might* want to triage on (access_level, sort_order, last_reviewed, card_line, subshelf, surfaces). For the rebuild these should at minimum be *visible* even if not editable, with a path to the MDX file as the editing affordance.

### Why this is the lead finding

The dashboard's job in the new world is to manage the overlay + bridge to MDX authoring. As shipped today it does the *opposite*: it pretends the catalog row is canonical, exposes editing on MDX-canonical fields, and hides the actually-overlay-only fields (other than pin and archive). The mental model is inverted.

---

## Lens 2: dead / misleading affordances (inventory)

Five categories of dead weight, ordered by prominence:

### 2.1 The "Linked to Drive" KPI cluster (most prominent)

**Code:** `AdminClient.js:380-401`. Two of the four metric cards measure Drive linkage; the widest card on the row is a horizontal progress bar showing 9% (Linked) with the most visually weighty text on the page.

**Why it's wrong:** Drive is retired. The doc-format arc replaced Drive-hosted PDFs with MDX-rendered enterprise documents (cover, TOC, print/PDF, the works). A doc with no Drive ID but a populated `document_content.html` row renders perfectly in the slide-over reader and the full-page doc reader. So "9% Linked to Drive" is now a fossil metric. It reads to a casual observer as "this system is 9% complete," which is exactly the wrong story - the system is well past that.

**What it should measure (if anything):** "Live with content populated" (count of docs where `status='Live'` AND a `document_content` row exists). Or: "Live and shippable" (status=Live AND no validation errors AND content_html present). Or remove the percentage card entirely - the count chips below already do the same work without the false framing.

### 2.2 The expandable Drive Link Panel (`AdminClient.js:780-963`)

Roughly 180 lines of polished UI (EN + ES input + Save button + test-render link + sharing hint with stretched-link icon). Every row in the worklist has a chevron-link button to expand this panel. In the current architecture the panel is **building tools for a system that has been removed**. The Linked column itself is the second-narrowest in terms of value (one boolean we no longer key off) but commands one of the loudest interaction affordances (a clickable expand-panel button with a chevron, prominent on every row).

**Recommendation:** delete the Drive Link Panel. Delete the Linked column. Delete the source_drive_id and source_drive_id_es fields from `WRITABLE_FIELDS_A`. If a single doc needs an emergency Drive-link override for a legacy fallback that hasn't been migrated yet, do that in Supabase Studio.

### 2.3 The "set Live without a Drive ID" soft warning (`AdminClient.js:218-225`)

```javascript
if (field === "status" && newValue === "Live" && !doc.source_drive_id) {
  const ok = window.confirm(
    `${doc.id} has no Drive file linked. Operators would see a Ready card
    that opens nothing.\n\nSet Live anyway? You can link the Drive file
    later from this dashboard.`
  );
```

**Why it's misleading:** the statement is *partially true today but for the wrong reason*. Operators *would* see a Ready card that opens nothing - because the *operator catalog* (`PlaybookClient.js:452, 943, 998`) still computes `isAlive = !!doc.source_drive_id && doc.status === "Live"`. So the warning is correct given the alive-test, but the alive-test itself is the broken thing - it should key off `document_content` presence, not Drive linkage.

**Recommendation:** fix the operator catalog's alive-test (cross-module finding, see Cross-Module Callouts) and then delete this warning entirely. Don't fix the warning text - the underlying gate is the bug.

### 2.4 The New Document flow (`AdminClient.js:1480-1634`)

Creates a `documents` row only. In an MDX-source world a row with no MDX file is the projection's "absent from MDX" archive trigger (`project-catalog.mjs:330-338`). Trace:

1. User opens dashboard, creates "PB-007 New Handbook" with `status=Pending`.
2. Row inserted into Postgres `documents` table. Dashboard shows it in the worklist.
3. Kevin runs `node --env-file=.env.local scripts/content/project-catalog.mjs --apply` next time he projects.
4. PB-007 is in PG but absent from `content/documents/`. Projection adds it to `docPlan.archive` with `reason: "absent_from_mdx"`. The `archive_document` RPC fires - row flipped `archived=true`, any chunks deleted (there are none yet anyway).
5. The doc is now in the Archive tab. Operators don't see it. There's no error, no warning, no notification. The doc is a ghost.

**Why this is bad:** the creation flow has no path to becoming a real, persistent document. The form asks for ID, title, class, shelf, status, version - all of which then get clobbered or archived by the next projection. The CreateModal is exactly as broken as the inline editors, just for a different reason: not silent-data-loss, but silent-auto-archive.

**Recommendation, in priority order:**
- **(A)** Remove the New Document button from the dashboard entirely; new docs are MDX-authored. The dashboard documents this in the empty state ("New docs are authored as `.mdx` in `content/documents/`. The projection picks them up on the next apply.").
- **(B)** Replace it with a "Scaffold New MDX" affordance that writes a stub `content/documents/PB-007.mdx` to a working branch (or copies to clipboard, or prints to a `.scratch/scaffolds/` folder). Requires file system access, so it's a CLI tool not a route - but the *dashboard* can expose a "Scaffold this in MDX" link that points to a documented script.
- **(C)** Worst case: keep New Document but warn loudly that the row will be auto-archived unless the matching MDX is added before the next projection apply, and time-stamp it with "create until 2026-XX-XX" so it's obviously expirable.

I'd take (A) as the floor and (B) as the ceiling.

### 2.5 Misc dead/minor

- `restoreNote` in `RestoreDialog` (`AdminClient.js:1412-1417`) keys off `source_drive_id` to choose between "re-extract from Drive" vs "no chunks": this is correct *for now* because the Sous re-embed dispatcher still routes that way, but should be revisited when SousAI A7 retires the Drive-extraction path. Logging as P2 to follow-up.
- Status options include `Draft` in the API validator (`route.js:118`) but `Draft` was dropped from the schema in pr-7-8 (per `AdminClient.js:53-55` comment). The validator should probably tighten to the 6-set; today it's permissive in a way that lets an unused state slip through. P3.

---

## Lens 3: IA + operator's real job

### What an owner of 89 active docs (and 12 archived) actually needs to know at a glance

These are the questions the dashboard should lead with - reverse-engineered from the owner's role (Kevin, solo, MDX-authoring + overlay-managing + operator-facing-quality-controlling):

1. **What's blocking a Live publish today?** (docs with status=In Build / Pending / Blocked that have all the content but a missing field or validation error)
2. **What's a placeholder still waiting on external content?** (PB-006 priority is the canonical example - flagged today, well-done)
3. **What's stale?** (Live docs whose `last_reviewed` is older than `review_interval_months`)
4. **What did I change since the last projection apply?** (overlay state that's drifted from MDX, or MDX that's drifted from PG)
5. **Are there validation errors in the corpus that will halt the next apply?** (the projection halts at error count > 0, `project-catalog.mjs:934-938`)
6. **What's pinned and what's surfacing where?** (overlay-y, operational, currently invisible)
7. **Is there any issue I haven't triaged?** (`document_issues` table exists, has `listIssues` in `dataStore/opd.js:228-236`, but the dashboard never reads it)
8. **What's recently archived that I might need to restore?** (Archive tab handles this)

### What the dashboard actually leads with

- **89 Active docs** (count - mildly useful)
- **8/89 Linked to Drive** (count - the wrong dimension)
- **11 Live** (count - useful)
- **9% Linked to Drive** (percentage + horizontal progress bar - the most visually emphasized element on the entire page, measuring the wrong dimension)

Then status pills (useful, scannable, well-done). Then the Gaps & Blockers panel (one PB-006 line + a "no other gaps" message - lean but honest).

Then 89 rows of flat table sorted by status.

### Verdict

The dashboard leads with one weak signal (Active docs = "how many rows in the table"), one wrong signal (Linked to Drive ×2), and one good signal (Live count). The single most visually emphasized element is the wrong-dimension percentage bar. The Gaps & Blockers panel is the *seed* of what should be the dashboard's center of gravity - it answers question (2) above and gestures at (1) - but it's a thin two-line panel below four KPI tiles that all out-shout it.

### The triage-first IA recommendation

Re-architect as a triage cockpit. Lead with grouped attention buckets, not aggregate counts. ASCII sketch:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Build Dashboard                                          [+ Scaffold MDX] │
│ Owner editing · 89 active · 11 Live · 12 archived · k.fietek@kf.com    │
├─────────────────────────────────────────────────────────────────────┤
│  ATTENTION  ┃  WORKLIST  ┃  ARCHIVE  ┃  OVERLAY                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ◆ PRIORITY        ── PB-006 Culinary OS Handbook (Placeholder)     │
│                       gates SLA rebuilds · waiting on Britt           │
│                                                                     │
│  ◆ READY TO SHIP   ── 4 docs status=In Build with all fields populated │
│                       SOP-002 v2.2, FORM-001, FORM-002, PB-003       │
│                       [bump to Live]                                 │
│                                                                     │
│  ◆ EMPTY SHELLS    ── 3 placeholders still need content              │
│                       PB-006, TPL-019, TPL-103                       │
│                                                                     │
│  ◆ STALE           ── 6 Live docs past their review interval         │
│                       AGR-001 (last 2026-01-…, 12mo cycle)            │
│                       …                                              │
│                                                                     │
│  ◆ VALIDATION      ── 0 errors blocking next apply  ✓                │
│  ◆ DRIFT           ── 2 overlay-only edits since last apply (pin,    │
│                       archive)                                       │
│  ◆ ISSUES          ── 1 unresolved issue (FORM-003)                  │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  Recent activity · last 24h                                         │
│  - archived REF-003 · 2h ago                                         │
│  - pinned POSTER-001 to top of People & Conduct · yesterday          │
│  - projection apply OK · 3 days ago (5 inserts, 12 updates)          │
└─────────────────────────────────────────────────────────────────────┘
```

The flat table doesn't go away - it lives in the **Worklist** tab and gets search/filter (see Lens 6). Attention tab is what loads first. Archive tab stays. Overlay tab is new - exposes the genuinely-overlay fields (pin, access tier visibility, archive set) with bulk operations.

### Severity

This is a P1 / P0 mix. Leading the page with the wrong-dimension Linked-to-Drive bar is P1 (the page works, the owner just routes through cognitively-wrong scaffolding to get to the useful Gaps panel). The IA reorganization itself is a rework decision, not a per-bug fix.

---

## Lens 4: governance + overlay management gaps

What's *live in the system* but *invisible in the dashboard*. Sourced from `opdAcl.js`, `dataStore/opd.js`, the schema migrations, and frontmatter inspection.

### Live and missing from the dashboard

| Concern | Schema/code home | Current state | Dashboard exposure | Recommendation |
|---|---|---|---|---|
| **3-tier access gate** (`access_level`) | `opdAcl.js:78-127`, `documents.access_level` (pr-7-11) | Wired end-to-end (bootstrap filter + detail handler + SousAI RPC). Today every doc defaults to `unrestricted` (0 MDX files set this) | **Completely absent** | Surface as a column (chip: unrestricted / restricted / slt). MDX-authored, so dashboard show + link-to-MDX-to-change. SLT-only docs are an operational reality once Kevin tags any doc - the dashboard must show this. |
| **`document_issues`** triage queue | `dataStore/opd.js:228`, `route.js:451-503` (report-issue accepts writes), schema in pr-7-1 | Reporter writes available; reader reads nothing | **Completely absent** | Add an "Issues" panel to the Attention IA. Show open count, surface issue text, allow resolve/close from the dashboard. Today every reported issue goes to Slack and into a PG row that's never re-read. |
| **`surfaces`** (where the doc appears) | `document_surfaces` table, `dataStore/opd.js:199-222`, MDX `frontmatter.surfaces` | MDX-authored; powers `getDocumentsForSurface` | **Absent from dashboard** | Show as a chip strip in the slide-over (already in the slide-over reader, probably) and as a column or filter in the worklist - "show docs surfacing on new-hire-onboarding" is a real operator query. |
| **`subshelf`** (HR-A/B/C, etc.) | MDX-only, read by future rail expansion | Present on 11 docs (HR sub-tabs) | **Absent** | Show as a secondary chip on shelf cell. Filter by subshelf when shelf=People & Conduct. |
| **`sort_order`** | MDX-authored, drives operator browse order | Used in `listDocuments` ORDER BY | **Absent** | Show as a column. MDX-authored, so dashboard read-only with link-to-MDX. Or: re-architect so sort_order moves to the overlay (genuinely operational). |
| **`pinned`** | Overlay (pr-7-9 `document_pins`) | Editable; works | Present (small toggle column) | OK, but raise to a more prominent affordance. Today it's the only field that's both safe-to-edit and live - it deserves better visual weight. |
| **`last_reviewed` / `next_review` / `review_interval_months`** | MDX-authored, projected to `documents` | Computed | **Absent** | Surface "X stale docs past review window" in the Attention IA (see Lens 3). The data is there. |
| **`approved_date` / approval block** | MDX `frontmatter.approval` (pr-7-14) | Projected to `documents.approved_date`, rendered on cover | **Absent from dashboard** | Surface as a small chip in the slide-over header; flag "approved without date" as a validation issue. |
| **`critical` flag** | MDX-authored | Affects styling on operator card | **Absent** | Show as a column or a triangle indicator in the title cell. |
| **`print_required` flag** | MDX-authored | Affects POST class operator UI | **Absent** | Show as a small icon column. |
| **`storage_path`** (reserved for Supabase Storage PDFs) | Overlay | Future-PDF home | **Absent** | Surface when populated; null until that storage plane gets built. |
| **Projection sync state** | Derivable from PG vs MDX diff | Computable via `--dry-run` | **Absent** | Could expose a "Sync: in sync / N drifts / last apply: 3 days ago" badge on each row or aggregated. See Lens 5. |
| **Recent activity / audit log** | Not persisted today | - | **Absent** | New feature ask. Worth scoping; small append-only `document_audit` table would do it. |

### Verdict

The dashboard exposes pin, archive, and (incorrectly) the entire MDX-canonical field set. It hides almost every other overlay-y, governance-y, or operationally-shipped field. The rebuild should invert the field-exposure model: every overlay field gets a first-class affordance; every MDX-authored field gets a read-only display + link-to-MDX.

---

## Lens 5: the MDX bridge proposal

This is the connective tissue the current dashboard doesn't have. Five pieces, in priority order:

### 5.1 Make the source-of-truth boundary visible

Every editable cell today looks the same regardless of whether the edit will stick. The user has no way to know that editing `title` is futile but editing `pinned` is real.

**Proposal:** dashboard cells render in two visual modes:

- **Overlay-editable** cells: today's blue click-to-edit affordance. Inline edits commit and stick.
- **MDX-authored** cells: small text + a discrete "Edit in MDX" link or a file icon. No click-to-edit. Hover/click opens a small panel with the MDX file path and (optionally) a "Copy edit prompt" affordance: a snippet that says "change `title` on `content/documents/AGR-001.mdx` from X to Y" that Kevin can paste into Claude Code in his editor.

If the rebuild absolutely keeps inline editing on MDX-authored fields (against my recommendation), the cell must show a persistent warning: "Lives in MDX. Next projection apply will overwrite unless MDX is updated." Not a tooltip - a visible indicator. The current green-flash + no-warning model is actively dishonest.

### 5.2 Per-doc content state indicator

Today the dashboard signals readiness via `source_drive_id` presence. The correct signal in the new world:

- **No content** - no row in `document_content` for this doc_id. Status: Empty Shell. Operator catalog won't render; reader falls back to "no content yet" empty state.
- **Content present, EN only** - one row. Status: Live (EN).
- **Content present, EN + ES** - two rows. Status: Bilingual.
- **Content stale** - `document_content.content_hash` differs from what the current MDX would render. Status: Drifted (re-project to refresh).
- **Validation errors** - the doc would fail the next projection's pre-write validation. Status: Blocked-by-validation.

Surface these states in a single column ("Content") with chips: `EMPTY` / `EN` / `EN+ES` / `DRIFTED` / `INVALID`. This *replaces* the Linked column and is the actual readable-state-of-the-doc signal.

### 5.3 Projection sync awareness

Run a lightweight version of `project-catalog.mjs --dry-run` on a button click ("Check sync") - or in the background nightly - and surface its summary:

- Last apply: 2026-06-15 14:30 (5 inserts, 12 updates, 0 archives)
- Currently drifted: 3 docs would update on next apply (title changed in MDX, etc.)
- Validation: 0 errors blocking
- Stray tokens / unresolved Includes: 0

The full report already exists at `docs/opd/foundation/PROJECTION_DRYRUN.md` (write target). The dashboard could read its headlines and surface them.

### 5.4 MDX file linkage

Every doc has a known file path: `content/documents/${id}.mdx`. The dashboard should:

- Show the path on hover or in the slide-over reader header.
- Provide a "Open in editor" affordance that fires `vscode://file/<absolute-path>` or `cursor://file/<absolute-path>` - these protocol handlers work; one click, file opens. This is the floor.
- Optional ceiling: a GitHub deep link to the file on `main` for review.

### 5.5 Bulk overlay operations

Once the dashboard owns just the overlay (pin, archive, and whatever moves there), bulk select on the worklist becomes high-value:

- Pin all docs on shelf X
- Bulk archive a list
- Bulk change access tier (if access_level moves to overlay)
- Bulk re-shelve (if shelf is partially overlay)

Linear's bulk actions on table rows is the reference pattern.

---

## Lens 6: interaction, density, scale, craft

At 89 rows the table is *just* usable. At 200 it falls apart on these axes:

### What's missing

1. **No search/filter/keyword search.** None. 89 rows = scroll the whole list to find FORM-009. No filter chip strip ("show me only In Build", "show me only People & Conduct"). The status pill row at the top is a *summary* not a filter. **P1.**
2. **No multi-column sort, no saved sort/view presets.** Single-column sort only. "Show me Stale Live docs" requires changing sort by hand every time. **P2.**
3. **No bulk selection / bulk actions.** "Bulk archive these five LEGACY-* rows" requires five separate dialog confirmations. **P1 once you have >5-row bulk operations to do, P2 otherwise.**
4. **Keyboard navigation:** the cell-edit affordance is mouse-only. No `j/k` row nav, no `Space` to open reader, no `Cmd-K` command palette to jump to a doc by ID. At 89-200 rows a power-user catalog should have these. **P2.**
5. **The Drive Link Panel expansion model.** Inflates the row by ~180px, only one panel open at a time, but it eats massive vertical real estate for a dead feature. **P0 to delete.**
6. **Inline-edit forgiveness.** Escape cancels, blur commits, Enter commits - good. But no undo on commit-by-blur, no "this row has unsaved changes" indicator after navigating to another row mid-edit. With optimistic UI this is mostly fine, but with MDX-overwrite risk on the same fields it's actively hostile. **P0 once you've kept any of these fields editable; moot if the editable set shrinks per Lens 1.**
7. **Loading / error / empty states are very thin.** `LoadingState` is a single text line; `ErrorState` is a tiny ⚠ + message; the worklist's empty state doesn't render because we always have 89 rows. None of these communicate state effectively per the design principles' "Design all states" baseline. **P2.**
8. **Pagination, virtualization, sticky header.** At 89 rows DOM rendering is fine, but the table header scrolls away as you scan - sticky header is missing. At 200+ rows virtualization becomes worth considering. **P2 (header), P3 (virtualization).**
9. **No "what changed since last load" affordance.** Dashboard is a snapshot. No "you have a Live edit since X minutes ago" indicator on the row, no diff vs last-projection-apply. **P2.**
10. **The Pin column is undersized.** It's the only safe-and-live editor on the page; it deserves a larger affordance and a column header that communicates what it does ("Pin" is OK but "Float to top of shelf" would communicate the operator-facing meaning). **P3.**

### What's well-done

- **Sort header click + arrow** is clean and works.
- **Status pill row** matches the operator catalog's visual language, scannable, color-coded with shape redundancy (count number + label).
- **Slide-over reader reuse** preserves the polished doc-format-arc reader inside the dashboard with one prop (`isOwner=true`).
- **Optimistic write + reconcile pattern** is correctly implemented.

### Scale to 200 rows

The flat table will be unusable. Search/filter/saved views become required, not optional. The triage-first IA from Lens 3 also bears the brunt of the scaling problem: at 200 rows the Attention cockpit gives you 8-12 things to look at first, regardless of corpus size, while the worklist becomes a search/filter surface rather than a scroll-and-scan surface.

---

## Lens 7: visual + brand (enterprise-grade bar)

Calibrated against the `DESIGN_SYSTEM_REFERENCE.md` Density tokens, the Linear/Ramp/Notion anchors, and the doc-format reader Kevin just shipped (which IS enterprise-grade).

### Where it falls short

1. **Hierarchy.** The Linked-to-Drive progress bar is the loudest element on the page, measuring the wrong dimension. The most operationally meaningful surface (Gaps & Blockers) is a thin two-line list squeezed between the KPI tile row and the worklist table. Visual weight = decision weight; today they're inverted.
2. **KPI tile design.** Plain centered number + label. No deltas, no sparklines, no trend indication. Compare to Linear's project-status surfaces or Ramp's spend dashboards: KPI tiles there carry a delta vs prior period, a small trend chart, a textual change ("+3 since Monday"). The dashboard's tiles are visually 2018-era admin-template.
3. **Type scale + density.** Reads as Density mode but undertuned. The h1 "Build Dashboard" + "Owner editing · Active documents only · k.fietek@kitchfix.com" subhead is the most prominent text and is informationally low-value. Worklist column headers and cell text are appropriate Density (11/13/14px range looks right). What's missing is the *hierarchy* between KPI tile numbers (which should be the largest non-header text on the page) and ambient text.
4. **Color discipline.** Status pills are correct. Otherwise the page is mostly white-on-light-gray with the one navy accent on the back link. Linear/Ramp use color sparingly but deliberately for status carriers; the dashboard uses it only for status pills, leaving the rest of the page visually flat.
5. **Empty / loading states.** "Loading dashboard..." with a single pulse. The doc-format-reader reader has full skeletons that match final layout. The admin lacks parallel polish.
6. **The Gaps & Blockers panel** is the most operationally-important panel and is visually the thinnest. It deserves to be a card with its own visual weight, not a 1-line list with light padding.
7. **Modal patterns.** The ArchiveDialog and CreateModal use the same ModalOverlay - clean, accessible, escape-closes, backdrop-click closes. This is solid. Hierarchy inside the modals could use the same Oswald/Inter treatment the doc-format arc adopted.

### Where it stands

The visual baseline isn't broken. Spacing, type, alignment are all *acceptable*. What's missing is the deliberate hierarchy + polish that would make the dashboard feel like it belongs to the same family as the just-shipped doc reader. Kevin's bar is the doc reader; the admin shell hasn't been raised to it.

### Recommendation

Treat the admin shell as a child of the same design language the doc reader landed in PR #182-184. Oswald for major page-level headings (Build Dashboard, Attention, Worklist). Inter for body. Spend the right amount of vertical real estate on the Attention panel (the page's reason for existing). Use color discipline to draw the eye to the things that need action. Borrow the modal language from `DocumentFullPageClient.js`'s polish without overloading the admin with cover-page treatment.

---

## Lens 8: expert-eye gaps (what a best-in-class operations cockpit has)

Patterns the dashboard lacks that comparable best-in-class admin tools take for granted:

1. **Activity feed / audit log.** "What's happened in this catalog in the last 7 days?" - archives, restores, projection applies, status changes, issue reports. The dashboard has zero memory. A simple append-only `document_audit_log` table with timestamp + actor + action + diff + doc_id would unlock this.
2. **Command palette (Cmd-K).** Jump to a doc by ID or title. Run a saved view. Trigger an action. Linear, Notion, GitHub all have this. At 89-200 documents, browse-by-scroll is the wrong primary nav.
3. **Saved views / filter presets.** "My open work today", "Stale Live docs", "Empty shells", "Recent archives". Linear's saved-view pattern, GitHub's repo-search-presets pattern.
4. **Validation panel.** The projection halts at validation errors. The dashboard doesn't run validation. There should be a "Validation: ✓ clean / N issues" panel that fires the validator on demand and lists what would block the next apply. This belongs to the operator (Kevin) far more than to a script he runs from a terminal.
5. **Issue triage.** `document_issues` exists, accepts writes from the operator catalog, and is never read in the dashboard. A first-class issues panel (list + status filter + assign-to-self + close) is one of the highest-leverage missing pieces.
6. **Diff view between PG and MDX.** "Show me what would change on next projection apply" - the dashboard could surface a diff-since-last-projection view per doc. The diff logic exists in `project-catalog.mjs:431-451`; it just needs an API + a UI.
7. **Health check beyond Drive linkage.** A "system health" rollup: corpus size, validation errors, drifted rows, content rows behind MDX, issues open, last successful apply. One scannable panel.
8. **Per-doc richer detail in the slide-over.** The slide-over already shows the reader, but it could *also* surface for the owner: when last updated, who edited what, projection sync state, validation status, MDX file path. The reader already exists and is great - the owner-side data is what's missing.
9. **Floor-first lite mode.** Owner-only is the gate today; if access widens later (e.g., shelf-owner role), an Action-Center-style split panel that collapses to a list-pane-only on mobile is the canonical pattern (also referenced in the design principles).
10. **Webhooks / integrations.** Slack issue notifications exist (`route.js:482-499`). A "post archive to Slack" affordance on the Archive dialog, or a "ping ops when this goes Live" affordance, would lean into the design principles' "tight Slack notification loop" working pattern.

---

## Direction recommendation

Kevin's stated target: **production/operations cockpit (triage-first) fused with an explicit MDX-authoring-bridge discipline (overlay-vs-repo boundary made first-class).**

### Does the target hold up?

**Yes - this is the right center of gravity** and I'd push it slightly harder than "fused." The MDX-bridge discipline isn't a feature on top of a cockpit; it's the *foundation* that determines what the cockpit can edit and how it presents every cell. The dashboard's core problem today is that it ignores the source-of-truth boundary; making that boundary first-class IS the rebuild's defining act, with the triage cockpit being the IA expression of that discipline.

### Concretely, what that looks like

A four-tab dashboard:

1. **Attention** (lands here) - the triage cockpit. Grouped buckets: Priority / Ready to ship / Empty shells / Stale / Validation / Drifted / Issues / Recent activity. Each bucket is an actionable list with quick actions where possible.
2. **Worklist** (the catalog table, rebuilt) - searchable, filterable, saveable views. Columns are *visibly* split into Overlay (editable, blue affordance) and MDX (read-only, file-link affordance). Status, Pin, Archive editable. Title, Shelf, Class, Version read-only with "Edit in MDX" link. Content state column (EMPTY/EN/EN+ES/DRIFTED/INVALID). Access tier column (when any doc gets restricted/SLT). Sort, filter, multi-select.
3. **Archive** (kept as-is, with bulk-restore added).
4. **Overlay** (new) - the pure-overlay management surface. Pin management with shelf grouping. Access tier overrides (if/when access_level moves to overlay). Bulk archive batch. This is where the dashboard's "edit" authority lives.

The slide-over reader keeps doing what it does well and gains an owner-only meta panel: MDX file path, validation state, sync state, audit history.

### Risks of the target

- **MDX-bridge friction.** If the only way to fix a typo in a doc title is to open the MDX file, smaller edits feel heavier. **Mitigation:** the "Edit in MDX" link with vscode/cursor protocol handler makes it one click; the actual edit + projection apply takes seconds; and the result is durable rather than ghosted.
- **The overlay set is currently small.** Pin + archive + maybe access tier later. Most of the dashboard's editing energy moves to read-and-link. **Mitigation:** that's the right answer in an MDX-canonical world; the trick is to make the read-and-link surface itself feel substantive (validation, sync, audit) rather than empty.
- **The activity log / audit log is new infrastructure.** Small append-only table, low risk, but a build cost. **Mitigation:** scoping it to dashboard-side writes (archive, restore, pin, status-via-MDX-projection) is a few-row schema and one trigger.

### Alternative directions (per persona format - three options)

I think the recommended direction is correct, but per the brief, here are three:

**Direction A - Triage cockpit + MDX bridge** (recommended). As above.

**Direction B - Strictly read-only + projection-controlled.** The dashboard becomes a viewer + monitor: no editing of anything (even pin and archive move to MDX-frontmatter or to a CLI tool). Pure: status, validation, sync, activity, issues. The smallest possible dashboard.
- Pro: zero risk of silent-data-loss, zero MDX/overlay confusion. Fast to build (mostly delete code).
- Con: pin and archive are *genuinely* operational ("I want to float this doc to the top of People & Conduct *right now*"), not authorial; forcing them through MDX-projection adds friction for state that's meant to be ephemeral.

**Direction C - Move more to overlay, dashboard owns everything operational.** Migrate `pinned`, `access_level`, `sort_order`, `surfaces`, `subshelf` to true overlay tables; MDX stops authoring them. Dashboard becomes the operational source of truth for the overlay set, MDX authors only the content + the static metadata.
- Pro: dashboard editing surface gets *bigger*, more decisions land in the operational tool, less round-tripping through file edits.
- Con: changes a lot of architectural decisions made in the projection. Re-architects the source-of-truth boundary, which is a strictly larger rebuild than Direction A. Real risk of getting the boundary wrong in a way that's painful to walk back.

**Why A wins for me.** B over-corrects (pin is real overlay; let the dashboard own it). C is appealing but front-loads more architectural commitment than the system needs - the existing boundary is reasonable; the dashboard just needs to honor it.

---

## Cross-module callouts

Things that touch the dashboard's redesign but live elsewhere:

1. **Operator-catalog "alive" test is Drive-dependent.** `PlaybookClient.js:452, 943, 998` all compute `isAlive = !!doc.source_drive_id && doc.status === "Live"`. In an MDX-canonical world the alive test should be `status === "Live"` (because the projection's `chk_live_complete` already guarantees Live docs have version + card_line, and the slide-over reader falls back to rendered HTML). This is a P0 cross-module finding: hiding the help bubble in print is a typo-grade fix; the alive-test is wrong for the new architecture and will block any "go Live without Drive" workflow until fixed.
2. **`Draft` status in the API validator but not in the schema set.** `route.js:118` allows `Draft`; `pr-7-8-opd-status-set.sql` dropped it. The dashboard's `STATUS_EDIT_OPTIONS` doesn't include it. Mismatch is harmless today (no rows have Draft) but is a latent inconsistency. P2 to clean up.
3. **`document_issues` is write-only across the system.** Reporter flow writes; no UI reads. Either the dashboard owns the read surface (recommended) or the corpus has no triage at all.
4. **`document_audit_log`-style table doesn't exist.** Whichever direction the rebuild goes, an append-only audit table is the right home for "who archived what when" and "what changed in the last 24h." Scope: one table, one trigger or three write paths. P2 to design alongside the rebuild.
5. **The projection script is run manually** (CLI, env-file flag). The dashboard's "drift / sync" surface depends on either (a) running the projection regularly enough that drift counts are accurate, or (b) the dashboard running a dry-run server-side on demand. Decision needed.

---

## Open questions (need Kevin's input before the rebuild scopes)

1. **Direction lock.** Direction A (triage cockpit + MDX bridge) is my recommendation; the brief sets it as the working target. Confirming.
2. **Pin and archive: confirmed overlay; what about `access_level` and `sort_order`?** Move to overlay (Direction C-flavored) or keep MDX-authored with read-only-display in dashboard (Direction A)?
3. **New Document: delete, gate, or replace with MDX scaffolding?** I recommend delete + add "Scaffold MDX" CLI affordance documented in the empty state.
4. **Drive: when does the operator-catalog alive-test change?** This is a separate PR but it gates how confidently we can delete the Drive Link Panel + Linked column. Sequence question.
5. **Audit log scope.** Just dashboard writes? Projection applies too? Status changes via MDX? Decision drives schema.
6. **Issues triage interaction.** Does the dashboard own resolve/close? Re-assign? Or is the dashboard the read surface and resolution happens in Slack/elsewhere?
7. **Validation surfacing.** Run-on-demand button or background nightly? Surface in the Attention IA or as a separate Health tab?
8. **Activity feed source.** Real append-only table now, or derived-from-`updated_at` for the v1?
9. **Bulk operations scope.** Just pin and archive? Reshelve? Access-tier?
10. **Visual rebuild scope.** Treat as a polish pass on top of the rework, or as part of the rework? The hierarchy/KPI-tile/color-discipline gap is mostly fixable in CSS but the IA reorganization is structural.

---

## Punch list (severity-labeled)

### P0 (do before any further investment in the current dashboard, or as the first acts of the rebuild)

- **P0-1** Editing on MDX-canonical fields (title, shelf, doc_class, status, version) is a silent-data-loss trap. Either remove the editor and replace with read-only display + "Edit in MDX" link, OR add a persistent warning indicator on every such cell. (`AdminClient.js:641-720`, `route.js:109-119`.)
- **P0-2** The KPI tile row leads with the wrong dimension. Three of four tiles are Drive-related; the largest is the 9% Linked-to-Drive bar. Replace with content-presence and corpus-health metrics. (`AdminClient.js:374-402`.)
- **P0-3** Operator-catalog alive-test still keys off `source_drive_id`. Cross-module. Update before the Drive Link Panel can be deleted from the dashboard. (`PlaybookClient.js:452, 943, 998`.)

### P1

- **P1-1** No search, filter, or saved views on a 89-row table. Add at minimum a text-search input + a status filter chip strip. (`AdminClient.js:457-505`.)
- **P1-2** Drive Link Panel + Linked column delete (gated on P0-3). (`AdminClient.js:780-963`, columns at `:725-750`.)
- **P1-3** The status-to-Live confirm warning is misleading (`AdminClient.js:218-225`). Delete after P0-3 lands.
- **P1-4** New Document flow creates a row that gets auto-archived on the next projection apply. Either delete + document MDX-scaffold path, or wire to a real MDX-write. (`AdminClient.js:1480-1634`, `route.js:642-667`.)
- **P1-5** Gaps & Blockers panel deserves to be the visual lead, not a thin afterthought below the KPI row. Restructure as the Attention cockpit per Lens 3.
- **P1-6** `access_level` (3-tier gate) is wired end-to-end but completely invisible in the dashboard. Surface as a column at minimum.
- **P1-7** `document_issues` is write-only across the system. Add a triage panel.
- **P1-8** No bulk-select / bulk actions on the worklist.

### P2

- **P2-1** Dashboard cells should visually distinguish overlay (editable) from MDX-authored (read-only + file-link). Lens 5.1.
- **P2-2** Content state column (EMPTY/EN/EN+ES/DRIFTED/INVALID) replaces the Linked column.
- **P2-3** Surface `subshelf`, `sort_order`, `surfaces`, `critical`, `print_required`, `last_reviewed` as read-only columns or chips.
- **P2-4** Mobile breakpoint: explicit "owner-only-desktop" guard, or a Comfortable-mode fallback that abandons the table. (Persona's mobile-Comfortable override.)
- **P2-5** Sticky table header.
- **P2-6** Inline-edit dirty-state indicator when navigating away from an in-progress edit.
- **P2-7** Loading / error / empty states deeper than one-line messages.
- **P2-8** Visual hierarchy / KPI tile design / color discipline pass to match the doc-format reader's polish bar.
- **P2-9** Tighten `STATUS_EDIT_OPTIONS` and API validator to drop `Draft` (pr-7-8 removed it).
- **P2-10** Modal patterns - good baseline; minor polish to match the doc-format type system.
- **P2-11** `restoreNote` Drive-keyed logic in `RestoreDialog` will need revisit when SousAI A7 retires Drive extraction.
- **P2-12** "What changed since last load" / "since last projection apply" affordance.

### P3

- **P3-1** Command palette (Cmd-K).
- **P3-2** Keyboard nav (j/k/Space).
- **P3-3** Virtualization for >200 rows.
- **P3-4** GitHub deep link to MDX file on `main`.
- **P3-5** Activity feed / audit log (could be P2 if scoped as part of the rebuild).
- **P3-6** Trend / delta / sparkline on KPI tiles.
- **P3-7** Webhook/Slack hooks on archive/restore actions.

---

## Closing position

The Build Dashboard is competently built for an architecture that no longer exists. Five of its eight editable fields are silent-data-loss traps; its three lead KPIs measure a retired dimension; its New Document flow ghosts the row at the next projection. None of these are implementation bugs - they're the dashboard correctly executing the design it was given for a system whose source-of-truth moved.

The rebuild is real work but it's tractable. The triage-first cockpit + first-class MDX-bridge discipline is the right center of gravity. Keep the archive flow, the slide-over reader reuse, the status pill row, the inline-edit mechanics. Rework everything else against the post-doc-format reality. Lead with attention buckets, not aggregate counts; make the source-of-truth boundary visible in the cell affordances; surface the overlay-only governance fields that today are completely invisible.

End of audit. Punch list above; field map in Lens 1 is the single most actionable artifact; direction in the recommendation section is the single most consequential decision. Three open questions (1, 2, 4) gate the start of any rebuild PR.
