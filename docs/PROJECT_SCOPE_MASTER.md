# PROJECT SCOPE MASTER - KitchFix Ops Hub

**Status:** LIVING. This is the alignment surface for every session, both Claude seats, and every arc.
**Target path in repo:** `docs/PROJECT_SCOPE_MASTER.md`
**Version:** v1.1
**Authored:** 2026-08-06 (Chat-Claude, from live repo `main` at `d286291` plus the 2026-08-05 handoff pack)
**Last updated:** 2026-08-06 v1.1 - Sebastian process notes received and reviewed; see change log
**Owner:** Kevin Fietek. Nothing in this doc is amended without his ruling.

---

## 0. How this doc works (the maintenance law)

**This doc points to depth. It does not contain depth.** Every section is a
current-state summary plus a link to the canonical deep doc. When a section
starts growing paragraphs of history, that history belongs in the deep doc or
the PR trail, not here.

**Hard rule:** if this file cannot be read top to bottom in ten minutes, it has
failed. `docs/PROJECT_DASHBOARD.md` broke this exact rule (it opens with a
"if this file grows past ~2 screens, something belongs in a linked doc" banner
and then runs a single unbroken paragraph of roughly 400 lines). Do not repeat
that failure here.

**Update triggers.** Update this doc when, and only when, one of these happens:

| Trigger | What changes |
|---|---|
| An arc opens or closes | §6 Forward scope |
| A PR merges that changes system state | §4 or §5, one line |
| Kevin issues a ruling | §8 Standing rulings register |
| A new migration applies in Studio | §5.3 migration index |
| A doc is found to disagree with the repo | §9 Drift register |
| A question gets answered | §10 Open decisions |
| Anything else | Probably does not belong here |

**Every update stamps §11 Change log.** One line, dated, what changed.

**Authority chain when two sources disagree:**

```
live Postgres / live code   >   docs/   >   this doc   >   any chat memory
```

This doc is a map. It is never the reason a number is what it is.

---

## 1. The operating model

### 1.1 Three seats

| Seat | Who | Owns | Cannot |
|---|---|---|---|
| **Owner** | Kevin Fietek | Every decision. Merges. Applies migrations in Supabase Studio. Domain truth on all accounts. Paces sessions. | n/a |
| **Chat-Claude** | this seat | Ruling docs, CC prompts, design audits, HTML mockups, probe recipes, completeness-map grades, this doc | Commit, push, merge, apply migrations, run commands on Kevin's machine or DB |
| **CC** | Claude Code CLI | Reads and edits code, runs commands, opens PRs, writes to disk, holds auto-memory | Merge. Apply migrations. Post `applied in Studio: YES`. Make prompt-rule changes. Resolve scope conflicts unilaterally |

**The loop:** Kevin states intent -> Chat-Claude authors the ruling doc ->
Kevin pastes it to CC -> CC builds and reports -> Kevin pastes the report back ->
Chat-Claude grades the completeness map, then the probe output -> Kevin gates
and merges.

**Repo access note (ruled 2026-08-06).** Kevin granted Chat-Claude read access to
the public repo and the wider environment. Chat-Claude now grounds rulings by
reading the repo directly instead of asking for pastes. Nothing else in the
contract moves: CC still builds, Kevin still merges, Chat-Claude still accepts
at paint. This supersedes the "you do not read files from disk, owner pastes"
line in the 2026-08-05 handoff pack.

### 1.2 Binding protocol - `docs/BUILD_ACCURACY_PROTOCOL.md`

CC contract: C1 no self-certification (`[ran]` / `[code-read]` / `needs-gate`,
one label per claim) · C2 completeness map, every numbered input to a commit hash
or an explicit `NOT DONE - reason` · C3 read the source and cite `file:line`
before altering an existing element · C4 acceptance echo verbatim · C5 regression
re-declare on any previously gated path.

Chat-Claude contract: A1 outcome-level acceptance, visuals accept at paint and
multi-site rulings name every site · A2 verbatim appendix, Kevin's raw words
append every owner-round prompt and every clause line-diffs to a wave or an
explicit `not scoped - flagged` · A3 grade the map before reading probe output,
bounce on a missing item · A4 the standing battery is never assembled ad-hoc ·
A5 probe canon.

Shared: S1 every PR body records `gate findings: N`.

### 1.3 Standing battery (A4)

Laptop matrix 1024 / 1152 / 1280 / 1366 / 1536 · legend audit · per-kind header
inventory · paint-level glyph cells · today and state carriers · failed-state
end to end · flag-off parity plus the storage-clear law · squint and grayscale ·
canvas-flush at zoom.

**Five-context law for any SC tile or layout change:** PDC per-meal, fee, MLB,
MiLB, each in month AND period view. Binding since the 66px break that a
single-account gate missed.

### 1.4 Probe canon (A5)

Settle-frames after interactions · `elementFromPoint` is paint truth, computed
geometry alone is not · kill-switch cells end with `localStorage.clear()` ·
code-path verification (wrapper class or data attribute) accompanies every
outcome check.

### 1.5 Writing and build discipline

- Hyphens, never em-dashes. Everywhere: code, comments, commits, copy, docs.
- No emojis unless asked.
- Honest expert pushback over agreement. Weak plans get said so.
- Quoting Kevin: verbatim from a locatable source, or paraphrase and mark it.
  A reconstructed quote inside quote marks is a defect.
- No new px literals for type, spacing, or radius. Tokens only.
- Stage by explicit path. `git add -A` is banned.
- Never read, write, or echo anything matching `.env*`.
- Force-push forbidden without an explicit ask.
- Commit only when asked. Push only when asked. Every push opens its PR in the
  same turn and the report ends with the verbatim push line.
