# Project OPD — Builder Handoff: Foundation

**To:** Claude Code (Builder)
**From:** Agent, on the Architect's direction (Kevin)
**Re:** Stand up Project OPD — The Playbook catalog + page
**Lands in repo at:** `docs/opd/OPD_CC_HANDOFF.md` (project-management artifact, per STD-005 §1.4 — not an OPD catalog document)

---

## 1. What this is

Project OPD is a **new project, parallel to Project 3 (finance stack)**. It stands up the Operational Playbook Database — a catalog of every operational document — and surfaces it as **The Playbook**, a new top-level intranet page at `/playbook`.

It is **greenfield and Postgres-only**: no Sheets predecessor, no dual-write, no cutover window. `CUTOVER_PLAYBOOK.md` scopes greenfield PG-only features out of the dual-write process — this is exactly that case. Build the PG-only data layer directly.

The original documents-library migration was **never committed** (confirmed by your repo audit, 2026-05-29). The schema below is reconstructed from STD-005 §10, the catalog spec.

**Module name for `opts.module` / `READ_FROM_POSTGRES_<MODULE>`: `playbook`.** Thread it from day one even though there's no Sheets fallback — the dataStore index expects the arg downstream.

---

## 2. Files in this handoff (four, already written)

| File | Repo destination | Status |
|---|---|---|
| `pr-7-1-opd-schema.sql` | `docs/migrations/` | Final — apply as-is |
| `pr-7-2-opd-seed.sql` | `docs/migrations/` | Final — apply after schema + verify |
| `opdAcl.js` | `src/lib/opdAcl.js` | Final |
| `verify-pr-7-1-opd-schema.mjs` | `scripts/` | Final |

Four tables: `documents` (TEXT PK = doc ID), `document_relationships`, `document_surfaces`, `document_issues`. CHECK-constraint enums, `is_historical` + `data_provenance` on every table (values verbatim to pr-6-1), RLS disabled, mandatory GRANT blocks. `chk_live_complete` enforces that a Live doc has a version + card_line; seed/historical rows are exempt.

---

## 3. Apply order (do not reorder)

1. Apply `pr-7-1-opd-schema.sql` via Supabase Studio SQL editor.
2. Run `node --env-file=.env.local scripts/verify-pr-7-1-opd-schema.mjs` — **before** the seed; it expects empty tables and tests the CHECK/FK constraints. Must pass.
3. Apply `pr-7-2-opd-seed.sql` — 41 documents, 38 relationships, 10 surfaces. Seed rows land `is_historical = TRUE`, `data_provenance = 'batch_rebuild'`.
4. Run the manifest backfill (§5) to attach `source_drive_id` to seeded rows. **Until this runs, no document can be opened** — every `source_drive_id` is NULL by design.

---

## 4. The data layer you write: `src/lib/dataStore/opd.js`

PG-only domain. Import `getServiceClient` from `../supabase.js` directly — **do not** route through the dual-write orchestrator or cutover flags. Register exports in `src/lib/dataStore/index.js` alongside the other module facades. Accept and forward `opts.module = 'playbook'` on every function.

Functions (spec, not open questions):

- `listDocuments({ shelf, statuses }, opts)` — ordered `pinned DESC, sort_order ASC, title ASC`. Never returns Retired. Caller passes the status set from `opdAcl.visibleStatuses()`.
- `getDocument(id, opts)` — single row.
- `getRelationships(id)` — edges where `from_doc = id OR to_doc = id`.
- `getSurfaces(id)` / `getDocumentsForSurface(surface)` — the many-to-many.
- `createDocument(data, opts)` / `updateDocument(id, patch, opts)` — `updated_at = now()`; default `data_provenance = 'manual_entry'`.
- `createIssue({ doc_id, reporter_email, issue_text })` — insert into `document_issues`; the route triggers the Slack ping.
- `listIssues({ status }, opts)` — for triage.

---

## 5. The manifest backfill (the step that makes the reader work)

Use `scripts/_lib/backfill-runner.mjs` (upsert strategy). Read `library_manifest` (HUB, 9 rows, live) — `ldug_library_manifest` is unseeded/empty, so skip it for now.

**The wrinkle:** the manifests carry `title` + `drive_file_id` but **no doc ID**. The catalog keys on doc ID. So the backfill must match manifest rows to catalog rows by **normalized title**, then `UPDATE documents SET source_drive_id = ... WHERE id = <matched>`.

Required behavior:
- Normalize titles (lowercase, trim, collapse whitespace) before matching.
- **Report, don't guess.** Emit three lists: matched, manifest-rows-with-no-catalog-match, catalog-rows-still-missing-a-drive-id. Unmatched rows go to Kevin for a manual mapping pass — do not fuzzy-force a match.
- Manifest rows with no catalog match may be real documents missing from the tracker (e.g. an "Appendix C" entry the incident wizard links to). Flag them; don't drop them.
- Also carry the manifest's `pinned` / `critical` / `sort_order` onto the matched catalog row if they disagree (manifest is the live signal for those).

