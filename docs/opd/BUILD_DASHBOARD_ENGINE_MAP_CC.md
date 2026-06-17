# Build Dashboard - Engine-Deep Field Map + Overlay Migration Scope (CC)

**Author:** Claude Code (Opus 4.7, 1M context)
**Date:** 2026-06-17
**Mode:** Read-only spec. No edits, no PR, no migration apply. Migration SQL written-to-file but unapplied.
**Sibling:** `docs/opd/BUILD_DASHBOARD_AUDIT_CC.md` (design audit; this doc is the engine half).
**Decisions locked (not re-litigated):** `status` -> overlay; `access_level` -> overlay; `sort_order` stays MDX; pin/archive already overlay; New Document deleted; everything authorial stays MDX read-only.

---

## Lead: the highest-risk step (preserve-mode must not wipe current status)

Read this before scoping the rest of the rebuild. The single dangerous moment in the whole migration is the **first `--apply` after the projection-logic change**. If the preserve logic is wrong, every doc's `status` and `access_level` get reset on that run. The full corpus would either fail to upsert (status NOT NULL with no default) or get blanked.

The risk is real because:

- `documents.status` is `TEXT NOT NULL` with **no schema default** (`pr-7-1-opd-schema.sql:44`). Omitting status from the upsert payload causes the PostgREST `INSERT INTO documents (col1, col2, ...) ... ON CONFLICT (id) DO UPDATE` to fail at the INSERT step with `null value in column status violates not-null constraint`. The conflict resolution never runs. Both existing and new rows fail.
- The existing preserve-by-omission pattern that works for `source_drive_id`, `pinned`, `archived` (`project-catalog.mjs:425-427` comment) works because those columns are either nullable or have schema defaults. Status doesn't.

Three implementation paths, ordered by my recommendation:

1. **(RECOMMENDED) Conditional-include via `existing` parameter to `mdxToDocRow`** - no schema change. For inserts, status comes from MDX. For updates, status comes from the existing PG row (effectively a no-op since `EXCLUDED.status === existing.status`). Mirrors Kevin's stated lean: "MDX seeds on insert, overlay owns on update."
2. **(SIMPLER but loses MDX-seed expressivity) Add schema default `status DEFAULT 'Placeholder'`** - omit status entirely from `mdxToDocRow`. Insert gets 'Placeholder' regardless of MDX; update preserves. Lowest implementation risk; loses "MDX seeds initial value."
3. **(MOST WORK) Split-path: separate `.insert()` and `.update()` calls** - replaces the single upsert. Insert gets MDX status; update doesn't touch status. Achieves Kevin's lean. Costs an extra round trip per existing doc on apply (~89 calls instead of 1).

Path 1 details are in Part 2 below. Path 2 is the fallback if Path 1 reveals a subtle bug in testing. Path 3 is overcomplicated and not recommended.

**Backfill SQL:** none needed. The current PG state for status and access_level IS the correct starting overlay state because the projection wrote them from MDX on the last apply. The migration is a *semantic* change (projection stops writing them), not a *data* change. The risk is preserving correctly, not migrating data.

**First-apply safety procedure** (mandatory):
1. Capture a JSON snapshot of `documents.id, status, access_level, updated_at` for every row to `.scratch/preserve-test-baseline.json` BEFORE the projection change ships.
2. Apply the projection change in a branch.
3. Run `--dry-run` and verify the report shows **0 status changes and 0 access_level changes** in the "Would-update sample" output.
4. Run `--apply` against staging if available (Kevin: there is none, so this is "merge to a branch, point a local env at prod with a feature flag, run, compare against baseline").
5. Diff PG state vs the baseline JSON. Every row's status and access_level must match.
6. Only after that, ship the projection change to main.

If anything in step 3 shows any non-empty diff for status or access_level, halt and inspect.

---

## Part 1 - Definitive field map (code-verified)

Every column on `documents` + every overlay table. Source-of-truth boundary post-rebuild.

### Legend

- **MDX-RO** = MDX authors it; dashboard renders read-only; "Edit in MDX" affordance.
- **Overlay** = Postgres-owned; dashboard may write.
- **Computed** = derived at projection or query time.
- **Dead** = Drive-retired; mark for removal.
- **Projection write behavior**: `OVERWRITE` (mdxToDocRow + diffRow includes it -> projection authors every apply), `INSERT-ONLY` (mdxToDocRow conditional on insert), `PRESERVE` (omitted from mdxToDocRow / diffRow), `COMPUTED` (set by projection logic separate from MDX).

### `documents` table

