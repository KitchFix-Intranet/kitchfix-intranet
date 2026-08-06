# SC -> QBO SHAPE SPEC (the blueprint)

**Target repo path:** `docs/SC_QBO_SHAPE_SPEC.md`
**Version:** v1.0 SIGNED (Kevin, "approved", 2026-08-06)
**Status:** all eight §11 marks resolved (answers + QBO evidence); build
prompts PR-A and PR-B issued the same day. Evidence base: `SC_BILLING_PROCESS_REVIEW_2026-08-06.md`,
`QB_API_RECON_2026-08-06.md`, `SC_BILLING_RECON_CC_2026-08-06.md` (PR #636),
rulings K-1..K-18.

---

## 1. Plain-english summary

1. One sentence: a site leader presses Finalize on a completed week; the
   system builds the invoice from their counts, drops it into QuickBooks as
   an unsent draft, and emails billing.
2. Why it matters: it deletes the retyping step that shipped a wrong invoice
   on camera, and makes the calendar the one place billing numbers live.
3. Why this doc exists: it is the contract Kevin signs before any build code
   is written. Every rule below traces to a ruling or captured evidence.
4. Rough size of what it specifies: two small migrations, three build PRs,
   one diff harness.

## 2. Scope and non-goals

**In:** the per-meal pilot pair TXR - AZ (weekly) + CIN - AZ (bi-weekly,
combined file per K-4), extending to the remaining per-meal accounts at their
cutover turn. **Out:** fee-schedule invoices (D2), TXR - TX - V and all
visiting catering (K-5), fee-account reimbursables, QBO's send operation
(Sebastian sends, always), adjustment-line automation (K-3 deferral).

## 3. The finalize state machine (per account, per Mon-Sun week)

The week is derived from `service_date` only; `week_label` is banned (C-3).

```
OPEN -> FINALIZED -> BILLED
          |             \
          v              -> (terminal for site leaders; K-3 freeze)
      PUSH_FAILED -> (retry) -> BILLED
```

- **OPEN:** normal entry. The Finalize button renders but stays disabled
  until the completeness rule holds for all 7 days: `entered || no-service`
  (the shipped rule, reused verbatim).
- **FINALIZED:** the site leader pressed it. For a weekly account this
  immediately triggers the build + push + notification (K-1). For CIN - AZ,
  each week finalizes normally but the push fires only when BOTH weeks of
  the bi-weekly pair are finalized, producing one combined invoice (K-4).
  Finalized (not yet billed) weeks are read-only to site leaders; the
  override group can revert to OPEN.
- **BILLED:** the QBO draft exists; the ledger row is written. Frozen for
  everyone below the override group. Corrections route through Sebastian
  manually (K-3). No un-bill action exists in v1 - an override-group revert
  on a BILLED week is deliberately absent; if a billed week is wrong, the
  fix is a Sebastian-side credit and a ledger note.
- **PUSH_FAILED:** finalize recorded, QBO call failed. The week stays
  frozen, a failure alert fires (§9), and a Retry action is available to
  the override group. Failure never silently unwinds a finalize.

**Who can finalize:** anyone with intranet access to the account - the OAuth
perimeter is already salaried managers only (Kevin, mark 1). Same predicate
as saving actuals.
**Who can override (revert FINALIZED->OPEN, retry, unlock periods):**
Kevin + Joe + Sebastian, per Kevin's K-10 ruling. Implemented as a new
frozen set `SC_LOCK_OVERRIDE` separate from the 8-member `isScAdmin` set -
Sebastian is billing, not an SC admin, and the two powers should not travel
together. The sc-25 period lock's override short-circuit swaps from
`isScAdmin` to this set in PR-A.

**Locked-state UI (K-1's ask):** frozen weeks and days render with an
explicit state banner, never a dead form. Copy tiers: "Week finalized -
sent to billing" (FINALIZED/BILLED), "Week finalized - billing push failed,
[name] has been alerted" (PUSH_FAILED), "Period N closed for billing"
(sc-25). Override affordances render only for the three-person group.
Pixel treatment is PR-A's design pass under the standing battery.

## 4. The invoice builder (PR-B, pure function)

`buildInvoicePayload({ accountKey, weekStart, rows, mapping, config })`
returns `{ payload, warnings[] }`. Rows are fetched outside (testability);
the transform is pure.

- **Read path:** `sc_daily_revenue` ACTUAL rows only (R2; C-11 proved
  projections miss real invoices by +12% to +50%). Fetch paginates past the
  1,000-row default per the `scWorkbook.js:231-249` precedent.
- **Exclusions, structural:** `is_non_revenue` rows · unmapped services
  (build FAILS loudly, never skips silently) · fee accounts · unfinalized
  weeks (server predicate, not UI).
- **Line shape (matches captured invoices):** one line per QB item per day.
  Where several SC services map to one QB item (the B/L/D pattern), the day
  line sums their quantities and composes the description
  `"Breakfast - 100 & Lunch - 100. Total = 200."` from the components.
  **Aggregation guard:** components merge into one line only when their
  cent-rounded rates are identical; otherwise they emit separate lines.
  (CIN - AZ ML Breakfast 20.3100 vs Lunch/Dinner 20.3062 both round to
  20.31 - merge holds; the guard exists for the day it does not.)
- **Rounding (matches Sebastian's practice, observed):** UnitPrice = SC
  price rounded to cents; Amount = rounded rate x qty. (SC 14.2926 -> line
  14.29 x 200 = 2,858.00, exactly what the live invoice shows.) Storage
  stays full-precision per R10.
- **Flat-weekly services (CIN - AZ Coffee Service, Fountain Bev -
  `is_flat_fee`):** one line PER WEEK at the flat rate, qty 1, never more
  (Kevin, mark 4). The combined bi-weekly file therefore carries TWO weekly
  lines per FF service. CC verifies the `sc_daily_revenue` storage shape
  during PR-B and reports.
- **Tax flags:** `is_tax_free` services emit line-level `TaxCodeRef: NON`
  (R9 sub-clause); all other lines `TAX`, with the invoice-level per-venue
  code from the account map. QBO computes the tax.
- **TxnDate:** the closing Sunday (week 2's Sunday for the CIN - AZ pair).
- **Splitting rules:** per-account config table, not code. Pilot config:
  both accounts emit ONE invoice per cadence unit (matches their QB
  history). The Rogers multi-invoice pattern is config for later accounts.

## 5. Draft pilot mapping tables (Sebastian confirms before PR-B lands)

Rates always come from SC at build time; QB item-master rates are stale by
evidence (C-10) and are listed only to aid recognition. Full SC-side tables
live in the audit doc §C-9.

**TXR - AZ -> customer "Texas Rangers - Surprise, AZ" · TaxCode 36 (confirmed
on live invoices):**

| SC services (group/service) | QB item | Aggregate |
|---|---|---|
| Minor League / Breakfast + Lunch + Dinner | 3333 TXR-AZ MiLB - Breakfast/Lunch/Dinner | per-day sum, desc composed |
| (regular snack service) | 3338 TXR-AZ - Regular Snack | per-day |
| (pre-game hot snack) | 3337 TXR-AZ - Pre-Game Hot Snack | per-day |
| Major League / B + L + D | 3334 TXR-AZ MLB - Breakfast/Lunch/Dinner | per-day sum |
| (ML pregame · road meal · postgame buffet as active) | 3382 · 3335 · 3443 | per-day |

**CIN - AZ -> customer "Cincinnati Reds (Goodyear, AZ)" · TaxCode 37:**

| SC services | QB item | Aggregate |
|---|---|---|
| Minor League / Breakfast + Lunch + Dinner (12.8950) | 3300 REDS MiLB - Meal Service | per-day sum |
| Major League / Breakfast + Lunch + Dinner (~20.31) | 3302 REDS MLB - Meal Service | per-day sum |
| Minor League / Pre-Game Snack | 3322 REDS MiLB/MLB - Snack | per-day |
| Minor League / Coffee Service (FF TF) | 3371 REDS Coffee Service | one line/week, NON tax |
| Minor League / Fountain Bev (FF TF) | 3372 REDS Fountain Beverages | one line/week, NON tax |
| Rehab / Breakfast + Lunch + Dinner (12.8950) | 3327 REDS Rehab - Meal Service | per-day sum at 12.90 |
| Rehab / Continental Plus (6.3566) | 3327 REDS Rehab - Meal Service | SEPARATE per-day lines at 6.36 - the rate guard in action. Evidence: invoices K300168900/881/863/837/783 carry both tiers on item 3327, split by description |
| (ST-season services when active) | 3303 / 3304 / 3305 | per-day, joins at ST |

**CIN - AZ split config (evidence, last 5 closes):** TWO invoices per
bi-weekly close, same TxnDate - a main invoice (MiLB meals + snack + coffee
+ fountain) and a Rehab-only invoice. The split table carries this from day
one. **Bi-weekly anchor (evidence):** closes land on alternate Sundays
2026-05-31, 06-14, 06-28, 07-12, 07-26, ...; next close 2026-08-09. Anchor
config value: 2026-05-31.

Unmapped-at-build-time = hard failure with the service named. The mapping
table is data (`sc_qbo_service_map`), not code, and every row change writes
`sc_config_changelog` (the C-1 lesson).

## 6. Data model (two migrations)

**sc-30 `sc_week_finalize`** (PR-A): `account_key · week_start · status
(finalized|push_failed|billed|reverted) · finalized_by · finalized_at ·
reverted_by/at/reason`. Unique (account_key, week_start) live row.

**sc-31 mapping tables** (PR-B): `sc_qbo_account_map` + `sc_qbo_service_map`
as below, changelog-paired.

**sc-32 `sc_export_ledger`** (PR-C): `account_key · week_start · week_end ·
cadence_unit · payload_hash · qbo_invoice_id · qbo_doc_number · pretax_total
· status (created|failed|superseded) · attempt · error · created_at ·
created_by`. Unique (account_key, week_start) where status='created' - the
idempotency spine, and later the input `sc_is_period_closed()` swaps to.
Plus **`sc_qbo_account_map`** (customer id, taxcode, cadence, bi-weekly
anchor date, split config) and **`sc_qbo_service_map`** (service_id ->
qb_item_id, aggregate group, tax override) - seeded in PR-B's migration,
changelog-paired.

## 7. QBO adapter (PR-C)

POST one Invoice per payload through Josh's proxy: CustomerRef + Line[] with
`SalesItemLineDetail` (ItemRef, Qty, UnitPrice, Amount, Description, line
TaxCodeRef) + TxnDate. **Never sets EmailStatus, never calls send** - drafts
only, Sebastian sends. QBO assigns DocNumber. On success: ledger row +
notification. On failure: ledger `failed` row + alert; one automatic retry
on 5xx, manual Retry (override group) otherwise. Before any call: ledger
lookup on (account, week) - an existing `created` row makes the build a
no-op with a "already billed" surface. Credentials: `QBO_PROXY_BASE` +
`QBO_PROXY_KEY` env vars only (ENV_VARS.md discipline); PR-C does not start
until K-18's rotation/read-write answer lands.

## 8. Shadow mode (revision to Phase 4 - safer than the original plan)

Shadow weeks need only PR-A + PR-B + a small diff harness. Each week the
builder produces the payload and the harness fetches Sebastian's REAL
invoice for the same week read-only, then diffs line-by-line (item, qty,
rate, amount, total). **Nothing is posted to QBO during shadow** - no
pollution, no voids. PR-C's live posting activates only after graduation:
two consecutive zero-diff weeks per pilot account (or every diff explained
and ruled in the system's favor), and Sebastian's nod.

**Retro-shadow first (Kevin, mark 8: build proves working BEFORE training is
scoped):** seed the pilot accounts' historical weeks from the site
spreadsheets, run the builder against them, and diff against invoices
Sebastian ALREADY SENT (fetched read-only). The build proves itself on real
past data with zero site involvement; Track C training is scoped only after
retro-shadow runs clean.

## 9. Notification matrix (one email shell, KitchFix-branded; R-8 one-list
rule)

| Event | To | cc | Channel | Content |
|---|---|---|---|---|
| N1 Billed (push succeeded) | Sebastian + Kevin + Joe + Josh + the account's salaried managers + the submitter (mark 2) | - | Email | Account, week range, pre-tax total, line summary, QBO deep link, SC week link |
| N2 Push failed | Kevin + Sebastian | - | Email + Slack | Account, week, error, Retry link |
| N3 Chase, three stages (mark 3) | The account's salaried managers | cc Kevin + Sebastian on all three | Email; Slack channel post at stage 3 only | Fri 12:00 local: standing reminder "submit actuals by Monday noon" (suppressed if already finalized) · Mon 12:00 local: urgent, prior week now · Tue 09:00 local: past due + Slack |
| N4 Backdate credit (Track B, own PR) | Adjuster + Joe + Josh + Sebastian (K-7) | - | Email + "Credit needed" admin flag | Account, service, old/new price, span, $ delta |

## 10. Build plan mapping

PR-A (sc-30, finalize + lock UI + chase + `SC_LOCK_OVERRIDE`; five-context
battery) -> PR-B (maps + builder + fixture parity against K300168954 /
K300168897 + diff harness) -> shadow weeks -> PR-C (sc-31, adapter, N1/N2)
-> graduation -> first live invoice. Track B independent after its ruling.
**Track C, owner Kevin:** TXR - AZ + CIN - AZ site activation. Per mark 8,
Track C is scoped AFTER retro-shadow proves the build; live shadow weeks
then follow training. Order: build -> retro-shadow (seeded history, no site
involvement) -> Track C training -> live shadow -> graduation -> PR-C live.

## 11. RED PEN - the open marks this spec needs from Kevin

1. **Finalize permission:** anyone with entry rights on the account, or site
   leaders only (a narrower list to build)? Spec assumes entry-rights.
2. **N1 recipients:** Sebastian + finalizer only, or + you and Joe?
3. **N3 chase times:** Monday 12:00 local + Tuesday 09:00 escalation - keep
   or change? Slack target: per-account channel or DM to the leader?
4. **FF weekly rows:** confirm at PR-B recon how Coffee/Fountain live in
   `sc_daily_revenue` (weekly row vs daily sevenths) - marked VERIFY, CC
   answers in the build, rule stands: one weekly line either way.
5. **Bi-weekly anchor:** which Sunday closes a CIN - AZ pair - Sebastian
   names the anchor date at mapping confirm.
6. **Rehab mapping:** does Continental Plus ride the Rehab meal item 3327 or
   the snack item? Sebastian call.
7. **Shadow-without-posting** (§8) replacing post-and-void: confirm.
8. **Season window:** confirm both AZ sites have enough remaining service
   weeks (ACL calendar) for Track C + 2-3 shadow weeks this season - or the
   shadow slides to the next active phase.

Sign §11 and this becomes v1.0; PR-A and PR-B prompts follow the same day.
