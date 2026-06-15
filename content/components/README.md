# MDX components - the source-side contract

These are the JSX-style tokens that appear in `/content/documents/<ID>.mdx` and that the **resolver** processes at build time.

For F1 they are not React components - they are tokens recognized by the resolver. At F1.5 / next phase they become real React components for the intranet view; the source syntax does not change.

**Convention:** hyphens only, no em-dashes (per STD-001 and the brief; em-dashes live only in the print render later).

---

## `<Fact id="..." />`

Looks up the named fact in `/content/facts/operational-facts.yaml` and resolves it against the doc's `applies_to` context (or a runtime context for Sous answers).

```mdx
Hold cold foods at <Fact id="cold_hold_temp" /> or below.
Sick leave accrues at <Fact id="sick_accrual" />.
```

### Resolution rules

- **Global fact** -> render the default value verbatim. Example: `<Fact id="cold_hold_temp" />` -> `41°F`.
- **Override-bearing fact** in a scoped doc (e.g. `applies_to: { states: [NY] }`) -> render the NY override if present, else the default.
- **Override-bearing fact** in a company-wide doc -> render the default **plus** a "varies by jurisdiction" qualifier so the corpus never teaches Sous a conditional value as universal. Example: `1 hour per 30 worked (varies by state)`.
- **Override-bearing fact in unscoped context (runtime Sous query without an account/state hint)** -> same as company-wide: floor + qualifier.

### Optional attributes

- `format` (future) - hint how to render (e.g. `format="number"` to render as a digit only, `format="phrase"` for full prose). For F1 the resolver renders `value` verbatim.

### What the resolver returns

The resolver replaces the token with a plain text string in the flattened corpus output, and with a structured `{value, authority, sourceFact}` object in the catalog/inspection output.

---

## `<Include doc="..." section="..." />`

Transcludes a section from another document. Use **sparingly** - facts always, includes only for blocks genuinely reused verbatim. Resist DITA-grade componentization at this library size (brief §3.7).

```mdx
<Include doc="SOP-002" section="6 The Six Steps" />
```

### Resolution rules

- The `doc` must exist as a `/content/documents/<doc>.mdx`.
- The `section` matches a heading in that doc by its plain text (case-sensitive, leading number / punctuation tolerated). The resolver flattens the matching section's body and inlines it.
- Cycles are rejected by the validator (an Include cycle would loop the resolver).

### When to use

- A safety preamble that appears in 5 docs identically -> `/content/components/safety-preamble.mdx` + `<Include doc="components/safety-preamble" section="all" />`.
- Anything that paraphrases differently per doc -> do NOT include. Keep the divergence.

---

## `<NonCanonical>` ... `</NonCanonical>`

Wraps inline specimen, example, or fill-in content that must NOT be quoted by SousAI as fact. Implements SousAI hard floor rule 7 (template-as-canonical) at the content layer. **F1.5 §4 rule.**

```mdx
<NonCanonical>
> TRY THIS: "The steak ran past the temp we wanted. That's on us."
> NOT THIS: "There were some issues with the protein station today."
</NonCanonical>
```

### Resolution rules

- The resolver **strips** these blocks during `flattenForCorpus`. The specimen text never enters `document_chunks`.
- The print render and the intranet view (next phase) **keep** the blocks for human readers.
- Use for: callout examples, sample table rows in TPL docs, "TRY THIS / NOT THIS" coaching scripts in PB-003, the brand-promise example in STD-001, any case where a reader needs to see the example but Sous must not retrieve it as policy.

### When to use

- STD-001 callout examples (Promise Callout, Anchor Banner, Critical Banner sample text).
- PB-003 "TRY THIS" / "NOT THIS" coaching scripts.
- TPL-019 sample-row data ("J.S. / 6-12" placeholder initials).
- Any future TPL-class doc's example data.

### When NOT to use

- The MLR 21 text in AGR-001 (it IS the binding policy, even though it reads as quoted text).
- The 9 Clubhouse Rules in AGR-001 (binding, not examples).
- Anything operators actually need to follow.

---

## `<SourceGoverns doc="..." section="..." />`

Emits a one-line preamble: "This document derives from [doc]. Where the two differ, [doc] governs." Used by derived / reference docs (CHK, REF, satellite TPL) that derive from a parent SOP, POL, or PB. **F1.5 §4 rule.**

```mdx
<SourceGoverns doc="SOP-008" section="§15" />
```

### When to use

- CHK-003 (Health Inspection Readiness Checklist) -> derives from SOP-008.
- REF-003 (Disciplinary Process Manager Quick Reference) -> derives from SOP-004.
- Future quick-reference cards and checklists that paraphrase a parent.
- Worked-example references (REF-005-A/B) -> derive from PB-005.

### Why

A Sous answer that retrieves from a derived doc carries the canonical-source pointer in-band, so the reader knows where to go if they need to verify. Defends against the case where a Sous answer cites the derived doc and the operator follows the derived doc instead of checking the source SOP.

---

## What does NOT live in `/content/components/`

- Layout components (cover page, header, footer, callout styling) - those are renderer concerns and live in the print / intranet phase.
- React components for the live intranet - same.
- Anything generated. Generated outputs live in `/content/derived/`.

---

## Compliance with the brief

| Brief §3.7 element | Where |
|---|---|
| `<Fact id />` (atomic values, with override resolution, use freely) | resolver in `scripts/content/resolver.mjs` |
| `<Include doc section />` (shared content blocks, sparingly) | resolver in `scripts/content/resolver.mjs` |
| Override-aware resolution against `applies_to` context | resolver `resolveFact(fact, context)` |
| Floor-plus-qualifier for company-wide docs | resolver `qualifierForCompanyWide()` |
| Audience-scoped corpus flatten | corpus projection `project_corpus.mjs` filters by `audience` + `classification` |
| Plain text flatten for the corpus | resolver `flattenForCorpus(mdx, context)` |