| Field | SOT today | Projection behavior today | Post-rebuild SOT | Post-rebuild projection | Dashboard write today | Dashboard write post-rebuild | Evidence |
|---|---|---|---|---|---|---|---|
| `id` | MDX | INSERT-key only (never updated) | MDX-RO | unchanged | no | no | `project-catalog.mjs:391`, `pr-7-1-opd-schema.sql:41` |
| `title` | MDX | OVERWRITE | MDX-RO | OVERWRITE | **yes** (silent-loss trap) | no | `project-catalog.mjs:392, 438`, `AdminClient.js:643`, `route.js:142-147` |
| `doc_class` | MDX | OVERWRITE | MDX-RO | OVERWRITE | **yes** (silent-loss trap) | no | `project-catalog.mjs:393, 438`, `AdminClient.js:670`, `route.js:154-159` |
| **`status`** | MDX | OVERWRITE | **Overlay** | **INSERT-ONLY** (conditional via `existing`) | yes (works until next apply) | yes (durable) | `project-catalog.mjs:394, 438`, `AdminClient.js:687`, `route.js:160-165`, schema NOT NULL no default at `pr-7-1:44` |
| `version` | MDX | OVERWRITE | MDX-RO | OVERWRITE | **yes** (silent-loss trap) | no | `project-catalog.mjs:395, 438`, `AdminClient.js:711`, `route.js:166-175` |
| `shelf` | MDX | OVERWRITE | MDX-RO | OVERWRITE | **yes** (silent-loss trap) | no | `project-catalog.mjs:396, 438`, `AdminClient.js:655`, `route.js:148-153` |
| `card_line` | MDX | OVERWRITE | MDX-RO | OVERWRITE | no | no | `project-catalog.mjs:397, 438` |
| `summary` | MDX | OVERWRITE | MDX-RO | OVERWRITE | no | no | `project-catalog.mjs:398, 438` |
| `keywords` | MDX | OVERWRITE (multiset diff at `:447-449`) | MDX-RO | OVERWRITE | no | no | `project-catalog.mjs:399, 447` |
| `owner` | MDX | OVERWRITE | MDX-RO | OVERWRITE | no | no | `project-catalog.mjs:400, 439` |
| `approver` | MDX | OVERWRITE | MDX-RO | OVERWRITE | no | no | `project-catalog.mjs:401, 439` |
| `source_drive_id` | Overlay (DEAD) | PRESERVE (omitted from row) | **Dead - delete** | n/a | yes (Part B Drive panel) | no | `project-catalog.mjs:425-427` comment, `pr-7-1:55`, `AdminClient.js:822-849` |
| `source_drive_id_es` | Overlay (DEAD) | PRESERVE | **Dead - delete** | n/a | yes (ES Drive panel) | no | same |
| `storage_path` | Overlay (reserved for Supabase Storage PDFs) | PRESERVE | Overlay (reserved) | PRESERVE | no | no | `pr-7-1:56` |
| `pinned` | Overlay (`document_pins`) | NEVER TOUCHED | Overlay | NEVER TOUCHED | yes (toggle, works) | yes | `project-catalog.mjs:29` header note, `dataStore/opd.js:117-131`, `pr-7-9` |
| `print_required` | MDX | OVERWRITE | MDX-RO | OVERWRITE | no | no | `project-catalog.mjs:402, 439` |
| `critical` | MDX | OVERWRITE | MDX-RO | OVERWRITE | no | no | `project-catalog.mjs:403, 439` |
| `sort_order` | MDX | OVERWRITE | **MDX-RO (KEEP)** | OVERWRITE | no | no (read-only column) | `project-catalog.mjs:404, 440`, decision locked |
| `audience` | MDX | OVERWRITE | MDX-RO | OVERWRITE | no | no | `project-catalog.mjs:405, 439` |
| `classification` | MDX | OVERWRITE | MDX-RO | OVERWRITE | no | no | `project-catalog.mjs:406, 439` |
| `effective_date` | MDX | OVERWRITE | MDX-RO | OVERWRITE | no | no | `project-catalog.mjs:407, 440` |
| `last_reviewed` | MDX | OVERWRITE | MDX-RO | OVERWRITE | no | no (display + staleness flag) | `project-catalog.mjs:408, 440` |
| `next_review` | Computed (projection-derived from last_reviewed + interval) | Currently set to `null` (`project-catalog.mjs:412`); planned compute later | MDX-RO display | COMPUTED | no | no | `project-catalog.mjs:410-413, 440` |
| `approved_date` | MDX (`fm.approval.approved_date`) | OVERWRITE | MDX-RO | OVERWRITE | no | no | `project-catalog.mjs:409, 441`, pr-7-14 |
| `is_historical` | MDX/projection (set to `false` on apply) | OVERWRITE | MDX-RO | OVERWRITE | no | no | `project-catalog.mjs:414, 440`. Functionally a projection-control flag, not a user field. |
| `data_provenance` | Projection ('batch_rebuild' on apply; 'manual_entry' on app writes via schema default) | OVERWRITE | Projection-managed | OVERWRITE | no | no | `project-catalog.mjs:415, 441` |
| **`access_level`** | MDX (defaults 'unrestricted' if absent) | OVERWRITE | **Overlay** | **INSERT-ONLY** (conditional via `existing`) | no (no editor) | **yes (new editor)** | `project-catalog.mjs:421, 441`, `opdAcl.js:78-127`, `pr-7-11` |
| `archived` | Overlay (RPC sets it) | PRESERVE | Overlay | PRESERVE | yes (Archive dialog) | yes | `pr-7-7`, `route.js:568-595` |
| `archived_at` | Overlay | PRESERVE | Overlay | PRESERVE | yes (RPC sets) | yes | same |
| `created_at` | Schema default `now()` | Never set by projection | Schema | n/a | no | no | `pr-7-1:73` |
| `updated_at` | Schema default `now()`; projection stamps on apply | OVERWRITE (stamps `new Date()` at `project-catalog.mjs:517`) | Same | OVERWRITE | implicit (via API write) | implicit | `pr-7-1:74`, `project-catalog.mjs:517`, `dataStore/opd.js:273` |

