# OPD Cleanup Decision Packet

**Date:** 2026-07-29
**Source SHA:** `d6580a6` (main HEAD, worktree `docs/opd-cleanup-decision-packet`)
**Method:** Read-only re-derivation from `content/documents/*.mdx` on disk, plus one sanctioned PG snapshot (`snapshot-overlay-state.mjs`, output written to gitignored `.scratch/`, not committed). No MDX or code edits. No PG writes.
**Plan pointer:** `docs/SOUSAI_AGENT_PLAN.md` v2.47 rides this PR.
**Predecessor:** `OPD_STATE_OF_RECORD_2026-07-29.md` (SHA `9f28b9f`) - inputs to check, not sources to quote. Where re-derivation disagrees, this packet's numbers govern; the prior document remains as commit history.

Every item below ends in **Options** and a **Recommendation** so Kevin rules on specifics, not categories. Where the evidence does not support a recommendation, it says so plainly.

---

## Section A. Sous exposure - the number that re-ranks everything below

Answered first because it decides whether the Related Documents work is a Sous-safety problem or a reader-cosmetic problem.

### A.1 How many of the 41 hand-typed-table docs are retrievable by Sous?

Sous retrievability = `status: Live` AND `in_corpus: true` in frontmatter (the current visibility rule; `[code-read] scripts/sousai-embed-corpus.mjs:11-14` confirms the bulk-embed loop filters on `status = 'Live'`).

**28 of 41 files are Sous-visible.** [ran] a per-file sweep on `content/documents/*.mdx` frontmatter, cross-referencing the 41 with `# Related Documents`.

```
Sous-visible (Live + in_corpus=true), 28:
  AGR-002, CHK-003, PB-004, PB-007, PB-008, PB-009, PB-010,
  POL-001, POL-003, POL-004, POL-006, POL-007, POL-008, POL-009,
  POL-010, POL-011, POL-013, POL-014, POL-015, POL-019,
  SOP-004, SOP-008, SOP-009, SOP-010, SOP-012, SOP-014, SOP-015,
  STD-003

Non-visible (13):
  In Build:  FORM-009, PB-005, PB-012, PB-013, REF-006, REF-007,
             SOP-005, TPL-014, TPL-019
  Blocked:   REF-002
  Retired:   REF-005-A, REF-005-B, TPL-015
```

### A.2 Of the drift rows, how many sit inside a Sous-visible document?

**Re-derivation disagrees with the state-of-record's "143 drift" headline.** Same corpus, tighter classifier. The `143` figure was strict-string-match against target frontmatter; a row with `Live (v1.0)` in the Status cell was scored DRIFT because it did not literally equal `Live`. My re-derivation counts the versioned-status pattern (`Live (v1.0)`) as CANONICAL AGREE - it is the same base status word with a version suffix, and treating it as drift produces a number that overstates the semantic problem by ~5x.

Re-derived counts across all 41 files:

| Class | Rows | Definition |
|---|---|---|
| Total rows in the tables | 235 | Every non-header non-separator table row across 41 files |
| Artifacts | 5 | No doc ID in the row (external system pointers, `[ pending ]` placeholders, `-` separators) |
| Referenced-in table rows | 230 | Rows that reference a real doc ID |
| Canonical AGREE | 132 | Status word matches target frontmatter status |
| **Canonical DRIFT (real, semantic)** | **24** | Status word wrong (`Draft` vs `Live`, `Live` vs `In Build`, etc.) |
| `Referenced` convention | 5 | Cell says `Referenced` (KitchFix convention meaning "form attached to this doc" - not a lifecycle claim) |
| Prose-statusy | 28 | Cell says `In review` / `Queued` / etc - looks statusy, is not canonical |
| Prose-descriptive | 41 | Cell contains a sentence describing the relationship (column mis-used as a Notes field) |

**Corrected drift count: 24 canonical DRIFT rows.** Not 143.

**Of the 24 canonical DRIFT rows, 23 sit inside a Sous-visible parent.** The remaining 1 (`TPL-019 -> TPL-018`) sits in a non-visible parent.

All 23 rows enumerated (parent → target: claims / actual):

```
AGR-002  -> POL-009 : "In Build" / Live
CHK-003  -> TPL-018 : "Live"     / In Build
CHK-003  -> TPL-019 : "Live"     / In Build
PB-007   -> SOP-010 : "Draft"    / Live
PB-007   -> PB-008  : "Draft"    / Live
PB-007   -> POL-019 : "In Build" / Live
PB-007   -> FORM-009: "Draft"    / In Build
PB-008   -> REF-001 : "Live"     / Pending
PB-010   -> PB-013  : "Live"     / In Build
PB-010   -> FORM-009: "Live"     / In Build
PB-010   -> TPL-007 : "Live"     / Pending
POL-007  -> SOP-001 : "Live"     / In Build
POL-010  -> POL-011 : "Draft"    / Live
POL-014  -> POL-011 : "Draft"    / Live
SOP-004  -> POL-001 : "Pending"  / Live
SOP-004  -> FORM-003: "Live"     / In Build
SOP-004  -> FORM-006: "Live"     / In Build
SOP-008  -> TPL-018 : "Live"     / In Build
SOP-008  -> POST-003: "Live"     / In Build
SOP-010  -> POL-019 : "In Build" / Live
SOP-012  -> TPL-019 : "Live"     / In Build
SOP-014  -> TPL-018 : "Live"     / In Build
SOP-015  -> TPL-018 : "Live"     / In Build
```

Direction skew: **17 of 23 claim `Live` for a target that is In Build / Pending / Retired.** That is the class that lets Sous assert something is production-ready when the target has not shipped. The other 6 claim `Draft` or `In Build` for a target that has since gone `Live` - reverse polarity, still wrong, but less operationally load-bearing.

### A.3 Do those tables actually reach Sous chunks?

Yes - and this is the load-bearing verdict. Code-read of the extractor and chunker:

- `[code-read] src/lib/sousai/extractMdx.js:91-121` - `extractMdx()` reads the MDX file, runs the resolver pipeline (Include → Fact → SourceGoverns → stripNonCanonical), then walks the resolved markdown to produce heading-bounded sections. It does NOT filter or drop the `Related Documents` heading or its body.
- `[code-read] src/lib/sousai/extractMdx.js:129-200` - `parseMarkdownSections()` walks the markdown line by line, breaks on every ATX heading, and captures body text between headings. A section titled `Related Documents` becomes a section with the full raw markdown table body.
- `[code-read] src/lib/sousai/chunk.js:56-96` - `chunkSections()` treats every heading-bounded section as a chunk candidate. A section titled `Related Documents` becomes one (or more) chunks with the raw markdown table pipes and cells baked into the chunk text.

Confirmation: no grep hit for `Related Documents` in any code path that would strip it (`grep -RnE "Related Documents" src/ scripts/` returns only a comment in `_probe_dedup_sweep.mjs` line 20 discussing boilerplate stripping - and that probe is a review-time tool, not the corpus pipeline).

