# Gap report: repo vs prompt Section 1 + mobile brief + renders

Every place the current repo (fresh origin/main checkout, 2026-08-31) contradicts the prompt's established facts, the mobile brief, or the approved renders. For each: what the source claims, what the code says, which should win, and whether Kevin must rule.

**Verdict legend:**
- **repo wins** - the prompt/brief is stale; update the spec to match the code.
- **spec wins** - the code is behind the design; item goes in the build plan.
- **owner rules** - genuinely ambiguous or coupled to policy; needs a Kevin ruling.

---

## Gaps against prompt Section 1 (established facts)

### G-1. `user_accounts` is no longer a table

- **Prompt (Section 1 not stated verbatim but implied in Q4 of Section A):** treats `user_accounts, user_accounts_derived, user_accounts_manual` as three live artifacts.
- **Repo:** `user_accounts` was DROPPED 2026-08-28 via `docs/migrations/user-accounts-table-drop.sql`. Only the derived view (35 rows, VIEW) and the manual overlay (3 rows, TABLE) exist. The last production reader was cut over to `user_accounts_derived` in PR #866 (2026-08-27); see `src/app/api/service-calendar/route.js:420`. [verified - Section A4, G]
- **Verdict:** **repo wins.** The spec should say `user_accounts_derived (VIEW) + user_accounts_manual (TABLE)`, and note that `user_accounts_derived` is deliberately a single-account-per-user projection and cannot represent multi-account scoping.

### G-2. `personal_email` is not usable as an identity join

- **Prompt (Section 1.5):** "100% [of hourly] have a `personal_email`. The magic-link model covers the entire population with no fallback needed."
- **Repo:** `people.personal_email` carries an explicit column comment: `"PII. Stored for a future opt-in workflow; NEVER selected by any application route. work_email is the safe address for internal surfaces."` (`docs/migrations/people-1-table.sql:118-121`, [verified]). Grep confirms zero code paths do `.eq("personal_email", ...)` or `.ilike("personal_email", ...)` anywhere in `src/`. [verified - Section A2, D14]
- **Verdict:** **owner rules.** The magic-link premise requires either (a) sending to `personal_email` (which contradicts the current PII fence), (b) requiring every hourly worker to have a `work_email` before Academy touches them (blocks the pilot), or (c) explicitly changing the policy comment and threading `personal_email` through the send path. This is a policy decision, not a code fix.

### G-3. "Slack webhooks may be the only outbound channel today"

- **Prompt (Section D framing):** "Slack webhooks may be the only outbound channel today - your job is to state whether or not that's true."
- **Repo:** **Contradicted.** Gmail API send (both SA-impersonated via `sendEmailSA` at `src/lib/gmail.js:411` and user-OAuth via `sendInvoiceEmail`) is production-live. Ten Slack webhook env vars coexist with, do not substitute for, Gmail send. NextAuth already carries `gmail.send` scope. [verified - Section D14]
- **Verdict:** **repo wins.** The spec should assume Gmail-API is available today. The prerequisite is `academy@` (or similar) being added to the SA domain-wide-delegation allowlist in Workspace admin - Kevin config task, not code.

### G-4. `obligations` field is defined but universally empty

- **Prompt (Section 1.6):** "This is the critical path. The assignment layer reads a field that is 0% populated."
- **Repo:** Confirmed. `content/schema/frontmatter.schema.json:176-226` defines the shape; zero MDX docs populate it (grep `^obligations:` in `content/documents/*.mdx` returns nothing). [verified - Section B6, B9]
- **Verdict:** **spec wins** (already flagged as critical path).

### G-5. "16 archived" is imprecise wording

- **Prompt (Section 1.6):** "confirm and explain the delta (expected: 16 archived)."
- **Repo:** 129 MDX - 113 visible = 16 delta, but the 16 are `status: Retired` (not `archived: true`). Live PG shows only 4 rows with `archived=true` (per `docs/opd/foundation/PROJECTION_DRYRUN.md:16`), while 16 MDX files carry `status: Retired`. `status` and `archived` are orthogonal columns; reader filters both. [verified - Section B6]
- **Verdict:** **repo wins on wording.** No behavior change; spec should say "16 Retired" not "16 archived" so future work doesn't chase a wrong column.

