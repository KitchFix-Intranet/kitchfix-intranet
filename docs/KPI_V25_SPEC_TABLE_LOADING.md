# KPI V25 SPEC - table corrections + loading states - approved 2026-08-17

Status: LOCKED. Amends KPI_V7_SPEC_DELTAS_TABLE.md (V9-1..V9-23). Reference renders (Kevin's
LOCAL files, layout intent only, never committed): kitchfix-kpi-v23-table.html,
kitchfix-kpi-v24-control-bar.html. Where a render and this document disagree, this document
wins. Commit-safe: no client dollars.

## A. P0 - the aggregate compares different account populations (V25-1..V25-3)

Verified live on 2026-08-17: the portfolio sums ELEVEN accounts of actuals against TEN accounts
of budget, because V6-20 correctly excludes the envelope account TXR - TX - V from the
aggregate budget while its actuals are still included. FYTD this overstates spend by
$49,567.32 and per period by roughly $10k-$25k, which is why seven of eight closed periods
render as over budget.

- V25-1  OWNER RULING: exclude TXR - TX - V from BOTH sides of every aggregate. Aggregate
         actuals, hours, OT, unpriced, worker counts, rate and dollars all cover the same ten
         accounts as the aggregate budget. This applies to ALL, EAST and WEST, on the board,
         the table and the export.
- V25-2  The excluded account is never hidden. In the aggregate week drill it still renders as
         a row with its own spend and hours, its vs-budget cell reads `not budgeted` in muted
         text (never a zero, never a grey bar), and its dollars are visibly outside the
         roll-up. A one-line scope note sits above the table: `Portfolio figures cover N
         accounts. TXR - TX - V is envelope-based and is excluded from both spend and budget so
         the two sides compare like with like.` The total row label carries the count:
         `TOTAL · <range> · N ACCOUNTS`.
- V25-3  A probe assertion, permanent: for any aggregate range, the sum of member actuals used
         in the roll-up equals the sum of actuals for exactly the accounts whose budgets are in
         the roll-up. Populations must match by construction, not by convention.

## B. P0 - expand/collapse state is unstable (V25-4)

- V25-4  Reported and reproducible: `Collapse all` does not collapse, and the first group stays
         open unless a later group is toggled. The signature - state responding only when a
         DIFFERENT row is touched - indicates expansion is keyed by array index or position
         rather than by a stable identity, so the map goes stale whenever the group list is
         rebuilt. Key expansion state by a STABLE identity (period number, or the group's
         start date), never by index. `Expand all` and `Collapse all` set every key
         explicitly rather than toggling. Acceptance: collapse all from any mix of open and
         closed groups leaves zero groups open, first group included; expand all opens every
         group including the first; the state survives a range change that keeps the same
         groups.

## C. Table corrections (V25-5..V25-11)

- V25-5  ACCOUNT ROWS CARRY THEIR OWN BUDGET. Every aggregate account row renders the full
         vs-budget lockup - bar plus signed delta - resolved per member per V9-4. A row with no
         budget renders muted text stating why (`not budgeted`), never a pale empty bar, which
         reads as zero.
- V25-6  THE SHARE MARK MOVES OUT OF THE DOLLARS CELL into its own narrow column headed
         `Share`. Under the figure it reads as a text-decoration artifact. Column width about
         52px scaled; bar at 55% opacity, full opacity on row hover.
- V25-7  EXCEPTION MARKING BELONGS TO THE ROW THAT OWNS IT. The amber left edge and warm row
         tint apply only to the row carrying the exception. Ancestor rows summarise with the
         count chip alone (`⚠ 2 sites unpriced`) and take no edge and no tint. Today two
         problems light up four rows.
- V25-8  THE TOTAL ROW. Background `--navy-900`. Label populated and never empty:
         `TOTAL · <range description>` plus the account count on aggregates. ALL numeric cells
         and the label render `#FFFFFF` at weight 800 - the total is the most legible row on
         the page, not the least. The vs-budget delta uses on-navy tints, `#8BE0A4` under and
         `#FCA5A5` over, and its bar renders at full opacity. Report the computed colour of the
         total row's cells as a receipt; "looks white" is not acceptable.
