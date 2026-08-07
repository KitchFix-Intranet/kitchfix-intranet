# SC Billing Process Review - Sebastian's current workflow

**Register:** design-audit (load-bearing / fragile / discretion vs mandated)
**Target repo path:** `docs/audits/SC_BILLING_PROCESS_REVIEW_2026-08-06.md`
**Sources:** Gemini notes + full transcript of the Sebastian Castro / Kevin Fietek
call, 2026-08-05 11:00 CDT, 28m48s. Transcript outranks the Gemini summary per
R15; every claim below carries a timestamp into the transcript. The transcript
is computer-generated and carries garbles; garbled spots are marked, never
smoothed.
**Authored:** 2026-08-06, Chat-Claude. Step 2 of the §7.5 sequence in
`PROJECT_SCOPE_MASTER.md`. Kevin's corrections are step 3. No shape proposals
in this doc.

---

## Verdict

The process is simple, coherent, and carried entirely by one person's weekly
transcription ritual. Its single control (the highlight convention) is social,
not mechanical, and its single method (duplicate last week's invoice, edit the
numbers) failed on camera during the call itself. The export Kevin proposed
removes exactly the step that failed. One structural finding changes the arc's
frame: **the billing clock is the service week, not the fiscal period**, which
puts the transcript in direct conflict with R11 of `SC_BILLING_OVERVIEW.md` and
reframes the period-lock design. Flagged, not resolved.

---

## 1. The central finding - the billing clock

**Per-meal billing runs on the service week: Monday through Sunday, invoiced
the following Tuesday.** Sebastian: "I usually send them out Tuesday, which
gives uh I try to give the teams a day to make like adjustments" [00:01:01].
The Tuesday lag is a deliberate grace window because numbers "changed over the
weekend" happen.

Three cadence exceptions, all named by Sebastian:

- **CIN - AZ is bi-weekly**, and it is the only one: "the reds are the only
  ones that I do a bi-weekly ... specifically only for the Goodyear"
  [00:01:01-00:02:18]. (The Gemini summary's "The Reds are the only clients on
  a bi-weekly billing cycle" is lossy - it is the Goodyear account
  specifically, not the Reds relationship.)
- **CIN - KY (Bats) and TBJ - NY (Buffalo) bill by service week**: reviewed
  weekly, invoiced only for weeks with service [00:00:01].
- Everything else in the per-meal set is straight weekly.

**Why this is structural:** the sc-25 period lock, the road-to-cutover lock
rule ("frozen so AP can pull clean figures"), and R11 of
`SC_BILLING_OVERVIEW.md` ("The billing unit is the fiscal PERIOD ... Export =
per-period") are all period-grain. The primary evidence is week-grain. Kevin's
own proposal on the call is week-grain: "when they have their week finalized,
they would press some button and then it would email you their finalized
count" [00:07:35]. The spreadsheet world already runs on weeks too - the
actuals tabs' decimal periods (1.1, 1.2, 1.3, 1.4) are sub-week markers per
`SC_SPREADSHEET_MAPPING.md`.

**Conflict flagged per R16, not resolved:** R11 needs Kevin's red pen. The
likely shape is two nested signals - a week-grain finalize (billable) inside
the period-grain lock (frozen) - and the lock-signal-is-its-own-function
ruling survives either reading because only the function's input changes. But
that is a ruling, not a review finding. Registered as drift item D-9 in the
scope master and open decision #11.

---

## 2. The process as it actually runs

### 2.1 Weekly meal-service billing (the export target)

1. Site maintains its service calendar (today: the Excel/Sheets workbook).
2. Site **highlights** the completed week: "the method has been that they
   highlight to let me know that they've finished reviewing it. So once it's
   highlighted, then I can enter in the information" [00:02:18]. Sebastian's
   own qualifier: "ideally."
3. Sebastian opens the client in QuickBooks and duplicates: "I will copy the
   previous week's invoice, just duplicate it" [00:03:45].
4. He edits the date, edits per-line quantities from the calendar, and adds or
   deletes lines when the service mix shifted (regular vs pregame snacks)
   [00:03:45].
5. QuickBooks computes extended amounts from the quantity and the rate riding
   on the duplicated line, applies the pre-set state tax from the dropdown
   [00:20:30], and the invoice goes to the contact stored on the previous
   invoice.
6. Send day Tuesday, covering prior Monday-Sunday.

**Note on the send day:** Kevin restated the group as "billing that you send
out on Mondays" [00:01:01] and the restatement went uncorrected in the moment,
but Sebastian's explicit statement is Tuesday and the grace-window rationale
only works with Tuesday. Tuesday is the operative fact.

### 2.2 The live defect [00:04:57]

While demonstrating, Sebastian found a shipped invoice carrying the prior
week's quantities: "that's weird. They changed that or I wrote the numbers
wrong ... See, so I didn't update this. This should have been 50 and 125."

An invoice went out with stale duplicated numbers, and nothing in the process
caught it - the client would have had to notice. This is not an anecdote; it
is the failure mode of the duplicate-and-edit method demonstrated
involuntarily during the meeting about replacing it. It is the whole case for
the export.

### 2.3 Service fees (retained manual, out of the export)

- Billed **entirely separately** from meal services, always: "they're always
  separate. Correct." [00:17:37]. Kevin's prior model (fee added to the
  service bill) was corrected live [00:09:50].
