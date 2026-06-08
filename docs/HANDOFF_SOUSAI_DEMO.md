# SousAI Demo - CC-Side Handoff

> **Written:** 2026-06-08, end of demo-build session
> **Author:** Claude Opus 4.7 (1M context)
> **For:** the next CC session continuing this work
>
> This is the CC-side handoff. Kevin is writing the architect-side handoff separately, covering business context + demo intent + tomorrow's CEO demo audience. The two together should be enough to continue without re-discovering. **CLAUDE.md is still canonical for ground rules.**

---

## 1. Branch state

### main (production)

- **Tip:** `7601aee` (origin/main)
- **What's live:** v1 SousAI pipeline (L1-L3) + retrieval RPC + admin archive/create + Brand & Standards shelf + character spec + retrieval harness 10Q
- **Production URL:** https://kitchfix-intranet.vercel.app
- **PRs that shipped v1:** #118 (SousAI L1-L3), #119 (admin archive/create), #120 (Brand & Standards shelf), #121 (character spec), #122 (10Q harness)

Key files on main:

| File / Dir | Purpose |
|---|---|
| `src/lib/sousai/{chunk,embed,extract,index,store}.js` | L1-L3 pipeline foundation |
| `src/lib/playbookValidation.js` | ID format + prefix↔class validation |
| `src/app/playbook/admin/AdminClient.js` + `admin.css` | Admin UI (archive/create + density polish) |
| `src/app/api/playbook/route.js` | Admin API actions (archive, restore, create-document, list-archived, archive-impact) |
| `scripts/sousai-embed-corpus.mjs` | Corpus embed CLI |
| `scripts/sousai-retrieval-test.mjs` | 10-question regression harness |
| `docs/SOUSAI_CHARACTER_SPEC.md` | Sous's character + behavior (canonical) |
| `docs/archive/specs/SPEC_INTRANET_AI_SEARCH.md` | Pipeline parking lot |
| `docs/DESIGN_SYSTEM_REFERENCE.md` | Web UI standards |
| `docs/migrations/pr-7-*.sql`, `pr-8-*.sql` | Schema applied to prod |

### feat/sousai-demo (where demo work lives)

- **Tip (committed):** `a65db10` — "sousai demo - working full-page version" **← SAFETY NET**
- **Working tree:** modal conversion uncommitted on top (see Section 5)
- **Status:** the demo can run from EITHER the committed full-page version OR the uncommitted modal version. Choice depends on whether Kevin verifies the modal works.

Commits on the branch (newest first, ignoring shared history with main):
- `a65db10` sousai demo - working full-page version *(SAFETY NET)*
- Branched off main at the pre-modal-conversion point; main has moved to `7601aee` but no conflicts on the demo files.

**Decision point for next session:**

| Kevin says | Do this |
|---|---|
| "Modal works end-to-end" | Commit modal: `git add -A && git commit -m "sousai demo - convert to in-place modal"`, then push |
| "Modal is flaky, fall back" | `git reset --hard a65db10` — restores committed full-page version, drops modal work |
| "Keep page version, ditch modal" | Same: `git reset --hard a65db10` |

### Cleaned-up / merged branches

`feat/admin-archive-create`, `feat/brand-standards-shelf`, `sousai-pipeline-l1-l3`, `docs/sousai-character-spec`, `feat/sousai-retrieval-harness-10q` — all merged via PRs #118-#122 and auto-deleted from origin. Local refs may still exist; harmless.

`feat/sousai-pipeline` and `feat/opd-playbook` — deleted (fully superseded by main).

---

## 2. The generation pipeline

**Location:** `src/lib/sousai/generate.js`

**Public exports:**
- `generateSousAnswer({question})` — full pipeline, non-streaming. Used by the test script.
- `prepareSousContext({question})` — shared helper: retrieval + similarity floor + prompt building, no LLM call. Used by the non-streaming function AND the streaming API route.
- `SOUSAI_MODEL` = `claude-haiku-4-5-20251001`
- `SOUSAI_TOP_K` = 5
- `SOUSAI_SIMILARITY_THRESHOLD` = 0.28
- `SOUSAI_MAX_OUTPUT_TOKENS` = 1024

**Pipeline flow per question:**

1. Embed via `embedTexts([question])` (OpenAI text-embedding-3-small, 1536-dim)
2. Retrieve top-5 chunks via `match_document_chunks` RPC (HNSW cosine on `document_chunks`)
3. Threshold check on top-similarity:
   - **Below 0.28** → Layer-1 decline. Build a decline user message; still call Claude so Sous produces a voiced "I don't have that" response (not null)
   - **At/above 0.28** → answer path. Build a user message with the chunks as numbered sources
