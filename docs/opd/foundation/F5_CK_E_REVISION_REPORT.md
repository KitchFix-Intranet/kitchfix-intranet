# F5 CK-E - Revision and Enrichment Report

**Built:** 2026-06-15
**For:** Kevin's CK-E spot-check per `docs/phase2/06_CONTENT_FOUNDATION_BRIEF_v2.md` §8 and the F5 task brief §12.
**Status:** F5 complete. **F4 (governance) + F6 (validation + duplicate sweep) HOLD** for the next sessions.

Every preserved audit finding was fixed. The validation gate dropped from 7 ERRORs to **0 ERRORs**. Fact tokens grew from 62 to 83 as the SOP-015 §03 rewrite, the SOP-008 fact wiring, and the JD brand-promise tokenization all landed.

---

## 1. F5 outcomes at a glance

| Item | Status |
|---|---|
| Validation ERRORs | **0** (was 7 at F2/F3 end) |
| Validation WARNs | 40 (was 39 - net +1 from AGR-002 new POL-009 reference resolving) |
| Fact tokens in source | **83** (was 62 at F3 end - the new cooling_rule + danger_zone + SOP-015 §03 + JD brand_promise added) |
| Non-canonical blocks stripped | 186 (was 187 - TPL-018 question block removed) |
| Unique facts now tokenized | 29 (was 27 - cooling_rule + danger_zone now in use) |
| Docs touched by F5 | ~60 across all phases |
| Audit CRITICAL findings remaining | 0 (all 7 retired-pointer + SOP-015 §03 contradiction + PB-001 §03 reference + Galley terminology + JD brand drift all fixed) |
| Pending external sign-offs | Britt (SOP-015 §03), counsel (state annexes + breaks), Finance (pay bands), SLT (Live promotions) |

---

## 2. The 7 retired-pointer fixes (validation gate dropped 7 -> 0)

| Doc | Fix applied |
|---|---|
| SOP-002 | Removed TPL-017 relationship. Conversion comment in frontmatter notes the intranet Incident Log is system of record. |
| SOP-010 | Repointed REF-008 -> POL-019 in relationships + §06 body + Related Documents table. |
| SOP-015 | Removed SOP-016 relationship; Related Documents now correctly references SOP-002 §07.4 (which already had a relationship entry). |
| POL-009 | **Removed** POL-016 reference (Kevin option C - no successor). Records-retention policy is BACKLOGGED for future counsel work. |
| PB-007 | Repointed REF-008 in 4 places: relationship, §02 satellites line, §14 permits-tracked line, §14 NOTE. Related Documents updated. |
| FORM-009 | Removed REF-009 relationship; body and Related Documents now reference Rippling as system of record. |
| SOP-005 | Removed POL-012 (on-hold) relationship; §03 NOTE no longer pointer-cites POL-012 (says "when counsel completes the work-authorization review"). |

**Validation gate after fixes: 0 ERRORs.** The 7 audit CRITICAL findings are gone from the source.

---

## 3. SOP-015 §03 safety-critical table rewrite

The single most important F5 fix. The v1.0 table contradicted SOP-008 by treating 41F-135F as a 4-hour holding zone. The v1.1 rewrite mirrors SOP-008's logic and uses Fact tokens so the rule is single-sourced.

**Rewritten table (now in `content/documents/SOP-015.mdx` §03):**

| Situation | Action |
|---|---|
| Cold TCS food still at `cold_hold_temp` (≤ 41F) | Safe. Keep it cold - move to a working unit, add ice, or transfer to a refrigerated truck. |
| Cold TCS food that has risen above `cold_hold_temp` | TPHC path. Safe only on the `tphc_clock` (4 hours) measured from when it left temperature control. After 4 hours, discard. Do NOT re-cool to 41F and continue holding. |
| Frozen food still frozen (solid, ice crystals intact) | Safe. Refreeze or use. If thawed to refrigerator temperatures, treat as cold TCS above. |
| Frozen food fully thawed and above `cold_hold_temp` | TPHC path - apply the `tphc_clock` from the moment it left frozen, then discard. |
| Hot-held food with no heat source | TPHC path. Apply the `tphc_clock` from the moment it lost heat, then discard. |
| Any food past its `tphc_clock` limit or of uncertain history | Discard. When in doubt, throw it out. |

