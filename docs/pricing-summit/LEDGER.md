# PRICING SUMMIT LEDGER — SC financial + contractual alignment
**Opened 2026-07-14 · Roadmap item 3 · Rule: every number traces to a named source. No code this phase. Existing docs win (SC_MONEY_MODEL is authority).**

---

## CURRENT STATE (read first — snapshot as of 2026-07-15)
> This ledger is a **decision-journal**: it grows by appending. Sections A–S are the *discovery record* (how we got here, in order); sections **T–U are the final rulings** that supersede earlier framing where they conflict. When an earlier section and a later ruling disagree, **the later ruling wins** — the earlier text is preserved as history, not overwritten.

**Kevin-owned rulings: ZERO outstanding.** Every conflict needing Kevin's head is resolved. What remains is async (Joe/Sebastian confirmations) + one CC verification pass.

**Final dispositions of the conflicts that were open going into this session** (full reasoning in §T–U; earlier sections may show these as OPEN — that framing is superseded):
- **A-4** → **DISSOLVED, not-a-conflict.** FSL and FCL are TWO SEPARATE GROUPS at two locations (FCL at the PDC $11.55; FSL = Dunedin Single-A at the stadium $16.51), NOT two tiers of one blended rate. The "blend" was a phantom. Both already correct in SC + signed sheet. **Everywhere earlier sections (§M, §O, §Q, §S) call this a "blend" or "two tiers of one population," that framing is WRONG — see §T.** (§T)
- **A-10** → **out of scope.** CIN-AZ $52K catering = Owners Week Caterings + Fantasy Camp, billed separately. (§T)
- **A-11** → **IN SCOPE (reversed).** TBR-FL $79,950 = Boys & Girls Club, which IS tracked in the SC and IS projected as TBR-FL revenue (TBR is the commissary-model account; BGC rides on it as a second client). The prior "out of scope" recommendation was WRONG — see §T. (§T)
- **The 5 Instructions-tab rows (C-8→C-12)** → confirmed by Kevin; no Joe round-trip. (§U)
- **A-6 (STL-FL tax 0.00)** → non-taxable, correct. Closed. (§U)
- **D-2 (TBR "2025" memo)** → typo, ignore. Closed. (§U)

