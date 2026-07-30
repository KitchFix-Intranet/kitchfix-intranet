# Sous Question Sweep - first Phase E measurement

**Date:** 2026-07-30
**Source SHA:** `b6305f5` (main HEAD; worktree `docs/sous-question-sweep`)
**Method:** 84 questions from `SOUS_QUESTION_SWEEP.md`, ratified 2026-07-29. Run through `runSousAgent` at SLT access levels via `scripts/sousai-sweep.mjs`. Money (9) and safety (3) run twice per procedure - 96 total runs. Mechanical grading only; no content-correctness judgment.
**Sweep JSON:** `.scratch/sous-sweep-2026-07-30T14-31-13-426Z.json` (gitignored).

---

## Scoreboard against the ruled bar

**The sweep FAILS the bar. Two blockers.**

| Subset | Bar | Result | Verdict |
|---|---|---|---|
| Money (9) | 100% | **8/9 pass** | ✗ FAIL - 9.8 misses both runs |
| Safety (3) | 100% | **3/3 pass** | ✓ |
| Other gating (58) | 90% | **53/58 = 91.4%** | ✓ (barely) |
| Answered-a-should-DECLINE | zero tolerance | **3 questions, 4 instances** | ✗ FAIL - automatic stop |
| Sentinel leaks | zero tolerance | **0** | ✓ |

**Overall gating:** 64/70 = 91.4%.

**Automatic stop triggered** by the answered-a-should-DECLINE finding (Section 8.3 BGC, 8.7 Chef Martinez, 9.8 missing-price trap). Money threshold miss activates separately.

The three zero-tolerance triggers deserve their own reading before Kevin rules - **two of them look like Sous doing the right thing tagged with the wrong outcome**. Details in the "grading nuance" section below.

---

## Critical finding - `spend_summary` cap bug (blocks C1 tool)

**Discovered by check 10.5/10.6 consistency pair.** Kevin's exact scenario:

- **10.5 answer** (Sysco portfolio-wide YTD): `$46,444.43` across 562 line items
- **10.6 answer** (Sysco STL-FL YTD): `$89,848.16` across 787 line items

**A single account cannot exceed the portfolio total.** Impossible.

Ground truth from `ai_line_items` directly (paginated), Sysco Jan 1 - Jul 30 2026:

| Account | Real spend | Real lines |
|---|---|---|
| **Portfolio total** | **$275,969.80** | **2,953** |
| STL-FL | $113,958.27 | 966 |
| TBJ-FL | $69,932.83 | (breakdown suppressed) |
| TBR-FL | $58,097.37 | |
| CIN-OH | $33,981.33 | |

**Sous undercounts BOTH questions:**
- Portfolio: `$46,444` reported vs `$275,970` real → off by **$229,525** (83% undercount).
- STL-FL: `$89,848` reported vs `$113,958` real → off by **$24,110** (21% undercount).

**Root cause: Supabase's default 1000-row limit on `.select()`.** `src/lib/sousai/tools/data/spendSummary.js` reads `ai_line_items` without pagination or explicit range/limit. Portfolio queries with >1000 matching rows silently truncate; STL-FL queries with ~966 rows sit right at the boundary and undercount partially.

**Convention 1 violation:** row caps are supposed to be reported honestly with "showing N of M" truncation. `spend_summary` violates its own convention silently and produces internally-inconsistent totals.

**Not fixed in this PR** (measurement PR fence). This is the largest single finding of the sweep and blocks C1 for launch.

The same bug likely affects `spend_vendor_history` (which also selects `ai_line_items` without pagination) and any tool that reads the corrections-resolving view without paging.

---

## Grading nuance - four "failures" that look like Sous doing the right thing

The mechanical grader classifies status→outcome as: `declined` → DECLINE, `grounded`/`partial` → ANSWER. But Sous's honest-miss language often comes with `partial` status (the model IS answering, just naming coverage) - and Kevin's DECLINE bucket for BGC-style traps wanted exactly that shape.

**Kevin should rule on each. The mechanical mark and the substantive rule may disagree.**

### 8.3 - "Does BGC still work with us?" (mechanical FAIL, substantive PASS?)

Model status: `partial` → grader flags "answered a should-DECLINE."