**The Related Documents section is embedded verbatim.** Any answer Sous generates that pulls from a doc's Related Documents chunk will carry the drifted status word as retrieved text. If Sous quotes the row - or synthesizes from a chunk that includes the row - it asserts wrong status with a citation attached.

The corpus-exposed count is high: **23 of 24 canonical-drift rows are inside chunks Sous can retrieve.** Not a reader cosmetic. This is Sous asserting false facts with citations attached, whenever an answer path routes through one of those 23 target IDs and the retrieval surfaces the parent's Related Documents block.

### A.4 What this re-ranks

- **B (NonCanonical strays)** stays high - Sous-facing pipeline hygiene.
- **D (prose-in-status)** drops - it is 74 rows of a column-shape problem, not 143 rows of a status-drift problem. The remedy is different.
- **H (delete the column)** rises - this is now the smallest fix that neutralizes the largest Sous-facing risk.

---

## Section B. The 3 stray `<NonCanonical>` markers

**Pipeline-gap vs authoring-error verdict: AUTHORING PATTERN.** All three strays are backticked references to the tag in prose, not orphaned real markup. The strip rule is tight for well-formed pairs.

### B.1 Naming the 3 strays

```
STD-004 line 156:  > CRITICAL: Mark specimens with `<NonCanonical>` markup in the body, not the frontmatter field.
TPL-020 line 52:   Any dollar figure shown inline is a specimen and is wrapped in `<NonCanonical>`.
TPL-020 line 57:   > CRITICAL: Wrap every bracketed write-in prompt, placeholder row, and specimen dollar figure in `<NonCanonical>` markup.
```

Each stray is a `` `<NonCanonical>` `` opening tag inside backticks, in an authoring-guidance sentence. None has a matching `</NonCanonical>`. None wraps any specimen content - they refer to the tag itself.

### B.2 The strip's matching rule

`[code-read] scripts/content/resolver.mjs:30` - `NON_CANONICAL_RE = /<NonCanonical>[\s\S]*?<\/NonCanonical>/g`. Non-greedy. Requires a matched opening and closing tag with any content (including newlines) between them.

`[code-read] scripts/content/resolver.mjs:214-221` - `stripNonCanonical()` uses this regex to strip both tags and inner content in one pass. The regex is not markdown-aware; backticks, code fences, and blockquote prefixes do not affect it. If a pair exists (even inside backticks), the pair is stripped and replaced with an empty string.

`[code-read] scripts/content/resolver.mjs:249-258` - `flattenForCorpus()` runs `stripNonCanonical()` first, then a "paranoid sweep" that removes any leftover JSX-style tags (`<[A-Z][A-Za-z0-9]*\b[^>]*>` etc.). This means an orphan opening tag DOES get removed on the CORPUS path (Sous never sees the raw tag).

`[code-read] scripts/content/project-catalog.mjs:232,239` - the projection's "stray" count is measured on the READER path, after `markNonCanonical()` (which uses the same `<NonCanonical>...</NonCanonical>` pair regex to convert to Example callouts). Orphan opens survive that pass and are counted as strays in the projection dry-run report. Post-report they render as literal text into `content_html`.

### B.3 Is the rule tight or brittle?

Tight for the pipeline it protects. Brittle for a specific authoring pattern.

- Any WELL-FORMED `<NonCanonical>...</NonCanonical>` pair (in body OR inside a backtick prose reference) is stripped correctly by the corpus path.
- An ORPHAN opening tag (backticked prose reference to the tag name, without a matched close) survives the reader-side `markNonCanonical()` and appears in `document_content.content_html`.
- The corpus (Sous) path catches orphans via the paranoid JSX sweep. Sous never sees `<NonCanonical>` as retrievable text.

Sweep of all MDX for opens/closes mismatch:

```
STD-004: opens=2 closes=1  (1 body orphan on line 156)
TPL-014: opens=29 closes=28  (1 orphan on line 36 - inside a frontmatter checklist, NOT body)
TPL-018: opens=1 closes=0  (1 orphan on line 37 - inside frontmatter, NOT body)
TPL-020: opens=14 closes=12  (2 body orphans on lines 52, 57)
```

The 3 body orphans match the projection report exactly (STD-004: 1, TPL-020: 2). The TPL-014 and TPL-018 frontmatter orphans do not enter body flow so they do not appear as strays and do not enter Sous chunks.

### B.4 Did any unstripped content reach chunks?

**No content. Just the raw string `<NonCanonical>` as retrievable text, in a documentation sentence.** For all three strays, the surrounding sentence is an authoring instruction *about* the tag ("Mark specimens with...", "Wrap every bracketed write-in prompt in..."). No live figure, price, or specimen value leaked.

- STD-004 (Live, in_corpus=true): the paranoid sweep on the corpus path removes the orphan tag. Sous sees the sentence with the tag name stripped.
- TPL-020 (Live, in_corpus=true - **but access_level=restricted**): same. Sous can only quote it for restricted-tier queries; even then, no live specimen leaked.

The reader path (`content_html` for the intranet playbook) preserves the orphan tag as literal text. Cosmetic issue in the browser; not a corpus-safety issue.

### B.5 Options and recommendation

**Options:**
- (a) Edit the three source lines to escape the tag reference (e.g., wrap in backticks + backslash: `` `\<NonCanonical>` `` or replace with the word "NonCanonical" without brackets).
- (b) Leave the source, harden the reader-side `markNonCanonical()` with a pre-pass that skips backtick-fenced content.
- (c) Add a validator rule in `scripts/content/validate.mjs` that flags any body-level `<NonCanonical>` without a matching close.
- (d) Do nothing - reader cosmetic only; corpus is already protected.

**Recommendation: (a) + (c).** The source-fix is 3 lines and permanent. The validator rule is 15 lines and prevents recurrence. (b) hardens the parser against a pattern authors should not use. (d) leaves a papercut in the reader that will confuse the next author who reads STD-004 or TPL-020. Reasoning: STD-004 and TPL-020 are the two docs whose whole point is to teach the NonCanonical convention; letting them render broken tags in the browser undermines their teaching function. This is a body-content fix and does not touch the pipeline.

**Kevin's ruling:** (a)+(c), (a) alone, (b), or (d)?

---

## Section C. TPL-015 → REF-005-A / REF-005-B (Retired targets)

### C.1 What are REF-005-A / REF-005-B?

Both `[code-read]` from `content/documents/REF-005-A.mdx:1-30` and `content/documents/REF-005-B.mdx:1-30`:

- **REF-005-A: "SLA Example - Orlando Sea Slugs Player Development Complex"** - Retired, v1.0, effective_date 2026-05-05. Fictional PDC (Player Development Complex) worked example of PB-005's ten-section SLA structure. Not a current account. `in_corpus: false`.
- **REF-005-B: "SLA Example - Montana Sasquatches MLB Clubhouse"** - Retired, v1.0. Fictional MLB Clubhouse worked example of the same ten-section structure, MLB variant (home/visitor clubhouse, road food, series-based menu). Not a current account. `in_corpus: false`.