- Probe identities are never real people.
- No silent scope additions. Flag before folding in.
- Recon before build on anything non-trivial.

---

## 2. The business

KitchFix runs professional kitchens for pro sports and corporate clients.
Operational portfolio above $10M annually. Kevin is Director of Operations and
the sole developer of the intranet that runs it.

Four kitchen shapes: MLB clubhouse (homestand-billed, fee-based, no per-meal
counting) · MiLB (per-meal, AAA subset carries homestand schedules) ·
PDC / spring training complexes (daily service in season, mixed billing) ·
corporate (flat-fee daily).

---

## 3. Accounts register

Account key is the primary key for every SC read and write, scoped in the URL
as `?account=STL - FL`. Spaces around the dash are part of the key.

### 3.1 PDC accounts

| Key | Team | Parent | Billing | Notes |
|---|---|---|---|---|
| `STL - FL` | Palm Beach Cardinals | STL - MO | flat_fee | Fee-based, no per-meal dollars. sc-17 home overlay, sc-28 qualifying away games, sc-29 SLU away projections. Catalog carries MLB + MiLB + PBC + Spring Training groups |
| `TBJ - FL` | Dunedin Blue Jays | TBJ - NY | per-meal | sc-17b overlay, sc-27 Sunday-zero reprojection |
| `CIN - AZ` | Reds AZ complex | CIN - OH | per-meal | Spring only. Level-split per-head pricing |
| `TXR - AZ` | Rangers AZ complex | TXR - TX - H | per-meal | Spring only |
| `TBR - FL` | (Rays complex) | - | per-meal | MLB no-SF vs MiLB 25% buffet-only. Appears in phase calendar and money model |

### 3.2 MLB accounts

| Key | Team | Billing | Notes |
|---|---|---|---|
| `CIN - OH` | Cincinnati Reds | flat_fee homestand | M-2 pilot for the homestand surface |
| `STL - MO` | St. Louis Cardinals | flat_fee homestand | sc-13 AWAY rows, sc-23 stranded projections, sc-24 game_type backfill |
| `TXR - TX - H` | Texas Rangers home | flat_fee homestand | |
| `TXR - TX - V` | Texas Rangers visitor | flat_fee homestand | Fee covered by H, amount 0 |

All four sit in `DERIVE_HOMESTANDS_ACCOUNTS` and are inert on day-level count
entry (M-3 ruling 2026-07-29). Actuals come from homestand close-out.

### 3.3 MiLB accounts

| Key | Team | Billing | Notes |
|---|---|---|---|
| `TBJ - NY` | Buffalo Bisons | per-meal, AAA | sc-16 `has_homestand_schedule` |
| `CIN - KY` | Louisville Bats | per-meal, AAA | sc-16 sibling |
| non-AAA MiLB | various | per-meal | No homestand overlay |

### 3.4 Corporate

Flat-fee daily service. No schedule overlay, no game days, `FEE` legend branch.

### 3.5 Locked 2026 contract fees (`sc_fee_schedule`)

CIN - OH $362,500 · STL - MO $473,000 · TXR - TX - H $604,032 ·
TXR - TX - V $0 covered by H · STL - FL $1,400,000.
Source of truth: `docs/SC_CONTRACT_BILLING_SUMMARY.md` RESOLVED BILLING DECISIONS.

---

## 4. The system as it stands

### 4.1 Stack

Next.js 16 (Turbopack) / React 19 · JavaScript, no TypeScript except Playwright
specs · NextAuth v5 with Google OAuth (currently full `drive` scope, flagged for
reduction) · Sheets plus Supabase Postgres dual layer · Vercel, `main` deploys
to production · **no staging environment**.

`NEXTAUTH_URL` is pinned to production, so Vercel preview deployments bounce
OAuth. Every real gate happens on localhost or on prod after merge. Whitelisting
the preview domain pattern in Google OAuth redirect URIs is the small change
that would give back a pre-merge gate. Not scheduled.

Playwright CI: the matrix job runs in-runner with `TEST_MODE`; the preview-smoke
job cannot reach the API surface behind Vercel Preview Protection. A green
Playwright check does not mean the PR's code works.

### 4.2 Danger zones (explicit approval before edit)

`src/lib/sheets.js` · `src/lib/cutover.js` · `src/lib/dataStore/*.js` ·
`src/lib/auth.js` · `src/middleware.js` · `vercel.json` · `next.config.mjs` ·
`package.json` · `docs/migrations/*.sql` · anything matching `.env*`.

### 4.3 Migration gate

Migrations live in `docs/migrations/*.sql` and never auto-apply. Kevin pastes
them into Supabase Studio himself. A PR that reads or writes an object created
by an unapplied migration opens as DRAFT. `.github/workflows/migration-gate.yml`
Job A fails the check when a PR adds migration files; Job B flips it green when
Kevin (author_association OWNER) comments `applied in Studio: YES`. Per-SHA
reset: any push re-runs Job A, so a confirmation never outlives the code it
confirmed.

Main is protected by repository ruleset `main protection` (id 16364953),
enforcement active, empty bypass list. Applies to admins.

### 4.4 Module state

| Module | Store | State |
|---|---|---|
| News, Directory, People-submissions, Vendor, Invoice, Playbook/OPD | Postgres, dual-write to Sheets | Cut over |
| Service Calendar | Postgres for the SC tables, Sheets legacy still present | Active build area |
| Labor, Financial, Legacy Inv Count, Incidents, Leadership Dugout | Sheets | Not cut over. Do NOT copy their pattern for new work |
| Smart Inventory | Postgres | Parked. v2 vision is queries-over-facts, no cron. Emergency and full-picture exports shipped as a bypass |
| SousAI | Postgres | FROZEN at v2.0 pending the KPI engine resolver |
| KPI engine | Postgres | See §9 drift item D-1. Migrations `kpi-1`, `kpi-1b`, `kpi-8a` are merged to main |

