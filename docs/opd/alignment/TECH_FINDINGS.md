# OPD + Academy technical findings

Investigation and documentation only. Answers the technical questions in `CC_PROMPT_OPD_ALIGNMENT_MASTER.md` against a fresh origin/main checkout on 2026-08-31. Every factual claim is labeled [verified] (ran, opened, or measured) or [code-read] (inferred from source without executing).

## Laymen's summary

- The intranet already has almost every load-bearing primitive the Academy needs: content projection, PR-gated authoring, migration discipline, Gmail-API sends, append-only DB patterns, PDF generation, and a working Sous panel.
- Three things do not yet exist and gate the build: (a) an authored `obligations` field on any MDX doc, (b) a magic-link primitive for the hourly portal, and (c) any surface that resolves a session to a specific person for the ~73 active hourly workers whose only email is `personal_email` (which is under a "never selected by any route" policy).
- Everything else in the design (badges, standing card, rooms, credentials, cycles, checks) is greenfield code writing against known patterns.
- Recommended path: pilot obligations on 5-10 known-training docs while identity and magic-link tracks land in parallel; ship the Mobile Chrome Contract as a separate arc before Academy PR 1.

## Answers to A1, A2, B6, and D14, stated plainly up front

### A1: OAuth to user identifier (see `SECTION_A_IDENTITY_AUTH.md`)

**Google-only via NextAuth v5. The sole user identifier is `session.user.email`.** Config at `src/lib/auth.js:1-89`. The session callback (lines 85-89) sets only `session.accessToken` and `session.error` - it never touches `session.user`, so `session.user` carries NextAuth's Google profile defaults (`name`, `email`, `image`). No `session.user.id`, no local user-row link, no session-side `role`. Every consumer (16 grep hits including `src/app/layout.js:29`, `src/middleware.js`, every `/api/*/route.js`) resolves permissions on each request from `session.user.email`. [verified]

### A2: Session to `people` row (see `SECTION_A_IDENTITY_AUTH.md`)

**`people.work_email` is the intended and only working join key.** No `user_id` mapping from session to people exists. The canonical join is at `src/lib/kpi/roleGate.js:157-198` using `ilike("work_email", session_email)` + `status='ACTIVE'` to defeat the seasonal-rehire trap. Fails silently for hourly workers because `people.work_email IS NULL` for them and `people.personal_email` carries a column comment `"NEVER selected by any application route"` (`docs/migrations/people-1-table.sql:118-121`). No code path substitutes `personal_email` today. Any Academy hourly portal design must choose one of: (a) change the `personal_email` policy, (b) require every hourly worker to have a `work_email`, or (c) introduce a new session-to-person seam. [verified]

### B6: `/content` to live catalog (see `SECTION_B_CONTENT_PIPELINE.md`)

**GitHub Actions job, not a Next build step.** `.github/workflows/opd-autoprojection.yml` fires on push to `main` when `content/documents/**` changes. It runs `scripts/content/project-catalog.mjs --apply` (836-line Node script). That does five ordered writes to Postgres: (1) UPSERT `documents` by id, (2) `archive_document` RPC for docs present in PG but absent from MDX, (3) `replace_document_relationships` RPC atomic delete+insert, (4) `replace_document_surfaces` RPC same shape, (5) UPSERT `document_content` on `(doc_id, lang)` with pre-rendered HTML + content hash. Then per-changed-doc calls `scripts/sousai-embed-doc.mjs <id>` to re-embed for retrieval. `document_pins` is deliberately never touched. The 129 MDX vs 113 live delta is 16 files with `status: Retired` (NOT `archived=true`; those are different columns - only 4 rows have `archived=true`). [verified]

### D14: Email send capability (see `SECTION_D_DELIVERY.md`)

**Gmail-API is production-live and already sends transactional email. Slack webhooks are NOT the only outbound channel.** `sendEmailSA({ sender, displayName, to, subject, html, replyTo })` at `src/lib/gmail.js:411-449` uses Google service-account domain-wide delegation with the `gmail.send` scope. Multiple production senders proven: `support@kitchfix.com` (people-ops), `m.chavez@kitchfix.com` (incident calendar). A separate user-OAuth path (`sendInvoiceEmail`) uses the signed-in user's Gmail token; NextAuth already carries `gmail.send` in scopes (`src/lib/auth.js:11-19`). An `academy@` alias works with **one operational prerequisite** - the mailbox must be on the SA's domain-wide-delegation allowlist in Google Workspace admin (Kevin config, not code). **Bounce detection: NONE** - grep returned zero matches for bounce patterns. That is the one delivery-side gap for the Academy hourly portal. [verified]

## Per-section files

Full evidence with file-level anchors is in each section file. All claims in each file are individually labeled [verified] or [code-read].

