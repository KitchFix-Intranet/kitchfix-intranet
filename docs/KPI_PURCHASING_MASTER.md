# KPI PURCHASING - MASTER SCOPE DOC
# v2 - 2026-08-18. Supersedes v1 (which assumed Invoice Capture was the primary source).
# Status: PHASE 0 CLOSED 2026-08-18. All sources confirmed by live pull. Phase 1 spec issued.

---

## 1. THE HEADLINE

**bill.com is the source of record for purchasing, not Invoice Capture.** This is a change from
v1 of this document and it was settled by measurement, not preference.

FY2026 spend, bill.com vs Invoice Capture:

  site            bill.com    inv capture    ratio
  STL - FL         854,091        338,946     2.5x
  TBJ - FL         714,911        225,411     3.2x
  TBR - FL         549,610        158,815     3.5x
  TXR - AZ         372,002        136,813     2.7x
  CIN - AZ         362,764        123,224     2.9x
  STL - MO         339,048        331,764     1.02x
  TXR - TX - H     253,554        241,972     1.05x
  CIN - OH         187,300        184,922     1.01x
  TXR - TX - V     103,119         94,238     1.09x
  CIN - KY          58,714              0        -
  TBJ - NY          40,310              0        -

Invoice Capture is missing 60-70% of spend at the large food sites and 100% at two MiLB sites.
The sites where the two agree are precisely the ones that appeared "over budget" in the earlier
analysis - that was not overspending, it was the only places where capture was complete.

bill.com FY2026: **3,367 bills, $4,107,886**, of which $269,861 is CORPORATE and $1,533 is a
CHICAGO legacy class - both excluded from all site and aggregate roll-ups.

---

## 2. WHAT IS SOLVED, WHAT IS BLOCKED

### 2.1 SOLVED - site attribution
`accountingClassId` on each bill line maps 1:1 to our sites. Verified independently by vendor
name suffixes (Sysco JUP, Sysco TBR, Shamrock REDS, Creation Gardens CINN, Creation Gardens
LBAT, Sysco TBJ-BUF), so we have two agreeing signals and can validate one against the other.

  cls01XDVUJNKWWE718yt  STL - FL          cls01GKCFIDLEGD46sa7  TXR - TX - H
  cls01MJNJVUSTRT46sa5  TBJ - FL          cls01HQLOOGQSHY6pqrj  CIN - OH
  cls01FITMWDEUUS4yjvx  TBR - FL          cls01LVIFFEPKYQ6k3i7  TXR - TX - V
  cls01HJFZJLQFXD5ezf3  TXR - AZ          cls01TVGQFCHAZW6lfo4  CIN - KY
  cls01LIGHCBKRZC50y8m  CIN - AZ          cls01GVPEPCCGSM46sa6  TBJ - NY
  cls01XGEJEVHCCR6sne7  STL - MO          cls01JPNBTZOZZH46saa  CORPORATE  (EXCLUDE)
                                          cls01TPHLWNLIDR471s9  CHICAGO    (EXCLUDE)
Only 1 bill of 3,367 carries no class, and $1,069 is unmapped. Treat both as an exception
bucket, never silently dropped.

### 2.2 SOLVED (08-18, Josh's unlock) - GL category attribution
/billcom/chartofaccounts is live. `accountNumber` IS our GL number - the mystery account holding
45% of spend is 3200.1 General Food. All 59 FY2026 account ids resolve. bill.com is not coarser
than the P&L; it is the P&L. FY2026: P&L COGS 2,167,762 · reimbursable 1,743,985 · SG&A 130,608.
/billcom/classes confirms the site map 13/13. /billcom/bills/filtered gives server-side date
filtering (v2 envelope). The contingency in 2.3 is retired. Original blocked note kept below
for the record.

### 2.2 (original, superseded) - GL category attribution
Bills carry `chartOfAccountId`, but the reference endpoints (`/billcom/chartofaccounts`,
`/classes`, `/departments`) all return 403, so the IDs are opaque.