**Build mode, not migration mode.** New features are Supabase-native using the
`dataStore` orchestrator plus flag-dispatch pattern.

---

## 5. Service Calendar - the current work area

The SC is the most complex surface on the intranet: per-day service counts
(projected against entered), homestand blocks with labor budget envelopes,
schedule overlays for PDC accounts, period lock for AP billing, bulk entry,
and an admin surface for catalog, pricing, and budgets.

### 5.1 The two-flag schedule model (canonical)

Two orthogonal booleans on `accounts`, both reading the same
`sc_homestand_schedule` table. Consumers branch on the FLAG, never on the
presence of rows.

| Flag | Meaning | Who has it | Effect |
|---|---|---|---|
| `has_homestand_schedule` | counts are homestand-driven | 4 MLB plus CIN - KY, TBJ - NY | Rows are AUTHORITATIVE for game days. Kind resolution keys off this |
| `has_schedule_overlay` | there is a game schedule to SEE but not count against | STL - FL, TBJ - FL | Rows are INFORMATIONAL. Kind resolution keys off account category |

**Gating law:** gate on explicit account sets (`MLB_HOMESTAND_SURFACE_ACCOUNTS`,
`HOME_DINING_AWAY_OPPONENTS`), never on a derived property. Derived-property
gating is a recorded repeat failure.

### 5.2 Legend architecture

The always-visible BAR keys STATES (action-driving colour signals: entered,
needs entry, overdue, upcoming, non-game, away, today). The POPUP behind the
(i) carries the FULL TAXONOMY including ATTRIBUTES (day/night pill, EXH marker,
game-type wedges, notes bubble). The coverage rule applies to states only;
attributes are curated. Ruling held 2026-07-22, still binding.

### 5.3 Migration index sc-1 through sc-29

| # | Purpose |
|---|---|
| sc-1..4 | Schema, non-revenue flag, homestand schedule, user_accounts seed, config changelog |
| sc-5 | `sc_fee_schedule` |
| sc-6a/b | Catalog `active_until` plus view recreate |
| sc-7 | Changelog latest view |
| sc-8a/b/c | `price_kind`, actual-prices view, remove double-discounted actuals |
| sc-9 | `sc_day_note_entries` ledger |
| sc-11 | `sc_phase_calendar`, 48 rows across 5 PDCs |
| sc-12 | MLB schedule reconciliation |
| sc-13 | AWAY row support, 4 MLB accounts |
| sc-15 | `game_time`, `day_night`, `is_doubleheader` |
| sc-16 | `has_homestand_schedule` plus AAA parity. The silent-gap incident that created the migration gate |
| sc-17 / 17b | `has_schedule_overlay`, STL - FL then TBJ - FL home rows |
| sc-18 / 19 | Counter patches, date-drift safe subset |
| sc-20 / 21 | `sc_labor_budgets`, period convention correction |
| sc-22 | `sc_homestand_closeout` plus `sc_confirm_closeout` |
| sc-23 / 24 | STL - MO stranded projections, game_type backfill |
| **sc-25** | **Period lock** |
| sc-26 | Note source |
| sc-27 | TBJ - FL reprojection, Sunday-zero discipline |
| **sc-28** | **STL - FL away-dining. `opponent_team_id` column, home backfill, 64 AWAY rows** |
| **sc-29** | **STL - FL SLU away projections, 12 dates, PBC Pre-game 50 plus Post-Game 50** |

### 5.4 Key code paths

- `src/lib/dataStore/serviceCalendar.js` `loadScheduleOverlay` - overlay reads;
  sc-28 widened it to GAME always plus AWAY filtered by
  `(account, opponent_team_id)`
- `src/app/service-calendar/v2/homeDiningAwayOpponents.js` - the map, plus
  `accountHasHomeDiningAwayOpponents`
- `src/app/service-calendar/DaySquare.js` `renderFeeNoDollar` - fee-tile chips
- `src/app/service-calendar/season/StateLegend.js` and `legendItems.js` -
  the bar
- `src/app/service-calendar/season/LegendInfoPopup.js` - the popup
- `src/app/service-calendar/ServiceCalendar.js` - root, roughly 4000 LOC,
  three `<StateLegend>` mount sites
- `src/app/service-calendar/v2/drill.css:511` - base opponent-chip rule at
  specificity 6 with a `:not()` opt-out chain. **Three variants use the chain
  today. A fourth is the trigger to split it into geometry-only plus a separate
  default-colour rule.** Recorded fragility, not yet scheduled.

### 5.5 Banked findings (do not re-learn)

- **Position, never name** for spreadsheet lookups. STL's actuals tab labels the
  PBC `Arrival` column "Breakfast"; a name lookup finds MiLB Breakfast, and the
  grand total still balances so a totals check will not catch it. Only the
  positional tables in `SC_SPREADSHEET_MAPPING.md` are safe.
- **Author markers already exist.** `created_by = 'import-script'` on imported
  rows, `spreadsheet_seed` on seed imports (decided 2026-08-01, no new column),
  Kevin's email on hand-entered. Zero overlap.
- **The fiscal calendar** is 12 periods of 4 weeks plus a 3-week P13 = 51 weeks
  = 357 days, 2025-12-29 through 2026-12-20. Week label resets each period.
  Projections sheets use integer periods; actuals sheets use decimal sub-week
  periods (1.1, 1.2, ...).
