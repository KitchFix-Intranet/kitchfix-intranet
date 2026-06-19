# OPD Per-Document Scorecard - v2 (Phase 2)

> One per document. Its output is three things at once: the **audit record**, the **OPD catalog row**, and the **SousAI metadata**. Fill it during Pass 1; finalize the catalog/SousAI fields in Pass 5. Every finding cites the **section**. Hyphens only, no em-dashes. Read with the Audit Brief v2 (criteria), the Charter (method, status mapping), and both CC State Briefs (the schema and the hard floor).

---

## Part 1 - Identification (from the doc's metadata table, checked against the tracker)

| Field | From document | Matches tracker? |
|---|---|---|
| Document ID | | yes / no |
| Title | | yes / no |
| Class (PB/SOP/STD/POL/AGR/TPL/FORM/CHK/REF/POST) | | yes / no |
| Version | | yes / no |
| Tracker status | | n/a |
| Owner (role title, never a name) | | yes / no |
| Approver (role title) | | yes / no |
| Classification | | yes / no |

Metadata integrity note (any mismatch/blank/stale = at least MAJOR):

---

## Part 2 - Document-level audit (mark PASS / ISSUES / FAIL, cite sections)

**A1. Accuracy & compliance** - PASS / ISSUES / FAIL
- Food-safety temps = 135F hot / 41F cold? (140/40 = CRITICAL)
- Facts current; regulatory content tied to the right authority?
- Notes:

**A2. Operator-actionability** - PASS / ISSUES / FAIL
- Passes "specific enough for a cook to act on tomorrow"?
- Right altitude for class; readable by hourly/ESL?
- Notes:

**A3. Completeness, status honesty & actuals** - PASS / ISSUES / FAIL
- Placeholders clearly visible; doc not falsely advanced toward Live?
- **Is the doc thin where it should be specific?** What operational ACTUAL is missing? (-> Actuals Needed register)
- Notes:

**A4. Format & metadata integrity** - PASS / ISSUES / FAIL
- STD-001 compliant; correct format for class (POL condensed; PB/SOP TOC + version history)?
- Notes:

**A5. SousAI-readiness (new in v2)** - PASS / ISSUES / FAIL
- **Template-as-canonical risk?** Any example/specimen/fill-in content that could be retrieved as real policy? (STD examples, all TPL docs.) -> mark non-canonical:
- **Chunking-readiness?** Real heading hierarchy (true `HEADING_1..6`, not bold) that will survive docx -> Google Doc conversion? Multi-section doc without it = will chunk as one blob:  YES / NO / N/A (short form)
- **Number hygiene?** Any figure/date/dollar that is a placeholder, example, or unverified estimate Sous might quote as fact? List:

---

## Part 3 - Library-level checks for this doc

**B. Cross-references**
- Every Related Documents entry resolves to a real doc, accurate status? yes / no - list breaks:
- Every inline Document-ID reference resolves? yes / no - list breaks:
- **Any reference to a RETIRED doc?** no / YES (CRITICAL) - list:
- Orphan (nothing points to this doc)? no / yes
- **Relationship edges to record** (for `document_relationships`): from -> to, rel_type (references / implements / supersedes / superseded_by / derived_from / related):

**C. Contradiction check** - does this doc disagree with another on a shared fact? (temps, OT-paid, sick accrual, menu approver, FT threshold, retention home, etc.)
- No conflicts / Conflict(s) found (CRITICAL) - the fact, this doc + section, the other doc + section, which is correct:

**D. Terminology & convention**
- "People Operations" vs "Human Resources" instances:
- Role/triad terms, brand-promise wording, financial-model names consistent?
- "Galley as system of record" present? (should be generic):

**E. Legal-review flag** - any legal-adjacent content or hard legal number?
- No / YES -> flag for counsel (do not rule). What needs a lawyer's eye, and why:

---

## Part 4 - Findings (severity-tagged, each citing a section)

| # | Severity (CRITICAL / MAJOR / MINOR) | Section | Finding | Fix | Actual needed from Kevin? |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |

---

## Part 5 - The OPD catalog row (finalize in Pass 5 - this is what gets written)

| Field | Value | Notes |
|---|---|---|
| `id` | | stable, `PREFIX-NNN` (POSTER -> class POST) |
| `title` | | |
| `doc_class` | | one of the 10 |
| `shelf` | | Safety / Operations / HR & People / Culinary / Brand & Standards / Finance / Site & Client |
| `status` (OPD enum) | | Placeholder / Pending / Draft / In Build / Blocked / Live / Retired - map per Charter §6 |
| `version` | | **required for Live** |
| `card_line` | | **required for Live** - one line, floor-first, operator words. Write it; most docs lack it. |
| `summary` | | longer paragraph; SousAI signal |
| `keywords` | | operator vocabulary; SousAI signal (array) |
| `owner` | | role title, never a name |
| `approver` | | role title |
| `audience` | | operator / corporate / internal |
| `classification` | | default "KitchFix Internal" |
| `source_drive_id` | | Drive file ID (not URL) |
| `source_drive_id_es` | | only for bilingual posters |
| `pinned` | | float to top of shelf? (pick 1-2 per shelf) |
| `critical` | | safety-critical styling? |
| `print_required` | | POST class |
| `sort_order` | | within-shelf order |

---

## Part 6 - Live-readiness pre-flight (the gate)

- `version` present? yes / no
- `card_line` present? yes / no
- `source_drive_id` present? yes / no
- Drive file **shared with the service account** (Viewer) and renders in test iframe? yes / no / not checked
- `owner` + `approver` present? yes / no
- summary + keywords present (SousAI)? yes / no
- chunking-readiness confirmed (heading hierarchy)? yes / no / n/a
- **Blocks to Live:** (list anything "no" above)

---

## Part 7 - SME / actuals needed

- SME required: none / Britt (Culinary) / Sebastian (Accounting) / HR (Mariela) / Counsel / Other:
- What they must provide:
- Operational actual needed from Kevin (the thing CC cannot invent):

---

## Part 8 - Verdict (the upload gate)

- **READY** - clean; revised; Live-ready; chunking-ready; can go into catalog + corpus.
- **READY PENDING SME** - sound, blocked only on the SME/actual in Part 7.
- **NOT READY** - has Critical/Major issues to fix first.

Multi-pass note (did Pass 4 re-audit confirm no new conflict after revision?): confirmed / pending / n/a
One-line rationale:
