# PRICE CERTIFICATION PHASE — plan
**Goal**: every price for every service on all 11 SC accounts is 100% verified in PG against the signed authority — then the SC surfaces those prices in the input screens, and mock account updates generate finance-ready CSVs.
**Definition of done**: (1) PG = signed Price Review v3 / account files, 100% match, zero known fixes outstanding. (2) Prices visible next to every service in SC input screens. (3) All 11 accounts mock-updated; CSVs with totals delivered to finance and sanity-accepted.
**Prereq**: batch doc-PR merged (clean canonical docs to certify against).

---

## STAGE 1 — Execute the ruled-but-unexecuted PG fixes
All already RULED in the pricing summit; none yet applied. One data-migration pass (Kevin runs in Studio, same pattern as the fee-schedule migration):
| Fix | Ruling |
|---|---|
| CIN-AZ MLB Breakfast $20.32 → **$20.31** | A-14 (Joe-approved + invoice-confirmed; PG holds wrong value) |
| TBJ-FL Media Meals $15 → **$16** | C-12 (actuals value stale) |
| Drop "(tax-free)" suffix from PG names (Coffee Service, Fountain Bev) | B-10 (flag carries the fact) |
| "Extended Day labor" → "Extended Day **L**abor" | B-11 (signed capitalization) |
| Verify TBJ-NY Snack + Shake = deactivated | C-10 (confirm state, fix if not) |
| TXR-V catalog: remove full-buffet modeling | A-7 (opt-in sales, out of SC billing scope — catalog correction) |
Effective-dated rows where applicable (price changes = new sc_service_prices row, never overwrite).

## STAGE 2 — Escalation-verification pass (CC, read-only)
The last systematic check from the summit. For each account: re-derive the 2026 rates/fees from the contract clause + real CPI data, confirm the signed sheet applied the RIGHT per-account rule. 9 distinct treatments (Oct 2%/5% · Aug 1%/4% · none · Aug SEFV · flat · 100% CPI Q4 · 75% SEFV01 Nov · fixed 2.5% · negotiated). Already spot-verified: TXR-AZ, TBR-FL, CIN-OH. Pass covers the rest + the two owed verifies:
- FSL signed-sheet rate = current **$16.51** (not old $14.50)?
- BGC $6.50 present in signed sheet / PG as a TBR-FL service?
- C-17 check: does the signed sheet encode CIN-AZ's 72,890-meal volume tier, or flat?

## STAGE 3 — FOUR-WAY certification audit → 100% + THE PRICE BOOK
CC runs a four-way audit post-Stage-1/2: **Signed xlsx vs PG vs Account Files vs the legacy SC workbooks** (workbooks = retired authority; divergences cataloged not fixed — the "never price from sheets" evidence). Target: **105/105 MATCH** (was 99%). Includes the Batch-3 accounts' price rows (the fee-model probe captured their catalogs but not prices — first full price check for TBJ-FL/TBR-FL/TXR-AZ rows). Any miss loops back to Stage 1.

**TWO certification artifacts:**
1. **Certification report** — the audit result ("every number verified as of <date>").
2. **THE PRICE BOOK** (`PRICE_BOOK.md`) — the canonical all-prices doc: every account × every service × certified price. **GENERATED from PG by script, never hand-edited** (PG stays the operational SOT; the book is its projection — regenerate on any price change, so it can't drift). Per account: money shape + fee/deposit (out-of-band amounts + cadence) + escalation rule, then the service table: service · level · 2026 rate · sticker vs post-SF where applicable · taxable + rate · flags (is_flat_fee / non-revenue / tax-exempt) · effective date · source. Dated + versioned ("certified as of <date>, PG snapshot <ts>").
**Dual purpose**: (a) the Ops-facing price doc — pull it up, view any account's prices; (b) the OPD handoff centerpiece — ports cleanly (OPD has a native `derived: true` machine-generated-doc convention for exactly this) and becomes SousAI's price knowledge. One source, one projection, no second truth.

## STAGE 4 — SC design: prices in the input screens
Design work (our critique-before-creation process): show the billing price next to every service in the SC input screens. Key design questions to settle first:
- Which price displays: post-SF invoice rate everywhere (billing truth, per Q-8 default) — sticker only where meaningful
- Flat-fee accounts: what shows next to services when revenue is the fee, not the meal (planning-only rates?)
- Add-ons/flat items (is_flat_fee), non-revenue (Fun $$$), tax-exempt flags — visual treatment
- TXR-V: no prices (out of billing scope)
Deliver: design thesis → mockups → Kevin approves → CC implements.

## STAGE 5 — Mock updates + finance CSVs
- Mock-update ALL 11 accounts in the SC (realistic counts, current period)
- Generate per-account CSVs with totals (the bill-export v1: per-period, pre-tax lines, R13 rounding — extended lines 2dp, sum exact; MLB/MiLB emitted as separate invoices per the cost-center split; BGC as its own stream)
- Deliver to finance (Joe/Sebastian) for sanity acceptance vs what they'd bill
- **Not in this phase**: the to-the-penny golden test vs real QB invoices (Phase E) — rides once the SF/deposit invoice seeds land from accounting. CSV structure is built golden-test-ready.

---

## Sequencing + roles
- Stage 1 (Chat writes migration, Kevin runs) → Stage 2 (CC pass) can overlap Stage 1 → Stage 3 (CC audit) after both → Stage 4 (Chat design → Kevin approves → CC builds) → Stage 5 (CC generates, finance reviews)
- Ledger discipline continues: every ruling/finding logged; standing cross-check + CC-prompt rules apply
- Exit → OPD HANDOFF package (docs clean + prices certified = handoff-ready)
