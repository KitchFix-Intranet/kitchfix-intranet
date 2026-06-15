# F1 CK-A - Sample Round Trip Report

**Built:** 2026-06-14
**For:** Kevin's CK-A review per `docs/phase2/06_CONTENT_FOUNDATION_BRIEF_v2.md` §8.
**Status:** F1 complete. Bulk conversion (F2) HOLDS until Kevin reviews this report and clears CK-A.

This is the F1 deliverable: scaffold the docs-as-code CCM, write the schemas, the resolver, the projections, the validation gate, and prove the round trip on one anchor document. Per the brief, F1 ends with a hard stop before any bulk conversion.

---

## 1. What was built

### `/content/` tree (brief §3.1)

```
/content/
  documents/SOP-002.mdx              <- the sample, faithfully converted
  facts/operational-facts.yaml       <- seed (4 global facts + 1 override-bearing demo)
  components/README.md               <- the `<Fact />` and `<Include />` contracts
  derived/                           <- (empty until generate_derived runs)
  schema/frontmatter.schema.json     <- catalog row + governance + applies_to + obligations + relationships
  schema/facts.schema.json           <- default + override-bearing dimensions + variants
  assets/                            <- (empty for F1)
```

### Build scripts at `/scripts/content/`

| Script | Purpose |
|---|---|
| `resolver.mjs` | Single point: source MDX + context -> resolved text. Override-aware. Flattens for the corpus with heading markers. Per brief §3.7. |
| `project_catalog.mjs` | Frontmatter -> Postgres `documents` + `document_relationships` row shape. Per brief §5. |
| `project_corpus.mjs` | Resolver -> flattened text -> chunker contract. Audience-scoped. Per brief §5 + §6. |
| `validate.mjs` | The merge gate stub. Brief §6 checks (schema, fact resolves, retired-pointer block, `chk_live_complete` extended, number hygiene, heading hierarchy, audience scope; blast radius + staleness + -ES parity stubbed for F1.5). |
| `generate_derived.mjs` | `obligations` -> compliance calendar + cert matrix `.generated.mdx`. Per brief §3.5. |
| `lib/yaml_lite.mjs` | Minimal YAML subset parser. F1 only - swap to js-yaml at F1.5. |
| `lib/frontmatter.mjs` | Extract YAML frontmatter + body from MDX. |
| `run_sample_round_trip.mjs` | The F1 end-to-end driver. |

### Sample doc - SOP-002

