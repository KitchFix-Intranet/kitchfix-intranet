# SC Entry v2 - Scope & Implementation Plan

Status: proposal for review. Not started. Parked behind Stage 5 unless you pull it forward.
Author: Chat-Claude (architect). Target executor: CC. Merges: Kevin.

---

## 1. In one paragraph

SC Entry v2 replaces the single-column day-entry modal with a two-pane "live bill" workspace: a
fast, keyboard-driven service list on the left, and a navy rail on the right that shows the whole
day's bill forming as you type - entered lines solid, un-entered ghosted - with the total ticking
live and a single Confirm that seals the day. The important part for feasibility: **the entire money
and data engine is reused unchanged.** v2 is a new *presentation and interaction* layer over the same
`sc_daily_revenue` rates, the same round-then-sum totals, the same save path. The real work is not the
math - it is faithfully rebuilding the two dozen hardened entry behaviors the current modal already
handles (dirty guard, offline queue, edit history, archived services, mark-no-service, day-nav, fee
accounts) inside the new layout, plus one genuine architectural decision about the save model.

---

## 2. Goals and non-goals

**Goals**
- A calmer, faster, money-forward entry surface tuned for the actual operators (GM, exec chef,
  hospitality manager, sous chef - all money-fluent).
- Kill the current friction: expand/collapse of "more services", the separate Review screen, the
  scattered-numbers feel, the empty state that looks filled.
- Make the money a live artifact (the forming bill) rather than a set of competing readouts.
- Keyboard-first entry (a full day in a handful of keystrokes, no mouse).
- Positive feedback woven into the doing (row flash, live total, group-complete, seal), not just an
  end toast.

**Non-goals (explicit)**
- No data-model change. Postgres SC tables, the `sc_daily_revenue` view, the effective-dated price
  model, and the Sheets dual-architecture are all untouched.
- No change to how revenue is calculated or rounded (round-then-sum / R13 stays exactly as shipped).
- Not a replacement for fee-account entry in v1 (see section 7).
- Autosave is **not** assumed - it is a separate decision (section 5), and the recommended path does
  not require it.
- Not a mobile-first build - mobile is a supported secondary surface, not the primary design target.

---

## 3. The key insight: the money engine is reused as-is

This is what makes v2 a redesign and not a rewrite. Everything below moves over untouched - v2 imports
and calls the same helpers, reads the same day object, and hits the same server actions.

| Concern | Current source | v2 status |
|---|---|---|
| Effective-dated rate | `day.priceAtDate[colIndex] ?? svc.price` | reuse as-is |
| Line amount | `round2(count * rate)` | reuse as-is |
| Day / group totals | `groupSummary` / `summary` / `enteredTotals` / `dayProjection` / `projectedGroupSummary` memos (round-then-sum, flat-excluded meals, non-rev-excluded revenue) | reuse as-is |
| Saved-day totals (server) | `readSavedDayTotals` (round2) | reuse as-is |
| Day object shape | `loadMonthDataPostgres` (projected, actual, priceAtDate, hasActuals, noteEntries, historyEntries, totals) | reuse as-is |
| In-service gating | `isInServiceOnDay` | reuse as-is |
| Delta semantics | `deltaChip` | reuse as-is |
| Rate cell + units + flags | `renderRate`, `deriveUnit`, flag pills, `LEDGER_HEAD` | reuse (re-skinned) |
| Save (write) | `onSave(day, entries, opts)` -> `{success, queued, noteFailed}`, touched-only payload, offline queue | reuse as-is |
| Notes | ride-along (`rideNote`) + standalone Activity composer (`onAddNote` -> sc-add-note) | reuse as-is |
| Activity ledger | `mergeActivity(noteEntries, historyEntries)` | reuse as-is |
| Mark-no-service | `executeMarkNoService` (zero-write + audit note) | reuse as-is |

Net: v2 is a new component tree that consumes the same props (`day`, `serviceGroups`, `onSave`,
`onAddNote`, `isFeeAccount`, ...) and the same math. If we keep the current modal in place behind a
flag, v2 is additive - zero risk to the shipped path until cutover.

---

## 4. What is genuinely new

1. **Two-pane layout** - a fixed-height workspace: scrolling service list (sticky group headers,
   sticky column labels) + a pinned navy rail.
2. **The live forming-invoice rail** - a new render that lists every in-service service, entered
   lines solid and pending lines ghosted (projection preview), with per-group subtotals, the live day
   total, progress, the ride-along note field, and Confirm. This replaces both the old scoreboard hero
   and the separate Review screen.
3. **Keyboard grid navigation** - arrow up/down between count boxes, Enter to advance, group-jump,
   `Cmd/Ctrl+Enter` to confirm, with correct focus management across groups and on day-nav.
4. **The motion layer** - row flash on entry, cascade-fill on Match all, live-total pulse, progress
   shimmer, group-complete stamp, Confirm pulse, seal. All gated on `prefers-reduced-motion`.
5. **Mobile bottom-sheet** - single-column list + sticky total bar that opens a bottom-sheet bill
   (note + Confirm). A different layout, same data + save.
