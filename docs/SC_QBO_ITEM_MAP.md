# SC → QBO Item Map

Authoritative reference for how Service Calendar services flow into QuickBooks
invoices for the accounts currently billing-enabled through the SC finalize
flow. **Currently in scope: TBR - FL and TBJ - FL** (sc-38, 2026-09-02). CIN -
AZ + TXR - AZ pilot mappings (sc-31) documented at their own reference in the
migration file.

This doc mirrors `sc_qbo_service_map` and `sc_qbo_account_map` as of
2026-09-02. If a mapping is edited in-place, update this doc same-day so
finalize behaviour reads truly.

Related docs:
- `SC_SPREADSHEET_MAPPING.md` - what the SC catalog holds (per-account, per-service).
- `SC_MONEY_MODEL.md` - the two-rate price model (January projection + June actuals-net-of-SF).
- `SC_QBO_SHAPE_SPEC.md` §4 + §5 - the builder rules and mapping-row shapes.

---

## Account map

| Account key | QBO customer id | QBO DisplayName | Tax code | QBO class id | Class name | Cadence | Mode |
|---|---|---|---|---|---|---|---|
| TBR - FL | 17860 | Tampa Bay Rays MiLB/MLB | 26 | 1200000000000091984 | PFS:TBR - FL | weekly | test |
| TBJ - FL | 16971 | Rogers Blue Jays Baseball Partnership | 26 | 1200000000000081313 | PFS:TBJ - FL | weekly | test |
| CIN - AZ | 17752 | Cincinnati Reds (Goodyear, AZ) | 37 | 1200000000000130911 | PFS:CIN - AZ (REDS) | biweekly | test |
| TXR - AZ | 19000 | Texas Rangers - Surprise, AZ | 36 | 1200000000000411132 | PFS:TXR - AZ | weekly | test |

All four accounts ship in `qbo_mode='test'` and route to the ZZ TEST customer
until Kevin runs a live drill and flips to `live`. Flip is a one-cell UPDATE
per account; see the qbo_mode adapter path for the fence rules.

**Customer DisplayName is validated by QBO at POST time** as part of the
`CustomerRef {value, name}` pair. The names above are pulled live from QBO,
not derived from the SC's account_key. A wrong name causes QBO to reject
the invoice.

**Every invoice line carries `ClassRef` from `qbo_class_id`** (sc-41,
2026-09-03). Kevin's discovery: QBO Items carry a default `ClassRef` in
their config but QBO does NOT echo it onto lines written via API. Before
sc-41, every invoice the system generated landed unclassed, orphaning
revenue on Kevin's class-segmented P&L. Fix: `qbo_class_id` on the
account map, builder emits `ClassRef: { value: qbo_class_id }` on every
line. Class is per-account, not per-service - verified across the four
fixtures (CIN main + CIN rehab, TXR week 0720 + week 0727) all sharing
one class id per account. **Any test invoices generated between PR-F
merge (2026-08-11) and sc-41 apply (2026-09-03) need voiding, not
reclassing** - QBO's edit UI does not backfill per-line ClassRef the
way a fresh POST does.

---

## TBR - FL service map

**10 rows.** 2 invoice slots (`mlb`, `milb`) plus the export-excluded B&G
slot. Realistic per-week count: 1-2 invoices in-season (only `milb` active
post-spring-training), 2 invoices at ST peak.