### Other tables that bear on dashboard write-paths

| Table | Purpose | Projection behavior | Dashboard write today | Post-rebuild dashboard write |
|---|---|---|---|---|
| `document_pins` (pr-7-9) | Pin overlay; presence-of-row means pinned | NEVER TOUCHED (header comment `project-catalog.mjs:29`) | yes (`setPinned`/`clearPinned` via update-document action) | yes (unchanged) |
| `document_content` (pr-7-10) | Rendered HTML per `(doc_id, lang)` | UPSERT on `(doc_id, lang)` from projection's render output (`project-catalog.mjs:564-579`) | no | no (projection-owned) |
| `document_relationships` (pr-7-1) | Directed edges between docs | DELETE-ALL then INSERT (`project-catalog.mjs:533-549`) | no | no (MDX-authored) |
| `document_surfaces` (pr-7-1) | Where each doc appears across the intranet | DELETE-ALL then INSERT (`project-catalog.mjs:551-562`) | no | no (MDX-authored). Could surface as a read-only column. |
| `document_issues` (pr-7-1) | Reported issues per doc | NEVER TOUCHED | reporter writes via `report-issue` (`route.js:451-503`) | **new: dashboard reads + triages** (Lens 4 finding from sibling audit) |
| `document_chunks` (SousAI) | Embeddings | Managed by SousAI re-embed; archived doc's chunks deleted atomically by `archive_document` RPC | no | no |

### Audit reconciliation (where the first audit and code agree/disagree)

The Lens 1 table in `BUILD_DASHBOARD_AUDIT_CC.md` is **verified accurate**. Two refinements worth flagging:

1. **`is_historical`** is technically projection-overwritten (always `false` on apply per `:414`). Reads less as MDX-authored than as "projection-control flag for the chk_live_complete gate." Categorize as projection-managed in spec; impact on dashboard zero.
2. **`data_provenance`** has dual-write behavior: projection writes `'batch_rebuild'` on apply; the API `createDocument` path inherits the schema default `'manual_entry'`. Once Create flow is killed (Part 3), only projection writes it. Functionally projection-managed.

No contradictions vs the first audit. The post-rebuild SOT column above is the new ground truth.

---

## Part 2 - The status + access_level -> overlay migration

### 2a. Projection surgery (`scripts/content/project-catalog.mjs`)

**Current state - where status + access_level get authored from MDX:**

- `mdxToDocRow(fm)` at `:385-429` returns a row object that includes:
  ```javascript
  status: fm.status,                                                 // :394
  access_level: fm.access_level || "unrestricted",                   // :424
  ```
- `diffRow(existing, planned)` at `:431-451` compares both:
  ```javascript
  const fields = [
    "title", "doc_class", "status", "version", "shelf", "card_line", "summary",   // :437
    "owner", "approver", "audience", "classification", "print_required", "critical",
    "sort_order", "effective_date", "last_reviewed", "next_review", "is_historical",
    "data_provenance", "access_level", "approved_date",                            // :441
  ];
  ```
- `computeDiff(corpus, live)` at `:295-339` builds `mdxToDocRow(fm)` for every doc and uses `diffRow` to decide insert/update.
- `executeApply` at `:509-521` batches insert + update rows into one `sb.from("documents").upsert(stamped, { onConflict: "id" })` call.

**The proven preserve pattern (currently in use for `source_drive_id*`, `pinned`, `archived`, `archived_at`, `storage_path`, `created_at`):**

- Field is OMITTED from `mdxToDocRow` return object.
- PostgREST upsert sends `INSERT INTO documents (cols) VALUES ... ON CONFLICT (id) DO UPDATE SET col1=EXCLUDED.col1, ...` - omitted cols are not in the UPDATE SET clause, so they are preserved.
- For INSERT, omitted cols rely on schema defaults: `source_drive_id` defaults to NULL; `pinned` defaults to false; `archived` defaults to false. Each has a default; insert succeeds.

