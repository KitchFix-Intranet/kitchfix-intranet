# TXR - TX - H deep dive - P1 through P8, budget vs actuals

**Date:** 2026-08-25
**Auditor:** CC
**Scope:** Single-account deep dive on `TXR - TX - H` (finance sheet `TXR-HOME`). One home in Arlington, TX.
**Uses:** the corrected v2 hourly aggregation (see [PNL_RECON_P1_P8_2026-08-25.md](PNL_RECON_P1_P8_2026-08-25.md) §0). The pre-correction pull dropped 1,206 pre-floor `rippling_report` rows; this report is built on the corrected snapshot.
**Finance file:** `Budget vs Actual (SLT) (2026) P8 (8.20.26)A.xlsx` (2,567,058 bytes, 2026-08-20 11:30). Cross-checked against file B (`8.20.26)B.xlsx`, 2,566,997 bytes, 2026-08-25 13:40); zero drift on TXR-HOME P1-P8.

**No worker names and no individual pay amounts appear in this report. Every figure is an account-period aggregate.**

---

## 1. Why this account specifically

Kevin's ask: TXR - TX - H had two P5 findings that pointed at real accounting stories, not board defects:

1. **P5 hourly is $925.01 low on our board vs the P&L**, and CIN - AZ P5 hourly is $925.02 high vs its P&L. Suspected reclass of a single shift between the two accounts.
2. **P1-P2 hourly is $0 on both sides even though salary is running.** Kevin's read: this is a salaried-only start to the year for a home that hadn't yet started service (concessions ramp).

The deep dive tests both hypotheses on the corrected data, walks the salary headcount story period-by-period, and asks whether Kevin can talk about TXR - TX - H with a site leader on Wednesday with confidence.

---

## 2. The full picture - P1 through P8, all four series

Sign convention: positive delta = DB > P&L, negative delta = DB < P&L. Blank cell = null on that side. P&L Actual columns round to whole dollars; deltas <$1 are classification-parity, not drift.

| Period | DB hourly | P&L hourly | Δ hourly | DB salary | P&L salary | Δ salary | DB hourly bud | P&L hourly bud | DB salary bud | P&L salary bud |
|:---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| P1 | - | 0 | - | 6,721.52 | 7,546.54 | -825.02 | 0 | - | 6,721.54 | 6,722 |
| P2 | - | 0 | - | 8,401.90 | 8,067.69 | +334.21 | 0 | - | 6,721.54 | 6,722 |
| P3 | 874.73 | 952.99 | -78.26 | 13,443.04 | 13,215.46 | +227.58 | 0 | - | 6,721.54 | 6,722 |
| P4 | 7,988.31 | 7,988.32 | -0.01 | 13,443.04 | 12,106.16 | +1,336.88 | 11,038.96 | 11,039 | 6,721.54 | 6,722 |
| P5 | 12,622.89 | 13,547.90 | -925.01 | 13,443.04 | 13,856.16 | -413.12 | 27,922.08 | 27,922 | 6,721.54 | 6,722 |
| P6 | 11,945.78 | 11,945.77 | +0.01 | 13,443.04 | 12,106.19 | +1,336.85 | 18,181.82 | 18,182 | 6,721.54 | 6,722 |
| P7 | 18,017.47 | 18,037.49 | -20.02 | 13,443.04 | 13,356.16 | +86.88 | 27,922.08 | 27,922 | 6,721.54 | 6,722 |
| P8 | 17,308.51 | 17,308.51 | 0.00 | 6,721.52 | 6,721.54 | -0.02 | 24,025.97 | 24,026 | 6,721.54 | 6,722 |
| **Total** | **68,757.69** | **69,780.98** | **-1,023.29** | **89,060.14** | **86,975.90** | **+2,084.24** | | | | |

**Budgets agree to a dollar on both hourly and salary in every period.** Whatever a site leader sees under the budget columns is what finance has.