- Accounting shape: "It's like a placeholder" on the balance sheet, revenue
  recognized through the year [00:09:50] - which independently confirms R11's
  billing-cadence vs revenue-recognition split.
- Mechanics this year: all fee invoices created at contract signing; Joe or
  Josh sends the full set to the client up front; Sebastian then sends each
  one individually on the first of its month [00:10:51]. Two-three invoices
  up to six (Rangers six; Cardinals six this year). His own caveat: "every
  year it's been different how we've done the service fees" [00:16:17], and
  "the onus is just on me to remember" the monthly sends [00:16:17].
- Fee-invoice recipients can differ from meal-invoice recipients [00:17:37].
- **Decision on the call:** the fee flow is not integrated into the automated
  workflow. Kevin: "we don't need to get super granular and trying to make
  this automate service fee" [00:16:17]. Sebastian: "Correct."

Consequence for the export set: **the four MLB fee accounts and STL - FL
produce no weekly export at all.** Their counts stay operational telemetry
(R2); their money stays `sc_fee_schedule` (R8). The transcript confirms the
two-layer money architecture from the AP side without prompting.

### 2.4 Price adjustments and credits (the TBR case)

Kevin demoed the SC admin backdate: TBR road sandwiches from $15 to $11,
backdated to the start of the year, producing a $3,892 credit owed
[00:14:24]. The system computes and records the delta but tells AP nothing:
"Right now, the system tells us this, but it doesn't send anything to you"
[00:14:24]. Kevin committed on the call to closing that: "it's going to need
to and that's what it's going to do. So, this will then send you an email"
[00:15:27], with a human heads-up from Joe or Kevin alongside.

This is a **new near-term buildable that fell out of the meeting**: backdate
event -> email to billing carrying account, service, old/new price, affected
periods, credit amount. Half the machinery exists - PR #620 closed the
backdate lock hole with warn-and-record, so the record is there and the
notification is not. Not scoped - flagged; needs Kevin's go and a ruling on
recipients.

### 2.5 Visiting catering (separate flow, next-year target)

Bethany emails billing info per event, attachment or in-body, format varies
[00:22:37]. Sebastian manually creates the invoice: picks the right client
account - "we kind of have multiple accounts for a lot of these clients
because of the whole triple C thing" [00:23:41] - enters line items
individually (steakhouse buffet, acai), categorizes so revenue hits the away
meal service line, applies Texas tax (always Texas) [00:21:37-00:23:41].
Revenue lines are, in his words, "kind of a mess" from years of changes
[00:23:41].

Kevin: automating this is a next-year goal, not this year [00:24:42].
Sebastian's counterpoint worth keeping: visiting catering may benefit MORE
from automation than weekly service, because weekly barely changes while
visiting changes every time, and there are more of them [00:24:42]. Parked by
Kevin's explicit ruling; the counterpoint is recorded so the next-year
prioritization starts from it.