**Why pure preserve-by-omission doesn't work for `status`:**

- `documents.status` is `TEXT NOT NULL` with **no schema default** (`pr-7-1-opd-schema.sql:44`).
- Omitting status from the upsert payload causes `INSERT` to fail with `null value in column status violates not-null constraint` even for an existing-doc row (because INSERT is attempted first, ON CONFLICT only triggers if INSERT-then-conflict succeeds far enough to detect the conflict).

**Why pure preserve-by-omission DOES work for `access_level`:**

- `documents.access_level` is `TEXT NOT NULL DEFAULT 'unrestricted'` (`pr-7-11-opd-access-level.sql:74-75`).
- Omitting it -> INSERT uses 'unrestricted'; UPDATE preserves the existing value via the ON CONFLICT branch.

### 2a Recommended path - conditional-include via `existing` parameter

This is the path that achieves Kevin's stated lean ("MDX status/access_level seed the value ONLY on insert, then overlay owns it"), requires zero schema change, and uses the existing single-upsert pipeline.

**Diff to `mdxToDocRow`:**

```diff
- function mdxToDocRow(fm) {
+ function mdxToDocRow(fm, existing = null) {
    return {
      id: fm.id,
      title: fm.title,
      doc_class: fm.doc_class,
-     status: fm.status,
+     // OVERLAY-PRESERVING: on insert (existing === null), MDX seeds the
+     // value. On update (existing !== null), the PG value is the source
+     // of truth and we copy it through so the upsert's ON CONFLICT SET
+     // clause is a no-op for this column.
+     status: existing ? existing.status : fm.status,
      version: fm.version || null,
      shelf: fm.shelf || null,
      // ... other MDX-authored fields unchanged ...
-     access_level: fm.access_level || "unrestricted",
+     access_level: existing ? existing.access_level : (fm.access_level || "unrestricted"),
      // ... rest unchanged ...
    };
  }
```

**Diff to `computeDiff`:**

```diff
  // Insert / update
  for (const d of corpus) {
    if (!d.id) continue;
    const fm = d.frontmatter;
-   const row = mdxToDocRow(fm);
    const existing = pgById[d.id];
+   const row = mdxToDocRow(fm, existing);     // <-- thread existing through
    if (!existing) {
      docPlan.insert.push(row);
    } else {
      const changes = diffRow(existing, row);
      if (Object.keys(changes).length > 0) {
        docPlan.update.push({ id: d.id, changes, row });
      }
    }
  }
```

**Diff to `diffRow` (optional but clarity-positive):**

Status and access_level can stay in the `fields` array - because `planned[f]` will now equal `existing[f]` for update rows, the comparison silently produces no change. But removing them documents intent and lets the dry-run report be free of spurious "status: from Live to Live" noise (none would render anyway, but the intent is clearer):

```diff
  const fields = [
-   "title", "doc_class", "status", "version", "shelf", "card_line", "summary",
+   "title", "doc_class", "version", "shelf", "card_line", "summary",
    "owner", "approver", "audience", "classification", "print_required", "critical",
    "sort_order", "effective_date", "last_reviewed", "next_review", "is_historical",
-   "data_provenance", "access_level", "approved_date",
+   "data_provenance", "approved_date",
  ];
```

**Behavior walk-through after the change:**

- **Existing doc, projection apply:** `existing = pgById[d.id]`. `row.status = existing.status`. `row.access_level = existing.access_level`. The upsert's `ON CONFLICT DO UPDATE SET status = EXCLUDED.status` resolves to `SET status = existing.status` - net change to the column: zero. Same for access_level. Pin/archive/source_drive_id continue to be preserved by omission as today. **PG value of status and access_level is the source of truth for every existing doc.**
- **New doc (in MDX but not in PG), projection apply:** `existing = null`. `row.status = fm.status` (MDX-authored). `row.access_level = fm.access_level || 'unrestricted'`. INSERT succeeds. NEW DOC IS SEEDED FROM MDX.
- **Dashboard write to status (post-migration):** `route.js` update-document action -> `updateDocument(id, { status: 'Live' }, ...)` -> SQL `UPDATE documents SET status = 'Live' WHERE id = ?`. Lands in PG. Survives projection apply because the next apply's row will have `status = existing.status = 'Live'`.
- **Dashboard write to access_level (post-migration):** identical pattern. New write durable across projection applies.

**Edge cases checked:**

- `existing.status` cannot be NULL (schema NOT NULL). Safe.
- `existing.access_level` cannot be NULL (schema NOT NULL DEFAULT 'unrestricted'). Safe.
- `existing` is `false` for `pgById[d.id] === undefined` (which is what we want - no row in PG). `existing = null` for `undefined` is fine; the truthy check `existing ?` works.

