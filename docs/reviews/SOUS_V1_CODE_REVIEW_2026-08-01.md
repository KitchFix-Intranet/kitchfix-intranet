# SOUS_V1_CODE_REVIEW_2026-08-01

Read-only code-side design review of Sous V1 at `dfcce5e`. Two QA rounds
(pre-flight + bundle) landed on top of this in the polish-pass prompt
(`fix/sous-pra-v1-polish`); the review below is what the polish prompt
consumed. Evidence-labeled `[ran]` (probe against PG) or `[code-read]`.

## Completeness map (Parts 1-11 of the review protocol)

| Part | Scope | Coverage |
|---|---|---|
| 1 | Composer + submit path (DR-01) | full [code-read] |
| 2 | Freshness / two clocks (DR-02) | full [code-read + grep] |
| 3 | mdLite gaps (DR-03) | full [code-read] |
| 4 | Vendor count provenance (DR-04) | full [ran + code-read] |
| 5 | Partial reason plumbing + base rate (DR-05) | full [code-read + ran] |
| 6 | Agent trajectory + done envelope (DR-06) | full [code-read] |
| 7 | Example-prompt wiring (DR-07) | full [code-read] |
| 8 | Dash sweep (DR-08) | full [ran across src/] |
| 9 | Tables (DR-11/12) | full [code-read] |
| 10 | Reduced-motion coverage | full [code-read] |
| 11 | Aria / keyboard / live-region / failed-state | full [code-read] |

## DR confirmations (chat's visual -> code evidence)

| DR-ID | Verdict | Evidence |
|---|---|---|
| DR-01 | confirmed | Composer doesn't clear on submit - `SousSurface.js:129-195` clears trail/answer/tags but never `setQuestion("")` |
| DR-02 | confirmed | Two clocks (server UTC vs client local) + raw ISO leaks into prose from every SC/spend tool's `loaded` field |
| DR-03 | confirmed | mdLite pipeline is escape -> bold -> tables -> lists -> line-breaks. No heading/hr/italic/code/link/blockquote pass. Dead `.sa-answer-body h2, h3` selector at `sous.css:567` |
| DR-04 | partially confirmed | Chip 41 vs tool 42 - 1-off on the surface but the two numbers define "vendor" differently; only coincidentally close |
| DR-05 | confirmed | Route done envelope drops `flags` + `truncated` from agent - UI can't explain PARTIAL |
| DR-06 | confirmed | Error rendered in plain `.sa-answer-body <p>` with no `role="alert"`, no icon, no distinct color |
| DR-07 | rejected | `onExampleClick(q) -> setQuestion(q); submitAsk(q)` - working |
| DR-08 | confirmed clean in Sous scope | 0 em/en dashes in `src/app/sous/**`; 5 user-facing hits in Playbook host |
| DR-11 | confirmed | `th` has `white-space: nowrap`, `td` no right-align for numeric, no zebra |
| DR-12 | confirmed | Between 1024 and 1520 the content column is tight and `th` nowrap forces horizontal scroll |
| DR-15 | confirmed | :focus-visible on 3 classes, missing on 7 |
| DR-16 | confirmed | Only breakpoints are `max-width: 767` and `max-width: 1023` - nothing between 1024 and 1519 |
| DR-17 | confirmed | Reduced-motion suppresses only load-sequence + pulse; 7 transition-bearing classes still animate |
| DR-18 | confirmed | Source card renders `docId` in both id-chip AND title (title dead) |
| DR-19 | confirmed | Hero freshness chip is inline text, not `sc-chrome-bar-asof` pattern |
| DR-21 | not in scope | Sous has no scroll-top FAB |
| DR-22 | confirmed | `--accent-sous #0891B2` on white measures 3.6:1 - passes for graphical / large text, needs audit for body-text uses |

## CODE findings (net-new)

### P1
- **CODE-02** Focus-visible coverage patchy across primary controls (7 classes bare)
- **CODE-03** Error state indistinguishable from a real answer
- **CODE-04** Composer never clears; Enter can double-fire the last question
- **CODE-05** `flags` and `truncated` from the agent are dropped by the route
- **CODE-06** Tool payloads leak raw UTC ISO into prose (11 hits across 4 files)

### P2
- **CODE-07** Reduced-motion cover incomplete
- **CODE-08** Source card title is the id
- **CODE-09** `<article aria-live="polite">` wraps the whole card
- **CODE-10** `th` nowrap + no responsive column strategy
- **CODE-11** No breakpoint between 1024 and 1520

### P3
- **CODE-01** 5 em-dashes in Playbook host
- **CODE-12** Dead selector `.sa-answer-body h2, h3`
- **CODE-14** Session rail time uses client wall clock, no timezone label

## Part 4 - vendor count SQL side-by-side [ran]

Chip: `SELECT count(*) FROM vendors WHERE deleted_at IS NULL` → 41

Tool: paginated aggregation over `ai_line_items` YTD, distinct on `vendor_name`, corrections-resolved via `v_invoice_submissions_current` → 42

Difference: chip counts every canonical vendor row regardless of YTD
activity; tool counts distinct `vendor_name` strings appearing in
line items. Coincidence that they land close.

**Note:** the Part 6 pre-flight probe (2026-08-01) corrected this. All
four "orphan" strings I flagged (`Cozzini Bros`, `Cozzini Brothers`,
`Freshpoint`, `Samuels Seafoos`) already exist in `vendor_aliases` and
every target row in `ai_line_items` resolves correctly via
`vendor_id`. My original probe queried `.select("alias")` when the
column is `alias_text`, silently returning zero matches. The polish
pass folded `spend_top_vendors` to aggregate by `vendor_id` and swapped
the first-run Spend chip to the same code path; both now return 38.

## Part 5 - status distribution, last 14 days [ran]

| status | n | % |
|---|---:|---:|
| grounded | 32 | 43.8% |
| partial | 17 | 23.3% |
| declined | 24 | 32.9% |
| error | 0 | 0.0% |
| TOTAL | 73 | 100% |

56.2% of asks are not fully grounded. The reason chip landed in the
polish pass with the U9 fallback text.

## Riskiest three (most likely to bite users first)

1. **CODE-05** PARTIAL/DECLINED pills with no reason on 56% of asks
2. **CODE-06** Raw UTC ISO leaking into answer prose
3. **CODE-04** Composer never clears - silent double-submit vector

All three fixed in the `fix/sous-pra-v1-polish` PR.