| Group | SC service | QBO item id | QBO line description | Aggregate group | Slot | Rate | Notes |
|---|---|---|---|---|---|---|---|
| Major League | Breakfast | 3297 | TBR MLB - Breakfast | (none) | mlb | $35.63 | Own line. Spring-training only. |
| Major League | Lunch | 3298 | TBR MLB - Lunch/Dinner | tbr-mlb-ld | mlb | $39.48 | Aggregates with Dinner. ST only. |
| Major League | Dinner | 3298 | TBR MLB - Lunch/Dinner | tbr-mlb-ld | mlb | $39.48 | Aggregates with Lunch. ST only. 0 season units - mapped preemptively. |
| Minor League | Breakfast - MiLB | 3293 | TBR MiLB - Breakfast | (none) | milb | $17.83 | Own line. |
| Minor League | Lunch - MiLB | 3294 | TBR MiLB - Lunch/Dinner | tbr-milb-ld | milb | $21.68 | Same QBO item as Dinner but rates differ - **splits into 2 lines per day when both carry qty** (rate-guard). |
| Minor League | Dinner | 3294 | TBR MiLB - Lunch/Dinner | tbr-milb-ld | milb | $20.96 | Same QBO item as Lunch but rate differs. 0 season units - safe today; a future actual produces a second line per day, NOT one blended line. Kevin ruling if that presents wrong. |
| Minor League | Road Sandwiches - MiLB | 3389 | TBR MiLB - Road Sandwiches | (none) | milb | $11.00 | Own line. |
| Minor League | Extra Protein - Chicken/Pork | 3369 | Extra Protein (TBR) - Chicken/Pork | (none) | milb | $111.84 | Own line since July 2026 per Kevin ruling (was bundled under Lunch/Dinner before). Sits on `milb` slot per observed invoices. `is_flat_fee=true`. |
| Minor League | Extended Day Labor | 3392 | Labor Fee | (none) | milb | $280.00 | Own line. `is_flat_fee=true`, one line per week with any actual row. |
| Boys & Girls Club | B&G Lunch | **EXCLUDED** | - | - | main | $6.75 | `export_excluded=true`. Sebastian invoices B&G outside the system; B&G revenue stays in TBR account totals per Kevin's kitchen-margin rule (rule 2b in `buildInvoicePayload.js` header). Sits on `main` slot as a marker (never produces a line). |

**TBR services NOT mapped** (all zero season units; unmapped-throw only fires
on qty>0, so silent until a real actual lands):

- Major League: `Umpire Meal`, `Extra Protein - Chicken/Pork` (MLB variant, distinct from MiLB), `Extra Protein - Beef/Seafood`, `MLB - Extra MTO - Sm`, `MLB - Extra MTO - Med`, `MLB - Extra MTO - Lrg`.
- Minor League: `AFTER HOURS MEALS`, `Extra Protein - Beef/Seafood`.

If any of these starts getting used, first finalize throws with a clean
`unmapped service ... - add to sc_qbo_service_map before finalize` message.

---

## TBJ - FL service map

**15 rows.** 8 invoice slots (`mlb`, `milb`, `single-a`, `ssm`, `florida-ops`,
`mlb-pantry`, `milb-pantry`, `catering`). Realistic per-week count: 3-5
in-season, up to 7 at spring-training peak. Only slots with non-zero units in
a given week produce an invoice - empty slots emit nothing.

| Group | SC service | QBO item id | QBO line description | Aggregate group | Slot | Rate | Notes |
|---|---|---|---|---|---|---|---|
| Major League - PDC | Breakfast | 3299 | TBJ MLB - Breakfast/Lunch/Dinner | tbj-mlb-bld | mlb | $23.12 | Aggregates. Spring-training only. |
| Major League - PDC | Lunch | 3299 | TBJ MLB - Breakfast/Lunch/Dinner | tbj-mlb-bld | mlb | $23.12 | Aggregates. ST only. |
| Major League - PDC | Dinner | 3299 | TBJ MLB - Breakfast/Lunch/Dinner | tbj-mlb-bld | mlb | $23.12 | Aggregates. ST only. 0 season units - preemptive. |
| Major League - PDC | Post Game Meal | 3381 | TBJ Pre/Post Game Meal | (none) | mlb | $23.12 | Own line. Same `mlb` slot / same invoice document, but distinct QBO item so it does not aggregate. |
| Minor League - PDC | Breakfast | 3295 | TBJ MiLB - Breakfast/Lunch/Dinner | tbj-milb-bld | milb | $11.55 | Aggregates. |
| Minor League - PDC | Lunch | 3295 | TBJ MiLB - Breakfast/Lunch/Dinner | tbj-milb-bld | milb | $11.55 | Aggregates. |
| Minor League - PDC | Dinner | 3295 | TBJ MiLB - Breakfast/Lunch/Dinner | tbj-milb-bld | milb | $11.55 | Aggregates. |
| Single A Jays | Breakfast | 3323 | TBJ Single A Jays - Meal Service | tbj-single-a-meal | single-a | $16.51 | Aggregates. 0 season units - preemptive. |
| Single A Jays | Pre-Game | 3323 | TBJ Single A Jays - Meal Service | tbj-single-a-meal | single-a | $16.51 | Aggregates. |
| Single A Jays | Post-Game | 3323 | TBJ Single A Jays - Meal Service | tbj-single-a-meal | single-a | $16.51 | Aggregates. |
| SSM | Stadium Staff Meals | 3435 | TBJ - Stadium Staff Meals | (none) | ssm | $16.51 | Own invoice slot. Sebastian invoices SSM separately from Florida Ops. |
| SSM | Florida Ops - PDC | 3438 | TBJ - Florida Ops | (none) | florida-ops | $11.55 | Own invoice slot per Sebastian's document separation. |
| Other | MLB G&G - Pantry | 3433 | MLB G&G - Pantry | (none) | mlb-pantry | $1.70 | Own invoice slot. Pantry lump-sum item. |
| Other | MiLB G&G - Pantry | 3432 | MiLB G&G - Pantry | (none) | milb-pantry | $1.70 | Own invoice slot. |
| Other | Team Canada | 3354 | Catering - PFS | (none) | catering | $23.12 | Own invoice slot. |

