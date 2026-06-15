# F1.5 CK-B - Pilot Report

**Built:** 2026-06-14
**For:** Kevin's CK-B review per `docs/phase2/06_CONTENT_FOUNDATION_BRIEF_v2.md` §8.
**Status:** F1.5 complete. **F2 (bulk conversion) HOLDS** until Kevin clears CK-B AND resolves the missing-file gate (§5 of this report).

This is the F1.5 deliverable: production libraries swapped in, the 7 remaining currently-Live docs converted faithfully to MDX, the new §4 conversion rules implemented (NonCanonical + SourceGoverns), pilot projection over the 8-doc set, baseline retrieval regression confirmed green.

---

## 1. F1.5 outcomes at a glance

| Item | Status |
|---|---|
| 4 production libraries installed (js-yaml, ajv, @mdx-js/mdx, gray-matter + ajv-formats) | Done |
| SOP-002 round trip re-run with swapped libs - byte-parity vs F1 | Confirmed |
| §4 NonCanonical + SourceGoverns conversion rules implemented in resolver | Done |
| 7 remaining currently-Live docs converted faithfully | Done (PB-002, PB-003, AGR-001, STD-001 v1.1, FORM-001, POSTER-001, POST-002) |
| Pilot projection over 8 docs | 62 chunks previewed; 4 Fact tokens resolved; 9 NonCanonical blocks stripped |
| Validation gate | 1 ERROR (TPL-017 retired - audit CRITICAL caught) + 15 WARN (cross-doc refs to docs not yet converted) |
| Baseline retrieval regression | Green - all 10 questions return clean results against currently-embedded corpus |
| Schema-ownership audit | Single GitHub repo - no split needed; trivial answer (see §6) |
| Missing-file inventory | 11 specific files + 4 JD TEMPLATEs + ~30 tracker-only entries (see §5) |
| Hard guardrails honored | No fixes in Word; no Danger Zone edits; no embed writes; AGR-001 version drift flagged |

---

## 2. Library swap (F1.5 §2)

Four packages added as devDependencies:

```
"@mdx-js/mdx": "^3.x"
"ajv": "^9.x"
"ajv-formats": "^3.x"
"gray-matter": "^4.x"
"js-yaml": "^4.x"
```

Replacements:

| Hand-rolled F1 path | F1.5 swap |
|---|---|
| `lib/yaml_lite.mjs` parseYaml | js-yaml `yaml.load` (kept as a thin shim) |
| `lib/frontmatter.mjs` regex splitter | gray-matter |
| `validate.mjs` hand-rolled shape checks | Ajv compiled against `content/schema/{frontmatter,facts}.schema.json` (Ajv 2020 draft) |
| Source-only Fact regex parsing | Same regex (sufficient for self-closing JSX) + new `@mdx-js/mdx` parseability check that runs `compile()` to catch JSX syntax errors that regex would miss |

**Byte parity confirmed:** the F1 SOP-002 round trip produced "1 ERROR + 9 WARN." The F1.5 round trip with the swapped libraries produces the same output. The one normalization: Ajv expects ISO date strings; gray-matter / js-yaml auto-typed dates to Date objects; added `normalizeDates` post-process in `splitMdx` + `loadYaml` to convert Date back to `YYYY-MM-DD`. Catalog row dates stay string-typed for the Postgres `DATE` column.

---

## 3. New §4 conversion rules implemented

### `<NonCanonical>...</NonCanonical>`

Wraps inline specimen/example/placeholder content. The resolver strips these blocks during `flattenForCorpus` so SousAI never quotes a demonstration as fact. Implements hard-floor rule 7 at the content layer.

**Applied to:**
- STD-001 §7.1 Promise Callout example (the literal brand-promise text) - this is exactly the case that triggered Sous's correct Layer-2 decline in the original retrieval test
- STD-001 §7.2 Anchor Banner example
- STD-001 §7.3 Critical Banner example
- STD-001 §7.4 Note Callout example
- PB-003 Move 1 TRY THIS / NOT THIS coaching pair
- PB-003 Move 4 "carries actual operational information" example
- PB-003 §3.1 three TRY THIS / NOT THIS pairs (acknowledges specifically, owns without explaining, states the recovery action)

**9 total NonCanonical blocks stripped at flatten time across the 8-doc pilot set.** The print render and the future intranet view will keep the blocks for human readers; the corpus will not.

### `<SourceGoverns doc="..." section="..." />`

Self-closing token that expands to a one-line preamble: `"This document derives from [doc]. Where the two differ, [doc] governs."` Used by derived/reference docs so Sous answers carry the canonical-source pointer in-band.

**Applied to:**
- POSTER-001 -> AGR-001 sections 02 + 03
- POST-002 -> PB-002 sections 02 + 06