### 2b. Migration SQL

The migration is a **semantic** change in the projection, not a schema change. The `status` and `access_level` columns already exist with correct types, constraints, and defaults (status NOT NULL no default; access_level NOT NULL DEFAULT 'unrestricted'). The CHECK constraints (`chk_documents_status`, `chk_documents_access_level`) stay intact - they apply to whoever writes, whether projection or dashboard.

**No new SQL migration is required for Path 1 (conditional include).** The SQL surface is unchanged. The change lives entirely in `scripts/content/project-catalog.mjs` and (separately) in the dashboard / API code per 2d.

**If Path 2 (schema default fallback) is chosen instead**, a small migration is required:

```sql
-- docs/migrations/pr-7-15-opd-status-default.sql (NOT APPLIED; only needed if Path 2 chosen)
-- Adds a schema-level default to documents.status so the projection can omit
-- the column entirely from its upsert payload (the preserve-by-omission
-- pattern used for source_drive_id, pinned, archived). Without this default,
-- omitting status fails INSERT with a NOT NULL violation.
--
-- 'Placeholder' is chosen as the default because a new catalog row that
-- hasn't been authored yet should be a Placeholder, not Pending or In Build.
-- The dashboard immediately surfaces it for the owner to set.
--
-- IDEMPOTENT: ALTER ... SET DEFAULT is safe to re-run.
-- ROLLBACK: ALTER TABLE documents ALTER COLUMN status DROP DEFAULT;

ALTER TABLE documents ALTER COLUMN status SET DEFAULT 'Placeholder';

-- VERIFY:
--   SELECT column_name, column_default FROM information_schema.columns
--   WHERE table_name = 'documents' AND column_name = 'status';
--   expected column_default: 'Placeholder'::text
```

Path 1 is the recommendation; Path 2 SQL is documented for completeness only.

### 2c. The backfill / preserve-risk (highest-risk step, restated)

**Backfill needed: NONE.** Current PG state for status and access_level was last written by the projection from MDX. So at the moment the projection logic flips, PG is already correct as the overlay source-of-truth seed. No data movement required.

**Risk vector:** the first `--apply` run after the projection logic change must NOT wipe status or access_level. If the conditional-include logic in `mdxToDocRow` has a bug (e.g., `existing` is always null for some path), every row's status gets overwritten back to MDX value on apply. Today many MDX `status` values diverge from operational truth (some In Build docs have been promoted to Live in PG via the dashboard - actually no, those writes haven't survived, so today MDX matches PG). The risk is a regression as the dashboard starts writing status durably.

**Mandatory pre-apply procedure for the first run after the projection change ships:**

1. **Capture baseline** (BEFORE shipping the projection-logic change):
   ```bash
   # Snapshot the current overlay state for status + access_level (and pin/archive
   # for good measure - those are the four "overlay" columns).
   node --env-file=.env.local scripts/content/project-catalog.mjs --dry-run
   # The dry-run report at docs/opd/foundation/PROJECTION_DRYRUN.md becomes
   # one reference. ALSO snapshot raw PG state:
   #
   #   SELECT id, status, access_level, pinned, archived, archived_at
   #   FROM documents ORDER BY id;
   #
   # to .scratch/preserve-baseline-pre-migration.json. This is the rollback
   # comparison point.
   ```
2. **Apply the projection-logic change** in a branch. Do NOT merge to main yet.
3. **Run dry-run with the new logic** against prod (read-only):
   ```bash
   git checkout feat/projection-overlay-status
   node --env-file=.env.local scripts/content/project-catalog.mjs --dry-run
   ```
4. **Inspect the dry-run report.** The "Would-update" section MUST show 0 status changes and 0 access_level changes for every doc currently in PG. If even one update row lists `status` or `access_level` in its changes set, halt and investigate - the conditional-include is buggy.
5. **Apply via the same branch checkout:**
   ```bash
   node --env-file=.env.local scripts/content/project-catalog.mjs --apply
   ```
6. **Re-snapshot PG state** and diff against `.scratch/preserve-baseline-pre-migration.json`. Every (id, status, access_level) tuple must match. Run:
   ```sql
   SELECT id, status, access_level FROM documents ORDER BY id;
   ```
   Compare row-by-row to the baseline. Any divergence is a P0 bug.
7. **Only then merge the projection-logic PR to main.**

If step 4 or step 6 shows any unexpected status / access_level changes, the rollback is to revert the projection-logic PR. The PG state stays whatever the apply produced - if the apply was clean, the state is fine. The risk is the apply itself being wrong; backup is rollback by reverting code and not re-applying (since PG state already reflects the new world post-apply).

**Belt-and-suspenders: optionally also dump documents.status + documents.access_level rows to `.scratch/preserve-baseline-post-migration.json` after step 6 succeeds so we have a known-good post-state for comparison if any future debugging needs it.**

