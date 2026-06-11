# MODULE 7 — INV-2 PLAN CORRECTION

**Supersedes:** the INV-2 section of `MODULE_7_DATA_AUDIT.md` (PART 4) and Decision D9.
**Date:** 2026-06-11
**Basis:** read-only recon of `src/lib/inventoryActions.js` + `src/lib/dataStore/inventory.js`
after the Review Queue tool shipped this session (`feat/review-queue-complete-tool`).

---

## Why this correction exists

The audit wrote INV-2 ("Handler rewire, ~14–18h") in a world where the Review Queue resolver
was a deferred stub (D9). We shipped the resolver this session — **and the build also shipped
the dual-write PG mirrors for every resolve path.** They sit dormant behind the dual-write
flags today.

That changes the *shape* of INV-2, not just its size. The rewire labor the audit anticipated is
largely already done. The remaining work is **verification + flag-cutover**, which is a cheaper
but more delicate kind of work. This doc replaces the audit's INV-2 plan with what the code
actually requires now.

The one-line summary: **INV-2 is no longer "write the rewires." It is "verify the pre-built
rewires and flip four flags as a single atomic group."**

---

## 1. Corrected handler enumeration: 30 → 35

The audit's "30 handlers, 7 stubs" is stale. `inventoryActions.js` now exports 35. The delta:
**2 of the 7 audit stubs became real** (`handleResolveQueue`, `handleReviewQueueGet`), and
**6 net-new RQ handlers were added** (Match, Create, Skip, BulkSkip, UndoAction, plus the
read/support handlers UnitList + CatalogItemDetail).

| Handler | Status vs audit | Writes to |
|---|---|---|
| handleResolveQueue | **was stub → now real** | review_queue, ai_line_items, price_history(cond) |
| handleResolveQueueMatch | **NEW** (Accept-suggested + Pick-different) | review_queue, item_aliases, price_history |
| handleResolveQueueCreate | **NEW** (Create-new, skipPriceHistory) | item_catalog, item_aliases, price_history, review_queue |
| handleSkipQueue | **NEW** | review_queue |
| handleBulkSkipQueue | **NEW** (loops skip) | review_queue |
| handleUndoAction | **NEW** (skip/reconcile/match reversers) | review_queue, ai_line_items, item_aliases, price_history |
| handleReviewQueueGet | **was stub → now real** | (read only) |
| handleUnitList | **NEW** | (read only) |
| handleCatalogItemDetail | **NEW** | (read only) |

The other 26 handlers are unchanged from the audit's assessment. **5 audit stubs remain stubs**
and do not write: `handleUpdateItem`, `handleAdminCorrect`, `handleScan`, `handleHistoryGet`,
`handlePrint`.

**The specifically-stale audit sentence to delete:** *"The 7 stub handlers stay stubs (resolver
deferred per D9)."* It is wrong on 2 of 7.

---

## 2. The 10 PG mirrors to verify (the real work)

Every Review Queue resolve path already has a dormant Postgres mirror. INV-2's primary
workstream is verifying each produces writes equivalent to its Sheets path — **forward and
reverse.**

This is not box-checking. **We have a live instance of why it matters:** the
`undoReconcilePostgres` `.eq("description", null)` no-op we caught and fixed *this session* was
exactly one of these dormant mirrors — it looked correct and silently did nothing. There are 10
of these paths. At least one already shipped broken. Verifying the artifact, not trusting the
mirror, is the standing principle that has protected this data all along.

| # | Path | Forward writes | Reverse (Undo) writes |
|---|---|---|---|
| 1 | resolveReviewQueueLine (arith / catch-weight) | review_queue flip, ai_line_items qty/unit, price_history(if matchId) | undoReconcilePostgres — **fixed this session** |
| 2 | resolveReviewQueueMatch (Accept / Pick-different) | review_queue flip+resultItemId, item_aliases, price_history | undoMatchPostgres |
| 3 | resolveReviewQueueCreate (Create-new) | item_catalog (shared), item_aliases, price_history, review_queue | (no undo — Create-new excluded from undo by design) |
| 4 | skipReviewQueueLine (Skip / Bulk-skip) | review_queue → rejected | undoSkipPostgres |

That's 4 forward paths + 3 reverse paths = **7 distinct PG functions**, but each must be checked
against **both** its mid-day-sample behavior and a larger batch, so the practical verification
surface is ~10 forward+reverse checks. Each verified the same way: run the resolve in dual-write,
read the real PG row, confirm it matches what the Sheets path wrote. **Eye-verified, not
count-verified.**

---

## 3. THE CUTOVER CONSTRAINT (the non-obvious finding)

This is the part the audit could not have known, and it falls directly out of the flag-gate
logic in the resolve orchestrators:

- `resolveReviewQueueMatch` fires its PG writes if **any-of-three** flags is on:
  `review_queue` OR `item_aliases` OR `price_history`.
- `resolveReviewQueueLine` fires its PG writes if **any-of-two** flags is on:
  `review_queue` OR `ai_line_items`.

