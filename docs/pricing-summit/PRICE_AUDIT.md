# PRICE AUDIT — PG vs Signed Billing Price (Layer D certification gate)

> Diagnosis only. **Fix nothing.** Per Kevin's ratified P-1: `Price Review v3 Service Price Review > Billing Price` is the #1 authority for per-service prices. This audit reads that signed column and diffs PG against it.

---

## §0. Bottom line — the fix-list

**One (1) STALE_PG row across 105 services × all 11 accounts.** The systemic-staleness fear is **REFUTED**.

### STALE_PG fix-list (Phase 3 correction target, Kevin-applied)

| Account | Group | Service | PG value | Signed Billing Price | Delta | Note |
|---|---|---|---:|---:|---:|---|
| **CIN - AZ** | Major League | Breakfast | **$20.32** | **$20.30622** | +$0.01378 | Rounding-level; PG is 1.4¢ high per meal. |

**That's it.** One row. Rounding-level. Not the "systemic" staleness Kevin feared post A-1.

### The A-1 reveal (why the concern turned out different)

The A-1 "$0.72 delta" (TBR-FL MiLB, invoice $21.68 vs digest $20.96) is **NOT a stale-PG bug**. PG actually stores the correct signed billing prices, but as **two distinct rates**:

| Service | Signed Billing Price | PG value | Verdict |
|---|---:|---:|---|
| TBR - FL Minor League Lunch - MiLB | $21.675 | $21.675 | ✓ MATCH |
| TBR - FL Minor League Lunch - MiLB ST | $21.675 | $21.675 | ✓ MATCH |
| TBR - FL Minor League Dinner | $20.96183 | $20.96183 | ✓ MATCH |
| TBR - FL Minor League Breakfast - MiLB | $17.8275 | $17.8275 | ✓ MATCH |
| TBR - FL Minor League Breakfast - MiLB ST | $17.8275 | $17.8275 | ✓ MATCH |

The **MONEY_MODEL per-account digest** flattened these into one "MiLB $20.96" row — that was the oversimplification, not a PG bug. Invoice K300168871 bills `TBR MiLB - Lunch/Dinner @ $21.68` for Lunch activity only (Description column shows "Lunch" on every line), matching the signed $21.675 exactly. The Dinner rate $20.96 is preserved in PG for when Dinner is billed.

**A-1 is REVISED — see CONFLICT_REGISTER §A-1 recompute revision.**

---

## §1. Methodology

- **Signed sheet**: `/Users/kevinfietek/Documents/Claude /Service Calendars/KitchFix_Service_Calendar_Price_Review_v3_FINAL.xlsx`, tab `Service Price Review`, column E = **`Billing Price`**.
- **Signed sheet metadata** (from Instructions tab):
  - Title: "SERVICE CALENDAR PRICE REVIEW v3 (June 16, 2026)"
  - Instruction (row 3): "Joe - review the 'Service Price Review' tab and confirm pricing."
  - Column J (row 20): "**Action Required - JOE FILLS THIS IN (blue column)**" — this is Joe's sign-off column.
  - Yellow-row questions to Joe (rows 22-28): STL-FL MiLB Snack price, TBJ-NY Snack/Shake, TBR-FL MiLB ST vs MiLB naming, STL-FL Arrival vs Breakfast, TBJ-FL Media Meals proj-vs-actuals gap.
- **PG effective-dated prices**: `sc_service_prices` where `price_kind = 'projected'` and `effective_date <= 2026-07-01`, latest per `service_id`. Mirrors the LATERAL JOIN the `sc_daily_revenue` view uses.
- **Extraction date**: 2026-07-14.
- **Match tolerance**: exact match to $0.01 (per-cent). Any delta of $0.01 or more counts as STALE_PG.
- **Reproducibility**: `python3 scripts/_probe_price_audit_join.py` (after `node --env-file=.env.local scripts/_probe_pricing_summit_pg_effective_prices.mjs > /tmp/pg-effective-prices.json`).

## §2. Verdict rollup

| Verdict | Count | % |
|---|---:|---:|
| MATCH (signed exactly = PG within $0.01) | **99** | 94.3% |
| **STALE_PG** (signed ≠ PG) | **1** | 1.0% |
| UNMAPPED_PG (signed row has no PG match by (acct, group, service)) | 4 | 3.8% |
| UNKNOWN (signed Billing Price blank pending Joe) | 1 | 1.0% |
| Total signed rows | 105 | |
| PG-only rows (in PG, not in signed sheet) | 4 | (mirror of UNMAPPED_PG) |

## §3. UNMAPPED tables

### §3.1 Signed-but-not-in-PG (naming mismatches vs real gaps)