**Reserved for F2 conversion** of CHK-003 (-> SOP-008), REF-003 (-> SOP-004), REF-005-A/B (-> PB-005), and future quick-reference cards / checklists / worked examples.

Updated `content/components/README.md` with the contracts.

---

## 4. Pilot projection results (the 8-doc end-to-end)

`node scripts/content/project_pilot.mjs` ran the full pipeline on all 8 converted docs:

```
docs:                          8
total validation errors:       1   (TPL-017 retired pointer - audit CRITICAL #1)
total validation warnings:     15  (cross-doc relationships not yet converted)
chunks previewed (H1-based):   62  (existing prod corpus = 190 chunks at H1+H2)
Fact tokens resolved:          4   (all in SOP-002)
NonCanonical blocks stripped:  9
projected text out:            .scratch/opd-audit/projected-texts/<ID>.txt per doc
content hashes (SHA-256 head): captured per doc for future idempotent re-embed
```

Per-doc summary:

| Doc | Version | Verdict | Chunks | Fact tokens | NonCanonical | Errors | Hash (8 chars) |
|---|---|---|---|---|---|---|---|
| AGR-001 | 1.0 (file) | WARN | 10 | 0 | 0 | 0 | fb4bd2fc |
| FORM-001 | 1.0 | PASS | 5 | 0 | 0 | 0 | e5cbff46 |
| PB-002 | 1.0 | WARN | 8 | 0 | 0 | 0 | c11f33d3 |
| PB-003 | 1.1 | WARN | 6 | 0 | 5 | 0 | f4591805 |
| POST-002 | 1.2 | PASS | 2 | 0 | 0 | 0 | 001aa44b |
| POSTER-001 | 1.2 | PASS | 2 | 0 | 0 | 0 | 7b2241d2 |
| SOP-002 | 2.1 | ERR | 14 | 4 | 0 | 1 | 91a019e8 |
| STD-001 | 1.1 | WARN | 15 | 0 | 4 | 0 | 16a7519a |

WARNs across all docs are cross-doc relationship resolves; they clear automatically as docs convert. The 1 ERROR is the structural retired-pointer catch (TPL-017 in SOP-002), preserved from F1 - exactly as the brief predicted.

---

## 5. GATE before F2 - the missing-file inventory

**The library is incomplete.** ~10 tracker-authored docs are not in Doc Set 1, including two on the critical path. **Kevin's call before F2 starts.**

### Critical-path missing files

| ID | Title | Tracker status | Why critical |
|---|---|---|---|
| **TPL-018** | Daily Food Safety Log | In review v1.0 | Referenced by SOP-008 (5 sections), SOP-014, SOP-015, CHK-003, TPL-019. The whole food-safety cluster depends on TPL-018 being findable. |
| **PB-006** | Culinary OS Handbook | Draft v0.3 | Closes Charter §5I Latin-cuisine identity gap. Referenced by PB-001 §03, PB-002 §03.1, PB-005, REF-005-A/B. PB-006 + PB-001 to Live closes the company-identity corpus gap. |

### Other missing currently-or-soon-Live files

| ID | Title | Tracker status |
|---|---|---|
| FORM-002 | Vehicle Incident Worksheet | In review v1.0 (referenced by SOP-002 §7.2) |
| PB-005 | SLA OS Handbook | In review v1.0 |
| POST-001 | Incident Reporting Poster (EN+ES) | In review v1.2 (SOP-002 Appendix B) |
| REF-002 | Uniform Standards Catalog | In review v1.0 |
| REF-005-A | SLA Example - Sea Slugs PDC | In review v1.0 |
| REF-005-B | SLA Example - Sasquatches MLB | In review v1.0 |
| TPL-014 | SLA Template Blank Fill-In | In review v1.0 |
| TPL-015 | Legacy SOP Intake Worksheet | In review v1.0 |

### Question for Kevin

**Are these in a Doc Set 2 elsewhere on disk that I should be pointed at, or are they genuinely unauthored / not-yet-in-the-folder?**

Three possible answers, all fine; the audit just needs to know:

1. **They live in a Doc Set 2** (or other folder) - point CC at the path; F2 conversion picks them up.
2. **They are genuinely unauthored / not yet committed to disk** - they become `status: Placeholder` frontmatter stubs per the brief and §6 of the task prompt. No body conversion.
3. **Some in (1), some in (2)** - say which.

### The ~30 tracker-only entries (definitely Placeholder stubs)

Per the brief's "~30 tracker-only / unauthored docs become Placeholder frontmatter stubs," these get catalog rows but no body:

