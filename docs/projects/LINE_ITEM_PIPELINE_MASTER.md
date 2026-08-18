# Invoice Line-Item Pipeline - Master Project Log

**Living document. Updated every session.**

| | |
|---|---|
| **Project** | Invoice line-item extraction rebuild |
| **Owner** | Kevin Fietek |
| **Architect** | Chat-Claude |
| **Executor** | CC |
| **Opened** | 2026-08-17 |
| **Current phase** | A - Delivery |
| **Repo home** | `docs/projects/LINE_ITEM_PIPELINE_MASTER.md` (to be committed) |
| **Last updated** | 2026-08-17 |

---

## How to use this document

This is the **front door**. It holds state, decisions, evidence, and changes.

The **scope** (`LINE_ITEM_PIPELINE_SCOPE_v1.0.md`) holds the plan: phases, exit criteria, rulings, sequence.

**These two documents do not duplicate each other.** The scope says what we intend to do; this log says what we decided, what we proved, and where we are. When they conflict, this log is newer and wins, and the scope gets amended in the next revision. Every amendment is recorded in §4 so the scope never silently drifts from reality - which is the exact disease this project was opened to fix.

Session start: read this document first, then the scope. Session end: update §1, §2, §3, §5, and §8.

---

## 1. Status at a glance

**Done**
- Duplicate `status` constraint dropped in Studio and verified live - archive works again
- `Migration gate` armed as a required status check on `main protection`
- Railway inventory cron deleted
- Two read-only audits complete and graded (pipeline, deep alignment)
- Scope v1.0 approved
- Storage architecture decided (Supabase)

**In flight**
- PR #691 (A0 housekeeping) - DRAFT, two fixes owed
- PR #693 (A1 durable extraction) - DRAFT, three corrections owed, `li-2` NOT applied

**Next**
- CC: A1 corrections → Chat-Claude re-grade → Kevin applies `li-2` → acceptance runs
- Then: A2 backlog drain, A3 observability, then Phase B

**Blocked on Kevin**
- Nothing right now. Acceptance runs come after `li-2` applies.

---

## 2. Decision log

Every decision, dated, with rationale. Newest last within a session.

| # | Date | Decision | Rationale | Status |
|---|---|---|---|---|
| D1 | 2026-08-17 | Postgres becomes the sole write target for `ai_line_items` | Sheets-first ordering is a pre-Postgres artifact; its only consumer is dead; Sheets availability currently gates line-item writes | Locked, Phase B |
| D2 | 2026-08-17 | The Sheets mirror goes stale and is never used again | No read-only backup posture to maintain; simpler than preserving a second store | Locked |
| D3 | 2026-08-17 | Railway inventory cron deleted | No PG writes since 2026-06-04; consumers gated to Kevin and Joe; Smart Inventory v2 deletes it by design | **Done** |
| D4 | 2026-08-17 | Service/uniform vendors are tagged and skipped, not line-extracted | Not product invoices; no pack sizes; systematically distort food analysis | Locked, Phase D1 |
| D5 | 2026-08-17 | Existing line rows for skipped vendors are marked excluded, not deleted | Preservation-first, matching the `is_historical` pattern | Locked |
| D6 | 2026-08-17 | Full corpus re-extraction, after the quality work | ~1,798 reachable invoices, ~$30; re-extracting first pays twice for the same defects | Locked, Phase F |
| D7 | 2026-08-17 | 43 historical invoices and 152 orphan line groups are permanently raw-only | No source PDF exists; nothing to re-extract from | Locked |
| D8 | 2026-08-17 | Kevin hand-verifies a labeled ground-truth sample | Nothing can be scored today; proxies are not accuracy | **Amended by D8a** |
| D8a | 2026-08-17 | Ground truth is generated from PDF text layers; Kevin spot-checks rather than transcribes | For digital invoices the text layer *is* the label; cuts the work from hours to under an hour and allows a bigger sample | Locked, Phase C1 |
| D9 | 2026-08-17 | Vendor order guides sourced from the chefs | Makes the vendor catalog a build rather than a research project | Locked, Phase G |
| D10 | 2026-08-17 | Vendor extraction knowledge lives in a table, not in prompt prose | The prompt is already a per-vendor rulebook and cannot be regression-tested; combinatorial ceiling | Locked, Phase D1 |
| D11 | 2026-08-17 | All ten target data questions accepted; ordered by dependency into tiers 0-5 | Kevin approved all ten; the data, not preference, dictates the order | Locked |
| D12 | 2026-08-17 | Drop `chk_status_enum` from `invoice_submissions` | Two CHECK constraints disagreed on the same column; the stricter blocked `archived` | **Applied in Studio** |
| D13 | 2026-08-17 | `Migration gate` becomes a required status check | It fired and caught 83 real cases but never blocked the merge button | **Done** |
| D14 | 2026-08-17 | Original uploads stored in **Supabase Storage**, private bucket, path `invoices/{account_key}/{submission_uuid}.{ext}`, direct browser upload via signed URL | Removes the 4.5 MB Vercel body limit and the need for a new server endpoint; deterministic paths; far simpler for Phase F re-extraction; avoids every Drive service-account quirk | Locked, Phase B |
| D15 | 2026-08-17 | The extracted text layer is stored in Postgres alongside the file | Near-zero cost; makes C1 ground truth instant; allows re-comparison without re-fetching | Locked, Phase B |
| D16 | 2026-08-17 | Header OCR reads the text layer when one exists, falling back to the image | Invoice number sits at 82% on a field printed as clean text; fixes the impossible-date bug at its source; cheaper and faster; nearly free once B extracts the text anyway | Locked, Phase B - **scope amendment A-1** |
| D17 | 2026-08-17 | A1: the submission row **is** the job - no separate job table | A second store is a second thing that can silently drift, which is the failure class being eliminated | Locked |
| D18 | 2026-08-17 | A1: no inline first attempt; the worker is the only runner | Nobody waits on line items, so latency is irrelevant; removes any dependence on the Fluid Compute setting | Locked |
| D19 | 2026-08-17 | Backfill eligibility: live, no existing line items, `type = 'invoice'`, source PDF present, not deleted | Prevents duplicating 4,421 historical line rows that have no unique-index protection | Locked |
| D20 | 2026-08-17 | An invoice-retrieval UI in the Ops Hub comes later, as its own piece | Makes Supabase strictly better than Drive - access can be scoped per account rather than all-or-nothing | Deferred, post-project |

