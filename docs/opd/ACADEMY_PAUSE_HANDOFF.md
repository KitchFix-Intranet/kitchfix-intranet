# Academy - pause handoff

**Paused 2026-09-01.** Everything below is verified against production and `main`, not remembered.

**For CC:** commit to `docs/opd/ACADEMY_PAUSE_HANDOFF.md`. Add a line at the top of `ACADEMY_MASTER_SPEC.md` Section 16 pointing here.

---

## 1. Read this first when resuming

The Academy is **built, verified, and paused mid-pilot**. It is not half-finished infrastructure - the machine works end to end and one real signature exists. What stopped is content authoring and three unbuilt rooms.

**One person can use it today: Kevin.** It is fenced by `ACADEMY_PREVIEW_ONLY` in `src/lib/academy/resolveIdentity.js`. Nobody else can reach `/opd`.

**Do not start by building.** Start by reading `ACADEMY_MASTER_SPEC.md` v1.2 end to end, then Section 4 below - the open rulings are what the next work depends on.

---

## 2. Production state, verified 2026-09-01

**13 `academy_*` tables. 5 RPCs.**

`academy_attestations`, `academy_check_attempts`, `academy_cycle_modules`, `academy_cycles`, `academy_eligibility_exceptions`, `academy_grants`, `academy_module_progress`, `academy_obligations`, `academy_person_stints`, `academy_persons`, `academy_questions`, `academy_region_leads`, `academy_requirements`

`backfill_requirement_person_ids`, `insert_requirements_bulk`, `publish_cycle_atomic`, `replace_document_obligations`, `sweep_orphan_obligations`

**Row counts:**

| Table | Rows |
|---|---|
| `academy_persons` | 887 |
| `academy_person_stints` | 1,129 |
| `academy_grants` | 6 (3 people x 2 grants) |
| `academy_region_leads` | 2 |
| `academy_obligations` | 8 |
| `academy_cycles` | 1 |
| `academy_cycle_modules` | 8 |
| `academy_requirements` | 8 (5 active, 3 waived) |
| `academy_questions` | 8 |
| `academy_check_attempts` | 5 |
| `academy_attestations` | **1** |
| `academy_module_progress` | 6 |

**Cycle 2:** "September 2026", **published**, `audience_scope = {"worker_ids":["6418e1e52a44e07c8b303f7b"]}` - Kevin only.

**The one real signature:** `KFA-2026-000004`, `PB-014` / `culture-os-origin`, signed 2026-09-01 16:37.

**Admins:** `k.fietek@`, `josh@`, `joe@` - each holds `academy_admin` and `library_admin`.

**Fences verified:** `academy_attestations` and `academy_check_attempts` hold no UPDATE, DELETE, or TRUNCATE for `service_role`, `anon`, or `authenticated`. All 13 tables TRUNCATE-revoked.

---

## 3. What is built and what is not

### Built and working

- People spine over seasonal rehire - `worker_id` is a stint, `person_id` is the human
- Identity resolver with region-based scope, verified through a live session at `/api/academy/whoami`
- Obligations authored in MDX frontmatter, projected into Postgres on push
- Cycle publishing with audience scoping, atomic and idempotent
- Requirements issuance with a single eligibility filter
- Read-check-sign, server-side grading, five sign gates, append-only attestation
- `/opd` Academy room and module, both through composition, scale, Lucide, motion and three live measurement passes

### Not built

| Item | Notes |
|---|---|
| Certificates as PDF | Serial is issued and displayed. `pdf-lib` is production-live elsewhere, ~100 line reuse |
| Records room | Tab exists, inert. Must show waived requirements with reason and waiver |
| Admin room | Tab exists, inert. Library admin exists at OPD Command and must fold in |
| Notifications | Gmail send is production-live. `academy@` alias created, needs Workspace domain-wide-delegation allowlist |
| Hourly portal | No magic-link primitive exists anywhere. Auth-adjacent, estimate 2-3x |
| Derive extension | **Parked and load-bearing.** Nothing keeps `academy_person_stints` current. The next new hire issues with a NULL `person_id`. `backfill_requirement_person_ids` is the manual drain |

---

## 4. Open rulings - read before building anything

| # | Question | State |
|---|---|---|
| **A** | **`academy-12`** - question matching by section rather than obligation | **Blocks all remaining content.** Kevin ruled the annual re-sign carries the same questions; duplicating rows per obligation means correcting each question twice |
| **B** | **Obligation `sort_order`** | Part order is currently **alphabetical by coincidence**. `culture-os-origin` < `culture-os-standard` happens to be right; `big-rules-annual` < `big-rules-onboarding` would be backwards. The projection should write authoring order and every consumer should read it. Fold into `academy-12` |
| C | Bounce detection - Gmail `history.list` polling or ESP webhook | Blocks the hourly portal |
| D | Overdue consequence ladder | Blocks notifications |
| E | Spanish parity - `PB-004-ES` is Retired and hourly needs it most | Blocks the hourly pilot |
| F | Mobile chrome sequencing - Academy-native then extract, or shared arc first | Gate on a real mobile measurement first |

