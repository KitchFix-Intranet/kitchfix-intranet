# KPI PURCHASING - PHASE 2 BUILD SPEC v2

**Supersedes v1 entirely.** v1 was written 2026-08-19 and is stale in ways that would produce the
wrong board - it assumed one account model, three buckets, flat budgets and trustworthy card figures.
All four were wrong.

**Status:** design approved at v10/v11. Build blocked on one open reconciliation, detailed in §11.
**Render:** `kitchfix-kpi-purchasing-v11.html`. **This document wins on every number, rule and edge case.**

---

## 0. PLAIN ENGLISH

- **What this is:** the purchasing board - one period, spend buckets, six detail cards, a drill table.
- **Why it matters:** operators are bonused on food, packaging and vehicle. They cannot see those
  numbers anywhere until the P&L closes.
- **What changed since v1:** the business turned out to be more varied than the design assumed. Three
  accounts bill their food straight back to clients and cannot be judged on it. Budgets are seasonal,
  not flat. Two more spend buckets have budgets already. And card spend had a date bug that made every
  period figure wrong.
- **Size:** larger effort. Four PRs after the reconciliation closes.

---

## 1. ACCOUNT MODELS - READ THIS FIRST

**The single biggest change from v1.** The board does not render the same way for every account.

Source of truth: **`src/lib/accountModels.js`** (PR #733). Not a DB column - `accounts.billing_model`
was bulk-written once in 2026-05 and is unmaintained, which is exactly how a column goes stale.
Changing an account's cost model requires a PR, which is correct: it only happens when a contract is
renegotiated.

| model | accounts | how the board behaves |
|---|---|---|
| **at_risk** | 8 - `CIN - AZ`, `CIN - KY`, `TBJ - FL`, `TBJ - NY`, `TBR - FL`, `TXR - AZ`, `TXR - TX - H`, `TXR - TX - V` | Full design. State pills, pace, red for over. |
| **pass_through** | 3 - `CIN - OH`, `STL - FL`, `STL - MO` | Different board. See §2. |
| **revenue_flex** | **zero members** | Reserved. Deferred to 2027 pending a sales dashboard. |

- `costModelFor(accountKey)` **throws on an unknown key.** Silent defaults are how a new account gets
  a wrong verdict.
- `TBJ - NY` defaults to `at_risk` with an open contract question logged in #730. Visible assumption,
  not a silent one.
- `TXR - TX - V` is `at_risk` on its fixed P&L budget. Revenue-flex deferred by owner ruling
  2026-08-20. Its purchasing exclusion in `V6_ENVELOPE_ACCOUNTS` was a rule inherited from labor and
  is removed - it now resolves budgets from `kpi_budgets` like everyone else.
- **Do not touch labor's `V37_REVENUE_FLEX_ACCOUNTS`.** Separate, working decision.

---

## 2. PASS-THROUGH ACCOUNTS - A DIFFERENT BOARD, NOT A VARIANT

At `CIN - OH`, `STL - FL` and `STL - MO`, food, packaging and supplies are **billed back to the
client**. The client approves overruns and pays for them. Savings revert to the client
(`ACCOUNT_SERVICES_BRIEF.md:187`).

**A reimbursable purchase is a receivable, not a cost.** It never touches the P&L as an expense, which
is why the three COGS buckets read near-zero at these accounts. Measured FYTD:

| account | 32xx | 34xx | 13xx reimbursable |
|---|---:|---:|---:|
| `CIN - OH` | $0.00 | $1,069.51 | $195,484.88 |
| `STL - FL` | $16,652.49 (Fun Money) | $0.00 | $836,819.23 |
| `STL - MO` | $79.80 | $3,624.66 | $335,344.00 |

**Rendering the COGS buckets there produces a board of zeros.** That is correct accounting and a
useless screen.

### 2.1 What these accounts show instead

Buckets built from that account's own `13xx` family:

| `STL - FL` | `STL - MO` | `CIN - OH` |
|---|---|---|
| `1385.3` Food | `1385.1` Food | `1374.1` Reimbursables |
| `1385.3.1` Packaged Snacks | `1385.1.1` Packaged Snacks | `1374.1.1` Packaged Snacks |
| `1385.3.2` Beverages | `1385.1.2` Beverages | `1374.3` Clubhouse Snacks |
| `1385.4` Other | `1385.2` Other | `1374.2` Equipment |

### 2.2 They DO get a verdict - owner ruling 2026-08-20

v1 said no verdict. **That was wrong.** Each account has an **internal budget** KitchFix holds itself
to as a steward of the client's money. Spend renders against it with full state, because the team
reviews it period by period and uses it to decide when a client conversation is needed.

The distinction from at-risk: **it is a management guide, not a bonus line.** The card must say so.

**OPEN:** the internal budget figure is not in the P&L workbooks and not in `kpi_budgets`. Kevin has
it. Needs locating before this can be built.

### 2.3 Fun Money

`STL - FL` `3200.2 Resale Food` is **KitchFix-borne** - $25,000 budget, $16,652.49 spent FYTD. The one
genuinely at-risk number at that account. Full verdict, full state.

The $25,000-versus-$900,000 discrepancy that looked like a data error is two separate money streams,
both correctly recorded.

### 2.4 Not a finding

~$4,774 of `3400.2` at `CIN - OH` and `STL - MO` sitting in COGS is **spend outside what the client is
normally charged** (owner ruling 2026-08-20). Correctly placed. v1's "billable cost absorbed" framing
is retracted.

---

## 3. BUCKETS - FIVE, NOT THREE

| bucket | GL | portfolio FY2026 | notes |
|---|---|---:|---|
| Food | `3200.1`, `3200.2` | ~$2.5M | |
| Packaging & supplies | `3400.1`, `3400.2`, `3400.5` | ~$290K | |
| Vehicle | `3500.2`, `3500.3`, `3500.4`, `3500.5` | $50,130 | only 5 of 11 accounts have a budget |
| **Equipment** | `5002.5` | $60,500 | new, owner ruling 2026-08-20 |
| **Repair & maintenance** | `5002.1` | $22,500 | new, owner ruling 2026-08-20 |

- **There is no `3500.1`.** v1 had this wrong. Vehicle is `.2 Insurance`, `.3 Leased Vehicle`,
  `.4 Fuel`, `.5 Vehicle Repair & Maintenance`.
- Equipment and R&M are `5002.x` **SG&A lines that already carry budgets**. Showing them on the
  purchasing board is a presentation decision, not a chart-of-accounts change. No Sebastian ruling
  needed.
- **Vehicle repairs stay inside R&M** (owner ruling 2026-08-20) - only $3,311.36 of $20,057.27 is
  vehicle. But the card must expose **transaction-level detail** so the team can talk to it. Reuse the
  itemised list pattern from Card purchases (§6.5).
- An account with **no budget and no spend** in a bucket hides that card entirely and drops the column
  from the table. Vehicle **with a budget and zero spend stays visible** - that absence is the signal.
- **Kevin will rule on whether Equipment and R&M stay** after seeing them rendered.

---

## 4. BUDGETS ARE SEASONAL - v1 WAS WRONG

v1 stated budgets were flat and warned that structural variance would look like operator performance.
**Retracted.** Measured from the eleven FY2026 P&L workbooks:

`TBR - FL` food: **$4,100 in P1, $158,555 in P3, $1,225 in P13** - a 129x spread tracking the season.

Budgets are set annually and distributed seasonally per period. The original weekly target is already
right; adjusted does less work than v1 assumed. **No seasonality caveat belongs on the board.**

---

## 5. THE MATH - UNCHANGED FROM v1, STILL LOAD-BEARING

### 5.1 Weekly targets
```
original = period_budget / weeks_in_period
adjusted = (period_budget - spend in FINISHED weeks) / count of weeks NOT finished
```
The running week is **not finished**, its partial spend is **not** subtracted. Subtracting it while
counting the week in the denominator is the double-count that made overspending raise the target.

**Acceptance, printed every build:** overspend in a finished week -> adjusted **falls**. Underspend ->
**rises**. No exceptions.

Finished weeks measure against **original**. Every unfinished week, including the running one,
measures against **adjusted**.

### 5.2 State resolver - one function
```
pace = spent / (budget * elapsed_frac)
> 1.03 -> over    < 0.97 -> under    else -> onpace
no bills at all -> none      no budget -> nobud      pass_through -> passthru
```
Pill, bar pattern, hero colour and every variance readout call the **same** `stateOf()`. Three
elements disagreeing about one bucket is a P0.

- **Period state** uses bills + pending. **Bucket state** uses bills only. They legitimately differ -
  the period reading over while buckets read under is the point of the board.

### 5.3 Pending
```
pending = SUM(amount) of card rows in range with gl_line_code IS NULL
remaining = budget - bills - pending
projected_close = (bills + pending) / elapsed_frac
```
A dollar sum, never a count. **Never split by bucket** - card spend has no GL line, which is the
entire reason it sits outside the buckets.

### 5.4 Fiscal weeks
`weekStartsInRange` from `src/app/kpi/labor/lib/periods.js`. **Do not fork it.**

### 5.5 Period close - owner ruling 2026-08-20
Books close **1 week** after period end. Bills keep arriving for ~16 days (measured p90). **Late bills
roll back into the closed period.** So the board stays **provisional for 16 days** past period end,
even though the books close at 7.

---

## 6. CARDS - approved at v22, 2026-08-21

Layout, top to bottom, **at-risk account**:

| row | contents |
|---|---|
| 1 | Period card - numbers left, week chart right |
| 2-4 | Food, Packaging & supplies, Vehicle - same two-up shape |
| 5 | Equipment + Repair & maintenance - **ledger cards**, two-up |
| 6 | Card purchases + Vendor breakdown - two-up |
| 7 | Table - week band, bill drill |

**Management fee account** replaces rows 1-4 with: management fee card, period card, Reimbursable row
(numbers + ledger). The three bucket cards **do not render** - the category split lives on the
Reimbursable card and repeating it is noise.

### 6.1 Period card
Neutral steel stripe. Hero **Spent**, secondary **Remaining** (or **Vs budget** when closed).
**KPI line only - food, packaging, vehicle.** Equipment and Repair keep their cards but stay off this
card and off its chart; charting a subtotal while headlining a total is how the two came to disagree.

Sub-rows: Bills, Cards, Pending, Projected close. Pills: state + `Provisional` / `Final`.
`Final` renders **neutral steel** - a closed period is neither good nor bad.

### 6.2 Bucket cards
Identity stripe, hero **Spent** coloured by state, secondary **Remaining** / **Vs budget**.
Sub-rows split **From bills** and **From cards**. Right card: four week columns.

### 6.3 Equipment and Repair & maintenance - ledger cards
No chart. Hero, variance, then **every purchase**: vendor, description, amount. At `ALL ACCOUNTS`
each line carries its **account key**. Vehicle repairs stay inside R&M and are flagged, not moved.

### 6.4 Card purchases
Two columns. Stats left - past deadline, due Friday, total pending, `Open Rippling`. Every charge
right, scrolling. **Nothing behind a disclosure** - consolidation is an action people must take.

### 6.5 Vendor breakdown - replaces What you bought and By vendor
One card, four columns: **Vendor** · **Where it landed** · **Spend** · **vs prior**.

"Where it landed" is a split bar - food, packaging, vehicle, other - so a vendor billing into two
P&L lines shows both. At `ALL ACCOUNTS` each row carries its account.

The two cards it replaces sat on different time bases and different sources and neither answered a
question asked in a period review.

### 6.6 Reimbursable
Full-width row: numbers and category split left, **ledger** right, headed `Reimbursable ledger` with
`Reimbursable` in the reimbursable purple so it pairs with its partner card.

Renders **only where the account has reimbursable spend.**

### 6.7 Management fee card
Hero and progress bar on one line, eight-period trend spanning the card beneath.

**No verdict anywhere.** No red, no green, no pass/fail on the charts. The account is not graded -
the client approves and pays for the spend. The card exists so an outlier is visible early.
**The board surfaces; a person decides.** No advisory copy.

### 6.8 Removed
**Invoices**, **Still landing**, **Period by period**, **Consolidation** as a separate card, and the
**What you bought** doughnut as a standalone. Each duplicated something else on the page.


## 7. DESIGN LAW

1. **Colour is identity. Pattern is state.** Food navy `#153968`, Packaging blue `#3E97D1`, Vehicle
   purple `#7A3E9D`, Pending amber hatch, period card neutral steel `#4A6076`. Over-budget adds a red
   diagonal overlay and inset outline. In-progress adds a light hatch. **State is never hue alone.**
2. **One hero per card.** Spent at `--t-hero`, Remaining at `--t-value`.
3. **Bucket hero colour follows state** - green under or on pace, red over, neutral at zero.
4. **Card titles** `--t-meta` / 800 / `--n-700`, matching labor's `.kpi-spend-h-title`.
5. **Arrows only.** No `+` or `-` on any figure.
6. **Cents everywhere**, including exports and tooltips.
7. **`$0.00` means nothing was bought** and reads neutral. **`—` means no budget or no data.**
8. **A week with no spend shows a baseline and says "no spend."** Never a green under-arrow.
9. **Visible legend** covering every mark including patterns.
10. **Shadow and hover on every card.** Visible keyboard focus. `prefers-reduced-motion` respected.
11. **Floor-first.**

---

## 8. CARD SPEND - CORRECTIONS APPLIED (#735)

| fix | effect |
|---|---|
| `txn_date` was `first_seen_at::date` - every row stamped with the sync date | Now ObjectID timestamp **minus 1 day**. Median error 0.0d on a 20-row spot check. **Interim** - real dates arrive with report ingestion, then backfill. |
| Unbounded walk pulled all history | 737 pre-FY parents / $184,714.87 now drop out of FYTD |
| Duplicate split parents | 113 excluded and **counted**, not guessed |
| 148 CAD + 1 EUR summing into USD | Excluded, shown separately. **No conversion** - no FX source ruled. |

**Card FYTD: $2,482,182.29 -> $1,452,776.92.**

Two asserts now gate the sync: superseded splits, and non-USD summing into USD. Both proven to fire on
seeded and real corpus.

---

## 9. WHAT IS STILL OPEN

| # | item | blocks |
|---|---|---|
| 1 | **~5,000 in-window transactions** we hold that Rippling's report does not show. Two CC runs disagree on why. Workbook with Kevin. | card figures |
| 2 | **970 zero-amount parents.** Recommend excluding - likely voided authorisations. | small |
| 3 | **Auth-vs-settlement rule.** Hold until the workbook's Sheet 2 shows whether the report keeps the later of each pair. A blanket rule could delete legitimate repeat orders. | card figures |
| 4 | **Pass-through internal budget figures** - Kevin has them, not in PG. | §2.2 |
| 5 | **Equipment and R&M** - final call after rendering. | §3 |
| 6 | **Friday cutoff week.** | §6.9 |
| 7 | **bill.com vendor sync** in flight. | §6.4 |
| 8 | **52 new category ids** from the unfiltered report, unlabelled. | routing |
| 9 | **#729** labor cent fix, gate failed at 12 rows / $0.18 against limits of 8 / $0.08. Recommend raising and applying. | labor, not this board |

### Watch items - observed once, cause unknown

- **`CIN - OH` `drill=lines` 500.** Seen during G7 on 2026-08-21, **not reproducible** - 22 attempts
  across all 11 accounts, drill and non-drill, all HTTP 200. Determinism checksum unchanged. Both
  `.reduce()` calls in the route already carry seeds, so the originally reported cause does not match
  the code. **No fix landed and none should be fabricated.** Numbering note: #751 is `pr-n audit
  fixes`, a different workstream - the number collided and was briefly mistaken for a drill fix. If
  PR 2's rendering resurfaces it, **capture the stack trace before investigating.**

---

## 9A. ENGINE STATUS - SIGNED OFF 2026-08-21

All seven gates closed. Recorded here because the board is built on top of it.

| gate | result |
|---|---|
| G1 dates | 293 distinct `txn_date` values, spot-check centred on zero |
| G2 reconciliation | $2,482,182.29 -> $1,082,107.32; residual named and bounded |
| G3 categories | 52 of 55 mapped with provenance; every bucket carries real money |
| G4 completeness | routed + unrouted + excluded balances to $0.00 delta, asserted |
| G5 P&L tie-out | every variance named - two accrual timing, one reclass, one rebate |
| G6 vendors | 99.88% resolution; vehicle question closed on a populated field |
| G7 envelope | deterministic across 3 runs, nightly fires the asserts, boundary risk $0.00, P7 tighter than P8 |

**The standard that replaced "ties to the cent":** the engine records **what was spent**; the P&L
records **what was decided**. Sebastian reclassifies, splits or reallocates a few times a year at
Kevin's, Joe's or Josh's request. The two will never tie exactly and should not.
**Every variance must have a name.**

---

## 9B. ONE-SOURCE RULE - THE DEFECT CLASS THAT KEEPS RECURRING

Four separate bugs, one shape: **two things computing the same idea from different inputs.**

1. Adjusted target divided by weeks-remaining-from-today while subtracting the running week's spend
2. The period card charted a KPI subtotal while headlining an all-bucket total
3. The chart shape was hardcoded at 62/38 while pace used 32% elapsed - **two different moments**
4. Closed periods kept a 3% tolerance band while the hero colour compared exactly

**Rule:** every card asserts that its **pill, its hero colour and its chart** derive from one call
before it renders. A disagreement is a defect, not a display choice. This is in §10.

---

## 10. ACCEPTANCE

- **Sentinel:** `TBR - FL` P8 `3200.1` billcom = **$39,373.74**. Any PR that moves it stops.
- **Adjusted-target direction check** printed every build. A RISES on an overspent week is a hard fail.
- **Orphan-selector scan.** Renaming a CSS class silently killed seven rules during design and broke
  the type scale. Any PR touching class names greps compiled CSS for dead scopes.
- **Cents scan.** No rendered dollar without two decimals.
- **State agreement.** Pill, bar, hero and table variance from one `stateOf()` call. Assert it.
- **`costModelFor()`** resolves all 11 keys; unknown throws.
- **Zero employment-status filters** anywhere in the codebase.
- Probes run at **runtime**. "PASS by construction" does not merge.
- **One-source assertion** (§9B). Pill, hero colour and chart from a single call, per card, asserted.
- **Migration grants.** Any migration creating a table carries `GRANT ... TO service_role` **and** a
  verify probe reading `information_schema.role_table_grants`. Five green structural checks preceded
  a 403; a shape check later passed on an empty table. Structure alone proves nothing flows.
- **Post-sync row count.** Any migration landing a table a sync populates verifies `> 0 rows after
  first sync`.

---

## 11. SEQUENCE

**Blocked until §9.1 and §9.3 resolve:** anything that displays card money - Pending, Card purchases,
the compliance card.

**Not blocked:** everything reading bill.com - buckets, budgets, the table, Period by period. That is
the top half of the board and it reconciles.

| PR | scope | gate |
|---|---|---|
| 2 | Shell, period card, bucket cards, legend - **at_risk accounts only** | adjusted-target check, state agreement |
| 3 | Pass-through board shape (§2) | needs §9.4 |
| 4 | Detail cards, table, `/items` route | cents scan, thin/hidden states |
| 5 | Loading + sync-failed states | both reachable, visually verified |
| 6 | Compliance card | §9.6 ruled |

Kevin merges. CC never merges, never self-certifies runtime outcomes, opens the PR in the same turn as
the push.

---

## 12. OUT OF SCOPE, TRACKED

- **Mobile.** No breakpoint exists; `--row` is 36px against a 44px touch target. Own phase, own render.
- **Rippling report ingestion.** Unlocks submission dates, receipts, approval state, real purchase
  dates, USD amounts and category names. One day of work, the pattern already exists for payroll.
  **Not a prerequisite for the board.**
- **Price movement, per vendor.** Same item, same vendor, first-to-latest, with the dollar effect at
  the quantities actually bought. Owner wants this; it is **not** in the board build. Three things
  must resolve first, and each can produce a confidently wrong number in a vendor negotiation:
  1. **Item identity** - `item_number` is 44% null. The card covers a subset and must say so.
  2. **Pack size** - `parsed_pack_uom` is null on all 20,241 rows; the backfill never ran. A vendor
     moving from a 6x5lb case to 4x5lb reads as a 33% price cut.
  3. **Which price** - unit, extended, or net of credits. Catch-weight defects are concentrated in
     Cheney Brothers, GFS and Sysco - three of the top vendors.
  Scoping investigation first, then its own PR. Render exists: `kitchfix-purchasing-additions.html`.
- **Trend sparkline** and **delivery pulse** - rendered and reviewed 2026-08-21, **not wanted**.
- **Vs prior period strip** - belongs above the table like labor's, not in the detail grid.
- **TXR - TX - V revenue flex** - 2027, with the sales dashboard.
- **SG&A dashboard** - after purchasing. Routing already tags it.
- **P&L / Overview** - after SG&A. Structure is Revenue -> COGS -> Gross Margin -> SG&A ->
  Contribution Margin. Labor sits **inside** COGS.