Both were reference examples that illustrated how to fill PB-005's structure. Retired without a supersedes: field or successor annotation - the intent was retire-not-replace.

### C.2 When and why retired?

No retirement narrative in either MDX body. Status is `Retired` and that is the only signal. No `supersedes:`, `superseded_by:`, or `retirement_note:` field. `[ran]` `grep -HnE "supersedes|superseded_by|retired|retirement" content/documents/REF-005-*.mdx content/documents/TPL-015.mdx` returns zero hits.

**Insufficient evidence for a why.** The retire-not-replace shape suggests the examples were made obsolete by PB-005 itself maturing (an operator can fill the ten-section structure directly against PB-005 without needing a worked example), but that is inference, not documented.

### C.3 Does a successor exist?

No. `[ran]` `ls content/documents/REF-005*` returns only `REF-005-A.mdx` and `REF-005-B.mdx`. `[ran]` `grep -lE "SLA Example|SLA example" content/documents/*.mdx` returns only the two retired docs plus TPL-015 (which points back). There is no active SLA-example doc.

Compare to POL-019, which correctly points at a retired predecessor via `supersedes:` frontmatter. REF-005-A/B and TPL-015 do not follow that pattern - they retire without a forward pointer.

### C.4 What does TPL-015 actually use REF-005-A/B for?

`[code-read] content/documents/TPL-015.mdx:45-59` (the `## 1.1 Workflow` table):

```
Step 7 | Attach: PB-005, TPL-014, REF-005-A, REF-005-B, and the legacy SOP.
```

The two REFs are attachments the operator sends into a Claude chat as pattern-reference material for a Draft-1 SLA rebuild. TPL-015 itself is `Retired` (`in_corpus: false`), so this instruction cannot fire against a live operator today - the whole workflow is dormant.

TPL-015's `# Related Documents` block also lists them:

```
| Doc ID    | Title                          | Notes                                     |
|-----------|--------------------------------|-------------------------------------------|
| REF-005-A | SLA Example - Sea Slugs PDC    | PDC contract type reference.              |
| REF-005-B | SLA Example - Sasquatches MLB  | MLB Clubhouse contract type reference.    |
```

Note: this is a `Notes` column, not a `Status` column - so these rows are prose-descriptive, not status-drift. They only surface as "retired-target hits" if the scan flags "any hand-typed row pointing at a Retired target" independent of the column shape. That is the state-of-record's scan and mine both agree: TPL-015 → REF-005-A and TPL-015 → REF-005-B are the only two retired-target rows in the entire hand-typed layer.

### C.5 Options and recommendation

**Options:**
- (a) Repoint the rows to a successor. **No successor exists**, so this option is unavailable without first authoring one.
- (b) Delete the two rows from TPL-015's Related Documents table.
- (c) Kevin option C: leave-retired-no-successor, log to backlog. Same disposition ruled for POL-009 → POL-016 predecessors.
- (d) Retire TPL-015 more forcefully (already Retired + out_of_corpus + archived=false; escalate to archived=true so it disappears from admin surfaces too).

**Recommendation: (c), with (d) as a paired action.** TPL-015 is itself Retired; its Related Documents pointing at Retired reference docs is internally consistent for a dormant workflow. Rewriting TPL-015 to remove the rows would produce cosmetic churn on a doc no one uses. Archiving TPL-015 (option d) makes the retired-retired chain invisible to admin dashboards, closing the finding entirely at zero content-edit cost. The backlog entry (option c) preserves optionality if the SLA-example convention ever returns as a first-class artifact.

**Kevin's ruling:** (b), (c), (c)+(d), or (d) alone?

---

## Section D. Prose-in-status rows (corrected drift count)

### D.1 The corrected count

Re-derivation (Section A.2 recap):

- Total table rows across the 41 files: 235
- Artifacts (excluded from drift denominator): 5
- Canonical DRIFT rows (real semantic mismatch): **24**
- Column-shape violations (Referenced convention + prose-statusy + prose-descriptive): 74
- Canonical AGREE (including the versioned-status `Live (v1.0)` pattern): 132

**The state-of-record's "143 drift" number was inflated by counting the versioned-status pattern and the column-shape violations against the strict-string-match test. The corrected drift number is 24.**

The class boundary that matters: `Live (v1.0)` scored as drift by the prior audit is scored as AGREE here because the version suffix is a routine authoring convention, not a status mismatch. Applying that lenience shifts ~60 rows from DRIFT to AGREE. The remaining ~60 rows that the prior audit called drift split into the shape-violation buckets below.

### D.2 The 24 canonical DRIFT rows (verbatim)

Reproduced in Section A.2 above. Each row is a table cell whose status word differs from the target doc's frontmatter status word.

### D.3 The 28 prose-statusy rows

Rows whose status cell contains a non-canonical status-like phrase (`In review`, `Queued`, `Staged`). These are not empty and not descriptive prose - they look statusy but do not match any of the frontmatter's seven canonical values (`Live`, `In Build`, `Draft`, `Retired`, `Blocked`, `Pending`, `Placeholder`).

By parent (all 28 rows):

```
PB-007  -> SOP-008 : "In review" (actual Live)
PB-009  -> PB-010  : "In review" (actual Live)
PB-009  -> PB-005  : "In review" (actual In Build)
PB-009  -> POL-008 : "In review" (actual Live)
PB-009  -> POL-013 : "In review" (actual Live)
PB-009  -> PB-012  : "In review" (actual In Build)
PB-012  -> PB-005  : "In review" (actual In Build)
PB-012  -> TPL-014 : "In review" (actual In Build)
PB-012  -> PB-010  : "In review" (actual Live)
PB-012  -> PB-009  : "In review" (actual Live)
PB-012  -> TPL-011 : "Queued"    (actual Pending)
PB-012  -> POL-014 : "In review" (actual Live)
PB-013  -> SOP-005 : "In review" (actual In Build)
PB-013  -> TPL-016 : "Queued"    (actual Pending)
PB-013  -> FORM-009: "In review" (actual In Build)
PB-013  -> SOP-008 : "In review" (actual Live)
PB-013  -> SOP-009 : "In review" (actual Live)
PB-013  -> SOP-001 : "In review" (actual In Build)
POL-010 -> POL-006 : "In review" (actual Live)
POL-010 -> POL-001 : "In review" (actual Live)
POL-010 -> PB-004  : "In review" (actual Live)
POL-014 -> POL-001 : "In review" (actual Live)
POL-014 -> POL-006 : "In review" (actual Live)
POL-014 -> SOP-004 : "In review" (actual Live)
SOP-005 -> TPL-016 : "Queued"    (actual Pending)
SOP-005 -> PB-013  : "In review" (actual In Build)
SOP-005 -> FORM-009: "In review" (actual In Build)
SOP-005 -> POL-013 : "In review" (actual Live)
```

