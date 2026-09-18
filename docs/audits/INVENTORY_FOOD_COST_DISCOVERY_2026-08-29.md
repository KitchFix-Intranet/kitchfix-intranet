# Inventory + food cost definition discovery - 2026-08-29

> READ-ONLY discovery. Measures whether Purchasing (purchases) and finance (inventory-adjusted usage) share a GL label but represent different quantities. Reports what exists; does not fix.
> All claims labelled [ran] or [code-read] per BUILD_ACCURACY_PROTOCOL C1.

## Executive summary

- The legacy monthly-count tracker is `/ops` -> `inventory` -> `InventoryTool`, writing per-account per-period category totals (food/packaging/supplies/snacks/beverages) to Sheets `inventory_submissions` on the COLLECTION spreadsheet. No PG mirror exists for this table (row count 0). Legacy Inventory Count is dispositioned "LEAVE ON SHEETS, retire year-end" per `MIGRATION_STATUS.md` line 118-121.
- A separate PARKED Smart Inventory prototype (Module 7) has PG schema live with 8 tables (`count_sessions`, `count_items`, `inventory_items`, etc.) but is not the count surface a site operator would submit against today. Its total per-account coverage across FYTD P1..P8 is **5 count_sessions on 2 accounts** (CIN - OH x1, STL - MO x4), all in draft status.
- The FYTD-P8 food + packaging deltas versus finance are **large, systematically NEGATIVE (ours < finance) on 9 of 11 accounts on Food, and 10 of 11 on Packaging**, in a range that is inventory-plausible but too large in some cases (e.g. TXR - AZ Packaging -55%, CIN - AZ Packaging -44%) to be inventory alone without other structural differences.
- The Labor control DID NOT reconcile clean for 4 of 11 accounts in my read (CIN - KY +45%, TXR - AZ -9%, STL - FL -8%, TBR - FL -2%). Per the brief's rule ("if labor also drifts, your window is wrong - fix that first and say so") I state plainly: **my labor read may be missing a scope element the labor CC's own reconciliation applies**, so the food deltas below carry a needs-gate on window/scope beyond the 7 accounts where my labor came within +/- 1%. See Part D verdict + blocked items.

## Part A - the inventory app as built

**Route / page paths [code-read]**
- Client entry: `/ops` -> tab `inventory` renders `InventoryTool`. Reference: `src/app/ops/page.js:104-106`.
- Component: `src/app/ops/components/inventory/InventoryTool.js` (804 lines).
- Server writes: `src/app/api/ops/route.js:1075-1178` `action=submit-inventory`.
- Server reads: `src/app/api/ops/route.js:842-867` `action=inventory-history` and the bootstrap `inventoryLog` at `route.js:722-746, 792-830`.

**What it writes to [code-read]**
- Sheets, not PG. Target: `SHEET_IDS.COLLECTION` (id `1itJh5x1YFBdyHTBr-dyKD_r_nRBfjwIBiR_bWiOyCzQ`), tab `inventory_submissions`. Reference: `src/app/api/ops/route.js:1109` (`appendRowSA(SHEET_IDS.COLLECTION, "inventory_submissions", row)`).
- PG mirror of the same table exists but holds **0 rows** [ran]. No dual-write is wired for the legacy monthly-count flow (confirmed by grep - no `dataStore/inventory*` helper writes `inventory_submissions`; only the parked Smart Inventory prototype touches PG inventory tables).

**Exact fields captured per count [code-read]**
Row shape written to Sheets, from `src/app/api/ops/route.js:1104-1108`:
```
[
  uuid,                          // client UUID for idempotency
  now.toISOString(),             // server timestamp
  email,                         // submitter email
  account,                       // account key (e.g. "TBR - FL")
  period,                        // fiscal period label ("P1".."P13")
  dateStamp,                     // client local date (YYYY-MM-DD) or UTC fallback
  fNum,                          // food $ (Number)
  pNum,                          // packaging $
  sNum,                          // supplies $
  snkNum,                        // snacks $
  bevNum,                        // beverages $
  total,                         // server-recomputed total ($)
  String(notes || ""),           // free-text notes
]
```

