# RIPPLING SPEND - SPIKE PLAN (reopened 2026-08-18)

Status of prior work: D7 (08-03) concluded "Rippling Spend absent from API, upload-only" and
parked it. But the same investigation logged (KPI_DASHBOARD_PLAYBOOK.md:640) that the "Call a
public API" WORKFLOW ACTION is tier-gated - meaning the door exists and was not opened. That is
a plan-tier question, not an architecture dead end. This spike tests every path before we
accept upload-only.

I cannot run these from the sandbox: RIPPLING_API_KEY is not present here, and Rippling's
Reports UI needs a browser session. Two of the six paths are Kevin/CC; the rest are Kevin only.

## Path 1 - Custom object discovery (CC, 15 min, uses the existing key)

The labor sync reads `custom-objects/time_entry_computed_pay_segment/records` and
`custom-objects/time_entry_zo/records`. It has never LISTED what custom objects exist. Rippling
often exposes Spend transactions, cards and expense reports as custom objects even when there
is no dedicated REST endpoint. Test:
  GET https://rest.ripplingapis.com/custom-objects            (list all objects)
  X-Rippling-Api-Version: 2024-08-01, Bearer <RIPPLING_API_KEY>
Then for each object whose name matches /spend|card|expense|transaction|reimburs|purchase/i:
  GET custom-objects/{name}/records?limit=5
Report: object names, field names, one sample row (redact card numbers). If a Spend
transaction object exists here, the whole card lane becomes a nightly sync exactly like labor
- and this is the highest-probability path.

## Path 2 - Undocumented / newer endpoints on the same key (CC, 10 min)

Try, and record the HTTP status for each:
  /spend/transactions   /spend-transactions   /expenses   /expense-reports
  /cards   /card-transactions   /reimbursements   /bills
Also try the same paths with `X-Rippling-Api-Version: 2025-01-01` and with the header omitted.
A 403 means the endpoint exists and our token lacks the scope (fixable in Rippling admin); a
404 means it does not exist. That distinction is the whole finding.

## Path 3 - Token scopes (Kevin, Rippling admin, 5 min)

Rippling API tokens carry explicit scopes. Open the token that RIPPLING_API_KEY belongs to and
list its scopes. If there is any Spend / Expense / Card read scope available that is UNCHECKED,
check it and rerun Path 2. If no such scope is offered at all, note that - it means Spend is
not on the public API surface for this account, regardless of tier.

## Path 4 - Custom Reports as the extraction surface (Kevin, Rippling admin, 20 min)

You said it: Spend has custom reports. Build one report with these columns and see if all
exist: transaction date, merchant, amount, card holder, card last-4, department/entity,
GL account or category, memo/receipt status, transaction id.
Then the real question - CAN THAT REPORT LEAVE RIPPLING WITHOUT A HUMAN?
  4a. Report settings -> Schedule / Deliver: is there an email-on-schedule option? If yes,
      that is a viable lane: scheduled report -> Gmail -> a small parser -> Postgres. Ugly but
      unattended, and Gmail MCP is already wired.
  4b. Reports API: some Rippling tiers expose `GET /reports/{id}/run` or a report-download
      endpoint. Test on the same key once the report exists.
  4c. Failing both: manual CSV export on a cadence = the upload lane, but with a FIXED SCHEMA
      we control, which is still much better than ad hoc.

## Path 5 - Workflow Automation egress (Kevin, Rippling admin, 10 min)

This is the door D7 found. Workflow Studio has a "Call a public API" action that could POST
each Spend transaction to a Vercel route on creation. Two questions:
  5a. Is Spend a supported TRIGGER for workflows (e.g. "when a Spend transaction is created /
      approved")? If not, this path is dead regardless of tier.
  5b. If it is, what tier unlocks the "Call a public API" action, and what does that tier cost?
      That is a business decision, but the pay-run push it would also enable makes it worth
      pricing.

## Path 6 - Accounting sync (Kevin / Josh, 10 min)

Rippling Spend syncs to accounting. Where does it sync for KitchFix - QBO? If Spend
transactions land in QBO as expenses with a GL account and class, we ALREADY have QBO through
the proxy (realm 1219933770) and can read them there without touching Rippling at all. Test:
  GET https://chief.ngrok.app/qbo/v3/company/1219933770/query?query=select * from Purchase
    where PaymentType='CreditCard' and TxnDate>='2025-12-29' maxresults 20
If card purchases appear with AccountRef and ClassRef, this is the cleanest answer of the six -
the source of truth for the P&L is QBO anyway.

## What decides it

Ranked by likelihood x value:
  1. Path 6 (QBO) - if Spend already syncs there, done, no Rippling work at all
  2. Path 1 (custom objects) - if a Spend object exists, it is a nightly sync we already know
     how to write
  3. Path 4a (scheduled report -> Gmail -> parser) - unattended, a bit ugly, viable
  4. Path 5 (workflow egress) - clean but tier-gated, needs pricing
  5. Path 4c (scheduled manual export, fixed schema) - the fallback, still better than ad hoc

Report format: one line per path with status + evidence. Whichever path lands first ends the
spike; the others do not need finishing.
