# PG APPENDIX — Pricing Summit Evidence

> READ-ONLY dump of `accounts`, `sc_fee_schedule`, `sc_service_prices` (joined via `sc_services`) at 2026-07-14. Reproduce via `node --env-file=.env.local scripts/_probe_pricing_summit_pg_dump.mjs`.

## accounts (12 rows)

| team_key | name | level | billing_model | has_homestand_schedule | has_schedule_overlay | active |
| --- | --- | --- | --- | --- | --- | --- |
| CIN - AZ | Cincinnati Reds | PDC | actuals_drive_invoice |  |  | ✓ |
| CIN - KY | Louisville Bats | AAA | actuals_drive_invoice | ✓ |  | ✓ |
| CIN - OH | Cincinnati Reds | MLB | flat_fee | ✓ |  | ✓ |
| CORP | KitchFix Team | CORP | — |  |  | ✓ |
| STL - FL | St Louis Cardinals | PDC | flat_fee |  | ✓ | ✓ |
| STL - MO | St Louis Cardinals | MLB | flat_fee | ✓ |  | ✓ |
| TBJ - FL | Toronto Blue Jays | PDC | actuals_drive_invoice |  | ✓ | ✓ |
| TBJ - NY | Buffalo Bisons | AAA | actuals_drive_invoice | ✓ |  | ✓ |
| TBR - FL | Tampa Bay Rays | PDC | actuals_drive_invoice |  |  | ✓ |
| TXR - AZ | Texas Rangers | PDC | actuals_drive_invoice |  |  | ✓ |
| TXR - TX - H | Texas Rangers Home | MLB | flat_fee | ✓ |  | ✓ |
| TXR - TX - V | Texas Rangers Visiting | MLB | flat_fee | ✓ |  | ✓ |

## sc_fee_schedule (5 rows)

| id | account_key | amount | effective_date | period_type | payment_cadence | covered_by_account_key | reason | requested_by | changed_by | created_at |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 5f4cd389-72db-41f0-9f9b-f2f02319a45c | CIN - OH | 362500 | 2026-01-01 | annual | monthly-6 | — | Seed: locked 2026 contract-year annual fee from SC_CONTRACT_BILLING_SUMMARY.md (Bundle 1 Stage 2). | — | seed-script | 2026-06-19T15:53:30.536428+00:00 |
| 85e2abad-48fe-4ddf-bb61-894ca2283360 | STL - FL | 1400000 | 2026-01-01 | annual | quarterly | — | Seed: locked 2026 contract-year annual fee from SC_CONTRACT_BILLING_SUMMARY.md (Bundle 1 Stage 2). | — | seed-script | 2026-06-19T15:53:31.285372+00:00 |
| 30cbdfd2-c7a1-4300-88ef-46408b163c93 | STL - MO | 473000 | 2026-01-01 | annual | monthly-6 | — | Seed: locked 2026 contract-year annual fee from SC_CONTRACT_BILLING_SUMMARY.md (Bundle 1 Stage 2). | — | seed-script | 2026-06-19T15:53:30.787087+00:00 |
| 8b3ffb94-6dab-46bb-a7ce-a9aff87d87d7 | TXR - TX - H | 604032 | 2026-01-01 | annual | monthly-6 | — | Seed: locked 2026 contract-year annual fee from SC_CONTRACT_BILLING_SUMMARY.md (Bundle 1 Stage 2). | — | seed-script | 2026-06-19T15:53:30.950725+00:00 |
| 0a3eb397-f636-417c-b142-b347d4bbf8b7 | TXR - TX - V | 0 | 2026-01-01 | annual | — | TXR - TX - H | Seed: locked 2026 contract-year annual fee from SC_CONTRACT_BILLING_SUMMARY.md (Bundle 1 Stage 2). | — | seed-script | 2026-06-19T15:53:31.120987+00:00 |

## sc_service_prices (joined via sc_services)

