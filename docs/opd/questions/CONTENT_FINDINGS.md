# Academy content findings

Findings surfaced during question authoring that require content edits or authoring work, not code. All dated 2026-09-01. See `docs/opd/ACADEMY_PAUSE_HANDOFF.md` for pause context.

---

## 1. `AGR-001` Acknowledgement references a retired witness countersignature

**Where.** `content/documents/AGR-001.mdx`, Acknowledgement section (last section of the document, immediately above signature).

**Current text ends:**

> The form-collection fields (Employee Name, Signature, Date, **KitchFix Witness Name, Signature, Date**) are captured in Rippling at signing event.

**Why it must be fixed before AGR-001 is onboarded.** Two rulings closed 2026-09-01 both contradict this sentence: the witness countersignature was retired, and the Academy replaces Rippling for document distribution and signature. This is also the last line a person reads before signing, so it is the worst place in the document for a stale instruction.

**Suggested replacement (from the pause handoff):**

> Your name, signature, and the date are captured in the Academy at signing. The signature is version-bound: if this document is materially revised, your signature expires and you will be asked to sign the new version.

The second sentence is worth adding because it is true, it is unusual, and a person signing a legal acknowledgment should know it.

**Blocks:** onboarding AGR-001 to any person. Do not seed AGR-001 questions until this content edit lands.

---

## 2. `PB-006` §3.14 Sanitation and Food Safety is 28 words

**Where.** `content/documents/PB-006.mdx`, section `3.14 Sanitation and Food Safety`.

**What it says.** Twenty-eight words pointing at `SOP-008` for the actual content. The highest-consequence topic in a kitchen is delegated by reference.

**Ruling 2026-09-01.** `SOP-008` becomes its own Academy module next month. Culinary OS §3.14 stays as the reference pointer; the standalone SOP-008 module carries the operational content and its own comprehension checks.

**Consequence for the Culinary OS question set.** No check on §3.14 in the current 11-question Culinary OS set is deliberate, not an oversight. The gap will be filled by the SOP-008 module rather than by adding a shallow check on 28 words.

---

## 3. `PB-006` §3.9 and §3.15 are stubs

**Where.** `content/documents/PB-006.mdx`:
- §3.9 Latin Program - 21 words
- §3.15 Branding and Information - 22 words

**Why it matters.** Every other §3.x section in Culinary Defined runs 130-350 words. In the module stepper each section becomes its own step; 21-word steps will read thin next to 300-word neighbours.

**Not yet ruled.** Worth expanding when the document is next touched. Not blocking - the merge pass in the stepper already folds short trailing sections into the previous step; §3.9 and §3.15 will read as consolidated groups rather than orphan micro-steps.