**TBJ services deliberately NOT mapped** (Kevin ruling 2026-09-02):

- `Major League - PDC / Umpire`, `Major League - PDC / Snack` - **dead services**. Separate archive PR queued; do not add to service_map. `active_until` archive on those two rows will follow in the next PR.
- `Other / Fun $$$$ Allocated` - `is_non_revenue=true`, dropped by `buildInvoicePayload.js:241` before the mapping check ever fires. Safe by construction. Amount-type input support parked in PR-T spec until post-training.

**TBJ services unmapped and Kevin ruling PENDING** (WILL THROW ON FINALIZE if a week carries their units):

- `Other / Media Meals`
- `Other / Scout Meals`
- `Other / MLB - Catering`

Chat-Claude flagged **three weeks in 2026 that carry Scout Meals or Media
Meals units**: **Jan 26, Feb 16, Jun 1**. Finalize on any of those three
weeks with the current map will throw with a named-service error. Either
(a) Kevin lands the three additional QBO item mappings in a follow-up
migration before running finalize on those weeks, or (b) Kevin only runs
finalize on weeks where those three services carry zero units. `MLB -
Catering` has no non-zero weeks in 2026 season-to-date - safe until a future
actual lands.

---

## Slot design

Slots produce one QBO invoice each. Each invoice ends up in its own document
in Sebastian's register. The slot names above match Sebastian's actual document
separation practice, verified against Jun-Aug 2026 invoice pulls.

**A slot with no lines produces no invoice.** So an in-season TBJ week with
zero MLB service (typical - MLB is spring-training only) generates 0 rows on
the `mlb` slot and 0 QBO invoices there. Only slots with any qty>0 in the
week generate invoices.

**Aggregate groups** merge multiple services into ONE QBO invoice line when
(a) they share the same aggregate_group value AND (b) they share the same
rate (cent-rounded). The rate-guard at `buildInvoicePayload.js:320-330` splits
different-rate services into separate lines under the same QBO item - this is
the case that affects TBR MiLB Lunch ($21.68) vs Dinner ($20.96), noted in
the table above.

---

## Owner rulings this map codifies (all 2026-09-02)

- **B&G billed outside the system.** `export_excluded=true` on the mapping row (not `is_non_revenue` on the service - that would drop the row from revenue math and violate the kitchen-margin rule that one kitchen buys labour + food once for two clients).
- **MLB is spring-training only at both accounts.** MLB items still mapped so a future ST day cannot throw (learned from TXR - AZ Extra Protein first-use throw pattern).
- **Extra Protein (TBR) is its own line item since July 2026.** Sebastian changed practice mid-season; sits on the `milb` slot at the same document as MiLB meals but as a distinct QBO item, not bundled.
- **Slot assignment matches Sebastian's document separation.** TBR: 2 slots. TBJ: 8 slots (typical 3-5 per week active).
- **Buffalo Meal Service / TBJ - NY out of scope.** No `invoice_account_key` cross-account routing built. Sebastian invoices Buffalo by hand.
- **TBJ Umpire + Snack are dead.** Separate archive PR, not this map.

## When to update this doc

- Any INSERT / UPDATE / DELETE on `sc_qbo_service_map` for TBR - FL or TBJ - FL.
- Any INSERT / UPDATE on `sc_qbo_account_map` for TBR - FL or TBJ - FL (customer id, tax code, cadence, or mode change).
- Kevin adds QBO items for the three pending TBJ services (Media Meals, Scout Meals, MLB - Catering).
- Sebastian changes invoicing practice (bundle/unbundle, slot separation change, new QBO item id).
- CIN - AZ or TXR - AZ mapping changes (add their sections here to consolidate).