### 2d. MDX-leftover-field disposition (recommendation)

Today every MDX file has `status: <value>` (required by `content/schema/frontmatter.schema.json:3` - it's in the schema's `required` array). Status distribution in MDX (from `grep "^status:" content/documents/*.mdx | sort | uniq -c`):

- `In Build` - 68
- `Live` - 11
- `Pending` - 7
- `Placeholder` - 3
- `Retired` - 12

access_level distribution: **0 MDX files set access_level**. Every doc is unrestricted by default.

**Disposition recommendation: leave both fields in MDX, do not clean up.**

Reasons:
- The frontmatter schema currently requires status. Removing it from MDX would fail validation. Loosening the schema is a separate decision (probably not worth it; "intent on creation" is a useful authorial signal).
- After the migration, MDX status is the "seed value on insert" - it has authority for new docs. Keeping it documents intent for posterity.
- `access_level` is absent from every MDX file. Authors can OPTIONALLY set it on new docs (e.g. `access_level: slt` on an SLT-only doc) and the projection will honor it on insert. Existing docs gain nothing from being annotated.

The risk of leaving the leftover fields is **zero** because the conditional-include logic ignores them on update. The cleanup cost is a small PR touching 101 MDX files. Not worth the churn.

**If Kevin wants explicit semantics, a comment block at the top of every MDX file's frontmatter could read:**
```
# status + access_level here are the SEED value used only when this doc is
# first projected into PG. Once in PG, the dashboard owns these as overlay
# fields. Editing here has no effect on existing docs.
```
But adding 101 such comments is itself a churn PR. Optional.

### 2e. Dashboard write-path adjustments

**Status (already writeable):**
- `WRITABLE_FIELDS_A` in `route.js:109-112` already includes `"status"`.
- `validatePatch` in `route.js:160-165` already validates status against `VALID_STATUSES`.
- `STATUS_EDIT_OPTIONS` in `AdminClient.js:55-57` already drives the dropdown editor.
- **No code change needed for the write path itself.** Post-migration the write becomes durable; today it's a silent-loss trap.

**Status: tighten validator and remove the misleading warning.**

- `route.js:117-119` allows `'Draft'` in `VALID_STATUSES`. `pr-7-8` dropped Draft from the schema. The validator should match:
  ```diff
    const VALID_STATUSES = new Set([
  -   "Live", "In Build", "Draft", "Pending", "Placeholder", "Blocked", "Retired",
  +   "Live", "In Build", "Pending", "Placeholder", "Blocked", "Retired",
    ]);
  ```
- `AdminClient.js:218-225` warns "Operators would see a Ready card that opens nothing" when status -> Live without `source_drive_id`. This warning is wrong-but-symptomatic: the operator catalog's alive-test still keys off Drive (cross-module bug in `PlaybookClient.js:452, 943, 998`). After the Drive-retirement cleanup, this warning is fully wrong; before that, it's correct for the wrong reason. **Delete the warning when the alive-test gets unwired from Drive (cross-module PR per the audit).** This task is sequenced behind the alive-test fix.

**Access_level (needs new editor):**

In `route.js`:
```diff
  const WRITABLE_FIELDS_A = new Set([
    "title", "shelf", "doc_class", "status", "version", "pinned",
    "source_drive_id", "source_drive_id_es",
+   "access_level",
  ]);
+ const VALID_ACCESS_LEVELS = new Set(["unrestricted", "restricted", "slt"]);
```

And inside `validatePatch`:
```diff
+   if ("access_level" in patch) {
+     if (!VALID_ACCESS_LEVELS.has(patch.access_level)) {
+       return { ok: false, error: `invalid access_level '${patch.access_level}'` };
+     }
+     clean.access_level = patch.access_level;
+   }
```

In `AdminClient.js`:
- Add `ACCESS_LEVEL_EDIT_OPTIONS = ["unrestricted", "restricted", "slt"]` near `STATUS_EDIT_OPTIONS`.
- Add an Access column to the worklist after Status (or wherever the IA places it).
- Add an `EditableSelectCell` with the three options, plus a small lock-icon affordance when `restricted` or `slt` to visually flag it (gold lock for slt, blue lock for restricted, no icon for unrestricted - calibrate to the design system).
- Include `access_level` in the sort key list (`AdminClient.js:317-340`) if Kevin wants to sort by it.

**Note:** the access_level edit is owner-only at the dashboard level (the route checks `canViewPlaybook` on every write). When the dashboard later opens to more roles, access_level edit should remain owner-only (or SLT-only) since it's a governance action. For v1 the owner-only gate already covers this.

---

## Part 3 - New Document deletion path

Decision locked: **kill the New Document modal**. Docs are MDX-born. Dashboard reflects post-projection.

### Exhaustive list of code to remove

