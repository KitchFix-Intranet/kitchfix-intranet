"use client";
// src/app/kpi/labor/components/FolioRail.js
//
// V6-18/19 - portfolio + regions. Reads accounts_directory (live
// accounts.region per PR-1) and regional_directors_display (RDO
// last-name map) from the labor route payload. The folio never
// invents a grouping - if the directory is missing (early loading,
// error), the rail falls back to the flat account list.
//
// Layout:
//   PORTFOLIO
//     All accounts                          (ALL pseudo-key)
//   EAST · RDO <last name>
//     <member accounts, salaried tag preserved>
//   WEST · RDO <last name>
//     <member accounts>
//
// Salaried tag (D26) on CIN - KY and TBJ - NY unchanged.

import { ACCOUNTS, SALARIED_ONLY } from "../lib/accounts";

const PSEUDO_KEYS = new Set(["ALL", "EAST", "WEST"]);

function AcctRow({ accountKey, isActive, isSalaried, isPseudo, onClick }) {
  return (
    <button
      key={accountKey}
      type="button"
      className={`kpi-acct ${isActive ? "on" : ""} ${isPseudo ? "kpi-acct-roll" : ""}`}
      aria-current={isActive ? "page" : undefined}
      onClick={() => onClick?.(accountKey)}
    >
      <span className="kpi-acct-nm">
        {isPseudo && accountKey === "ALL" ? "All accounts" : accountKey}
      </span>
      {isSalaried && <span className="kpi-acct-sal">salaried</span>}
    </button>
  );
}

export function FolioRail({
  activeAccount,
  onPickAccount,
  accountsDirectory,          // [{ team_key, region, salaried }] | undefined
  regionalDirectorsDisplay,   // { East: "S. Lynch", West: "R. Moore" } | undefined
}) {
  // Fallback: no directory yet -> flat list (D2 behavior), no eyebrows.
  const hasDirectory = Array.isArray(accountsDirectory) && accountsDirectory.length > 0;

  if (!hasDirectory) {
    return (
      <>
        <div className="kpi-folio-h">Accounts</div>
        {ACCOUNTS.map(a => (
          <AcctRow
            key={a}
            accountKey={a}
            isActive={a === activeAccount}
            isSalaried={SALARIED_ONLY.has(a)}
            isPseudo={false}
            onClick={onPickAccount}
          />
        ))}
      </>
    );
  }

  const east = accountsDirectory.filter(a => a.region === "East");
  const west = accountsDirectory.filter(a => a.region === "West");
  const eastRdo = regionalDirectorsDisplay?.East;
  const westRdo = regionalDirectorsDisplay?.West;

  return (
    <>
      <div className="kpi-folio-eyebrow">PORTFOLIO</div>
      <AcctRow
        accountKey="ALL"
        isActive={activeAccount === "ALL"}
        isSalaried={false}
        isPseudo
        onClick={onPickAccount}
      />
      <div className="kpi-folio-eyebrow">EAST{eastRdo ? ` · RDO ${eastRdo}` : ""}</div>
      <AcctRow
        accountKey="EAST"
        isActive={activeAccount === "EAST"}
        isSalaried={false}
        isPseudo
        onClick={onPickAccount}
      />
      {east.map(a => (
        <AcctRow
          key={a.team_key}
          accountKey={a.team_key}
          isActive={a.team_key === activeAccount}
          isSalaried={a.salaried}
          isPseudo={false}
          onClick={onPickAccount}
        />
      ))}
      <div className="kpi-folio-eyebrow">WEST{westRdo ? ` · RDO ${westRdo}` : ""}</div>
      <AcctRow
        accountKey="WEST"
        isActive={activeAccount === "WEST"}
        isSalaried={false}
        isPseudo
        onClick={onPickAccount}
      />
      {west.map(a => (
        <AcctRow
          key={a.team_key}
          accountKey={a.team_key}
          isActive={a.team_key === activeAccount}
          isSalaried={a.salaried}
          isPseudo={false}
          onClick={onPickAccount}
        />
      ))}
    </>
  );
}

export { PSEUDO_KEYS };
