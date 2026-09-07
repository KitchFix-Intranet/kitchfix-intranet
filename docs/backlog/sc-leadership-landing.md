# SC leadership landing - the corp-tier gap

**Filed:** 2026-09-09.
**Status:** Deferred, post-training.
**Trigger to unpark:** post-training, once a real leadership user has clicked around long enough for the gap to shape a design conversation.

---

## What this is really about

Shane Lynch (RDO East) is not an edge case. He is the **first instance of a class**. Every corp-level user - RDOs (East + West + generic), CEO, VP Ops, Director of Ops, Director of Culinary, Corporate Field Chef, HR, Staff Accountant, Joe and Kevin at owner tier - lands on `CORP` (or fallback CIN - AZ if no mapping) and sees an empty Season overview.

**There is no mechanism today tying a leadership user to the accounts they oversee.** `user_accounts_derived` is a 1:1 email → account view. A leadership user with responsibility across multiple accounts has no representation of that fact in the DB and no landing surface built for it.

Today's behaviour is a functional degradation, not a broken flow: the account picker at the top of the page is always there, so Shane clicks TBJ - FL (or TBR - FL, or CIN - KY, or wherever he's coaching next) and gets on with his day. But there is no view that says *"here are the four accounts you're accountable for this week."*

## The training-week fix Kevin ruled

**Option 4: do nothing.** Shane lands on CORP → Season overview (mostly empty) → clicks TBJ - FL from the dropdown → coaches Diego. One extra click. Not a bug worth risking a schema move during training.

## Why the other three options were refused

**Option 1 (mutate `people.account_key` to TBJ - FL)** would make Shane a TBJ employee in the Rippling-sourced record to fix a landing page. `people.account_key` feeds payroll allocation and org-chart derivation - corrupting HR truth to fit a UI convenience is the wrong trade, and it is the same instinct we refused when the fee table wanted to hold the period split.

**Option 2 (flip `user_accounts_derived` precedence so manual overrides `people`)** is worse in a quieter way. It contradicts the view's own docstring (*"owner-level access, no Rippling worker record"* - explicitly narrows manual to the additive case) and changes behaviour for every future row added under the old assumption. A shared view is the wrong place to solve one person's landing page.

**Option 3 (new `sc_landing_override` table read by SC alone)** is the right shape for the SC-scoped concern - the concern belongs to SC, so the table should too. But it is **only half** of the real gap: an override table lets you pin ONE account per leadership user. That still says nothing about the multi-account portfolio they oversee.

## The other half: a leadership landing surface worth landing on

Option 3 answers "which account should this leadership user auto-select?" The unanswered question is "**what should a leadership user see instead of a single account's Season overview?**"

Candidate shapes (report-only, not proposals):

- **Portfolio grid**: a row per account the user oversees, columns for period status + overdue count + last-finalized week. The RDO clicks a row to drill into an account's normal Season overview.
- **Cross-account week timeline**: fixed set of columns (week 1, week 2, ...), one row per account, cells coloured by finalize status. Reads across sites at a glance; a red cell is the operator moment.
- **Exception feed only**: no static overview, just a chronological list of things that need attention across the user's accounts (chase escalations, un-approved days in the finalize window, invoice failures).

Which shape is right depends on how leadership actually uses the SC once training is done. Kevin's read: **not for this week.**

## The account-membership question underneath

Any of the above requires answering: **which accounts does a leadership user oversee?**

Today the only signals are:
- `contacts.team_key` — hand-maintained, has been shown to disagree with reality already (see `two-fields-one-truth.md`).
- `people.account_key` — 1:1 per person; for corp-level roles it is `CORP`, which doesn't enumerate the accounts they cover.
- `contacts.role` — string classifiers like "Regional Director East" which imply a set of accounts (all East-region MLB + MiLB accounts) but the region-to-account mapping is nowhere in the DB.

A leadership landing surface needs either:
- **Explicit membership**: an `sc_account_membership(email, account_key, role_in_account)` many-to-many table, populated per-person. Highest fidelity, highest maintenance cost.
- **Implied membership via region + role**: encode the region-to-account map somewhere (`sc_region_accounts`?), derive membership from `contacts.role` region string. Lower maintenance but requires curating the region map.
- **Owner-set portfolio per user**: `sc_leadership_portfolio(email, account_key[])`, similar to option 1's override table but with an array. Simple, hand-maintained, meaning-preserving.

## Related backlog

- `docs/backlog/two-fields-one-truth.md` — the recurring class of `contacts.role` vs `people.title` disagreement. Same DB shape underneath: two fields with overlapping meaning, no authoritative source. A leadership landing surface would multiply this problem across membership signals unless the answer picks one authoritative source up front.

## What lands right after training

- **Do the survey Kevin already ruled**: `people.account_key` consumers list. Option 1 was refused specifically because the blast radius is unknown; a small survey would name it and either allow Option 1 in principle for future cases OR confirm the "never mutate for UI reasons" rule.
- **Then the leadership design conversation** with the three shapes above (portfolio grid vs cross-account timeline vs exception feed). Not a design document written in isolation - a working session with Shane after he has actually used the SC for a week.
- **Then Option 3 + the leadership landing surface as one PR arc**, not two. The override table is only useful in combination with a surface worth landing on.