---

## 3. PR register

| PR | Phase | Title | State | Owed |
|---|---|---|---|---|
| #691 | A0 | Housekeeping - audit delta + `li-1` | DRAFT | V3 verify block is a live-write hazard; historical row count crossed (5,771 is `ai_line_items`, `invoice_submissions` is 622) |
| #693 | A1 | Durable extraction worker | DRAFT | Backfill scope (P0), `extractionPages.js` explanation (P1), no-write-probe rule (P1), plus three smaller items |

**Migrations**

| File | State | Notes |
|---|---|---|
| `li-1-drop-duplicate-status-constraint.sql` | **Applied in Studio 2026-08-17** | Applied out of band *before* the file was authored - protocol inversion, my error. File is idempotent so no harm. |
| `li-2-extraction-worker.sql` | Authored, NOT applied | Held until A1 corrections are graded |
| `li-3-forbid-null-scan-status.sql` | To be authored in the A1 correction round | Applies only after the backlog drains and zero NULLs remain |

---

## 4. Scope amendments

Changes to `LINE_ITEM_PIPELINE_SCOPE_v1.0.md` agreed after it was approved. Fold into v1.1.

| # | Date | Amendment | Reason |
|---|---|---|---|
| A-1 | 2026-08-17 | The line "does not touch the submit form" is **retired**. Phase B touches it twice: original-file upload and header OCR reading the text layer | Both are the same primitive doing double duty; the header win is larger than the line-item win |
| A-2 | 2026-08-17 | Original-file preservation is promoted into **Phase B** | At 80%+ digital uploads, roughly twelve invoices a day are being permanently degraded; every day of delay is unrecoverable |
| A-3 | 2026-08-17 | The `needs_review` gate gains three checks: `item_number` present, `pack_size` present, and catch-weight rows must satisfy weight x price = extended | The gate only checks arithmetic and is blind to exactly the errors that block Tiers 2 and 3 - proven on live invoices |
| A-4 | 2026-08-17 | C1 ground truth comes from PDF text layers, not hand transcription | See D8a |
| A-5 | 2026-08-17 | B1 gains a precondition: classify the 1,563-row Sheets-vs-PG gap and recover anything real before freezing | Sheets turns out to be a **full 24-column mirror**, not the legacy shape the audit first reported, so the surplus rows may be real data |
| A-6 | 2026-08-17 | Storage target for originals changed from Google Drive to Supabase Storage | See D14 |

---

## 5. Evidence register

Verified facts with their source. **Do not re-derive these.** If a number here is challenged, re-measure and record both.

