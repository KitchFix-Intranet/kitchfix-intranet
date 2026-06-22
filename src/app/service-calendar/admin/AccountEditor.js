"use client";
// Per-account price + catalog editor. Loads via GET sc-admin-account-config?account=X.
//
// Per service row affordances:
//   - Active service:   Edit price / Archive
//   - Archived service: Reactivate (Edit disabled - archived can't price-edit)
//
// Per group:
//   - Group title row carries Archive (active groups) or Reactivate (archived)
//   - "+ Add service" at the bottom of each group's service list (active groups only)
// Per account:
//   - "+ Add group" at the bottom of the editor
//
// Archive uses the locked active_until model: NULL = active forever; a date
// = active through that day inclusive; days strictly after are archived.
// The views (sc-6b) filter on active_until. Archived rows display
// visible-but-marked so they can be reactivated.

import { useCallback, useEffect, useMemo, useState } from "react";
import PriceEditPanel from "./PriceEditPanel";
import ArchiveServicePanel from "./ArchiveServicePanel";
import ArchiveGroupPanel from "./ArchiveGroupPanel";
import AddServicePanel from "./AddServicePanel";
import AddGroupPanel from "./AddGroupPanel";
import ReactivatePanel from "./ReactivatePanel";

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
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function categoryLabel(level) {
  if (!level) return "";
  const L = String(level).toUpperCase();
  if (L === "MLB") return "MLB";
  if (L === "AAA" || L === "AA" || L === "MILB") return "MiLB";
  if (L === "PDC") return "PDC";
  return level;
}

// Archive status against today.
//   "active"     - activeUntil is NULL OR strictly > today
//   "scheduled"  - activeUntil is a date strictly > today (subset of active)
//   "archived"   - activeUntil <= today
function archiveStatus(activeUntil, today) {
  if (!activeUntil) return { state: "active" };
  const date = String(activeUntil).slice(0, 10);
  if (date > today) return { state: "active", scheduled: date };
  return { state: "archived", since: date };
}