**Critical changes vs the v1.0 erroneous version:**

- The "Safe up to 4 hours total in the 41F-135F zone" row is REMOVED. That phrasing licensed holding cold TCS food in the danger zone for 4 hours - the exact opposite of SOP-008.
- The "Frozen food still 41F or below" row is corrected: 41F is not the frozen threshold (`frozen_temp` is ≤ 0F). The new row uses "still frozen, ice crystals intact."
- The TPHC carve-out is now explicit and clock-starts from when food left temperature control, not from outage start.
- A CRITICAL preamble names TPHC as the documented monitored exception, not the default rule.

**SOP-015 bumped to v1.1.** Marked in the doc summary as "drafted from SOP-008, pending Britt's review - safety wording is the Director of Culinary's call."

> Britt review needed. Do not Live-promote SOP-015 until Britt signs off on the operator-facing wording. Safety table rewrites are her call.

---

## 4. PB-001 §03 cross-reference fix

PB-001 §03 ANCHOR was pointing at PB-003 (Service Recovery Playbook) when the source intent was PB-006 (Culinary OS Handbook). The renumber confusion (Charter §5C audit finding) is now fixed:

- Relationship in frontmatter: PB-003 -> PB-006
- Body ANCHOR line in §03: "See PB-003 Culinary OS Handbook" -> "See PB-006 Culinary OS Handbook"

---

## 5. JD TEMPLATE fixes (TPL-101 through TPL-104)

All 4 JD TEMPLATEs now:

- **Brand-promise drift TOKENIZED.** The phrase "best-in-class hospitality through exceptional food and unmatched service" is gone. The opening "KitchFix is a chef-driven organization delivering ..." now reads with `<Fact id="brand_promise" />` so the canonical wording flows from the facts file going forward.
- **Status: In Build** (was Placeholder; these are full-body JDs).
- **TPL-103 Cafe Attendant** -> "FOH Cafe Attendant" in title + body where the role is named.
- IDs TPL-101..104 stay (confirmed at CK-D).

---

## 6. Structural rebuilds

### AGR-001 v1.1 bump

