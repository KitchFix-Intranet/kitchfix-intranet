# Contract Digest Review — All 11 Accounts, Consolidated
**2026-07-14 · Single review of the full verbatim contract corpus (Phase 0d) · Chat-Claude to Kevin**

The whole document set is in. This is the one-page synthesis: what the contracts proved, what moved, what's still open, and what to do next. Detail per account lives in the ledger §P–R; this is the map.

---

## 1. THE HEADLINE
**The billing system is fundamentally sound — it needed documenting, not fixing.** Where we can trace a rate end-to-end (contract → escalation → signed sheet → PG → invoice), it coheres. The price audit already proved PG is 99% clean. Nothing in the full contract read overturned that. The summit's job was to make the money model *airtight and provable* per account — done.

**The one genuine structural surprise: escalation.** Nine different escalation regimes across eleven accounts. That's the finding that matters most for the future build.

---

## 2. WHAT THE CONTRACTS RESOLVED (rulings now backed by verbatim text)
- **A-5** (STL-FL upkeep) → passthrough, Cardinals-paid. Contract §2.b confirms word-for-word.
- **A-7** (TXR-V scope) → opt-in sales model, out of SC scope. Contract carve-in + Britt's SOP confirm.
- **C-1** (CIN-AZ beverage tax) → exemption. Contract §IV.B.4 confirms.
- **C-2** (TBR-FL service fee) → recurring ($200K static + variable second installment), NOT one-time. Two years of SOWs confirm the pattern.
- **A-1** (the $0.72 TBR "delta") → never a conflict; the signed sheet stores three distinct MiLB rates and the digest's Base-vs-Post-SF two-tier structure explains the last mystery ($28.90 = escalated Base, not billed rate).
- **R11** (postseason) → fully characterized: per-meal accounts extend at same rates; flat-fee accounts add per-game fees (CIN-OH states "1/81" explicitly; STL-MO uses flat dollars; TXR-TX-H says "pro rata").

## 3. THE BIG FINDING — Escalation is per-account, nine ways
A single global escalation formula would mis-price nearly everything. Verbatim:

| Account | Escalation rule |
|---|---|
| CIN - AZ | CPI Food-Away, **October**, 2% floor / 5% cap |
| CIN - KY | **None** — renegotiated year to year |
| CIN - OH | CPI Food-Away, **August**, 1% floor / 4% cap, **on a stepped-up $362,500 base** |
| STL - FL | **None** — flat $2.3M |
| STL - MO | CPI parent-index (SEFV), **August**, no cap |
| TBJ - FL | **100%** of CPI, Q4, provider-initiated + Club approval |
| TBJ - NY | None documented (no operative contract) |
| TBR - FL | **75%** of CPI **sub-index** (SEFV01), November |
| TXR - AZ | Fixed **2.5%**/yr |
| TXR - TX - H | **None** — +10% negotiated for 2026 |
| TXR - TX - V | n/a (opt-in sales) |

**Implication**: the signed sheet *appears* to have applied each correctly (audit shows 99% PG match; we hand-verified TBR, CIN-OH, TXR-AZ in session). But "appears" isn't "verified." → **one CC escalation-verification pass** re-derives all 11 from clause + real CPI and confirms the signed sheet used the right rule per account. This is the last systematic check before the price layer is fully, provably green.

## 4. STILL NEEDS A KEVIN RULING (3 items)
- **A-4 — TBJ-FL tiers vs blend.** Contract has two MiLB tiers (FSL $14.50 / FCL $10.14); practice bills a single blended $11.55 and the meal counts don't separate FSL from FCL players. Same species as TBR: contract states a framework, practice runs a negotiated simplification the signed sheet blesses. **The one thing only you know: was $11.55 deliberately negotiated as a blend, or does it just happen to land between the tiers?** Negotiated → document as handshake, close. Not agreed → enforce tiers (needs FSL/FCL day-tracking) or paper the blend.
- **A-10 — CIN-AZ catering revenue.** P&L books a $52K/yr "2200 Catering Revenue" line MONEY_MODEL doesn't document. What is it — the $1,000/class educational cooking demos in the contract? Outside catering? Should MONEY_MODEL carry it?
- **A-11 — TBR-FL catering revenue.** Same, $79,950/yr. Likely Boys & Girls Club lunches ($6.50) + road sandwiches + ancillary. Confirm + classify.

## 5. PAPERWORK GAPS — all risk-acceptable, none block certification
Operative prices are Joe-attested via the signed sheet, so these are "find the paper" business items, not billing blockers:
- **TBJ-NY** — the weakest-documented account: only a 2019 unsigned draft, no operative contract, base MSA (Dec 2018) not in files. *Highest documentation risk.* Chase: current Buffalo rate confirmation + the master agreement.
- **TBR-FL** — 2025 + 2026 SOWs missing (they hold the variable service-fee amounts). Chase.
- **CIN-AZ** — 2026 *renewal notice* (not a missing contract — the base has a renewal-option mechanic). Pull the correspondence.
- **TXR-AZ** — 2026 SOW missing (rates fully derivable via 2.5%; only the deposit dollar amount needs it).
- **TXR-TX-H §2(d)** — kitchen-budget section cited but absent from the contract.

## 6. TWO QUESTION LISTS READY TO SEND
- **Joe (5):** TBJ SF cadence · P&L 2300 computed-vs-billed (CIN-AZ + TXR-AZ) · TBR variable-installment rule · the 5 signed-sheet Instructions-tab open rows · TBR Lunch/Dinner base split.
- **Sebastian (4):** STL-FL tax-0.00 question · TBR memo "2025" bug · missing invoice samples (5 accounts) · SF-line-on-invoice confirmation.

## 7. BATCH DOC-PR (staged, one follow-up PR)
Lessard rename (D-1) · GOTCHAS STL-FL allocation fix (D-3) · MONEY_MODEL digest expansions (TBR three MiLB rates, MLB Breakfast splits, the two 2200 catering lines, snack rates, coffee/fountain, add-on line items) · naming cleanups (B-10/B-11).

## 8. RECOMMENDED NEXT STEPS (in order)
1. **Rule the final 3** (A-4, A-10, A-11) — closes every open conflict.
2. **Queue the escalation-verification CC pass** — the last systematic check; runs in background.
3. **Send Joe + Sebastian lists** — answers arrive async.
4. **Finish Tier 1** (§2 glossary + §3 pipeline stubs) — everything else in it is ruled.
5. **Write the CIN-AZ Tier 2 pilot** — now from fully-banked evidence; ratifies the account-doc template.
6. **Then** the batch doc-PR + the paperwork chases.

**Bottom line: the evidence phase is complete and the system is in far better shape than the initial audit fears suggested. Three small rulings and one verification pass stand between here and a fully-green price/contract foundation.**
