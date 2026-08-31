# PURCHASING P0b - Rippling Spend API spike (paths 1 + 2 + path 6 pre-check)

Date run: 2026-08-18
Executor: CC (Opus 4.7, 1M context)
Environment: `~/dev/li-audit-2026-08-17/kitchfix-intranet` off `origin/main`, doc-only branch
Auth: `RIPPLING_API_KEY` from `/Users/kevinfietek/dev/kitchfix-intranet/.env.local` loaded via `--env-file`
Client shape: matches `src/lib/rippling.js` (BASE `https://rest.ripplingapis.com`, Bearer, `X-Rippling-Api-Version: 2024-08-01`)
Total HTTP requests: 111 (69 initial probe + 36 refined probe + 6 targeted follow-ups)

Plan file: [PURCHASING_P0_RIPPLING_SPEND_SPIKE_PLAN.md](./PURCHASING_P0_RIPPLING_SPEND_SPIKE_PLAN.md) (verbatim from Kevin)
Companion note: [PURCHASING_P0_RIPPLING_SPEND_EMAIL_LANE.md](./PURCHASING_P0_RIPPLING_SPEND_EMAIL_LANE.md) (path 4a design, runs regardless of spike outcome)

---

## VERDICT

**B (split, actionable)** - Spend data IS reachable on the API surface we already have. `spend_transaction_line_item_zo` returns rich per-line-item records carrying amount, category, department, work_location, gl_billable, gl_customer, and a foreign-key to the parent transaction. HOWEVER the parent object `spend_transaction_zo` currently returns HTTP 400 on every records fetch due to a **Rippling-side model bug** (server exception: `Field with name purchase_location not found in model <class 'hub_platform.custom_objects.models.CustomObjectDataRow'>`). Same class of bug hits `spend_txn_mileage_segment_zo` (`address` field) and `spend_txn_attachment_zo` (500).