- **No-service days** store as zeros plus an audit note. The spreadsheet cannot
  distinguish "did not serve" from "not recorded yet", so a reseed cannot
  preserve the difference without a rule.
- **Sous is the only cross-account surface.** Everything else is scoped to one
  account by URL.
- **Team id beats abbreviation.** Abbreviations rename silently.
- **API dedup classes to watch:** doubleheader compression, postponement shadow
  (`officialDate` rewritten, do not create a service day for the original
  `gameDate`), suspended-game duplicates.
- **Never hand-type data derived from an API.** Concatenate from the generated
  source. Enumerate every target `(account_key, service_date)` pair against
  existing rows before writing an `ON CONFLICT` insert.
- **2026-03-05 on STL - FL** carries actual=1 on every live service. Bootstrap
  artifact. Seed replaces it.

### 5.6 Cutover model

Sites move one at a time, roughly 11 over about a month, beginning in the
2026-09 timeframe. Each site keeps its spreadsheet until Kevin trains them;
at training the account's data is wiped and reseeded from the live spreadsheet.
First site likely a PDC.

---

## 6. Forward scope

Ordered as Kevin ruled on 2026-08-06: **billing first, then the outstanding
polish items.**

### 6.1 IN FLIGHT - PR #632, away-dining chip restyle

Branch `feat/sc-stl-fl-away-dining` at `40e17bb`, draft, pushed, not merged.
Confirmed present on origin 2026-08-06.

- Copper renders. `drill.css:511` gains `--away-home-dining` in its `:not()`
  chain rather than escalating variant specificity; the variant now owns pill
  geometry since it no longer inherits.
- Pill shortens from `at OPP - Meals@Home` to `⌂ at OPP`; `· DH` suffix stays.
  137px to 66.95px on a 143px tile, 96px with the DH suffix.
- Legend gains `Away, meals at home`, copper swatch, gated per account so only
  STL - FL sees it.
- Acceptance measured in a headless-chromium fixture, landed in the PR body.

**State: awaiting Kevin's design gate. No changes proposed until he directs.**

### 6.2 NEXT - the billing arc (ACTIVE)

See §7. Sebastian's notes and full transcript received 2026-08-06; the process
review is authored (`docs/audits/SC_BILLING_PROCESS_REVIEW_2026-08-06.md`).
The arc sits at step 3 of the §7.5 sequence: Kevin's corrections plus the
clock rulings (open decisions 11-18) before any shape work.

### 6.3 THEN - entry modal polish

Kevin's feedback items 1, 2, 3, 4, 7, 10, plus one false label. Zero behaviour
change, every colour from a token.

- Match and Clear get resting colours; mint a red token family from the existing
  overdue colours so the product has one red, not two.
- Ledger column header spans the card edge to edge; rows get horizontal room.
- Type and input sizes step down once, with a 44px touch floor below 1024px.
- Confirm and save goes white on a darker green. White on the current bright
  green measures 3.02:1 and fails normal-text AA; deep green measures 6.49:1.
  Chat-Claude's call, made because Kevin asked for white text.
- Mark day as no service becomes a real button in a quiet register.
- Note rows render their author. The data was always captured.
- The Spring Training drawer subtitle stops claiming something was entered when
  nothing was.

### 6.4 THEN - undo and the period lock (recon first)

**Kevin's rule, paraphrased from `SC_ROAD_TO_CUTOVER.md` as carried in the
handoff pack:** operators correct their numbers freely until the end of their
period, after which the period freezes so AP can pull clean figures. SLT can
change anything at any time.

Three concepts, deliberately separate:

1. **Undo is a delete.** One API action removing that day's actuals for that
   account, returning the day to projected-with-no-input, writing a ledger entry
   with the person's name. Notes history survives.
2. **Editability is a server-side predicate.** Enforced at every write path -
   single day, bulk, undo - not merely hidden in the UI. The client reads the
   same predicate so what is shown matches what is allowed, but the API holds
   the line.
3. **The lock signal is its own function.** Today it reads a period end date.
   Once the billing export exists it reads whether AP has pulled that period.
   Swapping the input touches nothing else. **This is the design decision that
   matters most, and it is the hinge between this arc and the billing arc.**

Locked state renders read-only with a reason ("Period 8 closed for billing"),
never a silently dead form. SLT sees an override, not a wall.

Open recon questions: what a period boundary actually is in the data; whether
SLT is the same group as the existing corporate gate on the SC admin button or
a different list; whether the backlog's Close Day survives (note: `SC_STATUS.md`
records Close Day as REMOVED 2026-08-01, covered by shipped mark-no-service plus
the sc-25 period lock - confirm against the road-to-cutover text).

### 6.5 THEN - save confirmation

The dead pill is gone with the Handoff retirement, so a clean save just closes
the modal. Kevin wants something dead centre, obvious, worth the moment.
**Decide the ceiling before building.** A clean centred confirmation that
appears and fades is an afternoon. Real motion and personality is a design piece
with its own render and gate. The Handoff arc is the cautionary tale: a
save-celebration flight that never fired once, 473 lines retired.

Workaround already shipped: `SaveConfirmation` state hoisted to
`ServiceCalendarInner`, overlay mounted at workspace level, structurally
independent of the modal's mount cycle.

### 6.6 Launch roadmap (Kevin's ruling 2026-07-12, still the frame)

