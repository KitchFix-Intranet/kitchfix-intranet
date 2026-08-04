"use client";
// Catalog section extracted from AccountEditor (2026-08-04, admin
// wave commit 1). Renders the groups + services + add-service +
// add-group scaffolding. Both AccountEditor (per-meal) and
// FeeAccountEditor (flat-fee) mount this. No re-authoring of the
// per-meal path - the group cards, the service rows, the progressive
// disclosure, and the add + archive panels are the exact same code
// AccountEditor shipped, now under one roof for both editors.
//
// feeNoDollar prop: when true, no dollar figure renders anywhere in
// this section. That means:
//   - the per-row price ($X.XX span) is hidden
//   - the expanded-row "Current price" line is hidden
//   - the "Edit price" button is hidden (there is no PriceEditPanel
//     mount to hide because it never renders)
//   - the header subtitle reads "Catalog" instead of "Prices & catalog"
//   - AddServicePanel is passed feeNoDollar so its initial-price
//     field is hidden and the create posts price=0
// Everything else (group cards, add / archive / reactivate service,
// add / archive / reactivate group) works identically on both
// editor types.
//
// Owner ruling 2026-08-04: no price editing on a fee account, and
// this ruling applies to ALL flat_fee accounts, not only fee-no-
// dollar. Reason: the annual fee is the billing on those accounts;
// any per-service price is irrelevant to what they invoice. If an
// MLB fee account is discovered to carry non-zero prices in the
// live data, that is a case the wave report flagged - the resolution
// is still "no price editing here," but it may motivate a separate
// investigation into what those prices are being used for.

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

// Archive status against today.
function archiveStatus(activeUntil, today) {
  if (!activeUntil) return { state: "active" };
  const date = String(activeUntil).slice(0, 10);
  if (date > today) return { state: "active", scheduled: date };
  return { state: "archived", since: date };
}

export default function AccountCatalogSection({
  accountKey,
  data,
  onReload,
  showToast,
  feeNoDollar = false,
}) {
  const [openPanel, setOpenPanel] = useState(null);
  const [openRow, setOpenRow] = useState(null);
  const [focusIdx, setFocusIdx] = useState(-1);
  const editorRef = useRef(null);
  const today = useMemo(() => localToday(), []);

  const handleSaved = useCallback((message) => {
    setOpenPanel(null);
    setOpenRow(null);
    onReload?.();
    showToast(message || "Saved", "success");
  }, [showToast, onReload]);

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
        setOpenPanel((p) => (p?.id === id ? null : p));
        return null;
      }
      setOpenPanel((p) => (p?.id !== id ? null : p));
      return id;
    });
  }, []);

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

  const visibleServiceIds = useMemo(() => {
    const ids = [];
    for (const g of groupOrder) {
      for (const s of servicesByGroup.get(g.id) || []) ids.push(s.id);
    }
    return ids;
  }, [groupOrder, servicesByGroup]);

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

  if (!data) return null;

  return (
    <div
      className="sc-admin-catalog-section"
      ref={editorRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
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
                        {/* feeNoDollar path drops both the scheduled-price
                            annotation and the current-price cell so no
                            dollar figure appears on the row at rest. */}
                        {!feeNoDollar && !svcArchived && s.upcomingPrice !== null && (
                          <span className="sc-admin-svc-upcoming" title={`Scheduled change: ${fmtPrice(s.upcomingPrice)} on ${fmtDate(s.upcomingEffectiveDate)}`}>
                            scheduled {fmtPrice(s.upcomingPrice)} {fmtDate(s.upcomingEffectiveDate)}
                          </span>
                        )}
                        {!feeNoDollar && (
                          <span className="sc-admin-svc-price">{fmtPrice(s.price)}</span>
                        )}
                      </div>

                      {rowExpanded && (
                        <div
                          className="sc-admin-svc-detail"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {!feeNoDollar && (
                            <div className="sc-admin-svc-detail-meta">
                              <span className="sc-admin-svc-detail-label">Current price</span>
                              <span className="sc-admin-svc-detail-value">
                                {fmtPrice(s.price)}
                                {s.priceSinceDate && (
                                  <span className="sc-admin-svc-detail-since"> · since {fmtDate(s.priceSinceDate)}</span>
                                )}
                              </span>
                            </div>
                          )}

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
                                {!feeNoDollar && (
                                  <button
                                    type="button"
                                    className="sc-admin-svc-edit"
                                    onClick={() => toggleOpen("editPrice", s.id)}
                                    aria-expanded={isOpen("editPrice", s.id)}
                                  >
                                    {isOpen("editPrice", s.id) ? "Close edit" : "Edit price"}
                                  </button>
                                )}
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

                          {!feeNoDollar && isOpen("editPrice", s.id) && (
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
                      feeNoDollar={feeNoDollar}
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
