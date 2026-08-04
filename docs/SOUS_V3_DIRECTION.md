# Sous v3 - direction

> Written 2026-08-04 at v2.0 close-out, while the reasoning is fresh.
>
> This is not a plan. It is a direction, with the ceiling v2.0 hit stated
> plainly, and a proposed shape for how the next stage crosses it.

## The ceiling v2.0 hit

**The tools are a hand-written menu.** One tool per question shape.
`sc_account_window` for "one account, one window." `sc_portfolio_window`
for "all accounts, one window." `sc_homestand_detail` for "one account,
one homestand." `spend_summary` for "spend at an account or vendor over
a window." Thirteen tools total, each covering a specific slice of the
question space.

Questions that fit a listed slice work. Questions that need an unlisted
dimension become unaskable - and in v2.0, unaskable becomes confident
wrong.

Three independent instances of this in production:

1. **Breakfast per account, February.** The single-account tool worked,
   but there were 11 accounts and the budget was 14 tool calls. The
   loop fanned out, exhausted the budget at six accounts, and shipped
   partial. **Fix landed in v2.0:** `sc_portfolio_window`.

2. **Day-level counts for TXR - AZ this period.** The homestand tool
   requires `has_homestand_schedule=true`. TXR - AZ is PDC and has no
   homestand rows. The tool returned nothing; the model reported the
   data did not exist. **Mitigated in v2.0:** L3 preconditions in the
   prompt (Round 1 Part A of #622) tell the model to route to
   `sc_account_window` when the homestand tool structurally does not
   apply.

3. **Major League service group revenue at TBR - FL, season to date.**
   No tool exposes service groups. No tool aggregates across periods.
   The model saw two empty tool results and answered "Major League
   service does not exist at TBR - FL." Ground truth: 11,311 meals
   and $424,778.78 season to date, visible in the Service Calendar's
   day-entry modal. **Rule added in v2.0:** sanctioned line 12 +
   hard-floor rule 8 forbid publishing "this does not exist" as an
   answer; the model must say what it CAN see and route to the
   surface that has the rest.

The rule prevents the confident wrong answer. It does not add the
missing dimension. **A user who asks a group-split question still
gets "I can't see that from here" - just now, honestly.**

## Why financials make this worse

The KPI engine (`kpi-1-spine` + `kpi-8a` at the current commits)
adds financial measures - labor cost, revenue, contribution margin,
per-cover contribution, cost variance. The question space becomes
**combinatorial**: any measure x any account x any period x any
grouping (service group, service type, day, phase) x any comparison
(vs prior period, vs projection, vs budget).

The v2.0 tool inventory has 13 tools. A hand-written tool per
question shape scales to roughly the number of tools you are willing
to write, review, and maintain. The financial question space blows
past that number in the first sprint. Every unlisted combination
becomes a "I can't see that from here" answer, which is honest but
useless.

**Growing the tool menu is not the fix.** The fix is a semantic
layer.

## The proposed direction

**Sous queries through the KPI engine's resolver rather than growing
a parallel tool menu.**

Three consequences to record now, so the direction stays intact
through the v3 build:

1. **Coverage becomes a model question rather than a menu question.**
   The KPI resolver knows what measures exist, what dimensions each
   measure supports, and which combinations are legitimate. Sous
   asks "measure X, filtered by dimension Y at value Z, grouped by
   dimension W, for window V" and the resolver either returns a
   number or returns a structured "unknown dimension" / "unsupported
   combination" answer. The model does not have to be pre-taught
   which combinations exist; it discovers via the resolver at query
   time. Adding a new measure or a new dimension is one place -
   the resolver - not thirteen tools + a prompt update + a spec
   revision.

2. **Sous and the dashboard can never disagree because they share
   one source of truth.** Today, if a dashboard shows one revenue
   number and Sous says a different revenue number, the operator
   has to figure out which to trust. Under the resolver, both
   surfaces read the same resolved value. Discrepancy is impossible
   by construction.

3. **A semantic layer knows its own dimensions, so "unknown
   dimension" is detectable and "I cannot see that" becomes
   structurally honest** rather than a prompt rule we hope holds.
   The v2.0 rule (line 12 / rule 8) is the right rule but it lives
   in the prompt, which means enforcement is model discipline. In
   v3, when a question needs an unavailable dimension, the resolver
   itself returns the "unknown" shape; the model does not have to
   choose between honesty and helpfulness. The routing becomes
   mechanical.

## A note for whoever designs the resolver

**Design it as *the* data access layer, not the dashboard's data
layer.** The KPI engine currently sits under the dashboard - it
was built to feed metric tiles. That is fine as a starting point,
but the resolver is the more valuable primitive. Sous consuming
it later is the v3 unlock and costs nothing to allow for now.

Concretely, when you decide the resolver's public shape:

- Make the input a structured measure + dimension request, not a
  SQL string or a pre-baked query name. `{measure: "actual_revenue",
  dimensions: {account: "TBR - FL", service_group: "*", period: "*"},
  window: {start: "2026-04-01", end: "2026-08-04"}}` is composable;
  a hand-written `getMLBRevenueAtTBRFL()` is not.
- Return the "unknown dimension" case as data, not an exception.
  `{status: "unknown_dimension", requested: "service_group",
  available: ["account", "period", "service_type"]}` gives the
  model something to route with. A thrown error forces the caller
  into a try/catch and loses the routing information.
- Document the resolver's boundary clearly: what it can compute,
  what it explicitly cannot, and the shape of "cannot." Sous will
  cite this documentation in its structural-decline answers.

## The deferred backlog

Carrying forward from the roadmap so nothing is lost:

**Selected but not built:**
- **E5** length matches the question (short answers for short asks)
- **E6** declines offer the nearest thing rather than an empty
  refusal
- **E9** confidence gradient (currently binary grounded / partial;
  four bands would help calibration)
- **E7** source cards ordered by contribution
- **E8** entity memory beyond three turns
- **A5** sources-only toggle (skip the answer text, just show cited
  docs)
- **E12** real side-by-side comparison
- **A3** recently updated documents feed
- **F4** Sous in Slack (its own project - explicitly not before the
  demo; puts Sous in front of the whole team, the opposite of the
  solo gate)

**Deferred engine and logic items:**
- **N1** hybrid retrieval (biggest quality lever, most destabilising -
  do after the resolver rollout with time to test)
- **N2, N5, N6, N8, N9, N10, N12** (indexing / chunking / retrieval
  tuning)
- **L1, L2, L4** (do the next time the grader is touched anyway),
  **L5, L8, L9, L10, L11**

**Parked freedom bucket** (twelve items in "what if Sous could ...").
Most are v3 or later.

**X3 (contract intelligence) is the strongest** of the freedom
bucket - it plausibly finds money rather than saving time. Kept warm.
Everything else in the bucket is parked without a slot.

## What v3 does not do

- No new dashboard. The dashboard is a client of the resolver, not
  the resolver.
- No prompt-only fixes for missing dimensions. The v2.0 rule (line 12
  + rule 8) is the terminal prompt-side mitigation; further "just
  tell the model to be honest about visibility" ideas are variations
  on that rule and will not add new dimensions.
- No parallel Sous rewrite. The runtime backstops, the L12 self-
  check, the receipt module, the surface, the harness - all of them
  ship into v3 unchanged. Only the tool inventory + the retrieval
  layer + the semantic layer change.