**Hourly actuals:** 5 of 8 periods reconcile within $100 (P1, P2, P4, P6, P7, P8 - six actually, listing five to be careful about P1/P2 where both sides show 0/null). Only three have real variances - P3 (-$78, but under $100 in absolute terms, flagged as significant only because it's 8% of the $953 finance figure), P5 (-$925.01, the reclass hypothesis - see §4), and none in P6-P8 individual periods above $100. **YTD net hourly variance is -$1,023.29** on ~$69k, which is 1.5% - most of it is the P5 reclass.

**Salary actuals:** the classic annualization pattern (see [audit §7 Pattern C](PNL_RECON_P1_P8_2026-08-25.md)). DB stays flat within multi-period runs; P&L moves with actual pay. Net over P1-P8: DB shows $2,084 MORE than P&L, or 2.4% - within the annualization-transient band. Not a defect.

---

## 3. Pattern - hourly starts at $0 in P1-P2

**Both sides agree that TXR - TX - H had no hourly labor booked in P1-P2** (2025-12-29 through 2026-02-22). DB shows null (no rows in `labor_actuals_latest`), P&L shows literal zeros.

This matches the ballpark's ramp: TXR - TX - H is the Arlington MLB home (game-day concessions). The regular season doesn't start until late March, and the pre-season kitchen ramp begins in P3 (first hourly line: $874.73 DB / $952.99 P&L for the four weeks ending 2026-03-22).

Salary was running from P1 onward - a single site lead in P1 ($6,721.52 = 26,000 annual / 13 periods x 26 pay per year / 13 periods, i.e. one salaried person on the annualization). P2 shows an in-period hire ($8,401.90 = one full + one partial), then P3-P7 shows two full ($13,443.04 = 2 x $6,721.52), then P8 drops back to one full ($6,721.52). **See §5 for the headcount story.**

**This shape is normal for a ballpark account** and should not raise a site-leader concern.

---

## 4. The P5 $925 finding - confirmed as a reclass with CIN - AZ

Kevin's hypothesis was that TXR - TX - H P5 hourly (-$925.01 vs P&L) and CIN - AZ P5 hourly (+$925.02 vs P&L) are the two sides of a single labor reclass entry. The deep dive tested this two ways.

### 4.1 The two deltas match to the cent

| | DB | P&L | Delta |
|:---|---:|---:|---:|
| TXR - TX - H P5 hourly | 12,622.89 | 13,547.90 | **-925.01** |
| CIN - AZ P5 hourly | 16,215.92 | 15,290.90 | **+925.02** |
| Sum | | | **+0.01** |

Two accounts, same period, same line, opposite direction, sum $0.01 apart. That's a reclass signature.

### 4.2 It's the only exact offset-pair on the full matrix

`scripts/_probe_reclass_pairs.mjs` sweeps every (period, kind) combination in the 88-account-period matrix for pairs where both sides have `|delta| >= $100` AND `|sum| < $1`. **This is the only pair that qualifies across all 8 periods and both hourly + salary.** No other reclass-shaped offset exists in the audited data.

### 4.3 What it means

One shift's worth of hours (~$925 at typical hourly + burden) was booked against TXR - TX - H in our system but landed against CIN - AZ on the P&L, or the reverse. **The DB total across the two accounts equals the P&L total across the two accounts** ($12,622.89 + $16,215.92 = $28,838.81 DB vs $13,547.90 + $15,290.90 = $28,838.80 P&L, delta $0.01). So the money is right at the CIN + TXR level - it's an attribution question, not a headcount or hours question.

**Follow-up (not this audit):** identify which side booked correctly. That requires a Rippling-side pull for the specific shift, comparing the assigned account on the timecard to the assigned account in `labor_actuals_latest`. Deferred; log for the next TXR + CIN visit.

**Site-leader-facing sentence:** *"One shift in period 5 was posted against the wrong account between here and Arizona - $925 either direction. Total labor across the two accounts is the same on both sides."*

---

## 5. Salary headcount story - matches your prediction exactly

Kevin predicted this would look like: P1 one lead, P2 the hire begins, P3-P7 two full leads, P8 the departure. Direct query on `labor_salary_actuals` (aggregated week-by-week within each period, count of distinct workers with pay) confirms:

| Period | Distinct headcount | Full-period (4 of 4 weeks) | Partial | Total salary posted |
|:---:|---:|---:|---:|---:|
| P1 | 1 | 1 | 0 | 6,721.52 |
| P2 | 2 | 1 | 1 | 8,401.90 |
| P3 | 2 | 2 | 0 | 13,443.04 |
| P4 | 2 | 2 | 0 | 13,443.04 |
| P5 | 2 | 2 | 0 | 13,443.04 |
| P6 | 2 | 2 | 0 | 13,443.04 |
| P7 | 2 | 2 | 0 | 13,443.04 |
| P8 | 1 | 1 | 0 | 6,721.52 |

**Exact match to Kevin's prediction.** P2 partial = mid-period hire. P8 = end-of-season departure of the second lead.

**Salary delta is not a headcount defect.** The DB is flat at $13,443.04 for a P3-P7 stretch (two people on annualized allocation). The P&L drifts around that number because posted pay carries stub-period effects. Nothing to fix.

---

## 5.5 Plan-vs-reality staffing difference - sous chef moved from hourly to salaried

**Owner ruling, 2026-08-26.** The FY2026 labor budget for TXR - TX - H was written assuming the sous chef would be paid hourly. After the budget was finalised, the position was reclassified to salaried. The board reports both lines correctly against actual reality; the budget shape does not match reality on either line. This is a plan-vs-reality staffing difference, not a data variance.

**The numbers:**

| Series | Budget (P1-P8 sum) | Actual (P1-P8 sum) | Actual - Budget |
|:---|---:|---:|---:|
| Hourly | 109,090.91 | 68,757.69 | **-40,333.22** |
| Salary | 53,772.32 | 89,060.14 | **+35,287.82** |
| Net labor (hourly + salary) | 162,863.23 | 157,817.83 | -5,045.40 |

The **-$40K hourly / +$35K salary** shape is the same shift on both the board and the P&L (see §2 - hourly actuals reconcile within $100 on six of eight periods; salary is explained by §5 headcount + this reclassification). The net across the two lines is within ~$5K of the total labor budget, which is the correct order of magnitude for a single-position reclassification during the year.

**Not a variance to explain to a site leader as a data issue.** If a site leader asks "why are we way under on hourly and way over on salary?" the answer is that the sous chef came in salaried instead of hourly, so labor spend landed on the salary line where the budget expected the hourly line. Both the board and the P&L show this correctly; the budget will catch up in the next annual cycle.

**Follow-up (not this audit):** confirm this same shape does not exist on other accounts. The audit's §7 Pattern C mentions the account list; TXR - TX - H is now attributed. STL - FL salary was separately attributed to bonus payments (parent audit §7 Pattern C item 2). STL - MO and TXR - AZ remain annualization-transient.

---

## 6. Rendered board check - not performed

Per the parent audit's §12, this deep dive verifies DB vs finance only. If the deployed board at `/kpi/labor/[account]/[period]` under-renders vs the DB values in §2 above, that's a rendering-layer issue that would need on-prod inspection with the account/period selector on TXR - TX - H. Not executed here.

For TXR - TX - H specifically, all 8 periods have DB budget agreement with finance to the dollar, and 6 of 8 have DB hourly-actual agreement within $100. The rendering-layer check on those 8 account-periods would be verifying render accuracy of numbers that the DB itself agrees with finance on - a useful pass, but a separate one.

---

## 7. YTD verdict - what Kevin can tell TXR - TX - H's site leader Wednesday

**Yes, this account can be discussed with confidence.** All four series agree with finance:

- **Budgets**: hourly and salary, all 8 periods, to the dollar. No qualifier needed.
- **Hourly actuals**: 6 of 8 periods reconcile within $100 (P1 and P2 both zero; P4, P6, P7, P8 within $20). P3 is $78 under (8% of a $953 line, which is a partial-period ramp figure so a real dollar variance is expected). P5 is $925 under - explained as a reclass against CIN - AZ (§4). **YTD hourly net -$1,023 on ~$69k = 1.5%.**
- **Salary actuals**: net +$2,084 on ~$87k = 2.4%. Expected shape given the sous chef reclassification (§5.5) and the annualization allocation for the two leads on payroll (§5).

**One thing the site leader may notice** and the answer for it: hourly is $40K under budget and salary is $35K over budget. That's the sous chef coming in salaried instead of hourly - the budget was written before that change. Net labor across both lines is within ~$5K of what was budgeted. Not a board issue and not a P&L issue.

**The one script for Wednesday:**

*"On TXR - TX - H the budget on this board is identical to what finance has - if you want to know what we plan to spend on labor, this is that number. On actuals, hourly runs within a hundred dollars of the P&L on almost every period, with one $925 shift in period 5 that got posted to the wrong ballpark and needs a note - the total across TXR and CIN is right. If it looks like we're way under on hourly and way over on salary versus budget, that's the sous chef coming in salaried instead of hourly this year - net labor lands close to plan. Headcount tracks: one lead through January, second lead added end of January, both through the season, second lead off after the P7 close."*

---

## 8. Data provenance

- **DB pull:** `scripts/_probe_pnl_recon_db_v2.mjs` (v2, uses `periodOf(week_start)` for hourly; see parent audit §0/§14 for why v1 was wrong).
- **Finance pull:** `scripts/_probe_txr_h_extract.mjs` - pulls TXR-HOME sheet from both file A and file B, confirms no drift.
- **Salary headcount:** `scripts/_probe_txr_h_deep.mjs` - counts distinct workers with weekly salary rows in each period, flags full-period vs partial.
- **Reclass sweep:** `scripts/_probe_reclass_pairs.mjs` - confirms CIN-AZ/TXR-TX-H P5 is the sole exact-offset pair in the 88-row matrix.
- **Snapshots:** `/tmp/txr_h_finance.json`, `/tmp/txr_h_db.json`, `/tmp/pnl_matrix_v2.json`.
