# F6.5 CK-G - Approved Dedup Cleanup Applied

**Built:** 2026-06-15
**For:** Kevin's CK-G spot-check per the F6.5 task brief.
**Status:** F6.5 complete. **STOP at CK-G** per brief. This closes the in-control content work.

Three Kevin-approved items applied. Validation gate held at 0 errors. The Include resolves end-to-end. Two version bumps (POL-003, SOP-009) reflect the substantive edits; sweep + relationship edits were terminology/metadata only and did not get version bumps.

---

## 0. Bottom line up front

| Item | Result |
|---|---|
| Validation gate | **0 errors**, 40 warnings (identical to F6 baseline) |
| POL-003 §06 wording correction | 4 club->client swaps in sourcing-context phrases |
| POL-003 version | 1.1 -> 1.2 |
| SOP-009 §03 single-sourced | Bullets replaced with `<Include doc="POL-003" section="06" />` |
| SOP-009 version | 1.0 -> 1.1 |
| Include resolver | Section-walker implemented (`getSectionBody`); pipeline reordered to Include-then-Fact in `project_pilot.mjs` + `project_corpus.mjs` |
| Projection check | SOP-009 1/1 includes resolved; reads cleanly with POL-003 §06 content under [H1] 03 |
| HR -> People Operations sweep | 19 lines swept across 8 docs; 9 carve-outs left as "Human Resources" |
| Relationship edges added | **14 edges** across 7 docs - see §3 below; **count flag**: CK-F report said "11" but listed 14 |
| Total docs touched | 14 (1 POL, 1 SOP, 4 PB, 5 SOP, 1 FORM, 1 STD, 1 AGR, plus 4 forms via edges only) |

**One flag for Kevin (§3.1 below):** my CK-F report headline read "11 high-confidence missing edges" but the bullets actually listed 14 source-target pairs. I added all 14 (the listed pairs) since they are all genuinely high-confidence. If you want a stricter 11, the three to remove would be Kevin's choice; the candidate "extras" are the second STD-003 entry and either of the two FORM-007 entries, since those duplicate the same source-doc.

---

## 1. POL-003 §06 wording correction + SOP-009 Include

### 1.1 POL-003 §06 - 4 sourcing-context swaps

Per Kevin's note ("'client' is canonical; a club is the MLB/MiLB organization; a client is the contracting entity"), the following 4 lines in POL-003 §06 changed. Place names (clubhouse, club kitchen), person titles (club dietitian), and the "the club to a fine" MLB-sanction phrasing were left alone - "club" is correct in those contexts.

| Line | Before | After |
|---|---|---|
| CRITICAL callout | "not part of the **club's** NSF Certified for Sport program" | "not part of the **client's** NSF Certified for Sport program" |
| ## The KitchFix Position | "Any such product present in a clubhouse setting is **supplied by the club**, never by KitchFix" | "Any such product present in a clubhouse setting is **supplied by the client**, never by KitchFix" |
| ## Why | "**Clubs** supply only NSF Certified for Sport products." | "**Clients** supply only NSF Certified for Sport products." |
| ## Staff Rules | "...not part of the **club-directed**, NSF-certified program." | "...not part of the **client-directed**, NSF-certified program." |

