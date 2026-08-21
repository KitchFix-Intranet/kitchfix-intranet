"use client";
// SC Admin - accounts rail (left pane).
// Renders the per-meal and fee accounts as segmented lists. Selection
// is state on the host, not a route. Footer shows global service +
// scheduled-change counts (Kevin ruling on gap 7: same numbers as the
// command-bar counts).

export default function AccountsRail({
  accounts,          // [{ key, name, level, billingModel, services, hasScheduled? }]
  activeAccountKey,
  onSelectAccount,   // (key) => void
  totalServices,
  totalScheduled,
}) {
  const perMeal = accounts.filter((a) => a.billingModel !== "flat_fee");
  const fee = accounts.filter((a) => a.billingModel === "flat_fee");

  const renderRow = (a) => (
    <button
      key={a.key}
      type="button"
      className="scav-acct"
      aria-current={a.key === activeAccountKey}
      data-account-key={a.key}
      onClick={() => onSelectAccount(a.key)}
    >
      <span className="scav-acct-k">{a.key}</span>
      {a.hasScheduled && <span className="scav-acct-dot" title="has scheduled changes" />}
      <span className="scav-acct-c">{a.services?.length || 0}</span>
    </button>
  );

  return (
    <aside className="scav-accts" aria-label="Accounts">
      <div className="scav-accts-scroll" role="tablist">
        {perMeal.length > 0 && (
          <>
            <div className="scav-agrp">Per-meal</div>
            {perMeal.map(renderRow)}
          </>
        )}
        {fee.length > 0 && (
          <>
            <div className="scav-agrp">Fee</div>
            {fee.map(renderRow)}
          </>
        )}
      </div>
      <div className="scav-accts-foot">
        <b>{totalServices}</b> services &middot; <b>{totalScheduled}</b> scheduled changes
      </div>
    </aside>
  );
}