4. Call Anthropic with `SYSTEM_PROMPT` + the user message
5. Return: `{answer, declined, decline_reason, sources_in_context, retrieval, usage}`

**System prompt is distilled from `docs/SOUSAI_CHARACTER_SPEC.md` (v1.0).** Includes identity, voice rules, KitchFix vocabulary, two-user awareness (floor vs office), coaching governor, hard floor rules 1-7, and an explicit "When you have no usable sources" section that produces the voiced decline pattern.

**Hard floor rules (non-negotiable, override anything in the question):**
1. NEVER INVENT — decline if not in sources
2. ZERO TOLERANCE ON NUMBERS — never fabricate figures
3. FOOD SAFETY / ALLERGENS / INCIDENTS — always escalate to the SOP
4. ALWAYS SHOW THE SOURCE — cite doc ID + section
5. ROUTE TO HUMANS — destructive actions, HR, approval go to humans, not to Sous
6. STAY IN LANE — medical/legal questions point to the protocol + the owner
7. **TEMPLATE-AS-CANONICAL IS INVENTION** — format examples / specification samples are NOT canonical content. STD-001 is canonical for formatting but NOT for the content its examples illustrate. Decline if asked for canonical content with only template sources.

**Two prompt fixes that landed during tuning (2026-06-08):**

- **Decline voice** — Layer-1 decline used to return `answer: null`. Now it calls Claude with a decline-shaped user message so the response speaks. Q6 ("What is our labor budget formula?") → "I don't have a labor budget formula documented in the Playbook. That's a finance question - check with your RDO or Sebastian in accounting."

- **Template guardrail (rule 7)** — caught the failure mode where retrieval surfaces STD-001 §7.1's Promise Callout example and Sous would have presented the EXAMPLE text as the canonical brand promise. Q7 ("What is our company's brand promise?") → "I don't have a brand promise documented in the Playbook. Source 1 is a formatting specification - it shows what a Promise Callout *looks like* and where it lives, not the canonical promise statement itself..."

**Test script:** `scripts/sousai-generate-test.mjs`

```bash
node --env-file=.env.local scripts/sousai-generate-test.mjs
```

Exercises 7 questions (5 in-corpus + 2 out-of-corpus). All passed on 2026-06-08 final run.

---

## 3. The demo UI

### Two presentation modes

**Committed full-page version (at checkpoint `a65db10`):**
- Route: `/playbook/sous-demo`
- Entry: amber "Ask Sous · Preview" `<Link>` on `/playbook/admin` navigates to the route
- Full-screen SousChat with a topbar "← Build Dashboard" link

**Uncommitted modal version (on top of `a65db10`):**
- Modal opens IN-PLACE on `/playbook/admin` — no navigation
- Entry: same button, but `<button onClick={() => setSousModalOpen(true)}>` instead of Link
- Overlay reuses admin archive/create modal treatment (`rgba(15,23,42,0.5)` backdrop + `150ms`/`200ms` ease-out + `radius: 12`), sized large (max-width 820px, height 88vh)
- Esc / click-outside / X-button close
- `/playbook/sous-demo` route still works as a fallback

### Files

| File | Role |
|---|---|
| `src/app/api/playbook/sous-demo/route.js` | Streaming POST endpoint, owner-gated, NDJSON output |
| `src/app/playbook/sous-demo/page.js` | Server wrapper for the route |
| `src/app/playbook/sous-demo/SousDemoClient.js` | Page wrapper: bootstrap + render SousChat full-page |
| `src/app/playbook/sous-demo/SousChat.js` | Pure chat component (transcript, streaming, markdown, chips) — shared, only present in the uncommitted modal version |
| `src/app/playbook/sous-demo/SousModal.js` | Modal overlay wrapper — uncommitted modal version only |
| `src/app/playbook/sous-demo/sous-demo.css` | All demo styles, density-system grounded |
| `src/app/playbook/admin/AdminClient.js` | Entry button (+ modal render in uncommitted version) |
| `src/app/playbook/admin/admin.css` | `.pb-admin-sous-btn` styles (amber-outlined Preview button) |

### Streaming architecture

