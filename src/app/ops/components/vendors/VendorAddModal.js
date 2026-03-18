"use client";
import { useState, useEffect, useRef } from "react";

const CATEGORIES    = ["Produce", "Protein", "Dry Goods", "Dairy", "Beverage", "Paper", "Other"];
const PAYMENT_TERMS = ["NET30", "NET15", "NET7", "COD", "Prepaid", "Other"];
const DELIVERY_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function VendorAddModal({ accountKey, accountName, userEmail, showToast, onClose, onAdded }) {
  const [step, setStep]               = useState(1); // 1 = name + duplicate check, 2 = full form
  const [name, setName]               = useState("");
  const [duplicates, setDuplicates]   = useState([]);
  const [checkingDupe, setCheckingDupe] = useState(false);
  const [confirmedNew, setConfirmedNew] = useState(false);
  const [saving, setSaving]           = useState(false);

  const [form, setForm] = useState({
    category:     "",
    repName:      "",
    repEmail:     "",
    repPhone:     "",
    portalUrl:    "",
    portalUser:   "",
    portalPass:   "",
    notes:        "",
    paymentTerms: "",
    deliveryDays: [],
    minOrder:     "",
  });

  const debounceRef = useRef(null);
  const nameRef     = useRef(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  // Debounced duplicate check as user types
  useEffect(() => {
    if (name.trim().length < 3) { setDuplicates([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setCheckingDupe(true);
      fetch(`/api/ops?action=vendor-search&accountKey=${encodeURIComponent(accountKey)}&search=${encodeURIComponent(name.trim())}`)
        .then((r) => r.json())
        .then((d) => { if (d.success) setDuplicates(d.vendors?.slice(0, 3) || []); })
        .catch(() => {})
        .finally(() => setCheckingDupe(false));
    }, 400);
  }, [name, accountKey]);

  const toggleDay = (day) => {
    setForm((prev) => {
      const days = prev.deliveryDays.includes(day)
        ? prev.deliveryDays.filter((d) => d !== day)
        : [...prev.deliveryDays, day].sort((a, b) => DELIVERY_DAYS.indexOf(a) - DELIVERY_DAYS.indexOf(b));
      return { ...prev, deliveryDays: days };
    });
  };

  const proceed = () => {
    if (!name.trim()) { showToast("Vendor name is required", "error"); return; }
    if (duplicates.length > 0 && !confirmedNew) {
      showToast("Confirm this is a new vendor, or select an existing one", "error");
      return;
    }
    setStep(2);
  };

  const submit = () => {
    if (!form.category) { showToast("Category is required", "error"); return; }
    setSaving(true);
    fetch("/api/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action:       "vendor-add",
        accountKey,
        name:         name.trim(),
        category:     form.category,
        repName:      form.repName.trim(),
        repEmail:     form.repEmail.trim(),
        repPhone:     form.repPhone.trim(),
        portalUrl:    form.portalUrl.trim(),
        portalUser:   form.portalUser.trim(),
        portalPass:   form.portalPass,
        notes:        form.notes.trim(),
        paymentTerms: form.paymentTerms,
        deliveryDays: form.deliveryDays.join(","),
        minOrder:     form.minOrder ? Number(form.minOrder) : "",
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) { onAdded(); }
        else { showToast(d.error || "Failed to add vendor", "error"); }
      })
      .catch(() => showToast("Network error", "error"))
      .finally(() => setSaving(false));
  };

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="oh-modal-overlay" onClick={onClose}>
      <div className="oh-modal oh-vp-add-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="oh-modal-head">
          <div>
            <h3 className="oh-modal-title">Add Vendor</h3>
            <p className="oh-modal-subtitle">{accountName || accountKey}</p>
          </div>
          <button className="oh-vp-card-close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Step indicator */}
        <div className="oh-vp-steps">
          <div className={`oh-vp-step${step >= 1 ? " oh-vp-step--done" : ""}`}>1</div>
          <div className="oh-vp-step-line" />
          <div className={`oh-vp-step${step >= 2 ? " oh-vp-step--done" : ""}`}>2</div>
        </div>

        <div className="oh-vp-add-body">
          {/* ── Step 1: Name + duplicate check ── */}
          {step === 1 && (
            <div className="oh-vp-add-step">
              <div className="oh-vp-form-row">
                <label className="oh-vp-label">Vendor Name <span className="oh-vp-required">*</span></label>
                <input
                  ref={nameRef}
                  type="text"
                  className="oh-input"
                  placeholder="e.g. Sysco Cincinnati"
                  value={name}
                  onChange={(e) => { setName(e.target.value); setConfirmedNew(false); }}
                />
              </div>

              {/* Duplicate warning */}
              {checkingDupe && (
                <p className="oh-vp-dupe-checking">Checking for existing vendors…</p>
              )}
              {!checkingDupe && duplicates.length > 0 && (
                <div className="oh-vp-dupe-box">
                  <p className="oh-vp-dupe-title">⚠️ Similar vendors found</p>
                  {duplicates.map((v) => (
                    <div key={v.vendorId} className="oh-vp-dupe-row">
                      <span className="oh-vp-dupe-name">{v.name}</span>
                      <span className="oh-vp-dupe-cat">{v.category}</span>
                      {v.linkedToAccount
                        ? <span className="oh-vp-chip oh-vp-chip--linked">Already linked</span>
                        : <span className="oh-vp-chip oh-vp-chip--exists">Exists in master</span>
                      }
                    </div>
                  ))}
                  {!confirmedNew && (
                    <label className="oh-vp-dupe-confirm">
                      <input
                        type="checkbox"
                        checked={confirmedNew}
                        onChange={(e) => setConfirmedNew(e.target.checked)}
                      />
                      <span>This is a different vendor — continue adding</span>
                    </label>
                  )}
                </div>
              )}

              <div className="oh-vp-add-actions">
                <button className="oh-btn oh-btn--ghost" onClick={onClose}>Cancel</button>
                <button
                  className="oh-btn oh-btn--primary"
                  onClick={proceed}
                  disabled={!name.trim() || checkingDupe}
                >
                  Continue →
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Full form ── */}
          {step === 2 && (
            <div className="oh-vp-add-step">
              <div className="oh-vp-form-grid">
                {/* Category */}
                <div className="oh-vp-form-row oh-vp-form-row--full">
                  <label className="oh-vp-label">Category <span className="oh-vp-required">*</span></label>
                  <div className="oh-vp-cat-chips">
                    {CATEGORIES.map((c) => (
                      <button
                        key={c}
                        className={`oh-vp-cat-chip${form.category === c ? " oh-vp-cat-chip--selected" : ""}`}
                        onClick={() => set("category", c)}
                        type="button"
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Delivery Days */}
                <div className="oh-vp-form-row oh-vp-form-row--full">
                  <label className="oh-vp-label">Delivery Days</label>
                  <div className="oh-vp-day-row">
                    {DELIVERY_DAYS.map((d) => (
                      <label key={d} className="oh-vp-day-toggle">
                        <input
                          type="checkbox"
                          checked={form.deliveryDays.includes(d)}
                          onChange={() => toggleDay(d)}
                        />
                        <span>{d}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Payment Terms */}
                <div className="oh-vp-form-row">
                  <label className="oh-vp-label">Payment Terms</label>
                  <select className="oh-select" value={form.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)}>
                    <option value="">— Select —</option>
                    {PAYMENT_TERMS.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>

                {/* Min Order */}
                <div className="oh-vp-form-row">
                  <label className="oh-vp-label">Min Order ($)</label>
                  <input type="number" className="oh-input" min="0" placeholder="0" value={form.minOrder} onChange={(e) => set("minOrder", e.target.value)} />
                </div>

                {/* Rep section */}
                <div className="oh-vp-form-row">
                  <label className="oh-vp-label">Rep Name</label>
                  <input type="text" className="oh-input" placeholder="Jane Smith" value={form.repName} onChange={(e) => set("repName", e.target.value)} />
                </div>
                <div className="oh-vp-form-row">
                  <label className="oh-vp-label">Rep Phone</label>
                  <input type="tel" className="oh-input" placeholder="(513) 555-0100" value={form.repPhone} onChange={(e) => set("repPhone", e.target.value)} />
                </div>
                <div className="oh-vp-form-row oh-vp-form-row--full">
                  <label className="oh-vp-label">Rep Email</label>
                  <input type="email" className="oh-input" placeholder="jane@sysco.com" value={form.repEmail} onChange={(e) => set("repEmail", e.target.value)} />
                </div>

                {/* Portal section */}
                <div className="oh-vp-form-row oh-vp-form-row--full">
                  <label className="oh-vp-label">Ordering Portal URL</label>
                  <input type="url" className="oh-input" placeholder="https://order.sysco.com" value={form.portalUrl} onChange={(e) => set("portalUrl", e.target.value)} />
                </div>
                <div className="oh-vp-form-row">
                  <label className="oh-vp-label">Portal Username</label>
                  <input type="text" className="oh-input" value={form.portalUser} onChange={(e) => set("portalUser", e.target.value)} />
                </div>
                <div className="oh-vp-form-row">
                  <label className="oh-vp-label">Portal Password</label>
                  <input type="text" className="oh-input" value={form.portalPass} onChange={(e) => set("portalPass", e.target.value)} />
                </div>

                {/* Notes */}
                <div className="oh-vp-form-row oh-vp-form-row--full">
                  <label className="oh-vp-label">Notes</label>
                  <textarea className="oh-input oh-vp-textarea" rows={2} placeholder="Anything useful for the team…" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
                </div>
              </div>

              <div className="oh-vp-add-actions">
                <button className="oh-btn oh-btn--ghost" onClick={() => setStep(1)}>← Back</button>
                <button
                  className="oh-btn oh-btn--primary"
                  onClick={submit}
                  disabled={saving || !form.category}
                >
                  {saving ? "Adding…" : "Add Vendor"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}