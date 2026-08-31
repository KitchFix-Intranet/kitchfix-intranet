# Academy critical path

Ordered list of things that must be true (or built) before the Academy can ship. Each item names the source section for evidence.

## Longest-lead item, one sentence

**Populate the `obligations` frontmatter block across the training-carrying MDX documents so the projection has real data to project, because an assignment layer that reads a field zero documents author cannot ship regardless of how correct the code is.** (Source: prompt Section 1.6 + Section B6 + B9.)

## Ordered critical path

1. **Owner ruling: which MDX documents carry real obligations, and who writes them.** Nothing else in the stack can be built ahead of this. Recommendation: pilot on 5-10 known-training docs (Allergen, HACCP, whatever the current compliance calendar names) before extending to the full 129. Source: prompt Section 1.6, Section B6.
2. **Session-to-person identity resolution defined.** `people.work_email` is the only working join today and it covers salaried only. Owner ruling needed on: hourly identity source (`personal_email` policy) OR require every hourly worker to gain a `work_email` before Academy touches them OR add a session-level `person_id` column. Cannot ship the hourly portal without this. Source: Section A1, A2, D14/D15.
3. **A stateful role model that answers "what does this person owe."** Today's role model is four ad-hoc hardcoded allowlists (`src/lib/admin.js`) + one KPI-scoped gate (`roleGate.js`) + `contacts.role` free-text titles + `opdAcl.js` viewer-tier lookups. None of them answer "does this person owe this obligation." Academy needs either (a) a new resolver that composes existing signals or (b) a new `academy_assignments` table populated by rules. Source: Section A3, A5.
4. **Read-time facts/obligations resolver.** The existing `scripts/content/resolver.mjs` runs at PROJECTION time with doc-scoped ctx. Academy needs the same primitives called at REQUEST time with viewer-scoped ctx (account, role). Must be net-new but can share the scoring pattern. Source: Section B9.
5. **`academy_*` schema authored + Studio-applied.** Migration convention lives at `docs/migrations/*.sql`, applied manually in Studio, gated by `.github/workflows/migration-gate.yml`. Recommend `academy_*` prefix to avoid any name collision with the `document_*` OPD family, `contacts`, `submissions`, `accounts`, and `auth.*`. Attestations table should follow the `kpi-8a` grants + post-flight-assertion append-only pattern (SELECT+INSERT only, RAISE EXCEPTION on any UPDATE/DELETE grant). Source: Section C12, C13, G.
6. **Magic-link primitive (token generation, verification, session-issue).** Nothing exists in the repo. NextAuth is Google-only stateless JWT; no EmailProvider, no `crypto.randomBytes`, no signed-URL, no `jose`, no `nanoid`. Net-new component: `token_hash` column, `expires_at`, `consumed_at`, `GET /api/academy/verify?token=...` route, session-issue mechanism. Blocks the entire hourly portal. Source: Section D15.
7. **`academy@` mailbox on the Google Workspace SA domain-wide-delegation allowlist.** Kevin-side Workspace config; not code. `sendEmailSA` at `src/lib/gmail.js:411` already accepts sender as a parameter, so once the alias is authorized, sending is a one-line env var addition (`ACADEMY_FROM_EMAIL`). Source: Section D14.
8. **Bounce detection.** Nothing exists. Options: Gmail `history.list` polling of the sender inbox for DSN patterns, or a dedicated ESP webhook. Owner ruling needed on which. Blocks the "Email bounced" state in the hourly portal's link lifecycle. Source: Section D14.
9. **Certificate PDF template.** Model on `buildIncidentPdf` at `src/lib/incidentActions.js:907` using `pdf-lib`. ~100 lines, single page, fixed fields (name, doc title, date, serial). No Chromium needed. Straightforward once schema/serial mechanism decided. Source: Section D16.
10. **Ruling on the "Sous frozen at v2.0" freeze wording.** The existing `.github/workflows/opd-autoprojection.yml` re-embeds any changed `content/documents/*.mdx` on push to main; if "frozen" excludes this pre-existing OPD publish-to-Sous flow, it's a live contradiction that predates Academy. Owner clarification needed before Academy work references either reading. Source: Section E17.
11. **Mobile Chrome Contract (or waiver).** Nothing exists in the repo. Recommendation from Section F19 is a separate shared-chrome effort BEFORE Academy PR 1 (option (b)), because retrofitting a primitive over the 6 modules with mature per-module chrome is a multi-PR cross-cutting refactor. If ruled otherwise, Academy PR 1 becomes 30-40 files with wide blast radius.
12. **Attestations write path with "never recorded until persisted" invariant.** The SC F3 offline queue is a useful UI-discipline reference (badge-not-fill-swap, no premature success screen, offline chip on ambient) but is DISQUALIFIED as-is: its LWW replay semantics + single-writer localStorage assumption + key-shape (one entry per accountKey|date) would violate per-attestation immutability. Needs per-attestation UUIDs and IndexedDB-or-server-side hold-then-commit. Source: Section C11.
13. **Academy v1 audience ruling.** Kevin-only pilot, one site, or all 30 salaried? The `KPI_PREVIEW_ONLY = true` fence at `roleGate.js:69-70` is the established pattern for this. Owner ruling before PR sequencing. Source: Section A5, prompt Section 5.10.