This is NOT the token-scope kind of B (Kevin can't fix it in admin); this is a Rippling ENG bug on their custom-objects reflection layer. Path forward: file a Rippling ticket citing the exact error and object name; in the interim we already have enough data to build a working sync via line items (which include amounts, dates, GL-relevant fields, department, and work_location). The `spend_transaction_zo` FK gives us the merchant `display_value` per-transaction denormalized on every line item ("American Airlines", "Amazon", "Sam's Club", "HALL Arts Hotel", "SWA PREMSEAT", "Wawa", "Southwest Airlines", "Shamrock Foods" all observed).

**Recommendation**: pursue BOTH lanes in parallel - the line-item sync (works today, unblocked) AND the path-4a scheduled-report email lane (unblocked, retires this whole spike if Rippling doesn't fix the API bug quickly).

---

## PATH 1 - custom-object discovery

### Total objects listed: **35**

Discovery endpoint: `GET /custom-objects` returned 200 on the first try. No cursor follow-on (the response fit in one page - all 35 objects returned in the initial `results` array).

Full 35-object list is in [Appendix A](#appendix-a-full-custom-object-list).

The list surface exposes both `name` (a template string like `zobject_generated.zo_model.spend_transaction_zo.display_name`) and `api_name` (the actual URL slug, e.g. `spend_transaction_zo`). The api_name is what you use to fetch schema (`/custom-objects/{api_name}`) and records (`/custom-objects/{api_name}/records`). **Using the `name` field returns 404 on every follow-on** - this was a first-pass dead end that the second probe corrected.

### Spend-related objects: **17** (all in category `spend_management`)

| api_name | fetchable? | recordCount (limit=3) | notes |
|---|---|---|---|
| `spend_transaction_zo` | **NO (400)** | - | server bug: `Field with name purchase_location not found` |
| `spend_transaction_line_item_zo` | **YES (200)** | 3 | rich shape - amount, category, department, work_location, gl_billable, gl_customer, FK to spend_transaction |
| `spend_line_item_scanned_tax_amount_zo` | YES (200) | 3 | amount + FK to line_item |
| `spend_transaction_line_item_tax_zo` | YES (200) | 0 | empty for this tenant |
| `spend_policy_eval_result_zo` | YES (200) | 3 | result_type, result_category, FK to spend_transaction (carries merchant display_value) |
| `spend_txn_anomaly_reason_zo` | YES (200) | 3 | rule_type, kind, FK to spend_transaction |
| `spend_txn_attachment_zo` | **NO (500)** | - | server error 500 HTML page |
| `spend_txn_comment_rel_zo` | YES (200) | 3 | comment id + FK to spend_transaction (merchant "Amazon" observed) |
| `spend_txn_dimension_choice_rel_zo` | YES (200) | 3 | relation_kind, FK to spend_transaction (merchant "Wawa" observed) |
| `spend_txn_duplicate_rel_zo` | YES (200) | 3 | potential_duplicate_transaction id + FK to spend_transaction |
| `spend_txn_employee_rel_zo` | YES (200) | 3 | employee ref (with display_value + image signed URL), relation_kind = "Approving Role" |
| `spend_txn_form_rel_zo` | YES (200) | 0 | empty |
| `spend_txn_gl_sync_failure_context_zo` | YES (200) | 0 | empty (see path 6) |
| `spend_txn_mileage_segment_zo` | **NO (400)** | - | server bug: `Field with name address not found` |
| `spend_txn_needed_dimension_rel_zo` | YES (200) | 0 | empty |
| `spend_txn_per_diem_line_item_zo` | YES (200) | 0 | empty |
| `spend_txn_third_party_attendee_rel_zo` | YES (200) | 2 | relation_kind = "Third Party Attendee", FK to spend_transaction (merchant "Southwest Airlines" observed) |

### The four yes/no answers (for `spend_transaction_line_item_zo` - the reachable spend object)

The main `spend_transaction_zo` is not fetchable, but line items are and carry enough to build the board.

| Question | Answer | Evidence |
|---|---|---|
| **(a) GL account or category field?** | **YES** - `category` (string id like `65aad3b6ecda651e1c45f971`), plus `gl_billable` (bool, null in sample) and `gl_customer` (nullable ref) | firstRowKeys include: `category`, `gl_billable`, `gl_customer` |
| **(b) department / entity / work_location field we could map to a site?** | **YES** - both `department` (nested: `{ id, display_value }` - sample: `"5004.6 - CORP HR"`) and `work_location` (nested: `{ id, display_value }` - sample: `"Remote"`) | Line items land tagged with a real department code AND a work location. |
| **(c) status field (pending / posted / approved)?** | **NO on line item directly** - line items have no status field. Approval/status likely lives on the parent `spend_transaction_zo` (blocked by the API bug). Adjacent evidence: `spend_txn_employee_rel_zo` records have `relation_kind: "Approving Role"` and `spend_txn_anomaly_reason_zo` has `kind: "APPROVAL"` - the approval graph exists, just not on the line item. |
| **(d) receipt or memo field?** | **PARTIAL** - line item has `embedded_document_id` (null in sample) and `spend_txn_attachment_zo` exists (currently 500-broken). Memos likely live on the parent transaction. `spend_policy_eval_result_zo` records include `result_type: "require_receipt"` - the receipt-required flag is visible via policy eval even if the attachment fetch is broken. |

### Sample record - `spend_transaction_line_item_zo` (redacted)

Amounts, dates, merchants, GL fields, departments, work_location kept intact per the redaction rules. `name` field redacted (contains cardholder or memo text).

```json
{
  "id": "019fcea0-075c-7ca9-8b4a-79f3317a9364",
  "updated_at": "2026-08-07T18:23:27.714Z",
  "amount": { "currency_type": "USD", "value": "311.40" },
  "category": "65aad3b6ecda651e1c45f971",
  "created_at": "2026-08-04T21:13:41.944Z",
  "created_by": null,
  "department": { "id": "5c338afbc592917819e89219", "display_value": "5004.6 - CORP HR" },
  "discount": null,
  "embedded_document_id": null,
  "external_id": "6a6c093207bd8eb94ef93ca4__line_item_content_65aad3b6ecda651e1c45f971_311_40_no_dimensions",
  "gl_billable": null,
  "gl_customer": null,
  "last_modified_by": null,
  "name": "[REDACTED_PII]",
  "normalized_amount": null,
  "owner_role": null,
  "price": null,
  "purchase_type": null,
  "quantity": null,
  "quantity_unit_of_measure": null,
  "scanned_tax_amount": null,
  "spend_transaction": {
    "id": "019fcea0-060e-71b5-b221-20ecbbe4a825",
    "has_perm": true,
    "display_value": "American Airlines"
  },
  "system_updated_at": "2026-08-07T18:23:27.714Z",
  "tax_amount": null,
  "term": null,
  "term_unit_of_measure": null,
  "work_location": { "id": "68814132e69bbd42ff431fd9", "display_value": "Remote" }
}
```

Observation: the FK to `spend_transaction` carries `display_value` = merchant name (denormalized). Even without the parent object being fetchable, we get the merchant free on every line item.

### Sample record - `spend_transaction_zo` request (BLOCKED)

Every variant of the records fetch returned HTTP 400 with the same body:

```
{"detail":"Field with name purchase_location not found in model <class 'hub_platform.custom_objects.models.CustomObjectDataRow'>."}
```

Variants attempted (all 400):
- `/custom-objects/spend_transaction_zo/records?limit=3`
- `/custom-objects/spend_transaction_zo/records?limit=1`
- `/custom-objects/spend_transaction_zo/records?limit=1&fields=id,amount,transaction_date,merchant`
- `/custom-objects/spend_transaction_zo/records?limit=1&select=id,amount`
- `/custom-objects/spend_transaction_zo/records` (no query)
- `/custom-objects/spend_transaction_zo/records/019fcea0-060e-71b5-b221-20ecbbe4a825` (singular, id lifted from a line-item FK)

The schema endpoint `/custom-objects/spend_transaction_zo` returns 200 with the object metadata (id, name, api_name, plural_label, category_id) - so Rippling knows the object exists, it just can't serialize records. Server-side model mismatch, not a scope or param issue.

---

## PATH 2 - undocumented endpoint probe

Eleven endpoints x three header variants = 33 probes. **Every single one returned 404** with body `<html> <body> Not Found! </body> </html>`.

| endpoint | `2024-08-01` | `2025-01-01` | header omitted |
|---|---|---|---|
| `/spend/transactions` | 404 | 404 | 404 |
| `/spend-transactions` | 404 | 404 | 404 |
| `/spend/cards` | 404 | 404 | 404 |
| `/cards` | 404 | 404 | 404 |
| `/card-transactions` | 404 | 404 | 404 |
| `/expenses` | 404 | 404 | 404 |
| `/expense-reports` | 404 | 404 | 404 |
| `/reimbursements` | 404 | 404 | 404 |
| `/bills` | 404 | 404 | 404 |
| `/vendors` | 404 | 404 | 404 |
| `/purchases` | 404 | 404 | 404 |

**None of these endpoints exist on this API surface** (across all three header variants including the version-omitted call). No 403s were observed, so there is no hidden scoped endpoint on these paths - Rippling simply has not published REST resources at these names. The API version header (`2024-08-01` vs `2025-01-01` vs omitted) made zero difference to the 404 responses, meaning the version header is not gating discovery of these paths.

**Endpoints that exist but are unscoped: none.**
**Endpoints returning 200 with data: none** (the whole spend surface is behind `/custom-objects/{api_name}/records`, per Path 1).

---

## PATH 6 pre-check - accounting / ledger / GL sync objects

Filter `/accounting|ledger|journal|gl_|posting|chart_of_accounts/i` matched **1** object in the custom-object list:

- `spend_txn_gl_sync_failure_context_zo` - "Spend Transaction GL Sync Failure Context" - records endpoint returned 200 with **0 records** (empty for this tenant, which either means no GL sync failures have occurred or the GL sync is not enabled/configured on the Rippling side).

**No `general_ledger`, `journal_entry`, `chart_of_accounts`, `accounting_integration`, `gl_account`, or `gl_export` object appears in the 35-object custom-object list.** This means Rippling's outbound accounting-integration surface is NOT exposed on the Custom Objects API for our tenant. If Rippling Spend is syncing to accounting, that sync happens server-side without a queryable projection here.

The only GL-adjacent field observed is `gl_billable` (bool) and `gl_customer` (ref) on `spend_transaction_line_item_zo` - these are input fields for the sync, not the sync record itself.

**Hand-off to Chat-Claude for path 6 (QBO side)**: Rippling does not expose a "did-sync-to-QBO" or "GL journal entry" object on the API. The follow-up needs to happen on the QBO side via `chief.ngrok.app/qbo/v3/company/1219933770/query?query=select * from Purchase where PaymentType='CreditCard' and TxnDate>='2025-12-29'` (per the plan) to check whether Rippling Spend transactions land in QBO as Purchase records with AccountRef / ClassRef.

---

## Reproducibility - full request log

**Probe 1** (initial scan, 69 requests total):
- 1x `/custom-objects` -> 200
- 1x `/custom_objects` -> not sent (list already succeeded)
- 34x schema/records fetches under `/custom-objects/{buggy_name}.display_name/{schema_or_records}` -> all 404 (extraction bug: used `name` field instead of `api_name`)
- 33x path-2 probes (11 endpoints x 3 header variants) -> all 404
- 1x accounting-object record fetch -> 404

**Probe 2** (refined with correct `api_name`, 36 requests total):
- 1x `/custom-objects` -> 200
- 17x `/custom-objects/{api_name}` schema fetches -> 17x 200
- 17x `/custom-objects/{api_name}/records?limit=3` fetches -> 14x 200, 1x 400 (`spend_transaction_zo`), 1x 400 (`spend_txn_mileage_segment_zo`), 1x 500 (`spend_txn_attachment_zo`)
- 1x acctish records fetch (`spend_txn_gl_sync_failure_context_zo`) -> 200 (0 records)

**Probe 3** (targeted follow-up on the 400s, 6 requests total):
- 4x `spend_transaction_zo` records variants (different limits, `fields=` whitelist, `select=` whitelist, no query) -> all 400 same body
- 1x `spend_transaction_line_item_zo` record fetch to lift a valid txn id -> 200
- 1x singular fetch `/custom-objects/spend_transaction_zo/records/{id}` -> 400 same body

**Grand total: 111 HTTP requests.** No retry storms; two-failures-same-root-cause rule respected (stopped probing `spend_transaction_zo` after two variants confirmed the same server exception, then did four more only because Path 3 was pre-scoped to a bounded set of param variants before instrumenting the finding).

No rate-limiting was observed. No 429s. All requests completed inside a single 2-3 minute window.

---

## Surprises worth flagging

1. **Rippling's custom-objects layer has a model-vs-storage mismatch bug** that server-500s or 400s on three of the 17 spend-related objects. The 400 body leaks the internal class path (`hub_platform.custom_objects.models.CustomObjectDataRow`) which is a Django-shape stack trace hint - suggests this is a schema-migration issue on Rippling's side, not intended behavior. Worth a Rippling support ticket citing the exact object names and error messages.
2. **The line-item projection is denser than expected.** `spend_transaction_line_item_zo` carries department, work_location, GL flags, and a denormalized merchant name via the parent-transaction FK's `display_value`. If the parent-object API stays broken, a line-item-driven sync is viable AND arguably cleaner because it forces per-line-item department/site attribution instead of relying on card-holder mapping.
3. **The `owner_role` field is null across all sampled records**, but `spend_txn_employee_rel_zo` records carry `relation_kind: "Approving Role"` with real employee refs including images. The approval graph is queryable via this relation object, not via a status field on the transaction.
4. **`spend_policy_eval_result_zo` is a first-class object** with `result_type` values like `"require_receipt"` and `rule_info_id` refs. That means we can surface "which transactions violate policy" as a first-class board signal, not just as a derived count.
5. **The API version header (`2024-08-01` vs `2025-01-01` vs omitted) made zero difference** to any probe response. No hidden endpoint got unlocked by version change. This calibrates future spikes - version header is not a discovery lever on this API.
6. **The `/custom_objects` (underscore) fallback was never needed** - `/custom-objects` (hyphen) succeeded on first attempt. Kept the fallback list in the plan for defensiveness but did not exercise it.

---

## What this means for the purchasing lane

The plan's decision ranking said Path 1 wins if a Spend object exists as a nightly sync. That partial-B outcome:

- **PARTIAL YES on nightly sync via `spend_transaction_line_item_zo`** - line items are queryable now, carry amount + date + department + work_location + GL fields + merchant name (via FK display_value). We can start ingesting today without waiting on Rippling.
- **Parent transaction (`spend_transaction_zo`) blocked by a Rippling ENG bug** - file a support ticket. When they fix it, the sync becomes richer (transaction-level memo, status, receipt link) - but the line-item feed is already enough to build the board.
- **Path 4a (email lane) design should still ship** per its own header - runs regardless. Two independent ingest lanes hedges against either the Rippling API bug lingering OR the report-email lane failing on Rippling's side.

The pre-approval discipline note from Kevin's plan: this is READ-ONLY, and no ingest / no schema / no code lands from this spike. That's a separate PR sequence to design and approve.

---

## Appendix A - full custom-object list (35 objects)

Grouped by `category_id`:

**LMS (4 objects)** - category `6910d3ed963b8957ac7e5404`:
- `lms_event`
- `lms_session`
- `lms_session_details`
- `lms_registration`

**Rippling jobs (2 objects)** - category `69620c2b119483c2be14e15b`:
- `rippling_jobs__jobs_5c056bb27ee766474de38833__job_code__c`
- `rippling_jobs__jobs_5c056bb27ee766474de38833__job_code_assignment__c`

**Time entries (10 objects)** - category `698ec972c6939e8e89ba3ae6`:
- `time_entry_zo`
- `time_entry_break`
- `time_entry_job`
- `time_entry_computed_pay_premium`
- `time_entry_computed_pay_segment`
- `time_entry_computed_pto_action`
- `time_entry_job_mapping`
- `time_entry_links`
- `time_entry_computed_break_action`
- `time_entry_edit_history_zo`

**Company / titles (2 objects)** - category `company`:
- `title`
- `title_bt`

**Spend management (17 objects)** - category `spend_management`:
- `spend_line_item_scanned_tax_amount_zo`
- `spend_policy_eval_result_zo`
- `spend_transaction_line_item_tax_zo`
- `spend_transaction_line_item_zo`
- `spend_transaction_zo`
- `spend_txn_anomaly_reason_zo`
- `spend_txn_attachment_zo`
- `spend_txn_comment_rel_zo`
- `spend_txn_dimension_choice_rel_zo`
- `spend_txn_duplicate_rel_zo`
- `spend_txn_employee_rel_zo`
- `spend_txn_form_rel_zo`
- `spend_txn_gl_sync_failure_context_zo`
- `spend_txn_mileage_segment_zo`
- `spend_txn_needed_dimension_rel_zo`
- `spend_txn_per_diem_line_item_zo`
- `spend_txn_third_party_attendee_rel_zo`

---

## Appendix B - redaction rules applied

Per the spike plan and Kevin's rule 3:

**REDACTED** in sample records:
- Card numbers (any 12-19 digit run) -> `[REDACTED_CARDNO]`
- Cardholder / employee names (`name`, `first_name`, `last_name`, `full_name`) -> `[REDACTED_PII]`
- Memos / notes (`memo`, `note`, `notes`) -> `[REDACTED_PII]`
- Personal email / phone -> `[REDACTED_PII]`
- SSN / tax ID / DOB -> `[REDACTED_PII]`
- Signed image URLs on nested employee refs -> `[REDACTED_SIGNED_URL]`

**KEPT intact** (needed for downstream design):
- Amounts (currency + value)
- Dates (`created_at`, `updated_at`, `system_updated_at`)
- Merchants (via `spend_transaction.display_value` FK)
- GL fields (`category`, `gl_billable`, `gl_customer`)
- Department (`{ id, display_value }` - e.g. `"5004.6 - CORP HR"`)
- Work location (`{ id, display_value }` - e.g. `"Remote"`)
- Status / kind / relation_kind fields
- Object ids and external ids

The `name` field on Custom Object records is redacted defensively - Rippling uses `name` for various denormalized display strings including cardholder-name-format labels; safer to redact all than to case-check per object.

No transaction data is stored anywhere - the probe script wrote only to stdout / stderr, was deleted after run, and only redacted samples are quoted in this report. Nothing landed in Postgres, nothing landed in any file except this report.
