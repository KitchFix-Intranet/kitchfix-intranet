# Cross-account admin search

**Filed:** 2026-08-21, from PR-N (SC admin three-pane rebuild).
**Status:** Deferred. Not scheduled.
**Trigger to unpark:** anyone (Kevin or operator) asks for it, OR the
account roster grows enough that "pick the right account first" is
friction operators complain about.

---

## What is missing

The admin's command-bar search filters only the currently-selected
account's catalog. Spec state 11 of
`docs/design/KF_ADMIN_BUILD_SPEC.html` originally read "Search covers
every account, not just this one" and the demo JS ran the filter
client-side across ONE account's data. The build ships single-account,
matching the actual data path.

Empty-search copy in `src/app/service-calendar/admin/CatalogPane.js`
was corrected during PR-N review to name the scope honestly: "No
service matches X in this account's catalog." A screen promising
cross-account search that does not do it is worse than one that does
not promise it - Kevin ruling, 2026-08-21.

## Why the build shipped single-account

Standing fence on PR-N: no migration, no API change, no new endpoint.
Cross-account search would need one of:

- **A new endpoint** `sc-admin-search-services` that queries
  `sc_services` across all accounts with a name/group LIKE filter.
  Simplest server implementation; violates the PR-N fence.
- **A `sc-admin-all-config` extension** that returns service NAMES
  in addition to per-account service COUNTS. Bigger payload; the
  current endpoint intentionally returns counts only so the accounts-
  overview call stays small. Also a fence violation (API change).
- **Client-side bulk load**: on admin mount, fetch
  `sc-admin-account-config` for every account and index client-side.
  N per-account round-trips at admin boot; large payload; UX
  regression on first admin open.

None of these fit inside a PR bound by "how they are reached, not
what they do." Deferred to a separate PR with its own fence and its
own recon.

## What the follow-up looks like

**Scope:**
- One new endpoint `sc-admin-search-services` returning a flat list
  of `{ accountKey, groupId, groupName, serviceId, serviceName, price,
  isArchived }` filtered by a `q` query parameter.
- Command-bar search results become a dropdown (or overlay panel)
  listing hits across accounts, grouped by account, with a click
  that switches to that account + preselects the service.
- Empty-search copy reverts to "Search covers every account, not
  just this one" only after the endpoint lands. Not before.

**Constraints:**
- Reason auth boundary already carried by every other `sc-admin-*`
  action; add the same admin check on this one.
- Query length + rate-limit like other search-shaped endpoints.
- Return archived services with a flag; the admin surface can
  render them muted, letting operators find archived items too.

**Non-scope:**
- Fuzzy matching. Substring is fine.
- Cross-account bulk edit. Just navigation.

## Where the pieces live today

- Command bar with the search field: `src/app/service-calendar/admin/AdminCommandBar.js`
- Search state + current-account filter: `src/app/service-calendar/admin/AdminPanel.js` (`search` state)
  and `src/app/service-calendar/admin/CatalogPane.js` (filter logic).
- Empty-search render: `CatalogPane.js` `q && totalVisible === 0` branch.
