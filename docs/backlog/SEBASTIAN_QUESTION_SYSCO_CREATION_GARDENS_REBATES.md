# Ask Sebastian: do Sysco / Creation Gardens run a volume rebate programme?

**Filed:** 2026-09-04, from R-71 Stage 2 followup.
**Status:** Question for Sebastian, not a build item.
**Trigger to unpark:** next Sebastian sync; or if a Sysco/Creation
Gardens rebate surfaces in bill.com out of nowhere.

---

## The question

Do Sysco or Creation Gardens run a volume rebate programme, and where
does it land?

## Why this is worth asking

R-71 Stage 2 classified every FY26 vendor credit by intent using the
Shamrock `Q<n><yy>REB` and `<MMM><yy>REB` reference-number patterns
(see `scripts/probes/_probe_r71_credit_type_split.mjs`).

Result: **only Shamrock accounts show rebate credits.**

| account | rebate $ | short-delivery $ | note |
|---|---:|---:|---|
| CIN - AZ (Shamrock REDS) | $-3,481 | $-4,745 | rebates ✓ |
| TXR - AZ (Shamrock TXR-AZ) | $-5,185 | $-4,515 | rebates ✓ |
| every other account | $0 | $-46,881 | no rebates seen |

Sysco JUP alone billed us enough to be by far our largest vendor and
shows zero rebate credits. Creation Gardens (three divisions) same.
Three possibilities:

1. **They don't run one.** Fine - answer is no, close the question.
2. **They do, and the rebates arrive as null-GL credits.**  There are
   74 null-GL credit lines under Sysco JUP / Creation Gardens / etc.
   in the FY26 corpus totalling $-11,864 - see `NULL_GL_CREDIT_NIGHTLY_GATE.md`
   for that surface. If any of those are rebate money, the guard we
   plan to build will surface them, but only if we know to look.
3. **They arrive some other way entirely** - direct ACH from the
   vendor, a manual QBO entry finance posts against a different
   account, a credit memo on the account statement that never enters
   bill.com. Any of these would be invisible on our surface today.

## The ask, verbatim

> Sebastian - quick question on vendor rebates. We know Shamrock runs
> a quarterly + monthly rebate programme (I'm seeing about $8,600 of
> Shamrock rebate credits year-to-date across CIN - AZ and TXR - AZ).
> Do Sysco and Creation Gardens run comparable programmes? If yes,
> where do those rebates land - bill.com credit memo, direct ACH, or
> something else? Trying to figure out if we're capturing them or if
> money is being left on the table.

## Do not chase in code

Kevin ruling 2026-09-04: "One question to Sebastian: do Sysco or
Creation Gardens run a volume rebate programme, and where does it
land?"

No build item until Sebastian answers. If the answer is "yes and it
lands in bill.com credit memos," then reconcile against the null-GL
audit output. If the answer is "yes but arrives via <other channel>,"
that becomes its own ingest-arc scoping question. If the answer is
"no," close this file.

## Related

- R-71 Stage 2 PR #1016 - source arc.
- `scripts/probes/_probe_r71_credit_type_split.mjs` - the classifier
  that produced the "only Shamrock has rebates" finding.
- `NULL_GL_CREDIT_NIGHTLY_GATE.md` - the guard that would catch a
  rebate that arrives with a null-GL classification.
