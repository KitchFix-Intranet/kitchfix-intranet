"use client";
import { useState, useEffect, useCallback, useMemo } from "react";

const ADMIN_EMAILS = ["k.fietek@kitchfix.com", "joe@kitchfix.com"];

function fmtPrice(n) { return "$" + Number(n).toFixed(2).replace(/\.00$/, ""); }

export default function ServiceConfig({ account, serviceGroups, session, showToast, onClose, onConfigChanged }) {
  const email = session?.user?.email?.toLowerCase().trim() || "";
  const isAdmin = ADMIN_EMAILS.includes(email);

  const [groups, setGroups] = useState([]);
  const [saving, setSaving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(null);
  const [newService, setNewService] = useState({ groupName: "", serviceName: "", price: "", taxFree: false });
  const [newGroupName, setNewGroupName] = useState("");
  const [editPrices, setEditPrices] = useState({});
  const [dirty, setDirty] = useState(false);
  const [showReview, setShowReview] = useState(false);

  const [requestType, setRequestType] = useState("price");
  const [requestDetails, setRequestDetails] = useState({ groupName: "", serviceName: "", newPrice: "", notes: "" });
  const [requestSubmitted, setRequestSubmitted] = useState(false);

  useEffect(() => {
    if (!serviceGroups) return;
    const g = serviceGroups.map(grp => ({
      name: grp.name,
      services: grp.services.map(s => ({ ...s, active: true })),
    }));
    setGroups(g);
    const prices = {};
    for (const grp of serviceGroups) {
      for (const s of grp.services) { prices[`${grp.name}::${s.name}`] = String(s.price); }
    }
    setEditPrices(prices);
    setDirty(false);
  }, [serviceGroups]);

  const handlePriceChange = useCallback((groupName, svcName, value) => {
    const clean = value.replace(/[^0-9.]/g, "");
    setEditPrices(prev => ({ ...prev, [`${groupName}::${svcName}`]: clean }));
    setDirty(true);
  }, []);

  const handleDeactivate = useCallback((groupName, svcName) => {
    setGroups(prev => prev.map(g => g.name === groupName ? {
      ...g, services: g.services.map(s => s.name === svcName ? { ...s, active: !s.active } : s)
    } : g));
    setDirty(true);
  }, []);

  const changes = useMemo(() => {
    const list = [];
    for (const grp of groups) {
      for (const svc of grp.services) {
        const key = `${grp.name}::${svc.name}`;
        const origPrice = serviceGroups?.find(g => g.name === grp.name)?.services.find(s => s.name === svc.name)?.price;
        const newPrice = editPrices[key] !== undefined ? Number(editPrices[key]) : origPrice;
        const origSvc = serviceGroups?.find(g => g.name === grp.name)?.services.find(s => s.name === svc.name);
        if (origPrice !== undefined && newPrice !== origPrice) {
          list.push({ type: "price", groupName: grp.name, serviceName: svc.name, from: origPrice, to: newPrice });
        }
        if (origSvc && !svc.active) {
          list.push({ type: "deactivate", groupName: grp.name, serviceName: svc.name });
        }
      }
    }
    return list;
  }, [groups, editPrices, serviceGroups]);

  const handleSave = useCallback(async () => {
    if (changes.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch("/api/service-calendar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sc-config-update", accountKey: account.key, changes }),
      });
      const result = await res.json();
      if (result.success) { showToast(`${result.updated} config changes saved`, "success"); setShowReview(false); setDirty(false); onConfigChanged(); }
      else showToast(result.error || "Save failed", "error");
    } catch { showToast("Network error", "error"); }
    finally { setSaving(false); }
  }, [changes, account, showToast, onConfigChanged]);

  const handleAddService = useCallback(async () => {
    const groupName = showAddForm === "__new__" ? newGroupName.trim() : showAddForm;
    const { serviceName, price, taxFree } = newService;
    if (!groupName || !serviceName.trim() || !price) { showToast("Fill in all fields", "error"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/service-calendar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sc-config-add", accountKey: account.key, groupName, serviceName: serviceName.trim(), price: Number(price), taxFree }),
      });
      const result = await res.json();
      if (result.success) { showToast(`Added ${serviceName.trim()} to ${groupName}`, "success"); setShowAddForm(null); setNewService({ groupName: "", serviceName: "", price: "", taxFree: false }); setNewGroupName(""); onConfigChanged(); }
      else showToast(result.error || "Failed", "error");
    } catch { showToast("Network error", "error"); }
    finally { setSaving(false); }
  }, [showAddForm, newGroupName, newService, account, showToast, onConfigChanged]);

  const handleRequestSubmit = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/service-calendar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sc-config-request", accountKey: account.key, requestType, ...requestDetails }),
      });
      const result = await res.json();
      if (result.success) { setRequestSubmitted(true); showToast("Request submitted", "success"); }
      else showToast(result.error || "Failed", "error");
    } catch { showToast("Network error", "error"); }
    finally { setSaving(false); }
  }, [account, requestType, requestDetails, showToast]);

  // ── SITE LEAD VIEW ──
  if (!isAdmin) {
    if (requestSubmitted) {
      return (
        <div className="sc-day">
          <div className="sc-day-success-inner">
            <div className="sc-day-success-check">✓</div>
            <h3 className="sc-day-success-title">Request submitted</h3>
            <p className="sc-day-success-detail">Your change request has been sent to the corporate team for review.</p>
            <div className="sc-day-success-actions">
              <button className="sc-btn sc-btn--outline" onClick={onClose}>Close</button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="sc-day">
        <div className="sc-day-header">
          <h3 className="sc-day-title">Request a change</h3>
          <button className="sc-day-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="sc-day-coaching" style={{ background: "#f9fafb", borderColor: "#e5e7eb", color: "#6b7280" }}>
          Submit a change request for {account.name}. Corporate will review and apply.
        </div>
        <div className="sc-day-body">
          <div className="sc-cfg-field">
            <label className="sc-cfg-label">Change type</label>
            <div className="sc-cfg-toggle-group">
              {[["price", "Update price"], ["add", "Add service"], ["remove", "Remove service"]].map(([val, label]) => (
                <button key={val} className={`sc-cfg-toggle ${requestType === val ? "sc-cfg-toggle--active" : ""}`} onClick={() => setRequestType(val)}>{label}</button>
              ))}
            </div>
          </div>
          {requestType === "price" && (
            <>
              <div className="sc-cfg-field">
                <label className="sc-cfg-label">Service group</label>
                <select className="sc-cfg-select" value={requestDetails.groupName} onChange={e => setRequestDetails(p => ({ ...p, groupName: e.target.value }))}>
                  <option value="">Select group...</option>
                  {groups.map(g => <option key={g.name} value={g.name}>{g.name}</option>)}
                </select>
              </div>
              <div className="sc-cfg-field">
                <label className="sc-cfg-label">Service</label>
                <select className="sc-cfg-select" value={requestDetails.serviceName} onChange={e => setRequestDetails(p => ({ ...p, serviceName: e.target.value }))}>
                  <option value="">Select service...</option>
                  {groups.find(g => g.name === requestDetails.groupName)?.services.map(s => (
                    <option key={s.name} value={s.name}>{s.name} (currently {fmtPrice(s.price)})</option>
                  ))}
                </select>
              </div>
              <div className="sc-cfg-field">
                <label className="sc-cfg-label">New price</label>
                <input className="sc-cfg-input" type="text" inputMode="decimal" placeholder="0.00" value={requestDetails.newPrice} onChange={e => setRequestDetails(p => ({ ...p, newPrice: e.target.value.replace(/[^0-9.]/g, "") }))} />
              </div>
            </>
          )}
          {requestType === "add" && (
            <>
              <div className="sc-cfg-field">
                <label className="sc-cfg-label">Service group</label>
                <select className="sc-cfg-select" value={requestDetails.groupName} onChange={e => setRequestDetails(p => ({ ...p, groupName: e.target.value }))}>
                  <option value="">Select group...</option>
                  {groups.map(g => <option key={g.name} value={g.name}>{g.name}</option>)}
                  <option value="__new__">+ New group</option>
                </select>
              </div>
              <div className="sc-cfg-field">
                <label className="sc-cfg-label">Service name</label>
                <input className="sc-cfg-input" type="text" placeholder="e.g. Umpire Meal" value={requestDetails.serviceName} onChange={e => setRequestDetails(p => ({ ...p, serviceName: e.target.value }))} />
              </div>
              <div className="sc-cfg-field">
                <label className="sc-cfg-label">Price</label>
                <input className="sc-cfg-input" type="text" inputMode="decimal" placeholder="0.00" value={requestDetails.newPrice} onChange={e => setRequestDetails(p => ({ ...p, newPrice: e.target.value.replace(/[^0-9.]/g, "") }))} />
              </div>
            </>
          )}
          {requestType === "remove" && (
            <>
              <div className="sc-cfg-field">
                <label className="sc-cfg-label">Service group</label>
                <select className="sc-cfg-select" value={requestDetails.groupName} onChange={e => setRequestDetails(p => ({ ...p, groupName: e.target.value }))}>
                  <option value="">Select group...</option>
                  {groups.map(g => <option key={g.name} value={g.name}>{g.name}</option>)}
                </select>
              </div>
              <div className="sc-cfg-field">
                <label className="sc-cfg-label">Service to remove</label>
                <select className="sc-cfg-select" value={requestDetails.serviceName} onChange={e => setRequestDetails(p => ({ ...p, serviceName: e.target.value }))}>
                  <option value="">Select service...</option>
                  {groups.find(g => g.name === requestDetails.groupName)?.services.map(s => (
                    <option key={s.name} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="sc-cfg-field">
            <label className="sc-cfg-label">Notes (optional)</label>
            <textarea className="sc-day-notes-input" placeholder="Reason for change, effective date, etc." value={requestDetails.notes} onChange={e => setRequestDetails(p => ({ ...p, notes: e.target.value }))} rows={2} />
          </div>
        </div>
        <div className="sc-day-footer">
          <div className="sc-day-actions">
            <button className="sc-btn sc-btn--cancel" onClick={onClose}>Cancel</button>
            <button className="sc-btn sc-btn--primary" disabled={saving} onClick={handleRequestSubmit}>{saving ? "Submitting..." : "Submit request"}</button>
          </div>
        </div>
      </div>
    );
  }

  // ── REVIEW ──
  if (showReview) {
    return (
      <div className="sc-day sc-day--review">
        <div className="sc-day-review-inner">
          <div className="sc-day-review-header">
            <h3 className="sc-day-review-title">Review config changes</h3>
            <p className="sc-day-review-date">{account.key} — {account.name}</p>
          </div>
          <div className="sc-day-review-body">
            {changes.map((c, i) => (
              <div key={i} className="sc-day-review-row">
                {c.type === "price" && <span>{c.groupName} → {c.serviceName}: {fmtPrice(c.from)} → {fmtPrice(c.to)}</span>}
                {c.type === "deactivate" && <span style={{ color: "#dc2626" }}>Deactivate: {c.groupName} → {c.serviceName}</span>}
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: "#92400e", margin: "12px 0" }}>
            Price changes affect all revenue calculations including historical data. Price versioning coming soon.
          </p>
          <div className="sc-day-review-actions">
            <button className="sc-btn sc-btn--outline" onClick={() => setShowReview(false)}>Go back</button>
            <button className="sc-btn sc-btn--primary" disabled={saving} onClick={handleSave}>
              {saving ? "Saving..." : `Apply ${changes.length} change${changes.length !== 1 ? "s" : ""}`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── ADMIN EDITOR ──
  return (
    <div className="sc-day">
      <div className="sc-day-header">
        <div>
          <h3 className="sc-day-title">Service config</h3>
          <span style={{ fontSize: 13, color: "#6b7280" }}>{account.key} — {account.name}</span>
        </div>
        <button className="sc-day-close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>
      <div className="sc-day-coaching" style={{ background: "#f9fafb", borderColor: "#e5e7eb", color: "#6b7280" }}>
        Edit prices, add or deactivate services. Changes write to the config sheet.
      </div>
      <div className="sc-day-body">
        {groups.map(group => (
          <div key={group.name} className="sc-day-group">
            <div className="sc-day-group-header">
              <span className="sc-day-group-name">{group.name}</span>
              <span className="sc-day-group-price">{group.services.length} services</span>
            </div>
            {group.services.map(svc => {
              const key = `${group.name}::${svc.name}`;
              const origPrice = serviceGroups?.find(g => g.name === group.name)?.services.find(s => s.name === svc.name)?.price;
              const curPrice = editPrices[key] || "";
              const priceChanged = origPrice !== undefined && curPrice !== "" && Number(curPrice) !== origPrice;
              return (
                <div key={svc.name} className={`sc-cfg-row ${!svc.active ? "sc-cfg-row--inactive" : ""}`}>
                  <div className="sc-cfg-row-left">
                    <span className="sc-cfg-row-name">{svc.name}</span>
                    <span className="sc-cfg-row-meta">Col {svc.colIndex}{svc.taxFree ? " · Tax-free" : ""}</span>
                  </div>
                  <div className="sc-cfg-row-right">
                    <span className="sc-cfg-row-dollar">$</span>
                    <input type="text" inputMode="decimal" className={`sc-cfg-price ${priceChanged ? "sc-cfg-price--changed" : ""}`} value={curPrice} onChange={e => handlePriceChange(group.name, svc.name, e.target.value)} />
                    <button className={`sc-cfg-active-btn ${svc.active ? "sc-cfg-active-btn--on" : "sc-cfg-active-btn--off"}`} onClick={() => handleDeactivate(group.name, svc.name)} title={svc.active ? "Deactivate" : "Reactivate"}>
                      {svc.active ? "Active" : "Inactive"}
                    </button>
                  </div>
                </div>
              );
            })}
            <button className="sc-cfg-add-btn" onClick={() => { setShowAddForm(group.name); setNewService({ groupName: group.name, serviceName: "", price: "", taxFree: false }); }}>
              + Add service to {group.name}
            </button>
          </div>
        ))}
        <button className="sc-cfg-add-btn sc-cfg-add-btn--group" onClick={() => { setShowAddForm("__new__"); setNewService({ groupName: "", serviceName: "", price: "", taxFree: false }); setNewGroupName(""); }}>
          + Add new service group
        </button>
        {showAddForm && (
          <div className="sc-cfg-add-form">
            <div className="sc-cfg-add-form-header">{showAddForm === "__new__" ? "New service group" : `Add to ${showAddForm}`}</div>
            {showAddForm === "__new__" && (
              <div className="sc-cfg-field">
                <label className="sc-cfg-label">Group name</label>
                <input className="sc-cfg-input" type="text" placeholder="e.g. Rehab" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} />
              </div>
            )}
            <div className="sc-cfg-field">
              <label className="sc-cfg-label">Service name</label>
              <input className="sc-cfg-input" type="text" placeholder="e.g. Umpire Meal" value={newService.serviceName} onChange={e => setNewService(p => ({ ...p, serviceName: e.target.value }))} />
            </div>
            <div className="sc-cfg-field">
              <label className="sc-cfg-label">Price</label>
              <input className="sc-cfg-input" type="text" inputMode="decimal" placeholder="0.00" value={newService.price} onChange={e => setNewService(p => ({ ...p, price: e.target.value.replace(/[^0-9.]/g, "") }))} />
            </div>
            <div className="sc-cfg-field" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={newService.taxFree} onChange={e => setNewService(p => ({ ...p, taxFree: e.target.checked }))} />
              <label className="sc-cfg-label" style={{ margin: 0 }}>Tax-free service</label>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="sc-btn sc-btn--outline" onClick={() => setShowAddForm(null)}>Cancel</button>
              <button className="sc-btn sc-btn--primary" disabled={saving} onClick={handleAddService}>{saving ? "Adding..." : "Add service"}</button>
            </div>
          </div>
        )}
      </div>
      <div className="sc-day-footer">
        <div className="sc-day-actions">
          <button className="sc-btn sc-btn--cancel" onClick={onClose}>Cancel</button>
          <button className="sc-btn sc-btn--primary" disabled={!dirty || changes.length === 0 || saving} onClick={() => setShowReview(true)}>
            Review {changes.length} change{changes.length !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
    </div>
  );
}