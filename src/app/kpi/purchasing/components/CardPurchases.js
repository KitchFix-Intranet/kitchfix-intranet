"use client";
// src/app/kpi/purchasing/components/CardPurchases.js
//
// Row 6a of the at-risk board (spec §6.4).
//
// Two columns. Stats left - total pending + `Open Rippling`. Every
// charge right, scrolling.
//
// PR-2 R6 Part B - per-charge rows now populate from the route's
// `card_charges` block (uncoded rippling_spend, capped at 50 by amount
// desc). Each row shows merchant, txn date, operator category (from
// spend_category_map), amount. Rows needing a location or category
// keep the amber flag (per-row .flagged class) - the v22 render kept
// this affordance and the PR-2 R2 owner ruling is that a card that
// says what is missing beats a card that invents.

import { fmt$ } from "../lib/board";
// PR 2 R8 Gap 1 - shared HelpPop portal-renders at document.body so it
// escapes the card and the txn-list scroll container's stacking context.
import HelpPop from "@/app/kpi/labor/components/HelpPop.js";
import { CARD_PURCHASES_BODY } from "./PurchasingHelpPops";

// PR 2 R7 Fix 3 - the operator's Rippling default "**Please Select A
// Category**" was landing raw in the row detail line, then getting
// mid-word truncated by CSS ellipsis to "**Please Sel..." - the single
// most important thing that row could tell you ("nobody chose one")
// squashed to gibberish. Owner ruling: shorten deliberately to
// "no category" in amber; never render the raw sentinel.
const NO_CATEGORY_SENTINEL = /^\**\s*please\s+select\s+a\s+category\s*\**$/i;
function normaliseCategory(raw) {
  const s = (raw || "").trim();
  if (!s) return { label: "no category", missing: true };
  if (NO_CATEGORY_SENTINEL.test(s)) return { label: "no category", missing: true };
  return { label: s, missing: false };
}

export function CardPurchases({
  pendingAmount,          // number - summary total
  pendingLineCount,       // integer - total count (may exceed cap)
  closed,                 // hide entirely when the period is closed (no action to take)
  // PR-2 R6 Part B - capped list. Each row:
  //   { account_key, txn_date, amount, merchant, category, gl_line_code? }
  rows,
  totalCount,
  totalAmount,
  cap,
  isAggregate,
}) {
  if (closed) return null;
  const n = Number(pendingLineCount || 0);
  const list = Array.isArray(rows) ? rows : [];
  return (
    <div className="kpi-p-card kpi-p-cp" data-card="card-purchases">
      {/* R15 D - two-column header (was three).  The Open Rippling
          button is now a text link inline with the pending subline;
          card matches the ledger cards' two-stat grammar. */}
      <div className="kpi-p-cpstats kpi-p-cpstats-2col">
        <div>
          <span className="kpi-p-cardtitle">
            Card purchases
            {" "}<HelpPop id="qPurchCardCharges" title="Card purchases" body={CARD_PURCHASES_BODY} />
          </span>
          <span className="kpi-p-cardsub">card charges not yet coded to a P&amp;L line</span>
        </div>
        <div className="kpi-p-cpstat">
          <span className="kpi-p-l">Total pending</span>
          <span className="kpi-p-n">{fmt$(pendingAmount)}</span>
          <span className="kpi-p-s">
            {n === 0
              ? "no charges awaiting a code"
              : (
                <>
                  {`${n} charge${n === 1 ? "" : "s"} · need a P&L line or location · `}
                  <a
                    className="kpi-p-cplink"
                    href="https://app.rippling.com/expenses"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    open Rippling
                  </a>
                </>
              )}
          </span>
        </div>
      </div>
      <div className="kpi-p-cplist">
        <div className="kpi-p-txnhead">
          <span className="kpi-p-k">Every charge</span>
          <span style={{ flex: 1 }} aria-hidden="true" />
          <span className="kpi-p-k">amount</span>
        </div>
        <div className="kpi-p-txnlist">
          {list.length === 0 ? (
            /* Honest empty state per Kevin's PR-2 R2 ruling. Two
               distinct cases: zero pending (nothing awaiting a code)
               vs. the route did not ship rows (older payload / error). */
            <div style={{
              padding: "var(--kpi-sp-4) 0",
              textAlign: "center",
              fontSize: "var(--kpi-t-meta)",
              color: "var(--n-600)",
              fontWeight: 500,
            }}>
              {n === 0
                ? "No charges pending a code."
                : `Per-charge detail did not load. Route reports ${fmt$(pendingAmount)} across ${n} line${n === 1 ? "" : "s"}.`}
            </div>
          ) : (
            <>
              {list.map((r, i) => {
                // PR 2 R7 Fix 3 - normalise the operator category BEFORE
                // deciding "needs attention". Rippling's raw
                // "**Please Select A Category**" sentinel counts as
                // missing (nobody chose one) - same defect class as an
                // absent category and the same amber affordance.
                const cat = normaliseCategory(r.category);
                // A charge is flagged when it lacks a category label
                // (the operator picked something that has not been
                // mapped) OR the merchant/description would be blank.
                // Both are conditions the amber affordance calls out.
                const needsAttention = cat.missing || !r.merchant;
                return (
                  <div
                    key={`${r.merchant || "?"}-${r.txn_date || i}-${i}`}
                    className={`kpi-p-rw${needsAttention ? " flagged" : ""}`}
                  >
                    <span className="kpi-p-k">
                      {r.merchant || "unknown merchant"}
                      <small>
                        {isAggregate && r.account_key ? `${r.account_key} · ` : ""}
                        {r.txn_date || ""}
                        {" · "}
                        {cat.missing ? (
                          <span className="kpi-p-cat-amber">{cat.label}</span>
                        ) : (
                          cat.label
                        )}
                      </small>
                    </span>
                    <span className="kpi-p-v num">{fmt$(r.amount)}</span>
                  </div>
                );
              })}
            </>
          )}
        </div>
        {list.length > 0 && totalCount != null && (
          <div style={{
            padding: "5px 0 0",
            textAlign: "right",
            fontSize: "var(--kpi-t-meta)",
            color: "var(--n-600)",
            fontWeight: 500,
          }}>
            {totalCount > (cap || 0)
              ? `Showing ${cap} of ${totalCount} charges · ${fmt$(totalAmount)} total`
              : `${totalCount} charge${totalCount === 1 ? "" : "s"} · ${fmt$(totalAmount)} total`}
          </div>
        )}
      </div>
    </div>
  );
}
