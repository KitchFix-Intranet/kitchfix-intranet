# SC PRICING ALIGNMENT — SCOPE PROPOSAL v1
**Status: RATIFIED with the North Star charter 2026-07-14 · Hands to CC at Phase 3+. No code this phase.**

---

## §1 PROVISIONAL RULINGS (operating assumptions — veto any)
- **P-1 (REVISED 2026-07-14 — my original single-ladder ranking contradicted SC_MONEY_MODEL, which wins)**: Authority is **DOMAIN-SCOPED**: per-service prices → **Price Review v3** · SF amounts / escalation / cadence / postseason → **executed contracts** · line-item existence + flags → **legacy workbooks** · P&L 3-line shape → **fixed**. The Joe transcript + new contract/invoice evidence = newest evidence layer — it can trigger revisions ONLY via flagged conflict → Kevin ruling → MONEY_MODEL amendment. PG remains the audited, never the authority. **SC_MONEY_MODEL wins all conflicts until amended.**
- **P-2 Account mapping**: Joe-call "Reds"=CIN - AZ · "TXR/Surprise"=TXR - AZ · "Blue Jays"=TBJ - FL · "Rays"=TBR - FL · "Florida"=STL - FL. Evidence: 30% SF × $18.42 = $12.90 ✓ Mar-5 spring date ✓ reading note [5] "TXR-AC" ✓ STL - FL is the only PDC not discussed.
- **P-3 Rounding**: the ruling is DISPLAY-only. Stored values and every export carry full precision, always, all accounts. TBJ - FL + TBR - FL: no rounding anywhere on screen. TXR - AZ: rounded display may stay, full number shown alongside.
- **P-4 Per-service display price**: default = **post-SF invoice rate** (the billing truth) top-right on every service, every account. On SF% accounts the projected/sticker figure appears only as a labeled secondary ("proj. w/ SF"). Labels are the fix for L1-2 — the $18/$13 coexistence was a labeling failure, not a math failure.
- **P-5 Workbooks (Jul 9)** presumed current until you say superseded.
- **P-6 Catalog-tagging questions (level, buffet-vs-add-on, weekly-unit services, sc_fee_schedule completeness, SF% verification)** = verify-in-phase audit tasks, not blockers. They're literally what the L1-3 price audit answers.

## §2 TIER 1 — OVERVIEW MARKDOWN STRUCTURE
Proposed file: `docs/SC_BILLING_OVERVIEW.md` (complements SC_MONEY_MODEL; where they overlap, MONEY_MODEL wins or is explicitly revised)

1. **Purpose + consumers** — operator displays · finance per-period bill export · P&L/KPI dashboard (parked). One paragraph.
2. **Domain glossary** (definition order matters — each term uses only prior terms): service → service class → level (MLB/MiLB) → billing model → projected vs actual (**"two pricing bases, not draft-vs-final"** — verbatim doctrine) → sticker price → SF% → post-SF invoice rate → fee schedule → billing atom ("what is a meal") → period → phase.
3. **The pipeline** — signed contract → services in catalog → start-of-year projections → client approval (**locks SF for the year**) → operator actuals → period totals → invoice lines → tax applied at invoice → P&L. One diagram-in-words.
4. **LOAD-BEARING RULINGS** (numbered, immutable without Kevin; this is where the 2026-07-09 ruling lives so nothing overwrites it):
   R1 `sc_service_prices` stores the POST-SF invoice rate. R2 Actuals ARE the billing data — no counts, no bill. R3 Fee immutability: overage bills at actuals price, underage never reconciled, no true-up exists anywhere. R4 Flat-fee accounts never derive revenue from headcount × price. R5 Tax: never in calendar prices; invoice-level separate line; never P&L. R6 Fun money never reaches an invoice or client-facing export. R7 Transcript = source of record over any interpretation doc.
5. **The billing shapes** — the six shapes (per-meal SF% / per-meal flat-SF / per-meal no-SF / flat fee / hybrid / +any contracts reveal), each with formula + member accounts, **then the critical overlay: shapes bind per SERVICE-CLASS-within-account, not per account** (TBR - FL: MLB no-SF vs MiLB buffet-only SF; CIN - AZ: level-split pricing; CIN coffee/fountain: weekly flat-rate fee-exempt).
6. **Line-item classification taxonomy** — the ≥5 classes as orthogonal flags: projectable? fee-eligible? tax-backed-out? invoice-group? internal-only? (Schema-shaped later by CC; Tier 1 defines the vocabulary.)
7. **Rounding + display rules** — operator never sees rounded-only money; per-account display table; exports full precision (P-3).
8. **Per-service price display standard** — the P-4 ruling with mock label text.
9. **Truth architecture + airtight-alignment rules** — the declared hierarchy: Tier 1 = framework truth · Tier 2 account file = account truth ("the internal understanding" — wins on how THIS account works) · raw sources (contracts, transcripts, invoices, evidence packs) = immutable evidence the account file cites · PG = operational state that must CONFORM and is audited against the docs. Plus what "locked" means: every claim provenance-tagged, conflict log empty or dispositioned, verification checklist green.
10. **Framework open-questions register** — road sandwiches, TBJ lump-sum mechanics, cost centers/3-invoice breakout, billing-atom flag, 0-count projections, DH/PPD billing semantics, 232-day PDC billing base.

