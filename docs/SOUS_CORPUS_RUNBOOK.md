# Sous Corpus Runbook

> How the corpora Sous reads stay in sync with reality.
> Written 2026-08-04 for v2.0 close-out (PR feat/sous-v2-closeout). Verified
> against the codebase and workflows in that commit.

Sous reads three corpora at request time. Each answers a different family of
questions and each has its own refresh path:

1. **The Playbook** - MDX documents under `content/documents/` in this repo.
   Sous retrieves via semantic search over document chunks in Postgres.
2. **The Service Calendar** - operational meal counts, revenue, service
   prices, homestand and PDC-phase orientation. Live Postgres reads on
   every tool call.
3. **The directory** - people (`contacts`) and accounts (`accounts`). A
   frozen bulk load; every row shares `updated_at = 2026-05-27`.

If Sous cannot answer a question you know is answerable somewhere in the
company, the fault is almost always one of: (a) the corpus is not refreshed;
(b) the tool for that dimension does not exist; (c) the question needs a
dimension Sous structurally cannot see (see `SOUS_V2_STATE.md` blind spots).
This runbook covers (a).

---

## Playbook documents (`content/documents/*.mdx`)

### What has to happen for Sous to answer from a new or edited doc

**Automatic on push to `main`.** The `.github/workflows/opd-autoprojection.yml`
workflow watches `content/documents/**` and runs on every push to `main`:

1. `node scripts/content/project-catalog.mjs --apply` runs the projection
   (MDX -> Postgres: `documents`, `document_relationships`,
   `document_surfaces`, `document_content`).
2. For each changed MDX file in the push range, `node scripts/sousai-embed-doc.mjs <doc_id>` re-embeds the doc for SousAI retrieval (chunks -> embeddings -> `document_chunks`).
3. `POST-*` (poster) docs skip step 2 by design; they have no text to embed.

The workflow serialises on a named concurrency group so multiple pushes queue
rather than race the projection's transactional swap.

**Which means: no manual step is required for content already merged to
`main` through the normal path.**

### The two paths a doc gets to `main`

1. **In-app authoring** (cockpit / `/playbook/admin` editor). Writing edits
   an MDX under `content/documents/`, opens a PR to `main`, and turns on
   GitHub native auto-merge. Once the required Playwright check passes, the
   PR self-merges and the auto-projection workflow fires. Author sees a
   "Submitted for publish - PR #N" confirmation in the editor.
2. **Direct-commit / branch-and-PR** (git-native). Same content path
   (`content/documents/*.mdx`), same workflow trigger. The MDX schema and
   frontmatter conventions live in `docs/STD-001.mdx` and the OPD spec docs.

Either path lands the same MDX in `main` and fires the same workflow. There
is no third path.

### First push to a brand-new branch

The workflow's push-event handler checks `github.event.before`. On the first
push, that value is all-zeroes (no prior SHA to diff against), so the embed
step is skipped and only the projection runs. The next real push, or a
manual `workflow_dispatch` with the doc id, will embed. If you notice a
brand-new doc that Sous cannot see, run the manual dispatch:

```
gh workflow run opd-autoprojection.yml -f doc_id=AGR-042
```

### How to verify Sous can see a new document

Open Sous. Ask a question whose answer depends on that document: a document
name, a section header, or a distinctive phrase. Sous should retrieve it,
cite the doc id on the Source line, and quote from it. If it does not:

1. Confirm the PR merged to `main` (not just opened).
2. Check the `opd autoprojection` workflow run for that push (Actions tab).
   A red run left the projection or embed in a partial state; open the
   workflow logs.
3. If the workflow was green, run `sousai-embed-doc.mjs <id>` locally:
   ```
   node --env-file=.env.local scripts/sousai-embed-doc.mjs AGR-042
   ```
   That verifies the embed path against your own environment.
4. If the embed script itself errors, the doc's status is likely `In Build`
   or `Draft` and the embed step skips non-Live docs by design. Set status
   to `Live` in the frontmatter and re-run.

### What to do when Sous still cannot see it

The escalation ladder, in order:

1. **Doc status.** Only `Live` docs are retrieved. Any other status is
   invisible to search on purpose.
2. **Access level.** Restricted or SLT docs are invisible to unrestricted
   viewers. If the asker is at operator scope, a restricted doc will
   correctly not appear. This is not a bug.
3. **Embedding failed silently.** The projection runs before the embed;
   the doc row lands in `documents` even if embedding fails. Search over
   an unembedded doc returns nothing. Re-run the embed locally with the
   doc id and read the error output.