### Delivery
| Fact | Value | Source |
|---|---|---|
| Coverage | 992 of 1,162 live invoices carry line items (85.4%) | Live PG, 2026-08-17 |
| Last 30 days | 333 complete, 49 failed, 1 pg_failed, 59 NULL | Live PG |
| NULL cohort is last-in-burst | **70.9%**, median 21.6 h to next submission | Live PG, 45-day window |
| Complete cohort is last-in-burst | 16.9%, median 2.9 min | Same |
| Extraction runtime | 8-51 s, median 22 s | CC rescan logs |
| Time from submit to first line row | 309 under 1 min, 330 at 1-5 min, 164 at 5-60 min, 44 at 1-24 h | Live PG, 90-day window |
| Monthly coverage | Jun 88.9%, Jul 80.6%, Aug 84.2% | Live PG |

### Quality
| Fact | Value | Source |
|---|---|---|
| `needs_review` rate | 9.9% last 14 days; Cheney 32.8%, GFS 22.3%, Sysco 11.9%, most others ~0% | Live PG |
| Review reasons | `ep_qty_up_mismatch` 1,153, `invoice_over_extracted` 247 | Live PG |
| Fill rates, post-Stage-A rows | `item_number` 96%, `pack_size` 85%+, `shipped_count` 93% | Live PG |
| Reconciliation | Median line-sum / header = **1.000** for nearly every vendor; Alsco 0.920, Kuna 0.946 (tax and fees) | Live PG, 60-day window |
| Derived `pr-10-2` columns | **0 of 19,848 rows populated** | Live PG |
| Vendor resolution failures | **Zero, ever** | Live PG |
| Superseded line rows | 777 on `corrected` parents; 46 invoices hold both sets | Live PG |

### Backlog composition (drives D19)
| Cohort | Invoices | Already have lines |
|---|---:|---:|
| live, NULL | 163 | 37 |
| live, failed | 52 | 0 |
| live, pg_failed | 9 | 0 |
| historical, NULL | 387 | **330** |
| historical, failed/pending | 20 | 1 |

Dedup index is `UNIQUE (invoice_uuid, line_num) WHERE is_historical = false` - **historical rows have no protection.**

### Cost and storage
| Fact | Value | Source |
|---|---|---|
| Extraction cost | ~$0.0165 per invoice | CC audit |
| Total monthly AI spend | ~$13-15 (extraction ~$7, photo-gate/OCR/consistency ~$6) | CC audit |
| Full corpus re-extraction | ~1,798 reachable invoices, ~$30 | Derived |
| Sheets AI_LINE_ITEMS | 21,411 data rows, 9 tabs, 7.54% of the 10M ceiling | CC audit |
| Sheets column shape | **24-column Stage A on all writes since 2026-06-09**; only the header row stayed 15-wide | CC A0, cells `P:X` read directly |
| Drive footprint | 3,638 PDFs, 1.27 GiB | CC audit |
| Typical original PDF | 59-199 KB | Measured on four real invoices |

### The four-invoice comparison (2026-08-17) - the evidence that drove D14/D15/D16 and A-3

Kevin supplied four original vendor PDFs. Two were already in the system; their stored rows were compared against the text layer.

**Kuna 282149-00** - 26 of 26 lines captured, line sum $1,833.85 matches the subtotal exactly. Two field errors:
- item `71605` stored as `71609`
- `CUCUMBER EUROPEAN` pack/uom `12 COUNT` / `CS` stored as `1 LB` / `LB` (row slip)

**Kuna 281306-00** - worse:
- item number `SC27043` stored as **null**
- unit price `18.02` stored as **`23.40`** - a case weight from `Weights: TOTAL = 38.61 ==>>>> 15.21 23.40` misread as the price
- the orphaned real price became a **phantom line**, "Miscellaneous / 9999# MISC / $18.02"
- invoice inflated by $18.02 on $695.88 (+2.6%), masked in the reconciliation ratio by unrecorded tax

**`needs_review` was `false` on all four rows.** The gate only checks arithmetic and is structurally blind to a wrong item number, a wrong pack size, a wrong unit price on a catch-weight line, and a phantom line carrying dollars - the exact four things that block Tiers 2 and 3.

**Every one of those errors is a field printed as clean text in the original PDF.**

**Fortune Fish 384142-26-06** - present with `ai_scan_status = NULL` and zero lines: a live instance of the A1 defect. Also a 2-page PDF (`OFFICE COPY` / `CUSTOMER COPY`, identical) logged as 1 page.

