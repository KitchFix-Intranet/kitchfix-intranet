# Sous polish - Round 2 review (post-#586, live)

**2026-08-01 · Basis:** five production screenshots + Kevin's six items. Split: **hotfix now** (mechanical, live-visible) vs **design round** (awaits picks from the render sheet).

## Verified working in production - protect
One clock everywhere (rail 9:37 = wall clock), canonical 38 on chip and greeting-adjacent, U6 verbatim, V2 briefing structure, source cards with real titles (PB-002 Allergen Playbook), nav mark idle/active, composer disabled state, zebra tables, human provenance in prose ("Sections 02-06; SOP-002 §7.3").

## Hotfix - ships today, no design decisions needed

**R2-01 · P0 · `sources: [object Object]`.** I2 hydration made `sources` an array of `{docId, title}`; the meta-row formatter still string-joins it. Every multi-source answer shows it. Fix: join on `docId`.
**R2-02 · P1 · Tool line echoes its own name twice** (`list_contacts_by_role list_contacts_by_role`), and a third time in the companion line. The humanized action label is missing for the contacts tool, so the fallback echoes the name. Fix: action labels for every registry tool + fallback becomes a verb ("running") not the name; companion line never duplicates the top trail.
**R2-03 · P0-visual · The mark artifact on answer cards** [KF-3 core]. A mini mark renders at the card's top-left, overlapping the status rail, clipped by the card's rounded corner - reads as a rendering glitch on every answer. The spec's status companion belongs *beside the tool trail inside the card*, not on the rail. Fix now: remove the rail-adjacent instance entirely; correct companion placement ships with the design round's Q&A pick.
**R2-04 · P0 · Landing still scrolls ~57px** [KF-1]. The fit math uses full viewport height while the sticky TopNav sits above the page container - the budget forgot the nav in code even though the ledger subtracted it. Fix: page height accounts for the nav (`calc(100dvh - var(--nav-h))` pattern); re-verify zero-scroll at 800/768/720.
**R2-05 · P1 · Example chip truncates** ("...spent with Sysco thi..."). Fix now: swap the Spend example to a shorter string ("Top vendors by spend this year?"); design round may revisit chip sizing.
**R2-06 · P2 · Hero mark not vertically centered** [KF-2]. Alignment fix in the hero row.
**R2-11 · Kevin ruling (I5) · Panel starters are contextual.** In the Playbook host without docContext, starter pills recommend Playbook-domain asks; the page keeps the four-domain set. Built as a per-host starter map so future hosts slot in.
**R2-12 · P2 · Panel limits line** - missing space after `Not yet:` plus the page's "Not yet ... yet" doubling survived in the panel compact form. Corrected string in the hotfix.

## Design round - awaits Kevin's picks on the render sheet

**R2-07 [KF-5] · Q&A presentation.** Five treatments rendered (QA-1..QA-5). My lean: **QA-4 status-forward** - the pill leaves its lonely dead row inside the card and joins the question line; the card becomes pure answer. Second: QA-5 ledger.
**R2-08 [KF-6] · The mise on the landing.** Three options rendered (L-A lockup, L-B watermark, L-C crest). My lean: **L-A** - the mark earns a real place next to the heading instead of decorating; L-B is the safe ambient add; L-C is boldest and riskiest (a deliberate version of the accident R2-03 removes).
**R2-09 [KF-3] · Iconography upgrade.** The 15px bare strokes float unanchored - flat exactly as you called it. Proposal on the sheet: **icon tiles** - 28px module-tinted rounded squares containing each stroke icon. Aligns optically, adds designed weight, gives the accent colors a purposeful home, and scales to every module surface later.
**R2-10 [KF-4] · Depth direction.** "Floating on top instead of within": the cure is layered containment - inner elements get inset definition (subtle inner borders, tinted wells for chips and code zones, the question/answer zones of QA-5) so the card reads as a constructed object with interior depth, not a white sheet with things resting on it. Applied across the render sheet so the direction is visible rather than described.

## Known-deferred, not regressions
`THIS SESSION`/`IN CONTEXT` label stack (DR-17, P2 batch, never in #586 scope) · rail status dots (PR B) · `?doc=` deep link (deferred).

## Sequence
Hotfix prompt drops now → Kevin picks QA-x, L-x, yes/no on icon tiles → round-2 design prompt carries the picks. Both are small PRs off main; no migrations, no ceremony.