Reader shape (`inventory-history`, `src/app/api/ops/route.js:847-859`) confirms the column indices: `account=r[3], period=r[4], date=r[5], food=r[6], packaging=r[7], supplies=r[8], snacks=r[9], beverages=r[10], total=r[11], notes=r[12]`.

**Per-item or per-category? [code-read]**
- Per-category dollar totals only. Five categories: food, packaging, supplies, snacks, beverages. Not per-item.
- Server validation at `src/app/api/ops/route.js:1084-1086` requires at least one of food/packaging/supplies > 0.

**Valuation method [code-read]**
- Operator-entered dollar values per category. No unit prices, no counts, no derived valuation. What the operator types is what lands. The tool is a monthly self-report, not a linked-to-invoices count.

**Who can submit [code-read]**
- Any authenticated session that reaches `/ops`. `src/app/ops/page.js:104-106` mounts `InventoryTool` without a role gate (contrast the Inventory Manager gate at line 22: `INV_MANAGER_DEV_USERS = ["k.fietek@kitchfix.com", "joe@kitchfix.com"]`). The InventoryTool component has no additional role check.
- Account list restriction is data-driven: the account picker uses `config.accounts` (from bootstrap) filtered by `activePeriods` (`InventoryTool.js:76-89`) - a site leader would only see their own account per whatever the ops bootstrap decides. No hard gate in code.

## Part B - coverage

**Legacy `inventory_submissions` (Sheets, load-bearing table). BLOCKED.**
- `[ran]` PG mirror row count: **0** (`inventory_submissions` PG table exists but empty).
- `[code-read]` `inventory_submissions` is written to Sheets only (`src/app/api/ops/route.js:1109`). Reading it requires the Google Sheets API. CC's environment cannot query Sheets without a live OAuth token or SA credentials, and this audit is pinned to READ-ONLY Postgres.
- **Cannot report per-account count histories, cadence, or gaps from within this audit.** Only a Sheets-side query (or a running server call to `/api/ops?action=bootstrap` or `?action=inventory-history`) can produce them. Named as blocked.

**Smart Inventory (PARKED prototype, PG). Documented for completeness only - not the count surface a site leader submits against today.**
- `[ran]` `count_sessions` total rows: **5**. All in `draft` status (never submitted).

Per-account coverage for the 11 account keys in scope:

| account | sessions | last session date |
|---|---:|---|
| CIN - AZ | 0 | (none) |
| CIN - KY | 0 | (none) |
| CIN - OH | 1 | 2026-04-12T19:33:21 |
| STL - FL | 0 | (none) |
| STL - MO | 4 | 2026-05-19T17:20:09 |
| TBJ - FL | 0 | (none) |
| TBJ - NY | 0 | (none) |
| TBR - FL | 0 | (none) |
| TXR - AZ | 0 | (none) |
| TXR - TX - H | 0 | (none) |
| TXR - TX - V | 0 | (none) |

Per-session `count_items` and totals (all draft):

| session | items | total |
|---|---:|---:|
| STL - MO P4 (a) | 3 | 241.08 |
| STL - MO P4 (b) | 120 | 18,078.80 |
| CIN - OH P4 | 3 | 21.05 |
| STL - MO P5 | 18 | 2,144.43 |
| STL - MO P6 | 3 | 251.97 |

**Coverage verdict (Smart Inventory PG only, since Sheets not queryable in this env):**
- 9 of 11 accounts have zero PG count history.
- Cadence-achieved is not measurable: every existing row is `draft`, no `submitted_at`. Nothing has been closed out end to end through the PG path.
- The load-bearing count history lives in Sheets `inventory_submissions` per Part A; the sessions above are prototype residue, not operational data.

## Part C - reachability from Postgres

`[ran]` Inventory-shaped tables present in the schema (row counts as of 2026-08-29):

| table | rows | source |
|---|---:|---|
| `inventory_items` | 3,759 | Smart Inventory (PARKED) |
| `item_aliases` | 4,341 | Smart Inventory (PARKED) |
| `price_history` | 6,665 | Smart Inventory (PARKED) |
| `review_queue` | 167 | Smart Inventory (PARKED) |
| `count_sessions` | 5 | Smart Inventory (PARKED) - all draft |
| `count_items` | 147 | Smart Inventory (PARKED) |
| `merge_history` | 59 | Smart Inventory (PARKED) |
| `storage_locations` | 32 | Smart Inventory (PARKED) |
| `inventory_submissions` | 0 | Legacy monthly count (Sheets only; PG never populated) |

