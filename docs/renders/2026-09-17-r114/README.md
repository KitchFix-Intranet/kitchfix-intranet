# R-114 PR 1 · overview cards + cost table · display fixes

Full-page 1440 screenshots for the display fixes shipped in PR 1.

**Date captured:** 2026-09-17
**Branch:** feat/r114-cards-display
**Captured by:** scripts/probes/r114-screenshots.mjs (Playwright 1440x900, fullPage)

## Files

| account | range | dates | file |
|---|---|---|---|
| TBJ - FL | Current year (CY) · P1-P9 | 2025-12-29 to 2026-09-06 | `TBJ_-_FL__CY_p1-p9.png` |
| TBJ - FL | Last period (LP) · P9 | 2026-08-10 to 2026-09-06 | `TBJ_-_FL__LP_p9.png` |
| TBJ - FL | Current period (CP) · P10 | 2026-09-07 to 2026-10-04 | `TBJ_-_FL__CP_p10.png` |
| TBJ - FL | Next period (NP) · P11 | 2026-10-05 to 2026-11-01 | `TBJ_-_FL__NP_p11.png` |
| TBR - FL | Current year (CY) · P1-P9 | same | `TBR_-_FL__CY_p1-p9.png` |
| TBR - FL | Last period (LP) · P9 | same | `TBR_-_FL__LP_p9.png` |
| TBR - FL | Current period (CP) · P10 | same | `TBR_-_FL__CP_p10.png` |
| TBR - FL | Next period (NP) · P11 | same | `TBR_-_FL__NP_p11.png` |

## What to look for

- **LP** shows the fixed COGS + GM cards: two-decimal percent, navy Adjusted row, `?` tooltip carrying the Plan line, GM pill on the dollar anchor (BEHIND TARGET on TBJ - FL P9, matching the footer).
- **CY** shows the same fixes on the FYTD range plus the cost table total row's Target % column reading the adjusted-over-actual percent.
- **CP** renders the R-109 Current period table (unaffected by items 1-5 except for the two-decimal rule on the "of planned revenue" caption).
- **NP** renders the R-110 planning view.
