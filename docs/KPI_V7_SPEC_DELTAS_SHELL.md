# KPI V7 SPEC DELTAS - SHELL (header · portfolio · rail) - approved 2026-08-17

Status: LOCKED for the three sections below. Amends KPI_V6_SPEC_DELTAS.md. Renders (Kevin's
LOCAL files, never committed): kitchfix-kpi-v7.1-header.html, kitchfix-kpi-v7.2b-portfolio.html
(title option A), kitchfix-kpi-v7.3-rail-retired.html (option 1). Everything not named here
stays as v6 shipped. Commit-safe: no client dollars in this document.

## A. Header - one command bar (V7-1..V7-9)

- V7-1  REMOVE Copy link. Feature retired. Delete the control and the M3 crossfade choreography
        that only it used (keep shared motion tokens).
- V7-2  REMOVE Save view / saved-view pills / Views dropdown from the chrome. Feature retired
        from the UI in v7 (the views API + table stay untouched - a later ruling decides their
        fate; no client surface references them after this PR).
- V7-3  REMOVE the tabs row (Overview soon / Labor / Food soon / ...). Replace with a SECTION
        dropdown on the command bar, immediately right of the title: eyebrow `SECTION` +
        value `Labor` + caret. Menu lists Overview / Labor / Food / Other COGS / Revenue /
        P&L; non-Labor items ghosted with a `SOON` tag (K5 preserved). Selecting Labor is a
        no-op; ghosts are non-interactive.
- V7-4  MOVE the Range control (v6 Range menu, unchanged behavior incl. inline custom range)
        onto the command bar, right of the Section dropdown, left of the fiscal meta. Its
        popover anchors below the bar.
- V7-5  MOVE Workers filter to the TABLE control bar, immediately LEFT of the Employee-display
        segmented control (right-aligned pair). Same behavior and state.
- V7-6  REMOVE the scope band row entirely (nothing lives there after V7-2/4/5).
- V7-7  Command bar layout, left to right: title `KPI Dashboard · <account>` -> Section
        dropdown -> Range control -> fiscal meta `TODAY <MM/DD> | PERIOD <n> | WEEK <w>` ->
        flexible space -> Export -> freshness chip. Bar height 60px.
- V7-8  Shared control skin - EVERY control on the bar (Section, Range, Export, freshness):
        height 34px, radius 8px (freshness stays pill), side padding 12px, type 12.5px,
        background rgba(255,255,255,.08), border rgba(255,255,255,.18), hover .14; eyebrows
        11px uppercase tracked .06em in #B9C6DA; values 600 weight white; control gap 12px,
        group gap 20px; fiscal meta separators 1x16 in #3D5578 with 14px each side. One
        dashed 34px band contains every element (render guides show this).
- V7-9  Freshness chip becomes the entry point for pipeline diagnostics: click opens a small
        popover with the former Pipeline disclosure content (orphan facts, unmapped types,
        last derive, last walk). Chip color semantics unchanged.

## B. Portfolio folio (V7-10..V7-16)

- V7-10 Column width 236 -> 260px. Inner padding 16px, card gap 12px.
- V7-11 Title (option A): `PORTFOLIO` 14px/800 tracked .06em navy-900 with subline
        `<n> sites · 2 regions` 11px n-500. Not a card.
- V7-12 Three CARDS wearing the page card skin (1px n-300 border, 10px radius, layered shadow
        --card-shadow, hover shadow): ALL ACCOUNTS; EAST REGION; WEST REGION.
- V7-13 Group header row IS the selector for ALL/EAST/WEST: min-height 52px, two-line lockup -
        name 11px/800 tracked .08em (`ALL ACCOUNTS` / `EAST REGION` / `WEST REGION`) over
        subline 10px n-500 (`every site · both regions` / `RDO <initial>. <LASTNAME>` from the
        REGIONAL_DIRECTORS mapping); count pill pinned right (10px/700, n-100 bg, n-200
        border, pill). Both lines nowrap. Selected = solid navy-700 fill, white text, subline
        #B9C6DA, pill inverted. Never wraps at 260px.
- V7-14 Member rows: 44px, 12px side padding, 3px left accent bar. Two-line lockup: key
        12.5px/700 n-800 (`STL - FL`) over description 11px n-500 with team name 600 n-600 +
        ` · ` + city/state (`St. Louis Cardinals · Jupiter, FL`); description ellipsizes,
        never wraps. Selected = #EEF3FA bg + navy-700 bar + key in navy-700. Hover n-50.
- V7-15 REMOVE the `salaried` tag from folio rows (StateSalaried still renders on the
        account's own page - unchanged).
- V7-16 Team name + city come from account metadata (accounts table / HUB lineage), NOT
        hardcoded. Display strings ruled: TBJ - NY `Buffalo Bisons · Buffalo, NY`; TXR - TX - H
        `Rangers · Home · Arlington, TX`; TXR - TX - V `Rangers · Visitor · Arlington, TX`;
        others `<MLB club> · <city>, <ST>`. If a metadata field is missing, render the key
        alone (never a placeholder string) and list the gap in the PR body.

## C. Right rail retired (V7-17..V7-20)

- V7-17 REMOVE the right rail (ContextRail and its 300px grid track). Layout becomes TWO
        columns: folio 260 + main. Main gains the width; card grid stays 4-up in this PR
        (the cards section will rule on the extra width).
- V7-18 REMOVE the OT WATCH card entirely (OT surfaces later inside the table's worker
        detail - a future section ruling; nothing to build now).
- V7-19 Payroll data check + Nightly feed relocate to a SYSTEM status strip at the BOTTOM of
        the folio (after a flexible spacer so it hugs the column foot): eyebrow `SYSTEM`
        9.5px/800 tracked n-400; two 22px rows, each `<dot 7px> <label 11px n-600, flex>
        <value 11px/600 n-800>`: `Payroll data` -> `<complete> of <total> complete` (value
        green-700 when complete; amber-600 text when partial/hours_only; red-700 when unknown;
        dot color mirrors); `Nightly feed` -> `healthy · <HH:MM AM>` / `stale` / `failed`
        with the existing freshness color logic. Border-top 1px n-200, 12px top padding.
        No card, no shadow - deliberately quiet.
- V7-20 The plain-language coverage sentence and the `In view` counts move into the freshness
        chip popover (V7-9) beneath the pipeline lines, so nothing the rail said is lost.

## D. Cross-cutting

- V7-21 Grep gates all persist; NEW: zero references to `Copy link`, `Save view`, `ContextRail`
        (component may be deleted or left unrendered - delete preferred, list in PR body),
        `kpi-tabs`/tab-row markup, scope band. Playwright/e2e selectors that targeted removed
        elements are updated, not left dangling.
- V7-22 Mobile (<=1023): command bar wraps to two rows (title+section+range / meta+export+
        fresh) or the meta collapses to `P9 · W2` - CC picks the cleaner, states it. Folio
        becomes the horizontal strip as today with the SYSTEM strip inline at its end.
        375px floor walk required.
- V7-23 Nine states unchanged; range-empty and error states must render inside the new
        two-column frame with the Range control still reachable on the bar.
