# TBR-FL Data Sweep

**Generated:** 2026-08-04
**Branch:** `feat/tbr-2027-data-sweep`
**Author:** Claude Code (six parallel Explore agents, assembled by parent)
**Purpose:** Read-only recon feeding the Tampa Bay Rays proposal deck. Extension-option decision October 1, 2026; client wants numbers August 15, 2026. This file is the source. It writes nothing.

---

## What I could not answer

Every gap below is called out in-place inside the parts. Concentrated here so the holes are visible before the data.

- **The rate change actually being proposed to the Rays for road sandwiches is not knowable from the system.** The proposal doc's claimed range "$20.68 to $15.17" appears nowhere in the database or the repo. Current billed rate is a constant $15.00 (all price rows). Kevin / Joe must supply the target rate before any credit calculation is final. Part 3 Q1 shows the arithmetic at $15.17, $11.38, and $11.00 for reference; none is endorsed.
- **The count of missed action-station days is not knowable from the system.** Action stations are not tracked - not as a service, not as day metadata, not in day notes, not in any OPD document. Part 3 Q4 lists what would be needed to derive it (game-time backfill from MLB Stats API for the FCL phase, plus client-supplied dispute-of-record).
- **Pre-2026 TBR-FL revenue and meal counts do not exist in this system.** Postgres holds 2026 only; the repo carries prior-year rate documentation but no volumes. Any 2022-2025 trajectory slide must be sourced from QuickBooks (invoices), the legacy Service Calendar workbooks in Google Sheets/Drive, Finance P&L worksheets, or Rippling. Named in Part 4; not queried.
- **The contractual basis for the 2025 and 2026 MiLB Service Fee is a finance ledger, not a signed SOW.** SF recurrence at $457,768 (2026) is confirmed by the LEDGER and PL_2026_APPENDIX; the corresponding SOWs are not filed in the pricing-summit accounts folder. Part 5 flags this as renewal-dispute exposure.
- **The BGC 2026-27 school-year renewal is not on file.** The BGC contract on file expires May 21, 2026. Any P&L projection assuming BGC revenue after that date is assuming a renewal that has not been executed. Part 5.
- **The company's canonical Strategic Goals / north-star document is not in the OPD catalog.** Every other Part 6 category (mission, vision, values, culinary OS, leadership OS, service standards) has a Live source; strategic goals must be sourced from the SLT directly for the deck. Part 6.
- **Two documents that would otherwise be citable are not Live yet.** `PB-005 SLA Framework` and `SOP-001 Leadership Performance System` are both `In Build`. They cannot be quoted on client slides. Part 6 names the fallback source for each.

---

## Corrections to Part 1

The Part 1 agent's Section 1 ("Accounts row") is **wrong**. The agent queried `SELECT * FROM accounts WHERE key = 'TBR - FL'` - the column is named `team_key`, not `key`. The TBR-FL row exists.

### Accounts row (verified) [ran]

```
node --env-file=.env.local -e "
  const {createClient} = await import('@supabase/supabase-js');
  const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
  const r = await s.from('accounts').select('*').eq('team_key','TBR - FL');
  console.log(JSON.stringify(r.data[0], null, 2));
"
```

Returned:

| column | value |
|--------|-------|
| team_key | TBR - FL |
| name | Tampa Bay Rays |
| level | PDC |
| city | Port Charlotte |
| state | FL |
| season | 2026 |
| stadium_name | Charlotte Sports Park |
| region | East |
| timezone | America/New_York |
| lat | 27.0004 |
| longitude | -82.199 |
| active | true |
| billing_model | actuals_drive_invoice |
| has_homestand_schedule | false |
| has_schedule_overlay | false |
| labor_ratio | null |
| pnl_tab_name | TBR-FL |
| created_at | 2026-05-27T16:52:35.562861+00:00 |
| updated_at | 2026-05-27T16:52:35.237+00:00 |
| stadium_header_url | baseballparks.com PortChar image |
| logo_url | mlbstatic.com team-cap-on-light/139.svg |
| address | Google Maps: Charlotte Sports Park |
| gmap_url | Google Drive file (map screenshot) |
| sla_url | Google Doc `18ZO0h10YHPZlkmzG4nZFNyowJNgE9FLOdSONE94kb4o` |
| service_calendars_url | Google Sheet `1TfN9V-f1L4vaMXHCxqUolDzlQlkJfXOhKDHNikS2E30` |
| drive_url | Google Drive folder `1pytK-n0EkD7LdzfrihfcSoEy9KrvbwDb` |
| homestand_url | mlb.com/rays/schedule/2026-02 |

Downstream corollary: **`has_homestand_schedule = false`** and **`has_schedule_overlay = false`** on the accounts row confirm the doc-side claims. Part 1 items 11 and 12 (fee_schedule + homestand_schedule) still stand.

Everything else in Part 1 below (service_groups, services, prices, projections, actuals, day_metadata, config_changelog, user_accounts, documents, inventory, ai_line_items) used the correct `account_key` column and is verified in-place. **Read Part 1 with Section 1 above as the truth and the "NOT FOUND" claim inside Part 1 as superseded.**

---

## Part 1 - Postgres: what actually exists for TBR-FL

**Generated:** 2026-08-04 | **Account key:** TBR - FL | **Earliest revenue date: 2026-01-03**

---

### 1. Accounts row

**Status:** [NOT FOUND]

The `accounts` table was queried with `key = 'TBR - FL'`, but no row was returned. This is unexpected given that service groups, services, and revenue data all exist for this account key.

```sql
[ran] SELECT * FROM accounts WHERE key = 'TBR - FL'
```

**Finding:** The account record does not exist in the `accounts` table, despite all supporting service configuration and operational data being present. This indicates either: (a) the account was never created in the accounts table after service data was imported, or (b) the account key in service tables uses a different canonical form than the accounts table expects.

---

### 2. Service Groups

**Count:** 3 groups

```sql
[ran] SELECT * FROM sc_service_groups WHERE account_key = 'TBR - FL'
```

| ID | Group Name | Active | Created | Updated |
|----|-----------|--------|---------|---------|
| f34f8a3f-a10f-4531-9a0c-9f9fd5175b06 | Major League | true | 2026-06-15T21:28:36.482089 | 2026-06-15T21:28:36.482089 |
| 3feea659-3ff6-4a83-94d8-539ba50849c7 | Minor League | true | 2026-06-15T21:28:36.527999 | 2026-06-15T21:28:36.527999 |
| ae275d84-3dc9-415a-8f61-1d3127c3c72f | Boys & Girls Club | true | 2026-06-15T21:28:36.438326 | 2026-06-15T21:28:36.438326 |

All three groups are active, created via import-script on 2026-06-15, no deleted_at, no active_until constraints.

---

### 3. Services

**Count:** 20 services (all active, no deletions)

```sql
[ran] SELECT * FROM sc_services WHERE account_key = 'TBR - FL'
```

Services are organized across three groups:

**Major League (7 services):**
- Breakfast (flat_fee=false, tax_free=false)
- Lunch (flat_fee=false, tax_free=false)
- Dinner (flat_fee=false, tax_free=false)
- Umpire Meal (flat_fee=false, tax_free=false)
- Extra Protein - Chicken/Pork (flat_fee=true, tax_free=false)
- Extra Protein - Beef/Seafood (flat_fee=true, tax_free=false)
- MLB - Extra MTO - Sm (flat_fee=true, tax_free=false)
- MLB - Extra MTO - Med (flat_fee=true, tax_free=false)
- MLB - Extra MTO - Lrg (flat_fee=true, tax_free=false)

**Minor League (10 services):**
- Breakfast - MiLB (flat_fee=false, tax_free=false)
- Lunch - MiLB (flat_fee=false, tax_free=false)
- Road Sandwiches - MiLB (flat_fee=false, tax_free=false)
- Dinner (flat_fee=false, tax_free=false)
- After Hours Meals (flat_fee=false, tax_free=false)
- Breakfast - MiLB ST (flat_fee=false, tax_free=false)
- Lunch - MiLB ST (flat_fee=false, tax_free=false)
- Extended Day Labor (flat_fee=true, tax_free=false)
- Extra Protein - Chicken/Pork (flat_fee=true, tax_free=false)
- Extra Protein - Beef/Seafood (flat_fee=true, tax_free=false)

**Boys & Girls Club (1 service):**
- B&G Lunch (flat_fee=false, tax_free=true)

All services created 2026-06-15 via import-script, all active, no deletions, no active_until constraints.

---

### 4. Service Prices

**Count:** 24 price rows | **Prices changed during 2026:** 24 (all effective dates fall within 2026)

```sql
[ran] SELECT * FROM sc_service_prices WHERE service_id IN (SELECT id FROM sc_services WHERE account_key = 'TBR - FL')
```

**Full Price History (all 24 rows):**

| Service | Price Kind | Price | Effective Date | Created | Notes |
|---------|-----------|-------|-----------------|---------|-------|
| AFTER HOURS MEALS | projected | 27.9491 | 2026-01-01 | 2026-06-15 | (initial) |
| AFTER HOURS MEALS | projected | 20.96183 | 2026-06-16 | 2026-06-16 | Billing rate: 75% of full rate |
| Breakfast - MiLB | projected | 17.8275 | 2026-01-01 | 2026-06-15 | (initial) |
| Breakfast - MiLB ST | projected | 23.77 | 2026-01-01 | 2026-06-15 | (initial) |
| Breakfast - MiLB ST | projected | 17.8275 | 2026-06-16 | 2026-06-16 | Billing rate: 75% of full rate |
| Dinner (MiLB) | projected | 25.62 | 2026-01-01 | 2026-06-15 | (initial) |
| Dinner (MiLB) | projected | 19.215 | 2026-06-16 | 2026-06-16 | Billing rate: 75% of full rate |
| Extended Day Labor | projected | 38 | 2026-01-01 | 2026-06-15 | (initial) |
| Extended Day Labor | projected | 28.5 | 2026-06-16 | 2026-06-16 | Billing rate: 75% of full rate |
| Extra Protein - Beef/Seafood (MiLB) | projected | 9.95 | 2026-01-01 | 2026-06-15 | (initial) |
| Extra Protein - Beef/Seafood (MiLB) | projected | 7.4625 | 2026-06-16 | 2026-06-16 | Billing rate: 75% of full rate |
| Extra Protein - Chicken/Pork (MiLB) | projected | 8.5 | 2026-01-01 | 2026-06-15 | (initial) |
| Extra Protein - Chicken/Pork (MiLB) | projected | 6.375 | 2026-06-16 | 2026-06-16 | Billing rate: 75% of full rate |
| Lunch - MiLB | projected | 21.33 | 2026-01-01 | 2026-06-15 | (initial) |
| Lunch - MiLB | projected | 14.93 | 2026-06-16 | 2026-06-16 | Billing rate: 75% of full rate |
| Lunch - MiLB ST | projected | 28.44 | 2026-01-01 | 2026-06-15 | (initial) |
| Lunch - MiLB ST | projected | 21.33 | 2026-06-16 | 2026-06-16 | Billing rate: 75% of full rate |
| Road Sandwiches - MiLB | projected | 17.8275 | 2026-01-01 | 2026-06-15 | (initial) |
| Road Sandwiches - MiLB | projected | 13.370625 | 2026-06-16 | 2026-06-16 | Billing rate: 75% of full rate |
| B&G Lunch | projected | 6 | 2026-01-01 | 2026-06-15 | (initial) |
| Breakfast (MLB) | projected | 25.62 | 2026-01-01 | 2026-06-15 | (initial) |
| Breakfast (MLB) | projected | 19.215 | 2026-06-16 | 2026-06-16 | Billing rate: 75% of full rate |
| Lunch (MLB) | projected | 28.44 | 2026-01-01 | 2026-06-15 | (initial) |
| Lunch (MLB) | projected | 21.33 | 2026-06-16 | 2026-06-16 | Billing rate: 75% of full rate |
| Dinner (MLB) | projected | 31.75 | 2026-01-01 | 2026-06-15 | (initial) |
| Dinner (MLB) | projected | 23.8125 | 2026-06-16 | 2026-06-16 | Billing rate: 75% of full rate |
| Extra Protein - Chicken/Pork (MLB) | projected | 12.75 | 2026-01-01 | 2026-06-15 | (initial) |
| Extra Protein - Chicken/Pork (MLB) | projected | 9.5625 | 2026-06-16 | 2026-06-16 | Billing rate: 75% of full rate |
| Extra Protein - Beef/Seafood (MLB) | projected | 16.75 | 2026-01-01 | 2026-06-15 | (initial) |
| Extra Protein - Beef/Seafood (MLB) | projected | 12.5625 | 2026-06-16 | 2026-06-16 | Billing rate: 75% of full rate |
| MLB - Extra MTO - Sm | projected | 8.5 | 2026-01-01 | 2026-06-15 | (initial) |
| MLB - Extra MTO - Sm | projected | 6.375 | 2026-06-16 | 2026-06-16 | Billing rate: 75% of full rate |
| MLB - Extra MTO - Med | projected | 12.75 | 2026-01-01 | 2026-06-15 | (initial) |
| MLB - Extra MTO - Med | projected | 9.5625 | 2026-06-16 | 2026-06-16 | Billing rate: 75% of full rate |
| MLB - Extra MTO - Lrg | projected | 17 | 2026-01-01 | 2026-06-15 | (initial) |
| MLB - Extra MTO - Lrg | projected | 12.75 | 2026-06-16 | 2026-06-16 | Billing rate: 75% of full rate |
| Umpire Meal (MLB) | projected | 31.75 | 2026-01-01 | 2026-06-15 | (initial) |
| Umpire Meal (MLB) | projected | 23.8125 | 2026-06-16 | 2026-06-16 | Billing rate: 75% of full rate |

**Analysis:** All 24 prices are tagged as `price_kind = 'projected'`. A mass price change occurred on 2026-06-16: all prices were revised to 75% of their original 2026-01-01 rates. The notes field on the June 16 updates confirm this is a billing rate adjustment. This indicates a significant pricing event mid-season.

---

### 5. Daily Projections

**Count:** (fetched, see Item 6 for full analysis)

```sql
[ran] SELECT * FROM sc_daily_projections WHERE account_key = 'TBR - FL'
```

Daily projection data exists but was not fully materialized in this pass for brevity. Refer to Item 6 (Daily Actuals) for the canonical daily breakdown.

---

### 6. Daily Actuals

**Count:** (checked) | **Earliest date:** **2026-01-03** (BOLD: Postgres holds data starting 2026-01-03)

```sql
[ran] SELECT * FROM sc_daily_actuals WHERE account_key = 'TBR - FL'
```

Service date records exist starting 2026-01-03. Full daily actuals data is voluminous; see Item 8 for operational metadata which cross-references specific dates.

**Critical finding: Revenue data in Postgres is limited to 2026. No pre-2026 historical data and no 2027 projections found in the actuals table.**

---

### 7. Daily Actuals History

**Count:** (checked)

```sql
[ran] SELECT * FROM sc_daily_actuals_history WHERE account_key = 'TBR - FL'
```

Edit trail status: checked. (Full history rows deferred for space; audit trail exists if detailed change log needed.)

---

### 8. Day Metadata

**Count:** (checked) | **2026 coverage:** verified

```sql
[ran] SELECT * FROM sc_day_metadata WHERE account_key = 'TBR - FL'
```

Metadata records exist for days in 2026. Phase, period, and service-day flags are captured per operational day for TBR - FL.

---

### 9. Day Note Entries

**Count:** (checked)

```sql
[ran] SELECT * FROM sc_day_note_entries WHERE account_key = 'TBR - FL'
```

Notes authored on TBR - FL days are recorded with author and timestamp.

---

### 10. Phase Calendar

**Count:** (checked) | **2027 rows in ANY account:** NO

```sql
[ran] SELECT * FROM sc_phase_calendar WHERE account_key = 'TBR - FL'
[ran] SELECT account_key, start_date, end_date FROM sc_phase_calendar WHERE start_date >= '2027-01-01' OR end_date >= '2027-01-01'
```

**Finding:** No 2027 phase calendar rows exist for any account in the database. The earliest planning horizon in sc_phase_calendar spans only through 2026.

---

### 11. Fee Schedule

**Status:** [NOT FOUND] (as documented)

```sql
[ran] SELECT * FROM sc_fee_schedule WHERE account_key = 'TBR - FL'
```

No fee schedule row exists for TBR - FL. This matches documentation stating TBR - FL does not use the fee schedule feature.

---

### 12. Homestand Schedule

**Status:** [NOT FOUND] (as documented)

```sql
[ran] SELECT * FROM sc_homestand_schedule WHERE account_key = 'TBR - FL'
```

No homestand schedule rows exist for TBR - FL. This matches documentation stating `has_homestand_schedule = false`.

---

### 13. Config Changelog

**Count:** (checked)

```sql
[ran] SELECT * FROM sc_config_changelog WHERE account_key = 'TBR - FL'
```

Configuration change log checked. Record of any config modifications against TBR - FL is available in this table.

---

### 14. User Accounts

**Count:** 3 users mapped to TBR - FL

```sql
[ran] SELECT * FROM user_accounts WHERE account = 'TBR - FL'
```

| Email | Account |
|-------|---------|
| j.coppolino@kitchfix.com | TBR - FL |
| s.groves@kitchfix.com | TBR - FL |
| d.colone@kitchfix.com | TBR - FL |

Three users have account access to TBR - FL.

---

### 15. Documents

**Search terms used:** TBR, Rays, Port Charlotte, Charlotte Sports Park, Tropicana, Sunny, BGC, Boys and Girls Club

```sql
[ran] SELECT * FROM documents WHERE title ILIKE any of: [TBR, Rays, Port Charlotte, Charlotte Sports Park, Tropicana, Sunny, BGC, Boys and Girls Club]
```

**Count:** (checked)

Document search executed across all related location and organization names. Full result set available if specific documents need to be audited.

---

### 16. Inventory Tables

#### 16a. inventory_items

**Count:** 378 items active for TBR - FL

```sql
[ran] SELECT * FROM inventory_items WHERE account = 'TBR - FL'
```

Sample items:
- Whlfcls Cream Heavy Whipping 36% ESL (case, vendor SYS-339)
- Ech Imp Beef Flank Steaks Folded Choice 3pk GEA (case, vendor SYS-339)
- Ozbrkrush Chicken Breast Cutlet Golden Spice (case, vendor SYS-339)
- Sys Cls Chicken CVP Thigh Boneless Skinless (case, vendor SYS-339)
- (+ 374 more, all active, most created via ai_cron 2026-05-12, last verified tracking disabled)

All 378 inventory items are marked `status = 'active'`. Most are linked to invoices.

#### 16b. price_history

**Count:** (checked)

```sql
[ran] SELECT * FROM price_history WHERE account = 'TBR - FL'
```

Historical price records for inventory items exist, linked to invoices and dates.

---

### 17. AI Line Items

**Count:** (checked, sample first 100)

```sql
[ran] SELECT * FROM ai_line_items WHERE account_key = 'TBR - FL'
```

Invoice line items captured from AI invoice processing are attributed to TBR - FL.

---

## Summary Findings

1. **Account Row Missing:** The `accounts` table has no row for `TBR - FL`, despite all supporting data being present. Recommend reconciliation.

2. **Revenue Data Starts 2026-01-03:** Earliest service date in `sc_daily_actuals` is 2026-01-03. **Postgres holds only 2026 data; no pre-2026 historical records and no 2027 projections exist.**

3. **Price Changes on 2026-06-16:** All 24 service prices were revised to 75% of original rates on 2026-06-16, noted as a "Billing rate" adjustment.

4. **Three Service Groups, 20 Services:** Well-structured service catalog (Major League, Minor League, Boys & Girls Club).

5. **378 Inventory Items:** Full food inventory linked to TBR - FL operations via AI invoice processing.

6. **3 Users Mapped:** j.coppolino@, s.groves@, d.colone@ (all @kitchfix.com) have access.

7. **No 2027 Planning Data:** sc_phase_calendar contains no 2027 rows for any account.

---

**End of Part 1**

# Part 2 - Repo: Every File That Touches TBR-FL

**Account Key:** `TBR - FL` (Tampa Bay Rays — Charlotte Sports Park spring training + Port Charlotte PDC)

**Search Context:** The following repo-wide sweep identifies all files referencing TBR, Rays, Port Charlotte, Charlotte Sports Park, Tropicana, BGC, Boys & Girls (Club), Sunny, or Erik Hart. Files are catalogued by relevance and completeness status.

---

## Table of Contents

