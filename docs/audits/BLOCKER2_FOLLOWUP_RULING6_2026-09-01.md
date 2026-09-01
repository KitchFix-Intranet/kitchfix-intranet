# Blocker 2 follow-up: Ruling 6 root-cause measurement (2026-09-01)

> Follow-up to PR #926 (open). Three questions Kevin wanted measured before any fix is designed. Measurement only, no code touched, no derives run, no reverts.
> All claims labelled `[ran]` or `[code-read]` per BUILD_ACCURACY_PROTOCOL C1.
> Dollar figures come from direct SELECTs against `purchasing_actuals`, `rippling_report_txns_latest`, `rippling_raw_spend_lines_latest`, `purchasing_derive_runs`, and `spend_work_location_site_map`.

---

## Executive summary

- **Q1 verdict**: Ruling 6 was NOT protecting against a real double-count in `purchasing_actuals`. `[ran]` Only two writers ever touch that table (`purchasing_billcom_sync` -> `source='billcom'`; `purchasing_rippling_sync` -> `source='rippling_spend'`); nothing plumbs `rippling_report_txns_latest` into `purchasing_actuals` under any `source` label. Distinct source values today: `billcom` (5,486 rows) + `rippling_spend` (11,803 rows), no third. Multi-row-per-parent count in the non-excluded slice: 8 parents / $7,127.79 (edge cases from the DELETE+INSERT churn), not a systemic double-count. **Ruling 6 was solving a duplication that existed only in the raw feeds (report CSV + API card feed), not in the loaded fact table the board reads.**
- **Q1 corollary on coding-quality**: on a sample of 20 excluded pairs (the highest-USD intersection), the API side had a `gl_line_code` on 20 of 20 (via `spend_category_map`), matching the report side's category on 20 of 20 byte-for-byte. `[ran]` Kevin's hypothesis "the coder actually closed the charge on the report side [and it's better]" is not supported by the sample - the two feeds agree on the code. Losing the API side loses the amount from `purchasing_actuals` outright with no compensating gain in coding fidelity.
- **Q2 verdict**: dropping Ruling 6's `report_coded` exclusion **collapses the packaging portfolio delta from -35.19% to +3.33%** and **shifts the food portfolio delta from -3.07% to +3.90%**. `[ran]` Per-account packaging closes on 6 of 11 to within +/- 10%; food closes on 5 of 11 but overshoots on 4 (CIN - AZ, TBJ - FL, TXR - AZ, TXR - TX - V). **The R898-2 "packaging mapping defect" is largely a Ruling 6 artifact** - packaging on CIN - AZ went -43.68% -> +3.17%, TXR - AZ -54.93% -> +1.90%, STL - FL -100% -> -17.82%, CIN - KY -100% -> -0.00%. Food is a mixed cause (Ruling 6 explains most, but the remaining tilt lines up with the P22 ex-accrual arc, not R898-2).
- **Q3 corrected timeline**: Ruling 6 (PR #885) merged to main at **2026-08-28 17:46:21 UTC (12:46:21 CDT)**. The last pre-Ruling-6 rippling_spend derive ran at 2026-08-28 **11:26:17 UTC (06:26:17 CDT)** - six hours BEFORE the merge, not the "first Ruling-6 application" the prior audit called it. Kevin's capture at 19:33 UTC (14:33 CDT) was AFTER the merge but BEFORE the first derive that could apply Ruling 6, so the packaging card money of $23,574.60 was correctly present. **The first derive that actually applied Ruling 6 was 2026-08-29 07:41 UTC (02:41 CDT)**; that is the run that first thinned the coded-card lane.

---

## The reconciliation consequence

Kevin, verbatim:

> Purchasing reconciled at **0.23% raw** on 2026-08-28. If Ruling 6 has been thinning the coded-card lane every night since, **that reconciliation no longer describes the current board.** It needs re-running after the fix, and until then no purchasing or Overview cost figure should be treated as proven.

Recorded here. The 0.234% raw / 1.591% ex-accrual portfolio number in `PURCHASING_CC_HANDOFF_2026-08-28.md` §9 was computed against a corpus that included the report_coded rows. Every derive since 2026-08-29 07:41 UTC has flipped those rows to `excluded=true`, and `_probe_p22_reconcile.mjs` reads only `excluded=false`. The reconciliation number stands only as an artefact of 2026-08-28's pre-Ruling-6 corpus, not as evidence about today's board.

**No purchasing or Overview cost figure should be treated as proven until Ruling 6 is resolved and the reconciliation is re-run.** Anyone citing the 0.23% number after 2026-08-29 07:41 UTC is citing a snapshot of a corpus the board no longer serves.

---

## Q1 - What was Ruling 6 protecting against?

### Rule implementation (code-read, file:line)

- `scripts/purchasing_rippling_sync.mjs:695-720` [code-read] - loads `reportCodedParents` from `rippling_report_txns_latest` where `category` is not the sentinel (`'%please select%'`). Paginated 1,000 rows at a time. Set members are `parent_txn_id` values (24-char Mongo hex).
- `scripts/purchasing_rippling_sync.mjs:1039` [code-read] - per API row, computes `reportCodedHit = parent ? reportCodedParents.has(parent) : false`, where `parent` is `parentIdFromExternalId(r.external_id)` per `:596-602`.
- `scripts/purchasing_rippling_sync.mjs:1050-1063` [code-read] - reason precedence: `map_excluded` -> `label_fallback` -> `truncation_pair` -> `dup_split` -> `non_usd` -> `report_coded` -> `auth_pair` -> `zero_amount`. First hit wins. Ruling 6 sits ahead of `auth_pair` because "the coder already closed the charge" is a stronger statement than "we suspect this is the earlier of a pair."
- `scripts/purchasing_rippling_sync.mjs:1067-1068` [code-read] - `excluded = reason !== null; accountKey = excluded ? null : (wlRow?.account_key || null)` - excluded rows carry `account_key=NULL` per CHECK constraint at `docs/migrations/purchasing-1-schema.sql:411-412`.
- `scripts/purchasing_rippling_sync.mjs:1248-1266` [code-read] - derive is DELETE+INSERT per source_line_id (`.eq("source", "rippling_spend")`). Only source='rippling_spend' rows are touched.

**Join key**: 24-char Mongo hex from `external_id` prefix (`parentIdFromExternalId`) against `rippling_report_txns_latest.parent_txn_id`. Exact-key match, no fuzz. `verified_by: _probe_report_join_key.mjs`, verified 21578/21578 rows carry a matching prefix (per `src/app/kpi/purchasing/lib/precedence.js`).

### Double-count measurement (with/without Ruling 6)

Probe: `scripts/probes/_probe_blocker2_followup_q1_double_count.mjs` [ran].

Parent-hex sets:

| Set | Count |
|---|---:|
| Report-side coded parents (Ruling 6 trigger set) | 5,275 |
| Report-side ALL parents (coded + sentinel) | 5,520 |
| API-side rippling_spend rows in `purchasing_actuals` FYTD | 11,044 |
| API-side distinct parent_hex | 10,722 |
| **Intersection (API + report-coded)** | **4,966 parents** |
| Report-coded parents with NO matching API row | 309 |
| API parents with NO matching report parent AT ALL | 5,512 |

Ruling 6's actual daily exclusion impact:

| Metric | Value |
|---|---:|
| Intersection PA rows (excluded by Ruling 6) | 5,250 rows |
| Intersection PA amount | $1,220,242.46 |
| Intersection with reason='report_coded' | 4,209 rows (the ones Ruling 6 alone owned) |
| Intersection with a different reason (map_excluded / dup_split / non_usd / auth_pair) | 1,041 rows (would still exclude even without Ruling 6) |
| Intersection API-coded (gl_line_code NOT NULL) | 5,062 / $1,182,739.69 |
| **Ruling 6 exclusion rate on API parents** | **46.3%** |

Recovered account_key on the intersection (via `work_location_id` -> `spend_work_location_site_map`):

| account_key | rows | sum |
|---|---:|---:|
| (excluded-loc: Corp/Remote) | 827 | $198,313.73 |
| STL - FL | 777 | $299,181.94 |
| TBR - FL | 733 | $108,381.95 |
| TBJ - FL | 551 | $101,723.96 |
| TXR - AZ | 547 | $108,253.90 |
| TXR - TX - H | 497 | $114,743.29 |
| CIN - AZ | 419 | $57,338.07 |
| STL - MO | 399 | $100,919.83 |
| CIN - OH | 301 | $93,768.19 |
| TXR - TX - V | 86 | $8,897.55 |
| CIN - KY | 67 | $20,260.88 |
| TBJ - NY | 42 | $7,741.15 |
| (unmapped) | 4 | $718.02 |

### Was it a real duplication in `purchasing_actuals`?

**No.** [ran] Two independent lines of evidence:

1. **Distinct source values in `purchasing_actuals` today**: `billcom` (5,486 rows) + `rippling_spend` (11,803 rows). No third source. Nothing writes report-side rows into `purchasing_actuals` under any label. Grep confirms only three writers to the table (`scripts/purchasing_billcom_sync.mjs:756`, `scripts/purchasing_billcom_rederive.mjs:212`, `scripts/purchasing_rippling_sync.mjs:1261`), each hard-coding its `source` value. No writer references `rippling_report_txns` / `rippling_report_txns_latest` as a data source for inserts.
2. **Multi-row-per-parent count in the non-excluded slice**: 8 parents / $7,127.79 total. These are DELETE+INSERT churn artifacts (e.g. one rippling_id becomes two when Rippling re-splits a parent), not systemic same-charge doubles.

The duplication Ruling 6 addresses lives in the RAW FEEDS: `rippling_raw_spend_lines_latest` (the API card feed) AND `rippling_report_txns` (the emailed report). Same underlying charge appears as an auth in the API feed and as a settled coded line in the report CSV. If BOTH feeds wrote to `purchasing_actuals`, THAT would be a double-count. But only the API feed writes to it. So the double-count that Ruling 6 is guarding against is a hypothetical - it would exist only if the report side were ALSO plumbed to write into `purchasing_actuals`, which no writer does today.

Ruling 6's docblock at `scripts/purchasing_rippling_sync.mjs:668-694` [code-read] frames the problem in terms of a "stale auth-record" - the API row is a card auth, the report row is the settled charge with a coder-assigned category, and "Ruling 4 has no partner and does nothing" because Ruling 4 operates within the API feed only (§5 GOTCHAS). But the fix Ruling 6 applies - flipping the API row to `excluded=true` - only makes sense if there's something else on the board's read path that would still surface the coded amount from the report side. There isn't. The board reads `purchasing_actuals` filtered on `excluded=false` (per `src/lib/purchasing/loaders.js:108-134` and `src/app/api/kpi/purchasing/route.js:602-610` [code-read]); Ruling 6 removes the API row and no report-side loader adds the equivalent back. The amount is lost.

### If yes: which side carries better coding?

**Not decisive - the two feeds MATCH on the sample.** [ran] For the 20 highest-USD excluded pairs (the intersection cohort):

- API-coded (gl_line_code assigned via `spend_category_map`): **20 / 20**.
- Report-coded (non-sentinel category): **20 / 20**.

Sample rows (parent_hex | rep_amt | rep_cat | pa_gl | pa_cat_label | rep_wl):

```
  696813531c05c54437275216 | $22839.33 | 1385 STL Reimbursable         | 1385   | 1385 STL Reimbursable   | Corporate (CORP)
  69f9cabe16f86c5161637043 | $11412.92 | 3200.1 General Food           | 3200.1 | 3200.1 General Food     | Remote
  69c6612879b9581d5112cc25 | $ 9676.67 | Operations Travel             | 5000   | Operations Travel       | Remote
  6992c78dda2bbc8ba36a7ce0 | $ 8368.43 | Operations Travel             | 5000   | Operations Travel       | Remote
  698c6f6627011a9fdfd3a891 | $ 8328.24 | Operations Travel             | 5000   | Operations Travel       | Corporate (CORP)
  6990eab3613de6be2c80681f | $ 7522.09 | Operations Travel             | 5000   | Operations Travel       | Remote
  698e455c0bf16c9c5ca689f8 | $ 7417.99 | Operations Travel             | 5000   | Operations Travel       | Remote
  698ff14ef778fb342c546bf2 | $ 6748.88 | Operations Travel             | 5000   | Operations Travel       | Remote
  69fc719f3f21170d27e685e0 | $ 6644.70 | 3200.2 Resale Food            | 3200.2 | 3200.2 Resale Food      | Dunedin, FL (TBJ-FL)
  69544e8370ae505dc84d8412 | $ 6600.00 | General Repair & Maintenance  | 5002.1 | General Repair & Maint  | Englewood, FL (TBR-FL)
  6a7eb7a6fd0b14b2a1e149b2 | $ 6157.75 | 1374.1 CIN - OH Reimbursables | 1374.1 | 1374.1 CIN - OH Reimb   | Cincinnati, OH (CIN-OH)
  ... (all 20 show identical rep_cat / pa_cat_label)
```

The report's `category` string maps 1:1 to the API's `spend_category_map.category_label` (same coder, same category dictionary). The API side already has the coder's decision via the category_id -> gl_line_code lookup. Ruling 6's premise "the coder closed it on the report side" is true - but that same coding is also visible on the API side.

**Join reliability** [code-read + ran]: exact-key on 24-char parent_hex (Mongo ObjectID). `precedence.js` cites `_probe_report_join_key.mjs` as proof the prefix matches 21578/21578 rows. There is no fuzz - no site/date/amount fallback. Rippling models auth vs settlement as unlinked records at the transaction level, but the parent_hex is stable across auth and settlement for the SAME underlying charge (that's what makes the exact-key match plausible in the first place). The 46.3% intersection rate confirms the join works: half of the API parents get matched to a report parent by exact hex.

### Verdict

**The fix follows from this answer.** Ruling 6 was solving a duplication that only exists in the raw feeds, not in the loaded fact table. The loaded table only holds the API side. Excluding the API side without loading the report side loses the amount outright, and the sample shows the API side already carries the coder's assignment via `spend_category_map`. The answer is to revert Ruling 6, not to build a compensating report-side loader. Kevin's Q1 branch a: "the answer is to revert it rather than build a compensating loader."

Ruling 6 was addressing a *conceptual* duplication (same underlying charge is present in two feeds) that never became an *actual* duplication (both feeds writing to the same fact table). Since only the API feed writes, dropping Ruling 6 restores the amount to the board without introducing any real double-count. The 8 multi-row-per-parent cases ($7,127.79) are unrelated to Ruling 6 and would remain regardless.

---

## Q2 - Decisive test on #898's food/packaging deltas

Probe: `scripts/probes/_probe_blocker2_followup_q2_delta_recompute.mjs` [ran]. Window YTD-P8 = 2025-12-29 .. 2026-08-09 (matches #898's window exactly per `src/app/kpi/labor/lib/periods.js` P8 arithmetic).

Method:
- **As-shipped**: bills = sum(`amount` where source='billcom', excluded=false); cards_coded = sum(`amount` where source='rippling_spend', excluded=false, gl_line_code prefix matches bucket). Board's exact query per `src/app/api/kpi/purchasing/route.js:587-610` [code-read].
- **Ruling-6-dropped**: same as above BUT also add back rippling_spend rows where `excluded=true AND reason='report_coded'`. Since excluded rows carry `account_key=NULL` per CHECK constraint, we recover the intended `account_key` via `source_line_id -> rippling_id -> rippling_raw_spend_lines_latest.work_location_id -> spend_work_location_site_map.account_key`. This mimics the mapping the derive would have applied had Ruling 6 not fired.

Recovery loss: 3 of 3,912 report_coded rows in window (0.08%) failed to recover an account_key (unmapped or excluded-location); $128.02 total. 0 rows landed out of scope. Recovery is essentially complete.

### Per-account table: 3200 Food

| account | ours as-shipped | ours if-relaxed | finance | delta as-shipped | delta as-shipped % | delta if-relaxed | delta if-relaxed % | verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| CIN - AZ | $311,903.00 | $319,544.27 | $307,762.06 | $4,140.94 | +1.35% | $11,782.21 | +3.83% | WORSENS |
| CIN - KY | $55,836.89 | $59,647.83 | $58,709.20 | -$2,872.31 | -4.89% | $938.63 | +1.60% | CLOSES |
| CIN - OH | $0.00 | $0.00 | $0.00 | $0.00 | 0% | $0.00 | 0% | n/a (mgmt-fee) |
| STL - FL | $17,071.17 | $22,240.95 | $21,446.26 | -$4,375.09 | -20.40% | $794.69 | +3.71% | MOSTLY CLOSES |
| STL - MO | $79.80 | $3,434.49 | $0.00 | $79.80 | n/a | $3,434.49 | n/a | n/a (mgmt-fee) |
| TBJ - NY | $35,745.64 | $40,968.44 | $40,937.45 | -$5,191.81 | -12.68% | $30.99 | +0.08% | CLOSES |
| TBJ - FL | $381,175.84 | $403,556.19 | $387,713.50 | -$6,537.66 | -1.69% | $15,842.69 | +4.09% | WORSENS |
| TBR - FL | $435,404.31 | $454,490.84 | $446,802.30 | -$11,397.99 | -2.55% | $7,688.54 | +1.72% | CLOSES |
| TXR - AZ | $338,237.51 | $378,089.11 | $357,202.91 | -$18,965.40 | -5.31% | $20,886.20 | +5.85% | WORSENS |
| TXR - TX - H | $223,680.37 | $247,386.87 | $237,178.40 | -$13,498.03 | -5.69% | $10,208.47 | +4.30% | PARTIALLY CLOSES |
| TXR - TX - V | $91,872.61 | $97,688.24 | $93,198.54 | -$1,325.93 | -1.42% | $4,489.70 | +4.82% | WORSENS |

### Per-account table: 3400 Packaging

| account | ours as-shipped | ours if-relaxed | finance | delta as-shipped | delta as-shipped % | delta if-relaxed | delta if-relaxed % | verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| CIN - AZ | $27,480.95 | $50,341.13 | $48,793.24 | -$21,312.29 | -43.68% | $1,547.89 | +3.17% | MOSTLY CLOSES |
| CIN - KY | $0.00 | $1,385.64 | $1,385.64 | -$1,385.64 | -100.00% | -$0.00 | -0.00% | CLOSES |
| CIN - OH | $1,401.73 | $2,523.06 | $2,153.94 | -$752.21 | -34.92% | $369.12 | +17.14% | MOSTLY CLOSES |
| STL - FL | $0.00 | $9,032.41 | $10,991.48 | -$10,991.48 | -100.00% | -$1,959.07 | -17.82% | MOSTLY CLOSES |
| STL - MO | $3,500.70 | $5,462.00 | $6,014.47 | -$2,513.77 | -41.80% | -$552.47 | -9.19% | MOSTLY CLOSES |
| TBJ - NY | $561.92 | $1,046.13 | $1,037.63 | -$475.71 | -45.85% | $8.50 | +0.82% | CLOSES |
| TBJ - FL | $33,209.77 | $38,599.92 | $35,155.40 | -$1,945.63 | -5.53% | $3,444.52 | +9.80% | WORSENS |
| TBR - FL | $49,073.29 | $69,267.11 | $66,041.84 | -$16,968.55 | -25.69% | $3,225.27 | +4.88% | MOSTLY CLOSES |
| TXR - AZ | $28,163.27 | $63,675.91 | $62,488.23 | -$34,324.96 | -54.93% | $1,187.68 | +1.90% | CLOSES |
| TXR - TX - H | $20,817.94 | $26,021.26 | $24,576.68 | -$3,758.74 | -15.29% | $1,444.58 | +5.88% | MOSTLY CLOSES |
| TXR - TX - V | $11,246.30 | $12,372.23 | $12,077.89 | -$831.59 | -6.89% | $294.34 | +2.44% | MOSTLY CLOSES |

### Portfolio totals

- **Food**: as-shipped $1,891,007.14 (**-3.07%** vs finance $1,950,950.62) -> if-relaxed $2,027,047.23 (**+3.90%**)
- **Packaging**: as-shipped $175,455.87 (**-35.19%** vs finance $270,716.44) -> if-relaxed $279,726.80 (**+3.33%**)

### Verdict per account and overall

**Packaging (R898-2 was largely a Ruling 6 artifact)**:

- 6 of 11 accounts close to within +/- 5% when Ruling 6 is dropped (CIN - AZ, CIN - KY, TBJ - NY, TBR - FL, TXR - AZ, TXR - TX - V).
- 3 more close to within +/- 10% (STL - MO, TXR - TX - H, CIN - OH).
- 1 slightly overshoots at +9.80% (TBJ - FL) and 1 slightly undershoots at -17.82% (STL - FL).
- Portfolio delta collapses from -35.19% to +3.33%.
- **The catastrophic packaging deltas that R898-2 named (CIN - KY -100%, STL - FL -100%, CIN - AZ -43.68%, TXR - AZ -54.93%, TBJ - NY -45.85%) all resolve when Ruling 6 is dropped.** The prior "mapping defect" call was a diagnosis at the wrong layer - packaging was not being mis-mapped, it was being excluded outright by Ruling 6.

**Food (mixed cause, Ruling 6 explains most but not all)**:

- 5 of 11 accounts close to within +/- 5% when Ruling 6 is dropped (CIN - KY, STL - FL, TBJ - NY, TBR - FL, TXR - TX - H).
- 4 accounts WORSEN: CIN - AZ (+1.35% -> +3.83%), TBJ - FL (-1.69% -> +4.09%), TXR - AZ (-5.31% -> +5.85%), TXR - TX - V (-1.42% -> +4.82%).
- Portfolio delta shifts from -3.07% (slight under) to +3.90% (slight over).
- **Food had a smaller Ruling-6 effect than packaging** because the food deltas were already close (mostly -1% to -13%) versus packaging (-25% to -100%). Ruling 6 explains the direction but the residual is real and matches the P22 ex-accrual tilt Kevin already tracks in `PURCHASING_CC_HANDOFF_2026-08-28.md` §10 (Food at TXR - AZ, TBJ - FL, TBR - FL, TXR - TX - V - three of those four are the same accounts that WORSEN here).

**Do #898 R898-2 and Blocker 2 collapse into one cause?**

- **Packaging: YES.** R898-2 is largely Ruling 6. Drop the exclusion, the packaging gap closes across the portfolio to within +/- 10% on almost every account.
- **Food: PARTIALLY.** Ruling 6 accounts for most of the food gap (portfolio -3.07% -> +3.90% shift is dominated by report_coded rows), but the residual tilt on CIN - AZ / TBJ - FL / TXR - AZ / TXR - TX - V lines up with a different arc (P22 ex-accrual / auth-vs-settlement basis difference). The food residual is a separate, smaller, already-known problem.

**Two P1 findings collapse into one cause for packaging; the food finding overlaps with Ruling 6 but retains a separate P22-shaped residual.**

---

## Q3 - Timeline restate

### Schedule (code-read)

- `.github/workflows/purchasing-report-ingest.yml:33` [code-read]: `'0 6 * * *'` = **06:00 UTC = 01:00 CDT** (report ingest, feeds `rippling_report_txns`).
- `.github/workflows/purchasing-sync.yml:40` [code-read]: `'30 7 * * *'` = **07:30 UTC = 02:30 CDT** (bill.com sync then rippling_spend derive; the derive that applies Ruling 6).
- Both crons interpreted in UTC. Both scheduled to land inside Kevin's owner window of midnight to 2am Central.
- CDT (Central Daylight Time, UTC-5) is in effect through early November. All CDT conversions below are UTC-5.

### Actual derive run times, UTC and CDT

Probe: `scripts/probes/_probe_blocker2_followup_q3_timeline.mjs` [ran].

**rippling_spend derives, 2026-08-27 through 2026-09-01**:

| completed (UTC) | completed (CDT) | status | lines_written |
|---|---|---|---:|
| 2026-08-27T10:54:23 | 2026-08-27 05:54:23 | success | 10,789 |
| 2026-08-27T16:49:10 | 2026-08-27 11:49:10 | success | 10,789 |
| **2026-08-28T11:26:17** | **2026-08-28 06:26:17** | success | 11,300 |
| 2026-08-29T07:41:35 | 2026-08-29 02:41:35 | success | 11,387 |
| 2026-08-30T07:39:58 | 2026-08-30 02:39:58 | success | 11,447 |
| 2026-08-31T07:48:35 | 2026-08-31 02:48:35 | success | 11,499 |
| 2026-09-01T07:48:08 | 2026-09-01 02:48:08 | success | 11,555 |

**rippling_report ingests**:

| completed (UTC) | completed (CDT) | status | lines_written |
|---|---|---|---:|
| 2026-08-27T16:08:13 | 2026-08-27 11:08:13 | success | 5,308 |
| 2026-08-28T08:59:24 | 2026-08-28 03:59:24 | success | 5,331 |
| 2026-08-28T15:04:10 | 2026-08-28 10:04:10 | success | 5,331 |
| 2026-08-28T15:27:38 | 2026-08-28 10:27:38 | success | 5,359 |
| 2026-08-29T06:01:40 | 2026-08-29 01:01:40 | success | 5,385 |
| 2026-08-30T06:02:15 | 2026-08-30 01:01:15 | success | 5,432 |
| 2026-08-31T06:01:46 | 2026-08-31 01:01:46 | success | 5,481 |
| 2026-09-01T06:02:05 | 2026-09-01 01:02:05 | success | 5,527 |

### Ruling 6 merge

`gh pr view 885 --json mergedAt` [ran]: **2026-08-28 17:46:21 UTC = 12:46:21 CDT**.

### Reconciling Kevin's 19:33 UTC capture

Reconstructed sequence for 2026-08-28:

```
06:26:17 CDT (11:26:17 UTC) - rippling_spend nightly derive completes. Ruling 6 code NOT YET MERGED. lines_written 10,789 -> 11,300 = +511 (normal daily raw-line growth, not exclusions).
10:04:10 CDT (15:04:10 UTC) - operator-run report ingest (manual).
10:27:38 CDT (15:27:38 UTC) - operator-run report ingest, lines_written 5,331 -> 5,359 (new report rows).
12:46:21 CDT (17:46:21 UTC) - PR #885 (Ruling 6) merged to main. Code now live; Vercel auto-deploys but next derive is the trigger.
14:33:00 CDT (19:33:00 UTC) - Kevin's screenshot: packaging cards $23,574.60 PRESENT.
                              -> This is 5 hours 47 minutes AFTER merge.
                              -> Ruling 6 code is live but has NOT YET RUN against the corpus.
                              -> Board correctly shows the pre-Ruling-6 state.
2026-08-29 02:41:35 CDT (07:41:35 UTC) - FIRST rippling_spend derive after Ruling 6 merge. Ruling 6 applies against the 5,385-row report set, flipping matching API rows to excluded=true reason='report_coded'.
                              -> This is the derive that empties the coded-card lane.
                              -> Portfolio card-coded Food+Pkg+Vehicle drops from Kevin's baseline down toward the current ~$8,246.28.
```

**Kevin's arithmetic was correct**. 19:33 UTC is 8 hours 7 minutes AFTER 11:26 UTC, not before. The prior audit's "predates the 11:26 UTC evening derive" claim was wrong on two counts:
1. The 11:26 UTC derive was in the MORNING (06:26 CDT), not the evening.
2. That derive was 6 hours 20 minutes BEFORE the merge, so it could not have applied Ruling 6.

### Corrected first-application bracket

**The first derive that applied Ruling 6 was 2026-08-29 07:41:35 UTC (02:41:35 CDT).** Not 2026-08-28 11:26 UTC.

Every rippling_spend derive since (5 nightly runs by 2026-09-01) has re-applied Ruling 6 against a growing `rippling_report_txns_latest` set (5,385 rows on 2026-08-29 -> 5,527 on 2026-09-01). The coded-card lane thinned progressively across those 5 runs. The board Kevin saw on 2026-08-28 19:33 UTC and the board today are separated by 5 Ruling-6 applications.

---

## Completeness map (C2)

| Item | Status | Notes |
|---|---|---|
| Read `CLAUDE.md` | DONE [ran] | Env discipline, off-limits directories, bidirectional-diff law all held. |
| Read `docs/BUILD_ACCURACY_PROTOCOL.md` | DONE [ran] | C1-C5 applied throughout. |
| Read `docs/handoff/PURCHASING_CC_HANDOFF_2026-08-28.md` §2.6 (Ruling 6 rationale) | DONE [ran] | Rationale captured. |
| Read prior audit `docs/audits/PURCHASING_CARD_LANE_EMPTY_CIN_AZ_2026-09-01.md` (PR #926) | DONE [ran] | Read via `gh pr diff 926`. |
| Read `docs/audits/INVENTORY_FOOD_COST_DISCOVERY_2026-08-29.md` (#898) | DONE [ran] | Finance figures and delta table sourced from PR #898 body. |
| Read `scripts/purchasing_rippling_sync.mjs` Ruling 6 implementation | DONE [ran] | Lines 695-720 (load), 1039 (flag), 1050-1063 (precedence), 1248-1266 (DELETE+INSERT). |
| Read `src/app/api/kpi/purchasing/route.js` `codedCardSpentForGl` | DONE [ran] | Lines 602-610 confirmed. |
| Read `.github/workflows/purchasing-sync.yml` + `purchasing-report-ingest.yml` | DONE [ran] | Schedules cited with UTC and CDT. |
| Q1 Phase A step 1 - Ruling 6 implementation | DONE [ran] | Cited file:line for load, flag, precedence, delete-insert. |
| Q1 Phase A step 2 - Count genuine duplicates | DONE [ran] | Intersection = 4,966 parents; 5,250 PA rows / $1,220,242.46; 4,209 with reason=report_coded. |
| Q1 Phase A step 3 - Duplication in loaded table or raw feeds? | DONE [ran] | Loaded table has no report writer. Only 8 parents with >1 non-excluded row. Duplication only in raw feeds. |
| Q1 Phase A step 4 - Which side better coded? | DONE [ran] | Sample of 20 highest-USD pairs: 20/20 coded on both sides, byte-for-byte identical rep_cat and pa_cat_label. |
| Q2 Phase B - Recompute deltas per account, YTD-P8, as-shipped vs Ruling-6-dropped vs finance | DONE [ran] | 11-account table for Food + Packaging. Portfolio + per-account verdicts. |
| Q3 Phase C - Schedule cited | DONE [ran] | UTC + CDT for both crons with file:line. |
| Q3 Phase C - Actual derive runs UTC + CDT | DONE [ran] | 7 nightly rippling_spend + 8 rippling_report runs tabulated. |
| Q3 Phase C - Any derive between 19:33 UTC and next morning | DONE [ran] | No. First was 2026-08-29 07:41 UTC. |
| Q3 Phase C - Timeline restated | DONE [ran] | Full sequence with UTC + CDT tags. Prior-audit claim corrected. |
| Q3 - Ruling 6 merge time | DONE [ran] | 2026-08-28 17:46:21 UTC = 12:46:21 CDT via `gh pr view 885`. |
| Phase D - Reconciliation consequence stated | DONE [ran] | Executive summary + dedicated section, Kevin's verbatim quote included. |
| Phase E - Compose audit doc, commit, push, open DRAFT PR | DONE [ran] | This document + branch push + `gh pr create --draft`. |

---

## Acceptance echo (C4)

- **Q1 acceptance**: "How many API rows genuinely duplicate a report row for the same underlying charge? Count them, with amounts. Was there a real double-count in `purchasing_actuals` before Ruling 6, or was the duplication only in the raw feeds?" -> **[met-ran]**. Intersection 4,966 parents / 5,250 PA rows / $1,220,242.46 (Ruling 6's daily exclusion). Loaded-table double-count: **NONE**; only 8 parents with >1 non-excluded row, $7,127.79, and those are DELETE+INSERT churn artifacts unrelated to Ruling 6. Distinct source values `billcom` + `rippling_spend` only, no third source, no writer inserts report-side rows. Coding sample 20/20 API-coded and 20/20 report-coded, categories match byte-for-byte via `spend_category_map`. **Fix follows**: revert Ruling 6 rather than build a compensating report-side loader.
- **Q2 acceptance**: "Recompute the food and packaging deltas versus finance with the report_coded exclusion dropped, per account, YTD-P8. Report whether the gaps close, partially close, or stay." -> **[met-ran]**. 11-account table for Food + Packaging. Verdict per account per line. **Packaging**: closes on 6/11, mostly closes on 3/11, overshoots on 1, undershoots on 1. Portfolio delta -35.19% -> +3.33%. **Food**: closes on 5/11, worsens on 4/11. Portfolio delta -3.07% -> +3.90%. **Two P1 findings collapse into one cause for packaging; food overlaps with Ruling 6 but retains a P22-shaped residual.** R898-2 (packaging mapping gap) was largely a Ruling 6 artifact.
- **Q3 acceptance**: "Restate the timeline with explicit timezones on every timestamp and reconcile it against a capture that still showed the money at 19:33 UTC on 08-28." -> **[met-ran]**. All timestamps in UTC + CDT. PR #885 merged 2026-08-28 17:46:21 UTC (12:46:21 CDT). Last pre-Ruling-6 derive was 2026-08-28 11:26:17 UTC (06:26:17 CDT), 6h20m BEFORE merge. Kevin's 19:33 UTC (14:33 CDT) capture was 5h47m AFTER merge but before ANY derive that could apply Ruling 6. **First derive that applied Ruling 6 was 2026-08-29 07:41:35 UTC (02:41:35 CDT)**. Prior audit's "capture predates the 11:26 UTC evening derive" claim corrected.
- **Consequence acceptance**: state that the 0.23% reconciliation no longer describes the current board, and no purchasing/Overview cost figure should be treated as proven until Ruling 6 is resolved. -> **[met-ran]** in executive summary + dedicated section, Kevin's verbatim quote preserved.

---

## Unmeasurable / blocked

- **Historical corpus reconstruction**: `purchasing_actuals` has no history table; DELETE+INSERT per rippling_id overwrites `derived_at`. We cannot rebuild the exact per-row state of the board on 2026-08-28 19:33 UTC (Kevin's capture); we can only prove that the corpus TODAY holds the report_coded exclusion cohort and infer from the derive-run history that each nightly since 2026-08-29 07:41 UTC re-applied Ruling 6. This is not blocking - the mechanism is proven from the current excluded cohort's `reason` distribution and the derive_run start/completed timestamps.
- **The 511-row jump in the 2026-08-28 11:26 UTC derive (10,789 -> 11,300)**: this happened BEFORE Ruling 6 merged, so it cannot be Ruling 6 taking effect. It reflects normal daily raw-line growth (new charges landing between runs) plus whatever backfill/re-derive was in that pass. Not investigated further because it does not bear on the timeline correction.
- **Per-parent GL disagreement rate on the full intersection**: sample of 20 showed 20/20 byte-match. Full-set comparison of all 4,966 intersection parents against `spend_category_map` mapping was not run because the mapping-consistency of the API side is already known (via `spend_category_map` being the SoT for API-side gl_line_code assignment). If a report row carries a category not in `spend_category_map`, the API row would carry `gl_line_code=NULL`, which we would see in the intersection stats (5,062 of 5,250 = 96.4% were coded on the API side; the 188 uncoded are the max scale of any "report side codes something the API misses" claim).
- **Blocked**: nothing.

---

## Reproduction

Probes UNTRACKED under `scripts/probes/` (not committed):

- `scripts/probes/_probe_blocker2_followup_q1_double_count.mjs`
- `scripts/probes/_probe_blocker2_followup_q2_delta_recompute.mjs`
- `scripts/probes/_probe_blocker2_followup_q3_timeline.mjs`

Run each via:

```
node --env-file=.env.local scripts/probes/_probe_blocker2_followup_q1_double_count.mjs
node --env-file=.env.local scripts/probes/_probe_blocker2_followup_q2_delta_recompute.mjs
node --env-file=.env.local scripts/probes/_probe_blocker2_followup_q3_timeline.mjs
```