1. Final design polishes - SHIPPED (#418)
2. PDF schedule export - SHIPPED, PDC/PDCO drill PDF parked behind Coming Soon
   pending the wall-poster redesign
3. **Full pricing alignment across all accounts to 100% accuracy including
   off-contract specifics (Kevin supplies), then client bill export** - this is
   the billing arc
4. Full-scale system and codebase test, cleanup, drop the Coming Soon gate,
   desktop DONE
5. Mobile, details TBC

### 6.7 Parked (resume only on Kevin's ruling)

- Admin Dashboard, Fun Money Tracker
- Bulk entry for fee accounts (after cutover)
- The seed program (worked through when the first site is ready)
- PDC season PDF 500
- PDC/PDCO drill PDF wall-poster redesign
- Schedule-drift watchdog stages 2 and 3, parked to 2027
- `sc_homestand_schedule` array-shape for DH and PPD makeup dates
- Smart Inventory v2
- January 2027 queue: spring and FCL overlays, AAA TBD re-pull, `/seasons`
  sanity check
- Roster indicators (needs a Kevin hypothesis first)

### 6.8 Known defects carried, not scheduled

- **Price roundCents-then-extend drift** on the off-schedule fallback. Bounded
  at $1.50 worst case per row. Deliberately unfixed: both candidate fixes have a
  larger blast radius than the defect.
- **Day-detail modal remounts during post-save refetch.** 400ms-plus gap
  measured. The surgical monthCache patch was attempted twice and reverted; the
  `focusDayData` latch is tractable but is workspace-level cache/render work.
- **Bug A, transient month-swap on the Screen Month drill.** Parked. Hard rule:
  no fix ships without a named `file:line` mechanism.
- **`drill.css:511` fragility.** Fourth variant triggers the split.
- **Phantom 2026-05-12 STL - FL GAME row.** sc-17's snapshot predates the
  postponement onto 5/13; the API now shows 65 unique home dates against 66 rows
  in the table. Kevin's call, out of sc-28's scope.
- **TBJ - NY Snack and Shake** are `active=false` with `active_until=NULL`, so
  post-sc-6c they render as normal active rows. Cosmetic, defer.
- Incidents module has 0 rows despite full machinery.
- `src/lib/cutover.js` has no flag to turn Sheets writes off for cut-over
  modules.

---

## 7. The billing arc (scope frame - awaiting Sebastian's notes)

### 7.1 What this arc is

Design how SC data becomes a QuickBooks entry and a client invoice, on top of
the data model that sc-1 through sc-29 landed. Kevin met Sebastian (accountant,
AP) 2026-08-05; notes and full transcript received 2026-08-06; the process
review lives at `docs/audits/SC_BILLING_PROCESS_REVIEW_2026-08-06.md` and is
the evidence anchor for everything below.

**Headline findings from the review:**

- **The billing clock is the service week** (Mon-Sun, invoiced Tuesday), not
  the fiscal period. CIN - AZ bills bi-weekly; CIN - KY and TBJ - NY bill by
  service week. This conflicts with R11 of `SC_BILLING_OVERVIEW.md` (drift
  item D-9) and reframes the period-lock recon in §6.4.
- **The decided v1 shape (on the call):** site finalizes its week -> button ->
  system emails Sebastian the finalized counts -> he uploads into QuickBooks ->
  verifies -> sends. Sebastian stays in the loop. Not a direct API push.
- **Service fees stay annual and manual**, never on weekly invoices. The four
  MLB fee accounts plus STL - FL produce no weekly export at all. The export
  set is the per-meal six.
- **The current method failed on camera:** a shipped invoice carrying the
  prior week's duplicated quantities was found live at [00:04:57]. That defect
  class is the case for the export.
- **New near-term buildable:** price-backdate events must email billing (the
  TBR $3,892 credit case). Kevin committed on the call; PR #620's
  warn-and-record machinery is the half that exists.
- **Rollout:** PDCs first as they cut over; TXR next year (exact meaning of
  "the billing for TXR" needs confirmation); visiting catering stays manual
  this year; stress test with Sebastian before launch.
- **Prior art:** Alex built a Sheets-to-QuickBooks export for TBJ - FL last
  year. Mechanics forgotten, not carried forward. Dig it up before designing
  the QB-facing side.

### 7.2 Inherited constraints (binding before the notes arrive)

- **The period lock signal is one function.** Date rule today, AP-pulled signal
  later. Swapping the input touches nothing else.
- **The QB export format is AP-owned.** Chat-Claude does not design that
  contract. Sebastian's process is the input; intranet-side design serves that
  shape.
- **Position, never name** for every spreadsheet lookup.
- **Author markers** distinguish imported from hand-entered rows already.
- **Nothing computes sticker times count.** Two-layer money architecture: SC
  calendar dollars are the per-meal invoice line only; service fees and flat
  fees live in `sc_fee_schedule`.

### 7.3 What already exists (found in the repo 2026-08-06)

This arc is not starting from zero. `docs/SC_BILLING_OVERVIEW.md` already carries
sixteen numbered load-bearing rulings (R1 through R16) marked DRAFT for Kevin's
red pen, with §1, §2, §3, §5 through §10 stubbed. The rulings cover the stored
price being the post-SF invoice rate, actuals being the billing data, the fee
lock and its asymmetry (overage bills at the actuals price with no fee
component, underage is never reconciled, no true-up exists anywhere), the
approved-projection snapshot, flat-fee accounts never deriving revenue from
headcount times price, billing shapes binding per service-class within account
rather than per account, the two-layer money architecture, tax never living in
the SC, rounding, the fiscal period as the billing unit with two postseason
shapes, internal money never reaching a client, period freeze with corrections
as adjustment lines, effective-dated price changes, the truth architecture, and
the provenance law.

**Chat-Claude's read: the billing arc's first deliverable is finishing that doc,
not authoring a new one.** Sebastian's notes are the missing input for §3 (the
pipeline) and §10 (open framework questions). Standing up a parallel billing
framework doc would create exactly the drift class §9 exists to catch.

