# KPI labor table: move text-colour ownership from row to cell

**Filed:** 2026-08-24, from three rounds of specificity war on `.kpi-tbl-nil`.
**Status:** Deferred. Not scheduled.
**Trigger to unpark:** the next specificity contest on a table-cell rule
(colour, weight, or otherwise) surfaces on this table. If the fix is
"bump the selector's class count until it wins," that is the tell that
this refactor should land instead.

---

## What the current shape is

Row rules in `src/app/kpi/kpi.css` set `color` on their `> td`
children:

- `.kpi-tbl-band > td { color: var(--n-900); font-weight: 800 }` (spec 0,1,1)
- `.kpi-tbl-band.kpi-tbl-band-open > td { color: var(--navy-700) }` (spec 0,2,1)
- `.kpi-tbl-band:has(> td .kpi-tbl-bandbtn[aria-expanded="true"]) > td { color: var(--navy-700) }` (spec ~0,4,2)
- `.kpi-tbl-week > td { color: var(--n-800); font-weight: 600 }` (spec 0,1,1)
- `.kpi-tbl-child > td { color: var(--n-700) }` (spec 0,1,1)
- `.kpi-tbl tbody .kpi-tbl-total > td { color: #FFFFFF; font-weight: 800 }` (spec 0,3,1)

Cells inside those rows inherit the row's colour by default, and any
cell that wants to render differently (a muted em-dash placeholder, an
amber OT chip, a red overrun delta) has to name a selector that BEATS
the row rule at every combination the row rule can take. Missing one
combination means the cell silently paints at the row's colour and no
runtime error fires.

## Why it keeps costing rounds

The `.kpi-tbl-nil` em-dash placeholder needed three passes to actually
render at `var(--text-subtle)` on every row level. Each pass got the
"looked right in source" part correct and lost at runtime because a
row-level rule ranked higher:

1. **First pass** (2026-08-24 contrast sweep, PR #789):
   `.kpi-tbl-nil { color: var(--text-subtle) }` at spec 0,1,0. Lost
   to every row rule.
2. **Second pass** (PR #791): `.kpi-tbl tbody td.kpi-tbl-nil` at
   0,2,2. Beat non-open-band rows, tied `.kpi-tbl-band-open > td` at
   0,2,1 but won on source order. Lost the class-count comparison to
   `.kpi-tbl-band:has(> td .kpi-tbl-bandbtn[aria-expanded="true"]) > td`.
3. **Third pass** (PR #792): selector list of three shapes -
   base + class-shim + `:has()` twin - each meeting or beating its
   competitor. Actually landed.

Each pass matched the rule's target correctly and lost anyway. The
common failure mode was the mental model: "row sets tone, cell
overrides." The rule set has FIVE row rules setting colour on td
children, plus a `:has()` defensive twin, plus a total-row override -
seven contexts a cell rule must survive. Every future cell-level
colour rule inherits the same contest.

## What the cleaner shape would be

Invert the ownership: **rows own structure, cells own colour**.

Concretely:

- Strip `color:` from `.kpi-tbl-band > td`, `.kpi-tbl-band.kpi-tbl-band-open > td`, `.kpi-tbl-band:has(...) > td`, `.kpi-tbl-week > td`, `.kpi-tbl-child > td`.
  (Keep `background`, `border`, `font-weight`, `font-size` - those are structural to the row's tier.)
- Give every td class an explicit colour: the label cell already has
  `.kpi-tbl tbody td:first-child { color: var(--n-900) }`; numeric
  cells need their own. Candidate hooks: the `num` class on numeric
  tds today (WeekTable.js applies `className={`num ...`}` on every
  numeric cell) becomes the colour anchor: `.kpi-tbl-band td.num`,
  `.kpi-tbl-week td.num`, `.kpi-tbl-child td.num` each set colour
  explicitly. The band-open variant re-colours the same way.
- `.kpi-tbl-nil` then drops back to `.kpi-tbl-nil { color:
  var(--text-subtle); font-weight: 400 }` at spec 0,1,0 and wins,
  because no row rule is fighting it - the `num` rule is at the same
  or lower spec than a chained `.num.kpi-tbl-nil` would be.

## Cost

- Rewrite ~5 row rules + author ~15-20 explicit cell colour rules
  (band label, band num, band-open label, band-open num, week label,
  week num, child label, child num, total label, total num, plus the
  `:has()` twins).
- One PR against a well-tested surface. Every change is visible on the
  ALL portfolio period board, so live verify per row level is cheap.
- Playwright `getComputedStyle` probe already exists
  (`tests/kpi-tbl-nil-computed-style.spec.ts`) - extend to cover
  every numeric cell class at every row level so the refactor lands
  with a regression net.

## Why not now

Three-pass contest on ONE placeholder class was the visible symptom.
Nothing else on the table is fighting today; every existing cell rule
either wins or was already lost silently and hasn't been flagged.
Doing this refactor speculatively risks changing colours that nobody
asked to change. Waiting for the next specificity-war signal costs
one round on that next cell rule but keeps the refactor focused when
it lands.

## Related

- PRs #789, #791, #792 - the three rounds.
- `src/app/kpi/kpi.css:2857` - row rules start here.
- `tests/kpi-tbl-nil-computed-style.spec.ts` - existing probe pattern
  to extend.