6. **The save-model decision** - see next section. This is the only part that touches architecture
   rather than presentation.

---

## 5. The one real decision: the save model

The current flow is deliberate: enter -> Review screen -> Confirm -> `onSave` (touched-only) ->
success screen, with an offline queue, a dirty/discard guard, and an edit-history trigger on write.
v2's "live rail" naturally raises the question of whether to keep that or move to autosave+undo. Two
options:

### Option A - Live rail replaces the Review *screen*; Confirm keeps the existing write path (RECOMMENDED)

The rail is always visible and *is* the review (you see the full bill forming the whole time), so the
separate Review screen is deleted. But "Confirm day" still performs one deliberate, explicit write
through the existing `onSave` path - same touched-only payload, same queue, same edit-history, same
success/queued/noteFailed handling. The discard guard stays meaningful (unsaved counts until you
Confirm). "Autosaves as you type" text comes off the button.

- Pros: ~90% of the UX win (live bill, no separate review step, calm fast entry, keyboard flow) while
  **reusing the entire hardened save/queue/history/discard machinery**. No schema change. No change to
  server write frequency. Preserves a deliberate confirm for a billing number - which ops/finance may
  actively want. Fully behind a feature flag; instant rollback.
- Cons: not "autosave" - if the browser dies mid-entry before Confirm, unsaved counts are lost (same
  as today; the discard guard mitigates). The rail's live total is a preview until Confirm writes it.

### Option B - True autosave + undo

Counts write as you type (debounced), no explicit Confirm; an undo affordance replaces the discard
guard.

- Pros: nothing is ever lost; feels the most "modern POS."
- Cons: a real project, not a polish pass. It changes the write model (debounce, optimistic UI,
  conflict/last-write-wins handling), forces a rethink of the edit-history trigger (every debounced
  write is a history row - noisy), complicates the offline queue, removes the deliberate confirm on a
  billing figure, and needs an undo/redo stack with server reconciliation. Higher ceiling, materially
  higher risk on a load-bearing money path.

### Recommendation: Option A.

Not on effort grounds - on safety and correctness grounds. Option A keeps a deliberate, auditable
write on a billing number, reuses the proven queue and edit-history, and is flag-guarded and
reversible. It delivers the live-bill experience you liked without betting the money path on a new
write model. **Autosave (Option B) should be its own later decision, decoupled from this redesign** -
if we still want it after v2 ships, we scope it separately against real usage. The rest of this plan
assumes Option A.

---

## 6. Current-design fit

- **Tokens.** The rail's navy is the existing `--navy` (it already anchors the modal header, so the
  rail reads as the same system, not a new theme). Greens, cream, ghost, and the `--sc-tag-*` flag
  tokens all exist. New tokens needed are minimal and additive: a lightened entered-wash, a
  green-flash keyframe color, and rail-surface neutrals. All derived from existing palette primitives
  (no raw hex in components).
- **WCAG (AA baseline).** Must verify: rail body text on `--navy` (light-on-dark) contrast; the
  ghost/pending line contrast (it is supplementary, but keep it legible); the dashed ghost count box;
  focus rings on both panes; and that every motion cue has a non-motion fallback (already true in the
  prototype via `prefers-reduced-motion`). The live total needs an `aria-live="polite"` region so
  screen readers hear it update. Count inputs keep `aria-label` per service.
- **Browser matrix.** Chrome-only latest-2 desktop + recent iOS Safari / Android Chrome. Subgrid,
  CSS grid, CSS animations, `scrollbar-gutter` all clear this comfortably (same basis as the shipped
  ledger).
- **Density.** v2 is inherently a Density-mode surface. Mobile inverts to Comfortable via the
  bottom-sheet. Keep the two explicit rather than trying to make one layout do both.

---

## 7. Fee accounts and the edge cases that must survive

**Fee accounts (the 4 MLB homestand accounts) stay on the current modal for v2.** The entire value
prop is the live bill, and fee accounts have no per-meal dollars - a money rail is meaningless for
them. v2 targets the 7 per-meal / MiLB accounts where the live bill shines. Fee accounts keep working
exactly as today; we revisit them only if there's a reason to. This is a clean scoping line, not a
gap.

**Behaviors that MUST be preserved verbatim (this is the real work):**
- Ghost vs explicit-0 vs entered distinction; touched-only save payload.
- `isInServiceOnDay` gating + the read-only "Archived {date}" treatment for services archived after
  the day.
- Mark-no-service (zero-write all in-service + audit note).
- The dirty/discard guard (`isDirty` value comparison, `requestClose`, keep-editing default focus).
- Offline queue (`result.queued` -> close to grid + SYNCING badge) and the partial-success
  (`noteFailed`) path.
- Ride-along note + standalone Activity composer + the merged Activity ledger.
- Day-nav re-seed (values, notes draft reset, history rehydrate, scroll/focus reset).
- Auto-focus first ghost input; enterkeyhint on the last input.

If any of these is dropped in the rebuild, v2 is a regression regardless of how good it looks. The
implementation plan treats them as acceptance criteria, not extras.

---

## 8. Phased implementation plan (A++), behind a feature flag

