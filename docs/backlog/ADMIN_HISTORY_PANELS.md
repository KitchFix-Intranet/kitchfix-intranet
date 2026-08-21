# Admin history panels - per-service + per-fee

**Filed:** 2026-08-21, from PR-N follow-up audit.
**Status:** Deferred. Not scheduled.
**Trigger to unpark:** anyone asks "what was this before" while in the
admin rail and finds themselves grepping the changelog.

---

## What is missing

The rail form asks the operator to change a price or a fee. The
question "when did this last change and who changed it" is the one
someone asks immediately before changing it again, and today it has
nowhere to land on-screen. Two panels are missing:

- **Per-service price history** in the per-meal rail, below the form.
  Kevin ruling: last three entries, effective date + price + who.
- **Per-fee history** in the fee-account rail, opened by the existing
  "Fee history" footer link.

The two are separate PRs because the endpoint story is different.

## Cost table

### (a) Per-service price history

`sc-admin-price-history` does NOT exist. Confirmed via full grep of
`src/app/api/service-calendar/route.js` (see PR-N follow-up audit
answer, 2026-08-21). Three ways to ship it, in cost order:

| Option | Cost | Fence? |
|---|---|---|
| **New endpoint** `sc-admin-price-history?serviceId=X&limit=3` reading `sc_config_changelog` filtered to `entity_kind='price', entity_id=X`. | Small - one SELECT + admin-gate. | New endpoint. Needs a PR with a fence that permits one. |
| **Extend `sc-admin-account-config`** to include a `recentChanges: [...]` array on each service in the response. Same query per service, done server-side in the existing endpoint. | Payload gets bigger on every account load; per-service N-plus-one against `sc_config_changelog` unless a single `IN (...)` covers them all. Latency risk on large accounts. | Response-shape change. Fence-line depending on how strictly "no API change" is read. |
| **Read `sc_config_changelog` client-side** via the service-role Supabase key. | Zero server work. | Never - exposes admin data client-side without server-side authz. Rule out. |

Recommend option **(a)** with a scoped PR that carries a "new
endpoint permitted" fence for exactly this route. Keeps the query
targeted per service selection (single row-set on click, cached
per service for the session).

### (b) Fee history wire-up

`sc-admin-fee-history` **already exists at** `src/app/api/service-calendar/route.js:884`.
It was the read path for the retired `FeeAccountEditor`'s inline
history list. The action is wired server-side, admin-gated, and
untouched by PR-N.

The rail's "Fee history" footer button today opens a warn-tier toast
saying "Design pending." The wire-up is a client-side change only:
call the existing action on click, render its response in a rail
mode (or slide-out, or modal - design pending), no server work.

**Recommend making this its own standalone PR** - it is the cheap
half and lands under any fence, including PR-N's original "no new
endpoint." Doing (b) alone would fix half of the two audit items
(P1-7 for fee accounts) and set up the render shape that (a) can
reuse when it lands later.

## What both panels have in common

- Last N entries (Kevin's ruling: three).
- Columns: **effective date + amount + who** (`changed_by` column).
- Order: DESC by `effective_date`.
- Live below the form, not overlaid.
- Only render when the panel has content - a service or fee that has
  changed exactly once should NOT show an empty history block. PR-N
  addressed that structurally by pulling the footer links up under
  the form when there is no history to render; the same pattern
  works when the history query returns zero rows.

## Where the pieces live today

- Rail dispatcher: `src/app/service-calendar/admin/EditorRail.js`
- Fee-history footer button (currently opens a design-pending toast):
  `src/app/service-calendar/admin/EditorRail.js` `RailFee` component,
  `onOpenFeeHistory` prop wired in `AdminPanel.js`.
- View-history footer button on archived services: same shape as
  fee-history above, same "design pending" toast, waits for the
  per-service panel to land.
- Table: `sc_config_changelog` (shared by prices, fees, archives,
  reactivates, labor). Filter by `entity_kind` + `entity_id`.

## Why now, not in PR-N

Q1 was ruled to build the per-service panel in PR-N under a
"wire-up of an existing action" premise. The action does not exist.
PR-N's fence was "no new endpoint" and the audit correction (2026-08-21)
withdrew Q1 rather than admit an endpoint under the fence. The panel
gets its own PR with its own fence and its own recon.