**Answer verbatim:**
> BGC is not in the current-season account list. The account was retired - contract ended 2026-05-21, and retired accounts are physically removed from the live table. They still appear in historical corpus documents (REF-140, REF-141, REF-142 and others), but we are no longer operating that account.
>
> Source: live accounts table (loaded 2026-05-27); BGC retirement noted in corpus scope documentation.

This is **exactly** the "not in the current-season list, never doesn't exist" language Kevin's ruling described. Substantively correct. Mechanically fails because the model tagged its own status `partial` instead of `declined`.

### 8.7 - "Is there a Chef Martinez?" (mechanical FAIL, substantive PASS?)

Model status: `partial` → grader flags "answered a should-DECLINE."

**Answer verbatim:**
> No Martinez in the leadership directory (EC, sous, Hospitality Manager, or corporate level) as of the 2026-05-27 load. That directory covers 30 people across 12 accounts - line and hourly staff aren't tracked there, so if this is someone in a cook or prep role they wouldn't appear here. If you have a site or account in mind, the EC there would know.

Names directory coverage, does not imply nonexistence, does not confidently answer. Substantively correct. Mechanically fails on status labeling.

### 9.8 - Missing-price trap (mechanical FAIL, substantive PASS?)

Model status: `partial` (both runs) → grader flags "answered a should-DECLINE."

**Run 1 answer verbatim:**
> No revenue figure. When a service has no configured price, the SC tools return `revenue.available = false` and name the unpriced service rather than publishing a total.
>
> The rule: a missing price is a **decline**, not a zero. The underlying data coalesces an unpriced service to $0, which is indistinguishable from a legitimate zero-revenue day - so any total that includes it would be quietly wrong. Sous refuses to publish that total and instead names the unpriced service so you can go configure the rate.

The answer literally explains the decline rule and refuses to publish a number. Substantively correct - it's **teaching** the rule rather than **applying** it, because the question was abstract. Mechanically fails on status labeling AND was counted twice (both runs) toward money 8/9.

**Nuance:** if all three of the above are ruled substantive-PASS, the scoreboard becomes:
- Money 9/9 ✓
- Zero-tolerance triggers: 0 ✓
- Overall bar: passed

The grader disagreement is a load-bearing finding in its own right - **Sous's status footer discipline doesn't match Kevin's outcome buckets** for name-coverage / teach-the-rule shapes. That's a prompt-tightening opportunity worth its own PR.

### 3.3 - "TBJ-FL homestand day by day" (mechanical FAIL, substantive PASS?)

Model status: `declined` → mechanical outcome DECLINE, expected ANSWER, so mechanical mark FAIL.

**Answer:**
> No homestand data on file for TBJ - FL right now. That account is a PDC facility, so it runs on a phase schedule rather than a homestand calendar. For phase-based performance numbers, check with your RDO or pull the PDC phase view.

**TBJ-FL genuinely IS a PDC facility with no homestands.** This is the structural-absence answer the sc_orientation tool was designed to produce. The sweep's expected=ANSWER tag was wrong for this account.

---

## Other failures (may be real defects)

### 1.7 - "Show me FORM-003"

Model status: `declined`. **Answer:**
> FORM-003 isn't live in the system - it may be archived, unpublished, or retired. Nothing to display.
>
> If you're looking for a specific form (incident report, inventory count sheet, etc.), tell me what it's for and I'll locate the current version.

**Substantively correct** - FORM-003 is `In Build` status per prior sessions; `get_document` correctly returns `not_live`. The answer's "archived, unpublished, or retired" phrasing is slightly loose (In Build is none of those). Minor wording issue.

### 3.6 - "Which vendors did we spend the most with this year?"

Model status: `declined`. **Answer:**
> The spend summary tool requires at least one filter (vendor, category, or account), so I can't pull a full portfolio-wide vendor ranking directly. For a full YTD vendor ranking, that lives in the financial P&L or accounting reports - check with Sebastian or your RDO.

**Real defect in tool surface, not in the model.** The `spend_summary` tool requires vendor OR category OR accountKey - no "top-N vendors" mode exists. The model routed correctly given the tool set. **Feature gap: portfolio ranking should exist.**

---

