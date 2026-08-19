"use client";
// src/app/kpi/labor/components/FolioRail.js
//
// V7 carded portfolio folio (V7-10..V7-16). Three cards - ALL ACCOUNTS,
// EAST REGION, WEST REGION - each wearing the page card skin. The group
// header row IS the selector for the pseudo-key; the member rows below
// select individual accounts.
//
// Reads accounts_directory (live accounts.region + name + city + state
// per V7-16) and regional_directors_display (RDO last-name map) from
// the labor route payload. Falls back to a flat list if the directory
// hasn't landed yet.

import { folioMemberDescription, STATIC_DIRECTORY, STATIC_RDO_DISPLAY } from "../lib/accounts";

const PSEUDO_KEYS = new Set(["ALL", "EAST", "WEST"]);

function GroupHeader({ groupKey, name, subline, count, isActive, onClick }) {
  return (
    <button
      type="button"
      className={`kpi-ghead ${isActive ? "on" : ""}`}
      aria-current={isActive ? "page" : undefined}
      onClick={() => onClick?.(groupKey)}
    >
      <span className="kpi-ghead-lock">
        <span className="kpi-ghead-name">{name}</span>
        {subline && <span className="kpi-ghead-sub">{subline}</span>}
      </span>
      {count != null && <span className="kpi-ghead-cnt">{count}</span>}
    </button>
  );
}

function MemberRow({ teamKey, meta, isActive, onClick }) {
  const desc = folioMemberDescription(teamKey, meta);
  return (
    <button
      type="button"
      className={`kpi-acct ${isActive ? "on" : ""}`}
      aria-current={isActive ? "page" : undefined}
      onClick={() => onClick?.(teamKey)}
    >
      <span className="kpi-acct-lock">
        <span className="kpi-acct-key">{teamKey}</span>
        {/* V40 FIX 4 - always render the desc slot so the row is the
            same height with or without a live desc line. Prevents the
            static -> live directory swap from reflowing the rail. */}
        <span className="kpi-acct-desc">{desc.line || " "}</span>
      </span>
    </button>
  );
}

export function FolioRail({
  activeAccount,
  onPickAccount,
  accountsDirectory,          // [{ team_key, region, team_name, city, state, salaried }] | undefined
  regionalDirectorsDisplay,   // { East: "S. Lynch", West: "R. Moore" } | undefined
  folioFoot,                  // node - SYSTEM strip lands in C3 via this slot
}) {
  const hasLive = Array.isArray(accountsDirectory) && accountsDirectory.length > 0;

  // V40 FIX 4 - render the same grouped rail from STATIC_DIRECTORY on
  // the cold paint. Prior fallback was a flat 11-row list that swapped
  // to a grouped 3-card layout when live data arrived (measured 279px
  // grow at 2.0s). Static rows carry region + team_key only; the desc
  // line slot is reserved via .kpi-acct min-height so the swap when
  // live team_name/city/state land does not reflow.
  const directory = hasLive ? accountsDirectory : STATIC_DIRECTORY;
  const rdoDisplay = hasLive ? regionalDirectorsDisplay : STATIC_RDO_DISPLAY;

  const east = directory.filter(a => a.region === "East");
  const west = directory.filter(a => a.region === "West");
  const eastRdo = rdoDisplay?.East;
  const westRdo = rdoDisplay?.West;
  const total = directory.length;

  return (
    <>
      <div className="kpi-folio-title">
        <span className="kpi-folio-title-h">PORTFOLIO</span>
        <span className="kpi-folio-title-s">{total} sites · 2 regions</span>
      </div>

      <div className="kpi-gcard">
        <GroupHeader
          groupKey="ALL"
          name="ALL ACCOUNTS"
          subline="every site · both regions"
          count={total}
          isActive={activeAccount === "ALL"}
          onClick={onPickAccount}
        />
      </div>

      <div className="kpi-gcard">
        <GroupHeader
          groupKey="EAST"
          name="EAST REGION"
          subline={eastRdo ? `RDO ${eastRdo}` : null}
          count={east.length}
          isActive={activeAccount === "EAST"}
          onClick={onPickAccount}
        />
        <div className="kpi-gcard-members">
          {east.map(a => (
            <MemberRow
              key={a.team_key}
              teamKey={a.team_key}
              meta={a}
              isActive={a.team_key === activeAccount}
              onClick={onPickAccount}
            />
          ))}
        </div>
      </div>

      <div className="kpi-gcard">
        <GroupHeader
          groupKey="WEST"
          name="WEST REGION"
          subline={westRdo ? `RDO ${westRdo}` : null}
          count={west.length}
          isActive={activeAccount === "WEST"}
          onClick={onPickAccount}
        />
        <div className="kpi-gcard-members">
          {west.map(a => (
            <MemberRow
              key={a.team_key}
              teamKey={a.team_key}
              meta={a}
              isActive={a.team_key === activeAccount}
              onClick={onPickAccount}
            />
          ))}
        </div>
      </div>

      {folioFoot && <div className="kpi-folio-push" aria-hidden="true" />}
      {folioFoot}
    </>
  );
}

export { PSEUDO_KEYS };
