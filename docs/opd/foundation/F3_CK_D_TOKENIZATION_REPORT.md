# F3 CK-D - Tokenization Report

**Built:** 2026-06-15
**For:** Kevin's CK-D fact-resolution spot-check per `docs/phase2/06_CONTENT_FOUNDATION_BRIEF_v2.md` §8 and the F3 task brief §6.
**Status:** F3 complete. **F4 (governance wiring) HOLDS** - needs Kevin's approval dates per doc.

The facts file is built out (25 Tier 1 + 7 Tier 2 + 1 supplemental). 62 fact tokens are placed across 27 unique facts in 17 docs. Every token resolves cleanly under company-wide context. The hard exclusions held: SOP-015 §03 preserved-error table and the JD TEMPLATE brand-promise drift both stay literal.

---

## 1. F3 outcomes at a glance

| Item | Status |
|---|---|
| `operational-facts.yaml` rebuilt | 33 facts total (1 supplemental + 25 Tier 1 + 7 Tier 2) |
| SOP-002 token IDs renamed | `s1_notification_window` -> `incident_S1_window` + same for S2; wc_carrier + wc_policy_number kept |
| Schema regex updated | `^[a-z][a-z0-9_]*$` -> `^[a-z][a-zA-Z0-9_]*$` to allow capital severity tier markers (S1/S2/S3) |
| Facts validate against Ajv | yes (no schema errors) |
| Tokens placed in source | **62 tokens** across **27 unique facts** in 17 docs |
| Resolver under company-wide | 62 / 62 resolve cleanly |
| Override-bearing demo (sick_accrual) | resolves to floor + qualifier under company-wide, to floor under state-scoped (overrides empty until F4/F5) |
| Validation gate | 7 ERR + 39 WARN - **identical to F2 end**. Zero new errors from tokenization. |
| Hard exclusions | SOP-015 §03 preserved (3 literal-temp lines), JD drift preserved (4 docs with the drifted wording) |
| Quarantined facts left untouched | meal_break_rule, rest_break_rule, pay_band_hourly, pay_band_leadership (not tokenized; literal occurrences in POL-008 / POL-015 / REF-006 / REF-007 stay literal) |
| CK-C housekeeping carried into F5 revision log | 6 new items (§5) |

---

## 2. CK-C confirmations (housekeeping done)

- **Fidelity verified.** SOP-015 §03 errors, SOP-008 headings, AGR-002 §04 gap, TPL-101 brand-promise drift, TPL-018 spec build, ≤/≥ comparator normalization - all confirmed at CK-C.
- **PB-010 ratified.** The (1) variant in `content/documents/PB-010.mdx` is canonical (drops "Galley is the recipe system of record"). Non-dup file in Doc Set 1 to be archived (F5 task §5 below).
- **TPL-018 TPHC stays; no site rows.** The two F5-review flags + the bottom `<NonCanonical>` question block stay in place at F3 (no body changes except tokenization in this pass). F5 strips them per Kevin's confirmation.

---

## 3. The fact set as built

### Tier 1 globals (25) - Kevin-confirmed

| fact_id | value | authority |
|---|---|---|
| cold_hold_temp | ≤ 41F | SOP-008 / FDA Food Code |
| hot_hold_temp | ≥ 135F | SOP-008 / FDA Food Code |
| frozen_temp | ≤ 0F | SOP-008 |
| danger_zone | 41F - 135F | SOP-008 |
| cook_temp_poultry | 165F (15s) | SOP-008 |
| cook_temp_ground | 155F (17s) | SOP-008 |
| cook_temp_wholemuscle_fish | 145F (15s) | SOP-008 |
| cooling_rule | 135F to 70F in 2h, 70F to 41F in 4h (6h total) | SOP-008 |
| reheat_rule | 165F within 2 hours | SOP-008 |
| tphc_clock | 4 hours | SOP-008 (TPHC) |
| date_mark_max | 7 days at 41F | SOP-008 |
| quat_ppm | 200 - 400 ppm | SOP-008 |
| warewash_rinse | 180F manifold (~160F surface) | SOP-008 |
| threecomp_wash_temp | ≥ 110F | SOP-008 |
| storage_off_floor | 6 inches | SOP-008 |
| brand_promise | Best Food, Best Service, Best Hospitality | PB-001 |
| operating_states | AZ, FL, IL, KY, MO, NY, OH, TX (8 states; IL is corporate-only) | Company |
| ft_threshold_hours | 30 hrs/week | POL-013 |
| wc_carrier | The Hartford | Confirmed |
| incident_S1_window | 15 minutes | SOP-002 section 06 |
| incident_S2_window | 30 minutes | SOP-002 section 06 |
| incident_S3_window | 4 hours | SOP-002 section 06 |
| bac_limit | 0.08% | POL-003 / federal |
| fmla_worksite_threshold | 50 employees within 75 miles | FMLA statute |
| pip_standard_days | 30 days (60-day option) | SOP-004 |