## Dependencies

- **Item 1 blocks EVERYTHING.** No obligations data = no assignment surface. Recommend piloting on a small subset while items 2-12 land in parallel.
- **Items 2 and 3 must be settled together.** Identity model and role model are coupled; picking one without the other creates a seam.
- **Items 6, 7, 8 form the hourly-portal delivery slab.** All three must land before any hourly worker gets a link.
- **Item 11 either lands first (option b, recommended) or expands Academy PR 1 into a chrome-rewrite arc (option a, rejected).**
- **Item 12 is coupled to item 5.** The migration and the write path are one design conversation.

## What is already true (no work needed)

- **Content projection pipeline works.** `.github/workflows/opd-autoprojection.yml` -> `scripts/content/project-catalog.mjs --apply` -> five ordered UPSERTs across `documents / document_relationships / document_surfaces / document_content`, then per-doc SousAI re-embed. When obligations are authored, the projection will project them into whatever new tables Academy adds. Source: Section B6.
- **Reader render path works.** Pre-rendered HTML from `document_content` -> `dangerouslySetInnerHTML`. No Drive fetch, no MDX resolve at read time. Source: Section B8.
- **Publish gate works.** `commit-mdx` flow at `src/app/api/playbook/route.js:867-1267` goes through GitHub PR + auto-merge + `Playwright tests` required check + projection workflow. Source: Section B7.
- **Migration gate works.** `.github/workflows/migration-gate.yml` prevents unauthorized migrations from merging. Source: Section C12.
- **Email send works.** `sendEmailSA` in `src/lib/gmail.js` sends transactional email via Gmail API with SA domain-wide delegation. Multiple production senders proven (support@, m.chavez@). Source: Section D14.
- **PDF generation works.** `pdf-lib` used in production for incident reports; certificate is a straightforward reuse. Source: Section D16.
- **Append-only pattern works.** `rippling_raw_time_entries / _pay_segments / _users` use GRANT SELECT, INSERT + post-flight `RAISE EXCEPTION` assertion. This is the model for `academy_attestations`. Source: Section C13.
- **Sous consumption is stable.** `canUseSous` + `SousSurface(variant="overlay"|"page")` + `document_chunks` retrieval + provenance-by-docId-and-title. Academy can consume the panel today with zero Sous changes. Source: Section E17.
- **Postgres greenfield.** The Academy naming space (`attestations, signatures, certificates, credentials, training*, obligations, checks, cycles, assignments, magic_links, email_bounces, notifications`) is entirely unclaimed in `public`. Source: Section G.