4. **Text extraction skipped.** `POST-*` (poster) and `PROC-*` (procedure
   variants with the SKIP_TEXT_EXTRACTION marker) do not embed. If the
   dimension the asker wants lives in a visual doc, it is not searchable.
   The doc surfaces via `get_document` by exact id.

---

## Service Calendar entries

### When new actuals appear to Sous

**Immediately.** SC tools read Postgres live on every call. The
`sc_daily_revenue` view aggregates from `sc_service_prices`,
`sc_service_actuals`, and `sc_daily_actuals` in real time. There is no
cache, no snapshot boundary, no scheduled refresh. Save an actual in the
Service Calendar drill-in workspace, and Sous will see it on the next
question that hits an SC tool.

### The tool inventory today

- `sc_account_window(accountKey, window?, asOf?)` - one account, one window
  (month / homestand / period).
- `sc_portfolio_window(window?, asOf?, serviceType?)` - all 12 accounts,
  one window. Optional service-type filter (breakfast / lunch / dinner /
  snack).
- `sc_homestand_detail(accountKey, homestandRef?)` - per-day rows. Requires
  `has_homestand_schedule=true`.
- `sc_service_price(accountKey, serviceNameOrId, asOf?, includeHistory?)`.
- `sc_orientation(accountKey?, date?, scope?)` - current homestand /
  period / PDC phase.

### The tool blind spots (v2.0)

Documented alongside the sanctioned line 12 rule in `agentPrompt.js` and
mirrored in `SOUS_V2_STATE.md`:

- **Service group splits** (Major League / Minor League / Boys and Girls
  Club) - not visible to any tool. Live in the day-entry modal + operator
  export.
- **Service type splits** across all accounts - visible only through
  `sc_portfolio_window`'s `serviceType` filter, one bucket at a time, one
  window at a time.
- **Season-to-date or multi-period aggregation** - tools return one window
  at a time. The operator export has the year view.
- **Day-level detail for accounts without a homestand schedule** - PDC
  sites have no homestand rows. The drill-in workspace has per-day.

### How to verify

Open Sous. Ask a question whose answer depends on a specific SC entry you
just made: a per-day count, a homestand total, a period revenue figure at
a specific account. If Sous returns something plausible but wrong,
compare to the Service Calendar drill-in for the same account + date.
Divergence is worth reporting; it usually means the view definition (or
the projection) has a subtle bug rather than a caching issue.

---

## The directory (`contacts`, `accounts`)

### What the load date means

Every row in `contacts` and `accounts` carries `updated_at = 2026-05-27`.
This is a single bulk load; there is no active update mechanism (no
trigger, no scheduled refresh, no admin surface).

The date `2026-05-27` is captured as a constant in
`src/lib/sousai/tools/data/_constants.js` (`DIRECTORY_LOAD_DATE`), which
every directory tool passes through to the model in the `loaded` field of
its return payload. This lets Sous say "loaded 2026-05-27" honestly even
if a stray `UPDATE` in the future changes the row-level `updated_at`.

### What refreshes it

Nothing, today. When the load date is stale enough to matter (rare - the
leadership directory changes slowly), a fresh bulk load has to be run
manually. The seed script is `scripts/_seed_directory_from_csv.mjs` (or
similar - check the current script name at seed time). After a refresh:

1. Update `DIRECTORY_LOAD_DATE` in
   `src/lib/sousai/tools/data/_constants.js` to the new load date.
2. Update `CONTACTS_TOTAL` and `ACCOUNTS_TOTAL` if they changed.
3. Commit and merge.

The constant lives in one file so all four directory tools speak the same
numbers when the model asks about coverage.

### How to verify

Ask Sous "who is the Executive Chef at CIN - OH?" The answer should cite
`leadership directory (loaded 2026-05-27)` (or the current date if
refreshed). If the person named is wrong, the load itself is stale - not a
tool bug. Point the asker at the directory owner (Kevin) to schedule a
refresh; a stale name is a data problem, not a Sous problem.

---

## Fast summary

| Corpus | Refresh mechanism | Manual step? |
|---|---|---|
| Playbook (MDX) | GitHub Action on push to `main` (auto-project + auto-embed) | No, except first-push-to-brand-new-branch edge case |
| Service Calendar | Live Postgres reads on every tool call | No; save in the UI and Sous sees it |
| Directory | Frozen bulk load, no auto-refresh | Yes - run a fresh seed + update `DIRECTORY_LOAD_DATE` |

If a specific answer looks stale and none of the above explains it, treat
that as a bug report worth investigating. Sous cannot lie about freshness
if the constants and tool payloads agree; if they disagree, the constants
are the honest source.