### Tier 2 override-bearing (7)

**Floor confirmed** - tokenizable now (overrides empty until F4/F5):

| fact_id | floor | dimension | overrides |
|---|---|---|---|
| sick_accrual | 1 hour per 30 worked | state | empty (per-state bumps F4/F5) |
| overtime_threshold | 40 hrs/week (FLSA) | state | empty (daily-OT states F4/F5) |
| record_retention_disciplinary | 3 years | state | empty (state extensions F4/F5) |

**Quarantined (`non_canonical: true`)** - not tokenized; literal occurrences stay literal:

| fact_id | reason |
|---|---|
| meal_break_rule | PENDING - no federal floor; counsel completes per-state research at F4/F5 |
| rest_break_rule | same |
| pay_band_hourly | REF-006 is `in_corpus: false` until Finance validates against Rippling |
| pay_band_leadership | REF-007 is `in_corpus: false` and corporate-only restricted |

### Supplemental global (1)

| fact_id | value | reason kept |
|---|---|---|
| wc_policy_number | 83 WEC BP9792 | SOP-002 already tokenizes this from F1 seed |

---

## 4. Per-fact tokenization counts

The tokenization was per-fact and reviewed (not a global regex). Each substitution was vetted from the candidate-finder output (`scripts/content/_probe_fact_candidates.mjs`).

| fact_id | docs | tokens |
|---|---|---|
| brand_promise | 7 | 12 |
| cold_hold_temp | 2 | 7 |
| hot_hold_temp | 2 | 5 |
| frozen_temp | 1 | 2 |
| operating_states | 5 | 5 |
| reheat_rule | 2 | 2 |
| quat_ppm | 3 | 3 |
| wc_carrier | 2 | 2 |
| bac_limit | 1 | 2 |
| fmla_worksite_threshold | 1 | 2 |
| incident_S1_window | 2 | 2 |
| incident_S2_window | 2 | 2 |
| incident_S3_window | 2 | 2 |
| cook_temp_poultry | 1 | 1 |
| cook_temp_ground | 1 | 1 |
| cook_temp_wholemuscle_fish | 1 | 1 |
| date_mark_max | 1 | 1 |
| ft_threshold_hours | 1 | 1 |
| overtime_threshold | 1 | 1 |
| pip_standard_days | 1 | 1 |
| record_retention_disciplinary | 1 | 1 |
| sick_accrual | 1 | 1 |
| storage_off_floor | 1 | 1 |
| threecomp_wash_temp | 1 | 1 |
| tphc_clock | 1 | 1 |
| warewash_rinse | 1 | 1 |
| wc_policy_number | 1 | 1 |

**62 tokens across 27 facts in 17 docs.**

Facts with **0 tokens placed** (canonical literal not present in the converted corpus): `danger_zone`, `cooling_rule`. The values exist in source via descriptive prose ("danger zone" mentioned without the explicit 41F-135F range; cooling rule explained in multi-sentence form) - no single canonical literal to substitute without rewriting. Available at F5 when revision can normalize the wording.

---

## 5. Hard exclusions held

### 5.1 SOP-015 §03 preserved-error table

The exclusion logic in `_apply_tokens.mjs` scans for the §03 heading and skips every line until the §04 heading. The preserved-error table still reads:

- "Frozen food still 41F or below or holding ice crystals" (line preserved as written)
- "Cold TCS food between 41F and 135F / Safe up to 4 hours total in that zone, then discard" (preserved as written)
- Plus 1 more literal-temperature line in §03

**3 lines in SOP-015 §03 still carry literal 41F / 135F / 4-hour values.** The audit's CRITICAL #3 finding is intact. Tokenizing those values would have masked the contradiction with SOP-008 and erased the F5 fix opportunity.

### 5.2 JD TEMPLATE brand-promise drift