### 2.6 Contact management

No centralized list. "I guess where that data is stored is just in
QuickBooks" [00:18:44]. Reviewed at year start via Joe's kickoff email or by
asking Kevin/Joe; mid-year changes (Ashley; Michelle at TBJ) are edited
directly on the invoice in QB, and next week's duplicate carries the change
forward [00:18:44-00:19:32]. The duplicate chain IS the contact database.

### 2.7 Tax

QuickBooks owns it entirely: pre-set per-state rates, dropdown selection,
mostly configured at year start, rides along on every duplicate [00:20:30].
Confirms R9 from the AP side. The export must be pre-tax and emit no tax
content - already the R9 rule.

---

## 3. Decisions ratified on the call

| # | Decision | Anchor |
|---|---|---|
| D1 | Workflow shape: site finalizes week -> button -> system emails Sebastian the finalized counts -> he uploads into QuickBooks -> verifies -> sends to client. Sebastian stays in the loop as verifier and sender; this is not a direct API push in v1 | [00:07:35], "That would be amazing" |
| D2 | Service-fee billing stays annual and manual; not integrated | [00:16:17-00:17:37] |
| D3 | Rollout: PDCs first as they cut over to the intranet SC; "Next year I would do the billing for TXR" | [00:25:42-00:26:41] |
| D4 | Backdate events will email billing, with human follow-up | [00:15:27] |
| D5 | Stress test with Sebastian before launch, like the invoice-tool rollout | [00:26:41] |
| D6 | Sebastian delivers a rules and/or tracking doc, leaning "probably ... do both", beginning of next week | [00:27:43] |

