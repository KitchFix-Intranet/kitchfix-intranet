"use client";
// src/app/kpi/purchasing/components/LedgerCard.js
//
// Row 5 of the at-risk board (spec §6.3). Equipment + R&M.
//
// No chart. Hero, variance, then EVERY purchase - vendor, description,
// amount. At `ALL ACCOUNTS` each line carries its account_key.
//
// Vehicle repairs stay INSIDE R&M and are flagged (§3), not moved.
// The route ships the underlying bill/line data via actuals[] when
// `drill=lines` is requested. This PR does NOT request drill (that is
// PR 4's table); we render the ledger from `weekly` at the gl_line_code
// level only - one row per (vendor-if-known, bill count). If bill-line
// detail is required for review, the drill lands with PR 4.
//
// One resolveCardState() call - state / pill / hero color agree.

import { Pill } from "./Pill";
import { fmt$, fmtPct, moneyArrow, resolveCardState } from "../lib/board";
// PR 2 R8 Gap 1 - shared HelpPop portal-renders at document.body so it
// escapes the card + the ledger scroll container's stacking context.
import HelpPop from "@/app/kpi/labor/components/HelpPop.js";
import { EQUIPMENT_BODY, REPAIR_BODY, REIMBURSABLE_BODY } from "./PurchasingHelpPops";

const LEDGER_HELP = {
  equip: { id: "qPurchEquip", title: "Equipment",            body: EQUIPMENT_BODY    },
  rm:    { id: "qPurchRepair", title: "Repair & maintenance", body: REPAIR_BODY       },
  reimb: { id: "qPurchReimb",  title: "Reimbursable",         body: REIMBURSABLE_BODY },
};

