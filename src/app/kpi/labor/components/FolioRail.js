"use client";
// src/app/kpi/labor/components/FolioRail.js
//
// D2 P2 - left rail account navigation. v1.8 split: NAVIGATION ONLY in
// D2. No dollars, no sparklines, no dots, no All-accounts entry - those
// arrive in D3 with the aggregate endpoint. The dropdown is deleted;
// this rail IS the account selector.
//
// Salaried accounts (D26: CIN-KY, TBJ-NY) render with an italic
// "salaried" tag and no interactive behavior beyond selection.

import { ACCOUNTS, SALARIED_ONLY } from "../lib/accounts";

export function FolioRail({ activeAccount, onPickAccount }) {
  return (
    <>
      <div className="kpi-folio-h">Accounts</div>
      {ACCOUNTS.map(a => {
        const isSalaried = SALARIED_ONLY.has(a);
        const isActive = a === activeAccount;
        return (
          <button
            key={a}
            type="button"
            className={`kpi-acct ${isActive ? "on" : ""}`}
            aria-current={isActive ? "page" : undefined}
            onClick={() => onPickAccount?.(a)}
          >
            <span className="kpi-acct-nm">{a}</span>
            {isSalaried && <span className="kpi-acct-sal">salaried</span>}
          </button>
        );
      })}
    </>
  );
}
