# OPD Library Audit Brief - v2 (Phase 2)

**Supersedes:** OPD Library Audit Brief v1
**Read with:** the Phase 2 Master Charter (the method and sequence live there), the Per-Document Scorecard v2 (the worksheet), and both CC State Briefs (OPD, SousAI).
**Convention:** hyphens only, no em-dashes.

This is **Workstream A** - hardening the content. v2 differs from v1 in four ways: it runs the multi-pass method from the Charter, it produces the catalog and SousAI metadata (not just findings), it adds the SousAI-specific checks (template-as-canonical, chunking-readiness), and it aligns every status and gate to the real OPD schema.

---

## 1. Why this matters (unchanged, and now sharper)

This library becomes two things at once: the **operator source of truth** in the `/playbook` catalog, and the **knowledge corpus for SousAI**. A document that is individually well-written but **contradicts another** is more dangerous than a mediocre one, because SousAI will retrieve one of the conflicting answers and state it as fact, and two operators will do two different things while both believe they followed the playbook.

You are auditing one interconnected system, not 80 separate files. And per Kevin's direction, you build the whole picture first and then revise - more than once - because revising one document changes the state the others were judged against. The full method is §3 of the Charter; this brief is what you do inside it.

---

## 2. Your role and the hard limits

You are an expert HR and Operations reviewer and a knowledge engineer. Be rigorous, specific, and honest.

- **You are not legal counsel.** Flag legal-adjacent content for counsel review with what needs checking and why; do not rule on compliance. (§8.)
- **You do not invent.** This mirrors SousAI's own hard floor. Where a document needs an operational "actual" you do not have, you do not fill it with a plausible guess - you flag it for Kevin in the Actuals Needed register and he supplies the truth. A confidently-wrong document becomes a confidently-wrong brain.
- **Every finding cites the document ID and the section.** An untraceable finding is opinion.

---

## 3. The passes (from the Charter - here is what each produces in Workstream A)

- **Pass 0 - deep knowledge build.** Read everything; build the dependency graph (§6a); write the Library Understanding artifact. No edits.
- **Pass 1 - per-document audit.** One Scorecard v2 per document.
- **Pass 2 - library-level audit.** The system checks (§6).
- **Pass 3 - revision.** Reconcile conflicts; enrich with actuals (Kevin-supplied). Maintain the Actuals Needed register.
- **Pass 4 - re-audit.** Re-run cross-reference and contradiction checks on the revised library. This is the second application.
- **Pass 5 - finalize catalog + SousAI metadata** (§7).

---

## 4. KitchFix conventions - do not flag these as errors

These are intentional. (If one is misapplied in a specific doc, that is a finding; the convention is not.)

