# Claude's Knowledge Map

**Purpose:** Self-check tool. Tracks what I actually know vs. what I assume I know. Forces honesty about gaps so Kevin and I can fill them together.

**Read at:** session start, after the dashboard, before substantive work.
**Update at:** session end alongside dashboard close-out, AND immediately after any anti-knowledge moment.
**Cite when:** making confidence-weighted recommendations ("per my map, I'm surface-only on X - take this with appropriate weight").

The doc is in the repo so Kevin can read it whenever. The primary audience is still me. Honesty is the only thing that makes this work.

---

## Anti-knowledge log

Most recent first. Format: `YYYY-MM-DD: [what I was wrong about]. [What was actually true]. [Lesson].`

- **2026-05-26**: Stage 1 PR 1 recon initially treated `updateCellSA` as just another helper to bridge through the dual-write layer - same shape mapping as `readSheetSA` and `appendRowSA`. It is not. Sheets addresses cells by `(spreadsheetId, "tab!ColumnLetterRowNumber", value)`; Postgres addresses rows by primary key. There is no clean mapping for "write to cell C5" in Postgres because C5 is a Sheets coordinate, not a row identity. The recon's F.1 finding flagged this; the design decision was upsert-only semantics (the dataStore exposes logical upserts, the cell-by-cell mental model disappears from handlers entirely). This sidesteps the whole identity-tracking problem the cell model would have created across the read+update chain. Lesson: when bridging storage backends with fundamentally different addressing models (cell-coordinate vs primary-key), do not try to preserve the lower-level addressing in the bridge layer - lift the operation to a logical level both backends can speak natively (upsert). The cell model was also what produced the 2-month #59 bug, which is the strongest possible argument for retiring it.

- **2026-05-26**: Stage 1 PR 1 dual-write design needed Supabase env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) to exist before any code that touches Postgres could run. Initial reflex was to construct the client at module load (mirrors how `getServiceAccountSheetsClient` constructs eagerly). That would have made the merge fragile: env vars missing -> import failure -> entire dashboard route 500s, regardless of whether cutover flags were on. Real pattern: construct lazily, only when the cutover flag dispatcher actually routes to the Postgres path. With both flags off (the default merge state), `getServiceClient()` is never called, env vars could be missing entirely and the app would run cleanly. Lesson: when a new dependency requires runtime config that may not yet exist at merge time, build the dependency lazily so its absence is benign by default. Eager construction couples merge safety to deploy ordering; lazy construction decouples them. The flags-off invariant is the safety net that lets a dual-write PR ship before the actual cutover.

- **2026-05-26**: Stage 1 PR 1 SP3b's handler rewrite carried a silent-drift risk: each news action (news-read, news-save, news-ack, mark-all-read) writes a SPECIFIC field-set, and rewriting to upsert calls could have changed those field-sets subtly. news-save touches ONLY `saved` - if the new code touched `read` too, that would change behavior in a way the test plan (smoke tests with flags off) might not catch (the per-action partial-update semantics ARE what's being verified). Mitigation: documented each action's exact field-set against the actual file BEFORE rewriting, then mapped each to the upsert `partial` argument explicitly, then verified all 9 sub-paths (4 actions x existing-row + 4 actions x no-existing-row + 1 bootstrap read) byte-identical to current Sheets writes. Lesson: when rewriting a handler from cell-ops to logical-ops, the field-set per action is the load-bearing contract. Document each one against the source before changing anything; do not trust the recon's prose summary (which can miss "ONLY saved, NOT read" subtleties).

- **2026-05-22**: PR C recon found a 2-month-old production bug hiding inside dashboard/route.js's news_interactions write path. The 8 `updateCell` calls passed 5 positional args to a 4-arg helper - the tab name `"news_interactions"` landed in the `range` slot, the intended range string `"C5"` landed in the `value` slot, the real value (`"TRUE"`, ISO timestamp, etc.) was silently DROPPED as the unbound 5th arg. Effect: every cell update wrote the intended range string to A1 of news_interactions (a bare tab name in `values.update` resolves to A1) and the target cell was never touched. The bug hid behind three things stacked: (a) the helper swallowed errors (`catch { return {success: false} }`, no throw), (b) callers did `await Promise.all(updates)` without inspecting the returns, (c) low-frequency feature where users don't notice "I saved this and it forgot." Confirmed empirically during recon by reading `news_interactions!A1` and getting back `"E16"` (a stray range string) where the header `"postId"` should be. Lesson: positional-arg calls to shared helpers rot silently when the call site and signature drift, and the silence depends on errors-not-thrown + returns-not-inspected. This is the strongest single argument for the whole canonicalization effort - ad-hoc call sites are where signature drift goes undetected for months. Structural fixes are (a) canonicalization (one correct call shape, used everywhere) and (b) NOT swallowing+ignoring errors in helpers meant for production data writes.

