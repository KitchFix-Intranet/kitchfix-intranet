# Project OPD: Plan

**Status:** Working reference for Project OPD. Every PR in Project OPD traces back to this artifact.
**Substrate:** STD-005 §10 (catalog schema spec), `docs/opd/OPD_CC_HANDOFF.md` (builder handoff), `docs/architecture/CUTOVER_PLAYBOOK.md` §greenfield (scopes greenfield PG-only out of the dual-write window).
**Module name:** `playbook` (for `opts.module` and any future `READ_FROM_POSTGRES_PLAYBOOK` env var).
**Parallel to Project 3** — not a continuation. The PR numbering family `pr-7-*` is the next free slot after Project 3's PR 6.x, but Project OPD is its own project with its own scope and its own surface (a new top-level page at `/playbook`). Internally we refer to the three PRs as **PR 7.1 / 7.2 / 7.3** (or "Project OPD PR 1/2/3" prose-style). The "Module 7" label was deliberately retired pre-apply because Project 3's plan already uses "Module 7" for Smart Inventory; reusing it here would collide on reader scan.

---

## 1. Scope Statement

### In scope

- **Catalog schema (4 tables, greenfield Postgres):** `documents`, `document_relationships`, `document_surfaces`, `document_issues`. Reconstructed from STD-005 §10; the original documents-library migration was never committed (audited 2026-05-29).
- **Catalog seed (41 documents, 38 relationships, 10 surfaces)** from Documentation Tracker v0.5. Marked `is_historical = TRUE` + `data_provenance = 'batch_rebuild'` to exempt seed rows from the strict `chk_live_complete` gate while remaining queryable and auditable.
- **Manifest backfill** that attaches `source_drive_id` to seeded rows by matching the live `library_manifest` HUB tab (Drive ID + title) against catalog rows on normalized title.
- **PG-only data layer:** `src/lib/dataStore/opd.js` talks to Postgres via `getServiceClient` directly. No dual-write, no cutover flags, no Sheets adapter.
- **App-layer ACL:** `src/lib/opdAcl.js` — page gate (owner-only for v1) + document-status audience filter (CORP sees drafts, everyone else Live only, Retired hidden from all operator views).
- **The Playbook page** at `/playbook` — navy hero, six-shelf layout, document cards, slide-over Drive reader, report-issue affordance.
- **The Playbook API** at `/api/playbook` — bootstrap, single-document fetch with relationships and Drive URL, report-issue insert with Slack ping.
- **Top-nav link + icon + the `--kf-playbook-teal: #0F6E56` theme token** added to both `tailwind.config.mjs` and `globals.css`. CSS prefix `pb-` (mirroring `pp-` for People).

### Out of scope

- **The AUTH_MODEL.md `users` table.** That is its own decided project with its own phased rollout. OPD consumes its future vocabulary but does not stand it up. `opdAcl.isCorporateEmail()` derives the corporate flag from the live `contacts` table today and carries a marked swap point for when `users` ships.
- **Row-Level Security (RLS).** Service-role client + app-layer ACL is the v1 boundary. RLS becomes the boundary only when AUTH_MODEL.md ships user JWTs.
- **Supabase Storage.** Drive-id-only for v1. Storage is deferred until SousAI requires converted-PDF copies.
- **Leadership Dugout library rebuild.** Its library is absorbed via the manifest backfill, not duplicated. The Dugout's existing `library-list` action stays as-is until a separate consolidation PR.
- **The full SousAI search experience.** v1's "ask bar" is keyword search across `title`, `card_line`, and `keywords`. Full retrieval + grounding lands when SousAI's substrate is ready.
- **Cross-shelf document movement, multi-shelf documents, or per-document audience overrides.** A document lives on one shelf and surfaces (many-to-many) on as many intranet tools as needed. The status / shelf / audience axes are orthogonal in v1; no per-document audience override.

### Why this scope

OPD stands up the Operational Playbook Database — a catalog of every operational document — and surfaces it as a single discoverable page. v1 is owner-only (page gate restricts viewers to Kevin) which keeps the launch surface tight while the catalog stabilizes. Once the page widens to the company, the audience rule (`contacts.team_key === 'CORP'`) is the second gate, ready to swap to a `users.role` lookup when AUTH_MODEL.md lands.