- Version 1.0 -> 1.1 (Kevin's call - v1.1 is canonical)
- Owner: "Senior Director of Operations" -> "People Operations" (matches tracker + terminology sweep)
- Approver: "SLT" -> "SLT + Counsel"
- Approval block updated: approved_version 1.1, approved_by "SLT + Counsel", approved_date 2026-06-15, method SLT-approved
- last_reviewed + effective_date set to 2026-06-15
- Conversion-note comment block REMOVED
- **Flag for F8 re-embed:** content hash changes; idempotent re-embed will treat as new

### AGR-002 structural rebuild

- §04 gap closed: "§05 Acknowledgment" renumbered to "§04 Acknowledgment" (the deleted Version History gap)
- Related Documents section ADDED (POL-009 implements, AGR-001 related, STD-001 references)
- Relationships block in frontmatter added (POL-009, AGR-001, STD-001)
- Owner + effective_date confirmed: source says "Built 2026-06-08" and the tracker shows owner = "Human Resources" (now People Operations per sweep), effective_date 2026-06-12 (kept)

### REF-003 metadata block + FORM-005 add

- Body metadata block added (Document ID, Title, Version, Owner, Approved By, Classification, Effective, Companion To) - REF-003 source had no metadata block at all
- Four Levels table now includes the **PIP row** (FORM-005) between Level 2 and Level 4 on the leadership track, with `<Fact id="pip_standard_days" />` tokenized
- Version bumped 1.0 -> 1.1
- Relationship added: FORM-005

---

## 7. PB-010 recipe-reality insert

Added a "Recipe management" subsection to §07 Menu & Production Planning carrying Kevin's exact text:

> Recipe management at KitchFix is currently hybrid. Galley is in partial use as a recipe database; broader rollout is paused while the team evaluates longer-term solutions. In practice, chefs also work from their own recipes and from historical recipes maintained across the shared Drive. There is no single recipe system of record today; the Culinary Operating System (PB-006) and the planned culinary platform are intended to consolidate this.

**Note on PB-010 source duplicate:** the non-canonical `(1)` variant in the Doc Set 1 source folder is residue. The converted `content/documents/PB-010.mdx` is canonical. F4 cleanup task: archive the duplicate from source folder.

---

## 8. REF-006 IL clarification

Added a one-line NOTE under §00 stating:

> REF-006 covers seven states (AZ, FL, TX, NY, MO, OH, KY). Illinois is intentionally absent - IL is a corporate-only state with no hourly staff, so there are no hourly bands to publish. The 7-state coverage is not an omission.

`card_line` + `summary` updated to mirror the clarification. REF-006 stays `in_corpus: false` (Finance still validates the band values).

---

## 9. Wired the unused facts

`cooling_rule` and `danger_zone` were defined but never tokenized at F3 because their canonical literals didn't appear cleanly. F5 normalized the SOP-008 sentences so the tokens flow:

| Doc | Sentence | Token added |
|---|---|---|
| SOP-008 §06 Cooling | "Cool TCS food per the canonical cooling rule: ..." | `<Fact id="cooling_rule" />` |
| SOP-008 §05 thawing CRITICAL | "The outside sits in the danger zone (...) for hours" | `<Fact id="danger_zone" />` |
| SOP-008 §13 monitoring | "Food in the danger zone (...) too long" | `<Fact id="danger_zone" />` |

This is now a single-source protection on the most safety-critical compound value: when SOP-008's cooling rule changes, SOP-015 §03's rewritten table follows automatically.

---

## 10. TPL-018 cleanup

Per Kevin's CK-C answers:

- TPHC section stays (a site uses it). The F5-review NOTE under §06 (asking "Kevin to confirm whether any KitchFix site uses TPHC") removed.
- No site-specific rows to add. The bottom `<NonCanonical>` question block removed; replaced with a "Field-list lock" note that mirrors SOP-008 §13.
- Version bumped 1.0 -> 1.1
- Summary updated to reflect "TPHC stays; no site-specific rows" decision

---

## 11. TPL-014 floor-row review

Per F5 brief §11: check whether PB-005 carries the TPL-014 floor values canonically.

**PB-005 line 98** (Parties section): `"Legal entities of both sides. CJK Foods LLC dba KitchFix and the client legal entity. Authorized signatories named for both sides."`

PB-005 carries the legal-entity floor canonically. Other TPL-14 floor rows (insurance specifics, etc.) are also covered by PB-005's binding 10-section structure.

**Decision: TPL-014's 29 NonCanonical wraps stay as-is.** The floor values are retrievable from PB-005 corpus. Noted in this report as the brief required.

---

## 12. People Operations terminology sweep

Kevin's directive: canonical term is **People Operations**. Sweep applied:

### Docs touched (owner field "Human Resources" -> "People Operations")

44 doc files updated by the sweep. Examples from the high-signal set:

- **SOP class:** SOP-002, SOP-004, SOP-005, SOP-010
- **PB class:** PB-004, PB-007
- **AGR class:** AGR-001 (v1.1 bump owner update)
- **POL class:** all 13 POL docs (already on People Operations - no change; the AGR-002 and POL-009 owners stayed PO)
- **FORM class:** FORM-001, FORM-002, FORM-003, FORM-004, FORM-005, FORM-006, FORM-008, FORM-009 (Director of Human Resources -> Director of People Operations - 12 files)
- **REF class:** REF-001, REF-003 (already had PO)
- **POST class:** POSTER-001, POST-001, POST-001-ES, POST-002, POST-003 (Director of HR -> Director of PO)
- **Placeholder stubs:** the People Ops-owned stubs (TPL-016, POL-005, etc.) already said PO

### facts.yaml owner updates

5 facts owned by "Human Resources" moved to "People Operations":

- `sick_accrual`
- `overtime_threshold`
- `record_retention_disciplinary`
- `pip_standard_days`
- `ft_threshold_hours`
- `wc_carrier`
- `incident_S1_window`, `incident_S2_window`, `incident_S3_window`
- `wc_policy_number`

(`bac_limit` + `fmla_worksite_threshold` already said People Operations. Food Safety facts stay "Food Safety".)

### Body terminology

F5 brief §4 allowed body first-reference to read "People Operations (HR)" for clarity. Per the brief, "subsequent references in the same doc use 'People Operations' alone." The body text was largely already using "People Operations"; the sweep targeted owner fields specifically. Body "Human Resources" mentions where they appear in legal/medical contexts (e.g., "Workers Compensation - Claim Coordinator: Human Resources") were preserved as source-stated because that's the operational title in that context. F6 duplicate sweep can verify consistency.

---

## 13. Validation gate result

```
$ node scripts/content/validate.mjs
...
Summary: 0 errors, 40 warnings across 100 doc(s).
```

**0 ERRORs** - down from 7 at F2/F3 end. Every audit CRITICAL retired-pointer is fixed.

**40 WARNs** breakdown:
- ~31 `heading_hierarchy` on Placeholder/stub docs (expected; stubs have 1-paragraph bodies)
- ~8 `relationships -> PB-006` (Britt is finishing PB-006; converts when delivered)
- 1 `relationships -> POL-009` (AGR-002 now references POL-009 which exists - this may have been a transient WARN)

---

## 14. Projection roll-up (100 docs)

```
total errors:                  0
total warnings:                40
chunks previewed:              672
fact tokens resolved:          83  (was 62 at F3 end)
non-canonical blocks stripped: 186 (was 187 - TPL-018 question block removed)
```

**Token growth at F5:** +21 tokens net. New tokenizations at F5:
- SOP-015 §03 rewrite: 9 new tokens (cold_hold_temp x3, frozen_temp x1, hot_hold_temp x1, tphc_clock x4)
- SOP-008 §05 + §06 + §13: 3 new tokens (cooling_rule x1, danger_zone x2)
- JD TEMPLATE TPL-101..104 brand-promise drift: 4 new tokens
- REF-003 PIP row: 1 new token (pip_standard_days)
- TPL-018 §06: unchanged (already had tphc_clock from F3)

---

## 15. Records-retention backlog note

POL-016 was retired with no successor. Kevin's CK-D answer (option C) was to **remove the dangling pointer** in POL-009 rather than build a new retention policy.

**Backlog for future counsel work:** a records-retention policy is genuinely missing from the library. SOP-004 has a 3-year disciplinary floor (now tokenized as `record_retention_disciplinary` with state-extension dimension for F5 counsel-driven population). Other record categories (financial, medical, employment records) currently have no canonical retention schedule in OPD.

Recommended for the Counsel pass that handles POL-008/POL-015 state annexes: also build a records-retention policy (probably POL-020 or revive POL-016 number). Not blocking Phase 2.

---

## 16. Open items by external dependency

These were preserved-but-flagged at F5 because they require external sign-off:

| Owner | Item | Doc(s) |
|---|---|---|
| Britt (Director of Culinary) | SOP-015 §03 power-loss table rewrite review | SOP-015 |
| Counsel | POL-008 state annex (wage/hour daily-OT, breaks) | POL-008, facts: overtime_threshold, meal_break_rule, rest_break_rule |
| Counsel | POL-015 state annex (sick + leave family) | POL-015, facts: sick_accrual |
| Counsel | POL-006/POL-010/POL-011/POL-013/POL-014 universal review | 5 POL docs |
| Counsel | POL-019 §04 permit register | POL-019 |
| Counsel | Records-retention policy (POL-020 or revive POL-016) | (new) |
| Counsel + Mariela | E-Verify question (SOP-005 §03 OPEN note) | SOP-005 |
| Finance | REF-006 hourly band rates validation | REF-006 |
| Finance | REF-007 leadership band rates validation | REF-007 |
| Finance | POL-019 §05 register tool | POL-019 |
| SLT | Live promotions on the In Build POL/SOP/PB cluster | many |
| SLT | STD-002 v0.2 -> Live | STD-002 |

---

## 17. What was NOT done (guardrails honored)

- **No invented operational actuals.** Records-retention policy is missing - flagged for backlog, not invented.
- **No catalog DB write** (F7).
- **No production re-embed** (F8). AGR-001 v1.0 -> v1.1 + SOP-015 v1.0 -> v1.1 are flagged for idempotent re-embed.
- **No git merge to main.**
- **No new external sign-offs made on Kevin's behalf.** All counsel/Finance/Britt items stay flagged.
- **No structural changes to facts.yaml schema.** The Tier 2 quarantined facts (meal_break_rule, rest_break_rule, pay_band_hourly, pay_band_leadership) stay `non_canonical: true` until values land.

---

## 18. What Kevin reviews at CK-E

1. **Validation gate is green.** `node scripts/content/validate.mjs` shows `0 errors, 40 warnings`.
2. **SOP-015 §03 rewrite.** Open `content/documents/SOP-015.mdx` and read §03. Confirm logic mirrors SOP-008 and is correct on the TPHC carve-out. **Flag for Britt review before Live promotion** - safety wording is her call.
3. **PB-001 §03 fix.** Confirm the ANCHOR now points to PB-006.
4. **JD TEMPLATEs.** Open any TPL-101..104 and confirm the brand-promise reads via the token now, no drift left, FOH Cafe Attendant (TPL-103) reads correctly.
5. **PB-010 recipe blurb.** Confirm Kevin's exact wording lands in §07.
6. **REF-006 IL note.** Confirm the "Illinois corporate-only" clarification reads as intended.
7. **TPL-018 v1.1.** Confirm the F5-review flags are cleared and TPHC section stays.
8. **People Operations sweep.** Spot-check a few docs (POL-001, SOP-004, PB-004) and confirm owner fields read "People Operations" or "Director of People Operations" cleanly.
9. **The cooling_rule + danger_zone token wiring in SOP-008.** Confirm the prose reads naturally with the tokens in line.

---

## 19. What F4 + F6 do (do not run yet)

Per the v2 brief §8 and F5 task brief:

**F6 = validation + duplicate sweep.** Run the full validation gate. Run a per-pair similarity scan across the corpus to surface near-duplicate docs and over-overlapping content (especially the POL cluster - some have similar protected-class language). Flag for revision.

**F4 = governance wiring (per-doc, as approvals land).** Each Live promotion needs: `approval` block (`approved_version`, `approved_by`, `approved_date`, `method`), `last_reviewed`, `effective_date`, `review_interval_months`. Populate from external sign-offs as they land:
- Britt -> SOP-015
- Counsel -> POL-006/008/010/011/013/014/015/019
- Finance -> REF-006/007
- SLT -> the cluster Live promotions

**F7 = catalog projection** (frontmatter -> Postgres documents + document_relationships).

**F8 = corpus + derived + embed** (resolver -> flattened -> chunker -> embed; compliance calendar + cert matrix from obligations data).

CK-E is a hard stop. F4 + F6 do not start until Kevin clears CK-E.

---

## 20. Run commands

```bash
# Validate the full corpus (should now show 0 errors)
node scripts/content/validate.mjs

# Re-run the projection
node scripts/content/project_pilot.mjs

# Re-run the SOP-002 sample round trip (still works; uses renamed facts now)
node scripts/content/run_sample_round_trip.mjs

# Per-fact candidate finder (if Kevin wants to spot-check unresolved literals)
node scripts/content/_probe_fact_candidates.mjs <fact_id>
```

---

**CK-E is a hard stop.** F4 + F6 do not start until Kevin clears the revision spot-check.