The canonical `brand_promise` value is "Best Food, Best Service, Best Hospitality." TPL-101 through TPL-104 carry both the canonical phrasing AND the drifted phrasing "best-in-class hospitality through exceptional food and unmatched service."

**Tokenization affected only the canonical phrase.** The drifted wording is unmatched by the `brand_promise` pattern and survives literal in all 4 JD TEMPLATEs. F5 fix (per audit Brief §6d) replaces the drift with canonical.

### 5.3 NonCanonical blocks

The exclusion logic scans for `<NonCanonical>` / `</NonCanonical>` and skips every line inside. **187 NonCanonical blocks** (TPL-014 fill-in fields, REF-005-A/B fictional team data, PB-003 coaching examples, STD-001 callout examples) stay literal and never receive tokens. The F2 protection layer is intact.

### 5.4 Quarantined Tier 2 facts

The 4 quarantined facts (meal/rest breaks, pay bands) carry no substitution rules in `_apply_tokens.mjs`. Their literal occurrences in:

- POL-008 (meal/rest break references)
- POL-015 (FMLA leave references)
- REF-006 / REF-007 (DRAFT pay-band values, `in_corpus: false`)

all stay literal until values are confirmed at F4/F5.

---

## 6. Resolver verification

`node scripts/content/run_sample_round_trip.mjs` exercises 3 contexts on 3 facts:

| Fact | Company-wide | NY-scoped | TX-scoped |
|---|---|---|---|
| `wc_carrier` (GLOBAL) | "The Hartford" | "The Hartford" | "The Hartford" |
| `incident_S1_window` (GLOBAL) | "15 minutes" | "15 minutes" | "15 minutes" |
| `sick_accrual` (OVERRIDE-BEARING) | "1 hour per 30 worked" `[qualified: varies by state]` | "1 hour per 30 worked" (no NY override yet) | "1 hour per 30 worked" (no TX override yet) |

The override-bearing fact correctly:
- Adds the "varies by state" qualifier under company-wide context (so the corpus never teaches Sous a conditional as universal).
- Falls back to floor under state contexts because the overrides arrays are empty (F4/F5 populates them).

Full-corpus projection (`project_pilot.mjs`):

- **100 docs, 62 fact tokens resolved (100%)**
- No unresolved tokens in any flattened text
- 671 H1-bounded chunk previews (vs F2 baseline)
- 187 NonCanonical blocks stripped

---

## 7. Validation gate

`node scripts/content/validate.mjs` after F3 tokenization:

```
Summary: 7 errors, 39 warnings across 100 doc(s).
```

**Identical to F2 end.** Zero new errors from tokenization. The 7 ERRORs are still the audit CRITICAL retired-pointer findings:

1. SOP-002 -> TPL-017
2. SOP-010 -> REF-008
3. SOP-015 -> SOP-016
4. POL-009 -> POL-016
5. PB-007 -> REF-008 (3 occurrences)
6. FORM-009 -> REF-009
7. SOP-005 -> POL-012 (on-hold)

The 39 WARNs are unchanged (31 heading_hierarchy on stubs + 8 PB-006 cross-refs).

---

## 8. F5 revision log - CK-C carry-ins

Per the F3 task brief §5, the following CK-C items go on the F5 revision list. **Logged, not done.**

1. **PB-010 recipe reality.** Kevin to supply the sentence stating the hybrid: Galley referenced, partial rollout paused pending evaluation of alternatives; personal + historical Drive recipes; no single system of record today.
2. **PB-010 duplicate** - archive the non-canonical variant from Doc Set 1 source folder (the converted MDX is canonical; the source duplicate is the residue).
3. **TPL-014 floor-row unwrap** - the `<NonCanonical>` wraps over the "Field | Entry / KitchFix Floor" tables also stripped real floor standards (e.g., `KitchFix legal entity - CJK Foods LLC dba KitchFix`; `Insurance held by KitchFix - CGL $2M/occ, $4M agg, ...`). F5 fix: unwrap the "Floor -" rows, keep only the bracketed `[ ... ]` write-in prompts wrapped. Cross-check whether PB-005 carries these floor values canonically; if not, they must remain retrievable somewhere in_corpus.
4. **TPL-101..104 status** - currently `Placeholder` per F2 conversion choice; on full-body docs these should be `In Build`. F5 update.
5. **AGR-002** - add the missing Related Documents section; confirm `owner: Human Resources` and `effective_date: 2026-06-12` came from the tracker/source, not inferred.
6. **TPL-018** - clear the two F5-review flags (TPHC stays per Kevin; no site rows) and remove the bottom `<NonCanonical>` question block (kept now per F3 "do not touch bodies except to tokenize" rule).