| Account | Group | Signed service name | Signed Billing Price | Actual state |
|---|---|---|---:|---|
| CIN - AZ | Minor League | Coffee Service | $511.05293 | **NAMING MISMATCH** — PG has "Coffee Service **(tax-free)**" same price $511.05293 (below) |
| CIN - AZ | Minor League | Fountain Bev | $283.91714 | **NAMING MISMATCH** — PG has "Fountain Bev **(tax-free)**" same price $283.91714 (below) |
| STL - FL | Palm Beach Cardinals | Breakfast | $0 | **JOE QUESTION** — Instructions tab §Q(d): "STL-FL 'Arrival' vs 'Breakfast' - same service?" PG has "Arrival", not "Breakfast" |
| TBR - FL | Minor League | Extended Day Labor | $280 | **NAMING MISMATCH (case-only)** — PG has "Extended Day labor" (lowercase L in "labor") same price $280 (below) |

### §3.2 PG-only (in PG, no signed match)

| Account | Group | PG service name | PG price | Actual state |
|---|---|---|---:|---|
| CIN - AZ | Minor League | Coffee Service **(tax-free)** | $511.05293 | Mirror of §3.1 CIN-AZ Coffee row — same service, PG name has "(tax-free)" suffix |
| CIN - AZ | Minor League | Fountain Bev **(tax-free)** | $283.91714 | Mirror of §3.1 Fountain — same suffix pattern |
| STL - FL | Fun Money | Fun Money allocation | $0 | Non-revenue placeholder — expected (MONEY_MODEL §i mentions "Fun Money is `is_non_revenue`") |
| TBR - FL | Minor League | Extended Day **labor** | $280 | Mirror of §3.1 case-only mismatch |

### §3.3 UNKNOWN (signed Billing Price blank, Joe-pending)

| Account | Group | Service | Notes column | Flags column | Action Required |
|---|---|---|---|---|---|
| STL - FL | MiLB | Snack | "NEEDS PRICE - or $0 since fee account?" | `fee_account` | (blank — awaiting Joe) |

---

## §4. Full verdict matrix per account

### CIN - AZ (13 signed services)

- 12 MATCH · 1 STALE_PG (Major League Breakfast, PG $20.32 vs signed $20.30622) · 0 UNMAPPED · 0 UNKNOWN (2 apparent-UNMAPPED are Coffee/Fountain naming mismatches, materially fine).

### CIN - KY (5 signed services)

- 5 MATCH · 0 STALE · 0 UNMAPPED · 0 UNKNOWN.

### CIN - OH (4 signed services)

- 4 MATCH · 0 STALE · 0 UNMAPPED · 0 UNKNOWN.

### STL - FL (11 signed services)

- 9 MATCH · 0 STALE · 1 UNMAPPED_PG (Palm Beach Cardinals Breakfast — Joe question) · 1 UNKNOWN (MiLB Snack — Joe question).

### STL - MO (4 signed services)

- 4 MATCH · 0 STALE · 0 UNMAPPED · 0 UNKNOWN.

### TBJ - FL (21 signed services)

- 21 MATCH · 0 STALE · 0 UNMAPPED · 0 UNKNOWN. **All Blue Jays PDC rates align exactly** — including MLB Player Meal, FSL Team, FCL Team, Snack, Shake, and every add-on.

### TBJ - NY (6 signed services)

- 6 MATCH · 0 STALE · 0 UNMAPPED · 0 UNKNOWN.

### TBR - FL (20 signed services)

- 19 MATCH · 0 STALE · 1 UNMAPPED_PG (Extended Day Labor case-only mismatch, materially fine) · 0 UNKNOWN. **The A-1 concern lands here — all 5 MiLB meal rates match signed exactly.**

### TXR - AZ (13 signed services)

- 13 MATCH · 0 STALE · 0 UNMAPPED · 0 UNKNOWN.

### TXR - TX - H (4 signed services)

- 4 MATCH · 0 STALE · 0 UNMAPPED · 0 UNKNOWN.

### TXR - TX - V (4 signed services)

- 4 MATCH · 0 STALE · 0 UNMAPPED · 0 UNKNOWN.

---

## §5. Sanity cross-checks

### §5.1 Invoice vs signed alignment (9-invoice sample)