Companion docs already in place: `SC_MONEY_MODEL.md` (money authority, wins
conflicts) · `SC_CONTRACT_BILLING_SUMMARY.md` (contract bible, 743 lines) ·
`SC_BILLING_MODEL_AUDIT.md` · `SC_SPREADSHEET_MAPPING.md` (1126 lines,
positional tables) · `FINANCE_STACK_AUDIT.md` and `FINANCE_STACK_PLAN.md` ·
`ACCOUNT_SERVICES_BRIEF.md`.

### 7.4 What Sebastian's notes need to answer

Chat-Claude will hold the notes against this list and flag what they do not
cover, rather than filling gaps by inference.

1. How the eleven per-account Excel SC files reach him, on what cadence, in what
   state, and who sends them.
2. What he does to them between receipt and QuickBooks: which numbers he reads,
   which he re-keys, which he recomputes, which he reconciles against something
   else.
3. How numbers land in QuickBooks: which QB product, what object shape
   (invoice, journal entry, sales receipt), what the line grain is, what
   account codes and classes he keys against.
4. How clients get billed off that: invoice cadence, invoice grain, who reviews
   before it goes out, what the client sees.
5. Coverage: does this process apply to all eleven accounts, or only some.
6. Billing entity against account key: whether STL - FL and STL - MO invoice to
   one Cardinals entity, whether the three TXR accounts consolidate, and so on.
   This decides whether the export is per-account or per-client.
7. What he checks before he trusts a number, and what has gone wrong before.
8. What is AP-mandated versus his own discretion. A step that exists because he
   prefers it is a step the design can change; a step that exists because
   accounting requires it is not.
9. What the period-close signal actually is on his side today: what tells him a
   period is ready to pull, and what he does if a number changes after he pulls.
10. Adjustments and credits: how a post-close correction reaches a client today.

**Grades (2026-08-06, full table in the review §8):** answered - 2, 4, 5;
partial - 1, 3, 6, 7, 8, 9, 10. Partials stay partial until the pending
inputs land: Sebastian's rules doc (due early next week), Josh's QuickBooks
access for Kevin, and Alex's prior art. Nothing gets filled by inference.

### 7.5 Sequence (proposed, not ruled)

1. Kevin pastes the notes. **DONE 2026-08-06.**
2. Chat-Claude produces the process review: load-bearing / fragile / discretion
   versus mandated, plus a gap list against §7.4. **DONE 2026-08-06 -**
   `docs/audits/SC_BILLING_PROCESS_REVIEW_2026-08-06.md`.
3. Kevin corrects the review and rules on the clock questions (open decisions
   11-18). **<- THE ARC IS HERE.**
4. Chat-Claude and Kevin settle the shape.
5. `SC_BILLING_OVERVIEW.md` §3 and §10 get filled and the R-series gets Kevin's
   red pen (R11 amendment per D-9; em-dash sweep D-3 rides the same PR).
6. Only then does a CC ruling doc get authored.

**Chat-Claude proposes no build before step 5 is signed off.**

---

## 8. Standing rulings register

Every entry is binding until Kevin amends it. Dated where the date is known.

| ID | Ruling | Origin |
|---|---|---|
| SR-1 | Hyphens, never em-dashes, everywhere | standing |
| SR-2 | Bar keys states, popup carries attributes; the coverage rule applies to states only | 2026-07-22 |
| SR-3 | Every SC tile change gates across all five contexts, month and period | after the 66px break |
| SR-4 | Gate on explicit account sets, never on a derived property | third recorded instance |
| SR-5 | The period lock signal is its own function | road-to-cutover |
| SR-6 | Position, never name, for spreadsheet lookups | seed recon |
| SR-7 | No surface computes money independently; two-layer money architecture | `SC_MONEY_MODEL.md` |
| SR-8 | Migrations never auto-apply; CC never posts the confirmation phrase | after the sc-16 silent gap |
| SR-9 | No silent scope additions; flag before folding in | 2026-06-04 |
| SR-10 | Recon before build on anything non-trivial | repeated payoff |
| SR-11 | One label per claim: `[ran]`, `[code-read]`, or `needs-gate` | 2026-08-05 |
| SR-12 | The report ends with the verbatim push line | 2026-08-05 |
| SR-13 | Cite the element, not the neighbourhood | 2026-08-05 |
| SR-14 | Test the mechanism before proposing the irreversible option | 2026-08-05 |
| SR-15 | Provenance claims need git evidence | 2026-08-05 |
| SR-16 | When a fix changes what a prop means, every consumer of that prop is in scope for the question, even when out of scope for the change | 2026-08-05 |
| SR-17 | Never hand-type data derived from an API; enumerate collisions before an `ON CONFLICT` insert | 2026-08-05 |
| SR-18 | History claims verify against actual commits before landing in an authoritative doc | 2026-07-31 |
| SR-19 | A null is honest; a back-computed value is a lie | `HOW_WE_WORK.md` |
| SR-20 | Verify the real artifact, not the representation | `HOW_WE_WORK.md` |
| SR-21 | Floor-first: works at 375px before it ships. Chef on a phone in a 38F walk-in with wet hands | standing |
| SR-22 | Bidirectional-diff law: any DB against external-truth audit walks both directions | standing |
| SR-23 | Instrument after the second failed fix; two attempts at the same defect means the diagnosis is wrong | standing |
| SR-24 | Chat-Claude may read the repo directly; CC still builds, Kevin still merges | 2026-08-06 |
| SR-25 | Billing before polish in the current sequence | 2026-08-06 |