**Still open (async — NOT Kevin's to answer):**
- **Joe #3 (LOAD-BEARING)** — how TBR-FL's variable SF second installment is set each year. The one async item that gates the SC bill export for TBR.
- Joe #1, #2, #5 (non-blocking) · Sebastian #3 (invoice samples, for Phase E) · Sebastian #4 (overlaps Joe #2).
- **Escalation-verification CC pass** — re-derive all 11 accounts' 2026 numbers from clause + real CPI; confirm signed sheet applied the right per-account rule. Fold in 2 spot-checks: FSL signed = $16.51, BGC rates present as TBR-FL services.

**Pending doc reconciliation (the batch doc-PR, staged):** MONEY_MODEL + digests still carry pre-ruling framing (A-4 "blend"; BGC excluded; TBR "one-time 2024"; Fauzia→Lessard). These are written back in a single reconciliation PR — see §Q "Batch doc-PR" + §T/§U doc-impact notes. Runs AFTER the 11 account files (building them surfaces any remaining corrections → one comprehensive pass).

---

## A. Source register
### In hand ✓
| Source | Role |
|---|---|
| Design_Review_Interactive_Audit_-_SC__5_.pdf (Jul 14) | Kevin's dictated brief — Layer 1 defects + Layer 2 ask; 7 screenshots for per-account deep-dives |
| Scoping brief (CC-drafted, Kevin-sent) | Phase charter: two-tier doc set, my job list (§6), guardrails (§7) |
| **Joe Lessard call transcript (2026-07-10, 14:51, reconciled)** | PRIMARY per-account rules source — PDCs. Verbatim received; verified against §G extraction line-by-line 2026-07-14; 3 additional nuggets banked below |
| CC alignment brief | Working interpretation + modeling constraints → §H |
| 11 account SC workbooks (Jul 9) · Price_Review_v3_FINAL · Budget_vs_Actual P6 · SC_explained.docx · 2 Supabase CSVs (Jul 10) | Spreadsheet + PG evidence corpus |

### Outstanding (non-blocking for Tier 1)
1. **Signed contracts** — mode TBD: upload vs repo-doc pastes on request (Q-10)
2. **Recent client bill per PDC** (Kevin ← Sebastian; Joe no longer CC'd) — gates bill-EXPORT layout only
3. Repo money docs — paste on request per section (SC_MONEY_MODEL first when Tier 1 drafting starts)

---

## B. Layer 1 defect register (source: PDF pp.1–3 + brief §1)
| # | Defect | Account |
|---|---|---|
| L1-1 | Per-service cost must show top-right for ALL services, all accounts (currently inconsistent) | All |
| L1-2 | Same-day disagreement: header $17,472 · tile $18 · footer $13 (Mar 5). Mechanism: sticker $18.42; post-SF (30%) $12.90; tile = projected-w/-SF rounded down; footer = post-SF rounded up. None wrong alone; unlabeled coexistence | CIN - AZ |
| L1-3 | Full price audit: contracts vs Price Review vs workbooks vs PG (sc_service_prices), + actuals math end-to-end | All 11 |
| L1-4 | **NO ROUNDING** — projection = actual for this contract; show full numbers | TBJ - FL |
| L1-5 | Same ruling as L1-4 | TBR - FL |
| L1-6 | Amounts match actuals price ✓ but ALSO show whole non-rounded numbers | TXR - AZ |

## C. Layer 2 deliverable
- **Tier 1** Overview md: glossary → contract→catalog→counts→invoice path → the SIX billing shapes → rounding+display rules → per-service price display ruling → airtight-alignment rules.
- **Tier 2** per-account md ×11 (same template): SC details · contract details · pricing · logic (day→period→year) · history · nuances · handshake deals · open questions.
- Accounts: CIN - AZ · CIN - KY · CIN - OH · STL - FL · STL - MO · TBJ - FL · TBJ - NY · TBR - FL · TXR - AZ · TXR - TX - H · TXR - TX - V.
- Consumers: operator displays → finance per-period bill export → P&L/KPI dashboard (parked).
- Sequence: Tier 1 → seed Tier 2 from existing knowledge → account-per-account with Kevin's head-knowledge. **PDCs first.**

## D. Billing-shape table (BUSINESS_NOTES, pre-Joe — see §G deltas)
| Shape | Accounts | Bill math |
|---|---|---|
| Per-meal SF% | CIN - AZ (30%), TXR - AZ (20%), TBR - FL MiLB (25%) | actuals × post-SF rate; SF billed separately as flat annual |
| Per-meal flat-SF | TBJ - FL | actuals × rate (= sticker); flat SF separate |
| Per-meal no-SF | CIN - KY, TBJ - NY | actuals × sticker |
| Flat fee | STL - FL, STL - MO, CIN - OH, TXR - TX - H, TXR - TX - V | annual amount; meal counts = staffing only |
| Hybrid | CIN - AZ | per-meal PLUS real annual contract fee (ruling 2026-07-12, PR #417) |

## E. Standing rulings (inherit, don't relitigate)
Post-SF invoice rate is what sc_service_prices stores (2026-07-09) · actuals ARE the billing data · flat-fee ≠ headcount×price revenue (STL - FL prices → $0 by design 6/16) · STL - FL $1.4M fee phase-aware across 13 periods · sc-8c double-discount cleanup · finance views key off contacts.role.

## F. Working state
**Master plan: PRICING_SUMMIT_NORTH_STAR.md (six-layer certification bar, five phases). This ledger = Phase 0–2 memory.**
- [x] All four core inputs read · MONEY_MODEL absorbed · conflicts C-1/C-2 open, C-3 resolved
- [x] Scope v1 delivered (P-rulings, Tier 1/2 structure, sequence) — P-1 revised per MONEY_MODEL
- [x] CC Phase 0 evidence gather RUNNING (contracts + invoices + PG dumps)
- [x] **RATIFIED 2026-07-14** — Kevin approved charter + plan; Chat-Claude committed in writing as drafter/verifier/conflict-flagger under the working laws
- [~] **RULING SESSION in progress**: C-1 ✅ RESOLVED (exemption; R9 sub-clause landed) · **C-2 HELD pending Phase 0b P&L evidence** · items 3–10 queued (A-1, A-3→A-7, A-2 paste, R11 amendment, batch approvals)
- [~] **Phase 0b: 2026 P&L per-site deep dive** — brief on shelf (CC_pl_2026_deep_dive.md); tests C-2 + A-3 + STL - FL allocation; delivers Layer C tie-out targets
- [~] Phase 1 IN PROGRESS: §4 Load-Bearing Rulings drafted (R1–R16; R9 sub-clause ruled in) · §2 glossary + §3 pipeline next
- [ ] Phase 2: CIN - AZ pilot → batches
- [ ] Phases 3–5 per charter

---

## G. JOE CALL RULES (2026-07-10 — primary source, per-account)
**"Reds" [map→ CIN - AZ, Q-3]**
- Projections include SF; client approves start-of-year → **SF locked for the year**, split by period, billed separately
- Actuals price = total minus SF. Overage meals (101st) bill at actuals price (~$12.90 ex.), **no SF**. Underage: **never reconciled** — fee kept. Intentional asymmetry; build no true-up
- Coffee + fountain-bev: **weekly flat rates OUTSIDE the SF**; client pays fixed amount → **tax backed out on invoice** (Sebastian, manual) so pre-tax+tax = agreed number; calendar shows the full agreed amount
- **One calendar → THREE separate invoices** (breakout deferred; never hard-code 1:1)
- **The "green box"** [03:30] — Joe's old SC carries a bottom breakout: each billed item, headcount tied to dollar amounts, SF-vs-not split visible. Joe copy-pasted it to **Ashley (client contact)** because "the client wants to see" exactly that → this is the **prototype for the client bill export** (what the paying customer already expects to read)
- Green box text Kevin read aloud [04:00]: "post-service-fee per-head pricing… MLB is breakfast, lunch, dinner… MiLB is…" → **CIN - AZ prices split by LEVEL (MLB vs MiLB per-head rates) within one account** — level-split is NOT unique to TBR - FL; strengthens Q-4
**"TXR / Surprise" [→ TXR - AZ]** — same structure as Reds; explicitly no quirks
**"Blue Jays" [→ TBJ - FL]**
- Lump sum start-of-year; projections = actuals pricing (meals × service price)
- **"Other"** = one-off billables (media meals): excluded from projections, taxed normally
- **"Fun money"** = internal tracking only; NEVER billed; must never reach invoice/export
**"Rays" [→ TBR - FL]**
- **MLB side: NO SF** — pure per-head, projected = actual
- **MiLB side: SF on BUFFET MEALS ONLY** (B/L/D); billed actual + tax; projected includes SF allocated across year
- Add-ons (extra protein pans, made-to-order, after-hour meals): **never projected, always outside SF, both levels**
- Road sandwiches: $15 + tax, billed as actuals, each replaces a projected lunch; projection treatment = **open client conversation** — encode neither answer
- Joe's forward guess [12:54]: TBR projections may shift to **breakfast + lunch only**, clients converting some lunches to road meals mid-stream — flag as a possible projection-model change in TBR Tier 2 open questions
**"Florida" [→ STL - FL?]** — skipped on call; both call it straightforward. Unconfirmed
**Universal**: calendar prices NEVER include tax · tax = invoice-level separate line · tax never on P&L (balance sheet only) · in-calendar tax figures are client-estimate-only

## H. CC MODELING CONSTRAINTS (hold, don't schema yet)
- **Doctrinal framing (Tier-1 glossary gold)**: Projected vs Actual are **two different pricing bases, not draft-vs-final** — projected = client-facing plan (SF-inclusive on fee accounts); actual = the billing basis (= projected − SF component)
- Two prices per line OR price + explicit SF component — **fee component is the safer primitive** (lock-at-approval expressible)
- Tax back-out formula (CC-derived, **verify against a real Sebastian invoice**): pre-tax ≈ agreed ÷ (1 + tax rate)
- Line-item classes ≥5: projectable buffet (fee-eligible per account/level) · billable-never-projected add-ons · weekly flat-rate fee-exempt (optionally tax-backed-out) · one-off "Other" (taxed, unprojected) · internal-only (fun money)
- Tax-backed-out = flag/behavior, not hard-coded account rule
- Invoice grouping = own dimension (CIN alone = 3 invoices)
- Fee immutability within year (no volume response either direction)
- **Conflict protocol (phase rule)**: if code/data contradicts this model, FLAG — never silently resolve. Provenance between the two Joe docs: **transcript = source of record; alignment brief = working interpretation**
**Do-not-assume**: invoice formats (await Sebastian) · road sandwiches · cost centers · Florida rules · TBJ lump-sum mechanics (prepayment vs deposit vs fee-equivalent — ask Kevin if export needs it)

## I. Pre-banked from schedule arc (fold into per-account sessions)
Stale CIN - AZ fee flag · Fun $$$$/is_non_revenue (matches G) · billing-atom flag ("what is a meal"; #427 contamination table) · 0-count projections (Buffalo ~12 dates) · 3 FSL no-projection game days (STL-FL 8/22, TBJ-FL 6/7+7/18) · TXR H+V actuals model · DH/PPD billing semantics (8/17 = two billable services?) · 232 off-schedule PDC days = billing base

---

## J. CLARIFYING QUESTIONS (answer before Tier 1 structure)
- **Q-1 Source ranking on conflict**: signed contract → Joe's word → Price Review v3 → account workbook → PG. Confirm or reorder. Sub-rule: Joe vs BUSINESS_NOTES conflict pending contract check — who wins provisionally?
- **Q-2** Jul-9 workbooks still current, or superseded since?
- **Q-3 Account mapping**: Joe-call Reds=CIN - AZ · TXR=TXR - AZ · Blue Jays=TBJ - FL · Rays=TBR - FL · "Florida"=STL - FL? And L1-2's Mar-5 example = CIN - AZ?
- **Q-4 TBR - FL two regimes in one account** (MLB no-SF vs MiLB 25% buffet-only): does the SC catalog already tag services by level + class (buffet vs add-on), or is that tagging part of this phase?
- **Q-5 CIN coffee/fountain**: in the SC catalog today as weekly-unit services? (Tax-backed-out flag = new behavior to spec.)
- **Q-6 Locked-SF representation**: annual SF + per-period allocation — fully in sc_fee_schedule today for all three SF% accounts? Is CIN - AZ the stale one?
- **Q-7 Rounding scope**: storage + export always full precision; ruling is display-only? Confirm.
- **Q-8 Per-service display price** (Tier-1 ruling): default = post-SF invoice rate everywhere (billing truth), sticker/projected only where meaningful — your call, or I propose in Tier 1?
- **Q-9 SF% figures** (30/20/25): contract-verified, or verify-in-phase?
- **Q-10 Contracts**: upload vs repo-paste-on-request?

---

## K. SC_MONEY_MODEL EXTRACT (canonical — received 2026-07-14, wins all conflicts)
**Terminology law**: "cost basis" is BANNED → "post-SF invoice rate". `price_kind='projected'` is a LEGACY NAME — it holds the post-SF invoice rate (audit trap).
**Two-layer architecture**: SC calendar dollars = per-meal invoice ONLY. SF/flat fees live in sc_fee_schedule (contract-revenue layer) → KPI dashboard reads both additively. KPI = P&L 2400.1 (meals) + 2300 (service charges) + 2200 (catering). Never sticker × count.
**Flags EXIST in schema** (answers most of Q-4/Q-5): `is_non_revenue` (Fun Money, sc-1b) · `is_flat_fee` (Extra Protein Beef/Seafood, MLB Extra MTO Sm/Med/Lrg, Coffee, Fountain — flat unit rate, never SF-discounted) · `is_tax_free` (Coffee, Fountain). Still missing: LEVEL (MLB/MiLB) tagging + buffet-vs-add-on class as explicit dimensions.
**Effective-dating**: price changes = new sc_service_prices row (effective_date); escalations land via admin backdate flow, never sheets. sc-8c: zero 'actual'-kind rows remain; view falls back to projected-kind price for all.

### The numbers (per-account digest, verbatim from MONEY_MODEL)
| Account | Shape | Sticker MiLB/MLB | Post-SF MiLB/MLB | 2026 SF/fee |
|---|---|---|---|---|
| CIN - AZ | SF% 30% (hybrid) | 18.42 / 29.01 | **12.90 / 20.31** | $402,016/yr (Feb+Mar) |
| CIN - KY | No-SF | 25.95 uniform | 25.95 | none |
| CIN - OH | Flat_fee | (25.95 planning-only) | n/a | $362,500/yr |
| STL - FL | Flat_fee | $0 in PG | n/a | $1,400,000/yr phase-aware (P1 45,553 · P3 peak 407,375 · FCL 98,915 · offseason 0) |
| STL - MO | Flat_fee | n/a | n/a | $473,000/yr |
| TBJ - FL | Flat-SF | 11.55 / 23.12 | same (no discount) | $452,812/yr (Jan/Feb/Mar) |
| TBJ - NY | No-SF | **27.34 ASSUMPTION** | 27.34 | none — **NO CONTRACT ON FILE** |
| TBR - FL | SF% 25% MiLB only | 27.95 / 39.48 | **20.96** / 39.48 | $382,448 **one-time 2024** (front-loaded) |
| TXR - AZ | SF% 20% (deposit) | 17.87 / 35.72 | **14.29 / 28.58** | $297,419 (2025 deposit) |
| TXR - TX - H | Flat_fee | n/a | n/a | $604,032/yr |
| TXR - TX - V | Flat_fee | n/a | n/a | $0 covered-by-H; direct sales via Season Tracker (out of SC scope) |
**Passthrough (never revenue)**: CIN-OH food/supplies budget · STL-MO $225K · STL-FL $900K.
**Known paperwork gaps**: CIN - AZ 2026 SOW/amendment missing (2023 base rates don't escalate to operative rates; owner Kevin, counterparty Ashley/Reds) · TBJ - NY no contract, model assumption-only.

### CONFLICT REGISTER (flag, don't resolve — per protocol)
- **C-1 RESOLVED (Kevin, 2026-07-14): EXEMPTION.** Contract §IV.B.4 + invoice practice + PG `is_tax_free` triple-consistent — flagged lines emit NO tax on the invoice. Joe's "back-out" description = KitchFix's internal tax absorption (Sebastian's books), out of SC scope. R9 sub-clause added to Tier 1.
- **C-2 TBR - FL 2026 SF**: MONEY_MODEL says one-time 2024 front-loaded; Joe says "projected amount includes the fee allocated across the year." Is there ANY 2026 SF billing event for TBR - FL, or is the 25% discount running against a sunk 2024 payment? → Contract + invoices decide; bill export depends on it.
- **C-3 RESOLVED (Kevin, 2026-07-14)**: There is no Joe Fauzia. Price Review v3 = Joe **Lessard** + Kevin. "Fauzia" is an **error inside SC_MONEY_MODEL.md** → queue a one-line name correction as a MONEY_MODEL amendment candidate (fold into this phase's eventual doc PR). All provenance tags: Lessard.

### NEW FACT (Kevin, 2026-07-14)
- **MLB invoices go on SEPARATE invoices in most cases during Spring Training when MLB is at the PDC** → invoice grouping has a LEVEL dimension at PDCs, not just cost-center dimension. Bank into Tier 1 §2.6 + bill export spec.

---

## L. RULINGS ROUND 2 (Kevin, 2026-07-14 — risk-review answers, all 16)
1–4. Period close/lock · actuals audit trail · corrections-as-adjustments · missing-actuals compliance gate → **all IN** (Phase 3–4 design requirements)
5. **Cadence = PER PERIOD** (C-4 dispositioned); CC's invoice audit verifies what real invoices show
6. Approved-projection snapshot → **ADD** (frozen as-approved baseline)
7. **Postseason = same rates, additional service days** — calendar extension, not price change (CC verifies clause)
8. 2027 rollover = designed event ✓
9. **Sebastian invoices in QuickBooks** → SC export is an INPUT to QB; golden test target = QB invoice (pre-tax subtotal + lines)
10. Tax: SC = pre-tax always; tax applied at invoice in QB — **audit SC vs invoices to verify** (C-1 test stands)
11. Multi-invoice mapping → TBD; v1 export = single per-period bill + manual split note
12. Export format → **CSV v1**; derive others later
13. Rounding → **industry rules**: round extended lines at 2dp, sum exact
14. P&L tie-out → added to Layer C ✓
15. **Historical backfill → NO** — forward-only from cutover
16. Client count-verification → not required

---

## M. PHASE 0 RESULTS (CC evidence gather — PR #434 draft, 2026-07-14)
**Delivered**: 11 EVIDENCE packs + CONFLICT_REGISTER (7 A / 6 B / 7 C / 2 D / 6 E) + PG_APPENDIX + reproducible dump script. Docs-only.

### Conflicts effectively answered by evidence (Kevin confirms disposition)
- **C-1 → EXEMPTION, not back-out.** Contract § IV.B.4 verbatim: "No taxes will be assessed and/or collected in connection with the beverage service." PG `is_tax_free=true` ✓ invoice lines carry no T-flag ✓ invoice arithmetic = CPI escalation, NOT ÷(1+rate) ✓. Triple-consistent. Joe's "back-out" description ≈ internal absorption economics (Sebastian's books), not the invoice mechanism. **R9 sub-clause draft: fixed-gross lines emit tax-exempt; any tax owed is absorbed internally, out of SC scope.**
- **C-2 REVERSED (Kevin, 2026-07-14 — new contract evidence): TBR - FL SF is ANNUALLY RECURRING, not one-time.** Kevin surfaced a contract image proving the SF structure repeats every year: **static $200,000 on signing + a variable second installment by Feb 1.** Evidence: 2021 SOW = $200K + $120,569.84 ($320,569.84); 2024 SOW = $200K + $182,448 ($382,448); 2026 P&L 2300 = $457,768 = $200K + ~$257,768 implied. My earlier "one-time 2024" ruling was built on "contract silent after 2024" — FALSE premise; we had only ONE year's SOW in the folder and over-read the silence. **A 2026 SF DOES exist and IS billed.**
  - **This ALSO reverses the derivation theory for TBR**: the $457,768 is NOT a computed SF-component shadow — it's a real recurring fee ($200K + variable). (The derivation theory may still hold for CIN - AZ / TXR - AZ — those are % discounts, a different mechanic — so the Joe 2300 question SURVIVES for them; just not as TBR's explanation.)
  - **A-2 → paperwork gap** (not "one-time"): 2025 + 2026 TBR SOWs SHOULD exist (recurring pattern) but aren't in the read folder. Same class as CIN - AZ + TXR - AZ missing 2026 SOWs. → paperwork chase.
  - **A-12 → resolved**: P&L $457,768 = real 2026 SF ($200K + ~$257,768), not a recognition anomaly.
  - **Fee schedule CORRECTION**: TBR - FL DOES carry a 2026 SF line (~$457,768, structure $200K + variable) — reverses my earlier "no 2026 TBR SF line" note. Bill export must include it.
  - **OPEN — how is the variable second installment set each year?** $120,569.84 → $182,448 → ~$257,768 is ~50%+ growth per period, FAR above CPI — not a formula. Negotiated? Amortized off projected MiLB meal budget? Joe-set? → JOE_QUESTIONS. This is the real unknown now.
  - **A-1 parallel noted**: same lesson — don't infer from a single document's silence; the business reality (recurring fee, negotiated variable) lives outside the one contract slice we happened to read.

### The 7 A-conflicts awaiting Kevin's rulings
- **A-1** TBR - FL MiLB: invoice $21.68 vs digest $20.96 — **$0.72/meal live delta** (likely 75%-of-CPI escalation applied on invoice, digest stale)
- **A-2** (in register file — see PR)
- **A-3** TBJ - FL SF cadence: "monthly Jan/Feb/Mar per ABR OneSheeter" — contract SILENT; cite doesn't tie to contract
- **A-4** TBJ - FL MiLB tiers: contract $14.50 FSL / $10.14 FCL vs practiced single blend $11.55 (invoice confirms blend in use)
- **A-5** STL - FL upkeep-budget ownership ambiguous
- **A-6** STL - FL invoice shows TAX 0.00 vs contract § 2.d requiring tax itemization
- **A-7** TXR - TX - V: contract scope = **Grab&Go + snacks + coffee ONLY** vs SC modeling full buffet — *this also answers the banked H+V question: V is NOT a mirror*

### Rulings validated + refined
- **Postseason**: per-meal accounts confirmed (same rates, more days — TBJ - FL verbatim). **Flat-fee accounts refined**: contracted per-GAME pro-rata = 1/81 of annual fee (CIN - OH $4,413.58/gm · STL - MO $5,222.22/gm + $2,777.78/workout + $600 road food · TXR - H pro-rata). **R11 amendment candidate** — postseason on flat-fee = additional fee-schedule events, not meal math.
- **Cadence reality**: weekly (TBJ-FL, TBR-FL, TXR-AZ) · bi-weekly (CIN - AZ ≈ one SC period, clean fit) · quarterly/6-monthly SF installments. Per-period export stands as the INPUT; **golden test adjusts: period export vs SUM of that period's invoices** on weekly accounts.
- TXR - AZ mechanics sharpened: 20% **deposit-triggered** discount + **fixed 2.5%/yr escalation** (not CPI); 2025 × 1.025 = 2026 verified on invoices.
- CIN - OH "coffee" = Clubhouse Extras reimbursement — a DIFFERENT service class than CIN - AZ's flat-rate coffee. Class taxonomy vindication.

### Paperwork gaps (now 3 missing instruments + 1 drafting error)
CIN - AZ 2026 SOW missing · TBJ - NY contract absent (folder empty) · **TXR - AZ 2026 SOW missing (new)** · TXR - TX - H § 1.c cites § 2(d) which does not exist (kitchen-setup budget UNKNOWN).

### Human action items (Kevin → Sebastian)
1. Memo template says "2025" on 2026 TBR invoices (D-2) — flag for fix
2. Invoice samples missing for: CIN - KY, CIN - OH, STL - MO, TXR - TX - H/V, TBJ - NY — golden-test coverage needs at least the per-meal ones

### Ruling addendum (Kevin, 2026-07-14, mid-session)
**P&L ≠ cadence truth.** The P&L's period allocation is revenue-RECOGNITION view only; billing cadence authority = executed contracts (per P-1's domain scoping). A fee billed once may legitimately appear spread on the P&L — expected, not a conflict. Encoded: R11 (Tier 1) + interpretation guard in CC_pl_2026_deep_dive.md. Consequence for C-2: whatever TBR's 2300 line shows, it corroborates recognition treatment only — the billing question stays with contract silence + zero 2026 SF invoices.

---

## N. PHASE 0b RESULTS (P&L deep dive — PR #435 draft, 2026-07-14)
**Delivered**: PL_2026_APPENDIX (11/11 sites mapped, 13-period vectors, row provenance) · BILLING_TERMS_MATRIX (3-way cadence spec) · A-8→A-13, B-7→B-9, D-3 appended to register · reproducible extractor.
**Validations**: no tax lines on any P&L (R9 ✓) · passthrough excluded (§h ✓) · STL - FL 2400.1 = $1,400,000 exact ✓ · TXR - H $604,019 ≈ fee ✓ · 2400.1 sanity checks within a few % ✓ · FCL plateau $98,915 confirmed ✓.
**New A's**: A-8 flat-fee SFs booked in 2400.1 not 2300 (systemic, 4 accounts) · A-9 GOTCHAS STL - FL P1 wrong ($171,367 not $45,553; peak P2 not P3) → D-3 · A-10 CIN - AZ 2200 $52K undocumented · A-11 TBR 2200 $79,950 undocumented · A-12 TBR 2300 $457,768 (C-2 evidence) · A-13 TXR - V 2400.1 $312K vs "$0 covered-by-H".

### CHAT-CLAUDE ANALYSIS — the SF-component hypothesis (C-2 + A-12 + A-8, unified)
**Arithmetic kill-shot on the amortization reading**: recognition of a past payment can never exceed the payment. 2026 alone books $457,768 > the entire $382,448. Amortization is DEAD as a full explanation.
**The component hypothesis**: for SF% accounts, P&L 2300 = the **SF% component of meal revenue** (derived recognition), not the flat-fee cash schedule. Test — 2300 ≈ (SF%/(1−SF%)) × 2400.1:
- **TXR - AZ**: 20/80 = 0.25 × $1,206K = **$301.5K vs P&L $301,621 — near-exact match** (vs the weaker "deposit +1.4%" story)
- **CIN - AZ**: 30/70 = 0.4286 × ($1,075K − ~$21K beverages) ≈ **$452K vs $445.7K** — within ~1.5%
- **TBR - FL**: 25/75 = 0.3333 → implies MiLB post-SF revenue ≈ $1,373K of the $1,752K total (MLB ≈ $379K ≈ 10K meals/yr at Trop — plausible); the season-weighted shape (peak P2 = spring) matches MiLB volume, not any billing schedule
**If confirmed**: C-2's one-time-2024 SURVIVES (2300 is derived, never billed) · A-12 dissolves into convention · A-8 is the sibling convention (flat-fee SFs → 2400.1) · MONEY_MODEL §e's "2400.1+2300" arithmetic identity (= sticker × count) is exactly what finance books · KPI-dashboard mapping must encode the DERIVATION, not a fee schedule.
**One confirmation needed** (either): Joe/Sebastian one-liner "is 2300 for SF% sites computed as the fee component of meal volume?" OR a period-shape test: 2300 vector ÷ projected MiLB buffet revenue vector ≈ constant 1/3 (workbook-checkable).

## N2. RULINGS (continued)
- **A-1 RESOLVED (Kevin, 2026-07-14): $21.68 is a NEGOTIATED rate — the signed Billing Price column governs.** Business fact Kevin supplied: KitchFix raised prices and the Rays AGREED to $21.68. A mutually-agreed rate SUPERSEDES the contract's CPI-escalation clause (the clause is the default mechanism; agreement overrides it). So $21.68 is correct-because-agreed, not correct-because-derived — CC's contract math ($20.56) and the digest's dropped-75% ($20.96) are both moot: neither the formula nor the buggy formula is the authority. **The signed Billing Price column (§O) is the price authority, full stop.** PG's $20.96 = STALE, fix effective-dated to the signed value in Phase 3.
  - **What this REVERSES**: A-1 is no longer a "live over-billing exposure." The invoice is right; the paperwork (a 2026 SOW capturing the agreed rate) simply lags — parallels the missing CIN - AZ + TXR - AZ 2026 SOWs. → add to the paperwork-chase list: **TBR - FL 2026 rate memo/SOW capturing the agreed $21.68.**
  - **What SURVIVES from the recompute (don't discard)**: (1) the digest's dropped-75% derivation was still a real bug in whatever computed $20.96 — irrelevant for TBR now (agreement governs) but the SAME bug could sit under a NON-negotiated account where the formula IS the authority. The audit's SIGNED_VS_CONTRACT check stays valuable there. (2) Confirms the signed sheet is the right authority to be diffing against.
  - **CAVEAT (verify in audit)**: this ruling ASSUMES the signed Billing Price column actually says $21.68 for TBR MiLB. If the audit comes back and the signed column says $20.96 (i.e. the agreed increase never made it INTO the signed sheet), then the sheet is stale too and we have a sheet-update task. Confirm the signed value = $21.68.
- **⚠️ ESCALATED CONCERN (Kevin, 2026-07-14): if PG is stale on TBR MiLB, PG may be stale on OTHER prices.** A-1 is now treated as a SYMPTOM, not an isolated fix. → triggers the systematic price audit below (elevated to a Layer D certification gate).
- **A-3 DISPOSITIONED (Kevin, 2026-07-14): OneSheeter-operative, provenance-flagged, → JOE_QUESTIONS #1.** No conflict — a provenance gap. TBJ - FL SF cadence: contract SILENT; "monthly Jan/Feb/Mar" sourced only from the ABR OneSheeter (planning doc, not contract); P&L season-weighted spread is recognition-only per guard, doesn't confirm bill dates. Operative cadence = OneSheeter's Jan/Feb/Mar, tagged in Tier 2 as "OneSheeter-sourced, not contract-confirmed." Confirm via Joe or a TBJ - FL SF invoice. Non-blocking — cadence ≠ amount; export carries it with a provenance note until confirmed.
- **JOE_QUESTIONS list started** (JOE_QUESTIONS.md) — running parking lot for items needing Joe/Sebastian confirmation; seeded with A-3 cadence + the 2300 computed-vs-billed question.

## O. THE PRICE AUTHORITY (Kevin, 2026-07-14) — keystone

### Phase 0c: PRICE AUDIT RESULTS (PR #435, 2026-07-14) — THE STALENESS FEAR REFUTED
**1 STALE_PG of 105 services (0.95%)** — CIN - AZ Major League Breakfast, PG $20.32 vs signed $20.30622, +$0.014/meal rounding drift. That's the ENTIRE fix-list. Kevin's "one stale ⇒ systemic" worry: refuted with a number. PG is 99% aligned to the signed authority. Layer D price-audit gate: essentially GREEN (1 rounding row + naming cleanups).

**A-1 FULLY DISSOLVED — it was never a conflict.** The signed sheet distinguishes THREE TBR MiLB rates: Breakfast $17.8275 · Lunch **$21.675** · Dinner **$20.96183**. PG stores all three EXACTLY. Invoice K300168871 bills LUNCH ($21.68 = $21.675 rounded, Description column reads "Lunch" on every line). The "$0.72 delta" was the MONEY_MODEL DIGEST flattening Lunch+Dinner into one "MiLB $20.96" row. There was no stale price, no over-billing, no negotiated override needed. **Every A-1 ruling I made chased a digest artifact.** CC's $20.56 contract recompute + the $21.68 negotiated-rate story are both MOOT — the signed sheet stores the real per-service rates and PG matches them.
- **A-1 → NOT-A-CONFLICT.** Kevin's negotiated-rate ruling stands as TRUE (prices were raised + agreed) but wasn't even needed to resolve the number — the number was always right in PG.
- **Residual (non-blocking)**: signed Lunch full-rate $28.90 doesn't derive from contract $25.86 base via CPI → unseen 2025 SOW split Lunch/Dinner, or a signed business update. Same paperwork class as the missing SOWs. → the verbatim contract digest (Phase 0c-contracts) will find it.

**LESSON — logged hard (Chat-Claude)**: I anchored on the MONEY_MODEL DIGEST as ground truth THREE times across the A-1 thread and ruled on "which source wins" instead of "go read the actual rows." The digest is a convenience summary; the signed sheet + PG are the data. When a digest "disagrees" with data, the first move is inspect the underlying rows, NOT adjudicate sources. Kevin's keystone instinct (point at the signed Excel) cut through what my reconciliation could not. **META: the human who knows where truth lives beats reconciliation of secondary sources.** Bidirectional-diff law's cousin: audit the SUMMARY against the DATA, never rule from the summary.

**New from audit**: A-14 (the 1 rounding row) · B-10/B-11 (cosmetic naming: "(tax-free)" suffix, "Labor" case) · C-8→C-12 (5 Joe-pending Instructions-tab question rows: STL - FL MiLB Snack price, STL - FL Arrival-vs-Breakfast, TBJ - NY Snack/Shake, TBR - FL MiLB-ST-vs-MiLB, TBJ - FL Media Meals $15-vs-$16). MONEY_MODEL digest expansion needed (TBR three MiLB rates) — B-2.
**Invoice-vs-signed cross-check: CLEAN** across all 9 sampled invoices — billing has NOT diverged from the signed sheet.

### Phase 0c-contracts: VERBATIM contract source-of-record (brief on shelf)
Triggered by the reversal pattern — three rulings today (C-2 ×2, A-1, A-2) all traced to reading ONE slice of a multi-document contract history. Deliverable = CONTRACT_DIGEST_<ACCOUNT>.md ×11: verbatim per-account reproduction of every contract file's operative terms + document-hierarchy inventory (which doc governs 2026) + year-over-year tables. **Distinct from evidence packs**: verbatim source-of-record (no interpretation, §A–C pure) so Kevin + Chat rule from actual contract language, not a summary. Kills the incomplete-coverage error class. Confirms/locates the missing 2026 SOWs (TBR recurring, CIN - AZ, TXR - AZ). Brief: CC_contract_digest_verbatim.md.
**LESSON (logged)**: today's reversals were evidence-arrival, not bad logic — but they prove document coverage must be COMPLETE before rulings are final. Rulings on interpretive/contractual items are provisional until the verbatim digest confirms full-history coverage.
**`KitchFix_Service_Calendar_Price_Review_v3_FINAL.xlsx` → tab `Service Price Review` → column `Billing Price`** = the definitive per-service price source. Built by pulling every service's price from each account's service calendar, then **Joe Lessard signs off**. ATTESTED (human-confirmed), not derived — already encodes every escalation + SF adjustment. This is P-1's #1 authority made concrete.
- Collapses the A-1 staleness worry from "recompute + CPI arithmetic" to "read signed column, diff PG." A-1's $21.68 should = the signed TBR MiLB Billing Price (confirms the sheet's authority).
- Price audit brief rewritten to read this column directly (CC_price_audit_full.md). CC recompute micro-task (CC_a1_recompute.md) now REDUNDANT — the signed sheet supersedes it; skip unless a row shows signed≠invoice (a different, serious class).
- **The signed Billing Price is what PG must equal.** Phase 3 = effective-date PG to match the signed column wherever STALE_PG.
### The Sebastian/Joe confirmation question (settles 4 items)
**One question**: "For the SF% discount sites (CIN - AZ, TXR - AZ, TBR - FL MiLB), is the P&L 'Service Charges' (2300) line a COMPUTED fee-component of meal revenue, or an ACTUAL fee we invoice the client?"
- "Computed" → C-2 airtight · A-12 dissolves (2300 is derived) · A-8 explained (flat-fee sites book the whole fee in 2400.1 because there's no separate cash fee to split out) · A-13 informed. One answer, four closes.
- "Billed" → reopens C-2; would mean a 2026 SF invoice exists unsam pled → chase it.
Rolls into the Sebastian email already being assembled.

### A-5 RESOLVED (Kevin, 2026-07-14): PASSTHROUGH
STL - FL upkeep budgets (~$15K equipment + $4K storage + $11K temporary cooler) = **passthrough** — KitchFix collects and pays through at cost, zero margin, NEVER revenue. Same class as the existing $900K food/supplies passthrough (MONEY_MODEL §h). Consequences: excluded from all revenue figures, never on the bill export as revenue, never in P&L 2200/2300/2400. Tier 2 STL - FL records them under the passthrough section. The contract's ambiguous ownership language is resolved by operational reality: KitchFix fronts, Cardinals' money passes through. Digest will still quote the verbatim clause for the record, but the classification is settled.
**Pattern note**: STL - FL passthrough now = $900K food/supplies + ~$30K upkeep budgets. R12 (internal money never reaches client as revenue) already covers the treatment.

### A-4 HELD for verbatim digest (Kevin observation, 2026-07-14)
> ⚠️ **SUPERSEDED by §T (2026-07-15).** The "blend" premise below is WRONG. FSL and FCL are two separate groups/services/prices (FCL at PDC $11.55; FSL = Dunedin Single-A at stadium $16.51), not two tiers of one blended MiLB population. Preserved as discovery history. Read §T for the correct disposition.

TBJ - FL FSL/FCL two-tier split: **appears ONLY in contract text** per CC's Phase 0a extraction. Kevin confirms: **no FSL reference and no two-tier price in the service-calendar spreadsheets currently used for billing**, and the provided invoice bills a single **$11.55** — the SAME rate stored in the spreadsheet SC. So the two operative billing sources (workbook + invoice) AGREE on $11.55; only the contract mentions tiers.
- **Reframe**: this is likely a VESTIGIAL contract construct that operations already collapsed to a single blended MiLB rate — not a live practice-vs-authority divergence. The blend may simply BE the operative rate.
- **On hold pending the verbatim contract digest** — need to read the exact FSL/FCL clause: is it superseded by a later SOW? does a 2026 doc state a single rate? is the tier language even in the 2026-governing contract or only a prior year's?
- **Also confirm at digest**: what the signed Price Review v3 stores for TBJ - FL MiLB (audit showed TBJ - FL = 100% PG-match, so signed agrees with PG's $11.55 — meaning the ATTESTED authority already blesses the blend). If signed = $11.55 single rate, A-4 likely closes as "tiers vestigial; blend is the signed operative rate."
- **Residual for Joe only if digest leaves it open**: was a single-blend ever explicitly agreed with Dunedin, or did ops just build it that way?

### A-6 DISPOSITIONED (Kevin, 2026-07-14): → SEBASTIAN #1 (no ruling, no SC impact)
STL - FL invoice TAX 0.00 vs contract §2.d tax-itemization requirement. Likely benign: a service fee / passthrough isn't taxable the way prepared meals are in FL, so 0.00 may correctly satisfy itemization. Zero SC/export impact regardless (R9 — SC emits pre-tax; tax is QB's job). Parked to Sebastian to confirm the tax treatment. Only matters if the SF is actually taxable and 0.00 is an error → finance compliance issue, not billing-accuracy. **SEBASTIAN_QUESTIONS list started.**
The ~$15K equipment + $4K storage + $11K temporary cooler = **passthrough, paid for by the Cardinals** — never KitchFix revenue. Same class as STL - FL's existing $900K food/supplies passthrough (MONEY_MODEL §h). Confirms the contract's ambiguous language resolves to passthrough.
- **Consequences**: excluded from all revenue figures · never on the bill export as revenue · never a P&L revenue line (R12 governs). Add these three budgets to the STL - FL passthrough list in Tier 2 alongside the $900K.
- **R12 vindication**: passthrough-never-revenue rule holds; STL - FL now has documented passthrough = $900K food + ~$30K facility upkeep.
- Digest cross-check: confirm the verbatim clause matches this treatment (Cardinals-funded, at-cost, no margin).

### A-7 RESOLVED (Kevin, 2026-07-14): TXR - TX - V is a SALES/OPT-IN model — NOT a buffet mirror of H
**The definitive H+V answer**: V is NOT a mirror of H. V runs a **discretionary direct-sales model**: KitchFix actively reaches out to each VISITING team and SELLS them services; the visiting team CHOOSES whether to order KitchFix's on-site food OR manage their own catering (bring it in). Series-by-series opt-in; volume unknown in advance.
- **This is a distinct FOURTH revenue shape** (beyond per-meal-SF% / per-meal-no-SF / flat-fee): **opt-in direct sales.** No committed service fee (nothing is guaranteed), no per-meal contract rate, no flat fee. Revenue = whatever visiting teams actually buy.
- **Everything now reconciles**: contract §1.b "G&G + snacks + coffee, $0 fee, covered by H" = correct (no committed service = no fee) · P&L $312K in 2400.1 (A-13) = the ACTUAL opt-in sales, tracked via Season Tracker (sold-through × labor model) · MONEY_MODEL "$0 covered by H, direct sales out of SC scope" = correct.
- **SC MODELING IS WRONG (Phase 3 fix)**: the SC currently models a FULL BUFFET for V, mirroring H. V has no committed buffet to project — it has opt-in sales that may or may not occur. → Phase 3: correct V's catalog. Options for Kevin later: (a) stop modeling V meals in the SC entirely (direct sales live in Season Tracker, out of scope per MONEY_MODEL), or (b) model V as opt-in/actuals-only with no projection commitment. Decide at build time.
- **A-13 RESOLVED**: the $312K is legitimate V direct-sales revenue in the P&L; it does NOT flow through the SC (Season Tracker owns it). MONEY_MODEL correct as written.
- **Bill export**: V generates NO KitchFix-to-Rangers club invoice for a buffet. Direct sales to visiting teams are a separate revenue stream tracked outside the SC. The bill export should NOT produce a V club bill.
- **Open (minor, later)**: how/whether opt-in direct sales should surface in the SC at all vs staying purely in Season Tracker — a scope decision for the V catalog rebuild, not a blocker.

### A-7 EXTENDED — TXR - V operating model (Britt's "Visiting Catering Procedures" SOP, 2026-07-14)
The SOP confirms + operationalizes the opt-in model. Material facts for the SC/bill-export scope decision:
- **Per-order, per-series SALES flow**: chef contacts each visiting team 4wk out → follow-ups → team opts in → quote → confirm → bill. No projection, no commitment. Chef of visiting kitchen owns it (Ops = support/cc only; Britt + Kevin cc'd on all client comms). Effective 2026 MLB season+.
- **PRICING BASIS = à la carte catering menu** (fundamentally different from every other account): menu-price × quantity per item, e.g. "Poke Bowl Buffet 45 × $40 = $1,200." Buffets priced per-head; platters/pans priced per-unit; MTO available. Daily total → series GRAND TOTAL. There is NO per-meal contract rate and NO flat fee — the 2026 PDF menu is the price list.
- **TAX: added on the client-facing quote** ("plus tax" every line) — CONTRAST with committed-clubhouse accounts where SC emits pre-tax + QB applies tax. For V, tax is part of the quote math. (Does not change R9 for other accounts.)
- **CC surcharge**: 4% fee on all credit-card orders (ACH or CC choice per client).
- **Billing path**: chef → Sebastian at order confirmation (post-series adjustments allowed). Sebastian invoices the **visiting team** (not the Rangers). Needs: team + dates, bill-to location (Arlington TX), recipient email, ACH/CC.
- **Data lives OUTSIDE the SC**: Google Sheets visiting-teams/dates/contacts list + Drive past-orders + BEO templates + 2026 PDF menu. This IS the Season Tracker-adjacent workflow MONEY_MODEL flagged.
- **SCOPE RULING implication (strong)**: V does NOT belong in the SC billing/projection model at all — it's a discrete per-series catering-sales operation with its own tools, its own pricing (menu à la carte), its own tax handling, its own billing path (chef→Sebastian→visiting team). → Phase 3: REMOVE V's full-buffet SC modeling; do NOT build V into the per-period bill export. V's $312K (P&L 2400.1, A-13) is real but tracked in the catering-sales workflow, not the SC.
- **Deferred question (Kevin, later)**: does V need ANY SC presence (e.g. an operational actuals surface for the chef), or is it 100% Google-Sheets/BEO-driven outside the intranet? Not a blocker for pricing-summit certification — V is simply OUT of the SC billing scope. If V eventually wants a home in the intranet, that's a separate future module (catering-sales), not part of this billing-certification effort.

### R11 AMENDED + RULED (Kevin, 2026-07-14): postseason has TWO shapes
- **Per-meal accounts** (PDCs, AAA): same per-meal rates, additional service days — calendar extension, already ruled. Confirmed by TBJ - FL contract (postseason meals at same $14.50/$10.14/$20.29).
- **Flat-fee accounts** (MLB clubhouses): flat fee covers regular season ONLY; postseason = additional PER-GAME fees as fee-schedule events (not meal math), via the **1/81-of-annual mechanic** (81 = home half-season). Contract-stated: CIN - OH $4,413.58/gm + $2,206.79/workout · STL - MO $5,222.22/gm + $2,777.78/workout + $600/road food · TXR - TX - H "pro rata per game."
- **CAVEAT flagged**: TXR - TX - H denominator "1/81" is CC-inferred from matching the other two, not verbatim-stated. → confirm exact clause at the verbatim contract digest. Sub-point tagged pending; rest of R11 firm.
- **Consequence for bill export**: postseason on flat-fee accounts requires the export to emit per-game fee lines (count of postseason games/workouts × per-game rate) — a fee-schedule event type, distinct from both the annual installments and the per-meal path. Phase 3/4 build note.
- Tier 1 R11 updated.

### AUDIT BATCH RULINGS (Kevin, 2026-07-14)
- **A-14 RESOLVED (Kevin, 2026-07-14): the price is $20.31 — what Joe approved.** PG holds $20.32 (wrong) → Phase-3 fix to **$20.31**. IMPORTANT CORRECTION: CC's audit reported the signed `Billing Price` cell as $20.30622, but Kevin confirms **Joe approved $20.31** — so either CC misread the cell (pulled a pre-rounding formula value, not the signed figure) or the sheet shows 20.30622 while the attested number is 20.31. **Kevin's confirmation of what Joe signed is authority over CC's cell-read.** → (1) Phase-3 PG fix = $20.31. (2) Verify the signed-sheet cell actually reads $20.31; if it shows 20.30622, the sheet display/formula needs correcting to match the approved $20.31. (3) ⚠️ FLAG: if CC misread THIS cell, spot-check whether other "signed" values in the audit are pre-rounding formula reads vs approved figures — the 99% MATCH rate may include sub-cent formula-vs-approved noise. Low-stakes (sub-cent) but worth a targeted re-check at the contract digest / a Joe confirm on the sheet's precision convention.
- **B-10 APPROVED**: drop "(tax-free)" suffix from PG names (Coffee Service, Fountain Bev); is_tax_free flag carries the fact. Phase 3 cosmetic.
- **B-11 APPROVED**: align PG "Extended Day labor" → "Extended Day Labor" (signed capitalization). Phase 3 cosmetic.
- **C-8 (STL - FL MiLB Snack)**: RESOLVED — real cost, **purchased and passed through** to the Cardinals (passthrough, not $0-because-fee and not KitchFix revenue). Add to STL - FL passthrough treatment. NOT a flat $0 — it's a passthrough line. → confirm how it should surface (billed at cost, zero margin).
- **C-9 (STL - FL Arrival vs Breakfast)**: RESOLVED — **two distinct services.** Keep both; ensure PG + signed both carry both. Not a rename.
- **C-10 (TBJ - NY Snack + Shake)**: RESOLVED — **deactivate** both. Correct as no-price/inactive.
- **C-11 (TBR - FL "Breakfast - MiLB ST" vs "Breakfast - MiLB")**: Kevin asks — is there a COST difference? Both currently $17.8275 in signed + PG (no cost diff found). → Chat to confirm from data: if identical cost, likely same service time-bounded (consolidate or keep as two calendar-scoped entries); if the ST version should differ, needs the ST rate. PENDING data confirm.
- **C-12 (TBJ - FL Media Meals)**: RESOLVED — **$16** (the projected value is correct; actuals $15 is the stale one). Fix to $16.

---

## P. CONTRACT DIGESTS — verbatim source-of-record (PR #436, logged as pasted)

### CIN - AZ digest (logged 2026-07-14)
**Fidelity**: strong — block-quoted, page-cited, native DOCX source. One base agreement (2023) governs 2024–2027 by CPI formula.
**RESOLVES**:
- **CIN - AZ "missing 2026 SOW" reframed** → NOT a missing contract. 2026 is governed by the 2023 base's **Renewal Term option** (§I.B): Club extends by written notice by Nov 1, 2026, rates move by CPI formula. The only gap is the **renewal-notice document** (did the Club send it?) — a correspondence check, not a contract gap. Downgrades C-1(paperwork) severity.
- **Escalator verbatim**: CPI-U Food Away from Home, **October** annual increase, **2% floor / 5% cap** (§IV.B.3). Feeds divergence question.
- **C-1 tax re-confirmed**: "No taxes will be assessed and/or collected in connection with the beverage service" (§IV.B.4). Exemption ruling stands on contract text.
- **SF cadence verbatim**: 75% Feb 1 / 25% March 15 (§IV.A.1) — not monthly. Confirms prior.
- **SF calc verbatim**: 30% of pre-tax budget = $402,016 (Exhibit B).
**NEW FLAG — C-17 (volume-tier pricing)**: Exhibit B — once **72,890 meals** billed in a year, MiLB rates STEP $11.35→$16.22 (snack $4.51→$6.44). A volume-triggered rate change. 2023 base numbers (2026 rates are post-escalation in the signed sheet). **Question**: does the signed Price Review v3 encode this volume tier, or assume a flat MiLB rate? If flat, billing past the threshold could be wrong. → verify against signed sheet + Joe. (Note: audit showed PG matches signed, so if signed is flat, PG inherited flat — this is a signed-sheet-completeness question, not PG staleness.)
**Other flags**: educational services $1,000/class option (§IV.C) — is this a catering-revenue line? (parallels the 2200 lines). · Late Night meal conditional pricing (§IV.B.3) · FM proration base = 240 service days.

### CIN - KY digest (logged 2026-07-14)
**Fidelity**: strong — 3 executed docs (2024/2025/2026), clean scans, year-over-year table provided.
**RESOLVES**:
- **CIN - KY 2026 contract EXECUTED + operative** (Apr 21, 2026) — NOT a paperwork gap. Proper year-by-year series.
- **Escalation = NO FORMULA** (verbatim): year-to-year renegotiation, $24.00→$24.98→$25.95. Confirms the divergence finding — Price Review v3 must NOT apply an escalator to Louisville.
- **Shape confirmed**: pure per-meal, no SF, no passthrough. Type 1 buffet $25.95 / Type 2 snack $8.64, tax not included. Simplest money shape.
- Exclusive-caterer clause (§1); Club for-convenience termination new in 2026 (30-day notice, pro-rata).
**NEW FLAGS**:
- **C-18 ($28K lump-sum REMOVED in 2026)**: 2024+2025 had a $28,000 upfront credited $2,000 × 14 homestands; **2026 deleted it** → pure weekly per-meal. If PG/workbook/MONEY_MODEL still carries the lump-sum/credit structure, it's STALE. → targeted check: does anything reference the Louisville $28K? (Phase 0a EVIDENCE_CIN-KY noted the draft-removal; confirm nothing downstream assumes it.)
- **Drafting artifact (note in Tier 2, not a bug)**: 2026 KY termination clause references "Services Fee(s)"/"prepaid Services Fees" but KY has NO service fee — copy-paste leftover from CIN - OH template. Tier 2 must state KY is per-meal-only despite stray language.
- Homestand count: 2026 = 13 (was 14 in credit structure) — verify Price Review homestand count.
- Post-game service deferred to "beginning of May" discussion (§5.a.ii) — don't assume post-game from Opening Day.
- Outside-catering/rehab clause: 72hr notice, lost-product compensation right (§5.a.iv-vi) — minor Tier 2 nuance.

### CIN - OH digest (logged 2026-07-14)
**Fidelity**: strong — 2025-26 base agreement (executed) + one HISTORICAL planning docx (not executed). Reference implementation for flat-fee + passthrough + postseason.
**RESOLVES / CONFIRMS**:
- **R11 postseason VERBATIM-CONFIRMED for CIN - OH**: "Post Season Game Rate (1/81 of the Service Fee): $4,413.58" + "Workout Day Rate (50% of Game Rate): $2,206.79" (§2.e). The 1/81 denominator is EXPLICIT, not inferred. R11 flat-fee clause locked for CIN - OH. (TXR - TX - H denominator still to confirm from its own digest.)
- **R12 passthrough VERBATIM**: food/supplies budget (§2.b) + Clubhouse Extras (§2.c), both reimbursed, explicitly over-and-above the fee. Never revenue.
- **Per-service-class (R7) vindicated**: CIN - OH "coffee" = a Clubhouse Extra REIMBURSEMENT (§2.c), NOT CIN - AZ's flat-rate coffee service. Different class, different account — correct.
- **Escalator verbatim**: CPI-U Food Away, **August**, **1% floor / 4% cap** (§2.a). Confirms divergence (AZ = Oct 2%/5%).
- **Postseason escalates too**: game/workout rates subject to §2(a) increases after each season.
**NEW FLAGS**:
- **C-19 (CIN - OH 2026 base is a STIPULATED JUMP to $362,500, not escalated-from-$357,500)**: contract explicit — "the 2026 fee will be based off of an initial fee of $362,500 and increased by the [CPI] percentage change." Correct 2026 = **$362,500 × (1+CPI Aug24→Aug25)**, NOT $357,500 × (1+CPI). → verify Price Review v3 / MONEY_MODEL start from $362,500, and whether the operative 2026 fee = $362,500 + CPI is what's stored. (MONEY_MODEL digest listed $362,500 as the base — confirm it's base-plus-CPI, not base-flat.)
- **Recognition timing**: $20,000 tail installment due **Jan 1, 2027** is part of the **2025** season fee (2025 = 6×$56,250 + $20K). Cash crosses years. Bill export / P&L tie-out should know it exists. (2025 season, so not a 2026-cert blocker, but note for tie-out.)
- 2027 = planning-only (ABR docx not executed); meet-and-confer before Nov 1 2026 per §3.a. Don't assume 2027 terms.
- Games base = ~81 MLB regular (2025 = 80 at ballpark); postseason "if qualified."

### STL - FL digest (logged 2026-07-14)
**Fidelity**: strong — the 2025-10 Amendment (executed, docx+pdf) layered on the Nov 26 2024 base (base lives in STL MO folder, not FL folder — noted).
**RESOLVES / CONFIRMS**:
- **A-5 CONFIRMED VERBATIM**: upkeep = $15K equipment (rolls over) + $4K storage pod + $11K temporary cooler (ST only) + electrical (§2.b). Sits inside the $2.3M Total Annual Fee alongside the $900K passthrough — exactly Kevin's "passthrough, Cardinals-paid" ruling. Locked.
- **$2.3M structure VERBATIM (§2.a)**: $1,400,000 Florida Services (revenue) + $900,000 food/packaging passthrough (at-cost, bi-monthly invoiced + receipts, savings to Cardinals) + $30K upkeep. Confirms MONEY_MODEL split. Revenue-recognized fee = $1.4M; gross top-line = $2.3M.
- **Cadence VERBATIM**: quarterly Nov 1 / Feb 1 / May 1 / Aug 1 (NOT calendar quarters). → verify EVIDENCE didn't use Jan/Apr/Jul/Oct.
- **No escalator**: flat $2.3M; Amendment explicitly does NOT extend the MO base CPI clause to FL. Divergence: STL - FL flat vs STL - MO escalates. → verify Price Review doesn't apply CPI to FL.
- **A-6 stays alive (Sebastian)**: §2.d requires tax "applied and itemized on each invoice"; the sampled invoice showed TAX 0.00. Question confirmed worth asking — genuinely non-taxable (0.00 satisfies itemization) vs itemization skipped.
**NEW FLAG — C-20 (2027 work-stoppage lock-in, recognition timing inside cert window)**: §2.c — **$350,000 due Nov 1, 2026, "deemed earned in full,"** covering readiness Jan–Mar 2027 regardless of services performed (MLB work-stoppage hedge). Then $175K standby OR $350K full on Apr 1, 2027 per stoppage status; resume-quarterly Jul 1 / Oct 1 2027. **The $350K hits FY2026 cash (Nov 1 2026) but is earned for 2027 readiness** — a billing event INSIDE the 2026 cert window with unusual recognition ("earned in full on receipt"). Bill export + P&L tie-out must know it exists. Not a blocker but a real tie-out item.
- Facility: Cardinals building new kitchen; delays/costs their responsibility (§1.b). Termination for convenience = 180 days (§3.a.ii, FL or Base severable). $60K base-agreement smallwares (MO §2.e) may cover Busch and/or Jupiter — verify no double-count vs $15K FL upkeep.

### STL - MO digest (logged 2026-07-14) — the shared Cardinals base agreement
**Fidelity**: strong — single 2025-27 base agreement (executed Nov 26 2024). This is the "Agreement" the STL - FL Amendment amends; both Cardinals accounts inherit its base terms.
**RESOLVES / CONFIRMS**:
- **R11 postseason VERBATIM for STL - MO**: Game $5,222.22 / Workout $2,777.78 / Road Food $600 (§2.b). **Nuance vs CIN - OH**: CIN - OH states per-game as "1/81 of Service Fee" AND escalates it; STL - MO gives FLAT dollar amounts with NO escalation clause on them → held flat 2025-27. Two flat-fee accounts, DIFFERENT postseason escalation treatment. R11 per-account nuance.
- **$698K structure VERBATIM (§2.a)**: $423,000 meal services (6 monthly from Mar 1) + $50,000 Road Food Mgmt (annually Mar 1, **SEPARATE** from the 6 installments — resolves CC's "not a 7th installment" flag) + $225,000 food passthrough. Confirms MONEY_MODEL.
- **Escalator verbatim**: CPI-U **CUUR0000SEFV** (parent Food Away index), **August** basis (§2.d). NOTE: parent SEFV, vs TBR's sub-index SEFV01 — the distinction that mattered in A-1. Divergence: STL - MO escalates Aug-SEFV; STL - FL flat.
- **Tax itemized each invoice** (§2.c) — same as STL - FL → A-6 Sebastian question applies to BOTH Cardinals accounts.
- Capacity: 70/meal, 81 home games + 6 workouts. TFC fees decline $60K/$40K/$20K by year (§3.b.ii).
**NEW FLAG — C-21 (shared $60K investment, double-count risk)**: STL - MO §2.e = up to $60K equipment "for Busch Stadium AND/OR the kitchen in Jupiter, FL," title to Cardinals. Same $60K may overlap STL - FL's $15K FL equipment budget. NOT revenue (KitchFix capex) → doesn't touch bill export. But any cost/margin analysis counting both would double-book ~$15K. Minor, not a cert blocker. Flagged both directions.
- CPI "Pricing" scope ambiguity (§2.d): does CPI adjust the $225K passthrough budget or only the fee? Statute silent → verify Price Review scope.

### TBJ - NY digest (logged 2026-07-14) — the documentation-gap account
**Fidelity**: strong read, but the SOURCE is thin — only a 2019 DRAFT SOW (unsigned, "Note to Draft" markup, placeholder dates), single-season, HISTORICAL. Never operative for 2026.
**CONFIRMS THE GAP (does not resolve it)**:
- **No operative 2026 Buffalo contract exists in files.** No 2020–2026 SOW of any kind.
- **Governing master (MSA dated Dec 11, 2018) NOT in folder** — base terms (MFN, exclusivity, IP, indemnity) unread for this account.
- **2019 draft rate = $18.75/meal** — nowhere near the operative $27.34 in PG/MONEY_MODEL. Today's number is NOT derivable from the historical doc.
- **Operative $27.34 is assumption-only** with zero contemporary contract backing. The ONLY thing attesting it is the signed Price Review v3 (Joe) + PG match (audit put TBJ - NY in the 100%-match group).
**CERT FRAMEWORK read (honest)**:
- Price the SYSTEM uses = Joe-attested via signed sheet → billing-accuracy is covered.
- What's MISSING = the contract justifying the rate (the "why $27.34" paper) + client countersignature.
- Per Layer B, paperwork gaps are risk-acceptable IN WRITING with owner + revisit date when the operative price is confirmed — which it is.
- **Disposition: does NOT block certification, but TBJ - NY carries the MOST documentation risk of the 11.** Risk-accept EXPLICITLY + VISIBLY. Business exposure (not billing exposure): a Buffalo rate dispute would have the signed internal price but no client-countersigned contract to cite. → highest-priority paperwork chase: (1) the Dec 2018 MSA, (2) a current-year Buffalo SOW or written rate confirmation. Owner: Kevin (business-side).
- **The `w_3rdpartyvendor` in the filename** hints at a subcontractor arrangement not detailed in the SOW body — flag if anything in PG references Buffalo third-party passthrough.

### TBR - FL digest (logged 2026-07-14) — the headliner: C-2 + A-1 residual + escalation-divergence
**Fidelity**: strong — 4 executed 2024 docs (MLB Agreement + MLB SOW + MiLB Agreement + MiLB SOW), all Nov 16 2023, John P. Higgins (Rays) + Josh Katt. Retention: MLB→Oct 1 2026, MiLB→Dec 31 2026.
**C-2 REFINED (not re-reversed — your "recurring" ruling holds, with a precision)**:
- $200K signing + variable-second CONFIRMED verbatim (2024: $200K + $182,448; MiLB SOW §6(c)). With 2021 screenshot ($200K + $120,569.84) = pattern in 2 discrete years.
- **BUT the mechanism is SOW-GATED, not auto-recurring**: base agreement says the Service Fee is paid "in the amounts and at the times set forth in the SOW" — binding only for each executed SOW's year. UNLIKE the per-meal rates (which have an explicit CPI auto-escalation clause), the Service Fee has **NO auto-generation mechanic.** So: fee recurs in practice, but each year needs its own executed SOW, and **2025 + 2026 SOWs are NOT in the folder.** The 2026 fee amount is undocumented in hand.
- This makes Joe #3 (how is the variable set each year?) LOAD-BEARING — no formula exists; each year is negotiated + papered in a fresh SOW. The bill export can't produce the 2026 fee without either the 2026 SOW or Joe's rule.
**A-1 RESIDUAL SOLVED (vindicates the dissolution)**:
- The mystery "$28.90 signed Lunch full-rate not derivable from $25.86" is RESOLVED: $25.86 = "2024 **Base** Lunch/Dinner Rate"; contract has a TWO-TIER MiLB structure — a Base rate AND a "Post service-fee Rate" ($19.40). Service Fee "reduces Rates by 25%." So $25.86 escalated 2yr × 75%-CPI ≈ $28.90 (the escalated Base); the billed post-SF rate is that × 0.75. The signed sheet's $28.90 is the escalated BASE, not the billed rate. Same error-species as the digest-flattening that started A-1 — reading a Base where a Post-SF belongs. **A-1 fully closed.**
- **MODEL-CHECK C-22**: verify MONEY_MODEL/PG use the correct MiLB tier — the POST-service-fee rate ($19.40 base → escalated) is the billed number, NOT the Base ($25.86). (Audit showed PG stores Lunch $21.675 / Dinner $20.96 — those ARE post-SF-tier escalated values, so PG looks correct; confirm the Base-vs-Post labeling in the signed sheet is understood, not mis-stored.)
**ESCALATION-DIVERGENCE — sharpest instance (C-23)**:
- TBR = **75% of CPI**, **sub-index SEFV01** (Food Away — Full Service Meals & Snacks), **November** reset. TBJ - FL = 100% of CPI. → if Price Review v3 applied uniform escalation, TBR is MIS-MODELED. This is the escalation-divergence made concrete: not just month/cap differences but a different % of the index. Strongest case for the post-digest escalation-verification pass.
**Other**: MLB SOW has NO service fee (all per-meal; the $200K pattern is MiLB-ONLY). Weekly invoicing both SOWs. Dispute → 10-day window then CPA arbitration. Commissary exclusivity (Exhibit 2). Right of First Negotiation if Rays leave Charlotte Sports Park. Postseason = same per-meal rates (no separate postseason price) — confirms R11 per-meal clause for TBR.

### TXR - AZ digest (logged 2026-07-14)
**Fidelity**: strong — 2022 (superseded) + 2025-2027 master w/ 2025 SOW (operative). Full year-over-year table.
**RESOLVES / CONFIRMS**:
- **Deposit-triggered discount mechanic VERBATIM** (§2.a-b): Team pays **Annual Deposit = 20% of projected total Services Fee** (3 installments Jan/Feb/Mar); AFTER paying it, receives **20% discount on every per-meal fee.** The discount is TRIGGERED by the deposit — distinct from CIN - AZ flat-30% and TBR flat-25%. This is a fourth SF sub-mechanic. Now documented.
- **Escalator VERBATIM + cleanest of all 11**: "Starting in 2026, per-meal pricing shall increase by **2.5%**, and in 2027 by 2.5% over prior year" (§2.a). Flat fixed %, NO CPI/index/month/cap. 2026 rates = 2025 × 1.025, trivially derivable. Phase 0a confirmed invoices match 2025 × 1.025.
- **Weekly per-meal billing, 30-day terms** (§3). 2025 deposit = $297,419.26 (Jan/Feb/Mar). Kitchen improvements: Provider funds up to $75K (§5).
**PAPERWORK GAP — narrower than it looks (contrast TBJ - NY)**:
- 2026 SOW missing, BUT the fixed 2.5% escalator DETERMINES 2026 rates from the master — rates are derivable without a 2026 SOW. The ONLY undocumented piece is the 2026 **Annual Deposit dollar amount** (projection-driven, set yearly).
- **Risk profile: LOW** (vs TBJ - NY high). Valid multi-year master + fixed escalator + invoices confirm the math. Remedy is easy: generate the 2026 SOW to document the deposit figure. → paperwork chase, low-priority, owner Kevin.
**Minor flags**: 2022 had a "Continental Breakfast $8" SKU dropped in 2025 — check how PG prices Continental in 2026. · $75K kitchen equipment appears in BOTH 2022 + 2025 agreements — verify not double-funded. · 2022 $50K start-up fee correctly absent in 2025.

### TXR - TX - H digest (logged 2026-07-14)
**Fidelity**: strong — 3 single-year agreements (2024/2025/2026), 2026 EXECUTED (Jan 21 2026, Ross Fenstermaker + Josh Katt). Clean year-over-year table.
**RESOLVES / CONFIRMS**:
- **TXR - TX - H 2026 contract FOUND + operative** — NOT a paperwork gap (CC's earlier "Q4 found" confirmed). Proper year-by-year series.
- **$604,032 fee VERBATIM** + full installment table (6 × $100,672 pre-tax, Apr–Sep). Matches MONEY_MODEL.
- **+10% YoY jump is REAL and un-formula'd**: NO escalator clause; each year priced independently. 2026 $604,032 is NOT derivable from 2025 $549,120 by formula — negotiated +10% jump. → verify Price Review uses actual $604,032, not a formula-escalated number. (Mirror of CIN - OH base-jump; C-19 sibling.)
- Divergence: TXR - TX - H = NO escalator (annual negotiation) vs TXR - AZ = explicit 2.5%. Two Texas accounts, different escalation.
**R11 REFINED — three flat-fee postseason expressions**:
- CIN - OH: explicit "1/81 of Service Fee" + escalates.
- STL - MO: flat stated dollars, no escalation.
- **TXR - TX - H: "pro rata Services Fee per Postseason Game" — NO stated denominator, NO stated dollar.** 1/81 INFERRED from 81-game count ($604,032÷81 ≈ $7,457/game). Mechanic consistent (per-game fraction of annual), EXPRESSION differs per contract; only CIN - OH states the denominator. → for bill export, TXR - TX - H postseason rate is COMPUTED (fee ÷ regular-season games), not read. R11 denominator caveat RESOLVED: it's "pro rata," 1/81 is the sensible read, but the contract doesn't literally say 81.
**NEW FLAG (cost, not billing)**: 2026 Background Check Letter (Schedule A) — background checks at KitchFix sole cost, NEW 2026. Absorbed cost, not a passthrough line. Minor. Also: 12 post-game catered meals = passthrough (Rangers pay). Tax gross-up 8.25% (Arlington). 75%-workforce-by-Mar-1 + min-6-staff obligation (§4.e).

### TXR - TX - V digest (logged 2026-07-14) — A-7 confirmed from the contract side
**Fidelity**: strong — no standalone V contract exists; V is a carve-in inside the shared 2026 MLB agreement (same doc as TXR - TX - H), identical language 2024/2025/2026.
**CONFIRMS A-7 (contract side)**:
- **V is a bundled carve-in, not a contract.** Verbatim scope (§1.b): "in the visitors' clubhouse, Contractor agrees to provide: Grab & Go Snack options, packaged snacks, condiments, and beverages, and coffee service." **Expressly EXCLUDES made-to-order/buffet** (home-only). Contract confirms V is NOT a buffet mirror of H.
- **No separate fee / count / revenue line** — bundled into H's $604,032. Zero dollars contractually assignable to V. → the SC modeling a full buffet for V contradicts the contract. Phase-3 catalog fix confirmed from contract side too.
**RECONCILIATION — the TWO V's (both true, not contradictory)**:
1. **Contract V** = baseline hospitality (G&G/snacks/coffee) for whoever's in the visiting clubhouse, paid via H's fee. Zero separate revenue.
2. **Operational V** (Britt's SOP) = an ACTIVE SALES operation — chef pitches visiting teams à la carte menus, they opt in, KitchFix bills them DIRECTLY. This is the $312K in the P&L (A-13).
- These coexist: contract fee covers the snacks baseline; direct sales are INCREMENTAL à la carte orders on top. That's why the P&L books $312K the contract never mentions.
- **So the digest's "MONEY_MODEL crediting V with buffet revenue is out of contract scope" flag is RIGHT about the contract, but the $312K is NOT a contract-revenue error** — it's legitimate direct-sales revenue correctly tracked OUTSIDE the SC (Season Tracker / catering-sales workflow). Both true.
- **Net for cert**: V generates no SC per-period club bill (correct); its baseline is covered by H's fee (contract); its real money is opt-in direct sales tracked separately (SOP). Phase 3 = remove V's buffet modeling from the SC. A-13 remains resolved.
- Location clause (§1.c) ambiguity: Meals served "in the home clubhouse (and the visiting clubhouse when appropriate)" — leaves manager-discretion hot-meals to visiting clubhouse as a verbal-practice question. Non-blocking; the SOP direct-sales model already covers how those get billed.

---

## Q. FULL CONFLICT REGISTER RECONCILED (all phases 0a–0d, mapped to our rulings 2026-07-14)
The register accumulated across CC's four phases; several entries were written before our ruling session resolved them. Authoritative status:

### A-conflicts — final disposition
- **A-1** → RESOLVED, NOT-A-CONFLICT. (Register's own Phase 0c revision agrees: signed sheet stores 3 distinct MiLB rates, PG matches, invoice bills Lunch $21.68 correctly; the "$0.72" was digest-flattening. Kevin's negotiated-rate context + the TBR digest's Base-vs-Post-SF two-tier finding fully close it.)
- **A-2** → PAPERWORK GAP (not "one-time"). TBR SF recurs ($200K + variable, SOW-gated); 2025+2026 SOWs missing.
- **A-3** → OneSheeter-operative, provenance-flagged → JOE #1.
- **A-4** → **DISSOLVED, not-a-conflict (§T, 2026-07-15).** ⚠️ The "$11.55 blend" framing here is superseded. FSL and FCL are two SEPARATE groups at two locations (FCL at PDC $11.55; FSL = Dunedin Single-A at stadium $16.51), not two tiers of one blended population. Both already correct in SC + signed sheet. See §T.
- **A-5** → RESOLVED: passthrough, Cardinals-paid (contract §2.b verbatim confirms).
- **A-6** → SEBASTIAN #1 (tax itemization vs 0.00; no SC impact).
- **A-7** → RESOLVED: opt-in sales model, out of SC scope (SOP + contract carve-in confirm).
- **A-8** → likely convention (flat-fee SFs book in 2400.1) → JOE #2 confirms; provisionally resolved.
- **A-9 / D-3** → GOTCHAS stale (STL-FL P1 = $171,367 not $45,553; peak P2). Doc-fix, batched.
- **A-10 / A-11** → CIN-AZ 2200 ($52K) + TBR 2200 ($79,950) catering revenue undocumented in MONEY_MODEL. **Open** — Kevin classifies (educational classes? B&G? road sandwiches?).
- **A-12** → RESOLVED by recurring-SF finding (real 2026 fee, not derivation).
- **A-13** → RESOLVED: TXR-V $312K = opt-in direct sales, out of SC scope (A-7 sibling).
- **A-14** → RESOLVED: $20.31 (Joe-approved); PG fix Phase 3. Flagged: CC read signed cell as 20.30622 — audit-precision spot-check owed.

### C-paperwork gaps — consolidated chase list (Kevin, business-side)
CIN-AZ 2026 renewal notice (not a missing SOW — renewal-option mechanic) · TBJ-NY 2020+ Buffalo SOW + Dec 2018 MSA (highest doc-risk account) · TXR-AZ 2026 SOW · TBR-FL 2025+2026 SOWs (the variable-installment amounts) · TXR-TX-H §2(d) kitchen-budget (cited but absent) · C-5 TBR B&G $6.50 lunch rate (not in contracts) · C-6 CIN-AZ Exhibit-B $16.22 volume-tier (= my C-17 flag). **All risk-acceptable per Layer B** (operative prices Joe-attested via signed sheet); none block certification. Owner: Kevin.

### New double-count pointers (cost-analysis only, NOT billing/revenue — no cert impact)
C-14 STL $60K vs $15K FL equipment · C-15 TXR-AZ $75K kitchen (2022 vs 2025 — fresh or rollover?) · C-16 TXR-V H/V revenue split is internal not contract-driven.

### The escalation-divergence (D-2) — now COMPLETE across all accounts, verbatim
CIN-AZ Oct 2%/5% · CIN-OH Aug 1%/4% · CIN-KY none · STL-MO Aug SEFV no-cap · STL-FL flat · TBR 75%×SEFV01 Nov · TBJ 100%×SEFV Q4 · TXR-AZ fixed 2.5% · TXR-TX-H none (+10% negotiated). **NINE distinct escalation treatments.** → the post-digest ESCALATION-VERIFICATION PASS (re-derive each 2026 rate/fee from clause + real CPI, confirm signed sheet applied the right rule per-account) is now a firm recommended CC task. This is the last systematic check before Layer D fully greens.

### Batch doc-PR (staged, post-digest): D-1 Lessard rename · D-3 GOTCHAS fix · B-1..B-9 digest rate expansions (TBR MLB/MiLB Breakfast splits, TBR/CIN-AZ 2200 lines, add-on line items, coffee/fountain rates) · B-10/B-11 naming.

### PRICE_AUDIT full doc reviewed (logged 2026-07-14) — confirms Phase 0c, sharpens A-14
**Full audit doc confirms**: 99/105 MATCH · 1 STALE_PG (rounding) · 4 naming-only UNMAPPED · 1 UNKNOWN (Joe) · billing has NOT diverged from signed (all 9 invoices reconcile within rounding). Layer D price gate essentially GREEN. A-1 buried with receipts (PG stores all 5 TBR MiLB rates exactly; invoice bills Lunch $21.68 = signed $21.675; digest's $20.96 was the Dinner rate).
**A-14 SHARPENED (confirms the earlier precision correction)**:
- The audit reads the signed cell as **$20.30622** and recommends fixing PG to $20.30622. **BUT Kevin ruled $20.31 is what Joe approved, and Kevin's word overrides CC's cell-read.**
- **KEY EVIDENCE FOR KEVIN'S POSITION**: audit §5.1 shows invoice K300168587 bills "REDS MLB - Meal Service **$20.31**" — the REAL bill uses $20.31, not $20.30622. So the cell holds a sub-cent/formula value ($20.30622) while the approved+billed figure is $20.31.
- **Phase-3 fix target = $20.31** (Kevin-approved + invoice-confirmed), NOT $20.30622 (audit's cell-read). Already logged this way.
- **STANDING FLAG confirmed**: the audit's "signed" values may be pre-rounding CELL reads, not approved figures. Immaterial at billing level (§5.1 shows all invoices round cleanly to cents) but matters for PG STORAGE. → when PG is corrected in Phase 3, store the APPROVED cent-values, and/or confirm with Joe whether the signed sheet should display cents vs sub-cent precision. Low-stakes, but the R10 storage-precision question interacts here: decide whether PG stores sub-cent (matching a corrected sheet) or cent (matching approved/billed).
**TBJ - FL preview (A-4)**: audit shows TBJ - FL 21/21 MATCH including "FSL Team" AND "FCL Team" as DISTINCT services, both matched by PG. → the signed sheet DOES carry both separately, and PG matches. **[This was the tell — confirmed in §T: FSL and FCL are two distinct groups/services, NOT a blend. The signed sheet was right all along; the "blend" was an artifact of the single sampled invoice showing only the FCL line.]**

### TBJ - FL evidence pack (Phase 0a, logged 2026-07-14) + A-4 fully teed up
> ⚠️ **A-4 RESOLVED in §T (2026-07-15) — the "blend" question below was the WRONG question.** The answer wasn't "negotiated blend vs coincidence"; it was that FSL and FCL are two separate groups eating in two locations at two prices (FCL PDC $11.55 / FSL stadium $16.51). The single invoice showed only the FCL line, creating the illusion of a blend. Discovery history preserved below; §T governs.

**Fidelity**: strong evidence pack — contract §12 verbatim + 2 invoices (MLB K300168548 @ $23.12, MiLB K300168872 @ $11.55), both weekly, FL 7% tax.
**A-4 — FULLY INFORMED, awaiting Kevin's ruling**:
- Contract §12(b): TWO MiLB tiers — FSL Team $14.50 / FCL Team $10.14 (2023 base). MLB $20.29. Snack $1.50, Shake $5.00.
- Invoice bills single blended **$11.55** MiLB, line = "TBJ MiLB - Breakfast/Lunch/Dinner", NO FSL/FCL split. $11.55 sits BETWEEN $10.14 and $14.50.
- **KEY INSIGHT**: the daily meal counts don't separate FSL-assigned from FCL-assigned players — billing operates on ONE blended MiLB population. Matches Kevin's earlier note ("no FSL reference in the billing spreadsheets"). The two tiers = pricing FRAMEWORK; the blend = operative PRACTICE; signed sheet (PG 100% match) ratifies $11.55.
- **Same species as TBR/A-1**: contract states structure, practice runs a negotiated simplification, signed authority blesses it. Tiers not violated — administered as a blend.
- **THE ONE THING ONLY KEVIN KNOWS**: is $11.55 a DELIBERATELY negotiated blended rate (agreed "bill one MiLB rate"), or a number that happens to sit between tiers with no explicit agreement? Negotiated → handshake deal in Tier 2, tiers = framework, A-4 closes clean. NOT explicitly agreed → billing an unauthorized blend → either enforce tiers (needs FSL/FCL day-tracking build) or paper the blend.
- Also confirms: A-3 (SF cadence = OneSheeter not contract, contract §12(a) says only "annual", §12(e) weekly per-meal — CONFIRMS OneSheeter-sourced) · postseason SAME rates (R11 per-meal ✓) · **MFN clause §12(d) VERBATIM** — obligates KitchFix to pass more-favorable pricing given to other customers (equiv/lower volume) back to TBJ-FL → operational risk to note, not a conflict · escalation §12(c) = provider-initiated + documented cost basis + Club written approval (not automatic; can decrease) → the 2026 $23.12/$11.55 rates should have an approval trail; UNKNOWN if on file.
**TBJ escalation = 100% CPI Food Away From Home (broad index), Q4 reset** — the COUNTERPOINT that makes TBR's 75%×SEFV01 divergence concrete. Escalation-divergence picture COMPLETE.

### TXR - AZ evidence pack (Phase 0a, logged 2026-07-14) — FINAL digest, cleanest verification
**Fidelity**: strong — 2025-2027 master + 2025 SOW #1 + 2 invoices (MLB K300168585 @ $28.58, MiLB K300168870 @ $14.29 + snacks), AZ 9.5% tax.
**THE CLEANEST END-TO-END TRACE of the corpus**:
- 20% deposit-discount mechanic VERBATIM (§2.a-b): pay Annual Deposit → 20% off per-meal. Math clean ($27.88/$34.85 = 0.80).
- Fixed 2.5% escalator VERBATIM (§2.a). **Every 2026 rate derives EXACTLY from 2025 × 1.025**: MLB $27.88→$28.58 ✓ MiLB $13.95→$14.29 ✓ snacks ✓. **Invoices bill those exact derived rates.** Contract → escalation → signed sheet → PG → invoice ALL COHERE. This is "the system is right" traceable end-to-end.
- Divergence counterpoint to its OWN sibling: TXR - AZ = fixed 2.5% vs TXR - TX - H = no escalator (+10% negotiated). Two Rangers accounts, opposite mechanics.
**Confirmations**: 2026 SOW MISSING (paperwork-memorialization gap only — rates fully derivable + invoice-matched; the 2026 DEPOSIT amount is the one thing needing the SOW/Kevin memo, depends on new projection) · weekly invoicing Net 30 · $75K kitchen equipment KitchFix-borne (§5) · deposit retained on breach-termination (§4.c) · no postseason clause (spring-training facility) · no passthrough.
**Rate-table gaps**: snack rates (Pre-Game Hot Snack $10.93, Regular Snack $5.89) not in digest (B-3) · PG has `MLB Dinner` @ $28.58 but SOW lists MLB Breakfast+Lunch only (B-4 — new-service in missing 2026 SOW, or operationally = Lunch). Minor digest additions.

---

## R. ALL 11 DIGESTS LOGGED — corpus complete (2026-07-14)
Every account has verbatim contract terms banked. The escalation-divergence catalog is COMPLETE and verbatim:
| Account | Escalation | Shape |
|---|---|---|
| CIN - AZ | CPI Food-Away, **Oct**, 2%/5% floor-cap | per-meal + SF% 30% + hybrid |
| CIN - KY | **NONE** (year-to-year renegotiation) | per-meal no-SF |
| CIN - OH | CPI Food-Away, **Aug**, 1%/4% floor-cap + base-JUMP to $362,500 | flat-fee + passthrough |
| STL - FL | **NONE** (flat $2.3M) | flat-fee + passthrough |
| STL - MO | CPI **CUUR0000SEFV** (parent), **Aug**, no cap | flat-fee + passthrough |
| TBJ - FL | **100%** CPI Food-Away (broad), **Q4**, provider-initiated+Club-approval | flat-SF + per-meal |
| TBJ - NY | NONE documented (no operative contract) | per-meal no-SF (assumption) |
| TBR - FL | **75%** CPI **SEFV01** (sub-index), **Nov** | per-meal SF% 25% MiLB + recurring $200K+variable SF |
| TXR - AZ | fixed **2.5%**/yr | per-meal 20% deposit-discount |
| TXR - TX - H | **NONE** (+10% negotiated 2026) | flat-fee |
| TXR - TX - V | n/a (carve-in, opt-in sales) | opt-in direct sales (out of SC scope) |
**NINE distinct escalation treatments.** A single global formula would mis-price nearly everything. → the ESCALATION-VERIFICATION CC PASS (re-derive each 2026 number from clause + real CPI, confirm signed sheet applied the right per-account rule) is the last systematic check before Layer D fully greens. TXR - AZ + TBR + CIN-OH already spot-verified correct in-session; the pass confirms the rest.

### TXR - AZ contract digest (logged 2026-07-14) — confirms evidence pack, corpus now DOUBLY closed
Verbatim digest matches the evidence pack. Adds: year-over-year history (2022→2025-27), start-up fee $50K dropped after 2022, Continental Breakfast SKU dropped in 2025 SOW (verify how Continental is priced in 2026 PG — B-4 sibling). 2026 mechanic airtight without SOW: master + 2.5% escalation + invoice-match; only the 2026 DEPOSIT dollar amount is genuinely undocumented (needs projection). **C-15 confirmed**: $75K kitchen equipment appears in BOTH 2022 and 2025-27 as fresh commitment — verify one-spend-restated vs genuine second obligation (KitchFix capex, no billing impact).
**COVERAGE NOTE**: TXR - AZ, TBJ - FL now have BOTH an evidence pack (Phase 0a) AND a verbatim contract digest (Phase 0d) logged. All 11 accounts have verbatim contract terms banked from at least one source. Document-coverage error class CLOSED — the failure mode that flipped C-2 twice (ruling on one slice of multi-doc history) can no longer recur.

---

## S. THE ABR 2025 ONESHEETER / QBR (ABR_2025_OneSheeter.xlsx) — folded in 2026-07-14
> **Note**: this section consolidates what were two separate §S passes on the SAME document (the "QBR" and the "ABR OneSheeter" are one file). Merged 2026-07-15 for clarity; all unique findings from both preserved. Full standalone write-up in `reviews/ABR_ONESHEETER_REVIEW.md`.

The departed Director of Account Management's year-end 2025 handoff / annual business review. 5 tabs (Master Template + TEXAS RANGERS/Surprise, CINCINNATI REDS, TORONTO BLUE JAYS, TAMPA BAY RAYS — **no STL, no Globe Life TXR-TX**). A DIFFERENT LENS than contracts: 2025 operational actuals + 2026 asks + client stakeholders. SECONDARY source per P-1 (below contracts + signed sheet); corroborates, never overrides. Covers only the 4 relationships this director owned — not a complete 11-account picture. Read in full.

### RESOLVED A-10 + A-11 (via the KF Notes) — NOTE: A-11 later REVERSED by Kevin, see §T
- **A-10 (CIN-AZ $52K 2200 Catering Revenue) = Fantasy Camp + Owners Week Caterings + similar events.** Reds tab verbatim: "These numbers are with the 'Catering Revenue' removed (Fantasy Camp, Hell week, etc.)" — "Hell week" = internal name for **Owners Week Caterings**. NOT the $1K educational demos. → Kevin ruled (§T): ancillary event-catering, billed separately, OUT of SC scope. **CONFIRMED.**
- **A-11 (TBR-FL $79,950 2200 Catering Revenue) = Boys & Girls Club (BGC).** Rays tab verbatim: "These numbers have BGC numbers removed." → the OneSheeter's framing here ("ancillary, separate-tracked, out of scope") **was WRONG**. Kevin reversed it (§T): **BGC IS tracked in the SC and IS projected as TBR-FL revenue** — TBR is the commissary-model account and BGC rides on it as a second client. See §T for the correct disposition. Feeds C-5 ($6.50 BGC lunch = a real in-scope TBR-FL service line).

### INDEPENDENTLY CORROBORATES the contract corpus (contract-info blocks match banked terms)
- **TXR-AZ**: P&L, through 2027, 2.5% annual, 20% SF, deposit 1/3 Jan/Feb/Mar ✓. Stakeholders: **Katie & Brandon** (Katie main).
- **CIN**: 30% SF, 75% Feb 1 / 25% Mar 15, bracketed 2-5% CPI ✓. Stakeholder: **Ashley**. Good-through: end 2025 + 1yr auto-extension by Nov 1 (matches the renewal-option mechanic).
- **TBJ**: SF = "Previous year Service Fee + CPI", ask 1×/year, split 1/1-2/1-3/1 evenly ✓ (A-3 confirmed, OneSheeter-sourced). Stakeholders: **Michelle, Katarina** (Rogers if RFP).
- **TBR**: 25% SF, Nov-Nov CPI, "$200K on the first day, remaining due 2/1" ✓✓ — **independently confirms C-2's $200K + variable structure from a second source.** Stakeholders: **Alex Roth** primary, Tatiana + Sonny secondary. Good-through: end 2026 + options through 2028.
- 2025 rate tables escalation-consistent with signed 2026 (TXR-AZ ×1.025 exact; CIN coffee $491.87→$511.05; TBR ST-vs-regular Bfast split matches signed = confirms C-11 are two real services).

### BIG OPERATIONAL FINDING — meal→snack mix shift (revenue erosion)
Nearly every account shows actual MEALS under budget + SNACKS/continental over → revenue erosion (snacks bill lower). TXR net −$33K, CIN −$54K MiLB meals, TBJ −$34K MiLB; TBR the +outlier. → makes the SC's GRANULAR per-service pricing load-bearing (PG already stores snacks/continental separately — the mix shift is exactly why). Projection-accuracy point, not billing-correctness.

### NEW FLAG — C-24 (QBR 2025 post-SF prices don't all match our numbers)
The "25 Meal Price" + "25 Post S.F." columns are 2025 operational-tracking figures. SOME don't cleanly reconcile to contract-derived / signed-sheet values:
- CIN MLB Meal: 25 price $27.92 / post-SF **$19.54** (blended? CIN-OH is flat-fee, CIN-AZ MLB is $29.01 sticker/$20.31 post — the "CINCINNATI REDS" tab appears to BLEND OH+AZ or report GY only).
- TBR MiLB Lunch: 25 price $28.20 / post-SF **$21.15** (signed 2026 Lunch = $21.675; 2025 would be lower pre-escalation — plausibly consistent).
- TBR MiLB Bfast: 25 $23.26 / post-SF $17.45 (signed 2026 = $17.8275; 2025 pre-escalation plausible).
- TBJ MLB $22.25 / MiLB $11.12 (2025; 2026 signed = $23.12 / $11.55 — consistent with ~4% escalation ✓).
- TXR-AZ MLB $34.85 / post-SF $27.88, MiLB $17.43 / $13.94 (2025 — EXACT match to contract SOW ✓).
**Read (measured)**: MOST reconcile as 2025 pre-escalation figures (TXR-AZ exact; TBJ ~4%; TBR plausible). The CIN row looks BLENDED (OH+AZ or GY-only) — a reporting choice, not necessarily a price conflict. LOW authority under P-1 (signed sheet wins). → fold into the ESCALATION-VERIFICATION PASS as a cross-check: agreement = triple-confirmation; divergence = likely a QBR blend/rounding, not a signed-sheet error. Do NOT treat QBR as authority; treat as corroboration.

### NEW services to verify in PG (add to batch)
- CIN "Rehab" ($17.73/$12.41, 5,700 est — distinct line or billed as MiLB?)
- TBR à-la-carte "Protein C/P" $107.64 + "Protein B/S" $156.08 (= B-5 extra-protein, two SKUs)
- TBJ "Single A Jays" $15.89 = **Vancouver Canadians** (Single-A) — is this in the 11 or mislabeled TBJ-NY? Confirm mapping.
- **TBR "MLB L/D + Ump" line** ($38/$38) — confirms umpire meals bundle into MLB L/D. **TBR "MiLB ST" vs "MiLB" rows are DISTINCT in the QBR** (ST Bfast $21.96/$16.47 vs regular Bfast $23.26/$17.45) → relevant to C-11: shows them at DIFFERENT 2025 prices; confirm whether 2026 signed collapsed them to the same $17.8275 deliberately or if ST should differ. [Kevin ruled §U: no cost diff at 2026 values.]

### BONUS — non-pricing context captured (note, don't action now)
- **Client stakeholders per account** (above) — useful for the Joe/Sebastian lists + future account docs.
- **SF due-date cadences confirmed** from a second source (all match contracts).
- **2026 forward asks (operational, not pricing)**: TXR wants MLB-ST snack/bev BILLBACK + possible flat-fee "Yankees model" visiting side · CIN "Fee vs P&L for GY" (Goodyear shape open) · TBJ "Fun Money program review" (is_non_revenue flag) · TBR action-stations "charge more for additional items" + visiting-team "how do we charge." Bill export should be buildable to accommodate these even though they're not live yet.

**NET (as of the OneSheeter review)**: shrank open rulings from 3 to 1 (A-10/A-11 addressed here; A-4 was the last needing Kevin's memory). **All three subsequently closed by Kevin in §T** — including the A-11 reversal that this section got wrong. Escalation-verification pass unchanged as final systematic check.

---

## T. FINAL RULINGS — A-4, A-10, A-11 (Kevin, 2026-07-15) — TWO were wrong in prior docs

### A-4 — DISSOLVED as NOT-A-CONFLICT (the "blend" was a phantom; FSL/FCL are two separate groups, not tiers)
**Kevin's correction — the entire prior framing was wrong.** FSL and FCL are NOT two pricing tiers of one MiLB population, and $11.55 is NOT a blend between them. They are **two distinct groups, two locations, two services, two prices**:
- **FCL** = the minor-leaguers who eat **at the PDC**. Contract wrote **$10.14**; **today = $11.55** (breakfast/lunch/dinner). This is what the $11.55 line bills.
- **FSL** = the **Dunedin Blue Jays (Single-A)** who eat **at the stadium**. Contract wrote **$14.50**; **today = $16.51** (breakfast/pregame/postgame). A SEPARATE line.
- Both are **already correct in the service calendar and the signed price sheet.** The sampled invoice simply didn't show the FSL line.
**Why the confusion happened**: same error-species as A-1 — a summary (the contract-tier language + the single sampled invoice) made two distinct services look like one "blended" thing. There was never a blend to negotiate or paper. **A-4 → NOT-A-CONFLICT; two distinct groups/services, both priced correctly in SC + signed sheet.**
**Corroboration**: the price audit already showed the signed sheet carries "FSL Team" AND "FCL Team" as DISTINCT services, both PG-matched — consistent with Kevin's account.
**ONE VERIFY OWED (non-blocking, does NOT reopen ruling)**: confirm the signed sheet shows FSL at the CURRENT **$16.51**, not the old $14.50. If it still shows $14.50 → a real staleness catch to fix. If $16.51 → fully current. Either way A-4 stays dissolved (two distinct services is the ruling; the FSL number is a separate price-currency check).
**Doc impact**: correct the ledger/register/CONTRACT_DIGEST_TBJ-FL framing everywhere they call this a "blend" or "two tiers of one population." FCL and FSL are two clients/groups. Update MONEY_MODEL digest: TBJ-FL MiLB is NOT a single $11.55 — it's FCL $11.55 (at PDC) + FSL $16.51 (at stadium), two distinct services.

### A-10 — CONFIRMED out of scope (Kevin)
CIN-AZ $52K 2200 = Owners Week Caterings + Fantasy Camp. **Billed separately; OUT of SC scope.** Document in MONEY_MODEL as a named ancillary event-catering line, excluded from the SC per-meal model. LOCKED.

### A-11 — REVERSED: BGC is IN SCOPE, part of TBR-FL projected revenue (Kevin) — the INVERSE of A-10
**My "out of scope" rec was WRONG. Kevin's correction:**
- **TBR-FL is the ONLY account that does NOT cook in the client's facility.** KitchFix rents a **COMMISSARY** and delivers to the PDC, serving on-site.
- The **Exec Chef has a separate relationship with the Boys & Girls Club**. To add revenue to the commissary operation, KitchFix **produces food for BGC and bills them like a SECOND CLIENT under the TBR-FL account.**
- **BGC counts ARE tracked in the service calendar. BGC sales ARE projected as part of TBR-FL revenue.** The P&L 2200 line includes BGC **because it belongs there.**
**Disposition**: BGC is an **IN-SCOPE revenue stream** for TBR-FL — effectively a second client riding on the TBR-FL commissary operation. MONEY_MODEL must document BGC as in-scope TBR-FL revenue (NOT excluded). The bill export logic for TBR-FL must account for BGC as tracked/projected SC revenue.
**Contrast locked**: A-10 (CIN Owners Week/Fantasy Camp) = genuinely separate, out of scope. A-11 (TBR BGC) = in the SC, in TBR-FL projected revenue, in scope. The two 2200 catering lines have OPPOSITE dispositions — do not treat them the same.
**Feeds C-5**: the missing $6.50 BGC lunch rate is now understood — it's a real in-scope TBR-FL service line (the BGC "second client"). → the BGC rate(s) should be in the signed sheet / PG as TBR-FL services; verify they're present.
**New structural fact banked**: TBR-FL = commissary model (not on-site at client facility), which is WHY it can carry a second-client (BGC) revenue stream the other accounts can't. This is a first-class TBR-FL account characteristic for its account file.

### NET: all Kevin-owned rulings now CLOSED
A-4 dissolved · A-10 out-of-scope · A-11 in-scope (reversed). Remaining open items are async (Joe 5 / Sebastian 4) + the escalation-verification CC pass. No Kevin ruling outstanding.
**Two price-currency verifies owed (non-blocking)**: FSL signed-sheet rate = $16.51 (A-4)? · BGC rate(s) present in signed sheet/PG as TBR-FL services (A-11/C-5)?

## U. MORE RULINGS (Kevin, 2026-07-15) — clears 3 async items

### C-8→C-12 (the 5 signed-sheet Instructions-tab rows) — CONFIRMED by Kevin
Kevin confirms his prior answers land in the signed sheet — no separate Joe confirmation needed:
- **STL-FL MiLB Snack** = passthrough (purchased + passed through to Cardinals at cost, zero margin). NOT $0-because-fee.
- **STL-FL "Arrival" vs "Breakfast"** = TWO distinct services. Keep both.
- **TBJ-NY Snack + Shake** = deactivate (correct as no-price/inactive).
- **TBR-FL "Breakfast - MiLB ST" vs "Breakfast - MiLB"** = no cost difference (both $17.8275). [NOTE: reconcile against A-4/A-11 corrections + the QBR C-24 finding that showed ST vs regular at DIFFERENT 2025 prices — the "no cost diff" holds for the 2026 signed values; the account file should state the current structure clearly.]
- **TBJ-FL Media Meals** = $16 (projected correct; actuals $15 stale). Fix to $16.
→ These were the JOE #4 list. **CLOSED — Kevin-confirmed, no Joe round-trip needed.** Removes Joe #4 from the async list.

### A-6 / SEBASTIAN #1 — RESOLVED: STL-FL SF is NON-TAXABLE (Kevin)
The STL-FL $350K service-fee invoice showing TAX 0.00 is CORRECT — **the service fee is non-taxable.** The 0.00 satisfies the contract's §2.d itemization requirement (itemized as zero because non-taxable), not a skipped step. No finance-compliance issue. Zero SC impact regardless (R9 — SC emits pre-tax). **A-6 CLOSED.** Removes Sebastian #1 from the async list.
- Account-file note (STL-FL): the SF line is non-taxable; only prepared-meal lines carry FL tax.

### D-2 / SEBASTIAN #2 — IGNORE (Kevin): the "2025" memo is a typo
The TBR-FL 2026 invoices reading "2025 Tampa Bay Rays..." in the memo = a cosmetic typo, **ignore.** Not worth a template-fix task. **D-2 CLOSED — no action.** Removes Sebastian #2 from the async list.

### NET async list now SHRUNK
Kevin cleared: Joe #4 (Instructions rows) + Sebastian #1 (tax) + Sebastian #2 (memo).
**REMAINING async:**
- **Joe #1** — TBJ-FL SF cadence (confirm Jan/Feb/Mar; OneSheeter-sourced). Non-blocking.
- **Joe #2** — P&L 2300 computed-vs-billed for CIN-AZ + TXR-AZ. Non-blocking (structural clarity).
- **Joe #3** — TBR-FL variable SF installment: how set each year? **LOAD-BEARING** — the bill export can't produce TBR's 2026 SF without this. The one async item that actually gates the SC export.
- **Joe #5** — TBR-FL Lunch/Dinner base split ($28.90 provenance). Non-blocking (paperwork).
- **Sebastian #3** — missing invoice samples (5 accounts) for golden-test coverage. Needed for Phase E (certification), not for account files.
- **Sebastian #4** — SF-line-on-invoice confirmation (overlaps Joe #2).
- Plus the **escalation-verification CC pass** (with the 2 folded spot-checks: FSL $16.51, BGC rates present).
**Kevin-owned rulings: ZERO outstanding.** Only async confirmations + one CC pass remain.

---

## V. NOTES FROM SOURCE REVIEW (2026-07-15) — CIN-AZ build prep

### A-4 CORROBORATION — the operational brief had it RIGHT all along
When building CIN-AZ, reviewed `ACCOUNT_SERVICES_BRIEF.md` (dated 2026-06-16). Its TBJ-FL section **already carried the correct two-groups structure**: "Single A Jays — Breakfast/Pre-Game/Post-Game $16.51 (FSL Team Meal)" and "Minor League — PDC — Breakfast/Lunch/Dinner $11.55 (FCL Team Meal)" as SEPARATE service groups. → Independent confirmation of Kevin's §T A-4 ruling: the "blend" was NEVER in the operational/billing view — it was purely an artifact of (a) the contract digest quoting the 2023 tier language and (b) a single sampled invoice that happened to show only the FCL ($11.55) line. The two-groups truth was sitting in the brief the whole time. Strengthens the §T dissolution; nothing to re-rule.
- Also confirmed by PG appendix: TBJ-FL has "Breakfast $16.50971" (FSL/Single-A group) AND "Breakfast $11.55368" (FCL group) as distinct priced rows. Two groups, two prices, both in PG. Airtight.

### BATCH DOC-PR SCOPE EXPANDED — ACCOUNT_SERVICES_BRIEF.md is a THIRD stale doc to true up
`ACCOUNT_SERVICES_BRIEF.md` (2026-06-16) carries pre-summit framing that our rulings supersede — it's a third doc needing reconciliation alongside MONEY_MODEL + the digests. Specific staleness found:
- TBR-FL "one-time 2024" SF + the [CONTRADICTION - confirm with Kevin] tags on TBR SF recurrence → resolved (recurring $200K + variable, §M/§T).
- CIN-AZ "operative 2026 pricing document not in folder" hand-wringing → resolved (renewal-option mechanic + signed sheet is authority, §O/§P).
- CIN-AZ money-model paragraph → superseded by MONEY_MODEL (brief's own banner says so).
- The STL-MO $489,431-vs-$698,000 [CONTRADICTION] tag → still an open reconciliation (Joe #2-adjacent), note it.
- BUT its per-account OPERATIONAL detail (service groups, phases, personnel swings, stakeholder names, live client conversations like "Ashley asked about moving GY to a fee account") is CURRENT + valuable → the account files should HARVEST this operational detail into their §3 (Operations Record), and the batch doc-PR should true up the brief's money-model/contradiction sections (or add a pointer to the account files as the new current-state source).
→ **Batch doc-PR now covers THREE docs**: SC_MONEY_MODEL.md + the 11 CONTRACT_DIGEST_*.md (annotations only) + ACCOUNT_SERVICES_BRIEF.md. Runs AFTER the account files (which harvest the brief's good operational content + surface any last corrections).

### PG price-history confirms A-14 drift (receipts)
PG appendix shows CIN-AZ "Breakfast" (MLB) effective-dated rows: 2026-06-16 $20.30622 → 2026-06-17 $20.30622 → **2026-06-18 $20.32**. This IS the A-14 drift, visible in the data: the value was $20.30622, then changed to $20.32 on 06-18. Kevin's ruling: fix target = **$20.31** (Joe-approved), effective-dated, Phase 3. Both stored values ($20.30622 and $20.32) are off from the approved $20.31. → goes into CIN-AZ account file §6 History; already ruled in §O/audit-batch. No new ruling.

### CIN-AZ pilot review — corrections (Kevin, 2026-07-15)
- **CIN-AZ 2026 Service Fee CONFIRMED = $445,716** (Kevin, from 2026 P&L budget; cadence 75% Feb 1 / 25% Mar 15 confirmed). This was the previously-UNKNOWN escalated SF figure (2023 base was $402,016). **KEY: $445,716 = exactly the P&L 2300 line** that §N's SF-component analysis predicted (~$445.7K) and §S's ABR corroboration showed ($445,716). → does NOT resolve Joe #2 (billed-vs-computed) but confirms the number is right either way, and tightens the §N hypothesis (the predicted 2300 = the actual budget SF).
- **STAKEHOLDER CHANGE (affects CIN-AZ + relevant to CIN-OH chases)**: **Ashley Meuser left the Reds ~April/May 2026.** She was named in the CIN-AZ contract §V.D as invoice recipient + was primary account contact. **Current CIN-AZ contact = Rachel Sharley (client dietitian).** Invoices now route to sgrossman@reds.com / Bill-To Sarah Vedder. → any paperwork chase naming "Ashley" (renewal notices, the fee-conversion conversation) must route to the current contact instead. The OneSheeter's "Ashley" stakeholder tag for CIN is now stale. The ABR-sourced "Ashley asked about moving GY to a fee account" conversation has an originator who has departed — currency UNKNOWN, re-confirm before treating as live.
- CIN-AZ price table CONFIRMED correct by Kevin (all rates validated).
- CIN-AZ pilot completeness: PARTIAL → **PARTIAL (near-full)** after SF confirmation. Remaining opens all non-blocking (C-17 volume tier, renewal-notice paperwork, Joe #2).

### Batch 1 review — corrections (Kevin, 2026-07-15): CIN-KY + TBJ-NY
**CIN-KY:**
- **Client stakeholder = Rachel Sharley** (same Reds-side dietitian as CIN-AZ; covers both Reds accounts).
- **STRUCTURAL FACT — CIN-KY is a COMMISSARY/DELIVERY account (2nd one).** KitchFix does NOT cook on-site at Louisville Slugger Field: shared commissary kitchen, chef produces + packs + drives + delivers. → **CIN-KY runs the SAME model as TBR-FL** (the commissary account from A-11). So "commissary, not on-site" is NOT unique to Tampa — at least two accounts (CIN-KY, TBR-FL) operate this way. The contract's "co-used kitchen" language describes a historical/stadium framing; operationally it's commissary production + delivery. Relevant for cost/logistics shape + for the account files' operations sections.
- **Post-game = ON-REQUEST ONLY (72hr advance, rare)** — NOT a standing service, NOT "starts in May." SC should not project Post-Game as opening-day/standing; it appears only when actually requested + served. (Sharpens the earlier "post-game deferred to May" framing.)

**TBJ-NY:**
- **$27.34 rate CONFIRMED CORRECT by Kevin.** Still contractually unbacked (no operative contract), but the NUMBER is now Kevin-confirmed (was assumption-only). Distinguishes "rate confirmed" from "contract still missing" — billing-accuracy covered, business-exposure gap remains.
- **Michelle (TBJ contact) LEFT the org** — current Buffalo client contact TBD (Kevin to provide). (Second departed-contact this session, after Ashley Meuser at CIN.)
- **"Single A Jays" / Vancouver is NOT part of TBJ-NY — REMOVED from the account file.** → **RESOLVES the Vancouver mapping question for TBJ-NY**: Vancouver Canadians / "Single A Jays" ($15.89) does NOT belong to Buffalo. It's either its own thing or maps elsewhere — but it's OFF TBJ-NY. The mapping question moves off TBJ-NY entirely (no longer a TBJ-NY open item). If it needs a home, it's a separate investigation, not a Buffalo sub-line.

### INVOICE PULL IN PROGRESS (Kevin's accounting team, 2026-07-15) — burn-down checklist
Kevin's accounting team is pulling invoice copies for all accounts where invoices can close outstanding questions. This is the UNLOCK for most remaining gaps. As copies arrive, each account gets: a worked example (golden-test seed), confirmed tax rate, confirmed net terms, and (for thinly-documented accounts) independent rate backing. **This directly closes Sebastian #3** (missing invoice samples) account-by-account.
Invoice-sample status by account (✓ = have it, ⧗ = pending pull):
- CIN-AZ ✓ (K300168587 MLB + K300168736 MiLB — worked example built)
- CIN-KY ⧗ (needed for worked example + KY tax rate)
- TBJ-NY ⧗ (needed for worked example + NY tax + independent $27.34 backing)
- CIN-OH, STL-MO, STL-FL, TXR-TX-H, TXR-TX-V ⧗ (flat-fee; invoices confirm fee installments + tax treatment)
- TBJ-FL ✓ (K300168548 MLB + K300168872 MiLB — from A-4 evidence)
- TBR-FL ⧗ (needed; also load-bearing for Joe #3 SF-installment question)
- TXR-AZ ⧗ (needed for worked example + deposit-discount confirmation)
→ Update this list as copies land. When all ⧗ clear, Sebastian #3 closes and Phase E golden-test coverage is complete.

### INVOICE SAMPLES RECEIVED — CIN-KY + TBJ-NY (2026-07-16, extracted by CC)
Two client invoices extracted verbatim (K300168861 CIN-KY PAID; K300168849 TBJ-NY unpaid). Both fold into their account files. Key results:

**CIN-KY (invoice K300168861, 2026-06-28, PAID):**
- Rates CONFIRMED: Type-1 buffet $25.95, Type-2 snack $8.64 (every line).
- **KY tax = 6.00% exact** ($692.79/$11,546.55). No local Louisville tax.
- Net 30, weekly Sunday-invoiced, 6-day service period (Tue-Sun).
- **Golden-test seed**: pre-tax $11,546.55 → total $12,239.34, PAID. Client paid this exact figure → strongest golden-test candidate.
- QB Item = **"Meal Service - PFS (Home)"**. Two threads: (a) "PFS" undefined (glossary gap — Player Food Services?); (b) **"(Home)" suffix implies an "(Away)"/road variant** may exist → connects to CIN-KY's "same menus to visiting teams" clause; confirm whether road-food is separately billed.
- Bill-To = Rachel Sharley / Louisville Bats → confirms the stakeholder change.
- Completeness stays FULLY-CAPTURED; the pending invoice items are now closed.

**TBJ-NY (invoice K300168849, 2026-06-21):**
- **$27.34 rate INVOICE-CONFIRMED** (every line) — FIRST independent evidence for the rate that had no contract backing. Combined with Kevin-confirmed + Joe-attested + PG-matched, the number is now solid.
- **NY tax = 8.75% exact** ($1,112.40/$12,713.10) = Erie County (4% NY + 4.75% Erie).
- Net 30, weekly Sunday cadence, 6-day period. Worked example: pre-tax $12,713.10 → total $13,825.50.
- **STRUCTURAL FINDING — Buffalo bills through the TORONTO PARENT PDC.** Bill-To = Rogers Blue Jays Baseball Partnership / Toronto Blue Jays PDC / 3031 Garrison Road, Dunedin FL — the SAME address as TBJ-FL. → Buffalo is a **sub-scope of the Toronto master relationship**, NOT a standalone/orphaned account. This REFRAMES the "highest doc-risk" story: the operative paper is almost certainly a Buffalo SOW under the **Dec 11 2018 Rogers/Toronto MSA** (the same master that governs TBJ-FL) — "which SOW scopes Buffalo," not "no paper exists." TBJ-NY completeness upgraded **THIN → PARTIAL**; Q6 reframed (reduced risk).
- Invoice recipient = **Charlie Wilson** (Toronto PDC). Candidate for the [TBD] Buffalo client contact, BUT it's an AP/billing recipient — Kevin to confirm if he's the account contact. Michelle (departed) was the prior relationship contact.
- Snack/Shake deactivation CONFIRMED (no such lines on invoice). No third-party-vendor line visible (the 2019 `w_3rdpartyvendor` hint has no representation on the current invoice) → that open thread effectively closed for the current billing.
- QB Item = "Buffalo Meal Service"; all meal types at $27.34 (meal type in description, not separate SKUs).

**CROSS-REF TO WIRE IN BATCH 3**: TBJ-NY billing rolls up to the TBJ-FL / Toronto PDC (Dunedin, Dec 2018 MSA). When ACCOUNT_TBJ-FL.md is built (Batch 3), cross-reference: TBJ-NY (Buffalo) is a sub-scope riding on the same Rogers/Toronto master. TBJ-FL's file should note Buffalo as an affiliated sub-scope; TBJ-NY's file already points up to Toronto.

**INVOICE-PULL CHECKLIST UPDATE** (see prior INVOICE PULL section): CIN-KY ✓ (K300168861 PAID) and TBJ-NY ✓ (K300168849) now RECEIVED. Remaining ⧗: CIN-OH, STL-MO, STL-FL, TXR-TX-H, TXR-TX-V (flat-fee), TBR-FL, TXR-AZ. Sebastian #3 progress: 4 of 11 accounts now have samples (CIN-AZ, TBJ-FL, CIN-KY, TBJ-NY).

**PATTERN NOTE — invoices are high-value**: both invoices closed multiple loops at once (rate + tax + terms + cadence + naming + entity + golden-test seed) AND surfaced structural facts the contracts didn't (the Toronto-rollup; the "(Home)"/(Away) hint). Prioritize getting the remaining 7 invoice samples — each is likely to both close loops and reveal structure.

### TBJ client contact confirmed (Kevin, 2026-07-16)
- **Katarina Dimino = client contact for BOTH TBJ accounts (TBJ-NY + TBJ-FL).** Replaces the departed Michelle. Applied to ACCOUNT_TBJ-NY now; **wire into ACCOUNT_TBJ-FL when built (Batch 3).**
- **Charlie Wilson = AP/billing recipient** (invoice "Sent to" at the Toronto PDC), distinct from the account contact. Not the stakeholder.

### STL-FL invoice K300168343 — the $24,500 "prior payment" EXPLAINED (Kevin, 2026-07-16)
The STL-FL SF invoice K300168343 (2026-07-01, $350K "4 of 4 Final") showed a "$24,500 prior payment applied" that the evidence pack flagged as unexplained. Kevin: **it's a CREDIT KitchFix owed the Cardinals for the 2025 tax matter**, applied as a "payment" line against this SF installment (Total $350,000 − $24,500 credit = Balance Due $325,500). → CLOSES the §prior-payment-$24,500 flag. Not a partial prepayment; a prior-year tax-reconciliation credit/offset.
- **Billing-mechanics fact**: KitchFix applies credits/offsets against future SF installments (as a "payment" line) rather than issuing separate refunds. Worth noting for the bill export's handling of credits generally.
- Corroborates the STL-FL SF non-taxable ruling (§U A-6): the SF line still bills TAX 0.00; the $24,500 is a separate credit line, not a tax adjustment on this invoice.
- This invoice is the SAME K300168343 already in EVIDENCE_STL-FL.md §3.1 — no re-extraction needed; the only missing piece was what the $24,500 was, now supplied.

---

## W. FINANCE 2026 SERVICE-FEE SCHEDULE — new high-authority source (2026-07-16)
**Source**: `PFS Service Fees 2026.xlsx` (finance-owned), 2 tabs: **Accrual Schedule** (P1–P13 revenue-recognition per account) + **Billing Schedule** (invoice-level: send date, due date, amount, Inv #, JE #). Cross-linked (accrual Total Billed = SUM of billing installments); a Difference column + AR aging flag drift. Covers the **8 fee accounts** (CIN-AZ, CIN-OH, STL-FL, STL-MO, TBJ-FL, TBR-FL, TXR-AZ, TXR-HOME=TXR-TX-H). Absent (correctly): CIN-KY, TBJ-NY, TXR-TX-V (no service fee). **Purely the SF layer — NO passthrough lines** (STL-FL $900K, STL-MO $225K, CIN-OH food budget not here).
**Authority**: for **2026 SF dollar amounts + accrual/billing timing**, this is HIGH authority (finance's own control doc; computed actuals, not formulas). Cross-checks against contracts (formulas) + signed sheet (SF layer). Add to §A source register.

### 🎯 JOE #3 — ANSWERED FOR 2026 (method still unknown)
**TBR-FL 2026 SF = $457,768** = **$200,000** (installment 1, inv K300168375, due 11/01/2025, PIF) + **$257,768** (installment 2 — THE VARIABLE ONE, inv K300168376, due 02/01/2026, PIF). Matches the P&L 2300 line to the dollar + confirms the ledger's C-2 "$200K static + variable second" hypothesis.
- **What's resolved**: the 2026 variable installment IS $257,768, documented at invoice level. TBR-FL's 2026 bill export can now be built (unblocks the hardest Batch-3 account).
- **What's STILL open**: HOW the $257,768 is derived each year (not a visible formula). Joe #3 downgrades from "load-bearing BLOCKER" to "answered for 2026; going-forward derivation method still to confirm with Joe." No longer gates the 2026 build.

### 2026 SF AMOUNTS — now finance-confirmed (were mostly UNKNOWN/formula-only)
| Account | 2026 SF (finance) | Prior state | Note |
|---|---|---|---|
| CIN-AZ | $445,716 | Kevin-confirmed | Finance CROSS-CONFIRMS exactly. Billing: 2 installments $334,287 (P1-12) + $111,429, ≈75/25 split (matches contract 75% Feb / 25% Mar cadence). |
| CIN-OH | $376,686 accrued / $371,442.48 billed | base $362,500, CPI unknown | ~3.9% Aug-CPI escalation (within 1%/4% band). 6 monthly $61,907.08, accrued P4-P10. |
| STL-FL | $1,400,000 | confirmed | SF only ($900K passthrough excluded, correct). 4 quarterly $350K. |
| STL-MO | $489,497 | see reframe below | $73,249.50×6 meal-svc + $50,000 Road Food. |
| TBJ-FL | $515,712 | base $452,812 | **+13.89% jump ⚠️** — 3× $171,904 (Jan/Feb/Mar). Flag for escalation-verification (see below). |
| TBR-FL | $457,768 | Joe #3 gate | ANSWERED (above). |
| TXR-AZ | $301,623 | 2025 was $297,419 | +1.4% (deposit is projection-based, not formula — OK). 3× $100,541 (Jan/Feb/Mar). |
| TXR-TX-H | $604,032 | confirmed | Exact. 6 monthly $100,672, accrued P4-P10. |

### STL-MO FIGURE — RESOLUTION UPDATED (supersedes my earlier $473K note)
Earlier I concluded $473K was "the operative figure." CORRECTION per finance: **$473K is the contract BASE; the CPI-escalated 2026 ACTUAL that bills = $489,497** ($439,497 meal-services [=$73,249.50×6, ~4% escalation on $423K] + $50,000 Road Food). → This VINDICATES the ABR's "$489,431" figure the ledger had flagged as a contradiction — it wasn't wrong, it was the escalated number. **Final STL-MO resolution: base $473K (PG sc_fee_schedule) → 2026 billed $489,497 (finance) → old "$489,431" was the same escalated figure (~$66 rounding diff). Contradiction CLOSED.** PG's $473K is the base; finance's $489,497 is what actually bills 2026.

### TBJ-FL — ESCALATION JUMP FLAG (for Batch-3 build + escalation-verification)
Finance 2026 = $515,712 vs contract base $452,812 = **+13.89%** one-year. TBJ-FL's escalator is provider-initiated, Club-approval, CPI-based, max 1 increase/year — a ~14% single jump is large. Either compounded multi-year CPI catching up or a negotiated non-CPI step. NOT resolvable now; flag prominently on ACCOUNT_TBJ-FL (Batch 3) + feed the escalation-verification pass.

### STRUCTURAL INSIGHT — accrual patterns (for Phase D/E bill export + P&L tie-out)
- 13-period model (P1–P13). JE labels encode accrual span:
  - **P4–P10** (regular-season-only, 7 periods): CIN-OH, STL-MO, TXR-TX-H — the MLB-clubhouse flat-fee accounts.
  - **P1–P12**: CIN-AZ, STL-FL, TBR-FL, TXR-AZ (PDC accounts, spread across the year).
  - **P1–P13**: TBJ-FL (full-year spread).
- This accrual-vs-billing split IS the P&L-2300 tie-out infrastructure Phase E needs. The per-period vectors are the recognition truth; the billing installments are the cash truth.
- **AR aging** in the doc shows CIN-OH, STL-MO, TXR-TX-H each with their latest 2 installments unpaid (current + 1-30) — expected mid-season timing, not a problem.

### DATA-QUALITY FLAGS (transcribe-don't-fix; for finance to correct)
- **CIN-AZ due-date typos**: two Due cells read 2025 (02/01/2025, 03/15/2025) — should be 2026 given send dates + invoice range. Cosmetic; finance to fix. Does not affect amounts.
- Trivial accrual-vs-billed rounding: STL-MO +$64, TXR-TX-H +$13, CIN-OH -$5,243.52 (the CIN-OH gap = annualized-fee-vs-invoiceable estimate, not an error).

### BUILD-READINESS IMPACT
The finance doc makes the remaining Batch-2 fee accounts (CIN-OH, STL-MO, STL-FL, TXR-TX-H) fully build-ready on the SF layer (amounts + cadence + accrual all confirmed) WITHOUT waiting on more invoices. Only the PASSTHROUGH invoices (reimbursables) remain a gap for STL-FL/STL-MO/CIN-OH, and TXR-TX-V's catering stream. Batch 3's TBR-FL is now unblocked (Joe #3 answered for 2026).

---

## X. MIXED INVOICE SET — reimbursables + SF-tax + TXR-V catering (2026-07-16, CC-extracted)
9 unique invoices (`INVOICE_EXTRACTION_mixed_set.md`): 3 CIN-OH reimbursables + 1 CIN-OH SF + 2 STL-MO reimbursables + 1 TBJ-FL MiLB pantry + 1 TXR-V Yankees catering + 1 bonus TBR-FL MLB per-meal.

### 🎯 STRUCTURAL RULING NEEDED/BANKED — SF-TAXABILITY IS PER-ACCOUNT, NOT GLOBAL
- **CIN-OH SF bills WITH tax: 7.80%** (Cincinnati/Hamilton County; invoice K300168479, $61,907.08 + $4,828.75 tax = $66,735.83). Activity `Service Fees (PFS)`, T-flagged.
- **STL-FL SF bills TAX 0.00** (Kevin §U ruling, invoice K300168343).
- Same product family, OPPOSITE tax treatment (driven by state law + service classification). → **Bill export MUST carry SF-taxability as a per-account attribute; NO global SF-tax rule.** Design constraint for Phase D. Add to SC_BILLING_OVERVIEW rules when built.
- Confirms CIN-OH SF installment = **$61,907.08** (matches finance doc §W exactly), labeled "4 of 6" (6 cash installments, accrued P4-P10 per §W — cash-vs-recognition distinction, not a conflict).

### REIMBURSABLE STRUCTURE — now known (was a black box)
- **Single-line lump per week**: NO client-facing itemization. One row = "Week of X/Y-X/Y" + one total. (Answers the long-open "how do reimbursables bill" question.)
- **TAX = $0.00** on every reimbursable, every account (passthrough at cost).
- **Weekly cadence**, Sunday-invoiced.
- **Per-account Activity-code taxonomy** (NOT shared):
  - CIN-OH: `Food` + `Clubhouse Snacks` (the §2.c Clubhouse Extras — confirms two-track structure)
  - STL-MO: `Reimbursables - Food` + `Reimbursables - Food-Beverages`
  - TBJ-FL: `MiLB Pantry` ("Total pantry purchases for the MiLB fueling station") — invoice cites "without any mark-up" contract clause; "fueling station" matches Schedule A §12(b)(v)
- **No "at cost"/markup/budget-cap language ON the invoices** — only asserted in contracts.
- **Sampled weekly magnitudes** (week 6/1-6/7): CIN-OH Food $16,723.20 + Snacks $146.70; STL-MO Food $32,212.91 + Food-Bev $8,347.35 = $40,560.26. STL-MO ~2.4× CIN-OH (Busch scale). TBJ-FL pantry (wk 4/27) $12,025.17.
- **Reimbursables use LONGER effective due dates** (~40-44 days) vs strict Net-30 on SF/catering/per-meal. Possible finance convention (reimbursables get extended window). Confirm w/ Sebastian. NON-BLOCKING.

### TXR-V CATERING — REFRAMED (the account-defining finding; feeds the held TXR-V build)
Yankees invoice K300168675 (4/29/2026):
- **Bill-To = NEW YORK YANKEES / Andrew Weisberg — the VISITING TEAM DIRECTLY, not the Rangers.** TXR-V catering is NOT Rangers revenue; billed to each visiting club.
- **À-la-carte menu**: MTO $1,000/day flat, Smoothies $13, Power Bites $4, Acai Bowls $15, BIB Breakfast $30, Yogurt Parfaits $15, Continental Sweets Platter $180, + "Special Upcharge" items (Quesadilla $5, GS Burrito $215, Fry Mix $60). Menu-priced, not contract-per-meal.
- **4% credit-card Processing Fee** as an explicit invoice line ($325.29) — confirms Britt's SOP CC-surcharge.
- **Taxed** (~7.9% [CC calc]; near Arlington 8.25% — verify).
- **Activity `Meal Service - PFS (Away)`** — mirror of CIN-KY's `PFS (Home)`. First invoice-level confirmation of the Home/Away split.
- **Per-series** (3 game days = one Yankees @ Rangers series).
- ⚠️ **Cubs TXR-V invoice was NOT delivered** (expected 2). Can't yet confirm "every visiting team billed identically." Get the Cubs invoice with TXR-V detail.
- → TXR-V is a visiting-team-billed, à-la-carte, CC-surcharged, taxed catering stream, SEPARATE from the $604K Rangers home fee. Kevin holding TXR-V build for more detail — this is the invoice-side foundation.

### `(PFS)` CODE FAMILY — mapped (acronym still undefined)
`Service Fees (PFS)` (SF) · `Meal Service - PFS (Home)` (CIN-KY home meals) · `Meal Service - PFS (Away)` (TXR-V visiting catering) · `Meal Service - PFS` (no suffix, expected for basic contracted meals). Root = KitchFix product-family code. GLOSSARY: still need PFS expansion from Kevin. The CIN-KY-flagged "(Away) variant may exist" is now CONFIRMED to exist (TXR-V).

### OPEN QUESTION FOR KEVIN — the "Michelle" tension
TBJ-FL pantry invoice K300168698 (5/3/2026) "Sent to: **Michelle Rodgers** (Michelle.rodgers@bluejays.com)". But we set Katarina Dimino as the TBJ contact after Kevin said "Michelle left the org." Either (a) Michelle Rodgers departed AFTER 5/3, or (b) the departed "Michelle" (ABR relationship contact) ≠ Michelle Rodgers (pantry-invoice AP recipient). **NEEDS KEVIN CLARIFICATION before finalizing TBJ contact fields.** The built TBJ-NY file says "Michelle (prior contact) left the org" — may need nuance (Michelle Rodgers may be a current AP contact, distinct from the departed relationship Michelle).

### CIN-OH AP HANDOVER — invoice-level confirmation
CIN-OH invoices span the Ashley Meuser → Sarah Vedder handover: Ashley on 5/1 (SF) + 5/10 (Food reimb); Sarah Vedder on 6/7 (both 6/7 invoices). Handover window 5/10–6/7/2026. Confirms ledger's "Ashley left ~Apr/May 2026." NOTE: TWO distinct post-Ashley Reds contacts — **Sarah Vedder (AP/billing)** + **Rachel Sharley (dietitian)** — not the same person. (Applies to CIN-OH build + already-built CIN-AZ uses Sarah Vedder as Bill-To + Rachel Sharley as stakeholder — consistent.)

### BONUS — TBR-FL MLB per-meal invoice (not requested, useful for Batch 3)
Invoice K300168509 (2/15/2026, spring training wk 2/9-2/15): TBR MLB Breakfast **$35.63** + Lunch/Dinner **$39.48** confirmed (matches MONEY_MODEL). FL tax **7.00%** (Pinellas/St. Pete). Header "Tampa Bay Rays MiLB/MLB". Bill-To Sean "Sunny" Jones / Rays Baseball Club. **Marked OVERDUE (due 3/17/2026, ~4 months past due as of 7/16)** — real AR item, flag to finance. Memo "2025" typo = the D-2 CLOSED (ignore) item. Banks TBR MLB rates for the Batch-3 TBR-FL build.

### CIN-OH REIMBURSABLE INVOICE-LEVEL FACTS (for the CIN-OH build)
- Ohio reimbursables = tax-zero, weekly, single-line. Food reimb wk 5/4-5/10 = $11,840.45; wk 6/1-6/7 = $16,723.20; Clubhouse Snacks wk 6/1-6/7 = $146.70.
- CIN-OH SF invoice: $61,907.08 + 7.80% tax = $66,735.83, "4 of 6", Net 30, Bill-To Ashley (5/1) → later Sarah Vedder.

### STILL-MISSING (gaps in this set)
- Cubs TXR-V invoice (for TXR-V build).
- STL-FL reimbursable (only STL-MO sampled; the $900K STL-FL passthrough weekly draw unseen — but structure likely mirrors STL-MO).
- BGC invoice (would confirm A-11 in-scope reversal on real dollars).
- CIN-OH postseason per-game invoice (would confirm R11 flat-fee-postseason on real dollars).

### BATCH-DOC-PR SCOPE ADDITIONS (accumulating for the eventual reconciliation PR)
- MONEY_MODEL 2026 fee figures now superseded by finance §W: STL-MO ($473K base→$489,497 billed), TBJ-FL ($452,812→$515,712), CIN-OH (base→$376,686 accrued). Annotate.
- SC_BILLING_OVERVIEW: add the per-account SF-taxability rule (CIN-OH taxable, STL-FL exempt).
- Glossary: PFS expansion (pending Kevin); reimbursable Activity-code taxonomy per account.

### §X follow-ups RESOLVED (Kevin, 2026-07-16)
- **The "Michelle" tension → RESOLVED, no conflict.** The TBJ-FL pantry invoice K300168698 (5/3/2026, "Sent to: Michelle Rodgers") is an OLD invoice from BEFORE Michelle left and Katarina Dimino took over. So the timeline is confirmed, not contradicted: Michelle Rodgers was the prior TBJ contact (the departed "Michelle"); Katarina Dimino is the current contact for both TBJ accounts. The 5/3 invoice simply predates the handover. → Katarina stays as the TBJ contact in the account files (TBJ-NY correct as-is; wire Katarina into TBJ-FL at Batch-3 build). No open question remains.
- **The bonus TBR-FL MLB invoice K300168509 → old invoice that snuck into the file set.** Its rate data (TBR MLB Breakfast $35.63 / Lunch-Dinner $39.48, FL 7% tax) is still useful reference for the Batch-3 TBR-FL build, BUT its "Overdue" status is NOT a live AR flag (old invoice). Don't action the overdue status.
- **Cubs TXR-V invoice → deferred.** Kevin will send it with the rest of the TXR-V details/docs when we return to build TXR-V. TXR-V stays held.

### §X follow-ups — Batch-2 review corrections (Kevin, 2026-07-16)
Four Batch-2 files reviewed + corrected. Generalizable rulings extracted:

- **REIMBURSABLE-TAX RULE (general, all accounts): reimbursables bill TAX-ZERO because tax is already paid to vendors on the underlying purchase invoices.** Charging the client tax again would double-tax. This is WHY every sampled reimbursable (CIN-OH, STL-MO, TBJ-FL) showed TAX 0.00 — not an accident, a deliberate rule. Applies to CIN-OH (Food + Clubhouse Snacks), STL-MO (Food + Food-Beverages), STL-FL (full $900K food/snack/beverage stream), TBJ-FL (MiLB Pantry), and any account with reimbursables. → Bill export: reimbursable lines are always tax-zero.

- **PG CARRIES THE ESCALATED FIGURE (Kevin ruling): `sc_fee_schedule` should store the escalated 2026 actual, NOT the contract base.** Migration needed: CIN-OH $362,500→$376,686; STL-MO $473,000→$489,497. (STL-FL flat $1.4M and TXR-TX-H single-year $604,032 have no base/escalated split — N/A.) This is a `sc_fee_schedule` data migration run in Supabase Studio. Applies to every escalating fee account — when Batch 3's escalating accounts (TBJ-FL, TXR-AZ) are built, same migration: PG carries their escalated §W figures. → Add to the PG-migration action list.

- **SF (service-charge) TAX: still AWAITING FINANCE for STL-MO + STL-FL.** CIN-OH SF taxed 7.80% (confirmed), TXR-TX-H taxed 8.25% (contract-stated), STL-FL SF billed tax-zero on the invoice (§U) — but Kevin is confirming the service-charge tax treatment with finance across the flat-fee accounts. Current states stand (CIN-OH/TXR taxed, STL-FL non-taxable per invoice); STL-MO genuinely open. Per-account attribute either way. NON-BLOCKING.

- **STL-FL UPKEEP OWNERSHIP RESOLVED**: the $30K upkeep envelope ($15K equip/repair + $4K pod + $11K cooler) is a **Cardinals-reimbursed passthrough** — KitchFix spends, Cardinals reimburse. NOT KitchFix-borne (supersedes the MONEY_MODEL "KitchFix-borne" reading). Sits on top of the $1.4M like the $900K stream. → Batch-doc-PR: annotate MONEY_MODEL §h.

- **STL-FL FULL PASSTHROUGH CONFIRMED**: ALL food/snacks/beverages at STL-FL are reimbursable passthrough (the whole $900K stream), not just "food & packaging."

- **STAKEHOLDERS captured** (Kevin): STL-MO = Carl Kochan (client) + Linda Brauer (Finance). STL-FL = Carl Kochan (top, Jen+Linda's boss) + Jen Goldstein (site RD) + Linda Brauer (Finance). TXR-TX-H = Brandon Boyd (Clubhouse Mgr, main client) + Katie McInnes (RD) + Ross Fenstermaker (GM signatory). CIN-OH = Rachel Sharley (dietitian) + Sarah Vedder (AP). [Carl Kochan + Linda Brauer span both STL accounts — Kochan is the top Cardinals stakeholder over both MO + FL.]

- **CIN-OH postseason invoice**: only created IF the Reds make the playoffs — NOT a standing Phase-E gap (contingent on a berth). The $4,413.58 mechanic is contract-defined regardless.

- **CIN-OH aliases** added: REDS OH, REDS CIN, REDS CINN.

### BATCH-DOC-PR SCOPE ADDITIONS (this round)
- MONEY_MODEL §h: STL-FL upkeep is Cardinals-reimbursed passthrough (not KitchFix-borne).
- PG-migration action list: `sc_fee_schedule` carries escalated figures (CIN-OH, STL-MO now; TBJ-FL, TXR-AZ at Batch 3).
- Reimbursable-tax rule (tax-zero, vendor-paid) → add to SC_BILLING_OVERVIEW alongside the per-account SF-tax rule.

---

## Y. STL SF-TAX RESOLUTION + PFS GLOSSARY (2026-07-16)

### PFS = **Performance Food Service** (glossary CLOSED)
`PFS` on all QuickBooks Item names = **Performance Food Service** (KitchFix's parent/product-family brand — matches "KitchFix Performance Foodservice"). The code root across the family:
- `Service Fees (PFS)` — service-fee line
- `Meal Service - PFS (Home)` — home-clubhouse per-meal (CIN-KY)
- `Meal Service - PFS (Away)` — visiting-team catering (TXR-V)
- `Meal Service - PFS` (no suffix) — basic contracted meal service
→ Glossary gap CLOSED. Expansion added to all account files' QB crosswalk. `[Kevin, 2026-07-16]`
→ RIPPLE: CIN-KY (already merged) references "PFS" without expansion — add the expansion when CIN-KY next rides a PR (batch with the pending "(Away) confirmed" edit).

### STL SF TAXABILITY — RESOLVED (source: Slack, Josh + Joseph Lessard, 2026-07-16)
**Both STL-FL and STL-MO: NO sales tax on the service-fee portion.** Verbatim reasoning (Josh):
- Vendors charge KitchFix sales tax on the goods; KitchFix is reimbursed the full (tax-included) invoice for goods → no tax charged again to the client. (This IS the reimbursable-tax rule, stated by Josh.)
- On the service fee: the Cardinals believe tax-free is "the law," it's "defensible," the Cardinals' lawyers pushed the position.
- ⚠️ **CRITICAL NUANCE — this is the Cardinals' asserted legal position, NOT a settled exemption.** Josh: "If the state came after us and they won the Cardinals would be liable." So the tax-liability RISK sits with the Cardinals (they pushed it). Do NOT record this as a clean legal exemption; record it as a client-driven position with contingent liability.
→ STL-MO SF tax question (was "awaiting finance") = CLOSED: non-taxable, Cardinals' position. STL-FL SF = reconfirmed non-taxable (already §U A-6). Both files updated with the nuance.

### SF-TAXABILITY — full per-account picture now (4 of 4 Batch-2 known)
| Account | SF tax | Basis |
|---|---|---|
| CIN-OH | TAXABLE 7.80% | invoice-confirmed (OH law) |
| TXR-TX-H | TAXABLE 8.25% | contract-stated with-tax figure (Arlington) |
| STL-FL | NON-TAXABLE | invoice + Cardinals' legal position (they bear risk) |
| STL-MO | NON-TAXABLE | Cardinals' legal position (they bear risk) |
Confirms the per-account SF-tax attribute for the bill export. The two Cardinals accounts share the tax-free position (same client, same lawyers); the two AL/OH accounts are taxed per state law.

### BATCH-DOC-PR SCOPE ADDITIONS (this round)
- PFS expansion → glossary + CIN-KY (merged) annotation on next PR.
- SC_BILLING_OVERVIEW: SF-tax table (per-account) + note that STL tax-free = client legal position w/ Cardinals-borne risk (not a clean exemption).