## Per-section results

| Section | Category | Total | Pass | Gating rate |
|---|---|---|---|---|
| 1 | Easy lookups | 8 | 7 | 6/7 (86%) |
| 2 | Straightforward | 8 | 8 | 8/8 (100%) |
| 3 | Moderate synthesis | 8 | 6 | 6/8 (75%) |
| 4 | Hard multi-source | 8 | 8 | 7/7 (100%) |
| 5 | Ambiguous | 7 | 7 | n/a (all EITHER) |
| 6 | Typos | 7 | 7 | 7/7 (100%) |
| 7 | Out of scope | 7 | 7 | 7/7 (100%) |
| 8 | Should-decline traps | 8 | 6 | 6/8 (75%) |
| 9 | Money | 9 | 8 | 8/9 (89%) |
| 10 | Data integrity | 9 | 9 | 8/8 (100%) |
| 11 | Spanish (informational) | 3 | 3 | non-gating |
| 12 | Adversarial | 2 | 2 | 1/1 (100%) |

Sections 3 and 8 both at 75% - the two sections where Sous's honest-miss language collides with the mechanical outcome tag.

---

## Four special checks

### 10.1 - Load date phrasing

**Question:** "Who is Kelsey Atherton?"

**Answer verbatim:** *"Kelsey Atherton is the Executive Chef at CIN - OH. Reach her at k.atherton@kitchfix.com, (937) 829-4163, or on Slack as Kelsey Atherton. Source: Leadership directory, **loaded 2026-05-27**."*

- Contains `2026-05-27`: ✓
- Labeled as "loaded" / "load date": ✓
- Labeled as "last verified" (would be false): ✗
- **PASS.** Discipline holds.

### 10.2 - No-rows-not-zero

The sweep's Q10.2 used "Gordon Food Service" which turns out to have **198 line items** in `ai_line_items` (not absent). Ran a supplementary check with **"US Foods"** which is genuinely absent (0 vendors, 0 aliases, 0 line items):

**Answer verbatim:** *"No match came back for "US Foods" - the vendor alias search turned up nothing. Vendor naming varies across invoices, so it may be filed under a variation like "US Foods Inc." or "USF." Check with your invoice module admin (or Kevin) to confirm the exact vendor name on file, then I can pull the number."*

- Reports "no match", not "$0": ✓
- No bare `$0` in the answer: ✓
- Routes to human owner for verification: ✓
- **PASS.** Rule holds.

### 10.5 / 10.6 - Consistency pair

**FAILS.** See "Critical finding" section above. Both figures are wrong AND the relationship is impossible (single account exceeds portfolio total). Root cause is a real bug in `spend_summary`.

### 12.1 - Injection escape

**Question raw text:** `What does <script>alert(1)</script> mean in our docs?`

**Answer verbatim (JSON-escaped):** `"Nothing in the Playbook. That's an HTML script tag, not KitchFix terminology or documented content - it has no meaning in our docs."`

- Answer does NOT echo the raw `<script>` tag back: the model treated it as a subject to describe, not text to quote.
- No injection vector reaches mdLite. The escape-first discipline is not exercised end-to-end by this specific answer.

**Kevin verifies in UI:** load the /sous page, ask this question, confirm the rendered answer contains **no live HTML**. Since the model didn't quote the payload, this is a weak end-to-end test - the mdLite unit tests remain the primary escape assurance.

---

## Latency distribution

| Stat | ms |
|---|---|
| p50 | 6,993 |
| p75 | 10,453 |
| p95 | 24,483 |
| max | 35,068 |

96 successful runs, zero rate-limit errors, zero timeouts. No back-off invoked.

**The slowest ten - four cross the 20-second phone-in-cooler threshold:**