---

## 2. Target Architecture

### 2.1 Table inventory

4 PG tables, all in `public` schema:

| # | Table | Purpose | PK |
|---|---|---|---|
| 1 | `documents` | The catalog (one row per document). | `id TEXT` (stable doc ID, e.g. `PB-006`, `SOP-002`, `REF-005-A`) |
| 2 | `document_relationships` | Directed edges (references / implements / supersedes / superseded_by / derived_from / related). | `id UUID` |
| 3 | `document_surfaces` | Many-to-many: a doc's contextual appearances in intranet tools (`kitchen`, `incident-reporting`, `new-hire-onboarding`, etc.). | `id UUID` |
| 4 | `document_issues` | Report-an-issue channel (STD-005 §7.3). Insert → Slack ping in the route handler. | `id UUID` |

Full DDL lives in `docs/migrations/pr-7-1-opd-schema.sql`. Highlights:

- **Enums are CHECK constraints, not Postgres ENUM types.** Matches house style from pr-5-1 / pr-6-1.
- **`is_historical` + `data_provenance` on every table.** Values verbatim from pr-6-1: `'app_scan' | 'batch_rebuild' | 'manual_entry' | 'unknown'`. OPD has no OCR pipeline, so live app writes default to `'manual_entry'`; the seed marks rows `'batch_rebuild'` + `is_historical = TRUE`.
- **`chk_live_complete` on `documents`:** a `Live` doc must carry both a `version` and a `card_line` — but `is_historical = TRUE` rows are exempt. Mirrors pr-6-1's gated-constraint pattern (strict-for-new-writes / lenient-for-historical).
- **RLS disabled on every table.** Service-role client bypasses RLS regardless; the gate is app-layer until AUTH_MODEL.md ships user JWTs.
- **GRANT block on every table.** service_role: `SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE`. anon + authenticated: `REFERENCES, TRIGGER, TRUNCATE` only. Mandatory because the Supabase project has no default-privileges grant configured (discovered during pr-5-1 verification).
- **Idempotent.** `IF NOT EXISTS` throughout, so re-apply on DDL drift is safe.

### 2.2 Indexes

On `documents`:
- `documents_shelf_idx` on `(shelf)` — shelf-page lookups.
- `documents_status_idx` on `(status)` — admin status filters.
- `documents_class_idx` on `(doc_class)` — class filters.
- `documents_browse_idx` on `(shelf, doc_class, sort_order, title)` — the browse-view path.
- `documents_pinned_idx` on `(shelf) WHERE pinned = true` — pinned-first ordering.

On the auxiliary tables:
- `document_relationships`: `from_doc` index, `to_doc` index, UNIQUE `(from_doc, to_doc, rel_type)`.
- `document_surfaces`: `surface` index, `doc_id` index, UNIQUE `(doc_id, surface)`.
- `document_issues`: `doc_id` index, partial index on `status` WHERE `status <> 'closed'`.

---

## 3. Decision Log

Locked decisions baked into the schema + handoff. Format: ID | Decision | Reasoning.

