"use client";
// SC Admin - accounts rail (left pane).
// PR-N audit R2 A1 (Kevin ruling 2026-08-21, option b): the KPI
// portfolio treatment lands here - grouped white cards on grey,
// two-line rows (code + team name from accounts.name), count
// pills, selected row as a filled navy card. Team name is Kevin's
// option (b) - accounts.name only, NO ACCOUNT_META import (a
// hardcoded map in another module is not a source of truth).
// Group split stays PER-MEAL / FEE because that split changes the
// editor, not the KPI regional split.

const chip = (n) => (
  <span className="scav-acct-cnt" aria-label={`${n} service${n === 1 ? "" : "s"}`}>
    {n}
  </span>
);

function AccountCard({ label, accounts, activeAccountKey, onSelectAccount }) {
  if (accounts.length === 0) return null;
  return (
    <section className="scav-acct-card">
      <div className="scav-acct-card-hd">
        <span className="scav-acct-card-name">{label}</span>
        <span className="scav-acct-card-cnt">{accounts.length}</span>
      </div>
      <div className="scav-acct-card-members">
        {accounts.map((a) => {
          const isActive = a.key === activeAccountKey;
          return (
            <button
              key={a.key}
              type="button"
              className={"scav-acct" + (isActive ? " scav-acct--on" : "")}
              aria-current={isActive}
              data-account-key={a.key}
              onClick={() => onSelectAccount(a.key)}
            >
              <span className="scav-acct-lock">
                <span className="scav-acct-key">{a.key}</span>
                <span className="scav-acct-desc">{a.name || " "}</span>
              </span>
              {a.hasScheduled && <span className="scav-acct-dot" title="has scheduled changes" />}
              {chip(a.services?.length || 0)}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default function AccountsRail({
  accounts,          // [{ key, name, level, billingModel, services, hasScheduled? }]
  activeAccountKey,
  onSelectAccount,
  totalServices,
  totalScheduled,
}) {
  const perMeal = accounts.filter((a) => a.billingModel !== "flat_fee");
  const fee = accounts.filter((a) => a.billingModel === "flat_fee");

  return (
    <aside className="scav-accts" aria-label="Accounts">
      <div className="scav-accts-scroll">
        <AccountCard
          label="Per-meal"
          accounts={perMeal}
          activeAccountKey={activeAccountKey}
          onSelectAccount={onSelectAccount}
        />
        <AccountCard
          label="Fee"
          accounts={fee}
          activeAccountKey={activeAccountKey}
          onSelectAccount={onSelectAccount}
        />
      </div>
      <div className="scav-accts-foot">
        <b>{totalServices}</b> services &middot; <b>{totalScheduled}</b> scheduled changes
      </div>
    </aside>
  );
}
