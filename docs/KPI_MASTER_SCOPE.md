# KPI Master Scope v5 - Overview, Alignment, and the System Ledger

**Status:** ACTIVE. Canonical scope for the consolidated Master KPI workstream.
**Owner:** Kevin Fietek. **Architect:** Master KPI Chat-Claude. **Builders:** CC lanes (§1).
**v5, 2026-09-01:** Overview shipped and live. Adds the operator-first site posture ruling
(R-31..R-36), the Ruling 6 defect and its fix ruling, the Labor overtime fix, the doc-drift
program, and the current state of every lane.
Commit path `docs/KPI_MASTER_SCOPE.md`.
**Companions:** `KPI_DASHBOARD_PLAYBOOK.md`, `KPI_PURCHASING_MASTER.md`,
`BUILD_ACCURACY_PROTOCOL.md` (binding), `ACCOUNT_MODEL_MATRIX.md`, `SC_MONEY_MODEL.md`,
audits `OVERVIEW_REVENUE_DISCOVERY_2026-08-28.md` (#888),
`SC_REVENUE_ADMIN_DISCOVERY_2026-08-28.md` (#891),
`INVENTORY_FOOD_COST_DISCOVERY_2026-08-29.md` (#898),
handoffs `LABOR_CC_HANDOFF_2026-08-28.md`, `PURCHASING_CC_HANDOFF_2026-08-28.md`.

---

## 0. Plain English summary

Labor and Purchasing are complete, reconciled, cleaned, performance-passed and live. The
Overview is the landing page: per account, the P&L picture down to Gross Margin, with Labor
and Purchasing as drill-downs. Two audiences share one engine - corporate wants density and
choice, site leaders want a number they can speak to without friction. Finance's own workbook
is the reconciliation target and the source of revenue actuals.

**The one blocker that matters:** our food number runs roughly 5% below what finance posts,
and inventory is now measured and cannot explain it. Until that is understood, the food line
renders as purchases and no diagnostic trigger fires on it.

---

## 1. Seats and lanes

One architect (this chat). Kevin merges everything; no CC self-certifies or merges.

| Lane | Seat | Writes | State |
|---|---|---|---|
| Revenue discovery | Master CC | docs/audits | DONE - #888 |
| SC admin discovery | Master CC | docs/audits | DONE - #891 |
| Labor cleanup + perf | Master CC | labor route/board/probes | DONE - #894-#897 merged, verified live |
| Purchasing cleanup + perf | Purchasing CC | purchasing route/css/scripts | DONE - #889-#893 merged |
| Inventory / food cost | Master CC | docs/audits | #898 landed; three-way pass RUNNING |
| #889 Check 9 restore | Purchasing CC | route.js assert | QUEUED - prompt ready |
| Pre-release fixes | Master CC | F-1..F-4, contrast | QUEUED - gate on team release (R-8) |
| Contamination fix | TBD | SC price/actuals data + probe | QUEUED (R-9) |
| Overview build | Master CC | src/app/kpi/overview/*, api/kpi/overview/* | GATED on spec |

Lane rules: one writer per file family; re-merge-before-push; confirm branch before commit;
stop-and-report per PR with PR number; polish lane waits for cleanup lanes to close.

## 2. System state - what is proven

- **Labor:** budgets 176/176 exact. Hourly FY within 0.19% of finance, every variance over
  $100 named. Salary gap structural (annualized base vs posted). Rippling gross to two cents.
  **Re-confirmed 2026-08-29 against the P8 finance workbook: finance 3100.1 hourly YTD-P8
  $1,607,095.01 vs ours $1,604,030.64, -0.19%.**
- **Purchasing:** budgets 960/960 exact. Actuals 0.23% raw / 1.591% ex-accrual, tilt on Food
  at five accounts (open, P-1).
- **Perf pass complete on both boards.** Purchasing 3,303ms -> 988ms. Labor 2,142ms -> ~1,415ms
  dev, **verified in production at 1,206ms / 1,307ms warm**, payload -17%, sentinel intact.
- **Sentinels:** CIN - OH wk 06/29 = 113.98 / 2.32 / 39.91 / $4,328.27 · portfolio FYTD-P8
  hourly $1,604,030.64 · TBR - FL P8 3200.1 bill.com $39,373.74 · portfolio P9 KPI budget
  $231,132.99 · **finance hourly YTD-P8 $1,607,095.01 (new, outside-data).**
- **kpi_budgets:** 34 lines, 11/11 verified, all revenue lines present (11 x 5 x 13, zero gaps).
- **SC admin:** 9 gated write actions, changelog on every write, fenced backdate path.
- **Not verified anywhere:** mobile 375, print, keyboard nav; zero operator use.

## 3. Findings ledger

### 3.1 Hands-on sessions (2026-08-28, re-verified 08-29)

| ID | Sev | Finding | State |
|---|---|---|---|
| F-1 | P2 | Approvals caption missing space ("across38 people"). | OPEN |
| F-2 | P2 | 1280 labor eyebrow clips under pill; clip spec measures scrollWidth so overlap-clips are invisible to the gate. Fix header + extend spec. | OPEN, re-confirmed 08-29 |
| F-3 | P2 | Account-switch off homestand shows blank board + stale toggle. Masked by the perf work (faster route, shorter window), suppression logic unchanged. | OPEN |
| F-4 | P2 | Purchasing By P&L Line table prints $0.00 for running/future weeks while its charts render dashes. | OPEN |
| F-5 | align | Card header grammar differs. RULED R-7. | RULED |
| F-6 | align | Chart language differs. RULED R-6 - labor's is the standard. | RULED |
| F-7 | ruled | Range did not carry across sections. RULED R-5. | RULED |
| F-8 | P3 | CIN - KY "every shift approved" vacuous on a zero-shift account. | OPEN |
| F-9 | P1 | **Purchasing card corpus went backwards overnight 08-28 -> 08-29:** `cards_through` 08/28 -> 08/27, P9 coded card spend $16,325 -> $1,139, pending $16,182 -> $13,698, bills identical. All three sources reported green, `report_stale:false`. Likely Rippling auth-vs-settled churn inside the ~8-day post lag - which is also the untested hypothesis for P-1. A health surface that reports the job ran cannot report the corpus shrinking. | OPEN - best natural experiment available for P-1 |
| F-10 | closed | Approvals "drafts vanished" P1. **My error** - CC's fixture ends 08-09, drafts live after it (oldest 08-24). Rolling window shows 575.66 draft / 806.89 approved, matching the board. | CLOSED |

### 3.2 Discovery #888 - revenue ground truth

| ID | Sev | Finding |
|---|---|---|
| R888-1 | P1 | §5.7 contamination live on all five fee accounts. CIN - OH $4,671.76 and **STL - FL $466,216.00** actively bleeding into actual_revenue; three latent. Zero actual-kind price rows, COALESCE falls to projected. |
| R888-2 | gap | Fee cadence not computable: `payment_cadence` informational only, no installment table. |
| R888-3 | gap | `pnl_actuals` never built. **Superseded in part by R-17: the finance workbook is the source.** |
| R888-4 | drift | sc-28 never shipped; its number was reused by the away-dining migration. N11 row-order read still live. |
| R888-5 | ok | Per-meal per-period rollup PROVEN (TBR - FL P1-P8, zero NULL periods). |
| R888-6 | data | Seven accounts carry the 2026-06-15/16 seed burst; CIN - OH small-but-real; three empty. |

### 3.3 Discovery #891 - SC revenue admin

| ID | Sev | Finding |
|---|---|---|
| R891-1 | **P1** | TBJ - FL "Fun $$$$ Allocated" carries **$318,996,483.92** phantom actual_revenue in raw `sc_daily_revenue` (3 seed rows x stale price; flag flipped later, counts never retro-zeroed). Only `sc_month_summary` filters it. Any raw-view reader without `NOT is_non_revenue` eats it. |
| R891-2 | gap | Zero of 11 accounts can produce 2300 actuals from the SC. The four real shapes are out-of-band. **Superseded by R-17.** |
| R891-3 | gap | No P&L line_code binding on sc_services/prices - docs-only. |
| R891-4 | gap | Installment/recognition lane absent (9 candidate tables probed). |
| R891-5 | ok | Charge-shaped services real and flowing on 6 accounts. |
| R891-7 | note | Fee escalations landed as create rows, not supersedes; base values in docs + changelog JSONB. |

### 3.4 Discovery #898 + the inventory measurement

| ID | Sev | Finding |
|---|---|---|
| R898-1 | **P1** | **Our food runs systematically below finance** - 9/11 accounts, mostly -1% to -13%. Rendering purchases as "food cost" would tell operators they are under when they may not be. |
| R898-2 | **P1** | **Packaging is structurally broken on two accounts:** finance carries $1,385 (CIN - KY) and $10,991 (STL - FL) against our $0 - nothing mapped to 3400.x on our side. Others show -26% to -55%, far beyond any inventory explanation. Mapping defect, fixable now. |
| R898-3 | corrected | CC reported labor drift on 4 accounts. **Control was contaminated** - it compared hourly+salary against finance total 3100. Hourly-only reconciles at -0.19%. The four accounts are the four already documented (CIN - KY full-year salary booking, TXR - AZ convergence, STL - FL sign-on bonus, TBR - FL payroll cutoff). Food comparison at those accounts is NOT invalidated. |
| R898-4 | **measured** | **Inventory does not explain the food gap.** Counted movement nets to **$2,304 against $1,771,540** of finance food across the covered set - **0.1%**. Signs go both ways; the food gap is consistently one-signed. Different shapes, different cause. |
| R898-5 | ok | Counts are **period-tagged**, one submission per account-period, zero duplicates. No calendar-vs-period alignment problem exists. 58 clean account-period counts across 9 accounts; CIN - AZ / TBJ - FL / TBR - FL / TXR - AZ complete P1-P8. |
| R898-6 | P2 | **TXR - AZ P4 and P5 submissions are byte-identical** (food $12,024.03, pkg $4,331.02, sup $3,321.02). Copy-forward or resubmission. Nothing anywhere detects it. |
| R898-7 | method | Three separate "not in PG" reported as "not there" this pass (inventory rows, Sheets access, count coverage). **Absence from Postgres is not absence.** |
| R898-8 | ok | Pass-through accounts (CIN - OH, STL - MO) count ~$17K inventory each while finance books $0 food - client-owned product. Structural, not a defect. |

### 3.5 Finance workbook findings (P8, 2026-08-20)

| ID | Finding |
|---|---|
| W-1 | **The workbook carries revenue actuals per line per period for every account, including 2300.** CIN - AZ YTD-P8 revenue actual $1,280,388.78 vs $1,282,669 budget; 2300 actual $358,772. This is the pnl_actuals source and it already exists. |
| W-2 | **Fee accounts book to 2400.1**, 2200 and 2300 at zero. Confirms playbook D1. |
| W-3 | Finance runs Revenue -> COGS -> Gross Margin -> SG&A -> **Contribution Margin**. Overview stops at Gross Margin per R-1x below; CM is finance's bottom line and is noted for later. |
| W-4 | **Every line carries a percent-of-revenue column.** This is the finance-literacy vehicle - adopted system-wide. |
| W-5 | Structure: 97 rows x 197 cols per account tab; cols 2-15 period + year budget; then repeating 7-col bands per period and per YTD with Budget / % / Actual / % / ∆ / ∆%. Period starts P1 2025-12-29 through P8 2026-07-13 (closes 2026-08-09). |

### 3.6 Ruling 6 - the live money defect (2026-09-01)

| ID | Sev | Finding |
|---|---|---|
| RU6-1 | **P1** | Ruling 6 excludes API rows whose `parent_txn_id` appears in the report feed, on the theory the report side captured the charge. **Nothing loads report-side rows into `purchasing_actuals`**, and that table is the board's only source for coded-card totals. Money leaves, nothing replaces it. |
| RU6-2 | **P1** | **The shipped rule lost its scope.** `reportCodedHit` (sync:1039) is a bare set-membership test; `glLine` is not computed until line 1069, after the reason chain. The ruling was scoped to 56 uncoded stale-pending rows / $17,863.01. Shipped behaviour: **4,215 rows / $991,456.39**. |
| RU6-3 | ok | **R898-2 was a Ruling 6 artifact, not a mapping defect.** Packaging portfolio -35.19% to +3.33% when the exclusion is dropped; every catastrophic delta resolves. Close R898-2. |
| RU6-4 | open | Food partially closes (-3.07% to +3.90%, 5/11 accounts). Four accounts overshoot: CIN - AZ, TBJ - FL, TXR - AZ, TXR - TX - V. That residual is the P22 tilt - **bill.com, not cards**, splitting by regional distributor family (Sysco / Cheney / Ben E Keith positive; Shamrock / Peddler's Son negative). The auth-vs-settled hypothesis is **dead** for the food tilt (measured $1,393 against $35,099 of variance). |
| RU6-5 | note | `parent_txn_id` matches only 47% of API parents (5,318 of 11,215) - Rippling assigns different hexes to auth and settlement on some charges. Exact where present, absent where not. Do not build on it without this caveat. |
| RU6-6 | **P1** | **The purchasing 0.23% reconciliation measured a pre-exclusion state** (first application 2026-08-29 07:41 UTC). Until re-run after the fix, no purchasing or Overview cost figure is proven. |

### 3.7 Cleanup lane audit

| ID | Finding |
|---|---|
| C889-1 | Server-side Check 9 deletion downgraded prod coverage (surviving client gate is dev-only). Restore prompt ready. **OPEN.** |
| C889-2 | Payload trims, CSS deletions and probe edit verified clean. |
| C897-1 | `_probe_labor_route_select_coverage` guards `labor_actuals_latest` but **not** the `paginateActuals` select it was written to protect. A gate whose name is broader than its coverage. |
| C897-2 | CC stated 4 broken probes and named 3. Fourth still unnamed. |
| C897-3 | Labor probes 12 A / 0 B / 4 C; 3 of 16 CI-wired. Purchasing was 4/25/4 and 1 of 33. |

### 3.7 Inherited opens

Labor: bonuses ~$165K/yr invisible to 3100.1 (Joe + Sebastian) · TBR - FL one-week payroll
offset · four undefined GL codes ($18,780 STL - MO / $32,553 STL - FL) · mobile/print/keyboard
unverified. Purchasing: **P-1 Food tilt 1.591% ex-accrual (likely same defect as R898-1 and
F-9)** · Beau Davis duplicate check · TXR - AZ $15,780 residual · 132 unbridged pending · two
waived labor contrast selectors · MO sales tax · three miscoded category rows · Rippling
`purchase_location` bug · Rippling data audit deferred.
Doc drift: PROJECT_DASHBOARD stale · design-spec IA superseded by SECTION dropdown · sc-28
number collision.

## 4. Alignment charter - the system language

1. **Chart grammar = labor's** (R-6). Hatch for in-progress/estimated; purchasing re-skins its
   running/projection units into labor's language, keeping their semantics.
2. **Card header grammar = pill right-aligned** (R-7): eyebrow · context/GL · ?, pill at edge.
3. **Dash-vs-zero enforced everywhere including tables** (F-4 first fix).
4. **One loading philosophy:** skeleton cold, ghost + honest chip warm, never blank, never a
   stale control from the previous account (F-3).
5. **Contrast floor everywhere;** two waived labor selectors pull up; new stylesheets join the
   contrast probe CSS_PATHS in their creating PR.
6. **Tokens only;** `.kpi-app` scope, `--kf-scale`, zero raw px, gates extended at file-add.
7. **Range carries** (R-5) across sections and drill-downs.
8. **Shared primitives stay shared;** the Overview adds zero forks.
9. **Real financial terms first, plain-language explanation attached** (R-1x). The tool should
   make operators stronger, not just informed. Never the friendly word alone.
10. **Percent of revenue is a first-class column** on every money line, everywhere (W-4).
11. **"Also tracked" band** for R&M 5002.1, Equipment 5002.5, Perks 5017.3 - visually distinct,
    no verdict pills, sub-line "not part of gross margin or COGS - watched together."
    **Never the word "scored."**
12. **No bonus language anywhere.** This is a finance dashboard.

## 5. Overview scope - LOCKED DESIGN (prototype v5, 2026-08-31)

Prototype: `overview-prototype.html` (interactive, real P8 workbook data, all 11 accounts,
three ranges, both postures). The prototype is the render of record for the build.

### 5.1 What it is

Landing section (`pnl_overview`, enabled last). Per account and range: Revenue, Cost of goods
sold, Gross margin - budget vs actual in dollars **and percent of revenue** - with Labor and
Purchasing as drill-downs. Ends at Gross margin. No SG&A section; an "Also tracked" band for
5002.1, 5002.5, 5017.3.

### 5.2 The management logic the page is built on (R-18)

**Gross margin % is the goal. The COGS %s are the levers. Operators trade between lines.**
Every money line shows actual and budget in dollars and as a percent of revenue, with the gap
stated in the language the operation already uses: "24.1% vs 27.0% target · 2.9% under."
Percent of revenue is time-invariant, so it needs no proration and is the primary comparison
in open periods; dollars sit beside it with explicit labels.

### 5.3 Two audiences, one engine (R-19)

Same resolver, same numbers, same structure. **Corporate** adds the portfolio rail, GL codes on
headers, the account grid at ALL / region, and the revenue-source toggle. **Site leader** drops
the rail (one account), keeps GL codes inside the statement, and carries the gated salary
control. Card order is P&L order on both: Revenue, COGS, Gross margin.

### 5.4 Page anatomy (both postures)

1. **Command bar:** account, range chip (FYTD / This period / Last period), today · period ·
   week, salary control (site, gated) or revenue-source toggle (corporate), freshness chip.
2. **Sources line:** labor through date · purchases through date · SC revenue through date ·
   period-state chip (§5.6).
3. **Ticker** (§5.7).
4. **Three cards:** Revenue (hero, budget to date, period or full-year budget, breakdown with
   budgets, pill Planned / Contractual / Above or Below budget); COGS (hero "spent", % vs
   target, gap, budget to date, mini breakdown, pill Under / Over target); Gross margin (hero,
   % vs target, gap, budget context, target for the period or year, pill Ahead / Behind).
5. **Cost of goods lines** - the four levers: actual, budget, variance, actual %, target %,
   vs target. Zero-budget lines render "no budget", never a red over.
6. **Chart:** cost of goods sold vs budget - bars are spend, dashed line is budget, **below
   the line is green**. FYTD = period by period, P9 hatched running. Single period = week by
   week, unstarted week is a dash. Hover shows Spent / Budget / Under or Over.
7. **Drill buttons:** Labor and Purchasing - spent through date, % of revenue vs target,
   what's inside.
8. **Full profit and loss** - collapsed by default; opens on **Summary**, Full one click.
   Open periods carry three budget columns: Period budget · Budget to date · Actual to date.
9. **Also tracked** - dashed band, no pills, "not part of gross margin or cost of goods sold -
   watched together." Perks explained.

### 5.5 Revenue source rule (R-20) - replaces the Plan | Actuals toggle

| Period state | Per-meal accounts | Fee accounts | TXR - TX - V |
|---|---|---|---|
| Closed, verified | finance P&L actual (R-17) | finance P&L actual | finance P&L actual |
| Closed, awaiting finance | our estimate, marked | contractual | budget, marked tracked |
| Open | **planned** = budget to date, marked, until the site's SC counts are live | contractual (per-period budget rows are the recognition schedule) | budget to date, marked tracked |

Cost lines are always live (labor + purchasing engines). **Corporate keeps one toggle,
re-scoped:** "Planned revenue | Service Calendar revenue," switching only the open-period
revenue source on per-meal accounts, with a test-data note. That is the pipeline-validation
control R-1 intended; it retires when every site is live. Site leaders never see SC test data.

### 5.6 Period states (R-21)

**open · live estimate** → **closed · awaiting finance** → **verified against P&L · date**.
Chip on the sources line, hover defines all three. When a verified figure differs from what
the board showed, the delta surfaces once (R-17d).

### 5.7 The ticker (R-22) - rules-based, deterministic, every claim traceable to a number

- **State** from gross margin % vs target: Ahead (1%+ over) · On track (within 1%) · Behind
  (1-3% under) · At risk (3%+ under).
- **Gross margin** segment: actual % vs target % · gap.
- **Biggest lever:** the COGS line furthest from its own % target, with direction.
- **Offsetting:** the next line if it moves the other way by 0.3%+.
- **Through date / period closed** segment.
- **Notes** (amber): revenue set by contract (fee); food billed back, labor is the lever
  (pass-through); open-period revenue is planned (per-meal until live).
- **Never:** bonus, causes, predictions, or any word a number on the page cannot back.

### 5.8 Numbers and vocabulary (R-23..R-27)

- Whole dollars everywhere. No abbreviations, no cents on the Overview.
- Every gap is a positive number with a direction word - under/over (costs), ahead/behind
  (margin), above/below (revenue) - green when it is the good direction. No signed numbers.
  "On budget" when the gap is under a dollar. **Percentage points are never called points.**
- Budget to date prorates the open period by days through yesterday.
- Vocabulary: *Period budget · Budget to date · Actual to date* - both other boards adopt it.
- "Food purchased," never "food cost." Real terms first, plain meaning attached in the `?`.

### 5.9 Salary (R-28)

Site control, gated to corporate and the top site leader (role keys per CC). It **reveals** the
3100.1 / 3100.2 sub-lines; it never changes totals. Gross margin must equal finance's, and
finance's includes salary.

### 5.10 Binding rules inherited (not re-litigated)

N1-N11; D4; D17; §8.2 group-grain; pass-through accounts carry no verdict on billed-back
lines; §9B one-resolver-per-card; "you don't mess with people's money"; renders before code;
laptop matrix + standing battery per visual PR; server computes every dollar; `NOT
is_non_revenue` on every raw-view read; fee accounts never read `sc_daily_revenue`.

### 5.11 v1 in / out

**In:** 11 accounts + ALL/EAST/WEST; both postures; three ranges; the anatomy above; period
states with P1-P8 seeded verified from the P8 workbook; `pnl_actuals` table + loader; the
account live-flag; contrast-gated stylesheet; five sentinels.
**Out:** SG&A; Contribution Margin; workbook upload UI (loader script first, UI follows); TXR -
V tracked figure (v1.1 - budget + note in v1); inventory anything; bonus anything; export.

## 6. Rulings ledger

| # | Ruling |
|---|---|
| R-1 | Plan \| Actuals toggle, plan default, seed markers, retires when all sites live. |
| R-2 | Service charges live SC-side - investigated (#891); superseded as a source by R-17. |
| R-3 | TXR - V: budget vs tracked; Kevin seeds actuals post-season; SC tracking later this year. |
| R-4 | Fee recognition lives SC-side - superseded as a source by R-17. |
| R-5 | Range carries across sections and drill-downs. |
| R-6 | **Labor's chart grammar is the system standard;** purchasing re-skins. |
| R-7 | Pill-right card header grammar is the system standard. |
| R-8 | **All findings fixed before release to teams.** |
| R-9 | Ship the contamination fix. |
| R-10 | pnl_actuals: work out, do not park - answered by R-17. |
| R-11 | TXR - V binds 2400.1 per P&L with open flag. |
| R-12 | #889: restore the server assert. |
| R-13 | Kevin runs the operator walkthrough. |
| **R-14** | **Inventory is not a financial input.** Measured 0.1% of food. No cost line is ever inventory-adjusted. Revisit only when a vendor-linked system exists and proves itself. |
| **R-15** | **Inventory renders as practice, not value** - counted this period, consistent with pattern, plausible. Includes duplicate-of-prior-period detection (R898-6). Lives where inventory lives, not on the finance board. |
| **R-16** | **Food variance is a diagnostic trigger, not a verdict** - a prompt to look at ordering, usage and counts. Blocked until R898-1 is understood. |
| **R-17** | **The finance workbook is the revenue-actuals source and the reconciliation target.** Sebastian produces it 1-2 weeks after period close; Kevin uploads it. Per-period ingest, loader pattern. |
| **R-17b** | **Overview ends at Gross Margin.** No SG&A section. "Also tracked" band covers R&M 5002.1, Equipment 5002.5, Perks 5017.3 only. |
| **R-17c** | **Fun Money is 3200.2 Resale Food**, only where an account has it. Distinct from Perks (5017.3). |
| **R-17d** | **Every period shows open (live estimate) or closed (finance file, confirmed).** When a closed figure differs from what the board showed, surface the delta once rather than swapping silently. |
| **R-17e** | **Real financial terms first, plain-language explanation attached.** System-wide. |
| **R-18** | GM% is the goal, COGS %s are the levers; % of revenue on every line, primary in open periods. |
| **R-19** | Two postures, one engine, same structure; P&L card order on both. |
| **R-20** | Revenue source rule per period state (§5.5); corporate toggle re-scoped to revenue source; site leaders never see SC test data. |
| **R-21** | Three period states: open · closed-awaiting · verified, with date. |
| **R-22** | Ticker is rules-based with fixed grammar and 1% / 3% breaks; never says what a number cannot back. |
| **R-23** | Whole dollars; no abbreviations. |
| **R-24** | Gaps are positive numbers with direction words; never signed; never "points." |
| **R-25** | Budget to date prorated by days through yesterday. |
| **R-26** | Vocabulary: Period budget · Budget to date · Actual to date; adopted by all boards. |
| **R-27** | Statement collapsed by default, opens on Summary. |
| **R-28** | Salary control reveals sub-lines only; totals always include salary. |
| **R-29** | Charts are cost vs budget, below the line is green; unstarted units are dashes. |
| **R-30** | Cards updated nightly - CONFIRMED (3 clean nightly syncs, 1-day lag). |
| **R-31** | **Operator-first site posture.** Every number appears once. Page order follows the operator's questions - am I okay / what are the numbers / what is left / what is driving it / how did the weeks go / depth - not the chart of accounts. Locked render: `docs/renders/overview-site-leader-LOCKED.html`. |
| **R-32** | **Cut from the site posture:** gross margin in the ticker (the state pill is the verdict), card mini-breakdowns, the seven-column lever table (corporate only), the period-by-period chart, the progress bar, and the planned-revenue note once counts are live. |
| **R-33** | **No projection until it is a real one.** "At this pace margin closes at X%" is arithmetically identical to the current margin under linear accrual - an identity, not a forecast. Only ship a projection when it consumes what makes the remainder different (remaining game days, scheduled deliveries, homestand shape). |
| **R-34** | **"What is left" is the operator's number:** budget remaining, per day remaining, and pace as a sentence with both percentages behind it. Open period only - closed periods and FYTD drop the strip. |
| **R-35** | **Percent semantics during the planned-revenue window.** COGS% and GM% are to-date over to-date. While revenue is planned, revenue-to-date equals budget-to-date, so the percentage is the dollar variance rescaled, not a second signal. Teach dollars first; percentages become primary when Service Calendar counts go live. |
| **R-36** | **Labor and Purchasing are deliberately blended surfaces** - corporate density with site-leader access, reached by drill-down. Periods are the unit of work; weeks are navigation within a period. The Overview site posture is the only pure operator surface. |
| **R-37** | **Ruling 6 fix: add the missing condition, do not revert.** The ruling was correct and scoped to uncoded stale-pending rows; the implementation shipped without `!glLine` and fires on coded rows too. |
| **R-38** | **Labor overtime card shows this week against last week, in hours** - not a fiscal-year percentage against a fixed threshold. Wrong for both audiences: a site can sit at 1.3% all year and blow up last week. |
| **R-39** | **Docs that restate values will always drift.** Value docs get generated from source; prose docs carry decisions only and reference tokens by name, never by value. A drift probe fails any doc asserting a hex, px or font the code contradicts. |

## 7. Build sequence

### Shipped

| Phase | PRs | State |
|---|---|---|
| Labor cleanup + perf | #894-#897 | merged, verified live, 2,142ms -> ~1,200ms |
| Purchasing cleanup + perf | #889-#893 | merged, 3,303ms -> 988ms |
| Overview foundations | #902 | merged - `pnl_actuals` 2,815 rows, 11/11 to the cent |
| Overview engine | #906, #907, #910, #912 | merged - loaders extracted both boards, purchasing resolver + parity gate, Overview resolver |
| Overview board + enable | #916, #919, #921 | merged - both postures, live in the section dropdown |
| Salary blocker | #923 | merged - GM was overstated ~9.5 points |
| P2 defects | #929 | **merge now** - rail, sizing, range chip, sources line, FYTD budget |

### Now

| # | Item | Owner | Gate |
|---|---|---|---|
| 1 | **Ruling 6 fix (R-37)** - add `!glLine`, move the computation above the reason chain, add the uncoded-only assertion with seeded failure, re-run purchasing reconciliation + food/packaging vs finance + sentinels + parity | CC | the reconciliation must re-establish before anything is called proven |
| 2 | Merge #926 / #927 as the audit record | Kevin | - |

### Next

| # | Item | Why now |
|---|---|---|
| 3 | **Doc generator + drift probe (R-39)** - whole codebase, not KPI only | OPD, Academy and mobile are all being built against stale docs today. Half a day, zero product risk. Report findings, triage later. |
| 4 | **Overview site posture to the locked render (R-31..R-35)** | The pure operator surface. Cut list in R-32, "what is left" in R-34. |
| 5 | **Labor overtime card (R-38)** | This week vs last week in hours. |
| 6 | **Pre-release list (R-8)** - F-1..F-4, F-8, contrast pull-up, C889-1, C897-1/2, contamination fix (R-9) | Kevin's gate before any team sees it |
| 7 | **Operator test** - Jen or Liz in front of the site posture, cold, no narration | The only evidence that settles whether we built it for them or for us |

### Then

| # | Item |
|---|---|
| 8 | Alignment register §11 worked through on both boards |
| 9 | Food residual (RU6-4) - bill.com distributor-family pattern, now bounded |
| 10 | Pagination sweep - 213 sites flagged by the committed guard; triage, do not bulk-fix |
| 11 | Workbook upload UI; TXR - V tracked figure; inventory practice surface (R-15) |
| 12 | Arizona training |

### Standing gates

Renders before code. Migrations reviewed by Chat before Studio. CC never self-certifies or
merges. Every guard answers "what other path could make this pass?" A stated blocker beats a
workaround.

### 7.1 Questions CC answers before Phase 1 (read-only)

1. Can labor's `buildBoard` and purchasing's resolver be called as library functions with
   `(members, start, end, opts)` server-side, or are they route-bound? The Overview must reuse
   them - one implementation per number. If route-bound, what is the smallest extraction?
2. Week-grain and period-grain totals: does each engine expose them, or only the range total?
3. Day-level budget proration: what does each engine do today (labor by week, purchasing
   adjusted targets)? The Overview uses days-through-yesterday; report the delta and what
   adopting it costs each board.
4. Role keys for the site-leader posture and the salary gate (GM / top site leader).
5. Card sync cadence: nightly now, or still trailing? `cards_through` moved backwards on
   08-29 (F-9). Report what the sync actually does.
6. 5017.3 Perks: is it in the purchasing bucket map / line catalog? Can card charges coded to
   it be summed per account per period today?
7. `pnl_actuals`: propose the table (account, fiscal_year, period_no, line_code, budget,
   actual, verified_at, source_ref) and the loader shape, mirroring the `kpi_budgets` loader.
8. `kpi_period_status` and `kpi_account_flags`: propose shapes. Manual flag for
   `sc_revenue_live`, heuristic advisory only.
9. Fee-account recognition: confirm the per-period budget rows in `kpi_budgets` match the
   workbook's per-period 2400.1 for the four fee accounts (they are the recognition schedule).
10. Contamination status (R-9) and confirmation that no Overview path reads
    `sc_daily_revenue` for fee accounts or for non-live per-meal accounts.

## 8. Verification battery

Five sentinels asserted in every Overview engine PR. S1-S3 + the pattern law verbatim; every
guard answers "what other path could make this pass?" New cells owed: dash-vs-zero chart-vs-table
parity; overlap-clip detection in the 1280 spec (F-2); raw-view contamination probe (phase 3c);
`paginateActuals` select coverage (C897-1); card-corpus regression detection (F-9 - a
`cards_through` that moves backwards, or a period total that shrinks between runs, must alarm).
Reconciliation probes rerun per period, not cumulative.

## 9. Out of scope

SG&A section; Contribution Margin; Travel; SousAI v3; mobile PWA; Culinary Management Platform;
Invoice Capture B-H; SC Admin Dashboard beyond what R-17 needs; inventory rebuild (2027).

## 10. Doc maintenance

Canonical state for this workstream; §3, §6, §7 and §11 update as items close.
PROJECT_DASHBOARD.md gets a pointer row at its next refresh. History lives in the PR trail.

---

## 11. Cross-board alignment register

**Purpose:** every decision made for the Overview that Labor or Purchasing must also honor.
Worked during and after the Overview build so the platform stays one tool, not three.
**Rule: the Overview does not fork. If a decision here cannot be applied to a shipped board,
it is the wrong decision.**

Status values: `pending` (not started) · `overview` (built in Overview only) ·
`done` (all applicable boards) · `n/a`.

### 11.1 Language and terminology

| # | Decision | Labor | Purchasing | Overview | Status |
|---|---|---|---|---|---|
| A-1 | Real financial terms first, plain explanation attached (R-17e) | audit copy | audit copy | build in | pending |
| A-2 | **"Food purchased," never "food cost"** while the two differ (R-14) | n/a | rename required | build in | pending |
| A-3 | "Also tracked" band wording; never "scored" (R-17b) | n/a | R&M/Equipment already shown - adopt band + sub-line | build in | pending |
| A-4 | No bonus language anywhere | verify | verify | build in | pending |
| A-5 | Fun Money labeled as 3200.2 Resale Food where present (R-17c) | n/a | verify STL - FL / TBJ - FL copy | build in | pending |
| A-6 | Zero-shift / zero-spend accounts get non-vacuous wording (F-8) | fix | audit | build in | pending |
| A-7 | Gaps are positive numbers with direction words; never signed, never "points" (R-24) | audit ▲/▼ chips | audit ▲/▼ chips | build in | pending |
| A-8 | Vocabulary Period budget · Budget to date · Actual to date (R-26) | adopt ("range budget") | adopt ("target / adjusted") | build in | pending |

### 11.2 Numbers and states

| # | Decision | Labor | Purchasing | Overview | Status |
|---|---|---|---|---|---|
| B-1 | Dash-vs-zero: missing, failed and zero render distinctly - **tables included** (F-4) | audit | fix | build in | pending |
| B-2 | Percent-of-revenue as a first-class column (W-4) | add where meaningful | add | build in | pending |
| B-3 | Period open (live estimate) vs closed (finance file) state (R-17d) | adopt | adopt | build in | pending |
| B-4 | Closed-vs-shown delta surfaced once, never a silent swap (R-17d) | adopt | adopt | build in | pending |
| B-5 | No verdict on a total while any component is unsourced | adopt | adopt | build in | pending |
| B-6 | Fee accounts carry no revenue variance (D4) | n/a | n/a | build in | pending |
| B-7 | Pass-through accounts carry no verdict on billed-back lines | n/a | shipped | build in | done (purch) |
| B-8 | Inventory never adjusts a cost line (R-14) | n/a | verify | build in | pending |
| B-9 | Five sentinels asserted in every engine PR | adopt | adopt | build in | pending |
| B-10 | Percent of revenue is the primary comparison; dollars beside it (R-18) | add | add | build in | pending |
| B-11 | Budget to date by days through yesterday (R-25) | weekly today | adjusted-weekly today | build in | pending |
| B-12 | Whole dollars on the Overview; cents stay on drill boards (R-23) | keep cents | keep cents | build in | ruled |
| B-13 | Zero-budget lines render "no budget", never a red over | audit | audit | build in | pending |

### 11.3 Visual grammar

| # | Decision | Labor | Purchasing | Overview | Status |
|---|---|---|---|---|---|
| C-1 | Labor's chart grammar is the standard (R-6) | source | **re-skin required** | build in | pending |
| C-2 | Pill-right card header (R-7) | **converge** | source | build in | pending |
| C-3 | Contrast floor - no waived selectors | **pull up 2** | clean | gate at add | pending |
| C-4 | Tokens only, `.kpi-app`, `--kf-scale`, zero raw px | clean | clean | gate at add | done |
| C-5 | Skeleton cold / ghost warm / never blank / never stale control (F-3) | **fix** | shipped | build in | pending |
| C-6 | 1280 laptop floor, overlap-clips detected not just overflow (F-2) | **fix + extend spec** | verify | build in | pending |
| C-7 | Nonzero never renders as nothing (min visible height) | audit | audit | build in | pending |
| C-8 | Cost charts: bars are spend, line is budget, below the line is green (R-29) | source (hatch) | re-skin | build in | pending |
| C-9 | Muted text at n-600 minimum (4.9:1); n-500 fails small-text contrast | audit | audit | build in | pending |
| C-10 | Every card: eyebrow · context · ? · pill top-right, one pill style (R-7 enforced) | converge | source | build in | pending |

### 11.4 Behavior and navigation

| # | Decision | Labor | Purchasing | Overview | Status |
|---|---|---|---|---|---|
| D-1 | Range carries across sections and drill-downs (R-5) | adopt | adopt | build in | pending |
| D-2 | Drill from Overview carries account + range | n/a | n/a | build in | pending |
| D-3 | Site-leader posture: no portfolio rail on single-account users | **audit** | **audit** | build in | pending |
| D-4 | Two postures from one resolver - no second engine | n/a | n/a | build in | pending |
| D-5 | Shared primitives stay shared; zero forks | source | source | consume | pending |
| D-6 | Freshness surface identical across sections | source | source | consume | pending |
| D-7 | Sources line with per-source through-dates and the period-state chip (R-21) | adopt | adopt | build in | pending |
| D-8 | Statement-style folds open on Summary (R-27) | n/a | n/a | build in | ruled |

### 11.5 Engineering discipline

| # | Decision | Labor | Purchasing | Overview | Status |
|---|---|---|---|---|---|
| E-1 | Zero unconsumed payload keys from PR one | done #894 | done #889 | build in | pending |
| E-2 | Single proven-independent loader block | done #896 | done #893 | build in | pending |
| E-3 | Route instrumented from the first engine PR | done | done | build in | pending |
| E-4 | Every probe born with a seeded failure case | done #897 | partial | build in | pending |
| E-5 | Select-coverage probe covers **every** select it names (C897-1) | **fix** | audit | build in | pending |
| E-6 | Server-side assertions run in production, not dev-only (C889-1) | audit | **restore** | build in | pending |
| E-7 | Absence from Postgres is not absence (R898-7) | method | method | method | standing |
| E-8 | Health signals must detect corpus regression, not just job completion (F-9) | audit | **fix** | build in | pending |
| E-9 | Overview consumes labor and purchasing engines as library calls - one implementation per number | expose | expose | consume | pending |