Per the brief's suggestion ("SOP-002 or POL-008 are good candidates"), the sample is **SOP-002** because:
- Already Live in production.
- GOOD chunking-readiness per the audit (real `[H1]`/`[H2]` structure - chunked into 190 chunks at 8-doc corpus).
- Carries 4 literal facts that naturally become `<Fact />` tokens (S1 + S2 notification windows, workers comp carrier, policy number).
- Cross-references 8 live docs + 1 retired (TPL-017) - exercises the relationship projection AND the retired-pointer gate check (the audit's CRITICAL #1).

Faithful conversion of the source text. No content changes. No invention.

---

## 2. What the round trip showed

`node scripts/content/run_sample_round_trip.mjs` ran end-to-end, exercising every F1 piece.

### Step 1 - Parse SOP-002.mdx

The YAML-Lite + frontmatter splitter pulled out the 35-field frontmatter cleanly: id, title, doc_class, status, version, card_line, summary, keywords, owner, approver, audience, applies_to, approval block (approved_version + approved_by + approved_date + method), last_reviewed, effective_date, review_interval_months, 9 relationships. Body parsed as 14,463 chars of MDX.

### Step 2 - Override resolution (the most important architectural test)

Demonstrated the resolver under three contexts on three facts:

| Fact | Company-wide | NY-scoped | TX-scoped (no NY/TX override match) |
|---|---|---|---|
| `wc_carrier` (GLOBAL) | "The Hartford" | "The Hartford" | "The Hartford" |
| `s1_notification_window` (GLOBAL) | "15 minutes" | "15 minutes" | "15 minutes" |
| `sick_accrual` (OVERRIDE-BEARING) | "1 hour per 30 worked, up to 40 hours per year **(varies by state)**" | "TBD - counsel confirms NY Earned Safe and Sick Time threshold per employer size" (TBD per facts seed) | "1 hour per 30 worked, up to 40 hours per year" (TX has no override; falls back to floor) |

The brief §3.3 promise plays out exactly: **a contradiction on a load-bearing fact is now structurally impossible**. The fact has one home; its variants are data; the resolver picks the right one given context. The company-wide context never teaches Sous a conditional as universal (it appends the "varies by state" qualifier).

### Step 3 - Substitute Fact tokens in SOP-002 body

4 of 4 `<Fact />` tokens resolved cleanly in SOP-002's body (the 2 notification windows + The Hartford + the policy number). No unresolved tokens. The body is now valid plain prose with the resolved values inline.

### Step 4 - Flatten for the SousAI corpus

Flattening produces 14,509 chars with **13 H1 markers + 21 H2 markers** preserved in the contextual-header format the existing chunker expects (`From: Safety and Incident Management (SOP-002)` header line, then `[H1] ... [H2] ...`). The chunker contract is satisfied.

### Step 5 - Preview chunks

The preview shows **14 H1-bounded chunks**. (The actual chunker `src/lib/sousai/chunk.js` will produce more due to per-H2 subdivision; this is just a preview using the section markers.) For comparison: SOP-002 in production today produces 25 chunks - the F1 contract preserves the structure that produces that count.

### Step 6 - Project catalog row + relationships

The projected `documents` row matches the migration schema (`docs/migrations/pr-7-1-opd-schema.sql`) PLUS new governance columns the F7 schema migration will add: `last_reviewed`, `effective_date`, `review_interval_months`, `approved_version`, `approved_by`, `approved_date`, `approval_method`, `applies_to`, `lang`, `in_corpus`, `translation_of`, `source_version`, `supersedes`.

The 9 `document_relationships` rows include 8 valid edges (POL-001, PB-003, FORM-001, FORM-002, PB-002, SOP-004, REF-001, POST-001) + 1 to TPL-017 (which is RETIRED - intentionally preserved from the source to exercise the gate).

### Step 7 - Validation gate catches the audit's CRITICAL #1

The validator caught the TPL-017 retired-pointer as an **ERROR**:

```
[ERROR] (relationships_retired) relationship -> retired doc 'TPL-017' (audit CRITICAL)
```

This is exactly the audit's CRITICAL #1 (`CRITICAL_SUMMARY.md` §1 row 1) playing out structurally. The one-time audit becomes a permanent guarantee, per brief §6: "you audit once for judgment and actuals. The machine prevents regression on every change after that."

The 9 WARNs are informational (the 8 valid references and the TPL-017 reference all point at docs that do not yet exist in `/content/documents/` because only SOP-002 is converted in F1; these will resolve as docs land in F2).

---

## 3. What this proves and what it does not

### Proves

- The repo-canonical model works end-to-end: source -> resolved -> catalog row + corpus text. **One source, generated projections, no hand-sync.**
- Override resolution works: global facts render verbatim; override-bearing facts pick the most-specific override or fall back to the floor with a qualifier; the corpus never teaches Sous a conditional as universal.
- The audit's findings translate to structural guarantees: the retired-pointer gate catches the audit's CRITICAL #1 automatically. Add the rest of the audit's structural findings as gate checks and the audit never has to run again as judgment work.
- The frontmatter schema covers every field the OPD catalog + the governance + the obligations + the override scope. The shape is real.

### Does NOT prove

- Actual chunking quality at scale (only the contract is shown; the existing chunker still has to run on real bulk content - that is F8).
- DB upsert (F1 produces row shapes; F7 wires the upsert to Supabase).
- Actual embed call (F8).
- Validation at scale (F1 only runs on one doc; F1.5 pilot runs against the currently-live set).
- The derived calendar / matrix (the script exists; F1's sample has no `obligations` in its frontmatter, so derived is empty until F4 populates obligation data).

---

## 4. Honest scope flags (per "no silent scope additions")

### Library choices that need Kevin's review

- **YAML parsing.** F1 ships a minimal regex-based YAML-Lite parser at `scripts/content/lib/yaml_lite.mjs`. It handles the subset we need (mappings, nested objects, inline `{}` / `[]`, lists, ISO dates, quoted strings, comments). It does NOT handle anchors, aliases, multiline scalars (`|`/`>`), tags, or the full YAML 1.2 grammar. **At F1.5 the path is to add `js-yaml` to `package.json` and replace the lite parser**, before bulk conversion exposes edge cases. js-yaml install requires Kevin's package install sign-off per CLAUDE.md.
- **Validation library.** F1 ships hand-rolled validation. F1.5 should add `ajv` to validate against the JSON Schemas directly. Same install permission.
- **MDX parsing.** F1 uses regex on `<Fact />` and `<Include />`. F1.5 should add `@mdx-js/mdx` once the body has richer JSX (nested components, expressions). Same install permission.
- **gray-matter** for frontmatter split. F1 ships hand-rolled (`lib/frontmatter.mjs`); F1.5 should swap.

None of these affect the F1 demo. The F1 brief said "scaffold + ONE sample round trip" - the round trip is real; the parsers are explicitly minimal.

### Things deliberately NOT done at F1

- **Bulk conversion.** Brief §8: "Stop at CK-A. Show Kevin the sample round trip before any bulk conversion (F2). Do not convert the other 55 docs, do not write to the catalog, do not embed, until Kevin reviews the sample." Held.
- **Catalog DB write.** Brief §5: catalog is a generated projection but the script only prints rows. F7 wires the upsert.
- **SousAI embed.** Brief §5: corpus is a generated projection but the script only flattens. F8 wires the chunker + embed.
- **Drive sharing.** Workstream B retired (D-A). No Drive operations in this phase.
- **Audit finding fixes.** Brief: "Do not fix the 86 findings in Word docs. Convert faithfully to MDX first (F2), then fix everything in MDX (F5)." Held - SOP-002 was converted faithfully INCLUDING the retired TPL-017 reference, so the gate could catch it.
- **SOP-015 §03 safety contradiction.** Brief: "held from the corpus and from Live until §03 is reconciled against SOP-008 in MDX." NOT converted in F1. SOP-002 (Live, GOOD) was used instead.
- **The 6 gating decisions Kevin owes** (terminology sweep, AGR-001 version, status mapping, POL-016 GAP, PB-001 §03 fix, ~30-doc tracker reconciliation, SOP-009 forward-ref). Brief: "Do not decide any of these. Surface them at their step." None decided.

---

## 5. Scope confirmations from the brief (in case anything was reinterpreted)

- **Workstream B is retired (D-A).** The MDX conversion IS the load. The Drive-render gate (CK-6) and Drive-sharing batch are not built.
- **Print rendering is next phase (D-E).** F1 does not include a print renderer. The architecture leaves room (resolved HTML -> per-class STD-001 CSS -> WeasyPrint) but does not build it.
- **Intranet view is next phase.** F1 does not include Next.js MDX components at `/playbook`. The `<Fact>` / `<Include>` tokens in source are the same syntax those components will use when they exist.
- **Revise in MDX, not Word (D-B).** All Pass 3 / Pass 4 audit-finding work happens at F5 against the MDX source. The Word docs are read-only from F1 forward.
- **Facts canonical home = repo YAML (D-D).** No facts table in Postgres for F1; if runtime query needs it later, the YAML is the source of truth.
- **-ES same system (D-G).** Schema supports `lang`, `translation_of`, `source_version`. -ES docs ship `in_corpus: false`.
- **Override dimensions = state + account (D-H).** Schema supports both (+ role for future). Demonstrated with state in step 2.
- **Approval evidence required for Live legal docs (D-I).** Validator enforces this on POL + AGR class Live docs.
- **Effective-dating = lightweight + git (D-J).** Schema has `effective_date`; git history answers "what was in effect on date X" without a temporal DB.
- **Staleness 12mo default; shorter for legal POLs (D-K).** Schema default; check runs at F1.5.
- **Authoring UI trigger: ~100 docs or ~8 SME updates/month or second author (D-L).** F1 does not build the authoring UI.

---

## 6. What Kevin reviews at CK-A

1. **The reframe is right.** Repo = canonical; Postgres + Sous = generated projections. Look at the projected `documents` row in Step 6 of the run output - that is what Postgres will hold, generated from `SOP-002.mdx` frontmatter.
2. **Override resolution is right.** Step 2 of the run output. Read the 3 contexts on `sick_accrual`. Confirm the company-wide qualifier ("varies by state") matches what you want Sous to say when an operator does not provide a state hint.
3. **The validation gate catches the audit findings structurally.** Step 7. The retired-pointer ERROR is the audit's CRITICAL #1. Confirm this is the right enforcement model.
4. **The sample doc is faithful.** Open `content/documents/SOP-002.mdx`. The body should read identically to the source Word file minus the 4 `<Fact />` tokens. If you spot drift, that is a conversion bug to fix before F2.
5. **The frontmatter shape is right.** Look at the YAML at the top of `SOP-002.mdx`. Anything missing for the catalog? For governance? For SousAI?
6. **The facts shape is right.** Open `content/facts/operational-facts.yaml`. The override-bearing demo (`sick_accrual`) is the canonical example from brief §3.3. The 4 global facts are seeded from SOP-002's actuals.

---

## 7. After CK-A (next: F1.5 pilot, do not run yet)

Per brief §8 + Phase 2 prompt §7: "After CK-A, the next step is F1.5: the pilot on the currently-live set end to end, stopping at CK-B. Do not run it yet."

F1.5 plan (for visibility only):

- Convert the 7 other currently-live anchors to MDX faithfully: STD-001 v1.1, AGR-001, PB-002, PB-003, FORM-001 (Live), POSTER-001, POST-002.
- Add js-yaml + ajv + gray-matter to package.json (with permission).
- Wire the validator to a Vercel build step.
- Run the resolver + corpus projection over the 8-doc set.
- Run the existing `sousai-embed-corpus.mjs` against the projected text (idempotent re-embed - same content hash = skip).
- Confirm retrieval still passes the 10-question regression in `sousai-retrieval-test.mjs`.
- Stop at CK-B before bulk conversion.

That is the pilot. It de-risks the pattern on the existing Live cohort before F2 bulk conversion of the FLAT-RISK docs.

---

## 8. Run commands

```bash
# Read-only round trip on the sample (the F1 deliverable)
node scripts/content/run_sample_round_trip.mjs

# Validate a single doc (or all docs if no arg)
node scripts/content/validate.mjs content/documents/SOP-002.mdx

# Generate the derived calendar + matrix (empty for F1; runs cleanly)
node scripts/content/generate_derived.mjs
```

---

## 9. Honor roll for F1

- 0 npm installs without permission.
- 0 audit findings fixed in Word.
- 0 catalog writes.
- 0 Drive operations.
- 0 embed calls.
- 0 gating decisions made.
- 1 sample doc, faithfully converted, exercising the full pipeline.
- 1 audit CRITICAL caught structurally by the new gate (TPL-017 retired pointer).
- All scope confirmations from brief §10 honored.
- Hyphens only in source, code, comments, and this report.

F1 ends here. CK-A is a hard stop.
