# Account Reference

**Last verified:** 2026-08-06 (Kevin's corrections applied)
**Scope:** twelve accounts + Rippling identifiers + open items. Not a full inventory - the exploratory sections from the earlier draft did not add value beyond this table.

**Standing rule:** No account identifier is inferred at the point of use. If a system needs to resolve an account, the mapping comes from this file or a table seeded from it. An identifier not here is an open question, not a naming puzzle to solve locally.

---

## The twelve accounts

```
CIN - AZ
  P&L tab           CIN-AZ
  City              Goodyear, AZ
  Client            Cincinnati Reds
  Site leader       Jennifer Trible (General Manager)   [owner-confirmed 2026-08-06]
                    (Michael Decanio is Chef De Cuisine and a leader, but reports to Jen.
                     `contacts` table has Decanio only - contacts is stale, do not read it.)
  Billing           per-meal (actuals-driven) + SF
  Work location     Goodyear, AZ (CIN-AZ)
  Hourly dept       Hourly Kitchen - 3100.1 - REDS       (name-misleading; D32)
  Salary dept       Salary Wages - 3100.2 - REDS
  Other depts       Goodyear Reds (parent container)

CIN - KY
  P&L tab           CIN-KY
  City              Louisville, KY
  Client            Cincinnati Reds
  Site leader       Stephen Bailey (Executive Chef)   [contacts, cross-check owner]
  Billing           per-meal (actuals-driven)
  Work location     Louisville, KY (CIN-KY)
  Hourly dept       (none - D26 salaried-only)
  Salary dept       Salary Wages - 3100.2 - Bats
  Other depts       Louisville  Bats (parent, note double space; 1 contractor sits here)

CIN - OH
  P&L tab           CIN-OH
  City              Cincinnati, OH
  Client            Cincinnati Reds
  Site leader       Kelsey Atherton (Executive Chef)   [contacts, cross-check owner]
  Billing           flat fee
  Work location     Cincinnati, OH (CIN-OH)
  Hourly dept       Hourly Kitchen - 3100.1 - REDS OH
  Salary dept       Salary Wages - 3100.2 REDS OH
  Other depts       Cincinnati Reds (parent container)

CORP
  P&L tab           (NULL)
  City              Chicago, IL
  Client            KitchFix (corporate)
  Site leader       Josh Katt (CEO)   [owner-confirmed 2026-08-06]
                    (`contacts` has Kevin Fietek as Director of Operations. Kevin reports to Josh.
                     contacts is stale here too.)
  Billing           n/a
  Work location     Headquarters & Chicago Commissary Kitchen; Corporate (CORP)
  Hourly dept       n/a
  Salary dept       n/a
  Other depts       5004.1 - CORP CEO; 5004.2 - CORP FINANCE; 5004.4 - Marketing Wages;
                    5004.6 - CORP HR; 5004.7 CORP OPS/ACCT MGMT/SALES;
                    PFS (root container); Corporate (root container)

STL - FL
  P&L tab           STL-FL
  City              Jupiter, FL
  Client            St. Louis Cardinals
  Site leader       Bill Hofmann (Executive Chef)   [contacts, cross-check owner]
  Billing           flat fee
  Work location     Jupiter, FL (STL-FL)
  Hourly dept       Hourly Kitchen - 3100.1 - Jupiter
  Salary dept       Salary Wages - 3100.2 - Jupiter
  Other depts       Jupiter Cardinals (parent container)

STL - MO
  P&L tab           STL-MO
  City              St Louis, MO
  Client            St. Louis Cardinals
  Site leader       Joshua Poletti (Executive Chef)   [contacts, cross-check owner]
  Billing           flat fee
  Work location     St. Louis, MO (STL-MO)
  Hourly dept       Hourly Kitchen - 3100.1 - Cardinals
  Salary dept       Salary Wages - 3100.2 - Cardinals
  Other depts       St. Louis Cardinals (parent container)

TBJ - FL
  P&L tab           TBJ-FL
  City              Dunedin, FL
  Client            Toronto Blue Jays
  Site leader       Diego Diez (Executive Chef)   [contacts, cross-check owner]
  Billing           per-meal (actuals-driven) + SF (hybrid)
  Work location     Dunedin, FL (TBJ-FL)
  Hourly dept       Hourly Kitchen - 3100.1 - TBJ
  Salary dept       Salary Wages - 3100.2 - TBJ
  Other depts       Dunedin TBJ (parent container)

TBJ - NY
  P&L tab           TBJ-BUF   [KNOWN-WRONG-BUT-LOAD-BEARING - see divergences below]
  City              Buffalo, NY
  Client            Toronto Blue Jays
  Site leader       Keith Gilman (Executive Chef)   [contacts, cross-check owner]
  Billing           per-meal (actuals-driven)
  Work location     Buffalo, NY (TBJ-BUF)
  Hourly dept       Hourly Kitchen - 3100.1 - BUF   (12 workers, all TERMINATED 2020-21, D26 holds)
  Salary dept       Salary Wages - 3100.2 - BUF
  Other depts       Buffalo NY (parent container)

TBR - FL
  P&L tab           TBR-FL
  City              Port Charlotte, FL   [owner-confirmed 2026-08-06 as correct city]
  Client            Tampa Bay Rays
  Site leader       Joe Coppolino (Executive Chef)   [contacts, cross-check owner]
  Billing           per-meal (actuals-driven) + SF (hybrid)
  Work location     Englewood, FL/Port Charlotte, FL (TBR-FL)   (ONE Rippling work location
                    covering BOTH physical sites; two separate Rippling schedules -
                    TBR - Englewood, FL and TBR - Port Charlotte, FL - both roll to TBR-FL)
  Hourly dept       Hourly Kitchen - 3100.1 - TBR
  Salary dept       Salary Wages - 3100.2 - TBR
  Other depts       Port Charlotte TBR (parent container)

TXR - AZ
  P&L tab           TXR-AZ
  City              Surprise, AZ
  Client            Texas Rangers
  Site leader       Elizabeth Randall (Manager in charge)   [owner-confirmed 2026-08-06]
                    (Adam Lacy reports to her. contacts has both but no clear leader marker.)
  Billing           per-meal (actuals-driven) + SF
  Work location     Surprise, AZ (TXR-AZ)
  Hourly dept       Hourly Kitchen - 3100.1 TXR-AZ
  Salary dept       Salary Wages - 3100.2 TXR-AZ
  Other depts       Surprise TXR (parent container)

TXR - TX - H
  P&L tab           TXR-HOME
  City              Arlington, TX
  Client            Texas Rangers
  Site leader       Josh Forkner   [owner-confirmed 2026-08-06]
                    (Previously Sous Chef in Salary Wages - 3100.2 - TXR - Home Side.
                     Grant Lawson - previously Executive Chef, still in contacts - has been
                     TERMINATED. Josh's promotion from sous to site-leader is the §8
                     worked example for role-over-time.)
  Billing           flat fee
  Work location     Arlington, TX (TXR-HOME)
  Rippling schedule TXR - Home, Arlington, TX
  Hourly dept       Hourly Kitchen - 3100.1 - TXR - Home Side
  Salary dept       Salary Wages - 3100.2 - TXR - Home Side
  Other depts       Arlington TXR (parent container, shared with TXR - TX - V)
  Note              Thinnest account in the portfolio - 11.9% budgeted gross margin,
                    2.2% contribution, running below budget YTD, and just changed leadership.
                    Not a build item. Playbook §4.7 flags this so nobody reads the numbers
                    without the context.

TXR - TX - V
  P&L tab           TXR-VISTOR   [KNOWN-WRONG-BUT-LOAD-BEARING - see divergences below]
  City              Arlington, TX
  Client            Texas Rangers
  Site leader       Jordan Rodgers (Executive Chef)   [contacts, cross-check owner]
  Billing           flat fee   (accounts.billing_model = flat_fee. Revenue books to 2400.1
                                per Kevin 2026-08-06, NOT 2400.2 as previously ruled. See D3
                                reversal in playbook.)
  Work location     Arlington, TX Visitor (TXR-VISITOR)
  Rippling schedule TXR - Visitor, Arlington, TX
  Hourly dept       Hourly Kitchen - 3100.1 - TXR- Visiting Side   (note missing space after hyphen)
  Salary dept       Salary Wages - 3100.2 - TXR- Visiting Side
  Other depts       Arlington TXR (shared parent with TXR - TX - H)
  Note              H and V are separate accounts, separate employees, separate clock-ins,
                    separate departments, separate work locations, separate schedules.
                    Three independent structures agree.
```

---

## Known name divergences

Both `pnl_tab_name` values are wrong per Kevin (2026-08-06) but the workbook itself still uses those tab names, and `pnl_tab_name` exists to match the actual tab. **KNOWN-WRONG-BUT-LOAD-BEARING** pending workbook rename.

- `TBJ - NY` has P&L tab `TBJ-BUF` - should be `TBJ - NY`
- `TXR - TX - V` has P&L tab `TXR-VISTOR` (missing `I`) - should be `TXR - TX - V`

**Correct sequence to fix**:
1. Finance renames the tabs in the source workbook. Kevin's action, outside this repo.
2. A new upload arrives carrying the corrected tab names.
3. **Then** `pnl_tab_name` is updated, in its own migration with a pre-flight asserting the current values.

**The trap this note prevents:** a reader sees `pnl_tab_name = 'TBJ-BUF'`, knows Kevin ruled it wrong, and "fixes" the column. The parser silently stops finding TBJ-NY's data on the next upload and nobody connects the two.

---

## `contacts` table is stale

Four site-leader corrections above came from Kevin, not `contacts`. **Do not read `contacts` as authoritative** until it is refreshed. Refreshing it is its own scope.

Known-stale entries:
- CIN - AZ: contacts has Michael Decanio (CDC); correct leader is Jennifer Trible (GM)
- CORP: contacts has Kevin Fietek (DoO); correct is Josh Katt (CEO)
- TXR - AZ: contacts has no clear leader marker; correct is Elizabeth Randall
- TXR - TX - H: contacts still shows Grant Lawson (Exec Chef); Grant has been terminated. Correct is Josh Forkner.

---

## Open items

**Closed** (Kevin 2026-08-06, playbook §12 for detail):
- Q2 - TXR H/V clock discipline: separate, three structures agree
- Q3 - STL-MO 3200.2: coding error, AP is moving the money
- Q4 - STL-FL resale: fun money, closed
- Q5 - fun money is $25k at both STL-FL and TBJ-FL (TBJ arithmetic has a $3,474 delta - noted, not blocking)
- Q6 - TXR-V revenue line: **`2400.1`, not `2400.2`.** Reverses playbook D3.
- Q7 - bonus target: Total COGS (confirms D15b)
- Q8 - STL-MO / TXR-TX-H zero `sc_daily_actuals`: test data during build, will be removed

**Still open**:
- Q1 - fiscal year end. Kevin's answer (SC ends 12/20 for holidays; salary is year-round) implies FY2026 runs 2025-12-29 through 2026-12-27 and FY2027 P1 opens 2026-12-28. **Inference, needs one-line owner confirmation.** `FY2026_END` stays provisional until he says yes.

**New items opened**:
- **`gl_codes` correction needed for TXR - TX - V** - currently `2400.2`, should be `2400.1` per D3 reversal. Own migration with pre-flight asserting current value. Do not fold into another PR.
- **`pnl_tab_name` renames pending workbook** - see divergence sequence above.
- **Rippling worker-assignment cleanup** - 4 workers in `Hourly Kitchen - 3100.1 - TXR- Visiting Side` are assigned to Arlington HOME work_location instead of Arlington Visitor. All 4 are TERMINATED with 0 time entries; no attribution impact, but the assignment is a Rippling config cleanup item.

  ```
  worker_id                                status       title             time entries
  65b9442da767cbc65519e279                 TERMINATED   Dishwasher/Prep   0
  65baeae47c5f88bbc40beca9                 TERMINATED   Cook              0
  65f1f10761de96ec846b54e1                 TERMINATED   Cook              0
  66563c3263dfbb6ae8a022fe                 TERMINATED   Cook              0
  ```

---

## Rippling: three structures, none authoritative alone

Rippling exposes at least three structures that look like they identify an account: **department, work location, and schedule.** None is authoritative on its own, and they are not one-to-one with each other.

| Site | Departments | Work locations | Schedules | Accounts |
|---|---:|---:|---:|---:|
| TXR Arlington | 2 (H, V) | 2 (HOME, VISITOR) | 2 (Home, Visitor) | 2 (H, V) |
| TBR Florida | 1 pair (hourly + salary) | **1** (combined Englewood/Port Charlotte) | **2** (Englewood, Port Charlotte) | **1** (TBR-FL) |

**`department_id` is the attribution key** (playbook D24). Work location is a cross-check. Schedule is neither - it is operational scheduling structure and carries no account meaning on its own.

**A future integration that reaches for whichever identifier is closest to hand will get one of these two sites wrong.**