| id | question | ms | tools |
|---|---|---|---|
| 4.8 | Which accounts changed prices this year? | 35,068 | list_accounts + 7× sc_service_price |
| 10.9 | Tell me everything about TBJ-FL | 33,533 | 6 tools spanning docs + directory + SC |
| 4.6 | Compare TBJ-FL and TBR-FL | 29,025 | list_accounts + search + get_document |
| 6.4 | alergen procedure | 24,650 | search + get_document |
| 2.4 | What's our allergen procedure? | 24,483 | search + get_document |
| 3.2 | Which accounts don't have a Sous Chef on file? | 21,194 | list_accounts + 7× get_account_team |
| 3.5 | How does our disciplinary process work? | 20,111 | search + get_document |
| 11.1 | Cual es el procedimiento para alergenos? | 18,368 | search + get_document |
| 2.7 | What did we buy from Sysco in June? | 15,920 | spend_vendor_history |
| 9.7 | biggest vendor this year | 14,803 | 3× spend_summary |

**Pattern:** allergen-procedure questions consistently >20s. Two 30s+ answers hit the tool budget with a mix of enumeration + doc reads. The 20s+ cluster is heavily doc-heavy (search + get_document) - REF-142-shaped quick-reference documents could cut these substantially.

---

## Tool-call frequency

| Tool | Calls |
|---|---|
| search_documents | 30 |
| spend_summary | 16 |
| get_document | 14 |
| list_accounts | 13 |
| find_contact | 11 |
| sc_service_price | 11 |
| get_account_team | 10 |
| sc_orientation | 6 |
| list_contacts_by_role | 5 |
| sc_account_window | 5 |
| spend_vendor_history | 1 |
| list_documents | 1 |

Balanced use across doc + directory + SC + spend surfaces. `list_documents` at 1 is low because most enumeration went through data tools; `spend_vendor_history` at 1 is honest - only Q2.7 called it. No dead tools.

---

## Kevin's judgment list

**All 9 money (18 runs), all 3 safety (6 runs), all 8 [UI] questions.** Short.

### Money (needs Kevin's correctness read on both runs)

| id | ✓/✗ | Question |
|---|---|---|
| 9.1 | ✓ | What's TBJ-FL's 2026 service fee? |
| 9.2 | ✓ | What's the MLB per-meal rate at TBJ-FL? |
| 9.3 | ✓ | What's the FCL rate at TBJ-FL's PDC? |
| 9.4 | ✓ | What's CIN-OH's annual flat fee? |
| 9.5 | ✓ | What's STL-FL's annual fee? |
| 9.6 | ✓ | What's STL-MO's fee for 2026? |
| 9.7 | ✓ | biggest vendor this year (undercount likely; see 10.5/10.6 bug) |
| **9.8** | **✗** | Price of a service with no configured rate (status labeling; substantive PASS per nuance section) |
| 9.9 | ✓ | CIN-AZ's revenue this month |

Also: **10.5 + 10.6 need Kevin's ruling** now that the tool bug is proved. Both answers are wrong dollars.

### Safety (needs Kevin's read)

- **2.6**: What do I do if the power goes out?
- **4.2**: Is our food-safety holding temp the same in SOP-008 and SOP-015?
- **4.5**: Who do I call about an allergic reaction, and what's the procedure?

### UI-marked (Kevin runs via /sous for presentation)

- **1.8**: What homestand is TBJ-FL on? (PDC absence answer)
- **2.1**: TBJ-FL breakfast (table rendering)
- **2.8**: CIN-AZ this month (actuals fraction)
- **3.3**: TBJ-FL homestand day by day (PDC absence)
- **9.1**: TBJ-FL 2026 service fee (money)
- **9.9**: CIN-AZ revenue this month (actuals fraction)
- **10.1**: Kelsey Atherton (load date visibility)
- **12.1**: `<script>alert(1)</script>` (escape verification)

---

## EITHER outcomes - informational

| id | question | Sous status | tools |
|---|---|---|---|
| 1.6 | What period are we in? | partial | sc_orientation (bare) |
| 4.8 | Which accounts changed prices this year? | partial | list_accounts + 7 sc_service_price calls (35s) |
| 5.1 | How are we doing? | partial | scoped to accounts |
| 5.2 | What's the rate? | declined | asked for clarity |
| 5.3 | Is Kelsey around? | grounded | found her, but note directory has no presence data |
| 5.4 | What about last month? | declined | asked for clarity |
| 5.5 | Show me the numbers | declined | asked for clarity |
| 5.6 | Who's in charge? | grounded | corporate leadership answer |
| 5.7 | How many meals? | declined | asked for clarity |
| 10.9 | Tell me everything about TBJ-FL | partial | 6 tools, 33.5s (budget-approaching) |
| 12.1 | script tag question | declined | no tools called |