### G-6. `rippling_raw_workers_latest` is a VIEW, not a TABLE

- **Prompt (Section G question 20):** lists `rippling_raw_workers_latest` alongside base tables.
- **Repo:** It is a VIEW (1129 rows, same as `people` because `people` derives from it). [verified - Section G]
- **Verdict:** **repo wins.** Descriptive lumping is fine; anyone thinking they can INSERT should know it's a view.

### G-7. `public.users` exists but is dead

- **Prompt:** implicitly assumes this table would matter for Academy identity.
- **Repo:** 0 rows, no writers, no readers, no `CREATE TABLE users` in `docs/migrations/`. `docs/GOTCHAS.md:854` explicitly notes it "exists but is EMPTY". [verified - Section A5, G]
- **Verdict:** **owner rules.** Academy planners should either (a) drop the orphan before adding new identity tables, or (b) namespace everything as `academy_*` to sidestep confusion. Recommendation from Section G is (b).

### G-8. `people` count vs `user_accounts_derived` count

- **Prompt (Section 1.1):** 1,129 people total; 103 ACTIVE (105 with end_date null; 31 salaried + ~73 hourly).
- **Repo (via live Supabase MCP):** `people` = 1129 rows [verified]. `user_accounts_derived` = 35 rows [verified] (32 from ACTIVE people with `work_email + account_key`, plus 3 from the manual overlay). If ~30 salaried carry `work_email`, this is consistent. Exact 30/73 counts NOT verified in this pass; would require a live `SELECT COUNT(*) FROM people WHERE status='ACTIVE' AND ...`. [Section A2, G]
- **Verdict:** **no contradiction confirmed.** Ruling not needed. If the exact numbers matter to the master spec, run the count queries.

---

## Gaps against the mobile brief

### G-9. Mobile Chrome Contract has no repo presence

- **Prompt (Section F19 premise):** "The Mobile Chrome Contract has no repo presence."
- **Repo:** Confirmed. Grep for "MobileChrome", "AppShell", "ShellPrimitive", "chrome contract" returns nothing. The only globally-shared chrome primitives are `TopNav`, `HelpFAB`, `ProfileModal`. Module heroes, chrome bars, filter bars, sticky search bars, drill navs, and mobile books-bars are per-module implementations. [verified - Section F19]
- **Verdict:** **owner rules.** Recommendation from Section F19 is option (b): ship a separate shared-chrome effort first, Academy PR 1 becomes chrome-consumer. Option (a) - Academy ships primitives as PR 1 - would be a 30-40 file cross-cutting refactor with wide blast radius.

### G-10. The mobile brief's canonical shelf set

- **Prompt (Section 1.7):** "the mobile brief's asserted canonical set is wrong" - correct. Live `/content` shows People & Conduct (41), Service Delivery (34), Safety Health & Incident (24), Operations & Leadership (20), Brand & Documentation Standards (4), Culinary & Kitchen Operations (3). No Finance shelf, no Site & Client shelf.
- **Repo:** Confirmed by the projection's shelf counts and the MDX frontmatter. [verified via prompt's own count]
- **Verdict:** **repo wins on shelves.** The mobile brief needs an update; not a code issue.

---

## Gaps against the approved renders (Section 1.8)

### G-11. "One shell, four rooms" is not a codebase concept

- **Prompt (Section 1.8):** "One shell. The navy command bar is the lid of a single bordered surface. Four rooms: Academy, Library, Records, Admin."
- **Repo:** No `<AppShell>` or shell-with-rooms component exists. Each module (`/playbook`, `/service-calendar`, `/sous`, `/people`, `/ops`, `/directory`, `/kpi`) is its own top-level route with its own layout. The Sous surface has ONE shell (`SousSurface`) with two variants (`page`, `overlay`) - closest existing precedent, but not four rooms. [verified - Section E17, F19]
- **Verdict:** **spec wins.** This is a build-forward item. Chose approach depends on the Mobile Chrome Contract decision (G-9).