**`src/app/playbook/admin/AdminClient.js`:**

- `[showCreateModal, setShowCreateModal] = useState(false);` at `:204`
- `onCreateClick={() => setShowCreateModal(true)}` prop on `<TabNav>` at `:369`
- The `{showCreateModal && (<CreateModal .../>)}` mount block at `:516-530`
- The `CreateModal` component definition at `:1480-1634` (lines 1476-1634 including the leading comment)
- The `CLASS_EDIT_OPTIONS.filter(...)` invocation at `:523` (only used by CreateModal; safe to remove with it)
- `onCreateClick` prop in `TabNav` signature at `:1148`
- The TabNav's `+ New Document` button at `:1174-1188`
- The `pb-admin-tabnav-spacer` div at `:1173` (loses its purpose if the button is removed)
- `CLASS_EDIT_OPTIONS` constant itself at `:60-62` - **KEEP** (also used at `:671` for the worklist class editor; deletion would break that editor; but the class editor itself is being deleted per Part 1 since doc_class moves to MDX-RO. So when doc_class goes read-only, `CLASS_EDIT_OPTIONS` becomes deletable too. Sequence: first remove from CreateModal, then later remove with the doc_class editor in the rebuild proper.)

**`src/app/api/playbook/route.js`:**

- Import of `validateCreatePayload` at `:49` - delete
- Import of `createDocument` at `:30` - delete (createDocument has no other callers in src/)
- The `create-document` action block at `:642-667` (the whole `if (action === "create-document") {...}` clause) - delete
- The constants `VALID_SHELVES_SET`, `VALID_CLASSES`, `VALID_STATUSES` at `:113-119` - **KEEP**; they're still used by `validatePatch` for update-document.

**`src/lib/playbookValidation.js`:**

