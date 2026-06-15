# START HERE - OPD / SousAI Project Handoff

**Read this first.** It is the front door. It orients you, then points you to everything else in the right order.
**Prepared:** 2026-06-12, for the session continuing this project into Phase 2.
**Convention across this package:** hyphens only, no em-dashes (one documented exception in §6).

---

## 1. You are joining a project already in motion

This is **not a fresh start.** KitchFix has spent the last stretch building two things: a library of roughly 80 operational documents, and the systems that will serve them (a document catalog and an AI assistant). A lot is already decided, authored, and shipped. Your job in this next phase is to **extend and execute what exists - review it, sharpen it, and bring it live** - not to redesign it from scratch. Where this package states a convention or a decision, treat it as settled unless Kevin reopens it.

Hold that mindset the whole way through. The fastest way to waste this phase is to re-litigate things that are already done.

---

## 2. The project in one paragraph

KitchFix is a food-service company that runs the kitchens for professional baseball organizations (MLB clubhouses, MiLB, player-development complexes) and corporate sites. **OPD** (the Operations Playbook Database) is the company writing itself down: one catalog, one stable identity per document, the single source of truth for how KitchFix operates. **SousAI** is the assistant built on top of it - the longest-tenured operator who has read every document, available to anyone in the company at any hour, who answers with the source cited and never makes things up. The library is the company's brain; OPD is where it lives; SousAI is how operators talk to it.

---

## 3. Where things stand right now (June 2026)

- **The library:** ~80 documents authored, fast, to lay a foundation. The foundation is real and good, but it was built incrementally - some documents predate deeper operational knowledge, some are thin on the "actuals" of how the company truly runs, and some conflict with documents written later.
- **OPD (the catalog):** built and in production. 8 documents are Live; the rest are authored and waiting to land. The schema, the lifecycle, the admin dashboard, and the Drive integration all exist.
- **SousAI (the assistant):** the full pipeline is built (extract -> chunk -> embed -> retrieve -> generate), with a strict character and a hard floor of safety rules. 8 documents are embedded. A working demo exists but is not yet in broad production.
- **This phase (Phase 2):** take the ~80-document foundation from "authored" to "trustworthy and live" - a full-depth review, a knowledge-informed revision, and a clean load into the catalog and SousAI.

---

## 4. Who's who

- **Kevin Fietek** - Sr. Director of Operations, and the person you work with directly. He authored the library and built the systems solo. He owns every decision in this phase. Many documents are thin because the operational reality they need lives in his head and his operators' - so part of your job is asking him precise questions, not inventing answers.
- **The org:** Josh Katt (CEO) -> Joe Lessard (VP Operations) -> Kevin (Sr Dir Ops) and Britt Chernikovich (Director of Culinary). Sebastian Castro (Accounting). Mariela Chavez (HR). Field: Regional Directors of Operations -> Executive Chefs -> the site triad (Executive Chef / Sous Chef / Hospitality Manager) -> hourly staff.
- **The SMEs you will route to:** Britt (culinary), Sebastian (finance), Mariela / HR (people), and outside counsel (anything legal). Several documents are intentionally blocked on one of them.
- **The two sessions whose work you inherit:** a **content session** (built the document library and the review method you are about to use) and an **engineering session** (built OPD and SousAI, and wrote the two State Briefs). This handoff exists to align you with both.

---

## 5. Your reading map (in order)

1. **This document** - orientation. You are here.
2. **OPD / SousAI Phase 2 Master Charter** - the plan. What Phase 2 is, the method ("deep knowledge first, then apply more than once"), the full sequence with checkpoints, and the decisions Kevin owes you. **Read this second; it routes the rest.**
3. **OPD Complete State Brief** (engineering) - the catalog: schema, lifecycle, the go-Live gate, Drive integration, the load mechanics.
4. **SousAI Complete State Brief** (engineering) - the assistant: the pipeline, the character hard floor, the chunker, the retrieval thresholds, the open questions.
5. **OPD Library Audit Brief v2** - how to review and revise the content (the per-document and library-level method).
6. **OPD Intelligence & SousAI Brief v2** - the deeper content/intelligence method and how to verify and tune the existing SousAI at 80-document scale.
7. **OPD Per-Document Scorecard v2** - the worksheet you fill per document; its output is the audit record, the catalog row, and the SousAI metadata in one.

Plus the working data and standards:
- **Documentation Tracker** - the content-side catalog of all ~80 docs (status, owner, approver, notes).
- **Document Inventory** - the visual map of how the library is grouped.
- **STD-001 / STD-002** - the print format and visual standards (audit against them; they are not web UI references).
- In the repo: **CLAUDE.md** (canonical project ground rules), and the SousAI character spec and design/handoff docs.

---

## 6. The global ground rules (these apply to everything)

- **No silent scope additions.** If you want to add to the plan, surface it and wait. Do not add-then-explain.
- **Verify, do not assume.** The briefs and any memory are point-in-time. Check the current code and data before relying on a file path, a function name, or a row count.
- **Do not invent operational actuals.** Where a document needs the real detail of how KitchFix operates and you do not have it, name the gap and ask Kevin. A confidently-wrong document becomes a confidently-wrong brain. This is the one rule that, broken, does the most damage.
- **Flag legal, do not rule on it.** Raise legal-adjacent content for counsel with what needs checking and why. You are not the lawyer.
- **No em-dashes** in code, the repo, commits, and SousAI's voice - hyphens only. **The one exception:** the printed STD-001 document library uses em-dashes on purpose; do not strip them.
- **Surgical over sweeping.** A 4-line fix that solves the real thing beats a 400-line refactor.
- **Branch-and-PR for everything.** Direct push to production is blocked. Read CLAUDE.md before touching anything near the Danger Zone files.
- **Floor-first.** The end user is often a chef on a phone in a cold kitchen with wet hands. Write and build for that person.

---

## 7. Your first move

Do not start editing or loading anything. Read the Charter, then begin **Pass 0**: read the entire library and the two State Briefs, build the dependency map, and write up your understanding of the whole interconnected system - with **no changes yet**. Bring that to Kevin at the first checkpoint (CK-1), along with two decisions the Charter flags for him: the status mapping and whether Phase 2 authors the company-identity content.

Understanding the whole picture comes before touching any one piece. That is the core of how this phase is meant to run.

---

## 8. How Kevin works

He is direct and moves fast. He values honest pushback over agreement - if something is wrong, say so, with the reason. Short confirmations ("good," "great," "build it") mean proceed. He reviews work himself before it advances. He prefers options with a clear recommendation, the biggest issue flagged first. This is a long-running, high-trust collaboration; treat it like one.
