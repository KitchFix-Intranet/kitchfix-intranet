# Sous AI - Intranet Search Spec

This file is a **passive brain dump** for product thinking about the future Sous AI intranet search feature. It is not a build spec yet. It is the parking lot for thoughts, questions, examples, and constraints that surface during current work (audits, migration prep, day-to-day ops) that will inform the eventual build.

When Stage 1+ work begins on Sous AI itself, this file gets reviewed, edited down to a real spec, and superseded by an implementation plan. Until then, the discipline is: drop things in when they come up; don't worry about completeness.

## Vision

*(One-paragraph description of what Sous AI is supposed to do. Will be refined over time.)*

The intent: a natural-language search and Q&A interface inside the KitchFix Ops Hub that lets team members ask questions about company data, policies, schedules, and procedures and get accurate answers grounded in the intranet's actual systems (Postgres data + docs + real-time queries).

---

## Example queries

The user-story corpus. Every entry should be a real question someone might ask, with notes on what data sources it needs.

*(empty - to be populated. Examples for orientation: "What's my labor variance for P5?", "What's the uniform policy?", "When's my next homestand?", "How do I submit an invoice?")*

---

## Data sources / corpus

What Sous AI needs read access to, by category.

*(empty - to be populated. Will likely include: Postgres tables post-migration, the `docs/` folder, real-time schedule data, etc.)*

---

## Access control

Who sees what. Account-scoped data is sensitive.

*(empty - to be populated. Open: row-level security in Postgres vs. application-layer filtering on the RAG retrieval step.)*

---

## Conversation memory

Does Sous AI remember past questions? Within session? Across sessions? Per-user or per-account?

*(empty - to be populated)*

---

## Quality / accuracy bar

Where hallucination is tolerable vs. unacceptable.

*(empty - to be populated. Numbers/variance/dollar amounts = zero tolerance. Help/glossary = higher tolerance.)*

---

## Out of scope

What Sous AI is NOT.

*(empty - to be populated)*

---

## Open questions

Decisions to make before the build starts.

- **"I don't know" threshold can't be raw similarity alone.** From the 2026-06-04 preliminary retrieval test (4 docs, 130 chunks): the gap between weak-but-real hits (typo-laden question, sim ~0.30) and no-answer queries (out-of-corpus question, sim ~0.20) is only ~10 points. That gap will compress as the corpus grows and there's more semi-relevant content to fish through, eroding any static similarity threshold. The likely fix is a verifier step on top of retrieval: pull top K chunks, then ask Claude "is the retrieved content actually relevant to the question?" before answering. Decide before retrieval ships to production.
- **Spanish queries embed at ~half the confidence of English.** **RESOLVED 2026-06-04: won't-do.** SousAI is English-only in practice. All users query in English; the Spanish-language docs (POSTER-001, POST-002 EN+ES wall posters) are physical wall postings for kitchen staff, never queried through Sous. ES retrieval is a non-requirement, so the translate-then-embed and multilingual-model options below are moot for present scope. Poster stubs stay as English-pointer chunks (the stub is metadata about the poster's existence, not translated content); `documents.source_drive_id_es` fields sit unused but harmless. _Original empirical finding preserved in case the decision ever reverses: 2026-06-04 test showed an ES question retrieved the right English chunks at sim ~0.33 vs ~0.66 for the English equivalent. Two reactivation paths if scope ever changes: (a) translate-then-embed (ES query → EN translation → embed → search the EN index), (b) re-embed the corpus with a multilingual model. (a) is the lighter-weight path._

---

## Brain dump

Catch-all for thoughts that don't have a clear section home yet. Move to the right section when their fit becomes clear.

*(empty - to be populated)*
