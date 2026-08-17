# KPI V7 SPEC DELTAS - THE WEEK TABLE - approved 2026-08-17

Status: LOCKED. Amends KPI_V7_SPEC_DELTAS_SHELL.md and KPI_V7_SPEC_DELTAS_BOARD.md. Visual
oracle: kitchfix-kpi-v9.1-table.html (Kevin's LOCAL file, contains client figures, NEVER
committed). Renders win on visuals; this document wins on behavior. Unchanged and NOT in
scope: budget resolution (playbook 4.5/4.6/8.2), the nine states, URL contract, export
behavior, the board above. Commit-safe: no client dollars below.

## A. Coverage becomes exception-only (V9-1..V9-3)

- V9-1  DELETE the Coverage column. A row in a healthy state carries no badge, no chip, no
        column. Complete is the silent default.
- V9-2  A row NOT in a complete state renders: a 3px amber left edge on the first cell, a warm
        row background, and a flag chip beside the row label naming the condition -
        `⚠ unpriced` (partial / hours_only), `⚠ not covered` (unknown), `no labor` (no_labor,
        muted grey not amber). Severity ranking when mixed: unknown > partial/hours_only >
        complete. K3 vocabulary stands.
- V9-3  A parent row summarizes its children's exceptions: `⚠ <n> sites unpriced` on an
        aggregate week, `⚠ <n> weeks unpriced` on a period band. The count is of affected
        children, never of dollars.

## B. Budget enters the table (SPEC ADDITION - server work) (V9-4..V9-7)

- V9-4  Every WEEK row, ACCOUNT row (aggregate), PERIOD band, and the TOTAL row carries a
        `vs budget` cell. Source: the labor route resolves budget per row and ships it -
        the client never divides a period budget itself.
        - week row budget = that week's weekly budget: the resolved period budget / weeks in
          that period (the same figure the board's "original" line uses).
        - account row (aggregate week) budget = that account's weekly budget for that week,
          resolved per member through 4.5 BEFORE summing.
        - period band budget = the resolved period budget.
        - total row budget = sum of the budgets of the rows it totals.
- V9-5  The cell is a fixed lockup so every row aligns: a 58px bar + a 72px right-aligned
        delta. The bar's budget tick sits at 80% of its width, leaving a 20% overflow zone;
        an over-budget row renders a red segment past the tick sized to the overage (capped
        at the zone, with the true figure in the delta text). Under = green fill.
- V9-6  Delta format is identical everywhere: `▼ $<amount>` under, `▲ $<amount>` over, whole
        dollars, tabular figures. The words "under"/"over" appear only in the `?` popover.
- V9-7  IN-PROGRESS periods are never given a delta against a full period budget. Their band
        and the total row (when the range is an in-progress period) read `<n>% used` with an
        elapsed tick on the bar. Closed periods and closed weeks get deltas. Accounts with no
        budget, envelope accounts (TXR - TX - V), and salaried-only accounts render the cell
        as a muted dash, never a zero or a fabricated delta.

## C. Row tiers and hierarchy (V9-8..V9-12)

- V9-8  PERIOD BANDS ARE DATA ROWS, not headers: each band renders the full numeric line
        (hours, OT, holiday/unpriced as applicable, dollars) plus its `vs budget` cell, so a
        collapsed period is a complete summary. Band styling: navy-100 background, navy-bd
        rules top and bottom, 12px/800 navy label, plus a light sub-label (`4 wks · budget
        $X` for closed, `in progress · n of m wks` for current).
- V9-9  RETIRE the "Period N subtotal" rows entirely - the band carries those numbers now.
- V9-10 WEEK rows: white, 40px, chevron, clickable to expand, hover tint. CHILD rows (workers
        or accounts): tinted ground, 46px left padding with a short connector tick, 12.5px.
        TOTAL row: navy-900 band, white text, sticky to the BOTTOM of the scroll container,
        labeled `TOTAL · <range description>` (e.g. `TOTAL · 4 PERIODS · 13 WEEKS`).
- V9-11 Period bands stick to the top of the scroll container directly beneath the sticky
        column header; the column header sticks at top 0. Both must hold at every viewport
        without overlapping.
- V9-12 Child sort order: worker rows and account rows sort by DOLLARS DESCENDING (B15's
        "no user sorting in v1" stands - this is the default order, not a user control).

## D. Cell content rules (V9-13..V9-17)

- V9-13 Worker rows show `#<employee number> <title>`; names appear only when the Employee
        display control is set to Names. NEVER render a name in any other surface. Account
        rows (aggregate) show `<account key> <team name>` from account metadata and are
        CLICKABLE - selecting one switches the dashboard to that account.
- V9-14 A worker row's `vs budget` cell is a muted dash - a worker has no budget. The worker's
        SHARE of the parent row's dollars renders as a hairline fill inside the DOLLARS cell,
        never in the vs budget column.
- V9-15 RATE column: blended rate (dollars / hours) rendered on EVERY row tier - period, week,
        child, total - not only on workers. Never hours x rate for dollars (D27).
- V9-16 OT surfacing: OT hours render in amber on any row where OT > 0; a week or child row
        containing OT carries a small `OT` tag beside its label. This replaces the retired OT
        Watch rail card.
- V9-17 ADAPTIVE COLUMNS: a column whose values are all zero/absent across the entire current
        range is not rendered (typical: Holiday 2x, Unpriced). The `?` popover states the
        rule. Column set per view: single account = Week / vs budget / Hours / OT / Rate /
        Dollars; aggregate = Week / vs budget / Hours / OT / Unpriced / Dollars. Empty values
        inside a rendered column show a light `–`, not a heavy em-dash.

## E. Chrome around the table (V9-18..V9-20)

- V9-18 Control bar, one 32px baseline: JUMP TO label + period chips (conditional per V6-22)
        + Expand all / Collapse all on the left; Workers filter, Employee display segmented
        control, and a single `?` help control on the right.
- V9-19 ALL prose notes move OUT of the table body into that `?` popover: coverage meaning,
        D27 dollars provenance, the vs-budget basis, the adaptive-column rule, and (aggregate
        only) the per-account drill explanation. No italic sentence rows inside the data.
- V9-20 Density control (Comfortable 40px / Dense 30px rows) sits with the table controls and
        persists; it governs the table only, not the board.

## F. Cross-cutting (V9-21..V9-23)

- V9-21 Month grouping (V6-5) still applies: in month mode the bands are months and their
        budget is the sum of the weekly budgets of the weeks the month owns.
- V9-22 States: an empty range renders the existing range-empty state, not an empty table
        shell. A partial-coverage range never blocks the table - it flags rows.
- V9-23 Gates persist and add: zero "subtotal" row components, zero Coverage-column
        references, zero prose note rows inside tbody, zero worker names outside the
        Names-mode path.
