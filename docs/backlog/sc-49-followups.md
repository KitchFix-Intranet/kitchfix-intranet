# sc-49 follow-ups (P2)

Filed 2026-09-26 during Chat-Claude review of PR #1223 (sc-49b). Both P2, do not build now.

## 1. `readInvoiceByDocNumber` conflates "not found" with "lookup failed"

`src/lib/billing/qboAdapter.js`. On a QBO error `6140` (Duplicate Document Number), the handler queries QBO for the invoice under that DocNumber:

- **Not found** (query returned no `Invoice` rows): return `null` -> hard-fail branch, error string `docnumber_conflict_not_found`.
- **Lookup failed** (HTTP error, JSON parse error, network, timeout): also return `null` -> same hard-fail branch, same error string.

Fail-safe direction is right - never adopt on uncertainty. But the resulting N2 text tells Kevin the number was reassigned when the truth may be that the proxy was down. Those need different responses at 8pm on a Saturday.

**Shape of the fix.** `readInvoiceByDocNumber` returns a discriminated result:

```js
{ found: Invoice | null }   // successful QBO round-trip, invoice may or may not exist
{ error: string }           // proxy down, timeout, parse fail, non-2xx
```

6140 handler branches:
- `found: Invoice` matching our customer -> ADOPT.
- `found: Invoice` different customer -> hard-fail `docnumber_conflict` (unchanged).
- `found: null` -> hard-fail `docnumber_conflict_not_found` (unchanged).
- `error: ...` -> hard-fail `docnumber_lookup_error: <reason>` (**new** distinct string).

Do not adopt in the error branch. The distinction is only in the N2 text so an on-call reader can tell "someone else took our number" from "we could not reach QBO to check".

## 2. Adoption is `console.info` only

An adoption path fires when a POST landed but its response was lost, so a duplicate re-POST hits QBO's 6140 and we recover by fetching the invoice QBO already has. That is a **proxy-reliability signal** - it means the proxy or the network dropped a response - and today it lives in `console.info` with nobody watching it.

Sending it through N2 as informational (or counting it) would make proxy flakiness visible before it becomes an incident. Relevant to `docs/backlog/sc-invoice-double-charge-reconciliation.md` - adoption is exactly the class of event that reconciliation exists to guarantee.

**Shape of the fix.** Options:

- Route adoptions through N2 with a distinct subject prefix (`[ADOPTED]`) so Kevin sees them in the same channel as failures but can filter separately. Same low-friction path the existing sc-49 N2 uses.
- Or add a Grafana counter (if one exists for the intranet, TBD - `docs/RUNBOOK.md` does not list one). N2 is simpler and matches the existing observability posture.

Either way: also log to `sc_export_ledger.error` in a structured shape so the reconciliation probe can count adoptions in the last N days.

Not urgent, but adopting silently is the class of "no alarm" gotcha `docs/GOTCHAS.md` calls out repeatedly.
