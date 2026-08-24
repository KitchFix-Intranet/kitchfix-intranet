"use client";
// src/app/kpi/purchasing/components/ReimbursableRow.js
//
// PR 3 - reimbursable row at pass_through accounts (spec §2, §6.6).
//
// Full-width card, directly under the period card. Left side: numbers
// (spent + share of goal) plus the 13xx category split. Right side:
// the reimbursable ledger, header reads "Reimbursable" (purple) + "
// ledger" - so the row pairs visually with the mgmt-fee card above.
//
// **No verdict. No over/under.** The `NO BUDGET` pill says it. R7
// swept the zero-budget variance block; this component does not
// reintroduce it.
//
// The 13xx family is derived from `categories[]` at request time - any
// category whose gl_line_code starts with "13" is rendered. Adding a
// new 13xx line to `kpi_line_codes` shows up here on the next request;
// no hardcoded family list can drop it silently.
//
// Ledger detail is the same `ledgers.reimbursable.rows` payload the
// at-risk board's LedgerCard renders - reused as-is (up to `cap`
// rows, capped with an honest "showing N of M" footer). Shared
// component NOT modified.

import { fmt$, fmtPct } from "../lib/board";
import HelpPop from "@/app/kpi/labor/components/HelpPop.js";
import { REIMBURSABLE_BODY } from "./PurchasingHelpPops";

export function ReimbursableRow({
  account,
  client,             // "St. Louis Cardinals"
  spent,              // range-scoped reimbursable total (totals.reimbursable.spent)
  annualGoal,         // number - for share-of-goal readout
  categories,         // array from route.categories filtered/mapped upstream (13xx family)
  ledgerRows,         // route.ledgers.reimbursable.rows
  ledgerTotalCount,
  ledgerTotalAmount,
  ledgerCap,
  isAggregate,
}) {
  const rangeSpent = Number(spent || 0);
  const shareOfGoal = Number(annualGoal || 0) > 0
    ? rangeSpent / Number(annualGoal)
    : null;

  // Category split: filter to 13xx, sort desc by spent, keep every row
  // (no hardcoded list). Zero-value rows drop out to keep the split
  // scan-readable; a genuine zero at a family level still shows via
  // the aggregate hero above.
  const familyTotal = (categories || []).reduce((s, c) => s + Number(c.spent || 0), 0);
  const rows13xx = (categories || [])
    .filter(c => Number(c.spent || 0) !== 0)
    .sort((a, b) => Number(b.spent || 0) - Number(a.spent || 0));

  return (
    <div className="kpi-p-card kpi-p-reimbrow" data-card="reimb-row">
      <div className="kpi-p-reimbrow-inner">
        {/* LEFT: numbers + category split */}
        <div className="kpi-p-reimbrow-left">
          <div className="kpi-p-head">
            <div className="kpi-p-head-body">
              <span className="kpi-p-cardtitle kpi-p-ct-reimb">
                Reimbursable
                {" "}<HelpPop id="qReimbRowHelp" title="Reimbursable" body={REIMBURSABLE_BODY} />
              </span>
              <span className="kpi-p-cardsub">
                billed to {client || account} · 13xx
              </span>
            </div>
            <div className="kpi-p-pillrow">
              <span className="kpi-p-pill n"><i />Billed to client</span>
            </div>
          </div>

          <div className="kpi-p-nums kpi-p-nums-solo">
            <div className="kpi-p-stk">
              <span className="kpi-p-label">Spent</span>
              <span className="kpi-p-hero num">{fmt$(rangeSpent)}</span>
              <span className="kpi-p-subline">
                recovered in full · <b>no budget applies</b>
              </span>
            </div>
            {shareOfGoal != null && (
              <div className="kpi-p-stk">
                <span className="kpi-p-label">Share of goal</span>
                <span className="kpi-p-value num">{fmtPct(shareOfGoal)}</span>
                <span className="kpi-p-subline">of the annual target</span>
              </div>
            )}
          </div>

          {rows13xx.length > 0 && (
            <div className="kpi-p-subs">
              {rows13xx.map((c) => {
                const s = Number(c.spent || 0);
                const pct = familyTotal > 0 ? s / familyTotal : 0;
                return (
                  <div key={c.gl_line_code} className="kpi-p-sub">
                    <span className="kpi-p-k">
                      {c.gl_line_code}
                      <small>{c.bucket || "reimbursable"}</small>
                    </span>
                    <span className="kpi-p-v num">{fmt$(s)}</span>
                    <span className="kpi-p-x">{fmtPct(pct)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT: reimbursable ledger */}
        <div className="kpi-p-reimbrow-right">
          <div className="kpi-p-lh">
            <span className="kpi-p-cardtitle kpi-p-ct-reimb">Reimbursable</span>
            <span className="kpi-p-label kpi-p-reimb-ledgerlab">ledger</span>
            <span className="kpi-p-cardmeta kpi-p-reimb-ledgerhint">
              every purchase, billed back
            </span>
          </div>
          <div className="kpi-p-ledger-head">
            <span className="kpi-p-k">Vendor</span>
            <span className="kpi-p-k">amount</span>
          </div>
          <div className="kpi-p-ledger">
            {(ledgerRows || []).length === 0 ? (
              <div className="kpi-p-ledger-empty">
                {rangeSpent > 0
                  ? "Line detail lands with the drill route."
                  : "No reimbursable purchases in this range."}
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
                      {r.description || r.gl_line_code || ""}
                      {r.txn_date && !r.description ? ` · ${r.txn_date}` : ""}
                    </small>
                  </span>
                  <span className={`kpi-p-v num${Number(r.amount || 0) < 0 ? " g" : ""}`}>
                    {fmt$(r.amount)}
                  </span>
                </div>
              ))
            )}
          </div>
          {(ledgerRows || []).length > 0 && ledgerTotalCount != null && (
            <div className="kpi-p-ledger-empty kpi-p-reimb-ledgerfoot">
              {ledgerTotalCount > (ledgerCap || 0)
                ? `Showing ${ledgerCap} of ${ledgerTotalCount} lines · ${fmt$(ledgerTotalAmount)} total`
                : `${ledgerTotalCount} line${ledgerTotalCount === 1 ? "" : "s"} · ${fmt$(ledgerTotalAmount)} total`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