- **[SECTION_A_IDENTITY_AUTH.md](./SECTION_A_IDENTITY_AUTH.md)** - A1 OAuth flow, A2 session-to-people join, A3 opdAcl exports (16 predicates), A4 `user_accounts_*` family, A5 role model (KPI gate is the real one; four hardcoded allowlists coexist).
- **[SECTION_B_CONTENT_PIPELINE.md](./SECTION_B_CONTENT_PIPELINE.md)** - B6 projection job, B7 editor publish path (PR + auto-merge), B8 reader render (pre-rendered HTML via `dangerouslySetInnerHTML`), B9 facts resolver (projection-time only, doc-scoped, not viewer-scoped), B10 status/access/pin seam.
- **[SECTION_C_WRITES_INTEGRITY.md](./SECTION_C_WRITES_INTEGRITY.md)** - C11 Service Calendar F3 offline save queue (disqualified for attestations as-is; UI discipline is transferable), C12 migration convention (manual Studio apply, `.github/workflows/migration-gate.yml` enforcement), C13 append-only pattern (`kpi-8a` grants + post-flight `RAISE EXCEPTION`).
- **[SECTION_D_DELIVERY.md](./SECTION_D_DELIVERY.md)** - D14 email (Gmail-API works), D15 magic-link primitive (nothing exists), D16 PDF generation (`pdf-lib` production-live via `buildIncidentPdf`; certificate is a ~100-line reuse).
- **[SECTION_E_SOUS.md](./SECTION_E_SOUS.md)** - E17 consumption surface confirmed; freeze wording flagged for owner clarification.
- **[SECTION_F_MOBILE.md](./SECTION_F_MOBILE.md)** - F18 per-module breakpoint inventory at 390/430 (all [code-read]; explicitly not [verified] because no browser was opened), F19 Mobile Chrome Contract recommendation (option (b): separate shared-chrome effort first).
- **[SECTION_G_POSTGRES_INVENTORY.md](./SECTION_G_POSTGRES_INVENTORY.md)** - G20 full inventory of tables in scope with LIVE row counts via Supabase MCP; name collisions flagged; Academy naming space greenfield.

## Contradictions with the prompt / mobile brief / renders

Full list with verdicts and blocking-flag in **[GAP_REPORT.md](./GAP_REPORT.md)**.

Highlights:

| Gap | Verdict | Blocks Academy? |
|-----|---------|-----------------|
| Slack-only outbound channel assumption | repo wins (Gmail-API works) | no |
| `user_accounts` table exists | repo wins (dropped 2026-08-28) | no |
| `personal_email` covers hourly identity | owner rules | **YES** |
| `obligations` field authored | spec wins (universally empty today) | **YES (critical path)** |
| Mobile Chrome Contract exists | owner rules | **YES (arc shape)** |
| "One shell, four rooms" | spec wins (nothing like this exists) | **YES (main build)** |
| Sous freeze wording | owner rules | **YES (Sous coupling)** |
| Hourly link lifecycle infrastructure | spec wins (magic-link absent) | **YES (hourly portal)** |
| Person-above-stint identity | spec wins | **YES (schema decision)** |

## Rulings needed (from prompt Section 5, plus gaps flagged during investigation)

Framed as questions with recommendations attached. Kevin decides; the master spec's Open Rulings section (item 17) will carry these until closed.

### From gaps in this investigation

1. **Hourly identity source.** How does an hourly worker's Google-less session resolve to a `people` row?
   - Recommendation: introduce a new `academy_learners` table keyed on `worker_id` with a `link_email` column (defaulting to `personal_email` under an Academy-specific policy exception), plus a magic-link token that binds the click to that `worker_id`. Do NOT modify `people.personal_email` policy; the "never selected" fence stays for internal surfaces.
2. **Mobile Chrome Contract sequencing.** Does Academy PR 1 ship chrome primitives, or does a separate arc land first?
   - Recommendation: separate shared-chrome effort first (option b). Rationale in Section F19: retrofitting a shared primitive over 6 modules that already reflow correctly is a multi-PR cross-cutting refactor, not "Academy PR 1".
3. **Sous freeze reading.** Does "no output attributes pipeline generation to Sous" exclude the pre-existing `opd-autoprojection` -> `sousai-embed-doc` workflow?
   - Recommendation: read the freeze as "no NEW Academy-driven Sous generation". The existing OPD publish -> re-embed flow predates Academy and does not attribute Academy output to Sous.
4. **`public.users` orphan.** Drop the empty table, or namespace all Academy identity tables as `academy_*` to sidestep it?
   - Recommendation: namespace (`academy_*`). Dropping the orphan is a low-value migration; namespacing is a free naming discipline that also disambiguates from `auth.users`.

### From prompt Section 5 (Kevin's own list, recommendations attached)

5. **Calendar vs fiscal months for Academy cycles.**
   - Recommendation: calendar months for the operator, fiscal period as secondary context. The Academy is the one surface not about money; matching the operator's mental model matters more than aligning to finance.
6. **Document-open pattern.**
   - Recommendation: Focus for requirements, modal for Library peeks, inline for single-check refreshers. Matches existing Playbook `pb-slide` for requirements vs `SlideOverReader` for peeks.
