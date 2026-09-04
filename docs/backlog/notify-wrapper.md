# notify() wrapper - single call-site over recipient-lookup + send + audit

**Filed:** 2026-09-04, after notify-1 shipped the reader half of
the recipient-lookup path.
**Status:** Deferred. Its own PR after training week.
**Trigger to unpark:** as soon as a third call-site adopts
`getNotificationRecipients` and copies the same recipient-lookup +
send + failure-handling scaffolding, the abstraction earns its
keep. Two is a coincidence; three is a pattern.

---

## What this closes

The notification path assembled ad-hoc across the codebase.
notify-1 moved the recipient list to Postgres and shipped
`getNotificationRecipients` as the reader; every send site still
handles the recipient-lookup + mail construction + audit + failure
telemetry inline. Different sites make different mistakes: one
returns success when the send failed, one swallows the read error
and reports empty, one writes the dedupe key before confirming
delivery.

The wrapper is a single `notify(actionKey, payload)` function that:

1. Reads recipients via `getNotificationRecipients(actionKey)`;
2. Discriminates `unknown-key`, `empty-config`, and `error` returns
   from the reader (Ruling 6);
3. Sends the mail (or Slack, per action_key config);
4. Records the send result to the audit trail;
5. Reports success only after the send returns success from the
   provider, never before.

## What must ship

- `src/lib/notifications/notify.js` - the wrapper. Takes
  `(actionKey, payload)`, returns a discriminated result shape
  `{ status: 'sent' | 'no-recipients' | 'unknown-key' | 'send-failed' | 'read-failed', ... }`. No swallow-into-empty.
- Refactor the three known call-sites to use it:
  - PAF admin notifications (notify-1 landed the reader; wrap the
    send path);
  - N1 finalize-day mail (per-slot QBO deep-links);
  - Chase ladder N3.1 + N3.2 Slack fanout.
- Delete the inline recipient-lookup + send scaffolding at each
  call-site. If a call-site needs a bespoke send option (Slack
  channel override, additional CC), it goes as a payload field
  the wrapper reads, not as bespoke code.
- Extend the seed in `notification_recipients` with a `channel`
  column (mail / slack / both) so the wrapper knows which
  transport to use per action_key.

## What this DOES NOT do

- Does not change the recipient config itself. The 37 rows across
  13 action_keys in `notification_recipients` stay as-is; only the
  call-site code changes.
- Does not add retries. The provider's success return is the
  authority; a failure surfaces to the caller so the caller can
  decide whether to retry or fail. Silent retry loops belong in a
  different PR.
- Does not build a UI for admins to edit the recipient list. That
  is a separate ask if it ever earns its keep - today the config
  is edited via SQL.

## The three inline patterns this collapses

- **Recipient lookup** - each site does its own `getRecipientsForActionKey` call, its own null-check, its own decision about what to do when the list is empty. The wrapper decides once.
- **Send + capture** - each site builds its own `mailgunSend()` or Slack `chat.postMessage()` call and constructs its own success predicate. The wrapper does this once, matching what the provider actually returns.
- **Audit trail** - some sites log to `notification_audit`, some don't. The wrapper logs unconditionally with the discriminated status so a later drill-in sees what happened.

## Pointers into the code

- Reader: `src/lib/notifications/getNotificationRecipients.js` -
  the notify-1 landing. Returns `{ status, recipients }`. Throws
  on read error per Ruling 1.
- Existing send sites:
  - `src/lib/notifications/sendPafAdminNotifications.js` - the
    notify-1 refactor target for the wrapper's first adoption.
  - `src/lib/sc-billing/sendFinalizeMail.js` (N1) - per-slot
    QBO deep-links, currently builds recipient list ad-hoc.
  - `src/lib/sc-billing/chaseLadder.js` (N3.1 / N3.2) - Slack
    fanout from PR #997, another ad-hoc recipient path.
- Audit table: `notification_audit` (already exists from earlier
  work; check the column shape before the wrapper writes to it).

## Related backlog

- `docs/backlog/chase-ladder-option-b.md` - if Option B (dedicated
  Slack channel per account) lands, its recipient shape is per-account
  not per-role. The wrapper's payload shape needs to accommodate
  both; design the notify() signature with that in mind.
- `docs/backlog/sheets-retirement.md` - both are cross-module
  abstractions that make future changes safer. Independent PRs.

## Discipline note

Every silent-failure the arc captured in the "operation that
reports success regardless of outcome" GOTCHAS meta-entry ran
through code that predates any wrapper. Three of the five
instances were send-related. The wrapper does not fix a specific
bug; it eliminates the surface where the class of bug can be
written by accident.
