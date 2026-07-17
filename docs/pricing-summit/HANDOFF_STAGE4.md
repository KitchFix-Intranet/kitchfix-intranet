# HANDOFF_STAGE4 — Total Alignment Brief for the Successor Chat
> **You are Chat-Claude on the KitchFix pricing/SC workstream.** This doc is your boot image. Read it fully, then the pointer docs in §13, then tell Kevin: "Aligned — ready for Stage 4." Personal/relationship context arrives via Claude memory, NOT this doc (repo-committed, work-only). A companion file `CC_HANDOFF_STAGE4.md` carries the execution-environment truth from Claude Code's vantage point — read it too.

## 0. WHO'S WHO + HOW THIS WORKS
- **Kevin Fietek** — Sr. Director of Operational Excellence & Systems. Sole owner of the KitchFix intranet. Reviews everything, merges every PR, runs every migration. Direct, iterative, wants honest pushback over validation, approves proposed work before execution.
- **You (Chat-Claude)** — design director / verifier / conflict-flagger / prompt-writer. NO repo access. You write files in an ephemeral sandbox (`/mnt/user-data/outputs/`) and prompts for CC. **File share is quota-limited — paste content in chat or route through CC when large. Stage 4 exists in a NEW chat precisely to restore screenshot quota.**
- **CC (Claude Code)** — executes ON Kevin's machine (repo `github.com/KitchFix-Intranet/kitchfix-intranet.git`). Opens PRs, NEVER merges. Kevin's Downloads = the exchange folder.
- **The loop**: You design/verify/write prompt → Kevin hands to CC → CC executes + reports → Kevin pastes results → you verify → Kevin merges.
- **Comms style (Kevin-requested)**: chat = concise, layman's terms, bullets. Depth lives in FILES.
- **OPD chatbot** — separate Claude instance owning the OPD/Playbook knowledge system. Fully briefed (see §8/§11); coordinates via Kevin-carried relays.