- **Floor-then-override.** Company floor as default, then client/state overrides on top (SLAs, multi-state policies, the WC and permit annexes).
- **Point-don't-duplicate (single source of truth).** Each fact homed once; everyone else references it by Document ID. The Employee Handbook is intentionally a readable bundle that points to the authoritative policies.
- **Condensed policy format is intentional for short POL docs** (no version-history section, sections flow continuously). Manuals (PB) and SOPs keep TOC + version history + section-per-page. Different classes, different formats.
- **STD-001 is the print format standard.** Audit format against it. STD-002 is the visual/posting standard. **Neither is a web UI reference** - do not apply them to intranet styling (that confusion has happened before).
- **Em-dashes in the print library are correct** (STD-001, Kevin's preference). Do not strip them. The no-em-dash rule governs code, repo docs, commits, and Sous's voice - not the printed playbook. (Charter item D.)
- **Two standing SLA removals.** SLAs intentionally omit a §7 Performance Reporting table and a §8 Latin Cuisine banner; Latin content sits inside the §4 operating spec. Not a gap.
- **English-only corpus.** The `-ES` documents (POL-006-ES, PB-004-ES, POST/POSTER -ES) are physical wall postings and handbook translations, never queried through Sous. Do not flag the English library as "missing Spanish," and do not treat `-ES` docs as separate knowledge entries. (SousAI handles POST-class as a stub - SousAI brief §9.)
- **Galley is not the recipe system of record.** Recipe/production-list language should be generic. Naming Galley as the system of record is a finding.
- **Brand promise and non-negotiables.** "Best Food, Best Service, Best Hospitality." Latin cuisine non-negotiable on every account. Flag drift in wording.
- **Two financial models.** Fee (client owns food cost, KitchFix manages) vs full-service (KitchFix buys food, all-inclusive fee).
- **Org/role context.** Josh (CEO) -> Joe Lessard (VP Ops) -> Kevin (Sr Dir Ops) and Britt (Dir Culinary); Sebastian (Accounting), Mariela (HR). RDOs -> ECs -> site triad (EC / Sous / Hospitality Manager) -> hourly. Eight states: AZ, FL, IL, KY, MO, NY, OH, TX.

---

## 5. Pass 1 - the per-document review

For every document, complete one Scorecard v2. The document-level criteria:

1. **Accuracy & compliance.** Facts current. Food safety = **135F hot / 41F cold** (flag any 140/40 as Critical). Legal content flagged for counsel (§8). Regulatory content tied to the right authority.
2. **Operator-actionability.** Passes the KitchFix standard - *specific enough for a cook to act on tomorrow*. Right altitude for its class. Readable by hourly/ESL staff (this also matters for `card_line` quality).
3. **Completeness, status honesty, and actuals.** Placeholders clearly visible and the doc not falsely advanced toward Live? And - new in v2 - **does the document have the operational actuals it needs, or is it thin where it should be specific?** A doc that says "manage the client relationship" or "staff appropriately" without the real KitchFix detail is an enrichment target. Log what actual is missing.
4. **Format & metadata integrity.** STD-001 compliance, and is the metadata real and correct (ID, Title, Version, Status, Owner, Approver, Classification)? Now also: **does the stated status map cleanly to a valid OPD enum value** (Charter §6)? "In review," "Queued," etc. are not OPD-valid.
5. **(New) SousAI-readiness at the document level.**
   - **Template-as-canonical risk:** does this doc contain example, specimen, or "fill-in" content that could be retrieved and mistaken for real policy? (STD-001 callout examples; all TPL-class docs.) Mark it - SousAI must treat it as non-canonical (hard floor rule 7).
   - **Chunking-readiness:** does the document have a real heading hierarchy (true Google Docs `HEADING_1..6` styles, not bold text) that will survive conversion? Multi-section docs without it will chunk as one undifferentiated blob and retrieve poorly. (Charter item E - the most important technical-content interface point.)
   - **Number and claim hygiene:** SousAI has zero tolerance for fabricated figures. Flag any number, date, or dollar figure that looks like a placeholder, an example, or an unverified estimate, because Sous will quote it.

---

## 6. Pass 2 - the library-level review

**6a. Dependency graph & load-bearing analysis.** Build the graph (nodes = docs, edges = references). Rank by in-degree. Identify the load-bearing documents (expect STD-001, SOP-002, the PB-010 / PB-005 / SOP-008 spines) and pre-compute blast radius (when PB-006 lands, what flexes?). Find orphans (findability dead zones) and islands (siloed clusters). This re-prioritizes the whole audit and is the Pass 0 deliverable.

**6b. Cross-reference integrity.** Every Related Documents entry and inline Document-ID reference resolves to a real doc with an accurate status label. **Hunt inbound references to the retired set** (§9) - those should have zero live pointers. These map directly to `document_relationships` rows at load time, so getting them right here populates the catalog correctly.

**6c. Contradiction hunt (highest-value exercise).** Try to make the library disagree with itself. Ask the same operational question against every doc that could answer it, and flag every disagreement. At minimum: hot/cold temps (135/41); is worked-but-unapproved overtime paid (yes, always); sick-leave accrual (1 per 30, company blanket, annex bumps up); who approves a menu change (dietitian + Dir Culinary); full-time threshold (30+ hrs); where the record-retention/legal-hold rule lives now (POL-016 was retired - confirm nothing points to it and that the rule has a home or is a known gap). This is exactly how Sous will be queried.

**6d. Terminology consistency.** "People Operations" vs "Human Resources" (sweep to Human Resources / Mariela Chavez pending - flag every instance), "Executive Chef" vs "site leader," brand-promise wording, the two financial-model names, any "Galley as system of record."

**6e. Coverage & gap map.** Map against what a pro-sports contract-foodservice operation needs (Operations, Food Safety, HR, Finance, Culinary, Client/SLA, Safety, Training, Brand). Surface thin/absent areas. Known: the culinary baseline (PB-006/PB-011), game-day ops, and - flagged by SousAI itself - the **company-identity corpus** (brand promise, history, pillars, Latin-cuisine identity) and the **intranet-knowledge docs**. These last two are content this session can author; raise them at CK-1 (Charter item I).

**6f. Governance / publish-readiness.** Per doc: **Ready to publish**, **Ready pending SME** (name the SME), or **Not ready**. This verdict is the Live gate.

---

## 7. Pass 5 - finalize the catalog + SousAI metadata (the bridge to Workstream B)

For every Live-bound document, produce and confirm the data the catalog and SousAI need. This is content work, done by you, captured in the Scorecard:

- **`card_line`** - the one-line operator description on the browse card. Required by `chk_live_complete`. Write it floor-first: what this doc is, in the words an operator uses, in one line. (Most docs do not have this yet - writing it is part of the audit.)
- **`summary`** - the longer descriptive paragraph; a primary SousAI retrieval signal.
- **`keywords`** - the operator vocabulary someone would actually search.
- **`shelf`** (one of the 7), **`owner`** and **`approver`** (role titles, never names), **`audience`** (operator / corporate / internal), **`classification`**.
- **`status`** mapped to a valid OPD enum value (Charter §6).
- **relationships** - the `document_relationships` edges (references / implements / supersedes / superseded_by / derived_from / related), from the cross-reference work in 6b.
- **chunking-readiness** confirmed (real heading hierarchy) or flagged for fix before embed.
- **template-as-canonical** marked where it applies.

---

## 8. The legal-flag rule (unchanged)

You flag; counsel rules. For wage/hour (POL-008), leave (POL-015), EEO (POL-010), anti-retaliation (POL-011), classification (POL-013), work authorization / E-Verify (POL-012, on hold), anti-harassment / arbitration (POL-006), workers' comp (REF-001), permits (POL-019), and any regulated food-safety content or hard legal number: raise a LEGAL-REVIEW flag with the document, the section, what needs a lawyer, and why. Do not state whether it is compliant.

---

## 9. Known open threads and the retired set

**Open threads** (confirm each is handled correctly; a doc that asserts a wrong answer here is Critical because it becomes a wrong Sous answer): E-Verify / Arizona (POL-012 on hold; SOP-005 work-auth step open); the People-Operations-to-Human-Resources naming sweep (pending); the Employee Handbook reconciliation (135/41 fix, anti-retaliation pointer, EEO list, arbitration clause, When-I-Work removal - it is all Rippling now); the Tier-3 orphans (PTO/holiday/jury into POL-015, social media into AGR-001, dress code into POL-002); and the intentional-placeholder docs (SOP-009 product list / Britt; PB-009 finance / Sebastian; PB-013 cert matrix / HR; REF-001 state data / broker; POL-019 §04 register / Finance).

**Retired set** (should have zero live inbound references - any pointer to one is Critical): POL-005, POL-012 (on hold), POL-016, POL-017, POL-018, SOP-011, REF-008, REF-009, plus any others marked Retired in the tracker. **Confirm the list against the tracker before relying on it.**

---

## 10. Output (what Pass 1-5 produce)

- **Per-document scorecards** (Scorecard v2) - which double as the catalog/SousAI metadata.
- **Library findings report** - the dependency graph, the contradiction log, terminology drift, the gap map.
- **Prioritized remediation worklist** - every finding ranked by severity (Critical / Major / Minor per the Charter), with the doc, the fix, and the SME or actual needed.
- **Actuals Needed register** - the specific operational questions only Kevin/operators can answer, blocking enrichment.
- **Publish-readiness verdict table** - Ready / Ready-pending-SME / Not ready, the Live gate.

Surface Critical findings first, in their own summary (CK-3). Distinguish what the library **says**, what it **implies**, and what it **omits** - the omissions are where the brain is most dangerously confident.