Each phase is independently reviewable and shippable behind `SC_ENTRY_V2` (per-account or global
flag). The current modal remains the default until Phase 6 cutover. No phase requires a migration
under Option A.

- **Phase 0 - Decisions + scaffold.** Lock Option A, lock fee-accounts-stay-on-v1, add the flag, and
  stand up an empty `DayEntryV2` route/component that receives the same props as `DayDetail`. Ships
  nothing user-visible.
- **Phase 1 - Two-pane shell + left list (parity, no rail yet).** Render the service list in the left
  pane reusing `renderRate`/`deriveUnit`/`isInServiceOnDay`/the flag pills, with sticky group headers,
  sticky column labels (shared subgrid so labels sit over data), and the count inputs wired to the
  same edit state. No behavior change vs the modal's entry; just the new layout. Acceptance: enter,
  ghost/0/entered, archived, mark-no-service all behave as today.
- **Phase 2 - The live rail (replaces the Review screen).** Build the rail: live total (reusing
  `enteredTotals`/`dayProjection`), progress, the forming invoice (all services, entered solid +
  pending ghost, per-group subtotals via the existing memos), the ride-along note field, and Confirm
  wired to the existing `onSave` path with queue/noteFailed handling. Delete the separate Review
  screen. Keep the success/seal state. Acceptance: totals foot, queue works, notes ride, discard guard
  intact.
- **Phase 3 - Keyboard grid.** Arrow up/down, Enter-advance, group jump, `Cmd/Ctrl+Enter` confirm,
  focus management across groups and on day-nav. Acceptance: a full day enterable without a mouse.
- **Phase 4 - Motion / positive-feedback layer.** Row flash, Match-all cascade, total pulse, progress
  shimmer, group-complete stamp, Confirm pulse, seal - all `prefers-reduced-motion`-guarded.
  Acceptance: motion off = instant, no layout shift; motion on = crisp, <300ms.
- **Phase 5 - Mobile.** Single-column list + sticky total bar + bottom-sheet bill (note + Confirm),
  reusing the same state and save. Decide quick-edit vs full-entry framing (open question below).
- **Phase 6 - A11y audit + cutover.** Run the 4-part design audit + WCAG pass, verify every preserved
  behavior from section 7, then flip the flag for per-meal accounts. Keep the modal one release as a
  fallback before removing it.

---

## 9. Migration & rollback risk

- **Schema/data:** none under Option A. The data layer, view, and rounding are untouched.
- **Rollback:** flag off -> current modal. Because v2 is additive and reuses the save path, there is
  no data risk from running it alongside v1.
- **Real risk area:** behavior parity (section 7), not the money. The mitigation is treating those as
  hard acceptance criteria per phase and keeping the modal live through one release post-cutover.
- **Second-order risk:** anything auth/session-adjacent is not involved here (no auth surface
  changes), which keeps the blast radius contained to the entry UI.

---

## 10. CC build sequence (how it gets delivered)

One phase per PR, each opened as a normal PR (no migration under Option A), each with the deploy +
screenshot loop and the section-7 acceptance checklist. Order:

1. Flag + `DayEntryV2` scaffold (Phase 0).
2. Two-pane shell + left list parity (Phase 1).
3. Live rail + Confirm-via-existing-save, delete Review screen (Phase 2).
4. Keyboard grid (Phase 3).
5. Motion layer (Phase 4).
6. Mobile bottom-sheet (Phase 5).
7. A11y audit + cutover flag flip (Phase 6).

Chat-Claude writes each phase as an intent-first CC prompt (decisions, constraints, reuse targets,
acceptance criteria - code only where a specific implementation must be pinned). Kevin merges each;
CC never merges.

---

## 11. Open decisions for you

1. **Save model: confirm Option A** (live rail replaces the Review screen; Confirm keeps the existing
   write path; autosave deferred as a separate decision). This is the one that gates everything.
2. **Coexist or replace:** v2 behind a flag alongside the modal, cutover per-account after Phase 6
   (recommended), vs a harder switch.
3. **Fee accounts stay on v1** for now (recommended) - confirm.
4. **Mobile scope:** "quick edits / a service or two on the floor" vs "full day entry on a phone."
   This changes how hard we push the bottom-sheet and whether mobile is a Phase 5 must or a fast-follow.
5. **Priority:** where this sits relative to Stage 5 (finance CSVs), the Admin Dashboard, and the
   Fun Money Tracker. My default: it stays parked behind Stage 5 unless you want the entry win
   sooner. (Close Day was previously in this list; removed 2026-08-01 - shipped as mark-no-service
   + sc-25 period lock.)

---

## TLDR

The money engine is fully reused, so v2 is a presentation+interaction redesign, not a rewrite. Take
Option A (live rail replaces the Review screen, keep the deliberate write path, defer autosave) - it
delivers the live-bill experience you liked while preserving the hardened, auditable save on a billing
number. Build it in 6 flag-guarded phases with zero migration and instant rollback, treating the two
dozen existing entry behaviors as acceptance criteria. The only thing blocking a green light is your
call on the five decisions above - primarily the save model.