`stock_counts`, `stock_items`, `inventory_counts` - not present in schema.

**Reachability verdict**: the **operational** monthly-count data (`inventory_submissions`) is NOT reachable from Postgres today. It lives only on Google Sheets (Sheet id `1itJh5x1YFBdyHTBr-dyKD_r_nRBfjwIBiR_bWiOyCzQ`, tab `inventory_submissions`). To read it from a PG-backed reader would require either (a) a fresh migration of the Sheets rows into `inventory_submissions` PG table + a dual-write hook on submit, or (b) a Sheets-side reader path from whatever service wants inventory-adjusted food. Both are out of scope per the brief.

The PARKED Smart Inventory PG schema is reachable but is not what the site is submitting to and its cadence is one-off draft rows on two accounts.

## Part D - the measured gap

`[ran]` All figures computed by `scripts/probes/_probe_inventory_audit_partD.mjs` (READ-ONLY, service-role Supabase client). Range: `2025-12-29 .. 2026-08-09` (FY2026 P1 W1 through P8 close per `src/app/kpi/labor/lib/periods.js:19,65-80`).

**Bucket mapping mirrored from purchasing route** (not re-implemented) [code-read]:
- `src/app/api/kpi/purchasing/route.js:161-165` - `BUCKETS = [{food, 3200}, {packaging, 3400}, {vehicle, 3500}]`.
- `src/app/api/kpi/purchasing/route.js:167-174` - `bucketForGl(gl)` maps by prefix.
- `src/app/api/kpi/purchasing/route.js:1520-1543` - `billsOnlySpentForGl` filters `source='billcom'`; `codedCardSpentForGl` filters `source='rippling_spend'`. Both sum `amount` on non-excluded rows.
- `src/app/api/kpi/purchasing/route.js:266-294` - `paginateActuals` selects `purchasing_actuals` with `.eq("excluded", false).gte("txn_date", start).lte("txn_date", end).in("account_key", memberChunk)` paginated at `V6_PAGE_DEFAULT`.
- `src/app/api/kpi/purchasing/route.js:1646-1703` - `buckets[]` rollup: bucket hero = `billsOnly + cardsCoded` per bucket prefix.

My probe reads the same table, same filters, same bucket mapping, and reports both the bills-only figure AND the bills+cards_coded figure (the bucket hero the operator sees on the board).

**Labor probe** reads `labor_actuals_latest.amount` per account, in-range by `week_start <= end AND week_end >= start` (matches route.js:189-190), plus `labor_salary_actuals.amount` in the same window. Reference: `src/app/api/kpi/labor/route.js:180-202`.

### 3100 Labor control (reconciliation check)

| account | ours hourly | ours salary | ours total | finance | delta | delta % |
|---|---:|---:|---:|---:|---:|---:|
| TBR - FL | 355,555.33 | 133,846.40 | 489,401.73 | 500,461.43 | -11,059.70 | -2.21% |
| STL - MO | 88,561.84 | 112,981.02 | 201,542.86 | 202,471.12 | -928.26 | -0.46% |
| CIN - KY | 0.00 | 52,919.36 | 52,919.36 | 36,382.06 | +16,537.30 | **+45.45%** |
| CIN - AZ | 169,250.76 | 117,307.86 | 286,558.62 | 285,623.44 | +935.18 | +0.33% |
| CIN - OH | 78,255.32 | 53,772.16 | 132,027.48 | 132,144.45 | -116.97 | -0.09% |
| TBJ - NY | 0.00 | 36,679.23 | 36,679.23 | 36,679.33 | -0.10 | -0.00% |
| TBJ - FL | 341,586.30 | 115,608.50 | 457,194.80 | 459,726.98 | -2,532.18 | -0.55% |
| TXR - TX - H | 68,757.69 | 89,060.14 | 157,817.83 | 156,756.88 | +1,060.95 | +0.68% |
| TXR - TX - V | 49,567.32 | 39,422.00 | 88,989.32 | 91,975.76 | -2,986.44 | -3.25% |
| TXR - AZ | 196,618.08 | 82,067.84 | 278,685.92 | 306,451.07 | -27,765.15 | **-9.06%** |
| STL - FL | 255,878.00 | 95,192.43 | 351,070.43 | 382,078.72 | -31,008.29 | **-8.12%** |