"Any-of" means **a single flag controls a multi-table PG write.** If you turn on dual-write for
just `item_aliases`, then `resolveReviewQueueMatch` fires **all three** of its PG writes —
including a PG write to `price_history` whose own dual-write flag is still off. You'd be writing
to a table you haven't "migrated yet."

And `review_queue` appears in **both** gates. So the two gates are not independent — they share
a flag.

**The consequence — the load-bearing instruction of this whole spec:**

> The four RQ-touched dual-write flags — `review_queue`, `ai_line_items`, `item_aliases`,
> `price_history` — **must be flipped as a single atomic group.** They cannot be staged
> table-by-table. Flipping any subset causes PG writes to tables whose flags are still off,
> which splits a single resolve action across a half-migrated surface — the exact silent-divergence
> failure mode this project exists to prevent.

This is why verification (§2) must complete **before** the flag flip: when you flip the four
flags together, every path they activate must already be verified, because there is no
intermediate "flip one, watch it, flip the next" safety stage available. The gate logic forbids it.

**Cutover sequence:**

1. Verify all 10 forward+reverse PG mirrors in dual-write-dormant state (§2). Eye-verified.
2. Resolve the read-canonical question for the four tables (which source serves reads).
3. Flip the four RQ flags as one atomic group.
4. Observe a full resolve cycle (one of each action type) post-flip against PG-canonical reads.
5. Only then consider turning off Sheets writes for these tables.

---

## 4. Create-new is the one "MIXED" path — verify the Q3 suppression survives

Every other RQ path is cleanly RQ-only (rewire/verify in isolation). **Create-new is the only
path that is both shared and RQ-only**, and it carries the one invariant most likely to break
silently:

- Its **catalog-row half** goes through the **shared** `createInventoryItem` — also called by
  `handleAddItem`. Rewiring `createInventoryItem` for PG covers both callers (good — one rewire,
  two beneficiaries).
- Its **alias + invoice-tied price + queue-flip half** is RQ-only via `writeMatchResolution`.
  Verify separately.
- The **Q3-trap suppression** (`skipPriceHistory: true`) is a parameter on the *shared*
  `createInventoryItem`, but **only ever set true by Create-new.** It suppresses the synthetic
  "manual-add" price_history row so that one resolve writes exactly one price row (tied to the
  real invoiceUuid), not two.

**The risk:** someone rewires `createInventoryItem` to PG for `handleAddItem`'s benefit and
doesn't exercise the `skipPriceHistory: true` branch — because `handleAddItem` never sets it.
The Q3 double-price-row trap silently returns in PG-land. **Explicit INV-2 check:** confirm the
PG path honors `skipPriceHistory: true` and writes exactly one price_history row on Create-new
after the shared function is rewired.

---

## 5. Test-surface gap (name it, don't trip on it)

The RQ resolve flows are **not covered by the green Playwright check** (the
prod-Playwright-against-prod-URL gap). So every one of the 10 PG mirrors is *both dormant and
untested by the gate* — the precise combination (unverified code the safety net doesn't catch)
that has produced every silent failure this project has fought.

**Implication:** the §2 manual verification *is* the stand-in for the automated coverage we
don't have. It's not optional polish; it's the only net under these paths.

**Sub-decision (defer-able):** add Playwright coverage for the RQ resolve flows before cutover,
or accept manual verification as sufficient for the cutover and add coverage later. Lean: manual
verification gates the cutover; automated coverage is a follow-up, not a blocker — consistent
with not ballooning INV-2 scope.

---

## 6. Open decision + revised estimate

**Open decision — the 5 remaining stubs.** Retire `handleUpdateItem`, `handleAdminCorrect`,
`handleScan`, `handleHistoryGet`, `handlePrint`, or leave them?
**Lean: leave them stubs.** They don't write, so they no-op cleanly post-cutover. Retiring them
is scope INV-2 doesn't need — the same "don't redesign mid-migration" fence held on the cron
side. Revisit as their own feature work if/when those surfaces get built.

**Revised hour estimate.** The audit's ~14–18h assumed a stub-RQ world where the rewires had to
be written. With the PG mirrors pre-built by the RQ shipment, the rewire labor is largely
pre-paid; the remaining cost is verification + the four-flag cutover. Estimate: **~18–24h** —
not a doubling. The increase is verification surface (10 paths) and cutover care, not new code.

---

## INV-2 workstreams, in dependency order

1. **Verify 10 PG mirrors** (forward + reverse), eye-verified against real rows. *Highest value
   — at least one already shipped broken.*
2. **Resolve read-canonical** for review_queue / ai_line_items / item_aliases / price_history.
3. **Flip the four RQ flags as one atomic group** (§3 — they cannot be staged).
4. **Verify Create-new's `skipPriceHistory` suppression survives** the shared-function rewire (§4).
5. **D9 retirement** — correct the audit's handler enumeration (§1); leave the 5 non-writing
   stubs as stubs (§6).
6. **Test-surface** — manual verification gates cutover; Playwright coverage is a follow-up (§5).

No code touched in producing this. This is the plan; execution remains gated on the inventory
cutover (which is gated on the dup cleanup, which is gated on the coverage probe).