- V25-9  ADAPTIVE COLUMNS MUST ACTUALLY FIRE (V9-17). `Holiday 2x` currently renders as a full
         column of dashes on ranges with no holiday hours. Compute the drop per range, not per
         row, and report which columns were dropped for the walked ranges.
- V25-10 THE CHILD CONNECTOR IS A RAIL, NOT A GLYPH. Rows currently read `- TBR - FL`, and a
         leading dash is ambiguous in a table full of signed deltas. Use indentation plus a
         1px vertical rail.
- V25-11 One vs-budget lockup at EVERY tier - the bar and the delta occupy fixed widths so the
         column reads as a single column down the page. The period band's `22% used` currently
         sits at a different x than the week rows' deltas.

## D. The control bar (V25-12)

- V25-12 Rebuild to one rhythm, per the v24 render:
         - ONE control height for everything on the bar (28px scaled) and one radius (7px).
           Today four heights coexist: chips 26, buttons 28, segmented 30, help 22.
         - Labels 9.5px/800 tracking .09em uppercase in `--n-500`, with line-height matched to
           the control height so they centre against what they label.
         - TWO gap values only: 6px inside a group, 18px between groups. Hairline rules
           (1x16px `--n-200`) separate the right-hand display cluster.
         - Groups, left to right: [Jump to + period chips] [Expand all / Collapse all] ...
           [Workers] | [Show: Names/Numbers] | [Rows: Comfortable/Dense] | [?]
         - Period chips are equal-width tiles with a minimum width so `P9` and `P1` match.
         - The Workers control loses its pill shape and joins the button family.
         - `Density` is relabelled `Rows`.

## E. Loading and refresh states (V25-13..V25-17)

Measured on 2026-08-17 during an in-app account switch: page height collapses 1357 -> 671 and
rebounds to 1285 in under a second; the entire main column is replaced by one 470x52px card
holding three grey lines; the Range control and the SYSTEM strip unmount and remount.

- V25-13 NO LAYOUT COLLAPSE. During any refetch the main column holds at least its last-known
         height. The measured swing must be under 40px across a range change or an account
         switch, and the scroll position must not jump.
- V25-14 CONTROLS NEVER UNMOUNT. The Range control, the Section control, Export, the folio and
         the SYSTEM strip remain mounted and interactive through every fetch. Only their values
         go quiet. The freshness chip switching to `Loading data` is the loading signal and is
         sufficient.
- V25-15 WARM NAVIGATION DOES NOT SKELETON. When a board is already rendered and the user
         switches account or range, keep the previous content in place at reduced opacity
         (about 0.45) with the loading chip active, and swap when data lands. A skeleton is for
         a COLD start only - first paint with nothing to show.
- V25-16 THE COLD SKELETON MIRRORS THE LAYOUT: a spend-card block, four signal-card blocks, a
         numbers strip block and about six table rows, each at its real height, so the skeleton
         promises the shape that is coming. One small card standing in for an entire board is
         not a skeleton, it is a placeholder.
- V25-17 Reduced motion: no shimmer animation when the user prefers reduced motion - a static
         tint carries the same meaning.

## F. Default expansion (V25-18)

- V25-18 Multi-period ranges open COLLAPSED. The collapsed period view is the most useful read
         in the table and is currently reachable only by collapsing by hand. Single-period
         ranges continue to open with their weeks visible.

## G. Employee-display state must announce itself (V25-19)

Context: on 2026-08-17 the table appeared to have "lost" worker names. Root cause was not a
defect - the view was in Numbers mode, carried by `redact=1` in the URL after the toggle was
clicked in a prior session. The payload had `display_name` on every worker throughout. The
finding is that the state is too quiet: the owner looked at a nameless table and reasonably
concluded something had broken.

- V25-19  When Employee display is set to Numbers, the table states it where the names would
          be, not only in the toggle at the far right of the control bar:
          - the WEEK column header (or the worker-drill sub-header) carries a small neutral
            chip reading `Names hidden`, clickable to restore;
          - the chip uses the neutral grey state treatment, not amber - hiding names is a
            deliberate choice, not a warning;
          - the chip appears only when worker rows are actually visible, so a collapsed table
            does not carry it.
          Persisting the choice in the URL is correct and stays - a copied link must reproduce
          the exact view, including redaction - but the receiving user has to be able to see
          why the names are absent.