### G-12. "Academy rail is the person's profile" - not built

- **Prompt (Section 1.8):** "identity, standing meter, credential badges, record link, and a reserved block for future rollups (Service assignments, KPI accountabilities, Directory)."
- **Repo:** No such surface exists. Sous rail is a session-turns list, client-only, wiped on New Question. No profile, no badges, no credentials surface. [verified - Section E17, F18]
- **Verdict:** **spec wins.** Build-forward. Data model requirements (badges = credentials, standing meter, rollups) feed into the schema decisions in Section G.

### G-13. "Badges are credentials, never points"

- **Prompt (Section 1.8):** every badge maps to a signature and a certificate serial.
- **Repo:** No badges, no signatures, no certificates, no credentials table exists (all names greenfield per Section G). [verified - Section G]
- **Verdict:** **spec wins.** Build-forward. Schema authoring is straightforward once obligations authoring lands.

### G-14. "Governing rule is scope, not title"

- **Prompt (Section 1.8):** "the standing card renders when someone other than you is in scope."
- **Repo:** No standing card exists; but the underlying rule is compatible with existing role gates. `is_site_leader` on `people` + `accounts.region` + `kpi_roles.role=rdo|corporate` all resolve via scope (account/region), not title. Free-text titles in `contacts.role` are used for other purposes. [verified - Section A5]
- **Verdict:** **spec wins on the surface; repo is aligned on the underlying rule.** No contradiction, just a build-forward.

### G-15. Hourly link lifecycle vocabulary

- **Prompt (Section 1.8):** "Not sent / Sent, not opened / In progress / Signed / Email bounced. Bounced renders as dashed red with a QR action."
- **Repo:** No infrastructure for any of these states exists. Magic-link primitive absent (Section D15). Bounce detection absent (Section D14). No QR generation anywhere. [verified - Section D14, D15]
- **Verdict:** **spec wins.** Build-forward. Feeds directly into critical-path items 6, 7, 8.

### G-16. "Sous is frozen at v2.0. No output attributes pipeline generation to Sous."

- **Prompt (Section 1.8):** the freeze.
- **Repo:** **Ambiguous.** The `.github/workflows/opd-autoprojection.yml` workflow re-embeds any changed `content/documents/*.mdx` file on push to main - a pre-existing OPD publish -> Sous re-embed pipeline. If "frozen" means "no NEW Academy-driven Sous generation", the freeze holds. If "frozen" means "Sous corpus is static", the workflow is a live counter-example that predates Academy. [verified - Section E17]
- **Verdict:** **owner rules.** Kevin must clarify which reading is intended before Academy work assumes either.

### G-17. Admin two rail groups

- **Prompt (Section 1.8):** "Admin is one room with two rail groups: Library (Attention, Worklist, Archive) and Academy (Cycle Builder, Question Queue, Version Publisher, People and Sync, Reports and Notices)."
- **Repo:** Playbook admin currently has a table-driven single-view (`src/app/playbook/admin/AdminClient.js` + `admin.css`). No two-rail-group structure. The prompt's structure would be a rewrite of the admin surface, not an extension. [verified - Section B7, F18]
- **Verdict:** **spec wins on target state.** Build-forward. Existing admin table pattern (720px min-width horizontal-scroll on mobile) may or may not survive the rewrite.

### G-18. Type floor 10px absolute

- **Prompt (Section 1.8):** "Type floor 10px absolute."
- **Repo:** Not surveyed exhaustively in this pass. Global type scale lives in `src/app/tokens.css` / `globals.css`; module CSS reduces sizes for mobile (e.g., People `pp-nav-item` `font-size: 12px` at <=420, `size-subhead` in periodWorkspace at <=375). Cannot claim 10px floor is currently enforced anywhere without a per-token audit. [code-read - Section F18]
- **Verdict:** **owner rules on enforcement mechanism.** A CSS lint or a `--kf-type-floor` token could enforce this. Recommend the token approach so violations show up in developer tools instantly.

