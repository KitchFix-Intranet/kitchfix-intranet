# OPD Content Foundation - Project Brief (v2)

**What this is:** the build spec for re-founding OPD as a component content management system (CCM) on KitchFix's existing stack. The canonical content becomes presentation-free structured data in the repo; the catalog metadata, the SousAI corpus, and (later) the print and intranet renderings are all *generated* from it. Nothing downstream is hand-maintained.
**Scope of this phase:** the content foundation only - get all content into one governed system, structured and mapped correctly, with the catalog and corpus generated from it. **The operator-facing intranet OPD page is out of scope here** (next phase, confirmed). **Print rendering is out of this phase** (next phase, confirmed); it remains in the architecture as a renderer that plugs into the same source later.
**Pair with:** the Phase 2 Master Charter and the running library audit (this phase consumes its outputs), the SousAI character spec, CLAUDE.md.
**Convention:** hyphens only, no em-dashes.

**Revision note (v2):** added the override dimension to the facts model (§3.2-3.3), the governance layer - approval evidence, staleness, effective-dating (§3.4, §6), derived/generated documents (§3.5), -ES translation parity (§3.6), audience-scoped retrieval and the fact-change blast-radius report (§6), a pilot-first migration step (§8), and a named authoring-bottleneck trigger (§9). D-A confirmed (redirect Workstream B); print confirmed out of this phase. Leans applied throughout per Kevin's direction.

---

## 0. The reframe (read this first)

You are not building one canonical document. You are building a **canonical content repository**: many discrete structured files, governed as one system, with one set of rules and one automated pipeline. The "single spot" is the system, not a single file.

The architectural move is one inversion: **the repo becomes canonical; Postgres and the SousAI corpus become generated projections of it.** Today the document body lives in three hand-synced forms (Word, Drive, chunks) and the metadata lives in a fourth (Postgres), and you are the integration layer. After this, content has exactly one home, and every other form is built from it by a script, on every change. As a side benefit, git becomes the backup and the attributable audit trail, replacing the current Drive/Sheets sprawl.

Three reasons the system stays many-files-not-one:
- **Lifecycle is per-document.** One doc is Blocked on Sebastian while another is Live; you cannot hold two statuses, owners, and SME gates in one file.
- **SousAI's trust is per-source.** Citations, the contradiction guard, and template-as-canonical all need discrete, addressable documents.
- **Diff, rollback, and incremental re-audit need discrete artifacts.** Change-detection on 60 files is cheap; re-reading a monolith on every edit is not.

---

## 1. End-state for this phase (what "done" looks like)

- All ~60 documents exist as **structured source files** in `/content`, presentation-free, one file per doc, frontmatter + semantic body.
- The **load-bearing facts** live once, typed, with their authority - and **override-bearing facts carry their state and account variants in data**, so a New York operator gets the New York answer, not the company floor.
- Every document's **catalog row** and **relationship edges** are **generated from frontmatter**, not entered by hand.
- The **governance data** is real and recorded: who approved which version when, when each doc was last reviewed, and when each version took effect.
- **Derived documents** (the compliance calendar, the cert matrix) are **generated from structured data** on the source docs, never hand-maintained.
- The **SousAI corpus** is **generated from the source**, override-aware (Sous qualifies or asks on conditional facts rather than stating the floor as universal) and audience-scoped (operator queries never surface corporate-only content).
- A **validation gate** runs on every change: schema valid, all references resolve, no placeholder numbers in Live docs, heading hierarchy present, override resolution complete, approval evidence present for Live legal docs, and a blast-radius report on any fact change.

---

## 2. The system and the stack (no new SaaS)

This is the docs-as-code form of CCM, built entirely on tools you already run. It fits how you work: git diff, PR review, rollback, VS Code, CC editing files, repo-is-truth.

| Layer | What | Tool (already yours) |
|---|---|---|
| Canonical source | `/content` tree: documents, facts, components, schemas | Repo (git) |
| Authoring | MDX files + YAML facts, edited in VS Code / by CC | VS Code, GitHub Desktop |
| Resolution | Inline the facts (with override context), expand transclusions | Build script (Node) |
| Validation | Schema + reference + hygiene + governance checks as a merge gate | CI (Vercel build step / Railway job) |
| Catalog projection | Read frontmatter, upsert `documents` + `document_relationships` | Build script -> Supabase/Postgres |
| Corpus projection | Flatten to text (override-aware, audience-scoped), chunk, embed | Existing `src/lib/sousai/*` + scripts |
| Derived-doc generator | Aggregate `obligations` data -> compliance calendar, cert matrix | Build script |
| Print renderer (next phase) | Resolved HTML -> per-class STD-001 template -> PDF | WeasyPrint, cairosvg, pdf-lib |
| Intranet view (next phase) | Compile MDX to React at `/playbook` | Next.js 16 / React 19 |

