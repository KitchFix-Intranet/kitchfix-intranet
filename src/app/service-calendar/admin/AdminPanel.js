"use client";
// SC Admin - three-pane host.
// Replaces the retired three-mode switch. Accounts rail (left) +
// catalog pane (center) + editor rail (right). Selection is state,
// not a route. Command bar sits above the three panes with global
// counts, cross-account SEARCH placeholder (single-account today
// per fence: no new endpoint), and Calendar back-link.
//
// Fence: no migration, no API change, no new endpoint. Payload
// shapes to existing endpoints unchanged.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AccountsRail from "./AccountsRail";
import CatalogPane from "./CatalogPane";
import EditorRail from "./EditorRail";
import {
  AddServiceModal,
  AddGroupModal,
  ArchiveGroupModal,
  ReactivateGroupModal,
} from "./AdminModals";
import LaborBudgetsPanel from "./LaborBudgetsPanel";
import "./ops-sc-admin.css";
import "./admin.css";

// Guard overlay - renders on top of the current rail variant so the
// underlying form stays MOUNTED (state preserved for "Go back").
function GuardOverlay({ pending, onBack, onDiscard }) {
  const backRef = useRef(null);
  useEffect(() => { backRef.current?.focus(); }, []);
  return (
    <div
      className="scav-insp-scroll"
      data-rail-variant="guard"
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--sc2-rail-bg)",
        zIndex: 10,
      }}
      role="alertdialog"
      aria-modal="true"
      aria-label="Unsaved change"
    >
      <div className="scav-fadein">
        <div className="scav-kick">Unsaved change</div>
        <div className="scav-ih">Hold on</div>
        <div className="scav-warn bad" style={{ marginTop: "var(--sc2-space-4)" }}>
          <span>&#9888;</span>
          <span>
            <b>You have an unsaved change</b><br />
            It has not been saved yet. Discard it and {pending?.label || "move on"}, or go back and save.
          </span>
        </div>
        <div style={{ display: "flex", gap: "var(--sc2-space-2)", marginTop: "var(--sc2-space-4)" }}>
          <button
            ref={backRef}
            type="button"
            className="scav-ghost"
            style={{ flex: 1 }}
            onClick={onBack}
          >
            Go back
          </button>
          <button
            type="button"
            className="scav-save scav-save--danger"
            style={{ margin: 0, flex: 1, fontSize: "var(--sc2-size-body)" }}
            onClick={onDiscard}
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
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

