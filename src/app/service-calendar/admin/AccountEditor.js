"use client";
// Per-account price + catalog editor. Loads via GET sc-admin-account-config?account=X.
//
// Row pattern: matches the Inventory ItemCatalog (.ic-item) - the service ROW
// itself is the click target. Clicking opens an inline DETAIL strip below
// the row that contains the current-price line plus the action triggers
// (Edit price / Archive service / Reactivate). The existing edit panels
// (PriceEditPanel / ArchiveServicePanel / ReactivatePanel) render inside
// the detail strip when their trigger is invoked.
//
//   Two states drive the expansion (Option A, simpler than overloading
//   openPanel):
//     openRow  - id of the row whose detail strip is expanded
//     openPanel - { kind, id } for the inline edit panel inside the
//                 detail (or for group-level actions outside it)
//
// Per group:
//   - Group title row carries Archive (active groups) or Reactivate
//     (archived). Group-level action stays on the header, NOT per-row.
//   - "+ Add service" at the bottom of each group's service list
//     (active groups only)
// Per account:
//   - "+ Add group" at the bottom of the editor
//
// Archive uses the locked active_until model: NULL = active forever; a date
// = active through that day inclusive; days strictly after are archived.
// The views (sc-6b) filter on active_until. Archived rows display
// visible-but-marked so they can be reactivated.
//
// Keyboard nav (matches ItemCatalog):
//   ArrowDown / ArrowUp - move focus between visible service rows
//   Enter              - toggle the focused row's detail strip
//   Escape             - close any open detail + panel

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  // Panel state (group-level + per-service edit panel inside the
  // expanded row detail). One panel per (kind, id).
  //   kind: "editPrice" | "archiveService" | "reactivateService"
  //       | "archiveGroup" | "reactivateGroup" | "addService" | "addGroup"
  //   id:   service or group id (or accountKey for addGroup)
  const [openPanel, setOpenPanel] = useState(null);
  // Per-service row detail expansion. Independent from openPanel so the
  // row stays expanded while a panel below it is being interacted with.
  const [openRow, setOpenRow] = useState(null);
  // Keyboard focus (ItemCatalog parity). -1 = no row focused.
  const [focusIdx, setFocusIdx] = useState(-1);
  const [reloadKey, setReloadKey] = useState(0);

  const editorRef = useRef(null);
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
    setOpenRow(null);
    setReloadKey((k) => k + 1);
    showToast(message || "Saved", "success");
  }, [showToast]);

  const onPriceSaved = useCallback(() => handleSaved("Price updated"), [handleSaved]);
  const onArchiveSaved = useCallback(() => handleSaved("Archived"), [handleSaved]);
  const onReactivateSaved = useCallback(() => handleSaved("Reactivated"), [handleSaved]);
  const onAddSaved = useCallback(() => handleSaved("Added"), [handleSaved]);

  const closePanel = useCallback(() => setOpenPanel(null), []);
  const isOpen = useCallback((kind, id) => openPanel?.kind === kind && openPanel?.id === id, [openPanel]);
  const toggleOpen = useCallback((kind, id) => {
    setOpenPanel((prev) => (prev?.kind === kind && prev?.id === id ? null : { kind, id }));
  }, []);

  const toggleRow = useCallback((id) => {
    setOpenRow((prev) => {
      if (prev === id) {
        // Closing the row also closes any panel scoped to this row.
        setOpenPanel((p) => (p?.id === id ? null : p));
        return null;
      }
      // Opening a different row: close panels scoped to the prior row
      // so the editor never shows two row details simultaneously.
      setOpenPanel((p) => (p?.id !== id ? null : p));
      return id;
    });
  }, []);

  // Group services by groupId. Bundle 2: archived services are rendered
  // visible-but-marked (NOT skipped). The pre-existing active=false skip
  // is dropped because no UI surface today flips active and the field is
  // documented as a UI-only toggle, separate from the active_until archive.
  const groupOrder = useMemo(
    () => (data?.groups || []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
    [data]
  );
  const servicesByGroup = useMemo(() => {
    const m = new Map();
    for (const s of data?.services || []) {
      if (!m.has(s.groupId)) m.set(s.groupId, []);
      m.get(s.groupId).push(s);
    }
    // Sort each group's services: active first (by sortOrder), then
    // archived (by archive date desc, most recently archived first).
    for (const arr of m.values()) {
      arr.sort((a, b) => {
        const aArc = archiveStatus(a.activeUntil, today).state === "archived" ? 1 : 0;
        const bArc = archiveStatus(b.activeUntil, today).state === "archived" ? 1 : 0;
        if (aArc !== bArc) return aArc - bArc;
        if (aArc === 1) {
          return String(b.activeUntil).localeCompare(String(a.activeUntil));
        }
        return a.sortOrder - b.sortOrder;
      });
    }
    return m;
  }, [data, today]);

  // Flat list of visible service ids in render order (active groups +
  // their services). Drives keyboard focus navigation (ArrowUp/Down).
  const visibleServiceIds = useMemo(() => {
    const ids = [];
    for (const g of groupOrder) {
      for (const s of servicesByGroup.get(g.id) || []) ids.push(s.id);
    }
    return ids;
  }, [groupOrder, servicesByGroup]);

  // Keyboard nav (ItemCatalog parity):
  //   ArrowDown - move focus to next service row
  //   ArrowUp   - move focus to prior service row
  //   Enter     - toggle the focused row's detail
  //   Escape    - close any open detail + panel
  const handleKeyDown = useCallback((e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIdx((p) => Math.min(p + 1, visibleServiceIds.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIdx((p) => Math.max(p === -1 ? 0 : p - 1, 0));
    } else if (e.key === "Enter" && focusIdx >= 0) {
      e.preventDefault();
      const id = visibleServiceIds[focusIdx];
      if (id) toggleRow(id);
    } else if (e.key === "Escape") {
      setOpenPanel(null);
      setOpenRow(null);
      setFocusIdx(-1);
    }
  }, [focusIdx, visibleServiceIds, toggleRow]);

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
    <div
      className="sc-admin-editor"
      ref={editorRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
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
              {/* Header band: light fill, navy left-accent, group title +
                  group-level archive/reactivate action. */}
              <div className="sc-admin-group-header-band">
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
              </div>

              {/* Body: white svc-list of click-to-expand rows (PR #245). */}
              <ul className="sc-admin-svc-list">
                {svcs.map((s) => {
                  const svcStatus = archiveStatus(s.activeUntil, today);
                  const svcArchived = svcStatus.state === "archived";
                  const rowExpanded = openRow === s.id;
                  const focusIndex = visibleServiceIds.indexOf(s.id);
                  const rowFocused = focusIndex >= 0 && focusIndex === focusIdx;
                  const itemClass = [
                    "sc-admin-svc-item",
                    rowExpanded ? "sc-admin-svc-item--open" : "",
                    rowFocused ? "sc-admin-svc-item--focused" : "",
                    svcArchived ? "sc-admin-svc-item--archived" : "",
                  ].filter(Boolean).join(" ");

                  return (
                    <li key={s.id} className={itemClass}>
                      {/* The row itself is the click target (ItemCatalog
                          pattern). Action buttons live INSIDE the detail
                          strip below, not on the row at rest. */}
                      <div
                        className="sc-admin-svc-row"
                        role="button"
                        tabIndex={0}
                        aria-expanded={rowExpanded}
                        onClick={() => toggleRow(s.id)}
                        onKeyDown={(e) => {
                          if (e.key === " ") {
                            e.preventDefault();
                            toggleRow(s.id);
                          }
                        }}
                      >
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
                      </div>

                      {rowExpanded && (
                        // ItemCatalog .ic-detail equivalent. Inline strip
                        // with the current-price line + action triggers.
                        // stopPropagation so interacting inside the strip
                        // (text inputs in the edit panels) does not
                        // toggle the row.
                        <div
                          className="sc-admin-svc-detail"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="sc-admin-svc-detail-meta">
                            <span className="sc-admin-svc-detail-label">Current price</span>
                            <span className="sc-admin-svc-detail-value">
                              {fmtPrice(s.price)}
                              {s.priceSinceDate && (
                                <span className="sc-admin-svc-detail-since"> · since {fmtDate(s.priceSinceDate)}</span>
                              )}
                            </span>
                          </div>

                          <div className="sc-admin-svc-detail-actions">
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
                              <>
                                <button
                                  type="button"
                                  className="sc-admin-svc-edit"
                                  onClick={() => toggleOpen("editPrice", s.id)}
                                  aria-expanded={isOpen("editPrice", s.id)}
                                >
                                  {isOpen("editPrice", s.id) ? "Close edit" : "Edit price"}
                                </button>
                                <button
                                  type="button"
                                  className="sc-admin-svc-edit sc-admin-svc-edit--danger"
                                  onClick={() => toggleOpen("archiveService", s.id)}
                                  aria-expanded={isOpen("archiveService", s.id)}
                                  disabled={grpArchived}
                                  title={grpArchived ? "Reactivate the group first" : ""}
                                >
                                  {isOpen("archiveService", s.id) ? "Close" : "Archive service"}
                                </button>
                              </>
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
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              {/* Footer band: light fill, Add service link + (when open)
                  the AddServicePanel form. */}
              {!grpArchived && (
                <div className="sc-admin-group-footer">
                  <div className="sc-admin-add-row">
                    <button
                      type="button"
                      className="sc-admin-add-link"
                      onClick={() => toggleOpen("addService", g.id)}
                    >
                      {isOpen("addService", g.id) ? "Close" : "+ Add service"}
                    </button>
                  </div>
                  {isOpen("addService", g.id) && (
                    <AddServicePanel
                      accountKey={accountKey}
                      group={g}
                      onCancel={closePanel}
                      onSaved={onAddSaved}
                      showToast={showToast}
                    />
                  )}
                </div>
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
