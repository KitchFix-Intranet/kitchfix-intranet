# OPD Intelligence Extraction & SousAI Brief - v2 (Phase 2)

**Supersedes:** OPD Intelligence Extraction & Sous AI Design Brief v1
**Read with:** the Phase 2 Master Charter, the Audit Brief v2, and both CC State Briefs. The SousAI Brief and `docs/SOUSAI_CHARACTER_SPEC.md` are authoritative for anything about how Sous already behaves.
**Convention:** hyphens only, no em-dashes.

**What changed from v1:** v1 was written before the SousAI architecture was known. It read as "design the intelligence layer." That is wrong now - **the layer is built and shipped** (L1-L5, the character hard floor, the structure-aware chunker, the 0.28 retrieval threshold, the regression suite). So v2 re-aims Workstream B from *designing* to **verifying, stress-testing, and tuning the existing system at 80-doc scale, and extracting the derived intelligence the corpus makes possible.** Do not redesign what exists; confirm it holds and feed it well.

---

## 0. How this fits

The audit (Workstream A) makes the content correct. This brief makes it **intelligent, safe at scale, and alive** - on top of the SousAI system that already exists. Run it inside the Charter's pass structure. Several of these passes also strengthen the audit (the graph re-prioritizes it; the persona and red-team passes surface document-level findings the straight audit misses).

| Pass | Name | Primary artifact |
|---|---|---|
| 3 | Knowledge-graph & load-bearing analysis | Dependency Map + Load-Bearing Register |
| 4 | Red-team the hard floor at 80 docs | Sous Safety Verification Report |
| 5 | Multi-persona reads (incl. the floor/office spectrum) | Persona Read Reports |
| 6 | Tacit-knowledge mining (feeds the "actuals" enrichment) | Tacit-Knowledge Gap Register |
| 7 | Curriculum & competency extraction | Role Learning Paths + Competency Checks |
| 8 | Operational simulation | Scenario Log + Decision Trees + Compliance Calendar |
| 9 | SousAI tuning & verification at 80 docs | Retrieval Verification + Tuning Report |
| 10 | Strategic & moat lens | Strategic Assessment |
| 11 | Culture & voice | Culture & Voice Read |

---

## Pass 3 - Knowledge-graph & load-bearing analysis

Build the dependency graph from every reference. Rank by in-degree to find the **load-bearing documents**, so audit and revision energy concentrates where a wrong fact poisons the most downstream. Pre-compute blast radius (when PB-006 lands, what flexes). Find orphans and islands.

**New alignment:** the edges you find here are the `document_relationships` rows the catalog needs. SousAI retrieval has been proven to follow cross-document references in source text (the SOP-002 §7.3 -> PB-002 §06 case retrieved both correctly), so a well-populated relationship graph is not just navigation - it improves retrieval. **Artifact:** Dependency Map + Load-Bearing Register, plus the relationship-edge list for the load.

---

## Pass 4 - Red-team the hard floor at 80 docs

SousAI already has a 7-rule hard floor (never invent; zero tolerance on numbers; food-safety/allergens/incidents always escalate to the SOP; always cite; route to humans for destructive/HR/approval; stay in lane on medical/legal; template-as-canonical is invention). Your job is **not to design guardrails - it is to verify they hold at 80 docs and find where they leak.**

- **The 5am crisis test.** Run the hardest real-moment questions and confirm Sous gives a correct, findable, cited answer or a dignified decline - never a confident guess. Use KitchFix-real crises: walk-in fails at open, allergic reaction, injured dishwasher, angry GM, game-day no-show, failed inspection, mid-service recall. The seams between documents are where it fails; at 80 docs there are far more seams than at 8.
- **Number-fabrication stress.** Hard floor rule 2 is zero-tolerance on numbers. With 80 docs full of figures, dates, and dollar amounts, probe for any case where Sous would quote a placeholder, an example figure, or an unverified estimate as fact. Every such case is a content fix (Audit Brief v2, §5 number hygiene) and a guardrail test.
- **Template-as-canonical at scale.** The brand-promise example in STD-001 already triggered the correct Layer-2 decline. With all TPL-class docs and every STD example now in the corpus, confirm the guardrail still distinguishes specimen content from canonical content. This is the rule most likely to leak as the corpus grows.
- **The decline boundary.** Confirm Sous declines cleanly when the answer is not in the corpus, and that the decline points to where it might live or who owns it (the character spec voice). Map where Sous *should* decline but might not at 80 docs.
- **Do-not-answer cases.** Confirm Sous refuses player medical/dietary data (POL-014 confidentiality), inspection-dodging, food-safety shortcuts, and anything harmful, and routes to the human who owns it.