**Control read**: 7 of 11 accounts within +/- 1% (CIN - AZ, CIN - OH, TBJ - NY, TBJ - FL, TXR - TX - H, STL - MO, TXR - TX - V within 3.3%). **4 accounts drift meaningfully**: CIN - KY +45%, TXR - AZ -9%, STL - FL -8%, TBR - FL -2.2%. The brief said 10 of 11 reconciled to the penny already; my read matches for the majority but does not reproduce the reconciliation on those 4. Interpretation per the brief: **the food deltas on TXR - AZ, STL - FL, CIN - KY, and TBR - FL specifically may be partly window/scope, not inventory** - my labor is off on those same accounts, and if my method drops a scope element the labor CC handles, that same element could shift purchasing too. For the 7 accounts where labor lands clean, the food + packaging deltas below are trustworthy signal.

### 3200 Food

| account | ours bills | ours cards | ours total | finance | delta | delta % | lines |
|---|---:|---:|---:|---:|---:|---:|---:|
| TBR - FL | 434,991.52 | 412.79 | 435,404.31 | 446,802.30 | -11,397.99 | -2.55% | 556 |
| STL - MO | 79.80 | 0.00 | 79.80 | 0.00 | +79.80 | n/a | 1 |
| CIN - KY | 55,836.89 | 0.00 | 55,836.89 | 58,709.20 | -2,872.31 | -4.89% | 113 |
| CIN - AZ | 311,893.19 | 9.81 | 311,903.00 | 307,762.06 | +4,140.94 | +1.35% | 377 |
| CIN - OH | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | n/a | 0 |
| TBJ - NY | 35,745.64 | 0.00 | 35,745.64 | 40,937.45 | -5,191.81 | -12.68% | 10 |
| TBJ - FL | 380,448.26 | 727.58 | 381,175.84 | 387,713.50 | -6,537.66 | -1.69% | 334 |
| TXR - TX - H | 223,352.87 | 327.50 | 223,680.37 | 237,178.40 | -13,498.03 | -5.69% | 74 |
| TXR - TX - V | 91,872.61 | 0.00 | 91,872.61 | 93,198.54 | -1,325.93 | -1.42% | 59 |
| TXR - AZ | 334,173.54 | 4,063.97 | 338,237.51 | 357,202.91 | -18,965.40 | -5.31% | 441 |
| STL - FL | 16,652.49 | 418.68 | 17,071.17 | 21,446.26 | -4,375.09 | -20.40% | 13 |

### 3400 Packaging

| account | ours bills | ours cards | ours total | finance | delta | delta % | lines |
|---|---:|---:|---:|---:|---:|---:|---:|
| TBR - FL | 48,654.74 | 418.55 | 49,073.29 | 66,041.84 | -16,968.55 | -25.69% | 214 |
| STL - MO | 3,500.70 | 0.00 | 3,500.70 | 6,014.47 | -2,513.77 | -41.80% | 19 |
| CIN - KY | 0.00 | 0.00 | 0.00 | 1,385.64 | -1,385.64 | -100.00% | 0 |
| CIN - AZ | 27,480.95 | 0.00 | 27,480.95 | 48,793.24 | -21,312.29 | **-43.68%** | 172 |
| CIN - OH | 1,032.61 | 369.12 | 1,401.73 | 2,153.94 | -752.21 | -34.92% | 14 |
| TBJ - NY | 561.92 | 0.00 | 561.92 | 1,037.63 | -475.71 | -45.85% | 5 |
| TBJ - FL | 33,209.77 | 0.00 | 33,209.77 | 35,155.40 | -1,945.63 | -5.53% | 177 |
| TXR - TX - H | 20,817.94 | 0.00 | 20,817.94 | 24,576.68 | -3,758.74 | -15.29% | 91 |
| TXR - TX - V | 11,246.30 | 0.00 | 11,246.30 | 12,077.89 | -831.59 | -6.89% | 42 |
| TXR - AZ | 27,849.85 | 313.42 | 28,163.27 | 62,488.23 | -34,324.96 | **-54.93%** | 189 |
| STL - FL | 0.00 | 0.00 | 0.00 | 10,991.48 | -10,991.48 | -100.00% | 0 |

