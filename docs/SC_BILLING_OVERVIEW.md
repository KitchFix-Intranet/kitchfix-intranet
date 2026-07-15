# SC BILLING OVERVIEW — Tier 1 (DRAFT for Kevin's red pen)
**Target: docs/SC_BILLING_OVERVIEW.md · Complements SC_MONEY_MODEL.md (which wins conflicts until amended) · Drafting order: §4 first (below, FULL DRAFT), remaining sections stubbed**

## §1 Purpose + consumers — *stub*
Operator displays · finance per-period bill export (CSV v1 → QuickBooks) · P&L/KPI dashboard (parked).

## §2 Domain glossary — *stub (drafts next)*
service → service class → level → billing model → projected vs actual → sticker → SF% → post-SF invoice rate → fee schedule → billing atom → period → phase.

## §3 The pipeline — *stub*
Contract → catalog → projections → client approval (SF lock + snapshot) → operator actuals → period totals → export → tax at invoice (QB) → P&L.

---

## §4 LOAD-BEARING RULINGS — FULL DRAFT
*Numbered, immutable without Kevin. Every downstream doc, screen, and export obeys these. Amendments only via flagged conflict → Kevin ruling → dated revision here + MONEY_MODEL where applicable.*

**R1 — The stored price is the post-SF invoice rate.** `sc_service_prices` holds the post-SF invoice rate (Price Review v3, locked 2026-07-09). The `price_kind='projected'` column name is legacy — it holds the invoice rate. The term "cost basis" is banned. *(MONEY_MODEL)*

**R2 — Actuals ARE the billing data.** No counts entered = no per-meal bill. Fee accounts excepted: their money is `sc_fee_schedule`; their counts are operational telemetry. *(MONEY_MODEL; Joe 2026-07-10)*

**R3 — Projected and Actual are two pricing BASES, not draft-vs-final.** Projected = the client-facing plan (SF-inclusive on SF accounts). Actual = the billing basis (= projected − SF component). *(CC alignment brief, verbatim doctrine)*

**R4 — The fee lock and its asymmetry.** Client approval of annual projections locks the SF for the year — allocated by period, billed separately. Overage meals bill at the actuals price with NO fee component; underage is NEVER reconciled. No true-up exists anywhere. *(Joe [00:28–01:38])*

**R5 — The approved-projection snapshot.** The as-approved projection set is frozen at lock time as a separate artifact from working projections. The SF was locked against it; the baseline must survive later edits. *(Kevin ruling 2026-07-14, #6)*

**R6 — Flat-fee accounts never derive revenue from headcount × price.** Per-meal prices are $0 in PG by design; the fee schedule is the money; tiles show operational counts only. *(MONEY_MODEL; STL - FL zeroed 2026-06-16)*

**R7 — Billing shapes bind per SERVICE-CLASS-within-account, not per account.** Evidence: TBR - FL (MLB no-SF vs MiLB 25% buffet-only) · CIN - AZ level-split per-head pricing · CIN coffee/fountain weekly flat-rate fee-exempt. Level (MLB/MiLB) and class (buffet / add-on / weekly flat / Other / internal) are first-class dimensions. *(Joe call; MONEY_MODEL flags)*

**R8 — Two-layer money architecture.** SC calendar dollars = per-meal invoice line ONLY. SF and flat fees live in `sc_fee_schedule` (contract-revenue layer). KPI/all-in = P&L 2400.1 + 2300 + 2200, additive. Nothing ever computes sticker × count. *(MONEY_MODEL)*

**R9 — Tax never lives in the SC.** Calendar prices are pre-tax; the export emits pre-tax; tax applies at invoice level in QuickBooks as a separate line; tax never touches the P&L. **Sub-clause (ruled 2026-07-14, C-1)**: lines flagged `is_tax_free` (CIN coffee/fountain class) emit their full agreed amount with NO tax — the exemption is at service level per contract; any tax KitchFix owes internally is absorbed on finance's books, out of SC scope. *(Joe [04:41–06:33]; Kevin ruling #10; C-1 evidence: contract §IV.B.4 + invoice K300168736 + PG, triple-consistent)*

**R10 — Rounding.** Display: per account ruling (TBJ - FL + TBR - FL show full numbers, NO rounding; TXR - AZ shows full number alongside). Storage + export: always full precision. Aggregation: industry standard — round each extended line at 2 decimals, sum exact. *(Kevin PDF p.3; Kevin ruling #13)*

**R11 — The billing unit is the fiscal PERIOD; postseason has two shapes.** Export = per-period. **Postseason billing splits by account type**: (a) **per-meal accounts** (PDCs, AAA) — postseason bills at the SAME per-meal rates on ADDITIONAL service days; a calendar extension, never a price change. (b) **flat-fee accounts** (MLB clubhouses) — the flat fee covers the regular season only; postseason bills as ADDITIONAL per-game fees entered as fee-schedule events (NOT meal math), following the **1/81-of-annual-fee mechanic** (81 = home half-season). Contract-stated: CIN - OH $4,413.58/game + $2,206.79/workout · STL - MO $5,222.22/game + $2,777.78/workout + $600/road-game food · TXR - TX - H "pro rata Services Fee per game" (denominator inferred 1/81 — ⚠️ confirm verbatim at contract digest). **Billing cadence authority = the contract**; the P&L's period allocation is revenue-recognition truth only and never defines or overrides a billing schedule. *(Kevin rulings #5, #7 + postseason amendment 2026-07-14 from Phase 0a contract evidence + cadence guard)*

**R12 — Internal money never reaches a client.** Fun money (`is_non_revenue`) never appears on an invoice or client-facing export. Passthrough budgets (CIN - OH supplies · STL - MO $225K · STL - FL $900K) are never revenue. *(Joe [09:55]; MONEY_MODEL)*

**R13 — Period close + corrections.** Once a period is billed it FREEZES. Post-lock changes enter as adjustments (credit/debit lines on the next bill), never silent rewrites. A bill run requires the compliance precondition: every day in the period entered or explicitly no-service. *(Kevin rulings #1–4)*

**R14 — Prices change by effective-dating only.** A new rate = a new `sc_service_prices` row via the admin flow; history preserved; workbook escalator formulas are historical artifacts, never operative. *(MONEY_MODEL §j)*

**R15 — Truth architecture.** Tier 1 = framework truth · Tier 2 account file = account truth · raw sources (contracts, transcripts, invoices) = immutable evidence · PG = operational state that CONFORMS and is audited against the docs. Transcript outranks interpretation docs. MONEY_MODEL wins until amended. *(Kevin ruling 2026-07-14)*

**R16 — Provenance law.** Every claim carries a source or says UNKNOWN. Conflicts are flagged, never silently resolved. No number exists without a trace. *(Phase charter)*

---

## §5 The billing shapes — *stub (per-class overlay per R7)*
## §6 Line-item classification taxonomy — *stub (flags: projectable · fee-eligible · tax-treatment · invoice-group · internal-only)*
## §7 Rounding + display rules — *stub (expands R10 with per-account table)*
## §8 Per-service price display standard — *stub (P-4: post-SF rate top-right everywhere, labeled secondaries)*
## §9 Truth architecture + airtight-alignment rules — *stub (expands R15; defines LOCKED)*
## §10 Open framework questions — *stub (C-1 · C-2 · multi-invoice mapping · billing-atom flag · 0-count projections · DH/PPD billing semantics · TBJ lump-sum mechanics)*