| account_key | service | is_flat_fee | is_tax_free | is_non_revenue | active | effective_date | price_kind | price |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CIN - AZ | Breakfast |  |  |  | ✓ | 2026-01-01 | projected | 18.42147 |
| CIN - AZ | Breakfast |  |  |  | ✓ | 2026-06-16 | projected | 12.89503 |
| CIN - AZ | Breakfast |  |  |  | ✓ | 2026-01-01 | projected | 29.00888 |
| CIN - AZ | Breakfast |  |  |  | ✓ | 2026-06-16 | projected | 20.30622 |
| CIN - AZ | Breakfast |  |  |  | ✓ | 2026-06-17 | projected | 20.30622 |
| CIN - AZ | Breakfast |  |  |  | ✓ | 2026-06-18 | projected | 20.32 |
| CIN - AZ | Breakfast |  |  |  | ✓ | 2026-01-01 | projected | 18.42147 |
| CIN - AZ | Breakfast |  |  |  | ✓ | 2026-06-16 | projected | 12.89503 |
| CIN - AZ | Coffee Service (tax-free) | ✓ | ✓ |  | ✓ | 2026-01-01 | projected | 511.05293 |
| CIN - AZ | Continental Plus |  |  |  | ✓ | 2026-01-01 | projected | 9.08086 |
| CIN - AZ | Continental Plus |  |  |  | ✓ | 2026-06-16 | projected | 6.3566 |
| CIN - AZ | Dinner |  |  |  | ✓ | 2026-01-01 | projected | 18.42147 |
| CIN - AZ | Dinner |  |  |  | ✓ | 2026-06-16 | projected | 12.89503 |
| CIN - AZ | Dinner |  |  |  | ✓ | 2026-01-01 | projected | 29.00888 |
| CIN - AZ | Dinner |  |  |  | ✓ | 2026-06-16 | projected | 20.30622 |
| CIN - AZ | Dinner |  |  |  | ✓ | 2026-01-01 | projected | 18.42147 |
| CIN - AZ | Dinner |  |  |  | ✓ | 2026-06-16 | projected | 12.89503 |
| CIN - AZ | Fountain Bev (tax-free) | ✓ | ✓ |  | ✓ | 2026-01-01 | projected | 283.91714 |
| CIN - AZ | Lunch |  |  |  | ✓ | 2026-01-01 | projected | 29.00888 |
| CIN - AZ | Lunch |  |  |  | ✓ | 2026-06-16 | projected | 20.30622 |
| CIN - AZ | Lunch |  |  |  | ✓ | 2026-01-01 | projected | 18.42147 |
| CIN - AZ | Lunch |  |  |  | ✓ | 2026-06-16 | projected | 12.89503 |
| CIN - AZ | Lunch |  |  |  | ✓ | 2026-06-26 | projected | 12.89503 |
| CIN - AZ | Lunch |  |  |  | ✓ | 2026-01-01 | projected | 18.42147 |
| CIN - AZ | Lunch |  |  |  | ✓ | 2026-06-16 | projected | 12.89503 |
| CIN - AZ | Pre-Game Snack |  |  |  | ✓ | 2026-01-01 | projected | 7.31456 |
| CIN - AZ | Pre-Game Snack |  |  |  | ✓ | 2026-06-16 | projected | 5.12019 |
| CIN - KY | Breakfast |  |  |  | ✓ | 2026-01-01 | projected | 25.95422 |
| CIN - KY | Lunch |  |  |  | ✓ | 2026-01-01 | projected | 25.95422 |
| CIN - KY | Post-Game |  |  |  | ✓ | 2026-01-01 | projected | 25.95422 |
| CIN - KY | Snack |  |  |  | ✓ | 2026-01-01 | projected | 8.64448 |
| CIN - KY | Umpire |  |  |  | ✓ | 2026-01-01 | projected | 25.95422 |
| CIN - OH | Arrival |  |  |  | ✓ | 2026-01-01 | projected | 25.95422 |
| CIN - OH | Arrival |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| CIN - OH | Post BP |  |  |  | ✓ | 2026-01-01 | projected | 25.95422 |
| CIN - OH | Post BP |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| CIN - OH | Post-Game |  |  |  | ✓ | 2026-01-01 | projected | 25.95422 |
| CIN - OH | Post-Game |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| CIN - OH | Umpire |  |  |  | ✓ | 2026-01-01 | projected | 25.95422 |
| CIN - OH | Umpire |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| STL - FL | Arrival |  |  |  | ✓ | 2026-01-01 | projected | 26 |
| STL - FL | Arrival |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| STL - FL | Breakfast |  |  |  | ✓ | 2026-01-01 | projected | 26 |
| STL - FL | Breakfast |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| STL - FL | Breakfast - ST |  |  |  | ✓ | 2026-01-01 | projected | 40 |
| STL - FL | Breakfast - ST |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| STL - FL | Breakfast - ST |  |  |  | ✓ | 2026-01-01 | projected | 40 |
| STL - FL | Breakfast - ST |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| STL - FL | Fun Money allocation | ✓ |  | ✓ | ✓ | 2026-01-01 | projected | 25000 |
| STL - FL | Fun Money allocation | ✓ |  | ✓ | ✓ | 2026-06-16 | projected | 0 |
| STL - FL | Lunch |  |  |  | ✓ | 2026-01-01 | projected | 26 |
| STL - FL | Lunch |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| STL - FL | Lunch - ST |  |  |  | ✓ | 2026-01-01 | projected | 40 |
| STL - FL | Lunch - ST |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| STL - FL | Lunch - ST |  |  |  | ✓ | 2026-01-01 | projected | 40 |
| STL - FL | Lunch - ST |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| STL - FL | Post-Game |  |  |  | ✓ | 2026-01-01 | projected | 26 |
| STL - FL | Post-Game |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| STL - FL | Pre-game |  |  |  | ✓ | 2026-01-01 | projected | 26 |
| STL - FL | Pre-game |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| STL - FL | Snack |  |  |  | ✓ | 2026-01-01 | projected | 0 |
| STL - FL | Snack |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| STL - MO | Arrival |  |  |  | ✓ | 2026-01-01 | projected | 25.95422 |
| STL - MO | Arrival |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| STL - MO | Post BP |  |  |  | ✓ | 2026-01-01 | projected | 25.95422 |
| STL - MO | Post BP |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| STL - MO | Post-Game |  |  |  | ✓ | 2026-01-01 | projected | 25.95422 |
| STL - MO | Post-Game |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| STL - MO | Umpire |  |  |  | ✓ | 2026-01-01 | projected | 25.95422 |
| STL - MO | Umpire |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| TBJ - FL | Breakfast |  |  |  | ✓ | 2026-01-01 | projected | 16.50971 |
| TBJ - FL | Breakfast |  |  |  | ✓ | 2026-01-01 | projected | 11.55368 |
| TBJ - FL | Breakfast |  |  |  | ✓ | 2026-01-01 | projected | 23.11775 |
| TBJ - FL | Dinner |  |  |  | ✓ | 2026-01-01 | projected | 23.11775 |
| TBJ - FL | Dinner |  |  |  | ✓ | 2026-01-01 | projected | 11.55368 |
| TBJ - FL | Florida Ops - PDC |  |  |  | ✓ | 2026-01-01 | projected | 11.55 |
| TBJ - FL | Fun $$$$ Allocated | ✓ |  | ✓ | ✓ | 2026-01-01 | projected | 28472.756 |
| TBJ - FL | Fun $$$$ Allocated | ✓ |  | ✓ | ✓ | 2026-06-17 | projected | 0 |
| TBJ - FL | Lunch |  |  |  | ✓ | 2026-01-01 | projected | 11.55368 |
| TBJ - FL | Lunch |  |  |  | ✓ | 2026-01-01 | projected | 23.11775 |
| TBJ - FL | Media Meals |  |  |  | ✓ | 2026-01-01 | projected | 16 |
| TBJ - FL | Media Meals |  |  |  | ✓ | 2026-06-16 | projected | 15 |
| TBJ - FL | MiLB G&G - Pantry |  |  |  | ✓ | 2026-01-01 | projected | 1.70396 |
| TBJ - FL | MLB - Catering |  |  |  | ✓ | 2026-01-01 | projected | 38 |
| TBJ - FL | MLB G&G - Pantry |  |  |  | ✓ | 2026-01-01 | projected | 1.70396 |
| TBJ - FL | Post Game Meal |  |  |  | ✓ | 2026-01-01 | projected | 23.11775 |
| TBJ - FL | Post-Game |  |  |  | ✓ | 2026-01-01 | projected | 16.50971 |
| TBJ - FL | Pre-Game |  |  |  | ✓ | 2026-01-01 | projected | 16.50971 |
| TBJ - FL | Scout Meals |  |  |  | ✓ | 2026-01-01 | projected | 11.55 |
| TBJ - FL | Snack |  |  |  | ✓ | 2026-01-01 | projected | 1.70396 |
| TBJ - FL | Stadium Staff Meals |  |  |  | ✓ | 2026-01-01 | projected | 16.50971 |
| TBJ - FL | Team Canada |  |  |  | ✓ | 2026-01-01 | projected | 11.55368 |
| TBJ - FL | Umpire |  |  |  | ✓ | 2026-01-01 | projected | 23.11775 |
| TBJ - NY | Breakfast |  |  |  | ✓ | 2026-01-01 | projected | 27.34 |
| TBJ - NY | Lunch |  |  |  | ✓ | 2026-01-01 | projected | 27.34 |
| TBJ - NY | Post-Game |  |  |  | ✓ | 2026-01-01 | projected | 27.34 |
| TBJ - NY | Shake |  |  |  |  | 2026-01-01 | projected | 0 |
| TBJ - NY | Snack |  |  |  |  | 2026-01-01 | projected | 0 |
| TBJ - NY | Umpire |  |  |  | ✓ | 2026-01-01 | projected | 27.34 |
| TBR - FL | AFTER HOURS MEALS |  |  |  | ✓ | 2026-01-01 | projected | 27.9491 |
| TBR - FL | AFTER HOURS MEALS |  |  |  | ✓ | 2026-06-16 | projected | 20.96183 |
| TBR - FL | B&G Lunch |  |  |  | ✓ | 2026-01-01 | projected | 6.5 |
| TBR - FL | Breakfast |  |  |  | ✓ | 2026-01-01 | projected | 35.62731 |
| TBR - FL | Breakfast - MiLB |  |  |  | ✓ | 2026-01-01 | projected | 17.8275 |
| TBR - FL | Breakfast - MiLB ST |  |  |  | ✓ | 2026-01-01 | projected | 23.77 |
| TBR - FL | Breakfast - MiLB ST |  |  |  | ✓ | 2026-06-16 | projected | 17.8275 |
| TBR - FL | Dinner |  |  |  | ✓ | 2026-01-01 | projected | 27.9491 |
| TBR - FL | Dinner |  |  |  | ✓ | 2026-06-16 | projected | 20.96183 |
| TBR - FL | Dinner |  |  |  | ✓ | 2026-01-01 | projected | 39.482 |
| TBR - FL | Extended Day labor | ✓ |  |  | ✓ | 2026-01-01 | projected | 280 |
| TBR - FL | Extra Protein - Beef/Seafood | ✓ |  |  | ✓ | 2026-01-01 | projected | 162.16712 |
| TBR - FL | Extra Protein - Beef/Seafood | ✓ |  |  | ✓ | 2026-01-01 | projected | 162.16712 |
| TBR - FL | Extra Protein - Chicken/Pork | ✓ |  |  | ✓ | 2026-01-01 | projected | 111.83796 |
| TBR - FL | Extra Protein - Chicken/Pork | ✓ |  |  | ✓ | 2026-01-01 | projected | 111.83796 |
| TBR - FL | Lunch |  |  |  | ✓ | 2026-01-01 | projected | 39.482 |
| TBR - FL | Lunch - MiLB |  |  |  | ✓ | 2026-01-01 | projected | 21.675 |
| TBR - FL | Lunch - MiLB ST |  |  |  | ✓ | 2026-01-01 | projected | 28.9 |
| TBR - FL | Lunch - MiLB ST |  |  |  | ✓ | 2026-06-16 | projected | 21.675 |
| TBR - FL | MLB - Extra MTO - Lrg | ✓ |  |  | ✓ | 2026-01-01 | projected | 15 |
| TBR - FL | MLB - Extra MTO - Med | ✓ |  |  | ✓ | 2026-01-01 | projected | 10 |
| TBR - FL | MLB - Extra MTO - Sm | ✓ |  |  | ✓ | 2026-01-01 | projected | 5 |
| TBR - FL | Road Sandwiches - MiLB |  |  |  | ✓ | 2026-01-01 | projected | 15 |
| TBR - FL | Umpire Meal |  |  |  | ✓ | 2026-01-01 | projected | 39.482 |
| TXR - AZ | Breakfast |  |  |  | ✓ | 2026-01-01 | projected | 35.72125 |
| TXR - AZ | Breakfast |  |  |  | ✓ | 2026-06-16 | projected | 28.577 |
| TXR - AZ | Breakfast |  |  |  | ✓ | 2026-01-01 | projected | 17.86575 |
| TXR - AZ | Breakfast |  |  |  | ✓ | 2026-06-16 | projected | 14.2926 |
| TXR - AZ | Continental Breakfast |  |  |  | ✓ | 2026-01-01 | projected | 8.2 |
| TXR - AZ | Continental Breakfast |  |  |  | ✓ | 2026-06-16 | projected | 6.56 |
| TXR - AZ | Dinner |  |  |  | ✓ | 2026-01-01 | projected | 35.72125 |
| TXR - AZ | Dinner |  |  |  | ✓ | 2026-06-16 | projected | 28.577 |
| TXR - AZ | Dinner |  |  |  | ✓ | 2026-01-01 | projected | 17.86575 |
| TXR - AZ | Dinner |  |  |  | ✓ | 2026-06-16 | projected | 14.2926 |
| TXR - AZ | Extra Protein - Beef/Seafood | ✓ |  |  | ✓ | 2026-01-01 | projected | 165 |
| TXR - AZ | Extra Protein - Beef/Seafood | ✓ |  |  | ✓ | 2026-01-01 | projected | 165 |
| TXR - AZ | Extra Protein - Chicken/Pork | ✓ |  |  | ✓ | 2026-01-01 | projected | 115 |
| TXR - AZ | Extra Protein - Chicken/Pork | ✓ |  |  | ✓ | 2026-01-01 | projected | 115 |
| TXR - AZ | Lunch |  |  |  | ✓ | 2026-01-01 | projected | 17.86575 |
| TXR - AZ | Lunch |  |  |  | ✓ | 2026-06-16 | projected | 14.2926 |
| TXR - AZ | Lunch |  |  |  | ✓ | 2026-01-01 | projected | 35.72125 |
| TXR - AZ | Lunch |  |  |  | ✓ | 2026-06-16 | projected | 28.577 |
| TXR - AZ | Pre-Game Hot Snack |  |  |  | ✓ | 2026-01-01 | projected | 13.66325 |
| TXR - AZ | Pre-Game Hot Snack |  |  |  | ✓ | 2026-06-16 | projected | 10.9306 |
| TXR - AZ | Regular Snack |  |  |  | ✓ | 2026-01-01 | projected | 7.3595 |
| TXR - AZ | Regular Snack |  |  |  | ✓ | 2026-06-16 | projected | 5.8876 |
| TXR - TX - H | Arrival |  |  |  | ✓ | 2026-01-01 | projected | 25.95422 |
| TXR - TX - H | Arrival |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| TXR - TX - H | Post BP |  |  |  | ✓ | 2026-01-01 | projected | 25.95422 |
| TXR - TX - H | Post BP |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| TXR - TX - H | Post-Game |  |  |  | ✓ | 2026-01-01 | projected | 25.95422 |
| TXR - TX - H | Post-Game |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| TXR - TX - H | Umpire |  |  |  | ✓ | 2026-01-01 | projected | 25.95422 |
| TXR - TX - H | Umpire |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| TXR - TX - V | Arrival |  |  |  | ✓ | 2026-01-01 | projected | 25.95422 |
| TXR - TX - V | Arrival |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| TXR - TX - V | Post BP |  |  |  | ✓ | 2026-01-01 | projected | 25.95422 |
| TXR - TX - V | Post BP |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| TXR - TX - V | Post-Game |  |  |  | ✓ | 2026-01-01 | projected | 25.95422 |
| TXR - TX - V | Post-Game |  |  |  | ✓ | 2026-06-16 | projected | 0 |
| TXR - TX - V | Umpire |  |  |  | ✓ | 2026-01-01 | projected | 25.95422 |
| TXR - TX - V | Umpire |  |  |  | ✓ | 2026-06-16 | projected | 0 |
