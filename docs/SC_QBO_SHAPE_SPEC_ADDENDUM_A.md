# SC -> QBO SHAPE SPEC · ADDENDUM A

**Target repo path:** `docs/SC_QBO_SHAPE_SPEC_ADDENDUM_A.md`
**Status:** RULED by Kevin 2026-08-11. Extends the signed spec v1.0. Where this
addendum and the base spec disagree, this wins and the base spec gets amended.
**Renders approved:** `KF_FINALIZE_FLOW_RENDER.html` (flow),
`KF_NOTIFICATION_RENDERS.html` (N1-N4 content and copy). Both are the visual and
copy authority for the build.

---

## A1 · The finalize experience

The bare button is replaced by a confirmed flow. Six states:

| State | Treatment |
|---|---|
| **Blocked** | Disabled button + one clickable chip per missing day, each jumping to that day's entry. No prose-only reasons |
| **Ready** | Enabled button, right-aligned in the week action bar. Week total stays in the header; the button does not repeat it |
| **Confirm** | Modal overlay (§A2) |
| **Working** | Modal switches to four named progress steps: Locking the week · Building the invoice · Creating the draft in QuickBooks · Telling billing |
| **Done** | Toast, then a quiet one-line caption in the row: `Finalized {date} by {name} · Sent to AP for review`, plus `Unlock` for the override group only. **No QuickBooks link** - operators have no QBO access |
| **Failed** | The one state that keeps colour and weight. Red banner, Retry and Unlock for the override group |

**Why Done is quiet:** it will sit on every past week for the rest of the
season. The toast carries the moment; the row only records it.

## A2 · The confirmation overlay

Title: `Finalize the week of {date}?`
Subtitle: `Send finals to QuickBooks for AP review and billing to client.`
Working title: `Finalizing the week of {date}`
Working subtitle: `Creating the invoice in QuickBooks. AP will review and send
to client.`

Rows, in order: Account · Service week · Days served · Meals and snacks ·
Invoice goes to · **Pre-tax total** (display tier, the visual anchor).

- A `TEST MODE` badge renders in the overlay header whenever the account's
  `qbo_mode = 'test'`, and the destination row reads
  `ZZ TEST - KitchFix Intranet`. Nobody can push to test believing it is live,
  or the reverse.
- Lock warning, amber: `This locks the week. After this you cannot change these
  numbers. Kevin, Joe, or Sebastian can unlock it.`
- **No recipient list.** Ruled out as redundant - everyone on it receives the
  email anyway.
- Dialog semantics: `role="dialog" aria-modal`, full focus trap, Esc closes,
  focus returns to the invoking button.

## A3 · Month boundaries - Option A (ruled)

**A week is always the whole Mon-Sun week.** When a month cuts through it:

- The week renders complete in **both** months with the same total.
- Days belonging to the other month render ghosted (reduced opacity) but are
  **counted** in every figure and in the completeness rule.
- The week header carries a tag naming the overlap: `3 days in July`.
- One button, on the whole week, in either month. Finalizing from August
  finalizes the same week as finalizing from July - it is one week.

**Why ghosted and not hidden:** a leader looking at August must see that the
total includes three July days, or the number looks wrong. Hiding them would
make the button lie about what it finalizes.

## A4 · Bi-weekly pairs (CIN - AZ)

Only the **closing** week of a period-aligned pair carries a button.

- First week of a pair, when complete: quiet state
  `Week complete - finalizes with Week {n} on {date}`.
- Closing week: `Finalize 2-week period`, and the header carries the pair
  total alongside the week total.
- If the first week is incomplete when the closing week is ready, the button
  disables and names it: `Week {n} still needs {k} days`, with the same
  clickable chips. **A pair cannot half-close.**
- Pair membership derives from the fiscal calendar (weeks 1-2 and 3-4 of each
  period), never from anchor arithmetic. P13 hard-fails with a named error.

## A5 · Test mode - one capability, one switch

Rejected: a separate test mode with its own code path. **Ruled:** a per-account
flag `qbo_mode` in `('test','live')`, default `'test'`.

| Behaviour | `test` | `live` |
|---|---|---|
| QBO customer | 22463 ZZ TEST | the account's real customer |
| TxnDate | shifted to the 2029 weekday equivalent | the real closing Sunday |
| Invoice markers | CustomerMemo, PrivateNote, `TEST - ` line prefixes | none |
| Ledger row | `status='test'`, `is_test=true` | `status='created'` |
| **Notification recipients** | **Kevin only**, subject prefixed `[TEST]` | the full matrix |
| Who may finalize | the override group only | anyone with entry rights |

