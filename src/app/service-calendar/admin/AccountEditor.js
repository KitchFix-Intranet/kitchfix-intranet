"use client";
// Per-account price editor. Loads via GET sc-admin-account-config?account=X.
// Each service row has an Edit affordance that opens an inline PriceEditPanel
// underneath. After a successful save the editor refetches the config so
// the new current price + any scheduled future change are reflected.

import { useCallback, useEffect, useState } from "react";
import PriceEditPanel from "./PriceEditPanel";

function fmtPrice(n) {
  return "$" + Number(n).toFixed(2);
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = String(iso).slice(0, 10);
  const [y, m, day] = d.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[Number(m) - 1]} ${Number(day)}, ${y}`;
}

function categoryLabel(level) {
  if (!level) return "";
  const L = String(level).toUpperCase();
  if (L === "MLB") return "MLB";
  if (L === "AAA" || L === "AA" || L === "MILB") return "MiLB";
  if (L === "PDC") return "PDC";
  return level;
}

export default function AccountEditor({ accountKey, onBack, showToast }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [account, setAccount] = useState(null);
  const [openServiceId, setOpenServiceId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/service-calendar?action=sc-admin-account-config&account=${encodeURIComponent(accountKey)}`,
      { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) { setError(d.error || "Failed to load"); setData(null); }
        else { setData(d); }
      })
      .catch((e) => { if (e.name !== "AbortError") setError("Network error"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [accountKey, reloadKey]);

  // Account metadata (name + level + billingModel) comes from the
  // accounts overview path - we don't get it back from sc-admin-account-
  // config. Fetch it on first mount via the existing sc-accounts action.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/service-calendar?action=sc-accounts", { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) return;
        const a = (d.accounts || []).find((x) => x.key === accountKey);
        if (a) setAccount(a);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [accountKey]);

  const handleSaved = useCallback(() => {
    setOpenServiceId(null);
    setReloadKey((k) => k + 1);
    showToast("Price updated", "success");
  }, [showToast]);

  if (loading) {
    return (
      <div className="sc-admin-loading">
        <div className="oh-spinner" />
        <p>Loading account...</p>
      </div>
    );
  }
  if (error) {
    return <div className="sc-admin-error">Couldn&apos;t load account: {error}</div>;
  }
  if (!data) return null;

  // Group services by groupId. The orchestrator returns services sorted
  // by (group sortOrder, service sortOrder).
  const groupOrder = (data.groups || []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const servicesByGroup = new Map();
  for (const s of data.services || []) {
    if (s.active === false) continue;
    if (!servicesByGroup.has(s.groupId)) servicesByGroup.set(s.groupId, []);
    servicesByGroup.get(s.groupId).push(s);
  }

  return (
    <div className="sc-admin-editor">
      <button type="button" className="sc-admin-back sc-admin-back--inline" onClick={onBack}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
        All accounts
      </button>

      <div className="sc-admin-editor-head">
        <div className="sc-admin-editor-title-row">
          <h2 className="sc-admin-editor-title">{accountKey}</h2>
          {account?.name && <span className="sc-admin-editor-name">{account.name}</span>}
          {account?.category && (
            <span className={`sc-cat sc-cat--${(categoryLabel(account.category) || "").toLowerCase()}`}>{categoryLabel(account.category)}</span>
          )}
        </div>
        <p className="sc-admin-editor-section">Prices</p>
      </div>

      {groupOrder.length === 0 ? (
        <div className="sc-admin-empty">No services configured for this account.</div>
      ) : (
        groupOrder.map((g) => {
          const svcs = servicesByGroup.get(g.id) || [];
          if (svcs.length === 0) return null;
          return (
            <section key={g.id} className="sc-admin-group">
              <h3 className="sc-admin-group-title">{g.groupName}</h3>
              <ul className="sc-admin-svc-list">
                {svcs.map((s) => (
                  <li key={s.id} className="sc-admin-svc-item">
                    <div className="sc-admin-svc-row">
                      <span className="sc-admin-svc-name">
                        {s.serviceName}
                        {s.isTaxFree && <span className="sc-admin-svc-tag">tax-free</span>}
                      </span>
                      {s.upcomingPrice !== null && (
                        <span className="sc-admin-svc-upcoming" title={`Scheduled change: ${fmtPrice(s.upcomingPrice)} on ${fmtDate(s.upcomingEffectiveDate)}`}>
                          scheduled {fmtPrice(s.upcomingPrice)} {fmtDate(s.upcomingEffectiveDate)}
                        </span>
                      )}
                      <span className="sc-admin-svc-price">{fmtPrice(s.price)}</span>
                      <button
                        type="button"
                        className="sc-admin-svc-edit"
                        onClick={() => setOpenServiceId(openServiceId === s.id ? null : s.id)}
                        aria-expanded={openServiceId === s.id}
                      >
                        {openServiceId === s.id ? "Close" : "Edit"}
                      </button>
                    </div>
                    {openServiceId === s.id && (
                      <PriceEditPanel
                        accountKey={accountKey}
                        groupName={g.groupName}
                        service={s}
                        onCancel={() => setOpenServiceId(null)}
                        onSaved={handleSaved}
                        showToast={showToast}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