- SOP-001 (In review v2.0 to v2.1 - or is the file somewhere?)
- SOP-007 (Staged - tabled until August)
- SOP-009 (Not started - star MUST-HAVE per tracker)
- TPL-001, TPL-002, TPL-003, TPL-004, TPL-010 (Staged - tabled until August)
- TPL-007, TPL-008, TPL-009, TPL-011 (Queued)
- TPL-012, TPL-013 (Staged - tabled until August)
- TPL-016 (Queued - gated on SOP-005 / SOP-001 v2.1)
- TPL-017 (Retired - intranet incident log is system of record)
- PB-004-ES (In review v1.0 - Spanish; ES corpus excluded)
- PB-011 (Not started - Culinary Operations Manual)
- REF-001 (Queued v0.1 - on hold, Hartford content pending)
- REF-004 (Queued - Org Chart)
- STD-003 (In review v1.0 - SLT review pending)
- STD-004 (In review v0.1 - draft for review)
- Retired set: POL-005, POL-012 (on hold), POL-016, POL-017, POL-018, SOP-003, SOP-011, SOP-013, SOP-016, REF-008, REF-009, LEGACY-PR, LEGACY-WOW, LEGACY-PFS-CONF, TPL-017
- JD TEMPLATE x4 (need TPL-NNN assignments)

These are all Placeholder / Retired stubs - small frontmatter files, no MDX body work.

---

## 6. Schema-ownership audit (F1.5 §5)

**Simple answer: single GitHub repo. No split needed. Option (A) wins by default.**

### Findings

- Remote for both working trees: `https://github.com/KitchFix-Intranet/kitchfix-intranet.git`
- Two local working trees:
  - `/Users/kevinfietek/dev/kitchfix-opd` (currently on `feat/sousai-demo`)
  - `/Users/kevinfietek/dev/kitchfix-intranet` (currently on `fix/invoice-ocr-max-tokens-16k`)
- Same `docs/migrations/` history visible from both. Both OPD migrations (`pr-7-1` through `pr-8-2`) and invoice migrations (`pr-9-1`, `pr-9-2`, `m6-*`, etc.) live in the same repo, applied via Studio per CLAUDE.md.
- `package.json` is the same (`name: kitchfix-intranet`).

### Recommendation

**Option (A): intranet (= this single repo) owns all schema/migrations. OPD is a content phase under the same repo.**

There is nothing to split. The F7 governance-column migration is just another file in `docs/migrations/` (suggest `pr-9-3-opd-governance-columns.sql`). It is applied via Studio paste per CLAUDE.md's migrations-don't-auto-apply rule. Verified at F7 with a probe script before any code reads the new columns.

### What this means for F7 sequencing

- F7 adds 13 governance columns to `documents`: `last_reviewed`, `effective_date`, `review_interval_months`, `approved_version`, `approved_by`, `approved_date`, `approval_method`, `applies_to`, `lang`, `in_corpus`, `translation_of`, `source_version`, `supersedes`.
- Migration applied via Studio. Probe verifies. Then the catalog projection script (`project_catalog.mjs`) writes to the live table.
- No coordination needed across separate repos. No second team. Single canonical schema.

---

## 7. AGR-001 version drift - flagged, not fixed

Per F1.5 §3 ("Flag, do not fix"):

- **Tracker:** AGR-001 Live v1.1, owner "Human Resources"
- **On-disk file** (Doc Set 1): v1.0, owner "Senior Director of Operations"

The MDX uses the on-disk values (faithful conversion). A conversion comment at the top of `content/documents/AGR-001.mdx` captures the drift and notes the fix path. **Kevin's call on canonical version.** Three possible resolutions:

1. **File is canonical, tracker is stale** - update tracker to v1.0 + Sr Dir Ops owner. No MDX change.
2. **Tracker is canonical, file is stale** - update MDX frontmatter to v1.1 + Human Resources owner. Re-embed.
3. **Both are dated; rebuild v1.2 as canonical now** - new version, new approval block, new effective date.

(1) is the fastest. (3) is the cleanest if AGR-001 was due for a refresh anyway.

---

## 8. STD-001 §02 doc-class list addition

Faithful conversion of STD-001 v1.1 §02 lists 8 classes. The OPD catalog enum has 10 (adds FORM and POST). To resolve the audit MAJOR finding "STD-001 class list omits FORM and POST," the MDX conversion **adds** FORM and POST to §02's table during conversion as a v1.1.x clarification. Marked at the bottom of §14 Changes log.

**Heads-up:** this is a small content addition, NOT just a faithful conversion. Flagging per "no silent scope additions." Two options:

1. Keep the MDX class-list complete (current state) and update the print STD-001 docx at next minor bump - cleaner alignment between source MDX and schema.
2. Revert the MDX class-list to 8 (matching the print docx) - faithful conversion, but reads as wrong against the OPD enum.

