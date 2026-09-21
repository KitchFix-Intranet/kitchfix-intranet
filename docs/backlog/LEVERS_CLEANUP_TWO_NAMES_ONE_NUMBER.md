# Retire `payload.levers` · one name for one number

**Filed:** 2026-09-04, from Prompt 1 (period-budget-and-bands) diagnosis round.
**Status:** Deferred. Not scheduled.
**Trigger to unpark:** when nothing else is in flight on the Overview
resolver. Not to be bundled into a PR whose subject is elsewhere.

---

## Why this exists

The Overview payload emits two arrays that carry the same subset of
cost-lever information under two different names:

- `payload.levers[i].budget` - full period budget for the cost lever
  (3100 / 3200 / 3400 / 3500). Built at
  `src/lib/kpi/overview/resolver.js:1556-1586` (`buildLever`).
- `payload.statement_rows[j].period_budget` - the same figure on the
  parent lever row. Built at
  `src/lib/kpi/overview/resolver.js:2113` inside `buildCostRow`.

**Same number, two names, no comment tying them together.** On TBJ - FL
P9 both read `18,104.29` for 3200 today. A caller looking for "the
period budget on the food lever" finds it under whichever surface they
happen to be reading:

- `payload.levers[1].budget` -> 18104.29 (the levers view)
- `payload.statement_rows.filter(r => r.line_code==="3200")[0].period_budget` -> 18104.29 (the statement-rows view)

Reading the wrong one returns `undefined`, which JS coerces to `0`
under numeric ops - and `0` on a budget number reads like "there is no
budget," which was the failure mode that spent both Kevin's and CC's
time on 2026-09-04. **That is the reason to consolidate, not tidiness.**

## The scope

`payload.levers` is a redundant projection of what `statement_rows`
already carries for the same four line codes (3100/3200/3400/3500).
Every field on a `levers[i]` entry has an equivalent on the matching
statement_row - actual, budget (as `period_budget`), variance,
actual_pct, target_pct, envelope_delta, budget_at_this_revenue - the
schemas overlap almost entirely. The lever's `budget_display` and
`actual_display` are the only fields without a statement-row equivalent
(they're pre-formatted strings for a card render that no longer uses
them).

**Consumers of `payload.levers` today** (confirmed 2026-09-04):

- UI components under `src/app/**` - **zero**. Nothing on any board
  renders `payload.levers`.
- Probes - **three**, all standing:
  - `scripts/probes/_probe_overview_parity.mjs` - reads
    `ov.levers[3100].actual` and `.budget`
  - `scripts/probes/_probe_overview_same_horizon_target_pct.mjs` -
    reads `d.levers[*].target_pct`
  - `scripts/probes/_probe_target_honesty.mjs` - reads `j.levers`

## Why this is a separate PR

Migrating the three probes to read `statement_rows` while another PR
touches the resolver means the safety net moves at the same time the
thing it protects is being changed. That is exactly the situation
probes exist to catch. Sequence:

1. **Wait for nothing else in flight on Overview resolver.**
2. Migrate each probe one file at a time: replace
   `ov.levers.find(l => l.line_code === "3100")` with
   `ov.statement_rows.find(r => r.section === "cogs" && r.line_code === "3100" && !r.parent_line_code)`
   and swap `.budget` for `.period_budget`.
3. Run the full probe battery, confirm all three green against the
   current payload shape.
4. Delete the `buildLever` function + the `levers` array + the
   `levers,` entry from the resolver's return.
5. Assert `payload.levers === undefined` in a smoke test.
6. Ship.

## What to name in the commit

**Not "code cleanup" or "remove dead projection."** The reason is a
diagnostic-time cost: a caller reading `l.period_budget` on a levers
entry gets `undefined` because the field is `l.budget`, and `undefined`
looks like `0` under coercion, and `0` on a budget field looks like
"no budget," and the ensuing round trip is the whole cost. Commit
message should say what the naming inconsistency cost.

## Cost estimate

Small. Three probes, one resolver deletion. Two hours if the probe
battery is stable. Half a day if any probe is stale for other reasons
and needs its own fix first.

## Related

- Prompt 1 (`CC_PROMPT_PERIOD_BUDGET_AND_BANDS.md`) diagnosis 2026-09-04 -
  where the two-names-one-number pattern was named for the first time.
- No open issue; file this note as the record.