**Phrases deliberately left as "club":**
- "in a clubhouse" (physical place)
- "club kitchen or clubhouse" (physical place)
- "club dietitian" (person's title)
- "exposes... the club to a fine" (MLB sanction goes to the club organization)

POL-003 version bumped 1.1 -> 1.2. The approval block is unchanged (approved_version: 1.1, counsel-cleared). The wording edit was editorial-correction-to-match-SOP-009; counsel re-sign-off at next F4 governance pass.

### 1.2 SOP-009 §03 - single-sourced via Include

SOP-009 §03 body was 4 duplicated bullets. Now:

```mdx
# 03 What This Means in Practice

<Include doc="POL-003" section="06" />
```

The Include resolves to POL-003 §06's complete body (intro paragraph + CRITICAL callout + 3 H2 subsections including the Staff Rules bullets). Heading hierarchy nests cleanly: SOP-009 §03's H1 has POL-003 §06's H2s as children.

SOP-009 version bumped 1.0 -> 1.1.

### 1.3 Resolver work - Include section-walker (F1.5 deferred -> F6.5 delivered)

The resolver had stubbed Include from F1 ("F1.5 will inline the resolved section"). F1.5 didn't deliver the section-walker. F6.5 needed Include functional end-to-end so I implemented it:

**`scripts/content/resolver.mjs`:**
- `getSectionBody(mdxBody, sectionRef)` - finds a section by ref (exact heading-text match, then H1 numeric-prefix match), returns body content from after the heading to the next heading at the same level or higher. Drops the section's own heading line so the caller's heading remains the canonical parent.
- `resolveIncludeTokens(mdxBody, docsMap, _ctx)` - now actually inlines instead of leaving a stub sentinel. Falls back to a clear comment if doc-not-found or section-not-found.

**Pipeline reorder in `project_pilot.mjs` + `project_corpus.mjs`:** Includes resolve FIRST, then Facts. This way any Fact tokens carried in by an Include resolve in the calling doc's ctx. For F6.5's only Include (POL-003 §06 -> SOP-009 §03), the source has no Fact tokens, so the choice does not affect output - but the order is the semantically correct default.

### 1.4 Projection re-confirm

```
PASS  POL-003  Drug & Alcohol Policy        v1.2  20446c  12chunks  2fact  0/0inc  0nc  0E/0W
PASS  SOP-009  NSF Certified-for-Sport ...  v1.1   4119c   7chunks  0fact  1/1inc  0nc  0E/0W
```

The `1/1inc` on SOP-009 = one Include token, one Include resolved. SOP-009 projection reads cleanly with POL-003 §06 content under `[H1] 03 What This Means in Practice` (verified in `.scratch/opd-audit/projected-texts/SOP-009.txt`).

---

## 2. HR -> People Operations sweep (with carve-outs)

### 2.1 Decision rule applied

Per Kevin's brief: sweep org-reference mentions ("notify HR within X", "route to HR", "HR is notified"); leave mentions where HR is the named function in WC / benefits / claim-coordinator / legal context.

Carve-out list from the brief (all three preserved):
1. SOP-002 "Disciplinary Process" phrasing
2. FORM-001 section header
3. SOP-002 §10 table cell

Additional WC-context lines preserved per the broader rule.

### 2.2 The 19 swept lines (LEFT = before; RIGHT = after)

All 19 swept "Human Resources" -> "People Operations" with no other changes.

| Doc | Line context | Why sweep |
|---|---|---|
| AGR-001 | "6. Human Resources." (escalation chain step) | Org-reference rung in chain |
| AGR-001 | "raised directly to Human Resources at any point in the chain" | Org-reference for raising concerns |
| AGR-001 | "contact your RDO or Human Resources" | Org-reference for contact |
| PB-003 | "HR-grade conduct concern - directly to Human Resources per AGR-001 section 06" | Conduct routing (HR-grade modifier preserved) |
| PB-008 | "Notify Human Resources and corporate as soon as it is safe" | Notification workflow |
| PB-008 | "Site Leader notifies Human Resources and corporate before any outside communication" | Notification workflow |
| PB-013 | "Human Resources - owns the program - the certification matrix, tracking in Rippling, and compliance" | Program ownership; not WC/benefits/legal |
| SOP-002 | "**Human Resources** - Operational owner of this SOP. Triages every report. Coordinates the workers compensation carrier..." | Core Roles bullet - org/role name; parallel with other roles in section |
| SOP-002 | "Triage by Human Resources confirms or downgrades the tier" | Workflow org-reference |
| SOP-002 | "Manager of Record participates in root-cause review with Human Resources" | Workflow org-reference |
| SOP-002 | "Human Resources checks in with any injured employee" | Workflow org-reference |
| SOP-002 | "Call Human Resources directly" (S1 phone-tree step 2) | Workflow org-reference |
| SOP-002 | "notify Human Resources before any further action" (workplace violence) | Notification org-reference |
| SOP-002 | "PDF maintained by Human Resources. Manually entered into the Portal on receipt" | Records-keeping org-reference |
| SOP-002 | "Annual review by Human Resources and Senior Director of Operations" | Review-owner org-reference |
| SOP-005 | "**Human Resources** - owns compliance - work authorization, paperwork, policy acknowledgments, and the Rippling record" | Core Roles bullet parallel to SOP-002 |
| SOP-010 | "valid driver's license for the vehicle class, on file with Human Resources" | License-on-file records reference |
| SOP-010 | "Notify Human Resources and the VP of Operations" (vehicle-incident table) | Notification workflow |
| STD-002 | "Translation workflow: AI drafts, Sr Director Operations reviews, Human Resources approves" | Approval workflow org-reference |

Per-doc count after sweep:
- AGR-001: +3 swept
- PB-003: +1 swept
- PB-008: +2 swept
- PB-013: +1 swept
- SOP-002: +8 swept
- SOP-005: +1 swept
- SOP-010: +2 swept
- STD-002: +1 swept
- **Total: 19 swept across 8 docs**

### 2.3 The 9 left as "Human Resources"

| Doc | Line | Why leave |
|---|---|---|
| FORM-001 | "Submit to Human Resources within 24 hours. The completed form lives in HR Confidential storage" (§01 Purpose) | FORM-001 is the WC documentation form; entire form is claim-coordinator function |
| FORM-001 | "## 6 - Human Resources Receipt" (section header) | **Carve-out #2** (brief: FORM-001 section header) |
| FORM-001 | "Submit completed form to Human Resources within 24 hours. HR enters the case ID and stores the original" (§06 body) | WC claim-coordinator receipt context; consistent with §06 header |
| FORM-002 | "This worksheet plus photos goes to Human Resources within 24 hours" | FORM-002 is Vehicle Incident Worksheet - WC-adjacent submission |
| PB-007 | "Work-related injuries are covered. Human Resources coordinates every claim" | Explicit WC claim-coordinator function |
| SOP-002 | "handled through Human Resources Formal Disciplinary Process" (§01 scope/excludes) | **Carve-out #1** (brief: Disciplinary Process phrasing - named process) |
| SOP-002 | "complete FORM-001 Refusal of Medical Treatment Form... Submit to Human Resources within 24 hours" (§7.1) | WC form routing - matches FORM-001's own leave decision |
| SOP-002 | "\| Claim Coordinator \| Human Resources \|" (§10 WC table) | **Carve-out #3** (brief: SOP-002 §10 table cell) |
| SOP-002 | "claim coordination defers to Human Resources and the carrier for state-specific guidance" (§10 REF-001 note) | Explicit WC claim-coordinator function |

**Edge cases worth a glance from Kevin:**
- **FORM-001 §06 header stays "Human Resources Receipt" but §06 body says "Submit to Human Resources" with the abbreviated "HR enters the case ID" alongside.** Internally consistent within FORM-001's WC framing.
- **SOP-002 §02 Core Roles bullet for the operational owner WAS swept** ("**People Operations** - Operational owner of this SOP. Triages every report. Coordinates the workers compensation carrier..."). The bullet header is the role name (parallel with VPO, RDO, Site Leader, etc.). The WC coordination is a function described WITHIN the bullet, not the "the HR function" naming. Reasonable but borderline; if Kevin wants this one left as Human Resources for parallel with the §10 table cell, easy revert.
- **SOP-002 §7.1 line at L172** says "Submit to Human Resources within 24 hours" referring to FORM-001 - kept HR consistent with FORM-001 §01 + §06 wording.

### 2.4 Probe re-confirm

```
HR-body-mentions sweep: 9 mentions across 4 docs.
  FORM-001 (3 mentions) - all WC form receipt context
  FORM-002 (1 mention)  - vehicle incident worksheet WC routing
  PB-007 (1 mention)    - WC claim coordination
  SOP-002 (4 mentions)  - 3 carve-outs + 1 FORM-001 routing
```

---

## 3. Relationship edges added

### 3.1 Count flag (transparent surface)

My CK-F report stated "**11 high-confidence missing edges**" in the headline but the bullets listed 14 specific source-target pairs:

| Source doc | Targets | Count |
|---|---|---|
| FORM-004 | POL-002 | 1 |
| FORM-007 | SOP-001, SOP-007 | 2 |
| PB-013 | TPL-001 | 1 |
| POST-003 | PB-002, PB-007, POST-001, SOP-002, FORM-008 | 5 |
| SOP-001 | SOP-007 | 1 |
| SOP-009 | SOP-004 | 1 |
| STD-003 | FORM-003, FORM-004, FORM-006 | 3 |
| **Total source-target edges** | | **14** |

The "11" was my count error - either I counted source docs (7) or bullet lines (7) and the "11" was a typo, not a deliberate subset selection. All 14 listed pairs are genuinely high-confidence (real body cite, no existing relationship entry, target doc exists in /content/documents, not in the "verify" or "illustrative" categories).

**F6.5 applied all 14.** If you want a strict 11, the candidates for removal would be three of the multi-target groups (e.g., dropping one of the STD-003 forms or one of the POST-003 callouts). Easy to remove from individual frontmatter blocks; the relationships are simple lines and the script logs which doc each edit landed on.

### 3.2 The 14 edges (each with from_section)

```yaml
# FORM-004
- { to: POL-002, type: references, from_section: "section 04 conduct categories list" }

# FORM-007
- { to: SOP-001, type: references, from_section: "Performance Review on File (leadership track)" }
- { to: SOP-007, type: references, from_section: "Performance Review on File (hourly track)" }

# PB-013
- { to: TPL-001, type: references, from_section: "section 05 cadence tools" }

# POST-003
- { to: PB-002,   type: references,   from_section: "Allergens callout (PB-002 Top 9)" }
- { to: PB-007,   type: references,   from_section: "Hot surfaces + kitchen-safety detail" }
- { to: POST-001, type: related,      from_section: "Severity matrix - sibling poster" }
- { to: SOP-002,  type: derived_from, from_section: "Notify per SOP-002 severity matrix" }
- { to: FORM-008, type: references,   from_section: "Hygiene + sick-staff control" }

# SOP-001
- { to: SOP-007, type: related, from_section: "section 06 hourly-track parallel" }

# SOP-009
- { to: SOP-004, type: references, from_section: "section 05 Consequences" }

# STD-003
- { to: FORM-003, type: references, from_section: "performance coaching forms" }
- { to: FORM-004, type: references, from_section: "performance coaching forms" }
- { to: FORM-006, type: references, from_section: "termination conversations" }
```

### 3.3 What was NOT added (per CK-F report defaults, Kevin-approved)

**4 "verify" edges left for Kevin's call** (not added because the body cite was illustrative/borderline):
- POST-002 -> SOP-002 (POST-002 may already have `derived_from`)
- SOP-008 -> AGR-001 (line context ambiguous)
- SOP-009 -> AGR-001 (line context ambiguous)
- PB-013 -> PB-010 (caption-vs-real-ref ambiguous)

**6 illustrative-mention edges left as-is:**
- REF-005-A/B cited-doc tables (6 entries to PB-001 / PB-003 / STD-001) - the docs in those tables are illustrative SLA-content examples, not normative pointers
- STD-001 AGR-001 / PB-001 / SOP-014 example IDs (3 entries) - these are example IDs in the prose ("see SOP-014 section 3.2 or per AGR-001 The Big Rules") not edges

**11 orphan docs NOT de-orphaned** per brief:
- 3 ES translations (PB-004-ES, POL-006-ES, POST-001-ES) - reachable via `translation_of`, correctly orphaned by `relationships` graph
- 4 JD templates (TPL-101-104) - referenced from future POL-010 hiring policy when it builds out
- REF-004 Org Chart (pending), TPL-012/013 (will be referenced from SOP-007 when built), TPL-015 (standalone tool)

---

## 4. Validation + projection re-confirm

### 4.1 Validation

```
Summary: 0 errors, 40 warnings across 100 doc(s).
```

Identical to F6 baseline. The 40 warnings are the same expected baseline (31 stub heading_hierarchy + 9 PB-006 cross-references). No new warnings introduced by F6.5 edits.

### 4.2 Projection

```
docs:                 100
total errors:         0
total warnings:       40
chunks previewed:     672
fact tokens resolved: 83
includes resolved:    1/1 (the single new Include in SOP-009 §03)
non-canonical blocks: 186
```

Identical totals to F6 except:
- **+1 Include resolved** (SOP-009 §03 -> POL-003 §06, the F6.5 single-source)
- Slightly higher chunk count from SOP-009's now-larger body (POL-003 §06 content inlined)
- Hash drift on every doc whose body changed - expected, just means re-embed at F8 will pick up the deltas

### 4.3 SOP-009 projection spot-check

Verified in `.scratch/opd-audit/projected-texts/SOP-009.txt`: the §03 H1 is followed by POL-003 §06's intro + CRITICAL callout + three H2 subsections (The KitchFix Position / Why / Staff Rules). All "client" wording (not "club"). Heading hierarchy clean - H1 -> H2 nesting under §03 correctly.

---

## 5. Files changed in F6.5

| File | Change | Why |
|---|---|---|
| `content/documents/POL-003.mdx` | 4 wording swaps + version 1.1 -> 1.2 | §1.1 above |
| `content/documents/SOP-009.mdx` | §03 bullets replaced with Include + version 1.0 -> 1.1 + SOP-004 edge added | §1.2 + §3.2 |
| `content/documents/AGR-001.mdx` | 3 sweep lines | §2.2 |
| `content/documents/PB-003.mdx` | 1 sweep line | §2.2 |
| `content/documents/PB-008.mdx` | 2 sweep lines | §2.2 |
| `content/documents/PB-013.mdx` | 1 sweep line + TPL-001 edge added | §2.2 + §3.2 |
| `content/documents/SOP-002.mdx` | 8 sweep lines | §2.2 |
| `content/documents/SOP-005.mdx` | 1 sweep line | §2.2 |
| `content/documents/SOP-010.mdx` | 2 sweep lines | §2.2 |
| `content/documents/STD-002.mdx` | 1 sweep line | §2.2 |
| `content/documents/FORM-004.mdx` | POL-002 edge added | §3.2 |
| `content/documents/FORM-007.mdx` | SOP-001 + SOP-007 edges added | §3.2 |
| `content/documents/POST-003.mdx` | 5 edges added | §3.2 |
| `content/documents/SOP-001.mdx` | SOP-007 edge added | §3.2 |
| `content/documents/STD-003.mdx` | 3 edges added | §3.2 |
| `scripts/content/resolver.mjs` | Include section-walker implemented | §1.3 |
| `scripts/content/project_pilot.mjs` | docsMap + pipeline reorder Include-then-Fact | §1.3 |
| `scripts/content/project_corpus.mjs` | Pipeline reorder Include-then-Fact | §1.3 |
| `scripts/content/_apply_f65_sweeps.mjs` | F6.5 HR sweep script (in-repo for reruns) | §2.2 |
| `scripts/content/_apply_f65_edges.mjs` | F6.5 edges script (in-repo for reruns) | §3.2 |

**14 doc files changed; 5 script files changed.**

---

## 6. What this report does NOT do

Per F6.5 brief guardrail:
- No production re-embed (F8 territory).
- No catalog DB write (F7 territory).
- No git merge to main.
- No new content findings actioned (only the three approved items).
- No edges added beyond the 14 listed; no de-orphaning translations or JD templates.
- The 9 "Human Resources" mentions preserved per the WC carve-out rule remain literal in source.

---

## 7. After CK-G

Per the brief's "What comes after" section, the content foundation is now complete in repo. Remaining phases gated on external dependencies:

- **F4 governance wiring** - per-doc approval blocks as sign-offs land:
  - Britt -> SOP-015 §03 rewrite
  - Counsel -> POL-003 1.2 editorial (was 1.1-counsel-cleared, 1.2 is editorial); state annexes; meal/rest breaks; records-retention
  - Finance -> REF-006 + REF-007 pay bands
  - SLT -> Live promotions across all 1.x docs
- **F7 catalog projection** - frontmatter -> Postgres `documents` + `document_relationships` tables.
- **F8 corpus + derived + embed** - the resolver output embedded; compliance calendar + cert matrix generated from obligations data.

CK-G closes the work that does not wait on someone else. Stopping here.

---

## Appendix - reruns

```bash
# Validation (must stay 0 errors)
node scripts/content/validate.mjs

# Full projection (Includes + Facts + flatten)
node scripts/content/project_pilot.mjs

# HR-mentions confirm (must show 9 carve-outs, not 28)
node scripts/content/_probe_hr_mentions.mjs

# Relationship graph re-check (orphan + missing-edge counts after F6.5)
node scripts/content/_probe_relationships_check.mjs

# F6.5 mechanical sweeps (idempotent - re-run safely after manual reverts)
node scripts/content/_apply_f65_sweeps.mjs   # 0 applied = already done
node scripts/content/_apply_f65_edges.mjs    # 0 applied = already done
```
