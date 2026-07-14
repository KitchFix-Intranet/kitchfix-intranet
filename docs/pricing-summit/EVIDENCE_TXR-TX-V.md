# EVIDENCE — TXR - TX - V

> Read-only evidence pack. Verbatim + cites. UNKNOWN where silent. Flag-don't-resolve.
>
> **Account**: TXR - TX - V (Texas Rangers Visiting clubhouse — Globe Life Field). **Shape: Flat_fee $0** (covered by TXR-TX-H contract). Level: MLB. `billing_model=flat_fee`, `has_homestand_schedule=true`.

## §1. Sources

- **Contract**: same 2026 MLB PDF as TXR-TX-H (`/Users/kevinfietek/Documents/Claude /Contracts/TXR H&V/Food_Services_Agreement_-_KitchFix_(MLB_2026).pdf`). No separate TX-V contract.
- **Invoices in sample**: NONE for TXR-TX-V.
- **MONEY_MODEL digest row**: `TXR - TX - V | Flat_fee | n/a | n/a | $0 (covered by H); direct sales via Season Tracker | Operational counts only, no $`.
- **PG**: `billing_model = flat_fee`, `has_homestand_schedule = true`. `sc_fee_schedule` carries TXR-TX-V row at $0, `covered_by_account_key = TXR - TX - H`.

## §2. Contract evidence (verbatim, from shared 2026 MLB contract)

### 2.1 Visitor clubhouse scope (§ 1.b p.1) — **VERBATIM**

> "In addition to the Services and Meals, Contractor agrees to provide the following additional 'daily offerings': made-to-order options during the first two meals of every Rangers' home game; Grab & Go Snack options made by Contractor; packaged snacks, condiments, and beverages; and coffee service. Further, in the visitors' clubhouse, Contractor agrees to provide: Grab & Go Snack options made by Contractor; packaged snacks, condiments, and beverages; and coffee service."

**Visitor scope explicitly limited to: Grab & Go snacks, packaged snacks/condiments/beverages, coffee service. NO buffet, NO MTO, NO per-meal billing.**

### 2.2 Meals scope limited to home team (§ 1.a p.1, § 1.b p.1, § 1.c p.1)

> "Contractor shall provide meal preparation and hospitality management services for the Rangers' Major League players and personnel for each Rangers' home game (the 'Games') at Globe Life Field during the 2026 regular season as set forth herein (the 'Services')."

> "Contractor agrees to prepare three (3) meals per Game for sixty (60) people."

> "The Meals shall be served in the Rangers' home clubhouse (and the visiting clubhouse when appropriate), unless the parties mutually agree upon another area."

The "and the visiting clubhouse when appropriate" phrase permits serving Meals in the visitor clubhouse but does NOT add scope beyond the 60-person, 3-meal-per-game cap.

### 2.3 Services Fee — bundled

The single Services Fee of $604,032 (§ 2.a p.1) is "payment in full for the Services and all ingredients and supplies required for Meal preparation, delivery, service and clean-up." No separate visitor-clubhouse line, no separate dollar allocation between H and V clubhouses, no explicit $0 for V.

### 2.4 Tax + payment terms

Same as TXR-TX-H (single contract, single fee).

### 2.5 Postseason

Same as TXR-TX-H (see EVIDENCE_TXR-TX-H.md § 2.3). Pro-rata Services Fee for each 2026 Postseason Game — no separate V allocation.

### 2.6 Fee immutability / true-up

Same as TXR-TX-H. UNKNOWN on visitor-specific true-up.

### 2.7 MLB-vs-MiLB invoicing + Count-verification

Same as TXR-TX-H. No client sign-off required.

## §3. Invoice evidence

**No TXR-TX-V invoice in the 9-invoice sample. Consistent with the $0 fee-schedule row + covered-by-H marker.**

## §4. PG evidence

`sc_fee_schedule`:

| account_key | amount | covered_by_account_key | reason |
|---|---|---|---|
| TXR - TX - V | 0 | TXR - TX - H | Seed: locked 2026 contract-year annual fee from SC_CONTRACT_BILLING_SUMMARY.md (Bundle 1 Stage 2). |

## §5. Cross-check against MONEY_MODEL

| MONEY_MODEL claim | Contract | Verdict |
|---|---|---|
| $0 (covered by H) | ✓ contract has ONE $604,032 fee covering "Services" including visitor daily offerings | ✓ |
| "direct sales via Season Tracker (sold revenue × 19.23% labor model)" | Not in contract — out-of-scope reference | ✓ MONEY_MODEL note, contract silent on visitor direct sales |
| Contract scope = G&G + snacks + coffee only | ✓ verbatim § 1.b p.1 | ✓ |

## §6. UNKNOWN / gaps

- **Visitor direct-sales revenue mechanic**: MONEY_MODEL §g notes "Real visiting-team direct-sales revenue is tracked in Season Tracker (sold revenue × 19.23% labor model), out of scope for the SC and the fee schedule". Contract silent on this — it's an out-of-contract revenue lane.
- **Scope mismatch flag** (from `ACCOUNT_SERVICES_BRIEF.md:684` open item #25): "Visitor clubhouse contract scope is G&G + snacks + coffee only; SC models full buffet services. Decide whether to delete the buffet services or keep them as ad-hoc tracking."

## §7. Postseason

Shared 2026 contract's pro-rata mechanic covers "each 2026 Postseason Game" — same rate, additional days for the flat fee. Kevin's ruling satisfied at the account level (TXR-H covers TXR-V per MONEY_MODEL).

## §8. Billing cadence

No separate TXR-TX-V invoice cadence — bundled inside TXR-TX-H's monthly SF (see EVIDENCE_TXR-TX-H.md §8).

## §9. QuickBooks artifacts

No TXR-TX-V invoice in sample. Kevin's Season Tracker direct-sales mechanic likely produces separate QB invoices for visitor direct sales; those aren't part of this contract stack.

## §10. Count-verification

Not required — no separate billing for V.

## §11. Local flags (see CONFLICT_REGISTER)

- **§SC-models-buffet vs contract-G&G-only** (Open item #25 from `ACCOUNT_SERVICES_BRIEF.md:684`): SC currently mirrors TXR-TX-H's full buffet service list on TXR-TX-V, but contract scope is G&G + snacks + coffee only. **CONFLICT** — either the SC should delete the buffet services for V or keep them for operational tracking with a note that they don't contractually authorize billing.
- **§Season Tracker direct sales**: Out-of-scope for this pricing summit / SC — flagged as informational only.