Plus the prior F5 list (CRITICAL retired-pointer repoints, SOP-015 §03 safety rewrite, PB-001 §03 PB-006 fix, STD-001 §02 + §12 FORM/POST rows, owner-field + terminology sweeps, JD brand-promise canonical sweep, REF-003/AGR-002 structural rebuilds, ≤/≥ Unicode normalization sweep, danger_zone + cooling_rule prose normalization for future tokenization).

---

## 9. What was NOT done (guardrails honored)

- **No content fixes** beyond tokenization. Every audit finding preserved as F2 landed it.
- **No quarantined-fact tokenization.** meal_break_rule, rest_break_rule, pay_band_hourly, pay_band_leadership all left literal until values confirmed.
- **No SOP-015 §03 tokenization.** The preserved-error table is intact.
- **No JD-drift tokenization.** Drift survives in all 4 TPL-101..104 files.
- **No body changes** beyond replacing literals with `<Fact />` tokens (TPL-018 specifically: the §F5 review NonCanonical block stays per F3 rule).
- **No production re-embed** (F8). **No catalog DB write** (F7). **No governance dates added** beyond what F2 already had (F4).
- **No git merge to main.**

---

## 10. What Kevin reviews at CK-D

1. **Open `content/facts/operational-facts.yaml`.** Confirm the 25 Tier 1 values + authorities match what you intended. Quarantined Tier 2 facts (meal/rest breaks, pay bands) should clearly show `non_canonical: true` + `PENDING` markers.
2. **Spot-check tokenization fidelity.** Open `content/documents/SOP-008.mdx` and scan the cook-temps table - the 3 cook_temp_* tokens replace the source literals; no other changes.
3. **Confirm the override demo.** `node scripts/content/run_sample_round_trip.mjs` shows sick_accrual under company-wide, NY-scoped, TX-scoped. The "varies by state" qualifier under company-wide is the architectural promise from brief §3.3 playing out.
4. **Verify the hard exclusions.** Confirm SOP-015 §03 still reads literal 41F / 135F / 4-hour (the preserved-error table). Confirm TPL-101..104 still carry the drifted "best-in-class hospitality through exceptional food and unmatched service" verbatim.
5. **Validation still green.** 7 ERR + 39 WARN - identical to F2. The audit CRITICAL findings catch on every run.

---

## 11. What F4 does (do not run yet)

Per the v2 brief §8 and F3 task brief §7:

F4 = Relationship + governance wiring.

- For each Live or about-to-go-Live doc, Kevin supplies: `approval` block (`approved_version`, `approved_by`, `approved_date`, `method`), `last_reviewed`, `effective_date`, `review_interval_months` if non-default.
- Populate `obligations` arrays where the doc carries deadlines / renewals / recurring obligations (feeds the derived compliance calendar + cert matrix at F8).
- Confirm the relationships graph is dense per audit recommendation (Pass 0 + Pass 2 findings).

F4 needs Kevin's data on every In Build doc heading to Live. It's the next session.

After F4: F5 revision (all audit findings fixed; SOP-015 §03 rewritten; retired pointers repointed; PB-001 §03 PB-006 fix; etc.), F6 validation + duplicate sweep, F7 catalog projection, F8 corpus + derived + embed.

CK-D is a hard stop. F4 does not start until Kevin clears CK-D.

---

## 12. Run commands

```bash
# Validate the full corpus
node scripts/content/validate.mjs

# Re-tokenize (idempotent - re-running on already-tokenized docs is a no-op
# because the literal text has been replaced with <Fact /> tokens)
node scripts/content/_apply_tokens.mjs

# Per-fact candidate finder (sees what literal occurrences remain across the corpus)
node scripts/content/_probe_fact_candidates.mjs <fact_id>
node scripts/content/_probe_fact_candidates.mjs --all

# Project all 100 docs (resolver + flatten + chunk preview)
node scripts/content/project_pilot.mjs

# Run the sample round trip (shows override resolution across contexts)
node scripts/content/run_sample_round_trip.mjs
```

---

**CK-D is a hard stop.** F4 does not start until Kevin clears the fact-resolution spot-check.
