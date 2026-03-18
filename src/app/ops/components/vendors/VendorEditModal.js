"use client";
import { useState, useEffect } from "react";

const DELIVERY_DAY_OPTIONS  = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DELIVERY_METHODS      = ["Direct Delivery", "Will Call / Pickup", "Shipped (Common Carrier)", "Drop Ship"];
const PAYMENT_TERMS_OPTIONS = ["Net 7", "Net 15", "Net 30", "Net 45", "Net 60", "COD", "Prepaid", "Credit Card", "I don't know"];
const CATEGORIES            = ["Produce", "Protein", "Dairy", "Dry Goods", "Beverage", "Packaging", "Cleaning", "Equipment", "Specialty", "Broadliner", "Other"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTimeTo12h(val) {
  if (!val) return "";
  const m = val.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return val;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${min} ${ampm}`;
}

function formatTimeTo24h(val) {
  if (!val) return "";
  const m = val.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return val;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = m[3].toUpperCase();
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${min}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Field({ label, children, hint }) {
  return (
    <div className="oh-vp-ef-field">
      <label className="oh-vp-ef-label">
        {label}
        {hint && <span className="oh-vp-ef-label-hint">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function FieldRow({ children }) {
  return <div className="oh-vp-ef-row">{children}</div>;
}

function FieldGroup({ title, children }) {
  return (
    <div className="oh-vp-ef-group">
      <div className="oh-vp-ef-group-title">{title}</div>
      <div className="oh-vp-ef-group-body">{children}</div>
    </div>
  );
}

function DayToggle({ day, checked, onChange }) {
  return (
    <label className="oh-vp-day-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(day, e.target.checked)} />
      <span>{day}</span>
    </label>
  );
}

function PasswordField({ value, onChange }) {
  const [show, setShow] = useState(false);
  return (
    <div className="oh-vp-ef-pass-wrap">
      <input
        type={show ? "text" : "password"}
        className="oh-input oh-vp-mono"
        placeholder="Password"
        value={value}
        onChange={onChange}
        autoComplete="new-password"
      />
      <button type="button" className="oh-vp-ef-pass-toggle" onClick={() => setShow(v => !v)} tabIndex={-1}>
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}

function SavedFlash({ visible }) {
  return (
    <span className={`oh-vp-ef-saved-flash${visible ? " oh-vp-ef-saved-flash--visible" : ""}`}>
      ✓ Saved
    </span>
  );
}

function SwitchWarning({ onSwitch, onStay }) {
  return (
    <div className="oh-vp-ef-switch-warn">
      <span>You have unsaved changes on this tab.</span>
      <div className="oh-vp-ef-switch-warn-actions">
        <button className="oh-vp-ef-switch-btn oh-vp-ef-switch-btn--stay" onClick={onStay}>Stay</button>
        <button className="oh-vp-ef-switch-btn oh-vp-ef-switch-btn--switch" onClick={onSwitch}>Switch anyway</button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function VendorEditModal({
  vendor,
  accountKey,
  isAdmin,
  userEmail,
  showToast,
  onSaved,
  onClose,
}) {
  const [activeTab, setActiveTab]   = useState("account");
  const [pendingTab, setPendingTab] = useState(null);
  const [acctSaved,  setAcctSaved]  = useState(false);
  const [masterSaved, setMasterSaved] = useState(false);

  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const parseDeliveryDays = (str) =>
    (str || "").split(",").map(s => s.trim()).filter(Boolean);

  // ── Account state ──
  const [acct, setAcctRaw] = useState({
    customerAccountNum: vendor.customerAccountNum || "",
    salesRepName:       vendor.salesRepName       || "",
    salesRepPhone:      vendor.salesRepPhone      || "",
    salesRepEmail:      vendor.salesRepEmail      || "",
    deliveryDays:       parseDeliveryDays(vendor.deliveryDays),
    cutoffTime:         formatTimeTo24h(vendor.cutoffTime || ""),
    deliveryMethod:     vendor.deliveryMethod     || "",
    portalUrl:          vendor.portalUrl          || "",
    portalUsername:     vendor.portalUsername     || "",
    portalPassword:     vendor.portalPassword     || "",
    contactName:        vendor.contactName        || "",
    contactEmail:       vendor.contactEmail       || "",
    contactPhone:       vendor.contactPhone       || "",
    paymentTerms:       vendor.paymentTerms       || "",
    minOrder:           String(vendor.minOrder || "").replace(/^\$/, ""),
    // NEW: account-specific site notes
    accountNotes:       vendor.accountNotes       || "",
  });
  const [acctEdited, setAcctEdited] = useState({});
  const [acctDirty, setAcctDirty]   = useState(false);
  const [saving, setSaving]         = useState(false);

  const setAcct = (field, value) => {
    setAcctRaw(prev => ({ ...prev, [field]: value }));
    setAcctEdited(prev => ({ ...prev, [field]: true }));
    setAcctDirty(true);
  };

  const toggleDay = (day, checked) => {
    setAcctRaw(prev => {
      const days = checked
        ? [...prev.deliveryDays, day]
        : prev.deliveryDays.filter(d => d !== day);
      days.sort((a, b) => DELIVERY_DAY_OPTIONS.indexOf(a) - DELIVERY_DAY_OPTIONS.indexOf(b));
      return { ...prev, deliveryDays: days };
    });
    setAcctEdited(prev => ({ ...prev, deliveryDays: true }));
    setAcctDirty(true);
  };

  const saveAccountFields = () => {
    setSaving(true);
    fetch("/api/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action:             "vendor-update",
        vendorId:           vendor.vendorId,
        accountKey,
        customerAccountNum: acct.customerAccountNum,
        salesRepName:       acct.salesRepName,
        salesRepPhone:      acct.salesRepPhone,
        salesRepEmail:      acct.salesRepEmail,
        deliveryDays:       acct.deliveryDays.join(","),
        cutoffTime:         formatTimeTo12h(acct.cutoffTime),
        deliveryMethod:     acct.deliveryMethod,
        portalUrl:          acct.portalUrl,
        portalUsername:     acct.portalUsername,
        portalPassword:     acct.portalPassword,
        contactName:        acct.contactName,
        contactEmail:       acct.contactEmail,
        contactPhone:       acct.contactPhone,
        paymentTerms:       acct.paymentTerms,
        minOrder:           acct.minOrder,
        // NEW: account-specific site notes
        accountNotes:       acct.accountNotes,
      }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setAcctDirty(false);
          setAcctEdited({});
          setAcctSaved(true);
          setTimeout(() => setAcctSaved(false), 2500);
          onSaved();
        } else {
          showToast(d.error || "Save failed", "error");
        }
      })
      .catch(() => showToast("Network error", "error"))
      .finally(() => setSaving(false));
  };

  // ── Master state ──
  const [master, setMasterRaw] = useState({
    name:     vendor.name     || "",
    category: vendor.category || "",
    website:  vendor.website  || "",
    notes:    vendor.notes    || "",
  });
  const [masterEdited, setMasterEdited] = useState({});
  const [masterDirty, setMasterDirty]   = useState(false);
  const [savingMaster, setSavingMaster] = useState(false);

  const setMaster = (field, value) => {
    setMasterRaw(prev => ({ ...prev, [field]: value }));
    setMasterEdited(prev => ({ ...prev, [field]: true }));
    setMasterDirty(true);
  };

  const saveMasterFields = () => {
    setSavingMaster(true);
    fetch("/api/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action:   "vendor-master-update",
        vendorId: vendor.vendorId,
        name:     master.name.trim(),
        category: master.category,
        website:  master.website.trim(),
        notes:    master.notes.trim(),
      }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setMasterDirty(false);
          setMasterEdited({});
          setMasterSaved(true);
          setTimeout(() => setMasterSaved(false), 2500);
          onSaved();
        } else {
          showToast(d.error || "Save failed", "error");
        }
      })
      .catch(() => showToast("Network error", "error"))
      .finally(() => setSavingMaster(false));
  };

  // ── Tab guard ──
  const handleTabClick = (tab) => {
    if (tab === activeTab) return;
    const dirty = activeTab === "account" ? acctDirty : masterDirty;
    if (dirty) { setPendingTab(tab); }
    else { setActiveTab(tab); }
  };

  const confirmSwitch = () => {
    if (activeTab === "account") { setAcctDirty(false); setAcctEdited({}); }
    else { setMasterDirty(false); setMasterEdited({}); }
    setActiveTab(pendingTab);
    setPendingTab(null);
  };

  const cx = (base, field, edited) =>
    `${base}${edited[field] ? " oh-vp-ef-input--edited" : ""}`;

  const isDirty    = activeTab === "account" ? acctDirty     : masterDirty;
  const isSaving   = activeTab === "account" ? saving        : savingMaster;
  const showSaved  = activeTab === "account" ? acctSaved     : masterSaved;
  const handleSave = activeTab === "account" ? saveAccountFields : saveMasterFields;

  return (
    <div className="oh-modal-overlay" onClick={onClose}>
      <div className="oh-modal oh-vp-edit-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="oh-vp-ef-header">
          <div>
            <h3 className="oh-vp-ef-title">{vendor.name}</h3>
            <p className="oh-vp-ef-subtitle">Editing · {accountKey}</p>
          </div>
          <button className="oh-vp-card-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="oh-vp-ef-tabs">
          <button
            className={`oh-vp-ef-tab${activeTab === "account" ? " oh-vp-ef-tab--active" : ""}`}
            onClick={() => handleTabClick("account")}
          >
            Account Settings
            {acctDirty && <span className="oh-vp-ef-tab-dot"/>}
            <span className="oh-vp-ef-tab-scope">{accountKey} only</span>
          </button>
          <button
            className={`oh-vp-ef-tab${activeTab === "vendor" ? " oh-vp-ef-tab--active" : ""}`}
            onClick={() => handleTabClick("vendor")}
          >
            Vendor Info
            {masterDirty && <span className="oh-vp-ef-tab-dot"/>}
            <span className="oh-vp-ef-tab-scope">all accounts</span>
          </button>
        </div>

        {/* Tab switch warning */}
        {pendingTab && (
          <SwitchWarning onSwitch={confirmSwitch} onStay={() => setPendingTab(null)} />
        )}

        {/* Body */}
        <div className="oh-vp-ef-body">

          {/* ── Account Settings tab ── */}
          {activeTab === "account" && (
            <div className="oh-vp-ef-tab-content">

              <FieldGroup title="Ordering">
                <FieldRow>
                  <Field label="Account #">
                    <input
                      type="text"
                      className={cx("oh-input oh-vp-mono", "customerAccountNum", acctEdited)}
                      placeholder="e.g. 00123456"
                      value={acct.customerAccountNum}
                      onChange={e => setAcct("customerAccountNum", e.target.value)}
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="Order Cutoff">
                    <input
                      type="time"
                      className={cx("oh-input oh-vp-ef-time", "cutoffTime", acctEdited)}
                      value={acct.cutoffTime}
                      onChange={e => setAcct("cutoffTime", e.target.value)}
                    />
                  </Field>
                </FieldRow>

                <Field label="Delivery Days">
                  <div className="oh-vp-day-row">
                    {DELIVERY_DAY_OPTIONS.map(day => (
                      <DayToggle
                        key={day}
                        day={day}
                        checked={acct.deliveryDays.includes(day)}
                        onChange={toggleDay}
                      />
                    ))}
                  </div>
                </Field>

                <FieldRow>
                  <Field label="Delivery Method">
                    <select
                      className={cx("oh-select", "deliveryMethod", acctEdited)}
                      value={acct.deliveryMethod}
                      onChange={e => setAcct("deliveryMethod", e.target.value)}
                    >
                      <option value="">— Select —</option>
                      {DELIVERY_METHODS.map(m => <option key={m}>{m}</option>)}
                    </select>
                  </Field>
                  <Field label="Payment Terms">
                    <select
                      className={cx("oh-select", "paymentTerms", acctEdited)}
                      value={acct.paymentTerms}
                      onChange={e => setAcct("paymentTerms", e.target.value)}
                    >
                      <option value="">— Select —</option>
                      {PAYMENT_TERMS_OPTIONS.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </Field>
                </FieldRow>

                <Field label="Min Order">
                  <div className="oh-vp-ef-min-order-wrap">
                    <span className="oh-vp-ef-currency">$</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      className={cx("oh-input oh-vp-ef-input--minorder", "minOrder", acctEdited)}
                      placeholder="0"
                      value={acct.minOrder}
                      onChange={e => setAcct("minOrder", e.target.value.replace(/[^0-9]/g, ""))}
                    />
                  </div>
                </Field>
              </FieldGroup>

              <FieldGroup title="Sales Rep">
                <Field label="Name">
                  <input
                    type="text"
                    className={cx("oh-input", "salesRepName", acctEdited)}
                    placeholder="Rep name"
                    value={acct.salesRepName}
                    onChange={e => setAcct("salesRepName", e.target.value)}
                    autoComplete="off"
                  />
                </Field>
                <FieldRow>
                  <Field label="Email">
                    <input
                      type="email"
                      className={cx("oh-input", "salesRepEmail", acctEdited)}
                      placeholder="rep@vendor.com"
                      value={acct.salesRepEmail}
                      onChange={e => setAcct("salesRepEmail", e.target.value)}
                      autoComplete="off"
                      name="sales-rep-email-do-not-autofill"
                    />
                  </Field>
                  <Field label="Phone">
                    <input
                      type="tel"
                      className={cx("oh-input", "salesRepPhone", acctEdited)}
                      placeholder="(555) 000-0000"
                      value={acct.salesRepPhone}
                      onChange={e => setAcct("salesRepPhone", e.target.value)}
                      autoComplete="off"
                    />
                  </Field>
                </FieldRow>
              </FieldGroup>

              <FieldGroup title="Contact">
                <Field label="Name">
                  <input
                    type="text"
                    className={cx("oh-input", "contactName", acctEdited)}
                    placeholder="Contact name"
                    value={acct.contactName}
                    onChange={e => setAcct("contactName", e.target.value)}
                    autoComplete="off"
                  />
                </Field>
                <FieldRow>
                  <Field label="Email">
                    <input
                      type="email"
                      className={cx("oh-input", "contactEmail", acctEdited)}
                      placeholder="contact@vendor.com"
                      value={acct.contactEmail}
                      onChange={e => setAcct("contactEmail", e.target.value)}
                      autoComplete="off"
                      name="contact-email-do-not-autofill"
                    />
                  </Field>
                  <Field label="Phone">
                    <input
                      type="tel"
                      className={cx("oh-input", "contactPhone", acctEdited)}
                      placeholder="(555) 000-0000"
                      value={acct.contactPhone}
                      onChange={e => setAcct("contactPhone", e.target.value)}
                      autoComplete="off"
                    />
                  </Field>
                </FieldRow>
              </FieldGroup>

              <FieldGroup title="Ordering Portal">
                <Field label="Portal URL">
                  <input
                    type="url"
                    className={cx("oh-input", "portalUrl", acctEdited)}
                    placeholder="https://…"
                    value={acct.portalUrl}
                    onChange={e => setAcct("portalUrl", e.target.value)}
                    autoComplete="off"
                  />
                </Field>
                <FieldRow>
                  <Field label="Username">
                    <input
                      type="text"
                      className={cx("oh-input oh-vp-mono", "portalUsername", acctEdited)}
                      placeholder="Username"
                      value={acct.portalUsername}
                      onChange={e => setAcct("portalUsername", e.target.value)}
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="Password">
                    <PasswordField
                      value={acct.portalPassword}
                      onChange={e => setAcct("portalPassword", e.target.value)}
                    />
                  </Field>
                </FieldRow>
              </FieldGroup>

              {/* NEW: Site Notes — account-specific, stored in vendor_accounts */}
              <FieldGroup title="Site Notes">
                <Field label="Notes" hint="Only visible for this account">
                  <textarea
                    className={cx("oh-input oh-vp-textarea oh-vp-ef-notes", "accountNotes", acctEdited)}
                    rows={4}
                    placeholder="e.g. Rep changed to Sarah in Jan, net 15 here vs net 30 elsewhere, always call before ordering…"
                    value={acct.accountNotes}
                    onChange={e => setAcct("accountNotes", e.target.value)}
                  />
                </Field>
              </FieldGroup>

            </div>
          )}

          {/* ── Vendor Info tab ── */}
          {activeTab === "vendor" && (
            <div className="oh-vp-ef-tab-content">

              <FieldGroup title="Identity">
                <FieldRow>
                  <Field label="Vendor Name">
                    <input
                      type="text"
                      className={cx("oh-input", "name", masterEdited)}
                      placeholder="Vendor name"
                      value={master.name}
                      onChange={e => setMaster("name", e.target.value)}
                    />
                  </Field>
                  <Field label="Category">
                    <select
                      className={cx("oh-select", "category", masterEdited)}
                      value={master.category}
                      onChange={e => setMaster("category", e.target.value)}
                    >
                      <option value="">— Select —</option>
                      {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </Field>
                </FieldRow>
                <Field label="Website">
                  <input
                    type="url"
                    className={cx("oh-input", "website", masterEdited)}
                    placeholder="https://…"
                    value={master.website}
                    onChange={e => setMaster("website", e.target.value)}
                  />
                </Field>
              </FieldGroup>

              <FieldGroup title="Notes">
                <Field label="Notes" hint="Visible to all accounts using this vendor">
                  <textarea
                    className={cx("oh-input oh-vp-textarea oh-vp-ef-notes", "notes", masterEdited)}
                    rows={5}
                    placeholder="Ordering tips, quality notes, contract reminders, seasonal availability…"
                    value={master.notes}
                    onChange={e => setMaster("notes", e.target.value)}
                  />
                </Field>
              </FieldGroup>

            </div>
          )}
        </div>

        {/* Footer */}
        <div className="oh-vp-ef-footer">
          <div className="oh-vp-ef-footer-left">
            <SavedFlash visible={showSaved} />
          </div>
          <div className="oh-vp-ef-footer-right">
            <button className="oh-btn oh-btn--ghost oh-vp-ef-cancel-btn" onClick={onClose} title="Cancel (Esc)">
              Cancel
              <span className="oh-vp-ef-esc-hint">esc</span>
            </button>
            <button
              className="oh-btn oh-btn--primary"
              onClick={handleSave}
              disabled={isSaving || !isDirty}
              title={!isDirty ? "Make a change to enable save" : undefined}
            >
              {isSaving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}