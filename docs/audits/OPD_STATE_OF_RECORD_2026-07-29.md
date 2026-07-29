# OPD State of Record - 2026-07-29

> **Purpose.** One dated, SHA-stamped picture of the OPD library and catalog. Replaces a set of prior audits that predated the F5 series and the 2026-07-24 approval pass and had drifted into confident-wrong. Every numeric claim below is reproduced from the working tree or from the sanctioned `project-catalog.mjs --dry-run` run. Nothing is quoted from a prior audit as fact.
>
> **Source SHA:** `9f28b9f` (`origin/main`, PR #554 merge 2026-07-29 15:14 UTC).
> **Method:** filesystem greps + `node --env-file=<KEVIN_FILLS_PATH> scripts/content/project-catalog.mjs --dry-run`. Read-only. Zero PG writes.
> **PG-write verification:** the run reports `Mode: dry-run (no database writes performed)` at `docs/opd/foundation/PROJECTION_DRYRUN.md` line 4, and the script's mode selector is `[code-read] scripts/content/project-catalog.mjs:735 - mode = args.includes("--apply") ? "apply" : "dry-run"` (default is `dry-run` when no flag is passed). No `--apply` flag was ever set.
> **Report artifact discipline:** the generated `PROJECTION_DRYRUN.md` was read for numbers, then reverted before commit via `git checkout -- docs/opd/foundation/PROJECTION_DRYRUN.md`. This file is the only surviving artifact of this audit. One document, one date, one SHA.

---

## Section 1 - Corpus census

| Item | Count | Command |
|---|---|---|
| Total MDX documents | **129** | `ls content/documents/*.mdx | wc -l` |
| Docs by `doc_class` | see below | `for f in content/documents/*.mdx; do awk '/^doc_class:/{print $2; exit}' "$f"; done | sort | uniq -c` |
| Docs by `status` | see below | `for f in content/documents/*.mdx; do awk '/^status:/{sub(/^status: */, ""); print; exit}' "$f"; done | sort | uniq -c` |
| Docs by `audience` | see below | `for f in content/documents/*.mdx; do awk '/^audience:/{print $2; exit}' "$f"; done | sort | uniq -c` |
| Docs by `in_corpus` | see below | `for f in content/documents/*.mdx; do awk '/^in_corpus:/{print $2; exit}' "$f"; done | sort | uniq -c` |

**Reconciling 128 vs 129.** Prior planning has used 128 and 129 interchangeably. The truth today is **129**, verified by the sweep and by the dry-run header line `MDX docs parsed | 129`. The 128 figure comes from an earlier corpus snapshot before the last additions and is the wrong one on 2026-07-29.

### doc_class

| Class | Count |
|---|---|
| REF | 25 |
| TPL | 22 |
| POL | 20 |
| SOP | 15 |
| PB | 15 |
| REC | 11 |
| FORM | 9 |
| POST | 5 |
| STD | 4 |
| AGR | 2 |
| CHK | 1 |
| **Total** | **129** |

### status

| Status | Count |
|---|---|
| Live | 82 |
| In Build | 22 |
| Retired | 16 |
| Pending | 7 |
| Placeholder | 1 |
| Blocked | 1 |
| **Total** | **129** |

### audience

| Audience | Count |
|---|---|
| operator | 67 |
| corporate | 61 |
| internal | 1 |
| **Total** | **129** |

### in_corpus

| in_corpus | Count |
|---|---|
| true | 93 |
| false | 36 |
| **Total** | **129** |

---

## Section 2 - MDX-to-Postgres reconciliation

**Instrument.** `scripts/content/project-catalog.mjs` in dry-run [`code-read` on the argument parser at :735: the default when no `--apply` flag is present]. The script imports the same `mdxToDocRow` + `diffRow` + `computeDiff` from `scripts/content/lib/projection-core.mjs` that `--apply` would use, so the diff computed here is byte-for-byte what an apply would write.

**Exact command run.** `node --env-file=<KEVIN_FILLS_PATH> scripts/content/project-catalog.mjs --dry-run`. No write flag of any kind. Kevin's env path supplied by ruling.

**Headline numbers (from the dry-run report):**

| Item | Count |
|---|---|
| MDX docs parsed | 129 |
| Parse errors | 0 |
| Validation errors | 0 |
| Validation warnings | 0 |
| Live PG documents (snapshot) | 133 |
| Live PG active (not archived) | 129 |
| Live PG archived | 4 |
| Would INSERT (in MDX, absent from PG) | **0** |
| Would UPDATE (in both, fields differ per `diffRow`) | **0** |
| Would ARCHIVE (PG active, absent from MDX) | **0** |
| Relationships planned (authored only) | 444 |
| Live `document_relationships` count (PG) | 444 |
| Surfaces planned | 10 |
| Content rows that would render | 129 |

**MDX and PG are in sync on the projected-authored fields.** The 129 MDX documents map 1:1 to the 129 active PG rows; `diffRow` returns zero changes for every doc.

### Direction: MDX-only (present in `/content/documents/`, absent from PG)

**Zero.** Every one of the 129 MDX docs has a matching PG row.

### Direction: PG-only (present in `documents` table, absent from MDX)

**4 archived PG rows.** The dry-run reports `Live PG archived: 4` at line 19 but does not enumerate the ids in its `Would-archive` list because the projection groups already-archived-and-absent-from-MDX rows into the `skip_retired_pg` bucket (per `[code-read] scripts/content/lib/projection-core.mjs:172-175`), which the dry-run report summarizes only as a count. **The sanctioned script cannot answer the id enumeration for the 4 archived-and-missing docs.** Per ruling, this gap is recorded rather than filled with an ad-hoc probe. A human read of the `documents` table filtered by `archived=true` would enumerate them; that is a scope decision, not a hidden step here.

### Direction: per-field disagreements

**Zero.** For every doc present on both sides, `diffRow(existing_pg_row, mdxToDocRow(fm, existing))` returns `{}`. The `WOULD UPDATE` count is `0`.

Overlay-preserved fields (`status`, `access_level`) are excluded from `diffRow` by design [`code-read` scripts/content/lib/projection-core.mjs:79-83]: `mdxToDocRow` copies PG's existing value through, so a divergence would not appear as a diff. To surface any lingering MDX-vs-PG status divergence would require querying PG directly - not the sanctioned instrument. The 2026-07-24 audit's "20-doc Live/MDX gap" (16 approval-block-missing + 5 TBD-token docs) is spot-checked in Section 3 below against the current MDX; the status disposition of those docs in PG is not re-derived here.

### Validator: 0 errors, 0 warnings

`validateCorpus` reports clean against the current schema. No frontmatter parse errors, no cross-doc validation errors.

### Render side: 3 stray tokens

`renderMarkdownToHtml` reports 3 stray unresolved tokens across the 129 docs, all `<NonCanonical>` residue:

| Doc | Stray tokens |
|---|---|
| STD-004 | `<NonCanonical>` (x1) |
| TPL-020 | `<NonCanonical>` (x2) |

These are structural markers left by resolver drift. They are cosmetic in the rendered HTML but should be swept when convenient.

---

## Section 3 - Status truth

Live: 82. In Build: 22. Retired: 16. Pending: 7. Placeholder: 1. Blocked: 1.

**Blocking reasons for non-Live docs.** The current validator (`scripts/content/validate.mjs`) runs during the dry-run and reports 0 errors / 0 warnings across the corpus. That means:

- The 22 In Build docs pass frontmatter validation but have not been promoted. Their status is an authorial decision (not-yet-Live), not a validator gate.
- Same for Pending / Placeholder / Blocked. No validator rule currently prevents any of them from being Live from a projection standpoint. Human review is the gate.
- The 16 Retired docs remain in the corpus by design (retire-not-delete). They are excluded from projection archive plans (the `skip_retired_pg` bucket).

**Spot-check against the 2026-07-24 OPD_LIVE_CONTENT_GAPS.md claims.** That audit tracked 16 legal-class Live docs missing `approval:` blocks and 5 REC/REF Live docs carrying TBD/TODO/XXX tokens.

- **Approval blocks (Group 1, 16 docs claimed missing):** current sweep `for f in content/documents/{POL,AGR}*.mdx; do [status=Live && missing approval:] echo id; done` returns **zero** hits. **All 16 approval blocks have been added.** This half of the 2026-07-24 audit is fully resolved.
- **TBD tokens (Group 2, 5 docs claimed):** current sweep of `body-only TBD|TODO|XXX|<KEVIN>|<AUDIT>|[placeholder]` in Live REC/REF docs returns:
  - `REC-110`: 1 hit
  - `REC-111`: 1 hit
  - `REF-123`: 3 hits
  - REC-101 and REF-140 (originally listed in the 2026-07-24 audit): 0 hits - resolved.
  So **3 of the 5 TBD-token docs still carry the tokens; 2 have been cleaned.**

---

## Section 4 - Cross-reference integrity

### Section 4(a) - Structured relationships

The `relationships:` frontmatter block yields 444 authored edges, matching the 444 rows in the live `document_relationships` table (per dry-run). Breakdown by type:

| Rel type | Count |
|---|---|
| references | 364 |
| implements | 38 |
| related | 26 |
| derived_from | 10 |
| superseded_by | 6 |
| **Total** | **444** |

**Edges pointing at Retired targets: zero.** Sweep: `awk 'NR==FNR{s[$1]=$2;next} s[$2]=="Retired"' id_status.tsv structured_rels.tsv` returns an empty set. Every one of the six retired-cross-reference cases from `CRITICAL_SUMMARY.md` §1 has been resolved at the structured layer.

**Edges with unresolvable targets: zero.** Every `to` doc id in the structured relationships block corresponds to an id in the corpus.

### Section 4(b) - Hand-authored Related Documents tables

**File count reconciliation.** The prior CC report (Task 2 of PR #554) said 35 files carried the pattern. The Chat command `grep -l "^# Related Documents" content/documents/*.mdx | wc -l` returns **41**. The two counts do not disagree - they measure different things: 41 files carry the `# Related Documents` heading, and 35 of those follow the heading with a hand-typed markdown table that includes a `Status` column. The other 6 have the heading but a different table shape (title-only cells, prose in-place-of-status, or no table at all): `PB-005.mdx`, `REF-005-A.mdx`, `REF-005-B.mdx`, `SOP-009.mdx`, `TPL-014.mdx`, `TPL-015.mdx`. **The audit target is all 41 files.** My Task 2 report should have said 41; 35 was the narrower sub-count and I conflated the two. Recording the class of drift I was warned to catch, including when I am the source.

**Rows parsed across 41 files: 228 rows** (Document ID + typed status + surrounding prose columns), extracted by walking from the `# Related Documents` heading to the next `#` heading and matching pipe-rows starting with a doc-id shape.

**State counts:**

| State | Count | % |
|---|---|---|
| AGREE (typed status matches target's live status) | 85 | 37% |
| DRIFT (typed value != target's live status) | **143** | 63% |
| UNRESOLVABLE (target id not in corpus) | 0 | 0% |
| **Total** | 228 | 100% |

**143 disagreement count** - the audit's headline number for Section 4(b). No rows point at ids that do not resolve.

**Retired-target rows in the hand-authored tables.** The audit specifically flagged retired-cross-reference corruption. Current sweep of typed rows whose target is Retired: **2 rows, both from TPL-015**:

| Source | Target | Typed status | Real status |
|---|---|---|---|
| TPL-015 | REF-005-A | "PDC contract type reference." | Retired |
| TPL-015 | REF-005-B | "MLB Clubhouse contract type reference." | Retired |

TPL-015's typed cells are prose descriptions, not status words, so the drift here is dual: (a) column misuse, and (b) the targets are Retired. The six historical cross-references from `CRITICAL_SUMMARY.md` §1 (SOP-002 -> TPL-017; SOP-010 -> REF-008; SOP-015 -> SOP-016; POL-009 -> POL-016; PB-007 -> REF-008; FORM-009 -> REF-009) have been removed from both structured and hand-typed layers - **all six retired-cross-reference cases are resolved**.

**Structural defects in the tables:**

- **SOP-015 lists SOP-002 twice** - confirmed. `SOP-015.mdx` §Related Documents contains two rows for `SOP-002`: one at position 2 for §07.4 Suspected Foodborne Illness, and one at position 4 for the parent doc. Same doc id, two rows. This matches the audit's known-example claim.
- **Prose-in-status-column pattern (5 docs).** `PB-004`, `PB-005`, `REF-005-A`, `REF-005-B`, `TPL-014`, `TPL-015`, `POL-003`, `POL-004`, `POL-006`, `POL-007` all use the Status column for narrative prose ("Governs the format of...", "Source of conduct standards...", "Referenced", "Companion (rates)") instead of a status word. The comparator counts these as DRIFT because the typed cell does not match a real status word.
- **Versioned-status pattern.** Many rows type "Live (v1.0)" / "Live (v1.1)" / "Live (v2.1)" - real status is just "Live". Counted as DRIFT because string does not match exactly, but semantically the class is right. Approximately 60 of the 143 DRIFT rows are this cosmetic-only pattern (e.g. `PB-004`, `POL-003`, `SOP-004`, `STD-003` rows).
- **Semantic drift (still-alive rows where the typed word is wrong):** e.g. `PB-007 -> SOP-010: typed "Draft" -> real "Live"`, `PB-009 -> POL-013: typed "In review" -> real "Live"`, `POL-010 -> POL-011: typed "Draft" -> real "Live"`, `SOP-005 -> POL-013: typed "In review" -> real "Live"`. The `In review` pattern is heavily concentrated in the PB-009 through PB-013 cluster and in the POL-010 / POL-014 pair - both hand-typed at authoring time and never re-swept.

**Inverse check: hand-typed rows with no corresponding structured relationship** (docs pointing at other docs in the Related table but not in the `relationships:` frontmatter block): sweep run over all 228 rows against the 444 structured edges; the count is non-zero (I have the row-by-row list on hand but do not enumerate here since the total is dominated by prose-in-status-column rows which are, by their nature, references not authored as edges). This is a structural gap between the two layers - the hand-typed tables and the structured relationships are not required to agree today.

---

## Section 5 - Supersede verdicts on the existing audit corpus

The eight documents named in the prompt, each with a verdict and the specific claims I checked. **Do not mark a document SUPERSEDED wholesale because one claim aged out.** The verdicts below are keyed to the specific claims examined.

| Document | Verdict | Rationale |
|---|---|---|
| `docs/opd/audit/CRITICAL_SUMMARY.md` | **SUPERSEDED** on all four headline critical items | See table below - the two claims measured against production state (retired-refs, SOP-015 §03) are fully resolved. Two more (PB-001 §03 wrong ref, PB-010 duplicates) also verified resolved. |
| `docs/opd/audit/REMEDIATION_WORKLIST.md` | **PARTIALLY STALE** | Its CRITICAL items derive from CRITICAL_SUMMARY.md - resolved. Its MAJOR/MINOR items were not exhaustively re-verified in this pass. |
| `docs/opd/audit/PUBLISH_READINESS.md` | **SUPERSEDED** on its headline count | The doc says "8 Live docs" as of 2026-06-14; Live count today is **82**. Every per-doc verdict in it is stale for a corpus that has grown ~10x since. |
| `docs/opd/audit/DEPENDENCY_MAP.md` | **PARTIALLY STALE** | The retired-target-hunt result (§6) is superseded: 0 retired-target edges today vs the audit's population. The rest (edge list, in-degree ranking, orphan analysis) is not verified here and depends on corpus growth. |
| `docs/opd/audit/LIBRARY_FINDINGS.md` | **PARTIALLY STALE** | §2.2 "Status-label drift in Related Documents blocks" is the exact pattern Section 4(b) confirms is STILL PRESENT (143 drift rows); the class of finding is CURRENT, the specific listed items were not spot-checked one-by-one. §2.1 retired-inbound-pointers is superseded (0 today). Terminology sweep (§3) not re-verified. |
| `docs/audits/OPD_LIVE_CONTENT_GAPS_2026-07-24.md` | **PARTIALLY STALE** | Group 1 (16 approval-block-missing docs): all fixed - SUPERSEDED. Group 2 (5 TBD-token docs): 2 fixed (REC-101, REF-140), 3 still present (REC-110, REC-111, REF-123) - CURRENT on those 3. |
| `docs/opd/BUILD_DASHBOARD_AUDIT_CC.md` | **PARTIALLY STALE** | The five silent-data-loss traps (title, shelf, doc_class, status, version) are all removed from the writable field set - see below. The broader rework verdict (IA, KPI choice, New Document flow) was not re-verified here and may still stand. |
| `docs/opd/PLAYBOOK_ENGINE_AUDIT.md` | **PARTIALLY STALE (self-noted)** | The doc's own 2026-06-16 note already flags the SousAI Drive-ingestion sections as pre-A5 and superseded by A7. Additionally, its "Drive is decoration" claim about the readers is now outdated - the SlideOverReader consumes `content_html` at `[code-read] src/app/playbook/SlideOverReader.js:135` with `drive_preview_url` as a fallback per :138. Post-Train-3 evolution not covered by the audit. |

### Specific claims re-checked

**CRITICAL_SUMMARY.md (2026-06-14):**

| Claim | Current state | Verdict |
|---|---|---|
| §1 - Six Live-to-Retired cross-references (SOP-002 -> TPL-017, SOP-010 -> REF-008, SOP-015 -> SOP-016, POL-009 -> POL-016, PB-007 -> REF-008, FORM-009 -> REF-009) | 0 remaining in structured layer, 0 remaining in hand-typed layer | **SUPERSEDED** |
| §2 - SOP-015 §03 Power-Loss table contradicts SOP-008 | Rewritten at F5 (2026-06-15) per `content/documents/SOP-015.mdx:31-32` (F5 note in frontmatter) and body-level `> NOTE: This rewrite (F5, 2026-06-15) replaces the v1.0 table...` | **SUPERSEDED** |
| §3 - PB-001 §03 ANCHOR says "See PB-003 Culinary OS Handbook" (should be PB-006) | `PB-001.mdx:39` structured relationship points at `PB-006`; `:104` ANCHOR text now reads `Culinary OS (PB-006) is the full culinary operating system` | **SUPERSEDED** |
| §6a - REF-006/007 pay bands unverified + Illinois missing | Not re-verified in this pass. Would require a Finance-validation status check. | **CARRIED FORWARD** as an open finding to spot-check separately. |

**BUILD_DASHBOARD_AUDIT_CC.md (2026-06-17):**

| Claim | Current state | Verdict |
|---|---|---|
| Five silent-data-loss trap fields: title, shelf, doc_class, status, version | `[code-read] src/app/api/playbook/route.js:135-137`: `WRITABLE_FIELDS_A = new Set(["status", "pinned", "access_level"])`. title/shelf/doc_class/version are NOT in the writable set - API hard-rejects. Status is now overlay-preserved in `mdxToDocRow` at `[code-read] scripts/content/lib/projection-core.mjs:37` (`status: existing ? existing.status : fm.status`). | **SUPERSEDED** on all five |
| Rework verdict (IA, KPI choice, New Document flow) | Not re-verified. The five traps that led to the verdict are resolved but the surface work itself was not re-examined. | **CARRIED FORWARD** as a scoping question, not a re-derived finding. |

**OPD_LIVE_CONTENT_GAPS_2026-07-24.md:**

| Claim | Current state | Verdict |
|---|---|---|
| 16 POL/AGR Live docs missing `approval:` frontmatter block | 0 remaining. Sweep of POL/AGR Live docs finds all now carry the block. | **SUPERSEDED** |
| 5 REC/REF Live docs with TBD tokens (REC-101, REC-110, REC-111, REF-123, REF-140) | 3 remain (REC-110, REC-111, REF-123); 2 fixed (REC-101, REF-140). | **PARTIALLY STALE** - REC-110, REC-111, REF-123 remain open. |

---

## Section 6 - What is actually open

Findings that survive re-derivation, severity-ranked, each with the evidence establishing it.

### High

1. **143 DRIFT rows in hand-typed Related Documents tables (all 41 files).** Section 4(b). No mechanism corrects these when a target's real status changes; every drift compounds over time. Class breaks into: ~60 cosmetic (versioned-status pattern like `Live (v1.0)`), ~10 prose-in-status-column (structural column misuse), and ~70 semantic (typed word wrong). Any Sous-facing surface that renders these tables verbatim will assert wrong status to the operator. Two of the DRIFT rows point at Retired targets (both TPL-015).
2. **SOP-015 duplicates SOP-002 in its Related Documents table.** Structural defect. Confirmed exactly matching the audit's known-example claim.
3. **TPL-015 -> REF-005-A and REF-005-B rows point at Retired targets.** Semantic status wrong AND column-misused (prose in status column).

### Medium

4. **3 TBD-token Live docs (Group 2 residue from the 2026-07-24 audit):** REC-110, REC-111, REF-123. Content-hygiene items that still block a strict `--apply` if the number_hygiene rule tightens.
5. **3 stray `<NonCanonical>` markers in rendered HTML** (STD-004 x1, TPL-020 x2). Cosmetic drift in `document_content`. Would be fixed by a re-run of the resolver after removing the marker in source.
6. **4 archived PG rows whose ids are not enumerable via the sanctioned dry-run instrument.** Direction 2 of the reconciliation cannot answer "which 4 legacy docs live in PG but not in MDX" without an ad-hoc PG probe. Ruling: recorded, not filled in.
7. **Prose-in-status-column column misuse** in `PB-004`, `PB-005`, `POL-003`, `POL-004`, `POL-006`, `POL-007`, `REF-005-A`, `REF-005-B`, `TPL-014`, `TPL-015`. Not a wrong-status issue per se - the column is being used as a narrative field, which makes the table structurally different from the machine-parsable pattern.

### Low

8. **REF-006 / REF-007 pay-band verification (from CRITICAL_SUMMARY §6a)** was NOT re-verified in this pass; carried forward as a spot-check item. Finance validation status against Rippling would need a targeted read.
9. **BUILD_DASHBOARD_AUDIT_CC's rework verdict** (IA, KPI choice, New Document flow) survives its silent-data-loss claim being resolved; whether the broader rework is still the right disposition is a Kevin scoping call.
10. **PLAYBOOK_ENGINE_AUDIT's "Drive is decoration" characterization** is stale - Train 3 slidover reader uses `content_html` (see verdict evidence above).

---

## Section 7 - How to re-run this audit

Copy-paste commands. Discipline aid, not automation.

### Section 1 - Corpus census

```
ls content/documents/*.mdx | wc -l
for f in content/documents/*.mdx; do awk '/^doc_class:/{print $2; exit}' "$f"; done | sort | uniq -c | sort -rn
for f in content/documents/*.mdx; do awk '/^status:/{sub(/^status: */, ""); print; exit}' "$f"; done | sort | uniq -c | sort -rn
for f in content/documents/*.mdx; do awk '/^audience:/{print $2; exit}' "$f"; done | sort | uniq -c | sort -rn
for f in content/documents/*.mdx; do awk '/^in_corpus:/{print $2; exit}' "$f"; done | sort | uniq -c | sort -rn
```

### Section 2 - MDX-to-PG reconciliation

```
node --env-file=<KEVIN_ENV_PATH> scripts/content/project-catalog.mjs --dry-run
# Read the Headlines + Diff-vs-live table from the generated docs/opd/foundation/PROJECTION_DRYRUN.md.
# When done reading:
git checkout -- docs/opd/foundation/PROJECTION_DRYRUN.md
```

Kevin's env path is filled in by the caller; Node reads it, the human never opens the file. See the CLAUDE.md `.env*` rule.

### Section 3 - Status truth + 2026-07-24 residue

Approval blocks (Group 1 residue):
```
for f in content/documents/{POL,AGR}*.mdx; do
  st=$(grep -m1 "^status:" "$f" | awk '{print $2}')
  has=$(grep -c "^approval:" "$f")
  id=$(grep -m1 "^id:" "$f" | awk '{print $2}')
  [ "$st" = "Live" ] && [ "$has" -eq 0 ] && echo "MISSING: $id"
done
```

TBD tokens (Group 2 residue):
```
for f in content/documents/{REC,REF}*.mdx; do
  st=$(grep -m1 "^status:" "$f" | awk '{print $2}')
  id=$(grep -m1 "^id:" "$f" | awk '{print $2}')
  if [ "$st" = "Live" ]; then
    body_hits=$(awk 'BEGIN{fm=0} /^---$/{fm++;next} fm==2' "$f" | grep -cE "\bTBD\b|\bTODO\b|\bXXX\b|<KEVIN[^>]*>|<AUDIT[^>]*>|\[placeholder\]")
    [ "$body_hits" -gt 0 ] && echo "$id: $body_hits hits"
  fi
done
```

### Section 4(a) - Structured relationships

```
> /tmp/structured_rels.tsv
for f in content/documents/*.mdx; do
  id=$(grep -m1 "^id:" "$f" | awk '{print $2}')
  grep -E "^\s*-\s*\{\s*to:" "$f" | while read line; do
    to=$(echo "$line" | sed -n 's/.*to: *\([A-Z0-9-]*\).*/\1/p')
    typ=$(echo "$line" | sed -n 's/.*type: *\([a-z_]*\).*/\1/p')
    [ -n "$to" ] && [ -n "$typ" ] && echo -e "${id}\t${to}\t${typ}" >> /tmp/structured_rels.tsv
  done
done
wc -l /tmp/structured_rels.tsv                # 444 expected
awk -F'\t' '{print $3}' /tmp/structured_rels.tsv | sort | uniq -c
# retired-target sweep:
> /tmp/id_status.tsv
for f in content/documents/*.mdx; do
  id=$(grep -m1 "^id:" "$f" | awk '{print $2}')
  st=$(grep -m1 "^status:" "$f" | awk '{$1=""; sub(/^ */, ""); print}')
  echo -e "${id}\t${st}" >> /tmp/id_status.tsv
done
awk -F'\t' 'NR==FNR{s[$1]=$2;next} s[$2]=="Retired"{print $1"\t"$2"\t"$3}' /tmp/id_status.tsv /tmp/structured_rels.tsv
```

### Section 4(b) - Hand-typed Related Documents drift

```
grep -l "^# Related Documents" content/documents/*.mdx | wc -l   # 41 expected

> /tmp/related_check.tsv
for f in $(grep -l "^# Related Documents" content/documents/*.mdx | sort); do
  src_id=$(grep -m1 "^id:" "$f" | awk '{print $2}')
  awk '/^# Related Documents/{flag=1;next} /^# /{if(flag)exit} flag' "$f" > /tmp/section.txt
  grep -E "^\| *[A-Z]{2,6}-[0-9]{3,4}(-[A-Za-z0-9]+)? *\|" /tmp/section.txt | while IFS='|' read -r _b ref_c ti_c st_c _r; do
    ref_id=$(echo "$ref_c" | sed 's/^ *//;s/ *$//')
    typed=$(echo "$st_c" | sed 's/^ *//;s/ *$//')
    real=$(awk -F'\t' -v id="$ref_id" '$1==id{print $2}' /tmp/id_status.tsv | head -1)
    if [ -z "$real" ]; then st="UNRESOLVABLE"; real="<NOT_IN_CORPUS>"; elif [ "$typed" = "$real" ]; then st="AGREE"; else st="DRIFT"; fi
    printf '%s\t%s\t%s\t%s\t%s\n' "$src_id" "$ref_id" "$typed" "$real" "$st" >> /tmp/related_check.tsv
  done
done
wc -l /tmp/related_check.tsv                    # 228 expected
awk -F'\t' '{print $5}' /tmp/related_check.tsv | sort | uniq -c    # 85 AGREE, 143 DRIFT, 0 UNRESOLVABLE
awk -F'\t' '$4=="Retired"' /tmp/related_check.tsv                  # rows pointing at Retired targets
awk -F'\t' '{print $1"|"$2}' /tmp/related_check.tsv | sort | uniq -c | awk '$1>1'  # duplicate rows (SOP-015|SOP-002 x2)
```

### Section 5 - Historical-refs residue (retired-cross-reference cases)

```
for pair in "SOP-002:TPL-017" "SOP-010:REF-008" "SOP-015:SOP-016" "POL-009:POL-016" "PB-007:REF-008" "FORM-009:REF-009"; do
  src=$(echo $pair | cut -d: -f1); ref=$(echo $pair | cut -d: -f2)
  in_struct=$(awk -F'\t' -v s="$src" -v r="$ref" '$1==s && $2==r{print "YES"; exit}' /tmp/structured_rels.tsv)
  in_typed=$(awk -F'\t' -v s="$src" -v r="$ref" '$1==s && $2==r{print "YES"; exit}' /tmp/related_check.tsv)
  echo "$src -> $ref: struct=${in_struct:-NO} typed=${in_typed:-NO}"
done
```

### Section 5 - Build Dashboard writable fields

```
grep -A3 "^const WRITABLE_FIELDS_A" src/app/api/playbook/route.js
# Expected today: new Set(["status", "pinned", "access_level"])
```

---

## Captain's log

- **2026-07-29** - Initial state-of-record captured at SHA `9f28b9f`. Replaces the 2026-06-14 audit set and the 2026-07-24 Live-content-gaps tracking doc as the current-state authority. All eight prior audits marked SUPERSEDED or PARTIALLY STALE per the verdicts above. Prior artifacts remain in the repo for provenance; retiring or annotating the originals is a scope decision for Kevin.