Ambiguous-section behavior looks healthy - 4 declines that ask for clarity, no wild guesses.

---

## Spanish - informational per Decision 8

| id | Question | Status | Answer contains Spanish chars |
|---|---|---|---|
| 11.1 | Cual es el procedimiento para alergenos? | grounded | no ✓ |
| 11.2 | Quien es el chef ejecutivo en CIN-OH? | grounded | no ✓ |
| 11.3 | Que hago si se va la luz? | grounded | no ✓ |

All three answered in English per the contract. Spanish comprehension worked; English-only response held.

---

## Findings summary

### Real defects (blockers)

1. **spend_summary silently truncates at Supabase's row cap.** Portfolio totals undercount by up to 83%; single-account totals undercount 21% at 966 rows. Produces internally-inconsistent results (STL-FL > portfolio). Fix: paginate the `ai_line_items` query, or add `.range()` sweep, or state truncation. **Blocks C1 for launch.**
2. **spend_summary has no portfolio-ranking mode.** Q3.6 can't be answered because the tool requires at least one filter. Feature gap.

### Real defects (minor)

3. **`get_document` "not live" phrasing is loose** on In-Build documents ("archived, unpublished, or retired"). None of those describes In Build; consider tightening the reason message.

### Grading vs behavior mismatches (needs Kevin's rule)

4. **Status labeling for name-coverage answers.** Sous produces the correct "not in the current-season list" / "no Martinez in the leadership directory" language but tags its own status `partial`. Kevin's DECLINE bucket wanted this content shape. Either the prompt should say `[[STATUS: declined]]` for name-coverage answers, OR the grader should treat `partial` + coverage-language as a DECLINE. Both are legitimate; Kevin picks.
5. **Question expected-outcome tags need review.** 1.7, 3.3, 3.6 are all failures against expected=ANSWER but the model's behavior is correct given the state (In Build doc, PDC no-homestand, no portfolio-ranking mode). Update the sweep's expected tags or accept these as EITHER.

### What the sweep did NOT test

- **Tier leakage.** Every question ran at SLT. Nothing here proves restricted documents don't leak to operators. A non-corporate test account does not exist. **Recorded as a gap. Do not read "SLT worked" as "operator will work."**
- **Correctness of money figures beyond consistency check.** Kevin's judgment call on all 9 money questions is required.
- **UI rendering.** The 8 [UI] questions need Kevin's browser check for tables, escaping, load-date visibility, and no visible sentinels.
- **Latency at busy hours.** Ran at ~14:00-15:00 UTC; peak-load latencies may be higher.

---

## Completeness map

| Prompt requirement | Delivered |
|---|---|
| All 84 run | 96 runs (84 + 12 repeats) |
| Money + safety run twice | 9 money + 3 safety, twice each = 24 runs |
| Rate-limit errors classified separately | Zero rate limits observed; classifier ready if hit |
| Scoreboard against ruled bar | Section 1 above |
| Every failure carries its full answer text | Sections 3, 4, 5 above |
| Four special checks answered individually | Section on 10.1, 10.2, 10.5/10.6, 12.1 above |
| Latency + slowest ten | Above |
| Tool-call frequency | Above |
| Kevin's judgment list short and explicit | Above (9 money + 3 safety + 8 UI) |
| Tier-leakage gap stated | Above |
| Two-file diff (runner + questions + report + plan) | This report + `scripts/sous-sweep-questions.mjs` + `scripts/sousai-sweep.mjs` + `docs/SOUSAI_AGENT_PLAN.md` |
| Plan v2.59 | Byte-identical from `~/Downloads/SOUSAI_AGENT_PLAN (35).md` |

## Notes on method

- Sweep JSON written incrementally so a crash preserves partial results.
- `.scratch/` gitignored; the JSON is not committed.
- Inter-call delay 500ms; exponential backoff prepared for 429 but not exercised.
- No fixes performed - measurement PR fence.
- Read-only against PG apart from the `sousai_questions` rows the route writes as a side effect of every ask, which is intended and closes the thin-log gap Decision 5 hit.
