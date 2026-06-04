# SousAI - Pipeline / Retrieval Parking Lot

> **For the character spec** (who Sous is, how he sounds, how he behaves, his hard floor): see [`docs/SOUSAI_CHARACTER_SPEC.md`](../../SOUSAI_CHARACTER_SPEC.md). That is canonical for character; this file does not duplicate it.
>
> **This file** is a passive brain dump for product thinking about the **retrieval pipeline** that feeds Sous - extraction, chunking, embedding, storage, access control, evaluation. Drop things in when they come up; don't worry about completeness. When pipeline work begins, this gets reviewed, edited down to a real spec, and superseded by an implementation plan.

---

## Vision

A retrieval pipeline that hands SousAI the right corpus chunks per question, grounded in the intranet's real data: Postgres tables (post-migration), the Playbook catalog (`documents` + related), the `/docs/` folder, and real-time queries. The pipeline is the memory; the character spec is the character. If retrieval hands Sous the wrong content, he will fluently answer the wrong question - the pipeline must be tested in isolation before being wired to him.

---

## Example queries

The user-story corpus for the retrieval pipeline. Every entry should be a real question someone might ask, with notes on what data sources it needs to answer.

*(empty - to be populated. Examples for orientation: "What's my labor variance for P5?", "What's the uniform policy?", "When's my next homestand?", "How do I submit an invoice?")*

---

## Data sources / corpus

What the retrieval pipeline needs read access to, by category.

*(empty - to be populated. Will likely include: Postgres tables post-migration, the `/docs/` folder, the Playbook catalog (`documents` + `document_relationships` + `document_surfaces`), real-time schedule data, etc.)*

---

## Access control

Who sees what. Account-scoped data is sensitive.

*(empty - to be populated. Open: row-level security in Postgres vs. application-layer filtering on the RAG retrieval step.)*

---

## Conversation memory

Does SousAI remember past questions? Within session? Across sessions? Per-user or per-account?

*(empty - to be populated)*

---

## Quality / accuracy bar (retrieval side)

The character spec sets the **hard floor** on behavior (Section 8 of `SOUSAI_CHARACTER_SPEC.md`: never invent, zero tolerance on numbers, food-safety always escalates, always show the source). This section is about the **retrieval side** of the same standard - precision/recall on getting the right chunks for the right question, so Sous has truthful raw material to answer from.

*(empty - to be populated. Numbers/variance/dollar amounts = zero tolerance. Help/glossary = higher tolerance.)*

---

## Out of scope

What this file is NOT. Pipeline only - never duplicate or contradict the character spec.

*(empty - to be populated)*

---

## Open questions

Decisions to make before the pipeline build starts.

- **"I don't know" threshold can't be raw similarity alone.** From the 2026-06-04 preliminary retrieval test (4 docs, 130 chunks): the gap between weak-but-real hits (typo-laden question, sim ~0.30) and no-answer queries (out-of-corpus question, sim ~0.20) is only ~10 points. That gap will compress as the corpus grows and there's more semi-relevant content to fish through, eroding any static similarity threshold. The likely fix is a verifier step on top of retrieval: pull top K chunks, then ask Claude "is the retrieved content actually relevant to the question?" before answering. Decide before retrieval ships to production.
- **Spanish queries embed at ~half the confidence of English.** **RESOLVED 2026-06-04: won't-do.** SousAI is English-only in practice. All users query in English; the Spanish-language docs (POSTER-001, POST-002 EN+ES wall posters) are physical wall postings for kitchen staff, never queried through Sous. ES retrieval is a non-requirement, so the translate-then-embed and multilingual-model options below are moot for present scope. Poster stubs stay as English-pointer chunks (the stub is metadata about the poster's existence, not translated content); `documents.source_drive_id_es` fields sit unused but harmless. _Original empirical finding preserved in case the decision ever reverses: 2026-06-04 test showed an ES question retrieved the right English chunks at sim ~0.33 vs ~0.66 for the English equivalent. Two reactivation paths if scope ever changes: (a) translate-then-embed (ES query → EN translation → embed → search the EN index), (b) re-embed the corpus with a multilingual model. (a) is the lighter-weight path._

---

## Brain dump

Catch-all for thoughts that don't have a clear section home yet. Move to the right section when their fit becomes clear.

*(empty - to be populated)*
