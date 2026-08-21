# Track B - backdate AP email + Credit needed admin flag

**Filed:** 2026-08-21, from PR-N audit round 2.
**Status:** Deferred. Its own PR.
**Trigger to unpark:** the credit-decision UI is now recorded on the
changelog but the loop is not closed - operators are picking Issue
credit / No credit and nothing is being sent to AP. First real
backdate on a live account after PR #755 lands makes this urgent.

---

## What this closes

The credit-decision loop for backdated price changes. PR #755 (audit
round 2 commit 1) shipped the decision UI + payload validation +
`sc_config_changelog.new_value` JSONB record. The operator's choice
is captured; nobody is emailed. Track B ships the transmission side.

## What must ship

Per Kevin ruling at K-7 (see `docs/PROJECT_SCOPE_MASTER.md:682`):

- **Backdate email** on save, to: the adjuster, Joe, Josh, Sebastian.
  Content names the account, the service, from/to price, the
  effective date, the affected day count, the closed periods
  touched, the dollar delta, the operator's chosen credit decision
  (Issue / No credit), and the operator's reason. The no-credit path
  leads with the reason - that is where the operator's justification
  matters most.
- **"Credit needed" admin flag** surfaced somewhere admin can see it
  (probably a chip on the price row in the catalog, or a panel in
  the admin overview). Cleared when the AP-side action lands.
- **Both paths email**. The no-credit choice is still a notification
  event - AP needs to know the operator declined the credit so they
  can note it against the account, not chase it.

## What this DOES NOT do

- Does not create the credit memo in QBO. That is AP's manual action.
- Does not decide the credit amount. The operator already picked
  Issue or None; the amount is the `revenueDeltaCents` the backdate
  preview computed and the changelog now records.

## The live UI-lie that predates this

**PR-N shipped copy from 2026-08-19 through 2026-08-21 that said "AP
is emailed with the {credit|invoice} owed ({deltaStr})" on the
backdate warning.** The server had no email path. That copy has been
telling operators a notification was firing that never fired.
Corrected in PR #755 commit 1 (copy removed; the truthful "the
decision is recorded on the changelog; AP notification lands with
Track B" replaces it).

**Any backdated price change landed in that window went to AP nowhere.**
If ops has been operating on the assumption those emails were flowing,
credit memos may be sitting undone. Worth a scan of
`sc_config_changelog` for backdate rows in that window:

```sql
SELECT account_key, entity_label, effective_date, changed_at, reason,
       (new_value->>'creditDecision') AS credit_decision
FROM sc_config_changelog
WHERE entity_type = 'price'
  AND effective_date < changed_at::date
  AND changed_at >= '2026-08-19'
ORDER BY changed_at;
```

Rows in that scan with no `credit_decision` field predate the
decision UI - the operator was never asked. Rows with a decision
field were captured but not transmitted. Track B needs to figure out
how to reconcile that backlog when it ships.

## Pointers into the code

- Decision-recording site: `src/lib/dataStore/serviceCalendar.js` -
  the `updateServiceConfigPostgres` price branch, `newValue` object.
- Server validation site: `src/app/api/service-calendar/route.js` -
  the `sc-config-update` price-change validation block, checks
  `c.creditDecision` on any change with `c.allowBackdate === true`.
- Client UI: `src/app/service-calendar/admin/EditorRail.js` -
  `RailService`, the `scav-credit-choice` block, renders when
  Backdate mode has a valid date + price + priceChanged.
- Track B disclaimer text: `RailService` `.scav-credit-track-b`
  paragraph. Copy is intentionally in-line so operators see it
  every time until Track B lands.

## Related backlog

- `docs/backlog/ADMIN_HISTORY_PANELS.md` - per-service and per-fee
  history panels. Fee history reuses `sc-admin-fee-history` which
  already exists; per-service needs a new endpoint. Both are their
  own PRs and independent of Track B.
- `docs/backlog/CROSS_ACCOUNT_ADMIN_SEARCH.md` - the other UI lie
  from PR-N that the audit caught. Same discipline gap that produced
  this one.

## Discipline note

This gap exists because chat-claude specced the "AP is emailed"
copy in PR-N and I built it without verifying the write-through.
The pattern - render specifies copy describing a behaviour, code
never gets the behaviour - repeats. Feedback memory saved at
`~/.claude/projects/-Users-kevinfietek/memory/feedback_verify_behaviour_before_shipping_copy.md`
covering: when a render/spec specifies copy describing a behaviour
(AP notified, email sent, sync started), verify the behaviour
exists on the server before shipping the words.
