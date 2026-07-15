# Pricing Summit — Canonical Account & Billing Record

This folder is the **single source of record** for KitchFix Service Calendar pricing,
billing terms, and per-account contract truth. When any system or person needs to know
"what does this account bill, why, and on what authority" — the answer lives here.

## Source hierarchy (P-1, ratified)
When sources conflict, this order wins:
1. **Executed contracts** — verbatim in `CONTRACT_DIGEST_<ACCOUNT>.md` (SF amounts, escalation clauses, cadence, line-item existence)
2. **Signed Price Review v3** (Joe Lessard-attested) — the authority for per-service *prices* (the `Billing Price` column)
3. **SC_MONEY_MODEL.md** — the canonical money-shape model (wins until formally amended; note: several 2026-07-14 rulings in LEDGER.md §Q are pending amendments to it)
4. **Workbooks / PG** — the audited system state (never the authority; the thing that must MATCH the above)
5. **Secondary sources** (ABR OneSheeter, ACCOUNT_SERVICES_BRIEF) — corroborate and add operational context; never override 1–4

## The two layers (how to read this record)
- **LEDGER.md = the decision-journal + evidence store.** Answers "how did we get here, who ruled what, what reversed." History lives here; §Q holds the reconciled current disposition of every conflict.
- **accounts/ACCOUNT_<X>.md = the current-state system of record.** Answers "what is true about account X *right now*, across billing and operations." Effective-dated; superseded facts move to each file's History block (marked, never deleted). Points back to LEDGER for the reasoning.
When you need *current truth* → account file. When you need *why / audit trail* → LEDGER.

## What's here
- `NORTH_STAR.md` — the certification charter (the bar the whole effort must clear)
- `LEDGER.md` — the master memory: every rule, ruling, conflict, and disposition, source-tagged
- `SCOPE.md` — Tier 1 structure (historical; the account template now lives in accounts/ACCOUNT_FILE_SPEC.md)
- `CONTRACT_DIGEST_<ACCOUNT>.md` (×11) — verbatim contract source-of-record per account
- `CONFLICT_REGISTER.md` — the point-in-time discovery record (phases 0a–0d); current status is in LEDGER.md §Q
- `PL_2026_APPENDIX.md` / `PRICE_AUDIT.md` / `BILLING_TERMS_MATRIX.md` / `PG_APPENDIX.md` — evidence appendices
- `accounts/ACCOUNT_FILE_SPEC.md` — the canonical per-account template (identity-crosswalk, effective-dating, current-vs-history, billing-vs-ops, change management)
- `accounts/ACCOUNT_<X>.md` (×11, forthcoming) — the canonical per-account records = the **system of record**
- `reviews/` — consolidated reviews of the digest corpus and secondary sources
- `questions/` — running ask-lists for the people who hold un-documented answers (Joe, Sebastian)

## Consumers (read from here; do not fork the record)
- **PG** stores operational data (prices, counts); it does NOT store the *narrative* of why. It must MATCH the signed sheet + this record.
- **The intranet / OPD / SousAI** render or act on this knowledge; they read from these docs, they are not co-owners of the truth.
- **Future humans or AIs** should be able to read this folder top-to-bottom and be fully oriented.

## Status
Evidence phase (Phase 0a–0d): COMPLETE. All 11 accounts have verbatim contract terms banked.
Synthesis phase: this folder. Per-account canonical files (`accounts/`): NEXT (CIN-AZ pilot first, then the other 10).