D3's "the billing for TXR" is ambiguous in the transcript - it follows the
visiting-catering discussion, so the likely read is TXR visiting catering,
but it could mean TXR weekly service. Needs Kevin's one-line confirmation
(open decision #15).

---

## 4. Load-bearing register

What the design must preserve or serve. Breaking any of these breaks the
process.

- **LB-1 The week is the billing atom** for per-meal accounts. Mon-Sun,
  Tuesday invoice, with the CIN - AZ bi-weekly and by-service-week exceptions.
  (§1.)
- **LB-2 A finalize signal gates billing.** Today the highlight; tomorrow a
  real state. Sebastian never bills an unfinalized week by design - the export
  must be structurally unable to include one.
- **LB-3 Sebastian verifies and sends.** The decided v1 keeps a human between
  the system and the client. The export's job is to make his verification
  cheap, not to remove him.
- **LB-4 Fees never touch weekly invoices.** The export carries the per-meal
  layer only; fee accounts produce no export. The two-layer architecture (R8)
  is confirmed AP practice, not just SC doctrine.
- **LB-5 Tax stays in QuickBooks.** Pre-tax export, no tax content (R9
  confirmed).
- **LB-6 QB invoice line grain = service x quantity x rate.** The export's
  natural row is one service per account per week with its quantity. Whether
  the row also carries the rate is open decision #12 - it decides whether SC
  becomes the single rate truth.
- **LB-7 The grace window's purpose survives** even if the Tuesday mechanism
  changes: sites need room to correct weekend numbers before the bill cuts.
  A finalize-when-ready button absorbs this, but Sebastian's send-day rhythm
  is his to keep.
- **LB-8 Prior art exists.** Alex built a Sheets-to-QuickBooks export for
  TBJ - FL last year: "Alex kind of created something similar to this. It was
  in um Google Sheets though" [00:05:54]; "we only ever did it for TBJ last
  year, specifically Florida" [00:07:35]. Not carried into this year;
  mechanics forgotten. Dig it up before designing the QB-facing side - it
  answers what QB accepted at least once.

---

## 5. Fragility register

Severity uses the standing P-scale, applied to process rather than screens.

- **F-1 (P0 in the current process, killed by the export) Duplicate-and-edit
  ships stale numbers silently.** Proven live [00:04:57]. No control exists
  downstream of Sebastian's eyes. Every week, every account, the same
  exposure. The export removes the transcription step, which removes the
  defect class.
- **F-2 (P1) Two rate stores with no reconciliation.** `sc_service_prices`
  holds the post-SF invoice rate (R1); QuickBooks holds whatever rate rides
  the duplicated lines. Nothing reconciles them today; the TBR sandwich case
  shows a price change must land in both by hand. Until the export carries
  rates or a reconciliation exists, every SC price change is a latent QB
  divergence.
- **F-3 (P1) The finalize signal is social.** "Ideally they highlight."
  No enforcement, no chase path, no record of when. The intranet's finalize
  state fixes the signal; the chase path (who is nudged when a week is not
  finalized by the send day) is unowned and needs a ruling.
- **F-4 (P1) Post-invoice count edits are possible and invisible.** The
  calendar stays editable after Sebastian bills a week (the period lock sits
  at period grain, weeks bill inside open periods). A count edited after
  Tuesday silently diverges from the sent invoice. The transcript covers the
  price-backdate credit path but no count-correction path exists. Needs a
  ruling: block at week grain post-bill, or allow and emit an adjustment line
  on the next invoice (R13's shape at week grain).
- **F-5 (P2) The contact database is last week's invoice.** No list, no
  audit, regression risk if a duplicate is taken from the wrong week. Out of
  v1 scope by any reasonable reading - named because Kevin asked for
  fragility, not because it should be scoped.
- **F-6 (P2) QB revenue-line categorization is "kind of a mess."** An export
  that maps onto the existing item/revenue structure inherits the mess. The
  SC-service to QB-item mapping table will need Sebastian and Kevin to curate,
  and it is a chance to clean as it maps.
- **F-7 (P2) QB customer does not equal account key, in both directions.**
  Multiple QB accounts per client (the triple-C artifact [00:23:41]); one SC
  account (TXR visiting) fans out to many counterparties; "The bats are reds"
  [00:02:18] hints CIN - KY rolls into the Reds relationship without
  establishing the invoice counterparty. Any export design needs an explicit
  SC-account to QB-customer mapping, owned by AP.
- **F-8 (P2) Fee-send cadence is memory-carried** and varies annually.
  Retained manual by D2; recorded because it is the definition of fragile.
  A reminder mechanism is a P3 nice-to-have for some later day, not scoped.
- **F-9 (P3) The whole pipeline is one person.** Sebastian said it himself:
  "right now it's just me" [00:25:42]. The rules doc (D6) is the first
  externalization of the process that exists anywhere.

---

## 6. Discretion vs mandated

| Element | Class | Evidence |
|---|---|---|
| Fee revenue as balance-sheet placeholder + recognition schedule | AP-mandated (accounting) | [00:09:50] |
| Tax at invoice level in QB, per-state rates | AP-mandated | [00:20:30] |
| Fees always on separate invoices | AP-mandated practice, contract-adjacent | [00:17:37] |
| Credit memo for backdated price reductions | AP-mandated (accounting) | [00:14:24] |
| Tuesday send + grace window | Sebastian's discretion, good control | [00:01:01] |
| Duplicate-previous-week method | Sebastian's discretion; dies with the export | [00:03:45] |
| Contact-on-invoice management | Sebastian's discretion by default of nothing else existing | [00:18:44] |
| Fee-send mechanics (batch up front + monthly singles) | Discretion, varies annually | [00:10:51] |
| Highlight-as-finalize convention | Team-level discretion, no owner | [00:02:18] |

**Pending input:** Sebastian's rules/tracking doc (D6, due early next week)
is the authoritative firming of this table. This section gets revised against
it.

---

## 7. Conflicts with the R-series (flagged per R16)

- **R11 vs the transcript - the billing unit.** R11: "The billing unit is the
  fiscal PERIOD ... Export = per-period." Transcript: per-meal billing is
  weekly (§1). R11 was drafted pre-meeting from the P&L side; the primary
  evidence now says the fiscal period is the recognition and lock grain while
  the service week is the billing grain. Needs Kevin's red pen on R11.
  R11's postseason sub-clauses are unaffected. Registered as D-9.
- **Confirmed, no conflict:** R2 (actuals are the billing data - he bills
  from the calendar counts), R8 (two-layer, fees separate), R9 (tax in QB),
  R14 (effective-dated price changes - the admin demo is the mechanism).
- **Verify item, not a conflict:** Kevin read the CIN - OH fee off the admin
  screen as "3,700 376686" [00:16:17] - garbled audio, plausibly $376,686 on
  screen. The contract bible's locked value is $362,500. If the admin truly
  shows $376,686, either the fee was legitimately updated post-seed or there
  is drift between `sc_fee_schedule` and the bible. One query settles it.
  Open decision #17.

---

## 8. Gap grade against the §7.4 question list

| # | Question | Grade | Note |
|---|---|---|---|
| 1 | How the files reach him, cadence, state, sender | PARTIAL | He accesses the shared calendars himself; highlight = ready. Not covered: whether all accounts share identically, who owns highlight discipline, what he does when it is missing |
| 2 | What he does between receipt and QB | ANSWERED | §2.1. No recompute - QB extends qty x rate |
| 3 | How numbers land in QB: product, object, grain, coding | PARTIAL | Object = invoice, grain = service line. Not covered: QBO vs Desktop (decides the entire import mechanism), item naming, classes. Kevin's research task, blocked on Josh access |
| 4 | How clients get billed | ANSWERED | §2.1, §2.3 |
| 5 | Coverage across the eleven | ANSWERED | Export set = per-meal six: CIN - AZ (bi-weekly), TXR - AZ, TBJ - FL, TBR - FL, CIN - KY (by service), TBJ - NY (by service). Fee accounts + STL - FL: annual fee flow only. TXR - TX - V: visiting catering flow |
| 6 | Billing entity vs account key | PARTIAL | Triple-C multi-account artifact; bats/reds hint; visiting fans out per event. Mapping table required, AP-owned |
| 7 | What he checks; what has gone wrong | PARTIAL | Check = highlight then transcribe. Gone wrong = the live stale-quantity defect. No totals control exists |
| 8 | Mandated vs discretion | PARTIAL | §6; firmed by Sebastian's D6 doc next week |
| 9 | Period-close signal on his side | PARTIAL | Pre-bill signal answered (highlight). Post-bill: nothing freezes; count-correction path does not exist (F-4) |
| 10 | Adjustments and credits | PARTIAL | Price backdates -> credit memo (TBR case). Count corrections and QB credit-memo mechanics not covered |

Nothing gets filled by inference. Partials stay partial until the pending
inputs land: Sebastian's rules doc, Josh's QB access, Alex's prior art.

---

## 9. Open rulings for Kevin (blocking shape work)

1. **The clock.** Week-grain finalize nested inside the period-grain lock, or
   the lock concept moves to week grain? Decides R11's amendment and the §6.4
   recon frame. (D-9 / open decision #11.)
2. **Does the export row carry the rate**, making SC the single rate truth
   and retiring the duplicated-line rate store, or quantities only with QB
   items owning rates? F-2 lives or dies on this. (#12.)
3. **Post-bill count edits:** block at week grain, or allow with an
   adjustment line on the next invoice? (F-4 / #13.)
4. **CIN - AZ bi-weekly shape:** one two-week export, or two weekly exports
   Sebastian combines? (#14.)
5. **D3's "the billing for TXR"** - visiting catering or TXR weekly service?
   (#15.)
6. **Chase path** for weeks not finalized by send day - who gets nudged, by
   what? (#16.)
7. **Verify the CIN - OH admin fee figure** against the contract bible's
   $362,500. (#17.)
8. **Backdate-notification recipients and go** - Sebastian only, or
   Sebastian + Joe + Kevin? (D4; #18.)

---

## 10. What this feeds

- `SC_BILLING_OVERVIEW.md` §3 (the pipeline) can now be drafted from §2 of
  this review; §10 (open framework questions) absorbs §9 above; R11 awaits
  the red pen. The em-dash sweep (D-3) rides the same PR.
- `PROJECT_SCOPE_MASTER.md` bumped to v1.1 alongside this review: §7 updated,
  D-9 registered, open decisions re-graded.
- The period-lock recon (§6.4 of the master) inherits the clock question as
  its first input.
- No CC ruling doc is authored until Kevin corrects this review and rules on
  §9. That is the §7.5 sequence holding.
