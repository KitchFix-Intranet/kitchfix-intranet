# 03 - Phase 2 Engineering Orientation

**Prepared:** 2026-06-12 by the CC engineering session.
**Nests under:** [`00_START_HERE_Project_Handoff.md`](./00_START_HERE_Project_Handoff.md).
**For:** the next CC session (or anyone coming in cold) who needs to know what to read, in what order, before doing engineering work in Phase 2.
**Convention:** hyphens only, no em-dashes.

> **TL;DR.** Phase 2 is small but exacting on the engineering side. Read 4 docs (this one is one of them), run one probe, do the Drive sharing batch, follow the runbook. You can be ready to execute in under an hour.

---

## 1. The reading order (in this exact sequence)

1. **[`00_START_HERE_Project_Handoff.md`](./00_START_HERE_Project_Handoff.md)** - orientation for the whole project (content + engineering). You are here in the package, not at the start of the work; finish START_HERE first.
2. **[`OPD_Phase2_Master_Charter.md`](./OPD_Phase2_Master_Charter.md)** - the plan, the method, and the 11-step sequence with checkpoints CK-1 through CK-8. The Charter routes everything else.
3. **[`01_CODE_VERIFICATION_REPORT.md`](./01_CODE_VERIFICATION_REPORT.md)** - what the Charter and briefs claim about the code, verified against current HEAD + live data. Read this so you know what's true today (one drift to know about: spec doc missing rule 7).
4. **[`02_ENGINEERING_RUNBOOK.md`](./02_ENGINEERING_RUNBOOK.md)** - the technical how-to, mapped to Charter CK-1 through CK-8. This is the doc you act from.

Then the content-method briefs, when you need to know how the audit thinks:

5. **[`OPD_Library_Audit_Brief_v2.md`](./OPD_Library_Audit_Brief_v2.md)** - the content review method (Workstream A).
6. **[`OPD_Intelligence_and_SousAI_Brief_v2.md`](./OPD_Intelligence_and_SousAI_Brief_v2.md)** - the deeper content + SousAI tuning method (Workstream B).
7. **[`OPD_Per-Document_Scorecard_v2.md`](./OPD_Per-Document_Scorecard_v2.md)** - the per-document worksheet. Its output is the catalog row + the SousAI metadata.

In the repo (canon, not Phase 2 specific):

- **`CLAUDE.md`** at repo root - project ground rules. Read fresh; it was updated 2026-06-12 with the migration-project closeout. New Danger Zone entries (`cutover.js`, `dataStore/*.js`, `docs/migrations/*.sql`) and a new rule (migrations don't auto-apply on deploy).
- **`docs/SOUSAI_CHARACTER_SPEC.md`** - the Sous character. Note the rule-7 drift documented in §7 of the verification report.
- **`docs/HANDOFF_SOUSAI_DEMO.md`** - the 2026-06-08 CC state of the SousAI demo. Branch state, pipeline architecture, corpus state at the time. Use as historical context; the verification report captures the more current state.

---

## 2. What changed since 2026-06-08 (one-line each)

- `origin/main` moved 7601aee -> e3d637f (36 commits). All invoice/inventory module work. No OPD or SousAI changes.
- `CLAUDE.md` was rewritten 2026-06-12 to reflect the migration project closeout. Read it again if you've been away.
- Live data: 42 catalog rows total, 8 Live, 190 chunks across 8 distinct docs. Content side has ~80 authored; that's the gap Phase 2 closes.
- The Sous demo UI work (modal vs full-page) is still uncommitted on `feat/sousai-demo` from the prior session. Unrelated to Phase 2.

---

## 3. What to know before touching anything

- **Read the Charter before the runbook.** The Charter is the what-and-when. The runbook is the how. Read in that order.
- **CK-1 and CK-2 are gates, not suggestions.** No engineering bulk write happens before CK-2 confirms the status mapping (Charter §6).
- **The OPD code, schema, and pipelines work today.** No engineering blocker exists for the start of the work; verification report §10 is explicit.
- **One drift to know about up front:** `SOUSAI_CHARACTER_SPEC.md` §8 has 6 hard floor rules but the code's system prompt has 7. The behavior is correct; the spec doc is stale. Fix is one paragraph appended to §8. PR-able any time during Phase 2.
- **Branch-and-PR for everything.** Direct push to `main` is blocked. The runbook §3 has the suggested PR boundaries.
- **Owner-only gate on `/playbook` is doing real work** during the bulk catalog load. Broken or half-loaded state stays invisible to other operators. Charter §7 says broad release is next phase.

---

## 4. Your first move

If you are picking this up fresh:

1. Read the Charter (15 min).
2. Read the verification report (10 min).
3. Run the recon probe to see what's true right now in the database:
   ```bash
   node --env-file=.env.local scripts/_probe_phase2_recon.mjs
   ```
4. Read the runbook's §1 step-by-step (15 min).
5. Bring CK-1 questions to Kevin (the company-identity corpus decision + the status mapping confirmation).

That gets you to where Phase 2 work can start. Total: about 45 minutes of reading + one probe.

---

## 5. The boundary you keep in your head

**Phase 2 ends when:** every Live-bound doc has a complete catalog row, is shared with the service account, renders in the iframe, is embedded, passes regression. No verifier-step build. No broad SousAI release. No new feature work.

**Phase 2 doesn't end when:** the company-identity corpus is loaded if that decision is deferred at CK-1 (it can be a documented deferral).

**Don't expand the scope.** "While we're in here" thinking is what makes Phase 2 not end. The next phase will pick up the verifier step, the broad release, and the role-shaped answers at scale. Charter §7 is the canonical reference for what is and isn't in this phase.

---

## 6. The single thing that fails Phase 2 worst

A confidently-wrong document that becomes a confidently-wrong SousAI answer. From the Charter §6 ground rule: "Do not invent operational actuals. A confidently-wrong document becomes a confidently-wrong brain. This is the one rule that, broken, does the most damage."

The engineering equivalent: writing a catalog row with a `card_line` or `summary` that you wrote (rather than the audit or Kevin produced), promoting to Live, embedding. Sous now cites a wrong thing with full confidence and the source label gives it audit-trail credibility. The hard floor catches the worst cases but the chunk you wrote still ranks.

Do not write catalog content. Write the row, with the content the Scorecard produced.