Concentration: the prose-statusy phrase `In review` clusters in PB-009, PB-012, PB-013, POL-010, POL-014, SOP-005. Four of those (PB-009, POL-010, POL-014, SOP-005 partial) are Sous-visible parents. `In review` is a rebuild-workflow term, not a KitchFix lifecycle status.

### D.4 The 41 prose-descriptive rows

Rows whose status cell contains a full sentence describing the relationship - the column is being used as a Notes field. Concentrated in six parents whose header row explicitly labels the third column `Notes` rather than `Status`:

```
Header = "Notes":  PB-005 (6 rows), REF-005-A (6), REF-005-B (6),
                    TPL-014 (8), TPL-015 (5)
Header = "Status" (but cells hold prose): POL-007 (3), REF-006 (3),
                    REF-007 (3), SOP-005 (1)
```

Notes-column tables are a **different table shape**, not drift. The header openly declares it. Marking these as drift produces a phantom finding. The `Status`-header tables that hold prose (POL-007, REF-006, REF-007, SOP-005 - 10 rows total) ARE a real column misuse: the header promises a status word, the cell delivers a sentence.

### D.5 The 5 `Referenced` convention rows

```
POL-003 -> FORM-004: "Referenced" (actual Live)
POL-003 -> FORM-006: "Referenced" (actual In Build)
POL-004 -> SOP-004 : "Referenced" (actual Live)
POL-006 -> SOP-004 : "Referenced" (actual Live)
POL-007 -> SOP-007 : "Referenced" (actual In Build)
```

`Referenced` is a KitchFix convention meaning "form/asset attached to this doc". It is not a lifecycle status. Treating it as drift is a scoring choice; treating it as AGREE (my scoring) preserves the convention.

### D.6 What the number should be

**Real semantic drift: 24 rows** (rows where a canonical status word claim disagrees with the target's frontmatter status word).

**Column-shape misuse in Status-labeled tables: 10 rows** (POL-007 x3, REF-006 x3, REF-007 x3, SOP-005 x1). Header promises `Status`, cell delivers prose.

**Notes-column tables (not drift, different shape): 31 rows** (PB-005, REF-005-A/B, TPL-014, TPL-015).

**Referenced-convention: 5 rows** (not drift, established convention).

**Prose-statusy in Status-labeled tables: 28 rows.** These are drift-adjacent - the cell tried to say a status but chose a word not in the canonical set. Sous exposure applies (Section A.3).

### D.7 Options and recommendation

Two problems here, one remedy each:

**Problem 1 - semantic drift (24 rows).**
Options: (a) hand-fix each of the 24 rows, (b) delete the Status column (Section H), (c) leave and accept.

**Problem 2 - column-shape misuse in Status-labeled tables (10 rows).**
Options: (a) rename the header to `Notes` on POL-007/REF-006/REF-007/SOP-005 to reflect actual content, (b) split the cell content into Status word + separate Notes column, (c) delete the column.

**Recommendation: Section H's delete-the-column solves BOTH problems in one move.** The Notes-column tables already prove the pattern - a Doc ID + Title table without a status column is useful. Deleting the Status column across all 41 files unifies the shape (all tables become Doc ID + Title, some with a Notes column, none with Status), removes 24 semantic drifts and 10 shape violations, and pulls the largest Sous-facing risk out of the corpus in one pass.

**Kevin's ruling deferred to Section H.**

---

## Section E. The 3 residual TBD tokens

All three verbatim with surrounding context.

### E.1 REC-110 line 56

```
> NOTE: Capture completeness - **FULLY-CAPTURED** - contract banked, $604,032 fee
finance+contract-confirmed (exact), monthly cadence + 8.25% tax gross-up confirmed,
postseason pro-rata mechanic banked. Non-blocking opens: the missing-§2(d) contract
defect (cosmetic), SF invoice not sampled (Phase E), single-year contract (2027 TBD).
```

The `TBD` refers to the state of a 2027 contract renewal - the current contract is single-year, and whether it renews in 2027 has not been decided by the counterparty. This is a factually accurate statement about a real open decision. Not placeholder content.

### E.2 REC-111 line 143

```
Each visiting team is billed via its own AP contact. Full roster in
`TXR VISITING CATERING.xlsx` (All Contacts tab). Notable: Yankees =
Andrew Weisberg (aweisberg@yankees.com); Cubs = Beth Schwartz
(bschwartz@cubs.com, per 2026 Season tab - beyond the roster's "TBD");
**SF Giants = opt-out ("NEVER ORDERED")**; **STL Cardinals = no TXR
series in 2026** (Cardinals don't visit Texas this season - "TBD" holds).
Roster has minor Tab1-vs-Tab2 discrepancies (Cleveland, San Diego, Toronto)
- flag for the year-start review. *§Z*
```

Both `TBD` tokens are quoted values from an external source system (the `TXR VISITING CATERING.xlsx` roster). One is quoted with explicit context ("beyond the roster's 'TBD'" - explaining how the doc reconciled a source-system placeholder against a live email address). The other says the source system's placeholder "holds" (i.e., is still accurate because the Cardinals aren't visiting Texas). Both are historical/quotation content, not authoring placeholders.

### E.3 REF-123 lines 127, 201, 202

Line 127:

```
NOT PRESENT. AAA Louisville does not have MLB Postseason. Playoff/end-date
is left open in Exhibit A SOP ("through the end of the season, or playoffs
if indicated. (Exact end date TBD, September 2026)").
```

The `TBD` is a verbatim quote from Exhibit A SOP. Faithful transcription of a contract clause.

Lines 201-202 (a season-window comparison table):

```
| Guaranteed meals per homestand | Minimum 11 buffet meals per 6-game homestand | Minimum 11 buffet meals per 6-game homestand | Every arrival + mini meal; post-game TBD May |
| Season window | Mar 29, 2024 → Sep 2024 TBD | Mar 29, 2025 → Sep 2025 TBD | Mar 27, 2026 → Sep 13, 2026 (13 homestands total per Ex. B) |
```

The `TBD` tokens describe past-season end-date uncertainty (2024, 2025) that was real at the time and is now historical. The 2026 column has an actual end date (Sep 13, 2026). Rewording `Sep 2024 TBD` to `Sep 2024 (uncertain at time)` loses semantic fidelity - the doc is a historical record of what was known when.

### E.4 Verdict and recommendation

**All three docs contain zero authoring-placeholder `TBD` tokens.** Every hit is either (1) a factually-accurate reference to a real open decision, (2) a verbatim quote from an external source or contract, or (3) a historical column value. The flag was a false positive of a naive `\bTBD\b` regex.

**Options:**
- (a) Reword to remove the substring `TBD` from all three docs.
- (b) Accept as-is (evidence supports each occurrence).
- (c) Make the check quote-aware: skip matches inside backticks, blockquotes, or explicit quotation marks; skip matches inside table cells whose column is a season-window / date-range field.

**Recommendation: (b) + (c).** Rewording would degrade fidelity in each of the three cases. Making the check quote-aware prevents this false-positive class from recurring. The check as-written is a linter over-reach; the docs are correct.