---

## 3. The source content model

### 3.1 The tree

```
/content
  /documents/          one file per doc, the 60
    POL-008.mdx
    PB-006.mdx
    ...
  /facts/
    operational-facts.yaml      the typed load-bearing values, with overrides
  /components/                  reusable, transcludable blocks (use sparingly)
    safety-preamble.mdx
  /derived/                     generated outputs, not hand-authored
    compliance-calendar.generated.mdx
    cert-matrix.generated.mdx
  /schema/
    frontmatter.schema.json
    facts.schema.json
  /assets/                      images, poster art
```

### 3.2 A document = frontmatter (the catalog row) + semantic body

Frontmatter mirrors the OPD `documents` table and adds the governance and scope fields:

```yaml
---
id: POL-008
title: Overtime and Hours Worked
doc_class: POL          # PB SOP STD POL AGR TPL FORM CHK REF POST
shelf: HR & People
status: Live            # Placeholder Pending Draft In-Build Blocked Live Retired
version: 2.1            # required for Live
card_line: "When overtime gets paid, and how hours are counted."   # required for Live
summary: "..."
keywords: [overtime, pay, hours worked]
owner: Director of Operations      # role title, never a name
approver: VP Operations
audience: operator      # operator corporate internal  (scopes retrieval)
classification: KitchFix Internal
lang: en
in_corpus: true
applies_to: company-wide           # or { states: [TX] } / { account: TXR-TX-V }
# governance
approval:
  approved_version: 2.1
  approved_by: VP Operations
  approved_date: 2026-05-20
  method: recorded sign-off
last_reviewed: 2026-06-01
review_interval_months: 12         # shorter for legal-class POLs
effective_date: 2026-06-01         # when this version takes effect
# catalog flags
print_required: false
critical: false
pinned: false
sort_order: 10
relationships:
  - { to: POL-013, type: references }
# derived-doc inputs (only where the doc carries deadlines/obligations)
obligations:
  - { type: permit_renewal, cadence: annual, next_due: 2026-09-01, owner: Finance, source_section: "§04" }
---

Hold cold foods at <Fact id="cold_hold_temp" /> or below.
Sick leave accrues at <Fact id="sick_accrual" /> (varies by state - the resolver fills this for the doc's jurisdiction).
```

`applies_to` is the key new field: it declares the document's jurisdiction, and the resolver uses it as the override context for every `<Fact>` token inside the doc. A company-wide doc gets the floor value plus a "varies by jurisdiction" qualifier; an account annex gets that account's value.

### 3.3 The facts layer, with overrides (the highest-leverage piece, now corrected)

A flat one-value-per-fact model is wrong for your floor-then-override world. Facts now declare a default and, where they vary, the override variants in data:

```yaml
cold_hold_temp:
  scope: global
  default: { value: "41°F", unit: fahrenheit, authority: "FDA Food Code (company floor)" }
  owner: Food Safety
  last_reviewed: 2026-06-01

sick_accrual:
  scope: override-bearing
  dimensions: [state, account]
  default: { value: "1 hour per 30 worked", authority: "Company blanket floor" }
  overrides:
    - when: { state: <STATE> }
      value: "<KEVIN/AUDIT SUPPLIES>"
      authority: "<state statute - confirm with counsel>"
  owner: Human Resources
```

