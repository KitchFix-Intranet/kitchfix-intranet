"use client";
// src/app/kpi/purchasing/components/CardPurchases.js
//
// R16 P2 restructure (owner ruling 2026-08-28): mirror LedgerCard's
// shape.  Title + hero on top, list beneath, full-width.  The prior
// two-column grid left a ~490px empty stripe at STL - MO and CIN - AZ
// where the left column ran out of content but the right column
// stretched to the row list's height.
//
// Reused wrappers match the LedgerCard family:
//   .kpi-p-head  .kpi-p-nums  .kpi-p-stk  .kpi-p-hero  .kpi-p-subline
//   .kpi-p-ledger-head  .kpi-p-ledger  .kpi-p-lr  .kpi-p-ledger-empty
// so the visual match is structural, not styled-alike.
//
// Data flow after R16 P0: `card_charges.rows` now includes BOTH the API-
// derived pending rows AND the report-only pending rows (source: "api"
// vs "report_only" on each row).  Hero and footer both derive from the
// combined slice, so the Check 9 assertion passes for every account+range.
// Row shape: { account_key, txn_date, amount, merchant, category, source,
//              gl_line_code:null }.

import { fmt$ } from "../lib/board";
import HelpPop from "@/app/kpi/labor/components/HelpPop.js";
import { CARD_PURCHASES_BODY } from "./PurchasingHelpPops";

// PR 2 R7 Fix 3 - normalise "**Please Select A Category**" sentinel to
// "no category" so the amber affordance carries the fact rather than a
// mid-word ellipsis.
const NO_CATEGORY_SENTINEL = /^\**\s*please\s+select\s+a\s+category\s*\**$/i;
function normaliseCategory(raw) {
  const s = (raw || "").trim();
  if (!s) return { label: "no category", missing: true };
  if (NO_CATEGORY_SENTINEL.test(s)) return { label: "no category", missing: true };
  return { label: s, missing: false };
}

// R16 P0 gate (Kevin ruling 2026-08-28): compare merged hero against
// list footer at render.  Same shape as LedgerCard's Check 9.  Dev
// throws, prod warns.  After the P0 fix on the route this should not
// fire; if it does, one of the two slices drifted.
function assertPendingMatchesTotal({ pendingAmount, pendingLineCount, totalAmount, totalCount }) {
  if (typeof window === "undefined") return;
  if (totalAmount == null || totalCount == null) return;
  const heroR = Math.round(Number(pendingAmount || 0) * 100) / 100;
  const totR  = Math.round(Number(totalAmount   || 0) * 100) / 100;
  const heroN = Number(pendingLineCount || 0);
  const totN  = Number(totalCount || 0);
  if (Math.abs(heroR - totR) <= 0.01 && heroN === totN) return;
  const msg = `CardPurchases Check 9: hero $${heroR.toFixed(2)} (${heroN} charges) != footer $${totR.toFixed(2)} (${totN} charges) - ` +
              `delta amount $${(heroR - totR).toFixed(2)}, delta count ${heroN - totN}. ` +
              `Most likely cause: mergePending includes report-only pending in the hero but loadCardCharges lists API rows only.`;
  // eslint-disable-next-line no-console
  console.error(`[CardPurchases Check 9] ${msg}`);
  if (process.env.NODE_ENV !== "production") throw new Error(msg);
}

export function CardPurchases({
  pendingAmount,          // number - summary total
  pendingLineCount,       // integer - total count (may exceed cap)
  closed,                 // hide entirely when the period is closed (no action to take)
  // R16 P0 - list carries both API + report-only rows.  Each row:
  //   { account_key, txn_date, amount, merchant, category, source, gl_line_code? }
  rows,
  totalCount,
  totalAmount,
  cap,
  isAggregate,
}) {
  if (closed) return null;
  assertPendingMatchesTotal({ pendingAmount, pendingLineCount, totalAmount, totalCount });
  const n = Number(pendingLineCount || 0);
  const list = Array.isArray(rows) ? rows : [];
  return (
    <div className="kpi-p-card kpi-p-cp kpi-p-cp-stack" data-card="card-purchases">
      {/* Head - title + subtitle (matches LedgerCard head grammar).  No
          verdict pill on this card. */}
      <div className="kpi-p-head">
        <div className="kpi-p-head-body">
          <span className="kpi-p-cardtitle">
            Card purchases
            {" "}<HelpPop id="qPurchCardCharges" title="Card purchases" body={CARD_PURCHASES_BODY} />
          </span>
          <span className="kpi-p-cardsub">card charges not yet coded to a P&amp;L line</span>
        </div>
      </div>

      {/* Numbers block: solo hero (there is no matching secondary stat,
          same shape as LedgerCard `noBudget` mode). */}
      <div className="kpi-p-nums kpi-p-nums-solo">
        <div className="kpi-p-stk">
          <span className="kpi-p-label">Total pending</span>
          <span className="kpi-p-hero num">{fmt$(pendingAmount)}</span>
          <span className="kpi-p-subline">
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

      {/* Header row - "Every charge / amount" - suppressed when empty.
          Matches LedgerCard's `.kpi-p-ledger-head` grammar. */}
      {list.length > 0 && (
        <div className="kpi-p-ledger-head">
          <span className="kpi-p-k">Every charge</span>
          <span className="kpi-p-k">amount</span>
        </div>
      )}

      {/* List - full width, LedgerCard row shape (.kpi-p-lr). */}
      <div className="kpi-p-ledger">
        {list.length === 0 ? (
          <div className="kpi-p-ledger-empty">
            {n === 0
              ? "No charges pending a code."
              : `Per-charge detail did not load. Route reports ${fmt$(pendingAmount)} across ${n} line${n === 1 ? "" : "s"}.`}
          </div>
        ) : (
          list.map((r, i) => {
            const cat = normaliseCategory(r.category);
            // A row is flagged when it lacks a category label OR a
            // merchant name.  Report-only rows currently arrive without
            // a merchant string, so they land as flagged - accurate,
            // that IS the ingest-lane state the operator needs to see.
            const needsAttention = cat.missing || !r.merchant;
            return (
              <div
                key={`${r.merchant || "?"}-${r.txn_date || i}-${i}`}
                className={`kpi-p-lr${needsAttention ? " kpi-p-lr-flag" : ""}`}
              >
                <span className={`kpi-p-k${r.merchant ? "" : " kpi-p-nil"}`}>
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
          })
        )}
      </div>

      {/* Footer - "Showing N of M charges · $... total" - same shape as
          LedgerCard's honest cap-of-M footer. */}
      {list.length > 0 && totalCount != null && (
        <div className="kpi-p-ledger-empty kpi-p-cp-foot">
          {totalCount > (cap || 0)
            ? `Showing ${cap} of ${totalCount} charges · ${fmt$(totalAmount)} total`
            : `${totalCount} charge${totalCount === 1 ? "" : "s"} · ${fmt$(totalAmount)} total`}
        </div>
      )}
    </div>
  );
}