The same button, the same code path, the same notifications. Only the
destination changes. TXR - AZ and CIN - AZ sit in `test` until they graduate;
Kevin flips them to `live` per account. After go-live the flag remains as the
safety valve.

**Recipient override is structural, not conditional:** the resolver returns
Kevin's address and nothing else when the account is in test mode. There is no
code path in which a test finalize can email a site leader or a client.

**Slack posts in test mode, marked (amended by Kevin 2026-08-13).**
`#service-calendar-invoices` has one member today, so test-mode Slack is
enabled rather than suppressed - the copy is worth seeing in place. Because
channel membership is a fact about today and not a property of the system,
every test-mode post is hardened: the message opens with a `[TEST]` prefix and
closes with a one-line footer stating it is a test with no client impact. A
member who joins later cannot mistake one for real. Email recipients in test
mode remain Kevin and only Kevin.

**N1 posts to Slack (amended by Kevin 2026-08-14).** The same
`#service-calendar-invoices` webhook carries N1 posts alongside N2. Same
`[TEST]` prefix + test-footer rules apply in test mode. Slack content stays
tight - account, week, days served, meals, pre-tax total, one line stating
the draft is in QuickBooks for AP review; the email carries the fuller
line-summary and CTAs. The Slack channel is where a team member sees the
signal ("a week finalized") without needing to be on the email list; the
email carries the full readable record.

## A6 · Notification matrix, amended

| # | Event | To | cc | Channel |
|---|---|---|---|---|
| N1 | Invoice ready | Sebastian, Kevin, Joe, Josh, the account's salaried managers, the submitter | - | Email + Slack (`#service-calendar-invoices`) |
| N2 | Push failed | Kevin, Sebastian | - | Email + Slack (`#service-calendar-invoices`) |
| N3.1 | Friday 12:00 local reminder | the account's salaried managers | Kevin, Sebastian | Email |
| N3.2 | Monday 12:00 local, urgent | the account's salaried managers | Kevin, Sebastian | Email |
| N3.3 | Tuesday 09:00 local, past due | the account's salaried managers | Kevin, Sebastian, **the account's RDO** | Email + Slack (`#service-calendar-invoices`) |
| N4 | Credit needed | the adjuster, Joe, Josh, Sebastian, **the account's RDO** | - | Email + admin flag |

**RDO cc ruled 2026-08-11:** RDOs join N3.3 and N4 only. N1 was considered and
declined - it fires weekly per account and would train RDOs to filter the
sender, which would cost them N3.3 when it matters.

**N5, proposed not scoped:** a Tuesday-morning digest, one email per RDO
covering every account in their region - who finalized, totals, who did not.
The right answer to regional visibility, and one email instead of four.

**N1 open question, carried:** one email serves two audiences with different
jobs. Its primary CTA now points at the Service Calendar (everyone has it) with
the QuickBooks link secondary and labelled for AP and leadership. If it reads
wrong to either group, split it into an AP version and a site version.

## A6b · Slack channel

All billing Slack posts go to **`#service-calendar-invoices`** via
`SLACK_SC_BILLING_WEBHOOK_URL` (incoming webhook on the existing KitchFix app,
created 2026-08-11). Distinct from `SLACK_SC_WEBHOOK_URL`, which stays with the
Service Calendar's operational alerts (schedule drift, price-change smoke).
Missing variable = Slack silently skipped, matching every other webhook in the
codebase; email delivery is never blocked by a missing webhook.

## A7 · Copy and access rules

- Operators have **no QuickBooks access**. No operator-facing surface links to
  QBO. Outcomes are stated in the operator's terms: `Sent to AP for review`.
- `AP` is the role in copy; Sebastian's name is used where it is personal.
- Subject lines follow `State: Account, week` - `Invoice ready:`,
  `Push failed:`, `Reminder:`, `Action needed:`, `Past due:`, `Credit needed:`.
- Production email must be table-based, inline-styled markup. The renders are
  design previews; content and hierarchy carry over exactly, the CSS does not.

## A8 · Open items

1. **RDO-to-account mapping has no confirmed source.** Shane Lynch is RDO East
   and Ryan Moore RDO West by memory, but the account assignment must come from
   real data. If no authoritative source exists, Kevin supplies it and it
   becomes config - never inferred.
2. **N5 digest** - proposed, unscoped.
3. **N1 audience split** - carried.
