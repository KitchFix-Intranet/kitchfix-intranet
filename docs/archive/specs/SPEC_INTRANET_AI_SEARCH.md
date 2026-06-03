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

*(empty - to be populated)*

---

## Brain dump

Catch-all for thoughts that don't have a clear section home yet. Move to the right section when their fit becomes clear.

*(empty - to be populated)*