**Pass-through accounts** (CIN - OH, STL - MO) show 0.00 food at finance as expected (management-fee model: food and packaging COGS sit at the client, not KitchFix). Our purchasing shows zero to trace-only amounts on Food for those two (CIN - OH = 0.00, STL - MO = $79.80) which lines up with the model - the operator does not spend on-KitchFix-books food at those sites. Packaging on the two pass-through sites is small nonzero ($1,401 / $3,500) and does show a finance figure, meaning there IS a packaging trickle attributable to KitchFix at those sites. STL - FL is also a pass-through per `src/lib/accountModels.js:123` yet shows real finance food/packaging figures ($21,446 / $10,991), whereas ours shows $17,071 / $0 - the finance value there is a genuine unexplained (to me) delta, not a pass-through artefact.

### Verdict

**Directional pattern is clear and consistent** across all three tables:
- 9 of 11 accounts on Food show `ours < finance` (`-`).
- 10 of 11 accounts on Packaging show `ours < finance` (`-`).
- Only CIN - AZ Food (+1.35%) and STL - MO Food (+$79.80 on a $0 base) go the other way.

**Sign consistency is inventory-plausible.** A **decreasing** inventory position over the range (closing < opening) means finance's `usage = opening + purchases - closing` exceeds purchases; that is exactly the sign we see across nearly every account and both categories. Sites building down inventory over Q1-Q3 as season ramps is a real operational shape.

**Magnitude is where inventory alone strains as an explanation:**
- TXR - AZ Packaging -54.93%, CIN - AZ Packaging -43.68%, TBJ - NY Packaging -45.85%, TBR - FL Packaging -25.69% - inventory adjustments alone rarely account for HALF of purchases at scale over 8 periods; a 50% swing over 8 periods implies opening packaging inventory equal to roughly 8 months of purchases got consumed, or the categorisation cuts differ (e.g. supplies vs packaging split on finance side).
- CIN - KY Packaging -100% ($1,385 finance vs $0 ours) and STL - FL Packaging -100% ($10,991 finance vs $0 ours) at zero lines from our side - these are structural, not inventory. Either purchases exist under a GL not mapped to `3400.x`, or finance is booking a category ours does not see, or there is an account-mapping split.
- Food deltas are smaller and more inventory-plausible (mostly -1% to -13%; STL - FL -20% is the outlier).

**Cannot commit to "inventory alone accounts for all of this" from a discovery pass.** Both classes of thing likely live in the deltas:
1. inventory movement (opening/closing adjustments)
2. structural GL scope differences between finance's mapping and the `3200.x`/`3400.x` prefix we filter on (possible re-classification lines Sebastian posts at close; possible finance-side entries that never entered the purchases pipeline; the ex-accrual finding from the P22 arc named the same class - see `docs/handoff/PURCHASING_CC_HANDOFF_2026-08-28.md` §10)

**Actionable read**: the deltas are large enough and consistently signed enough that a food number rendered on the Overview from the Purchasing board today would tell site leaders their food is under by (on average) 5-6% and their packaging is under by (on average) 30-40% versus what finance eventually posts. That is exactly the class of untrue-statement the invariant framework is built to prevent.

## Part E - what an adjustment would need

Structure only. No build proposal.

### Inputs required to produce inventory-adjusted food/packaging cost per (account, period)