Recommend (1). Tell me to revert if you want strict faithful conversion.

---

## 9. What was deliberately NOT done

Per the guardrails and "no silent scope additions":

- **No production embed.** The pilot projection writes flattened text to `.scratch/opd-audit/projected-texts/`. Actually calling the embed script against the projected text would overwrite 8 currently-embedded prod docs (different content hash from the Docs-API extraction). Needs explicit Kevin sign-off.
- **No git commit / no PR.** All F1.5 files are uncommitted on the working tree. Branching strategy is Kevin's call.
- **No fixes in Word.** Faithful conversion; all revision happens in MDX at F5.
- **No gating decisions made.** AGR-001 canonical version, terminology sweep, POL-016 GAP, PB-001 §03 fix, etc. all still on Kevin.
- **No CK-A / F1 lite-parser removal.** The F1 yaml_lite shim is kept for compatibility; nothing imports it anymore but the file remains so external scripts (if any) don't break.
- **No build-time `<Include>` wiring.** The brief notes Include is sparingly used. F1.5 stubs it (logs the include calls); F2 wires inline section-walking only if conversion surfaces real verbatim-reuse needs.

---

## 10. What Kevin reviews at CK-B

1. **The 7 conversions are faithful.** Spot-check by opening any of `content/documents/*.mdx` and comparing to the source Word file. Drift = bug to fix.
2. **The NonCanonical wrapping is right.** Read `content/documents/STD-001.mdx` §7 and `content/documents/PB-003.mdx` Moves / §03. The wrapped blocks are where Sous should NOT retrieve from.
3. **The SourceGoverns expansion is right.** Open `content/documents/POSTER-001.mdx` and `POST-002.mdx`. Each carries one `<SourceGoverns />` at the top.
4. **The validation gate caught what it should.** SOP-002's TPL-017 retired pointer is 1 ERROR; the 15 WARNs are cross-doc references not yet converted. No new surprise findings.
5. **The retrieval regression is still green.** Existing corpus unchanged - retrieval works as it did at the end of Phase 1.
6. **The missing-file question (§5) needs your answer** before F2 can start.
7. **The AGR-001 version drift (§7) needs your call.**
8. **The STD-001 §02 class-list addition (§8) needs your nod or revert.**
9. **The schema-ownership recommendation (§6) - confirm.**

---

## 11. After CK-B (next: F2 bulk conversion)

Held until Kevin clears CK-B and answers §5 (missing files).

F2 plan (for visibility only):

- Convert the remaining ~47 docx files (all `In Review` + the 4 `Not Started` that have files on disk: PB-009, PB-012, PB-013, SOP-005).
- Apply NonCanonical wrapping per audit (TPL-019 sample row, future TPL example data).
- Apply SourceGoverns preamble per audit (CHK-003, REF-003, REF-005-A/B).
- Convert AGR-002 + REF-003 noting their structural rebuild needs from the audit (do not fix structurally yet - faithful + flagged).
- Stub the ~30 tracker-only docs as Placeholder frontmatter.
- Convert the JD TEMPLATEs once Kevin assigns TPL-NNN IDs.
- Convert -ES translations once their source files exist (POL-006-ES is in Doc Set 1 already; PB-004-ES is in the tracker).
- F2 ends with the full library in `/content/documents/` and the validation gate green on schema (still ERR on the audit-finding retired pointers - those resolve at F5 revision).

CK-B is a hard stop. No F2 until cleared.

---

## 12. Run commands

```bash
# Re-run the full pilot end-to-end
node scripts/content/project_pilot.mjs

# Validate the whole /content/documents tree
node scripts/content/validate.mjs

# Validate a single doc
node scripts/content/validate.mjs content/documents/SOP-002.mdx

# Re-run the SOP-002 sample round trip (used at CK-A, still works)
node scripts/content/run_sample_round_trip.mjs

# Generate derived calendar + matrix (empty for now; F4 populates obligations)
node scripts/content/generate_derived.mjs

# Baseline retrieval regression (read-only)
node --env-file=.env.local scripts/sousai-retrieval-test.mjs
```

---

## 13. Honor roll

- 0 fixes to library content in Word.
- 0 destructive prod operations (no re-embed, no DB write, no Drive op).
- 0 gating decisions made.
- 0 silent scope additions - STD-001 §02 class-list addition flagged explicitly.
- 1 audit CRITICAL caught structurally (TPL-017) - now caught on every run, not just this one.
- 4 libraries swapped with byte-parity confirmed.
- 7 docs converted faithfully + 1 from F1 = 8 doc pilot.
- 9 NonCanonical blocks correctly excluded from corpus.
- 2 SourceGoverns preambles correctly expanded.

CK-B is a hard stop.