**Kevin's ruling:** (a), (b), (b)+(c), or (c) alone?

---

## Section F. REF-006 / REF-007 pay bands

### F.1 What specifically needs verifying

Both docs are `status: In Build`, v1.1 (REF-006) and v1.0 (REF-007), authored labeled "Draft market reference (pending Finance validation)". `[code-read] content/documents/REF-006.mdx:57`: `VERSION | v1.1 - Draft - market reference (pending Finance validation)`. `[code-read] content/documents/REF-007.mdx:49`: `v1.0 - Draft - market reference (pending Finance validation)`.

REF-006 owner + approver: `People Operations` / `People Operations + Finance`.
REF-007 owner + approver: same, plus `access_level: slt` (leadership-tier restricted).

**The docs themselves declare the verification blocker: Finance signoff against Rippling actuals and account budgets.**

### F.2 Where the figures live

**REF-006 (Hourly - 7 states):**

Table structure (`[code-read] content/documents/REF-006.mdx:104-146`): one Min/Mid/Max table per state, for the three hourly roles. Sample values for the first three states:

```
Arizona           Dishwasher $15.50/$17.50/$20.00  Cook $18/$21/$25  FOH $16/$18.50/$22
Florida           Dishwasher $15.00/$17.00/$19.50  Cook $17.50/$20.50/$24  FOH $15.50/$18/$21
Texas             Dishwasher $15.00/$17.00/$19.50  Cook $18/$21/$25  FOH $15.50/$18/$21
```