1. **Purchases in period.** Have this today via `purchasing_actuals` filtered by `source in ('billcom', 'rippling_spend')` and `gl_line_code` prefix `3200`/`3400`. Reachable from PG.
2. **Opening inventory value at period start** (per account, per category: food, packaging, supplies, snacks, beverages). Currently in Sheets `inventory_submissions` as the last submission BEFORE period start. Not reachable from PG.
3. **Closing inventory value at period end** (same shape). Currently in Sheets `inventory_submissions` as the FIRST submission AT/AFTER period end. Not reachable from PG.
4. **Adjustments/reclassifications posted at close** (Sebastian's P&L reclass rows; ex-accrual entries per PURCHASING_CC_HANDOFF §10). Not in `purchasing_actuals`; lives in the finance workbook (`Budget vs Actual (SLT) (2026) P8 (8.20.26)B.xlsx` and its per-period predecessors).
5. **Category mapping** from monthly-count categories (food/packaging/supplies/snacks/beverages) to Purchasing bucket keys (food/packaging/vehicle). The count carries `supplies` and `snacks/beverages` which Purchasing does not carry as top-level buckets; the reverse mapping needs a decision (do `supplies` count as `packaging`? do `snacks/beverages` count as `food`?).
6. **Cadence completeness signal.** Per-account, per-period boolean of "did the site actually submit a count for the period boundary needed?" If not, opening/closing values are absent and the adjustment cannot be computed for that account/period; the Overview must have a graceful "no adjusted number yet" state rather than falling back to the purchases figure and calling it food cost.

### Where each lives today

| input | location today | reachable from PG? |
|---|---|---|
| purchases in period | `purchasing_actuals` (PG) | YES |
| opening inventory | Sheets `inventory_submissions` (COLLECTION spreadsheet) | NO |
| closing inventory | Sheets `inventory_submissions` (COLLECTION spreadsheet) | NO |
| finance adjustments | `Budget vs Actual (SLT) (2026) P<N> (mm.dd.yy).xlsx` workbooks | NO |
| category mapping table | does not exist; would need to be authored | N/A |
| cadence completeness | derivable from `inventory_submissions` if it were in PG | NO (today) |

### Blockers by name

- **B1 - `inventory_submissions` is Sheets-only.** No PG mirror is populated (row count 0 as of 2026-08-29). A PG reader for opening/closing inventory cannot exist until this table is either mirrored or the flow is rebuilt Supabase-native. Dispositioned "LEAVE ON SHEETS, retire year-end" per `MIGRATION_STATUS.md` line 118-121; a PG rebuild is planned for the 2027 off-season per the brief.
- **B2 - No PG source for finance-side adjustments.** Sebastian's reclassifications live in a periodically-exported xlsx workbook. There is no ingest lane for them. The P22 reconciliation probe (`_probe_p22_reconcile.mjs` per PURCHASING handoff §4) reads the workbook manually.
- **B3 - Count coverage is thin and unmeasured.** The load-bearing count table lives in Sheets and this audit cannot query it, so no per-account cadence-achieved can be reported. The parked Smart Inventory PG count_sessions holds 5 draft rows across 2 accounts - not a proxy for real cadence.
- **B4 - Category axis mismatch.** Legacy count carries five categories; Purchasing carries three buckets. The mapping between them is not written down anywhere in the repo (grep of `docs/` returned no `INVENTORY_CATEGORY_MAP` or similar file). Any adjustment rendering needs the mapping decided and encoded.
- **B5 - No submitter role gate on `InventoryTool`.** `src/app/ops/page.js:104-106` mounts the tool for every authenticated session; account restriction is data-driven via `config.accounts`. Not a blocker for a discovery pass but names an integrity concern if the counts start driving a public number.
- **B6 - Kevin/finance basis of truth for what "food cost" means on the Overview.** The Purchasing board reports purchases; finance reports inventory-adjusted usage; both share the label "3200 Food." Before any rendering, the Overview needs a ruling on which number it shows, what the sub-line clarifies, and what happens at accounts with pass-through cost models where both numbers are structurally different.

## Completeness map (C2)

- **Part A - the inventory app as built**: **DONE**. Route/page paths cited (`src/app/ops/page.js:104-106`, `src/app/ops/components/inventory/InventoryTool.js`, `src/app/api/ops/route.js:1075-1178` and `842-867`). Sheets id + tab named. Row shape cited from `src/app/api/ops/route.js:1104-1108`. Per-category dollars (not per-item). Valuation is operator-entered. Submitter gate is authenticated session only, with data-driven account restriction.
- **Part B - coverage**: **PARTIAL / BLOCKED**. Sheets-side coverage on `inventory_submissions` (the load-bearing table) is NOT MEASURABLE from this audit; Sheets is not reachable from a PG-only READ-ONLY probe. Smart Inventory PG coverage (5 draft sessions on 2 accounts) reported for completeness.
- **Part C - reachability from Postgres**: **DONE**. 8 Smart Inventory tables enumerated with row counts. `inventory_submissions` PG mirror is 0 rows. Reachability verdict clear: legacy count is NOT reachable from PG.
- **Part D - the measured gap**: **DONE with caveat**. 3100 Labor control + 3200 Food + 3400 Packaging tables produced per account. Labor did not reconcile clean on 4 of 11 accounts per my read - reported plainly per the brief's rule.
- **Part E - what an adjustment would need**: **DONE**. Six inputs enumerated, six blockers (B1..B6) named. No fix proposals per brief.

## Acceptance echo (C4)

- **Part A - map the inventory app, file:line**: **[met-code-read]**. All claims carry `src/...:line` citations.
- **Part B - per account, how many counts + date range + cadence + last count**: **[needs-gate]**. Cannot query Sheets from this environment. Reported what PG holds; named as blocked.
- **Part C - is inventory reachable from Postgres today?**: **[met-ran]**. Answered: legacy count table is 0 rows in PG (Sheets-only); Smart Inventory PG schema is reachable but is not what operators submit against today.
- **Part D - compute Purchasing 3200 + 3400 vs finance, with 3100 as control**: **[met-ran]**. All three tables produced. Labor control did NOT reconcile clean on 4 of 11 accounts per my read (differs from brief's 10/11 claim); reported plainly. Food + Packaging deltas reported with per-account delta % and directional verdict.
- **Part E - inputs, locations, blockers for an adjustment**: **[met-code-read + met-ran]**. Six inputs, table of locations, six named blockers (B1..B6). No fixes proposed.

## Unmeasurable as written + blocked items (named, not worked around)

- **Sheets access.** `inventory_submissions` on the COLLECTION spreadsheet (id `1itJh5x1YFBdyHTBr-dyKD_r_nRBfjwIBiR_bWiOyCzQ`) is the load-bearing count store and cannot be queried from a PG-only READ-ONLY audit. Every Part B question about actual operator cadence lands here. Would require running `curl` against the intranet's own `/api/ops?action=bootstrap` or `?action=inventory-history` with a session cookie (out of scope for this audit) OR a Sheets-side probe with a service-account credential (out of scope; env-file discipline).
- **Labor reconciliation drift on 4 accounts.** My labor probe hits `labor_actuals_latest.amount + labor_salary_actuals.amount` in a `week_start <= end AND week_end >= start` window; the labor route's own response may apply an additional filter (envelope exclusions, week floor, salaried_only handling) that shifts the number for CIN - KY, TXR - AZ, STL - FL, TBR - FL. The brief said 10/11 reconcile clean; my method reproduces 7. Not fixed in this pass; the food deltas on those same 4 accounts should be treated as `needs-gate` on scope rather than `inventory-shaped` until the labor delta is understood.
- **Finance workbook not parsed.** Finance figures used are the ones the brief supplied verbatim from `Budget vs Actual (SLT) (2026) P8 (8.20.26)B.xlsx`; the workbook itself was not opened by this probe. If any of the finance figures are misquoted in the brief, my deltas propagate that.
- **Individual account explanation not attempted** (per brief). "Are the food deltas inventory-shaped?" answered directionally + magnitudinally in Part D verdict. Per-account causes not analysed.
- **No adjustment proposed** (per brief). Part E is structure only.

## Reproduction

Probes are UNTRACKED under `scripts/probes/`:
- `scripts/probes/_probe_inventory_audit_partC.mjs` - schema discovery
- `scripts/probes/_probe_inventory_audit_partBC_coverage.mjs` - count_sessions per-account coverage
- `scripts/probes/_probe_inventory_audit_partD.mjs` - labor + food + packaging vs finance

Run each via `node --env-file=.env.local scripts/probes/_probe_inventory_audit_part<X>.mjs`.