I attempted to bootstrap the mapping by matching bills to Invoice Capture on invoice number +
amount and inheriting the coded GL. It works for small accounts and FAILS for the large one:

  0ca01MPFELOZTC15ptx8 -> 3400.5 Linen   13/13 clean
  0ca01GULTJRSFZF7t2tq -> 5013.1          9/9  clean
  0ca01BLSBGONTTKiqgos -> $1,865,302 = 45% of ALL spend, spans 8 sites, and its overlap
                          distributes across 3200.1, 3400.1, 3400.2 AND 1381

That is not noise. **bill.com's chart of accounts is coarser than our P&L line codes** - one
generic account absorbs what Invoice Capture splits into Food, Packaging, Supplies and
Reimbursables. Until we can read the account names we cannot know whether the other 58 accounts
map cleanly or whether the coarseness is systemic.

ACCESS REQUESTED FROM JOSH (pending): read-only GET on `/billcom/chartofaccounts`,
`/billcom/classes`, `/billcom/departments`. Also asked whether server-side date filtering can be
enabled on `/billcom/bills`.

### 2.3 CONTINGENCY IF THE CHART OF ACCOUNTS IS GENUINELY COARSE
If the account names confirm bill.com cannot distinguish Food from Packaging from Supplies, the
architecture becomes a HYBRID and the doc will be revised again:
  - bill.com provides TOTAL purchasing spend per site per period - complete and authoritative;
  - Invoice Capture provides the CATEGORY MIX for the invoices it does hold;
  - the board reports total spend from bill.com and applies the observed category mix to the
    remainder, clearly labelled as an estimate, OR reports categories only for the covered
    portion with an explicit coverage figure.
  I would not build the estimate version without Kevin ruling on it - an inferred category
  split on a bonus-bearing KPI is a bad idea unless everyone understands what it is.

---

## 3. OTHER FINDINGS FROM THE bill.com PROFILE

  - PAGINATION. No date filter. `sort` returns 400, `filters` 422, `startDate` is ignored. BUT
    the page token is base64 of `start=N`, so we can seek directly. Archive runs to index
    ~43,768; FY2026 begins near 40,000. A nightly sync should seek to a stored high-water mark
    rather than walking from 2014.
  - PAYMENT STATUS. 2,614 PAID · 727 UNPAID · 26 SCHEDULED. Decision needed (6.1): does the
    board count bills when INVOICED or when PAID? Accrual says invoiced; cash says paid. The
    P&L is accrual, so invoiced is almost certainly right - but 727 unpaid bills is real money
    and the choice must be stated on the board, not buried.
  - APPROVAL. 3,347 APPROVED of 3,367. Near-total, so approval state is not a useful filter.
  - ENTRY LAG. invoiceDate to createdTime: median 6 days, p90 16 days, max 157. So a period
    keeps accruing bills for roughly two weeks after it closes. The board must show a period as
    provisional until the lag window has passed - the direct equivalent of labor's "hours land
    before dollars" problem.

---

## 4. WHAT DOES NOT CHANGE

  - Tabs become Overview · Labor · Purchasing · P&L. Other COGS, Revenue and P&L roll into
    Overview later and are not in this build.
  - The shell stays: blue command bar, portfolio rail, SYSTEM strip, range selector, the V30
    house scale, the lane system, the literal-count gate.
  - The full P&L budget is ALREADY in `kpi_budgets` - 4,511 rows, 32 line codes, every
    purchasing category. No budget-loading work exists in this project.
  - Layout must be CATEGORY-ADAPTIVE. Budgeted purchasing categories per account range from 1
    (STL - FL) to 8 (TBJ - FL). Render a card per category with a budget or spend in range;
    omit the rest, same discipline as labor's V8-19.
  - Two archetypes: FULL P&L (bonus tied to budget - needs pace, forecast, variance) and
    PASSTHROUGH (STL - FL, STL - MO, CIN - OH - cost billed to client, needs stewardship
    tracking). TBJ - FL is genuinely MIXED: $145,745 P&L alongside $79,419 reimbursable.

---

## 5. INVOICE CAPTURE'S ROLE AFTER THIS