- Client POSTs `{question}` to `/api/playbook/sous-demo`
- Server: `canViewPlaybook` gate → `prepareSousContext` → Anthropic call with `stream: true`
- Server parses Anthropic SSE, forwards as NDJSON events:
  - `{type:"meta", declined, sources_in_context, decline_reason, top_similarity}` — fires first; UI renders source chips/decline tag immediately
  - `{type:"text", chunk}` — many, the answer streaming in token-by-token
  - `{type:"done", usage}` — final
  - `{type:"error", message}` — on failure
- Client reads NDJSON line-by-line, accumulates streaming answer, renders progressively with a blinking caret
- `AbortController` on the in-flight fetch — aborted on unmount so closing modal mid-stream cleans up

### Owner gate

`canViewPlaybook(session.user.email)` re-checked server-side on every POST. `ANTHROPIC_API_KEY_SOUS` lives server-side only (never exposed to client). Page itself uses `/api/playbook?action=bootstrap` (same as admin) to check `isOwner` before rendering chat.

### Running locally

```bash
npm run dev
# → http://localhost:3000/playbook/admin  (signed in as k.fietek@kitchfix.com)
# → click "Ask Sous · Preview" in the tab nav
```

### Scripted demo questions

5 in-corpus + 2 out-of-corpus, in this order:

1. *What do I do if someone has an allergic reaction?* → PB-002 + SOP-002, cites both
2. *What are the top 9 allergens?* → PB-002 list
3. *What's the procedure for a safety incident?* → SOP-002 six steps
4. *What are the big rules?* → AGR-001 confidentiality
5. *What form do I use when someone refuses medical treatment?* → FORM-001 + SOP-002 §7.1
6. *What is our labor budget formula?* → Layer-1 decline (similarity floor), voiced
7. *What is our company's brand promise?* → Layer-2 decline (template guardrail), voiced

All 7 verified working on 2026-06-08.

---

## 4. The embed loop

**Script:** `scripts/sousai-embed-corpus.mjs`

**Modes:**
- No args → embed all Live docs not yet in `document_chunks` (missing-only mode)
- With doc IDs → re-embed those specific docs (delete-then-insert via the existing replaceChunksForDoc path)

```bash
node --env-file=.env.local scripts/sousai-embed-corpus.mjs
```

### Current corpus state (2026-06-04 last embed run)

| Doc ID | Title | Chunks | Path |
|---|---|---|---|
| AGR-001 | The Big Rules · Confidentiality | 32 | structure-aware |
| FORM-001 | Refusal of Medical Treatment Form | 1 | size-based fallback |
| PB-002 | Allergen Playbook | 31 | structure-aware |
| PB-003 | Service Recovery Playbook | 22 | structure-aware |
| POSTER-001 | The Big Rules Posting | 1 | poster stub |
| POST-002 | Allergen Awareness Poster | 1 | poster stub |
| SOP-002 | Safety & Incident Management | 36 | structure-aware |
| STD-001 | Documentation Format Standard | 66 | structure-aware |
| **Total** | **8 docs** | **190 chunks** | |

### Dispatch logic in `embed-corpus.mjs`

- `doc_class = 'POST'` → `embedPosterStub` (single stub chunk, contextual header + "this is a wall posting" disclaimer + summary)
- else, with `source_drive_id` → `embedDocument` (full Drive extract → chunk with ancestry-aware sections → embed)
- else (no Drive link, not POST) → skipped, no chunks rebuilt

### Adding a new Live doc

1. Add to catalog via admin Create modal OR direct insert
2. Set `status='Live'` and `source_drive_id=<Drive ID>` (or leave Drive null for POST stubs that need title + card_line + summary)
3. Verify service account has Viewer access on the Drive file
4. Run the corpus embed — it auto-picks up new Live docs not yet in `document_chunks`
5. Optionally rerun `scripts/sousai-retrieval-test.mjs` to confirm retrieval discrimination still holds at the new scale

---

## 5. Uncommitted state right now (2026-06-08)

On `feat/sousai-demo`, on top of committed `a65db10`:

| File | State |
|---|---|
| `src/app/playbook/admin/AdminClient.js` | Modified — added `SousModal` import + `sousModalOpen` state + `onSousClick` prop on TabNav + `<SousModal>` render |
| `src/app/playbook/sous-demo/SousDemoClient.js` | Modified — refactored to use the shared `SousChat` component |
| `src/app/playbook/sous-demo/sous-demo.css` | Modified — `.pb-sous-wrap` flipped to parent-driven sizing, `.pb-sous-page` added, `.pb-sous-modal-overlay/-frame/-close` added, mobile rules added |
| `src/app/playbook/sous-demo/SousChat.js` | NEW (untracked, 418 lines) — extracted chat component shared by page + modal |
| `src/app/playbook/sous-demo/SousModal.js` | NEW (untracked, 77 lines) — modal overlay wrapper |