export function LedgerCard({
  bucketKey,          // 'equip' | 'rm' | 'reimb'
  label,
  sub,
  strokeClass,
  budget,
  spent,
  elapsedFrac,
  closed,
  // PR 2 R8 - server `is_future_range` flag. When true, suppress the
  // pill, hero state colour, and Remaining / Over-by verdict.
  isFutureRange = false,
  ledgerRows,         // [{ vendor, description?, amount, account_key?, gl_line_code?, txn_date? }]
  // PR-2 R6 Part B - capped list metadata. `total_count` reveals a
  // "showing N of M" footer when the cap is hit; a capped list that
  // does not say it is capped is silent truncation.
  totalCount,
  totalAmount,
  cap,
  isAggregate,
}) {
  // PR-2 R6 Part B - Check 9 client gate. Compare the uncapped
  // total_amount with the hero (`spent`); refuse to render if the
  // numbers disagree by more than a cent. Same defect class as R4
  // Part A - if the hero and its detail computed from different
  // queries, bind them or they drift.
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    if (totalAmount != null) {
      const heroR = Math.round(Number(spent || 0) * 100) / 100;
      const totR  = Math.round(Number(totalAmount || 0) * 100) / 100;
      if (Math.abs(heroR - totR) > 0.01) {
        // eslint-disable-next-line no-console
        console.error(`[LedgerCard Check 9] ${bucketKey} hero != ledger_total`, { heroR, totR, delta: heroR - totR });
        throw new Error(
          `LedgerCard Check 9: ${bucketKey} hero $${heroR.toFixed(2)} != ledger total $${totR.toFixed(2)} (delta $${(heroR - totR).toFixed(2)})`,
        );
      }
    }
  }
  const cs = resolveCardState({
    spent: Number(spent || 0),
    budget: Number(budget || 0),
    elapsedFrac,
    hasBills: Number(spent || 0) > 0,
    closed,
  });

  const rem = Number(budget || 0) - Number(spent || 0);
  const varz = Number(spent || 0) - Number(budget || 0);
  const usedPct = Number(budget || 0) > 0 ? Number(spent || 0) / Number(budget || 0) : null;

  return (
    <div className={`kpi-p-card ${strokeClass}`} data-card={`ledger-${bucketKey}`}>
      <div className="kpi-p-head">
        <div className="kpi-p-head-body">
          <span className="kpi-p-cardtitle">
            {label}
            {LEDGER_HELP[bucketKey] && (
              <>{" "}<HelpPop {...LEDGER_HELP[bucketKey]} /></>
            )}
          </span>
          <span className="kpi-p-cardsub">{sub}</span>
        </div>
        <div className="kpi-p-pillrow">
          {/* PR 2 R8 - no verdict pill on a future range. */}
          {!isFutureRange && <Pill tone={cs.pillTone} label={cs.pillLabel} />}
        </div>
      </div>

      {/* PR 2 R7 Fix 4 - when the range has NO budget on this card AND
          the range is not future, the second stack disappears entirely
          (the `no budget` subline on the hero above carries the state).
          Flag the `.kpi-p-nums` grid so it collapses to a single column
          and the hero owns the full width. */}
      <div className={`kpi-p-nums${!isFutureRange && Number(budget || 0) === 0 ? " kpi-p-nums-solo" : ""}`}>
        <div className="kpi-p-stk">
          <span className="kpi-p-label">Spent</span>
          {/* PR 2 R8 - hero drops state colour on a future range. */}
          <span className={`kpi-p-hero num ${isFutureRange ? "" : cs.heroClass}`}>{fmt$(spent)}</span>
          <span className="kpi-p-subline">
            of <b>{fmt$(budget)}</b>
            {!isFutureRange && usedPct != null && (<>{" "}· <b>{fmtPct(usedPct)}</b> used</>)}
            {Number(budget || 0) === 0 && (<><span aria-hidden="true"> · </span><b>no budget</b></>)}
          </span>
        </div>
        {/* PR 2 R7 Fix 4 - zero budget renders NO variance block. Prior
            state rendered `OVER BY —` when budget=0 and spent>0: label
            said "over by", value was an em-dash, subline read
            "every purchase below". That is a lie in three parts. The
            `no budget` pill in the subline above already carries the
            state; a second stack with a dashed value MUST NOT appear.
            Future range keeps the `Budget` presenter (the target has
            not yet been spent against, so the number itself is the
            reading). Closed and in-progress states with budget > 0
            keep their existing verdict. */}
        {isFutureRange ? (
          <div className="kpi-p-stk">
            <span className="kpi-p-label">Budget</span>
            <span className="kpi-p-value num">{fmt$(budget)}</span>
            <span className="kpi-p-subline">this range has not started</span>
          </div>
        ) : Number(budget || 0) === 0 ? (
          null
        ) : (
          <div className="kpi-p-stk">
            {/* PR-2 R2 Fix 3 - owner ruling 2026-08-21: `Remaining` is a
                quantity, plain, no arrow, no colour. Over budget swaps
                the label to `Over by` and the number carries variance
                colour. Closed reads `Vs budget` unchanged. */}
            <span className="kpi-p-label">
              {closed ? "Vs budget" : (rem < 0 ? "Over by" : "Remaining")}
            </span>
            {closed ? (
              <span className={`kpi-p-value num ${varz > 0 ? "r" : "g"}`}>{moneyArrow(varz)}</span>
            ) : rem < 0 ? (
              <span className="kpi-p-value num r">{fmt$(-rem)}</span>
            ) : (
              <span className="kpi-p-value num">{fmt$(rem)}</span>
            )}
            <span className="kpi-p-subline">
              {closed ? "period closed" : "every purchase below"}
            </span>
          </div>
        )}
      </div>

      {/* PR 2 R9 P2-5 - suppress the ledger header ("Every purchase /
          amount") when there are no rows. A table header above "no
          purchases recorded" reads as a broken render. Only shown
          when rows are present. */}
      {(ledgerRows || []).length > 0 && (
        <div className="kpi-p-ledger-head">
          <span className="kpi-p-k">Every purchase</span>
          <span className="kpi-p-k">amount</span>
        </div>
      )}
      <div className="kpi-p-ledger">
        {(ledgerRows || []).length === 0 ? (
          /* PR-2 R2 Fix 4 - owner ruling: a non-zero hero above
             "no purchases recorded" is a lie. Zero spend keeps the
             original copy. PR-2 R6 Part B populates rows so this
             branch only fires on an empty range. */
          <div className="kpi-p-ledger-empty">
            {Number(spent || 0) > 0
              ? "Line detail lands with the drill route."
              : "No purchases recorded in this range."}
          </div>
        ) : (
          (ledgerRows || []).map((r, i) => (
            <div key={`${r.vendor || "?"}-${i}`} className="kpi-p-lr">
              <span className={`kpi-p-k${r.vendor ? "" : " kpi-p-nil"}`}>
                {r.vendor || "—"}
                <small>
                  {isAggregate && r.account_key && (
                    <span className="kpi-p-acct">{r.account_key}</span>
                  )}
                  {/* description first if present, otherwise show the
                     gl code + date so the row explains itself. */}
                  {r.description || r.gl_line_code || ""}
                  {r.txn_date && !r.description ? ` · ${r.txn_date}` : ""}
                </small>
              </span>
              <span className={`kpi-p-v num ${Number(r.amount || 0) < 0 ? "g" : ""}`}>
                {fmt$(r.amount)}
              </span>
            </div>
          ))
        )}
      </div>
      {/* PR-2 R6 Part B - honest cap-of-M footer.
         A capped list that does not say it is capped is silent
         truncation (the failure mode this board has three times over).
         When rows are populated AND the cap hit, print "showing N of M".
         When all rows fit, print just the count. */}
      {(ledgerRows || []).length > 0 && totalCount != null && (
        <div className="kpi-p-ledger-empty" style={{ padding: "5px 0 0", textAlign: "right" }}>
          {totalCount > (cap || 0)
            ? `Showing ${cap} of ${totalCount} lines · ${fmt$(totalAmount)} total`
            : `${totalCount} line${totalCount === 1 ? "" : "s"} · ${fmt$(totalAmount)} total`}
        </div>
      )}
    </div>
  );
}