## §3 TIER 2 — PER-ACCOUNT TEMPLATE (one skeleton × 11)
Proposed files: `docs/accounts/SC_ACCOUNT_<KEY>.md`

**Header block** *(my addition)*: account key · billing shape declaration (per service-class matrix) · levels served · lock status (DRAFT/ALIGNED/LOCKED) · sources used.
1. **Service calendar details** — what the operator sees per day; tiles, services, states.
2. **Contract details** — what the contract literally says, plain language, clause-referenced.
3. **Pricing details** — per-service table: class · level · sticker · SF treatment · post-SF rate · PG row status.
4. **Logic details** — day → period → year math, **with one worked example using real numbers** *(my addition — an example that must reconcile to the penny is the cheapest error detector we own)*.
5. **History** — what changed, when, why (sc-8c, 6/16 STL zero-out, PR #417…).
6. **Nuances** — carve-outs (TXR - V covered by H's contract; phase-aware fees…).
7. **Handshake deals** — the not-in-contract-but-binding layer + WHO holds each (Joe/corporate/team lead/client).
8. **Conflict log** *(my addition)* — every source disagreement found, with disposition per P-1.
9. **Open questions** — what blocks LOCKED status.
10. **Verification checklist** *(my addition)* — contract read ✓ · PG audited ✓ · workbook reconciled ✓ · worked example verified ✓ · Kevin session done ✓.

## §4 FILL SEQUENCE — PDCs first, pilot-then-batch
- **Batch 0 (pilot): CIN - AZ alone.** Hardest account on purpose — hybrid + SF% + level-split + coffee/fountain tax-back-out + 3 invoices + green box + stale-fee flag + sc-8c history. If the template survives CIN - AZ, it survives anything. Ends with your review → **template ratified**.
- **Batch 1 (PDCs): TXR - AZ → TBR - FL → TBJ - FL → STL - FL.** TXR fast ("same as Reds, no quirks"), TBR carries the level-split complexity, TBJ carries lump-sum + Other + fun money, STL - FL carries flat-fee phase-aware. Ends with your head-knowledge session on all five PDCs.
- **Batch 2 (AAA): CIN - KY, TBJ - NY.** Simplest shape (per-meal no-SF). Quick.
- **Batch 3 (MLB flat-fee): CIN - OH, STL - MO, TXR - TX - H, TXR - TX - V.** Same shape ×4; TXR - V's covered-by-H nuance documented here. Ends with your session.
- **Close: cross-account audit** — all 11 vs Price Review v3 vs PG dump; Conflict Logs dispositioned; Tier 1 open-questions register updated; scope handed to CC.
- **Joe transcript threading**: every rule cited by timestamp into the four covered PDC docs; road-sandwich/lump-sum items land in the respective Open Questions; STL - FL marked "not covered on call — Kevin session is primary."

## §5 ONE-PASS GATHER (everything I still need from you)
1. **Contracts** — pick the mode: upload PDFs here, OR paste relevant clauses per account during its batch, OR CC-side reference only (weakest for me).
2. **Sebastian bills** (1 recent per PDC) — gates bill-export layout + verifies the tax-back-out formula. Non-blocking for docs.
3. **Repo pastes, in this order as needed**: `SC_MONEY_MODEL.md` (when Tier 1 drafting starts) · `SC_CONTRACT_BILLING_SUMMARY.md` (locked flat fees) · `BUSINESS_NOTES.md` account-rules section · `SC_PDC_PHASES.md` (STL - FL batch).
4. **Fresh PG dumps** (2 CSVs from Studio): `sc_service_prices` full table · `sc_fee_schedule` full table. The two CSVs on hand are schedule-era, not prices.
5. During each account's batch: that account's screenshots if the PDF's 7 don't cover it.

## §6 HANDOFF DEFINITION (what CC receives when this phase closes)
Locked Tier 1 + 11 locked Tier 2 docs → CC builds: (a) the L1 display fixes (per-service price, labels, rounding per P-3/P-4), (b) the automated price audit (PG vs docs), (c) the per-period client bill export honoring every flag in §2.6.