export default function AdminPanel({ view, onViewChange, showToast }) {
  // Bootstrap: all accounts + fee list, once. Kevin ruling gap 7:
  // command-bar + accounts-rail-footer counts come from this single
  // load; no per-account fetches for the counts.
  const [bootLoading, setBootLoading] = useState(true);
  const [bootError, setBootError] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [feeByKey, setFeeByKey] = useState({});
  const [bootReloadKey, setBootReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBootLoading(true);
    setBootError(null);
    Promise.all([
      fetch("/api/service-calendar?action=sc-admin-all-config", { signal: controller.signal }).then((r) => r.json()),
      fetch("/api/service-calendar?action=sc-admin-fee-list", { signal: controller.signal }).then((r) => r.json()),
    ])
      .then(([cfgRes, feeRes]) => {
        if (!cfgRes.success) { setBootError(cfgRes.error || "Failed to load"); return; }
        setAccounts(cfgRes.accounts || []);
        if (feeRes.success) {
          const idx = {};
          for (const f of feeRes.fees || []) idx[f.accountKey] = f;
          setFeeByKey(idx);
        }
      })
      .catch((e) => { if (e.name !== "AbortError") setBootError("Network error"); })
      .finally(() => { if (!controller.signal.aborted) setBootLoading(false); });
    return () => controller.abort();
  }, [bootReloadKey]);

  // Selection state.
  const [activeAccountKey, setActiveAccountKey] = useState(view?.key || null);
  const [selectedServiceId, setSelectedServiceId] = useState(null);
  const [search, setSearch] = useState("");
  const [dirty, setDirty] = useState(false);
  const [guardPending, setGuardPending] = useState(null);   // { label, resume }
  const [modal, setModal] = useState(null);                  // { kind, ... }
  const [laborRailOpen, setLaborRailOpen] = useState(false);
  const [archiveRail, setArchiveRail] = useState(null);      // null | "today" | "future"

  // Per-account catalog fetch.
  const [catalogData, setCatalogData] = useState(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState(null);
  const [catReloadKey, setCatReloadKey] = useState(0);

  useEffect(() => {
    if (!activeAccountKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCatalogData(null);
      setCatalogError(null);
      setCatalogLoading(false);
      return;
    }
    const controller = new AbortController();
    setCatalogLoading(true);
    setCatalogError(null);
    fetch(`/api/service-calendar?action=sc-admin-account-config&account=${encodeURIComponent(activeAccountKey)}`,
      { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) { setCatalogError(d.error || "Failed to load"); setCatalogData(null); return; }
        setCatalogData(d);
      })
      .catch((e) => { if (e.name !== "AbortError") setCatalogError("Network error"); })
      .finally(() => { if (!controller.signal.aborted) setCatalogLoading(false); });
    return () => controller.abort();
  }, [activeAccountKey, catReloadKey]);

  const activeAccount = useMemo(
    () => accounts.find((a) => a.key === activeAccountKey) || null,
    [accounts, activeAccountKey],
  );

  // Derived totals for the counts block.
  const totalServices = useMemo(
    () => accounts.reduce((sum, a) => sum + (a.services?.length || 0), 0),
    [accounts],
  );
  const totalScheduled = useMemo(() => {
    let n = 0;
    for (const a of accounts) {
      for (const s of a.services || []) {
        if (s.upcomingPrice != null) n++;
      }
    }
    return n;
  }, [accounts]);

  // Row navigation - visible service ids in current-account catalog.
  const today = useMemo(() => localToday(), []);
  const visibleServiceIds = useMemo(() => {
    if (!catalogData) return [];
    const ids = [];
    const groups = catalogData.groups || [];
    const services = catalogData.services || [];
    const byGroup = new Map();
    for (const g of groups) byGroup.set(g.id, []);
    for (const s of services) {
      if (!byGroup.has(s.groupId)) byGroup.set(s.groupId, []);
      byGroup.get(s.groupId).push(s);
    }
    const q = search.trim().toLowerCase();
    for (const g of groups) {
      for (const s of byGroup.get(g.id) || []) {
        if (!q || (s.serviceName + " " + g.groupName).toLowerCase().includes(q)) {
          ids.push(s.id);
        }
      }
    }
    return ids;
  }, [catalogData, search]);

  const [kbFocusIdx, setKbFocusIdx] = useState(-1);
  const kbFocusServiceId = kbFocusIdx >= 0 ? visibleServiceIds[kbFocusIdx] : null;

  const selectedService = useMemo(() => {
    if (!selectedServiceId || !catalogData) return null;
    const s = (catalogData.services || []).find((x) => x.id === selectedServiceId);
    if (!s) return null;
    const g = (catalogData.groups || []).find((x) => x.id === s.groupId);
    return { ...s, groupName: g?.groupName || "" };
  }, [selectedServiceId, catalogData]);

  // ─────────────── guard-aware transitions ───────────────
  const runOrGuard = useCallback((label, resume) => {
    if (dirty) {
      setGuardPending({ label, resume });
    } else {
      resume();
    }
  }, [dirty]);

  const handleSelectAccount = useCallback((key) => {
    runOrGuard(`switch to ${key}`, () => {
      setActiveAccountKey(key);
      setSelectedServiceId(null);
      setKbFocusIdx(-1);
      setLaborRailOpen(false);
      onViewChange?.({ mode: "admin", key });
    });
  }, [runOrGuard, onViewChange]);

  const handleSelectService = useCallback((serviceId, { service } = {}) => {
    // PR-N audit P1-5 (2026-08-21): keyboard cursor and mouse
    // selection are DISTINCT states per spec (green = what is open;
    // navy = where the keyboard cursor is). Do NOT auto-move the
    // kb cursor to the clicked row - that collapses the two states
    // into one and the navy [data-kb] rule then masks the green
    // [aria-current] rule via CSS cascade order. Keyboard cursor
    // moves only via arrow keys.
    runOrGuard(`open ${service?.serviceName || "this service"}`, () => {
      setSelectedServiceId(serviceId);
      setLaborRailOpen(false);
    });
  }, [runOrGuard]);

  const handleGuardBack = useCallback(() => {
    setGuardPending(null);
  }, []);
  const handleGuardDiscard = useCallback(() => {
    const pending = guardPending;
    setDirty(false);
    setGuardPending(null);
    if (pending?.resume) pending.resume();
  }, [guardPending]);

  // ─────────────── keyboard ───────────────
  const searchInputRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      const isEditable =
        document.activeElement &&
        (document.activeElement.tagName === "INPUT"
          || document.activeElement.tagName === "TEXTAREA"
          || document.activeElement.isContentEditable);
      if (e.key === "/" && !isEditable) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (isEditable) return;
      if (guardPending) return;
      if (!visibleServiceIds.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setKbFocusIdx((i) => Math.min(visibleServiceIds.length - 1, (i < 0 ? -1 : i) + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setKbFocusIdx((i) => Math.max(0, (i < 0 ? 0 : i - 1)));
      } else if (e.key === "Enter" && kbFocusIdx >= 0) {
        e.preventDefault();
        const sid = visibleServiceIds[kbFocusIdx];
        if (sid) handleSelectService(sid, { service: (catalogData?.services || []).find((x) => x.id === sid) });
      } else if (e.key === "Escape") {
        if (dirty) {
          setGuardPending({ label: "clear the selection", resume: () => { setSelectedServiceId(null); setKbFocusIdx(-1); } });
        } else {
          setSelectedServiceId(null);
          setKbFocusIdx(-1);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visibleServiceIds, kbFocusIdx, catalogData, guardPending, dirty, handleSelectService]);

  useEffect(() => {
    // Scroll the keyboard-focused row into view when it changes.
    if (kbFocusServiceId) {
      const el = document.querySelector(`[data-service-id="${kbFocusServiceId}"]`);
      if (el && "scrollIntoView" in el) el.scrollIntoView({ block: "nearest" });
    }
  }, [kbFocusServiceId]);

  // ─────────────── success handlers ───────────────
  const handleSaved = useCallback(() => {
    setDirty(false);
    setArchiveRail(null);
    setCatReloadKey((k) => k + 1);
    setBootReloadKey((k) => k + 1);
  }, []);
  const handleModalSaved = useCallback(() => {
    setDirty(false);
    setModal(null);
    setCatReloadKey((k) => k + 1);
    setBootReloadKey((k) => k + 1);
  }, []);

  // ─────────────── render ───────────────
  const activeAccountLevel = activeAccount?.level || activeAccount?.category || "";
  const activeAccountBillingModel = activeAccount?.billingModel || null;
  const isFee = activeAccountBillingModel === "flat_fee";
  const feeData = isFee ? (feeByKey[activeAccountKey] || null) : null;

  // Rail variant. Kept independent of guard state so the underlying
  // form stays MOUNTED when the guard fires - guard renders as an
  // overlay in the same .scav-insp container. Preserves form state
  // across guard cycles (N4: "Go back preserves the edit").
  let railVariant = "empty";
  if (!activeAccountKey) railVariant = "empty";
  else if (isFee && !selectedServiceId) railVariant = "fee";
  else if (selectedServiceId) {
    if (catalogLoading) railVariant = "loading";
    else if (selectedService) {
      const svcStatus = archiveStatus(selectedService.activeUntil, today);
      if (svcStatus.state === "archived") railVariant = "archived";
      else if (archiveRail) railVariant = "archiveService";
      else railVariant = "service";
    }
  }

  return (
    <div className="scav" role="application" aria-label="SC Admin">
      {/* PR-N audit P0-1 fix (2026-08-21): inner command bar deleted.
          The calendar shell already carries product name, admin mode
          chip, account context (via the highlighted accounts-rail
          row), freshness stamp, and back arrow. Two command bars
          stacked read as a widget inside a widget. Search moved to
          the catalog header where it is anchored to the thing it
          filters. Counts moved to the accounts-rail footer only. */}
      <AccountsRail
        accounts={accounts}
        activeAccountKey={activeAccountKey}
        onSelectAccount={handleSelectAccount}
        totalServices={totalServices}
        totalScheduled={totalScheduled}
      />
      {!activeAccountKey ? (
        <div className="scav-cat">
          {bootLoading ? (
            <div className="scav-sk" style={{ height: 22, width: "40%" }} />
          ) : bootError ? (
            <div className="scav-cat-error">
              <div className="t">Could not load accounts</div>
              <div className="d">{bootError}</div>
              <button type="button" className="scav-ghost" style={{ marginTop: "var(--sc2-space-3)" }}
                onClick={() => setBootReloadKey((k) => k + 1)}>Try again</button>
            </div>
          ) : (
            <div className="scav-cat-empty">
              <div className="t">Pick an account</div>
              <div className="d">Choose an account on the left to view its catalog.</div>
            </div>
          )}
        </div>
      ) : (
        <CatalogPane
          accountKey={activeAccountKey}
          accountName={activeAccount?.name}
          accountLevel={activeAccountLevel}
          billingModel={activeAccountBillingModel}
          data={catalogData}
          feeNoDollar={isFee}
          loading={catalogLoading}
          error={catalogError}
          onRetry={() => setCatReloadKey((k) => k + 1)}
          search={search}
          onSearchChange={setSearch}
          onClearSearch={() => setSearch("")}
          searchInputRef={searchInputRef}
          selectedServiceId={selectedServiceId}
          kbFocusServiceId={kbFocusServiceId}
          onSelectService={handleSelectService}
          onAddService={(g) => setModal({ kind: "addService", group: g })}
          onAddGroup={() => setModal({ kind: "addGroup" })}
          onArchiveGroup={(g) => {
            const active = (catalogData?.services || []).filter(
              (s) => s.groupId === g.id && archiveStatus(s.activeUntil, today).state !== "archived",
            ).length;
            setModal({ kind: "archiveGroup", group: g, activeServiceCount: active });
          }}
          onReactivateGroup={(g) => setModal({ kind: "reactivateGroup", group: g })}
        />
      )}

      <div className="scav-insp" style={{ position: "relative" }}>
        {laborRailOpen && isFee ? (
          <>
            <div className="scav-insp-scroll">
              <div className="scav-fadein">
                <div className="scav-kick">MLB</div>
                <div className="scav-ih">Labor budgets</div>
                <div className="scav-im">{activeAccountKey}</div>
                <div style={{ marginTop: "var(--sc2-space-4)", background: "var(--sc2-surface-card)", borderRadius: "var(--sc2-radius-container)", padding: "var(--sc2-space-3)" }}>
                  <LaborBudgetsPanel accountKey={activeAccountKey} showToast={showToast} />
                </div>
              </div>
            </div>
            <div className="scav-insp-foot">
              <button type="button" onClick={() => setLaborRailOpen(false)}>Back to fee editor</button>
            </div>
          </>
        ) : (
          <>
            <EditorRail
              variant={railVariant}
              accountKey={activeAccountKey}
              account={activeAccount}
              service={selectedService}
              feeData={feeData}
              onSaved={handleSaved}
              showToast={showToast}
              onDirtyChange={setDirty}
              onOpenLaborBudgets={() => setLaborRailOpen(true)}
              onOpenFeeHistory={() => showToast({ variant: "generic", tier: "warn", title: "Fee history view", detail: "Design pending. Data lives in sc_config_changelog." })}
              onOpenViewHistory={() => showToast({ variant: "generic", tier: "warn", title: "History view", detail: "Design pending. Data lives in sc_config_changelog." })}
              onOpenScheduleArchive={() => { if (selectedService) setArchiveRail("future"); }}
              onOpenArchiveNow={() => { if (selectedService) setArchiveRail("today"); }}
              archiveInitialMode={archiveRail || "today"}
              onCancelArchive={() => setArchiveRail(null)}
            />
            {guardPending && (
              <GuardOverlay pending={guardPending} onBack={handleGuardBack} onDiscard={handleGuardDiscard} />
            )}
          </>
        )}
      </div>

      {/* ── Modals ── */}
      {modal?.kind === "addService" && (
        <AddServiceModal
          accountKey={activeAccountKey}
          group={modal.group}
          feeNoDollar={isFee}
          onClose={() => setModal(null)}
          onSaved={handleModalSaved}
          showToast={showToast}
        />
      )}
      {modal?.kind === "addGroup" && (
        <AddGroupModal
          accountKey={activeAccountKey}
          onClose={() => setModal(null)}
          onSaved={handleModalSaved}
          showToast={showToast}
        />
      )}
      {modal?.kind === "archiveGroup" && (
        <ArchiveGroupModal
          accountKey={activeAccountKey}
          group={modal.group}
          activeServiceCount={modal.activeServiceCount}
          onClose={() => setModal(null)}
          onSaved={handleModalSaved}
          showToast={showToast}
        />
      )}
      {modal?.kind === "reactivateGroup" && (
        <ReactivateGroupModal
          accountKey={activeAccountKey}
          group={modal.group}
          onClose={() => setModal(null)}
          onSaved={handleModalSaved}
          showToast={showToast}
        />
      )}
    </div>
  );
}