- **2026-05-22**: PR C recon could see the dashboard updateCell calls had a wrong arg-shape from code inspection, but could not determine whether the bug had been HARMLESS (calls silently 400d, no corruption) or DESTRUCTIVE (corrupted A1) without reading actual production state. The two outcomes are observationally identical from the code alone - same call sites, same callers, same Promise.all + return-ignore pattern. A 2-minute read of `news_interactions!A1` returned `"E16"` and settled it definitively: corruption, not silent failure. The timestamps in the data rows also revealed the ~2-month duration. Lesson: same as PR B2's Drive test - when bug behavior depends on accumulated system state, read the state; don't reason about it. Code-only analysis can identify "this MIGHT be a bug" but only state inspection settles "this IS a bug, this duration, this severity." A throwaway read script has fixed cost (write + run + delete) and the payoff is definitive evidence.

- **2026-05-22**: PR B2 SP4 found `getSheetTabId` had 2 callers (admin-update-contacts L422 AND removeWorkLocation L540), not 1 as the original PR B recon stated. The recon was done pre-B1; PR #57's gate insertion shifted all post-L253 line numbers down by ~19, and at recon time the second caller was easy to miss in a 529-line file. Lesson: re-anchor caller counts against the actual file at execution time, not the recon's count - especially when prior PRs (or any code change) have shifted line numbers between recon and execution. Stale recon facts must be re-verified before destructive edits like helper removal. Removing a helper with a missed caller would have been a silent build break or runtime crash.

- **2026-05-22**: PR B2 SP2 confronted a genuinely unanswerable question - whether the SA Drive client could read team-logo image files - that no amount of code reading could resolve. The answer depended on where the files physically live in Drive (intranet shared folder vs. Kevin's personal Drive vs. somewhere else), which is metadata external to the codebase. A 2-minute throwaway test (`node --env-file=.env.local scripts/test-sa-drive.mjs` reading 12 production URLs) settled "will this work" definitively where analytical reasoning could only have given a probability. Lesson: some migration decisions are empirical, not analytical. When the answer depends on system state outside the code, an empirical test beats a reasoned guess - even a tiny one. The throwaway has a fixed cost (write + delete) and an open-ended payoff (kills uncertainty stone-dead or surfaces a real constraint).

- **2026-05-22**: PR B2 SP4 migrated two local read helpers (`safeReadSheet` returning bare array, inline `safeRead` returning `{headers, rows}`) to one canonical `readSheetSA` returning `{headers, rows}`. The auth swap was trivial; the risk was the SHAPE contract. The 6 bootstrap callers used `.rows` access on the object (no adaptation needed) but the 7 safeReadSheet callers used the bare array directly (needed `{ rows }` destructuring added). A shape mismatch here would have been silent - `undefined.findIndex(...)` throws clearly, but `({headers,rows}).findIndex` returns undefined which then renders as empty data downstream with NO error. Lesson: when consolidating helpers with divergent return shapes onto one canonical, the auth/API migration is the visible work; the shape contract per call site is the hidden work. Walk each consumer individually rather than trusting "all reads work the same way."

- **2026-05-22**: PR B recon planned the directory POST admin gate to mirror bootstrap's admins-tab check (col A email match), framing it as "preserve existing semantic." Kevin revealed that directory should be him-only and that the admins-tab flag model is itself a known fudge being replaced in Stage 1 (people/route.js checks col A + col C "hr"=TRUE; directory checks col A only - inconsistent across modules). The right move was a tiny env-var-based interim gate (`DIRECTORY_ADMIN_EMAILS`), loudly marked as interim, NOT the admins-tab check. Lesson: when a security gate would enshrine an existing ad-hoc check, stop and confirm the intended policy before encoding it. The "mirror current behavior" instinct is right for refactors but WRONG when current behavior is itself the thing to fix. Same-PR encoding of a known-broken policy makes it harder to remove later.

- **2026-05-22**: Originally scoped PR B as a single ~130-LOC consolidation that bundled the security fix (server-side admin gate) with the SA migration. Kevin split it into B1 (security only, env-var gate, +19 LOC) and B2 (the full SA migration, later). Reason: a security fix ships fast and independently reviewable; burying it in a -130 LOC refactor delays the auth hole closure and conflates two different review concerns. Lesson: when a recon surfaces a security-adjacent finding inside a refactor PR, default to splitting it out. The security fix has different urgency, different reviewer attention model, and different risk profile than the refactor it was found inside. Same pattern as PR A → A1 + A2 → A2a + A2b: when a recon surfaces meaningfully separate concerns, split.

- **2026-05-22**: Planned A2b's helper as a thin `getGmailClientSA(senderEmail)` constructor (last session's recon). Re-recon this session revealed a full-service `sendEmailSA` was the better fit for the architecture - it eliminates the two divergent MIME builders (people/route.js's robust one + cron's missing-RFC-2047 one) rather than leaving them behind. Lesson: the helper shape should be chosen at recon time against what the call sites actually need, not pre-decided a session earlier. The full-service version did more consolidation for marginal extra risk (mitigated by encoding verification).