export default function AccountEditor({ accountKey, onBack, showToast }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [account, setAccount] = useState(null);
  // Panel state: one open panel per (kind, id).
  //   kind: "editPrice" | "archiveService" | "reactivateService"
  //       | "archiveGroup" | "reactivateGroup" | "addService" | "addGroup"
  //   id:   service or group id (or accountKey for addGroup)
  const [openPanel, setOpenPanel] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const today = useMemo(() => localToday(), [reloadKey]);

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

  // Account metadata.
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

  const handleSaved = useCallback((message) => {
    setOpenPanel(null);
    setReloadKey((k) => k + 1);
    showToast(message || "Saved", "success");
  }, [showToast]);

  const onPriceSaved = useCallback(() => handleSaved("Price updated"), [handleSaved]);
  const onArchiveSaved = useCallback(() => handleSaved("Archived"), [handleSaved]);
  const onReactivateSaved = useCallback(() => handleSaved("Reactivated"), [handleSaved]);
  const onAddSaved = useCallback(() => handleSaved("Added"), [handleSaved]);

  const closePanel = () => setOpenPanel(null);
  const isOpen = (kind, id) => openPanel?.kind === kind && openPanel?.id === id;
  const toggleOpen = (kind, id) => setOpenPanel(isOpen(kind, id) ? null : { kind, id });

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

  // Group services by groupId. Bundle 2: archived services are rendered
  // visible-but-marked (NOT skipped). The pre-existing active=false skip is
  // dropped because no UI surface today flips active and the field is
  // documented as a UI-only toggle, separate from the active_until archive.
  const groupOrder = (data.groups || []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const servicesByGroup = new Map();
  for (const s of data.services || []) {
    if (!servicesByGroup.has(s.groupId)) servicesByGroup.set(s.groupId, []);
    servicesByGroup.get(s.groupId).push(s);
  }

  // Sort each group's services: active first (by sortOrder), then archived
  // (by archive date desc, most recently archived first).
  for (const arr of servicesByGroup.values()) {
    arr.sort((a, b) => {
      const aArc = archiveStatus(a.activeUntil, today).state === "archived" ? 1 : 0;
      const bArc = archiveStatus(b.activeUntil, today).state === "archived" ? 1 : 0;
      if (aArc !== bArc) return aArc - bArc;
      if (aArc === 1) {
        // Both archived: most recent archive first.
        return String(b.activeUntil).localeCompare(String(a.activeUntil));
      }
      return a.sortOrder - b.sortOrder;
    });
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
        <p className="sc-admin-editor-section">Prices &amp; catalog</p>
      </div>

      {groupOrder.length === 0 ? (
        <div className="sc-admin-empty">No service groups configured for this account.</div>
      ) : (
        groupOrder.map((g) => {
          const grpStatus = archiveStatus(g.activeUntil, today);
          const grpArchived = grpStatus.state === "archived";
          const svcs = servicesByGroup.get(g.id) || [];
          const activeServiceCount = svcs.filter((s) => archiveStatus(s.activeUntil, today).state !== "archived").length;
          return (
            <section key={g.id} className={`sc-admin-group${grpArchived ? " sc-admin-group--archived" : ""}`}>
              <div className="sc-admin-group-head">
                <h3 className="sc-admin-group-title">
                  {g.groupName}
                  {grpArchived && (
                    <span className="sc-admin-archived-badge" title={`Archived since ${fmtDate(grpStatus.since)}`}>
                      Archived {fmtDate(grpStatus.since)}
                    </span>
                  )}
                  {!grpArchived && grpStatus.scheduled && (
                    <span className="sc-admin-svc-upcoming" title={`Scheduled archive ${fmtDate(grpStatus.scheduled)}`}>
                      will archive {fmtDate(grpStatus.scheduled)}
                    </span>
                  )}
                </h3>
                <div className="sc-admin-group-actions">
                  {grpArchived ? (
                    <button
                      type="button"
                      className="sc-admin-svc-edit"
                      onClick={() => toggleOpen("reactivateGroup", g.id)}
                    >
                      {isOpen("reactivateGroup", g.id) ? "Close" : "Reactivate"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="sc-admin-svc-edit sc-admin-svc-edit--danger"
                      onClick={() => toggleOpen("archiveGroup", g.id)}
                      disabled={activeServiceCount === 0}
                      title={activeServiceCount === 0 ? "No active services to archive" : ""}
                    >
                      {isOpen("archiveGroup", g.id) ? "Close" : "Archive group"}
                    </button>
                  )}
                </div>
              </div>

              {isOpen("archiveGroup", g.id) && (
                <ArchiveGroupPanel
                  accountKey={accountKey}
                  group={g}
                  activeServiceCount={activeServiceCount}
                  onCancel={closePanel}
                  onSaved={onArchiveSaved}
                  showToast={showToast}
                />
              )}
              {isOpen("reactivateGroup", g.id) && (
                <ReactivatePanel
                  accountKey={accountKey}
                  entity={g}
                  entityType="group"
                  onCancel={closePanel}
                  onSaved={onReactivateSaved}
                  showToast={showToast}
                />
              )}

              <ul className="sc-admin-svc-list">
                {svcs.map((s) => {
                  const svcStatus = archiveStatus(s.activeUntil, today);
                  const svcArchived = svcStatus.state === "archived";
                  return (
                    <li key={s.id} className={`sc-admin-svc-item${svcArchived ? " sc-admin-svc-item--archived" : ""}`}>
                      <div className="sc-admin-svc-row">
                        <span className="sc-admin-svc-name">
                          {s.serviceName}
                          {s.isTaxFree && <span className="sc-admin-svc-tag">tax-free</span>}
                          {s.isNonRevenue && <span className="sc-admin-svc-tag">non-rev</span>}
                          {svcArchived && (
                            <span className="sc-admin-archived-badge" title={`Archived since ${fmtDate(svcStatus.since)}`}>
                              Archived {fmtDate(svcStatus.since)}
                            </span>
                          )}
                          {!svcArchived && svcStatus.scheduled && (
                            <span className="sc-admin-svc-upcoming" title={`Scheduled archive ${fmtDate(svcStatus.scheduled)}`}>
                              will archive {fmtDate(svcStatus.scheduled)}
                            </span>
                          )}
                        </span>
                        {!svcArchived && s.upcomingPrice !== null && (
                          <span className="sc-admin-svc-upcoming" title={`Scheduled change: ${fmtPrice(s.upcomingPrice)} on ${fmtDate(s.upcomingEffectiveDate)}`}>
                            scheduled {fmtPrice(s.upcomingPrice)} {fmtDate(s.upcomingEffectiveDate)}
                          </span>
                        )}
                        <span className="sc-admin-svc-price">{fmtPrice(s.price)}</span>
                        {svcArchived ? (
                          <button
                            type="button"
                            className="sc-admin-svc-edit"
                            onClick={() => toggleOpen("reactivateService", s.id)}
                            aria-expanded={isOpen("reactivateService", s.id)}
                          >
                            {isOpen("reactivateService", s.id) ? "Close" : "Reactivate"}
                          </button>
                        ) : (
                          <span className="sc-admin-svc-actions">
                            <button
                              type="button"
                              className="sc-admin-svc-edit"
                              onClick={() => toggleOpen("editPrice", s.id)}
                              aria-expanded={isOpen("editPrice", s.id)}
                            >
                              {isOpen("editPrice", s.id) ? "Close" : "Edit"}
                            </button>
                            <button
                              type="button"
                              className="sc-admin-svc-edit sc-admin-svc-edit--danger"
                              onClick={() => toggleOpen("archiveService", s.id)}
                              aria-expanded={isOpen("archiveService", s.id)}
                              disabled={grpArchived}
                              title={grpArchived ? "Reactivate the group first" : ""}
                            >
                              {isOpen("archiveService", s.id) ? "Close" : "Archive"}
                            </button>
                          </span>
                        )}
                      </div>
                      {isOpen("editPrice", s.id) && (
                        <PriceEditPanel
                          accountKey={accountKey}
                          groupName={g.groupName}
                          service={s}
                          onCancel={closePanel}
                          onSaved={onPriceSaved}
                          showToast={showToast}
                        />
                      )}
                      {isOpen("archiveService", s.id) && (
                        <ArchiveServicePanel
                          accountKey={accountKey}
                          service={s}
                          onCancel={closePanel}
                          onSaved={onArchiveSaved}
                          showToast={showToast}
                        />
                      )}
                      {isOpen("reactivateService", s.id) && (
                        <ReactivatePanel
                          accountKey={accountKey}
                          entity={s}
                          entityType="service"
                          onCancel={closePanel}
                          onSaved={onReactivateSaved}
                          showToast={showToast}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>

              {!grpArchived && (
                <div className="sc-admin-add-row">
                  <button
                    type="button"
                    className="sc-admin-add-link"
                    onClick={() => toggleOpen("addService", g.id)}
                  >
                    {isOpen("addService", g.id) ? "Close" : "+ Add service"}
                  </button>
                </div>
              )}
              {isOpen("addService", g.id) && (
                <AddServicePanel
                  accountKey={accountKey}
                  group={g}
                  onCancel={closePanel}
                  onSaved={onAddSaved}
                  showToast={showToast}
                />
              )}
            </section>
          );
        })
      )}

      <div className="sc-admin-add-row sc-admin-add-row--account">
        <button
          type="button"
          className="sc-admin-add-link"
          onClick={() => toggleOpen("addGroup", accountKey)}
        >
          {isOpen("addGroup", accountKey) ? "Close" : "+ Add group"}
        </button>
      </div>
      {isOpen("addGroup", accountKey) && (
        <AddGroupPanel
          accountKey={accountKey}
          onCancel={closePanel}
          onSaved={onAddSaved}
          showToast={showToast}
        />
      )}
    </div>
  );
}