---

## 9. Drift register

Repo is canonical; docs catch up. Nothing here is fixed unilaterally.

| ID | Finding | Severity | Proposed disposition |
|---|---|---|---|
| **D-1** | `docs/PROJECT_DASHBOARD.md` lists the KPI dashboard as "Parked ... not being built toward right now", and the standing project instructions list it as out of scope. `main` contains `docs/migrations/kpi-1-spine.sql`, `kpi-1b-activation-fk.sql`, `kpi-8a-rippling-raw.sql` and merged commits `e280391` (kpi PR 1 spine) and `6aea30d` (kpi 8a raw Rippling ingest). `SOUS_V3_DIRECTION.md` is written around Sous querying through the KPI engine's resolver. Three sources disagree about whether a live workstream exists. | **P1** | Kevin rules: is the KPI engine live scope, parked, or a separate track outside this seat's remit. Whichever it is, `PROJECT_DASHBOARD.md` and the session instructions say the same thing afterward |
| **D-2** | `SC_ROAD_TO_CUTOVER.md` is the newest strategic SC doc (2026-08-01) and is cited throughout the handoff pack, but it does not exist anywhere in the repo. It lives only in `filesSCv7.zip` | **P1** | Commit it to `docs/`. A canonical roadmap that only exists in a zip on one laptop is a single point of failure |
| **D-3** | `docs/SC_BILLING_OVERVIEW.md` contains 34 em-dashes, in direct violation of SR-1, in the doc that is about to become load-bearing for the billing arc | **P2** | Sweep during the billing arc, same PR that fills the stubs |
| **D-4** | `docs/PROJECT_DASHBOARD.md` last updated 2026-08-04. It does not mention PR #631, PR #632, sc-25 through sc-29, or the period lock. Its "Right now" section is a single roughly 400-line paragraph, violating the two-screen rule printed in its own header | **P2** | Decide its fate against this doc. See §12 |
| **D-5** | `HOW_WE_WORK.md` lists the Service Calendar under "still on Sheets" and tells new sessions not to copy its pattern. `02_TECHNICAL_STACK.md` calls it a Sheets plus PG hybrid. The SC tables are unambiguously Postgres. A new session reading `HOW_WE_WORK.md` first will start with the wrong model | **P2** | One-line correction naming what is actually still on Sheets |
| **D-6** | `SC_STATUS.md` records the primary working directory as `/Users/kevinfietek/dev/kf-cell-states`; the handoff pack says `/Users/kevinfietek/dev/kf-sc-admin`; `CLAUDE.md` reportedly says `kitchfix-intranet` | **P3** | Kevin states the real one; the three agree afterward |
| **D-7** | `SC_STATUS.md` records Close Day as REMOVED 2026-08-01 (covered by mark-no-service plus sc-25). The road-to-cutover recon list still carries "whether the backlog's Close Day survives as its own thing" as an open question | **P3** | Confirm removed; drop the recon question |
| **D-8** | `SC_STATUS.md` carries six dead-doc archive candidates awaiting Kevin's disposition since 2026-07-17 | **P3** | Kevin rules archive or keep |
| **D-9** | `SC_BILLING_OVERVIEW.md` R11 declares "The billing unit is the fiscal PERIOD ... Export = per-period". The 2026-08-05 transcript establishes per-meal billing runs on the service WEEK: Mon-Sun invoiced Tuesday, CIN - AZ bi-weekly, CIN - KY and TBJ - NY by service week. R11 was drafted pre-meeting from the P&L side; it now conflicts with the primary evidence | **P1** | Kevin's red pen on R11: service week as the billing grain for per-meal accounts, fiscal period retained as the recognition and lock grain. Postseason sub-clauses unaffected. See review §7 |

---

## 10. Open decisions awaiting Kevin

| # | Question | Blocks |
|---|---|---|
| 1 | PR #632 design gate: merge, refine, or rework | The away-dining arc closing |
| 2 | ~~Sebastian's process notes~~ RECEIVED 2026-08-06; review authored | - |
| 3 | Billing entity against account key mapping - PARTIALLY answered: QB carries multiple accounts per client (triple-C artifact), TXR visiting fans out per event, "the bats are reds" hints without establishing the CIN - KY counterparty. An explicit AP-owned mapping table is required | Export addressing |
| 4 | ~~Coverage~~ ANSWERED: export set = per-meal six (CIN - AZ bi-weekly, CIN - KY and TBJ - NY by service week); fee accounts + STL - FL annual fee flow only; TXR - TX - V = visiting catering flow | - |
| 5 | D-1, the KPI engine's actual status | Whether Sous v3 and the resolver are in or out of this seat's remit |
| 6 | Phantom 2026-05-12 STL - FL GAME row: delete or keep | STL - FL schedule accuracy |
| 7 | Save confirmation ceiling: afternoon, or design piece with its own gate | §6.5 |
| 8 | Is SLT the same group as the existing corporate gate on the SC admin button | Period lock predicate |
| 9 | Disposition of `PROJECT_DASHBOARD.md` once this doc lands | Doc hygiene |
| 10 | The six dead-doc archive candidates | Doc hygiene |
| 11 | ~~The clock~~ ANSWERED K-1: period lock stays the big freeze; per-week finalize under it; finalize pushes to QBO + styled email | - |
| 12 | ~~Rate in export~~ ANSWERED K-2: prices included; SC is the export's rate truth | - |
| 13 | ~~Post-bill edits~~ ANSWERED K-3: billed weeks block edits; corrections via Sebastian in phase 1 | - |
| 14 | ~~CIN - AZ shape~~ ANSWERED K-4: one combined two-week file | - |
| 15 | ~~TXR meaning~~ SUPERSEDED K-5: TXR visiting parked, TXR - V billing removed from arc scope | - |
| 16 | ~~Chase path~~ ANSWERED K-6: email + Slack nudge | - |
| 17 | ~~CIN - OH fee~~ ANSWERED C-1: $376,686 is a legitimate 2026 CPI escalation per contract §2.a; the bible's $362,500 is the stale side | Spawns items 21-22 |
| 18 | ~~Backdate recipients~~ ANSWERED K-7: adjuster + Joe + Josh + Sebastian, plus a "Credit needed" admin flag; its own PR | - |
| 19 | ~~K-10~~ RULED: override = Kevin + Joe + Sebastian, new `SC_LOCK_OVERRIDE` set separate from isScAdmin | - |
| 20 | K-18: `chief` hosting, key rotation, read-only key (Josh) | PR-C build dependence |
| 21 | Contract bible amendment: CIN - OH fee $362,500 -> $376,686 (CPI, §2.a) - Kevin's red pen on a locked value | Doc truth |
| 22 | Changelog gap: `kf-fee-escalation-2026-07` wrote the fee without an `sc_config_changelog` row. Backfill row + a scripts-write-changelog rule - small PR, outside the billing arc | Audit-trail integrity |
| 23 | ~~Pilot pairing~~ RULED: TXR - AZ + CIN - AZ, also the first cutover sites; Track C (site activation) precedes shadow weeks | - |
| 24 | ~~Shape spec §11~~ ALL EIGHT RESOLVED; spec SIGNED v1.0; PR-A + PR-B prompts issued | - |