- **2026-05-22**: First draft of `sendEmailSA` composed on gmail.js's existing `encodeSubject` helper, assuming it matched people/route.js's subject encoding. It did NOT - `encodeSubject` used a stricter printable-ASCII test (`[\x20-\x7E]`) vs the original's any-non-ASCII test (`[^\x00-\x7F]`), diverging on control chars. Caught only because the SP2 pause required a side-by-side proof. Lesson: "this existing helper looks equivalent" is an assumption to verify byte-for-byte, not assert. Reusing a canonical-looking helper without proving equivalence reintroduces the exact drift you are consolidating away.

- **2026-05-22**: Treated `Buffer.toString("base64url")` as "obviously equivalent" to the original's manual `btoa + +/-, //_, strip-=` chain without proving it. It IS equivalent (Node base64url is RFC 4648 §5 unpadded), but the equivalence was asserted before being tested. Lesson: when porting encoding logic into a canonical helper, prove every encoding empirically (a 2-second `node -e` settles it), especially the ones that look obvious. "Looks obvious" is where silent encoding bugs hide.

- **2026-05-22**: The by-reference function-injection pattern (incidentActions.js receives `sendEmail` as a parameter rather than importing it) made the people/route.js Gmail migration trivial - a 1-line adapter preserving the `(to, subject, html, replyTo) => "sent"|"failed"` contract meant zero changes to incidentActions.js. Lesson: dependency injection at module boundaries pays off at migration time. When a consuming module takes a function by reference instead of importing it, the provider can swap implementations freely as long as the contract holds. Worth designing this pattern intentionally at module boundaries where consolidation is foreseeable.

- **2026-05-22**: Estimated PR A2 as "swap ~80 lines of JWT" from the CLAUDE.md callout. Reality: 270 LOC across 64 call sites, 5 local helpers, JWT shared with Gmail (not Sheets-only like cron/daily). Lesson: file size (2,056 lines) correlates with hidden scope; line-count proxies from CLAUDE.md callouts underestimate when there are many local helpers in the file.

