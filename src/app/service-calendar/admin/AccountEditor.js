"use client";
// Per-account price + catalog editor (per-meal accounts).
//
// The catalog block (groups + services + panels + keyboard nav) was
// extracted 2026-08-04 into AccountCatalogSection so both this editor
// and FeeAccountEditor share the exact same rendering. This file
// keeps the account-scope wrapping: back button, header with
// category chip, subtitle "Prices & catalog", and the sc-admin-
// account-config fetch that feeds the shared section.
//
// Row pattern (still): the service row itself is the click target;
// clicking opens an inline detail strip with the current-price line
// plus action triggers. The existing edit panels (PriceEditPanel /
// ArchiveServicePanel / ReactivatePanel / AddServicePanel /
// AddGroupPanel / ArchiveGroupPanel) render inside the strip when
// their trigger fires. See AccountCatalogSection for the full
// mechanics.

import { useEffect, useState } from "react";
import AccountCatalogSection from "./AccountCatalogSection";

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
        <p className="sc-admin-editor-section">Prices &amp; catalog</p>
      </div>

      <AccountCatalogSection
        accountKey={accountKey}
        data={data}
        onReload={() => setReloadKey((k) => k + 1)}
        showToast={showToast}
        feeNoDollar={false}
      />
    </div>
  );
}