---

## Contradictions between spec sections (internal to prompt)

### G-19. Precedence rule vs canonical shelves list

- **Prompt (Section 1.8):** "Precedence: repo > this document > renders."
- **Also prompt (Section 1.7):** the mobile brief's canonical shelf set is wrong.
- **Verdict:** **no gap.** These are consistent. The precedence rule tells us to trust the repo, and 1.7 already updates the shelves from the repo. Flagged only to confirm the precedence rule is not being violated by the shelf list in this doc.

### G-20. `worker_id` per stint vs person identity

- **Prompt (Section 1.2):** attestations hang off the stint (`worker_id`), person identity resolves above the stint.
- **Repo:** No attestations, no resolved-person entity exists. The KPI role gate handles the seasonal-rehire trap by filtering `status='ACTIVE'` and throwing on >1 active row per email (`src/lib/kpi/roleGate.js:157-198`), which is a per-stint pattern. Person-above-stint has no code today. [verified - Section A2]
- **Verdict:** **spec wins.** Build-forward. The resolved-person entity is a schema decision (natural key `personal_email`? or a new `academy_persons` UUID table?) with implications for Section G.

---

## Summary matrix

| Gap | Verdict | Blocks Academy? |
|-----|---------|-----------------|
| G-1 `user_accounts` dropped | repo wins | no (already handled in code) |
| G-2 `personal_email` policy | owner rules | YES (hourly identity) |
| G-3 Slack webhooks assumption | repo wins | no (Gmail already works) |
| G-4 obligations universally empty | spec wins | YES (critical path) |
| G-5 "archived" vs "Retired" wording | repo wins | no |
| G-6 `_latest` is a view | repo wins | no |
| G-7 `public.users` orphan | owner rules | no (namespace to sidestep) |
| G-8 exact salaried/hourly counts | no contradiction | no |
| G-9 Mobile Chrome Contract absent | owner rules | YES (arc-shape dependency) |
| G-10 mobile brief's shelves wrong | repo wins | no |
| G-11 "one shell, four rooms" | spec wins | YES (main build target) |
| G-12 Academy rail (profile+badges) | spec wins | YES (main build target) |
| G-13 badges as credentials | spec wins | YES (main build target) |
| G-14 scope-not-title rule | spec wins on surface | no (rule already compatible) |
| G-15 hourly link lifecycle | spec wins | YES (hourly portal) |
| G-16 Sous freeze reading | owner rules | YES (blocks Academy vs Sous coupling decision) |
| G-17 admin two rail groups | spec wins | YES (admin rewrite) |
| G-18 10px type floor | owner rules | no (enforcement mechanism, defer) |
| G-19 precedence vs shelves | no gap | n/a |
| G-20 stint-vs-person | spec wins | YES (schema decision) |

## Owner rulings needed (consolidated from above)

These map to the ruling list in prompt Section 5. Copied here for the master spec author's convenience:

- **G-2 Hourly identity source** - `personal_email` policy vs `work_email` requirement vs new `person_id` seam.
- **G-7 `public.users` orphan** - drop vs namespace-around.
- **G-9 Mobile Chrome Contract** - option (a) Academy ships primitives vs option (b) separate shared-chrome effort first. Recommendation from Section F19: (b).
- **G-16 Sous freeze reading** - "no new Academy-driven Sous generation" vs "Sous corpus is static". Only one of these two interpretations is compatible with the existing OPD publish -> re-embed workflow.
- **G-18 Type floor enforcement** - CSS lint vs `--kf-type-floor` token vs manual review. Recommendation: token.

Plus every ruling in prompt Section 5 (Kevin's list): calendar vs fiscal, document-open pattern, peer visibility, hourly roster visibility, admin permission split, SLT/CEO ownership, "% current" denominator, overdue consequence ladder, minimum viable obligations authoring subset, Academy v1 audience.