Pending inputs W-1..W-4 (Sebastian's rules doc · Josh's QuickBooks access ·
Alex's TBJ - FL prior art · which QB product) are now also Kevin-answerable as
rulings K-14 to K-17 in the workbook; Sebastian's doc still trues up K-17 when
it arrives.

---

## 11. Change log

| Date | Version | Change |
|---|---|---|
| 2026-08-06 | v1.0 | Created. Built from live repo `main` at `d286291` plus the 2026-08-05 handoff pack. Billing arc frame stubbed pending Sebastian's notes. Eight drift items and ten open decisions registered |
| 2026-08-06 | v1.1 | Sebastian notes + transcript received; process review authored (`docs/audits/SC_BILLING_PROCESS_REVIEW_2026-08-06.md`). §7 rewritten with findings; §7.5 advanced to step 3. D-9 registered (R11 period-vs-week conflict). Open decisions 2 and 4 closed, 3 re-graded, 11-18 added. Billing arc marked ACTIVE in §6.2 |
| 2026-08-06 | v1.2 | Rulings workbook issued (`KF_Rulings_and_Questions_2026-08-06.xlsx`). Waiting-on-others items W-1..W-4 promoted to Kevin-answerable rulings K-14..K-17; §10 pending-inputs line updated |
| 2026-08-06 | v1.3 | Live read-only QB recon via Josh's proxy (`docs/audits/QB_API_RECON_2026-08-06.md`). K-14 answered (QuickBooks Online), K-15 and W-2/W-4 closed. Draft customer and tax maps produced; invoice anatomy captured (per-day lines, Sunday TxnDate, per-account invoice splitting); F-2 demonstrated with live numbers (item master 13.94 vs invoiced 14.29); "triple C" decoded as Tripleseat. K-18 added (key rotation, read-only key, `chief` hosting). Zero writes made |
| 2026-08-06 | v1.4 | Billing arc gets its own working master: `docs/SC_TO_QBO_PROJECT_MASTER.md` (phases 0-5 to first live invoice, pilot proposal TXR - AZ, risk register). CC recon R1 prompt authored (`CC_PROMPT_BILLING_RECON_R1.md`, C-1..C-12 read-only incl. the invoice-reconciliation feasibility proof). §7 of this doc defers arc detail to the arc master from here on |
| 2026-08-06 | v1.5 | Kevin's workbook answers logged. Open decisions 11-16 and 18 answered, 15 superseded (TXR - V removed from arc scope per K-5), 19-20 added (K-10, K-18). Arc master bumped to v1.1 with the rulings folded in; CC recon R1 running |
| 2026-08-06 | v1.6 | CC R1 accepted (PR #636). Item 17 answered (CIN - OH fee = legitimate CPI escalation); items 21-23 added (bible amendment, changelog backfill, pilot/cutover pairing); item 19 made concrete. Arc master at v1.2 |
| 2026-08-06 | v1.7 | K-10 and pilot ruled (items 19, 23 closed); Sebastian rules doc removed as an arc input. Shape spec v0.9 DRAFT issued with 8 red-pen marks (item 24). Arc master at v1.3 |
| 2026-08-06 | v1.8 | Spec SIGNED v1.0 (item 24 closed). Build prompts PR-A + PR-B issued; Phase 3 open. Arc master at v1.4 |

---

## 12. Note on `PROJECT_DASHBOARD.md`

That doc and this one now overlap. Chat-Claude's recommendation, for Kevin's
ruling rather than unilateral action:

- **This doc** becomes the current-state and forward-scope surface. Short,
  pointer-heavy, updated on the triggers in §0.
- **`PROJECT_DASHBOARD.md`** either gets trimmed to a pure pointer index or
  moves to `docs/archive/` as the historical narrative it has become. Its
  "Recently done" section is genuinely valuable history and should survive
  somewhere, but it is history, and history belongs in the PR trail or an
  archive file, not in the doc a new session reads to orient.

Two live current-state docs is the drift generator this register exists to
catch. Pick one.