- **2026-05-22**: PR A1's "Gmail SA pattern PRESERVE" decision was correct in A1's context (don't consolidate Gmail INTO Sheets helpers) but did NOT mean "every Gmail caller hand-rolls JWT forever." A future-me reading PR A1's BUSINESS_NOTES entry could have left the hand-rolled crypto.subtle code in place indefinitely. Lesson: "preserve" decisions can be local to one PR's scope; re-examine them when scope changes.

- **2026-05-22**: Split-vs-unified pattern. PR A grew from "1 PR for hand-rolled JWT consolidation" to A1 + A2, then A2 grew to A2a + A2b. Each split was the right call when scope revealed itself. Lesson: when recon reveals >2-3x estimated scope, split. Cost of an extra PR (context-switching) is much less than cost of a bloated PR (review fatigue, mid-PR bugs).

- **2026-05-22**: PR #54 added `getServiceAccountDriveClient` to sheets.js WITHOUT sweeping pre-existing local duplicates in `drive.js` and `incidentActions.js`. The pattern audit caught them a session later. Lesson: when adding a canonical helper, grep for pre-existing local equivalents BEFORE the PR closes. Half-done consolidation recreates the drift the helper was meant to eliminate.

- **2026-05-22**: PR #53's recon was a CATEGORIZATION pass (how each file talks to Sheets). The pattern audit was a PATTERN-AUDIT pass (specific anti-patterns across files). Files can be CONSOLIDATED in one dimension (Sheets) and have issues in another (Gmail variants, dead imports). Lesson: when asked "what about file X?", look at the file, don't rely on a 1-line recon summary.

- **2026-05-22**: Session close-out protocol now includes CLAUDE_KNOWLEDGE_MAP updates as a STANDARD item, not an afterthought. (Kevin had to prompt for it last session.) Lesson: end-of-session checklist includes CLAUDE_KNOWLEDGE_MAP alongside BUSINESS_NOTES and PROJECT_DASHBOARD.

- **2026-05-19**: Came into Service Calendar tour assuming it was production-ready audit material like Smart Inventory. Reality: ~50% built, not deployed, zero users, actively being developed daily. Required full reset of approach. Lesson: verify development status before assuming the audit framing applies. "Is this shipped?" is the first question, not the third.

- **2026-05-19**: Recommended CC push dashboard sync directly to main, framing as "pure docs maintenance." GitHub branch protection rejected the push. The repo requires PR + green Playwright for everything to main. Lesson: respect branch protection. Memory rule #9's "dashboard discipline at session boundaries" doesn't mean "separate commit at boundaries" - it means "captured within whatever PR is next." Carry forward the edits, don't isolate them.

- **2026-05-19**: Wrote up dashboard sync as if PR #51 weren't merged when I had already verified it was merged (commit 266f2e7). Conflated "repo state" (truth: merged) with "dashboard state" (stale: still says READY FOR MERGE). Lesson: when stating current status, be explicit about which artifact's state I'm describing.

- **2026-05-18**: When asked to critique the Four Gates framework, generated a sharp critique ("framework is doing self-promotion") that wasn't supported by observed evidence. Kevin immediately accepted it as a flaw in himself. Had to walk it back. Lesson: "critical" doesn't mean "harshest possible reading." When pushed to critique, accuracy beats sharpness. Kevin's openness to feedback creates responsibility on my end to land critiques that are true, not just provocative.

- **2026-05-18**: Recommended deleting 7 stub handlers in PR #51 sub-phase 4. Kevin pushed back: Smart Inventory is under active development, the stubs represent product decisions he may return to. My reasoning ("these have aged out") was an assumption without product context. Better answer was "keep + add TODO comments," which I'd dismissed too quickly. Lesson: when active development is happening, default to preserving optionality. Kevin's product instincts outweigh my clean-code instincts on active surfaces.

- **2026-05-18**: Framed sub-phase 4 (stub triage) as an audit task. Kevin correctly identified it as a product decision (which features get built when), not audit-scope work. Lesson: audit scope = "is this migration-ready" not "what features should exist." Stubs are migration-neutral if they don't block schema design.

- **2026-05-18**: When CC's F36 fix expanded scope beyond the F-code spec (added reviewStatus column write + merge_history entry vs. just "stop discarding params"), my first instinct was to push back on "scope creep." CC's reasoning revealed the bigger fix was architecturally better AND surfaced a previously-undocumented 5-value enum. Lesson: scope expansion isn't automatically wrong. Push back to force the discussion, but be open to the bigger fix being correct.

- **2026-05-18**: When proposing the F33 fix design, I would have said "just add await." CC proposed batching with batchUpdateRangesSA, which fixes the bug AND reduces N+M API calls to 2. The structural improvement matters because Sheets API has quota limits. Lesson: when the simple fix has performance implications, ask if there's a structural fix that's actually better.

- **2026-05-18**: Estimated PR sub-phases at 30-60 min each. Actual was 5-15 min because I was pricing CC's execution time as if it were Kevin's. Lesson: when CC is the executor, price its time, not Kevin's.

- **2026-05-18**: Thought PR #50's e2e failure was the PR's fault. CI tests prod, not preview - the PR's code never ran in test. Lesson: investigate config before assigning blame.

- **2026-05-18**: Said InvoiceTool.js had 1 lint problem from CC's recon summary. Actually had 18. Lesson: recon summaries are not file reads. Trust the file read.

- **2026-05-18**: Initial estimate for Smart Inventory audit was "1-2 hours" based on a 117-line route file. Actual audit surface was ~4,700 lines across 9 files + 30 handlers. Lesson: don't estimate from the smallest file in the surface; map the full surface first.

- **2026-05-18**: Assumed Smart Inventory was live in production. It was development-only. Changed the audit framing significantly. Lesson: verify deployment status before assuming user-impact constraints.

- **2026-05-18**: Claimed "60 word commit message minimum" as if it were an established rule. It was an extrapolation Kevin pushed back on. Lesson: distinguish "convention I've observed" from "rule that exists."

---

## What I should ask about next

Each entry: topic + current state + trigger for action.

- **Service Calendar tour, deeper pass when it stabilizes**: Today's tour gave me UI + Drive structure + data model. I still don't know the codebase or the in-progress decisions. **Trigger:** when Kevin says Service Calendar is closer to ready for review.

- **Railway cron repo** (`kitchfix-inventory-cron`): read end-to-end on 2026-05-19, audit-as-documentation only. **Trigger:** if any cron behavior issues surface in nightly Slack digest, OR before Stage 1 schema design touches the cron's writes.

- **The `inv_` prefix shared between sessionId and itemId**: both use `generateId("inv")` in Smart Inventory. The data model spec I wrote during PR #51 said items should be `item_<uuid>`. Why did this drift, or was the spec wrong? **Trigger:** Stage 1 schema design conversation.

- **The autosave gap in count flow**: documented as a known issue ("writes only happen on zone transitions or submit"). Has it caused real data loss in testing? **Trigger:** before Stage 2 features get scoped.

- **Bootstrap performance on phones in cold rooms**: 7-tab parallel read pulls thousands of rows. Has anyone tested this on a real device in real conditions? **Trigger:** before Stage 1 schema design (Postgres will change perf characteristics).

- **People Portal (PAF + new hire wizard)**: know it exists, nothing more. **Trigger:** if any People Portal PR surfaces.

- **Home dashboard (DashboardView.js)**: never read. **Trigger:** if any dashboard work surfaces.

- **The "why" behind specific architectural decisions**: I see patterns but rarely know history. **Trigger:** ask "why does this exist?" more proactively during audits.

- **User behavior**: no observation of any user using any tool. **Trigger:** request screenshots or descriptions during relevant audits.

---

## Knowledge depth

### Deep (can answer without re-reading)

- **invoiceActions.js** (1,247 lines)
  - Built depth: PR #47 audit (Audit #4), PR #50 debug (L742 latent stale-closure)
  - Can answer: OCR pipeline end-to-end, SA vs OAuth boundary, guardedNavigate purpose, why resetForm temporal-dead-zone was a bug, the L742 stale-closure mechanism
  - Cannot answer: history of why this AI prompt vs alternatives, real production OCR cost characteristics

- **inventoryActions.js** (1,191 lines)
  - Built depth: PR #51 audit (Audit #6) - 30 handlers audited, F33 + F36 fixed, 12 BUSINESS_NOTES authored
  - Can answer: which 30 handlers exist + categorization, F33 fire-and-forget pattern + batched-write fix, merge_history 6-value type enum, reviewStatus 5-value enum + handler attribution, soft-delete pattern (active=FALSE + reviewStatus), price_history-as-source-of-truth, accountMatch invariant (19 call sites), count session lifecycle, pack-size keep-separate rule, trust-server total recomputation, auto-assignment keyword patterns, zone_corrections feedback loop
  - Cannot answer: real production performance, why `inv_` prefix shared between sessions and items, how chefs experience the count flow, whether autosave gap has caused real data loss

- **vendorActions.js** (PR #47 audited)
  - Built depth: full audit including F19a/F19b/F24/F25 fixes
  - Can answer: vendor-ID collision retry pattern, idempotency-via-clientUUID, the F19a → F19b → F24 → F25 chain of bugs and how each compounded
  - Cannot answer: how often vendor adds actually collide in practice

- **Railway cron index.js** (720 lines)
  - Built depth: 2026-05-19 audit-as-documentation pass with production-data cross-check
  - Can answer: nightly run shape (discover accounts → batch → Claude prompt → write to 4 tabs → Slack digest), idempotency-via-invoiceUuid pattern, per-account + per-batch error isolation, MATCH_CONFIDENCE_THRESHOLD tunable, ai_cron vs ai_cron_batch attribution, DEDUP mode as mutation path, single-pass Claude prompt structure, F43-F49 theoretical risks + their non-impact in production
  - Cannot answer: production failure mode history (the cron has been running stably; I don't know what's actually failed before), variety-group merge-later behavior in detail, dedup-mode safety in active catalog edit window

- **`/api/ops/route.js` dispatcher pattern**
  - Built depth: traced across PR #47, #51
  - Can answer: action-string routing, handler import pattern, why dispatcher is thin
  - Cannot answer: full history of why this pattern vs Express/tRPC/per-route files

- **SA helper patterns in `sheets.js`** (6 helpers built across PR #47/#48)
  - Built depth: built safeRead, updateCellSA, deleteRowSA, findRowByValueSA, getSheetIdSA, createTabSA
  - Can answer: when to use each, why SA pattern over user OAuth for writes, values.append column-A anchor pattern, parseNum gotcha
  - Cannot answer: full history of why service account chosen over user OAuth originally

- **F-code audit methodology** (established PR #47, refined PR #51, extended PR #52)
  - Can answer: F-code numbering convention, P0/P1/P2/P3 triage rules, fix-vs-defer decision tree, BUSINESS_NOTES vs TEAM_KNOWLEDGE vs SUPABASE_MIGRATION decision tree, audit-as-documentation pattern (when code is too stable to warrant fixes)
  - Cannot answer: when this methodology will need adjustment for Stage 1 Postgres audits

- **Dashboard discipline + memory rule #9**
  - Built depth: established 2026-05-18 during Bundle 1, applied PR #48-#52
  - Can answer: session-start/end protocol, when to render visual vs read text, branch-protection interaction (learned 2026-05-19)
  - Cannot answer: whether protocol scales past Stage 0

- **people/route.js** (1,891 lines post-A2a; was 2,056)
  - Built depth: PR A2a end-to-end read + 66 call-site migration + drift-bomb removal + ensureIncidentsTab refactor
  - Can answer: full Sheets call-site landscape (GET handler 8 actions, POST handler 12 actions), local SHEETS const tab-to-pillar mapping, SUB column-index const for submissions sheet, incident-tab auto-create orchestration (addSheet + frozen-row + 42 headers), notify dispatcher pattern, EmailTemplates structure, why getAccessToken became orphan (Sheets-only wrapper; getGmailToken calls getServiceToken directly), why ensureIncidentsTab stays local (frozen-row preserved through canonical inline batchUpdate per D2), PEOPLE_DB_SHEET_ID drift-bomb history and removal
  - Cannot answer: real production traffic patterns for each action, which actions chefs/admins exercise most often, the history of why this file accumulated 7 local helpers + its own JWT layer (vs. being built on sheets.js from day one)

### Working (read parts, broad patterns clear)

- ARCHITECTURE.md five-pillar sheet model - read multiple times, haven't memorized every nuance
- accountMatch invariant + historical drift behind it (PR #51 cluster 1)
- Service account vs user OAuth boundary - clear on when each is used
- Action-dispatch API pattern - can replicate, haven't traced every variation
- CSS prefix conventions (oh-, oh-vp-, oh-inv-mgmt-, sc-, pp-, kf-, an-)
- BUSINESS_NOTES format conventions (What/Why/Where/Documented/Migration consideration/Verification)
- Smart Inventory count flow data writes (PR #51 cluster 2)
- Smart Inventory dedup/merge handlers (PR #51 cluster 3)
- Smart Inventory item-management handlers (PR #51 cluster 4)
- Smart Inventory review-queue + location handlers (PR #51 cluster 5)
- Service Calendar product intent + UI design (today's tour - month view, year heatmap, day overlay, billing-system-of-record framing)
- Service Calendar Drive structure (parent → MiLB/MLB/PDC subfolders → per-account 2026 sheet with 3 tabs)
- BUSINESS_NOTES contents for Smart Inventory + Railway cron specifically (14+ entries authored in PR #51-#52)
- **Pattern audit methodology** (established 2026-05-20 evening, applied to Bundle 3 readiness check): 10-pattern grep sweep across `src/` covering hand-rolled JWT (crypto.subtle), Gmail client variants, auth client construction (`google.auth.*`), env var fallback chains, dead helper imports, direct API calls bypassing helpers, user-OAuth writes potentially SA-able, mixed-auth files, hardcoded sheet IDs, inline range strings. Each pattern produces a severity-rated finding list (P0 bug / P1 fix-in-bundle / P2 doc-or-defer / P3 ignore). Reusable for future "before-Stage-N" readiness sweeps.
- **Storage layer landscape** (post-Stage-1-PR-1 snapshot): three lib files form the dual-write dispatch layer. `src/lib/supabase.js` exports `getServiceClient()` (lazy, called only by Postgres adapters in dataStore). `src/lib/cutover.js` parses `DUAL_WRITE_TABLES` + `READ_FROM_POSTGRES` env vars into Sets at module load (both default empty = off); exports `isDualWrite(tab)` + `isReadFromPostgres(tab)`. `src/lib/dataStore.js` is the per-table logical layer; currently has news_interactions adapters (Sheets + Postgres) + dispatch. Only consumer of dataStore is `dashboard/route.js`. Sheets-side helpers in `sheets.js` are untouched and used directly by every other handler (none migrate to dataStore yet - news_interactions is the first table). Stage 1 storage operations flow: handler -> dataStore.upsertX -> always Sheets adapter + optionally Postgres adapter (gated on isDualWrite). Reads: handler -> dataStore.getX -> either Postgres adapter (if isReadFromPostgres) or Sheets adapter (default). With flags empty, the layer is a Sheets-only passthrough; Postgres is dormant.

- **Drive/Calendar/Gmail client landscape + user-OAuth surface** (post-PR-C snapshot): Drive client construction is canonical-only (one definition in sheets.js, importers: backup-sheets, drive.js, incidentActions.js, directory/route.js post-B2). Gmail client construction is canonical-and-dual-pattern in gmail.js: `getGmailClient(accessToken)` for user-OAuth send (sendInvoiceEmail, sendRejectionEmail) + `sendEmailSA({ sender, ... })` for SA-impersonated send (people/route.js + cron/incident-reminders). Sheets layer has the same dual-pattern (`getSheetsClient(token)` for user-OAuth + `getServiceAccountSheetsClient()` for SA). Calendar client construction is NOT canonicalized - 3 inline constructions remain (incidentActions.js L60 impersonated + L73 fallback, wowPlanActions.js L309). Pending a future consolidation PR (deferred to post-Bundle-3). **User-OAuth Sheets/Drive surface after PR C:** the last general-purpose user-OAuth Sheets WRITE surface is closed. dashboard/route.js is now 100% SA (PR C migrated 12 user-OAuth calls; the news_interactions wrong-arg-shape bug was fixed as a direct consequence of canonicalization - see PR C BUSINESS_NOTES). Only `invoiceActions.js` user-flow paths remain on user-OAuth Sheets/Drive - intentional, NOT a consolidation target (invoice submission emails and Drive uploads should appear from the submitter, which requires user-OAuth).

### Surface (know exists, haven't read)

- CountSheet.js (1,008 lines - Smart Inventory UI state machine)
- ItemReview.js, LocationSetup.js, ProductPlacement.js, ItemCatalog.js, QuickTour.js (Smart Inventory UI siblings)
- InventoryManager.js (364 lines - Smart Inventory shell)
- DashboardView.js (home dashboard)
- People Portal FRONTEND modules (PAF wizard, new hire wizard, admin queue, action center, cancel/withdraw flows) - backend route is Deep (see people/route.js above), frontend components not yet read
- Service Calendar codebase (saw UI today, not the code)
- Season Tracker (MLB labor budget tracking)
- Team Directory (account cards, contact management)
- Analytics engine (event logging, cron aggregations, /analytics dashboard)
- Pre-Service Briefing Tool (specced, not built)
- Cowork integration
- Vendor Portal UI components
- Invoice Capture UI components (different from InvoiceTool.js itself)

### Not yet (no current context)

- User behavior patterns (no direct observation of any user using any tool)
- Stakeholder daily workflows (Britt, Josh, Joe, Chef Britt, Ryan, Joe C., Hana)
- Business model details / revenue mechanics beyond what Kevin shares contextually
- Stage 1 / Supabase concrete plans beyond general Postgres knowledge
- Full history of why architectural decisions were made (vs. the patterns themselves)
- Real production performance characteristics of any module
- Fietek & Weinstein fractional executive consulting practice

---

## Notes for future me

1. **The hardest part of this doc is honesty.** Resist inflating Deep tier. Resist hiding gaps.
2. **Cite this doc mid-session when relevant.** It's only useful if I actually use it.
3. **Update immediately after anti-knowledge moments.** Memory of the wrong reasoning fades fast.
4. **The seed content is starting material.** Adjust based on what's true at session start, not what this doc says.
5. **Kevin sees this.** That doesn't change what I write. It does mean I should be ready to discuss anything in it.