(Additional tables for NY, MO, OH, KY at lines 134+. Illinois deliberately absent - IL is corporate-only per the doc's own explanatory note.)

**REF-007 (Leadership - national with account-scope calibration):**

`[code-read] content/documents/REF-007.mdx:92-96`:

```
Sous Chef            $52,000  $60,000   $72,000
Hospitality Manager  $55,000  $66,000   $82,000
Executive Chef       $80,000  $95,000   $120,000
```

Calibration convention (`[code-read] content/documents/REF-007.mdx:78-82`): lower third = PDC/MiLB or new-in-role, midpoint = standard MLB account, upper third = flagship/dual-clubhouse MLB (TXR Home+Visitor, STL, CIN).

### F.3 What Kevin compares against

Two sources, one per document:

**REF-006 (hourly):** Rippling active-employee hourly rates by state + role. The smallest question: **does the paid rate for each state × role bucket fall inside the Min-Max range in REF-006?** If any active employee is below the state's Min or above the Max, the band is wrong for the market as it actually pays today.

Second-order check: **state minimum wage floors** - REF-006's summary calls out AZ Goodyear/Surprise $15.15, FL $14-$15 by Sept 30 2026, NY Buffalo $16.00, MO St. Louis $15.00, OH Cincinnati $11.00. If any Min in the table falls below the actual local minimum, the band publishes an illegal floor.

**REF-007 (leadership):** Rippling salary rows for the six named accounts + role. The smallest question: **does each named leadership salary fall inside the appropriate account-scope third of the band?**  PDC/MiLB should sit in lower third; standard MLB at midpoint; TXR-Home, TXR-Visitor, STL, CIN in upper third.

### F.4 The smallest possible question

- **REF-006:** "Does every current hourly employee's rate fall inside their state × role Min/Max? Any exceptions?"
- **REF-007:** "Does every current leadership salary fall inside the account-scope-appropriate third?"

Both are one-hour Rippling exports for Kevin/People Ops/Finance. No code, no MDX edit, no PG write required for the answer. Once answered:

- If all inside band: promote to `status: Live`, mark approved.
- If exceptions: adjust the band OR the salary; document the exception rationale in `# Version History`; then promote.

### F.5 Options and recommendation

**Options:**
- (a) Kevin runs the two Rippling exports, rules whether the bands are correct, and either promotes to Live or edits the bands.
- (b) Defer - keep both `In Build` and non-corpus, low urgency.
- (c) Deprecate the two docs, replace with a Rippling-derived generated report (bands sourced from a query over actuals, not hand-authored).

**Recommendation: (a).** These are the two docs whose only blocker is Kevin's ruling. They cannot ship without Finance validation and no code change moves them forward. Deferring (b) leaves an in-flight compensation reference in the corpus indefinitely; deprecating (c) is a much bigger scope decision that could ride a future People Ops rework, not this cleanup pass. The compensation function is Kevin's domain and only he can answer the smallest question.

**Kevin's ruling:** (a), (b), or (c)?

---

## Section G. The 4 archived PG-only ids

### G.1 Naming them

`[ran]` `node --env-file=/Users/kevinfietek/dev/kitchfix-intranet/.env.local scripts/content/snapshot-overlay-state.mjs`. Sanctioned read-only script that dumps `{id, status, access_level, archived, archived_at}` for every documents row. Output written to `.scratch/overlay-snapshot-2026-07-29T16-16-36-090Z.json` (gitignored, not committed).

```
LEGACY-PR    status=Retired    archived_at=2026-06-16T15:36:22Z
LEGACY-WOW   status=Retired    archived_at=2026-06-16T15:36:22Z
PB-099       status=Pending    archived_at=2026-06-04T19:16:59Z
STD-005      status=In Build   archived_at=2026-07-17T13:44:41Z
```

### G.2 What are they?

- **LEGACY-PR / LEGACY-WOW**: two "Legacy" placeholder rows from the pre-MDX era (Sheets-cutover artifacts). `[code-read] scripts/sousai-embed-corpus.mjs:33-35` documents the LEGACY-* pattern explicitly: "catalog-only rows that have no MDX source" are skipped by the embed loop by design. These were preserved when the MDX corpus took over, marked Retired, and eventually archived on 2026-06-16.
- **PB-099**: an early Playbook stub, archived on 2026-06-04 (roughly the migration-project close-out window). `Pending` status suggests it was scoped but never authored. Presumably the "99" ID reserves a slot but the intended content was superseded by another PB doc.
- **STD-005**: an In-Build standard, archived on 2026-07-17. The most recent archival. Not currently in MDX. Presumably the scope was folded into an existing STD doc or dropped.

### G.3 Why is the sanctioned instrument (project-catalog dry-run) blind to them?

`[code-read] scripts/content/lib/projection-core.mjs:167-177` - `computeDiff()`'s archive planner:

```js
for (const row of live.documents) {
  if (mdxIds.has(row.id)) continue;
  if (row.archived) continue; // already archived, nothing to do
  ...
  docPlan.archive.push(...);
}
```

The condition `if (row.archived) continue;` short-circuits already-archived rows so the dry-run's "Would-archive" list only enumerates rows that WOULD become archived on the next apply. Already-archived PG-only rows produce no dry-run output because there is no diff action for them.

That is why the state-of-record could name the 4 exist but not enumerate them - the sanctioned instrument's Would-archive plan is scoped to future work, not existing state.

### G.4 Does the blind spot matter downstream?

**No.** Confirmed by two checks:

- **Sous embed loop:** `[code-read] scripts/sousai-embed-corpus.mjs` filters to `status = 'Live'` in bulk mode (line 6-9) and skips docs whose MDX file does not exist (lines 34-35). Archived docs are not Live, and have no MDX. They cannot be embedded.
- **Reader / dashboard surfaces:** `archived=true` is the disappearance flag. Grep for `archived` on the playbook code path shows every reader query filters on it. Archived docs do not render.

The 4 archived-PG-only rows are inert. They occupy 4 rows in the `documents` table and nothing else. The blind spot is a reporting inconvenience, not a live risk.

### G.5 Options and recommendation

**Options:**
- (a) Delete the 4 archived-PG-only rows via a Studio DELETE. Frees the ID slots and removes the blind spot.
- (b) Retain-and-log: leave the 4 rows, add a note to the state-of-record how-to-re-run block that `snapshot-overlay-state.mjs` is the instrument for enumerating them.
- (c) Author placeholder MDX for each (matches the archive flag) so the sanctioned dry-run sees them.

**Recommendation: (b).** The 4 rows are inert. Deletion (a) is a PG mutation with no upside since they cause no operational problem. Authoring placeholder MDX (c) is negative-value work (creates artifacts to make a report cleaner). Adding a two-line pointer in the how-to-re-run to `snapshot-overlay-state.mjs` closes the visibility gap at zero risk.

**Kevin's ruling:** (a), (b), or (c)?

---

## Section H. Deleting the Status column - feasibility and blast radius

### H.1 Does anything parse or depend on the Status column?

**No.** Grep-proven across the three risk surfaces:

- **Reader / print pipeline:** `[ran]` `grep -rnE "Related Documents|related-docs|status-column" src/app/playbook/playbook.css src/lib/print/` returns zero hits. The print pipeline treats `# Related Documents` as an ordinary H1 section with a markdown table below. No selector targets a `Status` column. No conditional rendering.
- **Playbook admin / reader components:** `[ran]` `grep -rlE "Related Documents" src/app/` returns zero hits. No component special-cases the section.
- **Sous chunker:** `[ran]` `grep -RnE "Related Documents|related_documents" src/lib/sousai/` returns zero hits. `chunkSections()` treats the section as ordinary body text (Section A.3 above).
- **Validator:** `[code-read] scripts/content/validate.mjs:1-232` - no rule references `# Related Documents` or a Status column shape. The projection's `checkRelationships()` uses the frontmatter `relationships:` field only, not the hand-typed table.
- **Projection:** `[code-read] scripts/content/lib/projection-core.mjs:130-221` - the projection writes `document_relationships` rows from `d.frontmatter.relationships`, never from the markdown table. The table is presentation-only.

**The Status column has zero machine consumers.** Its only role is to signal to a human reader: "this related doc is (or is claimed to be) X status".

### H.2 Does the print pipeline render it?

**Yes, but only as ordinary table cell content - not via any Related-Documents-aware fenced code.**

The print pipeline (`playbook.css @media print` block, `.pb-print-*` classes, Bebas Neue asset registration in `src/lib/print/assets.js`) is fenced for all three trains and must not break. The fence has held because none of it references `# Related Documents` structurally. Removing the Status column changes the rendered table from three columns to two - a text change inside a doc, not a change to the print pipeline. The print pipeline's fenced files are not touched.

**Grep-proven no print-pipeline dependency.** `[ran]` `grep -rnE "Related Documents|related-docs" src/app/playbook/playbook.css src/lib/print/` returns zero hits.

### H.3 What does the table look like without the Status column?

Before:

```
| Document ID | Title | Status |
|---|---|---|
| SOP-008 | Food Safety Management | Live |
| SOP-002 | Safety and Incident Management | Live |
| TPL-018 | Daily Food Safety Log | Live |
```

After:

```
| Document ID | Title |
|---|---|
| SOP-008 | Food Safety Management |
| SOP-002 | Safety and Incident Management |
| TPL-018 | Daily Food Safety Log |
```

The Doc ID + Title carries the useful signal (the operator wants to know "what other docs matter here" and clicks through to the target). Status can be derived at render time from the target doc's frontmatter if we ever need it back (a reader-side lookup), rather than duplicated by hand.

The Notes-column tables (PB-005, REF-005-A/B, TPL-014, TPL-015 - 6 files) already prove the pattern is legible without a Status column. This delete-the-column decision unifies the corpus on the same shape.

### H.4 Validator rule to catch a future re-add

Sketch (would fit in `scripts/content/validate.mjs`):

```js
function checkRelatedDocumentsShape(body, fm, findings) {
  // Find the # Related Documents section and its table header.
  const relBlock = extractSection(body, "Related Documents");
  if (!relBlock) return;
  const headerMatch = relBlock.match(/^\|([^\n]+)\|\s*$/m);
  if (!headerMatch) return;
  const cols = headerMatch[1].split("|").map(c => c.trim().toLowerCase());
  // The third column, if present, must be "notes" (allowed) or absent
  // (recommended). "Status" is forbidden - it invites hand-typed drift and
  // has no machine consumer.
  if (cols[2] === "status" || cols[2] === "current status" || cols[2] === "state") {
    findings.push({
      rule: "related_documents_shape",
      severity: "warn",
      message: "Related Documents table has a Status column. Delete it - the column has no machine consumer and hand-typed values drift from the target's real status. Use two columns (Doc ID + Title) or three (Doc ID + Title + Notes).",
    });
  }
}
```

**False-positive risk: near zero.** The rule fires only on the exact header word `Status` / `Current Status` / `State` in the third column of the `# Related Documents` section. It ignores tables outside that section. `Notes` and empty third-column headers pass. `Status` in ANY other table (e.g., the doc's cover metadata table like `| DOCUMENT ID | REF-006 | ... | VERSION | v1.1 - Draft |`) is unaffected because it is in a different section.

### H.5 Honest counter-case - is there a reason to keep the column?

**One weak reason:** for offline print / PDF reading, the Status column shows the reader "this related doc is In Build - do not send this to a client". Removing it forces the reader to click through to the target doc to check the status. For a printed page, that click-through is impossible; the reader must remember or look up separately.

**Counter to the counter:** the column is currently WRONG 24 times in 41 files, and shape-violated 74 more times. A reader looking at the printed page today would trust false claims 34% of the time (74 of 219 rows carry a signal that is not a status word or is a wrong status word). Removing the column removes the wrong signal; adding the missing status requires a click, but a click to the truth beats reading a lie on paper.

**Weaker second reason:** administrative visibility. The dashboard displays document lists with status chips; if the Related Documents table also carried the status, an admin could scan a doc and see "5 In-Build dependencies, 2 Retired references" without opening each target. **But the dashboard already has this view via structured relationships** - hand-typed tables are not the mechanism.

No reason survives the drift rate. Delete the column.

### H.6 Options and recommendation

**Options:**
- (a) Delete the Status column across all 41 files. Add validator rule to prevent re-add.
- (b) Delete the column only on Sous-visible files (28), leave it on the 13 non-visible.
- (c) Keep the column and mass-correct the 24 canonical drift rows.
- (d) Keep the column, correct nothing, accept ongoing drift.

**Recommendation: (a).** Uniformity beats partial-uniformity (b). Correcting 24 rows (c) fixes the current state but does not stop the next drift; the column has no machine consumer, so accuracy will erode again. (d) leaves Sous quoting false status 23 times over the retrievable corpus.

The delete-and-guard approach:

1. Delete the Status column from all 41 tables (mechanical edit - `awk` or a purpose-built script). Affects 41 files, ~230 rows of markdown table syntax. Zero code changes. Zero PG changes until re-projection.
2. Add `checkRelatedDocumentsShape()` to `validate.mjs`. Runs on every `--apply` and pre-commit; produces a `warn` (not error) initially, upgraded to error after Kevin confirms no legitimate use case surfaces.
3. Re-project the affected docs (Section I).
4. Targeted re-embed of the 28 Sous-visible files (Section I).

**Kevin's ruling:** (a), (b), (c), or (d)? And on the validator: warn-only or error?

---

## Section I. The re-embed path

MDX edits do not reach Sous until re-projection + re-embed run. This is the exact sequence.

### I.1 Exact sequence to make a content sweep visible to Sous

Assuming a set of edited MDX files (from Sections B/C/D/E/H rulings):

**Step 1 - Local validation (no PG, no OpenAI):**

```
node scripts/content/validate.mjs
```

Validates every MDX file's shape + relationships + Facts + heading hierarchy. Zero writes. Kevin reviews any warn/error.

**Step 2 - Sanctioned dry-run of the projection (PG READ ONLY):**

```
node --env-file=/Users/kevinfietek/dev/kitchfix-intranet/.env.local \
  scripts/content/project-catalog.mjs --dry-run
```

Reads `documents`, `document_relationships`, `document_surfaces`, `document_content` snapshots, computes the diff against the MDX, writes `docs/opd/foundation/PROJECTION_DRYRUN.md`. **Zero PG writes.** Kevin inspects the Would-INSERT / Would-UPDATE / Would-ARCHIVE lists. Discard the generated report file before committing.

**Step 3 - Apply the projection (PG WRITE):**

```
node --env-file=/Users/kevinfietek/dev/kitchfix-intranet/.env.local \
  scripts/content/project-catalog.mjs --apply
```

`[code-read] scripts/content/project-catalog.mjs:735` confirms `mode = args.includes("--apply") ? "apply" : "dry-run"`. In apply mode, the script:

- Stages changes into `documents_staging`, `document_relationships_staging`, `document_surfaces_staging`, `document_content_staging`.
- Executes the swap: UPSERT into `documents` (by-ID, preserving `source_drive_id`, `pinned`, `archived`, `archived_at`, `created_at`, `storage_path`, `status`, `access_level` per the overlay-preserve pattern); TRUNCATE + INSERT `document_relationships` and `document_surfaces`; UPSERT `document_content` skipping rows whose `content_hash` matches existing.

**This is the PG write step.** All Related Documents column edits (Section H), NonCanonical strays (Section B), TBD wording (Section E), and TPL-015 archival (Section C, if chosen) flow through this write.

**Step 4 - Targeted re-embed (PG WRITE, OpenAI CALL):**

```
node --env-file=/Users/kevinfietek/dev/kitchfix-intranet/.env.local \
  scripts/sousai-embed-corpus.mjs DOC1 DOC2 DOC3 ...
```

`[code-read] scripts/sousai-embed-corpus.mjs:14-19` - targeted mode. Per doc, calls `embedDocument()` which extracts (via `extractMdx()`) → chunks (via `chunkSections()`) → embeds (via `embed()`, OpenAI text-embedding-3-small) → replaces chunks (delete-then-insert `document_chunks` rows for that doc). Idempotent - re-runs produce identical end state.

Only the docs edited in the sweep need re-embed. Sous-visible edited docs are the target set (from Section H, the 28 Sous-visible files; from Sections B/C/E, subset TBD by Kevin's rulings).

### I.2 Which steps write to PG

- Step 1: no writes.
- Step 2: no writes.
- **Step 3: writes to `documents`, `document_relationships`, `document_surfaces`, `document_content`.**
- **Step 4: writes to `document_chunks` (delete + insert).**

### I.3 Does any step trip `migration-gate.yml`?

**No.** `[code-read] .github/workflows/migration-gate.yml` (per CLAUDE.md description) fires when a PR adds files matching `docs/migrations/*.sql`. This cleanup PR is docs-only (the decision packet + plan file). The content-sweep PRs that follow will edit `content/documents/*.mdx` and `scripts/content/validate.mjs` (Section H), but zero SQL migration files.

`[ran]` `git diff origin/main..HEAD --name-only` for this worktree: `docs/audits/OPD_CLEANUP_DECISION_PACKET_2026-07-29.md` and `docs/SOUSAI_AGENT_PLAN.md`. Two files. No SQL.

**Migration-gate answer: NOT tripped. The migration-gate root-cause work remains parked and does not become a prerequisite for the cleanup sweep.**

### I.4 Can re-embedding be scoped to changed documents?

**Yes.** `[code-read] scripts/sousai-embed-corpus.mjs:14-19` - the targeted mode takes doc IDs as CLI args and re-embeds ONLY those. Bulk missing-only mode skips docs with existing chunks. There is no "re-embed entire corpus" hammer required.

**Scoping matters cost-wise.** A corpus-wide re-embed would touch every one of the 82 Live docs; a scoped run touches only the docs edited in the sweep.

### I.5 Rough cost and duration

- **Extraction + chunking:** local, sub-second per doc.
- **Embedding:** OpenAI `text-embedding-3-small` at $0.02 per 1M tokens. A typical Live doc yields 10-20 chunks of ~800 tokens each = 8k-16k tokens = $0.00016 - $0.00032 per doc. **28 Sous-visible docs = $0.005 - $0.01 total.** Rate-limited but not by budget - the constraint is OpenAI's requests-per-minute for the account. Practically a 30-60 second run for 28 docs.
- **PG round-trips:** the delete-then-insert per doc is a handful of statements; well under a second per doc. **Total wall-clock: 1-2 minutes.**

Bulk corpus-wide re-embed (if ever needed): 82 Live docs → ~$0.02 total, 3-5 minutes. Cheap in both dimensions.

### I.6 Recommendation (no ruling needed)

The path is the path. This section is a reference, not a decision. Kevin's decision, if any, is on **which docs to include in the sweep** - and that gets decided by Sections B/C/D/E/H above.

---

## Section J. The three scope questions

Brief evidence, no deep dives.

### J.1 Build Dashboard - what does "rework" still claim?

`[code-read] docs/opd/BUILD_DASHBOARD_AUDIT_CC.md` (2026-06-17). The five silent-data-loss traps (title, shelf, doc_class, status, version) are all resolved:

- `[code-read] src/app/api/playbook/route.js:135-137` - `WRITABLE_FIELDS_A = new Set(["status", "pinned", "access_level"])`. Only these three fields are writable by the admin API. title/shelf/doc_class/version are hard-rejected by the writable-set filter.
- `[code-read] scripts/content/lib/projection-core.mjs:33-73` - `status` and `access_level` are overlay-preserved: on UPDATE the existing PG value rides through, on INSERT the MDX seeds. Neither can be clobbered by re-projection.

**The trap class is dead.** What survives from the audit's broader rework verdict:
- **IA (information architecture) of the dashboard tab layout:** was the tabs/groups scheme judged "confusing" by the audit? Not re-verified. Sight-check `[code-read] src/app/playbook/admin/` - the current admin surface is the post-2026-06 refactor with tab-per-shelf. Whether it is right is a UX call, not a bug.
- **KPI choice** at the top of the dashboard: original audit criticized what was displayed. Not re-verified.
- **New Document flow:** the create-doc modal shape. Not re-verified.

**Verdict: the safety-critical rework (five traps) is done. The remaining rework claims are UX opinions that would need a fresh product session to resolve. NOT a cleanup-packet decision.**

### J.2 Playbook Engine audit - "Drive is decoration"

`[code-read] docs/opd/PLAYBOOK_ENGINE_AUDIT.md` self-notes it is pre-Train-3 (2026-06-16) and its SousAI-Drive-ingestion sections are superseded by A5.

Its "Drive is decoration" claim about the readers: **stale**.
- `[code-read] src/app/playbook/SlideOverReader.js:135-136` - the reader destructures `content_html, content_html_es` from the doc data.
- `[code-read] src/app/playbook/SlideOverReader.js:155-159` - primary render path is `content_html` (populated by the A4 projection); `drive_preview_url` is the FALLBACK per-language when `content_html` is missing.
- `[code-read] src/app/playbook/SlideOverReader.js:164` - `activeHtml = activeLang === "es" ? content_html_es : content_html`.

**Drive is now the fallback, not the primary. Post-Train-3 the projection populates `document_content.content_html` for every Live doc, so the fallback fires only when `content_html` is absent - which post-`--apply` should be zero for Live docs.**

**Verdict: audit is stale on this point. No live gap. NOT a cleanup-packet decision.**

### J.3 Anything else in Section 6 without a home above

`[code-read] docs/audits/OPD_STATE_OF_RECORD_2026-07-29.md:250-272` - the state-of-record's Section 6 lists 10 findings. Mapping:

| # | Finding | Section here |
|---|---|---|
| 1 | 143 DRIFT rows | Section A + D (corrected to 24) |
| 2 | SOP-015 duplicates SOP-002 | Not yet - see below |
| 3 | TPL-015 -> REF-005-A/B retired-target | Section C |
| 4 | 3 TBD-token docs | Section E |
| 5 | 3 stray NonCanonical | Section B |
| 6 | 4 archived PG-only ids | Section G |
| 7 | Prose-in-status column misuse | Section D |
| 8 | REF-006/007 pay bands | Section F |
| 9 | Build Dashboard rework | Section J.1 |
| 10 | Drive is decoration | Section J.2 |

**Finding #2 - SOP-015 duplicates SOP-002 in its Related Documents table** was not covered above. Verbatim from `content/documents/SOP-015.mdx`:

```
| Document ID | Title | Status |
|---|---|---|
| SOP-008 | Food Safety Management | Live |
| SOP-002 | Safety and Incident Management (§07.4 Suspected Foodborne Illness) | Live |
| TPL-018 | Daily Food Safety Log | Live |
| SOP-002 | Safety and Incident Management | Live |
```

SOP-002 appears twice - once with a section-qualified title (`§07.4 Suspected Foodborne Illness`), once bare. Both point at SOP-002. The section-qualified reference is the semantically-meaningful one; the bare row is redundant.

**Options:**
- (a) Delete the bare row, keep the section-qualified one.
- (b) Delete the section-qualified row, keep the bare one.
- (c) Merge into one row with the section context in a Notes column (which would arrive after Section H's delete-the-Status-column decision).

**Recommendation: (a).** The bare row carries no information the section-qualified row does not. Zero-information duplication invites future confusion.

**Kevin's ruling:** (a), (b), or (c)?

---

## Decision list

One numbered list. Each question terse; recommendation marked with a `*`.

1. **B - NonCanonical strays.** Fix the 3 body strays and add a validator rule? (a\* fix source + validator, b) harden parser only, c) validator only, d) do nothing.
2. **C - TPL-015 → retired REF-005-A/B.** (a) repoint - N/A no successor, b) delete the rows, c\* leave-retired-no-successor + backlog, d) archive TPL-015 fully. Recommendation: c+d.
3. **D+H - Delete Status column across all 41 Related Documents tables?** a\* delete + validator + Section I re-project + re-embed, b) delete only on the 28 Sous-visible files, c) keep column + mass-correct 24 drift rows, d) keep, accept ongoing drift.
4. **H - Validator rule severity.** warn-only\* or error?
5. **E - 3 TBD tokens.** a) reword the docs, b) accept as-is (evidence supports), c\* accept + make the check quote-aware.
6. **F - REF-006 / REF-007 pay bands.** a\* Kevin runs Rippling + rules, b) defer, c) deprecate + generate from Rippling.
7. **G - 4 archived PG-only rows.** a) delete from PG, b\* retain + add snapshot-overlay-state.mjs to the re-run docs, c) author placeholder MDX.
8. **J.3 - SOP-015 duplicate SOP-002 row.** a\* delete bare row, b) delete section-qualified row, c) merge with Notes.
9. **J.1 - Build Dashboard rework (IA / KPI / New Document flow).** Address in this cleanup pass, or defer to a UX session? Recommendation: defer.
10. **J.2 - Playbook Engine audit "Drive is decoration".** Retire the finding as stale (recommendation) or re-audit?

Kevin can answer this list in a few lines; each has a recommended default and each answer determines a specific downstream action.

---

## Notes on method

- Two-file diff proven: `git status --short` shows `docs/audits/OPD_CLEANUP_DECISION_PACKET_2026-07-29.md` (new) and `docs/SOUSAI_AGENT_PLAN.md` (modified) only.
- No `.env*` file read, opened, or echoed.
- No ad-hoc PG probe scripts written. Sanctioned instruments only: `project-catalog.mjs --dry-run` (invoked in a prior session, output cited), `snapshot-overlay-state.mjs` (invoked this session, output to gitignored `.scratch/`, not committed).
- MDX / filesystem analysis via grep, awk, and one node script (`/tmp/reldocs_reconcile2.mjs`, not committed) that only reads `content/documents/*.mdx` and writes to `/tmp`. No PG credentials required for the reconcile.
- Zero MDX edits. Zero code edits. Zero PG writes.
- Plan v2.47 rides this PR.