| Invoice | Line item | Invoice rate | Signed Billing Price | Match? |
|---|---|---:|---:|---|
| K300168545 | TBR MLB - Breakfast | $35.63 | $35.62731 | ✓ (rounds) |
| K300168545 | TBR MLB - Lunch/Dinner | $39.48 | $39.482 (Lunch), $39.482 (Dinner) | ✓ (rounds) |
| K300168548 | TBJ MLB - Breakfast/Lunch/Dinner | $23.12 | $23.12 (MLB Player Meal) | ✓ EXACT |
| K300168585 | TXR-AZ MLB - Breakfast/Lunch/Dinner | $28.58 | $28.57781 (MLB Breakfast/Lunch/Dinner) | ✓ (rounds) |
| K300168587 | REDS MLB - Meal Service | $20.31 | $20.30622 (CIN-AZ Major League Breakfast/Lunch/Dinner) | ✓ (rounds; note PG-STALE per §0) |
| K300168736 | REDS MiLB - Meal Service | $12.90 | $12.89503 (CIN-AZ Minor League Breakfast/Lunch/Dinner) | ✓ (rounds) |
| K300168736 | REDS Coffee Service | $511.05 | $511.05293 | ✓ (rounds) |
| K300168736 | REDS Fountain Beverages | $283.92 | $283.91714 | ✓ (rounds) |
| K300168871 | TBR MiLB - Lunch/Dinner | $21.68 | $21.675 (Lunch - MiLB) | ✓ (rounds) |
| K300168871 | TBR MiLB - Breakfast | $17.83 | $17.8275 (Breakfast - MiLB) | ✓ (rounds) |
| K300168870 | TXR-AZ MiLB - Breakfast/Lunch/Dinner | $14.29 | $14.288905 (MiLB Breakfast/Lunch/Dinner) | ✓ (rounds) |
| K300168870 | TXR-AZ - Pre-Game Hot Snack | $10.93 | $10.92835 | ✓ (rounds) |
| K300168870 | TXR-AZ - Regular Snack | $5.89 | $5.88585 | ✓ (rounds) |
| K300168343 | STL - FL Service Fees (PFS) | $350,000 | flat-fee ($0 per-meal in signed sheet) | ✓ N/A (fee-account) |

**Every invoice line matches the signed Billing Price** (all round exactly). **Billing has NOT diverged from the signed sheet** — the earlier concern (invoice ≠ signed = a serious class) is refuted.

### §5.2 A-1 confirmation: signed sheet IS the source of truth

The signed sheet's authority is confirmed by:
- Invoice $21.68 (Lunch) EXACTLY MATCHES signed $21.675 (Lunch - MiLB, rounded to $21.68).
- PG's $21.675 (Lunch) and $20.96 (Dinner) EXACTLY MATCH the signed sheet.
- The MONEY_MODEL digest's "MiLB $20.96" (single-rate) was an OVERSIMPLIFICATION of two distinct signed rates (Lunch + Dinner). Not a PG staleness issue.

The signed sheet's rates are what PG stores + what invoices bill. Signed IS truth for this account, as ratified by P-1.

---

## §6. Findings

1. **The systemic-staleness hypothesis is REFUTED.** 1 STALE_PG row of 105 (0.95%) is at rounding-level ($0.014/meal on CIN-AZ MLB Breakfast), not a systemic bug pattern.
2. **The A-1 finding is REVISED** to not-a-conflict. See CONFLICT_REGISTER §A-1 addendum-2 (this pass).
3. **Billing has NOT diverged from the signed sheet.** All invoice rates match signed within rounding.
4. **4 signed-vs-PG UNMAPPED rows are naming-only mismatches** (Coffee Service / Coffee Service (tax-free); Fountain Bev / Fountain Bev (tax-free); Extended Day Labor / Extended Day labor). Same prices; different service_name strings. **Documentation/naming clean-up candidates**, not price fixes.
5. **1 UNKNOWN** (STL-FL MiLB Snack) is a Joe-pending question, not a PG bug.
6. **1 STL-FL question** (Palm Beach Cardinals Breakfast vs Arrival, §3.1 row 3) is a Joe-pending question about whether the SC service "Arrival" IS "Breakfast" or is a separate service; both PG and signed sheet have their own name; the CONTENT (a morning meal at Roger Dean) may be the same.

## §7. Recommended Phase-3 actions (for Kevin's approval — not applied here)

1. **sc-XX-price-fix (single row)**: `UPDATE sc_service_prices SET price = 20.30622 WHERE service_id = <CIN - AZ Major League Breakfast> AND effective_date = 2026-06-16 AND price_kind = 'projected';` — corrects the $0.014/meal rounding delta to match Joe's signed Billing Price.
2. **Naming clean-up sc-XX** (not price-related, cosmetic): align `sc_services.service_name` OR the signed sheet's service names for the 3 naming-only mismatches (Coffee Service ± "(tax-free)", Fountain Bev ± "(tax-free)", Extended Day Labor vs Extended Day labor). Kevin picks direction.
3. **Joe follow-ups** (rows Joe hasn't ruled on):
   - STL-FL MiLB Snack Billing Price (Q(a) from Instructions tab).
   - TBJ-NY Snack + Shake prices (Q(b)).
   - TBR-FL Breakfast - MiLB ST vs Breakfast - MiLB same-or-distinct (Q(c)).
   - STL-FL Arrival vs Breakfast (Q(d)).
   - TBJ-FL Media Meals $16 (proj) vs $15 (actuals) $1 gap (Q(e)).
4. **MONEY_MODEL digest expansion**: TBR-FL row in the per-account digest currently lists "MiLB $20.96" (single rate) — this OVERSIMPLIFIES the actual signed structure (Breakfast $17.83, Lunch $21.675, Dinner $20.96). Recommend expanding the digest row per §B-1/B-2 already flagged in CONFLICT_REGISTER Phase 0a.
