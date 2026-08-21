"use client";
// SC Admin - catalog pane (center). Renders the group cards + service
// rows with one shared 1fr/104/108/96 grid across header and rows
// (spec §Symmetry). Owns the row-selection + keyboard-cursor state
// via props from the host. Search filters the current account's
// catalog; empty-search renders an inline empty card.
//
// Fee accounts (feeNoDollar=true) get the same catalog pane, read-
// only, with no Price column at all (Kevin ruling #5).

import { useMemo } from "react";

const BADGE_ACTIVE = "scav-badge scav-badge--ok";
const BADGE_SCHED = "scav-badge scav-badge--sch";
const BADGE_ARC = "scav-badge scav-badge--arc";

function fmtPrice(n) { return "$" + Number(n).toFixed(2); }
function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, day] = String(iso).slice(0, 10).split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[Number(m) - 1]} ${Number(day)}, ${y}`;
}
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function archiveStatus(activeUntil, today) {
  if (!activeUntil) return { state: "active" };
  const date = String(activeUntil).slice(0, 10);
  if (date > today) return { state: "active", scheduled: date };
  return { state: "archived", since: date };
}

export default function CatalogPane({
  accountKey,
  accountName,
  accountLevel,
  billingModel,
  data,               // { groups, services } from sc-admin-account-config
  feeNoDollar,        // fee accounts drop the Price column
  loading,
  error,
  onRetry,
  search,
  onSearchChange,     // PR-N audit P0-1: search input moved into this pane
  onClearSearch,
  searchInputRef,     // exposed so "/" hotkey in AdminPanel can focus
  selectedServiceId,
  kbFocusServiceId,   // for the navy keyboard cursor
  onSelectService,    // (serviceId, { groupName, kb: bool }) => void
  onAddService,       // (group) => void - opens modal
  onAddGroup,         // () => void
  onArchiveGroup,     // (group) => void
  onReactivateGroup,  // (group) => void
}) {
  const today = useMemo(() => localToday(), []);

  if (loading) return <CatalogSkeleton />;
  if (error) return (
    <div className="scav-cat">
      <div className="scav-cat-error">
        <div className="t">Could not load {accountKey}</div>
        <div className="d">Nothing was changed. The catalog is still safe.</div>
        <button type="button" className="scav-ghost" style={{ marginTop: "var(--sc2-space-3)" }} onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
  if (!data) return null;

  const groups = data.groups || [];
  const services = data.services || [];
  const servicesByGroup = new Map();
  for (const g of groups) servicesByGroup.set(g.id, []);
  for (const s of services) {
    if (!servicesByGroup.has(s.groupId)) servicesByGroup.set(s.groupId, []);
    servicesByGroup.get(s.groupId).push(s);
  }

  // Filter by search across service+group name.
  const q = search.trim().toLowerCase();
  const matches = (s, g) => !q || (s.serviceName + " " + g.groupName).toLowerCase().includes(q);
  const filteredGroups = groups.map((g) => ({
    group: g,
    services: (servicesByGroup.get(g.id) || []).filter((s) => matches(s, g)),
  })).filter((row) => row.services.length > 0 || (!q && (servicesByGroup.get(row.group.id) || []).length === 0));

  const totalVisible = filteredGroups.reduce((a, r) => a + r.services.length, 0);
  const scheduledCount = services.filter((s) => s.upcomingPrice != null).length;
  const totalActual = services.length;
  const grpCount = groups.length;

  const badge = billingModel === "flat_fee" ? "FEE ACCOUNT" : "PER-MEAL";

  return (
    <section className="scav-cat" aria-label="Catalog">
      <div className="scav-cat-head">
        <h2>{accountKey}</h2>
        <span className="scav-cat-name">{accountName}</span>
        <span className="scav-cat-badge">{badge}</span>
      </div>
      <div className="scav-cat-sub-row">
        <div className="scav-cat-sub">
          {totalActual} service{totalActual === 1 ? "" : "s"} in {grpCount} group{grpCount === 1 ? "" : "s"}
          {scheduledCount > 0 && <> &middot; {scheduledCount} scheduled</>}
          {q && <> &middot; filtered by &ldquo;{search}&rdquo;</>}
        </div>
        <div className="scav-cat-search">
          <input
            ref={searchInputRef}
            id="scav-search-input"
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Find a service in this account"
            aria-label="Find a service in this account's catalog"
          />
          <span className="k" aria-hidden="true">/</span>
        </div>
      </div>

      {q && totalVisible === 0 ? (
        <div className="scav-cat-empty">
          {/* PR-N (2026-08-21): copy MUST match the build's actual
              scope. Cross-account search is deferred behind a new
              endpoint (see docs/backlog/CROSS_ACCOUNT_ADMIN_SEARCH.md).
              A screen promising cross-account search that does not do
              it is worse than one that does not promise it. */}
          <div className="t">No service matches &ldquo;{search}&rdquo; in this account&apos;s catalog</div>
          <div className="d">Clear the search to see the full catalog, or pick a different account from the rail.</div>
          <button type="button" className="scav-ghost" style={{ marginTop: "var(--sc2-space-3)" }} onClick={onClearSearch}>
            Clear search
          </button>
        </div>
      ) : groups.length === 0 ? (
        <div className="scav-cat-empty">
          <div className="t">No services yet</div>
          <div className="d">Add a group first, then the services that sit inside it.</div>
          <button type="button" className="scav-ghost" style={{ marginTop: "var(--sc2-space-3)" }} onClick={onAddGroup}>
            Add the first group
          </button>
        </div>
      ) : (
        <>
          {filteredGroups.map(({ group: g, services: svcs }) => {
            const grpStatus = archiveStatus(g.activeUntil, today);
            const grpArchived = grpStatus.state === "archived";
            const activeSvcCount = (servicesByGroup.get(g.id) || []).filter((s) => archiveStatus(s.activeUntil, today).state !== "archived").length;
            const gsch = svcs.filter((s) => s.upcomingPrice != null).length;
            return (
              <div key={g.id} className="scav-group-card">
                <div className="scav-group-hd">
                  <h3>{g.groupName}</h3>
                  <span className="b">{(accountLevel || "").toUpperCase() === "PDC" ? "PDC" : accountLevel}</span>
                  <span className="scav-grow" />
                  {grpArchived ? (
                    <button type="button" className="scav-ghost" onClick={() => onReactivateGroup(g)}>
                      Reactivate group
                    </button>
                  ) : (
                    <>
                      <button type="button" className="scav-ghost" onClick={() => onAddService(g)}>Add service</button>
                      <button
                        type="button"
                        className="scav-ghost scav-ghost--danger"
                        onClick={() => onArchiveGroup(g)}
                        disabled={activeSvcCount === 0}
                        title={activeSvcCount === 0 ? "No active services to archive" : ""}
                      >
                        Archive group
                      </button>
                    </>
                  )}
                </div>
                <div className="scav-colhd">
                  <span>Service</span>
                  {!feeNoDollar && <span className="r">Price</span>}
                  {feeNoDollar && <span className="r">&nbsp;</span>}
                  <span className="r">Effective</span>
                  <span className="r">Status</span>
                </div>
                {svcs.map((s) => {
                  const svcStatus = archiveStatus(s.activeUntil, today);
                  const svcArchived = svcStatus.state === "archived";
                  const st = svcArchived
                    ? <span className={BADGE_ARC}>Archived</span>
                    : s.upcomingPrice != null
                      ? <span className={BADGE_SCHED}>Scheduled</span>
                      : <span className={BADGE_ACTIVE}>Active</span>;
                  const isCurrent = selectedServiceId === s.id;
                  const isKb = kbFocusServiceId === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={"scav-srow" + (svcArchived ? " arc" : "")}
                      aria-current={isCurrent}
                      data-kb={isKb}
                      data-service-id={s.id}
                      onClick={() => onSelectService(s.id, { groupName: g.groupName, service: s })}
                    >
                      <span className="scav-srow-nm">
                        {s.serviceName}
                        {s.isTaxFree && <em>tax-free</em>}
                        {s.isNonRevenue && <em>non-rev</em>}
                      </span>
                      {!feeNoDollar && <span className="scav-srow-pr">{fmtPrice(s.price)}</span>}
                      {feeNoDollar && <span className="scav-srow-pr">&nbsp;</span>}
                      <span className="scav-srow-ef">{fmtDate(s.priceSinceDate || s.activeSince || "")}</span>
                      <span className="scav-srow-st">{st}</span>
                    </button>
                  );
                })}
                <div className="scav-group-ft">
                  <span><b>{svcs.length}</b> service{svcs.length === 1 ? "" : "s"}</span>
                  <span>{gsch > 0 && <><b>{gsch}</b> scheduled</>}</span>
                </div>
              </div>
            );
          })}
          {!q && groups.length > 0 && (
            <button type="button" className="scav-add-group" onClick={onAddGroup}>
              + Add group
            </button>
          )}
        </>
      )}
    </section>
  );
}

function CatalogSkeleton() {
  return (
    <div className="scav-cat">
      <div className="scav-sk" style={{ height: 22, width: "40%" }} />
      <div className="scav-sk" style={{ height: 12, width: "26%", marginTop: 8 }} />
      <div style={{
        border: "1px solid var(--sc2-line)",
        borderRadius: "var(--sc2-radius-container)",
        marginTop: 14,
        overflow: "hidden",
      }}>
        <div style={{ background: "var(--sc2-band-cream-bg)", padding: "12px 14px", borderBottom: "1px solid var(--sc2-band-cream-bd)" }}>
          <div className="scav-sk" style={{ height: 15, width: "34%" }} />
        </div>
        <div style={{ padding: "10px 14px" }}><div className="scav-sk" style={{ height: 14 }} /></div>
        <div style={{ padding: "10px 14px" }}><div className="scav-sk" style={{ height: 14 }} /></div>
        <div style={{ padding: "10px 14px" }}><div className="scav-sk" style={{ height: 14 }} /></div>
      </div>
    </div>
  );
}
