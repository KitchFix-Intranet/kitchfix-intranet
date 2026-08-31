# OPD + Academy - Master Specification

**Status:** v1.0, approved to build
**Owner:** Kevin Fietek
**Repo home:** `docs/opd/ACADEMY_MASTER_SPEC.md`
**Last updated:** 2026-08-31

This is the living scope document. Section 16 (Status Ledger) is updated with every merged PR. Everything else changes only by explicit ruling, recorded in Section 17.

**Convention:** hyphens only, no em-dashes. Repo is canonical. Renders illustrate, they never override.
**Evidence:** every factual claim here is `[verified]` against production Postgres or a fresh clone between 2026-08-28 and 2026-08-31, or sourced from `docs/opd/alignment/*` (PR #901).

---

## 1. Purpose and non-goals

### What this is

The Playbook becomes two rooms on one spine. The **Library** is the truth: every operational document, versioned, searchable, readable. The **Academy** is the proof: who was required to read what, who signed it, against which version, and when.

The atomic unit is a **version-bound signature**. Not a completion, not a checkbox. A typed-name attestation, gated by comprehension checks, stored with the document version, timestamp, and attempt count, and issued a certificate serial. When a document changes materially, the prior signature expires and the re-sign flow covers the changed section.

### Non-goals for v1

- Not a personnel or performance system. It records what was read and signed, nothing else.
- Not a replacement for the Directory, People Portal, or Ops Hub.
- Not a Sous change. Sous stays frozen at v2.0 (Section 12.4).
- Not an authoring tool rebuild. The MDX + PR-gate publishing flow already works and is reused as-is.
- Not a KPI Dashboard dependency. The Academy resolves from `people` and `accounts` directly.

### Language rule

The word "compliance" does not appear in operator-facing UI. It appears in this spec, in Admin, and in Records exports. Operators see requirements, signatures, credentials, and standing.

---

## 2. Identity model

### 2.1 The core fact: `worker_id` is a stint, not a person

`[verified]` `public.people` holds 1,129 rows. There are 887 distinct `personal_email` values. **142 humans hold more than one `worker_id`.** One holds seven (Antonio Rodriguez, Cook, CIN-AZ, currently active). **39 of the 105 currently-active people are rehires (37%)**, concentrated in hourly: TBR-FL 9 of 12, TBJ-FL 7 of 11, CIN-AZ 5 of 10, while STL-FL is 0 of 10.

This is the seasonal clubhouse business written into the data, and it decides the schema.

**Ruling:** attestations hang off the **stint** (`worker_id`). A rehire produces a new stint with no prior attestations, so "rehires always redo onboarding" is structural rather than a rule somebody has to maintain and remember. A **person identity** sits above the stint, keyed on normalized `personal_email`, so a returning worker's history is legible without merging their compliance record across employment periods.

Stints for compliance. Person for history. These never merge.

### 2.2 Status vocabulary

`[verified]` Exactly three values in `people.status`:

| Status | Count | Meaning for the Academy |
|---|---|---|
| `ACTIVE` | 103 | In scope now |
| `TERMINATED` | 1,024 | Retained, never deleted. Attestations remain valid history. |
| `HIRED` | 2 | Future-dated hire. **This is the onboarding trigger.** |

`end_date IS NULL` yields 105 (103 ACTIVE + 2 HIRED). Terminations are retained by the nightly sync, which is what makes an audit trail possible.

### 2.3 Salaried versus hourly

`[verified]` `people.is_salaried` maps 1:1 to the raw Rippling `overtime_exemption` field (155 EXEMPT / 974 NON_EXEMPT, zero disagreement across all 1,129 rows). `worker_class_source` is `'derived'` for every row.

**Ruling:** pin the derivation explicitly to `overtime_exemption`. Do not infer from title, department, or pay rate.

`[verified]` `employment_type` exists in `rippling_raw_workers_latest.payload` but is **null for all 1,129 rows**. It is unusable and must not be built on.

### 2.4 Session resolution - salaried

`[verified]` Auth is NextAuth v5, Google-only (`src/lib/auth.js:1-89`). The sole user identifier is `session.user.email`. The session callback sets only `accessToken` and `error`; there is no `session.user.id` and no local user row.

The join is `people.work_email ILIKE session.user.email AND status = 'ACTIVE'`, following the established pattern at `src/lib/kpi/roleGate.js:157-198`. The `status = 'ACTIVE'` predicate is required: without it a rehire with multiple stints returns multiple rows.

`people.user_id` stores a **Rippling** identifier, not a Google identity. It must never be used for session resolution.

### 2.5 Session resolution - hourly

`[verified]` Hourly workers have `work_email IS NULL`, so the salaried join returns zero rows and they are correctly treated as having no intranet access. `[verified]` 100% of active hourly carry a `personal_email`, so the entire population is reachable.

`[verified]` `people.personal_email` carries the column comment (`docs/migrations/people-1-table.sql:118-121`):

> PII. Stored for a future opt-in workflow; NEVER selected by any application route. work_email is the safe address for internal surfaces.

**Ruling (Kevin, 2026-08-31):** the Academy hourly portal is the opt-in workflow that comment anticipated. `personal_email` may be used to **send**, never to **show**, under a hard rule:

1. The address is read **only** inside a single server-only send function, at the moment of sending.
2. It is **never copied** into another table. One copy of the truth stays in `people`, so a Rippling update cannot leave a stale address behind sending links to a dead mailbox.
3. It is never returned in an API response, never rendered on a screen, never included in an export. Site leaders see `Sent`, `Opened`, `Signed`, or `Bounced`. Never the address.
4. If a per-worker override is ever needed, it is an explicit nullable override column, never a defaulted copy.

**Rejected alternative:** an `academy_learners.link_email` column defaulting to `personal_email`. It launders the privacy fence into a second table and introduces a staleness failure that is indistinguishable from a worker ignoring the email.

Identity is established by a **magic link** (Section 10).

### 2.6 Eligibility

`[verified]` No authoritative contractor flag exists in the data. `employment_type` is null everywhere and the only signal distinguishing Theresa Camp is the literal string "Contractor" in her title. Title strings vary ("Contractor", "Consultant"), so a heuristic fails silently into the compliance denominator.

**Ruling:** eligibility is an **explicit exception table**, defaulting to include, with a required reason string.

Current state (Kevin's rulings):

| Person | Decision | Reason |
|---|---|---|
| Theresa Camp | **Excluded** | Contractor, event work only. Status HIRED, CIN-KY, no work email. |
| Alex Wasserman | **Included** | Corporate access. |
| Joshua Katt | **Included** | CEO takes training like everyone else. Null `manager_worker_id` is correct as tree root and must not be "fixed". |

Eligible population at v1: **30 active salaried**, ~**73 active hourly**.

---

## 3. Scope and roles

### 3.1 Scope resolves from account and region, never the manager chain

`[verified]` `public.accounts.region` is canonical and already drives the KPI Dashboard. The Rippling manager graph disagrees with it: **six of eleven site leaders bypass their RDO** and report directly to Joe Lessard (Atherton CIN-OH, Bailey CIN-KY, Poletti STL-MO, Gilman TBJ-NY, Forkner TXR-TX-H, Rogers TXR-TX-V). At least one sous chef (Adam Lacy, TXR-AZ) reports to the RDO directly, skipping his site leader.

**Ruling:** regional and site rollups resolve from `accounts.region` and `people.account_key`. `manager_worker_id` is used **only** for direct-report nudges.

Rationale: region-to-account is durable and changes when a site opens or closes. Manager edges drift constantly. A chain-derived regional number would show Shane 3 of his 5 East sites and look completely normal. Kevin is cleaning the Rippling org chart, and the ruling stands regardless, so the cleanup improves nudges without ever becoming load-bearing.

### 3.2 The Academy role resolver

`[verified]` There is no coherent role model in the intranet today. What exists: four hardcoded allowlists in `src/lib/admin.js`, one KPI-scoped gate in `roleGate.js`, free-text `contacts.role` titles, and viewer tiers in `opdAcl.js`. None of them answer "does this person owe this obligation."

**Ruling:** the Academy builds `resolveAcademyIdentity(email)` composed **only** from `people` and `accounts`, both of which are clean and verified. It does not read `contacts.role` free text and does not read the allowlists.

```
resolveAcademyIdentity(email) -> {
  worker_id,            // the stint
  person_id,            // stable across stints
  eligible,             // exception table
  is_salaried,          // pinned to overtime_exemption
  account_key,
  region,               // accounts.region
  is_site_leader,       // people, owner-maintained, one per account
  is_corp,
  scope: { kind: 'company' | 'region' | 'site' | 'self', region?, accounts[] },
  grants: ['library_admin' | 'academy_admin']
}
```

This resolver is the role model the intranet lacks. Build it to be reused, not as an Academy-internal helper.

### 3.3 The scope-not-title rule

**Ruling:** the standing card renders **when at least one eligible person other than the viewer is in scope.** It is not driven by job title.

`[verified]` This matters because **five of eleven site leaders are the only eligible salaried person at their site**: Atherton (CIN-OH), Bailey (CIN-KY), Gilman (TBJ-NY), Forkner (TXR-TX-H), Rogers (TXR-TX-V). A title-based rule would render them a team card containing exactly one person, themselves, directly below their own profile rail.

`[verified]` Two of those sites also have zero hourly staff (CIN-KY, TBJ-NY), so Bailey and Gilman genuinely manage nobody.

### 3.4 What each role sees

Only three things vary across roles: the rail scope list, the standing card, and Admin tab visibility. Everything else is identical.

| Role | Standing card | Records scope | Admin |
|---|---|---|---|
| Corporate | Company, 11 sites grouped, exceptions surfaced | My record / My sites / East / West / All sites | By grant |
| RDO | Their region, sites grouped | My record / My region / My sites | No |
| Site leader (with staff) | Their site, rendered as people | My record / My site | No |
| Site leader (solo) | None | My record | No |
| Salaried, no reports | None. Site aggregate in rail, no names. | My record | No |
| Hourly | Never sees this UI. Portal only. | n/a | No |

**Ruling (peer visibility):** a salaried manager with no reports sees a site **aggregate without names**. Which specific colleague is overdue is management information.

**Ruling (hourly roster visibility):** follows the **site** (`account_key`), not the reporting line. A sous chef who supervises line cooks on the floor but not in Rippling still needs the roster to resend a link or show a QR.

---

## 4. Content model

### 4.1 What exists

`[verified]` `/content` holds 129 MDX documents plus `facts/`, `schema/`, `components/`. The live catalog shows 113 active. The delta is 16 documents with `status: Retired` (a distinct concept from `archived=true`, which only 4 rows carry).

`[verified]` Canonical shelves, from live content:

| Shelf | Docs |
|---|---|
| People & Conduct | 41 |
| Service Delivery & Client Accounts | 34 |
| Safety, Health & Incident | 24 |
| Operations & Leadership | 20 |
| Brand & Documentation Standards | 4 |
| Culinary & Kitchen Operations | 3 |

There is no Finance shelf and no Site & Client shelf. Any document asserting otherwise is stale.

### 4.2 The obligations gap - the critical path

`[verified]` `content/schema/frontmatter.schema.json:176` **defines** an `obligations` key, with types including `cert_renewal` and `training`, supporting per-obligation scope by state, account, and role, described as feeding the derived compliance calendar and cert matrix.

**Zero of 129 documents author it.** Every apparent match in the tree is prose ("manager obligations", "legal obligation").

This is the longest-lead item in the entire project. An assignment layer reading a field that no document populates cannot ship regardless of code quality.

### 4.3 Pilot authoring set

**Ruling (Kevin, 2026-08-31):** six foundational documents, all `[verified]` Live in `/content`:

| Document | ID | Version | Shelf | Audience reach |
|---|---|---|---|---|
| Culture OS Handbook | `PB-014` | v1.0 | Operations & Leadership | Company-wide |
| Leadership OS Handbook | `PB-001` | v9.1 | Operations & Leadership | Salaried |
| Site Operations Manual | `PB-010` | v1.0 | Operations & Leadership | Salaried |
| Hourly Employee Handbook | `PB-004` | v1.2 | People & Conduct | **Hourly** |
| Culinary OS Handbook | `PB-006` | v1.0 | Culinary & Kitchen Operations | Salaried culinary |
| The Big Rules | `AGR-001` | v1.1 | People & Conduct | **Company-wide, both** |

This set covers both audiences, so the pilot exercises the intranet path and the hourly portal path against real content rather than proving only half the system.

Two findings from the lookup:

- `[verified]` **`PB-004-ES` (Spanish Hourly Employee Handbook) is Retired.** Hourly is the population most likely to need Spanish. Open ruling (17.4).
- `[verified]` **`audience: operator` is set on all six**, including the Hourly handbook. The existing `audience` field cannot route hourly versus salaried. Obligation scope must carry it.
- `[verified]` `POSTER-001` "The Big Rules Posting" exists and is a plausible host for a printed site QR code.

### 4.4 The projection pipeline

`[verified]` `/content` reaches Postgres via GitHub Actions, not a Next build step. `.github/workflows/opd-autoprojection.yml` fires on push to `main` touching `content/documents/**`, running `scripts/content/project-catalog.mjs --apply`, which performs five ordered writes: UPSERT `documents`, `archive_document` RPC for docs absent from MDX, `replace_document_relationships` RPC, `replace_document_surfaces` RPC, and UPSERT `document_content` keyed on `(doc_id, lang)` with pre-rendered HTML. It then calls `scripts/sousai-embed-doc.mjs` per changed document. `document_pins` is deliberately never touched.

**The Academy extends this with a sixth write:** UPSERT `academy_obligations` from the frontmatter `obligations` block.

`[verified]` The reader renders pre-rendered HTML from `document_content` via `dangerouslySetInnerHTML`. No Drive fetch, no MDX resolution at read time.

`[verified]` The authoring publish path (`src/app/api/playbook/route.js:867-1267`) opens a GitHub PR with auto-merge behind a required Playwright check, then triggers projection. This is reused unchanged.

### 4.5 The content-versus-Postgres seam

`[verified]` The precedent already ships. In OPD Command's Worklist, `Title`, `Shelf`, `Class`, and `Version` are MDX-authored and read-only, while `Status`, `Access`, and `Pin` are editable in Postgres.

**Ruling, generalized:**

- **Rules live in `/content`.** What a document requires, of whom, how often. Authored, versioned, PR-reviewed, owned by the document.
- **People live in Postgres.** Roster, role, account, stint, status. Live, nightly.
- **Resolution is computed once at request time.** Never stored in two places.
- **Records live in Postgres**, append-only, because they are transactional and audit-grade.

---

## 5. Assignment resolution

### 5.1 Why it cannot reuse the facts resolver

`[verified]` `scripts/content/resolver.mjs` runs at **projection time** with **document-scoped** context. The Academy needs the same primitives at **request time** with **viewer-scoped** context (account, region, role, stint).

**Ruling:** net-new resolver. It may share the scoring pattern, not the execution point.

### 5.2 When requirements are written

Requirements are **materialized**, not computed on every read, because due dates and audit trails need stability. Rows are written at exactly four triggers:

| Trigger | Source value | Behavior |
|---|---|---|
| Cycle published | `cycle` | One requirement per eligible person in the audience |
| Person appears with status `HIRED` | `onboarding` | Onboarding program issued |
| New stint detected for an existing person | `rehire` | Onboarding reissued in full. Prior stint's record untouched. |
| Material version published | `version_recert` | Re-cert issued to everyone holding a signature on the prior version |

Plus `manual` for one-off admin issuance. Every requirement stores its source, which is the defensible answer to "why did this person owe this."

### 5.3 Waivers

A requirement may be waived, never deleted. Waiver stores who, when, and a required reason. Waived requirements remain visible in Records.

---

## 6. Cycles

**Ruling (Kevin, 2026-08-31): calendar months.** One cycle per calendar month, opening on the 1st and due on the last day. The fiscal period is displayed as secondary context.

Rationale: the Academy is the one surface in the intranet that is not about money. "September" is what an operator thinks in. "P9 closes Saturday" is finance language on a training screen. The fiscal period is still shown so the Academy never contradicts SC or KPI.

Cycles are built in Admin (Section 12) with a per-role load preview, and are published explicitly. A published cycle writes requirements. A draft cycle writes nothing.

Mid-month hires receive onboarding only and join the cycle rhythm on the following 1st.

---

## 7. Signatures and attestation integrity

### 7.0 What a module is

**A module is one obligation, not one document version.** A document may carry several, scoped by `source_section`. Measured reading times put four of the six pilot documents over the 15-minute ceiling, with `PB-001` at roughly 61 minutes, and it contains five role definitions that no single reader needs in full.

### 7.1 The attestation

```
I, [full name], have read and understood [Document Title], version [x.y],
[including the revised [Section] if a re-cert],
and I will hold this standard at my sites.
```

The typed name must match the authenticated identity. Signature is gated on all comprehension checks passing.

### 7.2 Integrity rules - non-negotiable

This is the compliance extension of "you don't mess with people's money." You don't mess with people's compliance records either.

1. **Append-only at the database level.** `[verified]` The model already ships: the `kpi-8a` migration grants `SELECT, INSERT` only, with a post-flight `RAISE EXCEPTION` assertion, used by `rippling_raw_time_entries`, `_pay_segments`, and `_users`. `academy_attestations` follows this exactly.
2. **Corrections are superseding rows**, never updates. A correction inserts a new row referencing the one it supersedes.
3. **Never shown as recorded until persisted.** No optimistic UI. A signature in flight renders as pending, never as signed.
4. **Failure leaves last-good state.**
5. **Idempotency via client-generated UUID**, so a retry cannot double-sign.

### 7.3 The offline queue does not transfer

`[verified]` The Service Calendar F3 save queue is **disqualified** for attestations. Its last-write-wins replay semantics, single-writer localStorage assumption, and one-entry-per-`accountKey|date` key shape would each violate per-attestation immutability.

What does transfer is the **UI discipline**: badge rather than fill-swap, no premature success screen, offline state on ambient chrome. The write path itself is net-new: per-attestation UUIDs, server-side hold-then-commit.

---

## 8. Checks and comprehension

- **100% to pass.** Unlimited attempts.
- **Attempts are recorded honestly.** The Records "Attempts" column is real data.
- **The record stores passed, attempts, and time. Never a percentage score.** This is a certification system, not a grading system.
- **Wrong answers teach.** Amber, never red. An explanation of why, and a deep link back to the source section.
- **Correct answers are never discoverable client-side before submission.** `correct_option_id` is server-side only.
- **Answer order shuffles per attempt.**
- Questions are `[section]`-anchored to source documents and drafted by pipeline, then **approved by Kevin** before they can be assigned.

---

## 9. Certificates and credentials

`[verified]` `pdf-lib` is production-live via `buildIncidentPdf` (`src/lib/incidentActions.js:907`). A certificate is roughly a 100-line reuse, single page, fixed fields. No Chromium required.

- Serial format `KFA-YYYY-NNNNNN`, unique, stored on the attestation.
- Signatory line included.
- Delivered as a badge on the profile rail, a PDF on demand, and an email on signature.

**Badges are credentials, never points.** Every badge maps to a signature and a serial. A badge whose underlying signature has expired renders amber, tied to the same fact as the overdue requirement. The only non-document badge permitted is a behavioral fact that is literally true (for example, cycles completed on time). Invented points are prohibited: they would undercut the seriousness of a signature.

---

## 10. The hourly portal

### 10.1 Population

`[verified]` ~73 active hourly across **9 sites**. CIN-KY and TBJ-NY have zero. Per site: TBR-FL 12, TBJ-FL 11, CIN-AZ 10, STL-FL 10, TXR-AZ 8, STL-MO 7, CIN-OH 5, TXR-TX-H 5, TXR-TX-V 5. One future hire (`HIRED`) at TBJ-FL. Site sizes of 5 to 12 mean rosters render as real lists.

### 10.2 Access

`[verified]` No magic-link primitive exists anywhere in the repo. No EmailProvider, no signed-URL helper, no `jose`, no `nanoid`. This is net-new and auth-adjacent, so it is estimated at 2-3x surface reading.

- A long random token is generated server-side. Only its **hash** is stored, next to `worker_id`.
- The link is single-use, expiring, and revocable.
- Redemption issues a **scoped session** that can read only that worker's own requirements. No navigation, no intranet, no other person's data.
- **QR is a first-class delivery path**, not a fallback. A site leader displays it from the roster and the worker scans it. This is the recovery path for a bad address and the reason bounce handling is not optional.

### 10.3 Link lifecycle - the status vocabulary

The salaried states do not describe this population. Hourly requirements sit in a delivery lifecycle:

| State | Meaning | Action offered |
|---|---|---|
| Not sent | Person synced, link not yet issued | Send |
| Sent, not opened | Delivered, no click | Resend, QR |
| In progress | Opened, incomplete | Resend, QR |
| Signed | Complete | View certificate |
| **Email bounced** | Delivery failed | **QR** |

**Bounced renders as dashed red with an alarm bar,** never folded into "pending." An unreachable worker who looks merely slow is a silent compliance failure, which is the exact defect class this shop guards against.

`[verified]` **Bounce detection does not exist.** Options are Gmail `history.list` polling of the sender mailbox for DSN patterns, or a dedicated ESP webhook. Open ruling (17.2).

### 10.4 Returning workers

Returning staff are greeted by name and season ("Welcome back, Antonio") and carry a stint chip in the roster. They still sign everything again, because a rehire is a new stint. **Knowing someone and re-certifying them are not in conflict**, and the signature lands against the current stint so this season's record never merges with 2024's.

---

## 11. Notifications

`[verified]` Gmail API sending is **production-live**. `sendEmailSA({ sender, displayName, to, subject, html, replyTo })` at `src/lib/gmail.js:411-449` uses service-account domain-wide delegation with the `gmail.send` scope, with proven production senders (`support@`, `m.chavez@`). Slack webhooks are not the only outbound channel.

`academy@` requires one **operational** prerequisite: the mailbox must be on the service account's domain-wide-delegation allowlist in Google Workspace admin. That is Kevin configuration, not code. Once authorized, sending is an env var addition.

Cadence: cycle opens on the 1st, nudge on the 15th, reminder at T-5, overdue the day after and weekly thereafter, a Monday digest to leads routed **by region**, and a certificate on signature.

Every notification deep-links to the specific requirement.

---

## 12. Admin

### 12.1 One room, two groups

Admin is a single room with two rail groups, preserving everything OPD Command does today.

**Library:** Attention, Worklist, Archive.
**Academy:** Cycle Builder, Question Queue, Version Publisher, People and Sync, Reports and Notices.

`[verified]` The Worklist preserves the shipped read-only split: `Title`, `Shelf`, `Class`, `Version` are MDX-authored; `Status`, `Access`, `Pin` are editable. Column headers carry an editability marker and the footer states the rule.

Archive keeps signature history. A signature on an archived version stays valid in the record and is never removed.

### 12.2 Permissions

**Ruling:** `library_admin` and `academy_admin` are **separate grants**. Britt can hold Library without Academy. Mariela can hold People and Sync plus Reports without Version Publisher. Admin is not a role tier.

### 12.3 Version publisher

The one question is minor or material. Material expires every prior signature, requires a plain-language change note, and re-opens the document with the changed section emphasized. Minor leaves the record untouched. The UI states the blast radius before the decision ("re-opens 30").

### 12.4 The Sous fence

Sous is frozen at v2.0. The Academy adds **no Sous capability, no gate, no prompt line**.

**Clarified ruling:** the freeze covers (a) adding capability and (b) attributing pipeline output to Sous in the UI. It does **not** cover the pre-existing `opd-autoprojection` to `sousai-embed-doc` re-embedding flow, which predates the Academy and continues unchanged.

Pipeline-generated suggestions and draft questions are labeled neutrally ("Suggested", "Draft questions"). No UI ever says "Sous suggests" for pipeline output, because that erodes the "I cannot see that" trust boundary Sous depends on.

---

## 13. Data model

All tables are `academy_*` prefixed. `[verified]` the namespace is entirely greenfield in `public`.

`[verified]` Migration convention: SQL authored in `docs/migrations/*.sql`, reviewed by the architect, applied manually in Studio, enforced by `.github/workflows/migration-gate.yml`.

| Table | Purpose | Notes |
|---|---|---|
| `academy_persons` | Stable identity above the stint | Keyed on normalized `personal_email`. `person_id` never changes. |
| `academy_person_stints` | Maps `person_id` to `worker_id` | Maintained by the nightly sync |
| `academy_eligibility_exceptions` | Explicit include/exclude | Defaults to include. Reason required. Seeds with Theresa Camp. |
| `academy_grants` | `library_admin`, `academy_admin` | By email |
| `academy_obligations` | Projected from MDX frontmatter | The sixth projection write. Unique on `(doc_id, obligation_key)`. |
| `academy_cycles` | Calendar-month cycles | `draft` / `published` / `closed`. Carries fiscal period as context. |
| `academy_cycle_modules` | Documents in a cycle | With estimated minutes |
| `academy_requirements` | Resolved who-owes-what | Stores `source`: cycle, onboarding, rehire, version_recert, manual. Waiver fields. |
| `academy_questions` | Comprehension checks | `correct_option_id` never leaves the server. Approval required. |
| `academy_check_attempts` | Every attempt | **Append-only** |
| `academy_module_progress` | Sections seen, time | Mutable working state |
| `academy_attestations` | **The signature** | **Append-only, DB-enforced.** FK to `worker_id` (stint). Carries `person_id`, doc version, typed name, attempts, time, certificate serial, `superseded_by`, source (intranet or portal). |
| `academy_portal_tokens` | Magic links | Hash only, never raw. Expiry, consumption, revocation. |
| `academy_email_events` | Sends, opens, bounces | Feeds the link lifecycle |
| `academy_admin_audit` | Admin actions | Publish decisions, waivers, exception changes |

Notes carried forward: `[verified]` `user_accounts` (base table) was **dropped 2026-08-28**; only `user_accounts_derived` (which excludes hourly by construction) and `user_accounts_manual` survive. `[verified]` `public.users` is an empty orphan; the `academy_*` prefix sidesteps it without a low-value migration.

---

## 14. Mobile

Manager usage is roughly **50/50 desktop and mobile**, and the intranet has been built desktop-first. Every Academy PR ships its sub-768px behavior in the same PR. Type floor is **10px absolute**, tab labels 10.5 minimum.

`[verified: no]` The per-module breakpoint inventory in `docs/opd/alignment/SECTION_F_MOBILE.md` is **entirely inference**. No browser was opened. It must not be treated as evidence that a chef's phone renders correctly.

**Blocking measurement:** a Playwright pass at 390px and 430px with `TEST_MODE=true`, or a manual device check, across the seven modules.

**Chrome sequencing is an open ruling (17.1), and the measurement gates it.** CC recommends a shared-chrome arc before Academy PR 1. The architect disagrees on CC's own evidence: if the six existing modules already reflow correctly, shared chrome buys consistency rather than repair, and consistency can follow. Standard discipline is to build twice before abstracting. Architect's lean is that the Academy ships mobile-native with its own chrome, designed to be extractable, and the shared arc follows once a real second implementation exists to extract from.

---

## 15. PR ladder

**v1 audience ruling (Kevin, 2026-08-31): Kevin-only pilot**, using the established `KPI_PREVIEW_ONLY` fence pattern (`roleGate.js:69-70`). Widen to one site, then all 30 salaried, then hourly. Each step gated by the previous.

| PR | Scope | Size | Depends on |
|---|---|---|---|
| 1 | `academy_*` schema + append-only assertions + grants | M | - |
| 2 | Obligations authoring, 6 pilot docs (content only) | M | - (parallel) |
| 3 | Projection extension: write `academy_obligations` | S | 1, 2 |
| 4 | `resolveAcademyIdentity` + scope resolver | M | 1 |
| 5 | Shell, four rooms, rail grammar, Library reskin | L | 4 |
| 6 | Requirements engine + cycles + Cycle Builder | L | 3, 4 |
| 7 | Checks, questions, attestation write path | L | 6 |
| 8 | Certificates (pdf-lib reuse) | S | 7 |
| 9 | Records room | M | 7 |
| 10 | Notifications + `academy@` alias | M | 6 |
| 11 | Magic-link primitive + hourly portal | **XL** | 1, 10 |
| 12 | Bounce detection | M | 11, ruling 17.2 |
| 13 | Admin: Library worklist + permission split | M | 5 |

**PR 2 blocks the most and is content work, not engineering.** It can start immediately and run in parallel with everything.

**PR 11 is auth-adjacent and estimated at 2-3x** surface reading, per standing rule.

Standing build rules apply throughout: confirm branch before every commit, open the PR in the same turn as the push with the number in the report, re-merge before push, stop and report after each PR, migrations reviewed by the architect before Studio apply, no merge without CI green plus a live browser gate measurement. Build Accuracy Protocol governs verification; `[code-read]` claims are unverified until gated.

---

## 16. Status ledger

Updated with every merged PR. This is the living section.

### 16.1 Migration split

PR 1 ships as four migrations rather than three, split as follows so no downstream migration is invalidated by the pending frontmatter schema extension (open ruling 17.6):

| Migration | Contents | Gated on |
|---|---|---|
| 1 (this PR) | Identity foundation: persons, stints, eligibility exceptions, grants | Nothing |
| 2 | Assignment layer: obligations, cycles, cycle modules, requirements | Frontmatter schema extension approved and merged |
| 3 | Signature layer: questions, check attempts, module progress, attestations (append-only, DB-enforced per `kpi-8a`) | Migration 2 |
| 4 | Delivery: portal tokens, email events, admin audit | Migration 3 |

### 16.2 PR ledger

| PR | Title | Status | Merged | Notes |
|---|---|---|---|---|
| #901 | OPD + Academy technical findings (docs) | Delivered, awaiting merge | - | 10 documents, `docs/opd/alignment/` |
| 1 | `academy_*` schema | Not started | - | |
| 2 | Obligations authoring, 6 pilot docs | Not started | - | **Critical path** |
| 3 | Projection extension | Not started | - | |
| 4 | Identity + scope resolver | Not started | - | |
| 5 | Shell + four rooms + Library reskin | Not started | - | |
| 6 | Requirements + cycles | Not started | - | |
| 7 | Checks + attestations | Not started | - | |
| 8 | Certificates | Not started | - | |
| 9 | Records | Not started | - | |
| 10 | Notifications | Not started | - | |
| 11 | Magic link + hourly portal | Not started | - | Auth-adjacent, 2-3x |
| 12 | Bounce detection | Not started | - | Blocked on ruling 17.2 |
| 13 | Admin permission split | Not started | - | |

**Operational prerequisites (Kevin, not code):**

| Item | Status |
|---|---|
| `academy@` on Workspace domain-wide-delegation allowlist | Open |
| Obligations authored on the 6 pilot documents | Open, critical path |
| Rippling org chart cleanup | Open, non-blocking |

---

## 17. Open rulings

| # | Ruling | Recommendation | Blocks |
|---|---|---|---|
| 17.1 | Mobile chrome sequencing: Academy-native then extract, or shared arc first | Architect: Academy-native, extract later. Gate on the mobile measurement first. | PR 5 shape |
| 17.2 | Bounce detection: Gmail `history.list` polling or ESP webhook | Polling first, it needs no new vendor | PR 12 |
| 17.3 | Overdue consequence ladder and any lockout policy | At minimum a "not current" chip plus a lead nudge on day 8. A status without a consequence becomes wallpaper. | PR 10 |
| 17.4 | Spanish parity: `PB-004-ES` is Retired and hourly needs it most | Restore for the hourly pilot | PR 2 |
| 17.5 | SLT and CEO compliance ownership, given scope-by-reports leaves the root unmonitored | People Ops owns CORP standing | PR 9 |
| 17.6 | Frontmatter obligations schema extension. Add `obligations[].key` (required), `cadence: on-hire`, and `applies_to.worker_class`. Additive and safe today because zero documents author the block; expensive after authoring begins. | Approve additive extension. | Blocks migration 2 and PR 2. |

**Closed rulings** (recorded for history): stints versus persons (2.1), scope by region (3.1), eligibility exceptions (2.6), hourly identity and the `personal_email` policy (2.5), calendar months (6), pilot document set (4.3), v1 audience (15), peer visibility (3.4), hourly roster visibility (3.4), Admin permission split (12.2), "% current" denominator as signed-of-assigned-this-cycle, document-open pattern (Focus for requirements, modal for Library peeks, inline for single-check refreshers), Sous freeze scope (12.4), shelf taxonomy (4.1).