It is no longer the spend source, but it is not redundant:
  a. CATEGORY GRANULARITY - it is currently the only system that knows Food vs Packaging vs
     Supplies vs Reimbursable at the line level.
  b. REAL TIME - chefs submit on receipt; bill.com sees a bill days later. Median lag 6 days.
  c. LINE ITEMS - `ai_line_items` (19,848 rows) drives vendor comparison and food-category
     analysis that bill.com cannot support.
  d. OPERATIONAL COMPLIANCE - "which sites are not submitting" remains a real KPI, and the gap
     between bill.com and capture is now measurable per site. That gap becomes a metric.

---

## 6. OPEN QUESTIONS

  6.1 INVOICED vs PAID. Does purchasing spend count on invoice date (accrual, matches the P&L)
      or payment date (cash)? My strong lean: invoice date, with unpaid shown separately.
  6.2 PERIOD PROVISIONALITY. Given a 6-16 day entry lag, how long is a period "provisional"?
      Proposal: mark a period provisional until 16 days past its end, then final.
  6.3 PASSTHROUGH TREATMENT. Same board with "billed to client" language, a reduced board, or
      reimbursable GL codes treated as the budget lines? TBJ - FL needs both regardless.
  6.4 CATEGORY MIX ESTIMATION - only if 2.3 comes to pass. Do we ever infer a category split,
      or only report categories for the covered portion?
  6.5 THE LABOR BUDGET FLAT-LINE. STL - FL's labor budget sits at exactly 21,761.40 for P5-P9
      against ~38-41k actual. If the 2026 seed flat-lined labor it may have flat-lined
      purchasing too. Needs Sebastian to confirm the whole seed.
  6.6 RIPPLING SPEND - SOLVED (spike PR #705, verdict B). `spend_transaction_line_item_zo`
      returns real line items NOW: amount, category, department, work_location, GL flags, and
      the merchant name via FK. The parent transaction object is blocked by a Rippling-side
      model bug (400: `Field with name purchase_location not found`) - a support ticket, not a
      scope. QBO is NOT a route: the proxy blocks Purchase/Bill/JournalEntry/Account/Vendor.
      DECISION: card spend is a nightly sync of the line-item object in the existing Rippling
      job; the scheduled-report email lane is demoted to a backstop for parent-only fields
      (status, memo, posted date). Architecture in RIPPLING_SPEND_ARCHITECTURE.md. Acceptance
      test: CIN - AZ 5006.1 / 5016.6 card spend appears in the first sync.
  6.7 REFRESH. bill.com needs a nightly sync (high-water-mark seek). Invoice Capture is already
      live in Postgres. Confirm: nightly for bill.com, live for capture?

---

## 7. SEQUENCE

  PHASE 0 - INVESTIGATION (in flight, no UI)
    0a. [BLOCKED ON JOSH] chart of accounts -> GL line code mapping. Decides the architecture.
    0b. Rippling Spend - DONE. Line-item object reachable; nightly sync it is. Kevin files the
        Rippling ticket for the parent object. Email report stays as backstop.
    0c. Confirm the 2026 budget seed is sound across all lines, not just labor (6.5).
    0d. CC audit of Invoice Capture: submission lifecycle, what `sent` / `corrected` /
        `returned` / `deleted` mean for inclusion, and how corrections avoid double-counting.
        Also: reconcile capture against bill.com per site to formalise the coverage metric.
  PHASE 1 - DATA LAYER
    A bill.com sync into Postgres (nightly, high-water-mark seek), a normalised
    `purchasing_actuals` table keyed by site + period + GL line, and a purchasing route
    mirroring the labor route. Probes: site totals reconcile to bill.com; aggregate equals sum
    of members; CORPORATE and CHICAGO excluded by construction; no double-counting.
  PHASE 2 - BOARD
    Spend card, adaptive category row, coverage/confidence card, period and week table.
  PHASE 3 - DRILL-DOWNS
    Vendor comparison and food-category analysis from `ai_line_items`.
  PHASE 4 - OVERVIEW
    Labor + Purchasing + Revenue + Other COGS roll-up.

---

## 8. WHAT I AM NOT PROPOSING

No new tooling. No changes to the shell, the scale, or the labor board. No design work until
section 6 is ruled and 0a is unblocked. No Overview or P&L tab in this project.