- The entire file becomes unused (only consumer is route.js's create-document action). **Delete the file.** Confirmed via `grep -rn "validateCreatePayload\|STRICT_DOC_ID_RE\|PREFIX_TO_DOC_CLASS" src/`: only the file itself + route.js reference it.

**`src/lib/dataStore/opd.js`:**

- `createDocument` function at `:249-258` - delete. No other caller in src/.

**`src/lib/dataStore/index.js`:**

- `createDocument,` in the OPD re-export block at `:154` - delete.

### CSS

`src/app/playbook/admin/admin.css` - the `.pb-admin-new-btn` selector + the `.pb-admin-tabnav-spacer` selector + any `.pb-admin-modal-*` selectors specific to the CreateModal form rows (e.g. `.pb-admin-form-row`, `.pb-admin-form-hint`) become unused. The archive/restore dialogs share `.pb-admin-modal-*` selectors via `ModalOverlay` so those stay. Audit and delete only the CreateModal-specific selectors.

### Sequencing within the rebuild

The deletion can ship as a standalone PR (one-shot, low risk) or as a sub-step of the rebuild PR. My recommendation: **standalone first**. The change is small, isolated, and decouples cleanly. Ship it before the projection-logic change so the deletion's user-visible effect (no more "+ New Document" button) lands first and clears the surface for the rebuild.

### Test surface

- `npm run build` clean (deleted-import smoke).
- `next dev`, open `/playbook/admin`, confirm the TabNav has Worklist + Archive only, no New Document button.
- `curl -X POST .../api/playbook?action=create-document -d '{}'` returns `Unknown action` (since the create-document branch is gone, the function falls through to the final `return NextResponse.json({ error: "Unknown action" }, { status: 400 });` at `:669`). Confirms the API surface is genuinely dead.

---

## Part 4 - Final projection-preservation contract (post-rebuild)

The authoritative spec line the rebuild builds against. Apply this verbatim to the projection script's behavior.

### Projection WRITES (MDX-authored, dashboard read-only)

The projection authors these fields from MDX frontmatter into `documents` on every `--apply` (both INSERT and UPDATE):

- `id` (insert-key)
- `title`
- `doc_class`
- `version`
- `shelf`
- `card_line`
- `summary`
- `keywords`
- `owner`
- `approver`
- `audience`
- `classification`
- `print_required`
- `critical`
- `sort_order`
- `effective_date`
- `last_reviewed`
- `approved_date`
- `is_historical` (projection-control flag, always `false` on apply)
- `data_provenance` (projection-control, always `'batch_rebuild'` on apply)

Plus to the related tables:
- `document_content` (full replace via UPSERT on `(doc_id, lang)`)
- `document_relationships` (DELETE-ALL then INSERT)
- `document_surfaces` (DELETE-ALL then INSERT)

### Projection PRESERVES (overlay, dashboard may write)

The projection NEVER writes to these on UPDATE (it touches them on INSERT only, conditionally):

- **`status`** (NEW: INSERT-ONLY conditional via `existing` parameter to `mdxToDocRow`; UPDATE preserves)
- **`access_level`** (NEW: INSERT-ONLY conditional; UPDATE preserves)
- `source_drive_id` (omitted from `mdxToDocRow`; INSERT defaults to NULL; UPDATE preserves) **- field marked DEAD per audit; will be deleted once cross-module alive-test cleanup completes**
- `source_drive_id_es` (same; DEAD)
- `storage_path` (omitted; INSERT defaults to NULL; UPDATE preserves; reserved for future Supabase Storage)
- `archived` (omitted; INSERT defaults to false; UPDATE preserves; archive RPC writes)
- `archived_at` (omitted; INSERT defaults NULL; UPDATE preserves; archive RPC writes)
- `created_at` (schema default `now()`; never set by projection)
- `pinned` column (legacy - documents.pinned remains in schema for rollback per pr-7-9; the projection never wrote it; reads come from `document_pins` overlay)

The overlay table `document_pins` is **NEVER TOUCHED** by the projection (header comment `project-catalog.mjs:29`). Pin state persists across every projection apply.

The overlay table `document_issues` is never touched by the projection. Issue state persists.

### Computed

- `updated_at` - stamped to `new Date()` by the projection on every doc it touches (`project-catalog.mjs:517`). Schema default `now()` on insert. App writes via `updateDocument` also stamp it.
- `next_review` - currently set to `null` on apply (`project-catalog.mjs:412`); planned future compute is `last_reviewed + review_interval_months * INTERVAL '1 month'`.

### Cross-doc projection actions

Unchanged by the migration. Listed for completeness:

- `documents` INSERT for MDX-new docs (full row including MDX status + access_level).
- `documents` UPDATE for MDX-existing docs (row omits status + access_level; rest follows current logic).
- `documents` ARCHIVE via `archive_document` RPC for PG-active docs that are absent from MDX (`project-catalog.mjs:330-339, 523-531`). Unchanged.
- Full replace of `document_relationships` and `document_surfaces`. Unchanged.
- Upsert of `document_content` keyed on `(doc_id, lang)`. Unchanged.

---

## Open decisions for Kevin

1. **Path 1 vs Path 2 vs Path 3 for status preservation.** My recommendation: **Path 1** (conditional include via `existing`). Achieves your stated lean cleanly, zero schema change, single upsert call. Path 2 is the simpler fallback (schema default 'Placeholder') if Path 1 testing reveals subtle issues. Path 3 (split insert/update) is overcomplicated. Confirm Path 1.
2. **MDX-leftover-field disposition.** Recommendation: **leave both `status` and `access_level` in MDX as INSERT seed values; do not clean up existing 101 files.** The schema still requires status anyway. Confirm.
3. **Frontmatter schema loosening.** Should the schema's `required: ["id", "title", "doc_class", "status"]` (`content/schema/frontmatter.schema.json:3`) keep status as required, or drop it? My recommendation: **keep required.** Status carries authorial intent on new doc creation; making it optional creates ambiguity without saving any work. Confirm.
4. **Access_level lock-icon affordance.** Should the dashboard show a lock or shield icon for restricted/SLT docs? Visual decision, not engine. Suggested: small navy shield for `restricted`, gold shield for `slt`, nothing for `unrestricted`. Confirm or override.
5. **CreateModal deletion sequencing.** Ship as a standalone PR (recommended) or fold into the rebuild PR? Recommendation: standalone first - small, isolated, reduces rebuild PR surface.
6. **First-apply safety procedure (Part 2c).** Acceptable as written? Specifically: are you willing to run a one-time PG snapshot to `.scratch/` before the projection-logic change ships, as the rollback comparison point? Without this, the verification is harder.
7. **Cross-module alive-test cleanup sequencing.** The dashboard's misleading "set Live without Drive ID" warning depends on the cross-module operator-catalog alive-test still being Drive-keyed (`PlaybookClient.js:452, 943, 998`). The cleanest sequencing is: (a) fix alive-test in PlaybookClient first, (b) delete the warning + Drive panel from AdminClient, (c) ship the projection-logic change. Confirm sequence or override.

---

## Closing position

The migration is genuinely surgical. One function signature change (`mdxToDocRow(fm, existing)`), one diff-fields list shrinkage (optional), one threading change in `computeDiff`. No SQL migration needed under Path 1. The MDX corpus stays as-is (status field continues to be authored; semantics shift to insert-only seed).

The danger is concentrated in the first `--apply` after the projection-logic change ships. The pre-apply baseline snapshot + dry-run-zero-changes verification is mandatory belt-and-suspenders.

The New Document deletion is independently small and ships standalone before the rebuild.

The post-rebuild contract is clean: projection owns identity + structure + authorial fields + content render; dashboard owns lifecycle (status, archive, pin, access tier) + read-and-link for everything else. Source of truth boundary is finally visible at the cell level once the UI rebuild lands.