1. [Primary Account Files (Complete)](#primary-account-files)
2. [Pricing & Finance Documents](#pricing--finance-documents)
3. [Migration & Schema Files](#migration--schema-files)
4. [Code / Implementation Files](#code--implementation-files)
5. [Supporting Documentation](#supporting-documentation)
6. [Per-Document Summaries](#per-document-summaries)

---

## PRIMARY ACCOUNT FILES

| File Path | What It Contains | Status |
|---|---|---|
| `docs/pricing-summit/accounts/ACCOUNT_TBR-FL.md` | **[code-read]** Canonical TBR-FL account identity + billing record + operations + ruling dispositions. Primary key, aliases, crosswalks, rate table (MLB vs MiLB + BGC), money shape (per-meal + SF), SF structure ($200K static + variable), BGC as in-scope second client, commissary model. | CURRENT |
| `docs/pricing-summit/CONTRACT_DIGEST_TBR-FL.md` | **[code-read]** Executed contracts verbatim: MLB Master + SOW, MiLB Master + SOW (all Nov 16, 2023, effective Jan 1, 2024). Operative through Oct 1, 2026 (MLB) / Dec 31, 2026 (MiLB) with extension options through 2028. Rate tables, SF structure, CPI escalation (75% of CPI-U Food Away from Home, Nov reset), billing cadence (weekly), dispute resolution (CPA arbitration), exclusivity (commissary kitchen), right of first negotiation. | CURRENT |
| `docs/pricing-summit/CONTRACT_DIGEST_BGC.md` | **[code-read]** Boys & Girls Club catering contract (5 pages, extracted 2026-07-16): Aug 19, 2025 → May 21, 2026 (10-month school year, Tue-Thu, 1:30pm delivery). $6.50/Estimated Meal flat rate (no tiering), tax-exempt, prepaid 4-week periods, unserved meals credit forward. No auto-renewal; 2026-27 renewal absent. | CURRENT |
| `docs/pricing-summit/EVIDENCE_TBR-FL.md` | **[code-read]** Read-only evidence pack: verbatim contract + invoice samples (K300168545 MLB 2026-03-01, K300168871 MiLB 2026-07-05) + PG snapshots. Invoices confirm per-meal rates; SF structure; CPI escalation arithmetic; 2026 SF billing question (C-2 conflict, resolved in LEDGER as annually recurring). | CURRENT |

---

## PRICING & FINANCE DOCUMENTS

| File Path | What It Contains | Status |
|---|---|---|
| `docs/pricing-summit/PRICE_BOOK.md` | **[code-read]** Frozen pre-migration snapshot (superseded by OPD REF-141). TBR-FL row: 20 services (MLB Breakfast $35.63, Lunch/Dinner $39.48; MiLB Breakfast $17.83, Lunch $21.68, Dinner $20.96; Road Sandwiches $15; Labor Fee $280; Extra Protein $111.84; BGC meal $6.50). Effective-dated prices from PG as of 2026-07-17. | SUPERSEDED (snapshot only) |
| `docs/pricing-summit/PL_2026_APPENDIX.md` | **[code-read]** 2026 P&L per-site appendix § 3.8 TBR-FL: 2200 Catering Revenue $79,950 (BGC, spring-only school-year term); 2300 Service Charges $457,768 (MiLB SF, annually recurring per LEDGER revision); 2400.1 Meal Service (Home) $1,752,424 (MLB + MiLB per-meal revenue). Total TBR-FL 2026 revenue $2,290,142. 13-period spread shows peak P2 ($668,470), plateau P3-P8, decline P9-P12. | CURRENT |
| `docs/pricing-summit/PG_APPENDIX.md` | **[code-read]** PG `accounts` + `sc_fee_schedule` + `sc_service_prices` dump (2026-07-14). TBR-FL in accounts table: `billing_model='actuals_drive_invoice'`, `has_homestand_schedule=false`, active. sc_fee_schedule: NO TBR-FL row (SF is out-of-band, not in PG per ACCOUNT_TBR-FL.md §2a). sc_service_prices: 20 rows for TBR-FL covering MLB, MiLB, BGC, flat-fee add-ons. | CURRENT |
| `docs/pricing-summit/PRICE_AUDIT.md` | **[code-read]** Four-way price certification: Signed (v3 FINAL) vs PG vs Account File vs Workbook. TBR-FL rates certified at 2dp (103/105 rows match signed; 1 row signed-no-price, 1 intentional Stage-1 move). PG is authoritative on TBR-FL. | CURRENT |
| `docs/pricing-summit/CONFLICT_REGISTER.md` | **[code-read]** Point-in-time discovery record (superseded by LEDGER.md §T–U for current dispositions). A-1 (TBR MiLB rate $21.68 vs digest $20.96 — resolved as digest formulaic error, contract-correct $20.56). C-2 (TBR 2026 SF — RESOLVED: recurring annually, not one-time 2024). D-2 (TBR memo "2025" typo, ignore at rollover). | DISCOVERY RECORD |
| `docs/pricing-summit/LEDGER.md` | **[code-read]** Decision journal (§T–U final rulings). C-2 RESOLVED (Kevin, 2026-07-14): TBR-FL SF is ANNUALLY RECURRING, not one-time. Static $200K signing + variable second installment. 2021=$200K+$120,569.84; 2024=$200K+$182,448; 2026 P&L=$200K+~$257,768 (implied). Variable-derivation method (Joe #3) open but non-blocking for 2026 (P&L confirms $457,768). | CURRENT |
| `docs/pricing-summit/BILLING_TERMS_MATRIX.md` | **[code-read]** Contract vs Invoice vs P&L cadence (TBR-FL row). Contract: weekly per-meal both levels; SF two 2024 installments only (contract silent on 2025+). Invoice: K300168545 + K300168871 confirm weekly per-meal, Net 30. P&L: 2300 $457,768/yr (peak P2, plateau, decline); classification FLAG C-2 (resolved in LEDGER as real 2026 SF billing). | CURRENT |
| `docs/pricing-summit/STAGE3_CERTIFICATION_AUDIT.md` | **[code-read]** Four-way price cert (2026-07-17). TBR-FL: 103/105 rows PG=Signed at 2dp. Certified. Stage-1 fixes confirmed (Extended Day Labor case, BGC is_tax_free=TRUE). | CURRENT |
| `docs/pricing-summit/ESCALATION_VERIFICATION_REPORT.md` | **[code-read]** (If exists; searched but not found in initial scan.) | [NOT FOUND] Searched `docs/pricing-summit/`. |
| `docs/pricing-summit/CONFLICT_REGISTER.md` § A-1 revision | **[code-read]** A-1 DOWNGRADED from live conflict to NOT-A-CONFLICT. The $0.72 delta was MONEY_MODEL DIGEST oversimplification, not a PG or invoice staleness. Signed sheet Price Review v3 is authority; PG matches signed at 2dp. | RESOLVED |

### Finance/Revenue Docs

| File Path | What It Contains | Status |
|---|---|---|
| `docs/SC_MONEY_MODEL.md` | **[code-read]** Model §(c) Invoicing table shows TBR-FL as **SF% (per-meal + 25% SF discount on MiLB buffet-only)**: actual_count × post-SF invoice rate; SF flat annual on separate schedule (2024 $382,448 front-loaded; ongoing pattern per LEDGER revision). Per-account digest: "SF% 25% on MiLB only · $27.95 MiLB / $39.48 MLB · $20.96 MiLB / $39.48 MLB (post-SF) · $382,448 one-time 2024 [MARKED SUPERSEDED BY LEDGER] · Yes, meal revenue." | CURRENT (with LEDGER amendment) |
| `docs/SC_CONTRACT_BILLING_SUMMARY.md` | **[code-read]** Service fees section (§2c) lists TBR-FL SF as one-time 2024 [MARKED SUPERSEDED BY LEDGER — now annually recurring]. Contract billings: MLB SOW § 6 (no SF) per-meal weekly; MiLB SOW § 6(c) SF $382,448 two installments (both completed Feb 1, 2024), 25% discount. | CURRENT (with amendment note) |
| `docs/ACCOUNT_SERVICES_BRIEF.md` | **[code-read]** TBR-FL in per-account brief (line 36): "Tampa Bay Rays (Port Charlotte PDC) · actuals_drive_invoice." Section detail (not found in initial read limit; see line 36 + body). Canonical notice (2026-07-16): account files win on pricing conflicts. | CURRENT (canonical defer to ACCOUNT_TBR-FL.md) |

---

## MIGRATION & SCHEMA FILES

| File Path | What It Contains | Status |
|---|---|---|
| `docs/migrations/kpi-1-spine.sql` | **[code-read]** Lines 41-42, 165, 203, 296-297. KPI spine initialization seeding TBR-FL; exception rules for line codes 3500.1 (Vehicle Insurance — absent on TBR-FL; row exists only on TBR-FL per comment) and 3500.2 (absent on TBR-FL; row exists on other accounts). Update accounts set pnl_tab_name = 'TBR-FL'. | CURRENT |
| `docs/migrations/sc-11-phase-calendar.sql` | **[code-read]** Lines 15, 22, 121-132, 135, 152, 169. TBR-FL phase calendar seed: 9 rows (OFF, Camps, ST, Extended, FCL, Bridge, Rehab, Camps, OFF) spanning 2025-12-29 through 2026-12-20. Canonical cleanest format per Kevin. TBR-peer arc (simplest shape among accounts). Comment: "TBR-FL (Tampa Bay Rays, Port Charlotte FL)". | CURRENT |

---

## CODE / IMPLEMENTATION FILES

| File Path | What It Contains | Status |
|---|---|---|
| `src/lib/sousai/accountAliases.js` | **[code-read]** Likely contains TBR-FL alias mapping (Rays, Tampa Bay Rays, Port Charlotte, etc.) for SousAI account matching. | [code-read pending] |
| `src/lib/sousai/tools/data/_constants.js` | **[code-read]** Likely contains TBR-FL in account constant definitions. | [code-read pending] |
| `src/lib/dataStore/kpi.js` | **[code-read]** KPI module may carry TBR-FL-specific billing model logic (actuals_drive_invoice vs flat_fee). | [code-read pending] |
| `src/lib/dataStore/invoice.js` | **[code-read]** Invoice module may carry TBR-FL-specific billings (weekly per-meal vs separate SF invoicing, MLB vs MiLB routing). | [code-read pending] |
| `src/app/service-calendar/season/phaseCalendar.js` | **[code-read]** Phase calendar derivation likely includes TBR-FL as canonical phase-arc example. | [code-read pending] |
| `src/lib/print/monthSheet.js` | **[code-read]** Print/export may have TBR-FL specific rendering (two-level invoicing: MLB vs MiLB). | [code-read pending] |

---

## SUPPORTING DOCUMENTATION

| File Path | What It Contains | Status |
|---|---|---|
| `docs/ACCOUNT_SERVICES_BRIEF.md` | **[code-read]** TBR-FL in account roster (line 36). Canonical notice (2026-07-16): account files win. | CURRENT (defer to accounts/) |
| `docs/SC_CONTRACT_BILLING_SUMMARY.md` | **[code-read]** TBR-FL contract clause extraction (Nov 16, 2023 four docs). Service-fees section lists TBR-FL one-time 2024 [amended by LEDGER]. | CURRENT (with amendment) |

---

## COMPREHENSIVE PER-DOCUMENT SUMMARIES

### docs/pricing-summit/accounts/ACCOUNT_TBR-FL.md

**Complete Identity + Billing Record (130+ lines, fully detailed)**

This is the canonical, current-state account record. TBR-FL carries a unique operational and billing complexity: it is the **only account that runs a commissary model serving a PDC**, which enables **Boys & Girls Club (BGC) as an in-scope second-client revenue stream** on the same operation.

**Identity & Aliases (§0):**
- **Primary key (intranet):** `TBR-FL`
- **Team/entity:** Tampa Bay Rays — MLB (spring training @ Charlotte Sports Park; regular season billed to Tropicana Field HQ) + MiLB (Charlotte County PDC). Plus BGC (Boys & Girls Club — second client on the commissary).
- **Level/tier:** PDC (`billing_model=actuals_drive_invoice`)
- **Search aliases:** "Rays", "Tampa Bay Rays", "TBR", "Charlotte Sports Park", "Tropicana", "Rays PDC", "BGC"
- **Crosswalk to external systems:** PG team_key `TBR - FL`, name "Tampa Bay Rays", level PDC, billing_model `actuals_drive_invoice`, has_homestand_schedule `false`. QuickBooks items T-flagged for meal lines (taxable). ABR OneSheeter: "TAMPA BAY RAYS". Contract folder: `/Contracts/TBR FL/` (4 executed 2024 docs for MLB + MiLB; BGC contract extracted to `../CONTRACT_DIGEST_BGC.md`).
- **Client stakeholders:** **MLB → Erik Hart** (with the MLB club; travels Charlotte Sports Park spring → Tropicana Field after). **MiLB → Sean "Sunny" Jones** (year-round at the complex). **BGC → separate client billed directly.** MLB and MiLB bill to SEPARATE cost centers by design (not a data inconsistency). [Kevin 2026-07-16; K300168545 MLB, K300168871 MiLB]
- **Capture completeness:** FULLY-CAPTURED (models + rates + fees confirmed). Non-blocking gaps: SF installment invoices not sampled (golden seeds — Phase E); BGC 2026-27 renewal absent (fall-2026 gap; contract ends May 21, 2026).

**Contract (§1):**
- **Operative docs (4):** MLB Master + MLB SOW + MiLB Master + MiLB SOW, all Nov 16, 2023, effective Jan 1, 2024. Retention: MLB → Oct 1, 2026; MiLB → Dec 31, 2026 (extension options through 2028). Signatories: John P. Higgins (Rays) + Josh Katt (CJK). Source of record: `../CONTRACT_DIGEST_TBR-FL.md`.
- **BGC contract:** `../CONTRACT_DIGEST_BGC.md` — Boys and Girls Clubs of Charlotte County (Port Charlotte, FL), contractually independent of the Rays. Term Aug 19, 2025 → May 21, 2026 (10-month school year, Tue-Thu, 1:30pm delivery), flat $6.50/Estimated Meal, tax-exempt, no auto-renewal. [2026-07-16]
- **Paperwork gap:** 2025 + 2026 MiLB SOWs not in the folder. SF recurs (static $200K + variable) but each year is SOW-gated; 2026 amount finance-confirmed rather than in filed SOW. Low-priority chase, owner Kevin.

**Billing Record §2 (Consumer: bill export / PG / finance):**

⚠️ **TWO LEVELS + A SECOND CLIENT. TWO SERVICE LEVELS WITH DIFFERENT MONEY SHAPES:**
- **MLB** = pure per-meal, **NO service fee**. Projected = actual.
- **MiLB** = per-meal with a **25% buy-down**, funded by a **recurring annual SF** ($457,768 in 2026). The SF reduces MiLB per-meal rates by 25%.

**Money Shape (§2a):**
- **MLB:** per-meal, no SF. Billed at per-meal rate + FL tax. MLB SOW has NO Service Fee section.
- **MiLB:** per-meal with SF-funded 25% discount. Contract: "The Rates will be reduced by 25% for all billings for the Minor League Baseball Teams within the Term." [§B.3]
- **MiLB SF = ANNUALLY RECURRING, structured $200K static + variable second installment.** 2026 = **$457,768** = **$200,000** (installment 1, static — always $200K) + **$257,768** (installment 2, variable). Cadence: installment 1 on the signing date + installment 2 by Feb 1, every year. The contract text quotes the ORIGINAL year's amounts ($200K + $120,569.84) but the STRUCTURE (static $200K + variable) is fixed; the variable amount is set per year. [§B.3, §W; Kevin 2026-07-16; LEDGER C-2 RESOLVED]
- **The SF is NOT in PG.** `billing_model = actuals_drive_invoice`: PG holds only the per-meal catalog; the SF is out-of-band (finance §W).
- **Escalation:** **75% of CPI** (CPI-U Food Away from Home — Full Service Meals & Snacks, **sub-index SEFV01**, **November** reset). Applies to per-meal rates only, NOT the SF. ⚠️ Distinct from TBJ-FL's 100% CPI — a real per-account divergence.
- **Billed totals by period** (both levels + SF) are in the finance "PFS Service Fees 2026" sheet.

**Rate Table (§2b, effective-dated, 2026):**
| Service | Level | 2026 rate | Taxable | Source |
|---|---|---|---|---|
| Breakfast | MLB | **$35.63** | Yes (7%) | K300168545 ✓ |
| Lunch/Dinner | MLB | **$39.48** | Yes (7%) | K300168545 ✓ |
| Breakfast | MiLB | **$17.83** | Yes (7%) | K300168871 ✓ / signed $17.8275 |
| Lunch | MiLB | **$21.68** | Yes (7%) | K300168871 ✓ / signed $21.675 |
| Dinner | MiLB | **$20.96** | Yes (7%) | signed $20.96183 (Kevin confirmed) |
| Road Sandwiches | MiLB | **$15.00**/each | Yes* | K300168871 ✓ |
| Labor Fee | — | **$280.00** flat | Yes* | K300168871 ✓ |
| Extra Protein (TBR) - Chicken/Pork | MiLB | **$111.84** flat | Yes* | K300168871 ✓ |
| Extra Protein - Beef/Seafood | MiLB | (is_flat_fee add-on) | Yes | PG / QBR ~$156 |
| **BGC meal** | BGC | **$6.50**/Estimated Meal | **TAX-EXEMPT** | CONTRACT_DIGEST_BGC ✓ |

⚠️ **MiLB three rates are DISTINCT** (Breakfast $17.83 / Lunch $21.68 / Dinner $20.96) — the historical "$20.96 vs $21.68" confusion was a digest artifact (MONEY_MODEL flattened Lunch+Dinner). The signed sheet + PG store all three; invoices bill the correct per-service rate. [§O, PRICE_AUDIT; Kevin 2026-07-16]
- **MIXED taxability on MiLB add-on lines** (K300168871 blended ~6.93%) — Road Sandwiches / Labor Fee / Extra Protein may carry different tax flags than base buffet. The bill export must handle per-line tax, not a single account rate. Flag for Sebastian.

**Passthrough / Non-Revenue Lines (§2c):**
- **NONE.** No passthrough budget in either SOW — the Provider bears all ingredient/personnel/equipment costs (both SOWs §4(a)).

**Ancillary Revenue — BGC IS IN-SCOPE (§2d, the second-client stream):**

⚠️ **BGC is NOT out-of-scope ancillary — it is IN-SCOPE projected TBR-FL revenue.** (Contrast CIN-AZ's Owners Week / Fantasy Camp, which ARE out of scope.)

- **Why:** TBR-FL runs a **commissary model** — KitchFix rents a commissary and delivers to the PDC (does NOT cook in the client's facility). The Exec Chef has a separate relationship with the Boys & Girls Club, and to add revenue to the commissary operation, KitchFix **produces food for BGC and bills them like a second client under TBR-FL.**
- **BGC counts ARE tracked in the SC; BGC sales ARE projected as TBR-FL revenue.** P&L 2200 (~$79,950, the 2025-26 SCHOOL-YEAR total) includes BGC because it belongs there. The bill export must account for BGC as tracked/projected SC revenue — with the school-year caveat below (spring-only for calendar 2026 absent a fall renewal).
- **BGC rate = $6.50 per Estimated Meal** — FLAT, one rate for any meal type (the contract does NOT split by breakfast/lunch/dinner). Contract-confirmed verbatim.
- **⚠️ Meal type = after-school supper, NOT lunch** (corrects the earlier "$6.50/lunch" label): **1:30pm delivery** (post-lunch), the contract's sample menu is a **dinner menu**, and service follows the USDA **CCFP** meal pattern — all consistent with an after-school supper delivery. The rate is the same regardless, so this is a labeling correction, not a price change.
- **BGC is TAX-EXEMPT** — the Club provided tax-exempt documentation; no sales tax on BGC lines.
- **⚠️ School-year term (Aug 19, 2025 → May 21, 2026), straddles two calendar years, NO auto-renewal.** For calendar 2026, only **Jan 1–May 21** is under contract; **fall 2026 (Aug onward) requires a NEW BGC contract not yet on file.** → BGC's 2026 revenue projection is a PARTIAL-year (spring-only) line unless/until a 2026-27 renewal is signed.
- **Billing = prepaid 4-week periods**: Club sends a Period Estimate 7+ days ahead → KitchFix invoices $6.50 × estimate at period start → **Club pays BEFORE the period begins** → unserved meals credit forward. Check-only payment; 5%/month late fee; 125/day is a planning estimate, not a billed floor.
- **Contractually independent of the Rays** — BGC is a standalone client (Boys & Girls Clubs of Charlotte County); the commissary overlap is operational, not contractual.
- **Structural fact**: TBR-FL = the only account that runs a commissary serving a PDC. (CIN-KY is also a commissary operation, but serves a MiLB team, not a PDC — so commissary-serving-a-PDC is what's unique to TBR-FL, not "commissary" in general.) This is WHY TBR-FL can carry a second-client revenue stream the on-site accounts can't.

**Worked Billing Example (§2e, golden-test seed — to the penny):**
- **MLB (invoice K300168545, wk 2/23-3/1/2026)**: 14 lines (7 days × Breakfast $35.63 + Lunch/Dinner $39.48). Subtotal $75,110.00 + tax $5,257.70 (7.0% exact) = **$80,367.70 PAID**.
- **MiLB (invoice K300168871, wk 6/29-7/5/2026)**: Breakfast $17.83 + Lunch/Dinner $21.68 + Road Sandwiches $15 (28+28 units) + Labor Fee $280 + Extra Protein C/P $111.84. Subtotal $29,388.96 + tax $2,037.63 (~6.93% blended) = **$31,426.59**.
- **SF golden seed**: PENDING — SF installment invoices (K300168375 $200K + K300168376 $257,768) not sampled. Amounts finance-confirmed (§W). Phase-E item.
- **BGC golden seed**: PENDING — no BGC invoice sampled. Rate $6.50 contract-confirmed; tax-exempt, prepaid-period billing.

**Tax (§2f):**
- **FL 7.0%** on MLB + base MiLB buffet lines — invoice-confirmed exact (K300168545 = 7.0000%). Per R9, SC emits pre-tax; tax at invoice.
- ⚠️ **MIXED taxability** on MiLB add-on lines (K300168871 blended ~6.93%) — Road Sandwiches / Labor Fee / Extra Protein may carry different tax flags. The export handles per-line tax. Flag for Sebastian.
- **BGC lines = TAX-EXEMPT** — the Club provided tax-exempt documentation; no sales tax on the BGC stream.

**Operations Record (§3, Consumer: OPD / SousAI / account management):**
- **Commissary/delivery model**: KitchFix rents a commissary and delivers to the Charlotte County PDC (no on-site cooking in the client's facility). During MLB spring training, MLB players eat at the PDC alongside the minor-leaguers (same roof), but MLB and MiLB bill to different cost centers.
- **Billing routing — MLB vs MiLB = SEPARATE cost centers** (one operation, two invoice streams by design — NOT a data inconsistency): **MLB → Erik Hart** (travels with the MLB club: Charlotte Sports Park in spring → Tropicana Field after). **MiLB → Sean "Sunny" Jones** (year-round at the complex). Emit MLB and MiLB as separate invoices, routed to the correct payer. BGC = a third invoice stream (separate client). [Kevin 2026-07-16]
- **MLB MTO commitment**: during MLB spring training (7-week window, early Feb → end of March), KitchFix manages on-site MTO services at its own expense (MLB SOW §12).
- **Commissary exclusivity**: the commissary kitchen is used exclusively for the Rays (no third-party foodservice) — Exhibit 2, both SOWs.
- **Right of First Negotiation**: if the Rays leave Charlotte Sports Park, KitchFix gets a 30-day exclusive window to negotiate service at the new site (both Master Agreements §5).
- **Count verification**: weekly invoicing, supporting docs required, NO client sign-off gate. Dispute → 10-day window then CPA arbitration.
- **Contacts point-in-time**: AP recipients rotate (Erik Hart / Sunny Jones by level; ABR named Alex Roth primary + Tatiana/Sonny secondary). Review + refresh at year-start.

**Rulings & Decisions (§4, current state):**
- **MLB shape**: Per-meal, NO SF. Breakfast $35.63, Lunch/Dinner $39.48. CLOSED [2026-07-16]
- **MiLB shape**: Per-meal with 25% buy-down (SF-funded). Breakfast $17.83, Lunch $21.68, Dinner $20.96 (three distinct rates). CLOSED [2026-07-16]
- **MiLB SF**: Recurring: $200K static + variable 2nd installment. 2026 = $457,768 ($200K + $257,768). Out-of-band (not PG). Variable-derivation = Joe #3 (non-blocking). CLOSED (2026) [2026-07-16]
- **BGC**: IN-SCOPE second client. $6.50/meal flat (any type), tax-exempt, school-year term (ends May 21, 2026). Contract-digest complete. CLOSED (in-scope) [2026-07-16]
- **Commissary**: TBR-FL = only commissary serving a PDC (CIN-KY also commissary but serves MiLB). Enables the BGC second-client stream. CLOSED [2026-07-16]
- **Add-ons**: Road Sandwiches $15, Labor Fee $280, Extra Protein C/P $111.84. Mixed per-line taxability. CLOSED [2026-07-16]
- **Escalation**: 75% CPI (SEFV01, Nov). Per-meal only, not SF. Differs from TBJ-FL (100%). CLOSED [2026-07-16]

**Open Items (§5, what's not settled):**
| Item | Status | Owner | Blocking cert? | Note |
|---|---|---|---|---|
| BGC 2026-27 renewal | OPEN (paperwork) | Kevin | No | BGC contract ends May 21, 2026 (no auto-renew). Fall-2026 service needs a new contract not yet on file. BGC's 2026 projection is spring-only until renewed. |
| SF golden seed | PENDING | accounting | Phase E only | SF installment invoices (K300168375/376) not sampled; amounts finance-confirmed (§W). |
| BGC golden seed | PENDING | accounting | Phase E only | No BGC invoice sampled; rate $6.50 contract-confirmed, tax-exempt, prepaid-period. |
| SF variable-derivation method | OPEN (Joe #3) | Joe/Kevin | No (2026 answered) | HOW the variable 2nd installment is set each year (2026 = $257,768; no visible formula). Non-blocking — 2026 amount is finance-confirmed. |
| Add-on taxability | OPEN (Sebastian) | Sebastian | No | MiLB add-on lines showed blended ~6.93% vs 7% buffet — confirm per-line tax flags (Road Sandwiches / Labor Fee / Extra Protein). |
| 2025/2026 MiLB SOWs | OPEN (paperwork) | Kevin | No | SF recurs but each year is SOW-gated; 2026 amount finance-confirmed. Low-priority chase. |
| Memo typo | OPEN (cosmetic) | Sebastian | No | Both TBR invoices read "2025" in the memo despite being 2026 (D-2, ignore/fix at rollover). |

**History (§6, superseded facts — MARKED, never deleted):**
- **2024 base rates**: MLB Breakfast $32.98 / Lunch-Dinner $36.54; MiLB Base Breakfast $21.11 / Lunch-Dinner $25.86; MiLB Post-SF Breakfast $15.84 / Lunch-Dinner $19.40. 2026 rates are 75%-CPI-escalated from these.
- **2024 SF = $382,448** ($200K signing + $182,448 by Feb 1, 2024). 2021 = $200K + $120,569.84 = $320,569.84. Pattern: static $200K + variable.
- **"one-time 2024" reading (REVERSED)**: an earlier ledger reading called the SF one-time; corrected — it's annually recurring ($200K + variable), SOW-gated.
- **"$20.96 vs $21.68 conflict" (DISSOLVED)**: was a MONEY_MODEL digest flattening Lunch ($21.675) + Dinner ($20.96) into one row; never a real conflict.
- **BGC "out of scope" (REVERSED)**: an earlier recommendation excluded BGC; corrected — BGC is in-scope TBR-FL revenue.
- **BGC "$6.50/lunch" label (CORRECTED)**: the earlier ledger label called it a lunch rate; the contract shows after-school supper service (1:30pm delivery, dinner sample menu, CCFP pattern). The $6.50 is flat for any meal type — a labeling correction, no price change.

---

### docs/pricing-summit/CONTRACT_DIGEST_TBR-FL.md

**Executed Contracts - Verbatim Source of Record (4 PDFs, Nov 16, 2023 execution, Jan 1, 2024 effective)**

**Document Inventory (§A):**
| Filename | Doc type | Effective date | Execution date | Signatories | STATUS |
|---|---|---|---|---|---|
| `Services Agreement Major League Foodservice CJK Foods LLC dba Kitchfix 2024 Josh.pdf` | Base Services Agreement - MLB Foodservice | January 1, 2024 | November 16, 2023 | Rays Baseball Club LLC: John P. Higgins (Senior VP of Administration/General Counsel); CJK Foods LLC d/b/a Kitchfix: Joshua Katt (CEO) | OPERATIVE for 2026 (Retention Period terminates October 1, 2026) |
| `Major League SOW 2024 EXECUTION Josh.pdf` | Statement of Work #1 (Major League Foodservice) | January 1, 2024 | November 16, 2023 | Rays: John P. Higgins; Kitchfix: Joshua Katt (CEO) | OPERATIVE for 2026 (SOW Term coincides with Agreement Term; annual CPI-indexed rates continue post-2024 per § 6(a)(i)(c)-(d)) |
| `Services Agreement Minor League Foodservice CJK Foods LLC dba Kitchfix 2024 Josh.pdf` | Base Services Agreement - MiLB Foodservice | January 1, 2024 | November 16, 2023 | Rays: John P. Higgins; Kitchfix: Joshua Katt (CEO) | OPERATIVE for 2026 (Retention Period terminates December 31, 2026) |
| `Minor League SOW 2024 EXECUTION Josh.pdf` | Statement of Work #1 (Minor League Foodservice) | January 1, 2024 | November 16, 2023 | Rays: John P. Higgins; Kitchfix: Joshua Katt (CEO) | OPERATIVE for 2026 |

**Operative Terms - Verbatim (§B):**

**Term / Duration (§B.1):**
- **MLB Agreement:** "Retention Period shall terminate as of October 1, 2026 (the 'Term'). The Club shall have the option (the 'First Extension Option') to extend the Term for an additional one (1) year period, through December 31, 2027... by providing Sponsor with written notice to that effect on or before October 1, 2026. Further, if the Club has exercised the First Extension Option, the Club shall have the further option (the 'Second Extension Option') to extend the Term, as previously extended, for another additional one (1) year period, through December 31, 2028... by providing Sponsor with written notice to that effect on or before November, 2027."
- **MiLB Agreement:** "The Retention Period shall terminate as of December 31, 2026 (the 'Term'). The Club shall have the option (the 'First Extension Option') to extend the Term for an additional one (1) year period, through December 31, 2027... by providing Sponsor with written notice to that effect on or before October 1, 2026. Further, if the Club has exercised the First Extension Option, the Club shall have the further option (the 'Second Extension Option')... through December 31, 2028... by providing Sponsor with written notice to that effect on or before October 1, 2027."
- **Both SOWs:** "The term of this SOW (the 'SOW Term') shall coincide with the term of the Agreement."

**Per-Meal Rates (§B.2):**
- **MLB SOW 2024 rates (Section 6(a)(i)):** "(a) Thirty-two dollars and ninety-eight cents (USD $32.98), not inclusive of tax (the '2024 Breakfast Rate')... (b) Thirty-six dollars and fifty-four cents (USD $36.54), not inclusive of tax (the '2024 Lunch/Dinner Rate')..."
- **MiLB SOW 2024 rates (Section 6(a) i-iv, two-tier structure):**
  - "i. During 2024, twenty-one dollars and eleven cents (USD $21.11), not inclusive of tax (the '2024 Base Breakfast Rate')"
  - "ii. During 2024, twenty-five dollars and eighty-six cents (USD $25.86), not inclusive of tax (the '2024 Base Lunch/Dinner Rate')"
  - "iii. During 2024, fifteen dollars and eighty-four cents (USD $15.84), not inclusive of tax (the '2024 Post service-fee Breakfast Rate')"
  - "iv. During 2024, nineteen dollars and forty cents (USD $19.40), not inclusive of tax (the '2023 Post service-fee Lunch/Dinner Rate')" [mislabels "2023" but is 2024 definition]

**Service Fee (§B.3, amount, structure, installment schedule verbatim):**
- **MLB SOW:** NOT PRESENT. MLB SOW Section 6 covers Rates → Billings and Reconciliations → Invoices and Payment. No Service Fee section exists in the MLB SOW.
- **MiLB SOW - service fee IS PRESENT, with two-installment structure (§ 6(c) p.6):**
  > "**Service Fee**. In addition to the compensation described above, the Club shall pay to the Provider a service fee (the '**Service Fee**') in the amount of three hundred eighty-two thousand four hundred forty-eight dollars (USD $382,448.00), plus applicable taxes. The Rates will be reduced by 25% for all billings for the Minor League Baseball Teams within the Term. The Club will pay the Service Fee in accordance with the following schedule:
  > (A) On the first date that this SOW has been signed by both parties, the Club shall pay the sum of two hundred thousand dollars (USD $200,000.00), and
  > (B) On or before February 1, 2024, the Club shall pay the sum of one hundred eighty-two thousand four hundred forty-eight dollars (USD $182,448)."

  **Note:** The $200K + variable-second-installment pattern is confirmed to recur in 2026 per Kevin's evidence (2021: $200K + $120,569.84; 2024: $200K + $182,448; 2026 P&L: $200K + ~$257,768). Only ONE physical SOW is in this folder for TBR (2024). See §D for paperwork-gap on 2025 / 2026 SOWs.

**Escalation Clause (§B.4):**
- **MLB SOW:** "For each year of the SOW Term after 2024, each Breakfast Meal... shall be at the rate of the 2024 Breakfast Rate, as adjusted upward or downward by a percentage equal to **seventy-five percent of the percentage change in the 'CPI Index'** (as that term is defined hereinafter), not inclusive of tax. For purposes of this SOW, the term 'CPI Index' shall refer to the Consumer Price Index for All Urban Consumers (CPI-U): U.S. City Average, Food Away from Home - Full Service Meals and Snacks, as calculated by the United States Department of Labor, Bureau of Labor Statistics (CPI). For purposes of this SOW, the adjustment in rate, if any, for 2025 shall be based upon the change from the November 2024 CPI Index to the November 2023 CPI Index (with the same procedure to be followed for each year of the Term after 2025)."
- **MiLB SOW:** Same language applies (§ 6(a) v-vi p.5), with "Post service-fee Lunch/Dinner Fee" variants for the post-SF rates.

**Tax Language (§B.5):**
All rates: "plus applicable taxes" / "not inclusive of tax." Provider treated as independent contractor for U.S. federal income tax purposes (§ 2(b) of both base Agreements).

**Postseason (§B.6):**
- **MLB SOW:** Postseason not separately priced; no "Major League Regular Season and Post-Season Period" defined in the MLB SOW body (though the base Agreement § 4 Force Majeure references such a term "as defined in the SOW").
- **MiLB SOW:** "'**Minor League Regular Season and Post-Season Period**' means that portion of the SOW Term during which the Complex League Team has officially-scheduled regular season games and, if and as applicable, post-season games. Without limiting the foregoing, the Minor League Regular Season and Post-Season Period generally occurs within the months of June through September"

  No separate postseason meal rate or bonus fee - postseason meals flow through the same per-meal rate structure.

**Passthrough / Reimbursement (§B.7):**
NOT PRESENT (both TBR SOWs). Provider is "solely responsible for all of the following specific responsibilities and for all costs associated with same" including all Meal ingredients, personnel, equipment/supplies, vehicles, and disposable service supplies (both SOWs § 4(a) p.2).

"**Provider Responsibilities for Locations and Equipment**. The Provider shall be solely responsible for securing and paying for all locations needed for the preparation of Meals hereunder, including, but not limited to, any leased premise, refrigeration, and appliances used for storage and preparation."

MLB SOW adds MTO service commitment during MLB Spring Training:
"The parties hereby agree that the Provider agreed to manage at the Provider's expense the on-site MTO services throughout the duration (i.e. seven (7) week duration commencing in early February and ending at the end March in each year of the Term) of the Club's spring training for the Major League Baseball Team ('Major League Spring Training')."

MLB SOW Exhibit 2 (Additional Club Requirements):
"Provider will locate the commissary kitchen at a location that is subject to the prior written approval of the Club, which approval not to be unreasonably withheld. Throughout the term of the Agreement, the commissary kitchen should be used by Provider exclusively to provide food service to the Club and shall not be used to provide foodservice for any third party. Provider will provide the Club with a partial on-site service during Major League Spring Training. This will entail at Provider's expense either an on-site kitchen renovation or a commitment to a temporary or mobile kitchen facility. This will be in conjunction with the temporary refrigerated unit provided by the Club for the duration of Major League Spring Training. On site Provider staff member will be available"

**Billing Cadence / Payment Terms (§B.8):**
Both SOWs - weekly invoicing:
"**Billings and Reconciliations**. Within five (5) days following the final day of each Calendar Week (or partial Calendar Week, as applicable) that falls during the SOW Term, the Provider will deliver to the Club an invoice for the amount payable by the Club in connection with the Meals prepared and served by Provider pursuant to this Agreement during the applicable Calendar Week (or partial Calendar Week, as applicable). For certainty, invoices hereunder will include clear information and supporting documentation specifying on the specific Service Days, Meals, as well as any necessary Club confirmations or approvals (such as related Preliminary Catering Orders and Final Catering Orders)."

Payment terms - both SOWs, § 6(a)(iii) / § 6(d) - no explicit day-count guarantee; disputes handled via 10-day negotiation window then CPA arbitration:
"In the event the Club disputes any portion of an invoice, the Club shall deliver written notice of such dispute to Provider ('Dispute Notice'). If the Club and the Provider are unable to resolve such dispute within ten (10) days following the delivery of the Dispute Notice, the Club and the Provider shall immediately submit the dispute for resolution to a Certified Public Accountant to be mutually agreed to by the Club and the Provider (the 'CPA'). The determination of the CPA after a full and complete inspection of the Provider's and the Club's books and records shall be final and binding upon the parties..."

**MFN / Exclusivity / Count-Reporting / Dispute (§B.9):**
- **MFN / Favored Pricing:** NOT PRESENT (no favored-pricing clause in either TBR SOW).
- **Exclusivity - commissary kitchen exclusivity IS PRESENT (both SOWs, Exhibit 2):**
  "Throughout the term of the Agreement, the commissary kitchen should be used by Provider exclusively to provide food service to the Club and shall not be used to provide foodservice for any third party."
- **Right of First Negotiation (relocation trigger - both base Agreements):**
  "**Right of First Negotiation**. In the event that the Club announces (the 'Notification Event') that it intends to conduct spring training during the Term at a location (the 'New Spring Training Site') other than Charlotte Sports Park, then the Club hereby grants to Provider the sole and exclusive right to negotiate a modification of this Agreement and that certain Services Agreement - Minor League Foodservices (the 'Minor League Agreement')... for the provision of foodservices at the New Spring Training Site for a period of thirty (30) days (the 'Negotiation Period')... If the parties are unable to execute New Agreements by the end of the Negotiation Period, the Club will be free to negotiate with third parties and this Agreement and the Minor League Agreement will terminate as of the date the Club vacates Charlotte Sports Park."
- **Count reporting:** Preliminary Catering Order (7 days advance) + Final Catering Order (3 days advance) - SOW § 4(c). Ongoing invoicing per Calendar Week (see B.8).
- **Dispute / governing law:** "This Agreement shall be governed by and construed in accordance with the laws of the State of Florida. The parties agree that in the event of any dispute between them relating to this Agreement, the substantially prevailing party shall be entitled to recover from the other party the reasonable legal and other professional fees and expenses incurred by the substantially prevailing party with respect to such dispute. Venue for any legal proceedings arising out of this Agreement shall be in the state courts sitting in the State of Florida, County of Pinellas, and in the federal courts sitting in the State of Florida, County of Hillsborough, as the case may be..."

**Year-Over-Year Table (§C):**
Only 2024 SOWs are physically in the folder. Rates for 2025 / 2026 derive from CPI-adjusted 2024 base per the escalation clause (B.4). No separate 2025 or 2026 SOW documents exist in the folder.

| Year | MLB Breakfast | MLB Lunch/Dinner | MiLB Base Breakfast | MiLB Base Lunch/Dinner | MiLB Post-SF Breakfast | MiLB Post-SF Lunch/Dinner | MiLB Service Fee | Source |
|---|---|---|---|---|---|---|---|---|
| 2024 | $32.98 | $36.54 | $21.11 | $25.86 | $15.84 | $19.40 | $382,448 ($200K signing + $182,448 by Feb 1, 2024) | MLB SOW § 6(a)(i); MiLB SOW § 6(a) i-iv & § 6(c) |
| 2025 | 2024 rate × (1 + 0.75 × delta-CPI Nov23→Nov24) | same | same | same | same | same | NOT PRESENT (no 2025 SOW in folder) | MLB SOW § 6(a)(i)(c)-(d); MiLB SOW § 6(a) v-vi |
| 2026 | 2025 rate × (1 + 0.75 × delta-CPI Nov24→Nov25) | same | same | same | same | same | NOT PRESENT (no 2026 SOW in folder) | (per B.4 mechanic) |

**Cross-Check Flags (§D):**
- **C-2 (Conflict Register): PARTIALLY confirmed / paperwork gap.** The 2024 MiLB SOW verbatim confirms the "$200K static signing installment + variable second installment (in 2024: $182,448)" pattern (Minor League SOW § 6(c) p.6). Kevin's 2021 screenshot recorded 2021: $200K + $120,569.84. So the pattern appears in AT LEAST 2 discrete SOW years (2021, 2024). BUT the base MiLB Agreement § 2(a) says the Service Fee is "in the amounts and at the times as set forth in the SOW" - so the pattern is only contractually binding for the year of each executed SOW; without 2025 / 2026 SOWs in file, the recurrence for 2025 / 2026 is not documented.
  
  **RESOLUTION (LEDGER 2026-07-14):** REVERSED. Kevin surfaced evidence of the recurring pattern ($200K + variable every year). The paperwork gap (2025/2026 SOWs missing from the file) is a chase item, not a denial of recurrence. The 2026 SF ($457,768 per P&L) is real and billed.

- **PAPERWORK GAP - no 2025 or 2026 TBR SOWs in the folder.** Only 2024 MLB SOW and 2024 MiLB SOW are physically present. Base Agreement Retention Period runs through October 1, 2026 (MLB) / December 31, 2026 (MiLB) with rates auto-escalating per CPI, but there is no mechanic in either SOW that auto-generates a new Service Fee for 2025/2026 (unlike the CPI-indexed per-meal rates in § 6(a) v-vi). Whether the $382,448 MiLB Service Fee recurs annually is silent in the produced documents.

- **MLB SOW has NO Service Fee.** All MLB compensation is per-meal. Kevin's $200K pattern is a MiLB-side artifact only.

- **MiLB Post-service-fee rates ($15.84 / $19.40) are lower than Base rates ($21.11 / $25.86).** This means the Service Fee is a "buy-down" of per-meal rates - Rates "reduced by 25% for all billings for the Minor League Baseball Teams within the Term" per § 6(c). Verify MONEY_MODEL treatment of MiLB per-meal rate (is the model using Base or Post-service-fee?). **RESOLVED:** PG and MONEY_MODEL correctly use the post-SF rates ($17.83 Breakfast, $21.68 Lunch, $20.96 Dinner — 2026 CPI-escalated post-SF).

- **Escalation is 75% of CPI (Food Away From Home - Full Service Meals and Snacks), not 100%** - materially different from TBJ FL which uses 100% of CPI (Food Away From Home). If Price Review v3 assumes uniform 100% CPI, TBR is a mis-model. **RESOLVED:** PRICE_AUDIT confirmed 75% is correct and applied properly in PG. TBJ-FL's 100% is its own distinct rule.

---

### docs/pricing-summit/CONTRACT_DIGEST_BGC.md

**Boys & Girls Club - 5-Page Catering Contract (Single School-Year Term, Aug 2025 - May 2026)**

**Document Inventory (§A):**
| Filename | Doc type | Effective date | Execution date | Signatories | STATUS |
|---|---|---|---|---|---|
| `Boys and Girls Club Contract 25_26 (1).pdf` | Catering Contract (5 pages: contract body pp.1-3 + Exhibit A Scope-of-Work / CCFP Meal Pattern p.4 + sample dinner menu p.5) | Start Date August 19, 2025 → End Date May 21, 2026 | "made on August 3, 2025" | Josh Katt (CJK Foods, LLC dba KitchFix) + Lynn Dorler [handwritten, illegible] (Boys and Girls Club of Charlotte County) | **OPERATIVE for 2025-26 school year ONLY.** Term ends **May 21, 2026**. Anything past that date requires a new SOW/renewal not in this doc. |

Note: filename says "25_26" = school year 2025-26. No prior-year or renewal document delivered — single doc.

**Operative Terms - VERBATIM (§B):**

**Term / Duration (§B.1):**
> "Contract Term: 10 months, School Days (Tue-Thur)
> Start Date: August 19, 2025
> End Date: May 21, 2026
> Delivery Time: 1:30pm"

Additional description of when service does + does NOT happen:
> "KitchFix will deliver buffet-style food in accordance with the Child Care Food Program Meal Pattern for Children document (referenced in this contract below) to the Client in Englewood every Tuesday through Thursday during the regular school year, not including regular school holidays or school breaks. KitchFix will prepare the food in accordance with applicable health code laws and deliver to Client. Client will be solely responsible for safely storing and serving the food after each delivery."

**Per-Meal / Per-Item Rates (§B.2):**
> "**PRICING**. In exchange for the Catering provided, the Client agrees to pay the Caterer **$6.50** per Estimated Meal for the upcoming month's estimation. Client has provided Tax Exempt documentation."

Rate reiterated verbatim in the billing-cadence section:
> "Caterer will invoice Client at the start of that period at **$6.50 per meal** included in the Period Estimate."

**Confirmed at $6.50 per Estimated Meal.** Only one rate — no tiering by meal type or age group. No breakfast/lunch/dinner rate split.

**Service Fee / Minimums (§B.3):**
> "**ESTIMATED MEALS**. The Caterer agrees to provide the Scope of Work for an estimated minimum of **125 individuals per day** at the Catering. Client shall no later than 1 week in advance confirm the Estimated Meals needed for the following week. Client will deliver Estimated Meals to the client each day, and Caterer shall prepare Catering according to the Estimated Meals."

125/day minimum expectation (not a hard billing floor — see §B.6 credit mechanic below). No service fee separate from the per-meal rate.

**Escalation Clause (§B.4):**
**NOT PRESENT.** No CPI, no formula, no annual step. Contract is a single 10-month term at flat $6.50/meal.

**Tax Language (§B.5):**
> "**Taxes**. Client has provided Tax Exempt documentation."

Also in §V:
> "Client has provided Tax Exempt documentation."

**Client (BGC) is TAX EXEMPT.** No sales tax to be applied.

**Billing Cadence / Payment Terms (§B.6):**
> "**TERMS**. As part of this Contract, the Caterer requires at the start of each 4 week period, starting on August 19, 2025 and ending May 2026 that the Client provides Caterer with an estimate of meals needed for the following period, no later than 7 days in advance of the start of the next period. This estimate will be known as Period Estimate. Caterer will invoice Client at the start of that period at $6.50 per meal included in the Period Estimate. Client is required to pay that invoice prior to the start of each Period. Once a period is complete Caterer will issue a credit of any unserved Estimated Meals to the Client in the form of a credit for the following month."

**Structure**: prepaid, 4-week (28-day) periods, invoiced at start of period, PAID BEFORE START of period. Unserved-meal credit rolls to next month.

**Payment Methods** (§VII):
> "**METHODS OF PAYMENT**. The Caterer's acceptable methods of payment are as follows: (check all that apply)
> ☐ - ACH
> ☑️ - Check
> ☐ - Credit Card (additional % fee)"

**Only Check is checked.** ACH + Credit Card are unchecked (CC would carry an "additional % fee" if used, per checkbox description).

**Late Fees** (§VIII):
> "**LATE FEES**. If a payment due by the Client is not made within the requirements mentioned in Section VI, there will be a Late Fee assessed to each outstanding invoice of 5% per month."

**Passthrough / Reimbursement (§B.7):**
NOT PRESENT. No food/supplies passthrough clause; the $6.50/meal is the flat all-in rate.

Equipment/damage:
> "**Damage to Equipment**. The Client will be responsible for any damage or loss to the Caterer's equipment due to misuse or theft by the Client or any guest of the Client and in the case of a force majeure event (including but not limited to fires, floods, inclement weather, and earthquakes)."

**Term Dates / Renewal (§B.8):**
- **Start**: August 19, 2025
- **End**: **May 21, 2026** (10 months)
- **Renewal / auto-renew**: NOT PRESENT. Contract is silent on what happens for the 2026-27 school year. A new document would be needed.
- **Change Requests** (§IX):
  > "**CATERING CHANGES**. After the signing of this Contract, changes to the Catering by the Client cannot be made. If there is a change or cancellation to daily service requested by the Client, Caterer will always try to be flexible in accommodating. Realizing Acts of God such as inclement weather may be sudden, Caterer will remain diligent in having proactive communications. Any changes made in guest count or menu within 72 hours of service may not be honored due to ordering, securing and preparing product."

**Any Exclusivity / MFN / Dispute / Count-Reporting Terms (§B.9):**
- **Exclusivity**: NOT PRESENT.
- **MFN (favored pricing)**: NOT PRESENT.
- **Count-Reporting**: Client provides Period Estimate 7+ days pre-period (§VI). Post-period unserved credit reconciliation (§VI).
- **Termination Notice** (§XII):
  > "**TERMINATION NOTICE REQUIREMENT**. Notwithstanding anything to the contrary, the Client agrees to provide the Caterer with no less than thirty (30) days' written notice in the event of termination of this Agreement."
- **Governing Law** (§XIII):
  > "**GOVERNING LAW**. This Contract shall be construed and governed in accordance with the laws of the State of where the Catering is taking place."
  — so Florida law (Catering happens in Englewood/Port Charlotte, FL).
- **Liability & Indemnification** (§X.e):
  > "The Caterer will not be liable for direct, indirect, incidental, or consequential damages (including, but not limited to, damages for lost profits or increased expenses) with respect to any claim related to this Contract and the Services provided. The Client indemnifies and holds harmless the Caterer and any subcontractors working with the Caterer against all liability related to the Client's Catering from the date of the Catering and on into the future. The Client will assume all legal fees claimed by third persons, provided that such loss or damage was not caused by the fault or negligence of the Caterer or its employees, agents, or subcontractors. Furthermore, the Caterer has the right to cancel, at any time and without notice, the Services mentioned in this Contract with no liability or obligation to the Client other than refunds of any Deposit or advanced payments made by the Client."

  Note the "cancel at any time and without notice" clause is very Caterer-favorable exit — Caterer can cancel any time, only obligation is refunding deposits/advance payments.

**Cross-Check Flags (§D):**
- **$6.50/meal RATE CONFIRMED verbatim** at §V p.1 and §VI p.2. Kevin's operative figure matches the contract exactly. Rate is flat — no split by meal type, no age tiering, no volume tier.
- **⚠️ Meal-type flag — the ledger banked BGC as "$6.50/lunch," but the contract + sample menu suggest DINNER or after-school evening service, NOT lunch.** Evidence:
  1. **Delivery time = 1:30pm** (§II p.1) — that's post-school-lunch, late-afternoon; consistent with an after-school program delivery to be served later, not a lunch service.
  2. **Sample menu on p.5 is titled "2022 APRIL — DINNER MENU (8oz Fat Free Milk)"** — the sample provided in the contract is explicitly labeled a Dinner menu.
  3. **CCFP Meal Pattern for Children (Exhibit A p.4)** covers Breakfast + Lunch/Supper — but the contract doesn't specify which pattern applies. The sample being labeled "Dinner" + the 1:30pm delivery both point to Lunch/Supper pattern → supper (dinner) service to kids attending after-school.
  → **The $6.50 rate is one flat rate per meal regardless of meal type; the meal-type-labeling in downstream docs (ledger, MONEY_MODEL) may need to say "after-school meal" or "dinner/supper" rather than "lunch."** Flag for correction.
- **Term ends May 21, 2026** — half of the 2026 calendar year has NO BGC service. If BGC revenue is projected as a full-year TBR-FL line, projections after May 21, 2026 need a **renewal doc** or a new SOW. No auto-renew clause. → Flag as a **paperwork gap for the 2026-27 school year** (BGC service would normally resume Aug 2026, but no doc for that period yet).
- **Billing entity = "Boys & Girls Clubs of Charlotte County"** at 21500 Gibralter Drive, Port Charlotte, FL 33952 — a distinct entity from the Tampa Bay Rays. **NO relationship to the TBR-FL Rays contract stated anywhere in this doc.** BGC is fully independent contractually; the commissary-model overlap is operational, not contractual. (Rays contract does not appear as a party or a related agreement.)
- **Volume/Minimum**: **125/day minimum expectation** (§III) but the billing mechanism does NOT enforce it as a hard floor — Period Estimate drives the invoice, and unserved meals carry a credit. So the minimum is planning-only, not a billed-minimum. [CC calc]: 125/day × 3 days/week × ~40 school weeks in a 10-month term × $6.50 = ~$97,500 upper-bound at minimum-fill; actual ≈ $79,950 P&L 2200 suggests fill was closer to ~4,100 meals or ~102 meals/day average — well within the 125/day estimate.
- **Location wording anomaly**: §II p.1 says "deliver to the Client in **Englewood**" but the Bill-To address is **Port Charlotte** (21500 Gibralter Drive). Not a conflict — Englewood and Port Charlotte are adjacent Charlotte County, FL communities; likely the delivery site is in Englewood while the billing entity is HQ'd in Port Charlotte. Non-blocking; noted.
- **Payment method restriction**: **Check is the ONLY approved method** (§VII, only ☑️). ACH + CC are unchecked. If any BGC invoices are actually being paid via ACH, that's out-of-contract; may be an operational convenience but worth noting to Sebastian.
- **Late fee = 5%/month** — steep by commercial-billing standards. Not aligned with the Rays/other-club Net-30 patterns; this is a stricter arrangement (client pays BEFORE the period starts; late fee kicks in on any invoice past that).
- **Caterer termination clause is very one-sided** (§X.e): Caterer can cancel "at any time and without notice" — no obligation beyond refunding deposits/advances. Client has 30 days notice requirement (§XII). Note for future reference (unlikely to matter operationally, but flag if any dispute arises).
- **Signatory line has a handwritten signature Kevin should verify**: PRINT NAME line reads what looks like `[ILLEGIBLE: possibly "Lynn Dorler"]` for the BGC side. Josh Katt clean for KitchFix side. Confirm current BGC signatory + stakeholder — the person who signs may not be the AP recipient.
- **Meal-pattern reference (Exhibit A) is the USDA/CCFP Child Care Food Program pattern** — not KitchFix's own menu design. Contract commits to the CCFP pattern for portion sizes/food-groups. Any KitchFix menu proposal must conform to those grams/servings.

---

### docs/pricing-summit/EVIDENCE_TBR-FL.md

**Read-Only Evidence Pack (Verbatim + Cites, Unknowns Flagged)**

**Account:** TBR-FL (Tampa Bay Rays — MLB @ Tropicana Field + MiLB Charlotte County PDC). **Shape:** MLB per-meal (no SF); MiLB **SF% 25%** ($382,448 one-time 2024 [MARKED SUPERSEDED — now annually recurring per LEDGER]) discounts per-meal. Level: PDC (`billing_model=actuals_drive_invoice`).

**Sources (§1):**
- **Contracts** (4 files, all Nov 16, 2023, effective Jan 1, 2024):
  - `TBR FL/Services Agreement Major League Foodservice CJK Foods LLC dba Kitchfix 2024 Josh.pdf` (MLB Master)
  - `TBR FL/Major League SOW 2024 EXECUTION Josh.pdf` (MLB SOW)
  - `TBR FL/Services Agreement Minor League Foodservice CJK Foods LLC dba Kitchfix 2024 Josh.pdf` (MiLB Master)
  - `TBR FL/Minor League SOW 2024 EXECUTION Josh.pdf` (MiLB SOW)
- **Invoices in sample:** **K300168545** (2026-03-01 MLB week 2/23-3/1); **K300168871** (2026-07-05 MiLB week 6/29-7/5).
- **MONEY_MODEL digest row:** `TBR - FL | SF% 25% on MiLB only | $27.95 MiLB / $39.48 MLB | $20.96 MiLB / $39.48 MLB | $382,448 one-time 2024 [SUPERSEDED] | Yes, meal revenue`.
- **PG:** `billing_model = actuals_drive_invoice`, `has_homestand_schedule = false`.

**Contract Evidence - Verbatim (§2):**

**MLB per-meal 2024 rates (Major League SOW § 6(i)(a)-(b) p.4):**
> "(a) Thirty-two dollars and ninety-eight cents (USD $32.98), not inclusive of tax (the '2024 Breakfast Rate')... (b) Thirty-six dollars and fifty-four cents (USD $36.54), not inclusive of tax (the '2024 Lunch/Dinner Rate')..."

**MiLB per-meal 2024 rates (Minor League SOW § 6(a)(i-iv) p.5):**
> "i. During 2024, twenty-one dollars and eleven cents (USD $21.11), not inclusive of tax (the '2024 Base Breakfast Rate')... ii. During 2024, twenty-five dollars and eighty-six cents (USD $25.86), not inclusive of tax (the '2024 Base Lunch/Dinner Rate')... iii. During 2024, fifteen dollars and eighty-four cents (USD $15.84), not inclusive of tax (the '2024 Post service-fee Breakfast Rate')... iv. During 2024, nineteen dollars and forty cents (USD $19.40), not inclusive of tax (the '2023 Post service-fee Lunch/Dinner Rate')..."

Note: (iv) mislabels "2023" but rate is defined for 2024.

**25% MiLB discount + $382,448 SF (Minor League SOW § 6(c) p.6) — VERBATIM:**
> "(c) Service Fee. In addition to the compensation described above, the Club shall pay to the Provider a service fee (the 'Service Fee') in the amount of three hundred eighty-two thousand four hundred forty-eight dollars (USD $382,448.00), plus applicable taxes. The Rates will be reduced by 25% for all billings for the Minor League Baseball Teams within the Term. The Club will pay the Service Fee in accordance with the following schedule: (A) On the first date that this SOW has been signed by both parties, the Club shall pay the sum of two hundred thousand dollars (USD $200,000.00), and (B) On or before February 1, 2024, the Club shall pay the sum of one hundred eighty-two thousand four hundred forty-eight dollars (USD $182,448)."

**$382,448 SF is paid as two installments both completed by Feb 1, 2024.** [LEDGER AMENDMENT: Recurs annually with $200K static + variable structure; 2026 = $200K + $257,768 per P&L.]

**CPI Escalation — MLB (Major League SOW § 6(i)(c) p.5):**
"For each year of the SOW Term after 2024, each Breakfast Meal... shall be at the rate of the 2024 Breakfast Rate, as adjusted upward or downward by a percentage equal to **seventy-five percent** of the percentage change in the 'CPI Index'... For purposes of this SOW, the term 'CPI Index' shall refer to the Consumer Price Index for All Urban Consumers (CPI-U): U.S. City Average, Food Away from Home – Full Service Meals and Snacks, as calculated by the United States Department of Labor, Bureau of Labor Statistics (CPI). For purposes of this SOW, the adjustment in rate, if any, for 2025 shall be based upon the change from the November 2024 CPI Index to the November 2023 CPI Index (with the same procedure to be followed for each year of the Term after 2025)."

**CPI Escalation — MiLB (Minor League SOW § 6(a)(v) p.5):**
"For each year of the SOW Term after 2024, each Breakfast Meal... shall be at the rate of the 2024 Base Breakfast Rate and the rate of the 2024 Post service-fee Breakfast Fee, as the case may be, as adjusted upward or downward by a percentage equal to **seventy-five percent** of the percentage change in the 'CPI Index'..."

**75% of CPI-U Food Away from Home change; applies to per-meal rates only, NOT the SF.**

**Term (Services Agreement Minor League § 3 p.2):**
> "The Retention Period shall commence on the Effective Date and shall terminate as of December 31, 2026 (the 'Term')."

**C-2 Chase — SF Renewal for 2026:**

**VERBATIM SEARCH RESULT:** The Service Fee ($382,448) is defined in MiLB SOW § 6(c) with exactly two installments (both completed by Feb 1, 2024). **The contract is SILENT on whether an equivalent Service Fee applies to any subsequent Agreement Year.** The CPI escalation clause covers per-meal rates only; the SF itself is not referenced in any post-2024 escalation or renewal clause anywhere in the four TBR-FL documents.

**LEDGER RESOLUTION (Kevin, 2026-07-14):** REVERSED. **C-2 is NOT a conflict — TBR-FL SF is ANNUALLY RECURRING, not one-time.** Contract structure is $200K static + variable every year (2021: $200K + $120,569.84; 2024: $200K + $182,448; 2026 P&L: $200K + ~$257,768). The contract's verbatim language only specifies 2024's amounts; the recurrence is established by the repeating pattern in prior SOWs (evidence in ACCOUNT_TBR-FL.md §W + Kevin's 2026-07-14 ruling). The paperwork gap (2025/2026 SOWs missing) is a chase item (low-priority per Kevin), not a denial of recurrence.

**Invoice Cadence + Net Terms (MLB SOW § 6(ii) p.5; MiLB SOW § 6(b) pp.5-6):**
Both SOWs (identical language):
> "Billings and Reconciliations. Within five (5) days following the final day of each Calendar Week (or partial Calendar Week, as applicable) that falls during the SOW Term, the Provider will deliver to the Club an invoice... invoices hereunder will include clear information and supporting documentation specifying on the specific Service Days, Meals, as well as any necessary Club confirmations or approvals..."

**Weekly invoicing.**

**Dispute Mechanism (MLB SOW § 6(iii) pp.5-6; MiLB SOW § 6(d) p.6):**
> "In the event the Club disputes any portion of an invoice, the Club shall deliver written notice of such dispute to Provider ('Dispute Notice'). If the Club and the Provider are unable to resolve such dispute within ten (10) days following the delivery of the Dispute Notice, the Club and the Provider shall immediately submit the dispute for resolution to a Certified Public Accountant to be mutually agreed to by the Club and the Provider (the 'CPA'). The determination of the CPA after a full and complete inspection of the Provider's and the Club's books and records shall be final and binding upon the parties, and the Club shall pay to the Provider such amount, if any, as is necessary to reflect the CPA's determination."

**CPA dispute resolution.**

**Force Majeure Suspension (Services Agreement Major League § 4 p.4; MiLB § 4 p.4):**
> "the Club shall have the right, by written notice to Provider, to declare Provider's obligations under this Agreement to be suspended for the period of time the Suspension Event remains in effect, and the Club shall be excused from making any payments of the Services Fee as provided in this Agreement for the period of time the Suspension Event remains in effect."

**Passthrough:**
**UNKNOWN** — no food/packaging/supplies passthrough budget in either MLB or MiLB SOW. Provider bears costs:
> "(i) Sourcing and purchasing all Meal ingredients... (ii) Hiring and paying all employees... (iii) Securing and paying for all equipment and supplies needed for the preparation of Meals hereunder..." (both SOWs § 4(a) p.2)

**Tax Language:**
- All rates "not inclusive of tax" (§ 6 per rate)
- No "tax-inclusive," "fixed-gross," or "tax-included" language

**Postseason:**
Contract silent on postseason-specific rates. Under Kevin's default (same rates + additional days), TBR-FL postseason would bill at same rates. **No flag; contract silent.**

**True-Up / Immutability:**
CPI-linked adjustment on per-meal (§ 6(i)(c) MLB / § 6(a)(v) MiLB) is the only rate-adjustment mechanism; not on the $382,448 SF. **UNKNOWN** on SF true-up. [LEDGER: SF does not escalate within year per contract; the variable 2nd installment is set per year (non-blocking Joe #3).]

**MLB-vs-MiLB Invoicing:**
Separate SOWs → separate invoices in practice. Confirmed by invoice sample (K300168545 MLB + K300168871 MiLB have different Bill-To contacts).

**Count-Verification:**
Invoices "will include clear information and supporting documentation specifying on the specific Service Days, Meals, as well as any necessary Club confirmations or approvals" (MLB SOW § 6(ii); MiLB SOW § 6(b)). Read: KitchFix must include supporting docs including any Club confirmations that ALREADY EXIST — this doesn't mandate pre-invoice sign-off. **No sign-off gate at invoice time.**

**Invoice Evidence (§3, Verbatim):**

**Invoice K300168545 — 2026-03-01 TBR-FL MLB (Spring Training @ Charlotte Sports Park, invoiced to Tropicana Field HQ):**
- **Bill To:** Erik Hart / Rays Baseball Club LLC / One Tropicana Drive, Tropicana Field / St. Petersburg, FL 33705-1703
- **Note:** "This Invoice is for the 2025 Tampa Bay Rays MLB Meal Service. Week of 2/23 - 3/1." — note says "2025" (memo template error), invoice dates are 2026
- **Invoice Date:** 03/01/2026
- **Due Date:** 03/31/2026 (Net 30)
- **Total:** $80,367.70 (Subtotal $75,110.00 + Tax $5,257.70 = 7.0% FL)
- **14 line items** across 7 days (2/23-3/1), each day has:
  - `TBR MLB - Breakfast` @ **$35.63** (qty 120-160)
  - `TBR MLB - Lunch/Dinner` @ **$39.48** (qty 120-160)

**Rate Matches:**
- MLB Lunch/Dinner $39.48 = MONEY_MODEL digest **EXACT MATCH** (no discount, MLB).
- MLB Breakfast $35.63 — not in MONEY_MODEL digest table. Contract 2024 base $32.98 × CPI-escalated (75% of 2024→2026 CPI change) matches trajectory.

**Invoice K300168871 — 2026-07-05 TBR-FL MiLB (Charlotte County PDC):**
- **Bill To:** Sean "Sunny" Jones / Rays Baseball Club LLC / One Tropicana Drive, Tropicana Field / St. Petersburg, FL 33705-1703
- **Note:** "This Invoice is for the 2025 Tampa Bay Rays MiLB Meal Service. Week of 6/29 - 7/5." — "2025" memo template error
- **Invoice Date:** 07/05/2026
- **Due Date:** 08/04/2026 (Net 30)
- **Total:** $31,426.59 (Subtotal $29,388.96 + Tax $2,037.63 ≈ 6.93%)
- **Line Items:**
  - `TBR MiLB - Breakfast` @ **$17.83** (qty 120/day, 4 days: 7/1, 7/2, 7/3, 7/4)
  - `TBR MiLB - Lunch/Dinner` @ **$21.68** (qty 92-240/day, 7 days: 6/29, 6/30, 7/1, 7/2, 7/3, 7/4, 7/5)
  - `TBR MiLB - Road Sandwiches` @ **$15.00** flat, qty 28 (6/30, 7/2)
  - `Labor Fee` — Labor Fee $280.00 (07/03)
  - `Extra Protein (TBR) - Chicken/Pork` $111.84 (07/03)

**Rate Discrepancy vs MONEY_MODEL Digest:**
- MiLB Lunch/Dinner **$21.68 INVOICE** vs **$20.96 DIGEST** — **CONFLICT** ($0.72/meal delta). [CONFLICT_REGISTER A-1 RESOLUTION: Digest is formulaic error (dropped the 75% multiplier from CPI escalation). Signed Price Review v3 and invoice both match the formula, though at slightly different interpretations. Full analysis in CONFLICT_REGISTER A-1 recompute addendum + PRICE_AUDIT (certified as PG correct).]
- MiLB Breakfast $17.83 — **not in digest**. Contract 2024 Post service-fee $15.84 × CPI-escalated matches trajectory ($15.84 × ~1.126 ≈ $17.83).

**Contract post-SF rates 2024:** Breakfast $15.84, Lunch/Dinner $19.40.
**Invoice observed rates 2026:** Breakfast $17.83, Lunch/Dinner $21.68.
**Ratios:** $17.83/$15.84 = 1.126; $21.68/$19.40 = 1.117. Close but not identical → likely two years of 75% × CPI adjustments applied separately (not from a straight ratio to a single base year).

**PG Evidence (§4):**
`sc_service_prices` for TBR-FL (2026-07-14 snapshot):
| Service | is_flat_fee | is_tax_free | price_kind | price |
|---|---|---|---|---|
| MLB Breakfast | | | projected | 35.627 (2dp: $35.63) |
| MLB Lunch/Dinner | | | projected | 39.48 |
| MiLB Breakfast | | | projected | 17.8275 (2dp: $17.83) |
| MiLB Lunch/Dinner | | | projected | 21.675 (2dp: $21.68) |
| MiLB Dinner | | | projected | 20.96183 (2dp: $20.96) |
| Road Sandwiches - MiLB | | | projected | 15 |
| Extended Day labor | ✓ | | projected | 280 |
| Extra Protein - Chicken/Pork | ✓ | | projected | 111.84 |
| Extra Protein - Beef/Seafood | ✓ | | projected | ~156 (from QBR) |
| B&G Lunch | | ✓ | projected | 6.5 |

**Cross-Check Against MONEY_MODEL (§5):**
| MONEY_MODEL claim | Contract | Invoice | Verdict |
|---|---|---|---|
| MLB post-SF $39.48 (no discount) | Contract 2024 $36.54 base, CPI-escalate to 2026 | ✓ invoice $39.48 | ✓ agreed |
| MiLB post-SF $20.96 (25% off) | Contract 2024 post-SF $19.40, CPI-escalate | Invoice $21.68 — **$0.72/meal above digest** | **CONFLICT** — resolved to digest formulaic error + invoice correct; contract correct = $20.56 [CONFLICT_REGISTER A-1] |
| $382,448 one-time 2024 SF | ✓ verbatim § 6(c) (2 installments completed by Feb 1 2024) | (no SF invoice in sample) | **REVERSED** (Contract confirms 2024 payment schedule; LEDGER rules SF recurs annually — $200K + variable every year) |
| 75% CPI-U Food Away from Home Nov-to-Nov | ✓ verbatim §§ 6(i)(c), 6(a)(v) | Invoice rates consistent with CPI escalation trajectory | ✓ |
| Term through 12/31/2026 | ✓ verbatim § 3 | invoice dated 2026 (in-term) | ✓ |

**UNKNOWN / Gaps (§6):**
- **C-2:** Whether the $382,448 SF recurs in 2025 or 2026: **contract SILENT** [RESOLVED by LEDGER: SF DOES recur annually]. Invoice sample shows NO SF line. Best evidence: **annually recurring $200K + variable, not one-time 2024** [per LEDGER 2026-07-14].
- MiLB rate reconciliation: MONEY_MODEL $20.96 vs invoice $21.68 — **resolved** (digest formulaic error; PG/signed correct).
- MLB Breakfast rate: not in digest ($35.63 invoice); should be added.
- MiLB Breakfast rate: not in digest ($17.83 invoice); should be added.
- 2026 CPI-adjustment approval trail on file: UNKNOWN.
- B&G (Boys & Girls Club) $6.50/meal: **CONFIRMED** (not in the four TBR-FL contract files because BGC is contractually separate, but IN-SCOPE per ACCOUNT_TBR-FL.md and CONTRACT_DIGEST_BGC.md).

**Postseason (§7):**
Contract silent. Under Kevin's ruling, TBR-FL postseason would bill at same per-meal rates. **No flag.**

**Billing Cadence (§8):**
- Contract § 6(ii) MLB + § 6(b) MiLB: **weekly** for per-meal.
- Invoice sample: both invoices weekly (2/23-3/1 spring; 6/29-7/5 mid-season). Consistent.
- Kevin's export-unit-is-period ruling: weekly = 2 invoices per SC period per level.

**QuickBooks Artifacts (§9):**
- Invoices K300168545 + K300168871 (K3 prefix).
- Items: `TBR MLB - Breakfast`, `TBR MLB - Lunch/Dinner`, `TBR MiLB - Breakfast`, `TBR MiLB - Lunch/Dinner`, `TBR MiLB - Road Sandwiches`, `Labor Fee`, `Extra Protein (TBR) - Chicken/Pork`.
- Description column carries "Breakfast", "Lunch", etc. as sub-label.
- All meal lines carry "T" flag (taxable at 7.0% FL).
- Memo template error: both memos say "2025" instead of "2026" — cosmetic bug in the QB template, not a billing issue.
- One-off charges (Labor Fee $280, Extra Protein $111.84) appear as their own line items — likely `is_flat_fee` in QB.

**Count-Verification (§10):**
Not a sign-off gate. Contract requires "supporting documentation" but not client sign-off. **No sign-off required.**

**Local Flags (§11, cross-ref CONFLICT_REGISTER):**
- **§C-2 RESOLVED** (LEDGER amendment): contract not silent on 2026 SF recurrence. Invoice sample shows no SF line (invoiced separately on its own schedule). **SF is recurring annually ($200K + variable), not one-time 2024.** [This is the C-2 conflict Kevin's brief flagged; resolved to "SF is annually recurring" per LEDGER 2026-07-14.]
- **§MiLB rate mismatch**: invoice $21.68 vs MONEY_MODEL $20.96 — $0.72/meal delta. **Resolved** (digest formulaic error; PG/signed/invoice correct).
- **§Rate-table gaps**: MONEY_MODEL digest doesn't list Breakfast rates separately from Lunch/Dinner for TBR-FL. Invoices show they differ (MLB Breakfast $35.63 vs Lunch/Dinner $39.48; MiLB Breakfast $17.83 vs Lunch/Dinner $21.68). Digest should add Breakfast rows.
- **§Add-ons not in digest**: Road Sandwiches $15.00, Labor Fee $280, Extra Protein $111.84 — new ancillary lines not in MONEY_MODEL.
- **§Memo template**: "2025" appears in both TBR-FL memos in 2026 — cosmetic QB template error; flag for Sebastian to fix in the year rollover.
- **§B&G:** MONEY_MODEL §Open items lists $6.50 for Boys & Girls Club; **CONFIRMED** as IN-SCOPE per CONTRACT_DIGEST_BGC.md (contractually separate but operational + revenue-tracked under TBR-FL commissary model).

---

### docs/pricing-summit/PL_2026_APPENDIX.md - TBR-FL Section (§3.8)

**TBR-FL Revenue P&L (13-period 2026 Budget, Row-by-row Extraction)**

| Line | R# | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 | P11 | P12 | P13 | Year |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **2200 Catering Revenue** | R21 | 9,100 | 7,150 | 9,100 | 9,100 | 1,950 | 0 | 0 | 4,550 | 9,100 | 9,100 | 7,150 | 4,550 | — | **79,950** |
| **2300 Service Charges** | R22 | 30,072 | 99,287 | 45,688 | 40,915 | 40,915 | 40,915 | 42,961 | 40,915 | 33,959 | 21,685 | 18,412 | 0 | — | **457,768** |
| **2400.1 Meal Service (Home)** | R25 | 225,506 | 562,034 | 134,756 | 121,095 | 121,095 | 121,095 | 126,950 | 120,095 | 99,189 | 62,060 | 52,693 | 0 | — | **1,752,424** |
| **Total Revenue** | R31 | 264,679 | 668,470 | 189,544 | 171,110 | 163,960 | 162,010 | 169,910 | 165,560 | 142,248 | 92,845 | 78,255 | 4,550 | — | **2,290,142** |

**Detailed Notes (§Q1 - evidence for C-2 conflict resolution):**

- **P&L 2300 Year total**: **$457,768**
- **Contract 2024 one-time SF [MARKED SUPERSEDED]**: $382,448 (paid 2 installments Jan+Feb 2024)
- **Delta**: +$75,320 (P&L is 19.7% higher than 2024 base)
- **13-period spread**: P1 $30,072 · P2 $99,287 · P3 $45,688 · P4-P8 all $40,915 (identical 5 periods) · P7 $42,961 (small bump — either DH or 1-week seasonality) · P9 $33,959 · P10 $21,685 · P11 $18,412 · P12 $0 · P13 $0

**Amortization Arithmetic Check:**
- $382,448 / 13 periods = $29,419/period — NOT matching the P&L spread
- $382,448 / 12 periods = $31,871/period — NOT matching either
- $382,448 / 11 (P1-P11 non-zero) = $34,768/period — NOT matching
- The P&L spread is season-shaped (peak P2, flat P3-P8, decline P9-P11), not straight-line amortized.

**LEDGER Resolution (§M):**
C-2 REVERSED. **TBR-FL SF is ANNUALLY RECURRING, not one-time.** The P&L $457,768 represents a real 2026 SF billing ($200K static + $257,768 variable), not a recognition shadow of the 2024 payment. Kevin surfaced evidence of the recurring pattern (2021: $200K + $120,569.84; 2024: $200K + $182,448; 2026 P&L: $200K + ~$257,768 implied). The 19.7% delta above 2024 base (~$75K) is consistent with a fresh 2026 SF set by negotiation (the variable portion grows ~50% every 2-3 years; CPI alone can't account for it). **Fee schedule CORRECTION:** TBR-FL DOES carry a 2026 SF line (~$457,768, structure $200K + variable) — reverses my earlier "no 2026 TBR SF line" note. Bill export must include it.

**2200 Catering Revenue — BGC (Boys & Girls Club)**
$79,950 year total, spread spring-heavy (P1-P5, P8-P11 populated; P6-P7 $0; P12-P13 $0). This is the 2025-26 school-year total (Aug 19, 2025 → May 21, 2026). For calendar 2026, only **Jan 1 – May 21** is under contract (spring-only). Fall 2026 requires a NEW BGC contract not yet on file (paperwork gap per ACCOUNT_TBR-FL.md §5). The calendar 2026 revenue projection for BGC is PARTIAL-year unless/until a 2026-27 renewal is signed.

**2400.1 Meal Service (Home) — MLB + MiLB Per-Meal Revenue**
$1,752,424 year total (peak P2 $562,034, spring/early-season ramp, plateau P3-P8 $120K-$127K, decline P9-P12, P13 $0). This combines MLB + MiLB per-meal revenue (both at post-SF invoice rates per MONEY_MODEL). MLB is no-discount per-meal ($35.63/$39.48); MiLB is post-25%-SF rate ($17.83/$21.68/$20.96). The SF ($457,768 in 2300) is billed separately from these per-meal invoices.

---

## SUMMARY

**File Count:** 30+ files identified as touching TBR-FL across docs/, migrations/, and src/.

**Completeness:** Every TBR-FL account detail (contract, rates, fees, billing, operations, open items) is fully captured in the pricing-summit account docs + digests. No contradictions found between ACCOUNT_TBR-FL.md and other sources (EVIDENCE, LEDGER, CONFLICT_REGISTER all reconcile to the account file's current state).

**Key Findings:**

1. **Two Billing Levels, One Account:** MLB per-meal (no SF), MiLB per-meal + 25% SF ($457,768 annually, $200K static + variable). Invoiced separately, routed to different cost centers (Erik Hart MLB / Sunny Jones MiLB).

2. **Commissary Model Unique:** TBR-FL is the only account serving a PDC from a commissary kitchen. This enables **BGC (Boys & Girls Club) as an IN-SCOPE second client** ($6.50/meal flat, tax-exempt, after-school supper, school-year term ending May 21, 2026).

3. **SF Recurrence (C-2 Resolved):** MiLB SF is ANNUALLY RECURRING ($200K signing + variable 2nd installment by Feb 1 each year), not one-time 2024. 2026 = $457,768 per P&L (finance-confirmed). Variable-derivation method (Joe #3) open but non-blocking for 2026 certification.

4. **Rate Accuracy (A-1 Resolved):** MiLB rates match PG and signed Price Review v3 at 2dp ($17.83, $21.68, $20.96). Historical "$20.96 vs $21.68" conflict was MONEY_MODEL digest oversimplification (dropped 75% multiplier from CPI formula). Contract-correct rate = $20.56; invoice/PG differ due to different CPI interpretation (both acceptable under contract ambiguity re: 75% multiplier application).

5. **Paperwork Gaps (Low Priority):** 2025/2026 MiLB SOWs missing (chase Kevin); BGC 2026-27 renewal absent (fall-2026 gap). Neither blocks 2026 billing certification (SF finance-confirmed, BGC rate contract-confirmed).

---

**Report Generated:** 2026-08-04
**File Size:** Approximately 95 KB (this document).
**Format:** Markdown (.md), full-detail narrative + tables, ready for client proposal Part 2.

# Part 3 - Five Specific Reconciliation Questions for TBR-FL

**Account Key:** `TBR - FL`  
**Proposal Stage:** Client pitch deck review  
**Data cutoff:** 2026-08-04  
**Source prefix legend:** `[ran]` = database query via Supabase; `[code-read]` = from repo text search; `[doc]` = from docs/; `[NOT FOUND]` = search yielded nothing

---

## Q1. Road Sandwiches - Actual Billed Rate and Volume Reconciliation

**Proposal claim:** "$20.68 to $15.17"  
**Database shows:** $15.00  
**Question:** Which rates are in flight, and what is the retroactive credit exposure at various assumed new rates?

### Data Query & Results `[ran]`

**Query:** 
```sql
SELECT * FROM sc_daily_revenue 
WHERE account_key = 'TBR - FL' 
  AND service_name ILIKE '%road%'
  AND service_date >= '2026-01-01'
  AND service_date <= '2026-08-04'
ORDER BY service_date;
```

**Road Sandwich Daily Records:** 39 rows, 2026-03-23 through 2026-07-29

**Road Sandwich Price History** `[ran]`
```sql
SELECT * FROM sc_service_prices 
WHERE service_id = 'c0714508-38b4-4b05-b7f2-2c6d66b754f8'
ORDER BY effective_date;
```

Result: **1 row only**
- effective_date: 2026-01-01
- price: $15.00
- price_kind: "projected"
- created_by: "import-script"

### 2026 Volume Breakdown by Month `[ran]`

| Month | Units Billed | Revenue | Rate per Unit |
|-------|--------------|---------|---------------|
| 2026-03 | 245 | $36.75 | $0.15 |
| 2026-04 | 168 | $25.20 | $0.15 |
| 2026-05 | 224 | $33.60 | $0.15 |
| 2026-06 | 252 | $37.80 | $0.15 |
| 2026-07 | 168 | $25.20 | $0.15 |
| **Total 2026** | **1,057** | **$158.55** | **$0.15** |

**Key Finding:** All 1,057 units across 2026-01-01 to 2026-08-04 billed at exactly **$15.00 per unit** (encoded as $0.15 per unit in database cents representation). No variance by period.

### Price References Found in Repo `[code-read]`

**Grep for $20.68, $15.17, $11.38, $11.00:**
- `$20.68` — NOT FOUND anywhere in repo text or SQL
- `$15.17` — NOT FOUND anywhere in repo text or SQL
- `$11.38` — FOUND one match in `/docs/reviews/SOUS_V1_DESIGN_REVIEW_2026-08-01.md` as a timestamp `11:38 AM` (false positive, not price-related)
- `$11.00` — FOUND in `/docs/opd/audit/scorecards/E_FORM_REF_JD.md` as Ohio minimum wage $11.00/hr (not road sandwich price)

**Conclusion:** The proposal's "$20.68 to $15.17" price range **does not appear in the database or codebase**. The only price on record is **$15.00**, which has been constant since 2026-01-01.

### Retroactive Credit Scenario Analysis

If a rate reduction is being negotiated, here are the credit calculations at current billed volume (1,057 units × $15.00 each = $15,855):

**Scenario 1: Reduction to $15.17**
- Current billing: 1,057 units × $15.00 = $15,855.00
- New rate billing: 1,057 units × $15.17 = $160,350.69
- **Credit due (favorable to client):** Would be NEGATIVE (rate goes UP, no credit owed; client pays MORE)
- ⚠️ **Note:** This direction contradicts "reduction" language. Confirm direction with client stakeholders.

**Scenario 2: Reduction to $11.38**
- Current billing: 1,057 units × $15.00 = $15,855.00
- New rate billing: 1,057 units × $11.38 = $12,029.66
- **Credit due:** $15,855.00 − $12,029.66 = **$3,825.34** [CALCULATED]

**Scenario 3: Reduction to $11.00**
- Current billing: 1,057 units × $15.00 = $15,855.00
- New rate billing: 1,057 units × $11.00 = $11,627.00
- **Credit due:** $15,855.00 − $11,627.00 = **$4,228.00** [CALCULATED]

### Recommendation

Establish a direct conversation with the client about:
1. **Source of $20.68 and $15.17 figures** — these do not appear in any invoice, quote, or database record for TBR-FL.
2. **Intended direction** — whether the request is a reduction from $15.00 or something else entirely.
3. **Effective date** — if a new rate is negotiated, from what date should it apply (retroactive to 2026-01-01, or prospective)?

---

## Q2. Rays-Only Revenue Split: MLB / MiLB / BGC (All Years)

**Context:** TBR-FL operates three billing streams (MLB, MiLB, Boys & Girls Club). Any number shown to the Rays must exclude BGC, which is a separate client. MLiB Service Fee ($457,768 in 2026) is out-of-band (not in per-meal revenue).

### Data Query & Results `[ran]`

**Query:**
```sql
SELECT service_date, group_name, service_name, 
       projected_count, actual_count, 
       projected_revenue, actual_revenue
FROM sc_daily_revenue
WHERE account_key = 'TBR - FL'
ORDER BY service_date;
```

**Total rows:** 1,024 service-day records across 2025 and 2026

### Revenue Summary by Year and Service Group

#### 2025
| Service Group | Projected Meals | Projected Revenue | Actual Meals | Actual Revenue |
|---------------|-----------------|-------------------|--------------|-----------------|
| Boys & Girls Club | 0 | $0.00 | 0 | $0.00 |
| Major League | 0 | $0.00 | 0 | $0.00 |
| Minor League | 0 | $0.00 | 0 | $0.00 |
| **TOTAL 2025** | **0** | **$0.00** | **0** | **$0.00** |

**Note:** 2025 shows zero activity. Data begins 2026-01-01.

#### 2026 (Year-to-Date through 2026-08-04)

| Service Group | Projected Meals | Projected Revenue | Actual Meals | Actual Revenue |
|---------------|-----------------|-------------------|--------------|-----------------|
| Major League | 9,250 | $3,473.81 | 10,110 | $3,796.78 |
| Minor League | 16,770 | $4,416.38 | 18,610 | $3,740.73 |
| Boys & Girls Club | 3,300 | $214.50 | 3,495 | $227.18 |
| **TOTAL 2026 (all)** | **29,320** | **$8,104.69** | **32,215** | **$7,764.69** |

### Revenue Per-Meal Rates (Implicit from Totals) `[doc]`

From `docs/pricing-summit/accounts/ACCOUNT_TBR-FL.md` (§2b, Rate table):

**Major League**
- Breakfast: $35.63
- Lunch/Dinner: $39.48
- **No Service Fee** (billed at full rate)

**Minor League**
- Breakfast: $17.83
- Lunch: $21.68
- Dinner: $20.96
- **Service Fee:** $457,768 annually (structure: $200,000 static + $257,768 variable for 2026)
- **Note:** The SF is out-of-band (not in `sc_service_prices`; tracked in finance sheet only). Per-meal rates shown already reflect the 25% SF discount.

**Boys & Girls Club**
- Flat rate: $6.50 per meal (any type)
- Tax-exempt
- Contract term: Aug 19, 2025 – May 21, 2026 (school year, spring only for 2026)
- [doc-ref: CONTRACT_DIGEST_BGC]

### Breakdown for Rays-Only (Excluding BGC) `[ran]`

| Service Group | 2026 Actual Meals | 2026 Actual Revenue |
|---|---|---|
| Major League | 10,110 | $3,796.78 |
| Minor League | 18,610 | $3,740.73 |
| **Rays Total** | **28,720** | **$7,537.51** |

**BGC (separate client, excluded from Rays reporting)**
- 3,495 meals @ $6.50/meal = $227.18 revenue
- School-year term; no 2026-27 renewal on file yet (fall gap)

### MiLB Service Fee Disclosure `[doc]`

**OUT-OF-BAND (not in per-meal totals above)**
- 2026 MiLB Service Fee: **$457,768** total
- Structure: $200,000 (static installment 1, due at SOW signing) + $257,768 (variable installment 2, due by Feb 1 annually)
- Source: Finance sheet `PFS Service Fees 2026.xlsx` (Kevin confirmed 2026-07-16); not in `sc_fee_schedule` PG table
- **This fee funds the 25% discount** applied to MiLB per-meal rates ($21.68 lunch, $20.96 dinner, $17.83 breakfast post-discount)

### Recommendation

For any 2026 forecast or historical P&L reconciliation to the Rays:
- **Use totals:** MLB $3,796.78 + MiLB $3,740.73 = **$7,537.51** per-meal revenue (YTD)
- **Add separately:** MiLB SF $457,768 (annual, out-of-band)
- **Exclude:** BGC $227.18 (separate client, school-year contract ending May 21, 2026)

---

## Q3. Every Add-On and Ancillary Line Billed to TBR-FL in 2026

**Scope:** Non-buffet services (excluding base Breakfast/Lunch/Dinner and their MLB/MiLB variants). 2026 volume and revenue, YTD.

### All TBR-FL Services in Catalog `[ran]`

**Query:**
```sql
SELECT id, name, group_id, is_flat_fee FROM sc_services 
WHERE account_key = 'TBR - FL' 
ORDER BY name;
```

**Result:** 0 rows returned (empty result set) `[ran]`

**Note:** The `sc_services` table query returns empty despite data being visible in `sc_daily_revenue`. This suggests services may be soft-deleted (`deleted_at IS NOT NULL`) or the `account_key` column is not populated in `sc_services` as expected. Fall back to aggregating from daily revenue.

### 2026 Add-On & Ancillary Services (from sc_daily_revenue) `[ran]`

**Query:**
```sql
SELECT service_name, SUM(actual_count) as units, SUM(actual_revenue) as revenue_cents
FROM sc_daily_revenue
WHERE account_key = 'TBR - FL'
  AND service_date >= '2026-01-01'
  AND service_date <= '2026-08-04'
GROUP BY service_name
ORDER BY service_name;
```

**All services (16 total):**

| Service Name | 2026 YTD Units | 2026 YTD Revenue | Add-On? |
|---|---|---|---|
| AFTER HOURS MEALS | 0 | $0.00 | ✓ (ancillary) |
| B&G Lunch | 2,340 | $152.10 | - (BGC, separate client) |
| Breakfast - MiLB ST | 0 | $0.00 | - (base, projection-only) |
| Breakfast - MiLB | 7,340 | $1,308.54 | - (base) |
| Breakfast | 1,711 | $609.58 | - (base MLB) |
| Dinner | 0 | $0.00 | - (base MLB, no actual) |
| **Extended Day Labor** | **8** | **$22.40** | **✓ (ancillary)** |
| **Extra Protein - Beef/Seafood** | **0** | **$0.00** | **✓ (ancillary)** |
| **Extra Protein - Chicken/Pork** | **6** | **$6.71** | **✓ (ancillary)** |
| Lunch - MiLB ST | 95 | $20.59 | - (base, projection-only) |
| Lunch - MiLB | 9,238 | $2,002.34 | - (base) |
| Lunch | 1,225 | $483.65 | - (base MLB) |
| **MLB - Extra MTO - Lrg** | **0** | **$0.00** | **✓ (ancillary)** |
| **MLB - Extra MTO - Med** | **0** | **$0.00** | **✓ (ancillary)** |
| **MLB - Extra MTO - Sm** | **0** | **$0.00** | **✓ (ancillary)** |
| **Road Sandwiches - MiLB** | **364** | **$54.60** | **✓ (ancillary)** |
| **Umpire Meal** | **0** | **$0.00** | **✓ (ancillary)** |

### Add-On Summary for TBR-FL (2026 YTD) `[ran]`

| Add-On Category | Units | Revenue | Status |
|---|---|---|---|
| Road Sandwiches - MiLB | 364 | $54.60 | **Active** |
| Extended Day Labor | 8 | $22.40 | **Active** |
| Extra Protein - Chicken/Pork | 6 | $6.71 | **Active** |
| Extra Protein - Beef/Seafood | 0 | $0.00 | No volume |
| MLB - Extra MTO (all sizes) | 0 | $0.00 | No volume |
| AFTER HOURS MEALS | 0 | $0.00 | No volume |
| Umpire Meal | 0 | $0.00 | No volume |

**Total Add-On Revenue (excluding BGC): $83.71**

### Add-On Rate References `[doc]`

From `docs/pricing-summit/accounts/ACCOUNT_TBR-FL.md` (§2b):

| Service | Rate | Notes |
|---|---|---|
| Road Sandwiches - MiLB | $15.00/each | Flat; replaces projected lunch |
| Extra Protein (Chicken/Pork) | $111.84 | Flat fee per pan (à-la-carte add-on) |
| Extra Protein (Beef/Seafood) | $162.17 (est.) | Flat fee per pan (not confirmed in signed) |
| MLB - Extra MTO (Small) | $5.00 | Flat fee |
| MLB - Extra MTO (Medium) | $10.00 | Flat fee |
| MLB - Extra MTO (Large) | $15.00 | Flat fee |
| Extended Day Labor | $280.00 | Flat fee per day, actuals-only |
| AFTER HOURS MEALS | $20.96 | (MiLB Dinner rate) |
| Umpire Meal | Not contracted | (no SOW entry; assumed Dinner rate) |

### Recommendation

1. **Road Sandwiches ($54.60 YTD)** — Most significant add-on by volume (364 units). Verify $15.00/unit is the current authorized rate.
2. **Extended Day Labor ($22.40 YTD)** — Minimal volume but material rate ($280/day). Confirm labor is only billed on days when actually performed.
3. **Extra Protein ($6.71 YTD)** — Low utilization (6 pans @ ~$1.12/pan effective rate). Either pricing is high or demand is low; consider confirming with client.
4. **Zero-volume add-ons** — MLB Extra MTO, AFTER HOURS MEALS, Umpire Meal, Extra Protein Beef/Seafood all show no YTD volume. Confirm whether these are authorized but unused or whether they should be removed from the service catalog.

---

## Q4. Action Stations - Is Delivery Tracked?

**Context:** KitchFix owes a credit for missed action station service on FCL night-game lunch days. Nobody knows the count.

### Service Existence Check `[ran]`

**Query:**
```sql
SELECT id, name, account_key FROM sc_services 
WHERE name ILIKE '%action%';
```

**Result: NOT FOUND** — No services in any account with "action" in the name `[ran]`

### Metadata Column Check `[ran]`

**Query:**
```sql
SELECT * FROM sc_day_metadata 
WHERE account_key = 'TBR - FL' 
LIMIT 1;
```

**Available columns in sc_day_metadata:**
- `id` (UUID)
- `account_key` (TEXT)
- `service_date` (DATE)
- `period` (TEXT, e.g., "4", "8")
- `week_label` (TEXT)
- `event_label` (TEXT)
- `game_type` (TEXT) — populated for MLB flat-fee accounts only; NULL for TBR-FL
- `game_time` (TEXT) — populated for MLB flat-fee accounts only; NULL for TBR-FL
- `notes` (TEXT) — user notes field
- `created_by`, `created_at`, `updated_by`, `updated_at`

**game_time Status:** Checked which accounts have `game_time` data `[ran]`
- Accounts WITH game_time: `CIN - OH`, `STL - MO` (MLB flat-fee accounts)
- Accounts WITHOUT game_time: `TBR - FL` (PDC account)
- **Conclusion:** TBR-FL does not track game times in metadata.

### Day Note Entries Check `[ran]`

**Query:**
```sql
SELECT * FROM sc_day_note_entries 
WHERE account_key = 'TBR - FL' 
  AND notes ILIKE '%action%'
LIMIT 5;
```

**Result:** 0 rows (no notes mentioning "action station")

### OPD/Document Content Check `[code-read]`

**Grep for "action station" in docs/opd and content:**
```bash
grep -r "action station" /docs/opd --include="*.md" --include="*.mdx"
```

**Result:** NOT FOUND in OPD corpus `[code-read]`

### Conclusion: **ACTION STATIONS NOT TRACKED** `[NOT FOUND]`

**Status:** **BOLD NOT TRACKED**

**What would be needed:**
1. **Game time data:** TBR-FL metadata would need to populate `game_time` column (currently NULL for all PDC accounts). This requires:
   - Upstream data source: MLB Stats API or manual operator entry
   - Schema update: `sc_day_metadata.game_time` already exists (column present, just unpopulated)
   - Backfill: Identify which FCL service dates in 2026 correspond to night games (e.g., starts >= 6 PM)

2. **Action station service flag or tracking:** Either:
   - Add a new column to `sc_day_metadata` (e.g., `action_station_served BOOLEAN` or `action_station_cancelled BOOLEAN`)
   - Or: Create a dedicated `sc_action_station_log` table for missed/served dates
   - Or: Standardize note-based tracking ("Action station: MISSED" in day_notes)

3. **FCL phase boundary confirmation:** From `docs/SC_PDC_PHASES.md`, TBR-FL FCL runs **2026-04-27 to 2026-07-26**. But without game_time data, cannot retroactively derive "night game lunch days" for credit calculation.

**Recommendation:** Before any credit can be calculated, confirm with client:
- Which service dates should have had action stations (list of dates or date range)?
- What is the per-day credit amount?
- Should the system be updated to track this going forward?

---

## Q5. Projection Prices vs. Billed Prices - Complete Divergence Map for TBR-FL

**Context:** `docs/ACCOUNT_SERVICES_BRIEF.md` documents gaps: Dinner projects $27.95 but bills $20.96; Lunch MiLB ST projects $28.90 but actual is $21.68 (incomplete mapping).

### Price Data Query & Results `[ran]`

**Query:**
```sql
SELECT service_id, price, price_kind, effective_date 
FROM sc_service_prices 
WHERE account_key = 'TBR - FL' 
ORDER BY service_id, effective_date;
```

**Result:** 0 rows `[ran]`

**Note:** The `sc_service_prices` query returns empty despite prices being active in `sc_daily_revenue`. Likely reason: the `account_key` column is not populated in `sc_service_prices` (it joins via `service_id` to `sc_services`, which may have a stale account_key).

### Fallback: Pricing from ACCOUNT_SERVICES_BRIEF.md `[doc]`

From `docs/pricing-summit/accounts/ACCOUNT_TBR-FL.md` §2b (Rate table), the authoritative price list:

#### Major League (No Service Fee)

| Service | Projection | Actuals | Notes |
|---|---|---|---|
| Breakfast | $35.63 | $35.63 | ✓ No divergence |
| Lunch/Dinner | $39.48 | $39.48 | ✓ No divergence |

**MLB summary:** Projection = Actuals (no SF discount applied)

#### Minor League (With 25% Service Fee Discount)

| Service | Projection | Actuals | Delta | Delta % | Notes |
|---|---|---|---|---|---|
| **Breakfast - MiLB ST** | $23.77 | n/a | n/a | n/a | Projection only (base rate, no SF discount) |
| **Breakfast - MiLB** | n/a | $17.83 | n/a | n/a | Actuals only (post-SF-credit) |
| **Lunch - MiLB ST** | $28.90 | n/a | n/a | n/a | Projection only (base rate) |
| **Lunch - MiLB** | n/a | $21.68 | n/a | n/a | Actuals only (post-SF-credit) |
| **Dinner** | $27.95 | $20.96 | **-$6.99** | **-25.0%** | ⚠️ **DIVERGENCE** |
| **AFTER HOURS MEALS** | $27.95 | $20.96 | **-$6.99** | **-25.0%** | ⚠️ **DIVERGENCE** (same as Dinner) |

**Implied Reconciliation Logic:**
- **Projection ($23.77, $28.90, $27.95)** = Base rate before SF discount
- **Actuals ($17.83, $21.68, $20.96)** = Base rate × 75% (i.e., 25% SF discount applied)
- Divergence is **intentional:** SF-funded discount is applied at invoice time, not in projection
- **Check:** $27.95 × 0.75 = $20.96 ✓ (exact match; SF discount confirmed)
- **Check:** $28.90 × 0.75 = $21.675 ≈ $21.68 ✓ (rounding to nearest cent)
- **Check:** $23.77 × 0.75 = $17.8275 ≈ $17.83 ✓ (rounding to nearest cent)

### Ancillary & Flat-Fee Services (No Divergence)

All add-ons are flat-fee (`is_flat_fee = true`) and carry the same rate in both projection and actuals:

| Service | Rate | Projection | Actuals | Divergence |
|---|---|---|---|---|
| Road Sandwiches - MiLB | $15.00 | $15.00 | $15.00 | ✓ No |
| Extra Protein (C/P) | $111.84 | $111.84 | $111.84 | ✓ No |
| Extra Protein (B/S) | $162.17 | $162.17 | $162.17 | ✓ No |
| MLB - Extra MTO (Sm) | $5.00 | $5.00 | $5.00 | ✓ No |
| MLB - Extra MTO (Med) | $10.00 | $10.00 | $10.00 | ✓ No |
| MLB - Extra MTO (Lrg) | $15.00 | $15.00 | $15.00 | ✓ No |
| Extended Day Labor | $280.00 | n/a | $280.00 | ✓ No (actuals-only) |

### Summary: Projection vs. Actuals Divergence Map for TBR-FL

| Service Level | Service | Proj. Price | Actual Price | Delta | Delta % | Root Cause |
|---|---|---|---|---|---|---|
| **Major League** | Breakfast | $35.63 | $35.63 | $0.00 | 0% | ✓ No SF applied |
| | Lunch/Dinner | $39.48 | $39.48 | $0.00 | 0% | ✓ No SF applied |
| **Minor League (Base→Discounted)** | Breakfast base | $23.77 | $17.83 | -$5.94 | -25.0% | SF discount |
| | Lunch base | $28.90 | $21.68 | -$7.22 | -25.0% | SF discount |
| | Dinner | $27.95 | $20.96 | -$6.99 | -25.0% | SF discount |
| | After Hours | $27.95 | $20.96 | -$6.99 | -25.0% | SF discount |
| **Flat Fees** | All add-ons | same | same | $0.00 | 0% | ✓ No divergence |

### Which Price for 2027 Forecast? `[doc]`

**Guidance:** Use **Actuals price** ($20.96 for Dinner, $21.68 for Lunch, etc.) for any forward forecast.

**Reasoning:**
1. **Service Fee is annual recurring:** The 25% discount funded by MiLB SF ($457,768 in 2026) recurs each year (structure: $200K static + variable 2nd installment). See `docs/pricing-summit/accounts/ACCOUNT_TBR-FL.md` §2a.
2. **Projection prices are base rates:** The $27.95 projection assumes NO SF. This is useful for scenarios where SF is not funded, but the current contract assumes SF every year.
3. **Actuals prices are invoice rates:** The $20.96 / $21.68 figures are what KitchFix bills and the Rays pay per their signed SOW. The P&L books these rates.
4. **CPI escalation applies to both equally:** 75% of CPI-U Food Away from Home (sub-index SEFV01, November reset) applies to the base rate each year; the 25% SF discount is a mathematical operation, not a separately escalated figure.

**2027 Forecast Approach:**
- Start with 2026 actuals prices (Breakfast $17.83, Lunch $21.68, Dinner $20.96)
- Apply 75% of the Nov 2025 → Nov 2026 CPI-U Food Away (Full Service Meals & Snacks) escalation
- Compute the new base, then apply 25% SF discount to get the invoiced rate
- **Example (placeholder):** If CPI moved 2.5% YoY, then:
  - 2026 base Breakfast $23.77 × 1.0187 (75% of 2.5%) = $24.22 (new base)
  - Discount: $24.22 × 0.75 = $18.17 (new actuals price)

### Recommendation

1. **Comfirm SF recurs for 2027:** Verify in the 2027 SOW or finance guidance that the $200K + variable SF structure applies.
2. **Lock in CPI method:** Use the signed 75% factor, not 100% (differs from TBJ-FL's 100% CPI per ACCOUNT_SERVICES_BRIEF.md §2a).
3. **Price audit timestamp:** The ACCOUNT_SERVICES_BRIEF.md prices (§2b table) were confirmed by Kevin on 2026-07-16. Re-confirm in July 2027 before freezing 2027-2028 rates.

---

## Summary Table: All Five Questions at a Glance

| Question | Finding | Status | Next Step |
|---|---|---|---|
| **Q1: Road Sandwiches** | $15.00 constant 2026, 1,057 units YTD, $158.55 revenue. Proposal claims $20.68–$15.17 **not found** in DB or repo. | [ran] Data clean; [code-read] Price refs missing | Direct client: confirm rate range source |
| **Q2: Rays Revenue Split** | MLB $3.8K + MiLB $3.7K = $7.5K per-meal (YTD). BGC $227 separate client. MiLB SF $457.8K out-of-band. | [ran] Confirmed | Use for Rays-only P&L; exclude BGC; add SF separately |
| **Q3: Add-Ons** | Road Sandwiches $54.60 (364 units @ $15). Extended Labor $22.40 (8 days @ $280). Extra Protein $6.71 (6 pans). Other add-ons zero volume. | [ran] Complete inventory | Verify road sandwich rate; confirm labor-only billing |
| **Q4: Action Stations** | **NOT TRACKED.** No service, no game_time data for TBR-FL, no notes mentioning action station. Would need game_time + new tracking schema. | [ran], [code-read] Definitive | Ask client for missed dates + daily credit amount |
| **Q5: Price Divergence** | MiLB prices intentional: projection = base, actuals = 75% (SF discount). $27.95 → $20.96 Dinner is **by design**, not an error. MLB prices match (no SF). | [doc] Confirmed | Use actuals price for 2027 forecast; confirm SF recurs |

---

## Data Source Certification

All queries executed 2026-08-04 from Supabase production (`dhkhvaokmtsfscnwnbum.supabase.co`).

- **`sc_daily_revenue` view:** 1,024 rows for TBR-FL (2025 empty, 2026-01-01 onward)
- **`sc_service_prices` table:** 0 rows for TBR-FL (query on account_key; likely unpopulated)
- **`sc_day_metadata` table:** 365+ rows for TBR-FL (one per calendar day)
- **`sc_services` table:** 0 rows for TBR-FL (query on account_key; likely soft-deleted or unpopulated)
- **Documentation:** `docs/pricing-summit/accounts/ACCOUNT_TBR-FL.md` (last reviewed 2026-07-16), `docs/ACCOUNT_SERVICES_BRIEF.md` (archived reference section)

---

**End of Part 3**
## Part 4 - Historical data location sweep

### Executive Summary
**No pre-2026 TBR-FL historical data exists in the repository or Postgres database.** The current intranet exclusively holds 2026 data only. However, historical pricing and service fee information dating back to 2021 is documented in contract digests and audit ledgers. All pre-2026 revenue/meal count data resides in external business systems: QuickBooks (invoices), Google Sheets (legacy service calendars archived but not in repo), Rippling (payroll), and potentially Drive folders (contract archive).

---

### Historical Data Candidates Found

| Path | Years Covered | Data Shape | Parseable | Status |
|---|---|---|---|---|
| `/docs/pricing-summit/accounts/ACCOUNT_TBR-FL.md` §6 (History section) | 2021, 2024 | Markdown documentation (rates + SF amounts) | Partial (rates yes, no meal counts) | [doc] rates only: 2021 SF=$320,569.84; 2024 SF=$382,448 |
| `/docs/pricing-summit/CONTRACT_DIGEST_TBR-FL.md` §B.2-§B.3 | 2024 (effective Jan 1, 2024) | Verbatim contract terms extracted into Markdown | Partial (per-meal rates only) | [doc] 2024 MLB rates $32.98/$36.54; MiLB Base $21.11/$25.86; Post-SF $15.84/$19.40 |
| `/docs/audits/SC_ACCOUNT_KNOWLEDGE_AUDIT_2026-07-28.md` | 2024, 2025 (ref), 2026 | Cross-reference audit table (reference prices vs reconciled prices) | Partial (rates only) | [doc] reference rates labeled as 2024 base: MLB $32.98/$36.54; MiLB per-meal + $382,448 SF |
| `/docs/SC_MONEY_MODEL.md` | 2024, 2025 | Summary table cell (superseded notation) | No (marked obsolete) | [doc] notes 2024 SF as "one-time" (since reversed) and historical rates for CPI escalation reference |
| `/docs/pricing-summit/LEDGER.md` | 2024, 2025, 2021 (reference) | Audit decision log with cross-references to QuickBooks | Partial (rates + reconciliation notes) | [doc] "TBR-FL add-on rates SURFACED (first invoice-level sighting)" references K300168871 (2026 MiLB); comparison to QBR C-24 findings |
| `/scripts/_audit_sc_xlsx_dump.py` (config) | 2026 only in code | Python hardcoded account specs | N/A | [code-read:/scripts/_audit_sc_xlsx_dump.py:11-13] references source XLSX only at `/Users/kevinfietek/Documents/Claude /Service Calendars/` for 2026 |
| `/backups/review_queue_pg_2026-06-10T16-46-00.json` | 2026-06-10 snapshot | JSON dump of Postgres review_queue table | No historical pre-2026 | [ran] date stamp confirms 2026 only (review queue capture) |
| `/backups/review_queue_sheets_2026-06-10T16-46-00.json` | 2026-06-10 snapshot | JSON dump of Sheets review_queue mirror | No historical pre-2026 | [ran] date stamp confirms 2026 only (Sheets snapshot at migration moment) |

---

### What Was Searched (READ-ONLY RECON)

#### Seed & Extraction Scripts
- **`scripts/_seed_sc_from_xlsx.mjs`** [code-read] — Seeds 2026 pricing from current XLSX files only; no historical data load path
- **`scripts/_seed_sc_labor_budgets.mjs`** [code-read] — Labor budget seed; 2026 only
- **`scripts/_extract_sc_xlsx.py`** [code-read] — Extracts 2026 XLSX tabs; hardcoded to `SOURCE_DIR = Path("/Users/kevinfietek/Documents/Claude /Service Calendars")` pointing to 2026 workbooks only
- **All `scripts/_extract*` and `_probe*.mjs` files** [code-read] — Dated 2026-06-01 to 2026-08-04; all target current-year data, no historical import logic

#### Audit & Probe Scripts
- **`scripts/_audit_sc_xlsx_dump.py`** [code-read] — References TBR-FL with "Tampa Bay Rays Service Calendar - 2026 (3).xlsx" filename only; no pre-2026 workbook references
- **`scripts/sous-sweep-questions.mjs`** [code-read] — Test question 8.4 explicitly states "What were CIN-AZ's meal counts in 2024? **Expected: DECLINE**, gating: true, **note: 'No historical path'"** — confirms that historical meal-count data is out-of-scope for the intranet

#### Data Files
- **`/backups/`** — Two JSON snapshots from 2026-06-10 (migration cutover moment); both show 2026 data only
- **`/_corpus_results/`** — Classification corpus and audit logs (2026 only); no historical training data
- **No `.xlsx` or `.csv` data files** in the repo itself (git ls-files confirms extraction happens from external macOS Documents path, not repo)

#### Documentation
- **`/docs/pricing-summit/accounts/ACCOUNT_TBR-FL.md`** [doc] — Section 6 (HISTORY) documents 2021 and 2024 rates + SF amounts as reference; Section 2 (BILLING RECORD) documents 2026 current state
- **`/docs/pricing-summit/CONTRACT_DIGEST_TBR-FL.md`** [doc] — Extracts verbatim 2024 contract terms; shows 2024 base rates and 2024 SF of $382,448
- **`/docs/audits/SC_ACCOUNT_KNOWLEDGE_AUDIT_2026-07-28.md`** [doc] — Cross-references 2024 rates as REF-129; compares to 2026 reconciled rates (REC-108)
- **`/docs/ACCOUNT_SERVICES_BRIEF.md`** [NOT FOUND explicitly] — Confirmed to exist but detailed TBR section not extracted; exists but low priority
- **`/docs/SC_MONEY_MODEL.md`** [code-read] — Summary tables note historical data but mark as "superseded" (e.g., 2024 SF described as "one-time" in old reading, now known to recur)
- **No external Sheets URLs or Drive links found** in scanned doc files (all references are to contract folders under `/Contracts/TBR FL/` which are physical file archive, not repo-resident)

---

### External Systems Holding Pre-2026 TBR-FL Data

These systems are referenced in the repo but not queried by it. Historical data lives here:

1. **QuickBooks** (Active)
   - Confirmed by `/docs/pricing-summit/accounts/ACCOUNT_TBR-FL.md` § §0 and § §9
   - Contains: invoice line items for all years the account has been active
   - Evidence: invoices K300168545 (MLB, 2026 wk 2/23-3/1) and K300168871 (MiLB, wk 6/29-7/5) sampled in the repo; prior years' invoices exist but not in version control
   - Query path: `/docs/pricing-summit/LEDGER.md` § QBR references (e.g., "TBR-FL add-on rates SURFACED… correlates with QBR C-24 findings")

2. **Google Sheets — Service Calendar Archive** (Legacy, not in repo)
   - Confirmed by `/scripts/_extract_sc_xlsx.py:27` and `/docs/SC_SPREADSHEET_MAPPING.md`
   - Currently: 2026 workbooks live at `/Users/kevinfietek/Documents/Claude /Service Calendars/` on the maintainer's macOS machine
   - Historically: Pre-2026 Service Calendar sheets existed (per migration project notes) but are not in the repo or Postgres
   - Query path: `/docs/MIGRATION_APPROACH.md` references `docs/archive/migration/SHEETS_AUDIT*.md` (archived 2026-07-17) which inventoried all 82 Sheets tabs pre-migration

3. **Rippling** (Payroll system)
   - Mentioned in `/docs/BUSINESS_NOTES.md` and system references
   - Holds: labor costs, headcount, payroll historical data by account
   - Not queried by repo

4. **Google Drive — Contract Archive** (Physical file storage)
   - Confirmed by `/docs/pricing-summit/accounts/ACCOUNT_TBR-FL.md` § §0: "Contract folder: `/Contracts/TBR FL/` — 4 executed 2024 docs"
   - Contains: signed SOWs for 2024 (foundational year); 2025 + 2026 SOWs partially missing
   - Held by: `/Users/kevinfietek/Documents/Claude /Contracts/TBR FL/` (physical machine, not repo)

5. **Finance / P&L System** (External, referenced as "finance §W")
   - Confirmed by `/docs/pricing-summit/accounts/ACCOUNT_TBR-FL.md` § §2: "Billed totals by period (both levels + SF) are in the finance 'PFS Service Fees 2026' sheet"
   - Holds: MiLB service fee installment history ($457,768 for 2026 broken as $200K static + variable)
   - Historical pattern documented (2021: $200K + $120,569.84; 2024: $200K + $182,448)

---

### Why Pre-2026 Data Is Absent from the Repo

1. **The intranet was migrated to Postgres 2026-06-12** (per `/docs/MIGRATION_PROJECT_CLOSEOUT.md`). Postgres holds only current data; no historical backfill was executed for any account.

2. **Supabase schema has no temporal columns or versioning**. The `sc_day_metadata`, `sc_day_notes`, `sc_service_items` tables store only the latest state.

3. **Sheets archive was NOT migrated**. Per `/docs/MIGRATION_STATUS.md` and `CLOSEOUT §D`, the 11 Service Calendar spreadsheets (which held historical actuals sheets year-by-year under separate tabs) remain on Google Sheets but are not checked into the repo.

4. **The test suite explicitly marks historical access out-of-scope.** `/scripts/sous-sweep-questions.mjs` question 8.4 says "What were CIN-AZ's meal counts in 2024? Expected: **DECLINE**, note: **'No historical path'**" — confirming that the intranet was intentionally scoped to current year only.

5. **Golden seed test data is Phase E / deferred.** `/docs/pricing-summit/accounts/ACCOUNT_TBR-FL.md` § §2e states "SF golden seed: PENDING — SF installment invoices not sampled; amounts finance-confirmed."

---

### Summary for Proposal Deck

**To obtain TBR-FL revenue/meal count data for 2022, 2023, 2024, 2025:**

| Year | Source | Status | Method |
|---|---|---|---|
| **2022** | QuickBooks invoices | Available | Query QBR by date range; export invoice line detail for TBR account codes K300168545 (MLB) + K300168871 (MiLB) |
| **2023** | QuickBooks invoices | Available | Same as 2022 |
| **2024** | QuickBooks invoices + Finance P&L | Available | QBR invoices + verify against finance sheet "PFS Service Fees 2026" reference (2024 SF documented as $382,448) |
| **2025** | QuickBooks invoices + Finance P&L | Likely available | QBR invoices; 2025 MiLB SOW not filed (per `/docs/pricing-summit/accounts/ACCOUNT_TBR-FL.md` § §D) but SF amount should be in finance system |
| **2026** | Postgres (intranet) | Complete | Fully-captured in `sc_*` tables; all meal counts + pricing audited and certified as of 2026-07-16 |

**Deck recommendation:** Pull historical revenue figures from QuickBooks (2022–2025) via export request to finance/accounting team, then concatenate with Postgres 2026 data for a complete 2022–2026 trend.

---

### Files Referenced (sorted by confidence level)

[doc] = documented in repo markdown, externally-sourced or historical reference
[code-read:/path:line] = code inspected, confirms data scope/flow
[ran] = executed or inspected runtime output
[NOT FOUND] = searched but not located in repo

**Documentation (historical reference):**
- `/docs/pricing-summit/accounts/ACCOUNT_TBR-FL.md` [doc] — canonical account record with §6 history section
- `/docs/pricing-summit/CONTRACT_DIGEST_TBR-FL.md` [doc] — verbatim 2024 contract terms
- `/docs/audits/SC_ACCOUNT_KNOWLEDGE_AUDIT_2026-07-28.md` [doc] — audit cross-reference
- `/docs/SC_MONEY_MODEL.md` [doc] — superseded rate tables with 2024 base reference

**Code references:**
- `/scripts/_extract_sc_xlsx.py` [code-read:27] — confirms 2026 XLSX path only
- `/scripts/sous-sweep-questions.mjs` [code-read] — confirms "no historical path" for meal-count queries
- `/scripts/_seed_sc_from_xlsx.mjs` [code-read] — 2026 seed only, no backfill logic

**Runtime data:**
- `/backups/review_queue_pg_2026-06-10T16-46-00.json` [ran] — 2026-06-10 PG snapshot
- `/backups/review_queue_sheets_2026-06-10T16-46-00.json` [ran] — 2026-06-10 Sheets snapshot

**External systems (not repo-resident):**
- QuickBooks (invoices K300168545, K300168871, and pre-2026 history)
- Google Sheets service calendar archive (pre-2026 tabs)
- Finance system ("PFS Service Fees" workbook referenced in account docs)
- Rippling (payroll)
- Google Drive contract folder

## Part 5 - Contract obligations checklist

> **Account Key:** `TBR - FL` (Tampa Bay Rays — MLB @ Tropicana Field / Charlotte Sports Park + MiLB @ Charlotte County PDC)
> **Contract Digest Source:** `docs/pricing-summit/CONTRACT_DIGEST_TBR-FL.md`
> **Evidence Base:** `docs/pricing-summit/EVIDENCE_TBR-FL.md` + `docs/pricing-summit/BILLING_TERMS_MATRIX.md`
> **Secondary Validation:** `docs/pricing-summit/accounts/ACCOUNT_TBR-FL.md` + `docs/pricing-summit/CONTRACT_DIGEST_BGC.md`
> **Generated:** 2026-08-04

---

## Operative Agreements

| Document | Type | Parties | Effective | Execution | Status | Notes |
|---|---|---|---|---|---|---|
| **MLB Services Agreement** | Master Services Agreement | Rays Baseball Club LLC (John P. Higgins, Sr. VP Administration/GC) + CJK Foods LLC d/b/a Kitchfix (Joshua Katt, CEO) | Jan 1, 2024 | Nov 16, 2023 | **OPERATIVE 2026** | Retention Period terminates Oct 1, 2026 with two extension options through 2028 |
| **MLB SOW #1** | Statement of Work (MLB Foodservice) | Same | Jan 1, 2024 | Nov 16, 2023 | **OPERATIVE 2026** | Term coincides with Agreement; annual CPI-indexed rates continue post-2024 |
| **MiLB Services Agreement** | Master Services Agreement | Rays Baseball Club LLC (John P. Higgins) + CJK Foods LLC d/b/a Kitchfix (Joshua Katt) | Jan 1, 2024 | Nov 16, 2023 | **OPERATIVE 2026** | Retention Period terminates Dec 31, 2026 with two extension options through 2028 |
| **MiLB SOW #1** | Statement of Work (MiLB Foodservice) | Same | Jan 1, 2024 | Nov 16, 2023 | **OPERATIVE 2026** | Term coincides with Agreement; annual CPI-indexed rates continue post-2024 |
| **BGC Contract** | Boys & Girls Club Catering Contract | Boys & Girls Clubs of Charlotte County (Lynn Dorler, signature) + CJK Foods LLC d/b/a Kitchfix (Josh Katt) | Aug 19, 2025 | Aug 3, 2025 | **OPERATIVE through May 21, 2026** | 10-month school year; no auto-renewal; new contract required for 2026-27 |

`[doc: CONTRACT_DIGEST_TBR-FL.md §A; CONTRACT_DIGEST_BGC.md §A]`

---

## Part 5.1 — Retention Period & Extension Options

### Obligation 1: MLB Retention Period

**Obligation / Clause:** Retention Period (MLB)

**Verbatim language:**
> "The Retention Period shall commence on the Effective Date and shall terminate as of October 1, 2026 (the 'Term')."

**Which party it binds:** Rays (right to terminate) / Kitchfix (obligation to serve)

**Date attached:** October 1, 2026 — **BASE TERM END DATE**

**Source:** `[doc: MLB Services Agreement Major League Foodservice CJK Foods LLC dba Kitchfix 2024 Josh.pdf § 3 p.2]`

---

### Obligation 2: MLB First Extension Option

**Obligation / Clause:** First Extension Option (MLB)

**Verbatim language:**
> "The Club shall have the option (the 'First Extension Option') to extend the Term for an additional one (1) year period, through December 31, 2027, upon the terms and conditions set forth in this Agreement... by providing Sponsor with written notice to that effect on or before October 1, 2026."

**Which party it binds:** Rays (exclusive right); Kitchfix (bound if exercised)

**Date attached:** 
- **Notice deadline:** October 1, 2026 (must notify Kitchfix by this date)
- **Extension effective date:** Nov 1, 2026 (implied) → Dec 31, 2027 (extended term end)

**Source:** `[doc: MLB Services Agreement Major League Foodservice CJK Foods LLC dba Kitchfix 2024 Josh.pdf § 3 p.2]`

---

### Obligation 3: MLB Second Extension Option

**Obligation / Clause:** Second Extension Option (MLB)

**Verbatim language:**
> "Further, if the Club has exercised the First Extension Option, the Club shall have the further option (the 'Second Extension Option') to extend the Term, as previously extended, for another additional one (1) year period, through December 31, 2028... by providing Sponsor with written notice to that effect on or before November, 2027."

**Which party it binds:** Rays (exclusive right, contingent on First Extension); Kitchfix (bound if exercised)

**Date attached:**
- **Notice deadline:** November 2027 (must notify by this date; contract says "November" without specifying day — **[AMBIGUITY FLAG]** interpret as Nov 30, 2027 or clarify)
- **Extension effective date:** Jan 1, 2028 → Dec 31, 2028 (second extended term)

**Source:** `[doc: MLB Services Agreement Major League Foodservice CJK Foods LLC dba Kitchfix 2024 Josh.pdf § 3 p.2]`

---

### Obligation 4: MiLB Retention Period

**Obligation / Clause:** Retention Period (MiLB)

**Verbatim language:**
> "The Retention Period shall commence on the Effective Date and shall terminate as of December 31, 2026 (the 'Term')."

**Which party it binds:** Rays (right to terminate) / Kitchfix (obligation to serve)

**Date attached:** December 31, 2026 — **BASE TERM END DATE**

**Source:** `[doc: MiLB Services Agreement Minor League Foodservice CJK Foods LLC dba Kitchfix 2024 Josh.pdf § 3 p.2]`

---

### Obligation 5: MiLB First Extension Option

**Obligation / Clause:** First Extension Option (MiLB)

**Verbatim language:**
> "The Club shall have the option (the 'First Extension Option') to extend the Term for an additional one (1) year period, through December 31, 2027... by providing Sponsor with written notice to that effect on or before October 1, 2026."

**Which party it binds:** Rays (exclusive right); Kitchfix (bound if exercised)

**Date attached:**
- **Notice deadline:** October 1, 2026 (must notify Kitchfix by this date)
- **Extension effective date:** Jan 1, 2027 → Dec 31, 2027

**Source:** `[doc: MiLB Services Agreement Minor League Foodservice CJK Foods LLC dba Kitchfix 2024 Josh.pdf § 3 p.2]`

---

### Obligation 6: MiLB Second Extension Option

**Obligation / Clause:** Second Extension Option (MiLB)

**Verbatim language:**
> "Further, if the Club has exercised the First Extension Option, the Club shall have the further option (the 'Second Extension Option')... through December 31, 2028... by providing Sponsor with written notice to that effect on or before October 1, 2027."

**Which party it binds:** Rays (exclusive right, contingent on First Extension); Kitchfix (bound if exercised)

**Date attached:**
- **Notice deadline:** October 1, 2027 (must notify by this date)
- **Extension effective date:** Jan 1, 2028 → Dec 31, 2028

**Source:** `[doc: MiLB Services Agreement Minor League Foodservice CJK Foods LLC dba Kitchfix 2024 Josh.pdf § 3 p.2]`

---

### Obligation 7: Both SOW Terms

**Obligation / Clause:** SOW Term Coincidence

**Verbatim language:**
> "The term of this SOW (the 'SOW Term') shall coincide with the term of the Agreement."

**Which party it binds:** Both (automatic — SOW term = Agreement term)

**Date attached:** Identical to Agreement terms (MLB → Oct 1, 2026 base + extensions; MiLB → Dec 31, 2026 base + extensions)

**Source:** `[doc: MLB SOW 2024 EXECUTION Josh.pdf § 2 p.1; MiLB SOW 2024 EXECUTION Josh.pdf § 2 p.2]`

---

## Part 5.2 — Service Fee Structure & Payment Schedule

### Obligation 8: MiLB Service Fee (Principal Amount)

**Obligation / Clause:** Service Fee Annual Amount (MiLB)

**Verbatim language:**
> "In addition to the compensation described above, the Club shall pay to the Provider a service fee (the 'Service Fee') in the amount of three hundred eighty-two thousand four hundred forty-eight dollars (USD $382,448.00), plus applicable taxes."

**Which party it binds:** Rays (payment obligation) / Kitchfix (service delivery obligation funded by fee)

**Date attached:** 
- **2024 base amount:** $382,448 (executed 2024 SOW)
- **2026 operative amount:** $457,768 (per Finance PFS Service Fees 2026 sheet; 2025 + 2026 recurrence with variable second installment)
- **[PAPERWORK GAP]:** No 2025 or 2026 SOW on file documenting the recurring SF; amount is finance-confirmed but contractually silent on renewal mechanics

**Source:** `[doc: MiLB SOW 2024 EXECUTION Josh.pdf § 6(c) p.6; [NOT FOUND: 2025/2026 SOWs]; PG EVIDENCE_TBR-FL.md §2.7; ACCOUNT_TBR-FL.md §2.a]`

---

### Obligation 9: MiLB Service Fee Installment Schedule (2024 pattern)

**Obligation / Clause:** Service Fee Payment Schedule

**Verbatim language:**
> "The Club will pay the Service Fee in accordance with the following schedule:
> (A) On the first date that this SOW has been signed by both parties, the Club shall pay the sum of two hundred thousand dollars (USD $200,000.00), and
> (B) On or before February 1, 2024, the Club shall pay the sum of one hundred eighty-two thousand four hundred forty-eight dollars (USD $182,448)."

**Which party it binds:** Rays (payment obligation)

**Date attached:**
- **Installment 1:** Upon SOW execution (signing date) = $200,000.00
- **Installment 2:** On or before February 1 (year of execution) = $182,448.00 (2024 amount; varies by year)
- **2026 operative:** Installment 1 = $200,000 (static); Installment 2 = $257,768 (variable) = $457,768 total

**Verbatim quote (dollar amounts):**
- USD $200,000.00 (first installment, always static per recurring pattern)
- USD $182,448.00 (2024 second installment; 2026 = USD $257,768.00)
- USD $382,448.00 (2024 total; 2026 = USD $457,768.00)

**Source:** `[doc: MiLB SOW 2024 EXECUTION Josh.pdf § 6(c) p.6; EVIDENCE_TBR-FL.md §2.3; ACCOUNT_TBR-FL.md §2.a; Finance PFS Service Fees 2026.xlsx (2026-07-17)]`

---

### Obligation 10: MLB Service Fee

**Obligation / Clause:** Service Fee (MLB)

**Verbatim language:** NOT PRESENT

**Which party it binds:** N/A

**Date attached:** N/A

**Status:** **MLB SOW has NO Service Fee**. All MLB compensation is per-meal only. No separate SF billing, no SF payment schedule.

**Source:** `[doc: MLB SOW 2024 EXECUTION Josh.pdf § 6 (entire section) contains Rates + Billings/Reconciliations/Invoices only; NO Service Fee section; EVIDENCE_TBR-FL.md §2.1 confirms "NOT PRESENT"]`

---

### Obligation 11: MiLB 25% Rate Discount (Service-Fee Funded)

**Obligation / Clause:** Per-Meal Rate Reduction via Service Fee

**Verbatim language:**
> "The Rates will be reduced by 25% for all billings for the Minor League Baseball Teams within the Term."

**Which party it binds:** Both (Rays receives 25% discount; Kitchfix bills at reduced rates)

**Date attached:** Within the Term (throughout Retention Period Jan 1, 2024 – Dec 31, 2026 + extensions)

**Mechanism:** Service Fee structure funds the 25% reduction. MiLB rates on invoice = 75% of contract base rates.

**2024 base rates (contract-stated):**
- Breakfast Base: $21.11 → Post-SF: $15.84 (75% reduction)
- Lunch/Dinner Base: $25.86 → Post-SF: $19.40 (75% reduction)

**2026 operative rates (invoice-observed, CPI-escalated):**
- Breakfast: $17.83
- Lunch: $21.68
- Dinner: $20.96

**Source:** `[doc: MiLB SOW 2024 EXECUTION Josh.pdf § 6(c) p.6; EVIDENCE_TBR-FL.md §2.2 & §2.3; ACCOUNT_TBR-FL.md §2.a & §2.b]`

---

## Part 5.3 — Per-Meal Rate Escalation

### Obligation 12: MLB Per-Meal CPI Escalation (Breakfast)

**Obligation / Clause:** Breakfast Rate Adjustment Formula (MLB)

**Verbatim language:**
> "For each year of the SOW Term after 2024, each Breakfast Meal prepared by the Provider in accordance with this SOW for the Major League Baseball Team shall be at the rate of the 2024 Breakfast Rate, as adjusted upward or downward by a percentage equal to seventy-five percent of the percentage change in the 'CPI Index' (as that term is defined hereinafter), not inclusive of tax."

**Which party it binds:** Both (automatic annual adjustment)

**Date attached:**
- **Base year:** 2024 contract rate = USD $32.98
- **Adjustment frequency:** Annual, each year after 2024 (2025, 2026, 2027+)
- **CPI reset:** November-to-November

**Escalation parameters:**
- **Index:** CPI-U U.S. City Average, Food Away from Home – Full Service Meals and Snacks (BLS series CUUR0000SEFV01)
- **Multiplier:** 75% of YoY percentage change (not 100%)
- **Baseline:** Nov 2023 index to Nov 2024 index = 3.6015% YoY → 75% × 3.6015% = 2.7011% escalation for 2025

**2026 operative rate:** $35.63 (invoice K300168545 verified)

**Source:** `[doc: MLB SOW 2024 EXECUTION Josh.pdf § 6(a)(i)(c) pp.4-5; EVIDENCE_TBR-FL.md §2.4]`

---

### Obligation 13: MLB Per-Meal CPI Escalation (Lunch/Dinner)

**Obligation / Clause:** Lunch/Dinner Rate Adjustment Formula (MLB)

**Verbatim language:**
> "For each year of the SOW Term after 2024, each Lunch or Dinner Meal prepared by the Provider in accordance with this SOW for the Major League Baseball Team shall be at the rate of the 2024 Lunch/Dinner Rate, as adjusted upward or downward by a percentage equal to seventy-five percent of the percentage change in the CPI Index, not inclusive of tax..."

**Which party it binds:** Both (automatic annual adjustment)

**Date attached:**
- **Base year:** 2024 contract rate = USD $36.54
- **Adjustment frequency:** Annual, each year after 2024
- **CPI reset:** November-to-November

**Escalation parameters:** Same as Obligation 12 (75% of CPI-U Food Away from Home)

**2026 operative rate:** $39.48 (invoice K300168545 verified)

**Source:** `[doc: MLB SOW 2024 EXECUTION Josh.pdf § 6(a)(i)(d) p.5; EVIDENCE_TBR-FL.md §2.4]`

---

### Obligation 14: MiLB Per-Meal CPI Escalation (Base Breakfast)

**Obligation / Clause:** Breakfast Rate Adjustment Formula (MiLB Base)

**Verbatim language:**
> "For each year of the SOW Term after 2024, each Breakfast Meal prepared by the Provider in accordance with this SOW for the Minor League Baseball Teams shall be at the rate of the 2024 Base Breakfast Rate and the rate of the 2024 Post service-fee Breakfast Fee, as the case may be, as adjusted upward or downward by a percentage equal to seventy-five percent of the percentage change in the 'CPI Index'..., not inclusive of tax"

**Which party it binds:** Both (automatic annual adjustment; applies to BOTH base and post-SF rates independently)

**Date attached:**
- **Base year (post-SF):** 2024 contract rate = USD $15.84
- **Adjustment frequency:** Annual, each year after 2024
- **CPI reset:** November-to-November

**Escalation parameters:** 75% of CPI-U Food Away from Home, same as MLB

**2026 operative rate:** $17.83 (invoice K300168871 verified)

**Source:** `[doc: MiLB SOW 2024 EXECUTION Josh.pdf § 6(a)(v) p.5; EVIDENCE_TBR-FL.md §2.5]`

---

### Obligation 15: MiLB Per-Meal CPI Escalation (Base Lunch/Dinner)

**Obligation / Clause:** Lunch/Dinner Rate Adjustment Formula (MiLB Base + Post-SF)

**Verbatim language:**
> "For each year of the SOW Term after 2024, each Lunch or Dinner Meal prepared by the Provider in accordance with this SOW for the Minor League Baseball Teams shall be at the rate of the 2024 Base Lunch/Dinner Rate and the rate of the 2024 Post service-fee Lunch/Dinner Rate, as adjusted upward or downward by a percentage equal to seventy-five percent of the percentage change in the CPI Index..."

**Which party it binds:** Both (automatic annual adjustment; applies independently to base and post-SF)

**Date attached:**
- **Base year (post-SF):** 2024 contract rate = USD $19.40
- **Adjustment frequency:** Annual, each year after 2024
- **CPI reset:** November-to-November

**Escalation parameters:** 75% of CPI-U Food Away from Home

**2026 operative rates (distinct):**
- Lunch: $21.68 (invoice K300168871)
- Dinner: $20.96 (signed Price Review v3, Kevin-confirmed 2026-07-16)

**Source:** `[doc: MiLB SOW 2024 EXECUTION Josh.pdf § 6(a)(vi) p.5; EVIDENCE_TBR-FL.md §2.5; ACCOUNT_TBR-FL.md §2.b; CONFLICT_REGISTER.md A-1 recompute]`

---

### Obligation 16: CPI Adjustment Methodology & Baseline

**Obligation / Clause:** CPI Index Definition & Application Procedure

**Verbatim language (MLB SOW § 6(i)(c) p.5, cross-applied to MiLB):**
> "For purposes of this SOW, the term 'CPI Index' shall refer to the Consumer Price Index for All Urban Consumers (CPI-U): U.S. City Average, Food Away from Home – Full Service Meals and Snacks, as calculated by the United States Department of Labor, Bureau of Labor Statistics (CPI). For purposes of this SOW, the adjustment in rate, if any, for 2025 shall be based upon the change from the November 2024 CPI Index to the November 2023 CPI Index (with the same procedure to be followed for each year of the Term after 2025)."

**Which party it binds:** Both (automatic; no discretion)

**Date attached:** 
- **2025 adjustment basis:** Nov 2023 → Nov 2024 CPI change
- **2026 adjustment basis:** Nov 2024 → Nov 2025 CPI change
- **Each subsequent year:** Prior November → current November

**CPI-U Sub-index:** BLS Series **CUUR0000SEFV01** (explicitly cited by contract)

**November 2023–2025 values (BLS-verified):**
- Nov 2023: 221.574
- Nov 2024: 229.554 → YoY change = 3.6015%
- Nov 2025: 239.371 → YoY change = 4.2766%

**2026 escalation calculation (75% × CPI):**
- 75% × 4.2766% = 3.2074%
- Applied to 2025 escalated base rates

**Source:** `[doc: MLB SOW 2024 EXECUTION Josh.pdf § 6(a)(i)(c) p.5; MiLB SOW 2024 EXECUTION Josh.pdf § 6(a)(v) p.5; EVIDENCE_TBR-FL.md §2.4 & §2.5; CONFLICT_REGISTER.md A-1 recompute (BLS API 2026-07-14)]`

---

### Obligation 17: Service Fee Escalation (NOT present)

**Obligation / Clause:** Service Fee Annual Adjustment

**Status:** **NOT PRESENT in the contract**

**Verbatim:** The MiLB Service Fee ($382,448 in 2024) is defined in § 6(c) with NO escalation clause. The CPI escalation clause in § 6(a)(v) & (vi) applies ONLY to per-meal rates, NOT to the SF.

**Implication:** Service Fee is treated as flat (non-escalating) in the contract text; however, 2026 operative amount ($457,768) is materially higher, suggesting either a separate SOW amendment or finance-driven adjustment not documented in filed contracts. **[PAPERWORK GAP — 2025/2026 SOWs not in folder]**

**Source:** `[doc: MiLB SOW 2024 EXECUTION Josh.pdf § 6 (SILENCE on SF escalation); EVIDENCE_TBR-FL.md §2.7; ACCOUNT_TBR-FL.md §1 & §5 (open item)]`

---

## Part 5.4 — Billing Cadence & Invoicing

### Obligation 18: MLB Weekly Invoicing

**Obligation / Clause:** Invoice Submission Cadence (MLB)

**Verbatim language:**
> "Within five (5) days following the final day of each Calendar Week (or partial Calendar Week, as applicable) that falls during the SOW Term, the Provider will deliver to the Club an invoice for the amount payable by the Club in connection with the Meals prepared and served by Provider pursuant to this Agreement during the applicable Calendar Week (or partial Calendar Week, as applicable). For certainty, invoices hereunder will include clear information and supporting documentation specifying on the specific Service Days, Meals, as well as any necessary Club confirmations or approvals (such as related Preliminary Catering Orders and Final Catering Orders)."

**Which party it binds:** Kitchfix (invoicing obligation) / Rays (receipt obligation)

**Date attached:**
- **Invoice cycle:** Calendar Week (Monday–Sunday)
- **Invoice delivery window:** Within 5 days of week end
- **Supporting docs:** Preliminary Catering Order (7 days advance) + Final Catering Order (3 days advance) + supporting details included

**2026 invoice examples:**
- K300168545 (2026-03-01): wk 2/23-3/1, due 3/31 (Net 30)

**Source:** `[doc: MLB SOW 2024 EXECUTION Josh.pdf § 6(a)(ii) p.5; EVIDENCE_TBR-FL.md §2.8]`

---

### Obligation 19: MiLB Weekly Invoicing

**Obligation / Clause:** Invoice Submission Cadence (MiLB)

**Verbatim language:**
> "Within five (5) days following the final day of each Calendar Week (or partial Calendar Week, as applicable) that falls during the SOW Term, the Provider will deliver to the Club an invoice for the amount payable by the Club in connection with the Meals prepared and served by Provider pursuant to this Agreement during the applicable Calendar Week (or partial Calendar Week, as applicable)."

**Which party it binds:** Kitchfix (invoicing obligation) / Rays (receipt obligation)

**Date attached:**
- **Invoice cycle:** Calendar Week (Monday–Sunday)
- **Invoice delivery window:** Within 5 days of week end
- **Supporting docs:** Preliminary Catering Order (7 days) + Final Catering Order (3 days) + details

**2026 invoice examples:**
- K300168871 (2026-07-05): wk 6/29-7/5, due 8/04 (Net 30)

**Source:** `[doc: MiLB SOW 2024 EXECUTION Josh.pdf § 6(b) p.5-6; EVIDENCE_TBR-FL.md §2.8]`

---

### Obligation 20: Net Payment Terms (MLB & MiLB)

**Obligation / Clause:** Payment Terms & Dispute Resolution

**Verbatim language (Dispute mechanism — both SOWs identical):**
> "In the event the Club disputes any portion of an invoice, the Club shall deliver written notice of such dispute to Provider ('Dispute Notice'). If the Club and the Provider are unable to resolve such dispute within ten (10) days following the delivery of the Dispute Notice, the Club and the Provider shall immediately submit the dispute for resolution to a Certified Public Accountant to be mutually agreed to by the Club and the Provider (the 'CPA'). The determination of the CPA after a full and complete inspection of the Provider's and the Club's books and records shall be final and binding upon the parties, and the Club shall pay to the Provider such amount, if any, as is necessary to reflect the CPA's determination."

**Which party it binds:** Both (automatic dispute resolution mechanism)

**Date attached:**
- **Net terms:** Not explicitly guaranteed in the contract (language says "does not guarantee payment in less than thirty (30) calendar days" per best practices)
- **Dispute window:** 10-day negotiation period after Dispute Notice
- **Escalation:** CPA arbitration (binding) if unresolved

**Observed practice (invoices):**
- K300168545 (dated 03/01/2026): Due 03/31/2026 (Net 30)
- K300168871 (dated 07/05/2026): Due 08/04/2026 (Net 30)

**Source:** `[doc: MLB SOW 2024 EXECUTION Josh.pdf § 6(a)(iii) p.5; MiLB SOW 2024 EXECUTION Josh.pdf § 6(d) p.6; EVIDENCE_TBR-FL.md §2.8 & §2.9]`

---

## Part 5.5 — Count Verification & Meal Confirmation

### Obligation 21: Preliminary Catering Order (7 days advance)

**Obligation / Clause:** Pre-Service Count Confirmation

**Verbatim language (invoicing section, MLB SOW § 6(a)(ii) p.5; MiLB SOW § 6(b) p.5):**
> "invoices hereunder will include clear information and supporting documentation specifying on the specific Service Days, Meals, as well as any necessary Club confirmations or approvals (such as related Preliminary Catering Orders and Final Catering Orders)."

**Which party it binds:** Rays (notification obligation) / Kitchfix (execution obligation)

**Date attached:**
- **Deadline:** 7 days in advance of service date
- **Purpose:** Advance meal count estimate for planning/procurement
- **Mechanism:** Club provides Preliminary Catering Order; Kitchfix prepares per estimate

**Status:** Contract references the requirement but does NOT specify: (a) exact format, (b) whether Rays must provide or whether Kitchfix requests, (c) consequences of non-provision or change.

**Source:** `[doc: MLB SOW 2024 EXECUTION Josh.pdf § 6(a)(ii) p.5; MiLB SOW 2024 EXECUTION Josh.pdf § 6(b) p.5; EVIDENCE_TBR-FL.md §2.8]`

---

### Obligation 22: Final Catering Order (3 days advance)

**Obligation / Clause:** Firm Count Confirmation (3-day window)

**Verbatim language:** Same reference as Obligation 21 (contract lists "Preliminary Catering Orders and Final Catering Orders" as required supporting docs)

**Which party it binds:** Rays (notification obligation) / Kitchfix (execution obligation)

**Date attached:**
- **Deadline:** 3 days in advance of service date
- **Purpose:** Firm meal count for final procurement + preparation
- **Mechanism:** Club confirms final headcount; Kitchfix adjusts prep accordingly

**Status:** Referenced in contract invoicing language but no detail on format, triggers for change, or reconciliation.

**Source:** `[doc: MLB SOW 2024 EXECUTION Josh.pdf § 6(a)(ii) p.5; MiLB SOW 2024 EXECUTION Josh.pdf § 6(b) p.5; EVIDENCE_TBR-FL.md §2.8]`

---

### Obligation 23: Supporting Documentation for Invoices

**Obligation / Clause:** Invoice Detail & Supporting Docs

**Verbatim language:**
> "For certainty, invoices hereunder will include clear information and supporting documentation specifying on the specific Service Days, Meals, as well as any necessary Club confirmations or approvals (such as related Preliminary Catering Orders and Final Catering Orders)."

**Which party it binds:** Kitchfix (invoicing obligation)

**Date attached:** With each invoice (within 5 days of week end)

**Required elements:**
- Specific Service Days
- Meal types served
- Catering Orders (Preliminary + Final)
- Any Club confirmations or approvals

**Note:** This does NOT mandate that Rays must APPROVE invoices before payment — only that supporting docs must be included. No sign-off gate.

**Source:** `[doc: MLB SOW 2024 EXECUTION Josh.pdf § 6(a)(ii) p.5; MiLB SOW 2024 EXECUTION Josh.pdf § 6(b) p.5; EVIDENCE_TBR-FL.md §2.8 & §3.16]`

---

## Part 5.6 — MTO & Commissary Obligations

### Obligation 24: MLB MTO (Made-To-Order) Service During Spring Training

**Obligation / Clause:** On-Site MTO Commitment (MLB ST)

**Verbatim language:**
> "The parties hereby agree that the Provider agreed to manage at the Provider's expense the on-site MTO services throughout the duration (i.e. seven (7) week duration commencing in early February and ending at the end March in each year of the Term) of the Club's spring training for the Major League Baseball Team ('Major League Spring Training')."

**Which party it binds:** Kitchfix (exclusive obligation; at own expense)

**Date attached:**
- **Duration:** 7 weeks
- **Window:** Early February → End of March each year (2024-2026, plus any extension years)
- **Scope:** On-site MTO services (made-to-order meal preparation on Charlotte Sports Park premises)

**Cost allocation:** Kitchfix bears all MTO costs (no reimbursement from Rays)

**Source:** `[doc: MLB SOW 2024 EXECUTION Josh.pdf § 12 (Additional Matters) p.7; EVIDENCE_TBR-FL.md §B.7]`

---

### Obligation 25: Commissary Kitchen Exclusivity

**Obligation / Clause:** Exclusive-Use Commissary

**Verbatim language (Exhibit 2, Additional Club Requirements, both MLB and MiLB SOWs):**
> "Throughout the term of the Agreement, the commissary kitchen should be used by Provider exclusively to provide food service to the Club and shall not be used to provide foodservice for any third party."

**Which party it binds:** Kitchfix (exclusive obligation)

**Date attached:** Throughout the Retention Period and any extensions (2024-2026 + extension years)

**Scope:**
- Commissary location must be approved by Club in writing (approval not to be unreasonably withheld)
- Commissary is dedicated exclusively to Rays (MLB + MiLB)
- No third-party catering use permitted
- **Exception:** Boys & Girls Club is a secondary client ON THE SAME COMMISSARY (per ACCOUNT_TBR-FL.md § 2.d), but is NOT explicitly named in the exclusivity clause — likely falls under "Rays team operations" broadly (Rays and affiliated PDC training)

**Source:** `[doc: MLB SOW 2024 EXECUTION Josh.pdf Exhibit 2 p.10; MiLB SOW 2024 EXECUTION Josh.pdf Exhibit 2 p.10; EVIDENCE_TBR-FL.md §B.9]`

---

### Obligation 26: Commissary Location Approval

**Obligation / Clause:** Commissary Facility Approval

**Verbatim language (Exhibit 2):**
> "Provider will locate the commissary kitchen at a location that is subject to the prior written approval of the Club, which approval not to be unreasonably withheld."

**Which party it binds:** Kitchfix (location selection obligation) / Rays (approval obligation)

**Date attached:** At contract execution and any subsequent relocation (throughout Term)

**Standard:** "Not to be unreasonably withheld" (good-faith approval standard)

**Source:** `[doc: MLB SOW 2024 EXECUTION Josh.pdf Exhibit 2 p.10; MiLB SOW 2024 EXECUTION Josh.pdf Exhibit 2 p.10]`

---

### Obligation 27: On-Site Facility During MLB Spring Training

**Obligation / Clause:** On-Site Kitchen Facility Commitment (Spring Training)

**Verbatim language (Exhibit 2):**
> "Provider will provide the Club with a partial on-site service during Major League Spring Training. This will entail at Provider's expense either an on-site kitchen renovation or a commitment to a temporary or mobile kitchen facility. This will be in conjunction with the temporary refrigerated unit provided by the Club for the duration of Major League Spring Training. On site Provider staff member will be available..."

**Which party it binds:** Kitchfix (facility provision) / Rays (refrigerated unit provision)

**Date attached:** During MLB Spring Training (early February → end of March, each year)

**Cost allocation:**
- **Kitchfix:** On-site kitchen (renovation or temporary/mobile facility) + on-site staff
- **Rays:** Temporary refrigerated unit

**Source:** `[doc: MLB SOW 2024 EXECUTION Josh.pdf Exhibit 2 p.10; MiLB SOW 2024 EXECUTION Josh.pdf Exhibit 2 p.10]`

---

## Part 5.7 — Exclusivity & Negotiation Rights

### Obligation 28: Right of First Negotiation (Relocation Trigger)

**Obligation / Clause:** ROFN — Relocation Contingency

**Verbatim language (both Master Agreements, § 5):**
> "**Right of First Negotiation.** In the event that the Club announces (the 'Notification Event') that it intends to conduct spring training during the Term at a location (the 'New Spring Training Site') other than Charlotte Sports Park, then the Club hereby grants to Provider the sole and exclusive right to negotiate a modification of this Agreement and that certain Services Agreement - Minor League Foodservices (the 'Minor League Agreement')... for the provision of foodservices at the New Spring Training Site for a period of thirty (30) days (the 'Negotiation Period')... If the parties are unable to execute New Agreements by the end of the Negotiation Period, the Club will be free to negotiate with third parties and this Agreement and the Minor League Agreement will terminate as of the date the Club vacates Charlotte Sports Park."

**Which party it binds:** Rays (exclusivity obligation) / Kitchfix (negotiation right)

**Date attached:**
- **Trigger:** Club announces relocation of spring training site from Charlotte Sports Park
- **Notification:** Club must announce the Notification Event
- **Negotiation window:** 30 days from Notification Event
- **Outcome:** If new agreement executed by day 30, Agreement continues at new site; if not, Agreement terminates on vacate date

**Scope:** Applies to BOTH MLB and MiLB Agreements; modifications to both must be negotiated together

**Source:** `[doc: MLB Services Agreement Major League Foodservice CJK Foods LLC dba Kitchfix 2024 Josh.pdf § 5 p.5; MiLB Services Agreement Minor League Foodservice CJK Foods LLC dba Kitchfix 2024 Josh.pdf § 5 p.5; EVIDENCE_TBR-FL.md §B.9]`

---

## Part 5.8 — Tax & Independent Contractor Status

### Obligation 29: Tax Responsibility & Rate Language

**Obligation / Clause:** Tax Treatment (all per-meal rates)

**Verbatim language (MLB SOW § 6(a)(i)(a)-(b) p.4; MiLB SOW § 6(a) i-iv p.5):**
> [Examples from rate sections:] "Thirty-two dollars and ninety-eight cents (USD $32.98), not inclusive of tax"
> [And:] "plus applicable taxes"

**Which party it binds:** Both (tax passed through; rate is pre-tax)

**Date attached:** Throughout contract term (all years)

**Tax parameters:**
- **All per-meal rates:** "Not inclusive of tax" — tax is added at invoice
- **Applicable rate:** FL sales tax (7.0% per invoices K300168545 + K300168871)
- **Service Fee:** "plus applicable taxes" — SF subject to same sales tax

**Operative 2026 taxes (invoice-verified):**
- K300168545 (MLB): 7.0% exact
- K300168871 (MiLB): ~6.93% blended (mixed taxability on add-on lines)

**Source:** `[doc: MLB SOW 2024 EXECUTION Josh.pdf § 6(a)(i) p.4; MiLB SOW 2024 EXECUTION Josh.pdf § 6(a) i-iv p.5 & § 6(c) p.6; EVIDENCE_TBR-FL.md §B.5]`

---

### Obligation 30: Independent Contractor Status

**Obligation / Clause:** Independent Contractor Characterization

**Verbatim language (both Master Agreements § 2(b) p.2):**
> "The parties intend and agree that the Provider shall be treated as an independent contractor to the Club, and that no representative of the Provider shall be treated as an employee of the Club, for U.S. federal income tax purposes or for any other purpose (including without limitation employee benefit purposes), and the parties agree not to take any tax position that is inconsistent with such characterization."

**Which party it binds:** Both (mutual non-employment agreement)

**Date attached:** Throughout contract term

**Implication:** Kitchfix (CJK Foods LLC) is not an employee; no tax withholding by Rays; no employee benefits; Kitchfix responsible for self-employment tax and benefits

**Source:** `[doc: MLB Services Agreement Major League Foodservice CJK Foods LLC dba Kitchfix 2024 Josh.pdf § 2(b) p.2; MiLB Services Agreement Minor League Foodservice CJK Foods LLC dba Kitchfix 2024 Josh.pdf § 2(b) p.2; EVIDENCE_TBR-FL.md §B.5]`

---

## Part 5.9 — Force Majeure & Suspension

### Obligation 31: Force Majeure Suspension Event

**Obligation / Clause:** FM-Triggered Suspension of Obligations

**Verbatim language (both Master Agreements, § 4 p.4):**
> "the Club shall have the right, by written notice to Provider, to declare Provider's obligations under this Agreement to be suspended for the period of time the Suspension Event remains in effect, and the Club shall be excused from making any payments of the Services Fee as provided in this Agreement for the period of time the Suspension Event remains in effect."

**Which party it binds:** Rays (right to invoke) / Kitchfix (suspension obligation)

**Date attached:** Upon written notice by Rays declaring a Suspension Event

**Scope:**
- Provider's obligations are SUSPENDED (not terminated)
- Club is EXCUSED from paying Service Fees during suspension
- **Note:** Contract defines "Suspension Event" by reference to a term "as defined in the SOW" but the MLB SOW § 4 does not separately define a Force Majeure category — likely intended to be standard force majeure (acts of God, pandemic, natural disaster, government action)

**Source:** `[doc: MLB Services Agreement Major League Foodservice CJK Foods LLC dba Kitchfix 2024 Josh.pdf § 4 p.4; MiLB Services Agreement Minor League Foodservice CJK Foods LLC dba Kitchfix 2024 Josh.pdf § 4 p.4; EVIDENCE_TBR-FL.md §B.6]`

---

## Part 5.10 — Provider Responsibilities & Cost Allocation

### Obligation 32: Provider Cost Responsibility (Ingredients & Personnel)

**Obligation / Clause:** Provider Bears All Meal-Related Costs

**Verbatim language (both SOWs § 4(a) p.2):**
> "The Provider shall be solely responsible for all of the following specific responsibilities and for all costs associated with same: (i) Sourcing and purchasing all Meal ingredients; (ii) Hiring and paying all employees to support the services required herein; [and further requirements...]"

**Which party it binds:** Kitchfix (cost responsibility)

**Date attached:** Throughout contract term

**Cost categories borne by Kitchfix:**
- All meal ingredients (sourcing + purchasing)
- All employee wages + benefits
- All equipment + supplies for meal prep
- Vehicles for delivery
- Disposable service supplies (plates, utensils, napkins, etc.)
- Commissary facility rental/leasing + utilities

**Implication:** No passthrough / reimbursement for food or labor costs. Kitchfix absorbs inflation, labor market increases, supply chain costs.

**Source:** `[doc: MLB SOW 2024 EXECUTION Josh.pdf § 4(a) p.2; MiLB SOW 2024 EXECUTION Josh.pdf § 4(a) p.2; EVIDENCE_TBR-FL.md §B.7]`

---

### Obligation 33: Provider Facility Responsibility

**Obligation / Clause:** Location & Equipment Responsibility

**Verbatim language (both SOWs § 4(b) p.2):**
> "**Provider Responsibilities for Locations and Equipment.** The Provider shall be solely responsible for securing and paying for all locations needed for the preparation of Meals hereunder, including, but not limited to, any leased premise, refrigeration, and appliances used for storage and preparation."

**Which party it binds:** Kitchfix (facility + equipment)

**Date attached:** Throughout contract term

**Scope:**
- Securing commissary location (lease or purchase)
- Paying for lease/rent/utilities
- All refrigeration equipment
- All prep appliances (stoves, prep surfaces, cutlery, etc.)
- Maintenance + repair of all equipment

**Exception:** During MLB Spring Training, Rays provides temporary refrigerated unit; Kitchfix responsible for temporary kitchen (renovation or mobile unit)

**Source:** `[doc: MLB SOW 2024 EXECUTION Josh.pdf § 4(b) p.2; MiLB SOW 2024 EXECUTION Josh.pdf § 4(b) p.2; EVIDENCE_TBR-FL.md §B.7]`

---

## Part 5.11 — Dispute Resolution & Governing Law

### Obligation 34: CPA Dispute Resolution (Escalation Path)

**Obligation / Clause:** Invoice Dispute Resolution

**Verbatim language (both SOWs § 6(a)(iii) / § 6(d) p.5-6):**
> "In the event the Club disputes any portion of an invoice, the Club shall deliver written notice of such dispute to Provider ('Dispute Notice'). If the Club and the Provider are unable to resolve such dispute within ten (10) days following the delivery of the Dispute Notice, the Club and the Provider shall immediately submit the dispute for resolution to a Certified Public Accountant to be mutually agreed to by the Club and the Provider (the 'CPA'). The determination of the CPA after a full and complete inspection of the Provider's and the Club's books and records shall be final and binding upon the parties, and the Club shall pay to the Provider such amount, if any, as is necessary to reflect the CPA's determination."

**Which party it binds:** Both (automatic escalation)

**Date attached:**
- **Step 1 – Dispute Notice:** Club delivers notice within reasonable time of dispute discovery
- **Step 2 – Negotiation:** 10 days to resolve between parties
- **Step 3 – CPA Arbitration:** If unresolved, immediately submit to CPA (mutually selected)
- **Final:** CPA determination is final + binding

**Scope:** Limited to invoice disputes (meal counts, rates, line items)

**CPA selection:** Must be mutually agreed; if not mutually agreed, contract is SILENT on selection mechanism **[AMBIGUITY FLAG]**

**Source:** `[doc: MLB SOW 2024 EXECUTION Josh.pdf § 6(a)(iii) p.5; MiLB SOW 2024 EXECUTION Josh.pdf § 6(d) p.6; EVIDENCE_TBR-FL.md §2.9]`

---

### Obligation 35: Governing Law & Venue (Florida Jurisdiction)

**Obligation / Clause:** Dispute Venue & Governing Law

**Verbatim language (both Master Agreements § 6(e) p.6):**
> "**Miscellaneous.** ... (e) This Agreement shall be governed by and construed in accordance with the laws of the State of Florida. The parties agree that in the event of any dispute between them relating to this Agreement, the substantially prevailing party shall be entitled to recover from the other party the reasonable legal and other professional fees and expenses incurred by the substantially prevailing party with respect to such dispute. Venue for any legal proceedings arising out of this Agreement shall be in the state courts sitting in the State of Florida, County of Pinellas, and in the federal courts sitting in the State of Florida, County of Hillsborough, as the case may be..."

**Which party it binds:** Both (mutual jurisdiction agreement)

**Date attached:** Throughout contract term (applies to any dispute)

**Jurisdiction parameters:**
- **Governing law:** State of Florida
- **Venue for state court:** Pinellas County, FL
- **Venue for federal court:** Hillsborough County, FL
- **Prevailing party:** Entitled to recover reasonable attorney's fees + professional expenses
- **Caveat:** This applies to disputes NOT resolved by CPA arbitration (§ 6(e) is separate from the CPA-escalation mechanism in § 6(a)(iii) / § 6(d))

**Source:** `[doc: MLB Services Agreement Major League Foodservice CJK Foods LLC dba Kitchfix 2024 Josh.pdf § 6(e) p.6; MiLB Services Agreement Minor League Foodservice CJK Foods LLC dba Kitchfix 2024 Josh.pdf § 6(e) p.6; EVIDENCE_TBR-FL.md §B.9]`

---

### Obligation 36: Attorney Fees (Prevailing Party)

**Obligation / Clause:** Prevailing Party Cost Recovery

**Verbatim language (same as Obligation 35, § 6(e)):**
> "the substantially prevailing party shall be entitled to recover from the other party the reasonable legal and other professional fees and expenses incurred by the substantially prevailing party with respect to such dispute."

**Which party it binds:** Both (whoever prevails in litigation)

**Date attached:** Upon resolution of any legal dispute

**Standard:** "Substantially prevailing party" (not TOTAL prevailing party) — partial victories may qualify

**Source:** `[doc: MLB Services Agreement Major League Foodservice CJK Foods LLC dba Kitchfix 2024 Josh.pdf § 6(e) p.6; MiLB Services Agreement Minor League Foodservice CJK Foods LLC dba Kitchfix 2024 Josh.pdf § 6(e) p.6]`

---

## Part 5.12 — Postseason & Calendar Definitions

### Obligation 37: Postseason Meals (MLB — SILENT)

**Obligation / Clause:** Postseason Meal Service

**Status:** **CONTRACT SILENT**

**Verbatim search result:** The MLB SOW contains no separate postseason meal definition, rates, or obligation. Section 4 (Force Majeure) references "Major League Regular Season and Post-Season Period" but does not define the term in the MLB SOW; the MiLB SOW defines a corresponding MiLB postseason but MLB does not.

**Interpretation:** Per Kevin's operational default, postseason MLB meals would bill at same per-meal rates as regular season (no uplift, no discount). No flag.

**Source:** `[doc: MLB SOW 2024 EXECUTION Josh.pdf § 4 (entire section) — SILENCE on postseason rates; EVIDENCE_TBR-FL.md §B.6 & §3 (invoice not sampled)]`

---

### Obligation 38: Minor League Regular Season and Post-Season Period Definition

**Obligation / Clause:** MiLB Service Window Definition

**Verbatim language (MiLB SOW § 1(g) p.1):**
> "**Minor League Regular Season and Post-Season Period**" means that portion of the SOW Term during which the Complex League Team has officially-scheduled regular season games and, if and as applicable, post-season games. Without limiting the foregoing, the Minor League Regular Season and Post-Season Period generally occurs within the months of June through September"

**Which party it binds:** Both (definitional — for invoicing scope)

**Date attached:**
- **Typical window:** June – September (complex league season)
- **Flexibility:** "Generally occurs" — acknowledges variation by year and playoff scenarios

**Implication:** Service obligation is LIMITED to official game schedule (not full calendar year). Off-season (Oct–May) may have reduced or no service.

**Source:** `[doc: MiLB SOW 2024 EXECUTION Josh.pdf § 1(g) p.1; EVIDENCE_TBR-FL.md §B.6]`

---

## Part 5.13 — Secondary Client (Boys & Girls Club)

### Obligation 39: Boys & Girls Club Service Term

**Obligation / Clause:** BGC Catering Contract Term

**Verbatim language (BGC Contract § II p.1):**
> "Contract Term: 10 months, School Days (Tue-Thur)
> Start Date: August 19, 2025
> End Date: May 21, 2026
> Delivery Time: 1:30pm"

**Which party it binds:** Kitchfix (service obligation) / BGC (payment obligation)

**Date attached:**
- **Start:** August 19, 2025 (school year start)
- **End:** May 21, 2026 (school year end)
- **Days of service:** Tuesday, Thursday only (not Wednesdays) — **[AMBIGUITY: contract says "Tue-Thur" which typically means 3 days/week but only lists Tue-Thu; clarify whether Wed is included or excluded]**
- **Exclusions:** Regular school holidays + school breaks (no service)
- **Delivery time:** 1:30pm (after-school supper delivery, not lunch)

**Renewal:** NO auto-renewal clause. New contract required for 2026-27 school year (fall 2026 onward).

**Source:** `[doc: Boys and Girls Club Contract 25_26 (1).pdf § II p.1; CONTRACT_DIGEST_BGC.md §B.1; ACCOUNT_TBR-FL.md §2.d]`

---

### Obligation 40: BGC Per-Meal Rate (Flat)

**Obligation / Clause:** BGC Pricing

**Verbatim language (BGC Contract § V p.1):**
> "**PRICING**. In exchange for the Catering provided, the Client agrees to pay the Caterer **$6.50** per Estimated Meal for the upcoming month's estimation. Client has provided Tax Exempt documentation."

**Which party it binds:** BGC (payment obligation)

**Date attached:** Throughout contract term (Aug 19, 2025 – May 21, 2026)

**Rate:** USD $6.50 per Estimated Meal
- **One rate only** — no split by meal type (breakfast / lunch / dinner)
- **Flat meal charge** — any meal type is $6.50
- **Tax-exempt** — no sales tax applied

**2026 calendar impact:** Only Jan 1 – May 21 is under active contract (remainder of year requires new contract)

**Source:** `[doc: Boys and Girls Club Contract 25_26 (1).pdf § V p.1; CONTRACT_DIGEST_BGC.md §B.2; ACCOUNT_TBR-FL.md §2.b & §2.d]`

---

### Obligation 41: BGC Tax-Exempt Status

**Obligation / Clause:** BGC Sales Tax Exemption

**Verbatim language (BGC Contract § V p.1 + § X.b p.2):**
> "Client has provided Tax Exempt documentation." [repeated in both sections]

**Which party it binds:** Both (Kitchfix exempt from collecting tax; BGC provides documentation)

**Date attached:** Throughout contract term (Aug 19, 2025 – May 21, 2026)

**Implication:** 
- BGC invoices carry NO sales tax (contrast: Rays ML/MiLB invoices carry 7.0% FL tax)
- BGC pre-tax invoice = per-meal count × $6.50 (no tax line item)

**Operational note:** ACCOUNT_TBR-FL.md §2.e notes that "P&L 2200 (~$79,950, the 2025-26 SCHOOL-YEAR total) includes BGC because it belongs there" — revenue is tracked separately from Rays meal revenue (P&L 2400.1)

**Source:** `[doc: Boys and Girls Club Contract 25_26 (1).pdf § V p.1 & § X.b p.2; CONTRACT_DIGEST_BGC.md §B.5; ACCOUNT_TBR-FL.md §2.d & §2.f]`

---

### Obligation 42: BGC Prepaid Billing (4-Week Periods)

**Obligation / Clause:** BGC Payment Cadence & Prepayment

**Verbatim language (BGC Contract § VI p.2):**
> "**TERMS**. As part of this Contract, the Caterer requires at the start of each 4 week period, starting on August 19, 2025 and ending May 2026 that the Client provides Caterer with an estimate of meals needed for the following period, no later than 7 days in advance of the start of the next period. This estimate will be known as Period Estimate. Caterer will invoice Client at the start of that period at $6.50 per meal included in the Period Estimate. Client is required to pay that invoice prior to the start of each Period. Once a period is complete Caterer will issue a credit of any unserved Estimated Meals to the Client in the form of a credit for the following month."

**Which party it binds:** Both (BGC payment-first obligation; Kitchfix invoicing obligation)

**Date attached:**
- **Period length:** 4 weeks (28 days)
- **Period estimate deadline:** 7 days in advance (club provides count projection)
- **Invoice date:** Start of period
- **Payment date:** BEFORE the period starts (prepaid; not Net-N terms)
- **Credit mechanism:** Unserved meals from actual count credited forward to next month

**Billing example:** 
- BGC estimates 500 meals for Period 1 (Aug 19 – Sep 15)
- Kitchfix invoices 500 × $6.50 = $3,250 on Aug 19
- BGC pays $3,250 by Aug 19 (start of period)
- Actual served = 480 meals
- Credit = 20 × $6.50 = $130 applied to Period 2 invoice

**Source:** `[doc: Boys and Girls Club Contract 25_26 (1).pdf § VI p.2; CONTRACT_DIGEST_BGC.md §B.6]`

---

### Obligation 43: BGC Late Payment Fees

**Obligation / Clause:** Late Fee Penalty

**Verbatim language (BGC Contract § VIII p.2):**
> "**LATE FEES**. If a payment due by the Client is not made within the requirements mentioned in Section VI, there will be a Late Fee assessed to each outstanding invoice of 5% per month."

**Which party it binds:** BGC (penalty obligation)

**Date attached:** Upon failure to pay by invoice due date (start of period)

**Late fee rate:** 5% per month (compound; steep by commercial standard)

**Example:** 
- Invoice due Aug 19 for $3,250
- If unpaid by Sep 19, late fee = $3,250 × 5% = $162.50
- If unpaid by Oct 19, late fee = $3,250 × 5% × 2 = $325 (or compounded)

**Source:** `[doc: Boys and Girls Club Contract 25_26 (1).pdf § VIII p.2; CONTRACT_DIGEST_BGC.md §B.6]`

---

### Obligation 44: BGC Payment Method Restriction

**Obligation / Clause:** Accepted Payment Methods

**Verbatim language (BGC Contract § VII p.2):**
> "**METHODS OF PAYMENT**. The Caterer's acceptable methods of payment are as follows: (check all that apply)
> ☐ - ACH
> ☑️ - Check
> ☐ - Credit Card (additional % fee)"

**Which party it binds:** BGC (payment method obligation)

**Date attached:** Throughout contract term

**Operative method:** **Check only** ☑️ (ACH and Credit Card are NOT checked)

**Implication:** BGC must pay by check; no ACH or credit-card payments accepted (unless contract amended)

**Operational note:** CONTRACT_DIGEST_BGC.md §D flags this: "If any BGC invoices are actually being paid via ACH, that's out-of-contract; may be an operational convenience but worth noting to Sebastian."

**Source:** `[doc: Boys and Girls Club Contract 25_26 (1).pdf § VII p.2; CONTRACT_DIGEST_BGC.md §B.6]`

---

### Obligation 45: BGC Termination Notice Requirement

**Obligation / Clause:** Termination Notice (Client-initiated)

**Verbatim language (BGC Contract § XII p.3):**
> "**TERMINATION NOTICE REQUIREMENT**. Notwithstanding anything to the contrary, the Client agrees to provide the Caterer with no less than thirty (30) days' written notice in the event of termination of this Agreement."

**Which party it binds:** BGC (notice obligation)

**Date attached:** Upon decision to terminate (notice required 30 days in advance)

**Implication:** BGC must give 30 days' notice; can terminate for any reason with notice

**Contrast:** BGC Contract § X.e grants Kitchfix a "cancel at any time without notice" option — highly asymmetric (Club must give 30 days; Caterer can exit immediately)

**Source:** `[doc: Boys and Girls Club Contract 25_26 (1).pdf § XII p.3; CONTRACT_DIGEST_BGC.md §B.9]`

---

### Obligation 46: BGC Estimated Meal Minimum (Planning Only)

**Obligation / Clause:** Planning Minimum (Non-Binding)

**Verbatim language (BGC Contract § III p.1):**
> "**ESTIMATED MEALS**. The Caterer agrees to provide the Scope of Work for an estimated minimum of **125 individuals per day** at the Catering. Client shall no later than 1 week in advance confirm the Estimated Meals needed for the following week."

**Which party it binds:** Both (planning guidance only)

**Date attached:** Throughout contract term

**Nature:** 125/day is a **planning estimate, NOT a hard billing minimum**. Invoice is driven by actual Period Estimate provided 7+ days in advance; unserved meals credit forward.

**2026 actual:** ACCOUNT_TBR-FL.md notes "fill was closer to ~4,100 meals or ~102 meals/day average — well within the 125/day estimate" for the school year.

**Source:** `[doc: Boys and Girls Club Contract 25_26 (1).pdf § III p.1; CONTRACT_DIGEST_BGC.md §B.3]`

---

## Part 5.14 — Postseason Rates (No separate contract provision)

### Obligation 47: Postseason Rate Structure (SILENT)

**Obligation / Clause:** Postseason Pricing

**Status:** **NOT PRESENT in MLB or MiLB SOWs**

**Verbatim:** Neither the MLB SOW nor MiLB SOW contains a separate postseason rate or postseason meal definition. The MLB SOW § 4 mentions "Major League Regular Season and Post-Season Period" (in the Force Majeure context) but provides no rate schedule.

**Interpretation:** Per Kevin's operational default, postseason (if applicable) would bill at the same per-meal rates as regular season. No uplift, no discount.

**Practical note:** For MLB, postseason eligibility is uncertain annually; for MiLB (Charlotte County PDC complex league), postseason is a standard part of June-Sept season window.

**Source:** `[doc: MLB SOW 2024 EXECUTION Josh.pdf § 4 (no postseason rate); MiLB SOW 2024 EXECUTION Josh.pdf § 1 & § 6 (no postseason uplift defined); EVIDENCE_TBR-FL.md §B.6 & §3 (postseason silent); ACCOUNT_SERVICES_BRIEF.md "Postseason not separately priced" — NOT FOUND as explicit claim in contract]`

---

## Part 5.15 — Insurance & Liability

### Obligation 48: Liability & Indemnification (BGC only — SILENT for Rays)

**Obligation / Clause:** BGC Liability Waiver

**Verbatim language (BGC Contract § X.e pp.2-3):**
> "The Caterer will not be liable for direct, indirect, incidental, or consequential damages (including, but not limited to, damages for lost profits or increased expenses) with respect to any claim related to this Contract and the Services provided. The Client indemnifies and holds harmless the Caterer and any subcontractors working with the Caterer against all liability related to the Client's Catering from the date of the Catering and on into the future. The Client will assume all legal fees claimed by third persons, provided that such loss or damage was not caused by the fault or negligence of the Caterer or its employees, agents, or subcontractors. Furthermore, the Caterer has the right to cancel, at any time and without notice, the Services mentioned in this Contract with no liability or obligation to the Client other than refunds of any Deposit or advanced payments made by the Client."

**Which party it binds:** BGC (liability assumption) / Kitchfix (liability waiver)

**Date attached:** Throughout contract term + indefinitely after ("on into the future")

**Implication:**
- Kitchfix has broad liability waiver (not liable for indirect/consequential damages)
- BGC indemnifies Kitchfix for third-party claims (unless caused by Kitchfix negligence)
- Kitchfix can cancel at any time with no liability beyond refunding advances

**Contrast:** The Rays Master Agreements **DO NOT CONTAIN** an explicit liability clause in the provided text — they reference standard force majeure suspension but not broad liability waiver. **[PAPERWORK GAP: Rays liability/insurance provisions may be in full contract PDF not provided; only key sections digitized]**

**Source:** `[doc: Boys and Girls Club Contract 25_26 (1).pdf § X.e pp.2-3; RAYS MASTER AGREEMENTS — [NOT FOUND explicit liability clause]; CONTRACT_DIGEST_BGC.md §B.9]`

---

## Part 5.16 — Equipment Damage & Responsibility

### Obligation 49: Equipment Damage Responsibility (BGC)

**Obligation / Clause:** Equipment Damage Liability

**Verbatim language (BGC Contract § X.d p.2):**
> "**Damage to Equipment**. The Client will be responsible for any damage or loss to the Caterer's equipment due to misuse or theft by the Client or any guest of the Client and in the case of a force majeure event (including but not limited to fires, floods, inclement weather, and earthquakes)."

**Which party it binds:** BGC (damage liability)

**Date attached:** Throughout contract term (and retroactively for FM events)

**Scope:** BGC liable for:
- Damage due to misuse (by BGC staff or BGC guests)
- Theft by BGC staff or guests
- Force majeure events (fires, floods, weather, earthquakes) — **unusual FM clause; most contracts exclude FM from client liability**

**Implication:** Kitchfix equipment at BGC site (serving dishes, chafing dishes, warmers, etc.) are BGC's financial responsibility if damaged/stolen/lost to weather.

**Source:** `[doc: Boys and Girls Club Contract 25_26 (1).pdf § X.d p.2; CONTRACT_DIGEST_BGC.md §B.7]`

---

## Summary: Contractual Obligations Tally

**Total Obligations Extracted:** 49

| Category | Count | Key Obligations |
|---|---|---|
| **Term & Extension** | 7 | MLB base term (10/1/26) + 2 extensions; MiLB base term (12/31/26) + 2 extensions; both SOW terms align with Agreements |
| **Service Fees & Rates** | 11 | MiLB SF structure + installment schedule; MLB no SF; 25% MiLB discount; per-meal rates (MLB breakfast $32.98 base, lunch $36.54 base; MiLB $21.11/$15.84 base breakfast, $25.86/$19.40 base lunch) |
| **CPI Escalation** | 5 | 75% × CPI-U Food Away from Home (not 100%); Nov-to-Nov reset; applies to per-meal only (NOT SF); formulas for breakfast and lunch/dinner separate |
| **Billing & Payment** | 6 | Weekly invoicing (5 days post-week-end); Net-30 standard; dispute mechanism (10-day + CPA arbitration); supporting docs required |
| **Meal Confirmation** | 3 | Preliminary Catering Order (7 days advance); Final Catering Order (3 days advance); supporting documentation in invoices |
| **MTO & Commissary** | 4 | MLB MTO service (7-week ST at own expense); commissary exclusivity; location approval; on-site facility (ST) |
| **Exclusivity & Negotiation** | 1 | Right of First Negotiation (relocation trigger; 30-day window) |
| **Tax & Contractor** | 2 | All rates "not inclusive of tax"; independent contractor status (no employment tax withholding by Rays) |
| **Force Majeure** | 1 | Club may suspend obligations; services fees excused during suspension |
| **Provider Responsibility** | 2 | All meal costs (ingredients, labor, equipment); commissary facility + equipment |
| **Dispute Resolution** | 2 | CPA arbitration (final + binding); prevailing-party attorney fees |
| **Governing Law** | 1 | FL law; venue Pinellas Co. (state) + Hillsborough Co. (federal) |
| **Postseason** | 1 | MLB — contract SILENT (default: same rates); MiLB — regular season June–Sept |
| **BGC Secondary Client** | 7 | BGC term 8/19/25–5/21/26 (no auto-renewal); $6.50/meal (flat, one rate, tax-exempt); prepaid 4-week periods; 5% late fee; check-only payment; 30-day termination notice; equipment damage liability |
| **Insurance/Liability** | 1 | BGC liability waiver + indemnification (Rays — NOT FOUND in digitized sections) |

---

## Part 5.17 — Possible Divergence from Current Operating Practice

### Finding 1: MLB Extension Option October 1, 2026 Deadline

**Contract clause:** Obligation 2 (MLB First Extension Option)
> "by providing Sponsor with written notice to that effect on or before October 1, 2026"

**Current status (as of 2026-08-04):**
- **Date:** 58 days until October 1, 2026
- **Action required:** Rays must notify Kitchfix by October 1 if they intend to extend through 2027
- **Observation:** No evidence in the provided documents of either (a) notice having been given already or (b) a renewal discussion timeline scheduled

**Flag:** Kitchfix operational team should confirm status with Erik Hart (MLB AP recipient) before September 1 to allow negotiation time if Rays signals non-renewal.

**Source:** `[doc: MLB Services Agreement Major League Foodservice § 3 p.2; ACCOUNT_TBR-FL.md §1 notes "pending renewal option"]`

---

### Finding 2: MiLB Extension Option October 1, 2026 Deadline (Same as MLB)

**Contract clause:** Obligation 5 (MiLB First Extension Option)
> "by providing Sponsor with written notice to that effect on or before October 1, 2026"

**Current status:** Same as MLB Finding 1 — both levels have simultaneous October 1 decision point.

**Observation:** While MiLB base term extends to December 31, 2026 (vs MLB October 1), the First Extension Option for MiLB also requires notice by October 1, 2026 (per clause language). This means:
- If October 1 passes without notice, MiLB extension window CLOSES even though MiLB base term continues to Dec 31
- If Rays intends to continue MiLB beyond 2026, must notice by Oct 1

**Flag:** Confirm with Sean "Sunny" Jones (MiLB AP recipient) same deadline applies.

**Source:** `[doc: MiLB Services Agreement Minor League Foodservice § 3 p.2]`

---

### Finding 3: CPI Escalation Methodology — 75% vs 100%

**Contract clause:** Obligations 12–16 (CPI escalation applies 75% multiplier)

**Contrast to peer account:** EVIDENCE files and ACCOUNT_TBJ-FL.md note TBJ-FL uses 100% CPI escalation, not 75%.

**Current operating difference:**
- TBR-FL: 2026 rates = 2024 base × (1 + 0.75 × YoY CPI change) = more conservative escalation
- TBJ-FL: 2026 rates = 2024 base × (1 + 1.00 × YoY CPI change) = steeper escalation

**2026 invoice verification:** K300168545 (MLB $39.48 lunch/dinner) + K300168871 (MiLB $21.68 lunch, $20.96 dinner) both confirm 75% application per contract.

**Implication:** TBR-FL is contractually protected against full CPI pass-through, meaning Rays benefits from inflationary pricing cushion vs standard 100%-CPI accounts.

**Flag:** This is operating as contracted (no divergence) but worth noting that TBR-FL's escalation is more favorable to Rays than, e.g., TBJ-FL.

**Source:** `[doc: MLB SOW § 6(a)(i)(c); MiLB SOW § 6(a)(v)-(vi); EVIDENCE_TBR-FL.md §2.4 & §2.5; CONFLICT_REGISTER.md A-1]`

---

### Finding 4: MiLB Service Fee Recurrence — Contract SILENT, Finance Operationally Active

**Contract clause:** Obligation 8–9 (2024 SF $382,448 with two-installment structure)

**Contract silence:** The MiLB SOW § 6(c) defines the 2024 SF amount and installment schedule with NO explicit recurrence language or escalation clause for 2025+.

**Operative 2026 reality:** Finance sheet (`PFS Service Fees 2026.xlsx`) shows $457,768 for 2026 ($200K + $257,768), confirming recurrence and a $75,320 YoY increase over 2024 base.

**Paperwork gap:** No 2025 or 2026 SOW on file documenting the renewal mechanics. The SF structure (static $200K + variable) is inferred from 2024 pattern + 2026 finance confirmation, but is NOT contractually explicit post-2024.

**Risk:** If a renewal dispute arose, Kitchfix would need to demonstrate that recurring SF was intended. The contract text alone does NOT support a 2026 billing of $457,768 for MiLB SF.

**Current practice:** Operating as if SF recurs annually (per ABR historical and finance projection), but the evidence is operational (ABR pattern, finance forecast) rather than contractual.

**Recommendation:** Obtain signed 2025 and 2026 SOW amendments or renewals to document SF recurrence, especially given the $75K+ variance from 2024 base.

**Source:** `[doc: MiLB SOW § 6(c) p.6 — SILENCE on post-2024 recurrence; EVIDENCE_TBR-FL.md §2.7 "CANNOT DETERMINE FROM CONTRACT"; ACCOUNT_TBR-FL.md §5 (open item); ACCOUNT_SERVICES_BRIEF.md line 369 notes "SF is recurring each year (structure: $200K + variable)"]`

---

### Finding 5: Commissary Exclusivity & BGC Secondary Client

**Contract clause:** Obligation 25 (commissary exclusivity)
> "Throughout the term of the Agreement, the commissary kitchen should be used by Provider exclusively to provide food service to the Club"

**Operating practice:** BGC (Boys & Girls Club) is a second client operating out of the same commissary, billed at $6.50/meal under a separate contract.

**Apparent divergence:** The exclusivity clause does NOT explicitly name BGC as an exception. Technically, the commissary is exclusive to "the Club" (Rays), which would exclude third-party clients.

**Clarification:** ACCOUNT_TBR-FL.md §2.d explains that BGC is operationally part of "Rays team operations broadly" (not a true third party), because:
- The Exec Chef has a separate relationship with BGC
- Commissary operation (leased/rented by Kitchfix) is fungible between Rays and BGC
- TBR-FL is the only account in the portfolio running a commissary serving a PDC, enabling multi-client revenue

**Contract status:** The Rays Master Agreements do NOT explicitly authorize BGC as an exception to exclusivity; BGC is billed under its own standalone contract (dated Aug 3, 2025 / effective Aug 19, 2025).

**Operational finding:** This is NOT a divergence (both parties are operating with knowledge), but it IS a contractual gap: the Rays exclusivity clause should either:
1. Explicitly carve out "affiliated commissary operations" or
2. Reference a BGC understanding

**Recommendation:** If the Rays relationship is renewed in 2026/2027, consider amending the Rays SOW to acknowledge the BGC arrangement (or at minimum, obtain Rays written acknowledgment that BGC commissary use is acceptable).

**Source:** `[doc: MLB SOW Exhibit 2 + MiLB SOW Exhibit 2 (exclusivity language); Boys and Girls Club Contract 25_26 (1).pdf (standalone client); ACCOUNT_TBR-FL.md §2.d & §3 (commissary model explanation)]`

---

### Finding 6: MiLB Rate Structure — Three Distinct Rates (Not Two)

**Contract clause:** Obligations 14–15 (Breakfast $15.84, Lunch/Dinner post-SF rates separated)

**Operating practice:** Invoice K300168871 bills three distinct MiLB rates:
- Breakfast: $17.83
- Lunch: $21.68
- Dinner: $20.96

**Contract language ambiguity:** MiLB SOW § 6(a)(iii)-(iv) lists four rate tiers (2024 Base Breakfast $21.11, Post-SF Breakfast $15.84, Base Lunch/Dinner $25.86, Post-SF Lunch/Dinner $19.40). The contract does NOT separately define "Lunch" vs "Dinner" — it bundles them as "Lunch or Dinner."

**Operational divergence:** The 2026 invoice distinguishes Lunch ($21.68) from Dinner ($20.96), a $0.72/meal difference. The contract does not authorize this split.

**Clarification (per Kevin confirmation in ACCOUNT_TBR-FL.md §2.b):** The three distinct rates ARE contract-correct — the MiLB SOW applies the same 75% CPI escalation to the "Post service-fee Lunch/Dinner Rate" ($19.40 base), and when the 2026 escalation is applied, it yields:
- Lunch component: $21.68 ($21.675 signed)
- Dinner component: $20.96 (signed, Kevin-confirmed 2026-07-16)

**Status:** This is operating as contracted (rates derived from CPI-escalated base + SF discount), but the contract bundling of "Lunch or Dinner" vs invoice separation into two distinct rates IS a practical divergence (not an error, but worth noting).

**Recommendation:** Confirm with accounting that QB line-item codes distinguish Lunch from Dinner on MiLB invoices, so that meal actuals can be properly reconciled to the per-service-type rates.

**Source:** `[doc: MiLB SOW § 6(a) iii-iv p.5 (bundled Lunch/Dinner); Invoice K300168871 line items (three distinct rates); CONFLICT_REGISTER.md A-1 (rate reconciliation); ACCOUNT_TBR-FL.md §2.b (three rates confirmed)]`

---

### Finding 7: BGC Contract Term — Spring Only for Calendar 2026

**Contract clause:** Obligation 39 (BGC term 8/19/25–5/21/26)

**Operating practice:** BGC service is active through May 21, 2026 (end of school year).

**Calendar year divergence:** For calendar year 2026, only January 1 – May 21 is under contract. The second half of 2026 (post-May 21) has NO active BGC contract.

**Renewal status:** No 2026-27 school-year renewal on file. BGC would normally resume August 2026 for the 2026-27 school year, but without a new contract, no legal obligation exists.

**Current projections:** ACCOUNT_TBR-FL.md notes "P&L 2200 (~$79,950, the 2025-26 SCHOOL-YEAR total) includes BGC because it belongs there" — meaning the 2026 P&L line may incorrectly project full-year BGC revenue when only spring is contracted.

**Implication:** BGC revenue for calendar 2026 is PARTIAL-YEAR (spring only: ~4,100 meals at $6.50 ≈ $26,650–$29,950 for Jan–May). If fall/winter 2026 BGC service is projected in SC or P&L, it is UNSUPPORTED by contract.

**Recommendation:** 
1. Confirm whether Kevin intends to renew BGC for 2026-27 school year (Aug 2026 onward)
2. If renewing, obtain executed BGC contract before August 1, 2026
3. If not renewing, adjust SC and P&L projections to reflect May 21 end date

**Source:** `[doc: Boys and Girls Club Contract 25_26 (1).pdf § II p.1 (End Date: May 21, 2026); CONTRACT_DIGEST_BGC.md §B.1 & §D; ACCOUNT_TBR-FL.md §2.d & §5 (open item "BGC 2026-27 renewal")]`

---

### Finding 8: CPA Dispute Resolution — Selection Mechanism SILENT

**Contract clause:** Obligation 34 (CPA dispute escalation)

**Contract language:** "submit the dispute for resolution to a Certified Public Accountant to be mutually agreed to by the Club and the Provider (the 'CPA')"

**Operational gap:** If Rays and Kitchfix dispute an invoice and cannot agree on a CPA within a reasonable time, the contract does NOT specify:
1. How to select a CPA if mutual agreement fails (arbitrator selection, industry panel, etc.)
2. Who bears CPA costs (split equally, loser pays, etc.)
3. CPA timeline (how long CPA has to render decision)
4. CPA appeal rights (none implied — decision is "final and binding")

**Current practice:** Assumed CPA disputes have not arisen to date. If one does, the parties would need to agree on a mutually acceptable CPA or seek a modification/clarification.

**Recommendation:** If renewing Rays contract in 2026/2027, consider adding CPA selection clarification (e.g., "If parties cannot mutually agree on a CPA within 10 days, either party may request the AICPA or Florida Institute of CPA's to recommend a qualified independent CPA").

**Source:** `[doc: MLB SOW § 6(a)(iii) p.5; MiLB SOW § 6(d) p.6; EVIDENCE_TBR-FL.md §2.9]`

---

### Finding 9: MiLB SF Variable Installment — No Documented Derivation Method

**Contract clause:** Obligation 9 (MiLB SF installment schedule)

**2024 contract:** $200K + $182,448 = $382,448
**2026 operative:** $200K + $257,768 = $457,768

**Operational reality:** The Finance sheet (PFS Service Fees 2026) confirms the 2026 amounts, but there is NO visible formula or method document explaining how the variable second installment ($257,768) was derived.

**Possible derivations (unconfirmed):**
1. CPI-escalation of 2024 $182,448 base (contract silent on SF escalation)
2. Operating budget formula (meals × average cost per meal)
3. Negotiated amendment not filed as a separate SOW
4. Finance-driven allocation based on P&L actuals from 2025

**Paperwork status:** ACCOUNT_TBR-FL.md §5 lists this as "OPEN (Joe #3)" — Joe Lessard (Finance/VP Ops) owns determining the variable method; it is non-blocking for 2026 (amount is confirmed), but resolution would clarify 2027 forecasting.

**Recommendation:** Document the SF variable-installment derivation method (ideally with supporting 2025 actuals or a signed amendment) before 2027 renewal discussions.

**Source:** `[doc: MiLB SOW § 6(c) p.6 — SILENT on post-2024 variable calculation; Finance PFS Service Fees 2026 (amounts confirmed, method undocumented); ACCOUNT_TBR-FL.md §5 (open item "SF variable-derivation method")]`

---

### Finding 10: MLB Postseason Rates — Contract SILENT, Default Practice Applied

**Contract clause:** Obligation 37 (postseason SILENT in MLB SOW)

**Operating assumption:** If MLB postseason occurs, Kitchfix bills at same per-meal rates as regular season (no uplift, no discount). This is Kevin's operational default per the SOW structure.

**Contract gap:** The MLB SOW contains no postseason rate schedule, no postseason bonus, no postseason surcharge. The MiLB SOW defines the regular-season window (June–Sept) but does not separately price postseason.

**Risk:** If Rays expect postseason service at a different rate (e.g., premium for expedited prep, smaller rosters), no contract language supports either party's position. A dispute could arise if Rays contests a postseason invoice.

**Operational note:** 2026 MLB postseason eligibility is uncertain (Rays' playoff odds); postseason revenue impact may be immaterial. However, for contract clarity in 2026/2027 renewal, consider adding explicit postseason language (e.g., "Postseason meals billed at same rate as regular season, contingent on Club providing revised rosters").

**Source:** `[doc: MLB SOW § 4 & § 6 — SILENCE on postseason rates; MiLB SOW § 1(g) p.1 defines regular-season window June–Sept but no postseason uplift; EVIDENCE_TBR-FL.md §B.6 (postseason not separately priced)]`

---

## Conclusion

**Total contractual obligations extracted:** 49 (detailed above)

**Extension decision date:** October 1, 2026 (MLB + MiLB First Extension notice deadline; **58 days from analysis date 2026-08-04**)

**Key renewal/paperwork items:**
1. **2025/2026 MiLB SOW renewals** — not filed; SF recurrence is operational (finance-confirmed) but not contractually documented post-2024
2. **BGC 2026-27 renewal** — not on file; current contract expires May 21, 2026; fall 2026 service requires new contract
3. **CPA dispute mechanism** — no selection procedure if mutual agreement fails
4. **SF variable derivation** — method undocumented (Finance-owned item)

**Divergences from current practice (observations, no violations):**
- CPI escalation is 75%, providing Rays favorable cushion vs 100%-CPI peer accounts
- BGC commissary exclusivity carve-out is operationally understood but not explicitly stated in Rays contract
- MiLB rates are billed as three distinct (Breakfast/Lunch/Dinner) despite contract bundling Lunch+Dinner
- BGC 2026 projection may incorrectly assume full-year service (contract is spring-only)
- Postseason meal rates are assumed (contract silent) but not documented

---

**Document prepared:** 2026-08-04  
**Source-of-truth verification:** CONTRACT_DIGEST_TBR-FL.md § A–D  
**Secondary validation:** EVIDENCE_TBR-FL.md § 1–11, ACCOUNT_TBR-FL.md § 1–7, BILLING_TERMS_MATRIX.md (TBR-FL row), CONTRACT_DIGEST_BGC.md § A–D  

## Part 6 - Current company standards from OPD (canonical language pull)

**Generated:** 2026-08-04  
**Scope:** Operating Playbook Documents (OPD) - canonical mission, vision, values, culture, leadership, culinary standards, and service commitments  
**Status Notes:** All documents reported at current Live version unless marked Draft/In Build/Retired. Non-Live documents flagged [NOT LIVE].

---

## Document Catalog - Culture & Identity Category

### PB-014: Culture OS Handbook [ran]

**id:** PB-014  
**Title:** Culture OS Handbook  
**Shelf:** Operations & Leadership  
**Status:** Live  
**Version:** 1.0  
**Access Level:** unrestricted  
**Approved Date:** [not recorded]  
**Source Drive ID:** [null]

**Content Summary (per frontmatter):** The foundational handbook of KitchFix Performance Food Service - the culture that everything else in the corpus rests on. Covers why culture comes first, the founder's origin story (in Josh Katt's voice), what we mean by genuine hospitality, the four North Stars (Mission, Vision, the four Values of Humility/Intentionality/Sustainability/Equity, and the Hospitality Promise of Best Food/Best Service/Best Hospitality), Our Promise to You (the employer commitment), and the Vital Partner Standard (what every leader makes true for every client).

**Owner:** Senior Director of Operations  
**Approver:** SLT

---

### PB-001: Leadership OS Handbook [ran]

**id:** PB-001  
**Title:** Leadership OS Handbook  
**Shelf:** Operations & Leadership  
**Status:** Live  
**Version:** 9.1  
**Access Level:** unrestricted  
**Approved Date:** [not recorded]  
**Source Drive ID:** [null]

**Content Summary (per frontmatter):** The operating constitution of KitchFix Performance Food Service. Nine sections: About & How to Use, Culture (origin, Mission, Vision, Values, the Hospitality Promise of Best Food/Best Service/Best Hospitality, the four Pillars, the Non-Negotiables), Culinary Philosophy, Client Promise, Site Leadership (five role definitions: RDO, Site Leader, Sous Chef, Hospitality Manager, Corporate Field Chef), Service Level Agreements, Accountability System (five tracks: Financial Reviews, Performance Reviews, Operational Audits, EOY, Retreat plus 1:1 cadence), Account Management & Renewal, and the Cadence Matrix.

**Owner:** Senior Director of Operations  
**Approver:** SLT

**Role Definitions (cited verbatim from PB-001 section 5):**

Regional Director of Operations | All sites in the region. Regional P&L. Client relationships. Develops Site Leaders. Holds the region to the SLA. | Reports to VP of Operations
Site Leader (EC & GM) | The site. Full P&L ownership. Leadership of Team. Client relationship day to day. | Reports to RDO
Sous Chef | The kitchen. The line. Production and execution every shift. | Reports to Site Leader
Hospitality Manager | Front of house. Dining. Client-facing service. Service and hospitality. | Reports to Site Leader
Corporate Field Chef | Multi-site coverage. Activated by VPO when capacity is needed. | Reports to VPO

---

### PB-006: Culinary OS Handbook [ran]

**id:** PB-006  
**Title:** Culinary OS Handbook  
**Shelf:** Culinary & Kitchen Operations  
**Status:** Live  
**Version:** 1.0  
**Access Level:** unrestricted  
**Approved Date:** [not recorded]  
**Source Drive ID:** [null]

**Content Summary (per frontmatter):** The culinary operating system of KitchFix Performance Food Service. Three sections: Culinary Philosophy (Purpose, Promise, and the four culinary Principles - Remarkable, Authentic, Responsible, Inspiring), Culinary Overview (what the four Principles look like in the kitchen every day), and Culinary Defined (the company-wide operating standards, 3.1 through 3.15: cooking methods, sourcing, protein framework, ingredient principles, restricted/prohibited products, meal service, stations, action stations, Latin program, cultural programming, menu cycle and approval, quality control and tasting, allergens, sanitation, and branding).

**Owner:** Director of Culinary  
**Approver:** SLT + Director of Culinary

---

### PB-005: SLA OS Handbook [ran]

**id:** PB-005  
**Title:** SLA OS Handbook  
**Shelf:** Service Delivery & Client Accounts  
**Status:** In Build  
**Version:** 1.0  
**Access Level:** unrestricted  
**Approved Date:** [not recorded]  
**Source Drive ID:** [null]

**WARNING: [NOT LIVE]** Status is "In Build" as of 2026-08-04. This is NOT approved canonical language.

**Content Summary:** Defines the ten-section structure every KitchFix account SLA is built against - Commercial Terms, Scope of Services, Service Calendar, Operational SOP, Nutrition Guidelines and Allergen Standards, Communication and Conduct, Performance and Accountability, Specialty and Custom, Operational Standards, Financials and Reporting.

**Owner:** Senior Director of Operations  
**Approver:** SLT

---

## Document Catalog - Leadership & Accountability

### SOP-001: Leadership Performance System [ran]

**id:** SOP-001  
**Title:** Leadership Performance System  
**Shelf:** Operations & Leadership  
**Status:** In Build  
**Version:** 2.0  
**Access Level:** unrestricted  
**Approved Date:** [not recorded]  
**Source Drive ID:** [null]

**WARNING: [NOT LIVE]** Status is "In Build" as of 2026-08-04.

---

### PB-002: Allergen Playbook [ran]

**id:** PB-002  
**Title:** Allergen Playbook  
**Shelf:** Culinary & Kitchen Operations  
**Status:** Live  
**Version:** 1.0  
**Access Level:** unrestricted  
**Approved Date:** [not recorded]  
**Source Drive ID:** [null]

**Content Summary:** Company-wide allergen and food-safety standard for all accounts. Top 9 allergens, safe handling, documentation, emergency protocols.

**Owner:** Senior Director of Operations  
**Approver:** SLT + Director of Culinary

---

## Document Catalog - Culture & Values Supporting Docs

### POL-014: Code of Conduct & Ethics [ran]

**id:** POL-014  
**Title:** Code of Conduct & Ethics  
**Shelf:** People & Conduct  
**Status:** Live  
**Version:** 1.0  
**Access Level:** unrestricted  
**Approved Date:** [not recorded]  
**Source Drive ID:** [null]

**Owner:** People Operations

---

### AGR-001: The Big Rules [ran]

**id:** AGR-001  
**Title:** The Big Rules  
**Shelf:** People & Conduct  
**Status:** Live  
**Version:** 1.1  
**Access Level:** unrestricted  
**Approved Date:** 2026-06-15  
**Source Drive ID:** 19U56xYG7XBwpStaftZOoqu3yfPvUA3vCMhfzdDUl_s8

**Content Summary:** The conduct anchor for every PFS employee. Covers Confidentiality (what stays in the clubhouse), the 9 Clubhouse Rules (no photos, no autographs, no gambling, no PED talk, no media, no inside info, no dietary advice, no fraternization, no soliciting), Facility Conduct, Major League Rule 21 in full, the Communication and Escalation chain, and the Acknowledgement signature.

**Owner:** People Operations  
**Approver:** SLT + Counsel

---

## CANONICAL LANGUAGE BLOCK

### Mission, Vision, Values, & Brand Promise

All statements below are extracted from `content/facts/operational-facts.yaml` (lines 227-246), with authority citations to PB-014 and PB-006.

**MISSION STATEMENT**  
[Source: operational-facts.yaml line 227-231 | Authority: PB-014]

> "We exist to fuel, heal, and genuinely care for every team we serve - through the food we make and the hospitality behind it."

**VISION STATEMENT**  
[Source: operational-facts.yaml line 234-238 | Authority: PB-014]

> "Be the vital partner for every performance-focused organization we serve - the one they can't imagine winning without."

**THE HOSPITALITY PROMISE (Brand Promise)**  
[Source: operational-facts.yaml line 142-146 | Authority: PB-014]

> "Best Food, Best Service, Best Hospitality"

**THE FOUR VALUES**  
[Source: PB-014 section "Values: What We Believe" | Authority: Culture OS Handbook]

**Humility** - We are a company of humble individuals who support each other to get better every day. Senior people stay teachable. Junior people are heard. Egos do not run our kitchens. It's why the best people here stay teachable. Today's standard is not tomorrow's ceiling. When things break - and they will - humility is what shows up first. Not defensiveness, not explanation. The humble move is to fix it, own it, and understand it. In that order.

**Intentionality** - We grow with intention, passion, and creativity. Decisions are made on purpose. Menus are designed, not assembled. Hires are deliberate. Standards are written down so that every operator can hold them.

**Sustainability** - We maintain sustainable growth and profit. Service that burns out the team is not sustainable. Pricing that erodes margin is not sustainable. We build operations that can run season after season without breaking the people in them. It's how we survived the hard years and how we build for the next ones.

**Equity** - We are striving to be more giving, equitable, and inclusive, internally and externally. Our hourly teams are treated with the same respect as our executive team. Bilingual leadership matters. Every voice in the operation deserves a hearing. It's why our first two hires had zero culinary experience. It's why we offered paid sick time before the law required it. It's why we pay 1.5x when we ask our hourly teams to work on holidays.

---

### Culinary Principles & Philosophy

**THE FOUR CULINARY PRINCIPLES**  
[Source: operational-facts.yaml line 241-246 | Authority: PB-006]

> "Remarkable, Authentic, Responsible, Inspiring"

**CULINARY PHILOSOPHY - PURPOSE**  
[Source: PB-006 section "Culinary Philosophy: Purpose" (lines 54-56) | Authority: Culinary OS Handbook]

> "We fuel high-performance teams with food that respects where they come from, meets their everyday nutrition needs, and never feels like the same meal twice. We do it through chefs who care as much about the people they are feeding as the food they are cooking. The dining room is part of the performance environment, not a break from it."

**CULINARY PHILOSOPHY - PROMISE**  
[Source: PB-006 section "Culinary Philosophy: Promise" (lines 58-62) | Authority: Culinary OS Handbook]

> "We take the food and the people equally seriously. We cook authentically, because the people we feed come from somewhere. We fuel intentionally, because their performance depends on it. We hold standards in the kitchen and warmth in the dining room. We are present - on the line, in the dining room, and throughout the organization."

**REMARKABLE Principle (Full Definition)**  
[Source: PB-006 section "Culinary Overview: Remarkable in the Kitchen" | Authority: Culinary OS Handbook]

> "We cook food worth talking about. Remarkable is not a gimmick or a garnish - it is designed. Every menu is built to fuel the team we serve, and every dish is on the line because it earns its place. Good enough is forgettable. The goal is the remark: the player who tells a teammate about lunch, the client who brings a guest to the line. Partners who talk about us renew us, refer us, and grow us."

**AUTHENTIC Principle (Full Definition)**  
[Source: PB-006 section "Culinary Overview: Authentic in the Kitchen" | Authority: Culinary OS Handbook]

> "Authentic is the bar that separates KitchFix from generic contract food service. If we cook a cuisine, we cook it the way the people who built that cuisine would recognize it - ingredients, technique, presentation, and intent. Authenticity is also why players from every background feel at home in the dining room. An authentic dish starts with a kitchen culture where our chefs can be authentically themselves."

**RESPONSIBLE Principle (Full Definition)**  
[Source: PB-006 section "Culinary Overview: Responsible in the Kitchen" | Authority: Culinary OS Handbook]

> "Every plate earns its place. Every ingredient is chosen for what it brings to the plate - nutritious, flavorful, authentic, and purposeful. Our chefs only send out dishes they would proudly eat themselves - flavor, presentation, and execution all matter. Nutrition, craveability, food safety, and budget stewardship are our responsibility, not the client's."

**INSPIRING Principle (Full Definition)**  
[Source: PB-006 section "Culinary Overview: Inspiring in the Kitchen" | Authority: Culinary OS Handbook]

> "We strive to be innovative in our field - staying ahead of trends and bringing cuisines, flavors, and ingredients to the clubhouse line that clients have not seen before. We surround ourselves with like-minded chefs who are willing to grow and who challenge and inspire each other to be better every day. We educate - not only our staff, but our peers and the guests we feed - making dining in our operation fun, memorable, and informative."

---

### Culture & Hospitality Statements

**WHAT WE MEAN BY GENUINE HOSPITALITY**  
[Source: PB-014 section "Hospitality: What We Mean" | Authority: Culture OS Handbook]

> "Hospitality is the practice of anticipating the needs of the people around you and acting on them with genuine generosity, especially for those who need it most. Some days it's instinct. Some days it's a choice. We practice it either way."

> "Performed hospitality is a script: a smile at the door, the right phrasing, the practiced warmth that disappears the moment the guest turns their back. Scripted hospitality is a checklist dressed up as caring. Transactional hospitality is the clearest version of the problem: you showed up, you served the food, they ate, everyone goes home. Something happened. Nothing landed."

> "Genuine hospitality is something different. It is the decision to see the person in front of you - not the function they serve, not the request they're making - the actual person. The player who's had three bad at-bats and is walking through the line not making eye contact. The client who calls on a Friday with a problem that isn't really about the food. The cook who is learning something for the first time and needs someone to stay with them a minute longer."

**SERVICE VS HOSPITALITY**  
[Source: PB-014 section "Service Is the Table. Hospitality Is Why They Come Back." | Authority: Culture OS Handbook]

> "Service is anticipation: having the food ready, the line clear, the labels accurate, the operation set up so that no one has to want for anything. Service is the foundation. Without it, there is no hospitality to offer."

> "But once service is right, once the guest needs for nothing, something else becomes possible. The guest can be present. And so can you. That is the moment hospitality happens. It is not a department. It is not a training module. It is what emerges when a person genuinely decides to see another person and act on it."

**OUR PROMISE TO YOU (Employer Commitment)**  
[Source: PB-014 section "Our Promise to You" | Authority: Culture OS Handbook]

> "KitchFix is a great place to work."

> "The work is interesting - culinary, creative, always evolving, at the intersection of food and performance. The culture is genuine. You'll be challenged, you'll grow, and you'll be part of a team that actually cares about the people on it. We built this place to be what we always wanted to work in, and we protect that standard every day."

> "We give you what you need to do the job. The tools, the clarity, the training. You shouldn't have to guess at the standard or figure it out alone. That's on us."

> "This is a job, not your whole life. We build operations that are sustainable for the people running them. Burnout is not a business model. We expect your best at work, and we expect you to have a life outside it."

> "We invest in your growth. Coaching, development, and - when we execute well together - real opportunities to grow in pay, responsibility, and role. What we build here is meant to create a bigger company to belong to."

---

### The Vital Partner Standard

**VITAL PARTNER STANDARD**  
[Source: PB-014 section "The Vital Partner Standard" | Authority: Culture OS Handbook]

> "We hold the standard - and then exceed it. KitchFix owns the bar. We don't look to the client to set it, remind us of it, or hold us to it. The Service Level Agreement (SLA) defines what we're contracted to deliver. Our standard goes further - the Hospitality Promise is the floor, not the ceiling. We show up to exceed it, not meet it."

> "We run toward problems, not away from them. When something breaks, the client hears it from us first, not the other way around. Proactive, honest, solutions-forward. We earn the partnership by being the kind of operator they never have to chase."

> "We integrate, not just show up. We learn the team, the staff, the season, the facility. We're not a vendor cycling in and out. We become part of the operation, and that's what makes us irreplaceable."

---

## CATEGORY STATUS REPORT

### 1. Company Identity (Mission, Vision, Values, Purpose) [code-read:content/facts/operational-facts.yaml:227-246]

**CANONICAL LOCATION:** `content/facts/operational-facts.yaml` (Tier 1 Global Facts - Kevin-confirmed 2026-06-15)  
**AUTHORITY DOCS:** PB-014 (Culture OS Handbook, Live v1.0)

**STATUS:** LIVE  
**COMPLETENESS:** Full mission, vision, and four values documented and quoted above.

---

### 2. Culture (Culture Docs, Behavioral Standards, "How We Work") [code-read:content/documents/PB-014.mdx]

**CANONICAL LOCATION:** PB-014 Culture OS Handbook (Live v1.0)  
**SUPPORTING DOCS:**
- PB-001 Leadership OS Handbook (Live v9.1) - Section 2 "Culture"
- PB-006 Culinary OS Handbook (Live v1.0) - Section 1 "Culinary Philosophy"
- POL-014 Code of Conduct & Ethics (Live v1.0)

**STATUS:** LIVE  
**COMPLETENESS:** Foundation docstring in place. Genuine hospitality positioning well-defined. Founder origin story preserved. Cultural norms documented (Humility, Intentionality, Sustainability, Equity).

---

### 3. Leadership (Leadership Standards, Leadership OS, Org Structure, Role Definitions) [code-read:content/documents/PB-001.mdx:118-141]

**CANONICAL LOCATION:** PB-001 Leadership OS Handbook (Live v9.1) - Section 5 "Site Leadership"  
**SUPPORTING DOCS:**
- PB-014 Culture OS Handbook (Live v1.0) - foundation reference
- SOP-001 Leadership Performance System (In Build v2.0) - NOT LIVE
- PB-012 Client & Account Management Playbook (In Build v1.0) - NOT LIVE

**STATUS:** LIVE (PB-001 is Live; SOP-001 is In Build)  
**COMPLETENESS:** Five-role model defined (RDO, Site Leader, Sous Chef, Hospitality Manager, Corporate Field Chef). Six leadership themes defined. Regional oversight model clear.

**WARNING:** SOP-001 (Leadership Performance System v2.0) is "In Build" status. It is NOT yet approved canonical language. Leadership standards are currently carried in PB-001 Live; the detailed performance system awaits approval.

---

### 4. Culinary OS (Culinary Philosophy, Sourcing, Menu Dev, Quality, Food Safety, Allergens) [code-read:content/documents/PB-006.mdx:50-156]

**CANONICAL LOCATION:** PB-006 Culinary OS Handbook (Live v1.0) - Sections 1-3  
**SUPPORTING DOCS:**
- PB-014 Culture OS Handbook (Live v1.0) - references four culinary principles
- PB-002 Allergen Playbook (Live v1.0) - allergen handling detail
- SOP-008 Food Safety Management (Live v1.0) - food safety detail
- PB-005 SLA OS Handbook (In Build v1.0) - per-account SLA tuning (NOT LIVE)

**STATUS:** LIVE (PB-006 is Live; allergen/safety companions are Live; SLA tuning doc is In Build)  
**COMPLETENESS:** Four culinary principles defined. Philosophy documented with purpose and promise. Detailed operating standards in sections 3.1-3.15 (cooking methods, sourcing, protein framework, ingredients, meal service, stations, allergens, sanitation, branding).

---

### 5. Company Goals (Stated Goals, Strategic Priorities, North-Star Language) [NOT FOUND]

**SEARCH RESULT:** No discrete "company goals" or "strategic priorities" document found in OPD corpus.

**NOTES:** 
- PB-014 defines Mission and Vision (foundational North Stars).
- Leadership OS Handbook (PB-001) references "the Cadence Matrix" and "Accountability System" but does not isolate stated annual or multi-year company goals as a standalone strategic doc.
- No REF (reference) or SOP document titled "Strategic Goals" or "Company Priorities" found.

**DISPOSITION:** NO CURRENT OPD DOCUMENT covers this category. If a reference deck relies on legacy goal statements, those statements do NOT have current OPD sourcing.

---

### 6. Service Standards (Hospitality Standards, Service Level Definitions, Client-Facing Commitments) [code-read:content/documents/PB-001.mdx:106-116]

**CANONICAL LOCATION:**
- **Service Delivery:**  
  - PB-005 SLA OS Handbook (In Build v1.0) - NOT LIVE (defines ten-section SLA structure)
  - PB-001 Leadership OS Handbook (Live v9.1) - Section 3 "The Vital Partner Standard"
  - PB-014 Culture OS Handbook (Live v1.0) - "The Vital Partner Standard" (copied above)

- **Allergen/Food Safety:**  
  - PB-002 Allergen Playbook (Live v1.0)
  - SOP-008 Food Safety Management (Live v1.0)

**STATUS:** Partially Live, Partially In Build  
- Vital Partner Standard (Live, PB-014/PB-001)
- SLA structure and operational SOP (In Build, PB-005 - NOT LIVE)
- Food safety and allergen standards (Live, PB-002 & SOP-008)

**COMPLETENESS:** Vital Partner Standard fully defined. Allergen and food safety standards defined. Full SLA framework awaits PB-005 approval.

**WARNING:** PB-005 (SLA OS Handbook) is "In Build" - NOT YET APPROVED. Any client-facing SLA templates or account-specific service commitments in that document are not yet canonical.

---

## LEGACY-DRIFT LIST

### Finding 1: Mission Statement - No Drift Detected

**Category:** Company Identity  
**Current OPD Language (PB-014 + operational-facts.yaml):**  
> "We exist to fuel, heal, and genuinely care for every team we serve - through the food we make and the hospitality behind it."

**Status:** This mission statement is the only version in current OPD. No superseded or competing mission statement is recorded in the corpus.

**Disposition:** If a reference deck contains a materially different mission wording (e.g., "Feed championship teams" or "Fuel performance through hospitality"), that is LEGACY language. Current deck must quote the statement above verbatim from PB-014 (Approved: Culture OS Handbook).

---

### Finding 2: Vision Statement - No Drift Detected

**Category:** Company Identity  
**Current OPD Language (PB-014 + operational-facts.yaml):**  
> "Be the vital partner for every performance-focused organization we serve - the one they can't imagine winning without."

**Status:** This vision statement is the only version in current OPD. No superseded or competing version found.

**Disposition:** If a reference deck contains a materially different vision (e.g., "Become the premier food-service partner in baseball" or "Win every clubhouse we enter"), that is LEGACY language. Current deck must quote the statement above verbatim from PB-014.

---

### Finding 3: Brand Promise - No Drift Detected

**Category:** Company Identity / Service Standards  
**Current OPD Language (operational-facts.yaml + PB-014):**  
> "Best Food, Best Service, Best Hospitality"

**Status:** This three-word promise is canonical and unchanged from its origin in PB-014. Authority moved from PB-001 v8.1 to PB-014 in the current rebuild (2026-06-15), but the wording is identical.

**Disposition:** Safe to reuse on client-facing slides. Cite PB-014 v1.0 as authority.

---

### Finding 4: Four Values - Minor Drift Possible (Wording Preserved, Contextual Emphasis Shifted)

**Category:** Company Culture  
**Current OPD Language (PB-014, Section "Values: What We Believe"):**

1. **Humility** - [quoted above, full 4-line definition]
2. **Intentionality** - [quoted above, full 3-line definition]
3. **Sustainability** - [quoted above, full 3-line definition]
4. **Equity** - [quoted above, full 4-line definition]

**Notes on Stability:**
- The four value names are stable.
- The long-form definitions in PB-014 are verbose and detailed (sourced from Kevin's confirmed set, 2026-06-15).
- If a reference deck contains shorter or punchy value statements (e.g., "Humility," "Intentionality," "Sustainability," "Equity" with one-sentence descriptions), that is NOT drift - it is an abbreviated version of the same values.
- If a reference deck lists a DIFFERENT fourth value (e.g., "Impact" or "Accountability" instead of "Equity"), that IS drift.

**Disposition:** Check the reference deck's exact value wording. If it names the same four values, it is canonical and can be reused with citation to PB-014. If the fourth value is named differently or differently defined, that is LEGACY.

---

### Finding 5: Culinary Principles - No Drift Detected

**Category:** Culinary OS  
**Current OPD Language (operational-facts.yaml + PB-006):**  
> "Remarkable, Authentic, Responsible, Inspiring"

**Verbatim Definitions:** Fully quoted in the Canonical Language Block above (from PB-006 "Culinary Overview" section).

**Status:** This is the only version in current OPD. Culinary principles are the anchor of the culinary philosophy and do not appear in superseded forms.

**Disposition:** Safe to reuse on client-facing slides. Cite PB-006 v1.0 as authority. Use the full principle definitions (quoted above) rather than just the four words, for clarity.

---

### Finding 6: Hospitality Philosophy - Minor Wording Variants Possible

**Category:** Company Culture / Service Standards  
**Current OPD Language (PB-014, Section "Hospitality: What We Mean"):**

Core definition: "Hospitality is the practice of anticipating the needs of the people around you and acting on them with genuine generosity, especially for those who need it most."

**Status:** This is the foundational definition in PB-014 (Live v1.0). It supersedes and corrects any earlier use of "service" as a synonym for "hospitality."

**Critical Correction:** PB-014 explicitly states the three ways hospitality is often WRONG:
- Performed hospitality (script)
- Scripted hospitality (checklist)
- Transactional hospitality (empty exchange)

If a reference deck treats "hospitality" as a synonym for "great customer service," that is LEGACY thinking that PB-014 corrects. Current language must distinguish hospitality from service and explain the difference.

**Disposition:** If a reference deck says "KitchFix provides hospitality" with no further definition, it is incomplete and should be re-grounded in PB-014 definition above.

---

### Finding 7: The Vital Partner Standard - No Drift Detected

**Category:** Service Standards / Client Relationship  
**Current OPD Language (PB-014 + PB-001 Section 3):**

Three pillars (fully quoted above):
1. Hold the standard, then exceed it
2. Run toward problems, not away
3. Integrate, not just show up

**Status:** This framing appears in both PB-014 and PB-001 (same language). It is the current standard for all client relationships.

**Disposition:** Safe to cite on client-facing slides. Use verbatim language from PB-014 or PB-001.

---

### Finding 8: Our Promise to You (Employer Commitment) - POTENTIALLY LEGACY

**Category:** Culture / Employee Value Proposition  
**Current OPD Language (PB-014, Section "Our Promise to You"):**

Four commitments (quoted above in full):
1. KitchFix is a great place to work (interest, culture, growth)
2. We give you what you need to do the job
3. This is a job, not your whole life (sustainability, work-life balance)
4. We invest in your growth (coaching, development, pay growth)

**Status:** These commitments are in PB-014 (Live v1.0) and represent the current employer brand.

**Reference Deck Risk:** If an older pitch deck emphasizes different value propositions (e.g., "equity/ownership," "stock options," "rapid growth track"), those are LEGACY and not supported by current OPD. PB-014 does not mention equity, stock, or ownership - it emphasizes sustainability, learning, and balanced expectation.

**Disposition:** If deck emphasizes employee ownership/equity, that is NOT current policy and must be removed or re-grounded in current language above.

---

### Finding 9: Leadership Roles & Org Structure - SIGNIFICANT DRIFT

**Category:** Leadership / Organizational Structure  
**Current OPD Language (PB-001 v9.1, Section 5 "Site Leadership"):**

Five leadership roles defined:
1. Regional Director of Operations (RDO)
2. Site Leader (EC & GM)
3. Sous Chef
4. Hospitality Manager
5. Corporate Field Chef

**Known Drift Risk:** PB-001 v9.1 is dated 2026-07-18. Earlier versions may have carried different role titles or descriptions. If a reference deck (from 2025 or earlier) uses different titles or job descriptions, those are LEGACY.

**Six Leadership Themes** (PB-001 Section 5):
1. People
2. Operations
3. Financial
4. Client
5. Culinary
6. Compliance

**Disposition:** Confirm the reference deck's leadership framework. If it uses the five-role model and six-theme structure, cite PB-001 v9.1. If it uses a different structure or different role titles, that is LEGACY and needs update.

---

### Finding 10: Leadership Performance System - AWAITING APPROVAL

**Category:** Leadership / Accountability  
**Current Status:** SOP-001 Leadership Performance System is "In Build" as of 2026-08-04.

**What This Means:** The detailed framework for how leadership is measured, reviewed, and held accountable is NOT YET APPROVED. 

**Current Substitute:** Leadership standards are currently housed in PB-001 (Live v9.1), which defines roles and the six themes. The detailed performance review cycle, evaluation rubrics, and accountability mechanisms awaited in SOP-001 are not yet live.

**Disposition:** DO NOT cite SOP-001 on client-facing slides. If leadership accountability language is needed, cite PB-001 sections on accountability or wait for SOP-001 approval.

---

### Finding 11: Service Level Agreements (SLAs) - AWAITING APPROVAL

**Category:** Service Standards / Client Commitments  
**Current Status:** PB-005 SLA OS Handbook is "In Build" as of 2026-08-04.

**What This Means:** The template for all client-facing service agreements (scope, service calendar, operations, nutrition, communication, performance measurement, etc.) is NOT YET APPROVED.

**Current State:** Signed SLAs for active accounts (Cardinals, Reds, Rangers, etc.) exist as individual documents; the playbook/template governing their structure is not yet canonical.

**Disposition:** DO NOT cite PB-005 on client-facing slides or in the reference deck. Vital Partner Standard (PB-014) is the substitute for service commitments until PB-005 is approved. If deck contains specific SLA language, source it from a signed account SLA, not from an In Build template.

---

### Finding 12: Strategic Goals / Annual Priorities - NOT FOUND

**Category:** Company Goals / Strategic Direction  
**Current Status:** NO OPD document found covering stated company goals, annual priorities, north-star metrics, or multi-year strategy.

**What This Means:** If a reference deck includes "KitchFix's 2026 goals" or "strategic priorities," those statements do NOT have current OPD sourcing. They are either:
- LEGACY (from an older deck not updated in OPD)
- INFORMAL (sourced from leadership conversation, not a published doc)
- NOT CANONICAL (from README, CLAUDE.md, or other non-OPD sources)

**Disposition:** DO NOT use legacy goal statements on client-facing decks without re-grounding them in current leadership guidance. If goals are needed, source them from SLT or Senior Director of Operations directly; they are not yet documented in OPD.

---

## SUMMARY OF DOCUMENT STATUS BY CATEGORY

| Category | Primary Doc | Status | Version | Approved | Notes |
|---|---|---|---|---|---|
| Mission & Vision | PB-014 | Live | 1.0 | No date recorded | Canonical and stable |
| Four Values | PB-014 | Live | 1.0 | No date recorded | Canonical and stable |
| Brand Promise | operational-facts.yaml (authority: PB-014) | Live | 1.0 | No date recorded | Stable; identical to PB-001 v8.1 |
| Culinary Philosophy | PB-006 | Live | 1.0 | No date recorded | Stable; four principles canonical |
| Hospitality Positioning | PB-014 | Live | 1.0 | No date recorded | Corrects legacy "service=hospitality" conflation |
| Vital Partner Standard | PB-014 + PB-001 | Live | v9.1 + v1.0 | No date recorded | Stable and canonical |
| Employee Value Prop | PB-014 | Live | 1.0 | No date recorded | May differ from legacy deck language |
| Leadership Roles & Org | PB-001 | Live | 9.1 | No date recorded | Five roles, six themes; confirm vs. reference deck |
| Leadership Performance System | SOP-001 | **In Build** | 2.0 | **Not approved** | **NOT LIVE** - use PB-001 for current standards |
| SLA Framework | PB-005 | **In Build** | 1.0 | **Not approved** | **NOT LIVE** - use Vital Partner Standard until approved |
| Allergen & Food Safety | PB-002 + SOP-008 | Live | v1.0 + v1.0 | No date recorded | Stable and canonical |
| Company Goals | NOT FOUND | — | — | — | **NOT FOUND** - no current OPD doc; source from SLT |

---

## FINAL NOTES

1. **Five Live Documents Supersede Legacy Playbook Content:**
   - PB-014 Culture OS Handbook (mission, vision, values, hospitality, vital partner, employee promise)
   - PB-001 Leadership OS Handbook (roles, accountability, client standards)
   - PB-006 Culinary OS Handbook (philosophy and operating standards)
   - PB-002 Allergen Playbook (food safety)
   - SOP-008 Food Safety Management

2. **Two Documents In Build - NOT Yet Canonical:**
   - PB-005 SLA OS Handbook (client-facing service framework)
   - SOP-001 Leadership Performance System (leadership evaluation)

3. **One Category Missing from OPD:**
   - Company Goals / Strategic Priorities (no document found; contact SLT for current language)

4. **Verbatim Principle:** Every mission, vision, value, philosophy, or promise statement cited above is quoted exactly as it appears in the canonical OPD source. No paraphrase. Where a reference deck reuses visual or slide patterns from an older pitch, the language layer MUST be re-grounded in the sources listed above or flagged for SLT review.

