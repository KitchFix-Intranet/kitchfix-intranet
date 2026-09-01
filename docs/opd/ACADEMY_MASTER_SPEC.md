# OPD + Academy - Master Specification

**Status:** v1.2, approved to build
**Owner:** Kevin Fietek
**Repo home:** `docs/opd/ACADEMY_MASTER_SPEC.md`
**Last updated:** 2026-09-01

This is the living scope document. Section 16 (Status Ledger) is updated with every merged PR. Everything else changes only by explicit ruling, recorded in Section 17.

**Convention:** hyphens only, no em-dashes. Repo is canonical. Renders illustrate, they never override.
**Evidence:** every factual claim here is `[verified]` against production Postgres or a fresh clone between 2026-08-28 and 2026-08-31, or sourced from `docs/opd/alignment/*` (PR #901).

---

## 1. Purpose and non-goals

### What this is

The Playbook becomes two rooms on one spine. The **Library** is the truth: every operational document, versioned, searchable, readable. The **Academy** is the proof: who was required to read what, who signed it, against which version, and when.

The atomic unit is a **version-bound signature**. Not a completion, not a checkbox. A typed-name attestation, gated by comprehension checks, stored with the document version, timestamp, and attempt count, and issued a certificate serial. When a document changes materially, the prior signature expires and the re-sign flow covers the changed section.

### Scope ruling, 2026-09-01

**The Academy is the compliance home for KitchFix.** It replaces Rippling for company document distribution and signature capture. Documents that today collect signatures in Rippling migrate here as they are onboarded to the Academy, and the Academy's attestation record becomes the authoritative one.

Two consequences:

- **The witness countersignature is retired.** `AGR-001 The Big Rules` currently collects Employee Name / Signature / Date plus KitchFix Witness Name / Signature / Date in Rippling. The Academy models one signer per attestation. The witness requirement does not carry over. Where a document's body references a witness line, that text needs a content edit before the document is onboarded.
- **Migration is per document, not wholesale.** A document has one signing home at a time. When it gets obligations and questions here, its Rippling signing stops. Until then, Rippling remains authoritative for it. Never both.

### Non-goals for v1

- Not a personnel or performance system. It records what was read and signed, nothing else.
- Not a replacement for the Directory, People Portal, or Ops Hub.
- Not a Sous change. Sous stays frozen at v2.0.
- Not an authoring tool rebuild. The MDX + PR-gate publishing flow works and is reused as-is.
- Not a Rippling replacement for anything other than document distribution and signature. Payroll, roster, and HR records stay there and remain the upstream source for the people spine.

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

**Queue-versus-Records split, ruled 2026-09-01.** A waived requirement is **not work**: it does not appear in the Academy queue, it is not counted in "N to go", and its minutes are not summed. The waiver filter runs server-side at `/api/academy/room` (`.is("waived_at", null)`) so the waive reason - which may carry an operational explanation - never reaches a surface that will not render it. Records is where the audit trail lives, and Records is the only surface that renders waived requirements, with the reason + waiver + waived_at inline. When the Records room ships, its queries drop the waiver filter and add columns for those fields.

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

> **Superseded 2026-09-01 (Section 17 closed rulings):** Josh and Joe now hold both grants; no separate standing-viewer type is needed. The two grants remain formally separate for authoring flexibility, but the current admin roster carries both on every holder.

### 12.3 Version publisher

The one question is minor or material. Material expires every prior signature, requires a plain-language change note, and re-opens the document with the changed section emphasized. Minor leaves the record untouched. The UI states the blast radius before the decision ("re-opens 30").

**Pre-signature corrections do not bump the version.** Ruled 2026-09-01. Once anything is signed against a version, corrections bump. Until then, edits are the same version - bumping would create a version nobody ever saw and would leave any already-issued requirement rows pointing at a stale version string. The trigger is the existence of an `academy_attestations` row for the current version, not the passage of time.

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

## 15. Build state and PR ladder

**v1 audience: Kevin-only pilot**, fenced by `ACADEMY_PREVIEW_ONLY` in `src/lib/academy/resolveIdentity.js`. Widen to one site, then all salaried, then hourly. Each step gated by the previous.

### Shipped

| PR | What landed |
|---|---|
| #901 | Technical findings, 10 alignment documents |
| #903 | This spec, v1.0 |
| #904 | `academy-1` identity foundation: persons, stints, eligibility exceptions, grants |
| #905 | `academy-2` region leads; `resolveAcademyIdentity`; `/api/academy/whoami` |
| #908 | Frontmatter schema extension (`key`, `on-hire`, `worker_class`, `est_minutes`); obligations authored on 3 documents |
| #909 | `academy-3` assignment layer: obligations, cycles, cycle modules, requirements |
| #911 | `academy-4` projection RPCs; projection writes obligations |
| #913 | `/opd` shell + Library room |
| #914 | `academy-5` publish RPCs; requirements issuance engine |
| #915 | `academy-6` cycle audience scope |
| #917 | CLI import fix + alias audit |
| #918 | `academy-7` ambiguity fix + mandatory execution probes |
| #920 | Pagination discipline + `person_id` backfill RPC |
| #922 | Academy room |
| #924 | Design alignment pass |
| #925 | `academy-9` signature layer: questions, check attempts, module progress, attestations |

### Live state

- **14 `academy_*` tables**, six RPCs, all TRUNCATE-fenced.
- **887 persons / 1,129 stints**; identity spine populated and verified.
- **8 obligations** projected from `AGR-001`, `PB-014`, `PB-006`.
- **Cycle 2 (September 2026) published**, scoped to Kevin, 8 requirements, 96 minutes, due 2026-09-30, all carrying `person_id`.
- **`academy_attestations` and `academy_check_attempts` are append-only**, DB-enforced: `service_role` holds no UPDATE, DELETE, or TRUNCATE. Verified by probe.
- `academy_grants` holds three admins: `k.fietek@`, `josh@`, `joe@`, each with `library_admin` and `academy_admin`.

### Remaining

| Item | State |
|---|---|
| Comprehension questions | **Not started. Nothing can be signed until a module has approved questions.** |
| Read-check-sign flow | Not started. Requires the experience design (Section 18). |
| Certificates | Not started. `pdf-lib` path confirmed reusable. |
| Records room | Not started. |
| Admin room | Not started. Library administration exists at OPD Command and must fold in. |
| Notifications | Not started. Gmail send confirmed production-live; `academy@` alias created. |
| Hourly portal | Not started. No magic-link primitive exists. Auth-adjacent, estimate 2-3x. |
| Derive extension | **Parked and now load-bearing.** Nothing keeps `academy_person_stints` current as new hires sync; the next new hire issues with a NULL `person_id`. |

---

## 16. Status ledger

Updated with every merged PR. This is the living section.

### 16.1 Migration split

Five migrations. The identity foundation split off first, then the RDO region-leads table landed alongside the resolver, and the assignment layer is next. Split so no downstream migration is invalidated by upstream schema work:

| Migration | File | Contents | Gated on |
|---|---|---|---|
| 1 | `academy-1-identity-schema.sql` | Identity foundation: persons, stints, eligibility exceptions, grants | Nothing |
| 2 | `academy-2-region-leads.sql` | Region -> RDO email mapping (owner-maintained) | Migration 1 |
| 3 | `academy-3-assignment-layer.sql` | Assignment layer: obligations, cycles, cycle modules, requirements | Migrations 1-2 + frontmatter schema extension (closed as 17.6 in PR #908) |
| 4 | `academy-9-signature-layer.sql` | Signature layer: questions, check attempts, module progress, attestations (append-only, DB-enforced per `kpi-8a`) | Migration 3 |
| 5 | pending | Delivery: portal tokens, email events, admin audit | Migration 4 |

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

## 17. Rulings

### Open

| # | Ruling | Recommendation | Blocks |
|---|---|---|---|
| 17.1 | Mobile chrome sequencing: Academy-native then extract, or shared arc first | Academy-native. Gate on the mobile measurement first. | Chrome work |
| 17.2 | Bounce detection: Gmail `history.list` polling or ESP webhook | Polling first, no new vendor | Hourly portal |
| 17.3 | Overdue consequence ladder and any lockout policy | Minimum: a "not current" chip plus a lead nudge on day 8 | Notifications |
| 17.4 | Spanish parity: `PB-004-ES` is Retired and hourly needs it most | Restore before the hourly pilot | Hourly portal |
| 17.10 | **The full learner experience, landing through recognition.** See Section 18. | Design before build. | Everything downstream |

### Closed

Stints versus persons (2.1). Scope by region (3.1). Eligibility exceptions (2.6). Hourly identity and the `personal_email` policy (2.5). Calendar months (6). Pilot document set (4.3). v1 audience (15). Peer visibility (3.4). Hourly roster visibility (3.4). Admin permission split (12.2) - **superseded 2026-09-01: Josh and Joe hold both grants; no separate standing-viewer type is needed.** "% current" denominator as signed-of-assigned-this-cycle. Document-open pattern (Focus for requirements, modal for Library peeks, inline for single-check refreshers). Sous freeze scope (12.4). Shelf taxonomy (4.1). Frontmatter obligations extension (17.6). `supersedes` direction inversion (17.7). `satisfied_by` omission (17.8). **Academy replaces Rippling for document signing (1). Witness countersignature retired (1). Culture OS check scope (17.9) - closed 2026-09-01: `culture-os-standard` gets checks, `culture-os-origin` does not. Origin is company history; a comprehension test on it is trivia. Origin's signature is a straight acknowledgment.** **Pre-signature corrections do not bump the version (12.3).**

---

## 18. The learner experience

**Status: designed and approved, 2026-09-01.** Visual reference: `OPD_Academy_Journey_v2.html`. The render illustrates; this section rules. Where they disagree, this section wins.

No Academy surface ships that contradicts this section. If a build needs an exception, it is a ruling, not an implementation choice.

---

### 18.1 Six governing principles

**1. The reward is the record.** What a person earns for signing is a real certificate with a real serial, a credential that lights up, and honest numbers. Not points, not levels, not experience. The evidence is the prize because the evidence is what the system exists to produce.

**2. Celebration is proportional to what happened.** A correct answer gets nothing - correct is the expected outcome. A signature gets a quiet, dignified confirmation. **Finishing a cycle gets a real moment.** Celebrating small things devalues the large ones and makes a compliance record feel like a game.

**3. Every claim is true, or it is absent.** No invented statistics, no aspirational framing dressed as observation, no manufactured urgency. If the system does not know a thing, it says nothing rather than guessing warmly.

**4. Reading is not gated. Comprehension is.** Scroll depth is never tracked as evidence and never blocks progress. Scrolling is not reading, and gating on it is theater people defeat within a week. The comprehension check is the real gate, and it is the only gate.

**5. No percentage without history.** A person with zero signatures sees their queue and their minutes, never 0%. A percentage on a surface someone has never been able to act on reads as failure. Once there is signed history, the percentage appears.

**6. No ranking, ever.** No leaderboards, no position, no "you are Nth of thirty." Ranking motivates the fast and shames the slow, and a shamed operator clicks through without reading. Peer information is permitted only in the aggregate and the affirmative forms defined in 18.13.

---

### 18.2 Stage 1 - Landing

The Academy tab is the default room.

**Two cards on one gutter.** The landing is a profile card and a lessons card side by side, stretched to equal height, separated by the page's single gutter value. The secondary row (Your Year + Your Record left, Company Standing right) sits below on the same gutter. Five cards at five different gaps reads as scattered; four cards on one gutter reads as a grid.

**A card holds blocks; it is not divided into bands.** Content inside a card sits as bordered blocks inset by the page gutter. Full-bleed rules are reserved for a card's own header and footer (the identity strip, the lessons title bar, the tinted footer with links). One gutter value governs the gap between cards, the gap between blocks, and the inset inside them.

**The profile card takes this grammar too**: the identity strip is its header (36px avatar horizontal beside name and role, not a 52px avatar stacked above), and Streak, This cycle, Due, Your certificates and Coming up are each a block inside.

**No top greeting band.** The greeting, count, minutes and due date all live in the rail once each. Continue lives in the lessons card's own header, right-aligned next to the work it starts.

**Shown:** the person's identity and role; a **streak chip** when the streak is true; the queue count phrased as **"to go"** rather than "items"; total minutes; days remaining in the cycle; a progress meter; the certificates list (a legible list with document title, serial, and date - never a credential-tile wall); the year track; the record card; the site standing card.

**A list that can outgrow its card is capped and scrolls internally**, and when content is hidden the surface says how much - a fade alone tells the person something is below, not whether it is one item or six. The lessons list caps at `min(520px, calc(100vh - 330px))` and shows three signals when there's more below at once: a fade at the bottom edge, a visible scrollbar, and a **counted pill naming how many blocks are hidden** ("2 more below") that scrolls the list when clicked.

**One leading column governs alignment.** `--lead: 44px` (or its scaled equivalent) sets the icon/bubble column for every row type in the lessons list. Set headers, part rows, and single-part rows all start their text at the same x. The due column is fixed-width and right-aligned. A single-part document renders as a set header with no rows beneath it; NEVER as a part row wearing a header icon.

**Descriptions come from `documents.card_line` or `obligations.description`.** Never from `source_section` (that's a semicolon-joined heading list, not a description). If neither exists, render nothing - an empty second line beats an unreadable one.

**Due dates render neutral until the last five days of the cycle**, then amber, then red when overdue. Amber for a date 29 days out on a page whose rail already says 29 days left means amber has stopped meaning anything.

**Prohibited here:** a percentage before any signature exists; the word "compliance"; any nag when the queue is empty; emoji in operator copy; obligation keys in visible text or on `title` attributes.

---

### 18.3 Stage 2 - The queue

One row per requirement, ordered by due date then by estimated minutes ascending, so the shortest item is reachable first.

**Each row carries:** the document and its part ("Culture OS · part 1 of 2"); the module title; a **plain-language reason it applies** - "Every KitchFix leader reads this in their first month" - never a cadence code; due date; estimated minutes; social proof where it qualifies (18.13).

**Prohibited:** obligation keys, cadence enums, or worker-class labels in operator-facing copy. Those are Admin vocabulary.

---

### 18.4 Stage 3 - Opening a module

The document opens **inside the shell** as a Focus view with a breadcrumb. Never a modal, never a drawer.

**A module is one card.** Header, step rail, and reading column are regions of a single bordered surface divided by hairlines, not separate cards on a background. The reading column is centred within its own space so the measure reads as a deliberate column rather than a narrow card in a wide box. Do not widen the text; centre the column. Same logic as the approved shell where the navy bar is the lid of one surface, applied one level down.

**The header band** carries the doc chip, title, "part N of M" when the doc has multiple obligations, and **minutes remaining right-aligned as the largest number on the screen**. It decreases as sections complete. "How much more of this" is the question people actually have.

**A 3px progress rule** runs edge to edge directly under the header, so it belongs to the module rather than sitting near it.

**The reading pane is capped, not fixed.** Content shorter than the cap sits at its natural height with no scrollbar. Content longer caps at the smaller of 620px or `100vh - 360px`, and scrolls, with a fade at the edge as the only signal (no "keep reading" text cue - text clipped mid-line under a gradient is the signal). Below 900px the cap is removed and the page scrolls naturally; nested scroll on a phone is worse. The pane is `tabindex="0"` and carries an `aria-label` so it is reachable and announced by screen readers.

**The rail carries**, in order:
1. "In this module" header with a count ("3 of 8" done).
2. Every section as a row with title, minutes, and check count. A merged step shows a `+N` chip signalling additional sections folded into it.
3. A final **Sign** step.
4. A footer card stating: **your place is saved, nothing is submitted until you sign.**

That last card is not decoration. It is the permission to leave, and it is what makes a twelve-minute document openable on a phone between services.

**A passed check persists across navigation.** Returning to a completed section shows it as answered, with the option locked and the explanation visible, not rebuilt empty. Within-session Back preserves the exact option the person picked; a cross-session revisit shows a compact "passed" summary (the option identity isn't tracked server-side by design).

**Motion is a system, not a decoration.** One easing curve and three durations tune everything - step content slides in on change, the rail bubble pops when a section completes, the progress bar eases, buttons depress on `:active`, options transition border and shadow only. `transition: all` is banned; every transition names its properties, and `width`, `height`, `max-height`, `top`, `left`, `margin`, and `padding` are never transitioned. `prefers-reduced-motion: reduce` collapses every animation and transition to near-zero - not optional on a compliance surface.

**After answering a check, the pane scrolls just enough to bring the feedback above the fold.** Not a jump to top - the minimum scroll that reveals it, smooth. Applies to both correct and incorrect.

**The module fits the viewport.** Card height is `calc(100vh - --chrome)`, where `--chrome` names every contributing pixel (nav, margins, command bar, body padding, borders) so the sum is auditable rather than a magic number. The rail scrolls independently, the reading pane scrolls independently, and the footer is pinned. Both scroll containers need `min-height: 0` and `height: 100%`; the grid needs `min-height: 0` and `overflow: hidden`. Below 960px the whole viewport-fit rule releases (heights auto, overflow visible, page scrolls normally) - nested scroll on a phone is worse than a natural page scroll.

**No breadcrumb.** The Academy button in the footer is the route home. A crumb trail nobody clicks is chrome; a labelled button next to Back and Save & exit is a real affordance.

---

### 18.5 Stage 4 - Reading

**A module is a sequence of steps, not a document with checks appended.** One step is on screen at a time; the page does not grow as the person progresses. A step is a section of the document, sized so a reasonable reader can absorb it in about three minutes. Where a document section runs longer than that (roughly 600 words at 200 wpm), the server descends one heading level and breaks the step at the next boundary. Where a section is short, it stays whole.

**The frame carries three things every step:** a persistent **step rail** on the left listing every section (title, minutes, check count) plus a final **Sign** step; a **module header** at the top with the doc chip, the module title, the "part N of M" tag when the doc has multiple obligations, and the **minutes remaining as the largest number**, with a progress bar beneath; and a **step card** on the right holding one step's content and the check(s) that gate its advance.

**Reveal-and-append is the defect being fixed.** An implementation that keeps every section on screen and adds the next one below it has not implemented the stepper - by the last section the page is enormous, which is exactly the pattern the stepper replaces. The step card is the ONLY content surface; when the person advances, that card is replaced.

**No scroll tracking. No scroll gating. No progress bar that fills as you scroll.** Progress advances step by step, gated by checks where present.

**Two checks in a step come one at a time.** The active check is on screen; passed checks fold up above it; unstarted checks below it do not appear. The Continue button reads "Next check" between them and "Continue" (or "Continue to sign" on the last step) when the step is cleared.

**Locking after a right answer.** Once a check is correct, the options lock. There is no way to change a passed answer to a wrong one; the state that would produce is ambiguous and is not a state we ever want to be in.

**Positional answer letters.** Options are labeled A/B by display position. The shuffle happens server-side per request, so a stable underlying option letter would confuse; the letter the operator sees is the letter of the button they are looking at.

**Wrong-answer recovery stays inside the step.** The amber "Show me that line" scrolls and flashes an anchor WITHIN the current step card. It does not scroll the whole document, because at this point in the module there is no whole document on screen.

**Save & exit + resume.** Every step advance and every Save & Exit posts to `/api/academy/progress`, which UPSERTs a mutable scratch row (`academy_module_progress`) with the union of sections seen and the max of time spent. On re-entry, the client mounts at `progress.furthest_step_index`, not step zero. Passed-check state is server-tracked (append-only attempts) and reconstructed from `progress.all_correct_ids`, so a passed check stays passed across sessions.

**Keyboard.** Enter or Right advances when Continue is enabled; Left goes back; 1/2 select an option. Ignored while focus is in a text input, so the signature field is not disturbed.

**Mobile rail collapse.** Below 900px the desktop rail is replaced by a single line - "Section N of M", a thin progress bar, and an "All sections" toggle. The toggle expands the same list as the desktop rail.

**Accessibility.** Focus moves to the step heading on advance. Feedback panels are `aria-live="polite"`. Options are real `<button>` elements with `aria-pressed`. The step rail is an ordered list with `aria-current="step"` on the active item.

A completed step is marked done in the rail - a statement of position, not an assertion that comprehension occurred. The signature makes that claim, and only the person can make it.

---

### 18.6 Stage 5 - The check

Called a **quick check** in all operator-facing copy. Never "assessment", "test", "quiz", or "comprehension evaluation".

Checks appear inline at the section boundary, not gathered at the end. The person read the answer within the last minute, so the source is one scroll away. This is what makes the wrong-answer path recoverable rather than punishing.

**A section earns a check when it carries information an operator must actually retain.** Ruled 2026-09-01.

A check is warranted where the content is:

- something a person could plausibly get wrong on the floor, with consequence
- legally or contractually binding
- a specific standard, threshold, or sequence that has to be recalled correctly
- a distinction the document itself draws sharply, where collapsing it changes behaviour

A check is **not** warranted for narrative, history, or context, however well written. Testing those produces trivia, and trivia teaches people that checks are a hoop rather than a point.

There is no cap per section and no target per module. A section with four critical ideas earns four checks. A section with none earns none. **Volume follows the content, never the structure.**

**A check must never quote a `<Fact>` value.** Mission, Vision and the brand promise are interpolated components, not body text. A check that tests an interpolated value becomes wrong the moment that value is edited - and wrong for people who were already graded on it, whose attempts are recorded and whose signatures are on file. Checks test the standard and the surrounding commentary, never the interpolated value.

Answer order shuffles per attempt. `correct_option_id` never reaches the client.

---

### 18.7 Stage 6 - A wrong answer

**Amber. Never red.** Red is failure; amber is "look again".

The feedback must: say plainly that it is not right, in warm register; **explain why**, naming the specific line or anchor that holds the answer; offer a button that scrolls to that section and **flashes it** so it is findable.

Attempts are unlimited and every attempt is recorded. The certificate showing "2 attempts" is correct and is not a mark against anyone - it is what honest looks like.

**Prohibited:** scores, percentages, "you failed", red, any limit on retries, any consequence for a wrong answer beyond trying again.

---

### 18.8 Stage 7 - A right answer

Brief, warm, and then out of the way. One sentence confirming, one sentence of why it matters, one button forward.

**No celebration.** Correct is expected. Celebrating the expected is how a compliance record starts feeling like a game, and a person who feels they are playing a game reads less carefully.

---

### 18.9 Stage 8 - Signing

The attestation is set in a **serif face** so it reads as a document rather than interface. It is the one place legal register is correct; everywhere else uses operator language.

The typed name must match the authenticated person's name. **The button is disabled until it matches**, and the hint states the expected name after a few characters. No submission is possible with a mismatched name.

**What the person will earn is shown before they commit** - the credential and the fact a certificate will be issued and emailed. The reward is stated, never sprung.

---

### 18.10 Stage 9 - The push

**The highest-leverage screen in the product.** When a person is nearly done, the room stops being a list and becomes a single call to finish: one banner, one sentence, one button.

**Trigger rule, ruled 2026-09-01:**

> The push fires when **one requirement remains**, or when **any number remain and the cycle has 5 or fewer days left**.

**It fires once per state change, not on every page load.** A push that appears every time is a nag, and a nag gets ignored and then resented.

Copy names the remaining work and the time: "One left, Kevin. Eleven minutes and September is done."

**Prohibited:** countdown timers, red urgency, consequence threats, or any push while more than five days remain and more than one item is outstanding.

---

### 18.11 Stage 10 - Cycle complete

**This is where celebration belongs, and it is the only place it belongs.**

**Shown:** a plain declarative heading - "September is done."; the real numbers (modules signed, minutes spent, days early); the streak incremented; every credential earned in the cycle, current, in one row; the next cycle previewed with its opening date and size.

**Prohibited:** confetti, animation beyond a single entrance, points, levels, badges that are not credentials, any comparison to other people.

The numbers are the reward because the numbers are true.

---

### 18.12 Stage 11 - The resting state

What most people see most of the time, and it must be good.

**Shown:** that they are current; the credential wall, all earned; the year track; the next cycle opening date.

**Not shown:** a queue, a call to action, optional extra learning, or anything that manufactures work.

**A quiet Academy is a working Academy.** The correct response to a person who is up to date is to tell them so and get out of the way.

---

### 18.13 Social proof - permitted forms and the floor

Peer information is one of the strongest adoption levers available and one of the easiest to corrupt. Two forms are permitted and both must be literally true.

**Aggregate, on a queue row:** "12 of 30 leaders have signed this."

> **Floor, ruled 2026-09-01: display only at 25% or above.** Below the floor, show nothing. "0 of 30 have signed this" is true and demotivating, and on day one of every cycle it is the true number.

**Named and affirmative, on the site card:** "Jen finished hers on August 29."

> Only ever names people who have **completed**. Never names who is behind, late, or outstanding. A colleague's incompleteness is management information (spec 3.4) and is not shown to peers.

**Prohibited:** ranking, position, percentile, anyone's incompleteness, or any comparison framed as competition.

---

### 18.14 Expectation-setting copy

The landing sub-line sets effort expectation. Once completion data exists it may state an observed fact - "most people finish this in two sittings".

> **Ruled 2026-09-01: until that data exists, it is phrased as intent, not observation.** For example: "Eight short reads, built to be done in two sittings." That is a design statement and it is true. "Most people finish in two sittings" is a claim about behaviour nobody has measured.

This is principle 3 applied to the friendliest-sounding sentence on the page, which is exactly where an untrue claim is most likely to slip in.

---

### 18.15 Prohibited across the whole experience

- Points, levels, experience, or any invented score
- Leaderboards, ranking, or position
- Confetti or celebration on an individual signature
- A streak that is not literally true
- A progress bar that advances on scroll
- Red as the wrong-answer treatment
- A percentage score anywhere on the record - the record stores passed, attempts, and time
- Any statistic about people that has not been measured
- The word "compliance" in operator-facing UI
- Countdown timers or consequence threats
- Dark patterns of every kind, including the friendly ones

---

### 18.16 Open

| # | Question | Blocks |
|---|---|---|
| 18.a | Does the streak reset on a missed cycle, or degrade? | Streak display |
| 18.b | Hourly portal: which of these stages carry over, and which are replaced by the magic-link flow? | Hourly portal |
| 18.c | Mobile: does the session thread persist, or collapse to the time remaining alone? | Mobile chrome |
