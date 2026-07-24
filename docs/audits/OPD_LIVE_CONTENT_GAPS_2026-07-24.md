# OPD Live-content gaps - 2026-07-24 follow-up

This is a tracking document for the 20 documents PR #514 (`fix(opd): sync MDX status and access_level to PG`) had to exclude from the sync.

All 20 are currently `status='Live'` in PG (Kevin flipped them in the cockpit). Their MDX still says `In Build`. Syncing the MDX to `Live` would surface pre-existing content gaps that `scripts/content/validate.mjs` treats as errors, which then halts `project-catalog.mjs --apply`.

The DB `chk_live_complete` CHECK constraint (`version` + `card_line` non-null) is satisfied on all 20. Only the extended pre-projection layer blocks them.

## Group 1 - legal-class docs missing `approval:` frontmatter block

The extended `chk_live_complete` in `validate.mjs` requires POL and AGR Live docs to carry an `approval:` block (approver + date, at minimum). These 16 docs are Live in PG but lack it.

| id | title |
|---|---|
| AGR-002 | Laptop Acceptance Agreement |
| POL-001 | Employee Concerns Policy |
| POL-002 | Appearance & Dress Code Policy |
| POL-004 | Attendance & Punctuality Policy |
| POL-006 | Anti-Harassment Policy |
| POL-006-ES | Politica contra el Acoso |
| POL-007 | Compensation & Pay Increase Policy |
| POL-008 | Wage & Hour Policy |
| POL-009 | IT & Acceptable Use Policy |
| POL-010 | EEO, Non-Discrimination & Accommodation |
| POL-011 | Anti-Retaliation / Whistleblower |
| POL-013 | Employee Classification & Seasonal Workforce |
| POL-014 | Code of Conduct & Ethics |
| POL-015 | Leave Policies |
| POL-019 | Permit & License Compliance Policy |

**Fix**: add an `approval:` block to each frontmatter with counsel/HR/SLT signoff detail. Then their MDX can flip to `Live` and rejoin the sync.

## Group 2 - REC/REF docs with 'TBD' body tokens

The `number_hygiene` check in `validate.mjs` flags Live docs whose body contains `TODO|TBD|XXX|<KEVIN>|<AUDIT>|[placeholder]`. These 5 docs have 8 total lines with the literal token `TBD` in prose.

| id | title | offending lines |
|---|---|---|
| REC-101 | CIN-AZ (Cincinnati Reds, Goodyear AZ) | 1 |
| REC-110 | TXR-TX-H (Rangers MLB home) | 1 |
| REC-111 | TXR-TX-V (Rangers visiting-team) | 1 |
| REF-123 | Contract Digest - CIN-KY | 3 |
| REF-140 | Money Model - Service Calendar Billing Mechanics | 2 |

**Note on the assumption audit**: the earlier assumption-rulings review (2026-07-23) already ruled some of these `TBD` mentions were legitimate (e.g. contract-quoted TBD in REF-123, historical drift notes). If they are genuinely legitimate, the fix is either to reword them so `number_hygiene` does not flag them, or to loosen the `number_hygiene` rule (e.g. skip `TBD` inside verbatim `>` blockquotes, or match only isolated markers rather than TBD appearing in prose).

**Fix**: either rewrite the offending lines to remove the token, or adjust `number_hygiene` in `scripts/content/validate.mjs` to be quote-aware.

## After this is resolved

Once the 16 approval blocks are added and the 5 number_hygiene issues are cleared, a second sync PR can flip the last 20 MDX files to `Live` to close the divergence completely (POST-002 excepted - Kevin's standing exclusion).

The DB will accept the writes; PG is already Live for all 20. The follow-up is purely about the extended validator's health.

## Owner

Kevin.

## Related

- PR #514 - the 53-doc sync that landed the clean half.
- `docs/audits/OPD_STATE_REPORT_2026-07-24.md` - the audit that surfaced the drift.
- STD-004 v1.3 - the overlay-preservation callout that documents why this drift is expected.