7. **Peer visibility (salaried manager with no reports).**
   - Recommendation: aggregate. Individual compliance status is management information; a manager who does not manage anyone should not see it.
8. **Hourly roster visibility.**
   - Recommendation: follow the site (`people.account_key`), not the reporting line (`manager_worker_id`). Rationale: site leaders own the compliance floor for their site; a sous chef supervising line cooks in the kitchen but not in Rippling still needs the roster.
9. **Admin permission split.**
   - Recommendation: yes, separate `library_admin` and `academy_admin` grants. Enables Britt-holds-Library-without-Academy patterns without giving the tree root broader access than intended.
10. **SLT / CEO compliance ownership.**
    - Recommendation: named owner (Josh + Kevin) or an ownerless-tree-root chip that reads "self-attested" for the root. Do not silently exclude the CEO from compliance.
11. **"% current" denominator.**
    - Recommendation: signed of assigned-this-cycle. "Signed of all published" makes early cycles look worse than they are and dilutes the operator signal.
12. **Overdue consequence ladder.**
    - Recommendation: define at least one consequence (e.g., a "not current" chip on the Directory + a manager nudge on day 8). A status without a consequence becomes wallpaper (prompt Section 5.8 language).
13. **Minimum viable obligations authoring subset.**
    - Recommendation: 5-10 known-training docs (Allergen, HACCP, harassment training - whichever the current calendar names). Ship Academy against real data at pilot scale before extending to 129.
14. **Academy v1 audience.**
    - Recommendation: Kevin-only pilot first, using the same `KPI_PREVIEW_ONLY = true` fence pattern from `roleGate.js:69-70`. Widen to one site, then all 30 salaried, then hourly - each step gated by the previous.

## Single longest-lead item

**Populate the `obligations` frontmatter block across the training-carrying MDX documents so the projection has real data to project.** An assignment layer that reads a field zero documents author cannot ship regardless of how correct the code is. (Source: prompt Section 1.6, Section B6, Section B9.)

## Completeness map

Confidence by section (details in each per-section file):

| Section | Overall confidence | Notes |
|---------|--------------------|-------|
| A - Identity & Auth | mostly [verified] | auth.js, roleGate.js, opdAcl.js read end-to-end; exact 30/73 salaried/hourly count NOT verified against live DB (would need `SELECT COUNT(*)`). |
| B - Content pipeline | mostly [verified] | projection workflow + apply function read; 129->113 delta grep-confirmed; publish path + reader render are [code-read] end-to-end. |
| C - Writes & integrity | mostly [verified] | saveQueue.js + ServiceCalendar.js driver, migration-gate.yml, `_GRANT_TEMPLATE.md`, kpi-8a append-only pattern all read end-to-end. |
| D - Delivery | mostly [verified] | gmail.js, auth.js, .env.example read; grep-confirmed absence of bounce detection + magic-link primitive + POST print route. |
| E - Sous | mostly [verified] | opdAcl.js, SousSurface.js, PlaybookClient.js, route.js, store.js, index.js all read; freeze wording flagged for owner. |
| F - Mobile | entirely [code-read] | no browser opened. Every "Fine" / "Cramped" verdict is inference from CSS + JSX. Per memory `feedback_low_risk_is_inference_not_evidence`, do not treat as evidence a chef's phone will render correctly. |
| G - Postgres inventory | [verified] live row counts via Supabase MCP | migrations read for schema + design intent; read/write sites via grep. Auth-schema tables enumerated by name only. |

**What would promote the [code-read] parts to [verified]:**
- Section A: run `SELECT COUNT(*) FROM people WHERE status='ACTIVE' AND work_email IS NOT NULL` (and same for `personal_email`) to confirm exact salaried/hourly counts.
- Section B: actually merge a small MDX change and observe the GHA log to promote step-order/RPC claims.
- Section D: send one test email via `sendEmailSA` with a bad address and observe (a) that the SDK returns `"sent"` (b) that no bounce feedback path exists.
- Section E: run one `POST /api/sousai action=ask` request and inspect the `done` SSE envelope's `sources` field to promote the "no version field" claim.
- Section F: open each of the 7 modules at 390 and 430 in Chrome DevTools with representative data and verify or refute each per-module verdict. Use `TEST_MODE=true` (per memory `feedback_test_mode_bypass_for_playwright`) if a scripted probe is preferred.
- Section G: no promotions needed; row counts are live.

## What was investigated but is not included

Per the prompt's out-of-scope list:
- No product code, component changes, CSS, migrations, or schema DDL was written.
- No changes to Sous, Service Calendar, KPI, People, Ops Hub, or Directory.
- No resolutions to contradictions that belong to Kevin - only flags and recommendations.

## Stop and report

The investigation is complete. No build PR is being opened. This documentation PR (`docs/opd/alignment/*`) is the deliverable; the master spec author reads this, writes `docs/opd/ACADEMY_MASTER_SPEC.md`, and Kevin reviews before any code work begins.
