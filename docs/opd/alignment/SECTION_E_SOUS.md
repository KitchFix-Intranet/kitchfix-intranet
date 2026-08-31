# Section E: Sous consumption surface

## E17: Consumption surface confirmed

### canUseSous
[verified] **Definition:** `src/lib/opdAcl.js:141` (`export async function canUseSous(email, surfaceOrDeps, maybeDeps)`).

[verified] **Signature:** `canUseSous(email, surface?, deps?)`. Surface is `"page"` (default) or `"panel"`. Panel surface delegates directly to `canViewPlaybook` (Playbook owner-only today). Page surface honors `SOUS_PREVIEW_ALLOWLIST` (currently a Set of one: `k.fietek@kitchfix.com`, opdAcl.js:137-139); when the Set is non-empty, tier / corporate-email checks are bypassed.

[verified] **Checkpoints (four - listed in the source comment at opdAcl.js:77-85):**
1. `src/app/api/sousai/gate.js:45-46` (POST /api/sousai gate step 3; distinguishes panel vs page surface).
2. `src/app/sous/page.js:178` (server-component page gate; `notFound()` on fail).
3. `src/components/TopNav.js:299,306` (nav-link visibility), resolved server-side in `src/app/layout.js:30`.
4. `src/app/api/playbook/route.js:235` (`canUseSous(actualEmail, "panel")` for the Playbook bootstrap payload's `canUsePage` flag, gating the panel button).

[verified] Truth table in `src/lib/opdAcl.test.js`.

### Panel wiring
[verified] **Standalone page:** `src/app/sous/page.js` (server) mounts `src/app/sous/SousSurface.js` with `variant="page"`. Rail + hero + first-run domain briefing + composer.

[verified] **Overlay (Playbook panel):** `src/app/playbook/PlaybookClient.js:596-608` renders `SousAIOverlay` (defined at PlaybookClient.js:624-791), which wraps `SousSurface` with `variant="overlay"` (imported from `../sous/SousSurface`, PlaybookClient.js:19). Same component, no rail / no hero / no first-run.

[verified] **API surface consumed:**
- `POST /api/sousai` `{ action: "ask", question, priorTurns }` -> SSE stream (SousSurface.js:348).
- `POST /api/sousai` `{ action: "feedback", question_id, value, tags?, comment? }` (SousSurface.js:541, 567).
- `GET /api/sousai/chips` (starter chip fetch on panel mount, PlaybookClient.js:652).
- Handler: `src/app/api/sousai/route.js`; gate at `src/app/api/sousai/gate.js`; agent loop at `src/lib/sousai/agent.js`.

[verified] **Wire contract from SousSurface header comment (SousSurface.js:15-17):** "Wire contract unchanged: talks to `/api/sousai` (action=ask stream + action=feedback). No agent/prompt/route logic touched. Presentation only."

### Corpus + provenance
[verified] **Corpus:** `document_chunks` table in Postgres (vector-1536 embeddings of MDX-projected doc text). Chunk write path: `replaceChunksForDoc` at `src/lib/sousai/store.js:44` (delete-then-insert per `(doc_id, language)`). Ingestion: `embedDocument` at `src/lib/sousai/index.js:74` reads `content/documents/{docId}.mdx` (A5: MDX is the source, not Drive Docs API). Posters (`SKIP_TEXT_EXTRACTION_CLASSES = ["POST"]`) get a single stub via `embedPosterStub` (index.js:206).

[verified] **Retrieval:** `searchDocuments` (`src/lib/sousai/tools/searchDocuments.js:45`) calls the `match_document_chunks` RPC bounded by `match_count=30`, with `allowed_levels` passed through from the caller's `opdAcl.allowedAccessLevels` resolution. `getDocument` (`src/lib/sousai/tools/getDocument.js:73`) reads `document_chunks` for full-doc reconstitution.

[verified] **Data tools (non-corpus):** 10 data tools (directory / SC / spend) in `src/lib/sousai/tools/data/` read live Postgres tables; they're not part of the retrieval corpus and their citation is prose ("Source: contacts, loaded ..."), not doc-id.

[verified] **Provenance surfacing:** The `done` SSE envelope's `sources` is a hydrated `[{docId, title}]` array (route.js:331-345). The UI renders each source as a clickable `.sa-source-row` linking to `/playbook/d/{docId}` (SousSurface.js:899-919). It shows the docId chip and the doc title; **it does NOT surface `doc.version` or `updated_at`** (grep of `src/lib/sousai/tools/*` and `src/app/api/sousai/route.js` confirms no `version` field is passed through). A page-level `FreshnessChip` (`src/app/sous/FreshnessChip.js`) shows "PG live · h:mm AM" (browser-local clock, not doc-version). Tool-payload freshness stamps come from `src/lib/sousai/tools/_freshness.js` (`pgLiveNow()` / `pgLiveAsOf(dateStr)`), consumed by the model for citation-line prose (e.g. "Source: contacts, loaded 2026-05-27") but never rendered as UI provenance metadata.

### Freeze check
[verified] **Publish-time triggers (Sous generation from content update):** Yes, one exists - the `opd-autoprojection.yml` GitHub Action at `.github/workflows/opd-autoprojection.yml` fires on push to `main` when `content/documents/**` changes, runs the MDX-to-Postgres projection, then **re-embeds every changed doc via `scripts/sousai-embed-doc.mjs`** (workflow lines 74-137). This IS pipeline generation to Sous triggered by a content publish. Additionally the Playbook API route `action: "restore"` triggers `restoreDocument` -> re-embed on unarchive (`src/app/api/playbook/route.js:850`; helper at `src/lib/sousai/index.js:297`), and the MDX authoring `action: "commit-mdx"` flow (`src/app/api/playbook/route.js:867-1023`) publishes via PR, whose merge to main re-triggers the autoprojection workflow (comment at route.js:869-870: "auto-projects and re-embeds on merge").

[verified] **Runtime consumption side:** No changes to `src/lib/sousai/agent.js`, the tool registry, or `/api/sousai` are proposed or observed to accommodate Academy. The Sous panel is already re-used inside Playbook via `variant="overlay"`; the Academy could re-use the same overlay identically today without any Sous change.

**Freeze verdict against "Sous frozen at v2.0. No output attributes pipeline generation to Sous":**
- If "output" = **Academy output attributes / credentials / badge state** attributing to Sous generation - **no such wiring exists**. Academy is not yet built; nothing in the current codebase attributes Academy content, credentials, or attempt state to Sous ingestion.
- If "pipeline generation" is read strictly (any content-publish -> Sous re-embed), **the existing OPD MDX -> Postgres -> embed pipeline already does this for Playbook docs, and has since the autoprojection workflow landed.** That is a pre-existing OPD Playbook behavior, not an Academy addition. Whether it counts as a "violation" depends on the ruling's intent: reading it as "no NEW Academy-driven generation into Sous," the freeze holds; reading it as "Sous is now purely read-only against a static corpus," the OPD publish -> re-embed pipeline is a live counter-example that the ruling would need to either grandfather or take offline. **Flagging for owner clarification.**

### Future v3 wishes (park for later)
- **Credential-aware answers:** Sous today has no notion of who is credentialed for what. An Academy v1 that assigns credentials to people would eventually want Sous to answer "who on this account is Allergen-credentialed as of today" - requires a credentials tool + freshness contract, plus a policy on stale/expired credentials as declines vs partials.
- **Compliance-aware answers:** currently the agent's data tools cover directory / SC / spend. Compliance state (who has completed what, when it expires, who is overdue) would be a new tool class. The zero-tool retry backstop (agent.js:238-247) is already the pattern this would slot into.
- **Version-aware source card:** the source chip only shows docId + title. If Academy content is versioned and revisions matter for "was this the version the trainee saw," a `version` and `effective_date` field on the hydrated `sources` payload would surface that. Trivial API change; deferred pending v3 resolver design.
- **Panel starter set for Academy host:** `PANEL_HOST_STARTERS` currently registers "playbook" (PlaybookClient.js:761). An Academy host would register its own set through the same mechanism. No Sous change; just a starter registration. Not a v3 wish, but worth noting the extension seam exists today.

## Contradictions with the prompt's Section 1 facts
- **Prompt claim:** "Sous is frozen at v2.0 for this arc. No output attributes pipeline generation to Sous."
  - [verified] **Repo reality:** The `.github/workflows/opd-autoprojection.yml` workflow is live and re-embeds any changed `content/documents/*.mdx` file on push to main. If the ruling means "no NEW pipeline generation to Sous," no contradiction. If it means "Sous corpus is now static," this is a live contradiction with the existing OPD publish flow that predates Academy. Not an Academy-caused violation, but the ruling text as quoted would exclude a pre-existing behavior. Owner should confirm which reading is intended before Academy work assumes either.
- **Prompt claim:** "Academy rail is the person's profile / badges are credentials."
  - [verified] No such surface exists in the repo. Sous rail is a session-turns list (SousSurface.js:676-785); it is client-only, session-scoped, wiped on New Question / cmd-K. No profile, no badges, no credentials surface. This is a build-forward, not a contradiction.
- **Prompt claim:** "one shell / four rooms."
  - [verified] Sous has ONE shell (`SousSurface` with `variant="page"|"overlay"`), not four. "Rooms" is not a concept in the current codebase. Also build-forward, not a contradiction.

## Completeness map
| Claim | Basis |
|---|---|
| `canUseSous` location + signature + call sites | [verified] opdAcl.js:141 + grep of all four call sites read |
| Panel wiring (page + overlay variants) | [verified] SousSurface.js + PlaybookClient.js:596-791 read |
| API surface consumed by panel | [verified] route.js + SousSurface.js fetch sites read |
| Corpus = document_chunks (vector) | [verified] store.js + searchDocuments.js + getDocument.js read |
| Ingestion = MDX -> embed (A5) | [verified] index.js:38-46 read |
| Publish -> re-embed pipeline exists | [verified] opd-autoprojection.yml + route.js:850,870 read |
| Provenance surfaced = docId + title only (no version) | [verified] SousSurface.js:899-919 + route.js:331-345 read; grep for `version` in tools/route confirmed absent |
| FreshnessChip is a wall clock, not corpus freshness | [verified] FreshnessChip.js read |
| Data tools return non-corpus results with prose citations | [verified] registry.js kind: "data" entries + _freshness.js read |
| No violation surface from Academy today (Academy not built) | [code-read] no Academy directory exists in `src/` |
| Freeze reading ambiguity flagged | [code-read] inference from opd-autoprojection.yml behavior vs ruling text |
