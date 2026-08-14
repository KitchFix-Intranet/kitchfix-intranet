# KPI V6 SPEC DELTAS - approved 2026-08-14 (Kevin)

Status: LOCKED. These deltas amend KPI_MASTER_BUILD_SPEC_LOCKED.md v1.8 for the v6 arc.
Visual oracle for the surfaces below: `kitchfix-kpi-v6.2-lock.html` (Kevin's LOCAL file - it
contains client figures and is NEVER committed to the public repo). v5 remains the oracle for
everything v6 does not touch: trend internals, table row anatomy, the nine states, the
dual-month calendar day grid, motion doctrine M1-M7.

Commit-safety rule for this document: no client dollar figures appear here. The render carries
the visuals; this document carries the norms.

## A. Command bar

- V6-1  Fiscal context reads `TODAY <MM/DD> | PERIOD <n> | WEEK <w>` where w = week-of-period
        (1-4) from the existing periods derivation.
- V6-2  `Copy link` and `Export` relocate from the rail QuickPanel to the command bar right,
        as labeled buttons with tooltips ("Copy a link to this exact view" / "Download this
        view as a spreadsheet"). Freshness chip unchanged, right of them. Export keeps the B3
        redact wiring driven by the Employee-display toggle (V6-13).

## B. Range control (Band 2 - the single time surface)

- V6-3  One Range button owns time: label `<selection> · <resolved dates>`. Opens a menu with
        three columns - PRESETS (This period, Last period, Last 4 wk, Last 13 wk, FYTD),
        FISCAL PERIODS (P1-P13 grid), MONTHS · <FY year> (only months containing fiscal
        weeks) - and a footer `Custom range...` that expands the EXISTING dual-month picker
        INLINE below the columns (same component/logic relocated; staged-only; Apply commits;
        Cancel/Escape collapses; outside-click closes menu and discards staging).
- V6-4  Selection semantics: preset -> existing relative resolution; period Pn -> that
        period's exact dates; month -> every fiscal week whose MONDAY falls inside that
        calendar month (weeks never split; date echo appends "· N fiscal wks"); custom ->
        arbitrary dates, Apply-gated. Single period / single month only in v6 (spans are
        backlog).
- V6-5  Grouping is IMPLIED by selection: month selection -> month grouping everywhere the
        table groups (headers `<MONTH> <year> · N fiscal wks`, month subtotals, jump chips as
        month labels); every other selection -> fiscal-period grouping. There is NO standalone
        group-by control. A one-line note under the table states the active grouping and that
        it follows the selection.
- V6-6  Right side of the band, one row: Workers pill, Views dropdown, primary `+ Save view`.
        Saved views serialize the full selection (type + value), including pseudo-account
        keys (V6-19).
- V6-7  URL contract unchanged (`start`/`end` ISO). Label derivation extends the resolvedPreset
        inference: exact period boundaries -> `PERIOD n`; exact month week-span -> `<MONTH>
        <year>`; else preset inference; else `CUSTOM RANGE`. Copy-link therefore reproduces
        the label without new params.
- V6-8  Persistence: last selection (type + value) remembered per B15 spirit
        (localStorage `kpi.range`), alongside last account.

## C. Hero

- V6-9  The resolved date range renders beside the hero label for EVERY selection (echo).
        Label vocabulary: preset names, `PERIOD n`, `<MONTH> <year>`, `CUSTOM RANGE`.
        Budget sub-line keeps Ruling C span + superseded marker unchanged.

## D. Definition system (cards, sections, containers)

- V6-10 New root tokens in tokens.css (additive, no --sc2-* touched):
        `--card-shadow: 0 1px 2px rgba(10,37,72,.06), 0 4px 12px rgba(10,37,72,.07);`
        `--card-shadow-hover: 0 2px 4px rgba(10,37,72,.08), 0 8px 20px rgba(10,37,72,.10);`
- V6-11 Metric cards: 1px `--n-300` border, `--card-shadow`, hover lift (translateY(-1px) +
        hover shadow; motion respects reduced-motion - state stays, transition zeroes), and a
        3px top accent: BUDGET cards navy gradient (`--navy-700` -> #3D6CB0), HOURS cards
        amber gradient (`--amber-600`-family). Section eyebrows: tinted chips `BUDGET` (navy
        tint) and `HOURS` (amber tint) + hairline rule to the right. The table container and
        every rail card share the same border+shadow grammar.

## E. Cards data-viz toggle

- V6-12 A `View: Numbers | Visual` segmented control sits on the BUDGET section row and
        governs BOTH card rows; persisted (localStorage `kpi.cardsView`). Visual mode adds a
        compact viz UNDER the number (number stays primary):
        Budget -> bullet bar (fill = spend/budget, tick = elapsed %); Over/under -> signed
        delta bar around a zero tick (green left = under, red right = over); Pace -> ring
        with % centered; Est. unpriced -> unchanged dash when nothing unpriced; Total hours ->
        stacked bar regular/OT/holiday; Budget in hours -> amber bullet worked-vs-budget;
        Overtime -> amber ring with share %; Unpriced -> unchanged.
        Envelope mode (TXR - TX - V) and missing-budget states suppress budget-family viz
        exactly as they suppress numbers today. All viz color+label+shape, never color alone.

## F. QuickPanel dissolution

- V6-13 The rail QuickPanel component is retired. Its jobs move: Copy/Export -> V6-2; the
        `N weeks · M worker-weeks` counts -> an `In view` row inside the data check card
        (V6-14); Hide-names -> a table-bar segmented control `Employee display: Names |
        Numbers only` (same state + same B3 export behavior).

## G. Rail

- V6-14 Coverage card renamed `PAYROLL DATA CHECK`. Content: `<complete> of <total>` +
        status badge + one plain-language sentence per dominant state:
        complete -> "Every shift in this range has priced hours. Nothing is missing from
        payroll." · partial -> "Some shifts are missing pay data - dollars for those weeks
        are incomplete." · hours_only -> "Hours are in, pay data has not landed yet." ·
        unknown -> "The data feed has not covered part of this range." · no_labor -> "No
        labor recorded in this range." Mixed ranges lead with the most severe present
        (unknown > partial/hours_only > complete). K3 vocabulary stands (Unpriced, Coverage
        stays as the internal term; the CARD title is the operator-facing rename).
        Plus the `In view` kv row (V6-13).
- V6-15 OT card: `OVERTIME WATCH · RANGE`, top-5 unchanged, caption "OT 1.5x hours in range ·
        watch for threshold creep."
- V6-16 Pipeline card: `Nightly data feed` + status badge; existing disclosure detail intact.
- V6-17 DEFECT: rail cards clip against the container's right edge at wide viewports. Root
        cause TBD in build; acceptance: no clipping 1024-2560px.

## H. Portfolio + regions (folio) - depends on PR-1 data

- V6-18 Folio order: `PORTFOLIO` eyebrow -> `All accounts` row; then `EAST · RDO <last
        name>` eyebrow + member accounts; then `WEST · RDO <last name>` + members. Member
        order preserved as today within each group. Salaried tags unchanged. RDO display
        names derive from the existing REGIONAL_DIRECTORS mapping (email -> known name).
- V6-19 Reserved pseudo-account keys, uppercase, colliding with nothing the account regex
        admits: `ALL`, `EAST`, `WEST`. URL: `?account=ALL` etc. Last-account persistence may
        store them.
- V6-20 Aggregate view semantics (ALL / EAST / WEST):
        - actuals: union of member hourly accounts' rows; hero/cards/trend/table sum by week.
        - budget: per-period sum of each member's RESOLVED budget (supersede layer applies
          per member first). TXR - TX - V is EXCLUDED from aggregate budget (envelope);
          when in scope, the budget sub-line carries a marker "excludes TXR - TX - V
          (envelope)". Salaried-only accounts contribute nothing by nature.
        - superseded marker shows if ANY member period is superseded; marker title lists the
          member accounts and reasons.
        - PAYROLL DATA CHECK aggregates counts across members; OT watch is top-5 across the
          union; Pipeline unchanged (global).
        - Table inline drill (K14) in aggregate mode drills a week into PER-ACCOUNT rows
          (account · hours by bucket · dollars) instead of per-worker rows. Export in
          aggregate mode includes an account column; redact rules unchanged.
        - CORP remains out of scope everywhere (D17).
- V6-21 Region source of truth: accounts region (HUB accounts sheet col T lineage). PR-1
        verifies where it lives NOW (PG accounts column vs Sheets-side) and either consumes
        the live source read-only or ships a gated migration seeding `accounts.region` -
        never a hardcoded guess. The folio never invents a grouping.

## I. Table bar

- V6-22 Jump chips render ONLY when the current grouping yields 2+ groups, prefixed with a
        small `JUMP TO` label; behavior (scroll + M7 landing tint) unchanged; month mode uses
        month labels.
- V6-23 `Employee display: Names | Numbers only` segmented control sits at the table bar
        right (V6-13).

## J. Responsive + states + gates

- V6-24 <=1023px: Range menu renders as a fixed full-width sheet (scrollable; grids wrap to
        3 columns); band wraps; folio becomes the existing horizontal strip with group
        eyebrows inline; cards 2-col; hero 32px (existing). 375px floor-first walk required.
- V6-25 The nine states are unchanged; the Range control persists through empty/error states
        (scope-band persistence already shipped). Aggregate pseudo-keys respect the same
        states (e.g., EAST with a range of nothing -> range-empty with Use FYTD).
- V6-26 Standing gates all persist (sentinel, brightness/font-mono/var-fallback zeros,
        phantom scan CLEAN, BUDGET_WK|_budgetWeekly zero, no user-facing "illustrative", no
        "over N weeks" hero phrasing). New for v6: zero remaining imports/renders of
        QuickPanel; jump-chip conditional covered in the preview walk; wide-viewport clip
        check (V6-17) in the walk battery.