**Tropical Nut 24113904** - not in the system (2025, pre-dates it). Retained as a C1 fixture: 4 pages, three-part pack strings such as `4/10ct/1.59 OZ`, and zero-shipped lines.

All four become the first entries in the C1 regression set.

---

## 6. Retired and amended standing rules

Authority for these sits in scope §6. Recorded here for quick reference; the docs themselves are corrected in Phase H.

| Rule | Source | Ruling |
|---|---|---|
| "Google Sheets dual-architecture is locked" | Project instructions | RETIRED for `ai_line_items` |
| "The dual-write pattern is preserved in every orchestrator" | `CLAUDE.md:69` | AMENDED - already false; `serviceCalendar.js:73-86` inverts it and four others never used it |
| "Two-week dual-write window. Reversibility is mandatory." | `CLAUDE.md:43` | AMENDED - reversibility means re-derivable from source PDFs, not a Sheets mirror |
| "Until the Playwright suite is in place..." | `CLAUDE.md:39` | CORRECTED - the suite exists: 14 specs, `test:e2e` + `test:unit`, CI on every PR |
| "TypeScript first, then Postgres, then shadcn" | `CLAUDE.md:41` | RETIRED - ghost roadmap |
| "Invoice numbers, dates, totals do NOT extract reliably" | `GOTCHAS.md:226` | DEMOTED to hypothesis - Haiku-era, never re-measured. D16 addresses the root cause |
| Railway cron invariants `[PRESERVE THROUGH MIGRATION]` | `BUSINESS_NOTES.md:331` | RETIRED - cron deleted |
| "Recommendations under 4 hours of dev time" | Project instructions | EXPLICITLY EXCEEDED per its own escape hatch |

**New standing rules created by this project**

| # | Rule |
|---|---|
| N1 | Never verify schema state with a write. If PostgREST cannot read it, report blocked and use the value Chat-Claude supplies from `pg_constraint`. |
| N2 | Migration verify blocks must be read-only. Kevin applies statements one at a time in Studio, where `BEGIN` / `ROLLBACK` do not wrap across executions - any verify step that can commit is a defect. |
| N3 | A census reports "checked, clean" explicitly. Silence is not a result. |
| N4 | Schema-level questions route to Chat-Claude, which has `pg_constraint` access, not to CC, which does not. |

---

## 7. Open questions

| # | Question | Owner | Blocks |
|---|---|---|---|
| Q1 | Are Supabase Storage objects covered by the backup plan? | Kevin | Phase B ship |
| Q2 | Bucket file-size cap, so a 40 MB scan cannot land by accident | Kevin | Phase B ship |
| Q3 | Sample order guide, any vendor, to design the catalog against a real file | Kevin | Phase G |
| Q4 | Is Sentry actually receiving events in production? | Kevin | Phase A3 |
| Q5 | Vercel Fluid Compute setting - informational now, A1 no longer depends on it | Kevin | None |
| Q6 | What are the 1,563 surplus Sheets rows? | Phase B1 | Sheets freeze |
| Q7 | Is `pending` a dead `ai_scan_status` value? 7 rows, all historical | Phase H | None |

---

## 8. Session log

| Date | What happened |
|---|---|
| 2026-08-17 | Alignment on Invoice Capture. Pivot to the line-item pipeline. Two read-only audits commissioned, delivered, graded. Silent-loss cause proven from PG. Dollars-vs-units finding. Scope v1.0 written and approved. `li-1` applied. Migration gate armed. Railway deleted. A0 delivered. A1 delivered and corrections issued. Four real invoices compared against their text layers, driving the Supabase Storage, text-layer, and header-OCR decisions. |

---

## 9. Related artifacts

| Document | Purpose |
|---|---|
| `LINE_ITEM_PIPELINE_SCOPE_v1.0.md` | The plan - phases, exit criteria, rulings, sequence |
| `LINE_ITEM_PIPELINE_CURRENT_STATE_v0.2.md` | Baseline current-state report, superseded in detail by this log's §5 |
| `LINE_ITEM_PIPELINE_AUDIT.md` (CC) | Pipeline audit, 9 sections |
| `DEEP_ALIGNMENT_AUDIT.md` (CC) | Doc drift, migration reconciliation, external systems, 18 S1 findings |
| `kitchfix-inventory-cron/docs/invoice_extraction_profiles.md` | 736-invoice structural census, six families, zero unknowns - seed data for Phase D1 |
| `HANDOFF_INVOICE_CAPTURE_EXTRACTION_FINDINGS.md` | Purchasing-analysis punch list; several findings now stale, see §5 |