**Artifact:** Sous Safety Verification Report - where the hard floor holds, where it leaks, and the content or prompt fixes each leak needs. This gates broad release.

---

## Pass 5 - Multi-persona reads

Re-read the whole library as each persona and report what each sees. **Aligned to the two ends SousAI already serves** (the floor: chef on a phone, wet hands, mid-shift, needs 2 lines; the office: director at a desk, reads denser):

- **First-day dishwasher, ESL** - comprehension; also a direct test of `card_line` and summary quality (these are what the floor reads first).
- **Brand-new EC, day one** - do I know what to do, or only what to value?
- **Health inspector** - does the food-safety system hold to an outside expert?
- **Client team dietitian** - does the culinary/nutrition content earn professional trust?
- **Plaintiff's employment lawyer** (highest value for legal flags) - what would they attack? Feed into the audit's legal-review flags.
- **Prospective-account GM** - does this make KitchFix look like a partner with its act together?

**Artifact:** Persona Read Reports. The dishwasher/EC reports feed `card_line`/summary quality and actionability; the lawyer report feeds legal flags; the GM report feeds Pass 10.

---

## Pass 6 - Tacit-knowledge mining (this is Kevin's "actuals" problem)

The biggest risk to a knowledge hub is what the library **assumes but never states** - and Kevin has named this directly: some docs are thin because they were written before the deeper operational knowledge existed. Surface every place a document gestures at judgment or experience it never teaches ("set up the station correctly," "manage the relationship," "staff appropriately"). Distinguish *intentionally* tacit (genuine judgment) from *accidentally* tacit (should be written down).

**This pass directly feeds the Audit's revision step (Pass 3 / Actuals Needed register).** What you surface here is precisely the list of operational actuals to get from Kevin and write into the thin documents. **Do not invent the actual** - name the gap and the question.

**Artifact:** Tacit-Knowledge Gap Register, ranked by how often an operator hits it and how badly it bites. This becomes a real chunk of the enrichment work and the future build backlog.

---

## Pass 7 - Curriculum & competency extraction

Turn the corpus into PB-013's actual training program: role-based learning paths (cook, FOH, dish, Sous, Hospitality Manager, EC, RDO), competency checks/quizzes per role (feed SOP-005 and PB-013), and the "minimum viable knowledge" per role. The minimum-viable sets also inform how Sous shapes answers by audience.

**Artifact:** Role Learning Paths + Competency Checks.

---

## Pass 8 - Operational simulation

Run KitchFix from the documents alone and find where it stalls.

- **Scenario stress-tests** (recall, surprise inspection, EC quits mid-homestand, rain delay, new-account standup) - every stall is a gap, surfaced before an operator hits it.
- **Decision-tree extraction** - pull the implicit "if X do Y, escalate if Z" logic into explicit, visual trees. Operators follow trees, not paragraphs, at 100F on the line. These are also strong SousAI answer scaffolds.
- **The consolidated compliance calendar** - mine every deadline, renewal, and recurring obligation across all 80 docs (permits/POL-019, certs/PB-013/Rippling, inspections/CHK-003, performance cycles, WC/OSHA, SLA reviews, mock recalls/SOP-014) into one timeline. This exists in no single document and is pure operational gold.

**Artifact:** Scenario Log + Decision Trees + Compliance Calendar.

---

## Pass 9 - SousAI tuning & verification at 80 docs (the must-do)

The system is built; this pass confirms it still works at 10x the corpus and tunes what slipped. Use the existing scripts (`sousai-retrieval-test.mjs`, `sousai-generate-test.mjs`) and the contracts in the SousAI brief.