Resolution rule: given a context (the doc's `applies_to`, or a runtime account/state for Sous), the resolver picks the most specific matching override, else the default. **This is what makes a contradiction on a load-bearing fact structurally impossible** - the value has one home, and its variants are data, not prose scattered across annexes.

**The schema supports overrides; the audit and Kevin supply which facts are override-bearing and the actual variant values.** Nothing invented (this is an operational actual). The contradiction-hunt list from the running audit is the seed for which facts need this treatment.

### 3.4 Governance fields (what makes corporate and legal able to trust it)

- **Approval evidence.** The `approval` block records the approved version, approver role, date, and method - not just a typed string. Validation requires it on Live legal-class docs, so "HR approved POL-008 v2.1 on this date" is a recorded fact, not a claim.
- **Staleness.** `last_reviewed` + `review_interval_months` drive a generated staleness report (docs overdue for review). Lean default 12 months; shorter for legal POLs.
- **Effective-dating.** `effective_date` per version, combined with git history, answers "what policy was in effect on date X" without a heavyweight temporal database. Git's immutable, attributable history is a compliance asset most CMS platforms cannot match - this leans into it rather than rebuilding it.

### 3.5 Derived documents (generated, never authored)

Your highest-value operational artifacts are aggregations that exist in no single doc - the consolidated compliance calendar and the cert matrix. In this model they are not hand-written prose; they are **generated** from the `obligations` data block carried on each source doc (§3.2). A build step aggregates every deadline, renewal, and recurring obligation across all docs into `/content/derived/compliance-calendar.generated.mdx`, regenerated on every build, so it can never drift from its sources. Derived docs are flagged `derived: true` and are not hand-editable.

### 3.6 Translations and -ES parity

`-ES` postings stay in the same system, excluded from the corpus and linked to their English source:

```yaml
id: POL-006-ES
lang: es
in_corpus: false
translation_of: POL-006
source_version: 2.1        # the English version this reflects
```

Validation flags a translation as stale when `POL-006`'s current version is ahead of `source_version` - catching the case where your ESL floor staff are reading a different rule than the English policy now says.

### 3.7 Transclusion and the resolver

Two transclusion types: `<Fact id />` (atomic values, with override resolution, use freely) and `<Include doc section />` (a shared content block, use sparingly). Facts always; includes only for blocks genuinely reused verbatim. **Resist DITA-grade componentization at 60 docs.**

The **resolver** is the single point where references get filled in and override context is applied. Source MDX + context -> resolver -> one *resolved* representation -> three renderers (React for web, HTML+CSS for print, plain text for the corpus). For an override-bearing fact, the resolver emits the resolved value for a scoped doc, or the floor-plus-"varies-by-jurisdiction" form for a company-wide doc, so the corpus never teaches Sous a conditional value as universal.

---

## 4. The migration: how 60 separate docs become the system

Semi-automated: CC does the mechanical lift and the structural work; Kevin supplies the operational actuals (override values, real approval/effective dates, obligations) and confirms the canonical facts; CC never invents.

**Step 1 - Freeze the inputs from the audit.** The running audit is the migration prep. From its report: reconciled content and contradiction decisions, the facts inventory (the contradiction-hunt list seeds `operational-facts.yaml`, including which facts are override-bearing), the relationship edges (the dependency map seeds frontmatter `relationships`), the per-doc metadata (the scorecards seed frontmatter), the chunking-readiness flags, and the publish-readiness verdicts. **Conversion does not start until the report is in hand.**

**Step 2 - Scaffold the system.** CC builds `/content`, the schemas, the `<Fact>` / `<Include>` components, the resolver (with override resolution), the derived-doc generator, and the validation skeleton. One sample doc proves the round trip.

**Step 3 - Mechanical conversion, per doc (faithful, no content changes).** pandoc does the docx -> markdown first pass. CC maps the metadata table to frontmatter, ensures every heading is a real heading level (using the audit's chunking flags to know which docs need the hierarchy rebuilt), and produces clean semantic MDX. Transcribed faithfully so section-keyed audit findings still map.

**Step 4 - Extract the facts, with overrides.** Pull the load-bearing values into `operational-facts.yaml`, seeded by the audit. Replace inline occurrences with `<Fact>` tokens. **Kevin confirms each fact's canonical default, its authority, and - for override-bearing facts - the state/account variants.** After this, duplicated facts are gone; one home each.

**Step 5 - Wire relationships and governance.** The audit's edges become frontmatter `relationships`. Populate `approval`, `last_reviewed`, `effective_date`, `applies_to`, and `obligations` from Kevin-supplied data.

**Step 6 - Revise and enrich, in MDX.** The Pass 3 work, done in the target format. Reconcile remaining (non-fact) conflicts, enrich thin docs with actuals from the Actuals Needed register, mark template/specimen content non-canonical, set `in_corpus` / `lang` / `translation_of` for translations and POST stubs.

**Step 7 - Validate.** Run the merge gate (§6). Fix until green.

**Step 8 - Generate the projections.** Build the catalog (frontmatter -> tables), the corpus (resolver -> flattened, override-aware, audience-scoped text -> chunker -> embed), and the derived docs. Verify chunking, retrieval, and override resolution.

Division of labor: CC executes 2-5, 7, 8. Kevin confirms facts and override values (4), supplies governance and obligations data (5), supplies actuals and directs revision (6), reviews throughout.

---

## 5. The generated projections

- **Catalog (in scope).** A build script reads all frontmatter and upserts the Postgres `documents` and `document_relationships` tables. Postgres becomes a projection: writes come from the repo through the pipeline, never by hand, so the two cannot drift.
- **SousAI corpus (in scope).** The resolver flattens MDX to plain semantic text carrying the heading-ancestry path, with override-awareness and audience-scoping baked in; the existing structure-aware chunker reads it; embed runs idempotently (content hash, re-embed only changed docs). Only `in_corpus: true` docs enter. Chunking is lossless by construction.
- **Derived docs (in scope).** The compliance calendar and cert matrix are regenerated from `obligations` data on every build.
- **Print / PDF (next phase, confirmed out).** Resolved HTML -> per-class STD-001 CSS (em-dashes live here only) -> WeasyPrint -> pdf-lib stamp. Plugs into the same source with no content change.
- **Intranet view (next phase).** Next.js compiles the same MDX to React at `/playbook`.

---

## 6. Validation and governance (the merge gate)

CI fails the merge if any break. This is how the one-time audit becomes a permanent guarantee:

- Frontmatter validates against schema; `status` in the 7-enum; `doc_class` and `shelf` valid; `id` unique.
- Every `<Fact id />` resolves; every override-bearing fact has a default; override `when` keys use declared dimensions.
- Every `<Include doc section />` resolves.
- Every `relationships.to` resolves, and **no relationship points to a Retired doc** (the audit's retired-set check, now structural).
- Every Live doc has `version` and `card_line`; Live legal-class docs have an `approval` block (`chk_live_complete`, extended).
- **No placeholder or example numbers in a Live doc** (number hygiene; flag TODO / TBD / unresolved fact tokens) - defends SousAI hard-floor rule 2.
- Every multi-section doc has a real heading hierarchy (chunking-readiness, validated on the source).
- **Fact-change blast-radius report.** On any `operational-facts.yaml` change, the gate lists every document that references the changed fact, so a fact edit cannot silently invalidate approved content; affected approved Live docs are flagged for re-approval.
- **Audience scope.** The corpus projection respects `audience` / `classification` so operator queries never surface corporate-only content.
- **Staleness report** (warn, not fail): docs past `last_reviewed` + `review_interval_months`.
- **-ES parity report** (warn): translations whose `source_version` lags the English current version.

You audit once for judgment and actuals. The machine prevents regression on every change after that.

---

## 7. Relationship to the running audit, and what this changes

- **The audit (Pass 0-2, read-only, in flight) is unaffected.** Let it finish. It is the migration prep; §4 step 1 consumes its outputs.
- **Workstream B is redirected (D-A, confirmed).** Instead of loading audited Word docs into Drive and generating from Drive, the conversion to MDX *is* the load. The Drive-sharing batch and the Drive-based catalog/corpus build are not constructed.
- **Two gates we added change:** the Drive-render gate (CK-6) retires (no Drive iframe as source of truth); the Pass 5 chunking go/no-go upgrades to the stronger source-level CI validation in §6. The duplicate/overlap sweep stays valuable and runs against the MDX source.
- **Do not run conversion in parallel with a separate Word-side revision.** Sequence: audit -> faithful conversion -> revise in MDX. Keep one canonical at a time; the audit set is read-only and stable during conversion.
- **Hard dependency:** conversion cannot begin until the audit report exists.

---

## 8. Build sequence (sub-phases and checkpoints)

| Sub-phase | What | Owner | Checkpoint |
|---|---|---|---|
| F0 | Audit report received; inputs frozen (facts + override seed, edges, metadata, governance data, flags) | Kevin + CC | the audit's existing checkpoints; nothing converts before this |
| F1 | Scaffold `/content`, schemas, Fact/Include components, resolver (with overrides), derived generator, validation skeleton; one sample doc proves the round trip | CC | **CK-A: Kevin reviews the sample round trip before bulk conversion** |
| F1.5 | **Pilot: take the currently-live set (the handful in production today) end to end** - convert, project, embed, verify retrieval + override resolution. Ship and derisk the pattern before batching. | CC | **CK-B: Kevin reviews the working pilot before the full batch** |
| F2 | Mechanical conversion of the remaining docs to faithful MDX + frontmatter | CC | spot-check fidelity |
| F3 | Facts + override extraction; Kevin confirms each default, authority, and variant | CC + Kevin | **CK-C: Kevin confirms the facts file before tokens replace prose** |
| F4 | Relationship + governance wiring (approval, effective dates, applies_to, obligations) | CC + Kevin | spot-check |
| F5 | Revision + enrichment in MDX (actuals from Kevin; nothing invented) | CC + Kevin | **CK-D: Kevin directs revisions and supplies actuals** |
| F6 | Validation green; duplicate/overlap sweep; staleness + parity reports reviewed | CC | **CK-E: Kevin reviews validation + reports** |
| F7 | Generate catalog projection (upsert) | CC | confirm rows match frontmatter |
| F8 | Generate corpus + derived docs; embed; verify chunking, retrieval, override + audience behavior | CC | **CK-F: Kevin reviews chunk counts, retrieval + override spot-checks** |

Print and intranet are separate phases after F8, against the same source.

---

## 9. Risks and honest caveats

1. **Authoring ergonomics is the number-one risk, and now it has a planned offramp.** SMEs will not write MDX in git; for this phase you and CC are the structured-authoring layer. That makes you the sole authoring path - fine at 60 docs, a bottleneck and single point of failure at scale. **Trigger to build the thin authoring UI (Next.js writing MDX via the GitHub API): when the library passes ~100 docs, OR sustained SME-originated updates exceed ~8 per month, OR a second concurrent author is needed.** Planned milestone, not a crisis. Do not build it before a trigger fires.
2. **The migration is a real, front-loaded lift.** Sixty docs through conversion, fact + override extraction, governance population, and revision is weeks, not days. One-time cost for permanent structural health.
3. **Conversion fidelity.** pandoc plus Word's bold-as-headings means some docs need the heading hierarchy rebuilt by hand; the audit's flags say which. Budget for it.
4. **Over-modeling overrides.** Add override variants only where they genuinely exist; do not manufacture jurisdiction complexity for facts that are actually global. Keep variants in data, never hardcoded in prose.
5. **The corpus must read flattened, resolved text, not literal JSX**, and must apply override-awareness and audience-scoping at flatten time. A real build step to get right and to test.
6. **Blast radius is the cost of single-sourcing.** Changing one fact rewrites every referencing doc - the feature and the hazard. The blast-radius report (§6) is the mitigation; treat a fact change to approved content as a re-approval event.

---

## 10. Decisions

| ID | Decision | Status |
|---|---|---|
| D-A | Redirect Workstream B to the MDX conversion | **Confirmed yes.** |
| D-E | Print rendering in this phase | **Confirmed out** - next phase, plugs into the same source. |
| D-B | Revise post-conversion in MDX | Lean applied (post-conversion). |
| D-C | Source format MDX vs Markdown | Lean applied (MDX, for transclusion + native Next.js). |
| D-D | Facts canonical home repo YAML vs Postgres | Lean applied (repo YAML; project to Postgres only if runtime query needs it). |
| D-F | `<Include>` scope | Lean applied (facts-only to start; add block includes only where the audit shows verbatim reuse). |
| D-G | `-ES` / POST handling | Lean applied (same system, flagged + parity-tracked). |
| D-H | Override dimensions | Lean applied (state + account). |
| D-I | Approval evidence | Lean applied (recorded sign-off block; required for Live legal docs). |
| D-J | Effective-dating | Lean applied (lightweight `effective_date` + git; no temporal DB). |
| D-K | Staleness cadence | Lean applied (12-month default; shorter for legal POLs). |
| D-L | Authoring-UI trigger | Lean applied (~100 docs / ~8 SME updates per month / second author). |

**Still yours to supply (actuals, not decisions - nothing invented):** which facts are override-bearing and their state/account values; the real approval, effective, and review dates; the real obligations/deadlines for the compliance calendar and cert matrix. These come from you and the audit during F3-F5.

---

## 11. Operating principles (carried over)

- No silent scope additions - flag and wait.
- Verify, do not assume - check current code and state before relying on a path, name, or count.
- Do not invent operational actuals - name the gap, ask Kevin.
- Flag legal, do not rule.
- Hyphens only in source, code, commits, and Sous's voice; em-dashes live only in the print render per STD-001.
- Surgical over sweeping.
- Branch-and-PR for everything; direct push to main is blocked; Danger Zone files need explicit sign-off.
- The repo is the source of truth.