**A and B are the critical path.** Nothing else in content can proceed until they land.

---

## 5. Content state

| Document | Modules | Questions | Status |
|---|---|---|---|
| **PB-014 Culture OS** | 3 | **8 approved, live** | Working end to end |
| **AGR-001 The Big Rules** | 2 | **13 approved, not seeded** | Blocked on ruling A |
| **PB-006 Culinary OS** | 3 | **11 approved, not seeded** | Blocked on ruling A |

Approved question sets live in this conversation's outputs. **Re-author them into the repo when resuming** - a question set that only exists in a chat has already cost this project a round.

### Content findings not yet acted on

- **`PB-006` section 3.14 Sanitation and Food Safety is 28 words** pointing at `SOP-008`. Highest-consequence topic in a kitchen, delegated by reference. **Ruled: SOP-008 becomes its own Academy module next month.**
- `PB-006` 3.9 Latin Program (21 words) and 3.15 Branding (22 words) are stubs and will read thin as steps
- `AGR-001` Acknowledgement still references a **witness countersignature captured in Rippling**. The witness requirement was retired and the Academy replaces Rippling for signing. **This sentence must be edited before AGR-001 is onboarded** - it is the last line a person reads before signing

---

## 6. Two resolver rules that need building

Both surfaced from the eight-versus-five queue problem and neither is implemented.

**Never issue an annual obligation to someone with no prior signature on the same content.** An annual re-sign presupposes a first sign. Kevin was issued the annual re-signature of documents he had never signed.

**Refuse to publish a cycle containing two obligations that deliver the same content to the same person.** Three duplicate pairs shipped into cycle 2 and were cleaned up by waiver. Same class as the zero-population refusal already in the engine.

---

## 7. Parked cleanups

| Item | Why it matters |
|---|---|
| **`rippling_raw_time_entries` TRUNCATE fence** | `service_role` **and `anon`** hold TRUNCATE on a `kpi-8a` append-only payroll table. One statement erases the raw ingestion history. Scoped as `kpi-8c`. **Real blast radius** |
| **CSS class-hygiene lint** | Three JSX classes had no matching CSS rule - `opd-rg`, `opd-c2`, `opd-rq-fr` - silently rendering unstyled through three review passes. Pair with the phantom-token check |
| Unbounded `.select()` lint | 353 candidate sites, three named as likely real. Fifth instance of this bug class |
| `_audit_probe_imports` alias extension | 28 exposed scripts, none on a schedule |
| D2 cross-session restore | `selected_option_id` is already in the module route's query, just not in the response |
| `.opd-sright` on the solo row | Two structures doing one job. Right edges align, so cosmetic only |
| Set-header right edge | Progress bar / NOT STARTED / nothing - three treatments in one column |

---

## 8. Lessons worth keeping

**`align-items` defaults to `stretch`, and it caused three separate defects here** - an inert sticky rail, 130px of void under short content, and a rail column that would not shrink. All three looked correct in code and took a live measurement to find. **A grid child that must not stretch needs `align-items: start` on the container.**

**A class in markup with no matching CSS rule fails completely silently.** No error, no warning, no console output. It renders unstyled and looks exactly like a design decision, which is why three of them survived every review.

**`var(--token, fallback)` with an undefined token also fails silently.** Seven phantom tokens in `opd.css` rendered their fallbacks while looking deliberate. One - `--font-serif` - put Georgia on the two largest headings in the module.

**`CREATE OR REPLACE FUNCTION` succeeds regardless of whether the body runs.** Existence-and-grants probes pass while a runtime error waits for the first real call. **Function migrations need a mandatory execution probe that asserts the rows written, not the value returned** - a green probe shipped a NULL column.

**Studio wraps the editor in a transaction.** DDL and a verify block referencing it must be separate submissions, or a failing probe rolls back a correct migration.

**Never smoke-test a write path against a real person's real record.** A test signature was issued in Kevin's name, could not be deleted by the app because the fence worked, and had to be removed by owner-level Studio access.

---

## 9. Resume in this order

1. **`academy-12`** - question-to-section matching plus obligation `sort_order`. Rulings A and B together
2. **Seed The Big Rules and Culinary OS questions** - 24 questions already approved
3. **Edit `AGR-001`'s witness line** before that document is onboarded
4. **Certificates as PDF** - smallest remaining piece, high perceived value
5. **Records room** - mostly a table over data that already exists
6. **Admin room** - Cycle Builder plus folding in the existing Library admin
7. **Hourly portal** - the largest remaining piece, gated on rulings C and E

**Do not widen the pilot audience until Records exists.** The moment a second person signs something, someone will ask to see the record, and there is nowhere to show it.