**Modal-conversion semantics:**
- The button on `/playbook/admin` becomes a `<button onClick={...}>` that opens the modal instead of a `<Link>` that navigates
- The full-page route `/playbook/sous-demo` STILL WORKS as a fallback (SousDemoClient was refactored to use SousChat too, so both consumers share the same chat component)
- Body scroll lock while modal open, Escape-to-close, click-outside-to-close, X-button close
- `AbortController` aborts in-flight Claude streams on modal close mid-response

**Rollback (if modal flaky):**
```bash
git -C ~/dev/kitchfix-opd reset --hard a65db10
```
Restores the committed full-page version. The handoff commit will be dropped too — re-fetch it from this chat copy if needed.

---

## 6. Known gotchas

### Filed to memory (`/Users/kevinfietek/.claude/projects/-Users-kevinfietek/memory/`)

- **`project_playwright_ci_prod_url.md`** — `.github/workflows/e2e.yml` runs Playwright against the prod URL hardcoded in env, NOT the PR's preview deploy. Green check = "prod is up" not "PR code works." Don't rely on it for code coverage.
- **`feedback_no_em_dashes.md`** — Hyphens (`-`) only in writing. No em-dashes (`—`). Applies to docs, comments, commits, PRs.
- **`feedback_no_silent_scope_additions.md`** — Flag spec additions BEFORE folding in. No-surprises discipline.
- **`feedback_migration_fast_as_safe.md`** — Migration operating mode. Keep recon + dual-write + verdicts; drop re-audits + per-table PRs for easy tables.

### Other knowledge worth surfacing

- **pgvector requires dashboard-enable, not just SQL.** During L1 build, `CREATE EXTENSION vector` failed silently in Studio because pgvector wasn't pre-enabled in Supabase Dashboard → Database → Extensions. Watch for this on any future pgvector migration.

- **Branch protection on main requires PRs + Playwright check.** Direct push is blocked. Use GitHub PR flow for any merge to main. Playwright check is the prod-targeted smoke (above), green by default unless prod itself is broken.

- **Sous similarity threshold = 0.28.** From 2026-06-04 retrieval test: no-answer max ~0.22, weak-real min ~0.32, gap ~10pts. Held at 8 docs / 190 chunks. **May compress as corpus grows.** Eventual fix per the parking-lot open question: a verifier step (Claude judges relevance of retrieved chunks) instead of pure threshold.

- **Spanish retrieval is RESOLVED won't-do.** SousAI is English-only in practice. Spanish docs (POSTER-001, POST-002) are physical wall postings, never queried through Sous. `source_drive_id_es` fields harmless unused. See `docs/archive/specs/SPEC_INTRANET_AI_SEARCH.md` Open Questions section (one resolved, one still open about the threshold).

- **Design system: Ops Hub palette, NOT PFS.** Per `docs/DESIGN_SYSTEM_REFERENCE.md`:
  - Inter only (NO Oswald, NO Mulish on screen — Mulish is print-only)
  - Brand navy `#153968` + amber `#d97706` accent + neutral grays
  - Sky Blue `#C4E3E8` is PFS-palette only (Team Directory, customer-facing) — NOT Ops Hub
  - Density tokens 11/13/14/16/20/24, line-heights 1.3/1.15
  - 150ms ease-out default motion
  - Linear/Ramp calibration target
  - **STD-001/STD-002 are PRINT design standards. Do NOT use them as web UI references. That was a mistake earlier this arc and got corrected.**
  - Modal radius locked at 12

- **`--kf-navy` drift in globals.css.** Doc says `#0f3057` should be canonical `#153968`. Not fixed (sweeping refactor scope). New admin / sous code uses a local `--kf-brand-navy` for the canonical value while existing modules keep the drift until a system-wide pass.

- **Anthropic API keys are split.**
  - `ANTHROPIC_API_KEY` = main intranet (Invoice OCR, Smart Scan, Smart Inventory)
  - `ANTHROPIC_API_KEY_SOUS` = SousAI specifically
  - Both in Vercel (all 3 envs) and `.env.local`
  - Sous endpoint must use `ANTHROPIC_API_KEY_SOUS`