| ID | Decision | Reasoning |
|---|---|---|
| OPD-1 | PG-only data layer; no Sheets adapter, no `coordinatedWrite`, no cutover flag. | Greenfield. There is no Sheets source to dual-write against. CUTOVER_PLAYBOOK §greenfield carves this case out. |
| OPD-2 | Module name `playbook`, threaded via `opts.module` on every `dataStore/opd.js` function (even though no dispatch decision is made). | Caller-side consistency. Mirrors how vendor / invoice route handlers pass `module: "ops"` to every orchestrator. Keeps any future cross-cutting concern (logging, instrumentation, a second backend) loadable without breaking call sites. |
| OPD-3 | `documents.id` is `TEXT PRIMARY KEY`, not `UUID`. | Doc IDs are human-readable stable handles (`PB-006`, `SOP-002`, `REF-005-A`) used in cross-references throughout the operational documentation. UUIDs would break the references map. |
| OPD-4 | `is_historical` + `data_provenance` on every table. Strict constraints (`chk_live_complete`) gated to `is_historical = FALSE`. | Preservation-first pattern locked in pr-6-1 (MODULE_6_DATA_AUDIT.md §8). Seed rows are reconstructed-from-tracker, not app-authored, so they shouldn't be forced through the strict gate. |
| OPD-5 | Page gate checks the **actual** authenticated email, never the impersonated one. | Mirrors `performanceAcl`'s system-viewer asymmetry — if impersonation ever ships for the Playbook, an impersonating system viewer must not be able to escalate by impersonating another system viewer. |
| OPD-6 | Audience source of truth is `contacts.team_key === 'CORP'`, with a marked swap point for the future `users.role` lookup. | AUTH_MODEL.md is its own project. OPD does not stand up the `users` table. The contacts-derived rule is the v1 truth; the swap is a one-line change inside `isCorporateEmail()`. |
| OPD-7 | Retired documents are never shown to operator views (page or admin). STD-005 §3.5. | Retired ≠ deleted; retired rows stay in the table for audit + relationships, but they don't render. `visibleStatuses()` and `filterDocuments()` both exclude them. |
| OPD-8 | The manifest backfill matches by **normalized title**, not ID, and **reports + asks** instead of fuzzy-forcing matches. | Manifests carry `title` + `drive_file_id` but no doc ID. Catalog keys on doc ID. The backfill emits three lists (matched / manifest-orphans / catalog-rows-missing-drive-id); Kevin reviews unmatched cases. Fuzzy-forcing would silently mis-attach Drive files. |
| OPD-9 | Manifest carries the live signal for `pinned` / `critical` / `sort_order`. On a match disagreement, the manifest wins. | The manifest is what operators see today (Leadership Dugout). When the catalog and manifest disagree, the manifest is the production truth. |
| OPD-10 | v1 page gate is owner-only (`PLAYBOOK_OWNER = 'k.fietek@kitchfix.com'`). Non-owner gets a "coming soon" stub, not the page. | Tight launch surface while the catalog stabilizes + the audience rule shakes out. Widening the gate is the launch step. |
| OPD-11 | CSS prefix `pb-` for The Playbook (mirrors `pp-` for People). | First per-hub *token* (`--kf-playbook-teal: #0F6E56`) but per-hub theming is an existing concept per DESIGN_SYSTEM_REFERENCE.md. |
| OPD-12 | PR ordering: schema → data → surface. Get real data into the catalog before building the UI that reads it. | Avoids building a UI against stubs. PR 7.3 (the page) reads live PG rows from day one. Handoff §8 calls this out as the preferred ordering over "schema / handler+UI / seed." |

---

## 4. Migration Sequence

3 PRs. No dual-write, no cutover window, no env-var flag flip.

### PR 7.1 — Foundation (the cabinet)

**Goal:** stand up the schema + data layer + ACL so PR 7.2 has somewhere to land data.

**Ships:**
- `docs/migrations/pr-7-1-opd-schema.sql` — 4 tables + indexes + GRANT block.
- `scripts/verify-pr-7-1-opd-schema.mjs` — 3 sections (tables exist + empty / CHECK + FK rejections / GRANT count; soft-skip on GRANT if `exec_sql` RPC unavailable, verify in Studio).
- `src/lib/dataStore/opd.js` — 9 functions (5 reads + 3 writes + listIssues), every signature accepts `opts = {}`, PG-only via `getServiceClient`.
- `src/lib/opdAcl.js` — page gate + audience filter + the `isCorporateEmail` lookup against `contacts`.
- `docs/OPD_PLAN.md` — this document.
- `docs/PROJECT_DASHBOARD.md` — register Project OPD as item #12 (the next free number after the Stage 1 / Project 3 entry).

**Apply order (manual, via Supabase Studio):**
1. Apply `pr-7-1-opd-schema.sql` via the Studio SQL editor.
2. Run `node --env-file=.env.local scripts/verify-pr-7-1-opd-schema.mjs` — expects empty tables, tests the constraints. Must pass.
3. (Stop here for PR 7.1. The seed lands in PR 7.2.)

