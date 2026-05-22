# Claude's Knowledge Map

**Purpose:** Self-check tool. Tracks what I actually know vs. what I assume I know. Forces honesty about gaps so Kevin and I can fill them together.

**Read at:** session start, after the dashboard, before substantive work.
**Update at:** session end alongside dashboard close-out, AND immediately after any anti-knowledge moment.
**Cite when:** making confidence-weighted recommendations ("per my map, I'm surface-only on X - take this with appropriate weight").

The doc is in the repo so Kevin can read it whenever. The primary audience is still me. Honesty is the only thing that makes this work.

---

## Anti-knowledge log

Most recent first. Format: `YYYY-MM-DD: [what I was wrong about]. [What was actually true]. [Lesson].`

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
- **Drive/Calendar/Gmail client landscape** (post-PR-A2b snapshot): Drive client construction is now canonical-only (one definition in sheets.js, 5 importers). Gmail client construction is now canonical-and-dual-pattern in gmail.js: `getGmailClient(accessToken)` for user-OAuth send (sendInvoiceEmail, sendRejectionEmail) + new `sendEmailSA({ sender, ... })` for SA-impersonated send (used by people/route.js + cron/incident-reminders) - mirrors the Sheets layer's dual-pattern (`getSheetsClient(token)` + `getServiceAccountSheetsClient()`). Calendar client construction is NOT canonicalized yet - 3 inline constructions exist (incidentActions.js L60 impersonated + L73 fallback, wowPlanActions.js L309). Calendar mirrors the pre-PR-#54 Drive state; pending a future consolidation PR (deferred to post-Bundle-3 per A2a Calendar entry).

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