- **Verify, don't assume.** Examples that bit this session:
  - Grep false-positive: `getDocument` in InvoiceTool.js was `window.pdfjsLib.getDocument`, not our opd helper
  - Branch state needs git tool calls, not memory
  - Migration status needs verify-script confirmation, not "I think I applied it"
  - Memory items are point-in-time observations — verify against current code before relying on file paths or names

- **CLAUDE.md Danger Zones.** Don't edit without explicit user approval:
  - `src/lib/sheets.js`, `src/lib/auth.js`, `src/middleware.js`
  - `vercel.json`, `next.config.mjs`, `package.json`
  - Anything matching `.env*` (never read, never write, never echo)

---

## 7. What's next (execution view)

### Phase A — Doc loading (continuous, low-friction)

As Kevin authors new Playbook docs and sets them Live with `source_drive_id`, the corpus grows. Each addition extends Sous's coverage.

**Specifically flagged by character spec §13 as unauthored dependencies:**
- **Company-identity corpus** — brand promise, history, pillars, Latin-cuisine identity, standard-bearer ethos. Currently unauthored. Once written as canonical docs (not the STD-001 Promise Callout example), Sous will answer brand-promise questions cleanly. Today the template guardrail correctly declines.
- **Intranet-knowledge docs** — short docs describing each intranet page/tool/workflow so Sous can be the intranet expert too, not just the document expert.

**After each meaningful corpus addition:** rerun `scripts/sousai-retrieval-test.mjs` to confirm the 10 regression behaviors still hold (discrimination, ancestry, decline gap, stub directionality).

### Phase B — Generation to production (real, not demo)

The demo proves the engine. Productionizing requires:

1. **Verifier step** (the remaining open parking-lot question). As corpus scales beyond ~30 docs, the no-answer threshold gap may compress. Eventual fix: after retrieval pulls top-K, ask Claude "is this content actually relevant to the question?" before answering. Adds latency but catches false-confidence on weak retrievals. Decide before broad release.

2. **Surface promotion.** Move from `/playbook/sous-demo` (preview) to either a tab inside `/playbook` or a top-level `/sous` route. Drop the "Preview" tag. Broader gate (likely `isAuthenticated`) with role-based answer shaping.

3. **Streaming at scale.** Current setup streams through the Node API route. Edge-runtime considerations if latency-sensitive at scale.

4. **Conversation memory.** Per the parking-lot doc, conversation memory is an open question (within session? across sessions? per-user?). For the demo today: single-session transcript only, cleared on close.

5. **Slack escalation paths.** Per the character spec, Sous routes destructive/HR/approval to humans. Production wiring could surface Slack DM hooks for "ping the chef" or "ping Kevin" actions, but that's a feature beyond the engine.

---

## Quick-reference commands

```bash
# Run the demo locally (dev server)
npm run dev
# → http://localhost:3000/playbook/admin → "Ask Sous · Preview"

# Embed new Live docs (corpus loop, missing-only)
node --env-file=.env.local scripts/sousai-embed-corpus.mjs

# Re-test retrieval (10-question regression suite)
node --env-file=.env.local scripts/sousai-retrieval-test.mjs

# Test generation only (function-first, no UI)
node --env-file=.env.local scripts/sousai-generate-test.mjs

# Fall back to committed full-page demo (drop uncommitted modal)
git -C ~/dev/kitchfix-opd reset --hard a65db10

# Commit modal conversion (if Kevin confirms it works)
git -C ~/dev/kitchfix-opd add -A
git -C ~/dev/kitchfix-opd commit -m "sousai demo - convert to in-place modal"
git -C ~/dev/kitchfix-opd push origin feat/sousai-demo
```

---

## Environment notes

- `.env.local` has all needed keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY_SOUS`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`
- Vercel has both Anthropic + OpenAI keys in all 3 environments (Production, Preview, Development)
- Supabase has all required schema (`vector` extension enabled, `pr-7-1` through `pr-8-2` applied)
- Service account already has Viewer on all 8 currently-Live Drive files

---

## How to use this handoff

A fresh CC session should:
1. Read this file end-to-end
2. Read `CLAUDE.md` (the project ground rules - canonical)
3. Read `docs/SOUSAI_CHARACTER_SPEC.md` if any generation work is queued
4. Read Kevin's architect-side handoff for business context + demo intent
5. Check current branch + working-tree state before assuming this doc is still accurate (verify, don't assume — the modal-vs-page decision may have been made between when this was written and when it's read)
6. Pick up from whichever phase Kevin's queueing: corpus expansion, production wiring, or further demo iteration