---

## 6. The page + route (the surface)

- **`src/app/playbook/page.js`** — the hybrid layout already designed: navy hero with a SousAI ask bar (v1 = keyword search over `title`/`card_line`/`keywords`; full SousAI later), filter chips, the six shelves as sections (order: Safety · Operations · HR & People · Culinary · Finance · Site & Client), document cards (class as plain language, status pill, pinned star, Print on POST, report-issue flag), and a **slide-over reader** that renders the Drive PDF and prints from there (Drive-id, no Supabase Storage in v1).
- **`src/app/api/playbook/route.js`** — `GET ?action=bootstrap` (shelves + visible docs), `GET ?action=document&id=` (doc + relationships + Drive view URL), `POST ?action=report-issue` (insert + Slack ping to Kevin).
- **Gating, both from `opdAcl.js`:**
  - **Page gate (v1):** `canViewPlaybook(actualEmail)` — owner-only. Non-owner gets a "coming soon" stub, not the page. Use the **actual** authenticated email, never an impersonated one.
  - **Audience:** `visibleDocumentsForUser(email, docs)` — `contacts.team_key === 'CORP'` sees Drafts; everyone else Live only. (Belt-and-suspenders in v1 since the page gate already limits viewers to Kevin.)
- **Nav:** add `{ href: '/playbook', label: 'The Playbook', icon: icons.playbook }` to `TopNav.js` `navLinks` + an `icons.playbook` SVG.
- **Theme:** add `--kf-playbook-teal: #0F6E56` to both `tailwind.config.mjs` (`'kf-playbook-teal'`) and `globals.css`. CSS prefix `pb-` (mirrors `pp-` for People). This is the first per-hub *token*, though per-hub theming is an existing concept (DESIGN_SYSTEM_REFERENCE.md).

---

## 7. Project-tracking requirements (Tier 1 — required, not optional)

The foundational PR is Tier 1 per the doc-tiering policy, so it must co-ship docs:

- Create **`docs/OPD_PLAN.md`** — the project plan, shaped like `FINANCE_STACK_PLAN.md` (working reference for Project OPD: scope, the four tables, the PR sequence, the gating model, the auth dependency).
- Register **Project OPD in `docs/PROJECT_DASHBOARD.md`** as a new item (next free number after the finance-stack item) — status line + per-PR bullets.

---

## 8. PR packaging (3 PRs)

| PR | Ships | Contents |
|---|---|---|
| **7.1 — Foundation** | the cabinet | `pr-7-1-opd-schema.sql`, `verify-pr-7-1-opd-schema.mjs`, `src/lib/dataStore/opd.js`, `src/lib/opdAcl.js`, `docs/OPD_PLAN.md` + dashboard registration |
| **7.2 — Data** | fill the cabinet | `pr-7-2-opd-seed.sql`, `scripts/backfill-opd-manifests.mjs` |
| **7.3 — Surface** | the page | `src/app/playbook/page.js`, `src/app/api/playbook/route.js`, TopNav link + icon, teal theme token, `pb-` CSS |

Rationale for this order over "schema / handler+UI / seed": get real data into the catalog (7.2) **before** building the UI that reads it (7.3), so the page is built and tested against live rows, not stubs. Adjust if you see a reason to.

---

## 9. Hard guardrails — do NOT

- **Do not build the AUTH_MODEL.md `users` table.** That's its own decided project with its own phased rollout. OPD *consumes* its future vocabulary; it does not stand it up. `opdAcl.isCorporateEmail()` reads `contacts` today and has a marked swap point for when `users` ships.
- **Do not enable RLS.** Service-role client + app-layer ACL is the v1 boundary. RLS is the fast-follow that rides on AUTH_MODEL.md.
- **Do not add Supabase Storage.** Drive-id for v1. Storage is deferred until SousAI needs converted copies.
- **Do not rebuild the Leadership Dugout.** Its library is absorbed via the manifest backfill, not duplicated.

---

## 10. Open items to surface back (not blockers)

- **STD-005 needs a small rev:** the catalog field is `shelf` here, §10.2 calls it `hub`; and `CHK` was added to `doc_class` (in the tracker's class legend, omitted from §10.2's nine). Flag for the Architect's next STD-005 pass.
- **Relationships are a partial set** (38 edges reconstructed from the tracker's References Map, not the lost 54). Expand as cross-refs are confirmed.
- **Auth dependency:** the moment the page goes live to the company (page gate widened), the audience rule starts mattering for real — confirm the `users` table exists by then or keep the `contacts`-derived rule.