**Verification:**
- `npm run build` + `npx eslint` clean.
- Verify script PASS.
- No production behavior change (the page doesn't exist yet; `opdAcl` and `dataStore/opd.js` have no callers until PR 7.3).

### PR 7.2 — Data (fill the cabinet)

**Goal:** load the seed and attach Drive IDs so the catalog can render real documents.

**Ships:**
- `docs/migrations/pr-7-2-opd-seed.sql` — 41 documents / 38 relationships / 10 surfaces; closing `UPDATE … SET is_historical = TRUE, data_provenance = 'batch_rebuild'` on each table.
- `scripts/backfill-opd-manifests.mjs` — reads HUB `library_manifest` (`ldug_library_manifest` skipped per handoff §5; unseeded/empty today), matches by normalized title, emits the three-lists report, updates `documents.source_drive_id` + `pinned` / `critical` / `sort_order` on matched rows. Uses the shared runner at `scripts/_lib/backfill-runner.mjs` (upsert strategy).

**Apply order (manual):**
1. Apply `pr-7-2-opd-seed.sql` via Studio. Counts: 41 / 38 / 10.
2. `npm run backfill:opd-manifests` (dry-run) → review the three lists with Kevin.
3. `npm run backfill:opd-manifests -- --execute` → live update.
4. Verify a representative sample of documents can be opened (Drive viewer URL builds from `source_drive_id`).

**Verification:**
- Counts match (41 / 38 / 10 after seed; `documents.source_drive_id IS NOT NULL` count matches matched-list size after backfill).
- Unmatched manifest rows surfaced to Kevin for the manual mapping pass — not fuzzy-forced.
- Catalog rows that remain `source_drive_id IS NULL` are listed for the next pass; the page renders them but the "Open" affordance is disabled (PR 7.3 wires this).

### PR 7.3 — Surface (the page)

**Goal:** ship `/playbook` as a top-level intranet page reading live PG data.

**Ships:**
- `src/app/playbook/page.js` — navy hero with SousAI ask bar (v1 = keyword search over `title` / `card_line` / `keywords`), filter chips, six shelves as sections (Safety / Operations / HR & People / Culinary / Finance / Site & Client), document cards (plain-language class chip + status pill + pinned star + Print affordance on POST + report-issue flag), slide-over Drive reader that renders the PDF from `source_drive_id`.
- `src/app/api/playbook/route.js` — three actions: `GET ?action=bootstrap` (shelves + visible documents via `opdAcl.visibleDocumentsForUser`), `GET ?action=document&id=` (doc + relationships + Drive view URL), `POST ?action=report-issue` (insert via `opd.createIssue` + Slack ping to Kevin).
- `src/components/TopNav.js` — add `{ href: '/playbook', label: 'The Playbook', icon: icons.playbook }` to `navLinks` + a new `icons.playbook` SVG.
- `tailwind.config.mjs` + `src/app/globals.css` — `--kf-playbook-teal: #0F6E56` color token. CSS prefix `pb-` for the new components.

**Apply order:** no manual DB ops. PR 7.3 lands code only.

**Verification:**
- Page renders at `/playbook` for `k.fietek@kitchfix.com` (page gate passes).
- Non-owner sees the "coming soon" stub.
- Each shelf renders its documents from PG (live counts match `documents` table).
- Slide-over reader opens a Drive PDF for a representative document.
- Report-issue insert hits `document_issues` + posts to Slack.

---

## 5. Gating Model

Two enforcement layers, both app-layer (PG access goes through `getServiceClient`, which is service-role and bypasses RLS):

### 5.1 Page gate (`opdAcl.canViewPlaybook`)

Owner-only for v1.

```js
export const PLAYBOOK_OWNER = 'k.fietek@kitchfix.com';
export function canViewPlaybook(actualEmail) {
  return (actualEmail || '').toLowerCase() === PLAYBOOK_OWNER;
}
```

Takes the **actual** authenticated email. Mirrors `performanceAcl.isSystemViewer`'s asymmetry: if impersonation is ever added to the Playbook, the gate must not be escalatable.

Non-owner gets the "coming soon" stub, not the page. Widening the gate is the launch step — and at that point the audience rule (5.2) starts mattering for real.

### 5.2 Document audience (`opdAcl.visibleDocumentsForUser`)

CORP sees non-Live statuses; everyone else sees Live only. Retired is never shown.

```js
visibleStatuses(true)  // ['Live', 'In Build', 'Draft', 'Pending', 'Placeholder', 'Blocked']
visibleStatuses(false) // ['Live']
```

Belt-and-suspenders in v1 since the page gate already limits viewers to Kevin. But the rule is in place so that when the page widens, the audience filter is the second gate without needing a code change.

The corporate flag comes from `isCorporateEmail(email)`, which today queries `contacts.team_key === 'CORP'`. On lookup error, fails closed (returns false → Live only, never leak Drafts).

### 5.3 Swap point — `users` table

When AUTH_MODEL.md ships, replace the body of `isCorporateEmail()` with a `users.role` lookup. Nothing else changes:

```js
// AFTER (post-AUTH_MODEL):
export async function isCorporateEmail(email) {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('users')
    .select('role')
    .ilike('email', email)
    .limit(1);
  if (error) return false;
  return /* role is corporate */;
}
```

The call sites in the route + page don't change. The signature doesn't change. The behavior is byte-equivalent on the rows that overlap.

---

## 6. Auth Dependency

Project OPD does not block on AUTH_MODEL.md, but the dependency is real once the page widens to the company:

- **v1 (now):** page gate is owner-only. Audience rule reads `contacts`. AUTH_MODEL not required.
- **Launch (gate widens to company):** audience rule starts mattering for real. CORP-vs-not-CORP needs to be accurate across the entire company. `contacts` is still the live source. AUTH_MODEL not required.
- **Post-AUTH_MODEL:** swap `isCorporateEmail()` to read from `users.role`. Better source of truth (per the AUTH_MODEL design); same call shape.

The chain of decisions: keep the page narrow until either (a) the catalog is stable enough that a wider audience makes sense, or (b) AUTH_MODEL ships and the audience rule has a stronger source. Either ordering works.

---

## 7. Risk Register

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Manifest title-match misattaches a Drive file to the wrong catalog row | HIGH | Backfill normalizes titles (lowercase + trim + collapse whitespace) BEFORE matching. Reports unmatched manifest rows + catalog rows still missing a Drive ID. No fuzzy-forcing. Kevin reviews the three lists before live execution. |
| R2 | Seed re-apply on a partially-seeded DB hits PK violations | LOW | Schema is `IF NOT EXISTS` and idempotent; seed is not (matches pr-5-1 / pr-6-1 house style). Re-running the seed requires `TRUNCATE` of the 4 tables first. Documented in pr-7-2 header. |
| R3 | `chk_live_complete` fires on a Live row missing `version` or `card_line` during normal app writes | MEDIUM | All app writes default `is_historical = FALSE` and the constraint enforces version + card_line for Live rows. Operator UX must validate both fields before the row goes Live. PR 7.3 wires the form to require them; the schema is the safety net. |
| R4 | `chk_status_enum` not in OPD (no analog yet) — `status` is unrestricted today on `documents` | LOW | The seven values (`Live / In Build / Draft / Pending / Placeholder / Blocked / Retired`) are enumerated in the `chk_documents_status` CHECK on `documents`. Any drift is rejected by the constraint at insert. |
| R5 | `getRelationships(id)` `.or()` filter chokes on a doc ID containing reserved chars (`.`, `,`) | LOW | Doc IDs follow strict format (`PB-001`, `STD-005`, `REF-005-A`) with hyphens and digits only. No reserved chars in practice. If a future ID format introduces them, switch to two-query union. |
| R6 | Page gate accidentally widened (`PLAYBOOK_OWNER` edited or canViewPlaybook stubbed) | HIGH | Constant lives in `opdAcl.js`, code-reviewed at PR time. No env-var override (intentional — the gate should not be remotely flippable). Launch is a code change + deploy. |
| R7 | `isCorporateEmail` fails open instead of closed | HIGH | Implementation explicitly returns `false` on Supabase error, then `filterDocuments` filters to Live only. Verified in `opdAcl.js` line "Fails CLOSED (denies Drafts) on lookup error — never leak in-progress docs." |
| R8 | Slack ping on report-issue fires before insert (double-fire on retry) | MEDIUM | Route handler order: `opd.createIssue` first (returns the issue id), then Slack ping. If the Slack post fails the issue is still recorded; the operator gets a "filed but notification delayed" state, not a duplicate. |
| R9 | Drive file referenced by `source_drive_id` is deleted or moved | MEDIUM | The slide-over reader handles the error case (Drive 404) and surfaces a "document unavailable — report this" affordance. Tracked via the existing `document_issues` channel. |
| R10 | Catalog row's `source_drive_id IS NULL` and the operator clicks Open | LOW | PR 7.3 disables the Open affordance for rows missing `source_drive_id`. The card still renders so the operator can see "this document is catalogued but not yet attached." |

---

## 8. What Stays Unchanged

- **Service-account-only writes (universal pattern).** The route handler talks to PG via `getServiceClient`. User OAuth stays identity-only.
- **Cross-account visibility (intentional for floor operations).** Documents are not partitioned by account; everyone sees the same catalog (subject to audience rule).
- **Slack notification webhooks.** The report-issue ping uses the existing Slack convention (env var → POST JSON).
- **Drive folder structure.** The reader builds view + thumbnail URLs from `source_drive_id`; the Drive folder layout is untouched.
- **Leadership Dugout `library-list` action.** Stays as-is until a separate consolidation PR. OPD doesn't replace it in v1; it just absorbs the manifest data via the backfill.

---

## 9. Open Items

### Open items to surface back (not blockers)

- **STD-005 needs a small rev.** The catalog field is `shelf` in the schema; STD-005 §10.2 calls it `hub`. `CHK` was added to `doc_class` here but is missing from STD-005 §10.2's nine-class legend. Flagged in handoff §10 — for the Architect's next STD-005 pass.
- **Relationships are a partial set.** 36 edges reconstructed from the tracker's References Map, not the lost 54. Expand as cross-refs are confirmed.
- **Auth dependency.** Once the page widens past owner-only, the audience rule starts mattering for real — confirm `users` table exists or keep the `contacts`-derived rule active.
- **`pr-7-*` PR family preserved for filename sort order only.** The "Module 7" phrase was retired across all OPD file headers + this plan pre-apply because Project 3 uses "Module 7" for Smart Inventory. OPD PRs are referred to as PR 7.1 / 7.2 / 7.3 (or "Project OPD PR 1/2/3" prose-style) instead. Project 3 schema lives at `pr-7-*-inventory-*.sql`, OPD at `pr-7-*-opd-*.sql` — no code-level collision then or now.

### Naming conventions

- **Module name `playbook`** in `opts.module` (lowercase). Future `READ_FROM_POSTGRES_PLAYBOOK` env var would follow the cutover.js convention if a second backend is ever added.
- **CSS prefix `pb-`** for new Playbook components (mirrors `pp-` for People, `oh-` for Ops Hub, etc.).
- **Color token `--kf-playbook-teal: #0F6E56`** in both `tailwind.config.mjs` (`'kf-playbook-teal'`) and `globals.css`.

---

## 10. Document Maintenance

This document is the working reference for Project OPD. Expect it to evolve.

### Update rules

- **When a decision changes:** update Section 3 with a new row showing the new decision + date + reason. Don't delete the old row; add a "Superseded by" note.
- **When a PR ships:** link the PR # from the relevant entry in Section 4. Example: change `### PR 7.1 — Foundation` to `### PR 7.1 — Foundation (shipped #NN)`.
- **When a risk materializes:** update Section 7 with what happened + how it was mitigated. Add new risks as they emerge.
- **When the apply sequence changes:** update Section 4 + Section 5 if the gating model shifts.

### Cross-references

- `docs/opd/OPD_CC_HANDOFF.md` — the builder handoff from the Architect.
- `docs/migrations/pr-7-1-opd-schema.sql` — the DDL.
- `docs/migrations/pr-7-2-opd-seed.sql` — the seed.
- `scripts/verify-pr-7-1-opd-schema.mjs` — the schema verification script.
- `src/lib/dataStore/opd.js` — the PG-only data layer.
- `src/lib/opdAcl.js` — the access control library.
- `docs/architecture/CUTOVER_PLAYBOOK.md` — scopes greenfield PG-only out of the dual-write window; OPD is the first project in that lane.
- `docs/FINANCE_STACK_PLAN.md` — the parallel-project plan whose shape this document mirrors.
- `docs/PROJECT_DASHBOARD.md` — tracks PRs shipped. Update as Project OPD PRs land.

### End of plan
