# Chase ladder Option B - dedicated site-leader Slack channel per account

**Filed:** 2026-09-04, follow-on to PR #997.
**Status:** Deferred. Its own PR after training week. Task #43.
**Trigger to unpark:** Kevin has trained site leaders on the ladder
and observed enough real N3.1 fires to decide whether the
per-person Slack DMs are getting through or getting lost.

---

## What this closes

The chase ladder currently DMs site leaders in Slack for N3.1 +
N3.2 (PR #997). DMs work but they are private - if the site lead
misses one, nobody else at the site knows the day is overdue.
Option B routes the chase into a dedicated per-account channel
that the site leader, their backup, and Kevin all belong to.
Anyone on the channel can see the day is overdue and any of them
can enter it.

Kevin explicitly deferred this until after training: the channel
proliferation cost (one per account, ~5-8 channels) is not
justified until the DM path has been observed under real load and
proven insufficient. Do not ship Option B on speculation.

## What must ship

- One Slack channel per SC billing-enabled account, named per a
  convention Kevin sets (e.g. `#kf-tbr-fl-billing`). Owner + backup
  + Kevin as members. Named after the account, not the client.
- New column on `sc_qbo_account_map`: `chase_slack_channel_id`
  (text, nullable). NULL preserves today's DM behavior; a channel
  id routes the N3.1 + N3.2 send there.
- Chase ladder read of `chase_slack_channel_id`: if present, post
  to the channel with an @-mention of the site leader; if NULL,
  fall back to the DM. Both paths always run - the channel post
  is additive, not a swap - so a site leader in a channel-enabled
  account still gets the DM as belt-and-suspenders.
- One `notification_recipients` row per (action_key, account)
  pair with `channel = 'slack'` and the channel id stored as the
  recipient. The reader already returns per-key rows; the
  per-account discrimination lives on the caller side. (If the
  [`notify-wrapper`](notify-wrapper.md) landed first, this hooks
  into its per-account payload shape.)

## What this DOES NOT do

- Does not remove the DM path. The DM is the guaranteed path to
  the responsible party; the channel is the visibility path for
  everyone else. Both must fire.
- Does not create channels programmatically. Kevin creates them
  in Slack, records the ids in the DB. Automation of channel
  creation is a separate call.
- Does not change the ladder's escalation timing. N3.1 + N3.2
  fire on the same schedule; only the recipient shape changes.
- Does not fire in test mode. `qbo_mode='test'` keeps the ladder
  quiet regardless of channel config.

## Design decisions to lock before build

- **Channel per account or channel per client?** Some clients have
  multiple accounts (Rays + B&G both belong to TBR - FL via
  separate customers). One channel per SC account is the default;
  Kevin confirms before build.
- **@here vs @-user vs no mention.** N3.1 is a nag, not an alert;
  @here at every fire is noise. Default proposal: @-mention the
  site leader by Slack user id (already in `salaried_manager_emails`
  → Slack user via a lookup helper), no @here / @channel.
- **Weekend behavior.** Chase ladder is date-aware; a channel
  post on Saturday morning for a Friday day should still fire, but
  the copy might say "yesterday" instead of "today" - decide
  before build.

## Pointers into the code

- Chase send site: `src/lib/sc-billing/chaseLadder.js` (PR #997).
- Account map schema: `docs/migrations/sc-40-*.sql` shipped
  `salaried_manager_emails` + `rdo_email`; sc-42 or later adds
  `chase_slack_channel_id`.
- Slack client: existing `src/lib/slack.js` (used by N3.1/N3.2 DM
  path and by the incident + news modules); the channel post is a
  `chat.postMessage` with `channel` set to the id.
- Recipient reader: `src/lib/notifications/getNotificationRecipients.js`.

## Related backlog

- `docs/backlog/notify-wrapper.md` - if the wrapper lands first,
  its per-account payload shape carries the channel id and Option
  B becomes a config-only change on the send side.

## Discipline note

Option A (DMs only) shipped first because it is cheaper and
verifiable. Option B is layered on top only after Option A proves
insufficient. Do not build Option B until the evidence from live
training says the DM path drops - premature build produces channel
proliferation nobody uses.