- **Chunking-readiness (the critical interface).** SousAI's chunker is structure-aware: it splits on Google Docs `HEADING_1..6` and builds the ancestry path that makes retrieval good; without a heading hierarchy it falls back to one size-based chunk. **Confirm every multi-section doc's heading hierarchy survives the docx -> Google Doc conversion as real heading styles.** A manual that chunks as one blob retrieves badly. This is the same item as Charter E and Audit v2 §5 - own it here for the corpus.
- **Re-verify the no-answer gap.** At 8 docs the gap between weakest real hit (~0.32) and best out-of-corpus miss (~0.22) was ~10 points. SousAI flagged that 80 docs is exactly where this may compress. Re-run the regression and measure the gap. **If it compresses below ~5 points, the verifier-step decision becomes urgent** (next bullet).
- **The verifier-step decision (open question, may become a blocker).** The candidate fix is: after retrieving top-K, ask Claude "is this content actually relevant?" before answering, to catch false confidence on weak retrievals at the cost of one extra call. **Decide in Phase 2** whether it is needed, based on the measured gap. Deciding is in scope; building it as a feature may spill to the next phase (Charter §7) - flag if so.
- **Discrimination & leak check.** Confirm a query still pulls the right doc and does not leak across domains now that more docs share vocabulary (the allergen query should still land on PB-002; incident on SOP-002).
- **Prompt and top-K tuning.** The system prompt and top-K=5 were grounded in 8-doc behavior. At 80 docs Sous may need clearer domain-routing guidance (more docs = more domain boundaries), multi-doc synthesis handling (when retrieval pulls 3+ docs), and a top-K revisit. Tune against the regression, surgically.
- **Citation is already enforced** (hard floor rule 4). Confirm it holds across the larger corpus; do not rebuild it.
- **The company-identity corpus gap.** Closing it (Pass 6e of the audit / Charter item I) is what lets Sous answer "what is our brand promise?" with canonical content instead of the template-guardrail decline. Verify the fix once that content is authored and embedded.

**Artifact:** Retrieval Verification + Tuning Report - the gap measurement, the verifier-step decision, the discrimination results, and the surgical prompt/top-K changes. With Pass 4's Safety Report, this is the **Sous broad-release readiness package** (the broad release itself is next-phase per Charter §7).

---

## Pass 10 - Strategic & moat lens

Read the library as a competitive asset. What is genuinely proprietary and defensible (the PDC season flow, the fee-model discipline, Latin-cuisine-in-a-clubhouse, the hospitality standard) vs industry-generic? Stress-test expansion: if KitchFix moves into MLS / NBA / NHL / collegiate, what breaks - flag everything baseball-specific (meal cadence, game-day templates, PDC/spring-training, homestand/road rhythm) that will not transfer, and define what a league-agnostic core needs. Flag any safe, valuable slice that could become a client-facing Sous.

**Artifact:** Strategic Assessment.

---

## Pass 11 - Culture & voice

In aggregate the library reveals what KitchFix believes about its people, standards, and failures. Does it sound like one company or ten authors? Check against the brand promise and the "Best Places to Work in Sports" identity. Note that Sous has its own deliberate voice (confident, dense, tactile; banned openers and words; hyphens only) - the *library's* voice and *Sous's* voice are different surfaces, but the library's voice is what Sous is built from, so a fractured library voice becomes an inconsistent brain.

**Artifact:** Culture & Voice Read.

---

## 12. Output discipline (every pass)

- Every finding cites **document + section** and a **severity** (Critical / Major / Minor).
- **Flag legal, do not rule.**
- **Do not invent operational actuals** - name the gap, ask Kevin.
- Outputs are structured and machine-usable, designed to flow into the tracker, the catalog, and the corpus - not prose essays.
- Surface Critical findings first.
- Distinguish what the library **says**, **implies**, and **omits**.

The audit makes the content correct; this brief confirms the brain that runs on it is safe, holds at scale, and gives back the derived intelligence the corpus makes possible. Verify what exists; do not rebuild it.
