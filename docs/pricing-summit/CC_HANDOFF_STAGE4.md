# CC HANDOFF - STAGE 4 (execution-environment truth)

**Written:** 2026-07-17 by outgoing CC.
**Audience:** the next Claude Code instance pairing with the fresh Stage-4 chat.
**Purpose:** everything the chat side's `HANDOFF_STAGE4.md` cannot tell you because it's not the truth on disk.

**Chat-side companion:** `HANDOFF_STAGE4.md` (in `docs/pricing-summit/` after the phase-docs PR lands). That doc carries domain / money model / rules / certification narrative / Stage-4 brief. **This doc does not repeat any of that** - reference it. This doc is the operator's manual.

Both files ride the same phase-docs commit PR into `docs/pricing-summit/`. This doc's paths + linkage assume that landing location.

---

## 1. Worktree + branch state

**Three intranet worktrees on disk right now.** All are checkouts of the same repo (`KitchFix-Intranet/kitchfix-intranet`).

| Path | Branch | Purpose | node_modules? | .env.local? | Status |
|---|---|---|---:|---:|---|
| `~/dev/kf-cell-states/` | `docs/pricing-summit-batch3-accounts` (merged PR #444) | **Session-start default per CLAUDE.md.** Where all Supabase scripts run. | ✅ | ✅ | Live |
| `~/dev/kitchfix-intranet/` | `main` | Historical checkout, also fully wired. Fallback executor. | ✅ | ✅ | Live |
| `~/dev/kitchfix-doc-cleanup/` | `docs/batch-doc-cleanup` (merged PR #447) | Ad-hoc I created for the last docs PR. **Orphaned:** remote branch auto-deleted on merge. | ❌ | ❌ | Stale |

`~/dev/kf-cell-states/` and `~/dev/kitchfix-intranet/` are **both valid main-branch executors** in practice - kf-cell-states is on a merged branch that fast-forwards cleanly to main.

**`.env.local` lives in BOTH executable worktrees** (kf-cell-states + kitchfix-intranet). Same content. Never `cat` them, never grep them, never echo (`.env*` hard-blocked per CLAUDE.md).

**Env-sourcing pattern that actually works** (each `Bash` tool call is a fresh shell - see §8 gotcha #1):

```sh
cd ~/dev/kf-cell-states && set -a && source .env.local && set +a && node scripts/audit-sc-prices.mjs --smoke
```

The `set -a` exports every variable that gets set during the source; `set +a` turns it off. Without `set -a` the `KEY=VALUE` lines set the variable but do not export it, so Node's `process.env` sees nothing.

**Branch hygiene worth doing (not urgent, but clean):**

```sh
# 1. kitchfix-doc-cleanup worktree is orphaned; both the WT and local branch can go.
cd ~/dev/kf-cell-states
git worktree remove ~/dev/kitchfix-doc-cleanup    # if clean; --force if not
git branch -D docs/batch-doc-cleanup              # local ref cleanup

# 2. kf-cell-states itself sits on a merged branch. Move it to main:
git fetch origin && git checkout main && git pull

# 3. kitchfix-intranet also worth pulling forward:
cd ~/dev/kitchfix-intranet && git fetch origin && git pull --ff-only origin main
```

I did NOT run these cleanups (not my call to run destructive git in a fresh session). Kevin decides.

**If you see 260+ commits behind on main:** that's just an untouched worktree, not corruption. `git pull` fixes it.

---

## 2. Script inventory (the certification toolchain)

All three certification scripts live at `~/dev/kf-cell-states/scripts/` and are untracked (queued for the phase-docs commit PR - see §7).

### 2.1 `scripts/audit-sc-prices.mjs` - PG price dumper / smoke gate

**READ-ONLY** against Supabase. SELECT-only. Persistent - this is the PRICE_BOOK generator's data feed and the certification harness's PG source.

**Modes:**
```sh
node scripts/audit-sc-prices.mjs --smoke              # 5-check Stage-1/1-b gate; exits 0/1
node scripts/audit-sc-prices.mjs --out /tmp/pg_prices.json    # canonical full JSON dump
node scripts/audit-sc-prices.mjs > snap.json          # stdout, no smoke output
node scripts/audit-sc-prices.mjs --pretty > snap.json # dump + human summary on stderr
```

**Snapshot JSON shape (contract with downstream scripts):**
```json
{
  "generated_at": "2026-07-17T10:39:12.221Z",
  "counts": { "accounts": 12, "groups": 23, "services": 105, "prices_scanned": 161,
              "services_with_projected_price": 105, "services_with_actual_price": 0 },
  "smoke": [ { "id": "...", "pass": true, "detail": "..." }, ... ],
  "rows": [
    {
      "account_key": "CIN - AZ",              // SPACED-HYPHEN
      "account_name": "Cincinnati Reds - Goodyear PDC",
      "billing_model": "actuals_drive_invoice",
      "group": "Major League",
      "service": "Breakfast",
      "is_flat_fee": false, "is_non_revenue": false, "is_tax_free": false,
      "svc_active": true, "svc_active_until": null, "group_active_until": null,
      "projected_price": 20.31, "projected_effective_date": "2026-06-18",
      "actual_price": null, "actual_effective_date": null
    }, ...
  ]
}
```

**Smoke checks (all case-EXACT where noted):**
1. `CIN - AZ` / `Major League` / `Breakfast` projected = `$20.31`
2. `Media Meals` projected = `$16.00` (currently only TBJ-FL)
3. Zero service names containing `(tax-free)` or `(tax free)` suffix
4. `Extended Day Labor` present, **case-EXACT** (`service.includes("Extended Day Labor")` - see §8 gotcha #2)
5. `TBR - FL` / `Boys & Girls Club` / `B&G Lunch` `is_tax_free = true`

### 2.2 `scripts/build-four-way-audit.py` - Stage-3 certification harness

Cross-joins Signed / PG / AccountFile / Workbook -> emits `STAGE3_CERTIFICATION_AUDIT.md` to `~/Downloads/`.

**Prereq:** fresh `/tmp/pg_prices.json` from 2.1.

**Run:**
```sh
python3 scripts/build-four-way-audit.py
```

**Env override:** `KF_REPO_ROOT=~/dev/kitchfix-intranet` if you need to point at the other worktree.

**Group-synonym fuzzy join** in `GROUP_SYN` dict + `_strip_paren()` helper handles the impedance mismatch between:
- Signed sheet: `Major League`, `Minor League`, `Single A Jays`, `MLB - PDC`
- AccountFile §2b: `MLB`, `MiLB`, `FSL`, `MLB (Spring Training only)`, `Palm Beach Cardinals`
- Workbooks: no group field at all (positional inference only)

**Verdict class vocabulary** (in order of severity):
- `PG-FAIL` - real PG != Signed; blocks certification
- `SIGNED-STALE-STAGE1` - Kevin's directive moved PG ahead of signed (e.g. Media Meals $16); signed sheet needs v4 refresh; **PG correct**
- `SIGNED-NO-PRICE` - signed cell literally `NEEDS PRICE` (e.g. STL-FL MiLB Snack); excluded from cert denominator
- `PG-drift-fee` - fee account with non-zero PG
- `DOC-DRIFT` - AccountFile != Signed
- `WB-EXP-DIV` - Workbook != Signed (retired-authority, catalogued not fixed)
- `N/A-fee` - fee account, PG correctly $0
- `ALL-MATCH` - all four sources agree

**Re-run triggers:** any Studio price apply, any admin panel edit, any signed-sheet refresh, any account-file §2b change. Basically re-run whenever PRICE_BOOK regenerates (§2.3).

### 2.3 `scripts/generate-price-book.mjs` - Price Book emitter

**Default output:** `<repo>/docs/pricing-summit/PRICE_BOOK.md`. `--downloads` flag routes to `~/Downloads/PRICE_BOOK.md` for review builds.

Per-account header static-config (money shape / 2026 fee / escalation / notes) is hand-maintained in the `ACCOUNTS[]` array inside the script; every value is cross-cited to `docs/pricing-summit/accounts/ACCOUNT_<KEY>.md` §2. **When finance figures change, update `ACCOUNTS[]` AND cross-check against the account file first. If they disagree, STOP and report** (that discipline caught me a real inconsistency this session).

Per-account service tables come from PG only (no hardcoded rates).

Unit-ish column is heuristic (`deriveUnit()`): PG has no `unit` column, so infer from `is_flat_fee` + service-name pattern (`coffee|fountain|bev` -> per-week, `extra protein` -> per-pan, `mto` -> per-order, `extended day labor` -> per-day, default -> per-meal).

### 2.4 Legacy scripts worth knowing

**`scripts/_audit_sc_prices_vs_v3final.mjs`** - my direct predecessor. Same pattern (Supabase read + xlsx compare) but:
- Points at an older signed file location: `~/Downloads/KitchFix_Service_Calendar_Price_Review_v3_FINAL (1).xlsx` (note the ` (1)` suffix).
- Emits stdout diff table only; no JSON snapshot.
- Uses Python-inline `openpyxl` via `execFileSync("python3", ["-c", helperPy, ...])` because the Node xlsx libs are unreliable on Excel calc cells.

Kept for reference. When Kevin retires it, `git rm scripts/_audit_sc_prices_vs_v3final.mjs` is fine.

**Other `scripts/_*` files** are single-shot probes from earlier sessions (each documented in its own header). Notable ones: `_probe_pricing_summit_pg_dump.mjs` (schema exploration), `_seed_sc_from_xlsx.mjs` (the seed importer with the 2026-06-16 correction preservation `ignoreDuplicates: true`). Do not delete; historical value.

### 2.5 `/tmp` artifacts: what's one-shot vs persistent

| Path | Kind | Regenerate how |
|---|---|---|
| `/tmp/pg_prices.json` | **Ephemeral** but re-created every session | `node scripts/audit-sc-prices.mjs --out /tmp/pg_prices.json` |
| `/tmp/build_four_way.py` | **One-shot** dev scratchpad; superseded by `scripts/build-four-way-audit.py` | Delete on cleanup |
| `/tmp/signed_dump.txt` | **One-shot** grep dump of signed workbook rows | Re-run the inline Python if needed |
| `/tmp/_v3final_prices.json` | **One-shot** helper for the legacy audit | Ignore |

**Rule of thumb:** anything in `/tmp` is fair game to delete between sessions. Nothing depends on it long-term.

---

## 3. Data-source paths on Kevin's machine

**Everything under** `/Users/kevinfietek/Documents/Claude /` (note the trailing space in the folder name - `Claude ` not `Claude`).

### 3.1 Signed price authority

`~/Documents/Claude /Service Calendars/KitchFix_Service_Calendar_Price_Review_v3_FINAL.xlsx`
- Tab: `Service Price Review`
- Columns: A=Account Key, B=Group, C=Service, D=Full Rate (incl SF), **E=Billing Price** (P-1 authority), F=Unit, G=Flags
- 105 rows as of 2026-07-17
- Kevin regenerates this on Joe Lessard's attestation; refresh = v4 lands with the Media Meals $16 + STL-FL MiLB Snack decisions

### 3.2 Per-account SC workbooks (11 files)

Same folder, `~/Documents/Claude /Service Calendars/`:
- `REDS AZ - Service Calendar 2026 (4).xlsx` (CIN-AZ)
- `Louisville Bats Service Calendar - 2026 (2).xlsx` (CIN-KY)
- `Cincinnati Reds MLB Service Calendar - 2026 (2).xlsx` (CIN-OH)
- `STL - Jupiter, FL - Service Calendar - 2026 (4).xlsx` (STL-FL)
- `St. Louis Cardinals MLB - Service Calendar - 2026 (3).xlsx` (STL-MO)
- `TBJ FL - Service Calendar - 2026 (4).xlsx` (TBJ-FL)
- `TBJ BUF - Service Calendar - 2026 (1).xlsx` (TBJ-NY)
- `Tampa Bay Rays Service Calendar - 2026 (3).xlsx` (TBR-FL)
- `TXR AZ - Service Calendar - 2026 (4).xlsx` (TXR-AZ)
- `Texas Rangers MLB - Home - Service Calendar - 2026 (2).xlsx` (TXR-TX-H)
- `Texas Rangers MLB - Visitors - Service Calendar - 2026 (2).xlsx` (TXR-TX-V)

Layout per `docs/SC_SPREADSHEET_MAPPING.md`. Tab naming is inconsistent - substring-match `"Projec"` / `"Actual"` on `wb.sheetnames`. See §8 gotcha #6.

### 3.3 Contracts folder

`~/Documents/Claude /Contracts/<KEY>/` (e.g. `~/Documents/Claude /Contracts/CIN AZ/`, `~/Documents/Claude /Contracts/CINN/`). Naming is inconsistent - CIN-OH is under `Contracts/CINN/`, TBR-FL under `TBR/`, etc. Match by inspection.

**Prefer DOCX over PDF for text extraction** - many PDFs are scanned images and `pdftotext` returns nothing (32 bytes on the Reds AZ 2023 PDF; DOCX sibling extracts cleanly via `python-docx`).

### 3.4 Client invoices folder

`~/Documents/Claude /Client Invoices/` (plus per-account subfolders `CIN OH Invoices/`, `STL FL Invoices/`, `STL MO Invoices/`, and `Invoices for review/`).

Invoice IDs are the `K300168xxx` sequence. When digests cite an invoice (e.g. `K300168587`, `K300168736`), you can spot-check the PDF there.

### 3.5 Finance schedule (ground truth for SF amounts)

**`~/Downloads/PFS Service Fees 2026.xlsx`** - finance-owned. Two tabs:
- `Accrual Schedule - 2026` - per-account 13-period revenue-recognition vector + `Total Billed` + `Total Service Fee` + `Difference` + AR aging columns. **This is what caught the STL-FL R25 bug** (§8 gotcha #3).
- `Billing Schedule - 2026` - installment-level (send date, due date, amount, invoice #, JE #).

Cross-links between the two tabs via `Total Billed` = SUM(installments); the `Difference` column flags AR drift.

### 3.6 Downloads-as-exchange convention

`~/Downloads/` is the two-way exchange:
- **Kevin -> CC:** finance xlsx, contract drops, screenshot batches, revised signed sheets.
- **CC -> Kevin:** audit reports, price books, handoff briefs.
- Once Kevin acts on a Downloads file, it either moves to the repo (`docs/pricing-summit/`, `scripts/`) or gets archived to a per-topic folder in `~/Documents/Claude /Claude Outputs/`.
- **CC does NOT delete Downloads files.** Kevin owns cleanup there.

Files currently in `~/Downloads/` as of this handoff:
- `STAGE3_CERTIFICATION_AUDIT.md`
- `ESCALATION_VERIFICATION_REPORT.md`
- `PRICE_BOOK.md` (review copy; canonical lives at `docs/pricing-summit/PRICE_BOOK.md`)
- `CC_HANDOFF_STAGE4.md` (this file)
- `PFS Service Fees 2026.xlsx` (finance input)

---

## 4. External-data patterns

### 4.1 BLS API (Consumer Price Index)

**Series I used this arc:**
- `CUUR0000SEFV` - CPI-U Food Away from Home (parent, NSA, U.S. City Average). Base 1982-84 = 100.
- `CUUR0000SEFV01` - CPI-U Full Service Meals and Snacks (sub-index of the above).

**Fetch pattern (no auth needed for basic use):**
```
https://api.bls.gov/publicAPI/v2/timeseries/data/CUUR0000SEFV
https://api.bls.gov/publicAPI/v2/timeseries/data/CUUR0000SEFV?startyear=2022&endyear=2023
```

Use the `WebFetch` tool with a prompt like: *"Return monthly index values for series X; especially Aug/Oct/Nov/Dec of each year 2022-2025; format as year, month, value."* WebFetch caches for 15 minutes, so consecutive calls to the same URL are cheap.

**Rate limits:** unregistered API v2 = 25 queries/day per IP, 25 series per query, 10 years max per query. Registered (free key) = 500 queries/day, 50 series, 20 years. This arc never hit the limit; if you go over, back off ~1s between calls or ask Kevin to register a key.

**Retries:** BLS occasionally 429s. Simple retry loop with 1-2 second backoff is enough; do not hammer.

**BLS Oct 2025 gap.** BLS reports **`"Data unavailable due to the 2025 lapse in appropriations"`** for Oct 2025 on both series. Permanent - the survey wasn't collected. For 2026-cert this only bites CIN-AZ (Oct-basis clause, already NEGOTIATED so no impact). For 2027-cert this affects any Oct-basis account. Document explicitly if you hit it.

### 4.2 GitHub CLI (`gh`)

Standard: `gh pr create`, `gh pr view`, `gh api`, `gh pr comment`. Kevin uses branch-protection via a ruleset (id `16364953`, name `main protection`) - the classic `/branches/main/protection` API 404s. Query with `gh api repos/{owner}/{repo}/rulesets`.

Migration-gated PRs need Kevin to comment `applied in Studio: YES` before the gate flips green. Do NOT flip a draft PR to ready-for-review yourself if it touches `docs/migrations/*.sql` - wait for Kevin.

---

## 5. Supabase access pattern

### 5.1 Client setup (all three scripts use this)

```js
import { createClient } from "@supabase/supabase-js";
const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
```

Service-role key is fine for read probes. **Do not do writes** - Kevin applies migrations via Studio.

### 5.2 Tables + joins that matter

**`accounts`**
- PK: `team_key` **spaced-hyphen** (`"CIN - AZ"`, `"TXR - TX - H"`, `"CIN - OH"`). A stripped-key comparison silently returns zero rows. `.eq("account_key", "CIN - AZ")` - do not `trim` or `replace(/\s/g, "")`.
- Fields to read: `team_key`, `name`, `level`, `billing_model` (`actuals_drive_invoice` | `flat_fee`), `active`.

**`sc_service_groups`**
- Soft-delete: always `.is("deleted_at", null)`.
- `active_until` (DATE, nullable) - when set, group is archived through that date.

**`sc_services`**
- Soft-delete: `.is("deleted_at", null)`.
- Flags: `is_flat_fee`, `is_non_revenue`, `is_tax_free`, `active` (bool), `active_until` (DATE).
- **Three-way active semantics** (per `docs/migrations/sc-6a-catalog-active-until.sql`):
  - `active=true, active_until=null` -> currently active.
  - `active=true, active_until=X` -> active through X (the "real" archive mechanism post-sc-6a).
  - `active=false` -> **legacy** deactivation. Still respected but sc-6a promoted `active_until` as canonical.
- **TBJ - NY Snack + Shake are deactivated via legacy `active=false`, not `active_until`.** This is a mechanism-drift item Kevin flagged (see §7 queue).

**`sc_service_prices`**
- No unique constraint per service. Multiple rows differentiated by `(service_id, effective_date, price_kind)`.
- `price_kind` in `{"projected", "actual"}`. **After sc-8c, there are ZERO `actual` rows in production** - the view falls back to `projected`. My scripts assume `projected` is the live price.
- Latest-per-service pattern:
  ```
  .from("sc_service_prices")
    .select("service_id, price, effective_date, price_kind")
    .in("service_id", svcIds)
    .order("effective_date", { ascending: false })
    .range(from, from + 999)
  ```
  Then reduce to `latestByKey` keyed by `service_id::price_kind`.
- **Pagination:** cap 1000 rows per query; `sc_service_prices` has 161 rows as of 2026-07-17 but paginate defensively.

**`sc_fee_schedule`** (the flat-fee accounts' revenue truth)
- Fields: `account_key`, `amount`, `effective_date`, `cadence` (`annual` / `monthly-6` / `quarterly` / etc.).
- Rows for CIN-OH, STL-MO, STL-FL, TXR-TX-H, TXR-TX-V.
- **PG-carries-escalated migration ran 2026-07-16** (Kevin ruling): CIN-OH `$362,500 -> $376,686`; STL-MO `$473,000 -> $489,497`. STL-FL held flat at `$1,400,000`. TXR-TX-H stays `$604,032` (no escalator). TXR-TX-V is `$0` with `covered_by_account_key = "TXR - TX - H"`.
- **This table is NOT included in `audit-sc-prices.mjs` output.** If you need to verify flat-fee amounts, add a separate query. Per-service `sc_services` rows for fee accounts all carry `projected_price = $0` by design.

### 5.3 No unit column on `sc_services`

If you need unit info: infer from name + flags (see `deriveUnit()` in `generate-price-book.mjs`), or read the signed workbook's F column (`"per meal"`, `"per week"`, `"per pan ordered"`, `"per day"`, `"per order"`, `"annual"`).

---

## 6. PR / Git workflow

### 6.1 The rules

- **Never `git push origin main`.** Main is ruleset-protected + you'd catch a merge-not-allowed error even as admin.
- **Never merge your own PR.** Push branch, open PR, drop the URL in chat, wait for Kevin.
- **Never skip hooks** (`--no-verify`, `--no-gpg-sign`, `-c commit.gpgsign=false`) unless Kevin explicitly asks.
- **Never write to `.env*`.**
- Migration-gated PRs open as DRAFT until Kevin comments `applied in Studio: YES`.

### 6.2 Commit-message conventions from this arc

Terse, lowercase, imperative. **Do NOT** impose Conventional Commits. Recent examples that match the voice:

- `docs: batch cleanup - archive sweep, canonical banners, MONEY_MODEL reconciliation (pre-certification)`
- `docs: PR #447 review fixups - BGC link, TBJ-FL SF annotation, defer STL-FL vector transcription pending R25 reconciliation`
- `docs: STL-FL P&L vector - restore from finance source, appendix R25 was missing P1 cell`
- `docs: A-9/D-3 REVERSED annotations - CONFLICT_REGISTER + LEDGER (surgical, no re-copy)`

Multi-line bodies with numbered sections + `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer. **No em-dashes anywhere** (memory rule `[[feedback_no_em_dashes]]`; use `-` or `—>-`).

### 6.3 The clean-append ledger verification block

When editing `docs/pricing-summit/LEDGER.md` or `CONFLICT_REGISTER.md` (see §6.4 for the surgical-edit precedent), verify no line-count growth for pure annotations:

```sh
git diff --numstat docs/pricing-summit/LEDGER.md
# expect "N N path" where the two Ns are equal (in-line append = N insertions + N deletions,
# net line-count change = 0). For LEDGER surgery this session: "3 3 docs/pricing-summit/LEDGER.md".

git diff --stat docs/pricing-summit/LEDGER.md docs/pricing-summit/CONFLICT_REGISTER.md
# expect symmetric insertions/deletions on ledger, +N/-0 (new bullets) on register.
```

If `numstat` shows `M N path` where `M != N` on a supposed in-line edit, you accidentally added or removed a line. Revert and try again.

### 6.4 Surgical-edit precedent (PR #443)

**Rule Kevin established via PR #443, enforced in PR #447:** for annotations to LEDGER entries, **append inline to the existing line** rather than adding new bullets. Preserves the ledger's linear history and its line-count stability.

Example (LEDGER §Q A-9/D-3 row):
```markdown
- **A-9 / D-3** → GOTCHAS stale (STL-FL P1 = $171,367 not $45,553; peak P2). Doc-fix, batched. [REVERSED 2026-07-17 — see CONFLICT_REGISTER A-9; GOTCHAS was right, appendix R25 was the artifact]
```
The bracketed appendix rides the same line. `numstat` shows `1 1 LEDGER.md` for that edit (net +0).

**For CONFLICT_REGISTER,** Kevin's rule differs: **do NOT delete original text - append a new bullet below.** So CONFLICT_REGISTER edits show `+N/-0` in numstat. The register captures discovery history; ledger captures current state - different treatment.

### 6.5 gh commands I actually used

```sh
gh pr create --title "..." --body "$(cat <<'EOF' ... EOF)"
gh pr view 447
gh api repos/KitchFix-Intranet/kitchfix-intranet/pulls/447/comments
```

---

## 7. Running state + queue

### 7.1 Certification state (done)

- **Stage-1 gate: 5/5 PASS** (CIN-AZ Breakfast $20.31, Media Meals $16, no `(tax-free)` suffixes, `Extended Day Labor` case-exact, BGC `is_tax_free=TRUE`).
- **Escalation-verification pass: LAYER-D GREEN** (`~/Downloads/ESCALATION_VERIFICATION_REPORT.md`). 4 formula-consistent, 2 negotiated-override (Kevin-attested), 5 no-formula.
- **Stage-3 four-way certification: CERTIFIED (with catalogued signed-side notes)** (`~/Downloads/STAGE3_CERTIFICATION_AUDIT.md`). 103/105 PG=Signed at 2dp; 0 real failures; 1 SIGNED-STALE-STAGE1 (Media Meals); 1 SIGNED-NO-PRICE (STL-FL MiLB Snack).
- **PRICE_BOOK generated** at `<repo>/docs/pricing-summit/PRICE_BOOK.md` (canonical) + `~/Downloads/PRICE_BOOK.md` (review). Header static-config updated to 2026 finance-confirmed figures per Kevin's cross-check.

### 7.2 In flight (queue)

**The phase-docs commit PR (next thing Kevin queues).** Expected contents:
- `docs/pricing-summit/PRICE_BOOK.md` (currently untracked - already at correct path)
- `docs/pricing-summit/HANDOFF_STAGE4.md` (chat side, from `~/Downloads/HANDOFF_STAGE4.md`)
- `docs/pricing-summit/CC_HANDOFF_STAGE4.md` (this file, from `~/Downloads/CC_HANDOFF_STAGE4.md`)
- `docs/pricing-summit/STAGE3_CERTIFICATION_AUDIT.md` (from `~/Downloads/`)
- `docs/pricing-summit/ESCALATION_VERIFICATION_REPORT.md` (from `~/Downloads/`)
- `scripts/audit-sc-prices.mjs` (currently untracked)
- `scripts/build-four-way-audit.py` (currently untracked)
- `scripts/generate-price-book.mjs` (currently untracked)

Suggested branch name: `docs/pricing-summit-phase-4-handoff` or similar. **Do not open this PR proactively** - Kevin drives.

**Signed-v4 two-cell queue** (Kevin edits the signed workbook manually):
1. `TBJ - FL` / `Other` / `Media Meals` - `Billing Price` `$15.00` -> `$16.00` (matches Kevin's Stage-1 directive in PG).
2. `STL - FL` / `MiLB` / `Snack` - `Billing Price` currently literal string `"NEEDS PRICE"`. Decide: `$0` (fee-account reference) or strike the row.

After v4 lands, re-run `python3 scripts/build-four-way-audit.py` and confirm `SIGNED-STALE-STAGE1 = 0` and `SIGNED-NO-PRICE = 0` in the new audit.

**Optional TBJ-NY admin re-archive:**
`TBJ - NY / Buffalo Bisons / Snack` and `.../Shake` are deactivated via legacy `active=false` (not `active_until`). Kevin flagged this as a mechanism-drift item during my A5 probe. Non-urgent - the services ARE hidden from the calendar - but for schema hygiene, re-archive via the SC admin panel's `active_until` flow so both rows carry a date rather than the legacy boolean. Low priority; note it, don't block on it.

**C-17: CLOSED (Kevin ruling, 2026-07-17).** Operational reality supersedes the 2023 clause: each year KitchFix provides a meal projection billed at the post-SF rate as a FLOOR — under-attendance still bills the full projection; over-attendance stays at post-SF (no step-up). 2023 language + 72,890 count are outdated. No PG change, no Joe question, do not reopen. Full ruling: LEDGER 2026-07-17 appends.

### 7.3 What Stage-4 needs from you first

Stage 4 = SC price-display design + build. The design loop is screenshot-driven from the fresh chat. Your job initially:
- Keep the certification harness runnable (§2.1-2.3) so any Studio price change is verifiable in <2 minutes.
- Regenerate `PRICE_BOOK.md` whenever prices change (design docs may cite it).
- Read the Stage-4 design brief in chat's `HANDOFF_STAGE4.md` before touching UI code.

---

## 8. Gotchas / lessons (MY tripwires this arc)

1. **Each `Bash` tool call is a fresh shell.** `set -a && source .env.local && set +a` in call N does NOT set env for call N+1. Symptom: `TypeError: Cannot read properties of undefined (reading 'from')` or auth 401 on Supabase. **Fix:** chain the source + node command in the SAME tool call. Zombie shell state does not exist here.

2. **Case-lenient smoke check masked a rename gap.** My first `Extended Day Labor` smoke check was `normalize(svc).includes("extended day labor")` - which passed against `"Extended Day labor"` (lowercase L). Kevin caught it. **Rule:** rename gates MUST be case-EXACT - the whole point is to detect capitalization drift.

3. **PL_2026_APPENDIX R25 had a silent off-by-one that survived to production.** The STL-FL row had 12 numeric cells under a 13-column P1..P13 header (missing P1=$45,553). The prose vector at §Q3 in the same file matched the broken table. LEDGER, CONFLICT_REGISTER, and BILLING_TERMS_MATRIX all cited that broken vector. I "corrected" GOTCHAS + MONEY_MODEL to match the broken appendix; Kevin caught the sum ($1,354,446 vs stated $1,400,000) and handed me the finance source. **Rule:** if you re-derive a per-period vector against a source, **verify the sum before writing corrections downstream.** Trust arithmetic over prose that says "EXACT."

4. **PDF vs DOCX for contracts.** `pdftotext -layout` returned 32 bytes on the Reds AZ 2023 PDF (scanned image). Same content in the sibling DOCX extracted cleanly via `python-docx`. **Rule:** for contract folders, try DOCX first; fall back to PDF only if no DOCX exists.

5. **Doc-cleanup worktree cannot execute Node.** `~/dev/kitchfix-doc-cleanup/` has no `node_modules`. Placing `scripts/audit-sc-prices.mjs` there and running gave `ERR_MODULE_NOT_FOUND` for `@supabase/supabase-js`. **Rule:** persistent scripts live in `~/dev/kf-cell-states/scripts/` (executable). Copy or worktree-share to other branches; do not split.

6. **Openpyxl quirks in the 11 SC workbooks:**
   - **Tab-name trailing spaces exist** (e.g. `'Cincinnati Reds - MLB - 2026 - '`). String-exact `wb.sheetnames.includes(name)` misses them; substring-match on `"Projec"` / `"Actual"` instead.
   - **Row 2 alternates `(service_name, price, service_name, price, ...)`** after metadata columns A-E. **Group is NOT in row 2** - it lives in `docs/SC_SPREADSHEET_MAPPING.md` per-column-letter.
   - **Some workbooks have `Sheet1` / `Sheet2` empty duplicates** (CIN-OH `Sheet1`, TXR-TX-H `Sheet1` + `Sheet2`). Skip them.
   - **`data_only=True` is required** to get calculated cell values; without it, formula-driven cells return the formula string, not the number.
   - **Some workbooks have TWO Projections tabs** (STL-FL: `Jupiter - 2026 - Projections` + `Jupiter - 2026 - Projections Br`). Match the primary by exact substring or pick the first.

7. **Kevin's directives can outrun the signed sheet.** Media Meals `$15` signed -> `$16` PG per Kevin's Stage-1 directive. PG != Signed here is INTENTIONAL. My four-way audit classifies as `SIGNED-STALE-STAGE1` (green), not `PG-FAIL` (red). **Rule:** before flagging any PG-vs-Signed mismatch as failure, check Kevin's most recent directive. The `stage1_stale` guard in `build-four-way-audit.py` needs extension when new directives land.

8. **"NEEDS PRICE" signed cells are LITERAL STRINGS.** `STL - FL / MiLB / Snack` has `"NEEDS PRICE"` in column E. Numeric compare crashes. **Rule:** always type-check signed values before arithmetic. Non-numeric cells are catalog-completeness markers, not failures.

9. **Two Cincinnati Reds contracts, two different escalators, two different worktree quirks.** CIN-AZ (2023 agreement) uses `Oct 2%/5%` on parent Food-Away. CIN-OH (2025-26 agreement) uses `Aug 1%/4%` on the same parent + BASE-JUMP to `$362,500` (NOT `$357,500`-carried-forward). Same team, different accounts, different clauses. **Rule:** never assume Reds-account escalation from another Reds account.

10. **BLS Oct 2025 shutdown gap is real and permanent.** Not backfilled - the survey wasn't collected. Any Oct-basis clause has a permanent CPI-value gap. Currently only bites CIN-AZ (NEGOTIATED). Note this in any future escalation report touching Oct.

11. **Group naming impedance mismatch across all four sources.** Signed = `Major League` / `Minor League` / `Single A Jays`. AccountFile §2b = `MLB` / `MiLB` / `FSL` / `MLB (Spring Training only)`. Workbook = no group at all. `GROUP_SYN` dict + `_strip_paren()` in `build-four-way-audit.py` handles the common cases; extend the dict rather than patching case-by-case logic when new groups appear.

12. **Worktree `cd` habits.** I bounced between `~/dev/kitchfix-doc-cleanup/` (edits), `~/dev/kf-cell-states/` (execution), and `~/dev/kitchfix-intranet/` (validation) more than needed. **Rule:** prefer absolute paths in tool calls; only `cd` when a command genuinely needs cwd (git operations, npm scripts). Keeps the log readable and avoids "wait, which worktree am I in?" errors.

13. **The `~/Documents/Claude ` folder name has a trailing space.** Do not strip it; quote it in shell commands (`"/Users/kevinfietek/Documents/Claude /Service Calendars/..."`). Trailing space is intentional and must be preserved.

14. **`Bash(cat ...)` for large files hits output truncation.** Prefer `Read` (paginated) or `head` / `tail` / `grep -n` for narrow snippets. `wc -l` first if you're not sure how big.

---

## 9. First-contact protocol (successor CC + fresh chat)

**The successor chat's opening move.** The chat side has empty file quota + fresh context. Suggested first-contact template chat can drop verbatim:

> "Aligning on execution env before Stage 4 work. Please verify:
> 1. Worktree + branch (`pwd && git status && git branch --show-current`).
> 2. `origin/main` position (`git fetch origin && git log origin/main --oneline -3`).
> 3. Stage-1 gate (`cd ~/dev/kf-cell-states && set -a && source .env.local && set +a && node scripts/audit-sc-prices.mjs --smoke`) - expect 5/5 PASS.
> 4. Certification state - read `docs/pricing-summit/STAGE3_CERTIFICATION_AUDIT.md` §1 scorecard.
> 5. Confirm 3 script files are present at `~/dev/kf-cell-states/scripts/` (`audit-sc-prices.mjs`, `build-four-way-audit.py`, `generate-price-book.mjs`).
> Once verified, we start Stage 4 from `HANDOFF_STAGE4.md` (chat side) + `CC_HANDOFF_STAGE4.md` (this doc's companion)."

**Your response pattern to first contact:**

1. Run all five verifications in one message. Report clean/dirty state per item.
2. If any script or file is missing (e.g. because the phase-docs PR hasn't landed yet), locate it in `~/Downloads/` or `~/dev/kf-cell-states/scripts/` (untracked) and state where it is.
3. If smoke fails, DO NOT re-fix anything. Report the failure, ask Kevin to verify Studio state. Certification is fresh (2026-07-17) and should still hold.
4. If worktree is on the wrong branch, offer the `git fetch && checkout main && pull` sequence but wait for confirmation before running.
5. State understanding of the Stage-4 brief from the chat handoff and wait for direction.

**If Kevin joins the chat mid-first-contact and skips the verification handshake:** run the verifications quietly in the background of your first substantive response ("running the standard cold-start checks in parallel: ... 5/5 PASS on smoke, worktree on X branch, main is Y commits ahead"). Do not block work.

**If Kevin points you at a broken audit / stale price book:** the fix pattern is always the same three-command chain -
```sh
set -a && source .env.local && set +a
node scripts/audit-sc-prices.mjs --out /tmp/pg_prices.json
python3 scripts/build-four-way-audit.py
node scripts/generate-price-book.mjs
```
- fresh PG -> fresh audit -> fresh book. Do this before diagnosing anything else.

---

**End of handoff. Rides the phase-docs PR into `docs/pricing-summit/CC_HANDOFF_STAGE4.md` alongside chat's `HANDOFF_STAGE4.md`. Good luck to Stage-4 CC.**
