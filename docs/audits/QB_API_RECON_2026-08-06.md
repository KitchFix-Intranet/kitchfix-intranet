# QB API Recon - Josh's proxy, live read-only survey

**Target repo path:** `docs/audits/QB_API_RECON_2026-08-06.md`
**Authored:** 2026-08-06, Chat-Claude. Every figure below is [ran] against the
live endpoint. **Zero writes were made - GET only. The POST /invoice endpoint
was never touched.**
**Feeds:** the billing arc (§7 of `PROJECT_SCOPE_MASTER.md`), rulings K-1/K-2,
fragility items F-2/F-6/F-7 of `SC_BILLING_PROCESS_REVIEW_2026-08-06.md`.

---

## 1. The access path

- Base: `https://chief.ngrok.app/qbo/` proxying QuickBooks Online's real v3 API
  for company (realm) `1219933770`. Auth: static `X-API-Key` header. Josh's
  proxy holds the Intuit OAuth tokens server-side.
- **K-14 is answered: this is QuickBooks Online.** The response envelope
  (`QueryResponse`, `totalCount`), QBQL query semantics, entity shapes, and the
  K3-series DocNumbers (matching invoice K300168736 cited in the contract
  bible's C-1 evidence) all confirm it.
- Endpoints exposed: GET customer / item / taxcode / invoice / query, plus
  POST invoice. Query endpoint accepts QBQL (`SELECT ... FROM ... WHERE ...
  ORDERBY ... MAXRESULTS n`).
- **Proxy quirk found:** a field list containing a nested ref
  (`SELECT ..., IncomeAccountRef FROM Item`) returns 403. Plain field lists
  and `SELECT *` work. Adapters should stick to simple selects.

## 2. Live inventory

| Entity | Count |
|---|---|
| Customer | 251 (all active) |
| Item | 282 (159 Service, 80 NonInventory, 43 Category) |
| Invoice | 12,615 |
| TaxCode | 49 |

## 3. Draft customer map (SC account -> QB customer)

Evidence: invoice count + latest TxnDate per candidate. Sebastian confirms;
this table is the F-7 mapping's first draft.

| SC account | QB customer | QB id | Inv count | Latest | Confidence |
|---|---|---|---|---|---|
| CIN - AZ | Cincinnati Reds (Goodyear, AZ) | see qb_custmap | 358 | 2026-12-02 (!) | High - but latest invoice is FUTURE-dated; see §7 |
| TXR - AZ | Texas Rangers - Surprise, AZ | " | 269 | 2026-08-02 | High - matches Sebastian's demo |
| CIN - KY | Louisville Bats | " | 40 | 2026-08-02 | High - own customer; low count matches by-service-week. "The bats are reds" was affiliation, not counterparty |
| TBJ - NY | Rogers Blue Jays Baseball Partnership (probable rider) | " | (shared) | - | Medium - the "Buffalo Bisons" customer has ONE invoice, from 2019. Buffalo lines must ride another customer, almost certainly Rogers; confirm which invoice with Sebastian |
| TBJ - FL | Rogers Blue Jays Baseball Partnership | " | 720 | 2026-08-02 | High - the live TBJ counterparty. "Toronto Blue Jays Training Complex" went dormant 2024-02; "MLB Spring Training" dormant 2020 |
| TBR - FL | Tampa Bay Rays MiLB/MLB | " | 315 | 2026-08-02 | High |
| CIN - OH (fee) | Cincinnati Reds (Cincinnati, OH) | " | 65 | 2026-07-01 | High - latest on the 1st matches the monthly fee-send cadence |
| STL - MO (fee) | St. Louis Cardinals (STL-MO) | " | 75 | 2026-07-19 | High |
| STL - FL (fee) | St. Louis Cardinals (STL-FL) | " | 135 | 2026-07-19 | High - but 135 invoices on a flat-fee account implies reimbursable/passthrough billing outside the fee; see §7 |
| TXR - TX - H (fee) | Texas Rangers | " | 151 | 2026-08-01 | High - fee + road meals + misc |
| Visiting catering | per-event customers (Anaheim Angels, Houston Astros, ...) | - | - | - | Out of v1 per D3 |

**The Tripleseat decode:** the transcript's garbled "triple C thing" is
**Tripleseat** - 20+ customers exist twice, once plain and once as
"(Tripleseat)". The duplicate-customer risk Sebastian described is this
pattern. Export adapters must target the plain customers, never the
Tripleseat twins, unless Sebastian rules otherwise.

## 4. Invoice anatomy (the target shape, from live TXR - AZ invoices)

Read from #K300168954 (TxnDate 2026-08-02) and #K300168897 (2026-07-26):

- **TxnDate = the Sunday closing the service week.** Both invoices land on
  week-end Sundays, matching the Mon-Sun atom from the process review.
- **One line per service PER DAY**, not per-week aggregates. A week is ~6-14
  SalesItemLines: each meal-service day is its own line (qty, rate, amount),
  with the meal breakdown packed into the Description text, e.g.
  "Breakfast - 100 & Lunch - 100. Total = 200." Snack lines interleave per day.
- **Rates ride the line**, not the item master (see §5).
- Tax via TxnTaxDetail with a per-venue TaxCodeRef; QB computes TotalTax.
- **One customer can receive SEVERAL invoices for the same week, split by
  service class.** Rogers Blue Jays Baseball Partnership got four invoices
  all dated 2026-08-02: Stadium Staff Meals / Single A Jays / MiLB B-L-D /
  MLB Pantry (prior week). The export design therefore needs per-account
  invoice-splitting rules: which SC service groups ride which invoice. This
  is a new load-bearing finding, not in the process review.

## 5. Two live data-quality catches (F-1 and F-2, now with numbers)

1. **A description contradicting its own line** on #K300168897: a line with
   qty=250, amount=$3,572.50 (= 250 x 14.29, money correct) whose Description
   reads "Breakfast - 50, Lunch - 125, & Dinner - 75. Total = 175." The
   components sum to 250; "Total = 175" is stale text carried from a
   duplicated line. The charge is right and the narrative is wrong - exactly
   the duplicate-and-edit failure class, this time in the words a client
   reads.
2. **Rate drift inside QB itself:** the item master holds
   `TXR-AZ MiLB - Breakfast/Lunch/Dinner` at **13.94**, while the live
   invoices bill it at **14.29**. The duplicated invoice line is the real
   rate store; the item master has fallen behind. With `sc_service_prices`
   that makes THREE rate stores. F-2 upgraded from latent to demonstrated.
   Whether 14.29 matches the SC's post-SF invoice rate is a pricing-alignment
   check (launch roadmap item 3).

## 6. Draft tax map (SC account -> QB TaxCode)

Named, active codes found (hex-named rows are QBO automated-sales-tax
internals; ignore):

| SC account | TaxCode | Id |
|---|---|---|
| TXR - AZ | Arizona - Surprise (New) | 36 (confirmed on live invoices) |
| CIN - AZ | Arizona - Goodyear (New) | 37 |
| STL - FL / TBJ - FL / TBR - FL | FL 7% / Florida 7% | 26 / 11 - which one is live needs one invoice check |
| TBJ - NY | New York Department of Revenue - BUF or NY 8.75% | 24 / 14 - confirm |
| CIN - KY | Lousiville, KY (sic - QB's own typo) | 42 |
| CIN - OH | Ohio - Combined | 44 |
| STL - MO | St Louis, MO | 45 |
| TXR - TX | Texas Comptroller / TX 8% | 39 / 13 - confirm |

## 7. Curiosities to confirm with Sebastian (not resolved here)

- **CIN - AZ's latest invoice is future-dated 2026-12-02.** Pre-created
  prepayment, scheduled bill, or a date typo - unknown.
- **STL - FL carries 135 invoices on a flat-fee account.** Likely
  reimbursables/passthrough (`STL-FL Reimbursables - Food-Packaged Snacks`
  item exists; the $900K passthrough per R12). Means fee accounts still
  receive non-fee invoices outside the export's scope - worth one line in
  the shape discussion.
- **Which invoice do Buffalo's meals ride** when they have service - Rogers,
  or something else.
- FL / NY / TX duplicate tax codes: which twin is live.

## 8. Item map raw material

93 SC-relevant items identified by account prefix (REDS *, TXR-AZ *, TBJ *,
TBR *, AAA/Buffalo, STL-FL *), with live rates - the F-6 mapping's raw
material, preserved in the recon JSON alongside this doc. Notable: `TBR MiLB -
Road Sandwiches` exists (id 3389, master rate 0) - the landing item for the
$15 -> $11 backdate credit. The item list also confirms Sebastian's "kind of a
mess": duplicate Buffalo meal items (18.75 vs 21.56), a Category and a Service
both named `On-Site Meal Service`, and a tail of `(deleted)` legacy rows.

## 9. Security and reliability flags

- **The API key is burned.** It now lives in this chat's transcript and in
  whatever channel Josh sent it through. Fine for a recon spike; before the
  intranet depends on it: rotate, store server-side as an env var per
  `ENV_VARS.md` discipline, never in the repo.
- **The key can write.** POST /invoice creates real invoices on the books
  with a static header. Ask Josh for a read-only key until the writer is
  actually built and gated.
- **ngrok is a tunnel.** If `chief` is a process on Josh's laptop, the
  endpoint dies when the laptop sleeps - unacceptable for a weekly billing
  dependency. If it is a persistent box, fine. One question to Josh settles
  it. Registered as ruling K-18.

## 10. What this recon changes

- K-14 ANSWERED (QuickBooks Online), K-15 closed earlier, W-4 closed.
- F-6 (item mapping) and F-7 (customer mapping) move from "unknown shape" to
  "draft tables awaiting Sebastian's confirm."
- F-2 (rate stores) demonstrated with live numbers.
- New finding for the shape discussion: per-day invoice lines, Sunday
  TxnDate, and per-account invoice splitting.
- The API path for D1's amendment (create-as-draft in QB, Sebastian reviews
  and sends) is confirmed technically viable through Josh's proxy - pending
  K-1/K-2 rulings and the K-18 hosting answer.