## 1. STANDING RULES (all of them — non-negotiable)
1. **Ripple check**: every correction/new fact → cross-check the whole doc set for ripples; report what and where.
2. **Always provide a CC prompt** when handing Kevin a task for CC.
3. **One ledger**: `docs/pricing-summit/LEDGER.md` is the single pricing ledger. Verify before every handoff.
4. **Sandbox = truth during a build; repo = truth after merge.** Edits to merged files ride a FUTURE PR.
5. **Ledger discipline**: clean APPENDS (first-N-lines byte-identical) or SURGICAL in-line corrections (PR #443/#447 precedent, diff-verified). CC prompts include the clean-append verification block.
6. **Sum-check law**: any per-period vector must SUM to its stated total before use. (Caught the A-9 reversal.)
7. **Signed sheet = attested authority** (`KitchFix_Service_Calendar_Price_Review_v3_FINAL.xlsx` → tab `Service Price Review` → col `Billing Price`, Joe Lessard-attested). Mismatch = negotiated override or flag — never "signed is wrong." Kevin+Joe rulings CAN move PG ahead of signed; the sheet then owes a refresh (current: the v4 queue, §9).
8. **Audit the summary against the DATA.** Digests/extractions were the artifact THREE times (A-1, A-4, A-9).
9. **P-1 hierarchy**: executed contracts → Joe's word/finance docs → signed Price Review v3 → workbooks → PG. Finance's `PFS Service Fees 2026.xlsx` = high authority for SF amounts/cadence. For LIVE operational prices, PG/SC is the operating SOT and docs reference it.
10. **Migrations**: Kevin runs in Supabase Studio. PREVIEW → GUARDED (value-guards) → VERIFY. Price change = new effective-dated row; error correction = in-place with guard. NEW LESSON: Studio multi-statement blocks swallow per-statement row counts — run statements individually when counts matter.
11. **Extraction discipline**: verbatim, page-cited, UNKNOWN over guessing, flag-don't-resolve, `[CC calc]` tags.
12. **Design sessions**: critique before creation · thesis before execution · one screen DEEP not wide · render-and-react (screenshots) · durable scaffolding over session instructions.
13. **Design audit workflow**: SC-### ledger, OPEN → AGREED → FIXED → VERIFIED, hard audit/fix gate. Repo's `docs/DESIGN_AUDIT_LEDGER.md` is LIVE.
14. **Terminology**: "cost basis" BANNED → "post-SF invoice rate". `price_kind='projected'` = legacy name holding the post-SF invoice rate.
15. **Naming collision**: `docs/phase2/` = OPD's own project. Ours = "PRICE CERTIFICATION," never "Phase 2."
16. **Verification checks must be exact-match**: a case-insensitive smoke check produced a FALSE PASS on 'Extended Day Labor'. Gates work — the Stage-3 gate caught unapplied fixes; keep gates, keep them strict.

## 2. HARD-WON LESSONS (the sagas)
- **A-1 (TBR MiLB)**: digest flattened Lunch $21.675 + Dinner $20.96 into one row → phantom conflict, 3 wrong rulings. Signed stores 3 distinct MiLB rates; PG matched all along.
- **A-4 (TBJ "blend")**: one sampled invoice + tier language → phantom "$11.55 blend." Truth: FCL ($11.55, at PDC) + FSL ($16.51, delivered ~15min to TD Ballpark) are TWO groups.
- **C-2 (TBR SF)**: flipped twice off single-document slices. Truth: recurring $200K + variable (2026 = $457,768).
- **A-9/D-3 (STL-FL vector)**: appendix transcription DROPPED the P1 cell → we "corrected" truth to match a broken extraction. Finance xlsx proved original GOTCHAS right: P1 45,553 · P2 171,367 · P3 407,375 (peak) · P4 132,755 · P5-P9 98,915×5 · P10 57,267 · P11 52,061 · P12 39,047 · P13 0 = $1.4M exact. Reversed everywhere (#447).
- **C-17 (CIN-AZ volume tier)**: decoded — step-up rates = base ÷ 0.70 exactly = SF-EXHAUSTION mechanic (72,890 = 2023 budgeted volume), not a typo. Then Kevin CLOSED it with operational reality: annual projection billed at post-SF as a FLOOR (under-attendance still bills full projection; overage stays post-SF). 2023 language outdated. NO action, NO Joe question, do not reopen.
- **A-11 (BGC)**: "out of scope" rec reversed — BGC is IN-SCOPE TBR-FL (2nd client on the commissary; after-school SUPPER, $6.50, tax-exempt; "B&G Lunch" service name = known legacy labeling).
- **A-14**: signed CELL 20.30622 vs Joe-APPROVED $20.31 — Kevin's word on approvals > cell reads.
- **Infra**: stable model aliases only (dated IDs = time bomb) · background processes don't survive bash calls (foreground + timeout + checkpoints) · silent failures made loud and named · false-PASS lesson (rule 16).

## 3. THE BUSINESS DOMAIN (one paragraph)
KitchFix feeds MLB organizations: 11 Service-Calendar accounts across Reds (CIN-AZ Goodyear ST · CIN-KY Louisville AAA commissary · CIN-OH GABP), Cardinals (STL-MO Busch · STL-FL Jupiter PDC), Blue Jays (TBJ-FL Dunedin PDC · TBJ-NY Buffalo AAA), Rays (TBR-FL Port Charlotte PDC + commissary + BGC), Rangers (TXR-AZ Surprise ST · TXR-TX-H Globe Life · TXR-TX-V visiting). The SC intranet module tracks daily meal counts; billing = counts × prices (per-meal) or flat fees. The pricing summit built the canonical record layer; PRICE CERTIFICATION proved every PG price = signed authority (DONE, §9); Stage 4 puts prices into the SC input screens; Stage 5 mock-updates + finance CSVs; then OPD handoff.

## 4. MONEY MODEL ESSENTIALS
- **Four fee mechanics**: flat-fee (CIN-OH, STL-MO, STL-FL, TXR-TX-H, TXR-TX-V — `sc_fee_schedule`, PG carries ESCALATED figure) · SF% buy-down (CIN-AZ 30%, TBR-FL 25% MiLB-only) · deposit discount (TXR-AZ 20%) · opt-in direct sales (TXR-V). SF%/deposit fees live in finance §W + docs, NOT PG.
- **2026 fees (finance-confirmed §W)**: CIN-AZ $445,716 · CIN-OH $376,686 · STL-FL $1.4M · STL-MO $489,497 · TBJ-FL $515,712 (negotiated billable; ~CPI-consistent from $452,812; contract figure outdated) · TBR-FL $457,768 ($200K+$257,768) · TXR-AZ $301,623 deposit (3×$100,541) · TXR-TX-H $604,032.
- **Nine escalation treatments** (ALL formula-verified vs real BLS CPI, zero drift): CIN-AZ Oct 2%/5% · CIN-OH Aug 1%/4% · CIN-KY none · STL-MO Aug SEFV no-cap · STL-FL flat · TBR 75%×SEFV01 Nov · TBJ 100% CPI Q4 · TXR-AZ fixed 2.5% (cleanest) · TXR-TX-H none (+10% negotiated). One-size-fits-all = wrong by construction. NOTE: Oct 2025 CPI unavailable (BLS appropriations lapse) — affects CIN-AZ's 2027 derivation.
- **Tax**: FL 7% · AZ 9.5% · KY 6% · NY 8.75% · CIN-OH SF taxable 7.80% · TXR-TX-H SF taxable 8.25% · STL SFs NON-taxable (Cardinals' asserted position, they bear risk) · reimbursables ALWAYS tax-zero · BGC exempt (`is_tax_free=true` in PG) · TBR add-ons mixed (blended 6.93% seen).
- **Billing routing**: MLB + MiLB = SEPARATE client cost centers at ST/PDC accounts (two invoice streams by design). TBR adds BGC as third stream. PFS = Performance Food Service (QB naming).
- **Postseason**: per-meal = same rates more days; flat-fee = per-game (CIN-OH 1/81 $4,413.58 · STL-MO $5,222.22 · TXR-TX-H pro-rata).
- **Passthroughs (never revenue)**: STL-FL $900K+upkeep · STL-MO $225K · CIN-OH budgets · TBJ-FL pantry. Weekly single-line, tax-zero. **Non-revenue**: "Fun $$$$" never invoices.
- **sc-8c**: only projected-kind rows remain = the post-SF invoice rate.

## 5. PER-ACCOUNT CHEAT SHEET (full truth: `docs/pricing-summit/accounts/ACCOUNT_<KEY>.md`)
- **CIN-AZ**: hybrid SF% 30% ($445,716). Post-SF MLB $20.31 / MiLB $12.90. Coffee $511.05/wk + Fountain $283.92/wk (tax-free flag). C-17 closed (projection-floor model).
- **CIN-KY**: per-meal no-SF $25.95/$8.64, KY 6%, commissary, no escalator. Rachel Sharley.
- **CIN-OH**: flat $376,686 (escalated, PG ✓). SF taxable 7.80%. Postseason 1/81.
- **STL-MO**: flat $489,497 billed / $473K base (PG ✓). "Management Fee" invoicing. SF non-taxable.
- **STL-FL**: flat $1.4M quarterly + $900K passthrough. 13-period phase vector (§2, sum-checked). C-20 $350K work-stoppage payment Nov 1 2026. Jen Goldstein.
- **TBJ-FL**: flat SF $515,712 (3×$171,904 Jan-Mar) + per-meal parallel. MLB $23.12 · FCL $11.55 · FSL $16.51 · Media $16. Fun $$$. MFN clause. Katarina Dimino/Charlie Wilson.
- **TBJ-NY**: per-meal $27.34, NY 8.75%, bills through Toronto PDC. Highest doc-risk; rate invoice-confirmed. Snack/Shake deactivated (legacy boolean — accepted).
- **TBR-FL**: MLB per-meal ($35.63/$39.48, Erik Hart) + MiLB 25% buy-down (17.83/21.68/20.96, Sunny Jones) + recurring SF $457,768 + **BGC** ($6.50 supper, tax-exempt, term→May 21 2026 no auto-renew). Add-ons: Road Sandwiches $15 / Labor Fee $280 / Extra Protein $111.84 (mixed tax).
- **TXR-AZ**: 20% deposit discount, 2.5% esc. $28.58/$14.29/$10.93/$5.89. Stosh Hoover/Brandon Boyd.
- **TXR-TX-H**: flat $604,032 (6×$100,672), SF taxable 8.25%, negotiated +10%.
- **TXR-TX-V**: opt-in visiting-team sales, OUT of SC billing scope; PG catalog = 4 operational windows (Arrival/Post BP/Post-Game/Umpire), NO prices by design. Britt cc rule on comms.

## 6. PEOPLE
- **Joe Lessard** (VP Finance-side; signs Price Review; asks in `questions/JOE_QUESTIONS.md`) · **Sebastian** (AP/QuickBooks; `questions/SEBASTIAN_QUESTIONS.md`) · **Britt Chernikovich** (Dir. Culinary; TXR-V cc rule). Departed: Ashley Meuser (Reds → Sarah Vedder + Rachel Sharley), Michelle Rodgers (TBJ → Katarina Dimino).

## 7. PROJECT HISTORY (PR log)
#438 CIN-AZ · #439 CIN-KY · #440 TBJ-NY · #441 Batch-2 · #442 TXR-V · #443 enrichment (ledger-collapse caught) · #444 Batch-3 + BGC = 11/11 · #447 doc cleanup + A-9 reversal (main=2a31380). PG migrations run 2026-07-16 (fees) + 2026-07-17 (Stage-1 fixes + BGC flag, via Studio).

## 8. DECISIONS MADE (do not re-litigate)
- **Sequencing**: docs clean ✓ → PRICE CERTIFICATION ✓ → Stage 4/5 → OPD handoff. No number becomes a Fact until certified (now satisfied — Facts source from the PRICE_BOOK only).
- **Lanes**: we deliver pristine markdown + handoff manifest; OPD does ALL porting (MDX/frontmatter/Facts/embedding).
- **OPD custody model (ratified)**: Phase 1 = extraction with ZERO substantive change (fidelity rule: every fact traces to source). Phase 2 = after Kevin declares cutover, OPD becomes SYSTEM OF RECORD for these docs; future contract/term updates happen IN OPD. Permanent exception: live prices stay SC/PG-owned forever; OPD receives them only via the generated PRICE_BOOK.
- **SOT boundary**: PG/SC owns live prices · account files = per-account truth · digests = agreed terms · PRICE_BOOK = generated-from-PG, never hand-edited · evidence/register/ledger-narrative = frozen forensic, never in corpus.
- **Canonical order**: account files > ASB · digests > SC_CONTRACT_BILLING_SUMMARY · MONEY_MODEL = framework (figures annotated).
- **Declined**: §2b itemization sweep (AF audit 92 no-entry rows are by design) · C-17 reopening · TXR-V archive (dissolved — catalog was already operational-only).

## 9. CURRENT STATE — CERTIFICATION COMPLETE (as of 2026-07-17 EOD)
- **Stage 1 ✅**: 4 PG fixes applied in Studio + smoke 4/4 (A-14 $20.31 · Media Meals $16 · tax-free suffixes dropped · Extended Day Labor). **Stage 1-b ✅**: BGC `is_tax_free=true`.
- **Stage 2 ✅**: escalation verification — ZERO drift vs signed across all 9 treatments (report: `ESCALATION_VERIFICATION_REPORT.md`, 415L, Downloads). CIN-OH/STL-MO within 0.03% of formula; TXR-AZ exact; TBJ-FL SF ~CPI-consistent.
- **Stage 3 ✅ CERTIFIED**: four-way audit (Signed × PG × AccountFiles × legacy workbooks) — **103/105 PG=Signed at 2dp, ZERO real failures** (report: `STAGE3_CERTIFICATION_AUDIT.md`, 324L, Downloads). The 2 non-matches are signed-side: Media Meals cell ($15, Kevin ruled $16 — PG right) + STL-FL Snack "NEEDS PRICE" (PG $0 = the C-8 ruling). AF layer: 13 match / 0 drift / 92 no-entry (by design). 16 workbook divergences catalogued (retire-the-sheets evidence).
- **SIGNED v4 REFRESH QUEUE** (next Joe touchpoint, 2 cells, non-blocking): Media Meals → $16 · STL-FL MiLB Snack → $0. Joe re-attests; then re-run the harness.
- **PRICE_BOOK**: generation prompted to CC (`scripts/generate-price-book.mjs` off `scripts/audit-sc-prices.mjs`). SUCCESSOR: VERIFY it exists as `docs/pricing-summit/PRICE_BOOK.md` (generated-header, all 11 accounts) and is merged. Regenerate on any price change.
- **Certification harness**: `scripts/build-four-way-audit.py` (promoted from /tmp) — re-run after any price change or v4 refresh.
- **PHASE-DOCS PR**: pending at handoff-writing time — commits HANDOFF_STAGE4 + CC_HANDOFF_STAGE4 + PRICE_CERTIFICATION_PLAN + PRICE_BOOK + stage prompts + ledger append + register FINAL DISPOSITIONS table + doc flips (C-17 closure in ACCOUNT_CIN-AZ §5, ASB typo-line annotation). SUCCESSOR: confirm merged before anything else.
- **OPD**: full briefing relayed (prime directive: extraction-not-authorship · custody model · reading order · authority model · genre map · 5 traps · terminology). OPD is running its read-only recon → migration map. We OWE the HANDOFF MANIFEST (per-doc: canonical status, sensitivity rec, in-corpus rec, cross-refs, update-path map). Final OPD doc set = its map RECONCILED against our manifest.

## 10. STAGE 4 — YOUR IMMEDIATE WORK (the design brief)
**Goal**: billing price displayed next to every service in the SC input screens; Kevin drives with SCREENSHOTS (render-and-react — the reason this chat is fresh).
**Settled inputs**: default display = **post-SF invoice rate** (Q-8) · flat-fee accounts must NOT imply meal-math revenue (per-meal $0 by design — decide the visual: planning-only badge? hidden?) · TXR-TX-V shows NO prices · visual treatment needed for flags: is_flat_fee add-ons, is_non_revenue (Fun $$$), tax-exempt (BGC), mixed-tax add-ons (TBR).
**Process (rules 12/13)**: critique current screens FIRST → design thesis → Kevin approves → mockups → SC-### audit-ledger discipline → CC implements. One screen deep. Likely surfaces: DayDetail entry modal (`src/app/service-calendar/DayDetail.js`, 1408L) + admin PriceEditPanel; season/period views secondary.
**Code map**: `src/app/service-calendar/` (ServiceCalendar.js 2572L · DayDetail.js · DaySquare.js · admin/ 13 files · season/ 32 files) · API `route.js` 1233L · data `src/lib/dataStore/serviceCalendar.js` 2557L · export `scWorkbook.js`. Design system: `docs/DESIGN_SYSTEM_REFERENCE.md`, `docs/SC_DESIGN_TOKEN_README.md`, `docs/DESIGN_AUDIT_LEDGER.md` (LIVE; prior arcs closed 63 findings).
**Then Stage 5**: mock-update all 11 → per-account CSVs (R13 rounding: extended lines 2dp, sum exact · MLB/MiLB separate invoices · BGC own stream) → Joe/Sebastian accept.

## 11. THE TWO EXITS (after Stage 5)
- **OPD HANDOFF MANIFEST + package**: doc inventory w/ per-doc recs + PRICE_BOOK + SOT declarations + update-path map + sensitivity (restricted/slt; specimens non_canonical) + Phase-1/2 custody line. OPD prep running in parallel (id-space, dedupe PB-009/012/005 + REF-005-A/B retirement, prune, Facts shape design).
- **Phase E** (async): golden test — SC export == real QB invoices to the penny. WAITING on accounting pulls: TBJ-FL SF $171,904 · TXR-AZ deposit $100,541×3 · TBR K300168375/376 · a BGC invoice.

## 12. OPEN/ASYNC REGISTER (nothing blocks Stage 4)
**A-10** — the LAST open A: what is CIN-AZ's $52K "2200 Catering Revenue" (cooking classes @ $1,000/class per §IV.C? other?) — one-liner from Kevin, collect opportunistically · **Signed v4** (2 cells, Joe touchpoint) · Joe #1/#2/#3-method/#5 · Sebastian #3 (pending invoice pulls) + #4 + TBR add-on tax flags + reimbursable due-date convention · BGC 2026-27 renewal + signatory confirm · optional TBJ-NY Snack/Shake admin re-archive (proper active_until mechanism) · paperwork chases (CIN-AZ renewal notice · TBJ-NY MSA+SOWs · TXR-AZ 2026 SOW · TBR 2025/26 SOWs) · code-comment refs to archived docs (mechanical sweep, flagged in #447) · STL-MO $64 accrual rounding (known, trivial) · TBR memo "2025" typo (Sebastian, cosmetic).

## 13. WHERE TRUTH LIVES (read in order)
1. `docs/pricing-summit/README.md` → 2. `accounts/ACCOUNT_FILE_SPEC.md` → 3. the 11 account files → 4. `LEDGER.md` §Q + the 2026-07-17 appends → 5. `PRICE_BOOK.md` (generated) → 6. `CONTRACT_DIGEST_*.md` (12) → 7. `docs/SC_MONEY_MODEL.md` (framework; annotated) → 8. this file + `CC_HANDOFF_STAGE4.md` + `PRICE_CERTIFICATION_PLAN.md` + the two certification reports (stage prompts remain in chat history) → 9. design docs (`DESIGN_SYSTEM_REFERENCE`, `SC_DESIGN_TOKEN_README`, `DESIGN_AUDIT_LEDGER`) → 10. repo agreements (`CLAUDE.md`, `HOW_WE_WORK.md`). Reports (escalation + certification) live in Kevin's Downloads and/or alongside phase docs. SKIP for orientation: EVIDENCE_*, CONFLICT_REGISTER (frozen forensic), LEDGER narrative A-P.

## 14. YOUR FIRST MOVES
1. Read §13 items 1-8. 2. Confirm the phase-docs PR is MERGED (contains this file — if you're reading it in-repo, it is) and `PRICE_BOOK.md` exists + looks generated. 3. Say to Kevin: "Aligned — ready for Stage 4," restating the thesis process in one line. 4. Ask for current screenshots of the DayDetail modal + season view → run the critique pass (rule 12). 5. Collect the A-10 one-liner opportunistically. 6. Keep every §1 rule — especially ripple-check, CC-prompt-always, sum-check, signed-sheet authority, and exact-match verification.
